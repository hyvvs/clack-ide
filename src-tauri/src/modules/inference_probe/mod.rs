mod cache;
pub mod context;
pub mod discovery;
mod metadata;
#[cfg(test)]
mod tests;
mod transport;

use crate::modules::{
    secrets,
    self_hosted_profiles::{KEY, WRITE_LOCK},
};
use cache::{Begin, Cache};
use futures_util::future::Abortable;
use metadata::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;
use transport::{deadline, Transport, HANDSHAKE_TIMEOUT};

pub struct ProbeState {
    cache: Mutex<Cache>,
    transport: Transport,
    credentials: Arc<tokio::sync::Semaphore>,
}
impl Default for ProbeState {
    fn default() -> Self {
        Self {
            cache: Mutex::new(Cache::default()),
            transport: Transport::default(),
            credentials: Arc::new(tokio::sync::Semaphore::new(2)),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteError {
    pub route: Option<Route>,
    pub error: ProbeError,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub endpoint_id: String,
    pub configuration_revision: u64,
    pub selected_model_id: Option<String>,
    pub observed_at: u64,
    pub connected: bool,
    pub reachable: bool,
    pub credential_used: bool,
    pub stale: bool,
    pub refreshing: bool,
    pub inventory_ttl_ms: u64,
    pub instance_ttl_ms: u64,
    pub models: Vec<Model>,
    pub errors: Vec<RouteError>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backend: Option<Backend>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeOptions {
    endpoint_id: String,
    selected_model_id: Option<String>,
    #[serde(default)]
    allow_private_network: bool,
    #[serde(default)]
    force: bool,
    #[serde(default)]
    restart: bool,
    #[serde(default)]
    requested_context: Option<u64>,
}
fn annotate_requested_context(
    endpoint: &Endpoint,
    snapshot: &mut Snapshot,
    selected: Option<&str>,
    requested: Option<u64>,
) {
    if snapshot.backend.or(endpoint.backend()) != Some(Backend::Ollama) {
        return;
    }
    if let (Some(model), Some(requested)) = (
        snapshot
            .models
            .iter_mut()
            .find(|m| Some(m.id.as_str()) == selected),
        requested,
    ) {
        model.add(
            endpoint,
            snapshot.observed_at,
            None,
            "requestedContext",
            json!(requested),
            false,
        );
        if let Some(receipt) = model.evidence.last_mut() {
            receipt.source = "measured".into();
            receipt.confidence = "observed".into();
        }
    }
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn internal() -> ProbeError {
    ProbeError::new(ErrorCode::PersistenceFailed)
}

pub(super) fn endpoints(value: &Value) -> Vec<Endpoint> {
    value
        .get("endpoints")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|e| serde_json::from_value(e.clone()).ok())
        .collect()
}
fn configured(value: &Value, id: &str) -> Result<Endpoint, ProbeError> {
    if value["version"] != 1 {
        return Err(ProbeError::new(ErrorCode::InvalidConfiguration));
    }
    endpoints(value)
        .into_iter()
        .find(|e| e.id == id && e.deleted_at.is_none() && e.configuration_revision > 0)
        .ok_or_else(|| ProbeError::new(ErrorCode::InvalidConfiguration))
}

pub(super) fn settings_changed(app: &AppHandle, next: &Value) {
    if let Some(state) = app.try_state::<ProbeState>() {
        if let Ok(mut cache) = state.cache.lock() {
            cache.reconcile(&endpoints(next));
        }
    }
}
pub(super) fn credential_changed(app: &AppHandle, service: &str, account: &str) {
    if !matches!(service, "clack-ai" | "terax-ai")
        || !(account == "openai-compatible-api-key" || account.starts_with("compat-"))
    {
        return;
    }
    // Lock order is always settings -> cache, including probe commits.
    let Ok(_guard) = WRITE_LOCK.lock() else {
        return;
    };
    if let Some(state) = app.try_state::<ProbeState>() {
        if let Ok(mut cache) = state.cache.lock() {
            cache.invalidate_account(account);
        }
    }
    let Ok(store) = app.store("terax-settings.json") else {
        return;
    };
    let Some(previous) = store.get(KEY) else {
        return;
    };
    let mut next = previous.clone();
    let affected: Vec<_> = endpoints(&next)
        .into_iter()
        .filter(|e| e.account().ok().flatten().as_deref() == Some(account))
        .map(|e| e.id)
        .collect();
    if let Some(profiles) = next["profiles"].as_array_mut() {
        for profile in profiles {
            if affected.iter().any(|id| profile["endpointId"] == *id) {
                clear_probe_evidence(profile);
            }
        }
    }
    if next != previous {
        next["revision"] = json!(previous["revision"].as_u64().unwrap_or(0) + 1);
        let _ = save_state(app, &store, previous, next);
    }
}

async fn credential(app: &AppHandle, endpoint: &Endpoint) -> Result<Option<String>, ProbeError> {
    let Some(account) = endpoint.account()? else {
        return Ok(None);
    };
    let permit = app
        .state::<ProbeState>()
        .credentials
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| internal())?;
    let app = app.clone();
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        for service in ["clack-ai", "terax-ai"] {
            let value = secrets::read_secret(&app, &app.state(), service, &account)
                .map_err(|_| ProbeError::new(ErrorCode::AuthenticationFailed))?;
            if let Some(value) = value.filter(|s| !s.is_empty()) {
                if value.len() > 16 * 1024 {
                    return Err(ProbeError::new(ErrorCode::AuthenticationFailed));
                }
                return Ok(Some(value));
            }
        }
        // A configured credential reference cannot silently become anonymous access.
        Err(ProbeError::new(ErrorCode::AuthenticationFailed))
    })
    .await
    .map_err(|_| internal())?
}

async fn handshake(
    transport: &Transport,
    endpoint: &Endpoint,
    selected: Option<&str>,
    secret: Option<&str>,
    private: bool,
) -> Result<Snapshot, ProbeError> {
    let mut result = Snapshot {
        endpoint_id: endpoint.id.clone(),
        configuration_revision: endpoint.configuration_revision,
        selected_model_id: selected.map(str::to_owned),
        observed_at: now(),
        connected: false,
        reachable: false,
        credential_used: secret.is_some(),
        stale: false,
        refreshing: false,
        inventory_ttl_ms: INVENTORY_TTL_MS,
        instance_ttl_ms: INSTANCE_TTL_MS,
        models: vec![],
        errors: vec![],
        backend: endpoint.backend(),
    };
    let mut count = 0;
    let mut detected = endpoint.clone();
    if endpoint.backend_hint.is_none() {
        detected.detected_backend = None;
        // Native version + inventory signatures, never ports, aliases or model names.
        let version = transport
            .request(
                endpoint,
                Route::OllamaVersion,
                None,
                secret,
                private,
                &mut count,
            )
            .await;
        match version {
            Ok(value)
                if value["version"].as_str().is_some_and(|v| {
                    v.len() <= 64
                        && v.split('.').count() >= 2
                        && v.split('.')
                            .take(2)
                            .all(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()))
                }) =>
            {
                detected.backend_hint = Some(Backend::Ollama);
            }
            Err(error)
                if !matches!(
                    error.code,
                    ErrorCode::UnsupportedProbeRoute
                        | ErrorCode::InvalidServerResponse
                        | ErrorCode::MalformedMetadata
                ) =>
            {
                result.reachable = error.reachable;
                result.stale = true;
                result.errors.push(RouteError {
                    route: Some(Route::OllamaVersion),
                    error,
                });
                return Ok(result);
            }
            _ => {}
        }
    }
    let routes: &[Route] = match detected.backend() {
        Some(Backend::Ollama) => &[Route::OllamaTags],
        Some(Backend::Lmstudio) => &[Route::LmV1, Route::LmV0, Route::CompatibleModels],
        None => &[Route::LmV1, Route::LmV0, Route::CompatibleModels],
        _ => &[Route::CompatibleModels],
    };
    for route in routes {
        let response = transport
            .request(endpoint, *route, selected, secret, private, &mut count)
            .await;
        let models = response.and_then(|v| {
            if endpoint.backend_hint.is_none() && matches!(route, Route::LmV1 | Route::LmV0) {
                let key = if *route == Route::LmV1 {
                    "models"
                } else {
                    "data"
                };
                let native = v[key].as_array().is_some_and(|rows| {
                    !rows.is_empty()
                        && rows.iter().all(|m| {
                            matches!(
                                m["type"].as_str(),
                                Some("llm" | "vlm" | "embedding" | "embeddings")
                            )
                        })
                });
                if !native {
                    return Err(ProbeError::metadata());
                }
            }
            inventory(endpoint, *route, selected, &v, result.observed_at)
        });
        match models {
            Ok(models) => {
                if endpoint.backend_hint.is_none() {
                    result.errors.clear();
                }
                result.models = models;
                result.connected = true;
                result.reachable = true;
                result.backend = Some(match route {
                    Route::OllamaTags => Backend::Ollama,
                    Route::LmV1 | Route::LmV0 => Backend::Lmstudio,
                    _ => endpoint.backend_hint.unwrap_or(Backend::OpenaiCompatible),
                });
                break;
            }
            Err(error) => {
                result.reachable |= error.reachable;
                let fallback = error.code == ErrorCode::UnsupportedProbeRoute
                    || (endpoint.backend_hint.is_none()
                        && error.code == ErrorCode::MalformedMetadata);
                result.errors.push(RouteError {
                    route: Some(*route),
                    error,
                });
                if !fallback {
                    break;
                }
            }
        }
    }
    if result.connected && result.backend == Some(Backend::Ollama) {
        for route in [Route::OllamaShow, Route::OllamaPs] {
            if route == Route::OllamaShow
                && !result
                    .models
                    .iter()
                    .any(|m| Some(m.id.as_str()) == selected)
            {
                continue;
            }
            let response = transport
                .request(endpoint, route, selected, secret, private, &mut count)
                .await;
            let parsed = response.and_then(|value| {
                // Optional malformed metadata cannot half-mutate an otherwise valid inventory.
                let mut models = result.models.clone();
                if route == Route::OllamaPs {
                    ollama_ps(endpoint, &mut models, &value, now())?;
                } else if let Some(model) =
                    models.iter_mut().find(|m| Some(m.id.as_str()) == selected)
                {
                    ollama_show(endpoint, model, &value, now())?;
                } else {
                    if models.len() >= MAX_RECORDS {
                        return Err(ProbeError::metadata());
                    }
                    let mut model = Model::new(selected.unwrap_or_default().into());
                    ollama_show(endpoint, &mut model, &value, now())?;
                    models.push(model);
                }
                result.models = models;
                Ok(())
            });
            if let Err(error) = parsed {
                result.errors.push(RouteError {
                    route: Some(route),
                    error,
                });
            }
        }
    }
    result.stale = !result.connected;
    if serde_json::to_vec(&result).map_err(|_| internal())?.len() > MAX_METADATA_BYTES {
        return Err(ProbeError::new(ErrorCode::ResponseTooLarge));
    }
    Ok(result)
}

