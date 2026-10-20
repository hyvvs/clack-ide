use super::*;

fn tags(count: usize, revision: &str) -> Value {
    json!({"models": (0..count).map(|i| json!({"name": format!("model-{i}"),
        "digest": format!("{revision}-{i}"), "size": 1234, "modified_at": "2026-10-20T00:00:00Z"})).collect::<Vec<_>>()})
}
fn settings() -> Value {
    json!({"version":1,"revision":0,"endpoints":[{"id":"endpoint-a","alias":"Server A",
        "baseURL":"http://127.0.0.1:11435/","credentialRef":null,"allowPrivateNetwork":true,
        "transportSecurity":"http-unencrypted","revision":1,"configurationRevision":1,"createdAt":1,"updatedAt":1}],"profiles":[]})
}
fn observed(count: usize, revision: &str) -> Snapshot {
    let mut snapshot = snapshot();
    snapshot.backend = Some(Backend::Ollama);
    snapshot.models = inventory(
        &endpoint(Backend::Ollama),
        Route::OllamaTags,
        None,
        &tags(count, revision),
        100,
    )
    .unwrap();
    snapshot
}

#[test]
fn detected_backend_commit_reuses_the_shared_native_cache_instead_of_reprobing() {
    let mut cache = Cache::default();
    let mut endpoint = endpoint(Backend::Ollama);
    endpoint.backend_hint = None;
    let (generation, _, _) = begin(&mut cache, &endpoint, false, false);
    cache.finish(&endpoint, generation, Ok(observed(2, "a")));
    endpoint.detected_backend = Some(Backend::Ollama);
    assert!(
        cache
            .snapshot(&endpoint, None, true, 101)
            .unwrap()
            .connected
    );
    assert!(matches!(
        cache
            .begin(&endpoint, None, true, false, false, 101)
            .unwrap(),
        Begin::Cached(_)
    ));
}

#[tokio::test]
async fn automatic_ollama_signature_prefers_native_inventory_without_generating() {
    let server = Server::new(vec![
        Reply::json(json!({"version":"0.40.5"})),
        Reply::json(tags(10, "a")),
        Reply::json(json!({"models":[]})),
    ]);
    let mut endpoint = server.endpoint(Backend::Ollama);
    endpoint.backend_hint = None;
    endpoint.detected_backend = Some(Backend::OpenaiCompatible);
    let snapshot = handshake(&Transport::default(), &endpoint, None, None, true)
        .await
        .unwrap();
    assert!(snapshot.connected);
    assert_eq!(snapshot.backend, Some(Backend::Ollama));
    assert_eq!(snapshot.models.len(), 10);
    assert_eq!(snapshot.models[0].digest.as_deref(), Some("a-0"));
    assert_eq!(snapshot.models[0].size, Some(1234));
    assert_eq!(
        snapshot.models[0].modified_at.as_deref(),
        Some("2026-10-20T00:00:00Z")
    );
    let requests = server.requests.lock().unwrap();
    assert_eq!(requests.len(), 3);
    assert!(requests[0].starts_with("GET /proxy/api/version "));
    assert!(requests[1].starts_with("GET /proxy/api/tags "));
    assert!(requests[2].starts_with("GET /proxy/api/ps "));
    assert!(!requests
        .iter()
        .any(|r| r.contains("/chat") || r.contains("/generate")));
}

#[tokio::test]
async fn ambiguous_signatures_remain_compatible_without_port_or_model_name_inference() {
    let server = Server::new(vec![
        Reply::json(json!({"version":"not-ollama"})),
        Reply::json(json!({"models":[]})),
        Reply::json(models()),
        Reply::json(models()),
    ]);
    let mut endpoint = server.endpoint(Backend::Ollama);
    endpoint.backend_hint = None;
    let snapshot = handshake(&Transport::default(), &endpoint, None, None, true)
        .await
        .unwrap();
    assert!(snapshot.connected);
    assert_eq!(snapshot.backend, Some(Backend::OpenaiCompatible));
    assert_eq!(server.requests.lock().unwrap().len(), 4);
}

