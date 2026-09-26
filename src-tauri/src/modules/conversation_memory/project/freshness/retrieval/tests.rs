use super::super::super::tests::Fixture;
use super::*;

#[test]
fn idle_switch_recipient_preserves_authorization_and_rejects_new_runs() {
    let mut f = Fixture::new();
    let token = format!(
        "{}:issued",
        crate::modules::conversation_memory::target_context::idle_token(&f.originals.meta).unwrap()
    );
    let mut req = request();
    req.run_id = token;
    assert!(recipient(&f.originals, &req, &json!({})).is_ok());
    let agent = f.originals.meta["profile"]["agentId"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(recipient(&f.originals, &req, &json!({agent:{"mode":"chat-only"}})).is_err());
    f.originals.meta["run"] = json!({"state":"running","startedAt":10});
    assert!(recipient(&f.originals, &req, &json!({})).is_err());
}

fn request() -> Request {
    Request {
        session_id: "a".into(),
        run_id: "a:1".into(),
        query: "port".into(),
        anchor: None,
        files: vec![],
        max_chunks: 12,
        max_bytes: 65536,
        expected: None,
    }
}

fn run(f: &Fixture, snapshot: &Snapshot, request: &Request, dir: &Path, valid: bool) -> Retrieved {
    let registry = WorkspaceRegistry::default();
    registry.authorize(dir).unwrap();
    collect(
        Selection {
            access: &f.access,
            originals: &f.originals,
            snapshot,
            content: &f.content,
            git: "non-git",
            environment: "test",
        },
        request,
        &mut Batch::new(&registry, dir).unwrap(),
        &mut |_| valid,
    )
    .unwrap()
}

#[test]
fn retrieval_sees_only_approved_same_checkout_slices_and_never_private_messages() {
    let f = Fixture::new();
    let dir = tempfile::tempdir().unwrap();
    let mut snapshot = f.pending();
    let before = serde_json::to_vec(&f.originals.messages).unwrap();
    assert!(run(&f, &snapshot, &request(), dir.path(), true)
        .chunks
        .is_empty());
    snapshot.entries[0].status = Publication::Approved;
    let result = run(&f, &snapshot, &request(), dir.path(), true);
    assert_eq!(result.chunks.len(), 1);
    let text = serde_json::to_string(&result).unwrap();
    assert!(text.contains("1420"));
    assert!(!text.contains("Private introduction"));
    assert_eq!(result.chunks[0]["source"]["locator"]["messageId"], "m");
    assert_eq!(result.chunks[0]["freshness"], "explicit-user-statement");
    snapshot.entries[0].scope.checkout = "local:/different".into();
    assert!(run(&f, &snapshot, &request(), dir.path(), true)
        .chunks
        .is_empty());
    snapshot.entries[0].scope = f.access.scope.clone();
    snapshot.entries[0].status = Publication::Revoked;
    assert!(run(&f, &snapshot, &request(), dir.path(), true)
        .chunks
        .is_empty());
    assert_eq!(before, serde_json::to_vec(&f.originals.messages).unwrap());
}

#[test]
fn missing_original_is_explicit_and_never_fabricated() {
    let f = Fixture::new();
    let dir = tempfile::tempdir().unwrap();
    let mut snapshot = f.pending();
    snapshot.entries[0].status = Publication::Approved;
    assert_eq!(
        run(&f, &snapshot, &request(), dir.path(), false).chunks[0]["freshness"],
        "source-unavailable"
    );
    fs::remove_file(f.content.join(&snapshot.entries[0].source.slice_digest)).unwrap();
    let result = run(&f, &snapshot, &request(), dir.path(), false);
    assert_eq!(result.chunks[0]["freshness"], "source-missing");
    assert!(result.chunks[0]["originalEvidence"].is_null());
}

fn task(id: &str, source: &str, target: &str) -> Value {
    json!({"id":id,"sourceSessionId":source,"targetSessionId":target,"targetAgentId":"coder","workspaceId":"local:/one/project","status":"completed","rootTaskId":"root","dependsOn":[],"artifactRefs":[],"result":{"targetSessionId":target,"summary":"Port 7351 is the historical deployed value.","artifacts":[]}})
}

#[test]
fn dependency_results_follow_actual_task_identity_not_workspace_neighbors() {
    let mut f = Fixture::new();
    f.originals.session_ids.insert("c".into());
    let mut active = task("active", "b", "a");
    active["status"] = json!("running");
    active["dependsOn"] = json!(["dep"]);
    f.originals.meta["run"] = json!({"peerTaskId":"active","state":"running"});
    f.originals.tasks = vec![active, task("dep", "b", "c"), task("private", "b", "c")];
    let tasks = tasks_for(&f.originals, &f.access).unwrap();
    assert_eq!(tasks.len(), 2);
    let dir = tempfile::tempdir().unwrap();
    let result = run(&f, &f.snapshot(), &request(), dir.path(), true);
    assert_eq!(result.chunks.len(), 1);
    assert_eq!(result.chunks[0]["source"]["taskId"], "dep");
    assert_eq!(result.chunks[0]["required"], true);
    f.originals.tasks[1]["rootTaskId"] = json!("unrelated");
    assert!(tasks_for(&f.originals, &f.access).is_err());
    f.originals.tasks[1]["rootTaskId"] = json!("root");
    f.originals.tasks[0]["status"] = json!("cancelled");
    assert!(tasks_for(&f.originals, &f.access).is_err());
}

#[test]
fn native_recipient_rejects_chat_only_cancelled_restarted_and_other_runs() {
    let mut f = Fixture::new();
    f.originals.meta["run"] = json!({"startedAt":1,"state":"running"});
    let before = recipient(&f.originals, &request(), &json!({})).unwrap();
    assert!(recipient(
        &f.originals,
        &request(),
        &json!({"coder":{"mode":"chat-only"}})
    )
    .is_err());
    f.originals.meta["run"]["state"] = json!("interrupted");
    assert!(recipient(&f.originals, &request(), &json!({})).is_err());
    f.originals.meta["run"]["state"] = json!("running");
    f.originals.meta["run"]["startedAt"] = json!(2);
    assert!(recipient(&f.originals, &request(), &json!({})).is_err());
    f.originals.meta["run"]["startedAt"] = json!(1);
    f.originals.meta["profile"]["modelId"] = json!("changed");
    assert_ne!(
        before,
        recipient(&f.originals, &request(), &json!({})).unwrap()
    );
}

#[test]
fn file_reference_is_current_bounded_source_linked_and_missed_watcher_changes_stamp() {
    let f = Fixture::new();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.txt");
    fs::write(&path, "Do not change port 1420.").unwrap();
    fs::write(dir.path().join("unrelated.txt"), "private unrelated bytes").unwrap();
    let request = Request {
        files: vec!["config.txt".into(), "config.txt".into()],
        ..request()
    };
    let first = run(&f, &f.snapshot(), &request, dir.path(), true);
    assert_eq!(first.reads, 2);
    assert_eq!(first.chunks.len(), 1);
    assert_eq!(first.chunks[0]["freshness"], "current-file-observation");
    assert_eq!(
        first.chunks[0]["contentHash"],
        digest(b"Do not change port 1420.")
    );
    let time = fs::metadata(&path).unwrap().modified().unwrap();
    fs::write(&path, "Do not change port 7351.").unwrap();
    fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(time))
        .unwrap();
    assert_ne!(
        first.stamp,
        run(&f, &f.snapshot(), &request, dir.path(), true).stamp
    );
}

