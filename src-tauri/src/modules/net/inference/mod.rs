mod admission;
pub mod diagnostics;
pub mod delivery;
mod progress;
mod registry;
mod response_budget;
#[cfg(test)]
mod tests;
use super::{
    build_request, build_safe_client, header_map_to_strings, ip_kind, validate_url, IpKind,
};
use futures_util::StreamExt;
use progress::Progress;
use response_budget::ResponseByteBudget;
pub use registry::InferenceState;
use registry::{CancelOrigin, CancellationProvenance};
pub(crate) use registry::Lease;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    future::Future,
    net::{IpAddr, ToSocketAddrs},
    sync::{Arc, OnceLock},
    time::Duration,
};
use tauri::{ipc::Channel, Manager};
use tokio::{
    sync::{oneshot, Semaphore},
    time::Instant,
};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub code: String,
}
impl Failure {
    fn new(code: &str) -> Self {
        Self { code: code.into() }
    }
}

const ONE_MUSE_ENDPOINT: &str = "http://127.0.0.1:11435/api/chat";
const ONE_MUSE_MODEL: &str = "muse-glimmer:30b";
pub const ONE_MUSE_PERMIT_ENV: &str = "CLACK_ONE_MUSE_DIAGNOSTIC_PERMIT_SHA256";

fn valid_one_muse_permit(permit: Option<&str>, expected_hash: Option<&str>) -> bool {
    let (Some(permit), Some(expected_hash)) = (permit, expected_hash) else {
        return false;
    };
    if permit.len() != 64 || !permit.bytes().all(|byte| byte.is_ascii_hexdigit())
        || expected_hash.len() != 64
        || !expected_hash.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return false;
    }
    let observed = format!("{:x}", Sha256::digest(permit.as_bytes()));
    let mut difference = 0_u8;
    for (a, b) in observed.bytes().zip(expected_hash.bytes()) {
        difference |= a ^ b;
    }
    difference == 0
}

fn active_one_muse_run() -> Result<Option<String>, Failure> {
    if std::env::var_os(delivery::ONE_MUSE_RUN_ENV).is_none() {
        return Ok(None);
    }
    let run_id = std::env::var(delivery::ONE_MUSE_RUN_ENV)
        .map_err(|_| Failure::new("diagnostic-run-invalid"))?;
    if !delivery::valid_run_id(&run_id) {
        return Err(Failure::new("diagnostic-run-invalid"));
    }
    Ok(Some(run_id))
}

#[derive(Clone, Copy)]
struct OneMuseRequest<'a> {
    run_id: Option<&'a str>,
    url: &'a str,
    method: &'a str,
    headers: Option<&'a HashMap<String, String>>,
    body: Option<&'a [u8]>,
    allow_private: bool,
    policy: Option<Policy>,
    admission: Option<&'a admission::Admission>,
    preflight: bool,
    fallback: bool,
}

