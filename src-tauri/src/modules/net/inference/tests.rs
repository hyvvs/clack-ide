use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::Mutex,
};

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
        for part in parts {
            std::thread::sleep(pace);
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
    let result = execute(&lease, request(fixture.url), timeouts, &|p| {
        let cancel = matches!(
            (&p, cancel_at),
            (Payload::Headers { .. }, Some("body")) | (Payload::Chunk { .. }, Some("chunk"))
        );
        events.lock().unwrap().push(p);
        if cancel {
            state.close_owner("main");
        }
        true
    })
    .await;
    drop(lease);
    assert_eq!(state.len(), 0);
    tokio::time::timeout(Duration::from_secs(4), fixture.closed)
        .await
        .unwrap()
        .unwrap();
    fixture.thread.join().unwrap();
    (result, events.into_inner().unwrap())
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
    assert_eq!(policy.idle.unwrap().as_secs(), 60);
    assert_eq!(policy.overall.as_secs(), 600);
    let legacy = Timeouts::for_policy(Policy::Legacy);
    assert!(legacy.first.is_none());
    assert!(legacy.idle.is_none());
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
