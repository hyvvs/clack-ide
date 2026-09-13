use super::{registry::Lease, Failure};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::watch;

#[cfg(test)]
#[path = "admission_tests.rs"]
mod tests;

pub const MAX_CAPACITY: usize = 8;
const MAX_ENTRIES: usize = 128;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Admission {
    pub endpoint_id: String,
    pub profile_id: String,
    pub capacity: usize,
}
impl Admission {
    fn validate(&self) -> Result<(), Failure> {
        if !(1..=MAX_CAPACITY).contains(&self.capacity)
            || self.endpoint_id.is_empty()
            || self.endpoint_id.len() > 2048
            || self.profile_id.is_empty()
            || self.profile_id.len() > 40 * 1024
            || self.endpoint_id.chars().any(char::is_control)
        {
            return Err(Failure::new("invalid-capacity"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    pub endpoint_id: String,
    pub profile_id: String,
    pub capacity: usize,
    pub queue_entered_at: u64,
    pub admitted_at: Option<u64>,
    pub attempt_started_at: Option<u64>,
    pub settled_at: Option<u64>,
}
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
struct Entry {
    endpoint: String,
    capacity: usize,
    active: bool,
}
#[derive(Default)]
struct Inner {
    entries: HashMap<String, Entry>,
    queue: VecDeque<String>,
}
pub struct AdmissionState {
    inner: Mutex<Inner>,
    changed: watch::Sender<u64>,
}
impl Default for AdmissionState {
    fn default() -> Self {
        Self {
            inner: Mutex::default(),
            changed: watch::channel(0).0,
        }
    }
}
impl AdmissionState {
    fn notify(&self) {
        self.changed.send_modify(|n| *n = n.wrapping_add(1));
    }
    pub async fn acquire(
        self: &Arc<Self>,
        lease: &Lease,
        spec: Admission,
        queued: impl Fn(&Observation) -> bool,
    ) -> Result<Permit, Failure> {
        spec.validate()?;
        let mut changed = self.changed.subscribe();
        let mut permit = Permit {
            owner: self.clone(),
            id: lease.id.clone(),
            registered: false,
            observation: Observation {
                endpoint_id: spec.endpoint_id.clone(),
                profile_id: spec.profile_id,
                capacity: spec.capacity,
                queue_entered_at: now(),
                admitted_at: None,
                attempt_started_at: None,
                settled_at: None,
            },
        };
        {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            if inner.entries.contains_key(&lease.id) {
                return Err(Failure::new("duplicate-admission"));
            }
            if inner.entries.len() >= MAX_ENTRIES {
                return Err(Failure::new("admission-limit"));
            }
            inner.queue.push_back(lease.id.clone());
            inner.entries.insert(
                lease.id.clone(),
                Entry {
                    endpoint: spec.endpoint_id.clone(),
                    capacity: spec.capacity,
                    active: false,
                },
            );
            permit.registered = true;
        }
        let mut reported = false;
        loop {
            if lease.cancelled() {
                return Err(Failure::new("cancelled"));
            }
            {
                let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                let capacity = inner
                    .entries
                    .values()
                    .filter(|e| e.endpoint == spec.endpoint_id)
                    .map(|e| e.capacity)
                    .min()
                    .unwrap_or(1);
                let active = inner
                    .entries
                    .values()
                    .filter(|e| e.endpoint == spec.endpoint_id && e.active)
                    .count();
                let first = inner.queue.iter().find(|id| {
                    inner
                        .entries
                        .get(*id)
                        .is_some_and(|e| e.endpoint == spec.endpoint_id)
                });
                permit.observation.capacity = capacity;
                if active < capacity && first == Some(&lease.id) {
                    inner.queue.retain(|id| id != &lease.id);
                    inner.entries.get_mut(&lease.id).unwrap().active = true;
                    permit.observation.admitted_at = Some(now());
                    drop(inner);
                    self.notify();
                    return Ok(permit);
                }
            }
            if !reported {
                if !queued(&permit.observation) {
                    return Err(Failure::new("cancelled"));
                }
                reported = true;
            }
            tokio::select! {
                biased;
                _ = lease.cancellation() => return Err(Failure::new("cancelled")),
                _ = changed.changed() => {},
            }
        }
    }
}
pub struct Permit {
    owner: Arc<AdmissionState>,
    id: String,
    registered: bool,
    pub observation: Observation,
}
impl Drop for Permit {
    fn drop(&mut self) {
        if self.registered {
            let mut inner = self.owner.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.entries.remove(&self.id);
            inner.queue.retain(|id| id != &self.id);
            drop(inner);
            self.owner.notify();
        }
    }
}
