use super::super::tests::Fixture;
use super::*;

fn setup() -> (tempfile::TempDir, WorkspaceRegistry) {
    let dir = tempfile::tempdir().unwrap();
    let registry = WorkspaceRegistry::default();
    registry.authorize(dir.path()).unwrap();
    fs::write(
        dir.path().join("module.txt"),
        "Authentication uses module X.",
    )
    .unwrap();
    (dir, registry)
}
fn input(path: &str) -> DependencyInput {
    DependencyInput {
        path: path.into(),
        environment: false,
    }
}
fn knowledge(batch: &mut Batch<'_>) -> Knowledge {
    Knowledge {
        schema_version: 1,
        dependencies: vec![batch.read(&input("module.txt")).unwrap().dependency],
        git_revision: "non-git".into(),
        environment: "test".into(),
        verified_by: "a".into(),
        verified_at: now(),
        revision: 1,
        policy: "m2-user-evidence-v1".into(),
        records: vec![],
    }
}
fn entry(knowledge: Knowledge) -> Entry {
    let f = Fixture::new();
    let mut entry = f.pending().entries.remove(0);
    entry.status = Publication::Approved;
    entry.knowledge = Some(knowledge);
    entry
}

#[test]
fn unchanged_files_are_hashed_once_per_batch_and_not_scanned() {
    let (dir, registry) = setup();
    fs::write(dir.path().join("unrelated.txt"), "unrelated").unwrap();
    let mut batch = Batch::new(&registry, dir.path()).unwrap();
    let entry = entry(knowledge(&mut batch));
    assert_eq!(compare(&entry, "non-git", "test", &mut batch).0, "current");
    assert_eq!(compare(&entry, "non-git", "test", &mut batch).0, "current");
    assert_eq!(batch.reads, 2);
    assert_eq!(batch.cache.len(), 1);
}

#[test]
fn same_timestamp_changed_bytes_are_invalidated_and_original_evidence_survives() {
    let (dir, registry) = setup();
    let path = dir.path().join("module.txt");
    let time = fs::metadata(&path).unwrap().modified().unwrap();
    let mut batch = Batch::new(&registry, dir.path()).unwrap();
    let entry = entry(knowledge(&mut batch));
    fs::write(&path, "Authentication uses module Y.").unwrap();
    fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(time))
        .unwrap();
    let mut fresh = Batch::new(&registry, dir.path()).unwrap();
    let result = compare(&entry, "non-git", "test", &mut fresh);
    assert_eq!(result.0, "invalidated");
    assert!(result.1[0]["excerpt"]
        .as_str()
        .unwrap()
        .contains("module Y"));
    assert_ne!(
        result.1[0]["contentHash"],
        entry.knowledge.unwrap().dependencies[0].content_hash
    );
}

#[test]
fn rename_delete_and_untracked_changes_are_not_filename_guesses() {
    let (dir, registry) = setup();
    let mut batch = Batch::new(&registry, dir.path()).unwrap();
    let entry = entry(knowledge(&mut batch));
    fs::rename(
        dir.path().join("module.txt"),
        dir.path().join("renamed.txt"),
    )
    .unwrap();
    assert_eq!(
        compare(
            &entry,
            "non-git",
            "test",
            &mut Batch::new(&registry, dir.path()).unwrap()
        )
        .0,
        "source-missing"
    );
}

#[test]
fn secret_traversal_and_other_roots_are_denied_before_reads() {
    let (dir, registry) = setup();
    let mut batch = Batch::new(&registry, dir.path()).unwrap();
    for path in [
        "../module.txt",
        "/module.txt",
        "C:/module.txt",
        ".env",
        ".ssh/key",
        "a/../module.txt",
    ] {
        assert!(batch.read(&input(path)).is_err());
    }
    assert_eq!(batch.reads, 0);
    assert!(Batch::new(&WorkspaceRegistry::default(), dir.path()).is_err());
}

