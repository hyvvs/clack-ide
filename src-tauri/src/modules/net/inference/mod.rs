mod admission;
pub mod diagnostics;
pub mod delivery;
mod progress;
mod registry;
#[cfg(test)]
mod tests;
use super::{
    build_request, build_safe_client, header_map_to_strings, ip_kind, validate_url, IpKind,
};
use futures_util::StreamExt;
use progress::Progress;
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
#[tauri::command]
pub async fn ai_http_cancel(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, InferenceState>,
    request_id: String,
    cancellation_origin: Option<CancelOrigin>,
) -> Result<(), Failure> {
    state.cancel_with_origin(window.label(), &request_id,
        cancellation_origin.unwrap_or(CancelOrigin::Unspecified)).await;
    Ok(())
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
    let cancellation = if phase == Phase::Cancelled {
        lease.cancellation_provenance()
    } else { None };
    drop(lease);
    let _ = on_event.send(Event {
        request_id,
        payload: Payload::Settled {
            phase,
            error: result.err(),
            cancellation,
        },
    });
    Ok(())
}
