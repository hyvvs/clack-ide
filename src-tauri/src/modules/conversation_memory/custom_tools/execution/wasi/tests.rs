use super::*;

static TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn fixture(wat: &str) -> (tempfile::TempDir, Prepared, PathBuf) {
    let root = tempfile::tempdir().unwrap();
    let bytes = wat::parse_str(wat).unwrap();
    let module = root.path().join("module.wasm");
    fs::write(&module, &bytes).unwrap();
    let mut definition: Definition = serde_json::from_value(json!({"name":"custom_wasi","description":"Confined JSON function","inputSchema":{"type":"object","properties":{"value":{"type":"string","maxLength":200}},"additionalProperties":false},"outputSchema":{"type":"object","properties":{"value":{"type":"string","maxLength":200}},"additionalProperties":false},"outputDescription":"JSON result","binding":{"kind":"native","operation":"read_file"},"scope":"conversation","agents":["builtin:coder"],"conversations":["chat"],"permissions":["run-commands"],"credentialRef":null,"timeoutMs":1000,"outputBytes":8192})).unwrap();
    definition.binding = functions::binding(digest(&bytes));
    validate(&definition).unwrap();
    let arguments = json!({"value":"approved"});
    let mut record = super::super::tests::record();
    record.kind = "wasi".into();
    record.function = Some(definition.binding.clone());
    record.tool.hash = definition_hash(&definition).unwrap();
    record.arguments_hash = schema::arguments(&definition, &arguments).unwrap();
    record.permissions = definition.permissions.clone();
    record.state = "awaiting-approval".into();
    record.approval = None;
    record.effect = "none".into();
    record.transitions = vec![(record.state.clone(), now())];
    let prepared = Prepared {
        access: Access {
            session: "chat".into(),
            workspace: "local:/work".into(),
            agent: "builtin:coder".into(),
            run: Some(1),
        },
        record,
        definition,
        arguments,
        root: root.path().canonicalize().unwrap(),
        policy: "captured".into(),
        checked_revision: 0.into(),
        started: AtomicBool::new(false),
        mcp: None,
    };
    (root, prepared, module)
}

const ECHO: &str = r#"(module
 (import "wasi_snapshot_preview1" "fd_read" (func $read (param i32 i32 i32 i32) (result i32)))
 (import "wasi_snapshot_preview1" "fd_write" (func $write (param i32 i32 i32 i32) (result i32)))
 (memory (export "memory") 1)
 (func (export "_start")
  (i32.store (i32.const 0) (i32.const 100)) (i32.store (i32.const 4) (i32.const 16000))
  (if (call $read (i32.const 0) (i32.const 0) (i32.const 1) (i32.const 8)) (then unreachable))
  (i32.store (i32.const 4) (i32.load (i32.const 8)))
  (if (call $write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 8)) (then unreachable))))"#;

async fn invoke(
    prepared: &Prepared,
    module: PathBuf,
    path: PathBuf,
    stop: Arc<AtomicBool>,
) -> Result<Value> {
    if schema::arguments(&prepared.definition, &prepared.arguments)?
        != prepared.record.arguments_hash
    {
        return Err("stale-approval".into());
    }
    let policy = captured_policy(prepared, module)?;
    let state = crate::modules::net::inference::InferenceState::default();
    let id = state.open(&policy.owner).unwrap();
    let lease = state.start(&policy.owner, &id).unwrap();
    let mut record = prepared.record.clone();
    consume(&mut record, &prepared.record, id.clone()).unwrap();
    approve(&mut record, &prepared.record, true).unwrap();
    let journal = confinement::fixture_record(path.clone(), &policy, stop, false, record);
    let stage = staging::Prepared::new(policy, vec![], vec![])
        .map_err(error)?
        .json_input(schema::bounded_json(&prepared.arguments, MAX_INPUT)?)
        .map_err(error)?;
    let completed = stage.execute(lease, journal).await.map_err(error)?;
    assert!(state.completion(&id).is_none());
    let store = session_file::SessionFile::default();
    let mut ledger = read_ledger(&store, &path).unwrap();
    assert_eq!(
        ledger.records[0].state, "running",
        "cleanup must not imply valid JSON"
    );
    assert!(ledger.records[0].result.is_none());
    let outcome = result(&prepared.definition, completed);
    settle(&mut ledger.records[0], outcome.clone());
    write_ledger(&store, &path, &ledger).unwrap();
    let restarted = read_ledger(&session_file::SessionFile::default(), &path).unwrap();
    assert_eq!(
        restarted.records[0].function,
        Some(prepared.definition.binding.clone())
    );
    assert!(terminal(&restarted.records[0].state));
    assert!(!consume(&mut ledger.records[0], &prepared.record, "replay".into()).unwrap());
    outcome
}

