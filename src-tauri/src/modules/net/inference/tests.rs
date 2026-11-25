use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::Mutex,
};

#[test]
fn lm11_native_quiescence_requires_actual_original_registry_lease_drop() {
    let native=InferenceState::default();
    let original=native.open("main").unwrap();
    assert!(native.completion(&original).is_some(),"reserved original ID is still owned");
    let lease=native.start("main",&original).unwrap();
    assert!(native.completion(&original).is_some(),"completed SDK text cannot drop Rust lease");
    drop(lease);
    assert!(native.completion(&original).is_none(),"only actual native lease drop drains the ID");
}

#[test]
fn one_muse_permit_is_sha256_bound_and_never_permits_missing_or_foreign_tokens() {
    let permit = "d".repeat(64);
    let expected = format!("{:x}", Sha256::digest(permit.as_bytes()));
    assert!(valid_one_muse_permit(Some(&permit), Some(&expected)));
    assert!(!valid_one_muse_permit(Some(&permit), None));
    assert!(!valid_one_muse_permit(None, Some(&expected)));
    assert!(!valid_one_muse_permit(Some(&"a".repeat(64)), Some(&expected)));
    assert!(!valid_one_muse_permit(Some("short"), Some(&expected)));
    assert!(!valid_one_muse_permit(Some(&permit), Some(&"0".repeat(64))));
    assert!(!valid_one_muse_permit(Some(&permit), Some(&expected.to_uppercase())));
}

#[test]
fn one_muse_wire_admission_rejects_calibration_tools_fallback_and_continuation() {
    let run_id = "muse-one-0123456789abcdef";
    let admission = admission::Admission {
        endpoint_id: "real-qwen".into(), profile_id: "muse".into(), capacity: 1,
    };
    let body = serde_json::json!({
        "model": "muse-glimmer:30b",
        "stream": true,
        "options": {"num_ctx": 32768, "num_predict": 8192},
        "messages": [{"role": "user", "content": "Explain a generic streaming boundary."}],
    });
    let raw = serde_json::to_vec(&body).unwrap();
    let headers = HashMap::from([("content-type".into(), "application/json".into())]);
    let candidate = OneMuseRequest {
        run_id: Some(run_id), url: ONE_MUSE_ENDPOINT, method: "POST",
        headers: Some(&headers),
        body: Some(&raw), allow_private: true, policy: Some(Policy::SelfHosted),
        admission: Some(&admission), preflight: false, fallback: false,
    };
    assert!(valid_one_muse_request(run_id, &candidate));
    assert!(!valid_one_muse_request("muse-one-stale", &candidate));
    for invalid in [
        OneMuseRequest { method: "GET", ..candidate },
        OneMuseRequest { headers: None, ..candidate },
        OneMuseRequest { url: "http://127.0.0.1:11436/api/chat", ..candidate },
        OneMuseRequest { run_id: None, ..candidate },
        OneMuseRequest { allow_private: false, ..candidate },
        OneMuseRequest { preflight: true, ..candidate },
        OneMuseRequest { fallback: true, ..candidate },
        OneMuseRequest { policy: Some(Policy::Legacy), ..candidate },
    ] {
        assert!(!valid_one_muse_request(run_id, &invalid));
    }
    let with_authorization = HashMap::from([
        ("content-type".into(), "application/json".into()),
        ("authorization".into(), "Bearer PRIVATE".into()),
    ]);
    assert!(!valid_one_muse_request(run_id, &OneMuseRequest {
        headers: Some(&with_authorization), ..candidate
    }));
    let multiple = admission::Admission {
        endpoint_id: "real-qwen".into(), profile_id: "muse".into(), capacity: 2,
    };
    assert!(!valid_one_muse_request(run_id, &OneMuseRequest {
        admission: Some(&multiple), ..candidate
    }));
    for mutation in [
        ("model", serde_json::json!("other:latest")),
        ("tools", serde_json::json!([{"type":"function"}])),
        ("tool_choice", serde_json::json!("none")),
        ("think", serde_json::json!(false)),
        ("stream", serde_json::json!(false)),
    ] {
        let mut changed = body.clone();
        changed[mutation.0] = mutation.1;
        let raw = serde_json::to_vec(&changed).unwrap();
        assert!(!valid_one_muse_request(run_id, &OneMuseRequest {
            body: Some(&raw), ..candidate
        }));
    }
    for changed in [
        serde_json::json!({"num_ctx": 4096, "num_predict": 32}),
        serde_json::json!({"num_ctx": 32768, "num_predict": 8192, "temperature": 0.8}),
    ] {
        let mut altered = body.clone();
        altered["options"] = changed;
        let raw = serde_json::to_vec(&altered).unwrap();
        assert!(!valid_one_muse_request(run_id, &OneMuseRequest {
            body: Some(&raw), ..candidate
        }));
    }
    let mut continued = body.clone();
    continued["messages"].as_array_mut().unwrap().push(serde_json::json!({
        "role": "assistant", "content": "Prior answer",
    }));
    let raw = serde_json::to_vec(&continued).unwrap();
    assert!(!valid_one_muse_request(run_id, &OneMuseRequest {
        body: Some(&raw), ..candidate
    }));
}

fn limits() -> Timeouts {
    Timeouts {
        connect: Duration::from_secs(2),
        first: Some(Duration::from_millis(150)),
        idle: Some(Duration::from_millis(100)),
        overall: Duration::from_secs(3),
    }
}
fn request(url: String) -> Request {
    Request {
        url,
        method: "POST".into(),
        headers: None,
        body: Some(b"{}".to_vec()),
        allow_private: true,
        fallback: None,
        trace: diagnostics::Trace::default(),
    }
}

