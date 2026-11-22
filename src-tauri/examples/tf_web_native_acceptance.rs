//! TF3 headless native acceptance. No browser or renderer and no credential mocks
//! sent to a public endpoint. Fixture-only loopback permission is compiled into
//! tf_web.rs unit tests, NEVER into this example or a Tauri IPC.
//!
//! cargo run --manifest-path src-tauri/Cargo.toml --locked
//!   --example tf_web_native_acceptance
//! Optional external read: TF_WEB_PUBLIC_GET_URL=https://example.org/ ...
use terax_lib::modules::net::tf_web::{
    approve_headless, cancel, execute, prepare, provider_status_for_secret, TfWebOperation,
    TfWebRequest, TfWebState,
};
use terax_lib::modules::workspace::WorkspaceRegistry;

fn req(root: &str, op: TfWebOperation) -> TfWebRequest {
    TfWebRequest {
        operation: op,
        actor: "native-acceptance".into(),
        session_id: "native-acceptance-1".into(),
        workspace_root: root.to_owned(),
        url: None,
        query: None,
        search_result_id: None,
        timeout_ms: None,
        max_bytes: None,
        max_redirects: None,
    }
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempfile::tempdir()?;
    let root = dir.path().to_string_lossy().into_owned();
    let registry = WorkspaceRegistry::default();
    let state = TfWebState::default();
    let mut get = req(&root, TfWebOperation::HttpGet);
    get.url = Some("https://example.org/".into());
    assert!(
        prepare(get.clone(), &registry, &state).is_err(),
        "unregistered workspace denied"
    );
    registry.authorize(dir.path())?;
    let mut secret_url = get.clone();
    secret_url.url = Some("https://example.org/?api_key=hidden".into());
    assert!(prepare(secret_url, &registry, &state).is_err());
    let mut method_scope = get.clone();
    method_scope.query = Some("sneaky-query".into());
    assert!(prepare(method_scope, &registry, &state).is_err());
    let prepared = prepare(get, &registry, &state)?;
    assert_eq!(prepared.operation, TfWebOperation::HttpGet);
    assert!(!prepared.requires_approval);
    assert!(approve_headless(&prepared.token, &state).is_err());
    assert!(cancel(&prepared.token, &state)?);
    assert!(!cancel(&prepared.token, &state)?);
    assert!(execute(&prepared.token, &registry, &state, None)
        .await
        .is_err());

    // A literal local endpoint is valid to normalize but MUST be refused by
    // network public policy, without connecting to any loopback service.
    let mut local = req(&root, TfWebOperation::HttpGet);
    local.url = Some("http://127.0.0.1/".into());
    let token = prepare(local, &registry, &state)?.token;
    let denied = execute(&token, &registry, &state, None).await?;
    assert_eq!(denied.tool_id, "tf.web_operation.v1");
    assert_eq!(denied.reason_code, "dns-private-or-reserved-denied");
    assert_eq!(denied.policy_decision, "denied");
    assert!(!denied.dns_evidence[0].socket_ip_observed);
    assert!(execute(&token, &registry, &state, None).await.is_err());

    let mut metadata = req(&root, TfWebOperation::HttpGet);
    metadata.url = Some("http://169.254.169.254/latest/meta-data".into());
    let token = prepare(metadata, &registry, &state)?.token;
    let denied = execute(&token, &registry, &state, None).await?;
    assert_eq!(denied.reason_code, "dns-private-or-reserved-denied");

    let status = provider_status_for_secret(Ok(None));
    assert_eq!(status.provider, "brave_web");
    assert!(!status.available && !status.configured);
    assert_eq!(status.credential_reference, "credential:brave-web-search");
    let mut search = req(&root, TfWebOperation::WebSearch);
    search.query = Some("clack native test".into());
    let prepared = prepare(search, &registry, &state)?;
    assert!(prepared.requires_approval);
    // Isolated acceptance: verify approval and then no credential means no
    // network request. The production path requires a native OS modal.
    assert!(execute(&prepared.token, &registry, &state, None)
        .await
        .is_err());
    let prepared = prepare(
        {
            let mut r = req(&root, TfWebOperation::WebSearch);
            r.query = Some("clack native test".into());
            r
        },
        &registry,
        &state,
    )?;
    approve_headless(&prepared.token, &state)?;
    let unavailable = execute(&prepared.token, &registry, &state, None).await?;
    assert_eq!(unavailable.reason_code, "provider-unconfigured");
    assert_eq!(
        unavailable.credential_reference,
        Some("credential:brave-web-search")
    );
    assert!(!unavailable.credential_used);
    assert!(unavailable.search_results.is_none());

    if let Ok(url) = std::env::var("TF_WEB_PUBLIC_GET_URL") {
        let mut public = req(&root, TfWebOperation::HttpGet);
        public.url = Some(url);
        let prepared = prepare(public, &registry, &state)?;
        let observed = execute(&prepared.token, &registry, &state, None).await?;
        assert!(observed.dns_evidence.iter().all(|e| !e.socket_ip_observed));
        println!(
            "optional public read: terminal={} reason={} status={:?} retained={} redirects={}",
            observed.terminal,
            observed.reason_code,
            observed.status_code,
            observed.bytes_retained,
            observed.redirect_chain.len()
        );
    } else {
        println!("public network probe SKIPPED (set TF_WEB_PUBLIC_GET_URL explicitly)");
    }
    println!("TF3 native acceptance PASS: scope, reject secrets/local/metadata, single-use, cancel, mock-unconfigured provider and no credential leakage.");
    Ok(())
}