#[tokio::test]
async fn wasi_json_abi_uses_real_approved_module_and_bounded_d1_execution() {
    let _guard = TEST_LOCK.lock().await;
    let (root, mut p, module) = fixture(ECHO);
    if functions::platform_verified() {
        let registry = registry_action(&registered(&p), &p.access, "enable").unwrap();
        let entry = &registry.entries[0];
        p.record.tool = Reference {
            id: entry.id.clone(),
            version: latest(entry).version,
            hash: latest(entry).hash.clone(),
        };
        assert_eq!(
            authorized_version(&registry, &p.access, &p.record.tool)
                .unwrap()
                .definition
                .binding,
            p.definition.binding
        );
    }
    let mut record = p.record.clone();
    consume(&mut record, &p.record, "lease".into()).unwrap();
    approve(&mut record, &p.record, true).unwrap();
    assert!(record.approval.is_some());
    assert_eq!(
        invoke(
            &p,
            module.clone(),
            root.path().join("ledger.json"),
            Arc::new(false.into())
        )
        .await
        .unwrap(),
        p.arguments
    );
    p.arguments = json!({"value":"next"});
    assert_eq!(
        invoke(
            &p,
            module.clone(),
            root.path().join("stale.json"),
            Arc::new(false.into())
        )
        .await
        .unwrap_err(),
        "stale-approval"
    );
    let mut changed = p.record.clone();
    changed.arguments_hash = schema::arguments(&p.definition, &p.arguments).unwrap();
    assert!(approve(&mut record, &changed, true).is_err());
    p.record = changed;
    assert_eq!(
        invoke(
            &p,
            module,
            root.path().join("other.json"),
            Arc::new(false.into())
        )
        .await
        .unwrap(),
        p.arguments
    );
}

#[tokio::test]
async fn wasi_output_validation_rejects_malformed_utf8_json_and_schema_mismatch() {
    let _guard = TEST_LOCK.lock().await;
    for output in ["\\ff", "broken", "42", "{\\22wrong\\22:true}"] {
        let code = format!(
            r#"(module (import "wasi_snapshot_preview1" "fd_write" (func $w (param i32 i32 i32 i32) (result i32))) (memory (export "memory") 1)
          (data (i32.const 100) "{output}") (func (export "_start")
          (i32.store (i32.const 0) (i32.const 100)) (i32.store (i32.const 4) (i32.const {}))
          (drop (call $w (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 8)))))"#,
            if output == "\\ff" {
                1
            } else if output.contains("\\22") {
                14
            } else {
                output.len()
            }
        );
        let (root, p, module) = fixture(&code);
        let failure = invoke(
            &p,
            module,
            root.path().join("ledger.json"),
            Arc::new(false.into()),
        )
        .await
        .unwrap_err();
        assert!(
            matches!(
                failure.as_str(),
                "invalid-output" | "output-schema-mismatch"
            ),
            "{failure}"
        );
    }
}

#[tokio::test]
async fn wasi_substitution_and_host_paths_in_arguments_never_grant_access() {
    let _guard = TEST_LOCK.lock().await;
    let (root, mut p, module) = fixture(ECHO);
    p.arguments = json!({"value":root.path().join(".env").to_string_lossy()});
    p.record.arguments_hash = schema::arguments(&p.definition, &p.arguments).unwrap();
    fs::write(root.path().join(".env"), b"SECRET").unwrap();
    let value = invoke(
        &p,
        module.clone(),
        root.path().join("ledger.json"),
        Arc::new(false.into()),
    )
    .await
    .unwrap();
    assert!(!value.to_string().contains("SECRET"));
    fs::write(module.clone(), b"new unapproved bytes").unwrap();
    assert_eq!(
        invoke(
            &p,
            module,
            root.path().join("other.json"),
            Arc::new(false.into())
        )
        .await
        .unwrap_err(),
        "tool_wasi_invalid_module"
    );
}