struct Server {
    url: String,
    accepted: oneshot::Receiver<()>,
    closed: oneshot::Receiver<()>,
    thread: std::thread::JoinHandle<()>,
}
fn server(parts: Vec<Vec<u8>>, close: bool, heartbeat: bool) -> Server {
    paced_server(parts, close, heartbeat, Duration::ZERO)
}
fn paced_server(parts: Vec<Vec<u8>>, close: bool, heartbeat: bool, pace: Duration) -> Server {
    paced_server_with_gap(parts, close, heartbeat, pace, None)
}
fn paced_server_with_gap(
    parts: Vec<Vec<u8>>,
    close: bool,
    heartbeat: bool,
    pace: Duration,
    gap: Option<(usize, Duration)>,
) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!(
        "http://{}/v1/chat/completions",
        listener.local_addr().unwrap()
    );
    let (tx, closed) = oneshot::channel();
    let (accepted_tx, accepted) = oneshot::channel();
    let thread = std::thread::spawn(move || {
        listener.set_nonblocking(true).unwrap();
        let end = std::time::Instant::now() + Duration::from_secs(5);
        let mut socket = loop {
            if let Ok((socket, _)) = listener.accept() {
                break socket;
            }
            assert!(std::time::Instant::now() < end, "fixture was not contacted");
            std::thread::sleep(Duration::from_millis(2));
        };
        socket.set_nonblocking(false).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        socket
            .set_write_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut bytes = [0; 4096];
        let mut incoming = Vec::new();
        loop {
            let count = socket.read(&mut bytes).unwrap();
            assert!(count > 0, "client closed before fixture received request");
            incoming.extend_from_slice(&bytes[..count]);
            assert!(incoming.len() < 65536);
            if let Some(end) = incoming.windows(4).position(|w| w == b"\r\n\r\n") {
                let header = String::from_utf8_lossy(&incoming[..end]);
                let length: usize = header
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse().unwrap())
                    })
                    .unwrap_or(0);
                if incoming.len() >= end + 4 + length {
                    break;
                }
            }
        }
        let _ = accepted_tx.send(());
        for (index, part) in parts.into_iter().enumerate() {
            std::thread::sleep(gap.filter(|(at, _)| *at == index).map_or(pace, |(_, d)| d));
            if socket.write_all(&part).is_err() {
                break;
            }
        }
        if heartbeat {
            socket
                .set_read_timeout(Some(Duration::from_millis(5)))
                .unwrap();
            loop {
                if socket
                    .write_all(b": heartbeat\n\ndata: {\"choices\":[{\"delta\":{}}]}\n\n")
                    .is_err()
                {
                    break;
                }
                match socket.read(&mut bytes) {
                    Ok(0) => break,
                    Err(e)
                        if e.kind() == std::io::ErrorKind::WouldBlock
                            || e.kind() == std::io::ErrorKind::TimedOut => {}
                    Err(_) => break,
                    _ => {}
                }
                if std::time::Instant::now() >= end {
                    break;
                }
            }
        } else if !close {
            while let Ok(count) = socket.read(&mut bytes) {
                if count == 0 {
                    break;
                }
            }
        }
        drop(socket);
        let _ = tx.send(());
    });
    Server {
        url,
        accepted,
        closed,
        thread,
    }
}
fn headers() -> Vec<u8> {
    b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n".to_vec()
}

#[cfg(debug_assertions)]
async fn traced_fixture(mode: &str) -> (Result<(), Failure>, serde_json::Value, usize) {
    let mut parts = if mode == "no-headers" { vec![] } else {
        vec![b"HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nX-Private: SECRET_HEADER\r\nConnection: close\r\n\r\n".to_vec(),
            b"{\"message\":{\"content\":\"SECRET_TEXT\"},\"done\":false}\n".to_vec()]
    };
    if mode == "idle" {
        // TCP write boundaries are not HTTP body boundaries: macOS can merge
        // the five paced writes into one or two reqwest bytes_stream items.
        // Make each body observation an actual HTTP chunk without completing
        // the response, so five Body/IPC sequences remain a real assertion.
        let chunk = |body: &[u8]| {
            let mut framed = format!("{:X}\r\n", body.len()).into_bytes();
            framed.extend_from_slice(body);
            framed.extend_from_slice(b"\r\n");
            framed
        };
        parts[0] = b"HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nTransfer-Encoding: chunked\r\nX-Private: SECRET_HEADER\r\nConnection: close\r\n\r\n".to_vec();
        let meaningful = std::mem::take(&mut parts[1]);
        parts[1] = chunk(&meaningful);
        for _ in 0..4 {
            parts.push(chunk(b"{\"message\":{\"content\":\"  \"},\"done\":false}\n"));
        }
    } else if mode == "done" {
        parts.push(b"{\"done\":true,\"done_reason\":\"stop\"}\n".to_vec());
    } else if mode == "sse-done" {
        parts.push(b"data: [DONE]\n\n".to_vec());
    }
    let fixture = paced_server(
        parts,
        mode == "eof" || mode == "done",
        false,
        Duration::from_millis(15),
    );
    let captured = Arc::new(Mutex::new(None));
    let output = captured.clone();
    let diagnostics = diagnostics::AcceptanceDiagnostics::new(move |snapshot| {
        *output.lock().unwrap() = Some(serde_json::to_value(snapshot).unwrap());
    });
    let state = InferenceState::default();
    let id = state.open("main").unwrap();
    let lease = state.start("main", &id).unwrap();
    let mut req = request(fixture.url);
    req.headers = Some(HashMap::from([(
        "Authorization".into(),
        "SECRET_CREDENTIAL".into(),
    )]));
    req.body = Some(b"SECRET_PROMPT".to_vec());
    req.trace = diagnostics.request(&id);
    let emitted = Mutex::new(0);
    let mut fixture_limits = limits();
    // This fixture measures ordering *after* real body delivery. Under loaded
    // macOS CI the 150ms first-output limit can expire during localhost HTTP
    // setup, before the 15ms-paced body begins. Give header-producing cases
    // room to start; retain the strict 150ms no-headers negative and the
    // unchanged 100ms meaningful-output idle deadline/assertions.
    if mode != "no-headers" {
        fixture_limits.first = Some(Duration::from_secs(1));
    }
    let result = execute(&lease, req, fixture_limits, &|payload| {
        if matches!(payload, Payload::Chunk { .. }) {
            if mode == "reject" {
                return false;
            }
            *emitted.lock().unwrap() += 1;
            if mode == "cancel" {
                state.close_owner("main");
            }
        }
        true
    })
    .await;
    drop(lease);
    tokio::time::timeout(Duration::from_secs(4), fixture.closed)
        .await
        .unwrap()
        .unwrap();
    fixture.thread.join().unwrap();
    let snapshot = captured.lock().unwrap().take().unwrap();
    assert!(!snapshot.to_string().contains("SECRET"));
    let count = *emitted.lock().unwrap();
    (result, snapshot, count)
}

