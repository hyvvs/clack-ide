use super::Failure;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tokio::sync::watch;

// Fixed, payload-free provenance. The native receiver does not trust or store
// caller-supplied text. A stream-consumer cancellation is not proof of *why*
// the SDK stopped reading (provider error, parser failure, or explicit cancel).
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CancelOrigin {
    Unspecified,
    StreamConsumer,
    SdkStreamError,
    ProviderRetryError,
    ProviderRetryFinalizer,
    SettledCleanup,
    ParentSignal,
    SessionStop,
    ScopeSuperseded,
    PreflightFailure,
    ResponseConstructionFailure,
    NativeCommandFailure,
    FetchPreparationFailure,
}
impl CancelOrigin {
    fn layer(self) -> &'static str {
        match self {
            Self::SdkStreamError => "ollama-sdk-stream-parser",
            Self::ProviderRetryError | Self::ProviderRetryFinalizer => "provider-retry-middleware",
            Self::StreamConsumer => "response-stream-consumer",
            Self::ParentSignal | Self::SettledCleanup => "request-abort-signal",
            Self::SessionStop => "inference-lifecycle",
            Self::ScopeSuperseded => "inference-scope",
            Self::PreflightFailure => "request-preflight",
            Self::ResponseConstructionFailure | Self::FetchPreparationFailure => "proxy-fetch",
            Self::NativeCommandFailure => "native-command-invocation",
            Self::Unspecified => "unknown-webview-caller",
        }
    }
    fn category(self) -> &'static str {
        match self {
            Self::SessionStop => "explicit-or-lifecycle",
            Self::ScopeSuperseded => "supersession",
            Self::StreamConsumer => "consumer-cleanup",
            Self::SdkStreamError | Self::ProviderRetryError => "error-cleanup",
            Self::ProviderRetryFinalizer | Self::SettledCleanup => "cleanup",
            Self::PreflightFailure
            | Self::ResponseConstructionFailure
            | Self::NativeCommandFailure
            | Self::FetchPreparationFailure => "error-cleanup",
            Self::ParentSignal | Self::Unspecified => "unknown",
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CancellationProvenance {
    pub request_id: String,
    pub at: u64,
    pub source: &'static str,
    pub initiating_layer: &'static str,
    pub reason: &'static str,
    pub category: &'static str,
    // A dispatched HTTP stream still owned by Clack, NOT a claim that
    // Ollama's decoder was actively generating at this precise instant.
    pub provider_request_in_flight: bool,
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis().min(u64::MAX as u128) as u64)
}

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
    preflight: watch::Sender<Option<bool>>,
    preflight_pending: std::sync::atomic::AtomicBool,
    provider_request_in_flight: AtomicBool,
    cancellation: Mutex<Option<CancellationProvenance>>,
}
impl Entry {
    fn note_cancel(
        &self,
        id: &str,
        source: &'static str,
        layer: &'static str,
        reason: &'static str,
        category: &'static str,
    ) {
        // Preserve the *first* initiating signal, even if cleanup later sends
        // another ai_http_cancel or host shutdown. The watch retains its
        // original boolean-only cancellation semantics.
        let mut first = self.cancellation.lock().unwrap_or_else(|e| e.into_inner());
        if first.is_none() {
            *first = Some(CancellationProvenance {
                request_id: id.into(),
                at: now_millis(),
                source,
                initiating_layer: layer,
                reason,
                category,
                provider_request_in_flight: self.provider_request_in_flight.load(Ordering::SeqCst),
            });
        }
    }
    fn cancel_with(
        &self,
        id: &str,
        source: &'static str,
        layer: &'static str,
        reason: &'static str,
        category: &'static str,
    ) {
        self.note_cancel(id, source, layer, reason, category);
        self.cancel.send_replace(true);
    }
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
                preflight: watch::channel(None).0,
                preflight_pending: false.into(),
                provider_request_in_flight: false.into(),
                cancellation: Mutex::new(None),
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
            require_preflight: false,
        })
    }

    pub fn approve_preflight(&self, owner: &str, id: &str, approved: bool) -> Result<(), Failure> {
        let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let entry = inner
            .entries
            .get(id)
            .filter(|e| e.owner == owner)
            .ok_or_else(|| Failure::new("cancelled"))?;
        if !entry
            .preflight_pending
            .swap(false, std::sync::atomic::Ordering::SeqCst)
        {
            return Err(Failure::new("invalid-request"));
        }
        entry.preflight.send_replace(Some(approved));
        Ok(())
    }

    pub async fn cancel(&self, owner: &str, id: &str) {
        self.cancel_with_origin(owner, id, CancelOrigin::Unspecified)
            .await;
    }
    pub async fn cancel_with_origin(&self, owner: &str, id: &str, origin: CancelOrigin) {
        let mut done = {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            let Some(entry) = inner.entries.get(id).filter(|e| e.owner == owner).cloned() else {
                return;
            };
            let reason = match origin {
                CancelOrigin::Unspecified => "unspecified",
                CancelOrigin::StreamConsumer => "response-reader-cancelled",
                CancelOrigin::SdkStreamError => "sdk-stream-parser-failed",
                CancelOrigin::ProviderRetryError => "provider-retry-reader-error",
                CancelOrigin::ProviderRetryFinalizer => "provider-retry-finalizer",
                CancelOrigin::SettledCleanup => "sdk-request-settled-cleanup",
                CancelOrigin::ParentSignal => "parent-abort-signal",
                CancelOrigin::SessionStop => "session-inference-stopped",
                CancelOrigin::ScopeSuperseded => "request-scope-superseded",
                CancelOrigin::PreflightFailure => "preflight-denied-or-failed",
                CancelOrigin::ResponseConstructionFailure => "response-construction-failed",
                CancelOrigin::NativeCommandFailure => "native-command-rejected",
                CancelOrigin::FetchPreparationFailure => "fetch-preparation-failed",
            };
            entry.cancel_with(
                id,
                "webview-cancel-ipc",
                origin.layer(),
                reason,
                origin.category(),
            );
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
                entry.cancel_with(
                    id,
                    "reservation-expiry",
                    "native-registry",
                    "unstarted-reservation-expired",
                    "cleanup",
                );
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
        inner.entries.retain(|id, entry| {
            if owner.is_none_or(|owner| entry.owner == owner) {
                entry.cancel_with(
                    id,
                    if owner.is_some() {
                        "window-close"
                    } else {
                        "host-shutdown"
                    },
                    "native-lifecycle",
                    if owner.is_some() {
                        "window-owner-closed"
                    } else {
                        "host-shutdown"
                    },
                    "cleanup",
                );
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
    pub require_preflight: bool,
}
impl Lease {
    pub fn note_ipc_rejected(&self) {
        // A failed Channel send cancels execution without setting the watch.
        // Record the cause, but do not introduce an additional cancellation.
        self.entry.note_cancel(
            &self.id,
            "native-channel",
            "native-transport",
            "ipc-event-delivery-rejected",
            "transport",
        );
    }
    pub fn mark_provider_dispatched(&self) {
        self.entry
            .provider_request_in_flight
            .store(true, Ordering::SeqCst);
    }
    pub fn cancellation_provenance(&self) -> Option<CancellationProvenance> {
        self.entry
            .cancellation
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
    pub(crate) fn cancellation_sender(&self) -> watch::Sender<bool> {
        self.entry.cancel.clone()
    }
    pub(crate) fn owner(&self) -> &str {
        &self.entry.owner
    }
    pub fn request_preflight(&self) -> watch::Receiver<Option<bool>> {
        self.entry
            .preflight_pending
            .store(true, std::sync::atomic::Ordering::SeqCst);
        self.entry.preflight.subscribe()
    }
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
        self.entry
            .provider_request_in_flight
            .store(false, Ordering::SeqCst);
        self.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entries
            .remove(&self.id);
        self.entry.done.send_replace(true);
    }
}
