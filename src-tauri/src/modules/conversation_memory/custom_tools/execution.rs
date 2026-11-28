//! T2 consumes T1 definitions and D1 leases; T3b code uses only T3a WASI.
use super::*;
use crate::modules::net::inference::{InferenceState, Lease};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::sync::Semaphore;

pub mod confinement;
mod io;
mod schema;
#[cfg(test)]
mod tests;
mod wasi;

const MAX_INPUT: usize = 16 * 1024;
const MAX_OUTPUT: usize = 16 * 1024;
const MAX_RECORDS: usize = 128;
static SLOTS: LazyLock<Arc<Semaphore>> = LazyLock::new(|| Arc::new(Semaphore::new(4)));
static RUN_SLOTS: LazyLock<Arc<Semaphore>> = LazyLock::new(|| Arc::new(Semaphore::new(4)));
static APPROVAL_SLOTS: LazyLock<Arc<Semaphore>> = LazyLock::new(|| Arc::new(Semaphore::new(4)));

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Reference {
    id: String,
    version: u64,
    hash: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    session_id: String,
    run_id: Option<u64>,
    call_id: String,
    tool: Reference,
    arguments: Value,
    test: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Record {
    id: String,
    epoch: String,
    window: String,
    session_id: String,
    workspace_id: String,
    agent_id: String,
    run_id: Option<u64>,
    task_id: Option<String>,
    tool: Reference,
    tool_name: String,
    kind: String,
    arguments_hash: String,
    permissions: Vec<String>,
    test: bool,
    state: String,
    effect: String,
    created_at: u64,
    updated_at: u64,
    approval: Option<String>,
    native_id: Option<String>,
    result: Option<Value>,
    error: Option<String>,
    transitions: Vec<(String, u64)>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    confinement: Option<super::confinement::Receipt>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    function: Option<Binding>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    mcp: Option<mcp::Provenance>,
}
#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Ledger {
    version: u32,
    records: Vec<Record>,
}

pub(crate) fn has_run_effects(app: &tauri::AppHandle, session: &str, run: u64) -> Result<bool> {
    let state = app.state::<MemoryState>();
    Ok(read_ledger(&state.custom_tools, &path(app)?)?
        .records
        .iter()
        .any(|record| record.session_id == session && record.run_id == Some(run)))
}

pub(crate) struct Prepared {
    record: Record,
    access: Access,
    definition: Definition,
    arguments: Value,
    root: PathBuf,
    policy: String,
    checked_revision: std::sync::atomic::AtomicU64,
    started: AtomicBool,
    mcp: Option<mcp::Capture>,
}

pub(super) fn supported(definition: &Definition) -> bool {
    let properties = &definition.input_schema["properties"];
    let required = &definition.input_schema["required"];
    let requires = |name: &str| {
        required
            .as_array()
            .is_some_and(|r| r.contains(&json!(name)))
    };
    match &definition.binding {
        Binding::Native { operation } => {
            operation == "read_file"
                && cfg!(any(windows, target_os = "linux"))
                && definition.credential_ref.is_none()
                && properties.as_object().is_some_and(|p| p.len() == 1)
                && properties["path"]["type"] == "string"
                && requires("path")
        }
        Binding::Http { method, .. } => match method.as_str() {
            "GET" => properties.as_object().is_some_and(|p| p.is_empty()),
            "POST" => {
                properties
                    .as_object()
                    .is_some_and(|p| p.len() == 1 && p.contains_key("body"))
                    && requires("body")
            }
            _ => false,
        },
        Binding::Wasi { .. } => {
            functions::validate_binding(&definition.binding).is_ok()
                && functions::platform_verified()
                && definition.credential_ref.is_none()
        }
        Binding::Mcp { .. } => mcp::validate_binding(&definition.binding).is_ok(),
        _ => false,
    }
}
fn terminal(state: &str) -> bool {
    matches!(
        state,
        "succeeded" | "failed" | "denied" | "cancelled" | "timed-out" | "interrupted"
    )
}
pub(super) fn runtime_supported(entry: &Entry, access: &Access) -> bool {
    let definition = &latest(entry).definition;
    supported(definition)
        && !(access.workspace.starts_with("wsl:")
            && matches!(
                definition.binding,
                Binding::Native { .. } | Binding::Wasi { .. }
            ))
        && definition
            .credential_ref
            .as_deref()
            .is_none_or(|reference| io::credential_account(&entry.id, reference).is_ok())
}
fn prunable(record: &Record, owner: Result<Access>) -> bool {
    if record.tool.id == "tf.browser_operation.v1"
        && matches!(record.effect.as_str(), "possible" | "unknown")
    {
        return false;
    }
    terminal(&record.state)
        && (record.epoch != *MEMORY_EPOCH
            || record.test
            || owner.is_ok_and(|owner| owner.run != record.run_id))
}
fn authorized_version<'a>(
    registry: &'a Registry,
    access: &Access,
    reference: &Reference,
) -> Result<&'a Version> {
    let entry = registry
        .entries
        .iter()
        .find(|e| e.id == reference.id)
        .ok_or("tool-revoked")?;
    let version = latest(entry);
    if !eligible(entry, access)
        || version.version != reference.version
        || version.hash != reference.hash
        || !runtime_supported(entry, access)
    {
        return Err("tool-revoked".into());
    }
    Ok(version)
}
fn same_capture(record: &Record, captured: &Record) -> Result<()> {
    if record.id != captured.id
        || record.epoch != captured.epoch
        || record.window != captured.window
        || record.session_id != captured.session_id
        || record.workspace_id != captured.workspace_id
        || record.agent_id != captured.agent_id
        || record.run_id != captured.run_id
        || record.task_id != captured.task_id
        || record.tool != captured.tool
        || record.arguments_hash != captured.arguments_hash
        || record.kind != captured.kind
        || record.permissions != captured.permissions
        || record.test != captured.test
        || record.function != captured.function
        || record.mcp != captured.mcp
    {
        return Err("stale-approval".into());
    }
    Ok(())
}