fn clear_probe_evidence(profile: &mut Value) {
    if let Some(evidence) = profile["evidence"].as_array_mut() {
        evidence.retain(|e| {
            !e["metric"]
                .as_str()
                .is_some_and(|m| m.starts_with("probe."))
        });
    }
}

fn merge_evidence(value: &mut Value, snapshot: &Snapshot) -> Result<(), ProbeError> {
    merge_inventory(value, snapshot)?;
    let profiles = value["profiles"].as_array_mut().ok_or_else(internal)?;
    for profile in profiles
        .iter_mut()
        .filter(|p| p["endpointId"] == snapshot.endpoint_id)
    {
        let model = snapshot
            .models
            .iter()
            .find(|m| p_string(profile, "transportModelId") == m.id);
        let changed_revision = model
            .is_some_and(|m| profile["modelRevision"].as_str() != m.digest.as_deref())
            || (snapshot.connected
                && snapshot.backend.is_some()
                && profile
                    .get("backend")
                    .is_some_and(|b| *b != json!(snapshot.backend)));
        let detailed = snapshot.connected
            && snapshot.selected_model_id.as_deref() == profile["transportModelId"].as_str()
            && model.is_some_and(|m| {
                m.evidence
                    .iter()
                    .any(|e| e.metric == "probe.runtimeContext")
            });
        let capability_metrics = [
            "probe.thinking",
            "probe.thinkingControls",
            "probe.thinkingDefault",
            "probe.trainedForTools",
            "probe.vision",
            "probe.advertisedContext",
        ];
        let changed_capabilities = detailed
            && model.is_some_and(|m| {
                profile["evidence"].as_array().is_some_and(|old| {
                    old.iter().any(|e| {
                        capability_metrics.contains(&e["metric"].as_str().unwrap_or_default())
                    }) && capability_metrics.iter().any(|metric| {
                        old.iter()
                            .find(|e| e["metric"] == *metric)
                            .map(|e| &e["value"])
                            != m.evidence
                                .iter()
                                .find(|e| e.metric == *metric)
                                .map(|e| &e.value)
                    })
                })
            });
        if changed_revision || changed_capabilities {
            profile["evidence"] = json!([]);
            profile["recommendations"] = json!({});
            profile
                .as_object_mut()
                .ok_or_else(internal)?
                .remove("calibration");
            profile
                .as_object_mut()
                .ok_or_else(internal)?
                .remove("contextCalibration");
            profile
                .as_object_mut()
                .ok_or_else(internal)?
                .remove("toolVerification");
            profile
                .as_object_mut()
                .ok_or_else(internal)?
                .remove("agentToolConfigurations");
        }
        if let Some(digest) = model.and_then(|m| m.digest.as_ref()) {
            profile["modelRevision"] = json!(digest);
        } else if model.is_some() {
            profile
                .as_object_mut()
                .ok_or_else(internal)?
                .remove("modelRevision");
        }
        if model.is_some() && snapshot.backend.is_some() {
            profile["backend"] = json!(snapshot.backend);
        }
        let requested = profile["evidence"].as_array().and_then(|items| {
            items
                .iter()
                .find(|e| {
                    e["metric"] == "probe.requestedContext"
                        && e["scope"]["endpointId"] == snapshot.endpoint_id
                        && e["scope"]["transportModelId"] == profile["transportModelId"]
                        && e["scope"]["deploymentId"] == profile["deploymentId"]
                        && e["scope"]["configurationRevision"] == snapshot.configuration_revision
                })
                .cloned()
        });
        if let Some(items) = profile["evidence"].as_array_mut() {
            items.retain(|e| {
                !e["metric"].as_str().is_some_and(|metric| {
                    metric.starts_with("probe.")
                        && (metric == "probe.requestedContext"
                            || (["probe.loadedContext", "probe.runtimeAllocation"]
                                .contains(&metric)
                                && model.is_some_and(|m| {
                                    m.evidence.iter().any(|e| e.metric == "probe.loaded")
                                }))
                            || (detailed && capability_metrics.contains(&metric))
                            || !snapshot.connected
                            || model
                                .is_none_or(|m| m.evidence.iter().any(|new| new.metric == metric)))
                })
            });
        }
        let requested = snapshot
            .models
            .iter()
            .find(|m| p_string(profile, "transportModelId") == m.id)
            .and_then(|model| {
                model.evidence.iter().find(|e| {
                    e.metric == "probe.requestedContext"
                        && e.scope.deployment_id.as_deref() == profile["deploymentId"].as_str()
                })
            })
            .map(|e| json!(e))
            .or(requested);
        if let Some(requested) = requested {
            let existing = profile["evidence"].as_array_mut().ok_or_else(internal)?;
            if existing.len() >= 64 {
                return Err(internal());
            }
            existing.push(requested);
        }
        if let Some(model) = snapshot
            .models
            .iter()
            .find(|m| p_string(profile, "transportModelId") == m.id)
        {
            let deployment = profile["deploymentId"].as_str();
            let evidence: Vec<_> = model
                .evidence
                .iter()
                .filter(|e| {
                    e.scope.deployment_id.as_deref() == deployment
                        && e.metric != "probe.requestedContext"
                })
                .map(|e| json!(e))
                .collect();
            let existing = profile["evidence"].as_array_mut().ok_or_else(internal)?;
            existing.extend(
                evidence
                    .into_iter()
                    .take(64usize.saturating_sub(existing.len())),
            );
            profile["updatedAt"] = json!(snapshot.observed_at);
        }
    }
    for model in snapshot.models.iter().filter(|_| snapshot.connected) {
        let mut deployments = vec![None];
        for e in &model.evidence {
            if e.scope.deployment_id.is_some() && !deployments.contains(&e.scope.deployment_id) {
                deployments.push(e.scope.deployment_id.clone());
            }
        }
        for deployment in deployments {
            let id = json!([snapshot.endpoint_id, model.id, deployment]).to_string();
            if profiles.iter().any(|p| p["id"] == id) {
                continue;
            }
            if profiles.len() >= 2048 {
                return Err(internal());
            }
            let evidence: Vec<_> = model
                .evidence
                .iter()
                .filter(|e| e.scope.deployment_id == deployment)
                .collect();
            let mut profile = json!({"id": id, "endpointId": snapshot.endpoint_id, "transportModelId": model.id, "deploymentId": deployment, "createdAt": snapshot.observed_at, "updatedAt": snapshot.observed_at, "evidence": evidence, "recommendations": {}, "overrides": {}});
            if let Some(digest) = &model.digest {
                profile["modelRevision"] = json!(digest);
            }
            if snapshot.backend.is_some() {
                profile["backend"] = json!(snapshot.backend);
            }
            profiles.push(profile);
        }
    }
    value["revision"] = json!(value["revision"].as_u64().ok_or_else(internal)? + 1);
    Ok(())
}