#[tokio::test]
async fn provider_without_enumeration_retains_manual_identity_without_fabricating_models() {
    let server = Server::new(vec![Reply::status(404)]);
    let mut endpoint = server.endpoint(Backend::Mlx);
    endpoint.backend_hint = None;
    let snapshot = handshake(&Transport::default(), &endpoint, None, None, true)
        .await
        .unwrap();
    assert!(!snapshot.connected);
    assert!(snapshot.models.is_empty());
    assert_eq!(
        snapshot.errors.last().unwrap().error.code,
        ErrorCode::UnsupportedProbeRoute
    );
    let mut state = settings();
    merge_evidence(&mut state, &snapshot).unwrap();
    assert!(state["profiles"].as_array().unwrap().is_empty());
}

#[test]
fn one_connection_publishes_profiles_without_manual_saved_flags_or_credentials() {
    let mut state = settings();
    merge_evidence(&mut state, &observed(10, "a")).unwrap();
    crate::modules::self_hosted_profiles::validate(&state).unwrap();
    assert_eq!(state["endpoints"].as_array().unwrap().len(), 1);
    assert_eq!(state["endpoints"][0]["detectedBackend"], "ollama");
    assert_eq!(
        state["inventories"][0]["models"].as_array().unwrap().len(),
        10
    );
    assert_eq!(state["profiles"].as_array().unwrap().len(), 10);
    for profile in state["profiles"].as_array().unwrap() {
        assert!(profile.get("saved").is_none());
        assert_eq!(
            profile["evidence"][0]["scope"]["modelRevision"],
            profile["modelRevision"]
        );
    }
    assert!(state["inventories"][0]["models"][0]
        .get("evidence")
        .is_none());
    let before = state["profiles"].clone();
    merge_evidence(&mut state, &observed(10, "a")).unwrap();
    assert_eq!(before, state["profiles"]);
    assert_eq!(state["inventories"].as_array().unwrap().len(), 1);
}

#[test]
fn changed_digest_invalidates_evidence_recommendations_and_calibration_but_keeps_labels_pins() {
    let mut state = settings();
    merge_evidence(&mut state, &observed(1, "a")).unwrap();
    state["profiles"][0]["saved"] = json!({"label":"My model"});
    state["profiles"][0]["overrides"] =
        json!({"workingContext":{"mode":"manual","evidence":{"value":32768}}});
    state["profiles"][0]["recommendations"] = json!({"maxOutput":{"value":8192}});
    state["profiles"][0]["calibration"] = json!({"old":true});
    let id = state["profiles"][0]["id"].clone();
    merge_evidence(&mut state, &observed(1, "b")).unwrap();
    let profile = &state["profiles"][0];
    assert_eq!(profile["id"], id);
    assert_eq!(profile["modelRevision"], "b-0");
    assert_eq!(profile["saved"]["label"], "My model");
    assert_eq!(
        profile["overrides"]["workingContext"]["evidence"]["value"],
        32768
    );
    assert_eq!(profile["recommendations"], json!({}));
    assert!(profile.get("calibration").is_none());
    assert!(profile["evidence"]
        .as_array()
        .unwrap()
        .iter()
        .all(|e| e["scope"]["modelRevision"] == "b-0"));
}

#[test]
fn unchanged_digest_retains_scoped_detail_evidence_until_normal_expiry() {
    let mut state = settings();
    let mut first = observed(1, "a");
    first.models[0].add(
        &endpoint(Backend::Ollama),
        100,
        None,
        "thinking",
        json!(true),
        true,
    );
    merge_evidence(&mut state, &first).unwrap();
    merge_evidence(&mut state, &observed(1, "a")).unwrap();
    assert!(state["profiles"][0]["evidence"]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["metric"] == "probe.thinking"));
}

