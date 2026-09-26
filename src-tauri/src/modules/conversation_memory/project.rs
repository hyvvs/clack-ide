//! Explicit workspace-owned publication. Private conversation memory is never a shared index.
use super::*;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

#[cfg(test)]
mod integration_tests;
mod storage;
#[cfg(test)]
mod tests;
use storage::{expect_revision, load, publish};

pub(super) fn retention_roots(path: &Path) -> Result<Vec<String>> {
    storage::retention_roots(path)
}

const POLICY: &str = "m1-explicit-slice-v1";
const MAX_ENTRIES: usize = 64;
const MAX_SLICE: usize = 4096;
const SECTIONS: &[&str] = &[
    "requirements",
    "architecture",
    "interfaces",
    "bugs",
    "milestones",
    "constraints",
    "findings",
    "verification",
    "uncertainty",
];

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Scope {
    workspace: String,
    checkout: String,
    base_sha: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
enum Qualification {
    UserRequirement,
    ToolObservation,
    AgentFinding,
    UserCorrection,
    Disputed,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
enum Publication {
    Pending,
    Approved,
    Revoked,
    Superseded,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Source {
    owner: Owner,
    locator: SourceLocator,
    source_digest: String,
    start: usize,
    end: usize,
    slice_digest: String,
    qualification: Qualification,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Consent {
    policy: String,
    user_confirmed_at: u64,
    acting_session: String,
    action: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Entry {
    id: String,
    scope: Scope,
    section: String,
    text: String,
    source: Source,
    author_agent: String,
    status: Publication,
    qualification: Qualification,
    created_at: u64,
    updated_at: u64,
    consent: Vec<Consent>,
    supersedes: Option<String>,
    conflicts: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Snapshot {
    schema_version: u32,
    workspace: String,
    revision: u64,
    previous: Option<String>,
    entries: Vec<Entry>,
}

#[derive(Clone, Debug, PartialEq)]
struct Access {
    owner: Owner,
    scope: Scope,
    agent: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Proposal {
    locator: SourceLocator,
    start: usize,
    end: usize,
    section: String,
    conflicts: Vec<String>,
}

#[derive(Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Decision {
    Approve,
    Revoke,
    Correct { text: String },
}

pub(super) fn root(app: &tauri::AppHandle) -> Result<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("ai-project-memory"))
}

fn identity(environment: &str, path: &str) -> String {
    let raw = path.replace('\\', "/");
    let (prefix, tail) = if raw.as_bytes().get(1) == Some(&b':') {
        (&raw[..2], &raw[2..])
    } else if let Some(tail) = raw.strip_prefix('/') {
        ("/", tail)
    } else {
        ("", raw.as_str())
    };
    let mut parts = vec![];
    for part in tail.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            value => parts.push(value),
        }
    }
    let path = if prefix == "/" {
        format!("/{}", parts.join("/"))
    } else {
        format!("{prefix}/{}", parts.join("/"))
    };
    format!(
        "{environment}:{}",
        if prefix.ends_with(':') {
            path.to_lowercase()
        } else {
            path
        }
    )
}

fn access(app: &tauri::AppHandle, session_id: &str) -> Result<(Access, Originals)> {
    let mut originals = originals(app, session_id)?;
    load_tasks(app, &mut originals)?;
    let access = bind(
        &app.state::<super::super::workspace::WorkspaceRegistry>(),
        &originals,
    )?;
    Ok((access, originals))
}

fn bind(
    registry: &super::super::workspace::WorkspaceRegistry,
    originals: &Originals,
) -> Result<Access> {
    let session_id = originals.meta["id"]
        .as_str()
        .ok_or("project_missing_session")?;
    let profile = &originals.meta["profile"];
    let workspace_id = profile["workspaceId"]
        .as_str()
        .ok_or("project_unbound_session")?;
    let workspace_root = profile["workspaceRoot"]
        .as_str()
        .ok_or("project_unbound_session")?;
    let (environment, env) = if workspace_id.starts_with("local:") {
        (
            "local".to_string(),
            super::super::workspace::WorkspaceEnv::Local,
        )
    } else if let Some(rest) = workspace_id.strip_prefix("wsl:") {
        let (distro, _) = rest.split_once(':').ok_or("project_invalid_workspace")?;
        (
            format!("wsl:{distro}"),
            super::super::workspace::WorkspaceEnv::Wsl {
                distro: distro.into(),
            },
        )
    } else {
        return Err("project_invalid_workspace".into());
    };
    if identity(&environment, workspace_root) != workspace_id {
        return Err("project_workspace_identity_mismatch".into());
    }
    let owner = Owner {
        session_id: session_id.into(),
        workspace_id: Some(workspace_id.into()),
    };
    check_owner(originals, &owner)?;
    let canonical =
        super::super::workspace::authorize_spawn_cwd(registry, Some(workspace_root), &env)?
            .ok_or("project_unbound_session")?;
    let workspace = identity(&environment, &super::super::fs::to_canon(&canonical));
    let run = &originals.meta["run"];
    let checkout_root = if run["workspaceId"].as_str() == Some(workspace_id) {
        run["checkoutRoot"].as_str().unwrap_or(workspace_root)
    } else {
        workspace_root
    };
    let checkout =
        super::super::workspace::authorize_spawn_cwd(registry, Some(checkout_root), &env)?
            .ok_or("project_missing_checkout")?;
    let checkout = identity(&environment, &super::super::fs::to_canon(&checkout));
    let base_sha = if checkout != workspace {
        let task = originals
            .tasks
            .iter()
            .find(|task| {
                task["id"] == run["peerTaskId"]
                    && task["targetSessionId"].as_str() == Some(session_id)
                    && task["workspaceId"].as_str() == Some(workspace_id)
                    && task["worktree"]["checkoutRoot"].as_str() == Some(checkout_root)
            })
            .ok_or("project_checkout_provenance_missing")?;
        let sha = task["worktree"]["baseSha"]
            .as_str()
            .filter(|s| {
                (s.len() == 40 || s.len() == 64) && s.bytes().all(|b| b.is_ascii_hexdigit())
            })
            .ok_or("project_invalid_base_sha")?;
        Some(sha.into())
    } else {
        None
    };
    let agent = profile["agentId"]
        .as_str()
        .filter(|id| !id.is_empty())
        .ok_or("project_missing_agent")?
        .into();
    Ok(Access {
        owner,
        scope: Scope {
            workspace,
            checkout,
            base_sha,
        },
        agent,
    })
}

fn sensitive(value: &Value) -> bool {
    match value {
        Value::Object(object) => object.iter().any(|(key, value)| {
            (matches!(
                key.as_str(),
                "path" | "filePath" | "sourcePath" | "canonicalPath" | "displayName" | "entryPath"
            ) && value.as_str().is_some_and(|p| {
                super::super::archive::is_sensitive_archive_path(&p.replace('\\', "/"))
            })) || sensitive(value)
        }),
        Value::Array(values) => values.iter().any(sensitive),
        _ => false,
    }
}

fn selected_source(
    originals: &Originals,
    owner: &Owner,
    content: &Path,
    locator: &SourceLocator,
) -> Result<(String, String, Qualification)> {
    check_owner(originals, owner)?;
    let (value, _) = source_value(originals, owner, locator)?;
    if sensitive(&value) {
        return Err("project_secret_source_denied".into());
    }
    let (text, qualification) = match locator {
        SourceLocator::Part { message_id, .. } => {
            let message = originals
                .messages
                .iter()
                .find(|m| m["id"].as_str() == Some(message_id))
                .ok_or("project_source_missing")?;
            if sensitive(message) {
                return Err("project_secret_source_denied".into());
            }
            match value["type"].as_str() {
                Some("text") if message["role"] == "user" => (value["text"].as_str().ok_or("project_invalid_text")?.to_string(), Qualification::UserRequirement),
                Some(kind) if (kind.starts_with("tool-") || kind == "dynamic-tool") && value["state"] == "output-available" && value["toolCallId"].is_string() => {
                    let output = value.get("output").ok_or("project_missing_tool_result")?;
                    (output.as_str().map(str::to_owned).unwrap_or(serde_json::to_string(output).map_err(|e| e.to_string())?), Qualification::ToolObservation)
                }
                _ => return Err("project_unsupported_private_source: select a user requirement or completed tool result, not reasoning or an unsupported assistant assertion".into()),
            }
        }
        SourceLocator::TaskResult { task_id } => {
            let task = originals
                .tasks
                .iter()
                .find(|t| t["id"].as_str() == Some(task_id))
                .ok_or("project_missing_task")?;
            if task["status"] != "completed" {
                return Err("project_unfinished_task".into());
            }
            (
                value["summary"]
                    .as_str()
                    .ok_or("project_missing_task_summary")?
                    .into(),
                Qualification::AgentFinding,
            )
        }
        SourceLocator::Artifact { .. } => {
            if value["accessPolicy"] != "model-input"
                || !matches!(value["contentKind"].as_str(), Some("text" | "selection"))
            {
                return Err("project_unsupported_artifact".into());
            }
            validate_content_sizes(&value, content)?;
            let reference = &value["contentRef"];
            let id = reference["id"].as_str().ok_or("project_invalid_artifact")?;
            if reference["contentHash"].as_str() != Some(id) {
                return Err("project_invalid_artifact".into());
            }
            (
                String::from_utf8(read_content_from(content, id)?)
                    .map_err(|_| "project_invalid_encoding")?,
                Qualification::ToolObservation,
            )
        }
        _ => return Err("project_select_bounded_source_part".into()),
    };
    if text.contains("-----BEGIN") || text.contains("sk-") || text.contains("AKIA") {
        return Err("project_possible_secret_denied".into());
    }
    Ok((text, hash(&value)?, qualification))
}

fn check_source_scope(
    access: &Access,
    originals: &Originals,
    locator: &SourceLocator,
) -> Result<()> {
    if let SourceLocator::TaskResult { task_id } | SourceLocator::Artifact { task_id, .. } = locator
    {
        let task = originals
            .tasks
            .iter()
            .find(|task| task["id"].as_str() == Some(task_id))
            .ok_or("project_missing_task")?;
        if task["worktree"].is_object()
            && (originals.meta["run"]["peerTaskId"].as_str() != Some(task_id)
                || task["worktree"]["baseSha"].as_str() != access.scope.base_sha.as_deref()
                || task["worktree"]["checkoutRoot"] != originals.meta["run"]["checkoutRoot"])
        {
            return Err("project_source_checkout_mismatch".into());
        }
        let (value, _) = source_value(originals, &access.owner, locator)?;
        if value["worktreeProvenance"].is_object()
            && (value["worktreeProvenance"]["baseSha"].as_str() != access.scope.base_sha.as_deref()
                || value["worktreeProvenance"]["taskId"].as_str() != Some(task_id))
        {
            return Err("project_source_checkout_mismatch".into());
        }
    }
    Ok(())
}

fn propose(
    snapshot: &mut Snapshot,
    access: &Access,
    originals: &Originals,
    content: &Path,
    proposal: Proposal,
) -> Result<()> {
    if snapshot.workspace != access.scope.workspace {
        return Err("project_scope_denied".into());
    }
    if !SECTIONS.contains(&proposal.section.as_str()) {
        return Err("project_invalid_section".into());
    }
    if proposal.conflicts.len() > 8
        || proposal.conflicts.iter().any(|id| {
            !snapshot.entries.iter().any(|e| {
                &e.id == id && e.scope == access.scope && e.status == Publication::Approved
            })
        })
    {
        return Err("project_invalid_conflict".into());
    }
    check_source_scope(access, originals, &proposal.locator)?;
    let (text, source_digest, qualification) =
        selected_source(originals, &access.owner, content, &proposal.locator)?;
    let slice = text
        .get(proposal.start..proposal.end)
        .filter(|s| !s.trim().is_empty() && s.len() <= MAX_SLICE)
        .ok_or("project_invalid_slice")?;
    let slice_digest = put_content_in(content, slice.as_bytes())?.id;
    let source = Source {
        owner: access.owner.clone(),
        locator: proposal.locator,
        source_digest,
        start: proposal.start,
        end: proposal.end,
        slice_digest,
        qualification: qualification.clone(),
    };
    let id = hash(&json!([
        access.scope,
        source,
        snapshot.revision,
        snapshot.entries.len()
    ]))?;
    if snapshot.entries.iter().any(|entry| entry.id == id) {
        return Err("project_duplicate_proposal".into());
    }
    snapshot.entries.push(Entry {
        id,
        scope: access.scope.clone(),
        section: proposal.section,
        text: slice.into(),
        source,
        author_agent: access.agent.clone(),
        status: Publication::Pending,
        qualification: if proposal.conflicts.is_empty() {
            qualification
        } else {
            Qualification::Disputed
        },
        created_at: now(),
        updated_at: now(),
        consent: vec![],
        supersedes: None,
        conflicts: proposal.conflicts,
    });
    Ok(())
}

fn visible(entry: &Entry, access: &Access) -> bool {
    entry.scope == access.scope
        && (entry.status == Publication::Approved
            || entry.source.owner.session_id == access.owner.session_id)
}

fn decide(
    snapshot: &mut Snapshot,
    access: &Access,
    id: &str,
    decision: &Decision,
    confirmed: bool,
) -> Result<()> {
    if !confirmed {
        return Err("project_user_consent_required".into());
    }
    let entry = snapshot
        .entries
        .iter_mut()
        .find(|e| e.id == id && visible(e, access))
        .ok_or("project_record_unavailable")?;
    let action = match decision {
        Decision::Approve => "approve",
        Decision::Revoke => "revoke",
        Decision::Correct { .. } => "correct",
    };
    let consent = Consent {
        policy: POLICY.into(),
        user_confirmed_at: now(),
        acting_session: access.owner.session_id.clone(),
        action: action.into(),
    };
    match decision {
        Decision::Approve if entry.status == Publication::Pending => {
            entry.status = Publication::Approved;
            entry.consent.push(consent);
        }
        Decision::Revoke
            if matches!(entry.status, Publication::Pending | Publication::Approved) =>
        {
            entry.status = Publication::Revoked;
            entry.consent.push(consent);
        }
        Decision::Correct { text } if entry.status == Publication::Approved => {
            if text.trim().is_empty()
                || text.len() > MAX_SLICE
                || text.contains("-----BEGIN")
                || text.contains("sk-")
                || text.contains("AKIA")
            {
                return Err("project_invalid_correction".into());
            }
            let mut replacement = entry.clone();
            replacement.id = hash(&json!([id, text, snapshot.revision]))?;
            replacement.supersedes = Some(id.into());
            replacement.text = text.clone();
            replacement.qualification = Qualification::UserCorrection;
            replacement.author_agent = access.agent.clone();
            replacement.created_at = now();
            replacement.updated_at = now();
            replacement.consent = vec![consent.clone()];
            entry.status = Publication::Superseded;
            entry.updated_at = now();
            entry.consent.push(consent);
            snapshot.entries.push(replacement);
            return Ok(());
        }
        _ => return Err("project_invalid_transition".into()),
    }
    entry.updated_at = now();
    Ok(())
}

type SourceCache = HashMap<String, Result<(Access, Originals)>>;

fn source_state(
    app: &tauri::AppHandle,
    content: &Path,
    entry: &Entry,
    cache: &mut SourceCache,
) -> &'static str {
    if read_content_from(content, &entry.source.slice_digest).is_err() {
        return "content-unavailable";
    }
    let source = &entry.source;
    let Ok((source_access, originals)) = cache
        .entry(source.owner.session_id.clone())
        .or_insert_with(|| access(app, &source.owner.session_id))
    else {
        return "source-unavailable";
    };
    if source_access.owner.workspace_id != source.owner.workspace_id
        || source_access.scope != entry.scope
        || check_source_scope(source_access, originals, &source.locator).is_err()
    {
        return "source-scope-changed";
    }
    match selected_source(originals, &source.owner, content, &source.locator) {
        Ok((text, checksum, qualification))
            if checksum == source.source_digest
                && qualification == source.qualification
                && text
                    .get(source.start..source.end)
                    .is_some_and(|slice| digest(slice.as_bytes()) == source.slice_digest) =>
        {
            "historical-source-verified"
        }
        Ok(_) => "source-changed",
        Err(_) => "source-unavailable",
    }
}

fn view(
    snapshot: &Snapshot,
    access: &Access,
    mut state: impl FnMut(&Entry) -> &'static str,
) -> Value {
    json!({"workspace": snapshot.workspace, "checkout": access.scope.checkout, "baseSha": access.scope.base_sha, "revision": snapshot.revision,
        "entries": snapshot.entries.iter().filter(|entry| visible(entry, access)).map(|entry| json!({
            "id": entry.id, "section":entry.section,"text":entry.text,"qualification":entry.qualification,"status":entry.status,
            "sourceState":state(entry),"sourceSessionId":entry.source.owner.session_id,"locator":entry.source.locator,
            "sliceHash":entry.source.slice_digest,"start":entry.source.start,"end":entry.source.end,"authorAgent":entry.author_agent,
            "consent":entry.consent,"supersedes":entry.supersedes,"conflicts":entry.conflicts,"updatedAt":entry.updated_at
        })).collect::<Vec<_>>()})
}

#[tauri::command]
pub async fn project_memory_load(app: tauri::AppHandle, session_id: String) -> Result<Value> {
    blocking(move || {
        let (access, _) = access(&app, &session_id)?;
        let state = app.state::<MemoryState>();
        let lock = state.owner(&format!(
            "project:{}",
            digest(access.scope.workspace.as_bytes())
        ))?;
        let _owner = lock.lock().map_err(|e| e.to_string())?;
        let snapshot = load(&root(&app)?, &access.scope.workspace)?;
        let (_, content) = paths(&app)?;
        let mut cache = SourceCache::new();
        let result = view(&snapshot, &access, |entry| {
            source_state(&app, &content, entry, &mut cache)
        });
        if self::access(&app, &session_id)?.0 != access {
            return Err("project_authorization_changed".into());
        }
        Ok(result)
    })
    .await
}

#[tauri::command]
pub async fn project_memory_propose(
    app: tauri::AppHandle,
    session_id: String,
    expected_revision: u64,
    proposal: Proposal,
) -> Result<()> {
    blocking(move || {
        let _collection = CONTENT_COLLECTION.read().map_err(|e| e.to_string())?;
        let (access, originals) = access(&app, &session_id)?;
        let state = app.state::<MemoryState>();
        let lock = state.owner(&format!(
            "project:{}",
            digest(access.scope.workspace.as_bytes())
        ))?;
        let _owner = lock.lock().map_err(|e| e.to_string())?;
        let root = root(&app)?;
        let (_, content) = paths(&app)?;
        let mut snapshot = load(&root, &access.scope.workspace)?;
        expect_revision(&snapshot, expected_revision)?;
        propose(&mut snapshot, &access, &originals, &content, proposal)?;
        if self::access(&app, &session_id)?.0 != access {
            return Err("project_authorization_changed".into());
        }
        publish(&root, snapshot, expected_revision, |_| Ok(()))?;
        let _ = app.emit("clack:project-memory-changed", &access.scope.workspace);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn project_memory_decide(
    app: tauri::AppHandle,
    session_id: String,
    expected_revision: u64,
    id: String,
    decision: Decision,
) -> Result<()> {
    blocking(move || {
        let (captured, _) = access(&app, &session_id)?;
        let root = root(&app)?;
        let snapshot = load(&root, &captured.scope.workspace)?;
        expect_revision(&snapshot, expected_revision)?;
        let entry = snapshot.entries.iter().find(|e| e.id == id && visible(e, &captured)).ok_or("project_record_unavailable")?;
        let text = match &decision { Decision::Correct { text } => text, _ => &entry.text };
        if text.len() > MAX_SLICE { return Err("project_invalid_correction".into()); }
        let action = match decision { Decision::Approve => "Share selected evidence", Decision::Revoke => "Revoke project knowledge", Decision::Correct { .. } => "Publish a user correction" };
        let confirmed = app.dialog().message(format!("{action}?\nWorkspace: {}\nCheckout: {}\nSource: {}\n\n{}\n\nOnly this selected statement and evidence slice will be shared with authorized chats in this checkout. Confirm it contains no secrets or private personal context.", captured.scope.workspace, captured.scope.checkout, entry.source.owner.session_id, text))
            .title("Clack project memory authorization").buttons(MessageDialogButtons::OkCancel).blocking_show();
        if !confirmed { return Err("project_user_consent_required".into()); }
        let _collection = CONTENT_COLLECTION.read().map_err(|e| e.to_string())?;
        let (current, _) = access(&app, &session_id)?;
        if current != captured { return Err("project_authorization_changed".into()); }
        let state = app.state::<MemoryState>();
        let lock = state.owner(&format!("project:{}", digest(current.scope.workspace.as_bytes())))?;
        let _owner = lock.lock().map_err(|e| e.to_string())?;
        let mut snapshot = load(&root, &current.scope.workspace)?;
        expect_revision(&snapshot, expected_revision)?;
        let (_, content) = paths(&app)?;
        if matches!(decision, Decision::Approve) {
            let entry = snapshot.entries.iter().find(|e| e.id == id).ok_or("project_record_unavailable")?;
            if source_state(&app, &content, entry, &mut SourceCache::new()) != "historical-source-verified" { return Err("project_source_changed_before_consent".into()); }
        }
        decide(&mut snapshot, &current, &id, &decision, true)?;
        if self::access(&app, &session_id)?.0 != current { return Err("project_authorization_changed".into()); }
        publish(&root, snapshot, expected_revision, |_| Ok(()))?;
        let _ = app.emit("clack:project-memory-changed", &current.scope.workspace);
        Ok(())
    }).await
}

#[tauri::command]
pub async fn project_memory_inspect(
    app: tauri::AppHandle,
    session_id: String,
    expected_revision: u64,
    id: String,
) -> Result<Value> {
    blocking(move || {
        let _collection = CONTENT_COLLECTION.read().map_err(|e| e.to_string())?;
        let (access, _) = access(&app, &session_id)?;
        let state = app.state::<MemoryState>();
        let lock = state.owner(&format!("project:{}", digest(access.scope.workspace.as_bytes())))?;
        let _owner = lock.lock().map_err(|e| e.to_string())?;
        let snapshot = load(&root(&app)?, &access.scope.workspace)?;
        expect_revision(&snapshot, expected_revision)?;
        let entry = snapshot.entries.iter().find(|e| e.id == id && visible(e, &access) && (e.status == Publication::Approved || e.source.owner.session_id == session_id)).ok_or("project_record_unavailable")?;
        let (_, content) = paths(&app)?;
        let bytes = read_content_from(&content, &entry.source.slice_digest)?;
        if bytes.len() > MAX_SLICE { return Err("project_oversized_slice".into()); }
        let result = json!({"text":String::from_utf8(bytes).map_err(|_| "project_invalid_encoding")?,"sourceState":source_state(&app, &content, entry, &mut SourceCache::new()),"sliceHash":entry.source.slice_digest});
        if self::access(&app, &session_id)?.0 != access { return Err("project_authorization_changed".into()); }
        Ok(result)
    }).await
}
