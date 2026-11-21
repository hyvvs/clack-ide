//! Consent lives with the conversation; dispatch grants exist only in this process.
use super::*;
use crate::modules::net::inference::Lease;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::watch;

static SEQUENCE: AtomicU64 = AtomicU64::new(1);
const FALLBACK_ROUTING_ENABLED: bool = true;
const CATEGORIES: &[&str] = &[
    "conversation",
    "source files",
    "attachments",
    "memory",
    "artifacts",
    "tool results",
];

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Destination {
    pub model_id: String,
    pub identity: Value,
    pub base_url: String,
    pub configuration_hash: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Policy {
    version: u32,
    revision: u64,
    mode: String,
    agent_id: Option<String>,
    workspace_id: Option<String>,
    primary: Option<Destination>,
    destination: Option<Destination>,
    categories: Vec<String>,
    history: Vec<Value>,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            version: 1,
            revision: 0,
            mode: "never".into(),
            agent_id: None,
            workspace_id: None,
            primary: None,
            destination: None,
            categories: vec![],
            history: vec![],
        }
    }
}

fn policy(meta: &Value) -> Result<Policy> {
    let Some(value) = meta.get("fallback") else {
        return Ok(Policy::default());
    };
    let parsed: Policy = serde_json::from_value(value.clone()).map_err(|_| "fallback_corrupt")?;
    if parsed.version != 1
        || !["never", "ask", "trusted"].contains(&parsed.mode.as_str())
        || parsed.history.len() > 32
        || value.to_string().len() > 64 * 1024
        || (parsed.mode != "never"
            && (parsed.primary.is_none()
                || parsed.destination.is_none()
                || parsed.categories != CATEGORIES))
    {
        return Err("fallback_corrupt".into());
    }
    for destination in [&parsed.primary, &parsed.destination].into_iter().flatten() {
        validate_destination(destination)?;
    }
    Ok(parsed)
}

fn sanitized(mut value: Value) -> Value {
    if let Some(object) = value.as_object_mut() {
        for key in [
            "alias",
            "name",
            "label",
            "displayName",
            "createdAt",
            "updatedAt",
            "revision",
            "saved",
            "evidence",
            "calibration",
        ] {
            object.remove(key);
        }
    }
    value
}

fn configuration(app: &tauri::AppHandle, model: &str, identity: &Value) -> Result<String> {
    let settings = crate::modules::self_hosted_profiles::authoritative_settings_snapshot(app)
        .map_err(|_| "fallback_settings_unavailable")?;
    let mut values = vec![identity.clone()];
    if let Some(profile) = identity["selfHosted"]["profileId"].as_str() {
        let state = settings.get("selfHostedInference")
            .ok_or("fallback_destination_missing")?;
        for (key, id) in [
            ("profiles", profile),
            (
                "endpoints",
                identity["selfHosted"]["endpointId"]
                    .as_str()
                    .ok_or("fallback_identity")?,
            ),
        ] {
            let value = state[key]
                .as_array()
                .and_then(|entries| entries.iter().find(|v| v["id"] == id))
                .filter(|v| v.get("deletedAt").is_none())
                .ok_or("fallback_destination_missing")?;
            values.push(sanitized(value.clone()));
        }
        values.push(state["defaults"].clone());
    } else if let Some(id) = model.strip_prefix("saved-provider:") {
        let models = settings.get("savedProviderModels")
            .ok_or("fallback_destination_missing")?;
        let value = models
            .as_array()
            .and_then(|entries| {
                entries
                    .iter()
                    .find(|v| v["id"] == id && v["enabled"] == true)
            })
            .ok_or("fallback_destination_missing")?;
        values.push(sanitized(value.clone()));
    } else if let Some(id) = identity["customEndpointId"].as_str() {
        let endpoints = settings.get("customEndpoints")
            .ok_or("fallback_destination_missing")?;
        let value = endpoints
            .as_array()
            .and_then(|entries| entries.iter().find(|v| v["id"] == id))
            .ok_or("fallback_destination_missing")?;
        values.push(sanitized(value.clone()));
    } else {
        let prefix = match model {
            "lmstudio-local" => Some("lmstudio"),
            "mlx-local" => Some("mlx"),
            "ollama-local" => Some("ollama"),
            "openai-compatible-custom" => Some("openaiCompatible"),
            "openrouter-custom" => Some("openrouter"),
            _ => None,
        };
        if let Some(prefix) = prefix {
            for suffix in ["BaseURL", "ModelId", "ContextLimit"] {
                values.push(
                    settings.get(&format!("{prefix}{suffix}"))
                        .cloned().unwrap_or(Value::Null),
                );
            }
        }
    }
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&values).map_err(|e| e.to_string())?)
    ))
}

