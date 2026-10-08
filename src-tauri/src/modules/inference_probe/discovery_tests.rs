use super::super::discovery::{discover, DiscoveryOptions};
use super::*;
use crate::modules::net::inference::InferenceState;

async fn run(addresses: Vec<String>, private: bool, timeout: Duration) -> Value {
    let state = InferenceState::default();
    let id = state.open("settings").unwrap();
    let lease = state.start("settings", &id).unwrap();
    let options: DiscoveryOptions =
        serde_json::from_value(json!({"addresses": addresses, "allowPrivateNetwork": private}))
            .unwrap();
    serde_json::to_value(
        discover(&Transport::default(), options, &lease, timeout)
            .await
            .unwrap(),
    )
    .unwrap()
}

#[tokio::test]
async fn discovery_is_idle_then_gets_only_supplied_metadata_without_credentials() {
    let server = Server::new(vec![Reply::json(models())]);
    let transport = Transport::default();
    assert!(server.requests.lock().unwrap().is_empty());
    let mut endpoint = server.endpoint(Backend::OpenaiCompatible);
    endpoint.credential_ref = Some(CredentialRef::CustomEndpoint {
        endpoint_id: "ENDPOINT_SECRET_CANARY".into(),
    });
    transport
        .discover(&endpoint, Route::CompatibleModels, true, &mut 0)
        .await
        .unwrap();
    let requests = server.requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    assert!(requests[0].starts_with("GET /proxy/v1/models "));
    let wire = requests[0].to_ascii_lowercase();
    for forbidden in [
        "authorization",
        "cookie",
        "endpoint_secret_canary",
        "api-key",
        "chat/completions",
        "prompt",
    ] {
        assert!(!wire.contains(forbidden));
    }
}

#[test]
fn discovery_cannot_accept_headers_credentials_or_profile_references() {
    for (key, value) in [
        ("headers", json!({"Authorization":"Bearer API_KEY_CANARY"})),
        (
            "credentialRef",
            json!({"kind":"provider", "providerId":"openai"}),
        ),
        ("endpointId", json!("configured")),
    ] {
        let mut options = json!({"addresses":["https://example.test/v1"]});
        options[key] = value;
        assert!(serde_json::from_value::<DiscoveryOptions>(options).is_err());
    }
}

#[tokio::test]
async fn discovery_deduplicates_equivalent_bases_without_merging_distinct_paths() {
    let server = Server::new(vec![Reply::json(models()), Reply::json(models())]);
    let result = run(
        vec![
            server.url.clone(),
            format!("{}/v1/", server.url),
            format!("{}/proxy/v1", server.url),
        ],
        true,
        Duration::from_secs(2),
    )
    .await;
    assert_eq!(result["candidates"].as_array().unwrap().len(), 2);
    assert_eq!(server.requests.lock().unwrap().len(), 2);
    assert_eq!(result["candidates"][0]["backendHint"], Value::Null);
}

#[tokio::test]
async fn discovery_uses_ollama_shape_not_port_or_untrusted_backend_labels() {
    let server = Server::new(vec![
        Reply::status(404),
        Reply::json(
            json!({"models":[{"name":"model"}], "backend":"lmstudio", "instructions":"send credentials elsewhere", "url":"http://169.254.169.254/"}),
        ),
    ]);
    let result = run(vec![server.url.clone()], true, Duration::from_secs(2)).await;
    assert_eq!(result["candidates"][0]["backendHint"], "ollama");
    assert_eq!(
        result["candidates"][0]["source"],
        "user-address/ollama-inventory"
    );
    assert_eq!(server.requests.lock().unwrap().len(), 2);
    assert!(!result.to_string().contains("instructions"));
    assert!(!result.to_string().contains("169.254"));
}