#[cfg(debug_assertions)]
#[tokio::test]
async fn acceptance_body_and_ipc_sequences_track_real_delivery_not_whitespace_progress() {
    use diagnostics::Kind;
    let (result, snapshot, emitted) = traced_fixture("idle").await;
    assert_eq!(result.unwrap_err().code, "stream-idle-timeout");
    let events = snapshot["events"].as_array().unwrap();
    let kind =
        |event: &serde_json::Value, k: Kind| event["kind"] == serde_json::to_value(k).unwrap();
    let received: Vec<_> = events.iter().filter(|e| kind(e, Kind::Body)).collect();
    let forwarded: Vec<_> = events
        .iter()
        .filter(|e| kind(e, Kind::IpcForwarded))
        .collect();
    assert_eq!(received.len(), emitted);
    assert_eq!(received.len(), 5);
    assert_eq!(forwarded.len(), emitted);
    for (i, (body, ipc)) in received.iter().zip(forwarded).enumerate() {
        assert_eq!(body["sequence"], i + 1);
        assert_eq!(body["sequence"], ipc["sequence"]);
        assert_eq!(body["bytes"], ipc["bytes"]);
        assert!(body["elapsedUs"].as_u64().unwrap() <= ipc["elapsedUs"].as_u64().unwrap());
    }
    assert_eq!(
        events
            .iter()
            .filter(|e| kind(e, Kind::MeaningfulProgress))
            .count(),
        1
    );
    assert_eq!(events.last().unwrap()["kind"], "deadline-observed");
    assert!(!events.iter().any(|e| kind(e, Kind::Eof)));
    assert!(events.iter().any(|e| kind(e, Kind::Headers)));
    let progress = events
        .iter()
        .find(|e| kind(e, Kind::MeaningfulProgress))
        .unwrap();
    let idle_us = events.last().unwrap()["elapsedUs"].as_u64().unwrap()
        - progress["elapsedUs"].as_u64().unwrap();
    assert!(
        (95_000..190_000).contains(&idle_us),
        "byte-only activity must not extend idle: {idle_us}"
    );
}
#[cfg(debug_assertions)]
#[tokio::test]
async fn request_stage_trace_distinguishes_no_headers_from_completed_synthetic_http() {
    for (mode, expected_terminal, has_headers) in [
        ("done", "completed", true),
        ("no-headers", "deadline-observed", false),
    ] {
        let (result, snapshot, bytes) = traced_fixture(mode).await;
        if has_headers { result.unwrap(); } else {
            assert_eq!(result.unwrap_err().code, "first-output-timeout");
        }
        let events = snapshot["events"].as_array().unwrap();
        let kinds: Vec<&str> = events.iter().map(|e| e["kind"].as_str().unwrap()).collect();
        let index = |kind: &str| kinds.iter().position(|value| *value == kind).unwrap();
        assert!(index("resolve-start") < index("resolve-end"));
        assert!(index("resolve-end") < index("http-client-build-start"));
        assert!(index("http-client-build-start") < index("http-client-ready"));
        assert!(index("http-client-ready") < index("request-built"));
        assert!(index("request-built") < index("send-await-start"));
        assert_eq!(kinds.contains(&"headers"), has_headers);
        assert_eq!(bytes > 0, has_headers);
        assert_eq!(kinds.last().copied(), Some(expected_terminal));
        if has_headers {
            assert!(index("send-await-start") < index("headers"));
            assert!(index("headers") < index("first-body-chunk"));
            assert!(index("first-body-chunk") < index("provider-done"));
            assert_eq!(snapshot["httpStatus"], 200);
            assert_eq!(snapshot["resolvedIpScope"], "loopback");
            assert!(snapshot["destinationPort"].as_u64().unwrap() > 0);
            assert_eq!(snapshot["lastRequestStage"], "eof");
        } else {
            assert!(!kinds.contains(&"body"));
            assert_eq!(snapshot["httpStatus"], serde_json::Value::Null);
            assert_eq!(snapshot["resolvedIpScope"], "loopback");
            assert_eq!(snapshot["lastRequestStage"], "send-await-start");
            assert_eq!(snapshot["failureCode"], "first-output-timeout");
        }
        // The trace deliberately claims nothing about physical TCP/write phases.
        assert!(!snapshot.to_string().contains("SECRET"));
    }
}
#[cfg(debug_assertions)]
#[tokio::test]
async fn diagnostic_connect_failure_keeps_last_genuine_phase_and_safe_code() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v1/chat/completions", listener.local_addr().unwrap());
    drop(listener);
    let captured = Arc::new(Mutex::new(None));
    let out = captured.clone();
    let sink = diagnostics::AcceptanceDiagnostics::new(move |s| {
        *out.lock().unwrap() = Some(serde_json::to_value(s).unwrap());
    });
    // Use an explicitly no-proxy synthetic client to make the refused TCP
    // connection deterministic even on machines with system HTTP proxies.
    // Production connector selection and connection pooling are untouched.
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let err = client.get(url).send().await.unwrap_err();
    let failure = network_error(err);
    assert_eq!(failure.code, "connection-failed");
    let mut trace = sink.request("inference-connection-test");
    trace.record(diagnostics::Kind::HttpClientReady, 0);
    trace.record(diagnostics::Kind::SendAwaitStart, 0);
    trace.finish(&Err(failure));
    let snapshot = captured.lock().unwrap().take().unwrap();
    assert_eq!(snapshot["lastRequestStage"], "send-await-start");
    assert_eq!(snapshot["failureCode"], "connection-failed");
    assert!(snapshot["httpStatus"].is_null());
    assert!(!snapshot.to_string().contains("/v1/chat/completions"));
}
#[cfg(debug_assertions)]
#[tokio::test]
async fn diagnostic_parent_cancel_during_no_header_wait_preserves_transport_stage() {
    let fixture = server(vec![], false, false);
    let state = Arc::new(InferenceState::default());
    let id = state.open("main").unwrap();
    let lease = state.start("main", &id).unwrap();
    let captured = Arc::new(Mutex::new(None));
    let out = captured.clone();
    let sink = diagnostics::AcceptanceDiagnostics::new(move |s| {
        *out.lock().unwrap() = Some(serde_json::to_value(s).unwrap());
    });
    let mut req = request(fixture.url);
    req.trace = sink.request(&id);
    let owner = state.clone();
    let canceller = tokio::spawn(async move {
        fixture.accepted.await.unwrap();
        owner.close_owner("main");
        tokio::time::timeout(Duration::from_secs(3), fixture.closed).await.unwrap().unwrap();
        fixture.thread.join().unwrap();
    });
    let result = execute(&lease, req, limits(), &|_| true).await;
    assert_eq!(result.unwrap_err().code, "cancelled");
    drop(lease);
    canceller.await.unwrap();
    let snapshot = captured.lock().unwrap().take().unwrap();
    assert_eq!(snapshot["lastRequestStage"], "send-await-start");
    assert_eq!(snapshot["events"].as_array().unwrap().last().unwrap()["kind"], "cancellation-observed");
    assert!(snapshot["httpStatus"].is_null());
}

#[cfg(debug_assertions)]
#[tokio::test]
async fn acceptance_trace_preserves_cancellation_and_reports_ipc_rejection() {
    for mode in ["cancel", "reject"] {
        let (result, snapshot, emitted) = traced_fixture(mode).await;
        assert_eq!(result.unwrap_err().code, "cancelled");
        let events = snapshot["events"].as_array().unwrap();
        assert_eq!(events.last().unwrap()["kind"], "cancellation-observed");
        assert_eq!(emitted, usize::from(mode == "cancel"));
        assert_eq!(
            events
                .iter()
                .filter(|e| e["kind"] == "ipc-rejected")
                .count(),
            usize::from(mode == "reject")
        );
        assert!(!events.iter().any(|e| e["kind"] == "eof"));
    }
}

#[cfg(debug_assertions)]
#[tokio::test]
async fn acceptance_trace_distinguishes_provider_done_from_observed_http_eof() {
    for mode in ["done", "eof", "sse-done"] {
        let (result, snapshot, _) = traced_fixture(mode).await;
        result.unwrap();
        let events = snapshot["events"].as_array().unwrap();
        assert_eq!(events.last().unwrap()["kind"], "completed");
        assert_eq!(
            events.iter().filter(|e| e["kind"] == "eof").count(),
            usize::from(mode != "sse-done")
        );
        assert_eq!(
            events
                .iter()
                .filter(|e| e["kind"] == "provider-done")
                .count(),
            usize::from(mode != "eof")
        );
    }
}
fn delta() -> Vec<u8> {
    b"data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\n".to_vec()
}
async fn run_fault(
    parts: Vec<Vec<u8>>,
    close: bool,
    heartbeat: bool,
    timeouts: Timeouts,
    cancel_at: Option<&str>,
) -> (Result<(), Failure>, Vec<Payload>) {
    let fixture = server(parts, close, heartbeat);
    let state = InferenceState::default();
    let id = state.open("main").unwrap();
    let lease = state.start("main", &id).unwrap();
    let events = Mutex::new(Vec::new());
    let result = execute_admitted(
        &state,
        &lease,
        request(fixture.url),
        timeouts,
        Some(admission_spec(1)),
        &|p| {
            let cancel = matches!(
                (&p, cancel_at),
                (Payload::Headers { .. }, Some("body")) | (Payload::Chunk { .. }, Some("chunk"))
            );
            events.lock().unwrap().push(p);
            if cancel {
                state.close_owner("main");
            }
            true
        },
    )
    .await;
    drop(lease);
    assert_eq!(state.len(), 0);
    let next_id = state.open("next-window").unwrap();
    let next = state.start("next-window", &next_id).unwrap();
    drop(
        state
            .admission
            .acquire(&next, admission_spec(1), |_| {
                panic!("settled attempt retained capacity")
            })
            .await
            .unwrap(),
    );
    drop(next);
    tokio::time::timeout(Duration::from_secs(4), fixture.closed)
        .await
        .unwrap()
        .unwrap();
    fixture.thread.join().unwrap();
    (result, events.into_inner().unwrap())
}