/// The one-Muse session is deliberately narrower than ordinary provider IPC.
/// It accepts a single streaming, tool-free diagnostic prompt, without rewriting
/// its bytes or introducing a second parser/transport implementation.
fn valid_one_muse_request(expected_run_id: &str, request: &OneMuseRequest<'_>) -> bool {
    if request.run_id != Some(expected_run_id)
        || request.url != ONE_MUSE_ENDPOINT
        || request.method != "POST"
        || !request.headers.is_some_and(|headers| headers.len() == 1
            && headers.iter().all(|(name, value)|
                name.eq_ignore_ascii_case("content-type") && value == "application/json"))
        || !request.allow_private
        || !matches!(request.policy, Some(Policy::SelfHosted))
        || request.admission.is_none_or(|entry| entry.capacity != 1)
        || request.preflight
        || request.fallback
    {
        return false;
    }
    let Some(body) = request.body else { return false };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(body) else {
        return false;
    };
    let Some(data) = value.as_object() else { return false };
    if data.keys().any(|key| !matches!(key.as_str(), "model" | "messages" | "stream" | "options"))
        || data.get("model").and_then(|v| v.as_str()) != Some(ONE_MUSE_MODEL)
        || data.get("stream").and_then(|v| v.as_bool()) != Some(true)
    {
        return false;
    }
    let Some(options) = data.get("options").and_then(|v| v.as_object()) else {
        return false;
    };
    if options.keys().any(|key| !matches!(key.as_str(), "num_ctx" | "num_predict"))
        || options.get("num_ctx").and_then(|v| v.as_u64()) != Some(32768)
        || options.get("num_predict").and_then(|v| v.as_u64()) != Some(8192)
    {
        return false;
    }
    let Some(messages) = data.get("messages").and_then(|v| v.as_array()) else {
        return false;
    };
    let [message] = messages.as_slice() else { return false };
    let Some(message) = message.as_object() else { return false };
    message.keys().all(|key| matches!(key.as_str(), "role" | "content"))
        && message.get("role").and_then(|v| v.as_str()) == Some("user")
        && message.get("content").and_then(|v| v.as_str()).is_some_and(|text| !text.trim().is_empty())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OneMuseDiagnosticReady {
    run_id: String,
    native_ready: bool,
}

/// A positive registration ACK, usable only after the trusted host has installed
/// a bound native delivery collector. It never activates tracing or inference.
#[tauri::command]
pub fn ai_http_diagnostic_ready(
    app: tauri::AppHandle,
    run_id: String,
) -> Result<OneMuseDiagnosticReady, Failure> {
    if active_one_muse_run()?.as_deref() != Some(run_id.as_str())
        || !app.try_state::<delivery::DeliveryCapture>()
            .is_some_and(|capture| capture.acknowledge_ready(&run_id))
    {
        return Err(Failure::new("diagnostic-not-ready"));
    }
    Ok(OneMuseDiagnosticReady { run_id, native_ready: true })
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    Queued,
    Connecting,
    WaitingFirstOutput,
    Generating,
    Completed,
    Cancelled,
    TimedOut,
    Disconnected,
    Failed,
}
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Payload {
    Preflight {},
    Admission {
        observation: admission::Observation,
    },
    Phase {
        phase: Phase,
    },
    Headers {
        status: u16,
        headers: HashMap<String, String>,
    },
    Chunk {
        bytes: Vec<u8>,
    },
    Settled {
        phase: Phase,
        error: Option<Failure>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cancellation: Option<CancellationProvenance>,
    },
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    request_id: String,
    #[serde(flatten)]
    payload: Payload,
}
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Policy {
    #[default]
    Legacy,
    SelfHosted,
}
#[derive(Clone, Copy)]
struct Timeouts {
    connect: Duration,
    first: Option<Duration>,
    idle: Option<Duration>,
    overall: Duration,
}
impl Timeouts {
    fn for_policy(policy: Policy) -> Self {
        Self {
            connect: Duration::from_secs(10),
            first: matches!(policy, Policy::SelfHosted).then_some(Duration::from_secs(120)),
            // Verified live Ollama runner remained healthy at ~46 tokens/s for
            // 60 seconds after its last delivered byte. At that measured rate,
            // the unchanged 8,192-token Agent output allowance takes ~178s.
            // A bounded 180s inactivity window lets active local generation
            // complete without treating lack of *client* bytes as a liveness
            // guarantee. Explicit cancel still wins and overall stays 600s.
            idle: matches!(policy, Policy::SelfHosted).then_some(Duration::from_secs(180)),
            overall: Duration::from_secs(600),
        }
    }
}
struct Deadline {
    overall: Instant,
    progress: Option<(Instant, &'static str)>,
}
impl Deadline {
    fn next(&self) -> (Instant, &'static str) {
        match self.progress {
            Some((time, code)) if time < self.overall => (time, code),
            _ => (self.overall, "overall-deadline"),
        }
    }
}
async fn guarded<T>(
    lease: &Lease,
    deadline: (Instant, &str),
    work: impl Future<Output = Result<T, Failure>>,
) -> Result<T, Failure> {
    tokio::select! {
        biased;
        _ = lease.cancellation() => Err(Failure::new("cancelled")),
        _ = tokio::time::sleep_until(deadline.0) => Err(Failure::new(deadline.1)),
        result = work => result,
    }
}

async fn resolve(host: String, allow_private: bool) -> Result<Vec<IpAddr>, Failure> {
    let ips = if let Ok(ip) = host.trim_matches(['[', ']']).parse::<IpAddr>() {
        vec![ip]
    } else {
        static DNS: OnceLock<Arc<Semaphore>> = OnceLock::new();
        let permit = DNS
            .get_or_init(|| Arc::new(Semaphore::new(4)))
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| Failure::new("dns-failure"))?;
        let (tx, rx) = oneshot::channel();
        // System resolution cannot be killed portably. Detached OS work is bounded
        // by its retained permit; cancelling its receiver can never start HTTP.
        std::thread::Builder::new()
            .name("inference-dns".into())
            .spawn(move || {
                let _permit = permit;
                let result = (host.as_str(), 0)
                    .to_socket_addrs()
                    .map(|a| a.take(33).map(|a| a.ip()).collect::<Vec<_>>());
                let _ = tx.send(result);
            })
            .map_err(|_| Failure::new("dns-failure"))?;
        rx.await
            .map_err(|_| Failure::new("dns-failure"))?
            .map_err(|_| Failure::new("dns-failure"))?
    };
    if ips.is_empty() || ips.len() > 32 {
        return Err(Failure::new("dns-failure"));
    }
    if ips.iter().any(|ip| {
        matches!(ip_kind(*ip), IpKind::BlockedMetadata)
            || (!allow_private && ip_kind(*ip) != IpKind::Public)
    }) {
        return Err(Failure::new("unsafe-endpoint"));
    }
    Ok(ips)
}
fn network_error(error: reqwest::Error) -> Failure {
    use std::error::Error;
    if error.is_timeout() && error.is_connect() {
        return Failure::new("connect-timeout");
    }
    let mut source: Option<&(dyn Error + 'static)> = Some(&error);
    while let Some(e) = source {
        let text = e.to_string().to_lowercase();
        if text.contains("certificate")
            || text.contains("tls")
            || text.contains("corrupt message")
            || text.contains("invalid peer")
        {
            return Failure::new("tls-failure");
        }
        source = e.source();
    }
    Failure::new(if error.is_connect() {
        "connection-failed"
    } else {
        "remote-disconnect"
    })
}
struct Request {
    url: String,
    method: String,
    headers: Option<HashMap<String, String>>,
    body: Option<Vec<u8>>,
    allow_private: bool,
    fallback: Option<(tauri::AppHandle, String)>,
    trace: diagnostics::Trace,
}
async fn execute(
    lease: &Lease,
    mut request: Request,
    limits: Timeouts,
    emit: &impl Fn(Payload) -> bool,
) -> Result<(), Failure> {
    let mut trace = std::mem::take(&mut request.trace);
    let result = execute_traced(lease, request, limits, emit, &mut trace).await;
    trace.finish(&result);
    result
}
async fn execute_traced(
    lease: &Lease,
    request: Request,
    limits: Timeouts,
    emit: &impl Fn(Payload) -> bool,
    trace: &mut diagnostics::Trace,
) -> Result<(), Failure> {
    use diagnostics::Kind;
    let start = Instant::now();
    let mut deadline = Deadline {
        overall: start + limits.overall,
        progress: limits.first.map(|d| (start + d, "first-output-timeout")),
    };
    if !emit(Payload::Phase {
        phase: Phase::Connecting,
    }) {
        lease.note_ipc_rejected();
        return Err(Failure::new("cancelled"));
    }
    let parsed = validate_url(&request.url, request.allow_private)
        .map_err(|_| Failure::new("unsafe-endpoint"))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| Failure::new("unsafe-endpoint"))?
        .to_string();
    trace.record(Kind::ResolveStart, 0);
    let ips = guarded(
        lease,
        (
            start + limits.connect.min(limits.overall),
            "connect-timeout",
        ),
        resolve(host.clone(), request.allow_private),
    )
    .await?;
    trace.record(Kind::ResolveEnd, 0);
    let first_kind = ip_kind(ips[0]); // resolve() already rejects an empty vector.
    let scope = if ips.iter().any(|ip| ip_kind(*ip) != first_kind) {
        "mixed"
    } else {
        match first_kind {
            IpKind::Loopback => "loopback",
            IpKind::Private => "private",
            IpKind::Public => "public",
            IpKind::BlockedMetadata => "blocked",
        }
    };
    trace.destination(parsed.port_or_known_default(), scope);
    trace.record(Kind::HttpClientBuildStart, 0);
    let remaining = (start + limits.connect)
        .saturating_duration_since(Instant::now())
        .max(Duration::from_millis(1));
    let client = build_safe_client(request.allow_private, &[(host, ips)], Some(remaining))
        .map_err(|_| Failure::new("invalid-request"))?;
    trace.record(Kind::HttpClientReady, 0);
    if let Some((app, token)) = &request.fallback {
        crate::modules::conversation_memory::fallback::dispatch(
            app,
            token,
            lease,
            &request.url,
            request.body.as_deref(),
            true,
        )
        .map_err(|_| Failure::new("fallback-consent-rejected"))?;
    }
    let req = build_request(
        &client,
        &request.method,
        parsed,
        request.headers,
        request.body,
    )
    .map_err(|_| Failure::new("invalid-request"))?;
    trace.record(Kind::RequestBuilt, 0);
    // Headers may be withheld while the server computes. reqwest separately
    // bounds TCP/TLS connection establishment; first-output includes header wait.
    if !emit(Payload::Phase {
        phase: Phase::WaitingFirstOutput,
    }) {
        lease.note_ipc_rejected();
        return Err(Failure::new("cancelled"));
    }
    trace.record(Kind::Dispatch, 0);
    lease.mark_provider_dispatched();
    // This marks the await boundary, NOT proof of TCP connect, an HTTP write,
    // or Ollama receipt. reqwest returns here only when headers are available.
    trace.record(Kind::SendAwaitStart, 0);
    let response = guarded(lease, deadline.next(), async {
        req.send().await.map_err(network_error)
    })
    .await?;
    let status = response.status().as_u16();
    trace.http_status(status);
    trace.record(Kind::Headers, 0);
    let headers = header_map_to_strings(response.headers());
    let mut progress = Progress::default();
    progress.sse = headers
        .get("content-type")
        .is_some_and(|s| s.contains("text/event-stream"));
    if !emit(Payload::Headers { status, headers }) {
        lease.note_ipc_rejected();
        return Err(Failure::new("cancelled"));
    }
    let mut response_budget = ResponseByteBudget::default();
    let mut stream = response.bytes_stream();
    let mut generating = false;
    let mut first_chunk = true;
    loop {
        let Some(bytes) = guarded(lease, deadline.next(), async {
            stream.next().await.transpose().map_err(network_error)
        })
        .await?
        else {
            trace.record(Kind::Eof, 0);
            break;
        };
        response_budget
            .account(bytes.len())
            .map_err(|_| Failure::new("response-too-large"))?;
        if first_chunk {
            first_chunk = false;
            trace.record(Kind::FirstBodyChunk, bytes.len());
        }
        trace.record(Kind::Body, bytes.len());
        let was_complete = progress.complete;
        if progress.feed(&bytes) {
            deadline.progress = limits
                .idle
                .map(|d| (Instant::now() + d, "stream-idle-timeout"));
            trace.record(Kind::MeaningfulProgress, bytes.len());
            if !generating {
                generating = true;
                if !emit(Payload::Phase {
                    phase: Phase::Generating,
                }) {
                    lease.note_ipc_rejected();
                    return Err(Failure::new("cancelled"));
                }
            }
        }
        if !was_complete && progress.complete {
            trace.record(Kind::ProviderDone, bytes.len());
        }
        if lease.cancelled() {
            return Err(Failure::new("cancelled"));
        }
        trace.record(Kind::IpcAttempt, bytes.len());
        if !emit(Payload::Chunk {
            bytes: bytes.to_vec(),
        }) {
            trace.record(Kind::IpcRejected, bytes.len());
            lease.note_ipc_rejected();
            return Err(Failure::new("cancelled"));
        }
        trace.record(Kind::IpcForwarded, bytes.len());
        if progress.done {
            break;
        }
    }
    progress.finish();
    if lease.cancelled() {
        return Err(Failure::new("cancelled"));
    }
    if status >= 400 {
        return Err(Failure::new("provider-error"));
    }
    if limits.first.is_some() && progress.sse && !progress.complete {
        return Err(Failure::new("remote-disconnect"));
    }
    Ok(())
}
fn terminal(result: &Result<(), Failure>) -> Phase {
    match result.as_ref().err().map(|e| e.code.as_str()) {
        None => Phase::Completed,
        Some("cancelled") => Phase::Cancelled,
        Some(
            "connect-timeout" | "first-output-timeout" | "stream-idle-timeout" | "overall-deadline",
        ) => Phase::TimedOut,
        Some("remote-disconnect") => Phase::Disconnected,
        _ => Phase::Failed,
    }
}

fn deliver_terminal_once(
    send: impl FnOnce(Event) -> bool,
    request_id: String,
    phase: Phase,
    result: Result<(), Failure>,
    cancellation: Option<CancellationProvenance>,
) {
    let _ = send(Event {
        request_id,
        payload: Payload::Settled {
            phase,
            error: result.err(),
            cancellation,
        },
    });
}

async fn execute_admitted(
    state: &InferenceState,
    lease: &Lease,
    request: Request,
    limits: Timeouts,
    admission: Option<admission::Admission>,
    emit: &impl Fn(Payload) -> bool,
) -> Result<(), Failure> {
    let mut permit = if let Some(spec) = admission {
        Some(
            state
                .admission
                .acquire(lease, spec, |observation| {
                    emit(Payload::Admission {
                        observation: observation.clone(),
                    }) && emit(Payload::Phase {
                        phase: Phase::Queued,
                    })
                })
                .await?,
        )
    } else {
        None
    };
    if lease.cancelled() {
        return Err(Failure::new("cancelled"));
    }
    if lease.require_preflight {
        let mut verdict = lease.request_preflight();
        if !emit(Payload::Preflight {}) {
            lease.note_ipc_rejected();
            return Err(Failure::new("cancelled"));
        }
        guarded(
            lease,
            (Instant::now() + Duration::from_secs(5), "preflight-timeout"),
            async {
                loop {
                    match *verdict.borrow_and_update() {
                        Some(true) => return Ok(()),
                        Some(false) => return Err(Failure::new("context-preflight-rejected")),
                        None => {}
                    }
                    verdict
                        .changed()
                        .await
                        .map_err(|_| Failure::new("cancelled"))?;
                }
            },
        )
        .await?;
    }
    if let Some(permit) = &mut permit {
        permit.observation.attempt_started_at = Some(admission::now());
        if !emit(Payload::Admission {
            observation: permit.observation.clone(),
        }) {
            return Err(Failure::new("cancelled"));
        }
    }
    // execute owns the HTTP client/stream. Dropping its future precedes capacity release.
    let result = execute(lease, request, limits, emit).await;
    if let Some(permit) = &mut permit {
        permit.observation.settled_at = Some(admission::now());
        emit(Payload::Admission {
            observation: permit.observation.clone(),
        });
    }
    drop(permit);
    result
}

#[tauri::command]
pub fn ai_http_open(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, InferenceState>,
) -> Result<String, Failure> {
    let id = state.open(window.label())?;
    let owner = window.label().to_string();
    let handle = window.app_handle().clone();
    let reserved = id.clone();
    let mut done = state
        .completion(&id)
        .ok_or_else(|| Failure::new("cancelled"))?;
    tauri::async_runtime::spawn(async move {
        if *done.borrow_and_update() {
            return;
        }
        tokio::select! {
            _ = done.changed() => return,
            _ = tokio::time::sleep(Duration::from_secs(30)) => {},
        }
        handle
            .state::<InferenceState>()
            .expire_reservation(&owner, &reserved);
    });
    Ok(id)
}
/// Read-only observation of the EXISTING native request registry. The
/// qualification renderer must not turn SDK/Channel terminal into persisted
/// PASS while the original Rust lease is still running or undisposed.
/// No new registry, cancellation token or persistence owner is created.
#[tauri::command]
pub fn ai_http_request_quiescent(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, InferenceState>,
    request_id: String,
) -> Result<bool, Failure> {
    if !request_id.starts_with("inference-") || request_id.len() <= 10 ||
        !request_id[10..].bytes().all(|b|b.is_ascii_digit()) ||
        window.label().is_empty() {
        return Err(Failure::new("invalid-request"));
    }
    // The registry is an in-memory singleton per app owner; only lease drop
    // or an actual cancellation drain can remove the original ID. A retired
    // ID is never reused, even across child-process runtime epoch changes.
    Ok(state.completion(&request_id).is_none())
}
#[tauri::command]
pub async fn ai_http_cancel(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, InferenceState>,
    request_id: String,
    cancellation_origin: Option<CancelOrigin>,
) -> Result<(), Failure> {
    state.cancel_with_origin(window.label(), &request_id,
        cancellation_origin.unwrap_or(CancelOrigin::Unspecified)).await;
    #[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
    match acceptance_cancel_ack_fault(&window, &request_id) {
        Some("original-late-cancel-ack") => {
            // AFTER the existing production cancellation and exact-ID native
            // registry drain, hold ONLY the IPC response for a one-shot
            // original-caller terminal witness. No alternate cancel owner or
            // request semantics. The production handler above is unchanged.
            acceptance_hold_original_cancel_ack(&window, &request_id).await?;
        }
        Some("delayed-cancellation-ack") => {
            // The ORIGINAL native handler has already finished cancelling and
            // draining the request. Only its test-owned IPC ACK is delayed.
            tokio::time::sleep(Duration::from_millis(260)).await;
        }
        Some("cancellation-ack-failure") => {
            // A lost/error ACK after actual native cancellation, never a mock
            // registry mutation or a replacement handler. This cannot occur
            // without the explicit isolated Windows acceptance feature.
            return Err(Failure::new("synthetic-cancel-ack-delivery-failed"));
        }
        _ => {}
    }
    Ok(())
}
#[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
async fn acceptance_hold_original_cancel_ack(
    window: &tauri::WebviewWindow, id: &str,
) -> Result<(), Failure> {
    use std::io::Write;
    let data=window.app_handle().path().app_data_dir()
        .map_err(|_|Failure::new("cancelled"))?
        .canonicalize().map_err(|_|Failure::new("cancelled"))?;
    let root=data.parent().ok_or_else(||Failure::new("cancelled"))?;
    if !crate::modules::managed_local_runtime::acceptance_is_owned_webview_root(root)
        || window.app_handle().state::<InferenceState>().completion(id).is_some() {
        return Err(Failure::new("cancelled"));
    }
    let held=root.join("cancel-ack-held.json");
    let release=root.join("cancel-ack-release.json");
    let returned=root.join("cancel-ack-native-return.json");
    let mut witness=std::fs::OpenOptions::new().write(true).create_new(true)
        .open(&held).map_err(|_|Failure::new("cancelled"))?;
    let value=serde_json::json!({
        "requestId":id,"hostPid":std::process::id(),
        "actualProductionCancelAndNativeDrainBeforeAck":true,
        "syntheticOnly":true,
    });
    witness.write_all(&serde_json::to_vec(&value).map_err(|_|Failure::new("cancelled"))?)
        .and_then(|_|witness.sync_all()).map_err(|_|Failure::new("cancelled"))?;
    drop(witness);
    for _ in 0..1500 {
        if let Ok(raw)=std::fs::read(&release) {
            let marker: serde_json::Value=serde_json::from_slice(&raw)
                .map_err(|_|Failure::new("cancelled"))?;
            if marker["requestId"]!=id || marker["hostPid"]!=std::process::id()
                || marker["originalCallerAlreadyTerminal"]!=true
                || marker["syntheticOnly"]!=true {
                return Err(Failure::new("cancelled"));
            }
            if window.app_handle().state::<InferenceState>().completion(id).is_some() {
                return Err(Failure::new("cancelled"));
            }
            let mut output=std::fs::OpenOptions::new().write(true).create_new(true)
                .open(&returned).map_err(|_|Failure::new("cancelled"))?;
            let bytes=serde_json::to_vec(&serde_json::json!({
                "requestId":id,"hostPid":std::process::id(),
                "returnedOnlyAfterOriginalCallerTerminal":true,
                "nativeRegistryStillDrained":true,"syntheticOnly":true,
            })).map_err(|_|Failure::new("cancelled"))?;
            output.write_all(&bytes).and_then(|_|output.sync_all())
                .map_err(|_|Failure::new("cancelled"))?;
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    Err(Failure::new("cancelled"))
}

/// Test-only post-cancel IPC delivery fault, granted for ONE exact native
/// request ID in ONE exact fresh acceptance case. The production command and
/// native request registry have already settled before any fault is applied.
#[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
fn acceptance_cancel_ack_fault(
    window: &tauri::WebviewWindow,
    request_id: &str,
) -> Option<&'static str> {
    use std::os::windows::fs::MetadataExt;
    let data = window.app_handle().path().app_data_dir().ok()?.canonicalize().ok()?;
    if data.file_name()? != std::ffi::OsStr::new("data") {
        return None;
    }
    let root = data.parent()?;
    if root.file_name()?.to_string_lossy().starts_with("wry-")
        && crate::modules::managed_local_runtime::acceptance_is_owned_webview_root(root)
    {
        let marker = root.join("cancel-ack-fault.json");
        let meta = std::fs::symlink_metadata(&marker).ok()?;
        const WINDOWS_REPARSE: u32 = 0x00000400;
        if !meta.is_file() || meta.file_type().is_symlink()
            || meta.file_attributes() & WINDOWS_REPARSE != 0
            || marker.canonicalize().ok()? != marker
        {
            return None;
        }
        let bytes = std::fs::read(&marker).ok()?;
        if bytes.len() > 1024 { return None; }
        let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
        let fault = value["runtimeScenario"].as_str()?;
        if value["syntheticOnly"] != true
            || value["requestId"] != request_id
            || value["hostPid"] != u64::from(std::process::id())
            || !matches!(fault, "delayed-cancellation-ack" | "cancellation-ack-failure" | "original-late-cancel-ack")
        {
            return None;
        }
        // The original Chat ACK case owns its isolated host scenario instead
        // of activating a synthetic provider runtime fault. Earlier direct
        // transport cases still require the prior exact runtime activation.
        if fault != "original-late-cancel-ack" {
            let active = root.join("runtime-active.json");
            let meta = std::fs::symlink_metadata(&active).ok()?;
            if !meta.is_file() || meta.file_type().is_symlink()
                || meta.file_attributes() & WINDOWS_REPARSE != 0
                || active.canonicalize().ok()? != active
            { return None; }
            let active: serde_json::Value =
                serde_json::from_slice(&std::fs::read(active).ok()?).ok()?;
            if active["runtimeScenario"] != fault || active["syntheticOnly"] != true {
                return None;
            }
        }
        return match fault {
            "delayed-cancellation-ack" => Some("delayed-cancellation-ack"),
            "cancellation-ack-failure" => Some("cancellation-ack-failure"),
            "original-late-cancel-ack" => Some("original-late-cancel-ack"),
            _ => None,
        };
    }
    None
}
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn ai_http_preflight(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, InferenceState>,
    request_id: String,
    approved: bool,
) -> Result<(), Failure> {
    state.approve_preflight(window.label(), &request_id, approved)
}
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn ai_http_stream(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, InferenceState>,
    request_id: String,
    url: String,
    method: String,
    headers: Option<HashMap<String, String>>,
    body: Option<Vec<u8>>,
    allow_private_network: Option<bool>,
    timeout_policy: Option<Policy>,
    admission: Option<admission::Admission>,
    require_preflight: Option<bool>,
    fallback_token: Option<String>,
    diagnostic_run_id: Option<String>,
    diagnostic_permit: Option<String>,
    on_event: Channel<Event>,
) -> Result<(), Failure> {
    if let Some(expected_run) = active_one_muse_run()? {
        let expected_hash = std::env::var(ONE_MUSE_PERMIT_ENV).ok();
        if !valid_one_muse_permit(diagnostic_permit.as_deref(), expected_hash.as_deref()) {
            return Err(Failure::new("diagnostic-permit-denied"));
        }
        let capture = app.try_state::<delivery::DeliveryCapture>()
            .ok_or_else(|| Failure::new("diagnostic-not-ready"))?;
        // The atomic allowance is consumed before validation or any network action.
        // A malformed first attempt cannot unlock a second request.
        capture.claim_once(&expected_run).map_err(Failure::new)?;
        let candidate = OneMuseRequest {
            run_id: diagnostic_run_id.as_deref(),
            url: &url,
            method: &method,
            headers: headers.as_ref(),
            body: body.as_deref(),
            allow_private: allow_private_network == Some(true),
            policy: timeout_policy,
            admission: admission.as_ref(),
            preflight: require_preflight.unwrap_or(false),
            fallback: fallback_token.is_some(),
        };
        if window.label() != "main" || !valid_one_muse_request(&expected_run, &candidate) {
            return Err(Failure::new("diagnostic-request-denied"));
        }
    } else if diagnostic_run_id.is_some() || diagnostic_permit.is_some() {
        return Err(Failure::new("diagnostic-run-unavailable"));
    }
    let mut lease = state.start(window.label(), &request_id)?;
    let _connection = crate::modules::remote_ssh::lifecycle::pin_active_url(&app, &url)
        .map_err(|_| Failure::new("remote-connection-unavailable"))?;
    lease.require_preflight = require_preflight.unwrap_or(false);
    if let Some(token) = &fallback_token {
        if method != "POST" || !lease.require_preflight {
            return Err(Failure::new("fallback-consent-rejected"));
        }
        crate::modules::conversation_memory::fallback::dispatch(
            &app,
            token,
            &lease,
            &url,
            body.as_deref(),
            false,
        )
        .map_err(|_| Failure::new("fallback-consent-rejected"))?;
    }
    if matches!(timeout_policy, Some(Policy::SelfHosted)) && admission.is_none() {
        return Err(Failure::new("invalid-capacity"));
    }
    let mut trace = diagnostics::Trace::from_app(&app, &request_id);
    trace.record(diagnostics::Kind::NativeIpcReady, 0);
    let result = execute_admitted(
        &state,
        &lease,
        Request {
            trace,
            url,
            method,
            headers,
            body,
            allow_private: allow_private_network.unwrap_or(false),
            fallback: fallback_token.map(|token| (app, token)),
        },
        Timeouts::for_policy(timeout_policy.unwrap_or_default()),
        admission,
        &|payload| {
            on_event
                .send(Event {
                    request_id: request_id.clone(),
                    payload,
                })
                .is_ok()
        },
    )
    .await;
    let phase = terminal(&result);
    #[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
    if acceptance_defer_original_native_quiescence(&window, &request_id, phase, &on_event) {
        // Fault-only: the original native request lease remains registered
        // after the original terminal/invoke reply. The PRODUCTION registry
        // authority and original Channel are unchanged. Cleanup after 3.5s
        // is a real Lease drop, never a second synthetic registry.
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(3_500)).await;
            drop(lease);
        });
        return Ok(());
    }
    let cancellation = if phase == Phase::Cancelled {
        lease.cancellation_provenance()
    } else { None };
    drop(lease);
    deliver_terminal_once(
        |event| on_event.send(event).is_ok(),
        request_id.clone(),
        phase,
        result,
        cancellation,
    );
    #[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
    acceptance_schedule_post_terminal_channel_fault(&window, &request_id, phase, &on_event);
    Ok(())
}

