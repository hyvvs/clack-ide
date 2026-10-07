//! Explicit workspace-owned MCP connections in the existing T1 atomic registry.
use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

mod protocol;
#[cfg(test)]
mod tests;

#[cfg(test)]
pub(super) async fn fixture_call(endpoint: &str, arguments: &Value) -> Result<Value> {
    protocol::Client::fixture(endpoint)
        .call("echo", arguments, None)
        .await
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    name: String,
    transport: String,
    endpoint: String,
    scope: String,
    agents: Vec<String>,
    conversations: Vec<String>,
    use_credential: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Configuration {
    revision: u64,
    config: Config,
    credential_ref: Option<String>,
    authorized: bool,
    enabled: bool,
    updated_at: u64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Discovered {
    revision: u64,
    hash: String,
    server: Value,
    tools: Vec<(String, String)>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Connection {
    id: String,
    workspace_id: String,
    versions: Vec<Configuration>,
    discovery: Option<Discovered>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ConnectionChange {
    Create { config: Config },
    Edit { id: String, config: Config },
    Authorize { id: String },
    Enable { id: String },
    Disable { id: String },
    Revoke { id: String },
}

#[derive(Clone)]
struct Live {
    client: protocol::Client,
    discovery: protocol::Discovery,
    credential_hash: Option<String>,
}
pub(crate) struct Runtime {
    stopped: AtomicBool,
    status: Mutex<String>,
    live: Mutex<Option<Arc<Live>>>,
    slot: Arc<tokio::sync::Semaphore>,
}
impl Runtime {
    fn new() -> Self {
        Self {
            stopped: AtomicBool::new(false),
            status: Mutex::new("connecting".into()),
            live: Mutex::new(None),
            slot: Arc::new(tokio::sync::Semaphore::new(1)),
        }
    }
    fn status(&self, value: &str) {
        if let Ok(mut status) = self.status.lock() {
            *status = value.into();
        }
    }
    fn stop(&self, status: &str) {
        self.stopped.store(true, Ordering::Release);
        self.status(status);
        if let Ok(mut live) = self.live.lock() {
            live.take();
        }
    }
    fn check_credential(
        &self,
        expected: &Option<String>,
        actual: Result<Option<String>>,
    ) -> Result<Option<String>> {
        if self.stopped.load(Ordering::Acquire) {
            return Err("mcp-disconnected".into());
        }
        match actual {
            Ok(value) if secret_hash(&value) == *expected => Ok(value),
            _ => {
                self.stop("revoked");
                Err("mcp-credential-changed".into())
            }
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Provenance {
    connection_id: String,
    revision: u64,
    discovery: String,
    tool: String,
    tool_hash: String,
    endpoint: String,
    credential_ref: Option<String>,
}
pub(super) struct Capture {
    pub provenance: Provenance,
    runtime: Arc<Runtime>,
    live: Arc<Live>,
}

fn hash(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())
}
fn current(connection: &Connection) -> &Configuration {
    &connection.versions[connection.versions.len() - 1]
}
fn credential_ref(id: &str, config: &Config) -> Option<String> {
    config.use_credential.then(|| {
        format!(
            "keyring:mcp:{id}:{}",
            &digest(config.endpoint.as_bytes())[..24]
        )
    })
}
fn validate_config(config: &Config) -> Result<()> {
    bounded(&config.name, 128)?;
    bounded(&config.endpoint, 1024)?;
    if config.endpoint.chars().any(char::is_control) {
        return Err("mcp-invalid-endpoint".into());
    }
    ids(&config.agents)?;
    ids(&config.conversations)?;
    if config.agents.is_empty()
        || !matches!(
            config.scope.as_str(),
            "conversation" | "agent" | "workspace"
        )
        || (config.scope == "conversation") == config.conversations.is_empty()
    {
        return Err("mcp-invalid-scope".into());
    }
    match config.transport.as_str() {
        "remote-http" => {
            let url = reqwest::Url::parse(&config.endpoint).map_err(|_| "mcp-invalid-endpoint")?;
            if url.scheme() != "https"
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
            {
                return Err("mcp-invalid-endpoint".into());
            }
        }
        "local-native" if !config.use_credential => {}
        _ => return Err("mcp-unsupported-transport".into()),
    }
    Ok(())
}
pub(super) fn validate_binding(binding: &Binding) -> Result<()> {
    match binding {
        Binding::Mcp {
            server,
            tool,
            revision: Some(revision),
            discovery: Some(discovery),
            tool_hash: Some(tool_hash),
        } if server.starts_with("mcp-")
            && valid_id(server).is_ok()
            && *revision > 0
            && hash(discovery)
            && hash(tool_hash)
            && bounded(tool, 64).is_ok() =>
        {
            Ok(())
        }
        _ => Err("mcp-unregistered-binding".into()),
    }
}
impl Provenance {
    pub(super) fn validate(&self) -> Result<()> {
        validate_binding(&Binding::Mcp {
            server: self.connection_id.clone(),
            tool: self.tool.clone(),
            revision: Some(self.revision),
            discovery: Some(self.discovery.clone()),
            tool_hash: Some(self.tool_hash.clone()),
        })?;
        bounded(&self.endpoint, 1024)?;
        let expected = format!(
            "keyring:mcp:{}:{}",
            self.connection_id,
            &digest(self.endpoint.as_bytes())[..24]
        );
        if self.credential_ref.as_ref().is_some_and(|r| r != &expected) {
            return Err("mcp-credential-scope".into());
        }
        Ok(())
    }
}
pub(super) fn validate_connections(connections: &[Connection]) -> Result<()> {
    let mut seen = BTreeSet::new();
    if connections.len() > 16 {
        return Err("mcp-connection-capacity".into());
    }
    for connection in connections {
        valid_id(&connection.id)?;
        bounded(&connection.workspace_id, 2048)?;
        if !connection.id.starts_with("mcp-")
            || !seen.insert(&connection.id)
            || connection.versions.is_empty()
            || connection.versions.len() > 32
        {
            return Err("mcp-connection-corrupt".into());
        }
        for (i, version) in connection.versions.iter().enumerate() {
            validate_config(&version.config)?;
            if version.revision == 0
                || version.revision > 9_007_199_254_740_990
                || (i > 0 && version.revision != connection.versions[i - 1].revision + 1)
                || version.updated_at == 0
                || version.credential_ref != credential_ref(&connection.id, &version.config)
                || (version.enabled && !version.authorized)
                || (version.config.transport == "local-native"
                    && (version.enabled || version.authorized))
            {
                return Err("mcp-connection-corrupt".into());
            }
        }
        if let Some(discovery) = &connection.discovery {
            if discovery.revision != current(connection).revision
                || !hash(&discovery.hash)
                || discovery.tools.len() > 16
                || discovery
                    .tools
                    .iter()
                    .map(|(n, _)| n)
                    .collect::<BTreeSet<_>>()
                    .len()
                    != discovery.tools.len()
                || discovery
                    .tools
                    .iter()
                    .any(|(n, h)| bounded(n, 64).is_err() || !hash(h))
                || serde_json::to_vec(&discovery.server)
                    .map_err(|_| "mcp-discovery")?
                    .len()
                    > 1024
            {
                return Err("mcp-discovery-corrupt".into());
            }
        }
    }
    Ok(())
}
fn owned<'a>(registry: &'a Registry, access: &Access, id: &str) -> Result<&'a Connection> {
    registry
        .connections
        .iter()
        .find(|c| c.id == id && c.workspace_id == access.workspace)
        .ok_or_else(|| "mcp-unavailable".into())
}
fn allowed(connection: &Connection, access: &Access) -> Result<()> {
    let version = current(connection);
    if connection.workspace_id != access.workspace
        || !version.authorized
        || !version.enabled
        || !version.config.agents.contains(&access.agent)
        || (version.config.scope == "conversation"
            && !version.config.conversations.contains(&access.session))
    {
        return Err("mcp-not-authorized".into());
    }
    if version.config.transport != "remote-http" {
        return Err("mcp-local-native-unavailable".into());
    }
    Ok(())
}
fn apply_connection(
    registry: &Registry,
    access: &Access,
    expected: u64,
    change: ConnectionChange,
) -> Result<Registry> {
    validate_registry(registry)?;
    if registry.revision != expected {
        return Err("tool_stale_revision: reload and review again".into());
    }
    let mut next = registry.clone();
    let index = match &change {
        ConnectionChange::Create { config } => {
            validate_config(config)?;
            let id = format!(
                "mcp-{}",
                digest(
                    format!(
                        "{}:{}:{}:{}",
                        access.workspace,
                        registry.revision,
                        *MEMORY_EPOCH,
                        now()
                    )
                    .as_bytes()
                )
            );
            next.connections.push(Connection {
                id: id.clone(),
                workspace_id: access.workspace.clone(),
                versions: vec![Configuration {
                    revision: 1,
                    config: config.clone(),
                    credential_ref: credential_ref(&id, config),
                    authorized: false,
                    enabled: false,
                    updated_at: now(),
                }],
                discovery: None,
            });
            next.connections.len() - 1
        }
        ConnectionChange::Edit { id, .. }
        | ConnectionChange::Authorize { id }
        | ConnectionChange::Enable { id }
        | ConnectionChange::Disable { id }
        | ConnectionChange::Revoke { id } => {
            owned(registry, access, id)?;
            let index = next
                .connections
                .iter()
                .position(|c| &c.id == id)
                .ok_or("mcp-unavailable")?;
            let connection = &mut next.connections[index];
            let mut version = current(connection).clone();
            version.revision += 1;
            version.updated_at = now();
            match &change {
                ConnectionChange::Edit { config, .. } => {
                    validate_config(config)?;
                    version.config = config.clone();
                    version.credential_ref = credential_ref(id, config);
                    version.authorized = false;
                    version.enabled = false;
                }
                ConnectionChange::Authorize { .. } => {
                    version.authorized = true;
                    version.enabled = false;
                }
                ConnectionChange::Enable { .. } if version.authorized => {
                    version.enabled = true;
                }
                ConnectionChange::Disable { .. } => {
                    version.enabled = false;
                }
                ConnectionChange::Revoke { .. } => {
                    version.authorized = false;
                    version.enabled = false;
                }
                _ => return Err("mcp-not-authorized".into()),
            }
            if version.config.transport == "local-native" && (version.authorized || version.enabled)
            {
                return Err("mcp-local-native-unavailable".into());
            }
            connection.versions.push(version);
            if connection.versions.len() > 32 {
                connection.versions.remove(0);
            }
            connection.discovery = None;
            index
        }
    };
    let _ = index;
    next.revision += 1;
    validate_registry(&next)?;
    Ok(next)
}

fn assignment_definition(config: &Config) -> Definition {
    Definition {
        name: "custom_mcp_assignment".into(),
        description: "MCP assignment".into(),
        input_schema: json!({"type":"object","properties":{},"additionalProperties":false}),
        output_schema: json!({"type":"boolean"}),
        output_description: "MCP output".into(),
        binding: Binding::Native {
            operation: "read_file".into(),
        },
        scope: config.scope.clone(),
        agents: config.agents.clone(),
        conversations: config.conversations.clone(),
        permissions: vec!["network".into()],
        credential_ref: None,
        timeout_ms: 30_000,
        output_bytes: 16_384,
    }
}
fn definition(
    connection: &Connection,
    discovery: &protocol::Discovery,
    tool: &protocol::Tool,
) -> Definition {
    let version = current(connection);
    Definition {
        name: format!(
            "custom_mcp_{}",
            &digest(format!("{}:{}", connection.id, tool.name).as_bytes())[..24]
        ),
        description: tool.description.clone(),
        input_schema: tool.input.clone(),
        output_schema: tool.output.clone(),
        binding: Binding::Mcp {
            server: connection.id.clone(),
            tool: tool.name.clone(),
            revision: Some(version.revision),
            discovery: Some(discovery.hash.clone()),
            tool_hash: Some(tool.hash.clone()),
        },
        ..assignment_definition(&version.config)
    }
}
fn register(
    registry: &Registry,
    access: &Access,
    connection: &Connection,
    discovery: &protocol::Discovery,
) -> Result<Registry> {
    let mut next = registry.clone();
    for tool in &discovery.tools {
        let definition = definition(connection, discovery, tool);
        validate(&definition)?;
        let entry = next.entries.iter().find(|e| e.workspace_id == access.workspace && matches!(&latest(e).definition.binding, Binding::Mcp { server, tool: name, .. } if server == &connection.id && name == &tool.name));
        let change = if let Some(entry) = entry {
            let old = latest(entry);
            if old.status == "removed" {
                continue;
            }
            // Reconnect does not broaden manually narrowed tool assignments or resurrect revocations.
            if old.definition.binding == definition.binding
                && old.definition.input_schema == definition.input_schema
                && old.definition.output_schema == definition.output_schema
            {
                continue;
            }
            Change::Edit {
                id: entry.id.clone(),
                definition,
            }
        } else {
            Change::Create { definition }
        };
        next = apply(&next, access, next.revision, change, Authority::NativeUser)?;
    }
    let target = next
        .connections
        .iter_mut()
        .find(|c| c.id == connection.id)
        .ok_or("mcp-unavailable")?;
    target.discovery = Some(Discovered {
        revision: current(connection).revision,
        hash: discovery.hash.clone(),
        server: discovery.server.clone(),
        tools: discovery
            .tools
            .iter()
            .map(|t| (t.name.clone(), t.hash.clone()))
            .collect(),
    });
    next.revision += 1;
    validate_registry(&next)?;
    Ok(next)
}
fn secret(app: &tauri::AppHandle, reference: Option<&str>) -> Result<Option<String>> {
    let Some(reference) = reference else {
        return Ok(None);
    };
    let account = reference
        .strip_prefix("keyring:mcp:")
        .ok_or("mcp-credential-scope")?;
    let value = crate::modules::secrets::read_secret(
        app,
        &app.state::<crate::modules::secrets::SecretsState>(),
        "terax-ai",
        &format!("mcp:{account}"),
    )
    .map_err(|_| "mcp-credential-unavailable")?
    .ok_or("mcp-credential-unavailable")?;
    if value.is_empty() || value.len() > 4096 || value.chars().any(char::is_control) {
        return Err("mcp-credential-unavailable".into());
    }
    Ok(Some(value))
}
fn secret_hash(secret: &Option<String>) -> Option<String> {
    secret.as_ref().map(|s| digest(s.as_bytes()))
}
fn runtime(app: &tauri::AppHandle, id: &str) -> Result<Arc<Runtime>> {
    app.state::<MemoryState>()
        .mcp_connections
        .lock()
        .map_err(|_| "mcp-unavailable")?
        .get(id)
        .cloned()
        .ok_or_else(|| "mcp-disconnected".into())
}
fn invalidate(app: &tauri::AppHandle, id: &str, status: &str) {
    if let Ok(runtime) = runtime(app, id) {
        runtime.stop(status);
    }
    let _ = app.emit("clack:custom-tools-changed", json!(null));
}

pub(super) fn capture(
    app: &tauri::AppHandle,
    access: &Access,
    definition: &Definition,
) -> Result<Capture> {
    capture_in(app, &load(app)?, access, definition)
}

pub(super) fn capture_in(
    app: &tauri::AppHandle,
    registry: &Registry,
    access: &Access,
    definition: &Definition,
) -> Result<Capture> {
    validate_binding(&definition.binding)?;
    let Binding::Mcp { server, tool, .. } = &definition.binding else {
        return Err("mcp-unavailable".into());
    };
    let connection = owned(registry, access, server)?;
    allowed(connection, access)?;
    let version = current(connection);
    let runtime = runtime(app, server)?;
    if runtime.stopped.load(Ordering::Acquire) {
        return Err("mcp-disconnected".into());
    }
    let live = runtime
        .live
        .lock()
        .map_err(|_| "mcp-unavailable")?
        .clone()
        .ok_or("mcp-not-ready")?;
    let spec = contract(connection, definition, &live.discovery)?;
    runtime.check_credential(
        &live.credential_hash,
        secret(app, version.credential_ref.as_deref()),
    )?;
    Ok(Capture {
        provenance: Provenance {
            connection_id: server.clone(),
            revision: version.revision,
            discovery: live.discovery.hash.clone(),
            tool: tool.clone(),
            tool_hash: spec.hash.clone(),
            endpoint: version.config.endpoint.clone(),
            credential_ref: version.credential_ref.clone(),
        },
        runtime,
        live,
    })
}

fn contract<'a>(
    connection: &Connection,
    definition: &Definition,
    discovered: &'a protocol::Discovery,
) -> Result<&'a protocol::Tool> {
    let Binding::Mcp {
        server,
        tool,
        revision,
        discovery,
        tool_hash,
    } = &definition.binding
    else {
        return Err("mcp-unavailable".into());
    };
    let version = current(connection);
    if server != &connection.id
        || *revision != Some(version.revision)
        || discovery.as_ref() != Some(&discovered.hash)
        || connection
            .discovery
            .as_ref()
            .is_none_or(|d| d.hash != discovered.hash || d.revision != version.revision)
    {
        return Err("mcp-discovery-changed".into());
    }
    let spec = discovered
        .tools
        .iter()
        .find(|t| &t.name == tool && Some(&t.hash) == tool_hash.as_ref())
        .ok_or("mcp-tool-changed")?;
    if definition.input_schema != spec.input
        || definition.output_schema != spec.output
        || definition.description != spec.description
        || definition.scope == "global"
        || definition
            .agents
            .iter()
            .any(|a| !version.config.agents.contains(a))
        || (version.config.scope == "conversation"
            && (definition.scope != "conversation"
                || definition
                    .conversations
                    .iter()
                    .any(|s| !version.config.conversations.contains(s))))
    {
        return Err("mcp-tool-contract-changed".into());
    }
    Ok(spec)
}
pub(super) fn recheck(app: &tauri::AppHandle, captured: &Capture) -> Result<()> {
    // Every configuration edit disconnects the runtime before publication. Avoid
    // revalidating the whole bounded T1 registry on every D1 cancellation tick.
    let current = runtime(app, &captured.provenance.connection_id)?;
    if !Arc::ptr_eq(&current, &captured.runtime) {
        return Err("tool-revoked".into());
    }
    captured.runtime.check_credential(
        &captured.live.credential_hash,
        secret(app, captured.provenance.credential_ref.as_deref()),
    )?;
    Ok(())
}
pub(super) async fn invoke(
    app: &tauri::AppHandle,
    captured: &Capture,
    arguments: &Value,
    before_send: impl FnOnce() -> Result<()>,
) -> Result<Value> {
    let _slot = captured
        .runtime
        .slot
        .clone()
        .try_acquire_owned()
        .map_err(|_| "mcp-connection-busy")?;
    let secret = captured.runtime.check_credential(
        &captured.live.credential_hash,
        secret(app, captured.provenance.credential_ref.as_deref()),
    )?;
    let discovered = captured
        .live
        .client
        .discover(captured.live.discovery.server.clone(), secret.as_deref())
        .await;
    if discovered.is_err() {
        captured.runtime.stop("failed");
    }
    let discovery = discovered?;
    if discovery.hash != captured.provenance.discovery {
        captured.runtime.stop("discovery-changed");
        return Err("mcp-discovery-changed".into());
    }
    before_send()?;
    let result = captured
        .live
        .client
        .call(&captured.provenance.tool, arguments, secret.as_deref())
        .await;
    if result.is_err() {
        captured.runtime.stop("failed");
    }
    result
}

pub(super) fn interrupted(app: &tauri::AppHandle, captured: &Capture) {
    captured.runtime.stop("disconnected");
    let _ = app.emit("clack:custom-tools-changed", json!(null));
}

async fn connect_guard<T>(
    runtime: &Runtime,
    operation: impl std::future::Future<Output = Result<T>>,
    mut check: impl FnMut() -> Result<()>,
) -> Result<T> {
    tokio::pin!(operation);
    let timeout = tokio::time::sleep(Duration::from_secs(30));
    tokio::pin!(timeout);
    let mut interval = tokio::time::interval(Duration::from_millis(100));
    loop {
        tokio::select! {
            biased;
            _ = interval.tick() => {
                if runtime.stopped.load(Ordering::Acquire) { return Err("mcp-disconnected".into()); }
                check()?;
            }
            _ = &mut timeout => return Err("mcp-discovery-timeout".into()),
            value = &mut operation => return value,
        }
    }
}

fn connection_view(app: &tauri::AppHandle, registry: &Registry, access: &Access) -> Value {
    let connections: Vec<_> = registry.connections.iter().filter(|c| c.workspace_id == access.workspace).map(|c| {
        let version = current(c);
        let credential = secret(app, version.credential_ref.as_deref());
        let mut status = runtime(app, &c.id).ok().and_then(|r| {
            let live = r.live.lock().ok().and_then(|live| live.clone());
            if let Some(live) = live { let _ = r.check_credential(&live.credential_hash, credential.clone()); }
            r.status.lock().ok().map(|s| s.clone())
        }).unwrap_or_else(|| "disconnected".into());
        if credential.is_err() { status = "credential-unavailable".into(); }
        if version.config.transport == "local-native" { status = "local-native-unavailable".into(); }
        json!({"id":c.id,"workspaceId":c.workspace_id,"current":version,"discovery":c.discovery,"status":status,
            "credentialAvailable":credential.is_ok(),"assigned":allowed(c,access).is_ok()})
    }).collect();
    json!({"revision":registry.revision,"connections":connections})
}
fn consent(
    app: &tauri::AppHandle,
    action: &str,
    access: &Access,
    connection: &Connection,
) -> Result<()> {
    let version = current(connection);
    let text = format!("{action}\nWorkspace: {}\nConnection: {}\nTransport: {}\nDestination: {}\nScope: {}\nAgents: {}\nConversations: {}\nCredential reference: {}\n\nRemote MCP is not locally sandboxed. Connecting sends protocol metadata only. Each tool call needs separate exact-argument approval. Server text cannot grant permissions.",
        access.workspace, connection.id, version.config.transport, version.config.endpoint, version.config.scope,
        version.config.agents.join(", "), version.config.conversations.join(", "), version.credential_ref.as_deref().unwrap_or("none"));
    if text.len() > 4096 {
        return Err("approval-review-too-large".into());
    }
    if !app
        .dialog()
        .message(text)
        .title("Clack MCP connection consent")
        .buttons(MessageDialogButtons::OkCancel)
        .blocking_show()
    {
        return Err("mcp-native-consent-required".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn mcp_connections_load(app: tauri::AppHandle, session_id: String) -> Result<Value> {
    blocking(move || {
        let access = access(&app, &session_id)?;
        Ok(connection_view(&app, &load(&app)?, &access))
    })
    .await
}
#[tauri::command]
pub async fn mcp_connection_change(
    app: tauri::AppHandle,
    session_id: String,
    expected_revision: u64,
    change: ConnectionChange,
) -> Result<Value> {
    blocking(move || {
        let captured = access(&app, &session_id)?;
        let preview = apply_connection(&load(&app)?, &captured, expected_revision, change.clone())?;
        let target = match &change {
            ConnectionChange::Create { .. } => preview.connections.last(),
            ConnectionChange::Edit { id, .. }
            | ConnectionChange::Authorize { id }
            | ConnectionChange::Enable { id }
            | ConnectionChange::Disable { id }
            | ConnectionChange::Revoke { id } => preview.connections.iter().find(|c| &c.id == id),
        }
        .ok_or("mcp-unavailable")?;
        let restrictive = matches!(
            change,
            ConnectionChange::Disable { .. } | ConnectionChange::Revoke { .. }
        );
        if !restrictive {
            assignments(
                &app,
                &assignment_definition(&current(target).config),
                &captured,
            )?;
        }
        let action = serde_json::to_value(&change).map_err(|_| "mcp-change")?["action"]
            .as_str()
            .ok_or("mcp-change")?
            .to_string();
        consent(&app, &action, &captured, target)?;
        let state = app.state::<MemoryState>();
        let lock = state.owner("custom-tools")?;
        let _guard = lock.lock().map_err(|_| "mcp-unavailable")?;
        if access(&app, &session_id)? != captured || load(&app)?.revision != expected_revision {
            return Err("tool_stale_revision: reload and review again".into());
        }
        if !restrictive {
            assignments(
                &app,
                &assignment_definition(&current(target).config),
                &captured,
            )?;
        }
        invalidate(
            &app,
            &target.id,
            if matches!(change, ConnectionChange::Revoke { .. }) {
                "revoked"
            } else {
                "disconnected"
            },
        );
        publish(&app, &preview)?;
        Ok(connection_view(&app, &preview, &captured))
    })
    .await
}

#[tauri::command]
pub async fn mcp_connection_connect(
    app: tauri::AppHandle,
    session_id: String,
    id: String,
    expected_revision: u64,
) -> Result<Value> {
    let setup_app = app.clone();
    let (captured, connection, runtime) = blocking(move || {
        let captured = access(&setup_app, &session_id)?;
        let registry = load(&setup_app)?;
        if registry.revision != expected_revision {
            return Err("tool_stale_revision: reload and review again".into());
        }
        let connection = owned(&registry, &captured, &id)?.clone();
        allowed(&connection, &captured)?;
        consent(
            &setup_app,
            "Connect and discover tools",
            &captured,
            &connection,
        )?;
        let state = setup_app.state::<MemoryState>();
        let lock = state.owner("custom-tools")?;
        let _guard = lock.lock().map_err(|_| "mcp-unavailable")?;
        if access(&setup_app, &session_id)? != captured
            || load(&setup_app)?.revision != expected_revision
        {
            return Err("tool_stale_revision: reload and review again".into());
        }
        invalidate(&setup_app, &id, "disconnected");
        let runtime = Arc::new(Runtime::new());
        state
            .mcp_connections
            .lock()
            .map_err(|_| "mcp-unavailable")?
            .insert(id, runtime.clone());
        let _ = setup_app.emit("clack:custom-tools-changed", json!(null));
        Ok((captured, connection, runtime))
    })
    .await?;
    let initial_secret = secret(&app, current(&connection).credential_ref.as_deref());
    let initial_hash = initial_secret.as_ref().ok().and_then(secret_hash);
    let operation = async {
        let version = current(&connection);
        let value = initial_secret?;
        let mut client = protocol::Client::secure(&version.config.endpoint).await?;
        runtime.status("discovery");
        let discovered = client.initialize(value.as_deref()).await;
        let discovery = match discovered {
            Ok(value) => value,
            Err(error) => {
                client.close(value.as_deref()).await;
                return Err(error);
            }
        };
        let state = app.state::<MemoryState>();
        let lock = state.owner("custom-tools")?;
        {
            let _guard = lock.lock().map_err(|_| "mcp-unavailable")?;
            let registry = load(&app)?;
            if runtime.stopped.load(Ordering::Acquire)
                || registry.revision != expected_revision
                || access(&app, &captured.session)? != captured
                || secret_hash(&secret(&app, version.credential_ref.as_deref())?)
                    != secret_hash(&value)
            {
                return Err("mcp-stale-connection".into());
            }
            allowed(owned(&registry, &captured, &connection.id)?, &captured)?;
            let next = register(&registry, &captured, &connection, &discovery)?;
            publish(&app, &next)?;
            *runtime.live.lock().map_err(|_| "mcp-unavailable")? = Some(Arc::new(Live {
                client,
                discovery,
                credential_hash: secret_hash(&value),
            }));
            runtime.status("ready");
            let _ = app.emit("clack:custom-tools-changed", next.revision);
            Ok(connection_view(&app, &next, &captured))
        }
    };
    let result = connect_guard(&runtime, operation, || {
        if access(&app, &captured.session)? != captured {
            return Err("mcp-authorization-changed".into());
        }
        runtime.check_credential(
            &initial_hash,
            secret(&app, current(&connection).credential_ref.as_deref()),
        )?;
        Ok(())
    })
    .await;
    if let Err(error) = &result {
        runtime.stop(match error.as_str() {
            "mcp-auth-failed" => "auth-failed",
            "mcp-incompatible" => "incompatible",
            _ => "failed",
        });
    }
    let _ = app.emit("clack:custom-tools-changed", json!(null));
    result
}

#[tauri::command]
pub async fn mcp_connection_disconnect(
    app: tauri::AppHandle,
    session_id: String,
    id: String,
) -> Result<()> {
    let captured = access(&app, &session_id)?;
    let (live, reference) = {
        let state = app.state::<MemoryState>();
        let lock = state.owner("custom-tools")?;
        let _guard = lock.lock().map_err(|_| "mcp-unavailable")?;
        let registry = load(&app)?;
        let connection = owned(&registry, &captured, &id)?;
        let live = if let Ok(runtime) = runtime(&app, &id) {
            let live = runtime.live.lock().map_err(|_| "mcp-unavailable")?.take();
            runtime.stop("disconnected");
            live
        } else {
            None
        };
        (live, current(connection).credential_ref.clone())
    };
    let _ = app.emit("clack:custom-tools-changed", json!(null));
    if let Some(live) = live {
        if let Ok(value) = secret(&app, reference.as_deref()) {
            if secret_hash(&value) == live.credential_hash {
                live.client.close(value.as_deref()).await;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn mcp_connection_credential(
    app: tauri::AppHandle,
    session_id: String,
    id: String,
    expected_revision: u64,
    password: Option<String>,
) -> Result<()> {
    if password
        .as_ref()
        .is_some_and(|s| s.is_empty() || s.len() > 4096 || s.chars().any(char::is_control))
    {
        return Err("mcp-invalid-credential".into());
    }
    let consent_app = app.clone();
    let account = blocking(move || {
        let captured = access(&consent_app, &session_id)?;
        let registry = load(&consent_app)?;
        let connection = owned(&registry, &captured, &id)?;
        if registry.revision != expected_revision {
            return Err("tool_stale_revision: reload and review again".into());
        }
        let reference = current(connection)
            .credential_ref
            .as_deref()
            .ok_or("mcp-credential-not-configured")?;
        consent(
            &consent_app,
            "Change credential for this destination",
            &captured,
            connection,
        )?;
        let state = consent_app.state::<MemoryState>();
        let lock = state.owner("custom-tools")?;
        let _guard = lock.lock().map_err(|_| "mcp-unavailable")?;
        if access(&consent_app, &session_id)? != captured
            || load(&consent_app)?.revision != expected_revision
        {
            return Err("tool_stale_revision: reload and review again".into());
        }
        invalidate(&consent_app, &id, "revoked");
        Ok(reference
            .strip_prefix("keyring:")
            .ok_or("mcp-credential-scope")?
            .to_string())
    })
    .await?;
    let state = app.state::<crate::modules::secrets::SecretsState>();
    let result = if let Some(password) = password {
        crate::modules::secrets::secrets_set(
            app.clone(),
            state,
            "terax-ai".into(),
            account,
            password,
        )
        .await
    } else {
        crate::modules::secrets::secrets_delete(app.clone(), state, "terax-ai".into(), account)
            .await
    };
    let _ = app.emit("clack:custom-tools-changed", json!(null));
    result.map_err(|_| "mcp-credential-storage-failed".into())
}