fn admission_spec(capacity: usize) -> admission::Admission {
    admission::Admission {
        endpoint_id: "server".into(),
        profile_id: "model".into(),
        capacity,
    }
}

async fn concurrency_fixture(capacity: usize) {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!(
        "http://{}/v1/chat/completions",
        listener.local_addr().unwrap()
    );
    let active = Arc::new(AtomicUsize::new(0));
    let peak = Arc::new(AtomicUsize::new(0));
    let received = Arc::new(AtomicUsize::new(0));
    let release = Arc::new(AtomicBool::new(false));
    let metrics = (
        active.clone(),
        peak.clone(),
        received.clone(),
        release.clone(),
    );
    let server = std::thread::spawn(move || {
        let mut workers = Vec::new();
        let end = std::time::Instant::now() + Duration::from_secs(10);
        while workers.len() < 5 {
            match listener.accept() {
                Ok((mut socket, _)) => {
                    socket.set_nonblocking(false).unwrap();
                    socket
                        .set_read_timeout(Some(Duration::from_secs(5)))
                        .unwrap();
                    socket
                        .set_write_timeout(Some(Duration::from_secs(5)))
                        .unwrap();
                    let (active, peak, received, release) = metrics.clone();
                    workers.push(std::thread::spawn(move || {
                        let mut buf = [0; 4096];
                        let mut incoming = Vec::new();
                        loop {
                            let n = socket.read(&mut buf).unwrap();
                            assert!(n > 0);
                            incoming.extend_from_slice(&buf[..n]);
                            assert!(incoming.len() < 65536);
                            if incoming.windows(4).position(|w| w == b"\r\n\r\n")
                                .is_some_and(|end| incoming.len() >= end + 6)
                            {
                                break;
                            }
                        }
                        let current = active.fetch_add(1, Ordering::SeqCst) + 1;
                        peak.fetch_max(current, Ordering::SeqCst);
                        received.fetch_add(1, Ordering::SeqCst);
                        while !release.load(Ordering::SeqCst) {
                            assert!(std::time::Instant::now() < end);
                            std::thread::sleep(Duration::from_millis(1));
                        }
                        active.fetch_sub(1, Ordering::SeqCst);
                        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}").unwrap();
                    }));
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(std::time::Instant::now() < end);
                    std::thread::sleep(Duration::from_millis(1));
                }
                Err(e) => panic!("{e}"),
            }
        }
        for worker in workers {
            worker.join().unwrap();
        }
    });
    let state = Arc::new(InferenceState::default());
    let mut tasks = Vec::new();
    let queued = Arc::new(AtomicUsize::new(0));
    for index in 0..5 {
        let state = state.clone();
        let url = url.clone();
        let queued = queued.clone();
        tasks.push(tokio::spawn(async move {
            let owner = format!("window-{index}");
            let id = state.open(&owner).unwrap();
            let lease = state.start(&owner, &id).unwrap();
            let mut timeouts = limits();
            timeouts.first = Some(Duration::from_secs(3));
            timeouts.overall = Duration::from_secs(5);
            let result = execute_admitted(
                &state,
                &lease,
                request(url),
                timeouts,
                Some(admission_spec(capacity)),
                &|p| {
                    if matches!(
                        p,
                        Payload::Phase {
                            phase: Phase::Queued
                        }
                    ) {
                        queued.fetch_add(1, Ordering::SeqCst);
                    }
                    true
                },
            )
            .await;
            drop(lease);
            result.unwrap();
        }));
    }
    tokio::time::timeout(Duration::from_secs(5), async {
        while received.load(Ordering::SeqCst) < capacity
            || queued.load(Ordering::SeqCst) < 5 - capacity
        {
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(received.load(Ordering::SeqCst), capacity);
    assert_eq!(active.load(Ordering::SeqCst), capacity);
    release.store(true, Ordering::SeqCst);
    for task in tasks {
        task.await.unwrap();
    }
    server.join().unwrap();
    assert_eq!(received.load(Ordering::SeqCst), 5);
    assert_eq!(peak.load(Ordering::SeqCst), capacity);
    assert_eq!(state.len(), 0);
}

#[tokio::test]
async fn native_server_observes_maximum_one_across_five_windows() {
    concurrency_fixture(1).await;
}

#[tokio::test]
async fn native_server_observes_maximum_two_across_five_windows() {
    concurrency_fixture(2).await;
}

#[tokio::test]
async fn queue_wait_does_not_spend_any_transport_deadline() {
    let state = InferenceState::default();
    let first = state.start("a", &state.open("a").unwrap()).unwrap();
    let held = state
        .admission
        .acquire(&first, admission_spec(1), |_| panic!())
        .await
        .unwrap();
    let queued = state.start("b", &state.open("b").unwrap()).unwrap();
    let fixture = server(
        vec![b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".to_vec()],
        true,
        false,
    );
    let events = Mutex::new(Vec::new());
    let emit = |p| {
        events.lock().unwrap().push(p);
        true
    };
    let result = execute_admitted(
        &state,
        &queued,
        request(fixture.url),
        Timeouts {
            connect: Duration::from_millis(100),
            first: Some(Duration::from_millis(100)),
            idle: Some(Duration::from_millis(100)),
            overall: Duration::from_millis(150),
        },
        Some(admission_spec(1)),
        &emit,
    );
    tokio::pin!(result);
    assert!(futures_util::poll!(&mut result).is_pending());
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(futures_util::poll!(&mut result).is_pending());
    assert!(events.lock().unwrap().iter().all(|p| !matches!(
        p,
        Payload::Phase {
            phase: Phase::Connecting | Phase::WaitingFirstOutput | Phase::Generating
        }
    )));
    drop(held);
    result.await.unwrap();
    let observations: Vec<_> = events
        .lock()
        .unwrap()
        .iter()
        .filter_map(|p| {
            if let Payload::Admission { observation } = p {
                Some(observation.clone())
            } else {
                None
            }
        })
        .collect();
    let final_observation = observations.last().unwrap();
    assert!(
        final_observation.attempt_started_at.unwrap() >= final_observation.queue_entered_at + 150
    );
    assert!(final_observation.settled_at >= final_observation.attempt_started_at);
    fixture.thread.join().unwrap();
}

#[tokio::test]
async fn unenrolled_cloud_native_request_bypasses_busy_endpoint() {
    let state = InferenceState::default();
    let first = state.start("a", &state.open("a").unwrap()).unwrap();
    let held = state
        .admission
        .acquire(&first, admission_spec(1), |_| panic!())
        .await
        .unwrap();
    let cloud = state.start("b", &state.open("b").unwrap()).unwrap();
    let fixture = server(
        vec![b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".to_vec()],
        true,
        false,
    );
    execute_admitted(&state, &cloud, request(fixture.url), limits(), None, &|p| {
        assert!(!matches!(
            p,
            Payload::Phase {
                phase: Phase::Queued
            }
        ));
        true
    })
    .await
    .unwrap();
    drop(held);
    fixture.thread.join().unwrap();
}

#[tokio::test]
async fn reservation_cancel_is_scoped_idempotent_and_never_reused() {
    let state = InferenceState::default();
    let a = state.open("main").unwrap();
    let b = state.open("settings").unwrap();
    state.cancel("settings", &a).await;
    assert_eq!(state.len(), 2);
    state.cancel("main", &a).await;
    state.cancel("main", &a).await;
    assert!(state.start("main", &a).is_err());
    let c = state.open("main").unwrap();
    assert_ne!(a, c);
    state.cancel("main", &a).await;
    assert_eq!(state.len(), 2);
    assert!(state.start("main", &b).is_err());
    state.expire_reservation("main", &c);
    state.close_owner("settings");
    assert_eq!(state.len(), 0);
}
#[tokio::test]
async fn active_cancel_waits_for_drop_and_stale_cancel_cannot_affect_next() {
    let state = InferenceState::default();
    let id = state.open("main").unwrap();
    let lease = state.start("main", &id).unwrap();
    assert!(state.start("main", &id).is_err());
    let cancel = state.cancel("main", &id);
    tokio::pin!(cancel);
    tokio::select! { _ = &mut cancel => panic!("released before drop"), _ = tokio::time::sleep(Duration::from_millis(1)) => {} }
    assert!(lease.cancelled());
    drop(lease);
    cancel.await;
    let newer = state.open("main").unwrap();
    state.cancel("main", &id).await;
    assert!(state.start("main", &newer).is_ok());
    assert_eq!(state.len(), 0);
}
#[tokio::test]
async fn cancellation_provenance_keeps_first_webview_initiator_and_in_flight_state() {
    let state = InferenceState::default();
    let id = state.open("main").unwrap();
    let lease = state.start("main", &id).unwrap();
    lease.mark_provider_dispatched();
    let first = state.cancel_with_origin("main", &id, registry::CancelOrigin::StreamConsumer);
    tokio::pin!(first);
    tokio::select! { _ = &mut first => panic!("cancel completed before lease drop"),
        _ = tokio::time::sleep(Duration::from_millis(2)) => {} }
    let receipt = lease.cancellation_provenance().unwrap();
    assert_eq!(receipt.request_id, id);
    assert!(receipt.at > 0);
    assert_eq!(receipt.source, "webview-cancel-ipc");
    assert_eq!(receipt.initiating_layer, "response-stream-consumer");
    assert_eq!(receipt.reason, "response-reader-cancelled");
    assert_eq!(receipt.category, "consumer-cleanup");
    assert!(receipt.provider_request_in_flight);
    assert!(!serde_json::to_string(&receipt).unwrap().contains("prompt"));
    state.shutdown();
    assert_eq!(lease.cancellation_provenance(), Some(receipt));
    drop(lease);
    first.await;
}
#[test]
fn diagnostic_cancellation_origin_is_strict_and_sdk_errors_are_redacted() {
    let sdk: registry::CancelOrigin = serde_json::from_str("\"sdk-stream-error\"").unwrap();
    assert_eq!(sdk, registry::CancelOrigin::SdkStreamError);
    assert!(serde_json::from_str::<registry::CancelOrigin>("\"secret arbitrary provider text\"").is_err());
    let state = InferenceState::default();
    let id = state.open("main").unwrap();
    let lease = state.start("main", &id).unwrap();
    // The native cancellation command is asynchronous; directly check the
    // fixed reason mapping and first-signal storage at the registry boundary.
    state.close_owner("another-window");
    assert!(!lease.cancelled());
    lease.note_ipc_rejected();
    assert_eq!(lease.cancellation_provenance().unwrap().category, "transport");
}
#[test]
fn cancellation_provenance_distinguishes_native_shutdown_and_ipc_delivery_failure() {
    let state = InferenceState::default();
    let id = state.open("main").unwrap();
    let lease = state.start("main", &id).unwrap();
    lease.note_ipc_rejected();
    assert!(!lease.cancelled(), "diagnostics must not change cancellation semantics");
    assert_eq!(lease.cancellation_provenance().unwrap().reason, "ipc-event-delivery-rejected");
    state.close_owner("main");
    assert!(lease.cancelled());
    assert_eq!(lease.cancellation_provenance().unwrap().reason, "ipc-event-delivery-rejected");
    drop(lease);
    let id = state.open("main").unwrap();
    let lease = state.start("main", &id).unwrap();
    state.shutdown();
    let receipt = lease.cancellation_provenance().unwrap();
    assert_eq!(receipt.source, "host-shutdown");
    assert_eq!(receipt.initiating_layer, "native-lifecycle");
    assert!(!receipt.provider_request_in_flight);
    assert!(lease.cancelled());
}
#[tokio::test]
async fn cancellation_drops_dns_or_connect_future_before_it_can_start_http() {
    let state = InferenceState::default();
    let id = state.open("main").unwrap();
    let lease = state.start("main", &id).unwrap();
    let dropped = Arc::new(std::sync::atomic::AtomicBool::new(false));
    struct DropSignal(Arc<std::sync::atomic::AtomicBool>);
    impl Drop for DropSignal {
        fn drop(&mut self) {
            self.0.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    }
    let marker = DropSignal(dropped.clone());
    let work = async move {
        let _marker = marker;
        std::future::pending::<Result<(), Failure>>().await
    };
    let wait = guarded(
        &lease,
        (Instant::now() + Duration::from_secs(1), "connect-timeout"),
        work,
    );
    let stop = async {
        tokio::task::yield_now().await;
        state.close_owner("main");
    };
    let (result, _) = tokio::join!(wait, stop);
    assert_eq!(result.unwrap_err().code, "cancelled");
    assert!(dropped.load(std::sync::atomic::Ordering::SeqCst));
    drop(lease);
    assert_eq!(state.len(), 0);
}
#[tokio::test]
async fn connect_timeout_and_cancel_race_are_deterministic() {
    let state = InferenceState::default();
    let id = state.open("main").unwrap();
    let lease = state.start("main", &id).unwrap();
    let past = Instant::now() - Duration::from_secs(1);
    assert_eq!(
        guarded(
            &lease,
            (past, "connect-timeout"),
            std::future::pending::<Result<(), Failure>>()
        )
        .await
        .unwrap_err()
        .code,
        "connect-timeout"
    );
    state.close_owner("main");
    assert_eq!(
        guarded(&lease, (past, "connect-timeout"), async { Ok(()) })
            .await
            .unwrap_err()
            .code,
        "cancelled"
    );
}
#[tokio::test]
async fn stalled_headers_are_first_output_timeout_not_fabricated_loading() {
    let (result, events) = run_fault(vec![], false, false, limits(), None).await;
    assert_eq!(result.unwrap_err().code, "first-output-timeout");
    assert!(events.iter().all(|e| !matches!(
        e,
        Payload::Phase {
            phase: Phase::Generating
        }
    )));
}
#[tokio::test]
async fn headers_without_body_time_out_and_close_native_socket() {
    let (result, _) = run_fault(vec![headers()], false, false, limits(), None).await;
    assert_eq!(result.unwrap_err().code, "first-output-timeout");
}
#[tokio::test]
async fn cancel_accepted_connection_before_response_headers() {
    let fixture = server(vec![], false, false);
    let state = InferenceState::default();
    let id = state.open("main").unwrap();
    let lease = state.start("main", &id).unwrap();
    let work = async {
        let result = execute(&lease, request(fixture.url), limits(), &|_| true).await;
        drop(lease);
        result
    };
    let stop = async {
        fixture.accepted.await.unwrap();
        state.cancel("main", &id).await;
        assert_eq!(state.len(), 0);
    };
    let (result, _) = tokio::join!(work, stop);
    assert_eq!(result.unwrap_err().code, "cancelled");
    tokio::time::timeout(Duration::from_secs(1), fixture.closed)
        .await
        .unwrap()
        .unwrap();
    fixture.thread.join().unwrap();
}
#[tokio::test]
async fn slow_first_output_then_meaningful_chunks_extend_idle_until_completion() {
    let fixture = paced_server(
        vec![
            headers(),
            delta(),
            delta(),
            delta(),
            b"data: [DONE]\n\n".to_vec(),
        ],
        false,
        false,
        Duration::from_millis(40),
    );
    let state = InferenceState::default();
    let id = state.open("main").unwrap();
    let lease = state.start("main", &id).unwrap();
    let start = Instant::now();
    let result = execute(&lease, request(fixture.url), limits(), &|_| true).await;
    assert!(result.is_ok(), "{result:?}");
    assert!(start.elapsed() > limits().first.unwrap());
    drop(lease);
    assert_eq!(state.len(), 0);
    fixture.closed.await.unwrap();
    fixture.thread.join().unwrap();
    state.cancel("main", &id).await;
    assert_eq!(terminal(&result), Phase::Completed);
}
#[tokio::test]
async fn several_chunks_then_disconnect_is_not_success() {
    let (result, _) = run_fault(
        vec![headers(), delta(), delta(), delta()],
        true,
        false,
        limits(),
        None,
    )
    .await;
    assert_eq!(terminal(&result), Phase::Disconnected);
}
#[tokio::test]
async fn bounded_reservations_and_window_close_do_not_cancel_another_owner() {
    let state = InferenceState::default();
    let other = state.open("other").unwrap();
    let other_lease = state.start("other", &other).unwrap();
    for _ in 1..128 {
        state.open("main").unwrap();
    }
    assert_eq!(state.open("main").unwrap_err().code, "request-limit");
    state.close_owner("main");
    assert_eq!(state.len(), 1);
    assert!(!other_lease.cancelled());
    drop(other_lease);
    assert_eq!(state.len(), 0);
}
#[tokio::test]
async fn system_resolver_failure_is_classified_without_raw_hostname() {
    let result = resolve("\0".into(), true).await;
    assert_eq!(result.unwrap_err().code, "dns-failure");
}
#[tokio::test]
async fn invalid_tls_server_is_distinct_from_connection_failure() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let thread = std::thread::spawn(move || {
        listener.set_nonblocking(true).unwrap();
        let end = std::time::Instant::now() + Duration::from_secs(3);
        loop {
            if let Ok((mut socket, _)) = listener.accept() {
                socket.set_nonblocking(false).unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut bytes = [0; 4096];
                let _ = socket.read(&mut bytes);
                socket
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
                    .unwrap();
                while let Ok(count) = socket.read(&mut bytes) {
                    if count == 0 {
                        break;
                    }
                }
                break;
            }
            assert!(std::time::Instant::now() < end);
            std::thread::sleep(Duration::from_millis(2));
        }
    });
    let state = InferenceState::default();
    let id = state.open("main").unwrap();
    let lease = state.start("main", &id).unwrap();
    let result = execute(
        &lease,
        request(format!("https://{address}/v1")),
        limits(),
        &|_| true,
    )
    .await;
    assert_eq!(result.unwrap_err().code, "tls-failure");
    drop(lease);
    assert_eq!(state.len(), 0);
    thread.join().unwrap();
}
#[tokio::test]
async fn first_chunk_then_stall_is_idle_timeout() {
    let (result, events) = run_fault(vec![headers(), delta()], false, false, limits(), None).await;
    assert_eq!(result.unwrap_err().code, "stream-idle-timeout");
    assert_eq!(
        events
            .iter()
            .filter(|e| matches!(
                e,
                Payload::Phase {
                    phase: Phase::Generating
                }
            ))
            .count(),
        1
    );
}
// Regression for the observed Ollama task 1806: its generated-token counter
// climbed for a full minute while no further body bytes reached native IPC.
// The test uses real elapsed seconds, not a shortened simulated clock.
#[tokio::test]
async fn self_hosted_real_61_second_silence_then_native_chunks_resume_and_finish() {
    let fixture = paced_server_with_gap(
        vec![headers(), delta(), delta(), b"data: [DONE]\n\n".to_vec()],
        false,
        false,
        Duration::ZERO,
        Some((2, Duration::from_secs(61))),
    );
    let state = InferenceState::default();
    let id = state.open("main").unwrap();
    let lease = state.start("main", &id).unwrap();
    let forwarded = Mutex::new(Vec::<u8>::new());
    let started = Instant::now();
    let result = execute(
        &lease,
        request(fixture.url),
        Timeouts::for_policy(Policy::SelfHosted),
        &|event| {
            if let Payload::Chunk { bytes } = event {
                forwarded.lock().unwrap().extend_from_slice(&bytes);
            }
            true
        },
    )
    .await;
    assert!(
        result.is_ok(),
        "resuming after >60s must complete: {result:?}"
    );
    assert!(started.elapsed() >= Duration::from_secs(61));
    // reqwest may coalesce the second delta and [DONE] into a single chunk.
    assert_eq!(
        String::from_utf8_lossy(&forwarded.lock().unwrap())
            .matches("hello")
            .count(),
        2,
        "both pre-gap and post-gap deltas reached native IPC"
    );
    drop(lease);
    assert_eq!(state.len(), 0, "no retained request/timer after success");
    tokio::time::timeout(Duration::from_secs(4), fixture.closed)
        .await
        .unwrap()
        .unwrap();
    fixture.thread.join().unwrap();
}
#[tokio::test]
async fn self_hosted_dead_stream_is_bounded_and_stale_request_cannot_resume() {
    // Scale the same 180:600 idle/overall ratio down for deterministic testing;
    // the real-second success regression above exercises the actual policy.
    let bounds = Timeouts {
        connect: Duration::from_secs(2),
        first: Some(Duration::from_millis(120)),
        idle: Some(Duration::from_millis(180)),
        overall: Duration::from_millis(600),
    };
    let (outcome, events) = run_fault(vec![headers(), delta()], false, false, bounds, None).await;
    assert_eq!(outcome.unwrap_err().code, "stream-idle-timeout");
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event, Payload::Chunk { .. }))
            .count(),
        1,
    );
    assert_eq!(
        terminal(&Err(Failure::new("stream-idle-timeout"))),
        Phase::TimedOut
    );
}
#[tokio::test]
async fn heartbeat_and_empty_events_do_not_prevent_first_output_timeout() {
    let (result, _) = run_fault(vec![headers()], false, true, limits(), None).await;
    assert_eq!(result.unwrap_err().code, "first-output-timeout");
}
#[tokio::test]
async fn overall_ceiling_wins_even_with_longer_progress_allowances() {
    let mut policy = limits();
    policy.first = Some(Duration::from_secs(2));
    policy.overall = Duration::from_millis(100);
    let (result, _) = run_fault(vec![headers()], false, true, policy, None).await;
    assert_eq!(result.unwrap_err().code, "overall-deadline");
}
#[tokio::test]
async fn premature_stream_eof_is_disconnect_not_completed() {
    let (result, _) = run_fault(vec![headers(), delta()], true, false, limits(), None).await;
    assert_eq!(terminal(&result), Phase::Disconnected);
}
#[tokio::test]
async fn normal_done_drops_native_socket_without_waiting_for_peer_to_close() {
    let (result, events) = run_fault(
        vec![headers(), delta(), b"data: [DONE]\n\n".to_vec()],
        false,
        false,
        limits(),
        None,
    )
    .await;
    assert!(result.is_ok());
    assert_eq!(terminal(&result), Phase::Completed);
    assert!(events.iter().any(|e| matches!(e, Payload::Chunk { .. })));
}
#[tokio::test]
async fn streaming_response_keeps_normal_headers_generation_chunk_and_completion_events() {
    let (result, events) = run_fault(
        vec![headers(), delta(), b"data: [DONE]\n\n".to_vec()],
        false,
        false,
        limits(),
        None,
    ).await;
    assert!(result.is_ok());
    assert!(events.iter().any(|event| matches!(event, Payload::Headers { status: 200, .. })));
    assert!(events.iter().any(|event| matches!(event, Payload::Phase { phase: Phase::Generating })));
    assert!(events.iter().any(|event| matches!(event, Payload::Chunk { bytes } if String::from_utf8_lossy(bytes).contains("hello"))));
    assert_eq!(terminal(&result), Phase::Completed);
}

#[tokio::test]
async fn non_streaming_ollama_json_completion_is_forwarded_unchanged_and_settles() {
    let body = br#"{"model":"muse-glimmer:30b","message":{"role":"assistant","content":"{\"claims\":[]}"},"done":true,"done_reason":"stop","prompt_eval_count":120,"eval_count":18}"#;
    let header = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let fixture = server(vec![header.into_bytes(), body.to_vec()], true, false);
    let state = InferenceState::default();
    let id = state.open("main").unwrap();
    let lease = state.start("main", &id).unwrap();
    let events = Mutex::new(Vec::new());
    let result = execute_admitted(&state, &lease, request(fixture.url), limits(), None, &|event| {
        events.lock().unwrap().push(event);
        true
    }).await;
    assert!(result.is_ok(), "non-streaming JSON response must complete: {result:?}");
    assert_eq!(terminal(&result), Phase::Completed);
    let events = events.into_inner().unwrap();
    assert!(events.iter().any(|event| matches!(event, Payload::Headers { status: 200, headers }
        if headers.get("content-type").is_some_and(|value| value.contains("application/json")))));
    let forwarded: Vec<u8> = events.iter().flat_map(|event| match event {
        Payload::Chunk { bytes } => bytes.clone(),
        _ => Vec::new(),
    }).collect();
    assert_eq!(forwarded, body, "native transport must preserve the JSON response bytes");
    let decoded: serde_json::Value = serde_json::from_slice(&forwarded).unwrap();
    assert_eq!(decoded["done"], true);
    assert_eq!(decoded["message"]["content"], "{\"claims\":[]}");
    drop(lease);
    assert_eq!(state.len(), 0, "completed non-streaming request releases its lease");
    tokio::time::timeout(Duration::from_secs(4), fixture.closed).await.unwrap().unwrap();
    fixture.thread.join().unwrap();
}

#[tokio::test]
async fn cancellation_during_non_streaming_json_delivery_still_wins_and_releases() {
    let body = br#"{"model":"muse-glimmer:30b","message":{"role":"assistant","content":"bounded result"},"done":true}"#;
    let header = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let fixture = server(vec![header.into_bytes(), body.to_vec()], true, false);
    let state = Arc::new(InferenceState::default());
    let id = state.open("main").unwrap();
    let lease = state.start("main", &id).unwrap();
    let owner = state.clone();
    let chunks = Mutex::new(0usize);
    let result = execute_admitted(&state, &lease, request(fixture.url), limits(), None, &|event| {
        if matches!(event, Payload::Chunk { .. }) {
            *chunks.lock().unwrap() += 1;
            owner.close_owner("main");
        }
        true
    }).await;
    assert_eq!(terminal(&result), Phase::Cancelled);
    assert!(*chunks.lock().unwrap() > 0);
    drop(lease);
    assert_eq!(state.len(), 0, "cancelled non-streaming request releases its lease");
    tokio::time::timeout(Duration::from_secs(4), fixture.closed).await.unwrap().unwrap();
    fixture.thread.join().unwrap();
}

#[tokio::test]
async fn cancellation_after_headers_and_during_stream_drops_socket() {
    for phase in ["body", "chunk"] {
        let (result, _) = run_fault(
            vec![headers(), delta()],
            false,
            false,
            limits(),
            Some(phase),
        )
        .await;
        assert_eq!(terminal(&result), Phase::Cancelled);
    }
}
#[tokio::test]
async fn cancelling_after_last_chunk_wins_before_cleanup() {
    let (result, _) = run_fault(
        vec![headers(), b"data: [DONE]\n\n".to_vec()],
        false,
        false,
        limits(),
        Some("chunk"),
    )
    .await;
    assert_eq!(terminal(&result), Phase::Cancelled);
}
#[tokio::test]
async fn invalid_request_releases_lease_on_error() {
    let state = InferenceState::default();
    let id = state.open("main").unwrap();
    let lease = state.start("main", &id).unwrap();
    let result = execute(
        &lease,
        request("http://secret:password@example.com/".into()),
        limits(),
        &|_| true,
    )
    .await;
    assert_eq!(result.unwrap_err().code, "unsafe-endpoint");
    drop(lease);
    assert_eq!(state.len(), 0);
}
#[tokio::test]
async fn provider_error_releases_and_keeps_status_for_sdk() {
    let (result, events) = run_fault(
        vec![b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 2\r\n\r\n{}".to_vec()],
        true,
        false,
        limits(),
        None,
    )
    .await;
    assert_eq!(result.unwrap_err().code, "provider-error");
    assert!(events
        .iter()
        .any(|e| matches!(e, Payload::Headers { status: 401, .. })));
}
#[tokio::test]
async fn shutdown_cancels_active_work_and_rejects_future_requests() {
    let state = InferenceState::default();
    let id = state.open("main").unwrap();
    let lease = state.start("main", &id).unwrap();
    let _reserved = state.open("main").unwrap();
    state.shutdown();
    assert!(lease.cancelled());
    assert!(state.open("main").is_err());
    assert_eq!(
        guarded(
            &lease,
            (Instant::now() + Duration::from_secs(1), "connect-timeout"),
            std::future::pending::<Result<(), Failure>>()
        )
        .await
        .unwrap_err()
        .code,
        "cancelled"
    );
    drop(lease);
    assert_eq!(state.len(), 0);
}
#[test]
fn policy_defaults_and_deadline_priority_are_finite() {
    let policy = Timeouts::for_policy(Policy::SelfHosted);
    assert_eq!(policy.connect.as_secs(), 10);
    assert_eq!(policy.first.unwrap().as_secs(), 120);
    assert_eq!(policy.idle.unwrap().as_secs(), 180);
    assert_eq!(policy.overall.as_secs(), 600);
    let legacy = Timeouts::for_policy(Policy::Legacy);
    assert_eq!(legacy.connect.as_secs(), 10);
    assert!(legacy.first.is_none());
    assert!(legacy.idle.is_none());
    assert_eq!(legacy.overall.as_secs(), 600);
    let now = Instant::now();
    let deadline = Deadline {
        overall: now,
        progress: Some((now + Duration::from_secs(1), "first-output-timeout")),
    };
    assert_eq!(deadline.next().1, "overall-deadline");
}
#[test]
fn parser_is_chunk_boundary_safe_and_does_not_count_metadata_or_whitespace() {
    let mut parser = Progress::default();
    for byte in b": ping\n\ndata: {\"choices\":[{\"delta\":{\"role\":\"assistant\",\"content\":\"  \"}}]}\n\n" { assert!(!parser.feed(&[*byte])); }
    let count = delta().iter().filter(|b| parser.feed(&[**b])).count();
    assert_eq!(count, 1);
    assert!(!parser.feed(b"data: [DONE]\n\n"));
    assert!(parser.complete);
}
#[test]
fn reasoning_tools_and_other_provider_formats_are_meaningful() {
    for data in [
        r#"{"choices":[{"delta":{"reasoning_content":"think"}}]}"#,
        r#"{"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"{"}}]}}]}"#,
        r#"{"type":"content_block_delta","delta":{"partial_json":"{"}}"#,
        r#"{"type":"response.output_text.delta","delta":"hello"}"#,
        r#"{"candidates":[{"content":{"parts":[{"text":"hello"}]}}]}"#,
    ] {
        assert!(Progress::default().feed(format!("data: {data}\n\n").as_bytes()));
    }
}
#[test]
fn oversized_progress_frame_is_ignored_without_unbounded_allocation() {
    let mut parser = Progress::default();
    assert!(!parser.feed(&vec![b'x'; 1024 * 1024]));
    assert!(!parser.feed(b"\n\n"));
    assert!(parser.feed(&delta()));
}

#[test]
fn ollama_ndjson_text_thinking_and_tools_advance_progress_but_empty_frames_do_not() {
    let mut parser = Progress::default();
    assert!(!parser.feed(b"{\"message\":{\"content\":\"\"},\"done\":false}\n"));
    for line in [
        r#"{"message":{"content":"hello"},"done":false}"#,
        r#"{"message":{"thinking":"thinking"},"done":false}"#,
        r#"{"message":{"tool_calls":[{"function":{"name":"echo","arguments":{"n":7}}}]},"done":false}"#,
    ] {
        assert!(parser.feed(format!("{line}\n").as_bytes()));
    }
    assert!(!parser.complete);
    assert!(!parser.feed(b"{\"done\":true,\"done_reason\":\"stop\"}\n"));
    assert!(parser.complete);
    assert!(!parser.sse);
}

#[tokio::test]
async fn preflight_refusal_makes_zero_http_calls_and_successor_sends_once() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!(
        "http://{}/v1/chat/completions",
        listener.local_addr().unwrap()
    );
    let state = InferenceState::default();
    let spec = || {
        Some(admission::Admission {
            endpoint_id: "server".into(),
            profile_id: "model".into(),
            capacity: 1,
        })
    };
    let id = state.open("main").unwrap();
    let mut lease = state.start("main", &id).unwrap();
    lease.require_preflight = true;
    let result = execute_admitted(
        &state,
        &lease,
        request(url.clone()),
        limits(),
        spec(),
        &|payload| {
            if matches!(payload, Payload::Preflight {}) {
                assert!(state.approve_preflight("other-window", &id, true).is_err());
                state.approve_preflight("main", &id, false).unwrap();
                assert!(state.approve_preflight("main", &id, true).is_err());
            }
            true
        },
    )
    .await;
    assert_eq!(result.unwrap_err().code, "context-preflight-rejected");
    assert_eq!(
        listener.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
    drop(lease);
    let received = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let count = received.clone();
    let worker = std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let mut socket = loop {
            if let Ok((socket, _)) = listener.accept() {
                break socket;
            }
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(2));
        };
        socket.set_nonblocking(false).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut bytes = [0; 4096];
        assert!(socket.read(&mut bytes).unwrap() > 0);
        count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}")
            .unwrap();
    });
    let id = state.open("main").unwrap();
    let mut lease = state.start("main", &id).unwrap();
    lease.require_preflight = true;
    execute_admitted(&state, &lease, request(url), limits(), spec(), &|payload| {
        if matches!(payload, Payload::Preflight {}) {
            state.approve_preflight("main", &id, true).unwrap();
        }
        true
    })
    .await
    .unwrap();
    worker.join().unwrap();
    assert_eq!(received.load(std::sync::atomic::Ordering::SeqCst), 1);
    drop(lease);
    assert_eq!(state.len(), 0);
}