/// Acceptance-only: the REAL provider HTTP stream has completed but its
/// original native request still owns the registry lease. The original
/// Channel is sent an intentionally premature terminal; the native registry
/// still owns the lease. This is an isolated native-ACK-before-drain fault,
/// NOT an SDK timer, fake handler or parallel request/persistence registry.
#[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
fn acceptance_defer_original_native_quiescence(
    window: &tauri::WebviewWindow, id: &str, phase: Phase, channel: &Channel<Event>,
) -> bool {
    if std::env::var("CLACK_LM11_AUTHENTICATED_ACCEPTANCE_SCENARIO").as_deref()
        != Ok("original-native-quiescence-failure") || phase != Phase::Completed
        || window.label() != "main" { return false; }
    use std::io::Write;
    let Some(root)=window.app_handle().path().app_data_dir().ok()
        .and_then(|p|p.canonicalize().ok())
        .and_then(|p|p.parent().map(std::path::Path::to_path_buf)) else{return false};
    if !crate::modules::managed_local_runtime::acceptance_is_owned_webview_root(&root)
        || window.app_handle().state::<InferenceState>().completion(id).is_none() {return false;}
    let original_native_terminal_sent=channel.send(Event {
        request_id:id.to_owned(),
        payload:Payload::Settled {
            phase: Phase::Completed,error:None,cancellation:None,
        },
    }).is_ok();
    if !original_native_terminal_sent{return false;}
    let started=root.join("native-quiescence-original-held.json");
    if let Ok(mut f)=std::fs::OpenOptions::new().create_new(true).write(true).open(&started) {
        let _=f.write_all(serde_json::json!({
            "requestId":id,"nativeLeaseStillRegistered":true,
            "actualHttpResponseAlreadyCompleted":true,
            "originalNativeTerminalSentBeforeNativeDrain":true,
            "nativeRegistryDrainHeld":true,
            "delayMs":3500,"syntheticOnly":true
        }).to_string().as_bytes());
        let _=f.sync_all();
    }
    true
}