#[test]
fn events_invalidate_only_known_dependencies_and_reject_late_checks() {
    let (dir, registry) = setup();
    let mut batch = Batch::new(&registry, dir.path()).unwrap();
    let entry = entry(knowledge(&mut batch));
    let state = FreshnessState::default();
    let generation = state.register(&entry).unwrap();
    state.finish(&entry, generation, "current").unwrap();
    assert!(!state.invalidate(&[to_canon(dir.path().join("other.txt"))]));
    assert_eq!(state.status(&entry).unwrap(), "current");
    assert!(state.invalidate(&[to_canon(dir.path().join("module.txt"))]));
    assert!(state.finish(&entry, generation, "current").is_err());
    assert_eq!(state.status(&entry).unwrap(), "potentially-stale");
    assert_eq!(
        FreshnessState::default().status(&entry).unwrap(),
        "needs-revalidation"
    );
}

#[test]
fn environment_and_branch_revision_changes_invalidate_test_claims() {
    let (dir, registry) = setup();
    let mut batch = Batch::new(&registry, dir.path()).unwrap();
    let mut entry = entry(knowledge(&mut batch));
    assert_eq!(
        compare(&entry, "other-head", "test", &mut batch).0,
        "invalidated"
    );
    assert_eq!(
        compare(&entry, "non-git", "another-platform", &mut batch).0,
        "invalidated"
    );
    entry.section = "verification".into();
    assert_eq!(
        compare(&entry, "non-git", "test", &mut batch).0,
        "needs-revalidation"
    );
    entry.knowledge.as_mut().unwrap().dependencies[0].environment = true;
    assert_eq!(compare(&entry, "non-git", "test", &mut batch).0, "current");
}

#[test]
fn newer_revalidation_and_cancellation_barrier_reject_old_results() {
    let (dir, registry) = setup();
    let entry = entry(knowledge(&mut Batch::new(&registry, dir.path()).unwrap()));
    let state = FreshnessState::default();
    let first = state.begin(&entry).unwrap();
    let second = state.begin(&entry).unwrap();
    state.finish(&entry, second, "invalidated").unwrap();
    assert!(state.finish(&entry, first, "current").is_err());
    state.invalidate(&[]);
    assert!(state.finish(&entry, second, "current").is_err());
}

#[test]
fn evicted_entries_cannot_reuse_an_old_completion_ticket() {
    let (dir, registry) = setup();
    let entry = entry(knowledge(&mut Batch::new(&registry, dir.path()).unwrap()));
    let state = FreshnessState::default();
    let first = state.begin(&entry).unwrap();
    state.inner.lock().unwrap().clear();
    let next = state.begin(&entry).unwrap();
    assert_ne!(first, next);
    assert!(state.finish(&entry, first, "current").is_err());
}

#[test]
fn cyclic_dependency_metadata_stays_bounded_and_untrusted() {
    let (dir, registry, mut snapshot) = graph_fixture();
    snapshot.entries[0].knowledge.as_mut().unwrap().records = vec![snapshot.entries[1].id.clone()];
    let mut batch = Batch::new(&registry, dir.path()).unwrap();
    assert_ne!(
        compare_closure(
            &snapshot,
            &snapshot.entries[1],
            "non-git",
            "test",
            &mut batch,
            &mut |_| true
        )
        .0,
        "current"
    );
    assert_eq!(batch.reads, 2);
}

#[test]
fn declared_environment_bytes_invalidate_tests_without_rewriting_requirements() {
    let (dir, registry) = setup();
    fs::write(dir.path().join("test-config.json"), "version1").unwrap();
    let mut batch = Batch::new(&registry, dir.path()).unwrap();
    let mut knowledge = knowledge(&mut batch);
    knowledge.dependencies.push(
        batch
            .read(&DependencyInput {
                path: "test-config.json".into(),
                environment: true,
            })
            .unwrap()
            .dependency,
    );
    let mut entry = entry(knowledge);
    entry.section = "verification".into();
    let original = entry.text.clone();
    fs::write(dir.path().join("test-config.json"), "version2").unwrap();
    assert_eq!(
        compare(
            &entry,
            "non-git",
            "test",
            &mut Batch::new(&registry, dir.path()).unwrap()
        )
        .0,
        "invalidated"
    );
    assert_eq!(entry.text, original);
}