#[tokio::test]
async fn preflight_missing_ack_times_out_without_http_and_releases_lease() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let state = InferenceState::default();
    let id = state.open("main").unwrap();
    let mut lease = state.start("main", &id).unwrap();
    lease.require_preflight = true;
    let result = execute_admitted(
        &state,
        &lease,
        request(format!(
            "http://{}/v1/chat/completions",
            listener.local_addr().unwrap()
        )),
        limits(),
        None,
        &|_| true,
    )
    .await;
    assert_eq!(result.unwrap_err().code, "preflight-timeout");
    assert_eq!(
        listener.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
    drop(lease);
    assert_eq!(state.len(), 0);
}

#[tokio::test]
async fn preflight_owner_close_cancels_before_http() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let state = InferenceState::default();
    let id = state.open("main").unwrap();
    assert!(state.approve_preflight("main", &id, true).is_err());
    let mut lease = state.start("main", &id).unwrap();
    lease.require_preflight = true;
    let result = execute_admitted(
        &state,
        &lease,
        request(format!(
            "http://{}/v1/chat/completions",
            listener.local_addr().unwrap()
        )),
        limits(),
        None,
        &|payload| {
            if matches!(payload, Payload::Preflight {}) {
                state.close_owner("main");
            }
            true
        },
    )
    .await;
    assert_eq!(result.unwrap_err().code, "cancelled");
    assert_eq!(
        listener.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
    drop(lease);
    assert_eq!(state.len(), 0);
}
