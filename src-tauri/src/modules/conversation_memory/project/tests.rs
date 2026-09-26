use super::*;

pub(super) struct Fixture {
    _dir: tempfile::TempDir,
    pub(super) root: PathBuf,
    pub(super) content: PathBuf,
    pub(super) access: Access,
    pub(super) originals: Originals,
}
impl Fixture {
    pub(super) fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        Self {
            root: dir.path().join("project"),
            content: dir.path().join("content"),
            _dir: dir,
            access: Access {
                owner: Owner {
                    session_id: "a".into(),
                    workspace_id: Some("local:/one/project".into()),
                },
                scope: Scope {
                    workspace: "local:/one/project".into(),
                    checkout: "local:/one/project".into(),
                    base_sha: None,
                },
                agent: "coder".into(),
            },
            originals: Originals {
                meta: json!({"id":"a","profile":{"workspaceId":"local:/one/project","agentId":"coder"}}),
                messages: vec![
                    json!({"id":"m","role":"user","parts":[{"type":"text","text":"Private introduction. Keep port 1420. Private conclusion."}]}),
                    json!({"id":"t","role":"assistant","parts":[{"type":"tool-read_file","toolCallId":"call","state":"output-available","input":{"path":"src/config.ts"},"output":"Observed port 1420."}]}),
                    json!({"id":"speculation","role":"assistant","parts":[{"type":"text","text":"The system is definitely secure"},{"type":"reasoning","text":"private reasoning"}]}),
                ],
                tasks: vec![],
                session_ids: BTreeSet::from(["a".into(), "b".into()]),
            },
        }
    }
    pub(super) fn snapshot(&self) -> Snapshot {
        load(&self.root, &self.access.scope.workspace).unwrap()
    }
    pub(super) fn proposal(&self) -> Proposal {
        Proposal {
            locator: SourceLocator::Part {
                message_id: "m".into(),
                part_index: 0,
            },
            start: 22,
            end: 37,
            section: "requirements".into(),
            conflicts: vec![],
        }
    }
    pub(super) fn pending(&self) -> Snapshot {
        let mut snapshot = self.snapshot();
        propose(
            &mut snapshot,
            &self.access,
            &self.originals,
            &self.content,
            self.proposal(),
        )
        .unwrap();
        publish(&self.root, snapshot, 0, |_| Ok(())).unwrap();
        self.snapshot()
    }
    fn recipient(&self) -> Access {
        let mut access = self.access.clone();
        access.owner.session_id = "b".into();
        access.agent = "reviewer".into();
        access
    }
}

#[test]
fn workspace_identity_is_environment_and_root_not_label() {
    assert_ne!(
        identity("local", "/one/project"),
        identity("local", "/two/project")
    );
    assert_ne!(
        identity("local", "/one/project"),
        identity("wsl:Ubuntu", "/one/project")
    );
    assert_ne!(
        identity("wsl:Ubuntu", "/one/project"),
        identity("wsl:Debian", "/one/project")
    );
    assert_eq!(
        identity("local", "C:\\Work\\Project\\"),
        identity("local", "c:/work/project")
    );
}

