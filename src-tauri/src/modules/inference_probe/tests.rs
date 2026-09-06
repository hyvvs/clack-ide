use super::*;
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};

fn endpoint(backend: Backend) -> Endpoint {
    Endpoint {
        id: "endpoint-a".into(),
        base_url: "http://127.0.0.1:1/v1".into(),
        backend_hint: Some(backend),
        credential_ref: None,
        configuration_revision: 1,
        deleted_at: None,
    }
}
fn models() -> Value {
    json!({"object":"list", "data":[{"id":"model-a", "object":"model"}]})
}
fn evidence<'a>(model: &'a Model, metric: &str) -> Option<&'a Evidence> {
    model
        .evidence
        .iter()
        .find(|e| e.metric == format!("probe.{metric}"))
}
fn parse(backend: Backend, value: Value) -> Vec<Model> {
    inventory(
        &endpoint(backend),
        Route::CompatibleModels,
        Some("model-a"),
        &value,
        100,
    )
    .unwrap()
}

#[derive(Clone)]
struct Reply {
    status: u16,
    body: Vec<u8>,
    headers: String,
    delay: Duration,
    body_delay: Duration,
    chunked: bool,
}
impl Reply {
    fn json(value: Value) -> Self {
        Self {
            status: 200,
            body: value.to_string().into_bytes(),
            headers: "Content-Type: application/json\r\n".into(),
            delay: Duration::ZERO,
            body_delay: Duration::ZERO,
            chunked: false,
        }
    }
    fn status(status: u16) -> Self {
        Self {
            status,
            ..Self::json(json!({"error":"backend raw body must not escape"}))
        }
    }
    fn slow(mut self, ms: u64) -> Self {
        self.delay = Duration::from_millis(ms);
        self
    }
}
struct Server {
    url: String,
    requests: Arc<Mutex<Vec<String>>>,
    peak: Arc<AtomicUsize>,
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}
impl Server {
    fn new(replies: Vec<Reply>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        listener.set_nonblocking(true).unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let requests = Arc::new(Mutex::new(Vec::new()));
        let peak = Arc::new(AtomicUsize::new(0));
        let (s, r, p) = (stop.clone(), requests.clone(), peak.clone());
        let thread = thread::spawn(move || {
            let mut workers = vec![];
            let replies = Arc::new(replies);
            let active = Arc::new(AtomicUsize::new(0));
            let index = Arc::new(AtomicUsize::new(0));
            while !s.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let (r, p, a, replies, index) = (
                            r.clone(),
                            p.clone(),
                            active.clone(),
                            replies.clone(),
                            index.clone(),
                        );
                        workers.push(thread::spawn(move || {
                            serve(stream, &r, &p, &a, &replies, &index)
                        }));
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(1))
                    }
                    Err(_) => break,
                }
            }
            for worker in workers {
                worker.join().unwrap();
            }
        });
        Self {
            url,
            requests,
            peak,
            stop,
            thread: Some(thread),
        }
    }
    fn endpoint(&self, backend: Backend) -> Endpoint {
        Endpoint {
            base_url: format!("{}/proxy/v1", self.url),
            ..endpoint(backend)
        }
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        self.thread.take().unwrap().join().unwrap();
    }
}
fn serve(
    mut stream: TcpStream,
    requests: &Mutex<Vec<String>>,
    peak: &AtomicUsize,
    active: &AtomicUsize,
    replies: &[Reply],
    index: &AtomicUsize,
) {
    // Accepted sockets can inherit the listener's nonblocking mode on Windows.
    stream.set_nonblocking(false).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    let mut bytes = Vec::new();
    let mut buffer = [0; 2048];
    loop {
        let Ok(n) = stream.read(&mut buffer) else {
            return;
        };
        if n == 0 {
            return;
        }
        bytes.extend_from_slice(&buffer[..n]);
        if bytes.len() > 32768 {
            return;
        }
        if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
            let header = String::from_utf8_lossy(&bytes[..end]);
            let length = header
                .lines()
                .find_map(|l| {
                    l.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .and_then(|n| n.trim().parse::<usize>().ok())
                })
                .unwrap_or(0);
            if bytes.len() >= end + 4 + length {
                break;
            }
        }
    }
    requests
        .lock()
        .unwrap()
        .push(String::from_utf8_lossy(&bytes).into_owned());
    let i = index.fetch_add(1, Ordering::SeqCst);
    let reply = &replies[i.min(replies.len() - 1)];
    let current = active.fetch_add(1, Ordering::SeqCst) + 1;
    peak.fetch_max(current, Ordering::SeqCst);
    thread::sleep(reply.delay);
    let length = if reply.chunked {
        "Transfer-Encoding: chunked".into()
    } else {
        format!("Content-Length: {}", reply.body.len())
    };
    let header = format!(
        "HTTP/1.1 {} Result\r\n{}{length}\r\nConnection: close\r\n\r\n",
        reply.status, reply.headers
    );
    let _ = stream.write_all(header.as_bytes());
    thread::sleep(reply.body_delay);
    if reply.chunked {
        for chunk in reply.body.chunks(65536) {
            if write!(stream, "{:x}\r\n", chunk.len())
                .and_then(|_| stream.write_all(chunk))
                .and_then(|_| stream.write_all(b"\r\n"))
                .is_err()
            {
                break;
            }
        }
        let _ = stream.write_all(b"0\r\n\r\n");
    } else {
        let _ = stream.write_all(&reply.body);
    }
    active.fetch_sub(1, Ordering::SeqCst);
}
async fn probe(server: &Server, backend: Backend) -> Snapshot {
    handshake(
        &Transport::default(),
        &server.endpoint(backend),
        Some("model-a"),
        None,
        true,
    )
    .await
    .unwrap()
}

