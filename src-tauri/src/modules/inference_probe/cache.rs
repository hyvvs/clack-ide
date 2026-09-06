use super::metadata::{Endpoint, ErrorCode, ProbeError, INVENTORY_TTL_MS};
use super::Snapshot;
use futures_util::future::{AbortHandle, AbortRegistration};
use std::collections::HashMap;
use tokio::sync::watch;

pub type Outcome = Result<Snapshot, ProbeError>;
pub type Receiver = watch::Receiver<Option<Outcome>>;
const MAX_ENDPOINTS: usize = 8;
const MAX_CACHE_BYTES: usize = 32 * 1024 * 1024;

struct Flight {
    generation: u64,
    abort: AbortHandle,
    sender: watch::Sender<Option<Outcome>>,
}
struct Entry {
    endpoint: Endpoint,
    selected: Option<String>,
    allow_private: bool,
    snapshot: Option<Snapshot>,
    bytes: usize,
    flight: Option<Flight>,
    touched: u64,
}
#[derive(Default)]
pub struct Cache {
    entries: HashMap<String, Entry>,
    generation: u64,
}
pub enum Begin {
    Cached(Snapshot),
    Join(Receiver),
    Start {
        generation: u64,
        receiver: Receiver,
        registration: AbortRegistration,
    },
}

impl Entry {
    fn cancel(&mut self) {
        if let Some(flight) = self.flight.take() {
            flight.abort.abort();
            flight
                .sender
                .send_replace(Some(Err(ProbeError::new(ErrorCode::Cancelled))));
        }
    }
}

impl Cache {
    pub fn reconcile(&mut self, endpoints: &[Endpoint]) {
        self.entries.retain(|id, entry| {
            if endpoints
                .iter()
                .any(|e| e.id == *id && e == &entry.endpoint && e.deleted_at.is_none())
            {
                true
            } else {
                entry.cancel();
                false
            }
        });
    }
    pub fn invalidate_account(&mut self, account: &str) {
        self.entries.retain(|_, entry| {
            if entry.endpoint.account().ok().flatten().as_deref() == Some(account) {
                entry.cancel();
                false
            } else {
                true
            }
        });
    }
    pub fn cancel(&mut self, id: &str) {
        if let Some(entry) = self.entries.get_mut(id) {
            entry.cancel();
        }
    }
    pub fn snapshot(
        &self,
        endpoint: &Endpoint,
        _selected: Option<&str>,
        private: bool,
        now: u64,
    ) -> Option<Snapshot> {
        // Inventory is endpoint-wide. The snapshot retains its original selected
        // model and scoped evidence; reading another binding adds no evidence.
        let entry = self.entries.get(&endpoint.id)?;
        if entry.endpoint != *endpoint || entry.allow_private != private {
            return None;
        }
        let mut snapshot = entry.snapshot.clone()?;
        snapshot.stale |= now.saturating_sub(snapshot.observed_at) >= INVENTORY_TTL_MS;
        snapshot.refreshing = entry.flight.is_some();
        Some(snapshot)
    }
    pub fn begin(
        &mut self,
        endpoint: &Endpoint,
        selected: Option<String>,
        private: bool,
        force: bool,
        restart: bool,
        now: u64,
    ) -> Result<Begin, ProbeError> {
        if let Some(entry) = self.entries.get_mut(&endpoint.id) {
            if entry.endpoint != *endpoint
                || entry.selected != selected
                || entry.allow_private != private
            {
                entry.cancel();
                self.entries.remove(&endpoint.id);
            }
        }
        if !self.entries.contains_key(&endpoint.id) && self.entries.len() >= MAX_ENDPOINTS {
            let oldest = self
                .entries
                .iter()
                .filter(|(_, e)| e.flight.is_none())
                .min_by_key(|(_, e)| e.touched)
                .map(|(id, _)| id.clone());
            if let Some(id) = oldest {
                self.entries.remove(&id);
            } else {
                return Err(ProbeError::new(ErrorCode::Busy));
            }
        }
        let entry = self
            .entries
            .entry(endpoint.id.clone())
            .or_insert_with(|| Entry {
                endpoint: endpoint.clone(),
                selected,
                allow_private: private,
                snapshot: None,
                bytes: 0,
                flight: None,
                touched: now,
            });
        entry.touched = now;
        if restart {
            entry.cancel();
        }
        if let Some(flight) = &entry.flight {
            return Ok(Begin::Join(flight.sender.subscribe()));
        }
        if !force && !restart {
            if let Some(snapshot) = &entry.snapshot {
                if !snapshot.stale && now.saturating_sub(snapshot.observed_at) < INVENTORY_TTL_MS {
                    return Ok(Begin::Cached(snapshot.clone()));
                }
            }
        }
        self.generation += 1;
        let generation = self.generation;
        let (sender, receiver) = watch::channel(None);
        let (abort, registration) = AbortHandle::new_pair();
        entry.flight = Some(Flight {
            generation,
            abort,
            sender,
        });
        Ok(Begin::Start {
            generation,
            receiver,
            registration,
        })
    }
    pub fn current(&self, endpoint: &Endpoint, generation: u64) -> bool {
        self.entries.get(&endpoint.id).is_some_and(|e| {
            e.endpoint == *endpoint
                && e.flight
                    .as_ref()
                    .is_some_and(|f| f.generation == generation)
        })
    }
    pub fn finish(&mut self, endpoint: &Endpoint, generation: u64, outcome: Outcome) {
        if !self.current(endpoint, generation) {
            return;
        }
        let entry = self.entries.get_mut(&endpoint.id).expect("current entry");
        let result = match outcome {
            Ok(snapshot) if snapshot.connected => {
                entry.snapshot = Some(snapshot.clone());
                Ok(snapshot)
            }
            other => {
                if let Some(previous) = &mut entry.snapshot {
                    previous.stale = true;
                    previous.refreshing = false;
                    previous.connected = false;
                    previous.reachable = match &other {
                        Ok(s) => s.reachable,
                        Err(e) => e.reachable,
                    };
                    previous.errors = match &other {
                        Ok(s) => s.errors.clone(),
                        Err(e) => vec![super::RouteError {
                            route: None,
                            error: e.clone(),
                        }],
                    };
                    Ok(previous.clone())
                } else {
                    if let Ok(s) = &other {
                        entry.snapshot = Some(s.clone());
                    }
                    other
                }
            }
        };
        entry.bytes = entry
            .snapshot
            .as_ref()
            .map_or(0, |s| serde_json::to_vec(s).map_or(0, |v| v.len()));
        if let Some(flight) = entry.flight.take() {
            flight.sender.send_replace(Some(result));
        }
        while self.entries.values().map(|e| e.bytes).sum::<usize>() > MAX_CACHE_BYTES {
            let oldest = self
                .entries
                .iter()
                .filter(|(id, e)| **id != endpoint.id && e.snapshot.is_some())
                .min_by_key(|(_, e)| e.touched)
                .map(|(id, _)| id.clone());
            if let Some(id) = oldest {
                if let Some(entry) = self.entries.get_mut(&id) {
                    entry.snapshot = None;
                    entry.bytes = 0;
                }
            } else {
                break;
            }
        }
    }
}

pub async fn receive(mut receiver: Receiver) -> Outcome {
    loop {
        if let Some(result) = receiver.borrow().clone() {
            return result;
        }
        receiver
            .changed()
            .await
            .map_err(|_| ProbeError::new(ErrorCode::Cancelled))?;
    }
}