#[test]
fn artifact_hash_and_policy_are_checked_without_path_fallback() {
    let f = Fixture::new();
    let blob = put_content_in(&f.content, b"Immutable port 1420").unwrap();
    let task = task("task", "a", "b");
    let mut artifact = json!({"id":"artifact","sourceSessionId":"b","workspaceId":"local:/one/project","accessPolicy":"model-input","contentKind":"text","contentRef":{"id":blob.id,"contentHash":blob.id,"byteSize":19},"sourcePath":"config.txt"});
    assert!(task_evidence(&task, Some(&artifact), &f.content, &terms("port")).is_ok());
    artifact["sourcePath"] = json!(".env");
    assert!(task_evidence(&task, Some(&artifact), &f.content, &terms("port")).is_err());
    artifact["sourcePath"] = json!("config.txt");
    fs::write(f.content.join(&blob.id), b"corrupt").unwrap();
    assert!(task_evidence(&task, Some(&artifact), &f.content, &terms("port")).is_err());
    fs::remove_file(f.content.join(&blob.id)).unwrap();
    assert!(task_evidence(&task, Some(&artifact), &f.content, &terms("port")).is_err());
}

#[test]
fn request_bounds_and_secret_paths_fail_before_source_reads() {
    for path in ["../escape.txt", ".env", "C:/other/file.txt", "/etc/passwd"] {
        assert!(validate_request(&Request {
            files: vec![path.into()],
            ..request()
        })
        .is_err());
    }
    assert!(validate_request(&Request {
        max_chunks: 13,
        ..request()
    })
    .is_err());
    assert!(validate_request(&Request {
        max_bytes: 65537,
        ..request()
    })
    .is_err());
}