/// Deliberate test-only post-terminal *native Channel* delivery, not an SSE
/// parser event or a model token. It exercises whether the actual registered
/// renderer's onmessage receives events AFTER the original native terminal.
/// The original native request lease is dropped and Settled is sent already.
#[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
fn acceptance_schedule_post_terminal_channel_fault(
    window: &tauri::WebviewWindow,
    request_id: &str,
    phase: Phase,
    on_event: &Channel<Event>,
) {
    use std::io::Write;
    use std::os::windows::fs::MetadataExt;
    if !matches!(phase, Phase::Completed | Phase::Cancelled) || window.label() != "main" {
        return;
    }
    let Some(root) = window.app_handle().path().app_data_dir().ok()
        .and_then(|data| data.canonicalize().ok())
        .and_then(|data| (data.file_name() == Some(std::ffi::OsStr::new("data")))
            .then(|| data.parent().map(std::path::Path::to_path_buf)).flatten())
    else { return; };
    if !crate::modules::managed_local_runtime::acceptance_is_owned_webview_root(&root)
        || !root.file_name().is_some_and(|name| name.to_string_lossy().starts_with("wry-"))
    { return; }
    let marker = root.join("post-terminal-channel-fault.json");
    let output = root.join("post-terminal-channel-send.json");
    const REPARSE: u32 = 0x00000400;
    let valid_file = |path: &std::path::Path| {
        std::fs::symlink_metadata(path).ok().is_some_and(|meta|
            meta.is_file() && !meta.file_type().is_symlink()
                && meta.file_attributes() & REPARSE == 0
                && path.canonicalize().ok().as_deref() == Some(path))
    };
    if !valid_file(&marker) || output.exists() { return; }
    let Ok(bytes) = std::fs::read(&marker) else { return };
    if bytes.len() > 1024 { return; }
    let Ok(data) = serde_json::from_slice::<serde_json::Value>(&bytes) else { return };
    let expected = match phase {
        Phase::Completed if data["scenario"] == "original-duplicate-terminal" =>
            "original-duplicate-terminal",
        Phase::Completed => "post-terminal-channel-callback",
        Phase::Cancelled if data["scenario"] == "post-cancel-original-lm2f-channel" =>
            "post-cancel-original-lm2f-channel",
        Phase::Cancelled => "post-cancel-channel-callback",
        _ => return,
    };
    if data["syntheticOnly"] != true
        || data["scenario"] != expected
        || data["requestId"] != request_id
        || data["hostPid"] != u64::from(std::process::id())
    { return; }
    // DO NOT await the late callback in the original ai_http_stream handler:
    // doing so keeps its renderer IPC Promise pending while the callback
    // arrives, which would not prove a post-terminal renderer callback.
    // This is a strictly acceptance-gated same-Channel delayed observer, not
    // a parallel response parser, completion authority or second registry.
    let channel = on_event.clone();
    let request_id = request_id.to_owned();
    let app = window.app_handle().clone();
    let production_lm2f = expected == "post-cancel-original-lm2f-channel";
    tokio::spawn(async move {
        // T13 only: never inject by elapsed time after the native terminal.
        // Wait for the renderer's *original* LM2F promise to reject, its
        // separately recorded Cancelled callback, and a one-shot canonical
        // marker written by the isolated acceptance-only command. A missing
        // marker is a retained failed attempt, not permission to send.
        let release_confirmed = if production_lm2f {
            let release = root.join("post-cancel-lm2f-release.json");
            tokio::time::timeout(Duration::from_secs(10), async {
                loop {
                    if valid_file(&release) {
                        if let Ok(bytes) = std::fs::read(&release) {
                            if bytes.len() <= 2048 {
                                if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                                    if value["scenario"] == "post-cancel-original-lm2f-channel"
                                        && value["syntheticOnly"] == true
                                        && value["hostPid"] == u64::from(std::process::id())
                                        && value["requestId"] == request_id
                                        && value["nativeTerminal"] == "cancelled"
                                        && value["originalLm2fRejected"] == true
                                    {
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    tokio::time::sleep(Duration::from_millis(25)).await;
                }
            }).await.is_ok()
        } else {
            tokio::time::sleep(Duration::from_millis(500)).await;
            true
        };
        // The original lease was dropped before this helper was scheduled.
        // Independently check no *new* registry membership was installed for
        // the exact old ID. This is observation only; never open a request.
        let old_registry_absent = app.state::<InferenceState>()
            .completion(&request_id).is_none();
        let may_inject = release_confirmed && (!production_lm2f || old_registry_absent);
        let late_chunk_sent = may_inject && channel.send(Event {
            request_id: request_id.clone(),
            payload: Payload::Chunk {
                bytes: b"LM11-POST-TERMINAL-NATIVE-CHANNEL-ONLY-NO-MODEL".to_vec(),
            },
        }).is_ok();
        let late_terminal_sent = may_inject && channel.send(Event {
            request_id: request_id.clone(),
            payload: Payload::Settled {
                phase, error: None, cancellation: None,
            },
        }).is_ok();
        if let Ok(mut file) = std::fs::OpenOptions::new().create_new(true).write(true).open(&output) {
            let recorded = serde_json::json!({
                "requestId":request_id,
                "afterOriginalNativeSettled":true,
                "afterOriginalLeaseDrop":true,
                "scheduledAfterOriginalIpcHandler":true,
                "originalTerminalPhase":match phase { Phase::Cancelled => "cancelled", _ => "completed" },
                "testInjectedNotExternalSseParser":true,
                "lateChunkNativeSendSucceeded":late_chunk_sent,
                "lateTerminalNativeSendSucceeded":late_terminal_sent,
                "originalLm2fReleaseConfirmed":if production_lm2f {
                    serde_json::Value::Bool(release_confirmed)
                } else {serde_json::Value::Null},
                "oldNativeRegistryAbsentAtInjection":old_registry_absent,
                "releaseWaitBoundMs":if production_lm2f {10000} else {0},
                "syntheticOnly":true,
            });
            let _ = writeln!(file, "{recorded}");
            let _ = file.flush();
            let _ = file.sync_all();
        }
    });
}