#[test]
fn no_private_chat_or_pending_proposal_is_shared() {
    let f = Fixture::new();
    let before = serde_json::to_vec(&f.originals.messages).unwrap();
    assert!(f.snapshot().entries.is_empty());
    let pending = f.pending();
    assert_eq!(
        view(&pending, &f.recipient(), |_| "ok")["entries"],
        json!([])
    );
    assert_eq!(
        view(&pending, &f.access, |_| "ok")["entries"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(before, serde_json::to_vec(&f.originals.messages).unwrap());
    let path = fs::read_dir(&f.content)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    assert!(!String::from_utf8(fs::read(path).unwrap())
        .unwrap()
        .contains("Private"));
}

#[test]
fn only_a_confirmed_selected_slice_is_shared_without_browsing_grant() {
    let f = Fixture::new();
    let mut pending = f.pending();
    let id = pending.entries[0].id.clone();
    assert!(decide(&mut pending, &f.access, &id, &Decision::Approve, false).is_err());
    decide(&mut pending, &f.access, &id, &Decision::Approve, true).unwrap();
    publish(&f.root, pending, 1, |_| Ok(())).unwrap();
    let output = view(&f.snapshot(), &f.recipient(), |_| {
        "historical-source-verified"
    });
    assert_eq!(output["entries"][0]["text"], "Keep port 1420.");
    let serialized = serde_json::to_string(&output).unwrap();
    assert!(!serialized.contains("Private"));
    assert!(!serialized.contains("sourceDigest"));
    assert_eq!(output["entries"][0]["consent"][0]["policy"], POLICY);
}

#[test]
fn pending_revocation_does_not_publish_private_text() {
    let f = Fixture::new();
    let mut snapshot = f.pending();
    let id = snapshot.entries[0].id.clone();
    decide(&mut snapshot, &f.access, &id, &Decision::Revoke, true).unwrap();
    assert!(view(&snapshot, &f.recipient(), |_| "ok")["entries"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[test]
fn cross_workspace_and_checkout_reads_and_writes_are_denied() {
    let f = Fixture::new();
    let mut snapshot = f.pending();
    let mut outsider = f.recipient();
    outsider.scope.workspace = "local:/two/project".into();
    outsider.scope.checkout = outsider.scope.workspace.clone();
    assert!(view(&snapshot, &outsider, |_| "ok")["entries"]
        .as_array()
        .unwrap()
        .is_empty());
    assert!(propose(
        &mut snapshot,
        &outsider,
        &f.originals,
        &f.content,
        f.proposal()
    )
    .is_err());
    outsider = f.access.clone();
    outsider.scope.checkout = "local:/worktree".into();
    outsider.scope.base_sha = Some("a".repeat(40));
    assert!(view(&snapshot, &outsider, |_| "ok")["entries"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[test]
fn names_models_agents_and_conversations_do_not_change_project_owner() {
    let f = Fixture::new();
    let mut snapshot = f.pending();
    let id = snapshot.entries[0].id.clone();
    decide(&mut snapshot, &f.access, &id, &Decision::Approve, true).unwrap();
    let mut changed = f.recipient();
    changed.agent = "another-agent".into();
    assert_eq!(
        view(&snapshot, &changed, |_| "ok")["entries"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(snapshot.workspace, changed.scope.workspace);
}

#[test]
fn message_and_tool_provenance_are_preserved_and_assertions_rejected() {
    let f = Fixture::new();
    let mut snapshot = f.pending();
    let (text, checksum, kind) = selected_source(
        &f.originals,
        &f.access.owner,
        &f.content,
        &SourceLocator::Part {
            message_id: "t".into(),
            part_index: 0,
        },
    )
    .unwrap();
    assert_eq!(text, "Observed port 1420.");
    assert_eq!(kind, Qualification::ToolObservation);
    assert!(valid_hash(&checksum));
    for part_index in [0, 1] {
        assert!(selected_source(
            &f.originals,
            &f.access.owner,
            &f.content,
            &SourceLocator::Part {
                message_id: "speculation".into(),
                part_index
            }
        )
        .is_err());
    }
    let mut proposal = f.proposal();
    proposal.locator = SourceLocator::Message {
        message_id: "m".into(),
    };
    assert!(propose(&mut snapshot, &f.access, &f.originals, &f.content, proposal).is_err());
}

#[test]
fn malicious_citations_missing_sources_and_secret_paths_fail_closed() {
    let mut f = Fixture::new();
    for message_id in ["missing", "another-chat-message"] {
        assert!(selected_source(
            &f.originals,
            &f.access.owner,
            &f.content,
            &SourceLocator::Part {
                message_id: message_id.into(),
                part_index: 0
            }
        )
        .is_err());
    }
    f.originals.messages[1]["parts"][0]["input"]["path"] = json!(".env");
    assert!(selected_source(
        &f.originals,
        &f.access.owner,
        &f.content,
        &SourceLocator::Part {
            message_id: "t".into(),
            part_index: 0
        }
    )
    .is_err());
    f.originals.messages[0]["parts"][0]["text"] = json!("sk-private-credential");
    assert!(selected_source(
        &f.originals,
        &f.access.owner,
        &f.content,
        &SourceLocator::Part {
            message_id: "m".into(),
            part_index: 0
        }
    )
    .is_err());
}

#[test]
fn correction_and_revocation_invalidate_views_and_preserve_history() {
    let f = Fixture::new();
    let mut snapshot = f.pending();
    let id = snapshot.entries[0].id.clone();
    decide(&mut snapshot, &f.access, &id, &Decision::Approve, true).unwrap();
    publish(&f.root, snapshot, 1, |_| Ok(())).unwrap();
    let mut snapshot = f.snapshot();
    decide(
        &mut snapshot,
        &f.recipient(),
        &id,
        &Decision::Correct {
            text: "Use port 1421 instead.".into(),
        },
        true,
    )
    .unwrap();
    publish(&f.root, snapshot, 2, |_| Ok(())).unwrap();
    let mut snapshot = f.snapshot();
    assert!(expect_revision(&snapshot, 2).is_err());
    assert_eq!(snapshot.entries[0].status, Publication::Superseded);
    assert_eq!(snapshot.entries[0].text, "Keep port 1420.");
    assert_eq!(snapshot.entries[1].supersedes.as_deref(), Some(id.as_str()));
    assert_eq!(
        snapshot.entries[1].qualification,
        Qualification::UserCorrection
    );
    let id = snapshot.entries[1].id.clone();
    decide(&mut snapshot, &f.recipient(), &id, &Decision::Revoke, true).unwrap();
    assert!(view(&snapshot, &f.recipient(), |_| "ok")["entries"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[test]
fn conflicting_records_coexist_without_overwriting() {
    let f = Fixture::new();
    let mut snapshot = f.pending();
    let id = snapshot.entries[0].id.clone();
    decide(&mut snapshot, &f.access, &id, &Decision::Approve, true).unwrap();
    let mut proposal = f.proposal();
    proposal.conflicts = vec![id];
    snapshot.revision = 2;
    propose(&mut snapshot, &f.access, &f.originals, &f.content, proposal).unwrap();
    assert_eq!(snapshot.entries.len(), 2);
    assert_eq!(snapshot.entries[1].qualification, Qualification::Disputed);
}

#[test]
fn atomic_faults_leave_previous_valid_state_and_stale_writes_fail() {
    let f = Fixture::new();
    let snapshot = f.pending();
    for point in ["before-revision", "before-pointer"] {
        assert!(publish(&f.root, snapshot.clone(), 1, |at| if at == point {
            Err("crash".into())
        } else {
            Ok(())
        })
        .is_err());
        assert_eq!(f.snapshot().revision, 1);
    }
    publish(&f.root, snapshot.clone(), 1, |_| Ok(())).unwrap();
    assert!(publish(&f.root, snapshot, 1, |_| Ok(())).is_err());
    assert_eq!(f.snapshot().revision, 2);
}

#[test]
fn restart_does_not_publish_pending_and_load_is_idempotent() {
    let f = Fixture::new();
    f.pending();
    for _ in 0..3 {
        let snapshot = load(&f.root, &f.access.scope.workspace).unwrap();
        assert_eq!(snapshot.revision, 1);
        assert_eq!(snapshot.entries[0].status, Publication::Pending);
    }
    let legacy = load(&f.root, "local:/untouched").unwrap();
    assert_eq!(legacy.revision, 0);
    assert!(legacy.entries.is_empty());
}

#[test]
fn retention_keeps_only_committed_selected_content_and_previous_revision() {
    let f = Fixture::new();
    f.pending();
    let source = &f.snapshot().entries[0].source;
    assert_eq!(
        retention_roots(&f.root).unwrap(),
        vec![source.slice_digest.clone()]
    );
    let orphan = put_content_in(&f.content, b"orphan").unwrap();
    super::super::super::attachments::reconcile_store(
        &f.content,
        &retention_roots(&f.root).unwrap(),
    )
    .unwrap();
    assert!(!f.content.join(orphan.id).exists());
    assert!(f.content.join(&source.slice_digest).exists());
    fs::remove_file(f.content.join(&source.slice_digest)).unwrap();
    assert!(read_content_from(&f.content, &source.slice_digest).is_err());
    assert_eq!(f.snapshot().revision, 1);
}

#[test]
fn metadata_bounds_and_unsupported_versions_fail_safely() {
    let f = Fixture::new();
    let mut snapshot = f.pending();
    snapshot.schema_version = 2;
    assert!(publish(&f.root, snapshot.clone(), 1, |_| Ok(())).is_err());
    snapshot.schema_version = 1;
    snapshot.entries[0].text = "x".repeat(MAX_SLICE + 1);
    assert!(publish(&f.root, snapshot, 1, |_| Ok(())).is_err());
    assert_eq!(f.snapshot().revision, 1);
}

#[test]
fn corruption_is_isolated_and_does_not_resurrect_old_consent() {
    let f = Fixture::new();
    let snapshot = f.pending();
    publish(&f.root, snapshot, 1, |_| Ok(())).unwrap();
    let dir = f.root.join(digest(f.access.scope.workspace.as_bytes()));
    let pointer: Value =
        serde_json::from_slice(&fs::read(dir.join("manifest.json")).unwrap()).unwrap();
    fs::write(
        dir.join(format!("{}.json", pointer["current"].as_str().unwrap())),
        b"corrupt",
    )
    .unwrap();
    assert!(load(&f.root, &f.access.scope.workspace).is_err());
    assert!(dir
        .join(format!("{}.json", pointer["previous"].as_str().unwrap()))
        .exists());
    assert!(load(&f.root, "local:/other").is_ok());
    assert!(retention_roots(&f.root).is_err());
}

#[test]
fn project_locks_are_independent_but_same_owner_is_serialized() {
    let state = MemoryState::default();
    let a = state.owner("project:a").unwrap();
    let b = state.owner("project:b").unwrap();
    let _lock = a.lock().unwrap();
    assert!(b.try_lock().is_ok());
    assert!(state.owner("project:a").unwrap().try_lock().is_err());
}
