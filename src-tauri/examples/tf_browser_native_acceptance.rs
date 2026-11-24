//! TF4 inert-native browser acceptance. No remote WebView engine is started.
//! Only exact TF3-native HTTP policy can fetch pages; test-only local allowance
//! exists solely in TF3's isolated unit tests, not renderer / this example.
//!
//! Run:
//! cargo run --manifest-path src-tauri/Cargo.toml --locked --example tf_browser_native_acceptance
//! Optional (external public HTTPS network only):
//! $env:TF_BROWSER_PUBLIC_GET_URL="https://example.org/"
//! cargo run --manifest-path src-tauri/Cargo.toml --locked --example tf_browser_native_acceptance
use terax_lib::modules::net::tf_browser::{
    approve_headless, cancel, execute, prepare, status, TfBrowserOperation, TfBrowserRequest,
    TfBrowserState,
};
use terax_lib::modules::net::tf_web::TfWebState;
use terax_lib::modules::workspace::WorkspaceRegistry;

fn request(root: &str, operation: TfBrowserOperation) -> TfBrowserRequest {
    TfBrowserRequest {
        operation,
        actor: "native-acceptance".to_owned(),
        session_id: "acceptance-session-1".to_owned(),
        workspace_root: root.to_owned(),
        browser_session_id: None,
        page_id: None,
        page_generation: None,
        url: None,
        snapshot_id: None,
        element_id: None,
        selector: None,
        text: None,
        timeout_ms: None,
        max_bytes: None,
    }
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempfile::tempdir()?;
    let root = dir.path().to_string_lossy().into_owned();
    let registry = WorkspaceRegistry::default();
    let browser = TfBrowserState::default();
    let web = TfWebState::default();

    let mut open_req = request(&root, TfBrowserOperation::Open);
    open_req.url = Some("https://example.org/".into());
    assert!(
        prepare(open_req.clone(), &registry, &browser).is_err(),
        "an unregistered workspace MUST NOT grant browser egress"
    );
    registry.authorize(dir.path())?;
    let prepared = prepare(open_req.clone(), &registry, &browser)?;
    assert!(prepared.requires_approval);
    assert_eq!(prepared.engine, "inert_native_text");
    assert!(
        execute(&prepared.token, &registry, &browser, &web)
            .await
            .is_err(),
        "native one-use approval is mandatory for remote navigation"
    );
    assert!(
        approve_headless(&prepared.token, &browser).is_err(),
        "execution without approval consumed token"
    );

    let prepared = prepare(open_req, &registry, &browser)?;
    assert!(cancel(&prepared.token, &browser, &web)?);
    assert!(!cancel(&prepared.token, &browser, &web)?);
    assert!(execute(&prepared.token, &registry, &browser, &web)
        .await
        .is_err());
    let available = status(
        "native-acceptance",
        "acceptance-session-1",
        &root,
        None,
        &registry,
        &browser,
    )?;
    assert!(available.available && available.sessions.is_empty());
    assert_eq!(available.engine, "inert_native_text");

    // No DNS or remote network source is necessary to prove private-IP denial.
    for target in [
        "http://127.0.0.1/",
        "http://2130706433/",
        "http://169.254.169.254/latest/meta-data",
    ] {
        let mut r = request(&root, TfBrowserOperation::Open);
        r.url = Some(target.into());
        let p = prepare(r, &registry, &browser)?;
        approve_headless(&p.token, &browser)?;
        let receipt = execute(&p.token, &registry, &browser, &web).await?;
        assert_eq!(receipt.tool_id, "tf.browser_operation.v1");
        assert_eq!(receipt.reason_code, "dns-private-or-reserved-denied");
        assert!(receipt.body.is_none());
        assert!(receipt.dns_evidence.iter().all(|e| !e.socket_ip_observed));
        assert!(execute(&p.token, &registry, &browser, &web).await.is_err());
    }
    assert!(status(
        "native-acceptance",
        "acceptance-session-1",
        &root,
        None,
        &registry,
        &browser
    )?
    .sessions
    .is_empty());

    // Only when explicitly enabled: live public HTTPS navigates via TF3,
    // retains an inert text snapshot and can inspect/close it without network.
    if let Ok(url) = std::env::var("TF_BROWSER_PUBLIC_GET_URL") {
        let mut req = request(&root, TfBrowserOperation::Open);
        req.url = Some(url);
        let p = prepare(req, &registry, &browser)?;
        approve_headless(&p.token, &browser)?;
        let opened = execute(&p.token, &registry, &browser, &web).await?;
        assert_eq!(
            opened.terminal, "completed",
            "public HTTP reason={}",
            opened.reason_code
        );
        assert_eq!(opened.engine, "inert_native_text");
        assert!(opened.content_sha256.is_some());
        assert!(opened.body.as_ref().is_some_and(|s| s.len() <= 32 * 1024));
        assert!(opened.dns_evidence.iter().all(|e| !e.socket_ip_observed));
        let id = opened
            .browser_session_id
            .ok_or("missing native browser session id")?;
        let sid = opened.snapshot_id.ok_or("missing inert snapshot ref")?;
        let existing = status(
            "native-acceptance",
            "acceptance-session-1",
            &root,
            Some(&id),
            &registry,
            &browser,
        )?;
        assert!(existing.exists);
        assert_eq!(existing.snapshot_id.as_deref(), Some(sid.as_str()));
        assert_eq!(existing.sessions.len(), 1);
        let mut snap_req = request(&root, TfBrowserOperation::Snapshot);
        snap_req.browser_session_id = Some(id.clone());
        snap_req.snapshot_id = Some(sid.clone());
        let snap = prepare(snap_req, &registry, &browser)?;
        assert!(!snap.requires_approval);
        let retrieved = execute(&snap.token, &registry, &browser, &web).await?;
        assert_eq!(retrieved.body, opened.body);
        assert_eq!(retrieved.snapshot_id, Some(sid));
        assert!(
            retrieved.dns_evidence.is_empty(),
            "cached snapshot causes NO egress"
        );
        let mut close_req = request(&root, TfBrowserOperation::Close);
        close_req.browser_session_id = Some(id.clone());
        let close = prepare(close_req, &registry, &browser)?;
        let result = execute(&close.token, &registry, &browser, &web).await?;
        assert_eq!(result.reason_code, "ephemeral-browser-session-closed");
        assert!(
            !status(
                "native-acceptance",
                "acceptance-session-1",
                &root,
                Some(&id),
                &registry,
                &browser
            )?
            .exists
        );
        println!("OPTIONAL PUBLIC HTTPS inert navigation PASS: snapshot, status, close");
    } else {
        println!("PUBLIC HTTPS probe SKIPPED: opt-in via TF_BROWSER_PUBLIC_GET_URL");
    }
    println!("TF4 native acceptance PASS: workspace authorization, native approval, one-use/cancel, private/alternate-ip/metadata SSRF deny, truthful inert engine/status; no remote WebView or OS browser sandbox claim");
    Ok(())
}