fn active_version<'a>(
    registry: &'a Registry,
    access: &Access,
    reference: &Reference,
) -> Result<&'a Version> {
    let entry = registry
        .entries
        .iter()
        .find(|e| e.id == reference.id)
        .ok_or("tool-revoked")?;
    let version = entry
        .versions
        .iter()
        .find(|v| v.version == reference.version && v.hash == reference.hash)
        .ok_or("tool-revoked")?;
    if !matches!(version.definition.binding, Binding::Wasi { .. }) {
        return authorized_version(registry, access, reference);
    }
    let captured_entry = Entry {
        versions: vec![version.clone()],
        ..entry.clone()
    };
    if !eligible(&captured_entry, access)
        || !runtime_supported(&captured_entry, access)
        || entry
            .versions
            .iter()
            .any(|v| v.version > reference.version && v.invalidates_previous)
    {
        return Err("tool-revoked".into());
    }
    Ok(version)
}
fn approve(record: &mut Record, captured: &Record, granted: bool) -> Result<()> {
    same_capture(record, captured)?;
    if record.state != "awaiting-approval" || record.approval.is_some() {
        return Err("stale-approval".into());
    }
    if !granted {
        return Err("denied".into());
    }
    record.approval = Some(digest(
        format!(
            "{}:{}:{}",
            record.id, record.tool.hash, record.arguments_hash
        )
        .as_bytes(),
    ));
    transition(record, "approved", None);
    transition(record, "running", None);
    Ok(())
}
fn consume(record: &mut Record, captured: &Record, native_id: String) -> Result<bool> {
    same_capture(record, captured)?;
    if record.native_id.is_some() || terminal(&record.state) {
        return Ok(false);
    }
    if record.state != "awaiting-approval" {
        return Err("stale-approval".into());
    }
    record.native_id = Some(native_id);
    Ok(true)
}
fn settle(record: &mut Record, result: Result<Value>) {
    if terminal(&record.state) {
        return;
    }
    match result {
        Ok(output) => {
            record.result = Some(output);
            if record.effect == "possible" {
                record.effect = "reported".into();
            }
            transition(record, "succeeded", None);
        }
        Err(error) => {
            if record.effect == "possible" {
                record.effect = "unknown".into();
            }
            let state = match error.as_str() {
                "denied" => "denied",
                "cancelled"
                | "tool-revoked"
                | "run-changed"
                | "permission-changed"
                | "mcp-credential-changed"
                | "mcp-disconnected" => "cancelled",
                "timed-out" | "approval-expired" => "timed-out",
                _ => "failed",
            };
            let error = match error.as_str() {
                "denied"
                | "cancelled"
                | "tool-revoked"
                | "run-changed"
                | "permission-changed"
                | "timed-out"
                | "approval-expired"
                | "permission-denied"
                | "invalid-arguments"
                | "workspace-violation"
                | "protected-path"
                | "network-denied"
                | "auth-failed"
                | "output-limit"
                | "invalid-output"
                | "output-schema-mismatch"
                | "native-failed"
                | "network-failed"
                | "http-failed"
                | "redirect-denied"
                | "credential-unavailable"
                | "credential-denied"
                | "execution-capacity"
                | "approval-unavailable"
                | "approval-review-too-large"
                | "stale-approval"
                | "mcp-auth-failed"
                | "mcp-disconnected"
                | "mcp-credential-changed"
                | "mcp-credential-unavailable"
                | "mcp-discovery-changed"
                | "mcp-tool-changed"
                | "mcp-tool-contract-changed"
                | "mcp-network-failed"
                | "mcp-http-failed"
                | "mcp-server-error"
                | "mcp-tool-error"
                | "mcp-response-limit"
                | "mcp-result-limit"
                | "mcp-malformed-rpc"
                | "mcp-malformed-json"
                | "mcp-response-identity"
                | "mcp-unsupported-server-request"
                | "mcp-unsupported-notification"
                | "mcp-unsupported-result-content"
                | "mcp-result"
                | "mcp-connection-busy"
                | "mcp-session-changed"
                | "mcp-session"
                | "mcp-content-type"
                | "mcp-incomplete-stream"
                | "mcp-event-limit"
                | "mcp-unsupported-event"
                | "mcp-encoding" => error.as_str(),
                "tool_wasi_content_unavailable"
                | "tool_wasi_invalid_module"
                | "tool_wasi_platform_unverified" => error.as_str(),
                _ => "execution-unavailable",
            };
            transition(record, state, Some(error));
        }
    }
}
fn transition(record: &mut Record, state: &str, error: Option<&str>) {
    record.state = state.into();
    record.updated_at = now();
    record.error = error.map(str::to_string);
    record.transitions.push((state.into(), record.updated_at));
}
fn recover(ledger: &mut Ledger, epoch: &str) -> bool {
    let mut changed = false;
    for record in &mut ledger.records {
        if !terminal(&record.state)
            && (record.epoch != epoch || now().saturating_sub(record.created_at) > 300_000)
        {
            if record.effect == "possible" {
                record.effect = "unknown".into();
            }
            transition(record, "interrupted", Some("interrupted-no-replay"));
            if let Some(receipt) = &mut record.confinement {
                receipt.interrupted();
            }
            changed = true;
        }
    }
    changed
}
fn read_ledger(store: &session_file::SessionFile, path: &Path) -> Result<Ledger> {
    let mut ledger: Ledger = store
        .get(path, "executions")?
        .map(serde_json::from_value)
        .transpose()
        .map_err(|_| "tool-execution-corrupt")?
        .unwrap_or(Ledger {
            version: 1,
            records: vec![],
        });
    if ledger.version != 1 || ledger.records.len() > MAX_RECORDS {
        return Err("tool-execution-corrupt".into());
    }
    let mut ids = BTreeSet::new();
    for record in &ledger.records {
        let hash_valid =
            |value: &str| value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit());
        if !ids.insert(&record.id)
            || [
                &record.id,
                &record.epoch,
                &record.window,
                &record.session_id,
                &record.workspace_id,
                &record.agent_id,
                &record.tool.id,
            ]
            .iter()
            .any(|value| bounded(value, 2048).is_err())
            || !hash_valid(&record.tool.hash)
            || !hash_valid(&record.arguments_hash)
            || record
                .confinement
                .as_ref()
                .is_some_and(|r| r.validate().is_err())
            || record.tool.version == 0
            || record.permissions.len() > 16
            || record.permissions.iter().any(|p| bounded(p, 128).is_err())
            || bounded(&record.tool_name, 128).is_err()
            || !matches!(record.kind.as_str(), "native" | "http" | "wasi" | "mcp")
            || (record.kind == "mcp") != record.mcp.is_some()
            || record.mcp.as_ref().is_some_and(|m| m.validate().is_err())
            || (record.kind == "wasi") != record.function.is_some()
            || record
                .function
                .as_ref()
                .is_some_and(|b| functions::validate_binding(b).is_err())
            || record.created_at > record.updated_at
            || record
                .transitions
                .last()
                .is_none_or(|(state, _)| state != &record.state)
            || (record.result.is_some() && record.state != "succeeded")
            || record.transitions.len() > 8
            || !matches!(
                record.state.as_str(),
                "awaiting-approval"
                    | "approved"
                    | "running"
                    | "succeeded"
                    | "failed"
                    | "denied"
                    | "cancelled"
                    | "timed-out"
                    | "interrupted"
            )
            || !matches!(
                record.effect.as_str(),
                "none" | "possible" | "unknown" | "reported"
            )
            || schema::bounded_json(
                &serde_json::to_value(record).map_err(|_| "tool-execution-corrupt")?,
                MAX_OUTPUT + 8192,
            )
            .is_err()
        {
            return Err("tool-execution-corrupt".into());
        }
    }
    if recover(&mut ledger, &MEMORY_EPOCH) {
        write_ledger(store, path, &ledger)?;
    }
    Ok(ledger)
}
fn write_ledger(store: &session_file::SessionFile, path: &Path, ledger: &Ledger) -> Result<()> {
    let value = serde_json::to_value(ledger).map_err(|_| "tool-execution-corrupt")?;
    if let Err(error) = store.set(path, "executions", Some(value.clone())) {
        if store.get(path, "executions")? != Some(value) {
            return Err(error);
        }
    }
    Ok(())
}
fn edit_record(
    app: &tauri::AppHandle,
    id: &str,
    edit: impl FnOnce(&mut Record) -> Result<()>,
) -> Result<Record> {
    let state = app.state::<MemoryState>();
    let lock = state.owner("custom-tools")?;
    let _guard = lock.lock().map_err(|_| "tool-execution-unavailable")?;
    let mut ledger = read_ledger(&state.custom_tools, &path(app)?)?;
    let record = ledger
        .records
        .iter_mut()
        .find(|r| r.id == id)
        .ok_or("tool-execution-unavailable")?;
    edit(record)?;
    let record = record.clone();
    write_ledger(&state.custom_tools, &path(app)?, &ledger)?;
    let _ = app.emit(
        "clack:custom-tool-execution",
        json!({"sessionId": record.session_id, "id": record.id, "state": record.state}),
    );
    Ok(record)
}

