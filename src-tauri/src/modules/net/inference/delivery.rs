//! Explicitly opted-in, content-free delivery observations from production
//! reqwest. No HTTP body, socket handle, IP, request URL or tool text escapes.
//! Socket identity is not exposed by reqwest; downstream matching is provisional.
use serde::Serialize;
use std::{
    panic::{catch_unwind, AssertUnwindSafe},
    sync::Arc,
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Boundary {
    NativeDispatch,
    NativeHeaders,
    NativeBodyRead,
    NativeSemanticProgress,
    NativeIpcForwarded,
    NativeIpcRejected,
    NativeProviderDone,
    NativeEof,
    NativeTerminal,
    NativeCollectorLoss,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub schema_version: u8,
    pub host: &'static str,
    pub request_id: String,
    pub boundary: Boundary,
    pub at_unix_ms: u64,
    /// Local monotonic microseconds since the observer was installed.
    pub mono_us: u64,
    pub sequence: u64,
    /// Application bytes only for read/IPC events, otherwise zero.
    pub bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dropped: Option<u64>,
}

pub fn loss_receipt(dropped: u64, mono_us: u64) -> Receipt {
    Receipt {
        schema_version: 1,
        host: "clack-native",
        request_id: "diagnostic".into(),
        boundary: Boundary::NativeCollectorLoss,
        at_unix_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis().min(u64::MAX as u128) as u64)
            .unwrap_or(0),
        mono_us,
        sequence: 0,
        bytes: 0,
        dropped: Some(dropped),
    }
}

type Sink = Arc<dyn Fn(Receipt) + Send + Sync>;

/// An app can manage this state only in an explicitly authorized diagnostic
/// session. The sink must enqueue or drop metadata promptly; it must not block.
pub struct DeliveryCapture {
    sink: Sink,
    origin: Instant,
}

impl DeliveryCapture {
    pub fn new(sink: impl Fn(Receipt) + Send + Sync + 'static) -> Self {
        Self {
            sink: Arc::new(sink),
            origin: Instant::now(),
        }
    }
}

pub(crate) struct RequestCapture {
    sink: Option<Sink>,
    origin: Instant,
    request_id: String,
    body_sequence: u64,
}

impl Default for RequestCapture {
    fn default() -> Self {
        Self {
            sink: None,
            origin: Instant::now(),
            request_id: String::new(),
            body_sequence: 0,
        }
    }
}

impl RequestCapture {
    pub fn record_kind(&mut self, kind: super::diagnostics::Kind, bytes: usize) {
        use super::diagnostics::Kind;
        let boundary = match kind {
            Kind::Dispatch => Boundary::NativeDispatch,
            Kind::Headers => Boundary::NativeHeaders,
            Kind::Body => Boundary::NativeBodyRead,
            Kind::MeaningfulProgress => Boundary::NativeSemanticProgress,
            Kind::IpcForwarded => Boundary::NativeIpcForwarded,
            Kind::IpcRejected => Boundary::NativeIpcRejected,
            Kind::ProviderDone => Boundary::NativeProviderDone,
            Kind::Eof => Boundary::NativeEof,
            Kind::Completed
            | Kind::Failed
            | Kind::FutureDropped
            | Kind::DeadlineObserved
            | Kind::CancellationObserved
            | Kind::TransportError => Boundary::NativeTerminal,
            _ => return,
        };
        self.record(boundary, bytes);
    }

    pub fn from_app(app: &tauri::AppHandle, request_id: &str) -> Self {
        let capture = app.try_state::<DeliveryCapture>();
        let valid = !request_id.is_empty()
            && request_id.len() <= 80
            && request_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
        Self {
            sink: if valid {
                capture.as_ref().map(|c| c.sink.clone())
            } else {
                None
            },
            origin: capture
                .as_ref()
                .map(|c| c.origin)
                .unwrap_or_else(Instant::now),
            request_id: if valid {
                request_id.into()
            } else {
                String::new()
            },
            body_sequence: 0,
        }
    }

    pub fn record(&mut self, boundary: Boundary, bytes: usize) {
        let Some(sink) = &self.sink else { return };
        if boundary == Boundary::NativeBodyRead {
            self.body_sequence = self.body_sequence.saturating_add(1);
        }
        let body_bytes = if matches!(
            boundary,
            Boundary::NativeBodyRead | Boundary::NativeIpcForwarded | Boundary::NativeIpcRejected
        ) {
            bytes as u64
        } else {
            0
        };
        let event = Receipt {
            schema_version: 1,
            host: "clack-native",
            request_id: self.request_id.clone(),
            boundary,
            at_unix_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis().min(u64::MAX as u128) as u64)
                .unwrap_or(0),
            mono_us: self.origin.elapsed().as_micros().min(u64::MAX as u128) as u64,
            sequence: self.body_sequence,
            bytes: body_bytes,
            dropped: None,
        };
        // Diagnostic observer faults never become transport failures.
        let _ = catch_unwind(AssertUnwindSafe(|| sink(event)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn metadata_is_content_free_and_observer_panics_cannot_stop_native_flow() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let seen = events.clone();
        let installed = DeliveryCapture::new(move |row| seen.lock().unwrap().push(row));
        let mut request = RequestCapture {
            sink: Some(installed.sink),
            origin: installed.origin,
            request_id: "inference-27".into(),
            body_sequence: 0,
        };
        request.record(Boundary::NativeBodyRead, 149);
        request.record(Boundary::NativeSemanticProgress, 149);
        request.record(Boundary::NativeIpcForwarded, 149);
        request.record(Boundary::NativeBodyRead, 153);
        request.record(Boundary::NativeTerminal, 0);
        let rows = events.lock().unwrap();
        assert_eq!(rows.len(), 5);
        assert_eq!(rows[0].sequence, 1);
        assert_eq!(rows[1].bytes, 0);
        assert_eq!(rows[2].bytes, 149);
        assert_eq!(rows[3].sequence, 2);
        assert_eq!(rows[4].bytes, 0);
        let serialized = serde_json::to_string(&*rows).unwrap();
        assert!(!serialized.contains("content"));
        assert!(!serialized.contains("socket"));
        drop(rows);
        let failed = DeliveryCapture::new(|_| panic!("test-only diagnostic failure"));
        let mut request = RequestCapture {
            sink: Some(failed.sink),
            origin: failed.origin,
            request_id: "inference-27".into(),
            body_sequence: 0,
        };
        request.record(Boundary::NativeBodyRead, 302);
        assert_eq!(request.body_sequence, 1);
    }
}
