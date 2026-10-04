use super::super::tests::policy;
use super::*;

fn fixture() -> (tempfile::TempDir, Policy, Input) {
    let root = tempfile::tempdir().unwrap();
    #[cfg(windows)]
    let path = root.path().to_path_buf();
    #[cfg(unix)]
    let path = root.path().canonicalize().unwrap();
    let binary = path.join("reviewed.exe");
    let input = path.join("approved.txt");
    std::fs::write(&binary, b"reviewed immutable fixture").unwrap();
    std::fs::write(&input, b"approved bytes").unwrap();
    let mut p = policy();
    p.workspace = path.clone();
    p.cwd = path.clone();
    p.read_roots = vec![path];
    p.executable.path = binary;
    p.executable.sha256 = format!("{:x}", Sha256::digest(b"reviewed immutable fixture"));
    let input = Input {
        source: input,
        name: "input.txt".into(),
        sha256: format!("{:x}", Sha256::digest(b"approved bytes")),
    };
    (root, p, input)
}

#[test]
fn shared_staging_copies_independent_identity_and_never_grants_launch() {
    let (_source, p, input) = fixture();
    let stage = Prepared::new(p, vec![input.clone()], vec!["result.txt".into()]).unwrap();
    let original = identity(&File::open(&input.source).unwrap()).unwrap();
    let copy = identity(&File::open(stage.root.path().join("input.txt")).unwrap()).unwrap();
    assert_ne!((original.volume, original.index), (copy.volume, copy.index));
    assert_eq!(copy.links, 1);
    assert!(stage.check_host().is_ok());
    stage.receipt().validate().unwrap();
    let path = stage.root.path().to_path_buf();
    stage.close().unwrap();
    assert!(!path.exists());
    assert_eq!(std::fs::read(&input.source).unwrap(), b"approved bytes");
}

#[test]
fn shared_staging_rejects_existing_hardlink_aliases_and_changed_bytes() {
    let (root, p, input) = fixture();
    std::fs::hard_link(&input.source, root.path().join("alias.txt")).unwrap();
    assert!(Prepared::new(p.clone(), vec![input.clone()], vec![]).is_err());
    std::fs::remove_file(root.path().join("alias.txt")).unwrap();
    std::fs::write(&input.source, "changed").unwrap();
    assert!(matches!(
        Prepared::new(p.clone(), vec![input], vec![]),
        Err(Failure::ExecutableChanged)
    ));
    std::fs::write(&p.executable.path, "substituted").unwrap();
    assert!(matches!(
        Prepared::new(p, vec![], vec![]),
        Err(Failure::ExecutableChanged)
    ));
}

#[test]
fn shared_staging_bounds_names_metadata_and_source_permissions() {
    let (_root, p, input) = fixture();
    for value in ["../escape", "CON", "input.exe", ".env", "a/b", "a:b", ""] {
        let mut changed = input.clone();
        changed.name = value.into();
        assert!(
            Prepared::new(p.clone(), vec![changed], vec![]).is_err(),
            "{value}"
        );
    }
    assert!(Prepared::new(p.clone(), vec![input.clone(), input.clone()], vec![]).is_err());
    assert!(Prepared::new(p.clone(), vec![], vec!["result.txt".into(); 17]).is_err());
    let mut denied = p.clone();
    denied.denied_paths.push(input.source.clone());
    assert!(Prepared::new(denied, vec![input.clone()], vec![]).is_err());
    let mut denied_module = p.clone();
    denied_module.denied_paths.push(p.executable.path.clone());
    assert!(matches!(
        Prepared::new(denied_module, vec![], vec![]),
        Err(Failure::UnsupportedSecrets)
    ));
    let mut writes = p.clone();
    writes.write_roots.push(p.workspace.clone());
    assert!(Prepared::new(writes, vec![], vec![]).is_err());
    let outside = tempfile::tempdir().unwrap();
    let outside_input = Input {
        source: outside.path().join("other.txt"),
        ..input
    };
    std::fs::write(&outside_input.source, b"approved bytes").unwrap();
    assert!(Prepared::new(p, vec![outside_input], vec![]).is_err());
}

#[test]
fn shared_staging_cleanup_does_not_delete_an_outside_hardlink_target() {
    let (_source, p, _) = fixture();
    let outside = tempfile::tempdir().unwrap();
    let canary = outside.path().join("canary.txt");
    std::fs::write(&canary, "outside").unwrap();
    let stage = Prepared::new(p, vec![], vec![]).unwrap();
    std::fs::hard_link(&canary, stage.root.path().join("scratch/alias.txt")).unwrap();
    stage.close().unwrap();
    assert_eq!(std::fs::read_to_string(canary).unwrap(), "outside");
}

#[cfg(unix)]
#[test]
fn shared_staging_rejects_symlink_inputs_and_cleanup_does_not_follow_links() {
    use std::os::unix::fs::symlink;
    let (source, p, input) = fixture();
    let alias = p.workspace.join("alias.txt");
    symlink(&input.source, &alias).unwrap();
    assert!(Prepared::new(
        p.clone(),
        vec![Input {
            source: alias,
            ..input
        }],
        vec![]
    )
    .is_err());
    let stage = Prepared::new(p, vec![], vec![]).unwrap();
    symlink(source.path(), stage.root.path().join("scratch/escape")).unwrap();
    stage.close().unwrap();
    assert!(source.path().join("approved.txt").is_file());
}