/// TF4 calls only after consuming its original native consent. No public
/// command exposes this ledger admission or accepts an approval from the UI.
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
pub(crate) fn begin_native_browser_effect(
    app: &tauri::AppHandle,
    actor: &str,
    session: &str,
    root: &Path,
    consumed_approval: &str,
) -> Result<String> {
    let state = app.state::<MemoryState>();
    let lock = state.owner("custom-tools")?;
    let _guard = lock.lock().map_err(|_| "tool-execution-unavailable")?;
    let owner = access(app, session)?;
    let mut originals = original_owner(app, session)?;
    load_tasks(app, &mut originals)?;
    if owner.agent != actor || project::authorized_tool_root(app, &originals, root)? != root {
        return Err("browser-ledger-owner-mismatch".into());
    }
    let mut ledger = read_ledger(&state.custom_tools, &path(app)?)?;
    let record = native_browser_effect_record(owner, consumed_approval);
    let id = record.id.clone();
    append_native_browser_effect(&mut ledger, record, |r| access(app, &r.session_id))?;
    let path = path(app)?;
    // Dispatch requires a successful durable write, not just a cached value
    // after a failed synchronization.
    state.custom_tools.set(
        &path,
        "executions",
        Some(serde_json::to_value(&ledger).map_err(|_| "tool-execution-corrupt")?),
    )?;
    Ok(id)
}