#[test]
fn passage_keeps_complete_negations_and_reports_unfit_long_lines() {
    let text = format!(
        "{}Do not change port 1420.\n{}",
        "unrelated line\n".repeat(400),
        "more lines\n".repeat(400)
    );
    let (start, end, excerpt) = passage(&text, &terms("port")).unwrap();
    assert_eq!(excerpt, &text[start..end]);
    assert!(excerpt.starts_with("Do not change port"));
    assert!(excerpt.len() <= MAX_PASSAGE);
    assert!(passage(&format!("port {}", "x".repeat(5000)), &terms("port")).is_err());
}

#[test]
fn persisted_m2_record_is_revalidated_at_use_and_retains_historical_provenance() {
    let f = Fixture::new();
    let dir = tempfile::tempdir().unwrap();
    let registry = WorkspaceRegistry::default();
    registry.authorize(dir.path()).unwrap();
    fs::write(dir.path().join("config.txt"), "port = 1420").unwrap();
    let mut snapshot = f.pending();
    let id = snapshot.entries[0].id.clone();
    decide(&mut snapshot, &f.access, &id, &Decision::Approve, true).unwrap();
    publish(&f.root, snapshot, 1, |_| Ok(())).unwrap();
    let mut snapshot = f.snapshot();
    let observed = Batch::new(&registry, dir.path())
        .unwrap()
        .read(&DependencyInput {
            path: "config.txt".into(),
            environment: false,
        })
        .unwrap();
    put_content_in(&f.content, observed.excerpt.as_bytes()).unwrap();
    install(
        &mut snapshot,
        &f.access,
        &id,
        Knowledge {
            schema_version: 1,
            dependencies: vec![observed.dependency],
            git_revision: "non-git".into(),
            environment: "test".into(),
            verified_by: "a".into(),
            verified_at: now(),
            revision: 3,
            policy: "m2-user-evidence-v1".into(),
            records: vec![],
        },
        true,
    )
    .unwrap();
    publish(&f.root, snapshot, 2, |_| Ok(())).unwrap();
    let snapshot = f.snapshot();
    let first = run(&f, &snapshot, &request(), dir.path(), true);
    assert_eq!(first.chunks.len(), 1);
    assert_eq!(first.chunks[0]["freshness"], "current");
    assert_eq!(first.chunks[0]["supersedes"], id);
    fs::write(dir.path().join("config.txt"), "port = 7351").unwrap();
    let second = run(&f, &f.snapshot(), &request(), dir.path(), true);
    assert_eq!(second.chunks[0]["freshness"], "invalidated");
    assert_eq!(
        second.chunks[0]["currentEvidence"][0]["excerpt"],
        "port = 7351"
    );
    assert_eq!(second.chunks[0]["text"], first.chunks[0]["text"]);
    assert_ne!(first.stamp, second.stamp);
    assert_eq!(f.snapshot().revision, 3);
    assert_eq!(
        run(&f, &f.snapshot(), &request(), dir.path(), true).stamp,
        second.stamp
    );
}

