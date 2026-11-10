//! Isolated, explicitly operated one-Muse diagnostic host.
//! Opening this host installs observers; it never starts inference or a probe.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use terax_lib::modules::{fs as clack_fs, net};

const RUN_ENV: &str = net::inference::delivery::ONE_MUSE_RUN_ENV;
const ROOT_ENV: &str = net::inference::delivery::ONE_MUSE_ROOT_ENV;
const DELIVERY_EVENT: &str = "clack-local-delivery";

struct HostState {
    run_id: String,
    root: PathBuf,
    ready_url: String,
    ready_nonce: String,
    journal_url: String,
    journal_nonce: String,
    permit_sha256: String,
    client: reqwest::Client,
    sources: Mutex<HashMap<String, String>>,
    origin: Instant,
    native_loss: Arc<AtomicU64>,
    native_pending: Arc<AtomicU64>,
    native_dispatches: Arc<AtomicU64>,
    native_terminals: Arc<AtomicU64>,
    native_request_id: Arc<Mutex<Option<String>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserConfiguration {
    run_id: String,
}

fn required(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("Missing isolated diagnostic setting: {name}"))
}

fn loopback(raw: String) -> String {
    let url = reqwest::Url::parse(&raw).expect("Metadata endpoint must be a URL");
    assert!(
        url.scheme() == "http"
            && url.host_str() == Some("127.0.0.1")
            && url.port().is_some()
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
            && url.path() == "/",
        "Only an exact owned loopback metadata endpoint is permitted"
    );
    format!("http://127.0.0.1:{}", url.port().unwrap())
}

fn source_valid(source: &str) -> bool {
    matches!(source, "native" | "semantic" | "webview")
}

fn identity_valid(identity: &str) -> bool {
    !identity.is_empty()
        && identity.len() <= 96
        && identity
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b':'))
}

fn scoped(window: &tauri::WebviewWindow, state: &HostState, run_id: &str) -> Result<(), String> {
    if window.label() != "main" || state.run_id != run_id {
        return Err("Diagnostic host/run identity mismatch".into());
    }
    Ok(())
}

fn registered(app: &tauri::AppHandle, state: &HostState) -> bool {
    app.try_state::<net::inference::delivery::DeliveryCapture>()
        .is_some_and(|capture| capture.registration_active(&state.run_id))
}

async fn post_ack(
    state: &HostState,
    journal: bool,
    route: &str,
    body: &Value,
) -> Result<Value, String> {
    let (url, nonce, header) = if journal {
        (
            &state.journal_url,
            &state.journal_nonce,
            "x-clack-delivery-session",
        )
    } else {
        (
            &state.ready_url,
            &state.ready_nonce,
            "x-clack-one-muse-session",
        )
    };
    let response = state
        .client
        .post(format!("{url}{route}"))
        // The broker can recheck three remote clock anchors before granting
        // its irreversibly consumed permit. Its claim needs a longer bound;
        // all observer ACK/heartbeat operations retain the 5s ceiling.
        .timeout(metadata_timeout(journal, route))
        .header(header, nonce)
        .header("content-type", "application/json")
        .body(serde_json::to_vec(body).map_err(|_| "Invalid metadata envelope")?)
        .send()
        .await
        .map_err(|_| "Run-owned metadata collector unavailable")?;
    if !response.status().is_success() {
        return Err("Run-owned metadata collector rejected an observation".into());
    }
    let body = response
        .bytes()
        .await
        .map_err(|_| "Collector acknowledgment failed")?;
    if body.len() > 1024 {
        return Err("Oversized collector acknowledgment".into());
    }
    let acknowledgment: Value =
        serde_json::from_slice(&body).map_err(|_| "Malformed collector acknowledgment")?;
    if acknowledgment.get("ok").and_then(Value::as_bool) != Some(true)
        || (acknowledgment.get("runId").is_some() && acknowledgment["runId"] != state.run_id)
    {
        return Err("Untrusted collector acknowledgment".into());
    }
    Ok(acknowledgment)
}

fn metadata_timeout(journal: bool, route: &str) -> Duration {
    if !journal && route == "/v1/claim" {
        Duration::from_secs(35)
    } else {
        Duration::from_secs(5)
    }
}

