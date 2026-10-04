use super::*;

#[test]
fn wasi_registration_validates_bytes_imports_entrypoint_and_abi_without_execution() {
    let valid = wat::parse_str(r#"(module (memory (export "memory") 1) (func (export "_start")))"#)
        .unwrap();
    confinement::validate_function(&valid).unwrap();
    let loops_at_start = wat::parse_str(r#"(module (memory (export "memory") 1) (func $init (loop br 0)) (start $init) (func (export "_start")))"#).unwrap();
    confinement::validate_function(&loops_at_start).unwrap();
    for source in [
        r#"(module (memory (export "memory") 1))"#,
        r#"(module (memory (export "memory") 1) (func (export "_start") (param i32)))"#,
        r#"(module (func (export "_start")))"#,
        r#"(module (import "env" "system" (func)) (memory (export "memory") 1) (func (export "_start")))"#,
        r#"(module (import "wasi_snapshot_preview1" "sock_open" (func)) (memory (export "memory") 1) (func (export "_start")))"#,
        r#"(module (import "wasi_snapshot_preview1" "fd_write" (func)) (memory (export "memory") 1) (func (export "_start")))"#,
        r#"(module (memory (export "memory") 1025) (func (export "_start")))"#,
    ] {
        assert!(
            confinement::validate_function(&wat::parse_str(source).unwrap()).is_err(),
            "{source}"
        );
    }
    for bytes in [b"not wasm".to_vec(), vec![0; MAX_MODULE + 1]] {
        assert!(confinement::validate_function(&bytes).is_err());
    }
    let b = binding(digest(&valid));
    validate_binding(&b).unwrap();
    for (key, value) in [
        ("abi", json!("native")),
        ("runtime", json!("old")),
        ("schemaVersion", json!(2)),
        ("hash", json!("../bad")),
        ("export", json!("other")),
    ] {
        let mut raw = serde_json::to_value(&b).unwrap();
        raw[key] = value;
        assert!(validate_binding(&serde_json::from_value(raw).unwrap()).is_err());
    }
}

#[test]
fn wasi_content_is_immutable_and_not_a_mutable_source_path() {
    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("source.wasm");
    let bytes = wat::parse_str(r#"(module (memory (export "memory") 1) (func (export "_start")))"#)
        .unwrap();
    fs::write(&source, &bytes).unwrap();
    let reviewed = read_import(&source).unwrap();
    let content = put_content_in(&root.path().join("store"), &reviewed).unwrap();
    fs::write(&source, b"changed").unwrap();
    assert_eq!(
        read_content_from(&root.path().join("store"), &content.id).unwrap(),
        bytes
    );
    assert!(read_import(&source).is_err());
    fs::write(root.path().join("store").join(&content.id), b"substituted").unwrap();
    assert!(read_content_from(&root.path().join("store"), &content.id).is_err());
}

#[test]
fn wasi_module_ownership_history_retention_and_collection_use_existing_store() {
    let root = tempfile::tempdir().unwrap();
    let owner = Access {
        session: "chat".into(),
        workspace: "local:/work".into(),
        agent: "builtin:coder".into(),
        run: Some(1),
    };
    let mut definition = super::super::tests::definition();
    let first = put_content_in(root.path(), &wat::parse_str("(module)").unwrap())
        .unwrap()
        .id;
    let second = put_content_in(root.path(), &wat::parse_str("(module (memory 1))").unwrap())
        .unwrap()
        .id;
    let orphan = put_content_in(root.path(), b"unreferenced failed import")
        .unwrap()
        .id;
    definition.binding = binding(first.clone());
    definition.permissions = vec!["run-commands".into()];
    definition.output_bytes = 16384;
    let registry = apply(
        &Registry::default(),
        &owner,
        0,
        Change::Create {
            definition: definition.clone(),
        },
        Authority::NativeUser,
    )
    .unwrap();
    let id = registry.entries[0].id.clone();
    definition.binding = binding(second.clone());
    let edited = apply(
        &registry,
        &owner,
        registry.revision,
        Change::Edit {
            id: id.clone(),
            definition,
        },
        Authority::NativeUser,
    )
    .unwrap();
    let removed = apply(
        &edited,
        &owner,
        edited.revision,
        Change::Remove { id },
        Authority::NativeUser,
    )
    .unwrap();
    assert!(known_module(&removed, &owner, &first));
    let foreign = Access {
        workspace: "local:/other".into(),
        ..owner.clone()
    };
    assert!(!known_module(&removed, &foreign, &first));
    assert!(!known_module(&removed, &owner, &orphan));
    let roots = module_roots(&removed);
    assert_eq!(roots.len(), 2);
    crate::modules::attachments::reconcile_store(root.path(), &roots).unwrap();
    assert!(root.path().join(first).exists());
    assert!(root.path().join(second).exists());
    assert!(!root.path().join(orphan).exists());
    let reloaded: Registry =
        serde_json::from_slice(&serde_json::to_vec(&removed).unwrap()).unwrap();
    validate_registry(&reloaded).unwrap();
    assert_eq!(module_roots(&reloaded), roots);
}

#[test]
fn wasi_import_protects_secrets_and_oversized_files() {
    let root = tempfile::tempdir().unwrap();
    let bytes = wat::parse_str(r#"(module (memory (export "memory") 1) (func (export "_start")))"#)
        .unwrap();
    let secret = root.path().join(".env");
    fs::write(&secret, bytes).unwrap();
    assert_eq!(read_import(&secret).unwrap_err(), "protected-path");
    let large = root.path().join("large.wasm");
    fs::write(&large, vec![0; MAX_MODULE + 1]).unwrap();
    assert!(read_import(&large).is_err());
}