#[test]
fn repeated_inventory_refreshes_keep_exactly_one_existing_requested_context_receipt() {
    let mut state = settings();
    let mut initial = observed(1, "a");
    initial.models[0].add(
        &endpoint(Backend::Ollama),
        100,
        None,
        "requestedContext",
        json!(32768),
        false,
    );
    merge_evidence(&mut state, &initial).unwrap();
    for _ in 0..100 {
        merge_evidence(&mut state, &observed(1, "a")).unwrap();
    }
    let receipts: Vec<_> = state["profiles"][0]["evidence"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["metric"] == "probe.requestedContext")
        .collect();
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0]["value"], 32768);
    crate::modules::self_hosted_profiles::validate(&state).unwrap();
}

#[test]
fn add_remove_offline_and_return_online_update_inventory_without_deleting_history() {
    let mut state = settings();
    merge_evidence(&mut state, &observed(2, "a")).unwrap();
    let old = state["profiles"][1]["id"].clone();
    merge_evidence(&mut state, &observed(3, "a")).unwrap();
    assert_eq!(state["profiles"].as_array().unwrap().len(), 3);
    merge_evidence(&mut state, &observed(1, "a")).unwrap();
    assert_eq!(
        state["inventories"][0]["models"].as_array().unwrap().len(),
        1
    );
    assert_eq!(state["profiles"][1]["id"], old);
    let mut offline = observed(0, "a");
    offline.connected = false;
    offline.errors.push(RouteError {
        route: None,
        error: ProbeError::new(ErrorCode::Unreachable),
    });
    merge_evidence(&mut state, &offline).unwrap();
    assert_eq!(state["inventories"][0]["connected"], false);
    assert_eq!(
        state["inventories"][0]["models"].as_array().unwrap().len(),
        1
    );
    merge_evidence(&mut state, &observed(2, "a")).unwrap();
    assert_eq!(state["inventories"][0]["connected"], true);
    assert_eq!(
        state["inventories"][0]["models"].as_array().unwrap().len(),
        2
    );
    assert_eq!(state["profiles"][1]["id"], old);
}

#[test]
fn persisted_inventory_validation_rejects_conflicting_owners_and_duplicate_models() {
    let mut state = settings();
    merge_evidence(&mut state, &observed(1, "a")).unwrap();
    let valid = state.clone();
    state["inventories"][0]["endpointId"] = json!("other-server");
    assert!(crate::modules::self_hosted_profiles::validate(&state).is_err());
    state = valid.clone();
    state["inventories"][0]["models"] = json!([
        state["inventories"][0]["models"][0],
        state["inventories"][0]["models"][0]
    ]);
    assert!(crate::modules::self_hosted_profiles::validate(&state).is_err());
    crate::modules::self_hosted_profiles::validate(&valid).unwrap();
}

#[tokio::test]
#[ignore = "requires the explicitly authorized existing localhost Ollama tunnel; metadata only"]
async fn live_discovery_to_persisted_picker_contract_without_inference() {
    assert_eq!(std::env::var("CLACK_DISCOVERY_LIVE").as_deref(), Ok("1"));
    let mut endpoint = endpoint(Backend::Ollama);
    endpoint.base_url = "http://127.0.0.1:11435/".into();
    endpoint.backend_hint = None;
    let snapshot = deadline(
        transport::HANDSHAKE_TIMEOUT,
        handshake(&Transport::default(), &endpoint, None, None, true),
    )
    .await
    .unwrap();
    assert!(
        snapshot.connected,
        "metadata discovery failed: {:?}",
        snapshot.errors
    );
    assert_eq!(snapshot.backend, Some(Backend::Ollama));
    let mut state = settings();
    merge_evidence(&mut state, &snapshot).unwrap();
    crate::modules::self_hosted_profiles::validate(&state).unwrap();
    std::fs::create_dir_all("target/discovery-integration").unwrap();
    std::fs::write(
        "target/discovery-integration/live.json",
        serde_json::to_vec_pretty(&json!({
            "snapshot":snapshot, "state":state, "inference":0, "downloads":0
        }))
        .unwrap(),
    )
    .unwrap();
    println!(
        "Ollama metadata-only discovery: {} models; no per-model save",
        snapshot.models.len()
    );
}
