//! Explicitly opted-in, content-free delivery observations from production
//! reqwest. No HTTP body, socket handle, IP, request URL or tool text escapes.
//! Socket identity is not exposed by reqwest; downstream matching is provisional.
use serde::Serialize;
use std::{
    fs::{self, OpenOptions},
    panic::{catch_unwind, AssertUnwindSafe},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
}

pub fn loss_receipt(dropped: u64, mono_us: u64, run_id: Option<&str>) -> Receipt {
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
        run_id: run_id.map(str::to_owned),
    }
}

pub const ONE_MUSE_RUN_ENV: &str = "CLACK_ONE_MUSE_DIAGNOSTIC_RUN_ID";
pub const ONE_MUSE_ROOT_ENV: &str = "CLACK_ONE_MUSE_DIAGNOSTIC_ROOT";

pub fn valid_run_id(run_id: &str) -> bool {
    (8..=80).contains(&run_id.len())
        && run_id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && run_id.as_bytes()[0].is_ascii_alphanumeric()
}

type Sink = Arc<dyn Fn(Receipt) + Send + Sync>;

/// The owned root is already created by the coordinator. Resolving symlinks,
/// parent traversal or alternate roots at dispatch would weaken run ownership.
fn diagnostic_root(run_id: &str, root: &Path) -> Option<PathBuf> {
    if !root.is_absolute()
        || root.file_name()?.to_str()? != run_id
        || fs::symlink_metadata(root).ok()?.file_type().is_symlink()
        || !root.is_dir()
    {
        return None;
    }
    let canonical = fs::canonicalize(root).ok()?;
    (crate::modules::fs::to_canon(root) == crate::modules::fs::to_canon(&canonical))
        .then_some(canonical)
}

fn configured_root(run_id: &str) -> Option<PathBuf> {
    let root = std::env::var_os(ONE_MUSE_ROOT_ENV)?;
    diagnostic_root(run_id, Path::new(&root))
}

/// An app can manage this state only in an explicitly authorized diagnostic
/// session. The sink must enqueue or drop metadata promptly; it must not block.
pub struct DeliveryCapture {
    sink: Sink,
    origin: Instant,
    run_id: Option<String>,
    claimed: AtomicBool,
    readiness_acknowledged: AtomicBool,
}

impl DeliveryCapture {
    pub fn new(sink: impl Fn(Receipt) + Send + Sync + 'static) -> Self {
        Self {
            sink: Arc::new(sink),
            origin: Instant::now(),
            run_id: None,
            claimed: AtomicBool::new(false),
            readiness_acknowledged: AtomicBool::new(false),
        }
    }

    /// Only the host may bind a diagnostic run; there is no IPC installation route.
    pub fn for_run(run_id: String, sink: impl Fn(Receipt) + Send + Sync + 'static) -> Option<Self> {
        valid_run_id(&run_id).then(|| Self {
            sink: Arc::new(sink),
            origin: Instant::now(),
            run_id: Some(run_id),
            claimed: AtomicBool::new(false),
            readiness_acknowledged: AtomicBool::new(false),
        })
    }

    pub fn acknowledge_ready(&self, run_id: &str) -> bool {
        let root = configured_root(run_id);
        self.acknowledge_with_root(run_id, root.as_deref())
    }

    fn acknowledge_with_root(&self, run_id: &str, root: Option<&Path>) -> bool {
        if !self.ready_for(run_id)
            || root.is_none_or(|path| diagnostic_root(run_id, path).is_none())
        {
            return false;
        }
        self.readiness_acknowledged.store(true, Ordering::SeqCst);
        true
    }

    fn ready_for(&self, run_id: &str) -> bool {
        self.run_id.as_deref() == Some(run_id) && !self.claimed.load(Ordering::SeqCst)
    }

    /// Read-only confirmation for the isolated host's journal/broker handshake.
    pub fn registration_active(&self, run_id: &str) -> bool {
        self.run_id.as_deref() == Some(run_id) && self.readiness_acknowledged.load(Ordering::SeqCst)
    }

    /// The allowance is permanently spent on any attempted dispatch. The
    /// exclusive, fsynced claim also blocks another process with the same run.
    pub fn claim_once(&self, run_id: &str) -> Result<(), &'static str> {
        self.claim_with_root(run_id, configured_root(run_id))
    }

    fn claim_with_root(&self, run_id: &str, root: Option<PathBuf>) -> Result<(), &'static str> {
        if self.run_id.as_deref() != Some(run_id)
            || !self.readiness_acknowledged.load(Ordering::SeqCst)
        {
            return Err("diagnostic-not-ready");
        }
        self.claimed
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "diagnostic-dispatch-exhausted")?;
        let root = root.ok_or("diagnostic-run-root-invalid")?;
        self.claim_on_root(&root)
    }

    fn claim_on_root(&self, root: &Path) -> Result<(), &'static str> {
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(root.join("one-muse-dispatch.claim"))
            .map_err(|_| "diagnostic-durable-claim-failed")?;
        file.sync_all()
            .map_err(|_| "diagnostic-durable-claim-failed")?;
        // On POSIX, persist the directory entry as well as the claim file.
        #[cfg(unix)]
        fs::File::open(root)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| "diagnostic-durable-claim-failed")?;
        Ok(())
    }
}