fn merge_inventory(value: &mut Value, snapshot: &Snapshot) -> Result<(), ProbeError> {
    if snapshot.connected {
        if let Some(endpoint) = value["endpoints"]
            .as_array_mut()
            .and_then(|items| items.iter_mut().find(|e| e["id"] == snapshot.endpoint_id))
        {
            endpoint["detectedBackend"] = json!(snapshot.backend);
        }
    }
    if value.get("inventories").is_none() {
        value["inventories"] = json!([]);
    }
    let inventories = value["inventories"].as_array_mut().ok_or_else(internal)?;
    let previous = inventories.iter().find(|v| {
        v["endpointId"] == snapshot.endpoint_id
            && v["configurationRevision"] == snapshot.configuration_revision
    });
    let models = if snapshot.connected {
        snapshot
            .models
            .iter()
            .map(|model| {
                let mut item = json!(model);
                item.as_object_mut()
                    .expect("serialized model")
                    .remove("evidence");
                item
            })
            .collect::<Vec<_>>()
    } else {
        previous
            .and_then(|v| v["models"].as_array())
            .cloned()
            .unwrap_or_default()
    };
    let backend = snapshot
        .backend
        .map(|b| json!(b))
        .or_else(|| previous.and_then(|v| v.get("backend")).cloned())
        .unwrap_or(Value::Null);
    let inventory = json!({"endpointId": snapshot.endpoint_id,
        "configurationRevision": snapshot.configuration_revision, "observedAt": snapshot.observed_at,
        "connected": snapshot.connected, "backend": backend, "models": models,
        "error": snapshot.errors.last().map(|e| e.error.code)});
    inventories.retain(|v| v["endpointId"] != snapshot.endpoint_id);
    inventories.push(inventory);
    Ok(())
}
fn p_string<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or_default()
}