async fn post(state: &HostState, journal: bool, route: &str, body: &Value) -> Result<(), String> {
    post_ack(state, journal, route, body).await.map(|_| ())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeliveryRow {
    schema_version: u8,
    run_id: String,
    host: String,
    request_id: String,
    boundary: String,
    at_unix_ms: u64,
    mono_us: u64,
    sequence: u64,
    bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    dropped: Option<u64>,
}

impl DeliveryRow {
    fn valid(&self, run_id: &str) -> bool {
        let native = matches!(
            self.boundary.as_str(),
            "native-dispatch"
                | "native-headers"
                | "native-body-read"
                | "native-semantic-progress"
                | "native-ipc-forwarded"
                | "native-ipc-rejected"
                | "native-provider-done"
                | "native-eof"
                | "native-terminal"
                | "native-collector-loss"
        );
        let webview = matches!(
            self.boundary.as_str(),
            "webview-headers-received"
                | "webview-ipc-received"
                | "webview-stream-enqueued"
                | "webview-settled-received"
        );
        self.schema_version == 1
            && self.run_id == run_id
            && ((self.host == "clack-native" && native)
                || (self.host == "clack-webview" && webview))
            && !self.request_id.is_empty()
            && self.request_id.len() <= 80
            && self
                .request_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            && self.bytes <= 1_048_576
            && self.sequence <= 1_000_000
            && (self.boundary != "native-semantic-progress" || self.bytes == 0)
            && if self.boundary == "native-collector-loss" {
                self.dropped.is_some_and(|count| count > 0) && self.bytes == 0
            } else {
                self.dropped.is_none()
            }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BrokerRow {
    run_id: String,
    source: String,
    identity: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    active_registration: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    receipt_ack: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    complete: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    loss: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pending: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    native_dispatches: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    native_terminals: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    webview_settled: Option<u64>,
}

#[tauri::command]
fn local_muse_one_config(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, HostState>,
) -> Result<BrowserConfiguration, String> {
    scoped(&window, &state, &state.run_id)?;
    Ok(BrowserConfiguration {
        run_id: state.run_id.clone(),
    })
}

#[tauri::command]
async fn local_muse_one_observe(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, HostState>,
    row: DeliveryRow,
) -> Result<(), String> {
    scoped(&window, &state, &row.run_id)?;
    if !row.valid(&state.run_id) {
        return Err("Unapproved diagnostic delivery metadata".into());
    }
    post(&state, true, "/v1/observe", &json!(row)).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceReceiptRequest {
    run_id: String,
    source: String,
    identity: String,
    kind: String,
    success: bool,
}

#[tauri::command]
async fn local_muse_one_source_receipt(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, HostState>,
    payload: SourceReceiptRequest,
) -> Result<(), String> {
    scoped(&window, &state, &payload.run_id)?;
    if !registered(&app, &state)
        || !source_valid(&payload.source)
        || !identity_valid(&payload.identity)
        || !matches!(payload.kind.as_str(), "source-ready" | "source-terminal")
    {
        return Err("Unregistered diagnostic source".into());
    }
    if payload.kind == "source-ready" && !payload.success {
        return Err("Source readiness cannot claim failure as ready".into());
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "Invalid observer clock")?
        .as_millis();
    let body = json!({"schemaVersion":1,"runId":payload.run_id,"host":"collector",
        "layer":"collector","kind":payload.kind,"source":payload.source,"sourceIdentity":payload.identity,
        "result":if payload.success {"ok"} else {"failed"},
        "atUnixMs":now.min(u64::MAX as u128) as u64,
        "monoUs":state.origin.elapsed().as_micros().min(u64::MAX as u128) as u64});
    post(&state, true, "/v1/observe", &body).await?;
    if payload.kind == "source-ready" {
        let mut sources = state
            .sources
            .lock()
            .map_err(|_| "Source registry unavailable")?;
        if sources.insert(payload.source, payload.identity).is_some() {
            return Err("Duplicate diagnostic source registration".into());
        }
    }
    Ok(())
}

#[tauri::command]
async fn local_muse_one_broker(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, HostState>,
    action: String,
    payload: BrokerRow,
) -> Result<(), String> {
    scoped(&window, &state, &payload.run_id)?;
    if !registered(&app, &state)
        || !source_valid(&payload.source)
        || !identity_valid(&payload.identity)
        || !matches!(action.as_str(), "ready" | "heartbeat" | "terminal")
        || state
            .sources
            .lock()
            .map_err(|_| "Source registry unavailable")?
            .get(&payload.source)
            != Some(&payload.identity)
    {
        return Err("Unregistered diagnostic broker source".into());
    }
    if action == "ready"
        && (payload.active_registration != Some(true)
            || payload.receipt_ack != Some(true)
            || payload.loss != Some(0)
            || payload.pending != Some(0))
    {
        return Err("Diagnostic source readiness incomplete".into());
    }
    if action == "terminal"
        && (payload.complete.is_none() || payload.loss.is_none() || payload.pending.is_none())
    {
        return Err("Diagnostic source terminal is incomplete".into());
    }
    if action == "terminal"
        && payload.source == "native"
        && (payload.native_dispatches != Some(state.native_dispatches.load(Ordering::SeqCst))
            || payload.native_terminals != Some(state.native_terminals.load(Ordering::SeqCst)))
    {
        return Err(
            "Native source counts do not match actual dispatch and terminal observations".into(),
        );
    }
    post(&state, false, &format!("/v1/{action}"), &json!(payload)).await
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OneMuseIntent {
    model: String,
    stream: bool,
    context: u64,
    output: u64,
    tools: u64,
    think: String,
    request_class: String,
    retry: bool,
    continuation: bool,
    fallback: bool,
}

impl OneMuseIntent {
    fn valid(&self) -> bool {
        self.model == "muse-glimmer:30b"
            && self.stream
            && self.context == 32768
            && self.output == 8192
            && self.tools == 0
            && self.think == "omitted"
            && self.request_class == "diagnostic"
            && !self.retry
            && !self.continuation
            && !self.fallback
    }
}

fn permit_matches(permit: &str, expected: &str) -> bool {
    if permit.len() != 64
        || !permit.bytes().all(|b| b.is_ascii_hexdigit())
        || expected.len() != 64
        || !expected.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return false;
    }
    let actual = format!("{:x}", Sha256::digest(permit.as_bytes()));
    actual
        .bytes()
        .zip(expected.bytes())
        .fold(0_u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

#[tauri::command]
async fn local_muse_one_claim(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, HostState>,
    run_id: String,
    intent: OneMuseIntent,
) -> Result<String, String> {
    scoped(&window, &state, &run_id)?;
    if !registered(&app, &state)
        || !operator_release_matches(&state.root, &run_id)
        || state.native_dispatches.load(Ordering::SeqCst) != 0
        || state.root.join("one-muse-dispatch.claim").exists()
        || !intent.valid()
        || state
            .sources
            .lock()
            .map_err(|_| "Source registry unavailable")?
            .len()
            != 3
    {
        return Err("Diagnostic observers are not fully registered".into());
    }
    let result = post_ack(
        &state,
        false,
        "/v1/claim",
        &json!({"runId":run_id,"intent":intent}),
    )
    .await?;
    let permit = result
        .get("permit")
        .and_then(Value::as_str)
        .ok_or("Coordinator did not issue a one-use permit")?;
    if !permit_matches(permit, &state.permit_sha256) {
        return Err("Coordinator permit did not match the launched run".into());
    }
    Ok(permit.to_owned())
}

fn operator_release_matches(root: &std::path::Path, run_id: &str) -> bool {
    let file = root.join("one-muse-ready.claim");
    let Ok(metadata) = fs::symlink_metadata(&file) else {
        return false;
    };
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() != (run_id.len() + 1) as u64
    {
        return false;
    }
    fs::read_to_string(file).ok().as_deref() == Some(format!("{run_id}\n").as_str())
}

#[tauri::command]
fn local_muse_one_operator_ready(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, HostState>,
    run_id: String,
) -> Result<bool, String> {
    scoped(&window, &state, &run_id)?;
    Ok(operator_release_matches(&state.root, &run_id)
        && state
            .sources
            .lock()
            .map_err(|_| "Source registry unavailable")?
            .len()
            == 3
        && state.native_dispatches.load(Ordering::SeqCst) == 0
        && !state.root.join("one-muse-dispatch.claim").exists())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeCollectorStatus {
    loss: u64,
    pending: u64,
    dispatches: u64,
    terminals: u64,
}

#[tauri::command]
fn local_muse_one_native_collector_status(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, HostState>,
    run_id: String,
) -> Result<NativeCollectorStatus, String> {
    scoped(&window, &state, &run_id)?;
    Ok(NativeCollectorStatus {
        loss: state.native_loss.load(Ordering::SeqCst),
        pending: state.native_pending.load(Ordering::SeqCst),
        dispatches: state.native_dispatches.load(Ordering::SeqCst),
        terminals: state.native_terminals.load(Ordering::SeqCst),
    })
}

#[tauri::command]
async fn local_muse_one_request_settled(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, HostState>,
    run_id: String,
    outcome: String,
    request_id: String,
) -> Result<(), String> {
    scoped(&window, &state, &run_id)?;
    if !matches!(outcome.as_str(), "completed" | "failed" | "cancelled")
        || !request_id.starts_with("inference-")
        || request_id.len() > 80
        || !request_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("Invalid diagnostic request terminal".into());
    }
    if state.native_dispatches.load(Ordering::SeqCst) != 1
        || state.native_terminals.load(Ordering::SeqCst) != 1
        || state
            .native_request_id
            .lock()
            .map_err(|_| "Native request registry unavailable")?
            .as_deref()
            != Some(request_id.as_str())
    {
        return Err("Native request did not settle with the observed dispatch identity".into());
    }
    post(
        &state,
        false,
        "/v1/request-settled",
        &json!({"runId":run_id,"outcome":outcome,"requestId":request_id}),
    )
    .await
}

#[tauri::command]
fn local_muse_one_exit(
    app: tauri::AppHandle,
    run_id: String,
    state: tauri::State<'_, HostState>,
) -> Result<(), String> {
    if run_id != state.run_id {
        return Err("Wrong diagnostic run".into());
    }
    app.exit(0);
    Ok(())
}

fn main() {
    let run_id = required(RUN_ENV);
    assert!(
        net::inference::delivery::valid_run_id(&run_id),
        "Invalid diagnostic run ID"
    );
    let raw_root = PathBuf::from(required(ROOT_ENV));
    let root = fs::canonicalize(&raw_root).expect("Run-owned root must already exist");
    assert!(
        raw_root.is_absolute()
            && root.is_dir()
            && root.file_name().and_then(|name| name.to_str()) == Some(run_id.as_str())
            && clack_fs::to_canon(&root) == clack_fs::to_canon(&raw_root)
            && !fs::symlink_metadata(&raw_root)
                .unwrap()
                .file_type()
                .is_symlink(),
        "One-Muse root must be an exact canonical directory"
    );
    let ui_url: tauri::Url = required("CLACK_ONE_MUSE_WEBVIEW_URL")
        .parse()
        .expect("Diagnostic WebView URL is invalid");
    assert!(
        ui_url.scheme() == "http"
            && ui_url.host_str() == Some("127.0.0.1")
            && ui_url.port().is_some()
            && ui_url.path() == "/local-muse-one.html"
            && ui_url.query().is_none()
            && ui_url.fragment().is_none(),
        "Only the exact owned diagnostic WebView is permitted"
    );
    let nonce = |name: &str| {
        let value = required(name);
        assert!(
            value.len() == 48 && value.bytes().all(|b| b.is_ascii_hexdigit()),
            "Invalid ephemeral collector nonce"
        );
        value
    };
    let permit_sha256 = required(net::inference::ONE_MUSE_PERMIT_ENV);
    assert!(
        permit_sha256.len() == 64
            && permit_sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "Invalid bound diagnostic permit digest"
    );
    let state = HostState {
        run_id: run_id.clone(),
        root: root.clone(),
        ready_url: loopback(required("CLACK_ONE_MUSE_READY_URL")),
        ready_nonce: nonce("CLACK_ONE_MUSE_READY_NONCE"),
        journal_url: loopback(required("CLACK_ONE_MUSE_JOURNAL_URL")),
        journal_nonce: nonce("CLACK_ONE_MUSE_JOURNAL_NONCE"),
        permit_sha256,
        client: reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(5))
            .build()
            .expect("Loopback metadata client"),
        sources: Mutex::new(HashMap::new()),
        origin: Instant::now(),
        native_loss: Arc::new(AtomicU64::new(0)),
        native_pending: Arc::new(AtomicU64::new(0)),
        native_dispatches: Arc::new(AtomicU64::new(0)),
        native_terminals: Arc::new(AtomicU64::new(0)),
        native_request_id: Arc::new(Mutex::new(None)),
    };
    let data = root.join("isolated-tauri-data");
    fs::create_dir(&data).expect("Fresh run-owned app data directory required");
    let webview_data = root.join("isolated-webview-data");
    fs::create_dir(&webview_data).expect("Fresh run-owned WebView data directory required");
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = clack_fs::to_canon(&data);
    context.config_mut().build.dev_url = Some(ui_url.clone());
    tauri::Builder::default()
        .manage(state)
        .manage(net::inference::InferenceState::default())
        .setup(move |app| {
            let (sender, mut receiver) = tokio::sync::mpsc::channel(2048);
            let dropped = std::sync::Arc::new(AtomicU64::new(0));
            let failures = dropped.clone();
            let handle = app.handle().clone();
            let loss_run = run_id.clone();
            let native_loss = app.state::<HostState>().native_loss.clone();
            let native_pending = app.state::<HostState>().native_pending.clone();
            let native_dispatches = app.state::<HostState>().native_dispatches.clone();
            let native_terminals = app.state::<HostState>().native_terminals.clone();
            let native_request_id = app.state::<HostState>().native_request_id.clone();
            let emit_loss = native_loss.clone();
            let emit_pending = native_pending.clone();
            tauri::async_runtime::spawn(async move {
                let started = Instant::now();
                let mut tick = tokio::time::interval(Duration::from_secs(1));
                loop {
                    tokio::select! {
                        Some(event) = receiver.recv() => {
                            emit_pending.fetch_sub(1, Ordering::SeqCst);
                            if handle.emit(DELIVERY_EVENT, event).is_err() {
                                failures.fetch_add(1, Ordering::SeqCst);
                                emit_loss.fetch_add(1, Ordering::SeqCst);
                            }
                        },
                        _ = tick.tick() => {
                            let lost = failures.swap(0, Ordering::Relaxed);
                            if lost > 0 {
                                let receipt = net::inference::delivery::loss_receipt(lost,
                                    started.elapsed().as_micros().min(u64::MAX as u128) as u64,
                                    Some(&loss_run));
                                if handle.emit(DELIVERY_EVENT, receipt).is_err() {
                                    emit_loss.fetch_add(1, Ordering::SeqCst);
                                }
                            }
                        },
                        else => break,
                    }
                }
            });
            let capture =
                net::inference::delivery::DeliveryCapture::for_run(run_id.clone(), move |row| {
                    if row.boundary == net::inference::delivery::Boundary::NativeDispatch {
                        native_dispatches.fetch_add(1, Ordering::SeqCst);
                        let mut existing =
                            native_request_id.lock().unwrap_or_else(|e| e.into_inner());
                        if existing
                            .as_deref()
                            .is_some_and(|value| value != row.request_id)
                        {
                            native_loss.fetch_add(1, Ordering::SeqCst);
                        } else if existing.is_none() {
                            *existing = Some(row.request_id.clone());
                        }
                    }
                    if row.boundary == net::inference::delivery::Boundary::NativeTerminal {
                        native_terminals.fetch_add(1, Ordering::SeqCst);
                    }
                    native_pending.fetch_add(1, Ordering::SeqCst);
                    if sender.try_send(row).is_err() {
                        native_pending.fetch_sub(1, Ordering::SeqCst);
                        dropped.fetch_add(1, Ordering::Relaxed);
                        native_loss.fetch_add(1, Ordering::SeqCst);
                    }
                })
                .expect("Run-bound native diagnostic capture");
            assert!(
                app.manage(capture),
                "Native diagnostic capture registered once"
            );
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(ui_url))
                .title("Clack One-Muse Diagnostic · Manual Dispatch")
                .inner_size(720.0, 360.0)
                .visible(true)
                .data_directory(webview_data)
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            local_muse_one_config,
            local_muse_one_observe,
            local_muse_one_source_receipt,
            local_muse_one_broker,
            local_muse_one_claim,
            local_muse_one_operator_ready,
            local_muse_one_native_collector_status,
            local_muse_one_request_settled,
            local_muse_one_exit,
            net::inference::ai_http_open,
            net::inference::ai_http_cancel,
            net::inference::ai_http_stream,
            net::inference::ai_http_diagnostic_ready,
        ])
        .build(context)
        .expect("Isolated one-Muse host startup")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<net::inference::InferenceState>().shutdown();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn isolated_host_permit_and_wire_intent_must_match_one_muse() {
        let permit = "a".repeat(64);
        let hash = format!("{:x}", Sha256::digest(permit.as_bytes()));
        assert!(permit_matches(&permit, &hash));
        assert!(!permit_matches(&"b".repeat(64), &hash));
        assert!(!permit_matches("missing", &hash));
        let intent: OneMuseIntent = serde_json::from_value(json!({
            "model": "muse-glimmer:30b", "stream": true,
            "context": 32768, "output": 8192,
            "tools": 0, "think": "omitted", "requestClass": "diagnostic",
            "retry": false, "continuation": false, "fallback": false,
        }))
        .unwrap();
        assert!(intent.valid());
        let mut unsupported = serde_json::to_value(&intent).unwrap();
        unsupported["tools"] = json!(1);
        assert!(!serde_json::from_value::<OneMuseIntent>(unsupported)
            .unwrap()
            .valid());
        let mut extra = serde_json::to_value(&intent).unwrap();
        extra["unsafeNewField"] = json!(true);
        assert!(serde_json::from_value::<OneMuseIntent>(extra).is_err());
    }

    #[test]
    fn one_use_claim_allows_bounded_cross_host_revalidation_without_relaxing_ack_timeout() {
        assert_eq!(
            metadata_timeout(false, "/v1/claim"),
            Duration::from_secs(35)
        );
        for route in [
            "/v1/ready",
            "/v1/heartbeat",
            "/v1/terminal",
            "/v1/request-settled",
        ] {
            assert_eq!(metadata_timeout(false, route), Duration::from_secs(5));
        }
        assert_eq!(
            metadata_timeout(true, "/v1/observe"),
            Duration::from_secs(5)
        );
        assert_eq!(metadata_timeout(true, "/v1/claim"), Duration::from_secs(5));
    }

    #[test]
    fn operator_release_is_exact_run_owned_file_with_final_newline() {
        let run_id = "muse-one-offline-test-owner";
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("one-muse-release-{unique}-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let marker = root.join("one-muse-ready.claim");
        assert!(!operator_release_matches(&root, run_id));
        fs::write(&marker, format!("{run_id}\n")).unwrap();
        assert!(operator_release_matches(&root, run_id));
        assert!(!operator_release_matches(&root, "muse-one-stale"));
        fs::write(&marker, run_id).unwrap();
        assert!(!operator_release_matches(&root, run_id));
        fs::write(&marker, format!("{run_id}\n\n")).unwrap();
        assert!(!operator_release_matches(&root, run_id));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn journal_receipt_rejects_unapproved_sources_and_private_extra_fields() {
        let receipt: SourceReceiptRequest = serde_json::from_value(json!({
            "runId":"muse-one-offline-test-owner", "source":"native",
            "identity":"reqwest-native-hook", "kind":"source-ready", "success":true
        }))
        .unwrap();
        assert_eq!(receipt.source, "native");
        let mut unexpected = json!({
            "runId":"muse-one-offline-test-owner", "source":"native",
            "identity":"reqwest-native-hook", "kind":"source-ready", "success":true
        });
        unexpected["prompt"] = json!("do not persist this");
        assert!(serde_json::from_value::<SourceReceiptRequest>(unexpected).is_err());
        let row: DeliveryRow = serde_json::from_value(json!({
            "schemaVersion":1,"runId":"muse-one-offline-test-owner","host":"clack-native",
            "requestId":"inference-1","boundary":"native-dispatch",
            "atUnixMs":1000,"monoUs":42,"sequence":0,"bytes":0
        }))
        .unwrap();
        assert!(row.valid("muse-one-offline-test-owner"));
        assert!(!row.valid("muse-one-foreign"));
        let mut extra = serde_json::to_value(&row).unwrap();
        extra["prompt"] = json!("private");
        assert!(serde_json::from_value::<DeliveryRow>(extra).is_err());
        let mut misplaced = serde_json::to_value(&row).unwrap();
        misplaced["boundary"] = json!("webview-ipc-received");
        assert!(!serde_json::from_value::<DeliveryRow>(misplaced)
            .unwrap()
            .valid("muse-one-offline-test-owner"));
    }
}
