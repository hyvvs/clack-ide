use super::tests::Fixture;
use super::*;
use crate::modules::workspace::WorkspaceRegistry;

#[test]
fn native_binding_rechecks_real_workspace_authorization_and_aliases() {
    let mut f = Fixture::new();
    let a = f.root.join("one/project");
    let b = f.root.join("two/project");
    fs::create_dir_all(&a).unwrap();
    fs::create_dir_all(&b).unwrap();
    let registry = WorkspaceRegistry::default();
    let path = crate::modules::fs::to_canon(&a);
    f.originals.meta["profile"]["workspaceRoot"] = json!(path);
    f.originals.meta["profile"]["workspaceId"] = json!(identity("local", &path));
    assert!(bind(&registry, &f.originals).is_err());
    registry.authorize(&a).unwrap();
    let first = bind(&registry, &f.originals).unwrap();
    f.originals.meta["profile"]["workspaceRoot"] = json!(format!("{path}/."));
    assert_eq!(bind(&registry, &f.originals).unwrap().scope, first.scope);
    f.originals.meta["title"] = json!("Renamed chat");
    f.originals.meta["profile"]["modelId"] = json!("new-model");
    f.originals.meta["profile"]["agentId"] = json!("reviewer");
    assert_eq!(bind(&registry, &f.originals).unwrap().scope, first.scope);
    assert!(bind(&WorkspaceRegistry::default(), &f.originals).is_err());
    let path = crate::modules::fs::to_canon(&b);
    f.originals.meta["profile"]["workspaceRoot"] = json!(path);
    assert!(bind(&registry, &f.originals).is_err());
    registry.authorize(&b).unwrap();
    f.originals.meta["profile"]["workspaceId"] = json!(identity("local", &path));
    assert_ne!(bind(&registry, &f.originals).unwrap().scope, first.scope);
    fs::remove_dir(&b).unwrap();
    assert!(bind(&registry, &f.originals).is_err());
}

fn task_fixture(f: &mut Fixture) -> String {
    let bytes = b"Original verified interface.";
    let reference = put_content_in(&f.content, bytes).unwrap();
    let id = reference.id.clone();
    f.originals.tasks = vec![
        json!({"id":"task","sourceSessionId":"a","targetSessionId":"b","workspaceId":"local:/one/project","status":"completed",
        "artifactRefs":[{"id":"artifact","sourceSessionId":"b","sourceTaskId":"task","workspaceId":"local:/one/project","accessPolicy":"model-input","contentKind":"text","displayName":"interface.txt","contentRef":{"id":id,"contentHash":id,"byteSize":bytes.len()}}],
        "result":{"targetSessionId":"b","summary":"Tests passed for revision 123.","artifacts":[]}}),
    ];
    id
}

#[test]
fn peertask_result_and_immutable_artifact_provenance_are_not_fabricated() {
    let mut f = Fixture::new();
    let id = task_fixture(&mut f);
    let result = SourceLocator::TaskResult {
        task_id: "task".into(),
    };
    let artifact = SourceLocator::Artifact {
        task_id: "task".into(),
        artifact_id: "artifact".into(),
    };
    let (text, _, kind) =
        selected_source(&f.originals, &f.access.owner, &f.content, &result).unwrap();
    assert_eq!(text, "Tests passed for revision 123.");
    assert_eq!(kind, Qualification::AgentFinding);
    assert_eq!(
        selected_source(&f.originals, &f.access.owner, &f.content, &artifact)
            .unwrap()
            .0,
        "Original verified interface."
    );
    fs::write(f.content.join(&id), b"corrupt").unwrap();
    assert!(selected_source(&f.originals, &f.access.owner, &f.content, &artifact).is_err());
    fs::remove_file(f.content.join(id)).unwrap();
    assert!(selected_source(&f.originals, &f.access.owner, &f.content, &artifact).is_err());
    f.originals.tasks[0]["workspaceId"] = json!("local:/other");
    assert!(selected_source(&f.originals, &f.access.owner, &f.content, &result).is_err());
}

#[test]
fn unmerged_worktree_result_is_not_published_as_main_checkout_knowledge() {
    let mut f = Fixture::new();
    task_fixture(&mut f);
    f.originals.tasks[0]["worktree"] = json!({"checkoutRoot":"/unmerged","baseSha":"a".repeat(40)});
    let mut snapshot = f.snapshot();
    let mut proposal = f.proposal();
    proposal.locator = SourceLocator::TaskResult {
        task_id: "task".into(),
    };
    proposal.start = 0;
    proposal.end = 12;
    assert!(
        propose(&mut snapshot, &f.access, &f.originals, &f.content, proposal)
            .unwrap_err()
            .contains("checkout_mismatch")
    );
    assert!(snapshot.entries.is_empty());
}

#[test]
fn changed_task_checkout_metadata_invalidates_prepared_source() {
    let mut f = Fixture::new();
    task_fixture(&mut f);
    let locator = SourceLocator::TaskResult {
        task_id: "task".into(),
    };
    assert!(check_source_scope(&f.access, &f.originals, &locator).is_ok());
    f.originals.tasks[0]["worktree"] =
        json!({"checkoutRoot":"/different","baseSha":"a".repeat(40)});
    assert!(check_source_scope(&f.access, &f.originals, &locator).is_err());
}