#[cfg(any(test, all(windows, feature = "tf-browser-native-runtime")))]
fn append_native_browser_effect(
    ledger: &mut Ledger,
    record: Record,
    owner: impl Fn(&Record) -> Result<Access>,
) -> Result<()> {
    if ledger.records.iter().any(|old| old.id == record.id) {
        return Err("browser-ledger-no-replay".into());
    }
    if ledger.records.len() == MAX_RECORDS {
        let index = ledger
            .records
            .iter()
            .position(|r| prunable(r, owner(r)))
            .ok_or("tool-execution-capacity")?;
        ledger.records.remove(index);
    }
    ledger.records.push(record);
    Ok(())
}

#[cfg(any(test, all(windows, feature = "tf-browser-native-runtime")))]
fn native_browser_effect_record(owner: Access, consumed_approval: &str) -> Record {
    let id = format!("tf4-{}", digest(consumed_approval.as_bytes()));
    let at = now();
    Record {
        id: id.clone(),
        epoch: MEMORY_EPOCH.clone(),
        window: "native-browser".into(),
        session_id: owner.session,
        workspace_id: owner.workspace,
        agent_id: owner.agent,
        run_id: owner.run,
        task_id: None,
        tool: Reference {
            id: "tf.browser_operation.v1".into(),
            version: 1,
            hash: digest(b"tf.browser_operation.v1"),
        },
        tool_name: "Native browser action".into(),
        kind: "native".into(),
        arguments_hash: digest(consumed_approval.as_bytes()),
        permissions: vec!["network".into()],
        test: false,
        state: "running".into(),
        effect: "possible".into(),
        created_at: at,
        updated_at: at,
        approval: Some(digest(consumed_approval.as_bytes())),
        native_id: None,
        result: None,
        error: None,
        transitions: vec![("running".into(), at)],
        confinement: None,
        function: None,
        mcp: None,
    }
}