fn validate_destination(destination: &Destination) -> Result<()> {
    let object = destination
        .identity
        .as_object()
        .ok_or("fallback_identity")?;
    if object.keys().any(|key| {
        ![
            "providerId",
            "transportModelId",
            "endpointBaseURL",
            "customEndpointId",
            "selfHosted",
        ]
        .contains(&key.as_str())
    }) || destination.identity["providerId"]
        .as_str()
        .is_none_or(|s| s.is_empty() || s.len() > 64)
        || !destination
            .configuration_hash
            .bytes()
            .all(|b| b.is_ascii_hexdigit())
        || destination.base_url.len() > 4096
    {
        return Err("fallback_identity".into());
    }
    if let Some(hosted) = object.get("selfHosted") {
        let hosted = hosted.as_object().ok_or("fallback_identity")?;
        if hosted.keys().any(|key| {
            ![
                "endpointId",
                "profileId",
                "configurationRevision",
                "allowPrivateNetwork",
                "credentialRef",
                "credentialRequired",
            ]
            .contains(&key.as_str())
        }) {
            return Err("fallback_identity".into());
        }
        if let Some(reference) = hosted.get("credentialRef").filter(|value| !value.is_null()) {
            let reference = reference.as_object().ok_or("fallback_identity")?;
            if reference
                .keys()
                .any(|key| !["kind", "providerId", "endpointId"].contains(&key.as_str()))
            {
                return Err("fallback_secret_or_invalid_reference".into());
            }
        }
    }
    if destination.model_id.is_empty()
        || destination.model_id.len() > 1024
        || destination.identity.to_string().len() > 4096
        || destination.configuration_hash.len() != 64
        || destination.identity["transportModelId"]
            .as_str()
            .is_none_or(|s| s.is_empty() || s.len() > 1024)
    {
        return Err("fallback_identity".into());
    }
    let url = reqwest::Url::parse(&destination.base_url).map_err(|_| "fallback_endpoint")?;
    if !["http", "https"].contains(&url.scheme())
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("fallback_endpoint".into());
    }
    Ok(())
}

fn current(app: &tauri::AppHandle, destination: &Destination) -> Result<()> {
    validate_destination(destination)?;
    if configuration(app, &destination.model_id, &destination.identity)?
        != destination.configuration_hash
    {
        return Err("fallback_destination_changed".into());
    }
    Ok(())
}

#[tauri::command]
pub fn conversation_fallback_describe(
    app: tauri::AppHandle,
    model_id: String,
    identity: Value,
    base_url: String,
) -> Result<Destination> {
    let destination = Destination {
        configuration_hash: configuration(&app, &model_id, &identity)?,
        model_id,
        identity,
        base_url,
    };
    validate_destination(&destination)?;
    Ok(destination)
}

fn save(
    app: &tauri::AppHandle,
    state: &MemoryState,
    mut meta: Value,
    policy: &Policy,
) -> Result<Value> {
    meta["fallback"] = serde_json::to_value(policy).map_err(|e| e.to_string())?;
    if meta["fallback"].to_string().len() > 64 * 1024 {
        return Err("fallback_capacity".into());
    }
    meta["modelRevision"] = json!(meta["modelRevision"]
        .as_u64()
        .unwrap_or(0)
        .checked_add(1)
        .ok_or("fallback_revision_overflow")?);
    meta["updatedAt"] = json!(now());
    let path = session_path(app)?;
    let mut sessions = state
        .sessions
        .get(&path, "sessions")?
        .ok_or("memory_invalid_sessions")?;
    *sessions
        .as_array_mut()
        .ok_or("memory_invalid_sessions")?
        .iter_mut()
        .find(|entry| entry["id"] == meta["id"])
        .ok_or("memory_missing_session")? = meta.clone();
    if let Err(error) = state.sessions.set(&path, "sessions", Some(sessions)) {
        if state
            .sessions
            .get(&path, "sessions")?
            .as_ref()
            .and_then(Value::as_array)
            .and_then(|entries| entries.iter().find(|e| e["id"] == meta["id"]))
            != Some(&meta)
        {
            return Err(error);
        }
    }
    let _ = app.emit("clack:fallback", &meta);
    Ok(meta)
}