#[test]
fn current_claims_linked_to_revoked_dependencies_are_invalidated() {
    let f = Fixture::new();
    let dir = tempfile::tempdir().unwrap();
    let registry = WorkspaceRegistry::default();
    registry.authorize(dir.path()).unwrap();
    fs::write(dir.path().join("config.txt"), "port = 1420").unwrap();
    let mut snapshot = f.pending();
    let mut source = snapshot.entries[0].clone();
    source.id = digest(b"related-source");
    source.status = Publication::Revoked;
    let observation = Batch::new(&registry, dir.path())
        .unwrap()
        .read(&DependencyInput {
            path: "config.txt".into(),
            environment: false,
        })
        .unwrap();
    put_content_in(&f.content, observation.excerpt.as_bytes()).unwrap();
    snapshot.entries[0].status = Publication::Approved;
    snapshot.entries[0].knowledge = Some(Knowledge {
        schema_version: 1,
        dependencies: vec![observation.dependency],
        git_revision: "non-git".into(),
        environment: "test".into(),
        verified_by: "a".into(),
        verified_at: now(),
        revision: 1,
        policy: "m2-user-evidence-v1".into(),
        records: vec![source.id.clone()],
    });
    snapshot.entries.push(source);
    let result = run(&f, &snapshot, &request(), dir.path(), true);
    assert_eq!(result.chunks.len(), 1);
    assert_eq!(result.chunks[0]["freshness"], "invalidated");
}

#[test]
fn conflicts_are_qualified_and_different_workspace_content_never_ranks() {
    let f = Fixture::new();
    let dir = tempfile::tempdir().unwrap();
    let mut snapshot = f.pending();
    snapshot.entries[0].status = Publication::Approved;
    let mut other = snapshot.entries[0].clone();
    other.id = digest(b"other-source");
    other.conflicts = vec![snapshot.entries[0].id.clone()];
    snapshot.entries.push(other);
    let result = run(&f, &snapshot, &request(), dir.path(), true);
    assert_eq!(result.chunks.len(), 2);
    assert!(result
        .chunks
        .iter()
        .all(|c| c["freshness"] == "conflicting"));
    for entry in &mut snapshot.entries {
        entry.scope.workspace = "local:/other".into();
    }
    assert!(run(&f, &snapshot, &request(), dir.path(), true)
        .chunks
        .is_empty());
}

#[test]
fn required_missing_anchor_is_not_satisfied_by_an_unrelated_dependency() {
    let mut f = Fixture::new();
    f.originals.tasks = vec![task("allowed", "a", "b")];
    let registry = WorkspaceRegistry::default();
    let dir = tempfile::tempdir().unwrap();
    registry.authorize(dir.path()).unwrap();
    let request = Request {
        anchor: Some("task:unrelated".into()),
        ..request()
    };
    let result = collect(
        Selection {
            access: &f.access,
            originals: &f.originals,
            snapshot: &f.snapshot(),
            content: &f.content,
            git: "non-git",
            environment: "test",
        },
        &request,
        &mut Batch::new(&registry, dir.path()).unwrap(),
        &mut |_| true,
    );
    assert!(result.err().unwrap().contains("anchor_unavailable"));
}

#[test]
fn required_sources_fail_closed_at_native_byte_or_chunk_limits() {
    let f = Fixture::new();
    let mut snapshot = f.pending();
    snapshot.entries[0].status = Publication::Approved;
    let registry = WorkspaceRegistry::default();
    let dir = tempfile::tempdir().unwrap();
    registry.authorize(dir.path()).unwrap();
    let request = Request {
        anchor: Some(format!("project:{}", snapshot.entries[0].id)),
        max_bytes: 1,
        ..request()
    };
    let result = collect(
        Selection {
            access: &f.access,
            originals: &f.originals,
            snapshot: &snapshot,
            content: &f.content,
            git: "non-git",
            environment: "test",
        },
        &request,
        &mut Batch::new(&registry, dir.path()).unwrap(),
        &mut |_| true,
    );
    assert!(result.err().unwrap().contains("required_no_fit"));
}

#[test]
fn task_revision_and_result_changes_invalidate_ephemeral_receipts() {
    let mut f = Fixture::new();
    let dir = tempfile::tempdir().unwrap();
    f.originals.tasks = vec![task("allowed", "a", "b")];
    let first = run(&f, &f.snapshot(), &request(), dir.path(), true);
    f.originals.tasks[0]["result"]["summary"] = json!("Port 9000 instead.");
    let second = run(&f, &f.snapshot(), &request(), dir.path(), true);
    assert_ne!(first.stamp, second.stamp);
    f.originals.tasks[0]["workspaceId"] = json!("local:/other");
    assert!(run(&f, &f.snapshot(), &request(), dir.path(), true)
        .chunks
        .is_empty());
}

