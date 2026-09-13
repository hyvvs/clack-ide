mod admission;
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
use registry::Lease;
use serde::{Deserialize, Serialize};
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
            idle: matches!(policy, Policy::SelfHosted).then_some(Duration::from_secs(60)),
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
}
async fn execute(
    lease: &Lease,
    request: Request,
    limits: Timeouts,
    emit: &impl Fn(Payload) -> bool,
) -> Result<(), Failure> {
    let start = Instant::now();
    let mut deadline = Deadline {
        overall: start + limits.overall,
        progress: limits.first.map(|d| (start + d, "first-output-timeout")),
    };
    if !emit(Payload::Phase {
        phase: Phase::Connecting,
    }) {
        return Err(Failure::new("cancelled"));
    }
    let parsed = validate_url(&request.url, request.allow_private)
        .map_err(|_| Failure::new("unsafe-endpoint"))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| Failure::new("unsafe-endpoint"))?
        .to_string();
    let ips = guarded(
        lease,
        (
            start + limits.connect.min(limits.overall),
            "connect-timeout",
        ),
        resolve(host.clone(), request.allow_private),
    )
    .await?;
    let remaining = (start + limits.connect)
        .saturating_duration_since(Instant::now())
        .max(Duration::from_millis(1));
    let client = build_safe_client(request.allow_private, &[(host, ips)], Some(remaining))
        .map_err(|_| Failure::new("invalid-request"))?;
    let req = build_request(
        &client,
        &request.method,
        parsed,
        request.headers,
        request.body,
    )
    .map_err(|_| Failure::new("invalid-request"))?;
    // Headers may be withheld while the server computes. reqwest separately
    // bounds TCP/TLS connection establishment; first-output includes header wait.
    if !emit(Payload::Phase {
        phase: Phase::WaitingFirstOutput,
    }) {
        return Err(Failure::new("cancelled"));
    }
    let response = guarded(lease, deadline.next(), async {
        req.send().await.map_err(network_error)
    })
    .await?;
    let status = response.status().as_u16();
    let headers = header_map_to_strings(response.headers());
    let mut progress = Progress::default();
    progress.sse = headers
        .get("content-type")
        .is_some_and(|s| s.contains("text/event-stream"));
    if !emit(Payload::Headers { status, headers }) {
        return Err(Failure::new("cancelled"));
    }
    let mut stream = response.bytes_stream();
    let mut generating = false;
    while let Some(bytes) = guarded(lease, deadline.next(), async {
        stream.next().await.transpose().map_err(network_error)
    })
    .await?
    {
        if progress.feed(&bytes) {
            deadline.progress = limits
                .idle
                .map(|d| (Instant::now() + d, "stream-idle-timeout"));
            if !generating {
                generating = true;
                if !emit(Payload::Phase {
                    phase: Phase::Generating,
                }) {
                    return Err(Failure::new("cancelled"));
                }
            }
        }
        if lease.cancelled()
            || !emit(Payload::Chunk {
                bytes: bytes.to_vec(),
            })
        {
            return Err(Failure::new("cancelled"));
        }
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
) -> Result<(), Failure> {
    state.cancel(window.label(), &request_id).await;
    Ok(())
}
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn ai_http_stream(
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
    on_event: Channel<Event>,
) -> Result<(), Failure> {
    let lease = state.start(window.label(), &request_id)?;
    if matches!(timeout_policy, Some(Policy::SelfHosted)) && admission.is_none() {
        return Err(Failure::new("invalid-capacity"));
    }
    let result = execute_admitted(
        &state,
        &lease,
        Request {
            url,
            method,
            headers,
            body,
            allow_private: allow_private_network.unwrap_or(false),
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
    drop(lease);
    let _ = on_event.send(Event {
        request_id,
        payload: Payload::Settled {
            phase,
            error: result.err(),
        },
    });
    Ok(())
}