#[test]
fn deleted_or_changed_sources_cannot_revalidate_the_original_digest() {
    let mut f = Fixture::new();
    let snapshot = f.pending();
    let source = &snapshot.entries[0].source;
    let (_, original, _) =
        selected_source(&f.originals, &source.owner, &f.content, &source.locator).unwrap();
    assert_eq!(original, source.source_digest);
    f.originals.messages[0]["parts"][0]["text"] = json!("Changed requirement");
    assert_ne!(
        selected_source(&f.originals, &source.owner, &f.content, &source.locator)
            .unwrap()
            .1,
        source.source_digest
    );
    f.originals.messages.clear();
    assert!(selected_source(&f.originals, &source.owner, &f.content, &source.locator).is_err());
    assert_eq!(
        read_content_from(&f.content, &source.slice_digest).unwrap(),
        b"Keep port 1420."
    );
}

#[test]
fn malformed_consent_and_fabricated_text_are_rejected() {
    let f = Fixture::new();
    let snapshot = f.pending();
    let mut malformed = snapshot.clone();
    malformed.entries[0].status = Publication::Approved;
    assert!(publish(&f.root, malformed, 1, |_| Ok(())).is_err());
    let mut malformed = snapshot.clone();
    malformed.entries[0].text = "A fabricated claim".into();
    assert!(publish(&f.root, malformed, 1, |_| Ok(())).is_err());
    let mut malformed = snapshot;
    malformed.entries[0].conflicts = vec!["invented".into()];
    assert!(publish(&f.root, malformed, 1, |_| Ok(())).is_err());
    assert_eq!(f.snapshot().revision, 1);
}

#[test]
fn same_owner_concurrent_commits_have_one_winner() {
    let f = Fixture::new();
    let state = MemoryState::default();
    let snapshot = f.pending();
    let outcomes = std::thread::scope(|scope| {
        let mut threads = vec![];
        for _ in 0..2 {
            let state = state.clone();
            let root = &f.root;
            let snapshot = snapshot.clone();
            threads.push(scope.spawn(move || {
                let lock = state.owner("project:a").unwrap();
                let _guard = lock.lock().unwrap();
                publish(root, snapshot, 1, |_| Ok(()))
            }));
        }
        threads
            .into_iter()
            .map(|t| t.join().unwrap())
            .collect::<Vec<_>>()
    });
    assert_eq!(outcomes.iter().filter(|r| r.is_ok()).count(), 1);
    assert_eq!(f.snapshot().revision, 2);
}

#[test]
fn separate_workspaces_commit_independently_to_existing_atomic_storage() {
    let f = Fixture::new();
    let a = f.pending();
    let mut b = a.clone();
    b.workspace = "local:/other".into();
    b.entries.clear();
    b.revision = 0;
    std::thread::scope(|scope| {
        let one = scope.spawn(|| publish(&f.root, a, 1, |_| Ok(())));
        let two = scope.spawn(|| publish(&f.root, b, 0, |_| Ok(())));
        one.join().unwrap().unwrap();
        two.join().unwrap().unwrap();
    });
    assert_eq!(f.snapshot().revision, 2);
    assert_eq!(load(&f.root, "local:/other").unwrap().revision, 1);
}

#[test]
fn retained_history_and_metadata_have_finite_quotas() {
    let f = Fixture::new();
    let mut snapshot = f.pending();
    for _ in 0..5 {
        let revision = snapshot.revision;
        publish(&f.root, snapshot, revision, |_| Ok(())).unwrap();
        snapshot = f.snapshot();
    }
    let dir = f.root.join(digest(f.access.scope.workspace.as_bytes()));
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 3);
    let entry = snapshot.entries[0].clone();
    for i in 0..MAX_ENTRIES {
        let mut entry = entry.clone();
        entry.id = digest(format!("entry-{i}").as_bytes());
        snapshot.entries.push(entry);
    }
    let revision = snapshot.revision;
    assert!(publish(&f.root, snapshot, revision, |_| Ok(())).is_err());
    assert_eq!(f.snapshot().revision, revision);
}

#[test]
fn metadata_capacity_preserves_room_to_approve_and_revoke_every_entry() {
    let mut f = Fixture::new();
    f.originals.messages[0]["parts"][0]["text"] = json!("x".repeat(MAX_SLICE));
    let mut snapshot = f.snapshot();
    loop {
        let mut next = snapshot.clone();
        let mut proposal = f.proposal();
        proposal.start = 0;
        proposal.end = MAX_SLICE;
        propose(&mut next, &f.access, &f.originals, &f.content, proposal).unwrap();
        if publish(&f.root, next, snapshot.revision, |_| Ok(())).is_err() {
            break;
        }
        snapshot = f.snapshot();
    }
    assert!(!snapshot.entries.is_empty());
    for id in snapshot
        .entries
        .iter()
        .map(|entry| entry.id.clone())
        .collect::<Vec<_>>()
    {
        let revision = snapshot.revision;
        decide(&mut snapshot, &f.access, &id, &Decision::Approve, true).unwrap();
        publish(&f.root, snapshot, revision, |_| Ok(())).unwrap();
        snapshot = f.snapshot();
        let mut recipient = f.access.clone();
        recipient.owner.session_id = "\\".repeat(256);
        let revision = snapshot.revision;
        decide(&mut snapshot, &recipient, &id, &Decision::Revoke, true).unwrap();
        publish(&f.root, snapshot, revision, |_| Ok(())).unwrap();
        snapshot = f.snapshot();
    }
    assert!(snapshot
        .entries
        .iter()
        .all(|entry| entry.status == Publication::Revoked));
}