#[test]
fn metadata_and_read_limits_fail_closed() {
    let (dir, registry) = setup();
    fs::write(dir.path().join("large.txt"), vec![b'x'; MAX_FILE + 1]).unwrap();
    let mut batch = Batch::new(&registry, dir.path()).unwrap();
    assert!(batch.read(&input("large.txt")).is_err());
    assert_eq!(batch.reads, 0);
    let mut knowledge = knowledge(&mut batch);
    knowledge.schema_version = 99;
    assert!(validate(&knowledge).is_err());
    knowledge.schema_version = 1;
    knowledge.dependencies[0].content_hash = "invented".into();
    assert!(validate(&knowledge).is_err());
}

fn graph_fixture() -> (tempfile::TempDir, WorkspaceRegistry, Snapshot) {
    let (dir, registry) = setup();
    let mut first = entry(knowledge(&mut Batch::new(&registry, dir.path()).unwrap()));
    first.id = digest(b"requirement");
    let mut second = first.clone();
    second.id = digest(b"dependent");
    second.knowledge.as_mut().unwrap().records = vec![first.id.clone()];
    let snapshot = Snapshot {
        schema_version: 2,
        workspace: first.scope.workspace.clone(),
        revision: 1,
        previous: None,
        entries: vec![first, second],
    };
    (dir, registry, snapshot)
}

#[test]
fn dependency_closure_reuses_reads_and_revokes_derived_authority() {
    let (dir, registry, mut snapshot) = graph_fixture();
    let mut batch = Batch::new(&registry, dir.path()).unwrap();
    assert_eq!(
        compare_closure(
            &snapshot,
            &snapshot.entries[1],
            "non-git",
            "test",
            &mut batch,
            &mut |_| true
        )
        .0,
        "current"
    );
    assert_eq!(batch.reads, 2);
    snapshot.entries[0].status = Publication::Superseded;
    assert_eq!(
        compare_closure(
            &snapshot,
            &snapshot.entries[1],
            "non-git",
            "test",
            &mut Batch::new(&registry, dir.path()).unwrap(),
            &mut |_| true
        )
        .0,
        "invalidated"
    );
}

#[test]
fn evidence_grant_loss_invalidates_dependents_without_publishing_private_sources() {
    let (dir, registry, snapshot) = graph_fixture();
    let private = snapshot.entries[0].id.clone();
    let result = compare_closure(
        &snapshot,
        &snapshot.entries[1],
        "non-git",
        "test",
        &mut Batch::new(&registry, dir.path()).unwrap(),
        &mut |e| e.id != private,
    );
    assert_eq!(result.0, "invalidated");
}

#[test]
fn conflict_is_symmetric_and_does_not_resolve_itself() {
    let (dir, registry, mut snapshot) = graph_fixture();
    snapshot.entries[1].conflicts = vec![snapshot.entries[0].id.clone()];
    for entry in &snapshot.entries {
        assert_eq!(
            compare_closure(
                &snapshot,
                entry,
                "non-git",
                "test",
                &mut Batch::new(&registry, dir.path()).unwrap(),
                &mut |_| true
            )
            .0,
            "conflicting"
        );
    }
}

#[test]
fn changed_dependency_graph_marks_cached_descendants_for_revalidation() {
    let (_, _, mut snapshot) = graph_fixture();
    let state = FreshnessState::default();
    state.index(&snapshot).unwrap();
    let generation = state.begin(&snapshot.entries[1]).unwrap();
    state
        .finish(&snapshot.entries[1], generation, "current")
        .unwrap();
    snapshot.entries[0].status = Publication::Superseded;
    state.index(&snapshot).unwrap();
    assert_eq!(
        state.status(&snapshot.entries[1]).unwrap(),
        "needs-revalidation"
    );
    assert!(state
        .finish(&snapshot.entries[1], generation, "current")
        .is_err());
}