pub(crate) struct RequestCapture {
    sink: Option<Sink>,
    origin: Instant,
    request_id: String,
    body_sequence: u64,
    run_id: Option<String>,
}

impl Default for RequestCapture {
    fn default() -> Self {
        Self {
            sink: None,
            origin: Instant::now(),
            request_id: String::new(),
            body_sequence: 0,
            run_id: None,
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
            run_id: capture.as_ref().and_then(|c| c.run_id.clone()),
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
            run_id: self.run_id.clone(),
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
            run_id: None,
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
            run_id: None,
        };
        request.record(Boundary::NativeBodyRead, 302);
        assert_eq!(request.body_sequence, 1);
    }

    #[test]
    fn opt_in_one_muse_claim_is_exclusive_durable_and_never_rearmed() {
        assert!(valid_run_id("muse-one-0123456789abcdef"));
        assert!(!valid_run_id("../wrong"));
        assert!(!valid_run_id("MUSE-ONE-abc"));
        let run_id = "muse-one-0123456789abcdef";
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let parent = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("clack-one-muse-{unique}-{}", std::process::id()));
        let root = parent.join(run_id);
        std::fs::create_dir_all(&root).unwrap();
        let capture = DeliveryCapture::for_run(run_id.into(), |_| {}).unwrap();
        assert!(!capture.readiness_acknowledged.load(Ordering::SeqCst));
        assert_eq!(capture.claim_once(run_id), Err("diagnostic-not-ready"));
        assert!(diagnostic_root(run_id, &root).is_some());
        assert!(diagnostic_root("some-other-run", &root).is_none());
        assert!(diagnostic_root(run_id, &root.join("..")).is_none());
        assert!(!capture.acknowledge_with_root("muse-one-stale", Some(&root)));
        assert!(!capture.acknowledge_with_root(run_id, Some(&root.join(".."))));
        assert!(capture.acknowledge_with_root(run_id, Some(&root)));
        capture.claim_with_root(run_id, Some(root.clone())).unwrap();
        assert_eq!(
            capture.claim_with_root(run_id, Some(root.clone())),
            Err("diagnostic-dispatch-exhausted")
        );
        assert_eq!(
            std::fs::metadata(root.join("one-muse-dispatch.claim"))
                .unwrap()
                .len(),
            0
        );
        let second_host = DeliveryCapture::for_run(run_id.into(), |_| {}).unwrap();
        assert!(second_host.acknowledge_with_root(run_id, Some(&root)));
        assert_eq!(
            second_host.claim_with_root(run_id, Some(root.clone())),
            Err("diagnostic-durable-claim-failed")
        );
        assert_eq!(
            second_host.claim_with_root(run_id, Some(root.clone())),
            Err("diagnostic-dispatch-exhausted")
        );
        std::fs::remove_dir_all(parent).unwrap();
    }

    #[test]
    fn concurrent_one_muse_dispatch_claims_admit_exactly_one_attempt() {
        let run_id = "muse-one-concurrency-fixture";
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let parent = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!(
                "clack-one-muse-race-{unique}-{}",
                std::process::id()
            ));
        let root = parent.join(run_id);
        std::fs::create_dir_all(&root).unwrap();
        let capture = Arc::new(DeliveryCapture::for_run(run_id.into(), |_| {}).unwrap());
        assert!(capture.acknowledge_with_root(run_id, Some(&root)));
        let joined: Vec<_> = (0..24)
            .map(|_| {
                let capture = capture.clone();
                let root = root.clone();
                std::thread::spawn(move || capture.claim_with_root(run_id, Some(root)))
            })
            .collect();
        let results: Vec<_> = joined
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| *result == &Err("diagnostic-dispatch-exhausted"))
                .count(),
            23
        );
        assert!(root.join("one-muse-dispatch.claim").is_file());
        std::fs::remove_dir_all(parent).unwrap();
    }

    #[test]
    fn run_bound_delivery_receipts_carry_only_the_explicit_run_id() {
        let run_id = "muse-one-0123456789abcdef";
        let received = Arc::new(Mutex::new(Vec::<Receipt>::new()));
        let output = received.clone();
        let capture = DeliveryCapture::for_run(run_id.into(), move |row| {
            output.lock().unwrap().push(row);
        })
        .unwrap();
        let mut request = RequestCapture {
            sink: Some(capture.sink),
            origin: capture.origin,
            request_id: "inference-1".into(),
            body_sequence: 0,
            run_id: capture.run_id,
        };
        request.record(Boundary::NativeDispatch, 0);
        request.record(Boundary::NativeBodyRead, 302);
        let receipt = loss_receipt(2, 50, Some(run_id));
        let rows = received.lock().unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].run_id.as_deref(), Some(run_id));
        assert_eq!(rows[1].run_id.as_deref(), Some(run_id));
        assert_eq!(receipt.run_id.as_deref(), Some(run_id));
        assert_eq!(rows[0].bytes, 0);
        assert_eq!(rows[1].bytes, 302);
        assert!(!serde_json::to_string(&*rows).unwrap().contains("content"));
        assert!(loss_receipt(1, 0, None).run_id.is_none());
    }
}