#[tokio::test]
async fn wasi_infinite_guest_times_out_and_revocation_interrupts_without_result() {
    let _guard = TEST_LOCK.lock().await;
    let code = r#"(module (memory (export "memory") 1) (func (export "_start") (loop br 0)))"#;
    let (root, mut p, module) = fixture(code);
    p.definition.timeout_ms = 100;
    assert_eq!(
        invoke(
            &p,
            module,
            root.path().join("timed.json"),
            Arc::new(false.into())
        )
        .await
        .unwrap_err(),
        "timed-out"
    );
    let (root, p, module) = fixture(code);
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let revoke = async move {
        tokio::time::sleep(Duration::from_millis(50)).await;
        flag.store(true, Ordering::Release);
    };
    let (outcome, ()) = tokio::join!(
        invoke(&p, module, root.path().join("revoked.json"), stop),
        revoke
    );
    assert_eq!(outcome.unwrap_err(), "cancelled");
}

fn registered(p: &Prepared) -> Registry {
    let draft = apply(
        &Registry::default(),
        &p.access,
        0,
        Change::Create {
            definition: p.definition.clone(),
        },
        Authority::NativeUser,
    )
    .unwrap();
    registry_action(&draft, &p.access, "authorize").unwrap()
}

fn registry_action(registry: &Registry, access: &Access, action: &str) -> Result<Registry> {
    apply(
        registry,
        access,
        registry.revision,
        serde_json::from_value(json!({"action": action, "id": registry.entries[0].id})).unwrap(),
        Authority::NativeUser,
    )
}

#[test]
fn wasi_authorization_scope_permissions_and_unverified_platforms_fail_closed() {
    let (_root, p, _module) = fixture(ECHO);
    let authorized = registered(&p);
    assert!(!eligible(&authorized.entries[0], &p.access));
    let enabled = registry_action(&authorized, &p.access, "enable");
    if !functions::platform_verified() {
        assert!(enabled.unwrap_err().contains("unverified"));
        assert!(!supported(&p.definition));
        return;
    }
    let registry = enabled.unwrap();
    let entry = &registry.entries[0];
    let reference = Reference {
        id: entry.id.clone(),
        version: latest(entry).version,
        hash: latest(entry).hash.clone(),
    };
    assert!(authorized_version(&registry, &p.access, &reference).is_ok());
    for access in [
        Access {
            agent: "other".into(),
            ..p.access.clone()
        },
        Access {
            session: "other".into(),
            ..p.access.clone()
        },
        Access {
            workspace: "local:/other".into(),
            ..p.access.clone()
        },
        Access {
            workspace: "wsl:Ubuntu:/work".into(),
            ..p.access.clone()
        },
    ] {
        assert!(authorized_version(&registry, &access, &reference).is_err());
    }
    let mut d = p.definition.clone();
    d.credential_ref = Some("keyring:secret".into());
    assert!(validate(&d).is_err());
    d.credential_ref = None;
    d.permissions.push("network".into());
    assert!(validate(&d).is_err());
    for action in ["authorize", "enable", "edit", "revoke"] {
        let change = if action == "edit" {
            Change::Edit {
                id: entry.id.clone(),
                definition: p.definition.clone(),
            }
        } else {
            serde_json::from_value(json!({"action":action,"id":entry.id})).unwrap()
        };
        assert!(apply(
            &registry,
            &p.access,
            registry.revision,
            change,
            Authority::Proposal
        )
        .is_err());
    }
}