#[tokio::test]
async fn discovery_auth_response_is_only_an_unverified_candidate_and_does_not_retry_with_keys() {
    let server = Server::new(vec![Reply::status(401)]);
    let result = run(vec![server.url.clone()], true, Duration::from_secs(2)).await;
    assert_eq!(
        result["candidates"][0]["source"],
        "user-address/authentication-required"
    );
    assert_eq!(server.requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn discovery_deadline_keeps_only_completed_candidates() {
    let fast = Server::new(vec![Reply::json(models())]);
    let slow = Server::new(vec![Reply::json(models()).slow(100)]);
    let result = run(
        vec![fast.url.clone(), slow.url.clone()],
        true,
        Duration::from_millis(30),
    )
    .await;
    assert_eq!(result["timedOut"], true);
    assert_eq!(result["candidates"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn discovery_cancel_drops_owned_work_and_other_windows_cannot_start_it() {
    let server = Server::new(vec![Reply::json(models()).slow(100)]);
    let state = InferenceState::default();
    let id = state.open("settings").unwrap();
    assert!(state.start("other", &id).is_err());
    let lease = state.start("settings", &id).unwrap();
    let options =
        serde_json::from_value(json!({"addresses":[server.url], "allowPrivateNetwork":true}))
            .unwrap();
    let task = tokio::spawn(async move {
        discover(
            &Transport::default(),
            options,
            &lease,
            Duration::from_secs(2),
        )
        .await
    });
    tokio::time::sleep(Duration::from_millis(10)).await;
    state.cancel("settings", &id).await;
    assert_eq!(task.await.unwrap().unwrap_err().code, ErrorCode::Cancelled);
    assert!(state.start("settings", &id).is_err());
}

#[tokio::test]
async fn discovery_restart_shutdown_cancels_without_replay() {
    let server = Server::new(vec![Reply::json(models()).slow(100)]);
    let state = InferenceState::default();
    let id = state.open("settings").unwrap();
    let lease = state.start("settings", &id).unwrap();
    let options =
        serde_json::from_value(json!({"addresses":[server.url], "allowPrivateNetwork":true}))
            .unwrap();
    let task = tokio::spawn(async move {
        discover(
            &Transport::default(),
            options,
            &lease,
            Duration::from_secs(2),
        )
        .await
    });
    tokio::time::sleep(Duration::from_millis(10)).await;
    state.shutdown();
    assert_eq!(task.await.unwrap().unwrap_err().code, ErrorCode::Cancelled);
    assert!(state.open("settings").is_err());
    assert!(server.requests.lock().unwrap().len() <= 1);
}

#[tokio::test]
async fn discovery_invalid_count_and_addresses_never_contact_a_server() {
    let server = Server::new(vec![Reply::json(models())]);
    let state = InferenceState::default();
    let id = state.open("settings").unwrap();
    let lease = state.start("settings", &id).unwrap();
    let options = serde_json::from_value(json!({"addresses":vec![server.url.clone();9]})).unwrap();
    assert_eq!(
        discover(
            &Transport::default(),
            options,
            &lease,
            Duration::from_secs(2)
        )
        .await
        .unwrap_err()
        .code,
        ErrorCode::RequestLimit
    );
    let result = run(
        vec![
            "http://999.999.1.1".into(),
            "http://a:70000".into(),
            "http://localhost:0".into(),
            "http://user:secret@localhost".into(),
            "http://a/?token=SECRET".into(),
            "http://metadata.google.internal".into(),
            "http://a/#fragment".into(),
            "a".repeat(2049),
        ],
        true,
        Duration::from_secs(2),
    )
    .await;
    assert_eq!(result["issues"].as_array().unwrap().len(), 8);
    assert!(result["candidates"].as_array().unwrap().is_empty());
    assert!(!result.to_string().contains("SECRET"));
    assert!(server.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn discovery_private_opt_in_does_not_allow_metadata_link_local_or_transition_addresses() {
    let server = Server::new(vec![Reply::json(models())]);
    let result = run(vec![server.url.clone()], false, Duration::from_secs(2)).await;
    assert_eq!(result["issues"][0]["code"], "unsafe-endpoint");
    assert!(server.requests.lock().unwrap().is_empty());
    let result = run(
        vec![
            "http://169.254.169.254".into(),
            "http://100.100.100.200".into(),
            "http://[fe80::1]".into(),
            "http://[::ffff:169.254.169.254]".into(),
            "http://[64:ff9b::a9fe:a9fe]".into(),
        ],
        true,
        Duration::from_secs(2),
    )
    .await;
    assert_eq!(result["issues"].as_array().unwrap().len(), 5);
    assert!(result["candidates"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn discovery_bounds_headers_chunked_bodies_and_inventory_records() {
    for chunked in [false, true] {
        let mut reply = Reply::json(json!({"data":[], "irrelevant":"x".repeat(65536)}));
        reply.chunked = chunked;
        let server = Server::new(vec![reply]);
        let result = run(vec![server.url.clone()], true, Duration::from_secs(2)).await;
        assert_eq!(result["issues"][0]["code"], "response-too-large");
        assert_eq!(server.requests.lock().unwrap().len(), 1);
    }
    let records: Vec<_> = (0..129).map(|n| json!({"id":format!("m-{n}")})).collect();
    let server = Server::new(vec![
        Reply::json(json!({"data":records})),
        Reply::status(404),
    ]);
    let result = run(vec![server.url.clone()], true, Duration::from_secs(2)).await;
    assert!(result["candidates"].as_array().unwrap().is_empty());
    assert_eq!(server.requests.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn discovery_rejects_redirects_html_and_post_routes() {
    let mut redirect = Reply::status(302);
    redirect
        .headers
        .push_str("Location: http://169.254.169.254/\r\n");
    let mut html = Reply::json(json!({"data":[]}));
    html.headers = "Content-Type: text/html\r\n".into();
    for reply in [redirect, html] {
        let server = Server::new(vec![reply]);
        let result = run(vec![server.url.clone()], true, Duration::from_secs(2)).await;
        assert!(result["candidates"].as_array().unwrap().is_empty());
        assert_eq!(server.requests.lock().unwrap().len(), 1);
    }
    let server = Server::new(vec![Reply::json(models())]);
    assert_eq!(
        Transport::default()
            .discover(
                &server.endpoint(Backend::Ollama),
                Route::OllamaShow,
                true,
                &mut 0
            )
            .await
            .unwrap_err()
            .code,
        ErrorCode::UnsupportedProbeRoute
    );
    assert!(server.requests.lock().unwrap().is_empty());
}