#[test]
fn restart_and_missed_events_rehash_only_declared_dependencies() {
    let (dir, registry, snapshot) = graph_fixture();
    let json = serde_json::to_vec(&snapshot).unwrap();
    fs::write(dir.path().join("module.txt"), "New implementation").unwrap();
    let restored: Snapshot = serde_json::from_slice(&json).unwrap();
    let mut batch = Batch::new(&registry, dir.path()).unwrap();
    assert_eq!(
        compare_closure(
            &restored,
            &restored.entries[1],
            "non-git",
            "test",
            &mut batch,
            &mut |_| true
        )
        .0,
        "invalidated"
    );
    assert_eq!(batch.cache.len(), 1);
}

#[test]
fn git_checkout_identity_changes_even_when_file_bytes_do_not() {
    let (dir, registry) = setup();
    let git = |args: &[&str]| {
        let mut command = std::process::Command::new("git");
        command.current_dir(dir.path()).args(args);
        crate::modules::proc::hide_console(&mut command);
        assert!(command.output().unwrap().status.success());
    };
    git(&["init"]);
    git(&["add", "module.txt"]);
    git(&[
        "-c",
        "user.name=Clack test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-m",
        "fixture",
    ]);
    let cwd = to_canon(dir.path());
    let first =
        crate::modules::git::operations::project_evidence_revision(&cwd, &WorkspaceEnv::Local)
            .unwrap();
    fs::write(dir.path().join("unrelated.txt"), "unrelated commit").unwrap();
    git(&["add", "unrelated.txt"]);
    git(&[
        "-c",
        "user.name=Clack test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-m",
        "unrelated",
    ]);
    let after_commit =
        crate::modules::git::operations::project_evidence_revision(&cwd, &WorkspaceEnv::Local)
            .unwrap();
    assert_ne!(first, after_commit);
    let mut unchanged = entry(knowledge(&mut Batch::new(&registry, dir.path()).unwrap()));
    unchanged.knowledge.as_mut().unwrap().git_revision = first.clone();
    assert_eq!(
        compare(
            &unchanged,
            &after_commit,
            "test",
            &mut Batch::new(&registry, dir.path()).unwrap()
        )
        .0,
        "current"
    );
    git(&["checkout", "-b", "other"]);
    let second =
        crate::modules::git::operations::project_evidence_revision(&cwd, &WorkspaceEnv::Local)
            .unwrap();
    assert_ne!(first, second);
    let mut entry = entry(knowledge(&mut Batch::new(&registry, dir.path()).unwrap()));
    entry.knowledge.as_mut().unwrap().git_revision = first;
    assert_eq!(
        compare(
            &entry,
            &second,
            "test",
            &mut Batch::new(&registry, dir.path()).unwrap()
        )
        .0,
        "invalidated"
    );
}

#[test]
fn source_mutation_during_read_does_not_become_verified_evidence() {
    let (dir, registry) = setup();
    let mut batch = Batch::new(&registry, dir.path()).unwrap();
    let result = batch.read_observation(&input("module.txt"), &mut |count| {
        if count == 1 {
            fs::write(dir.path().join("module.txt"), "Changed during verification").unwrap();
        }
    });
    assert_eq!(result.err().as_deref(), Some("project_source_mutating"));
}

#[test]
fn user_verified_replacement_is_atomic_source_linked_and_restart_safe() {
    let f = Fixture::new();
    let (dir, registry) = setup();
    let mut snapshot = f.pending();
    let id = snapshot.entries[0].id.clone();
    decide(&mut snapshot, &f.access, &id, &Decision::Approve, true).unwrap();
    publish(&f.root, snapshot, 1, |_| Ok(())).unwrap();
    let mut snapshot = f.snapshot();
    let original = serde_json::to_vec(&f.originals.messages).unwrap();
    let mut batch = Batch::new(&registry, dir.path()).unwrap();
    let mut knowledge = knowledge(&mut batch);
    knowledge.revision = 3;
    let observation = batch.read(&input("module.txt")).unwrap();
    put_content_in(&f.content, observation.excerpt.as_bytes()).unwrap();
    let before = serde_json::to_vec(&snapshot).unwrap();
    assert!(install(&mut snapshot, &f.access, &id, knowledge.clone(), false).is_err());
    assert_eq!(before, serde_json::to_vec(&snapshot).unwrap());
    install(&mut snapshot, &f.access, &id, knowledge, true).unwrap();
    assert!(publish(&f.root, snapshot.clone(), 2, |point| {
        if point == "before-pointer" {
            Err("crash".into())
        } else {
            Ok(())
        }
    })
    .is_err());
    assert_eq!(f.snapshot().revision, 2);
    publish(&f.root, snapshot, 2, |_| Ok(())).unwrap();
    let restored = f.snapshot();
    assert_eq!(restored.schema_version, 2);
    assert_eq!(restored.entries[0].status, Publication::Superseded);
    assert_eq!(restored.entries[1].supersedes.as_deref(), Some(id.as_str()));
    assert_eq!(
        restored.entries[1].source.source_digest,
        restored.entries[0].source.source_digest
    );
    assert!(retention_roots(&f.root)
        .unwrap()
        .contains(&observation.dependency.slice_hash));
    assert_eq!(serde_json::to_vec(&f.originals.messages).unwrap(), original);
    assert!(publish(&f.root, restored, 2, |_| Ok(())).is_err());
}