#[test]
fn ollama_tags_inventory() {
    let list = inventory(
        &endpoint(Backend::Ollama),
        Route::OllamaTags,
        None,
        &json!({"models":[{"name":"model-a","details":{"family":"irrelevant"}}]}),
        10,
    )
    .unwrap();
    assert_eq!(list[0].id, "model-a");
    assert_eq!(list[0].chat, Support::Unknown);
    assert!(evidence(&list[0], "loaded").is_none());
}
#[test]
fn ollama_show_separates_advertised_context_from_runtime_and_parser() {
    let mut model = parse(Backend::Ollama, models()).remove(0);
    ollama_show(&endpoint(Backend::Ollama), &mut model, &json!({"capabilities":["completion","tools","vision"],"model_info":{"general.architecture":"example","example.context_length":131072},"parameters":"num_ctx 999999"}), 10).unwrap();
    assert_eq!(
        evidence(&model, "advertisedContext").unwrap().source,
        "advertised"
    );
    assert_eq!(evidence(&model, "trainedForTools").unwrap().value, true);
    assert!(evidence(&model, "configuredContext").is_none());
    assert_eq!(model.chat, Support::Supported);
}
#[test]
fn ollama_loaded_context_is_ephemeral_without_invented_instance() {
    let mut list = parse(Backend::Ollama, models());
    ollama_ps(
        &endpoint(Backend::Ollama),
        &mut list,
        &json!({"models":[{"name":"model-a","context_length":4096}]}),
        20,
    )
    .unwrap();
    let e = evidence(&list[0], "loadedContext").unwrap();
    assert_eq!(e.value, 4096);
    assert_eq!(e.observed_at, 20);
    assert_eq!(e.scope.deployment_id, None);
    assert_eq!(INSTANCE_TTL_MS, 30_000);
}
#[test]
fn ollama_unloaded_has_no_runtime_context() {
    let mut list = parse(Backend::Ollama, models());
    ollama_ps(
        &endpoint(Backend::Ollama),
        &mut list,
        &json!({"models":[]}),
        20,
    )
    .unwrap();
    assert_eq!(evidence(&list[0], "loaded").unwrap().value, false);
    assert!(evidence(&list[0], "loadedContext").is_none());
}
#[tokio::test]
async fn ollama_optional_route_missing_keeps_inventory_and_never_generates() {
    let server = Server::new(vec![
        Reply::json(json!({"models":[{"name":"model-a"}]})),
        Reply::status(404),
        Reply::status(404),
    ]);
    let result = probe(&server, Backend::Ollama).await;
    assert!(result.connected);
    assert_eq!(result.models.len(), 1);
    assert_eq!(result.errors.len(), 2);
    let requests = server.requests.lock().unwrap();
    assert!(requests[0].starts_with("GET /proxy/api/tags "));
    assert!(requests[1].starts_with("POST /proxy/api/show "));
    assert!(requests[1].ends_with("{\"model\":\"model-a\",\"verbose\":false}"));
    assert!(requests[2].starts_with("GET /proxy/api/ps "));
}
#[test]
fn malformed_ollama_metadata_is_rejected() {
    assert!(inventory(
        &endpoint(Backend::Ollama),
        Route::OllamaTags,
        None,
        &json!({"models":[{}]}),
        10
    )
    .is_err());
    assert!(ollama_show(
        &endpoint(Backend::Ollama),
        &mut parse(Backend::Ollama, models())[0],
        &json!({"message":"hello"}),
        10
    )
    .is_err());
}
fn lm_native() -> Value {
    json!({"models":[{"key":"model-a","display_name":"A model","type":"llm","max_context_length":32768,"capabilities":{"vision":false,"trained_for_tool_use":true},"loaded_instances":[{"id":"instance-1","config":{"context_length":4096,"parallel":2}}]},{"key":"embedding-a","type":"embedding","loaded_instances":[]}]})
}
#[test]
fn lm_native_inventory_and_explicit_embedding_exclusion() {
    let list = inventory(
        &endpoint(Backend::Lmstudio),
        Route::LmV1,
        None,
        &lm_native(),
        100,
    )
    .unwrap();
    assert_eq!(list[0].name.as_deref(), Some("A model"));
    assert_eq!(list[0].chat, Support::Supported);
    assert_eq!(list[1].chat, Support::Unsupported);
    assert_eq!(
        evidence(&list[0], "trainedForTools").unwrap().source,
        "advertised"
    );
}
#[test]
fn lm_native_loaded_context_is_instance_scoped_not_theoretical() {
    let list = inventory(
        &endpoint(Backend::Lmstudio),
        Route::LmV1,
        None,
        &lm_native(),
        100,
    )
    .unwrap();
    let e = evidence(&list[0], "loadedContext").unwrap();
    assert_eq!(e.value, 4096);
    assert_eq!(e.scope.deployment_id.as_deref(), Some("instance-1"));
    assert_eq!(
        evidence(&list[0], "advertisedContext").unwrap().value,
        32768
    );
}
#[tokio::test]
async fn lm_falls_back_only_on_unavailable_routes() {
    let server = Server::new(vec![
        Reply::status(404),
        Reply::status(405),
        Reply::json(models()),
    ]);
    let result = probe(&server, Backend::Lmstudio).await;
    assert!(result.connected);
    assert_eq!(result.errors.len(), 2);
    let requests = server.requests.lock().unwrap();
    for (r, route) in requests.iter().zip([
        "/proxy/api/v1/models",
        "/proxy/api/v0/models",
        "/proxy/v1/models",
    ]) {
        assert!(r.starts_with(&format!("GET {route} ")));
    }
}
#[tokio::test]
async fn lm_auth_failure_does_not_fallback_or_claim_connected() {
    let server = Server::new(vec![Reply::status(401)]);
    let result = probe(&server, Backend::Lmstudio).await;
    assert!(!result.connected);
    assert!(result.reachable);
    assert_eq!(result.errors[0].error.code, ErrorCode::AuthenticationFailed);
    assert_eq!(server.requests.lock().unwrap().len(), 1);
}
#[test]
fn lm_v0_preserves_unknown_loaded_context() {
    let list = inventory(&endpoint(Backend::Lmstudio), Route::LmV0, None, &json!({"data":[{"id":"model-a","type":"vlm","state":"loaded","max_context_length":8192},{"id":"embed","type":"embeddings"}]}), 10).unwrap();
    assert!(evidence(&list[0], "loadedContext").is_none());
    assert_eq!(list[1].chat, Support::Unsupported);
}
#[test]
fn vllm_selected_record_context_only() {
    let list = parse(
        Backend::Vllm,
        json!({"data":[{"id":"model-a","object":"model","max_model_len":8192},{"id":"model-b","object":"model","max_model_len":16384}]}),
    );
    assert_eq!(evidence(&list[0], "configuredContext").unwrap().value, 8192);
    assert!(evidence(&list[1], "configuredContext").is_none());
}
#[test]
fn vllm_lora_missing_context_remains_unknown() {
    assert!(evidence(&parse(Backend::Vllm, models())[0], "configuredContext").is_none());
}
#[test]
fn generic_vllm_looking_fields_do_not_establish_backend() {
    assert!(evidence(
        &parse(
            Backend::OpenaiCompatible,
            json!({"data":[{"id":"model-a","object":"model","max_model_len":8192}]})
        )[0],
        "configuredContext"
    )
    .is_none());
}
#[test]
fn mlx_inventory_retains_creation_but_not_fabricated_capabilities() {
    let list = parse(
        Backend::Mlx,
        json!({"data":[{"id":"model-a","created":123,"max_model_len":65536}]}),
    );
    assert_eq!(evidence(&list[0], "created").unwrap().value, 123);
    assert_eq!(list[0].chat, Support::Unknown);
    assert!(evidence(&list[0], "configuredContext").is_none());
    assert!(evidence(&list[0], "vision").is_none());
    assert!(evidence(&list[0], "loaded").is_none());
}
#[tokio::test]
async fn compatible_valid_authenticated_inventory() {
    let server = Server::new(vec![Reply::json(models())]);
    let result = handshake(
        &Transport::default(),
        &server.endpoint(Backend::OpenaiCompatible),
        None,
        Some("fixture-secret"),
        true,
    )
    .await
    .unwrap();
    assert!(result.connected && result.credential_used);
    assert!(server.requests.lock().unwrap()[0].contains("authorization: Bearer fixture-secret"));
    assert!(!serde_json::to_string(&result)
        .unwrap()
        .contains("fixture-secret"));
}
#[tokio::test]
async fn unavailable_list_preserves_selected_manual_id_without_fabrication() {
    let server = Server::new(vec![Reply::status(404)]);
    let result = probe(&server, Backend::OpenaiCompatible).await;
    assert!(!result.connected);
    assert_eq!(result.selected_model_id.as_deref(), Some("model-a"));
    assert!(result.models.is_empty());
}
#[tokio::test]
async fn html_login_and_binary_are_not_json_metadata() {
    for headers in [
        "Content-Type: text/html\r\n",
        "Content-Type: application/octet-stream\r\n",
    ] {
        let server = Server::new(vec![Reply {
            body: b"<html>login</html>".to_vec(),
            headers: headers.into(),
            ..Reply::status(200)
        }]);
        let result = probe(&server, Backend::OpenaiCompatible).await;
        assert!(!result.connected);
        assert_eq!(
            result.errors[0].error.code,
            ErrorCode::InvalidServerResponse
        );
    }
}
#[test]
fn malformed_json_and_wrong_shapes_rejected() {
    for data in [b"{".as_slice(), b"null", b"[]", b"<html>", b"\0\xFF"] {
        assert!(transport::decode_json(data, None).is_err());
    }
    for value in [
        json!({"data":null}),
        json!({"data":[null]}),
        json!({"data":[{"id":"a"},{"id":"a"}]}),
    ] {
        assert!(inventory(
            &endpoint(Backend::Mlx),
            Route::CompatibleModels,
            None,
            &value,
            10
        )
        .is_err());
    }
}
#[test]
fn huge_record_count_and_id_names_are_bounded() {
    assert!(inventory(
        &endpoint(Backend::Mlx),
        Route::CompatibleModels,
        None,
        &json!({"data":vec![json!({"id":"a"});5001]}),
        10
    )
    .is_err());
    for record in [
        json!({"id":"a".repeat(1025)}),
        json!({"id":"a","name":"b".repeat(1025)}),
        json!({"id":"a\n"}),
        json!({"id":""}),
    ] {
        assert!(inventory(
            &endpoint(Backend::Mlx),
            Route::CompatibleModels,
            None,
            &json!({"data":[record]}),
            10
        )
        .is_err());
    }
    assert!(name(&json!("a".repeat(1024))).is_ok());
    assert!(name(&json!("\u{e9}".repeat(513))).is_err());
}
#[tokio::test]
async fn response_byte_limit_is_enforced() {
    let server = Server::new(vec![Reply {
        body: vec![b' '; transport::MAX_BYTES + 1],
        ..Reply::json(models())
    }]);
    let result = probe(&server, Backend::Mlx).await;
    assert_eq!(result.errors[0].error.code, ErrorCode::ResponseTooLarge);
    assert!(transport::decode_json(&vec![0; transport::MAX_BYTES + 1], None).is_err());
}
#[tokio::test]
async fn compression_is_rejected_instead_of_unbounded_decompression() {
    let server = Server::new(vec![Reply {
        headers: "Content-Type: application/json\r\nContent-Encoding: gzip\r\n".into(),
        ..Reply::json(models())
    }]);
    let result = probe(&server, Backend::Mlx).await;
    assert_eq!(
        result.errors[0].error.code,
        ErrorCode::InvalidServerResponse
    );
    assert!(server.requests.lock().unwrap()[0].contains("accept-encoding: identity"));
}
#[tokio::test]
async fn per_probe_timeout_bounds_body_and_queued_work() {
    let server = Server::new(vec![Reply::json(models()).slow(150)]);
    let mut transport = Transport::default();
    transport.probe_timeout = Duration::from_millis(30);
    let result = handshake(&transport, &server.endpoint(Backend::Mlx), None, None, true)
        .await
        .unwrap();
    assert_eq!(result.errors[0].error.code, ErrorCode::Timeout);
    assert_eq!(transport::PROBE_TIMEOUT, Duration::from_secs(5));
}
#[tokio::test]
async fn overall_deadline_bounds_multiple_probe_fallbacks() {
    let server = Server::new(vec![Reply::status(404).slow(40)]);
    let transport = Transport::default();
    let result = deadline(
        Duration::from_millis(60),
        handshake(
            &transport,
            &server.endpoint(Backend::Lmstudio),
            None,
            None,
            true,
        ),
    )
    .await;
    assert_eq!(result.unwrap_err().code, ErrorCode::Timeout);
    assert_eq!(HANDSHAKE_TIMEOUT, Duration::from_secs(20));
}
#[tokio::test]
async fn probe_concurrency_is_globally_two() {
    let server = Server::new(vec![Reply::json(models()).slow(50)]);
    let transport = Transport::default();
    let e = server.endpoint(Backend::Mlx);
    let (a, b, c) = tokio::join!(
        handshake(&transport, &e, None, None, true),
        handshake(&transport, &e, None, None, true),
        handshake(&transport, &e, None, None, true)
    );
    assert!(a.unwrap().connected && b.unwrap().connected && c.unwrap().connected);
    assert_eq!(server.peak.load(Ordering::SeqCst), 2);
}
#[tokio::test]
async fn seventh_request_rejected_before_network() {
    let server = Server::new(vec![Reply::json(models())]);
    let mut count = 6;
    assert_eq!(
        Transport::default()
            .request(
                &server.endpoint(Backend::Mlx),
                Route::CompatibleModels,
                None,
                None,
                true,
                &mut count
            )
            .await
            .unwrap_err()
            .code,
        ErrorCode::RequestLimit
    );
    assert!(server.requests.lock().unwrap().is_empty());
}
#[tokio::test]
async fn redirects_never_forward_credentials_to_other_origin() {
    let target = Server::new(vec![Reply::json(models())]);
    let server = Server::new(vec![Reply {
        headers: format!("Location: {}/models\r\n", target.url),
        ..Reply::status(302)
    }]);
    let result = handshake(
        &Transport::default(),
        &server.endpoint(Backend::Mlx),
        None,
        Some("fixture-secret"),
        true,
    )
    .await
    .unwrap();
    assert!(!result.connected);
    assert_eq!(result.errors[0].error.status_code, Some(302));
    assert!(target.requests.lock().unwrap().is_empty());
}
#[test]
fn metadata_ips_and_transition_bypasses_always_blocked() {
    for ip in [
        "169.254.169.254",
        "fd00:ec2::254",
        "::ffff:169.254.169.254",
        "fe80::1",
        "64:ff9b::a9fe:a9fe",
        "2002:a9fe:a9fe::1",
        "2001:0::1",
    ] {
        assert!(
            transport::approve_ips(vec![ip.parse().unwrap()], true).is_err(),
            "{ip}"
        );
    }
    assert!(transport::approve_ips(
        vec![
            "1.1.1.1".parse().unwrap(),
            "169.254.169.254".parse().unwrap()
        ],
        true
    )
    .is_err());
}
#[test]
fn private_networks_require_opt_in_without_weakening_public_rules() {
    for ip in [
        "127.0.0.1",
        "::1",
        "::ffff:127.0.0.1",
        "192.168.1.1",
        "100.100.1.1",
    ] {
        assert!(transport::approve_ips(vec![ip.parse().unwrap()], false).is_err());
        assert!(transport::approve_ips(vec![ip.parse().unwrap()], true).is_ok());
    }
    assert!(transport::approve_ips(vec!["1.1.1.1".parse().unwrap()], false).is_ok());
}
#[test]
fn unsafe_urls_and_metadata_names_rejected() {
    for url in [
        "file:///test",
        "ftp://example.com",
        "http://user:pass@host/",
        "http://metadata.google.internal./",
        "http://metadata/",
        "http://host/?key=secret",
        "http://host/#part",
    ] {
        let e = Endpoint {
            base_url: url.into(),
            ..endpoint(Backend::Mlx)
        };
        assert!(
            transport::route_url(&e, Route::CompatibleModels).is_err(),
            "{url}"
        );
    }
}
#[tokio::test]
async fn dns_pinning_uses_approved_address_not_a_second_lookup() {
    let server = Server::new(vec![Reply::json(models())]);
    let url = server
        .url
        .replace("127.0.0.1", "unresolvable-probe-fixture.invalid");
    let ips = transport::approve_ips(vec!["127.0.0.1".parse().unwrap()], true).unwrap();
    let client = transport::pinned_client("unresolvable-probe-fixture.invalid", &ips).unwrap();
    assert_eq!(client.get(url).send().await.unwrap().status(), 200);
    assert_eq!(server.requests.lock().unwrap().len(), 1);
}
#[test]
fn proxy_prefixes_and_compatible_base_paths_remain_intact() {
    for (url, route, expected) in [
        (
            "https://server/ollama/",
            Route::OllamaTags,
            "/ollama/api/tags",
        ),
        (
            "https://server/ollama/v1",
            Route::OllamaPs,
            "/ollama/api/ps",
        ),
        (
            "https://server/a%20b/v1/",
            Route::LmV1,
            "/a%20b/api/v1/models",
        ),
        (
            "https://server/custom/api",
            Route::CompatibleModels,
            "/custom/api/models",
        ),
        ("https://server/", Route::CompatibleModels, "/v1/models"),
    ] {
        assert_eq!(
            transport::route_url(
                &Endpoint {
                    base_url: url.into(),
                    ..endpoint(Backend::Mlx)
                },
                route
            )
            .unwrap()
            .path(),
            expected
        );
    }
}
#[test]
fn credentials_and_raw_backend_fields_never_enter_evidence() {
    let secret = "fixture-secret";
    assert!(transport::decode_json(
        json!({"data":[{"id":secret}]}).to_string().as_bytes(),
        Some(secret)
    )
    .is_err());
    assert!(
        transport::decode_json(br#"{"data":[{"id":"fixture-\u0073ecret"}]}"#, Some(secret))
            .is_err()
    );
    let parsed = parse(
        Backend::Mlx,
        json!({"data":[{"id":"a","authorization":"other-secret","url":"http://metadata/","headers":{"cookie":"private"}}]}),
    );
    let encoded = serde_json::to_string(&parsed).unwrap();
    assert!(
        !encoded.contains("other-secret")
            && !encoded.contains("metadata/")
            && !encoded.contains("cookie")
    );
    assert_eq!(endpoint(Backend::Mlx).account().unwrap(), None);
    let e = Endpoint {
        credential_ref: Some(CredentialRef::CustomEndpoint {
            endpoint_id: "saved-id".into(),
        }),
        ..endpoint(Backend::Mlx)
    };
    assert_eq!(
        e.account().unwrap().as_deref(),
        Some("compat-saved-id-api-key")
    );
}

fn snapshot() -> Snapshot {
    Snapshot {
        endpoint_id: "endpoint-a".into(),
        configuration_revision: 1,
        selected_model_id: None,
        observed_at: 100,
        connected: true,
        reachable: true,
        credential_used: false,
        stale: false,
        refreshing: false,
        inventory_ttl_ms: INVENTORY_TTL_MS,
        instance_ttl_ms: INSTANCE_TTL_MS,
        models: parse(Backend::Mlx, models()),
        errors: vec![],
    }
}
fn begin(
    cache: &mut Cache,
    e: &Endpoint,
    force: bool,
    restart: bool,
) -> (
    u64,
    cache::Receiver,
    futures_util::future::AbortRegistration,
) {
    match cache.begin(e, None, true, force, restart, 100).unwrap() {
        Begin::Start {
            generation,
            receiver,
            registration,
        } => (generation, receiver, registration),
        _ => panic!("expected new generation"),
    }
}
#[tokio::test]
async fn cache_duplicate_refresh_is_single_flight() {
    let mut cache = Cache::default();
    let e = endpoint(Backend::Mlx);
    let (g, a, _) = begin(&mut cache, &e, true, false);
    let b = match cache.begin(&e, None, true, true, false, 100).unwrap() {
        Begin::Join(r) => r,
        _ => panic!("must join"),
    };
    cache.finish(&e, g, Ok(snapshot()));
    assert!(cache::receive(a).await.unwrap().connected);
    assert!(cache::receive(b).await.unwrap().connected);
}
#[tokio::test]
async fn cancellation_aborts_native_work_and_prevents_stale_commit() {
    let mut cache = Cache::default();
    let e = endpoint(Backend::Mlx);
    let (g, r, registration) = begin(&mut cache, &e, true, false);
    cache.cancel(&e.id);
    assert!(Abortable::new(std::future::pending::<()>(), registration)
        .await
        .is_err());
    assert_eq!(
        cache::receive(r).await.unwrap_err().code,
        ErrorCode::Cancelled
    );
    cache.finish(&e, g, Ok(snapshot()));
    assert!(cache.snapshot(&e, None, true, 100).is_none());
}
#[tokio::test]
async fn newer_refresh_supersedes_generation() {
    let mut cache = Cache::default();
    let e = endpoint(Backend::Mlx);
    let (old, r, _) = begin(&mut cache, &e, true, false);
    let (new, _, _) = begin(&mut cache, &e, true, true);
    assert_eq!(
        cache::receive(r).await.unwrap_err().code,
        ErrorCode::Cancelled
    );
    cache.finish(&e, old, Ok(snapshot()));
    assert!(cache.snapshot(&e, None, true, 100).is_none());
    assert!(cache.current(&e, new));
}
#[test]
fn url_backend_and_credential_changes_invalidate_but_alias_does_not() {
    let original = json!({"id":"endpoint-a","baseURL":"http://localhost/v1","backendHint":"mlx","credentialRef":null,"configurationRevision":1,"alias":"First"});
    let e: Endpoint = serde_json::from_value(original.clone()).unwrap();
    for (field, value) in [
        ("baseURL", json!("http://localhost/changed/v1")),
        ("backendHint", json!("vllm")),
        (
            "credentialRef",
            json!({"kind":"custom-endpoint","endpointId":"key"}),
        ),
        ("alias", json!("Renamed")),
        ("deletedAt", json!(123)),
    ] {
        let mut cache = Cache::default();
        let (g, _, _) = begin(&mut cache, &e, true, false);
        cache.finish(&e, g, Ok(snapshot()));
        let mut changed = original.clone();
        changed[field] = value;
        cache.reconcile(&[serde_json::from_value(changed).unwrap()]);
        assert_eq!(
            cache.snapshot(&e, None, true, 100).is_some(),
            field == "alias"
        );
    }
}
#[test]
fn key_rotation_invalidates_only_its_reference() {
    let mut cache = Cache::default();
    let mut e = endpoint(Backend::Mlx);
    e.credential_ref = Some(CredentialRef::CustomEndpoint {
        endpoint_id: "a".into(),
    });
    let (g, _, _) = begin(&mut cache, &e, true, false);
    cache.finish(&e, g, Ok(snapshot()));
    cache.invalidate_account("compat-b-api-key");
    assert!(cache.snapshot(&e, None, true, 100).is_some());
    cache.invalidate_account("compat-a-api-key");
    assert!(cache.snapshot(&e, None, true, 100).is_none());
}
#[test]
fn failed_refresh_keeps_evidence_stale_success_replaces_it() {
    let mut cache = Cache::default();
    let e = endpoint(Backend::Mlx);
    let (g, _, _) = begin(&mut cache, &e, true, false);
    cache.finish(&e, g, Ok(snapshot()));
    let (g, _, _) = begin(&mut cache, &e, true, false);
    cache.finish(&e, g, Err(ProbeError::new(ErrorCode::Timeout)));
    let previous = cache.snapshot(&e, None, true, 200).unwrap();
    assert!(previous.stale);
    assert!(!previous.connected);
    assert_eq!(previous.models.len(), 1);
    assert_eq!(previous.observed_at, 100);
    let (g, _, _) = begin(&mut cache, &e, true, false);
    let mut next = snapshot();
    next.models.clear();
    next.observed_at = 300;
    cache.finish(&e, g, Ok(next));
    let next = cache.snapshot(&e, None, true, 300).unwrap();
    assert!(!next.stale);
    assert!(next.models.is_empty());
    assert!(next.errors.is_empty());
}
#[test]
fn cache_ttl_and_endpoint_isolation() {
    let mut cache = Cache::default();
    let e = endpoint(Backend::Mlx);
    let (g, _, _) = begin(&mut cache, &e, true, false);
    cache.finish(&e, g, Ok(snapshot()));
    assert!(!cache.snapshot(&e, None, true, 299_999).unwrap().stale);
    assert!(cache.snapshot(&e, None, true, 300_100).unwrap().stale);
    assert!(cache
        .snapshot(
            &Endpoint {
                id: "other".into(),
                ..e.clone()
            },
            None,
            true,
            100
        )
        .is_none());
    assert!(cache.snapshot(&e, None, false, 100).is_none());
    assert!(matches!(
        cache.begin(&e, None, true, false, false, 101).unwrap(),
        Begin::Cached(_)
    ));
}
#[test]
fn cache_capacity_is_bounded() {
    let mut cache = Cache::default();
    for n in 0..8 {
        begin(
            &mut cache,
            &Endpoint {
                id: format!("e{n}"),
                ..endpoint(Backend::Mlx)
            },
            true,
            false,
        );
    }
    assert!(cache
        .begin(&endpoint(Backend::Mlx), None, true, true, false, 100)
        .is_err());
}

#[test]
fn reading_another_saved_binding_reuses_inventory_without_fabricating_evidence() {
    let mut cache = Cache::default();
    let e = endpoint(Backend::Mlx);
    let (generation, _, _) = begin(&mut cache, &e, true, false);
    let mut original = snapshot();
    original.selected_model_id = Some("model-a".into());
    cache.finish(&e, generation, Ok(original));
    let another = cache.snapshot(&e, Some("model-b"), true, 100).unwrap();
    assert_eq!(another.selected_model_id.as_deref(), Some("model-a"));
    assert!(!another.models.iter().any(|model| model.id == "model-b"));
    assert!(cache.snapshot(&e, Some("model-b"), false, 100).is_none());
}
#[test]
fn profile_evidence_merge_preserves_manual_pins_and_existing_identity() {
    let mut value = json!({"version":1,"revision":1,"endpoints":[],"profiles":[]});
    let mut snap = snapshot();
    snap.selected_model_id = Some("model-a".into());
    merge_evidence(&mut value, &snap).unwrap();
    assert_eq!(
        value["profiles"][0]["id"],
        "[\"endpoint-a\",\"model-a\",null]"
    );
    value["profiles"][0]["overrides"] = json!({"configuredContext":{"mode":"manual"}});
    let pins = value["profiles"][0]["overrides"].clone();
    merge_evidence(&mut value, &snap).unwrap();
    assert_eq!(value["profiles"].as_array().unwrap().len(), 1);
    assert_eq!(value["profiles"][0]["overrides"], pins);
    assert_eq!(
        value["profiles"][0]["evidence"].as_array().unwrap().len(),
        1
    );
}

#[tokio::test]
async fn body_timeout_keeps_http_reachability_without_claiming_connected() {
    let server = Server::new(vec![Reply {
        body_delay: Duration::from_millis(180),
        ..Reply::json(models())
    }]);
    let mut transport = Transport::default();
    transport.probe_timeout = Duration::from_millis(100);
    let result = handshake(&transport, &server.endpoint(Backend::Mlx), None, None, true)
        .await
        .unwrap();
    assert!(result.reachable);
    assert!(!result.connected);
    assert_eq!(result.errors[0].error.code, ErrorCode::Timeout);
}

#[tokio::test]
async fn streamed_unknown_length_body_stops_at_byte_cap() {
    let server = Server::new(vec![Reply {
        chunked: true,
        body: vec![b' '; transport::MAX_BYTES + 1024],
        ..Reply::json(models())
    }]);
    let result = probe(&server, Backend::Mlx).await;
    assert_eq!(result.errors[0].error.code, ErrorCode::ResponseTooLarge);
}

#[test]
fn expanded_evidence_is_bounded_during_parsing() {
    let e = Endpoint {
        id: "e".repeat(2048),
        ..endpoint(Backend::Lmstudio)
    };
    let mut input = lm_native();
    input["models"] = json!((0..3000)
        .map(|n| {
            let mut model = lm_native()["models"][0].clone();
            model["key"] = json!(format!("model-{n}"));
            model
        })
        .collect::<Vec<_>>());
    assert_eq!(
        inventory(&e, Route::LmV1, None, &input, 10)
            .unwrap_err()
            .code,
        ErrorCode::ResponseTooLarge
    );
}

#[tokio::test]
async fn no_selected_model_means_no_show_request() {
    let server = Server::new(vec![Reply::json(json!({"models":[]}))]);
    let result = handshake(
        &Transport::default(),
        &server.endpoint(Backend::Ollama),
        None,
        None,
        true,
    )
    .await
    .unwrap();
    assert!(result.connected);
    let requests = server.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(requests.iter().all(|r| r.starts_with("GET ")));
}

#[tokio::test]
async fn server_failure_never_claims_connected_or_retries_other_routes() {
    for status in [429, 500] {
        let server = Server::new(vec![Reply::status(status)]);
        let result = probe(&server, Backend::Lmstudio).await;
        assert!(!result.connected);
        assert!(result.reachable);
        assert_eq!(result.errors[0].error.status_code, Some(status));
        assert_eq!(server.requests.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn malformed_optional_metadata_does_not_partially_commit() {
    let server = Server::new(vec![
        Reply::json(json!({"models":[{"name":"model-a"}]})),
        Reply::json(
            json!({"capabilities":["vision","completion"],"model_info":{"general.architecture":"x","x.context_length":"invalid"}}),
        ),
        Reply::json(json!({"models":[]})),
    ]);
    let result = probe(&server, Backend::Ollama).await;
    assert!(result.connected);
    assert_eq!(result.errors.len(), 1);
    assert!(evidence(&result.models[0], "vision").is_none());
}

#[tokio::test]
async fn vllm_and_mlx_use_only_the_configured_compatible_route() {
    for backend in [Backend::Vllm, Backend::Mlx] {
        let server = Server::new(vec![Reply::json(models())]);
        let result = probe(&server, backend).await;
        assert!(result.connected);
        let requests = server.requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].starts_with("GET /proxy/v1/models "));
    }
}

#[test]
fn only_saved_non_deleted_endpoints_can_be_probed() {
    assert!(configured(&json!({"version":1,"endpoints":[]}), "arbitrary").is_err());
    assert!(configured(&json!({"version":1,"endpoints":[{"id":"saved","baseURL":"http://localhost","configurationRevision":1,"deletedAt":1}]}),"saved").is_err());
}