#[test]
fn unmerged_worktree_artifact_stays_historical_and_requires_exact_provenance() {
    let f = Fixture::new();
    let blob = put_content_in(&f.content, b"port 1420").unwrap();
    let mut task = task("task", "a", "b");
    task["worktree"] = json!({"checkoutRoot":"/unmerged","baseSha":"a".repeat(40)});
    let mut artifact = json!({"id":"artifact","sourceSessionId":"b","workspaceId":"local:/one/project","accessPolicy":"model-input","contentKind":"text","contentRef":{"id":blob.id,"contentHash":blob.id,"byteSize":9},"worktreeProvenance":{"taskId":"task","baseSha":"a".repeat(40)}});
    assert!(task_evidence(&task, Some(&artifact), &f.content, &terms("port")).is_ok());
    artifact["worktreeProvenance"]["baseSha"] = json!("b".repeat(40));
    assert!(!artifact_allowed(&task, &artifact));
}

#[test]
fn mandatory_task_evidence_takes_precedence_over_optional_project_matches() {
    let mut f = Fixture::new();
    let dir = tempfile::tempdir().unwrap();
    let mut snapshot = f.pending();
    snapshot.entries[0].status = Publication::Approved;
    f.originals.tasks = vec![task("required", "a", "b")];
    let request = Request {
        anchor: Some("task:required".into()),
        max_chunks: 1,
        ..request()
    };
    let result = run(&f, &snapshot, &request, dir.path(), true);
    assert_eq!(result.chunks.len(), 1);
    assert_eq!(result.chunks[0]["source"]["taskId"], "required");
    assert_eq!(result.omitted, 1);
}

#[test]
fn candidate_cap_cannot_silently_drop_mandatory_dependency_artifacts() {
    let mut f = Fixture::new();
    let mut active = task("active", "b", "a");
    active["status"] = json!("running");
    active["dependsOn"] = json!(["dep"]);
    let mut dependency = task("dep", "a", "b");
    let artifacts: Vec<_> = (0..16).map(|n| json!({"id":format!("artifact-{n}"),"workspaceId":"local:/one/project","sourceSessionId":"b","accessPolicy":"model-input","contentKind":"text"})).collect();
    dependency["artifactRefs"] = json!(&artifacts[..8]);
    dependency["result"]["artifacts"] = json!(&artifacts[8..]);
    f.originals.meta["run"] = json!({"peerTaskId":"active","state":"running"});
    f.originals.tasks = vec![active, dependency];
    let registry = WorkspaceRegistry::default();
    let dir = tempfile::tempdir().unwrap();
    registry.authorize(dir.path()).unwrap();
    let result = collect(
        Selection {
            access: &f.access,
            originals: &f.originals,
            snapshot: &f.snapshot(),
            content: &f.content,
            git: "non-git",
            environment: "test",
        },
        &request(),
        &mut Batch::new(&registry, dir.path()).unwrap(),
        &mut |_| true,
    );
    assert!(result.err().unwrap().contains("required_no_fit"));
}

#[test]
fn tool_result_promotions_expose_only_the_consented_source_slice() {
    let f = Fixture::new();
    let dir = tempfile::tempdir().unwrap();
    let mut snapshot = f.snapshot();
    let mut proposal = f.proposal();
    proposal.locator = SourceLocator::Part {
        message_id: "t".into(),
        part_index: 0,
    };
    proposal.start = 0;
    proposal.end = "Observed port 1420.".len();
    propose(&mut snapshot, &f.access, &f.originals, &f.content, proposal).unwrap();
    let id = snapshot.entries[0].id.clone();
    decide(&mut snapshot, &f.access, &id, &Decision::Approve, true).unwrap();
    let result = run(&f, &snapshot, &request(), dir.path(), true);
    assert_eq!(result.chunks[0]["qualification"], "tool-observation");
    assert_eq!(result.chunks[0]["freshness"], "needs-revalidation");
    assert_eq!(result.chunks[0]["source"]["locator"]["messageId"], "t");
    assert_eq!(result.chunks[0]["originalEvidence"], "Observed port 1420.");
    assert!(!serde_json::to_string(&result)
        .unwrap()
        .contains("private reasoning"));
}