#[test]
fn older_schema_loads_without_automatic_publication_or_knowledge() {
    let f = Fixture::new();
    let mut original = f.pending();
    original.schema_version = 1;
    let bytes = serde_json::to_vec(&original).unwrap();
    let directory = f.root.join(digest(original.workspace.as_bytes()));
    let id = digest(&bytes);
    atomic_write(&directory.join(format!("{id}.json")), &bytes).unwrap();
    let manifest =
        serde_json::to_vec(&json!({"schemaVersion":1,"current":id,"previous":null})).unwrap();
    atomic_write(&directory.join("manifest.json"), &manifest).unwrap();
    let restored = f.snapshot();
    assert_eq!(restored.schema_version, 1);
    assert_eq!(fs::read(directory.join("manifest.json")).unwrap(), manifest);
    assert!(restored.entries[0].knowledge.is_none());
    assert_eq!(restored.entries[0].status, Publication::Pending);
    publish(&f.root, restored, 1, |_| Ok(())).unwrap();
    assert!(f.snapshot().entries[0].knowledge.is_none());
}

#[test]
fn shared_excerpts_are_exactly_the_bounded_bytes_shown_for_authorization() {
    let (dir, registry) = setup();
    fs::write(
        dir.path().join("module.txt"),
        format!("{}PRIVATE TAIL", "x".repeat(MAX_EXCERPT)),
    )
    .unwrap();
    let observation = Batch::new(&registry, dir.path())
        .unwrap()
        .read(&input("module.txt"))
        .unwrap();
    assert_eq!(observation.excerpt.len(), MAX_EXCERPT);
    assert_eq!(
        digest(observation.excerpt.as_bytes()),
        observation.dependency.slice_hash
    );
    assert!(!observation.excerpt.contains("PRIVATE"));
    assert!(!possible_secret("task-scoped risk-based design"));
    assert!(possible_secret("key=sk-private-credential"));
}

#[test]
fn cross_scope_or_fabricated_dependency_links_are_invalid() {
    let (_, _, mut snapshot) = graph_fixture();
    snapshot.entries[0].scope.checkout = "another-checkout".into();
    assert!(validate_links(
        snapshot.entries[1].knowledge.as_ref().unwrap(),
        &snapshot.entries[1],
        &snapshot
    )
    .is_err());
    snapshot.entries[1].knowledge.as_mut().unwrap().records = vec![digest(b"invented")];
    assert!(validate_links(
        snapshot.entries[1].knowledge.as_ref().unwrap(),
        &snapshot.entries[1],
        &snapshot
    )
    .is_err());
}

#[cfg(unix)]
#[test]
fn symlink_escape_and_secret_alias_are_denied_before_open() {
    let (dir, registry) = setup();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("secret.txt"), "outside").unwrap();
    std::os::unix::fs::symlink(
        outside.path().join("secret.txt"),
        dir.path().join("alias.txt"),
    )
    .unwrap();
    let mut batch = Batch::new(&registry, dir.path()).unwrap();
    assert!(batch.read(&input("alias.txt")).is_err());
    assert_eq!(batch.reads, 0);
}