fn event(policy: &mut Policy, mut value: Value) {
    value["id"] = json!(format!(
        "{}:{}",
        *MEMORY_EPOCH,
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    policy.history.push(value);
    if policy.history.len() > 32 {
        policy.history.remove(0);
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Update {
    owner: Owner,
    expected_revision: u64,
    mode: String,
    primary: Option<Destination>,
    destination: Option<Destination>,
}

fn update_boundary(meta: &Value, expected: u64, mode: &str) -> Result<()> {
    if policy(meta)?.revision != expected {
        return Err("fallback_stale_policy".into());
    }
    if !["never", "ask", "trusted"].contains(&mode) {
        return Err("fallback_mode".into());
    }
    if mode != "never" {
        target_context::idle_token(meta)?;
    }
    Ok(())
}

fn revoke(grants: &mut HashMap<String, Grant>, owner: &Owner) {
    grants.retain(|_, grant| {
        if &grant.owner == owner {
            for sender in &grant.cancellations {
                sender.send_replace(true);
            }
            false
        } else {
            true
        }
    });
}

#[tauri::command]
pub async fn conversation_fallback_set(app: tauri::AppHandle, update: Update) -> Result<Value> {
    blocking(move || {
        let state = app.state::<MemoryState>();
        let _metadata = state.metadata.lock().map_err(|e| e.to_string())?;
        let originals = original_owner(&app, &update.owner.session_id)?;
        authorize(&app, &originals, &update.owner)?;
        let mut policy = policy(&originals.meta)?;
        update_boundary(&originals.meta, update.expected_revision, &update.mode)?;
        if update.mode != "never" {
            current(&app, update.primary.as_ref().ok_or("fallback_primary")?)?;
            current(
                &app,
                update.destination.as_ref().ok_or("fallback_destination")?,
            )?;
            if update.primary == update.destination {
                return Err("fallback_same_destination".into());
            }
        }
        policy.revision = policy
            .revision
            .checked_add(1)
            .ok_or("fallback_revision_overflow")?;
        policy.mode = update.mode;
        policy.agent_id = originals.meta["profile"]["agentId"]
            .as_str()
            .map(str::to_owned);
        policy.workspace_id = update.owner.workspace_id.clone();
        if policy.mode != "never" {
            policy.primary = update.primary;
            policy.destination = update.destination;
        }
        policy.categories = CATEGORIES.iter().map(|s| (*s).into()).collect();
        let mode = policy.mode.clone();
        let revision = policy.revision;
        event(
            &mut policy,
            json!({"kind":"policy","mode":mode,"revision":revision,"at":now()}),
        );
        let saved = save(&app, &state, originals.meta, &policy)?;
        let mut grants = state.fallbacks.lock().map_err(|e| e.to_string())?;
        revoke(&mut grants, &update.owner);
        Ok(saved)
    })
    .await
}

pub(super) struct Grant {
    owner: Owner,
    window: String,
    run: u64,
    revision: u64,
    destination: Destination,
    created: u64,
    cancellations: Vec<watch::Sender<bool>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Begin {
    owner: Owner,
    run_id: u64,
    revision: u64,
    primary: Destination,
    destination: Destination,
    approved_once: bool,
    source_hash: String,
}

#[tauri::command]
pub async fn conversation_fallback_boundary(
    app: tauri::AppHandle,
    owner: Owner,
    run_id: u64,
) -> Result<String> {
    blocking(move || {
        let state = app.state::<MemoryState>();
        let _metadata = state.metadata.lock().map_err(|e| e.to_string())?;
        let originals = originals(&app, &owner.session_id)?;
        authorize(&app, &originals, &owner)?;
        if originals.meta["run"]["state"] != "running"
            || originals.meta["run"]["startedAt"] != run_id
            || !safe_boundary(&Value::Array(originals.messages.clone()))
            || custom_tools::execution::has_run_effects(&app, &owner.session_id, run_id)?
        {
            return Err("fallback_unsafe_boundary".into());
        }
        Ok(format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&originals.messages).map_err(|e| e.to_string())?)
        ))
    })
    .await
}

fn safe_boundary(messages: &Value) -> bool {
    let Some(messages) = messages.as_array() else {
        return false;
    };
    let Some(user) = messages.iter().rposition(|m| m["role"] == "user") else {
        return false;
    };
    messages[user + 1..]
        .iter()
        .all(|m| m["parts"].as_array().is_some_and(Vec::is_empty))
}

fn authorized(policy: &Policy, meta: &Value, begin: &Begin) -> Result<()> {
    if !FALLBACK_ROUTING_ENABLED
        || policy.mode == "never"
        || policy.revision != begin.revision
        || policy.primary.as_ref() != Some(&begin.primary)
        || policy.destination.as_ref() != Some(&begin.destination)
        || policy.agent_id.as_deref() != meta["run"]["agentId"].as_str()
        || policy.workspace_id != begin.owner.workspace_id
        || meta["run"]["state"] != "running"
        || meta["run"]["startedAt"] != begin.run_id
        || meta["run"]["modelId"] != begin.primary.model_id
        || meta["run"].get("peerTaskId").is_some()
        || (policy.mode == "ask" && !begin.approved_once)
        || policy
            .history
            .iter()
            .any(|e| e["kind"] == "approved" && e["runId"] == begin.run_id)
    {
        return Err("fallback_unauthorized_boundary".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn conversation_fallback_begin(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    begin: Begin,
) -> Result<Value> {
    blocking(move || {
    let state = app.state::<MemoryState>();
    let _metadata = state.metadata.lock().map_err(|e| e.to_string())?;
    let originals = originals(&app, &begin.owner.session_id)?;
    authorize(&app, &originals, &begin.owner)?;
    let mut policy = policy(&originals.meta)?;
    authorized(&policy, &originals.meta, &begin)?;
    current(&app, &begin.primary)?;
    current(&app, &begin.destination)?;
    if !safe_boundary(&Value::Array(originals.messages.clone()))
        || custom_tools::execution::has_run_effects(&app, &begin.owner.session_id, begin.run_id)?
    {
        return Err("fallback_unsafe_effect_or_output".into());
    }
    let mut grants = state.fallbacks.lock().map_err(|e| e.to_string())?;
    grants.retain(|_, g| now().saturating_sub(g.created) < 3_600_000);
    if grants
        .values()
        .any(|g| g.owner == begin.owner && g.run == begin.run_id)
    {
        return Err("fallback_already_attempted".into());
    }
    if grants.len() >= 128 {
        return Err("fallback_capacity".into());
    }
    let token = format!(
        "{}:{}",
        *MEMORY_EPOCH,
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let source_hash = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&originals.messages).map_err(|e| e.to_string())?)
    );
    if begin.source_hash != source_hash {
        return Err("fallback_stale_source".into());
    }
    event(
        &mut policy,
        json!({"kind":"approved","runId":begin.run_id,"revision":begin.revision,"destination":begin.destination,"sourceHash":source_hash,"at":now()}),
    );
    let saved = save(&app, &state, originals.meta, &policy)?;
    grants.insert(
        token.clone(),
        Grant {
            owner: begin.owner,
            window: window.label().into(),
            run: begin.run_id,
            revision: begin.revision,
            destination: begin.destination,
            created: now(),
            cancellations: vec![],
        },
    );
    Ok(json!({"token":token,"session":saved}))
    }).await
}

fn allowed_request(destination: &Destination, url: &str, body: Option<&[u8]>) -> bool {
    let Ok(base) = reqwest::Url::parse(&destination.base_url) else {
        return false;
    };
    let Ok(url) = reqwest::Url::parse(url) else {
        return false;
    };
    let prefix = base.path().trim_end_matches('/');
    if url.origin() != base.origin()
        || !url.path().starts_with(&format!("{prefix}/"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return false;
    }
    let model = destination.identity["transportModelId"]
        .as_str()
        .unwrap_or("");
    if destination.identity["providerId"] == "google" {
        return url.path() == format!("{prefix}/models/{model}:streamGenerateContent");
    }
    if !["chat/completions", "responses", "messages"]
        .iter()
        .any(|suffix| url.path() == format!("{prefix}/{suffix}"))
    {
        return false;
    }
    body.and_then(|b| serde_json::from_slice::<Value>(b).ok())
        .is_some_and(|v| v["model"] == model)
}

pub(crate) fn dispatch(
    app: &tauri::AppHandle,
    token: &str,
    lease: &Lease,
    url: &str,
    body: Option<&[u8]>,
    sent: bool,
) -> Result<()> {
    if !FALLBACK_ROUTING_ENABLED {
        return Err("fallback_disabled".into());
    }
    let state = app.state::<MemoryState>();
    let _metadata = state.metadata.lock().map_err(|e| e.to_string())?;
    let mut grants = state.fallbacks.lock().map_err(|e| e.to_string())?;
    let grant = grants.get_mut(token).ok_or("fallback_missing_grant")?;
    let originals = original_owner(app, &grant.owner.session_id)?;
    authorize(app, &originals, &grant.owner)?;
    let mut policy = policy(&originals.meta)?;
    if grant.window != lease.owner()
        || now().saturating_sub(grant.created) >= 3_600_000
        || policy.mode == "never"
        || policy.revision != grant.revision
        || policy.destination.as_ref() != Some(&grant.destination)
        || policy.agent_id.as_deref() != originals.meta["run"]["agentId"].as_str()
        || policy.workspace_id != grant.owner.workspace_id
        || originals.meta["run"]["state"] != "running"
        || originals.meta["run"]["startedAt"] != grant.run
        || !allowed_request(&grant.destination, url, body)
    {
        return Err("fallback_revoked_or_changed".into());
    }
    current(app, &grant.destination)?;
    if !sent {
        grant.cancellations.retain(|s| s.receiver_count() > 0);
        if grant.cancellations.len() >= 128 {
            return Err("fallback_capacity".into());
        }
        grant.cancellations.push(lease.cancellation_sender());
    } else {
        let request_hash = format!("{:x}", Sha256::digest(body.unwrap_or_default()));
        event(
            &mut policy,
            json!({"kind":"dispatch-authorized","runId":grant.run,"destination":grant.destination,"requestHash":request_hash,"at":now()}),
        );
        save(app, &state, originals.meta, &policy)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stale_policy_writers_and_running_grants_fail_but_revocation_is_allowed() {
        let meta = json!({"id":"chat","run":{"state":"running"}});
        assert!(update_boundary(&meta, 0, "never").is_ok());
        assert!(update_boundary(&meta, 0, "trusted").is_err());
        assert!(update_boundary(&meta, 1, "never").is_err());
        let next = json!({"id":"chat","run":{"state":"running"},"fallback":Policy::default()});
        assert!(target_context::guard_session_updates(&[meta], &[next]).is_err());
    }
    #[test]
    fn revocation_cancels_queued_leases_and_isolates_other_conversations() {
        let a = Owner {
            session_id: "a".into(),
            workspace_id: Some("workspace".into()),
        };
        let b = Owner {
            session_id: "b".into(),
            workspace_id: Some("workspace".into()),
        };
        let (cancel_a, watch_a) = watch::channel(false);
        let (cancel_b, watch_b) = watch::channel(false);
        let grant = |owner, cancel| Grant {
            owner,
            window: "main".into(),
            run: 10,
            revision: 1,
            destination: destination(),
            created: now(),
            cancellations: vec![cancel],
        };
        let mut grants = HashMap::from([
            ("a".into(), grant(a.clone(), cancel_a)),
            ("b".into(), grant(b, cancel_b)),
        ]);
        revoke(&mut grants, &a);
        assert!(*watch_a.borrow());
        assert!(!*watch_b.borrow());
        assert!(!grants.contains_key("a"));
        assert!(grants.contains_key("b"));
    }
    #[test]
    fn secrets_and_oversized_identity_metadata_cannot_be_persisted() {
        let mut d = destination();
        d.identity["apiKey"] = json!("never-persist-this");
        assert!(validate_destination(&d).is_err());
        d = destination();
        d.base_url = "x".repeat(5000);
        assert!(validate_destination(&d).is_err());
        let mut p = Policy::default();
        for i in 0..100 {
            event(&mut p, json!({"kind":"approved","at":i}));
        }
        assert_eq!(p.history.len(), 32);
        let ids = p
            .history
            .iter()
            .map(|e| e["id"].as_str().unwrap())
            .collect::<BTreeSet<_>>();
        assert_eq!(ids.len(), 32);
    }
    fn destination() -> Destination {
        Destination {
            model_id: "target".into(),
            identity: json!({"providerId":"openai","transportModelId":"model"}),
            base_url: "https://example.com/v1".into(),
            configuration_hash: "a".repeat(64),
        }
    }
    #[test]
    fn exact_origin_path_and_model_block_redirect_and_identity_confusion() {
        let d = destination();
        assert!(allowed_request(
            &d,
            "https://example.com/v1/chat/completions",
            Some(br#"{"model":"model"}"#)
        ));
        for url in [
            "https://evil.com/v1/chat/completions",
            "https://example.com/v10/chat",
            "https://example.com/else",
            "https://user@example.com/v1/chat",
        ] {
            assert!(!allowed_request(&d, url, Some(br#"{"model":"model"}"#)));
        }
        assert!(!allowed_request(
            &d,
            "https://example.com/v1/chat",
            Some(br#"{"model":"other"}"#)
        ));
    }
    #[test]
    fn partial_text_tools_and_unknown_effects_fail_closed() {
        for part in [
            json!({"type":"text","text":"partial"}),
            json!({"type":"tool-write_file","state":"output-available"}),
            json!({"type":"dynamic-tool","state":"input-available"}),
            json!({"type":"reasoning","text":"partial"}),
        ] {
            assert!(!safe_boundary(
                &json!([{"role":"user","parts":[]},{"role":"assistant","parts":[part]}])
            ));
        }
        assert!(safe_boundary(
            &json!([{"role":"assistant","parts":[{"type":"tool-old"}]},{"role":"user","parts":[{"type":"text","text":"new"}]}])
        ));
    }
    #[test]
    fn never_corruption_and_unsupported_versions_fail_closed() {
        assert_eq!(policy(&json!({})).unwrap().mode, "never");
        for value in [
            json!({"version":2}),
            json!({"version":1,"mode":"trusted"}),
            json!(null),
        ] {
            assert!(policy(&json!({"fallback":value})).is_err());
        }
    }
    #[test]
    fn alias_only_changes_do_not_change_configuration() {
        assert_eq!(
            sanitized(json!({"alias":"one","revision":1,"configurationRevision":3,"baseURL":"x"})),
            sanitized(json!({"alias":"two","revision":2,"configurationRevision":3,"baseURL":"x"}))
        );
        assert_ne!(
            sanitized(json!({"configurationRevision":3})),
            sanitized(json!({"configurationRevision":4}))
        );
    }
    #[test]
    fn atomic_restart_preserves_policy_history_without_dispatch_grants() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sessions.json");
        let store = session_file::SessionFile::default();
        let mut p = Policy {
            mode: "trusted".into(),
            primary: Some(destination()),
            destination: Some(destination()),
            categories: CATEGORIES.iter().map(|s| (*s).into()).collect(),
            ..Default::default()
        };
        event(&mut p, json!({"kind":"approved","at":1}));
        store
            .set(&path, "sessions", Some(json!([{"id":"chat","fallback":p}])))
            .unwrap();
        let reloaded = session_file::SessionFile::default()
            .get(&path, "sessions")
            .unwrap()
            .unwrap();
        assert_eq!(policy(&reloaded[0]).unwrap().mode, "trusted");
        p.mode = "never".into();
        store
            .set(&path, "sessions", Some(json!([{"id":"chat","fallback":p}])))
            .unwrap();
        assert_eq!(
            policy(
                &session_file::SessionFile::default()
                    .get(&path, "sessions")
                    .unwrap()
                    .unwrap()[0]
            )
            .unwrap()
            .mode,
            "never"
        );
        assert!(MemoryState::default().fallbacks.lock().unwrap().is_empty());
        assert_eq!(p.history.len(), 1);
    }
    #[test]
    fn scoped_approval_stale_revision_agent_and_loop_guard() {
        let d = destination();
        let mut p = Policy {
            mode: "ask".into(),
            revision: 1,
            primary: Some(d.clone()),
            destination: Some(d.clone()),
            agent_id: Some("agent".into()),
            workspace_id: Some("workspace".into()),
            ..Default::default()
        };
        let meta =
            json!({"run":{"state":"running","startedAt":10,"agentId":"agent","modelId":"target"}});
        let mut b = Begin {
            owner: Owner {
                session_id: "chat".into(),
                workspace_id: Some("workspace".into()),
            },
            run_id: 10,
            revision: 1,
            primary: d.clone(),
            destination: d,
            approved_once: false,
            source_hash: "a".repeat(64),
        };
        assert!(authorized(&p, &meta, &b).is_err());
        b.approved_once = true;
        assert!(authorized(&p, &meta, &b).is_ok());
        b.revision = 0;
        assert!(authorized(&p, &meta, &b).is_err());
        b.revision = 1;
        assert!(authorized(
            &p,
            &json!({"run":{"state":"running","startedAt":10,"agentId":"other","modelId":"target"}}),
            &b
        )
        .is_err());
        event(&mut p, json!({"kind":"approved","runId":10}));
        assert!(authorized(&p, &meta, &b).is_err());
    }
}