fn save_state(
    app: &AppHandle,
    store: &tauri_plugin_store::Store<tauri::Wry>,
    previous: Value,
    next: Value,
) -> Result<(), ProbeError> {
    crate::modules::self_hosted_profiles::validate(&next).map_err(|_| internal())?;
    store.set(KEY, next.clone());
    if store.save().is_err() {
        store.set(KEY, previous);
        return Err(internal());
    }
    let _ = app.emit("terax://prefs-changed", json!({"key": KEY, "value": next}));
    Ok(())
}

fn finish(app: &AppHandle, endpoint: &Endpoint, generation: u64, mut outcome: cache::Outcome) {
    let Ok(_guard) = WRITE_LOCK.lock() else {
        return;
    };
    let state = app.state::<ProbeState>();
    let Ok(mut cache) = state.cache.lock() else {
        return;
    };
    if !cache.current(endpoint, generation) {
        return;
    }
    let commit = || -> Result<(), ProbeError> {
        let store = app.store("terax-settings.json").map_err(|_| internal())?;
        let previous = store.get(KEY).ok_or_else(internal)?;
        if configured(&previous, &endpoint.id)? != *endpoint {
            return Err(ProbeError::new(ErrorCode::Cancelled));
        }
        let failed;
        let snapshot = match &outcome {
            Ok(snapshot) => Some(snapshot),
            Err(error)
                if !matches!(
                    error.code,
                    ErrorCode::Cancelled
                        | ErrorCode::Busy
                        | ErrorCode::InvalidConfiguration
                        | ErrorCode::PersistenceFailed
                ) =>
            {
                failed = Snapshot {
                    endpoint_id: endpoint.id.clone(),
                    configuration_revision: endpoint.configuration_revision,
                    selected_model_id: None,
                    observed_at: now(),
                    connected: false,
                    reachable: error.reachable,
                    credential_used: false,
                    stale: true,
                    refreshing: false,
                    inventory_ttl_ms: INVENTORY_TTL_MS,
                    instance_ttl_ms: INSTANCE_TTL_MS,
                    models: vec![],
                    errors: vec![RouteError {
                        route: None,
                        error: error.clone(),
                    }],
                    backend: endpoint.backend(),
                };
                Some(&failed)
            }
            _ => None,
        };
        if let Some(snapshot) = snapshot {
            let mut next = previous.clone();
            merge_evidence(&mut next, snapshot)?;
            save_state(app, &store, previous, next)?;
        }
        Ok(())
    };
    if let Err(error) = commit() {
        outcome = Err(error);
    }
    cache.finish(endpoint, generation, outcome);
}