#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
pub(crate) fn finish_native_browser_effect(
    app: &tauri::AppHandle,
    id: &str,
    observed: bool,
    not_attempted: bool,
) -> Result<()> {
    edit_record(app, id, |record| settle_native_browser_record(record, observed, not_attempted))?;
    Ok(())
}
/// Shared with deterministic source tests, not exposed as an action API.
/// Only the original owner may promote a dispatched effect on independent
/// evidence. After a crash, an interrupted ledger row is terminal forever.
#[cfg(any(test, all(windows, feature = "tf-browser-native-runtime")))]
fn settle_native_browser_record(
    record: &mut Record,
    observed: bool,
    not_attempted: bool,
) -> Result<()> {
    if record.tool.id != "tf.browser_operation.v1" || record.epoch != *MEMORY_EPOCH {
        return Err("browser-ledger-owner-mismatch".into());
    }
    if observed && not_attempted {
        return Err("browser-ledger-conflicting-effect-evidence".into());
    }
    if terminal(&record.state) {
        // A record recovered as interrupted cannot later become success.
        if observed || not_attempted {
            return Err("browser-ledger-terminal-no-replay".into());
        }
    } else if observed {
        record.effect = "reported".into();
        transition(record, "succeeded", None);
    } else if not_attempted {
        record.effect = "none".into();
        transition(record, "failed", Some("native-browser-not-attempted"));
    } else {
        record.effect = "unknown".into();
        transition(record, "interrupted", Some("interrupted-no-replay"));
    }
    Ok(())
}
fn policy(
    app: &tauri::AppHandle,
    access: &Access,
    definition: &Definition,
    originals: &Originals,
) -> Result<String> {
    let profiles = crate::modules::self_hosted_profiles::authoritative_settings_value(
        app,
        "agentPermissionProfiles",
    )
    .map_err(|_| "permission-denied")?
    .unwrap_or(json!({}));
    let profile = &profiles[&access.agent];
    if profile["mode"] == "chat-only"
        || (originals.meta["run"]["mutationMode"] == "read-only"
            && definition.permissions.iter().any(|p| p != "read-files"))
    {
        return Err("permission-denied".into());
    }
    Ok(digest(
        &serde_json::to_vec(profile).map_err(|_| "permission-denied")?,
    ))
}
fn resolve(app: &tauri::AppHandle, request: &Request, window: &str) -> Result<Prepared> {
    bounded(&request.call_id, 256)?;
    let captured = access(app, &request.session_id)?;
    if (request.test && (captured.run.is_some() || request.run_id.is_some()))
        || (!request.test && (request.run_id.is_none() || captured.run != request.run_id))
    {
        return Err("run-changed".into());
    }
    let mut originals = original_owner(app, &request.session_id)?;
    load_tasks(app, &mut originals)?;
    if !request.test {
        let references = &originals.meta["run"]["customTools"]["versions"];
        if !references.as_array().is_some_and(|list| {
            list.iter().any(|v| {
                v["id"] == request.tool.id
                    && v["version"] == request.tool.version
                    && v["hash"] == request.tool.hash
            })
        }) {
            return Err("uncaptured-tool".into());
        }
    }
    let registry = load(app)?;
    app.state::<MemoryState>()
        .tool_registry_revision
        .fetch_max(registry.revision, Ordering::AcqRel);
    let version = authorized_version(&registry, &captured, &request.tool)?;
    let definition = version.definition.clone();
    let arguments_hash = schema::arguments(&definition, &request.arguments)?;
    if let Some(reference) = &definition.credential_ref {
        io::credential_account(&request.tool.id, reference)?;
    }
    let policy = policy(app, &captured, &definition, &originals)?;
    let root = if captured.run.is_some() {
        originals.meta["run"]["checkoutRoot"].as_str()
    } else {
        None
    }
    .or_else(|| originals.meta["profile"]["workspaceRoot"].as_str())
    .ok_or("workspace-violation")?;
    if captured.workspace.starts_with("wsl:")
        && matches!(
            definition.binding,
            Binding::Native { .. } | Binding::Wasi { .. }
        )
    {
        return Err("unsupported-platform".into());
    }
    let root = if matches!(
        definition.binding,
        Binding::Native { .. } | Binding::Wasi { .. }
    ) {
        project::authorized_tool_root(app, &originals, Path::new(root))?
    } else {
        PathBuf::new()
    };
    let kind = if matches!(definition.binding, Binding::Wasi { .. }) {
        functions::module_path(app, &definition)?;
        "wasi"
    } else if matches!(definition.binding, Binding::Http { .. }) {
        "http"
    } else if matches!(definition.binding, Binding::Mcp { .. }) {
        "mcp"
    } else {
        "native"
    };
    let id = format!(
        "tool-call-{}",
        digest(
            format!(
                "{}:{}:{:?}:{}",
                captured.session, *MEMORY_EPOCH, request.run_id, request.call_id
            )
            .as_bytes()
        )
    );
    let mcp = if kind == "mcp" {
        Some(mcp::capture(app, &captured, &definition)?)
    } else {
        None
    };
    let record = Record {
        id,
        epoch: MEMORY_EPOCH.clone(),
        window: window.into(),
        session_id: captured.session.clone(),
        workspace_id: captured.workspace.clone(),
        agent_id: captured.agent.clone(),
        run_id: captured.run,
        task_id: originals.meta["run"]["peerTaskId"]
            .as_str()
            .map(str::to_string),
        tool: request.tool.clone(),
        tool_name: definition.name.clone(),
        kind: kind.into(),
        arguments_hash,
        permissions: definition.permissions.clone(),
        test: request.test,
        state: "awaiting-approval".into(),
        effect: "none".into(),
        created_at: now(),
        updated_at: now(),
        approval: None,
        native_id: None,
        result: None,
        error: None,
        transitions: vec![("awaiting-approval".into(), now())],
        confinement: None,
        mcp: mcp.as_ref().map(|m| m.provenance.clone()),
        function: if matches!(definition.binding, Binding::Wasi { .. }) {
            Some(definition.binding.clone())
        } else {
            None
        },
    };
    Ok(Prepared {
        record,
        access: captured,
        definition,
        arguments: request.arguments.clone(),
        root,
        policy,
        checked_revision: std::sync::atomic::AtomicU64::new(registry.revision),
        started: AtomicBool::new(false),
        mcp,
    })
}
fn recheck(app: &tauri::AppHandle, prepared: &Prepared) -> Result<()> {
    if let Some(captured) = &prepared.mcp {
        mcp::recheck(app, captured)?;
    }
    if access(app, &prepared.access.session)? != prepared.access {
        return Err("run-changed".into());
    }
    if app
        .state::<MemoryState>()
        .tool_registry_revision
        .load(Ordering::Acquire)
        != prepared.checked_revision.load(Ordering::Acquire)
    {
        let registry = load(app)?;
        if prepared.started.load(Ordering::Acquire) {
            active_version(&registry, &prepared.access, &prepared.record.tool)?;
        } else {
            authorized_version(&registry, &prepared.access, &prepared.record.tool)?;
        }
        prepared
            .checked_revision
            .store(registry.revision, Ordering::Release);
    }
    let mut originals = original_owner(app, &prepared.access.session)?;
    load_tasks(app, &mut originals)?;
    if matches!(
        prepared.definition.binding,
        Binding::Native { .. } | Binding::Wasi { .. }
    ) && project::authorized_tool_root(app, &originals, &prepared.root)? != prepared.root
    {
        return Err("workspace-violation".into());
    }
    if policy(app, &prepared.access, &prepared.definition, &originals)? != prepared.policy {
        return Err("permission-changed".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn custom_tool_prepare(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: Request,
) -> Result<Record> {
    blocking(move || {
        let prepared = resolve(&app, &request, window.label())?;
        let state = app.state::<MemoryState>();
        let lock = state.owner("custom-tools")?;
        let _guard = lock.lock().map_err(|_| "tool-execution-unavailable")?;
        recheck(&app, &prepared)?;
        let mut ledger = read_ledger(&state.custom_tools, &path(&app)?)?;
        if let Some(old) = ledger.records.iter().find(|r| r.id == prepared.record.id) {
            same_capture(old, &prepared.record)?;
            return Ok(old.clone());
        }
        if ledger.records.len() == MAX_RECORDS {
            let index = ledger
                .records
                .iter()
                .position(|r| prunable(r, access(&app, &r.session_id)))
                .ok_or("tool-execution-capacity")?;
            ledger.records.remove(index);
        }
        let mut pending = state
            .tool_calls
            .lock()
            .map_err(|_| "tool-execution-unavailable")?;
        pending.retain(|id, _| {
            ledger
                .records
                .iter()
                .any(|r| &r.id == id && !terminal(&r.state))
        });
        if pending.len() >= MAX_RECORDS {
            return Err("tool-execution-capacity".into());
        }
        let record = prepared.record.clone();
        ledger.records.push(record.clone());
        write_ledger(&state.custom_tools, &path(&app)?, &ledger)?;
        pending.insert(record.id.clone(), Arc::new(prepared));
        Ok(record)
    })
    .await
}

async fn execute_io(
    app: &tauri::AppHandle,
    prepared: &Prepared,
    cancelled: Arc<AtomicBool>,
) -> Result<Value> {
    let limit = (prepared.definition.output_bytes as usize).min(MAX_OUTPUT);
    match &prepared.definition.binding {
        Binding::Native { operation } if operation == "read_file" => {
            let root = prepared.root.clone();
            let raw = prepared.arguments["path"]
                .as_str()
                .ok_or("invalid-arguments")?
                .to_string();
            let permit = SLOTS
                .clone()
                .try_acquire_owned()
                .map_err(|_| "execution-capacity")?;
            tokio::task::spawn_blocking(move || {
                let _permit = permit;
                io::read_file(&root, &raw, limit, &cancelled)
            })
            .await
            .map_err(|_| "native-failed")?
        }
        Binding::Http { url, method } => {
            let _permit = SLOTS
                .clone()
                .try_acquire_owned()
                .map_err(|_| "execution-capacity")?;
            let (client, url) = crate::modules::net::custom_tool_client(url).await?;
            let secret = if let Some(reference) = &prepared.definition.credential_ref {
                let account = io::credential_account(&prepared.record.tool.id, reference)?;
                Some(
                    crate::modules::secrets::read_secret(
                        app,
                        &app.state::<crate::modules::secrets::SecretsState>(),
                        "terax-ai",
                        &account,
                    )
                    .map_err(|_| "credential-unavailable")?
                    .ok_or("credential-unavailable")?,
                )
            } else {
                None
            };
            recheck(app, prepared)?;
            let request =
                io::request(&client, url, method, &prepared.arguments, secret.as_deref())?;
            edit_record(app, &prepared.record.id, |record| {
                recheck(app, prepared)?;
                same_capture(record, &prepared.record)?;
                if record.state != "running" {
                    return Err("cancelled".into());
                }
                record.effect = "possible".into();
                Ok(())
            })?;
            let response = request.send().await.map_err(|_| "network-failed")?;
            io::response(response, limit, secret.as_deref()).await
        }
        Binding::Mcp { .. } => {
            let captured = prepared.mcp.as_ref().ok_or("mcp-unavailable")?;
            mcp::invoke(app, captured, &prepared.arguments, || {
                edit_record(app, &prepared.record.id, |record| {
                    recheck(app, prepared)?;
                    same_capture(record, &prepared.record)?;
                    if record.state != "running" {
                        return Err("cancelled".into());
                    }
                    // Even a tool annotated read-only may mutate a remote service.
                    record.effect = "possible".into();
                    Ok(())
                })?;
                Ok(())
            })
            .await
        }
        _ => Err("unsupported-kind".into()),
    }
}

fn approval_text(record: &Record, definition: &Definition, arguments: &Value) -> Result<String> {
    let remote = record.mcp.as_ref().map(|p| serde_json::to_string(p).map(|p| format!("\nRemote MCP (not locally sandboxed); arguments leave Clack. Destination and provenance: {p}"))).transpose().map_err(|_| "mcp-provenance")?.unwrap_or_default();
    let description = format!("{} v{}\nWorkspace: {}\nAgent: {}\nDefinition SHA-256: {}\nBinding: {}\nPermissions: {}\nCredential reference: {}\nArguments (untrusted data): {}{remote}\n\nReal operation, not a dry run. Remote effects may not be reversible. Approve this exact request?",
        record.tool_name, record.tool.version, record.workspace_id, record.agent_id,
        record.tool.hash, serde_json::to_string(&definition.binding).map_err(|_| "invalid-arguments")?,
        definition.permissions.join(", "), definition.credential_ref.as_deref().unwrap_or("none"),
        serde_json::to_string(arguments).map_err(|_| "invalid-arguments")?);
    if description.chars().count() > 2048 {
        return Err("approval-review-too-large".into());
    }
    Ok(description)
}

pub(super) fn redact_mcp(mut value: Value, secret: Option<&str>) -> Value {
    io::redact(&mut value, secret);
    value
}

async fn run(app: &tauri::AppHandle, prepared: &Prepared, lease: Lease) -> Result<Value> {
    recheck(app, prepared)?;
    let description = approval_text(&prepared.record, &prepared.definition, &prepared.arguments)?;
    let dialog_app = app.clone();
    let approval_slot = APPROVAL_SLOTS
        .clone()
        .try_acquire_owned()
        .map_err(|_| "execution-capacity")?;
    let approved = tokio::task::spawn_blocking(move || {
        let _slot = approval_slot;
        dialog_app
            .dialog()
            .message(description)
            .title("Clack custom tool execution approval")
            .buttons(MessageDialogButtons::OkCancel)
            .blocking_show()
    });
    let approved = tokio::select! {
        biased;
        _ = lease.cancellation() => return Err("cancelled".into()),
        _ = tokio::time::sleep(Duration::from_secs(60)) => return Err("approval-expired".into()),
        value = approved => value.map_err(|_| "approval-unavailable")?,
    };
    edit_record(app, &prepared.record.id, |record| {
        recheck(app, prepared)?;
        approve(record, &prepared.record, approved)?;
        prepared.started.store(true, Ordering::Release);
        Ok(())
    })?;
    if matches!(prepared.definition.binding, Binding::Wasi { .. }) {
        return wasi::execute(app, prepared, lease).await;
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    let result = monitor(
        &lease,
        prepared.definition.timeout_ms,
        execute_io(app, prepared, cancelled.clone()),
        || recheck(app, prepared),
    )
    .await;
    cancelled.store(true, Ordering::Release);
    if result.is_err() {
        if let Some(captured) = &prepared.mcp {
            mcp::interrupted(app, captured);
        }
    }
    let output = result?;
    recheck(app, prepared)?;
    schema::value_matches(&prepared.definition.output_schema, &output, 0)
        .map_err(|_| "output-schema-mismatch")?;
    schema::bounded_json(
        &output,
        (prepared.definition.output_bytes as usize).min(MAX_OUTPUT),
    )?;
    Ok(output)
}

async fn monitor(
    lease: &Lease,
    timeout_ms: u64,
    operation: impl std::future::Future<Output = Result<Value>>,
    mut check: impl FnMut() -> Result<()>,
) -> Result<Value> {
    // Check cancellation and revocation before racing the timer against the
    // interval's first tick. Under a busy executor a very short deadline can
    // otherwise fire first, reporting a timeout for a revoked tool. Neither
    // condition may authorize dispatch or an effect replay.
    if lease.cancelled() {
        return Err("cancelled".into());
    }
    check()?;
    tokio::pin!(operation);
    let timer = tokio::time::sleep(Duration::from_millis(timeout_ms));
    tokio::pin!(timer);
    let mut watch = tokio::time::interval(Duration::from_millis(100));
    let result = loop {
        tokio::select! {
            biased;
            _ = lease.cancellation() => break Err("cancelled".into()),
            _ = &mut timer => break Err("timed-out".into()),
            _ = watch.tick() => if let Err(error) = check() { break Err(error); },
            value = &mut operation => break value,
        }
    };
    result
}

#[tauri::command]
pub async fn custom_tool_execute(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    execution_id: String,
) -> Result<Record> {
    let _permit = RUN_SLOTS
        .clone()
        .try_acquire_owned()
        .map_err(|_| "execution-capacity")?;
    let prepared = app
        .state::<MemoryState>()
        .tool_calls
        .lock()
        .map_err(|_| "tool-execution-unavailable")?
        .get(&execution_id)
        .filter(|p| p.record.window == window.label())
        .cloned()
        .ok_or("tool-execution-unavailable")?;
    let state = app.state::<InferenceState>();
    let id = state
        .open(window.label())
        .map_err(|_| "execution-capacity")?;
    let lease = state
        .start(window.label(), &id)
        .map_err(|_| "execution-unavailable")?;
    let mut consumed = false;
    let existing = edit_record(&app, &execution_id, |record| {
        consumed = consume(record, &prepared.record, id)?;
        Ok(())
    })?;
    if !consumed {
        return Ok(existing);
    }
    let result = run(&app, &prepared, lease).await;
    let settled = edit_record(&app, &execution_id, |record| {
        let result = result.and_then(|output| recheck(&app, &prepared).map(|()| output));
        settle(record, result);
        Ok(())
    });
    app.state::<MemoryState>()
        .tool_calls
        .lock()
        .map_err(|_| "tool-execution-unavailable")?
        .remove(&execution_id);
    settled
}

#[tauri::command]
pub async fn custom_tool_cancel(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    session_id: String,
    execution_id: String,
) -> Result<()> {
    access(&app, &session_id)?;
    let record = edit_record(&app, &execution_id, |record| {
        if record.window != window.label() || record.session_id != session_id {
            return Err("permission-denied".into());
        }
        if record.native_id.is_none() && !terminal(&record.state) {
            transition(record, "cancelled", Some("cancelled"));
        }
        Ok(())
    })?;
    if let Some(id) = record.native_id {
        app.state::<InferenceState>()
            .cancel(window.label(), &id)
            .await;
    }
    Ok(())
}

#[tauri::command]
pub async fn custom_tool_history(app: tauri::AppHandle, session_id: String) -> Result<Vec<Record>> {
    blocking(move || {
        let owner = access(&app, &session_id)?;
        let state = app.state::<MemoryState>();
        let lock = state.owner("custom-tools")?;
        let _guard = lock.lock().map_err(|_| "tool-execution-unavailable")?;
        Ok(read_ledger(&state.custom_tools, &path(&app)?)?
            .records
            .into_iter()
            .filter(|record| {
                record.session_id == owner.session && record.workspace_id == owner.workspace
            })
            .collect())
    })
    .await
}
