use super::*;
use serde_json::json;
use std::process::Command;

fn config() -> Config {
    Config {
        host: "lab.example".into(),
        username: "user".into(),
        port: 22,
        key_path: Some("C:/Users/Name With Spaces/.ssh/key".into()),
        remote_host: "127.0.0.1".into(),
        remote_port: 11434,
    }
}
pub(super) fn slot() -> Arc<Slot> {
    Arc::new(Slot {
        config: config(),
        revision: 1,
        generation: AtomicU64::new(0),
        operation: Mutex::new(()),
        flight: tokio::sync::Mutex::new(()),
        runtime: Mutex::new(Runtime::default()),
    })
}
fn sleeper() -> OwnedChild {
    #[cfg(windows)]
    let cmd = {
        let mut c = Command::new("C:/Windows/System32/ping.exe");
        c.args(["-n", "60", "127.0.0.1"]);
        c
    };
    #[cfg(not(windows))]
    let cmd = {
        let mut c = Command::new("/bin/sleep");
        c.arg("60");
        c
    };
    OwnedChild::spawn(cmd).unwrap()
}

#[test]
fn config_roundtrip_contains_only_references_and_default_loopback_target() {
    let c = config();
    let value = serde_json::to_value(&c).unwrap();
    assert_eq!(serde_json::from_value::<Config>(value.clone()).unwrap(), c);
    assert_eq!(value["remoteHost"], "127.0.0.1");
    assert_eq!(value["remotePort"], 11434);
    assert!(!value.to_string().contains("PRIVATE KEY"));
    assert!(value.get("pid").is_none());
}
#[test]
fn injection_and_non_loopback_destinations_fail_closed() {
    for host in [
        "-oProxyCommand=evil",
        "host\ncommand",
        "host;whoami",
        "user@host",
        "host:22",
        "",
        "host/path",
    ] {
        let mut c = config();
        c.host = host.into();
        assert!(c.validate().is_err(), "{host}");
    }
    for remote in ["169.254.169.254", "192.168.1.2", "example.com", "0.0.0.0"] {
        let mut c = config();
        c.remote_host = remote.into();
        assert!(c.validate().is_err());
    }
    let mut c = config();
    c.port = 0;
    assert!(c.validate().is_err());
}
#[test]
fn structured_arguments_preserve_spaces_and_disable_shell_proxy_password_and_global_config() {
    let c = config();
    let a = ssh_args(&c, Path::new("C:/App Data/ssh-hosts/id"), 53281);
    assert!(a
        .windows(2)
        .any(|a| a == ["-i", c.key_path.as_ref().unwrap()]));
    for option in [
        "StrictHostKeyChecking=yes",
        "GlobalKnownHostsFile=none",
        "ForwardAgent=no",
        "PermitLocalCommand=no",
        "ProxyCommand=none",
        "BatchMode=yes",
        "PasswordAuthentication=no",
        "UpdateHostKeys=no",
    ] {
        assert!(a.contains(&option.into()), "{option}");
    }
    assert!(a.contains(&"127.0.0.1:53281:127.0.0.1:11434".into()));
    assert!(!a.contains(&"-g".into()));
    assert!(a.contains(&"-N".into()));
    assert_eq!(a.last().unwrap(), &c.host);
}
#[cfg(unix)]
#[test]
fn guardian_wrapper_preserves_argument_boundaries_in_unit_builds() {
    let mut original = Command::new("/path with spaces/ssh");
    original.args(["-i", "/home/test/clé key", "-N"]);
    let guarded = guardian::command(original).unwrap();
    let args: Vec<_> = guarded
        .get_args()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        args,
        [
            guardian::FLAG,
            "/path with spaces/ssh",
            "-i",
            "/home/test/clé key",
            "-N"
        ]
    );
}
#[test]
fn key_observation_cannot_authenticate_forward_execute_or_modify_actual_trust() {
    let a = observe_args(&config(), "192.0.2.1", Path::new("isolated.observed"));
    for option in [
        "PreferredAuthentications=none",
        "PubkeyAuthentication=no",
        "IdentityAgent=none",
        "PasswordAuthentication=no",
        "KbdInteractiveAuthentication=no",
        "GlobalKnownHostsFile=none",
    ] {
        assert!(a.contains(&option.into()));
    }
    for argument in ["-L", "-i", "-R", "-D"] {
        assert!(!a.contains(&argument.into()));
    }
    assert!(a.iter().any(|v| v.contains("isolated.observed")));
}
#[test]
fn metadata_and_unspecified_ssh_hosts_are_rejected_before_handshake() {
    for host in ["169.254.169.254", "0.0.0.0", "metadata.google.internal"] {
        let mut c = config();
        c.host = host.into();
        assert!(safe_address(&c).is_err());
    }
}
#[test]
fn advanced_port_and_ipv6_loopback_are_explicit_not_scanned() {
    let mut c = config();
    c.remote_port = 12000;
    c.port = 2222;
    c.remote_host = "::1".into();
    c.validate().unwrap();
    let a = ssh_args(&c, Path::new("known"), 43000);
    assert!(a.contains(&"127.0.0.1:43000:[::1]:12000".into()));
    assert_eq!(c.host_pattern(), "[lab.example]:2222");
}
#[test]
fn first_use_requires_pending_exact_fingerprint_confirmation() {
    let key = "ssh-ed25519 AAAATEST";
    let fp = "SHA256:test";
    assert_eq!(
        trust_decision(None, key, fp, None, None, false).unwrap_err(),
        "verification-required"
    );
    assert!(trust_decision(None, key, fp, None, Some(fp), false).is_err());
    let pending = (key.into(), fp.into());
    assert_eq!(
        trust_decision(None, key, fp, Some(&pending), Some(fp), false).unwrap(),
        "Explicit fingerprint confirmation"
    );
    assert!(trust_decision(
        None,
        "ssh-ed25519 changed",
        fp,
        Some(&pending),
        Some(fp),
        false
    )
    .is_err());
}
#[test]
fn existing_trust_and_changed_key_never_silently_replace() {
    let known = "host ssh-ed25519 AAAATEST";
    assert_eq!(
        trust_decision(Some(known), "ssh-ed25519 AAAATEST", "fp", None, None, false).unwrap(),
        "Clack trusted host"
    );
    assert_eq!(
        trust_decision(
            Some(known),
            "ssh-ed25519 CHANGED",
            "fp",
            None,
            Some("fp"),
            true
        )
        .unwrap_err(),
        "host-key-changed"
    );
    assert_eq!(
        trust_decision(None, "ssh-ed25519 AAAATEST", "fp", None, None, true).unwrap(),
        "System known_hosts"
    );
}
#[test]
fn malformed_public_evidence_is_not_trusted() {
    assert!(public_key("# comment\nmalformed").is_none());
    assert!(public_key("host ssh-rsa AAAA").is_none());
    assert!(public_key("host ssh-ed25519 AAAA;evil").is_none());
    assert!(system_key_decision("@revoked host ssh-ed25519 AAAA", "ssh-ed25519 AAAA").is_err());
    assert!(system_key_decision(
        "host ssh-ed25519 AAAA\nhost ssh-ed25519 BBBB",
        "ssh-ed25519 AAAA"
    )
    .is_err());
}
#[test]
fn trust_scope_is_host_and_port_not_local_forward_or_user() {
    let a = config();
    let mut b = a.clone();
    b.username = "other".into();
    assert_eq!(a.trust_id(), b.trust_id());
    b.port = 2222;
    assert_ne!(a.trust_id(), b.trust_id());
}
#[test]
fn logical_identity_is_stable_distinct_and_has_no_transient_port() {
    assert_eq!(logical_url("a"), "http://clack-ssh.invalid/61/");
    assert_ne!(logical_url("a"), logical_url("b"));
    assert!(!logical_url("a").contains("11435"));
}
#[test]
fn persisted_transport_is_bound_to_endpoint_and_cannot_carry_http_credentials() {
    let mut e = json!({"id":"a","baseURL":logical_url("a"),"credentialRef":null,"ssh":config()});
    validate_endpoint(&e).unwrap();
    e["baseURL"] = json!(logical_url("b"));
    assert!(validate_endpoint(&e).is_err());
    e["baseURL"] = json!(logical_url("a"));
    e["credentialRef"] = json!({"kind":"provider"});
    assert!(validate_endpoint(&e).is_err());
}
#[test]
fn direct_http_https_and_legacy_endpoints_are_unchanged() {
    for raw in [
        "http://localhost:1234/proxy/v1",
        "https://server.test/proxy/v1",
    ] {
        let u = reqwest::Url::parse(raw).unwrap();
        assert_eq!(resolve(u.clone()).unwrap(), u);
        validate_endpoint(&json!({"baseURL":raw})).unwrap();
    }
}
#[test]
fn unknown_managed_route_never_uses_dns_or_global_fallback() {
    assert!(resolve(
        reqwest::Url::parse("http://clack-ssh.invalid/not-an-owner/api/chat").unwrap()
    )
    .is_err());
}
#[test]
fn disconnected_restart_state_has_no_pid_or_replayed_child() {
    let s = slot();
    assert_eq!(current_status(&s).state, "disconnected");
    assert!(s.runtime.lock().unwrap().child.is_none());
    assert_eq!(
        serde_json::to_value(current_status(&s)).unwrap().get("pid"),
        None
    );
}
#[test]
fn owned_cleanup_cancellation_and_process_death_do_not_kill_another_child() {
    let mut unrelated = sleeper();
    let s = slot();
    s.runtime.lock().unwrap().child = Some(sleeper());
    stop(&s);
    assert!(s.runtime.lock().unwrap().child.is_none());
    assert!(unrelated.alive());
    assert_eq!(s.generation.load(Ordering::SeqCst), 1);
    assert_eq!(
        finish(&s, 0, Status::new("connected")).unwrap().state,
        "disconnected"
    );
    assert_eq!(current_status(&s).state, "disconnected");
    let mut dead = sleeper();
    dead.child.kill().unwrap();
    dead.child.wait().unwrap();
    s.runtime.lock().unwrap().child = Some(dead);
    assert_eq!(current_status(&s).state, "offline");
    assert!(unrelated.alive());
}
#[test]
fn one_connection_serializes_operations_without_blocking_other_connections() {
    let a = slot();
    let b = slot();
    let _lock = a.operation.lock().unwrap();
    assert!(a.operation.try_lock().is_err());
    assert!(b.operation.try_lock().is_ok());
}
#[test]
fn runtime_port_changes_remap_routes_without_changing_logical_identity_and_removal_revokes_them() {
    let id = "native-ssh-test-only";
    let s = slot();
    {
        let mut r = s.runtime.lock().unwrap();
        r.child = Some(sleeper());
        r.status.state = "connected".into();
        r.port = Some(51001);
    }
    slots().lock().unwrap().insert(id.into(), s.clone());
    let logical = format!("{}v1/chat/completions", logical_url(id));
    assert_eq!(
        resolve(logical.parse().unwrap()).unwrap().as_str(),
        "http://127.0.0.1:51001/v1/chat/completions"
    );
    s.runtime.lock().unwrap().port = Some(51002);
    assert_eq!(
        resolve(logical.parse().unwrap()).unwrap().as_str(),
        "http://127.0.0.1:51002/v1/chat/completions"
    );
    stop(&s);
    assert!(resolve(logical.parse().unwrap()).is_err());
    slots().lock().unwrap().remove(id);
}
#[test]
fn ephemeral_allocation_is_loopback_only_and_independent() {
    let a = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let b = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    assert!(a.local_addr().unwrap().ip().is_loopback());
    assert_ne!(a.local_addr().unwrap(), b.local_addr().unwrap());
}
#[test]
fn unreadable_key_does_not_attempt_network_or_authenticate() {
    let mut s = slot();
    Arc::get_mut(&mut s).unwrap().config.key_path = Some("/missing-private-key".into());
    s.runtime.lock().unwrap().pinned = true;
    let result = connect(&s, Path::new("/not-used"), None, None).unwrap();
    assert_eq!(result.state, "key-unreadable");
    assert!(
        connect(&s, Path::new("/not-used"), None, None).is_err(),
        "bounded reconnect backoff"
    );
}