#[tauri::command]
pub fn self_hosted_probe_cache(
    app: AppHandle,
    options: ProbeOptions,
) -> Result<Option<Snapshot>, ProbeError> {
    let _guard = WRITE_LOCK.lock().map_err(|_| internal())?;
    let store = app.store("terax-settings.json").map_err(|_| internal())?;
    let endpoint = configured(&store.get(KEY).unwrap_or(Value::Null), &options.endpoint_id)?;
    transport::route_url(&endpoint, Route::CompatibleModels)?;
    let state = app.state::<ProbeState>();
    let cache = state.cache.lock().map_err(|_| internal())?;
    Ok(cache.snapshot(
        &endpoint,
        options.selected_model_id.as_deref(),
        options.allow_private_network,
        now(),
    ))
}

#[tauri::command]
pub fn self_hosted_probe_cancel(app: AppHandle, endpoint_id: String) -> Result<(), ProbeError> {
    app.state::<ProbeState>()
        .cache
        .lock()
        .map_err(|_| internal())?
        .cancel(&endpoint_id);
    Ok(())
}

#[tauri::command]
pub async fn self_hosted_probe(
    app: AppHandle,
    options: ProbeOptions,
) -> Result<Snapshot, ProbeError> {
    if let Some(selected) = &options.selected_model_id {
        name(&json!(selected))?;
    }
    let (endpoint, begin, requested_context) = {
        let _guard = WRITE_LOCK.lock().map_err(|_| internal())?;
        let store = app.store("terax-settings.json").map_err(|_| internal())?;
        let value = store.get(KEY).unwrap_or(Value::Null);
        let endpoint = configured(&value, &options.endpoint_id)?;
        let requested_context = options.requested_context.or_else(|| {
            value["profiles"].as_array()?.iter().find(|p| {
                p["endpointId"] == endpoint.id
                    && p["transportModelId"].as_str() == options.selected_model_id.as_deref()
            })?["evidence"]
                .as_array()?
                .iter()
                .find(|e| {
                    e["metric"] == "probe.requestedContext"
                        && e["scope"]["configurationRevision"] == endpoint.configuration_revision
                })?["value"]
                .as_u64()
        });
        if requested_context.is_some_and(|v| v == 0 || v > 2_000_000)
            || (options.requested_context.is_some()
                && (endpoint.backend() != Some(Backend::Ollama)
                    || options.selected_model_id.is_none()))
        {
            return Err(ProbeError::new(ErrorCode::InvalidConfiguration));
        }
        endpoint.account()?;
        transport::route_url(&endpoint, Route::CompatibleModels)?;
        let begin = app
            .state::<ProbeState>()
            .cache
            .lock()
            .map_err(|_| internal())?
            .begin(
                &endpoint,
                options.selected_model_id.clone(),
                options.allow_private_network,
                options.force,
                options.restart,
                now(),
            )?;
        (endpoint, begin, requested_context)
    };
    match begin {
        Begin::Cached(snapshot) => Ok(snapshot),
        Begin::Join(receiver) => cache::receive(receiver).await,
        Begin::Start {
            generation,
            receiver,
            registration,
        } => {
            tauri::async_runtime::spawn(async move {
                let work = deadline(HANDSHAKE_TIMEOUT, async {
                    let secret = credential(&app, &endpoint).await?;
                    let mut snapshot = handshake(
                        &app.state::<ProbeState>().transport,
                        &endpoint,
                        options.selected_model_id.as_deref(),
                        secret.as_deref(),
                        options.allow_private_network,
                    )
                    .await?;
                    annotate_requested_context(
                        &endpoint,
                        &mut snapshot,
                        options.selected_model_id.as_deref(),
                        requested_context,
                    );
                    Ok(snapshot)
                });
                let outcome = Abortable::new(work, registration)
                    .await
                    .unwrap_or_else(|_| Err(ProbeError::new(ErrorCode::Cancelled)));
                finish(&app, &endpoint, generation, outcome);
            });
            cache::receive(receiver).await
        }
    }
}