#[test]
fn wasi_active_version_freezes_but_queued_approval_and_explicit_revocation_do_not() {
    let (_root, p, _module) = fixture(ECHO);
    let authorized = registered(&p);
    if !functions::platform_verified() {
        return;
    }
    let registry = registry_action(&authorized, &p.access, "enable").unwrap();
    let entry = &registry.entries[0];
    let reference = Reference {
        id: entry.id.clone(),
        version: latest(entry).version,
        hash: latest(entry).hash.clone(),
    };
    let mut d = p.definition.clone();
    d.binding = functions::binding("f".repeat(64));
    let edited = apply(
        &registry,
        &p.access,
        registry.revision,
        Change::Edit {
            id: reference.id.clone(),
            definition: d,
        },
        Authority::NativeUser,
    )
    .unwrap();
    assert!(authorized_version(&edited, &p.access, &reference).is_err());
    assert_eq!(
        active_version(&edited, &p.access, &reference)
            .unwrap()
            .definition
            .binding,
        p.definition.binding
    );
    assert!(!latest(&edited.entries[0]).enabled);
    assert_eq!(latest(&edited.entries[0]).status, "draft");
    for action in ["disable", "revoke", "remove"] {
        let stopped = registry_action(&edited, &p.access, action).unwrap();
        assert!(
            active_version(&stopped, &p.access, &reference).is_err(),
            "{action}"
        );
        assert!(authorized_version(&stopped, &p.access, &reference).is_err());
    }
    let new = registry_action(
        &registry_action(&edited, &p.access, "authorize").unwrap(),
        &p.access,
        "enable",
    )
    .unwrap();
    assert!(active_version(&new, &p.access, &reference).is_ok());
    let latest_ref = Reference {
        id: reference.id.clone(),
        version: latest(&new.entries[0]).version,
        hash: latest(&new.entries[0]).hash.clone(),
    };
    assert!(authorized_version(&new, &p.access, &latest_ref).is_ok());
    assert!(authorized_version(&new, &p.access, &reference).is_err());
    let disabled = registry_action(&new, &p.access, "disable").unwrap();
    let reenabled = registry_action(&disabled, &p.access, "enable").unwrap();
    assert!(active_version(&reenabled, &p.access, &reference).is_err());
    let restored: Registry =
        serde_json::from_slice(&serde_json::to_vec(&reenabled).unwrap()).unwrap();
    assert!(active_version(&restored, &p.access, &reference).is_err());
}

#[tokio::test]
async fn wasi_function_floods_memory_and_stderr_are_bounded_separately_from_json() {
    let _guard = TEST_LOCK.lock().await;
    for fd in [1, 2] {
        let code = format!(
            r#"(module (import "wasi_snapshot_preview1" "fd_write" (func $w (param i32 i32 i32 i32) (result i32)))
          (memory (export "memory") 1) (func (export "_start") (i32.store (i32.const 0) (i32.const 100))
          (i32.store (i32.const 4) (i32.const 8193)) (drop (call $w (i32.const {fd}) (i32.const 0) (i32.const 1) (i32.const 8)))))"#
        );
        let (root, p, module) = fixture(&code);
        assert_eq!(
            invoke(
                &p,
                module,
                root.path().join("flood.json"),
                Arc::new(false.into())
            )
            .await
            .unwrap_err(),
            "output-limit"
        );
    }
    let code = r#"(module (memory (export "memory") 1) (func (export "_start") (drop (memory.grow (i32.const 1024)))))"#;
    let (root, p, module) = fixture(code);
    assert_eq!(
        invoke(
            &p,
            module,
            root.path().join("memory.json"),
            Arc::new(false.into())
        )
        .await
        .unwrap_err(),
        "native-failed"
    );
    let code = r#"(module (import "wasi_snapshot_preview1" "fd_write" (func $w (param i32 i32 i32 i32) (result i32)))
        (memory (export "memory") 1) (data (i32.const 100) "{}diagnostic") (func (export "_start")
        (i32.store (i32.const 0) (i32.const 100)) (i32.store (i32.const 4) (i32.const 2))
        (drop (call $w (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 8)))
        (i32.store (i32.const 0) (i32.const 102)) (i32.store (i32.const 4) (i32.const 10))
        (drop (call $w (i32.const 2) (i32.const 0) (i32.const 1) (i32.const 8)))))"#;
    let (root, p, module) = fixture(code);
    assert_eq!(
        invoke(
            &p,
            module,
            root.path().join("stderr.json"),
            Arc::new(false.into())
        )
        .await
        .unwrap(),
        json!({})
    );
    assert!(!fs::read_to_string(root.path().join("stderr.json"))
        .unwrap()
        .contains("diagnostic"));
}

