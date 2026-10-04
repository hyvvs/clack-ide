//! Versioned definitions only. No execution kind is available in T1.
use super::*;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

pub mod confinement;
pub mod execution;
pub mod functions;
#[cfg(test)]
mod tests;

const MAX_TOOLS: usize = 128;
const MAX_VERSIONS: usize = 32;
const MAX_STORE: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Binding {
    Native {
        operation: String,
    },
    Http {
        url: String,
        method: String,
    },
    Script {
        executable: String,
        argv: Vec<String>,
        hash: String,
    },
    Function {
        module: String,
        export: String,
        hash: String,
    },
    Wasi {
        #[serde(rename = "schemaVersion")]
        schema_version: u32,
        hash: String,
        abi: String,
        export: String,
        runtime: String,
    },
    Mcp {
        server: String,
        tool: String,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Definition {
    name: String,
    description: String,
    input_schema: Value,
    output_schema: Value,
    output_description: String,
    binding: Binding,
    scope: String,
    agents: Vec<String>,
    conversations: Vec<String>,
    permissions: Vec<String>,
    credential_ref: Option<String>,
    timeout_ms: u64,
    output_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Version {
    version: u64,
    hash: String,
    definition: Definition,
    status: String,
    enabled: bool,
    source: String,
    session_id: String,
    agent_id: String,
    run_id: Option<u64>,
    created_at: u64,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    invalidates_previous: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Entry {
    id: String,
    workspace_id: String,
    versions: Vec<Version>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Registry {
    schema_version: u32,
    revision: u64,
    entries: Vec<Entry>,
}
impl Default for Registry {
    fn default() -> Self {
        Self {
            schema_version: 1,
            revision: 0,
            entries: vec![],
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Change {
    Create { definition: Definition },
    Edit { id: String, definition: Definition },
    Authorize { id: String },
    Enable { id: String },
    Disable { id: String },
    Revoke { id: String },
    Remove { id: String },
}
#[derive(Clone, Debug, PartialEq)]
struct Access {
    session: String,
    workspace: String,
    agent: String,
    run: Option<u64>,
}
enum Authority {
    Proposal,
    NativeUser,
}

fn bounded(value: &str, max: usize) -> Result<()> {
    if value.is_empty()
        || value.len() > max
        || value
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\t'))
    {
        return Err("tool_invalid_text".into());
    }
    Ok(())
}
fn ids(values: &[String]) -> Result<()> {
    if values.len() > 16 || values.iter().collect::<BTreeSet<_>>().len() != values.len() {
        return Err("tool_invalid_assignments".into());
    }
    for value in values {
        bounded(value, 256)?;
    }
    Ok(())
}
fn schema(value: &Value, depth: usize, nodes: &mut usize) -> Result<()> {
    *nodes += 1;
    if depth > 6 || *nodes > 128 {
        return Err("tool_schema_complexity".into());
    }
    let object = value.as_object().ok_or("tool_schema_object_required")?;
    let kind = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or("tool_schema_type_required")?;
    let common = ["type", "description", "enum"];
    let allowed: &[&str] = match kind {
        "object" => &["properties", "required", "additionalProperties"],
        "array" => &["items", "maxItems"],
        "string" => &["maxLength"],
        "number" | "integer" => &["minimum", "maximum"],
        "boolean" | "null" => &[],
        _ => return Err("tool_schema_unsupported_type".into()),
    };
    if object
        .keys()
        .any(|key| !common.contains(&key.as_str()) && !allowed.contains(&key.as_str()))
    {
        return Err("tool_schema_unsupported_keyword".into());
    }
    if let Some(description) = object.get("description") {
        bounded(description.as_str().ok_or("tool_schema_description")?, 512)?;
    }
    if let Some(values) = object.get("enum") {
        let values = values.as_array().ok_or("tool_schema_enum")?;
        if values.is_empty()
            || values.len() > 32
            || values
                .iter()
                .any(|v| v.is_object() || v.is_array() || v.to_string().len() > 512)
        {
            return Err("tool_schema_enum".into());
        }
        for value in values {
            let valid = match kind {
                "string" => value.is_string(),
                "integer" => value.is_i64() || value.is_u64(),
                "number" => value.is_number(),
                "boolean" => value.is_boolean(),
                "null" => value.is_null(),
                _ => false,
            };
            if !valid {
                return Err("tool_schema_enum_type".into());
            }
        }
    }
    match kind {
        "object" => {
            if object.get("additionalProperties") != Some(&Value::Bool(false)) {
                return Err("tool_schema_unbounded_object".into());
            }
            let properties = object
                .get("properties")
                .and_then(Value::as_object)
                .ok_or("tool_schema_properties")?;
            if properties.len() > 32 {
                return Err("tool_schema_properties".into());
            }
            for (key, value) in properties {
                bounded(key, 64)?;
                if ["__proto__", "prototype", "constructor"].contains(&key.as_str()) {
                    return Err("tool_schema_property".into());
                }
                schema(value, depth + 1, nodes)?;
            }
            if let Some(required) = object.get("required") {
                let required = required.as_array().ok_or("tool_schema_required")?;
                let mut unique = BTreeSet::new();
                for key in required {
                    let key = key.as_str().ok_or("tool_schema_required")?;
                    if !properties.contains_key(key) || !unique.insert(key) {
                        return Err("tool_schema_required".into());
                    }
                }
            }
        }
        "array" => {
            if object
                .get("maxItems")
                .and_then(Value::as_u64)
                .is_none_or(|n| n > 64)
            {
                return Err("tool_schema_unbounded_array".into());
            }
            schema(
                object.get("items").ok_or("tool_schema_items")?,
                depth + 1,
                nodes,
            )?;
        }
        "string" => {
            if object
                .get("maxLength")
                .and_then(Value::as_u64)
                .is_none_or(|n| n > 8192)
            {
                return Err("tool_schema_unbounded_string".into());
            }
        }
        "number" | "integer" => {
            for key in ["minimum", "maximum"] {
                if object.get(key).is_some_and(|n| !n.is_number()) {
                    return Err("tool_schema_number".into());
                }
            }
            if let (Some(min), Some(max)) = (
                object.get("minimum").and_then(Value::as_f64),
                object.get("maximum").and_then(Value::as_f64),
            ) {
                if min > max {
                    return Err("tool_schema_number".into());
                }
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate(definition: &Definition) -> Result<()> {
    if serde_json::to_vec(definition)
        .map_err(|e| e.to_string())?
        .len()
        > 32768
    {
        return Err("tool_definition_size".into());
    }
    bounded(&definition.name, 64)?;
    if !definition.name.starts_with("custom_")
        || definition.name.len() <= 7
        || !definition
            .name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
    {
        return Err(
            "tool_reserved_name: use custom_ followed by lowercase letters, digits or underscores"
                .into(),
        );
    }
    bounded(&definition.description, 2048)?;
    bounded(&definition.output_description, 1024)?;
    ids(&definition.agents)?;
    ids(&definition.conversations)?;
    ids(&definition.permissions)?;
    if definition.agents.is_empty()
        || !["agent", "conversation", "workspace", "global"].contains(&definition.scope.as_str())
        || (definition.scope == "conversation") == definition.conversations.is_empty()
    {
        return Err("tool_invalid_scope".into());
    }
    if definition.permissions.iter().any(|p| {
        ![
            "read-files",
            "write-files",
            "create-files",
            "run-commands",
            "network",
        ]
        .contains(&p.as_str())
    }) {
        return Err("tool_invalid_permissions".into());
    }
    if !(100..=120_000).contains(&definition.timeout_ms)
        || !(1024..=262_144).contains(&definition.output_bytes)
    {
        return Err("tool_invalid_limits".into());
    }
    for value in [&definition.input_schema, &definition.output_schema] {
        if serde_json::to_vec(value).map_err(|e| e.to_string())?.len() > 8192 {
            return Err("tool_schema_size".into());
        }
        schema(value, 0, &mut 0)?;
    }
    if definition.input_schema["type"] != "object" {
        return Err("tool_input_object_required".into());
    }
    if let Some(reference) = &definition.credential_ref {
        if reference.len() > 128
            || reference.len() <= "keyring:".len()
            || !reference.starts_with("keyring:")
            || !reference
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_:-.".contains(&b))
        {
            return Err("tool_credential_reference_only".into());
        }
    }
    let required = match &definition.binding {
        Binding::Native { operation } => match operation.as_str() {
            "read_file" | "list_directory" => "read-files",
            "write_file" => "write-files",
            "create_directory" => "create-files",
            _ => return Err("tool_native_operation_unavailable".into()),
        },
        Binding::Http { url, method } => {
            let parsed = reqwest::Url::parse(url).map_err(|_| "tool_invalid_url")?;
            if url.len() > 2048
                || parsed.scheme() != "https"
                || parsed.host_str().is_none()
                || !parsed.username().is_empty()
                || parsed.password().is_some()
                || parsed.query().is_some()
                || parsed.fragment().is_some()
                || !["GET", "POST"].contains(&method.as_str())
            {
                return Err("tool_invalid_url_or_method".into());
            }
            "network"
        }
        Binding::Script {
            executable,
            argv,
            hash,
        } => {
            file_binding(executable, hash)?;
            if argv.len() > 16
                || argv
                    .iter()
                    .any(|v| v.len() > 512 || v.contains(['\n', '\r', '\0']))
            {
                return Err("tool_invalid_argv".into());
            }
            "run-commands"
        }
        Binding::Function {
            module,
            export,
            hash,
        } => {
            file_binding(module, hash)?;
            bounded(export, 64)?;
            "run-commands"
        }
        Binding::Mcp { server, tool } => {
            bounded(server, 128)?;
            bounded(tool, 128)?;
            "network"
        }
        Binding::Wasi { .. } => {
            functions::validate_binding(&definition.binding)?;
            if definition.credential_ref.is_some() || definition.permissions != ["run-commands"] {
                return Err("tool_wasi_capabilities".into());
            }
            if definition.output_bytes > 16 * 1024 {
                return Err("tool_wasi_output_limit".into());
            }
            "run-commands"
        }
    };
    if !definition.permissions.iter().any(|p| p == required) {
        return Err("tool_missing_required_permission".into());
    }
    let text = serde_json::to_string(definition)
        .map_err(|e| e.to_string())?
        .to_lowercase();
    if [
        "bearer ",
        "sk-",
        "-----begin",
        "api_key=",
        "password=",
        "token=",
        "authorization:",
    ]
    .iter()
    .any(|s| text.contains(s))
    {
        return Err("tool_secret_material_rejected".into());
    }
    Ok(())
}
fn file_binding(path: &str, hash: &str) -> Result<()> {
    bounded(path, 1024)?;
    if !Path::new(path).is_absolute()
        || super::super::archive::is_sensitive_archive_path(&path.replace('\\', "/"))
        || hash.len() != 64
        || !hash.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("tool_invalid_file_binding".into());
    }
    Ok(())
}
fn definition_hash(definition: &Definition) -> Result<String> {
    Ok(digest(
        &serde_json::to_vec(definition).map_err(|e| e.to_string())?,
    ))
}
fn latest(entry: &Entry) -> &Version {
    &entry.versions[entry.versions.len() - 1]
}
fn visible(entry: &Entry, access: &Access) -> bool {
    entry.workspace_id == access.workspace
        || (latest(entry).definition.scope == "global" && latest(entry).status == "authorized")
}
fn eligible(entry: &Entry, access: &Access) -> bool {
    let version = latest(entry);
    let d = &version.definition;
    visible(entry, access)
        && version.status == "authorized"
        && version.enabled
        && d.agents.contains(&access.agent)
        && (d.scope != "conversation" || d.conversations.contains(&access.session))
}
fn validate_registry(registry: &Registry) -> Result<()> {
    if registry.schema_version != 1
        || registry.entries.len() > MAX_TOOLS
        || registry.revision > 9_007_199_254_740_990
    {
        return Err("tool_registry_version_or_capacity".into());
    }
    let mut unique = BTreeSet::new();
    for entry in &registry.entries {
        valid_id(&entry.id)?;
        bounded(&entry.workspace_id, 2048)?;
        if !unique.insert(&entry.id)
            || entry.versions.is_empty()
            || entry.versions.len() > MAX_VERSIONS
        {
            return Err("tool_registry_invalid_identity".into());
        }
        for (index, version) in entry.versions.iter().enumerate() {
            bounded(&version.session_id, 256)?;
            bounded(&version.agent_id, 256)?;
            validate(&version.definition)?;
            if version.version != index as u64 + 1
                || version.hash != definition_hash(&version.definition)?
                || !["draft", "proposed", "authorized", "revoked", "removed"]
                    .contains(&version.status.as_str())
                || (version.enabled && version.status != "authorized")
                || !["native-user", "agent-proposal"].contains(&version.source.as_str())
                || (version.source == "agent-proposal" && version.status != "proposed")
                || (version.source == "agent-proposal" && version.run_id.is_none())
                || (index > 0 && entry.versions[index - 1].status == "removed")
                || version.created_at == 0
            {
                return Err("tool_registry_corrupt".into());
            }
        }
    }
    for (index, entry) in registry.entries.iter().enumerate() {
        if latest(entry).status == "removed" {
            continue;
        }
        for other in &registry.entries[..index] {
            if latest(other).status != "removed"
                && latest(entry).definition.name == latest(other).definition.name
                && (entry.workspace_id == other.workspace_id
                    || latest(entry).definition.scope == "global"
                    || latest(other).definition.scope == "global")
            {
                return Err("tool_name_collision".into());
            }
        }
    }
    if serde_json::to_vec(registry)
        .map_err(|e| e.to_string())?
        .len()
        > MAX_STORE
    {
        return Err("tool_registry_capacity".into());
    }
    Ok(())
}
fn apply(
    registry: &Registry,
    access: &Access,
    expected: u64,
    change: Change,
    authority: Authority,
) -> Result<Registry> {
    validate_registry(registry)?;
    if registry.revision != expected {
        return Err("tool_stale_revision: reload and review again".into());
    }
    let proposal = matches!(authority, Authority::Proposal);
    let restrictive = matches!(
        change,
        Change::Disable { .. } | Change::Revoke { .. } | Change::Remove { .. }
    );
    if proposal && !matches!(change, Change::Create { .. }) {
        return Err("tool_native_consent_required".into());
    }
    let mut next = registry.clone();
    let (index, mut version) = match change.clone() {
        Change::Create { definition } => {
            if next.entries.len() >= MAX_TOOLS {
                return Err("tool_registry_capacity".into());
            }
            if proposal
                && (definition.scope != "conversation"
                    || definition.agents != [access.agent.clone()]
                    || definition.conversations != [access.session.clone()])
            {
                return Err("tool_proposal_scope".into());
            }
            let id = format!(
                "tool-{}",
                digest(
                    format!(
                        "{}:{}:{}:{}:{}",
                        access.workspace,
                        access.session,
                        registry.revision,
                        *MEMORY_EPOCH,
                        now()
                    )
                    .as_bytes()
                )
            );
            next.entries.push(Entry {
                id,
                workspace_id: access.workspace.clone(),
                versions: vec![],
            });
            (
                next.entries.len() - 1,
                Version {
                    version: 1,
                    hash: definition_hash(&definition)?,
                    definition,
                    status: if proposal { "proposed" } else { "draft" }.into(),
                    enabled: false,
                    source: if proposal {
                        "agent-proposal"
                    } else {
                        "native-user"
                    }
                    .into(),
                    session_id: access.session.clone(),
                    agent_id: access.agent.clone(),
                    run_id: access.run,
                    created_at: now(),
                    invalidates_previous: false,
                },
            )
        }
        Change::Edit { id, .. }
        | Change::Authorize { id }
        | Change::Enable { id }
        | Change::Disable { id }
        | Change::Revoke { id }
        | Change::Remove { id } => {
            let index = next
                .entries
                .iter()
                .position(|entry| entry.id == id && entry.workspace_id == access.workspace)
                .ok_or("tool_unavailable")?;
            let entry = &next.entries[index];
            let mut version = latest(entry).clone();
            let restrictive = matches!(
                change,
                Change::Disable { .. } | Change::Revoke { .. } | Change::Remove { .. }
            );
            let has_confined_history = entry
                .versions
                .iter()
                .any(|v| matches!(v.definition.binding, Binding::Wasi { .. }));
            if (matches!(change, Change::Disable { .. })
                && !version.enabled
                && (!has_confined_history || version.invalidates_previous))
                || (matches!(change, Change::Revoke { .. }) && version.status == "revoked")
            {
                return Ok(registry.clone());
            }
            if entry.versions.len() >= MAX_VERSIONS
                || (!restrictive && entry.versions.len() >= MAX_VERSIONS - 2)
                || version.status == "removed"
            {
                return Err("tool_version_capacity_or_removed".into());
            }
            version.version += 1;
            version.created_at = now();
            version.source = "native-user".into();
            version.session_id = access.session.clone();
            version.agent_id = access.agent.clone();
            version.run_id = access.run;
            version.invalidates_previous = restrictive;
            (index, version)
        }
    };
    match change {
        Change::Edit { definition, .. } => {
            version.definition = definition;
            version.hash = definition_hash(&version.definition)?;
            version.status = "draft".into();
            version.enabled = false;
        }
        Change::Authorize { .. } => {
            version.status = "authorized".into();
            version.enabled = false;
        }
        Change::Enable { .. } => {
            if version.status != "authorized" {
                return Err("tool_native_consent_required".into());
            }
            if matches!(version.definition.binding, Binding::Wasi { .. })
                && !functions::platform_verified()
            {
                return Err("tool_wasi_platform_unverified".into());
            }
            version.enabled = true;
        }
        Change::Disable { .. } => version.enabled = false,
        Change::Revoke { .. } => {
            version.status = "revoked".into();
            version.enabled = false;
        }
        Change::Remove { .. } => {
            version.status = "removed".into();
            version.enabled = false;
        }
        Change::Create { .. } => {}
    }
    validate(&version.definition)?;
    for (other_index, entry) in next.entries.iter().enumerate() {
        if other_index != index
            && latest(entry).status != "removed"
            && latest(entry).definition.name == version.definition.name
            && (entry.workspace_id == access.workspace
                || latest(entry).definition.scope == "global"
                || version.definition.scope == "global")
        {
            return Err("tool_name_collision".into());
        }
    }
    next.entries[index].versions.push(version);
    next.revision += 1;
    validate_registry(&next)?;
    if !restrictive {
        let size = serde_json::to_vec(&next).map_err(|e| e.to_string())?.len();
        let mut reserved = 0;
        for entry in &next.entries {
            if latest(entry).status != "removed" {
                reserved += 2
                    * (serde_json::to_vec(latest(entry))
                        .map_err(|e| e.to_string())?
                        .len()
                        + 1024);
            }
        }
        if size + reserved > MAX_STORE {
            return Err("tool_registry_capacity: reserved for revocation".into());
        }
    }
    Ok(next)
}
fn path(app: &tauri::AppHandle) -> Result<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("clack-ai-tools.json"))
}
fn load(app: &tauri::AppHandle) -> Result<Registry> {
    let value = app
        .state::<MemoryState>()
        .custom_tools
        .get(&path(app)?, "registry")?;
    let registry = match value {
        Some(value) => {
            serde_json::from_value(value).map_err(|e| format!("tool_registry_corrupt: {e}"))?
        }
        None => Registry::default(),
    };
    validate_registry(&registry)?;
    Ok(registry)
}
fn access(app: &tauri::AppHandle, session_id: &str) -> Result<Access> {
    let mut originals = original_owner(app, session_id)?;
    load_tasks(app, &mut originals)?;
    let profile = &originals.meta["profile"];
    let workspace = project::authorized_workspace(app, &originals)?;
    let run = &originals.meta["run"];
    let active = run["state"] == "running";
    let agent = if active {
        run["agentId"].as_str()
    } else {
        profile["agentId"].as_str()
    }
    .ok_or("tool_agent_required")?;
    Ok(Access {
        session: session_id.into(),
        workspace,
        agent: agent.into(),
        run: if active {
            run["startedAt"].as_u64()
        } else {
            None
        },
    })
}
fn view(registry: &Registry, access: &Access) -> Value {
    registry_view(registry, access, false)
}
fn registry_view(registry: &Registry, access: &Access, eligible_only: bool) -> Value {
    let entries: Vec<_> = registry.entries.iter()
        .filter(|entry| if eligible_only { eligible(entry, access) } else { visible(entry, access) })
        .map(|entry| json!({
            "id": entry.id, "workspaceId": entry.workspace_id, "current": latest(entry),
            "versions": if eligible_only { vec![] } else if entry.workspace_id == access.workspace { entry.versions.clone() } else { vec![latest(entry).clone()] },
            "eligible": eligible(entry, access), "executable": eligible(entry, access) && execution::runtime_supported(entry, access),
            "runtime": if execution::runtime_supported(entry, access) { "Guarded execution; invocation approval required" }
                else if matches!(latest(entry).definition.binding, Binding::Wasi { .. }) { "WASI execution unavailable: platform verification or workspace environment" }
                else if matches!(latest(entry).definition.binding, Binding::Script { .. } | Binding::Function { .. } | Binding::Mcp { .. }) { confinement::unavailable_reason() }
                else { "Execution unavailable: operation, argument contract, credential scope or platform" }
        })).collect();
    json!({"schemaVersion": 1, "revision": registry.revision, "entries": entries, "confinement": confinement::capabilities()})
}
fn assignments(app: &tauri::AppHandle, definition: &Definition, access: &Access) -> Result<()> {
    let agents = app
        .store("terax-ai-agents.json")
        .map_err(|e| e.to_string())?
        .get("customAgents")
        .unwrap_or(json!([]));
    for agent in &definition.agents {
        if ![
            "builtin:coder",
            "builtin:architect",
            "builtin:reviewer",
            "builtin:security",
            "builtin:designer",
        ]
        .contains(&agent.as_str())
            && !agents
                .as_array()
                .is_some_and(|entries| entries.iter().any(|entry| entry["id"] == *agent))
        {
            return Err("tool_unknown_agent".into());
        }
    }
    let sessions = app
        .state::<MemoryState>()
        .sessions
        .get(&session_path(app)?, "sessions")?
        .ok_or("tool_sessions_unavailable")?;
    for session in &definition.conversations {
        if !sessions.as_array().is_some_and(|entries| {
            entries.iter().any(|entry| {
                entry["id"] == *session && entry["profile"]["workspaceId"] == access.workspace
            })
        }) {
            return Err("tool_foreign_conversation".into());
        }
    }
    Ok(())
}
fn publish(app: &tauri::AppHandle, registry: &Registry) -> Result<()> {
    let state = app.state::<MemoryState>();
    let path = path(app)?;
    let value = serde_json::to_value(registry).map_err(|e| e.to_string())?;
    if let Err(error) = state
        .custom_tools
        .set(&path, "registry", Some(value.clone()))
    {
        if state.custom_tools.get(&path, "registry")? != Some(value) {
            return Err(error);
        }
    }
    state
        .tool_registry_revision
        .store(registry.revision, std::sync::atomic::Ordering::Release);
    let _ = app.emit("clack:custom-tools-changed", registry.revision);
    Ok(())
}

#[tauri::command]
pub async fn custom_tools_load(
    app: tauri::AppHandle,
    session_id: String,
    eligible_only: Option<bool>,
) -> Result<Value> {
    blocking(move || {
        let access = access(&app, &session_id)?;
        let registry = load(&app)?;
        let mut view = registry_view(&registry, &access, eligible_only.unwrap_or(false));
        for value in view["entries"]
            .as_array_mut()
            .ok_or("tool_invalid_registry")?
        {
            if let Some(entry) = registry.entries.iter().find(|e| value["id"] == e.id) {
                if matches!(latest(entry).definition.binding, Binding::Wasi { .. })
                    && functions::module_path(&app, &latest(entry).definition).is_err()
                {
                    value["executable"] = json!(false);
                    value["runtime"] = json!(
                        "WASI module missing, corrupt, or unsupported; reimport reviewed code"
                    );
                }
            }
        }
        Ok(view)
    })
    .await
}
#[tauri::command]
pub fn custom_tools_validate(definition: Definition) -> Result<String> {
    validate(&definition)?;
    definition_hash(&definition)
}
#[tauri::command]
pub async fn custom_tools_change(
    app: tauri::AppHandle,
    session_id: String,
    expected_revision: u64,
    change: Change,
) -> Result<Value> {
    blocking(move || {
        let captured = access(&app, &session_id)?;
        let preview = apply(&load(&app)?, &captured, expected_revision, change.clone(), Authority::NativeUser)?;
        let target = match &change {
            Change::Create { .. } => preview.entries.last(),
            Change::Edit { id, .. } | Change::Authorize { id } | Change::Enable { id }
            | Change::Disable { id } | Change::Revoke { id } | Change::Remove { id } => preview.entries.iter().find(|e| e.id == *id),
        }.ok_or("tool_unavailable")?;
        let restrictive = matches!(change, Change::Disable { .. } | Change::Revoke { .. } | Change::Remove { .. });
        let v = latest(target);
        if !restrictive {
            assignments(&app, &v.definition, &captured)?;
            functions::registered_module(&app, &load(&app)?, &captured, &v.definition)?;
        }
        let description = serde_json::to_string_pretty(&json!({
            "action": serde_json::to_value(&change).map_err(|e| e.to_string())?["action"],
            "name": v.definition.name, "workspace": captured.workspace,
            "scope": v.definition.scope, "agents": v.definition.agents,
            "conversations": v.definition.conversations, "permissions": v.definition.permissions,
            "version": v.version, "definitionSha256": v.hash,
            "binding": v.definition.binding,
            "execution": "Registration and invocation approval are separate. Confirm the exact definition reviewed in Custom tools."
        })).map_err(|e| e.to_string())?;
        if !app.dialog().message(description).title("Clack tool definition authorization")
            .buttons(MessageDialogButtons::OkCancel).blocking_show() {
            return Err("tool_native_consent_required".into());
        }
        let state = app.state::<MemoryState>();
        let lock = state.owner("custom-tools")?;
        let _guard = lock.lock().map_err(|e| e.to_string())?;
        if access(&app, &session_id)? != captured { return Err("tool_authorization_changed".into()); }
        let current = load(&app)?;
        if current.revision != expected_revision { return Err("tool_stale_revision: reload and review again".into()); }
        if !restrictive { assignments(&app, &v.definition, &captured)?; }
        publish(&app, &preview)?;
        Ok(view(&preview, &captured))
    })
    .await
}
#[tauri::command]
pub async fn custom_tools_propose(
    app: tauri::AppHandle,
    session_id: String,
    expected_revision: u64,
    definition: Definition,
) -> Result<Value> {
    blocking(move || {
        let captured = access(&app, &session_id)?;
        if captured.run.is_none() { return Err("tool_active_run_required".into()); }
        validate(&definition)?;
        assignments(&app, &definition, &captured)?;
        functions::registered_module(&app, &load(&app)?, &captured, &definition)?;
        let state = app.state::<MemoryState>();
        let lock = state.owner("custom-tools")?;
        let _guard = lock.lock().map_err(|e| e.to_string())?;
        let next = apply(&load(&app)?, &captured, expected_revision, Change::Create { definition }, Authority::Proposal)?;
        if access(&app, &session_id)? != captured { return Err("tool_authorization_changed".into()); }
        publish(&app, &next)?;
        Ok(json!({"revision": next.revision, "id": next.entries.last().map(|e| &e.id), "status": "proposed", "executable": false}))
    })
    .await
}
