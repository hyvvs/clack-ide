use super::Failure;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::watch;

const MAX_REQUESTS: usize = 128;

#[derive(Default)]
struct Inner {
    next: u64,
    closing: bool,
    entries: HashMap<String, Arc<Entry>>,
}

pub struct Entry {
    owner: String,
    running: std::sync::atomic::AtomicBool,
    pub cancel: watch::Sender<bool>,
    done: watch::Sender<bool>,
}

#[derive(Default)]
pub struct InferenceState {
    inner: Arc<Mutex<Inner>>,
    pub(super) admission: Arc<super::admission::AdmissionState>,
}

impl InferenceState {
    pub fn completion(&self, id: &str) -> Option<watch::Receiver<bool>> {
        self.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entries
            .get(id)
            .map(|e| e.done.subscribe())
    }
    pub fn open(&self, owner: &str) -> Result<String, Failure> {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if inner.closing || inner.entries.len() >= MAX_REQUESTS {
            return Err(Failure::new("request-limit"));
        }
        inner.next = inner
            .next
            .checked_add(1)
            .ok_or_else(|| Failure::new("request-limit"))?;
        let id = format!("inference-{}", inner.next);
        inner.entries.insert(
            id.clone(),
            Arc::new(Entry {
                owner: owner.into(),
                running: false.into(),
                cancel: watch::channel(false).0,
                done: watch::channel(false).0,
            }),
        );
        Ok(id)
    }

    pub fn start(&self, owner: &str, id: &str) -> Result<Lease, Failure> {
        let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let entry = inner
            .entries
            .get(id)
            .filter(|e| e.owner == owner)
            .ok_or_else(|| Failure::new("cancelled"))?;
        if entry
            .running
            .swap(true, std::sync::atomic::Ordering::SeqCst)
        {
            return Err(Failure::new("invalid-request"));
        }
        Ok(Lease {
            id: id.into(),
            inner: self.inner.clone(),
            entry: entry.clone(),
        })
    }

    pub async fn cancel(&self, owner: &str, id: &str) {
        let mut done = {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            let Some(entry) = inner.entries.get(id).filter(|e| e.owner == owner).cloned() else {
                return;
            };
            entry.cancel.send_replace(true);
            if !entry.running.load(std::sync::atomic::Ordering::SeqCst) {
                inner.entries.remove(id);
                entry.done.send_replace(true);
            }
            entry.done.subscribe()
        };
        while !*done.borrow_and_update() {
            if done.changed().await.is_err() {
                break;
            }
        }
    }

    pub fn expire_reservation(&self, owner: &str, id: &str) {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = inner.entries.get(id).filter(|e| e.owner == owner) {
            if !entry.running.load(std::sync::atomic::Ordering::SeqCst) {
                entry.cancel.send_replace(true);
                entry.done.send_replace(true);
                inner.entries.remove(id);
            }
        }
    }

    pub fn close_owner(&self, owner: &str) {
        self.close(Some(owner));
    }
    pub fn shutdown(&self) {
        self.close(None);
    }
    fn close(&self, owner: Option<&str>) {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if owner.is_none() {
            inner.closing = true;
        }
        inner.entries.retain(|_, entry| {
            if owner.is_none_or(|owner| entry.owner == owner) {
                entry.cancel.send_replace(true);
                if !entry.running.load(std::sync::atomic::Ordering::SeqCst) {
                    entry.done.send_replace(true);
                    return false;
                }
            }
            true
        });
    }
    #[cfg(test)]
    pub(super) fn len(&self) -> usize {
        self.inner.lock().unwrap().entries.len()
    }
}
impl Drop for InferenceState {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub struct Lease {
    pub id: String,
    inner: Arc<Mutex<Inner>>,
    entry: Arc<Entry>,
}
impl Lease {
    pub fn cancelled(&self) -> bool {
        *self.entry.cancel.borrow()
    }
    pub async fn cancellation(&self) {
        let mut rx = self.entry.cancel.subscribe();
        while !*rx.borrow_and_update() {
            if rx.changed().await.is_err() {
                break;
            }
        }
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        self.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entries
            .remove(&self.id);
        self.entry.done.send_replace(true);
    }
}