#[tokio::test]
async fn wasi_function_has_no_workspace_secret_environment_or_extra_preopen() {
    let _guard = TEST_LOCK.lock().await;
    let workspace = tempfile::tempdir().unwrap();
    let secret = workspace.path().join(".env");
    fs::write(&secret, "HOST_SECRET").unwrap();
    let ordinary = workspace.path().join("file.txt");
    fs::write(&ordinary, "WORKSPACE").unwrap();
    fs::hard_link(&ordinary, workspace.path().join("alias.txt")).unwrap();
    for path in [
        secret.to_string_lossy().into_owned(),
        ordinary.to_string_lossy().into_owned(),
        "../.env".into(),
        "alias.txt".into(),
    ] {
        let encoded = path
            .bytes()
            .map(|b| format!("\\{b:02x}"))
            .collect::<String>();
        let code = format!(
            r#"(module
          (import "wasi_snapshot_preview1" "path_open" (func $open (param i32 i32 i32 i32 i32 i64 i64 i32 i32) (result i32)))
          (import "wasi_snapshot_preview1" "environ_sizes_get" (func $env (param i32 i32) (result i32)))
          (import "wasi_snapshot_preview1" "fd_prestat_get" (func $pre (param i32 i32) (result i32)))
          (import "wasi_snapshot_preview1" "fd_write" (func $w (param i32 i32 i32 i32) (result i32)))
          (memory (export "memory") 1) (data (i32.const 100) "{encoded}") (data (i32.const 4000) "{{}}")
          (func (export "_start")
           (if (i32.eqz (call $open (i32.const 3) (i32.const 0) (i32.const 100) (i32.const {}) (i32.const 0) (i64.const 2) (i64.const 0) (i32.const 0) (i32.const 16))) (then unreachable))
           (drop (call $env (i32.const 20) (i32.const 24))) (if (i32.load (i32.const 20)) (then unreachable))
           (if (i32.eqz (call $pre (i32.const 4) (i32.const 28))) (then unreachable))
           (i32.store (i32.const 0) (i32.const 4000)) (i32.store (i32.const 4) (i32.const 2))
           (drop (call $w (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 8)))))"#,
            path.len()
        );
        let (root, p, module) = fixture(&code);
        boundary::validate_function(&fs::read(&module).unwrap()).unwrap();
        assert_eq!(
            invoke(
                &p,
                module,
                root.path().join("isolated.json"),
                Arc::new(false.into())
            )
            .await
            .unwrap(),
            json!({})
        );
    }
    assert_eq!(fs::read_to_string(&secret).unwrap(), "HOST_SECRET");
    assert_eq!(fs::read_to_string(&ordinary).unwrap(), "WORKSPACE");
}

#[test]
fn wasi_interrupted_execution_restarts_without_replay_or_fabricated_result() {
    let (root, p, _module) = fixture(ECHO);
    let mut record = p.record.clone();
    consume(&mut record, &p.record, "previous-process".into()).unwrap();
    approve(&mut record, &p.record, true).unwrap();
    record.epoch = "previous-epoch".into();
    let path = root.path().join("registry.json");
    let store = session_file::SessionFile::default();
    write_ledger(
        &store,
        &path,
        &Ledger {
            version: 1,
            records: vec![record],
        },
    )
    .unwrap();
    let mut recovered = read_ledger(&session_file::SessionFile::default(), &path).unwrap();
    assert_eq!(recovered.records[0].state, "interrupted");
    assert!(recovered.records[0].result.is_none());
    assert_eq!(recovered.records[0].function, p.record.function);
    let old = recovered.records[0].clone();
    assert!(!consume(&mut recovered.records[0], &old, "new-process".into()).unwrap());
    assert!(!recover(&mut recovered, &MEMORY_EPOCH));
}
