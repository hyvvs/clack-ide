use super::*;
use std::sync::Barrier;

struct Fixture {
    directory: tempfile::TempDir,
    root: PathBuf,
    content: PathBuf,
    originals: Originals,
    owner: Owner,
}

impl Fixture {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("memory");
        let content = directory.path().join("ai-attachments");
        Self {
            directory,
            root,
            content,
            owner: Owner {
                session_id: "chat-a".into(),
                workspace_id: Some("local:/project".into()),
            },
            originals: Originals {
                meta: json!({"id":"chat-a","title":"Original title","profile":{"agentId":"a","modelId":"m","workspaceId":"local:/project","workspaceRoot":"/project"},
                    "run":{"state":"completed","startedAt":1,"agentId":"a","modelId":"m","providerId":"openai","transportModelId":"model-route"}}),
                messages: vec![
                    json!({"id":"u1","role":"user","parts":[{"type":"text","text":"Never change the port: 1420."}]}),
                    json!({"id":"a1","role":"assistant","parts":[{"type":"tool-read_file","toolCallId":"call-1","state":"output-available","input":{"path":"src/main.ts"},"output":{"content":"exact original result"}}]}),
                ],
                tasks: vec![],
                session_ids: BTreeSet::from(["chat-a".into(), "chat-b".into()]),
            },
        }
    }

    fn view(&self) -> Result<MemoryView> {
        load(&self.root, &self.content, &self.originals, &self.owner)
    }
    fn candidate(&self) -> Candidate {
        let preparation = self.view().unwrap().preparation;
        let locator = SourceLocator::Message {
            message_id: "u1".into(),
        };
        let (evidence, _) = evidence_for(
            &self.root,
            &self.content,
            &self.originals,
            &self.owner,
            locator.clone(),
        )
        .unwrap();
        Candidate {
            preparation,
            policy_version: "test-1".into(),
            start: 0,
            end: 2,
            sources: vec![locator],
            claims: vec![Claim {
                id: "requirement-port".into(),
                section: Section::Requirements,
                status: ClaimStatus::UserRequirement,
                text: "Never change the port: 1420.".into(),
                sources: vec![evidence.id],
                observed_at: 1,
                contradicts: vec![],
            }],
        }
    }
    fn commit(&self, candidate: Candidate) -> Result<String> {
        commit(
            &self.root,
            &self.content,
            &self.originals,
            candidate,
            |_| Ok(()),
        )
    }
    fn initial(&self) -> String {
        self.commit(self.candidate()).unwrap()
    }
}

#[test]
fn migration_is_additive_idempotent_and_preserves_original_hashes() {
    let fixture = Fixture::new();
    let before = hash(&fixture.originals.messages).unwrap();
    let first = fixture.view().unwrap().preparation;
    let second = fixture.view().unwrap().preparation;
    assert_eq!(first, second);
    assert_eq!(before, hash(&fixture.originals.messages).unwrap());
    assert!(fixture.view().unwrap().revision.is_none());
}

#[test]
fn committed_memory_survives_fresh_reader_and_preserves_transcript() {
    let fixture = Fixture::new();
    let before = serde_json::to_vec(&fixture.originals.messages).unwrap();
    let id = fixture.initial();
    let reopened = fixture.view().unwrap();
    assert_eq!(reopened.revision_id, Some(id));
    assert_eq!(
        reopened.revision.unwrap().claims[0].text,
        "Never change the port: 1420."
    );
    assert_eq!(
        before,
        serde_json::to_vec(&fixture.originals.messages).unwrap()
    );
}

#[test]
fn early_source_only_manifest_restores_without_changing_originals_or_disk_on_read() {
    let fixture = Fixture::new();
    fixture.view().unwrap();
    let path = manifest_path(&fixture.root, "chat-a");
    let mut legacy: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    legacy.as_object_mut().unwrap().remove("revision");
    let bytes = serde_json::to_vec(&legacy).unwrap();
    fs::write(&path, &bytes).unwrap();
    let originals = hash(&fixture.originals.messages).unwrap();
    for _ in 0..2 {
        let view = fixture.view().unwrap();
        assert!(view.revision.is_none());
        assert!(collect_roots(&fixture.root, &fixture.originals.session_ids)
            .unwrap()
            .is_empty());
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(hash(&fixture.originals.messages).unwrap(), originals);
    }
    fixture.initial();
    assert_eq!(fixture.view().unwrap().revision.unwrap().revision, 1);
    assert_eq!(
        read_manifest(&fixture.root, "chat-a")
            .unwrap()
            .unwrap()
            .revision,
        1
    );
}

#[test]
fn missing_counter_with_committed_history_still_fails_closed() {
    let fixture = Fixture::new();
    fixture.initial();
    let path = manifest_path(&fixture.root, "chat-a");
    let mut value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    value.as_object_mut().unwrap().remove("revision");
    fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
    assert!(fixture.view().is_err());
    assert!(collect_roots(&fixture.root, &fixture.originals.session_ids).is_err());
    value["revisions"] = json!([]);
    fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
    assert!(fixture.view().is_err());
    assert!(collect_roots(&fixture.root, &fixture.originals.session_ids).is_err());
}

#[test]
fn early_manifest_compatibility_does_not_relax_other_validation() {
    let fixture = Fixture::new();
    fixture.view().unwrap();
    let path = manifest_path(&fixture.root, "chat-a");
    let mut legacy: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    legacy.as_object_mut().unwrap().remove("revision");
    for (key, invalid) in [
        ("schemaVersion", json!(999)),
        ("sessionId", json!("another-chat")),
        ("unexpected", json!(true)),
        ("revisions", Value::Null),
        ("revision", Value::Null),
    ] {
        let mut value = legacy.clone();
        value[key] = invalid;
        let bytes = serde_json::to_vec(&value).unwrap();
        fs::write(&path, &bytes).unwrap();
        assert!(fixture.view().is_err(), "accepted {key}");
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
}

#[test]
fn manifest_compatibility_still_rejects_duplicate_json_fields() {
    let fixture = Fixture::new();
    fixture.view().unwrap();
    let path = manifest_path(&fixture.root, "chat-a");
    let mut value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    for legacy in [false, true] {
        if legacy {
            value.as_object_mut().unwrap().remove("revision");
        }
        let duplicate =
            serde_json::to_string(&value)
                .unwrap()
                .replacen('{', "{\"generation\":0,", 1);
        fs::write(&path, duplicate.as_bytes()).unwrap();
        assert!(fixture.view().err().unwrap().contains("duplicate field"));
        assert!(collect_roots(&fixture.root, &fixture.originals.session_ids).is_err());
        assert_eq!(fs::read(&path).unwrap(), duplicate.as_bytes());
    }
}

#[test]
fn rename_and_pane_reopen_preserve_identity_and_revision() {
    let mut fixture = Fixture::new();
    let id = fixture.initial();
    let before = fixture.view().unwrap().preparation;
    fixture.originals.meta["title"] = json!("Renamed");
    let after = fixture.view().unwrap();
    assert_eq!(before, after.preparation);
    assert_eq!(after.revision_id, Some(id));
}

#[test]
fn agent_and_model_changes_keep_memory_but_reject_old_preparation() {
    for key in ["agentId", "modelId"] {
        let mut fixture = Fixture::new();
        let id = fixture.initial();
        let old = fixture.candidate();
        fixture.originals.meta["profile"][key] = json!("changed");
        assert_eq!(fixture.commit(old).unwrap_err(), "memory_stale_preparation");
        assert_eq!(fixture.view().unwrap().revision_id, Some(id));
        assert_eq!(fixture.view().unwrap().preparation.owner, fixture.owner);
    }
}

#[test]
fn source_ids_are_deterministic_and_content_sensitive() {
    let mut fixture = Fixture::new();
    let first = fixture.candidate().claims[0].sources[0].clone();
    assert_eq!(first, fixture.candidate().claims[0].sources[0]);
    fixture.originals.messages[0]["parts"][0]["text"] = json!("Changed branch");
    assert_ne!(first, fixture.candidate().claims[0].sources[0]);
}

#[test]
fn cross_conversation_and_workspace_owners_fail_closed() {
    let fixture = Fixture::new();
    for owner in [
        Owner {
            session_id: "chat-b".into(),
            ..fixture.owner.clone()
        },
        Owner {
            workspace_id: Some("local:/other".into()),
            ..fixture.owner.clone()
        },
    ] {
        assert_eq!(
            load(&fixture.root, &fixture.content, &fixture.originals, &owner)
                .err()
                .unwrap(),
            "memory_owner_mismatch"
        );
    }
}

#[test]
fn conversation_paths_do_not_interpret_user_ids_as_paths() {
    let fixture = Fixture::new();
    let path = manifest_path(&fixture.root, "../../outside");
    assert!(path.starts_with(&fixture.root));
    assert_eq!(path.parent().unwrap().parent().unwrap(), fixture.root);
}

#[test]
fn coverage_excludes_new_messages_and_stale_preparations() {
    let mut fixture = Fixture::new();
    fixture.initial();
    let old = fixture.candidate();
    fixture
        .originals
        .messages
        .push(json!({"id":"later","role":"user","parts":[{"type":"text","text":"A new fact"}]}));
    assert_eq!(fixture.commit(old).unwrap_err(), "memory_stale_preparation");
    let view = fixture.view().unwrap();
    assert_eq!(view.uncovered_messages, 1);
    assert!(!view.source_changed);
    assert_eq!(view.revision.unwrap().coverage.latest_message_id, "a1");
}

#[test]
fn source_branch_edits_keep_exact_prior_evidence_without_retargeting() {
    let mut fixture = Fixture::new();
    let id = fixture.initial();
    let original = fixture.view().unwrap().revision.unwrap().evidence[0].clone();
    fixture.originals.messages[0]["parts"][0]["text"] = json!("Actually change the port.");
    assert!(fixture.view().unwrap().source_changed);
    let (retained, bytes) = evidence_for(
        &fixture.root,
        &fixture.content,
        &fixture.originals,
        &fixture.owner,
        SourceLocator::Retained {
            revision_id: id,
            evidence_id: original.id.clone(),
        },
    )
    .unwrap();
    assert_eq!(retained.id, original.id);
    assert!(String::from_utf8(bytes).unwrap().contains("Never change"));
}

#[test]
fn retained_original_evidence_can_be_carried_forward_across_revisions() {
    let mut fixture = Fixture::new();
    let first = fixture.initial();
    let old = fixture.view().unwrap().revision.unwrap().evidence[0].clone();
    fixture.originals.messages[0]["parts"][0]["text"] = json!("New branch");
    let mut next = fixture.candidate();
    next.sources = vec![SourceLocator::Retained {
        revision_id: first.clone(),
        evidence_id: old.id.clone(),
    }];
    next.claims[0].sources = vec![old.id];
    fixture.commit(next).unwrap();
    assert_eq!(
        fixture
            .view()
            .unwrap()
            .revision
            .unwrap()
            .preparation
            .previous,
        Some(first)
    );
}

#[test]
fn tool_call_and_result_parts_are_preserved_together() {
    let fixture = Fixture::new();
    let mut candidate = fixture.candidate();
    candidate.sources.push(SourceLocator::Part {
        message_id: "a1".into(),
        part_index: 0,
    });
    fixture.commit(candidate).unwrap();
    let revision = fixture.view().unwrap().revision.unwrap();
    let tool = revision
        .evidence
        .iter()
        .find(|e| matches!(e.locator, SourceLocator::Part { .. }))
        .unwrap();
    let value: Value =
        serde_json::from_slice(&read_content_from(&fixture.content, &tool.digest).unwrap())
            .unwrap();
    assert_eq!(value["toolCallId"], "call-1");
    assert_eq!(value["input"]["path"], "src/main.ts");
    assert_eq!(value["output"]["content"], "exact original result");
}

#[test]
fn duplicate_locators_are_deduplicated_deterministically() {
    let fixture = Fixture::new();
    let mut candidate = fixture.candidate();
    candidate.sources.push(candidate.sources[0].clone());
    fixture.commit(candidate).unwrap();
    assert_eq!(fixture.view().unwrap().revision.unwrap().evidence.len(), 1);
}

#[test]
fn missing_sources_are_not_fabricated() {
    let fixture = Fixture::new();
    let mut candidate = fixture.candidate();
    candidate.sources[0] = SourceLocator::Message {
        message_id: "missing".into(),
    };
    assert_eq!(
        fixture.commit(candidate).unwrap_err(),
        "memory_missing_message"
    );
    assert!(fixture.view().unwrap().revision.is_none());
}

#[test]
fn invented_claim_references_and_contradictions_fail_validation() {
    let fixture = Fixture::new();
    for contradiction in [true, false] {
        let mut candidate = fixture.candidate();
        if contradiction {
            candidate.claims[0].contradicts.push("invented".into());
        } else {
            candidate.claims[0].sources.push("invented".into());
        }
        assert!(fixture.commit(candidate).is_err());
    }
}

#[test]
fn duplicate_message_ids_and_invalid_coverage_fail() {
    let mut fixture = Fixture::new();
    let mut candidate = fixture.candidate();
    candidate.end = 3;
    assert_eq!(
        fixture.commit(candidate).unwrap_err(),
        "memory_invalid_candidate"
    );
    fixture
        .originals
        .messages
        .push(fixture.originals.messages[0].clone());
    assert_eq!(
        fixture.view().err().unwrap(),
        "memory_duplicate_message_identity"
    );
}

#[test]
fn failed_update_preserves_the_previous_committed_revision() {
    let fixture = Fixture::new();
    let id = fixture.initial();
    let mut candidate = fixture.candidate();
    candidate.claims[0].sources = vec!["bad".into()];
    assert!(fixture.commit(candidate).is_err());
    assert_eq!(fixture.view().unwrap().revision_id, Some(id));
}

#[test]
fn stale_and_cancelled_generations_cannot_overwrite_newer_memory() {
    let fixture = Fixture::new();
    let candidate = fixture.candidate();
    fixture.initial();
    assert_eq!(
        fixture.commit(candidate).unwrap_err(),
        "memory_stale_preparation"
    );
    let candidate = fixture.candidate();
    let mut manifest = read_manifest(&fixture.root, "chat-a").unwrap().unwrap();
    manifest.generation += 1;
    write_manifest(&fixture.root, &manifest).unwrap();
    assert_eq!(
        fixture.commit(candidate).unwrap_err(),
        "memory_stale_preparation"
    );
}

#[test]
fn two_window_publications_have_exactly_one_winner() {
    let fixture = Fixture::new();
    let first = fixture.candidate();
    let second = fixture.candidate();
    let state = MemoryState::default();
    let barrier = Barrier::new(2);
    std::thread::scope(|scope| {
        let publish = |candidate| {
            barrier.wait();
            let lock = state.owner("chat-a").unwrap();
            let _guard = lock.lock().unwrap();
            fixture.commit(candidate)
        };
        let a = scope.spawn(move || publish(first));
        let b = scope.spawn(move || publish(second));
        let results = [a.join().unwrap(), b.join().unwrap()];
        assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|r| r
                    .as_ref()
                    .err()
                    .is_some_and(|e| e == "memory_stale_preparation"))
                .count(),
            1
        );
    });
    assert_eq!(fixture.view().unwrap().revision.unwrap().revision, 1);
}

#[test]
fn unrelated_conversations_have_independent_locks() {
    let state = MemoryState::default();
    let first = state.owner("a").unwrap();
    let _guard = first.lock().unwrap();
    let second = state.owner("b").unwrap();
    assert!(second.try_lock().is_ok());
    assert!(Arc::ptr_eq(&first, &state.owner("a").unwrap()));
}

#[test]
fn every_publication_crash_boundary_recovers_old_or_new_commit() {
    for point in [
        "before-evidence",
        "after-evidence",
        "before-revision",
        "after-revision",
        "before-manifest",
        "after-manifest",
    ] {
        let fixture = Fixture::new();
        let previous = fixture.initial();
        let candidate = fixture.candidate();
        let result = commit(
            &fixture.root,
            &fixture.content,
            &fixture.originals,
            candidate,
            |stage| {
                if stage == point {
                    Err(format!("injected crash at {point}"))
                } else {
                    Ok(())
                }
            },
        );
        assert!(result.is_err());
        let recovered = fixture.view().unwrap();
        if point == "after-manifest" {
            assert_ne!(recovered.revision_id, Some(previous));
        } else {
            assert_eq!(recovered.revision_id, Some(previous));
        }
        assert_eq!(fixture.view().unwrap().preparation, recovered.preparation);
    }
}

#[test]
fn full_disk_failure_before_publication_preserves_previous_memory() {
    let fixture = Fixture::new();
    let previous = fixture.initial();
    assert!(commit(
        &fixture.root,
        &fixture.content,
        &fixture.originals,
        fixture.candidate(),
        |stage| {
            if stage == "before-manifest" {
                Err(std::io::Error::from_raw_os_error(112).to_string())
            } else {
                Ok(())
            }
        }
    )
    .is_err());
    assert_eq!(fixture.view().unwrap().revision_id, Some(previous));
}

#[test]
fn interrupted_migration_never_replaces_legacy_transcript() {
    let fixture = Fixture::new();
    let legacy = fixture.directory.path().join(SESSION_STORE);
    let bytes = serde_json::to_vec(
        &json!({"sessions":[fixture.originals.meta],"messages:chat-a":fixture.originals.messages}),
    )
    .unwrap();
    fs::write(&legacy, &bytes).unwrap();
    fs::write(&fixture.root, b"storage unavailable").unwrap();
    assert!(fixture.view().is_err());
    assert_eq!(fs::read(&legacy).unwrap(), bytes);
    fs::remove_file(&fixture.root).unwrap();
    assert!(fixture.view().unwrap().revision.is_none());
    require_durable_source(&legacy, &fixture.originals).unwrap();
}

#[test]
fn legacy_readers_see_identical_chat_json_after_memory_commit() {
    let fixture = Fixture::new();
    let legacy = fixture.directory.path().join(SESSION_STORE);
    let bytes = serde_json::to_vec(
        &json!({"sessions":[fixture.originals.meta],"messages:chat-a":fixture.originals.messages}),
    )
    .unwrap();
    fs::write(&legacy, &bytes).unwrap();
    fixture.initial();
    assert_eq!(fs::read(legacy).unwrap(), bytes);
}

#[test]
fn unsaved_originals_cannot_be_the_basis_of_durable_memory() {
    let mut fixture = Fixture::new();
    let path = fixture.directory.path().join(SESSION_STORE);
    assert!(require_durable_source(&path, &fixture.originals).is_err());
    fs::write(&path, serde_json::to_vec(&json!({"sessions":[fixture.originals.meta],"messages:chat-a":fixture.originals.messages})).unwrap()).unwrap();
    require_durable_source(&path, &fixture.originals).unwrap();
    fixture.originals.messages[0]["parts"][0]["text"] = json!("Unsaved text");
    assert_eq!(
        require_durable_source(&path, &fixture.originals).unwrap_err(),
        "memory_source_not_durable"
    );
}

#[test]
fn malformed_unsupported_and_oversized_manifests_are_explicit_errors() {
    let fixture = Fixture::new();
    fixture.view().unwrap();
    let path = manifest_path(&fixture.root, "chat-a");
    let mut value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    value["schemaVersion"] = json!(999);
    fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
    assert_eq!(fixture.view().err().unwrap(), "memory_unsupported_schema");
    fs::write(&path, b"not json").unwrap();
    assert!(fixture.view().err().unwrap().starts_with("memory_corrupt"));
    fs::write(&path, vec![b' '; MAX_RECORD + 1]).unwrap();
    assert_eq!(fixture.view().err().unwrap(), "memory_oversized");
}

#[test]
fn corrupt_revision_checksum_never_becomes_reliable_memory() {
    let fixture = Fixture::new();
    let id = fixture.initial();
    fs::write(
        manifest_path(&fixture.root, "chat-a").with_file_name(format!("{id}.json")),
        b"{}",
    )
    .unwrap();
    assert_eq!(fixture.view().err().unwrap(), "memory_integrity_failed");
}

#[test]
fn missing_and_corrupt_evidence_fail_closed_without_touching_messages() {
    for missing in [true, false] {
        let fixture = Fixture::new();
        fixture.initial();
        let revision = fixture.view().unwrap().revision.unwrap();
        let path = fixture.content.join(&revision.evidence[0].digest);
        if missing {
            fs::remove_file(path).unwrap();
        } else {
            fs::write(path, b"corrupt").unwrap();
        }
        assert!(fixture.view().is_err());
        assert_eq!(fixture.originals.messages.len(), 2);
    }
}

#[test]
fn attachments_keep_original_identity_and_join_retention_roots() {
    let mut fixture = Fixture::new();
    let stored = put_content_in(&fixture.content, b"original attachment").unwrap();
    fixture.originals.messages[0]["parts"].as_array_mut().unwrap().push(json!({"type":"data-clack-attachment","data":{
        "attachmentId":"att-1","contentId":stored.id,"contentHash":stored.id,"byteSize":stored.byte_size}}));
    let before = hash(&fixture.originals.messages).unwrap();
    fixture.initial();
    let roots = collect_roots(&fixture.root, &fixture.originals.session_ids).unwrap();
    assert!(roots.contains(&stored.id));
    assert_eq!(before, hash(&fixture.originals.messages).unwrap());
    assert_eq!(fs::read_dir(&fixture.content).unwrap().count(), 2);
}

fn task_fixture(fixture: &mut Fixture) -> String {
    let stored = put_content_in(&fixture.content, b"immutable peer artifact").unwrap();
    fixture.originals.tasks.push(json!({"id":"task-1","sourceSessionId":"chat-a","targetSessionId":"chat-b","workspaceId":"local:/project",
        "result":{"summary":"tests passed","targetSessionId":"chat-b","completedAt":2,"artifacts":[{
            "id":"artifact-1","sourceSessionId":"chat-b","sourceTaskId":"task-1","workspaceId":"local:/project",
            "contentRef":{"id":stored.id,"contentHash":stored.id,"byteSize":stored.byte_size},"sourcePath":"/project/out.txt"}]}}));
    stored.id
}

#[test]
fn pruned_peer_results_and_artifacts_remain_traceable_and_retained() {
    let mut fixture = Fixture::new();
    let artifact = task_fixture(&mut fixture);
    let mut candidate = fixture.candidate();
    candidate.sources.push(SourceLocator::TaskResult {
        task_id: "task-1".into(),
    });
    candidate.sources.push(SourceLocator::Artifact {
        task_id: "task-1".into(),
        artifact_id: "artifact-1".into(),
    });
    fixture.commit(candidate).unwrap();
    fixture.originals.tasks.clear();
    let revision = fixture.view().unwrap().revision.unwrap();
    assert_eq!(revision.evidence.len(), 3);
    assert!(collect_roots(&fixture.root, &fixture.originals.session_ids)
        .unwrap()
        .contains(&artifact));
}

#[test]
fn explicit_peer_source_session_deletion_revokes_memory_and_roots() {
    let mut fixture = Fixture::new();
    task_fixture(&mut fixture);
    let mut candidate = fixture.candidate();
    candidate.sources.push(SourceLocator::TaskResult {
        task_id: "task-1".into(),
    });
    fixture.commit(candidate).unwrap();
    fixture.originals.session_ids.remove("chat-b");
    assert_eq!(fixture.view().err().unwrap(), "memory_source_revoked");
    assert!(collect_roots(&fixture.root, &fixture.originals.session_ids)
        .unwrap()
        .is_empty());
}

#[test]
fn cross_workspace_and_unrelated_peer_task_references_are_rejected() {
    for workspace in [true, false] {
        let mut fixture = Fixture::new();
        task_fixture(&mut fixture);
        if workspace {
            fixture.originals.tasks[0]["workspaceId"] = json!("local:/other");
        } else {
            fixture.originals.tasks[0]["sourceSessionId"] = json!("chat-c");
        }
        let mut candidate = fixture.candidate();
        candidate.sources.push(SourceLocator::TaskResult {
            task_id: "task-1".into(),
        });
        assert_eq!(
            fixture.commit(candidate).unwrap_err(),
            "memory_unauthorized_task"
        );
    }
}

#[test]
fn deleted_conversations_release_evidence_and_cannot_be_recreated_by_late_work() {
    let fixture = Fixture::new();
    fixture.initial();
    let old = fixture.candidate();
    tombstone(&fixture.root, "chat-a").unwrap();
    assert_eq!(fixture.commit(old).unwrap_err(), "memory_session_deleted");
    assert!(collect_roots(&fixture.root, &fixture.originals.session_ids)
        .unwrap()
        .is_empty());
}

#[test]
fn orphan_revisions_are_cleaned_and_committed_revisions_preserved() {
    let fixture = Fixture::new();
    let first = fixture.initial();
    assert!(commit(
        &fixture.root,
        &fixture.content,
        &fixture.originals,
        fixture.candidate(),
        |stage| {
            if stage == "after-revision" {
                Err("crash".into())
            } else {
                Ok(())
            }
        }
    )
    .is_err());
    let folder = manifest_path(&fixture.root, "chat-a")
        .parent()
        .unwrap()
        .to_path_buf();
    assert_eq!(fs::read_dir(&folder).unwrap().count(), 3);
    collect_roots(&fixture.root, &fixture.originals.session_ids).unwrap();
    assert_eq!(fs::read_dir(&folder).unwrap().count(), 2);
    assert!(folder.join(format!("{first}.json")).exists());
}

#[test]
fn ten_cycles_retain_early_original_evidence_without_summary_lineage() {
    let mut fixture = Fixture::new();
    let original_hash = hash(&fixture.originals.messages[0]).unwrap();
    for i in 0..10 {
        fixture.originals.messages.push(json!({"id":format!("later-{i}"),"role":"user","parts":[{"type":"text","text":format!("Fact {i}")}]}));
        fixture.initial();
        let view = fixture.view().unwrap();
        assert_eq!(view.revision.unwrap().revision, i + 1);
        assert_eq!(hash(&fixture.originals.messages[0]).unwrap(), original_hash);
    }
    let manifest = read_manifest(&fixture.root, "chat-a").unwrap().unwrap();
    assert_eq!(manifest.revisions.len(), 10);
    assert_eq!(
        collect_roots(&fixture.root, &fixture.originals.session_ids)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn selection_and_run_history_is_bounded_and_excludes_credentials() {
    let mut fixture = Fixture::new();
    fixture.originals.meta["run"]["apiKey"] = json!("never persist this");
    fixture.originals.meta["run"]["endpointBaseURL"] =
        json!("https://user:secret@host/?key=secret");
    for i in 0..140 {
        fixture.originals.meta["profile"]["modelId"] = json!(format!("model-{i}"));
        fixture.view().unwrap();
    }
    let manifest = read_manifest(&fixture.root, "chat-a").unwrap().unwrap();
    assert_eq!(manifest.events.len(), 128);
    assert_eq!(manifest.source.profile_revision, 140);
    let serialized = serde_json::to_string(&manifest).unwrap();
    assert!(!serialized.contains("secret"));
    assert!(!serialized.contains("never persist"));
}

#[test]
fn oversized_claims_and_inline_binary_are_rejected() {
    let mut fixture = Fixture::new();
    let mut candidate = fixture.candidate();
    candidate.claims[0].text = "x".repeat(8193);
    assert_eq!(
        fixture.commit(candidate).unwrap_err(),
        "memory_invalid_claim"
    );
    fixture.originals.messages[0]["parts"][0]["text"] = json!("data:image/png;base64,AAAA");
    let locator = SourceLocator::Message {
        message_id: "u1".into(),
    };
    assert_eq!(
        evidence_for(
            &fixture.root,
            &fixture.content,
            &fixture.originals,
            &fixture.owner,
            locator
        )
        .unwrap_err(),
        "memory_inline_binary_not_allowed"
    );
}

#[test]
fn real_attachment_collection_keeps_memory_roots_and_removes_unreferenced_blobs() {
    let fixture = Fixture::new();
    fixture.initial();
    let garbage = put_content_in(&fixture.content, b"unreferenced blob").unwrap();
    let roots = collect_roots(&fixture.root, &fixture.originals.session_ids).unwrap();
    super::super::attachments::reconcile_store(&fixture.content, &roots).unwrap();
    assert!(!fixture.content.join(garbage.id).exists());
    assert!(fixture.view().unwrap().revision.is_some());
    tombstone(&fixture.root, "chat-a").unwrap();
    let roots = collect_roots(&fixture.root, &fixture.originals.session_ids).unwrap();
    super::super::attachments::reconcile_store(&fixture.content, &roots).unwrap();
    assert_eq!(fs::read_dir(&fixture.content).unwrap().count(), 0);
}

#[test]
fn collection_waits_for_inflight_memory_publication() {
    let _publication = CONTENT_COLLECTION.read().unwrap();
    assert!(CONTENT_COLLECTION.try_write().is_err());
    assert!(CONTENT_COLLECTION.try_read().is_ok());
}

#[test]
fn rolling_revision_retention_preserves_current_and_previous_without_leaking_metadata() {
    let fixture = Fixture::new();
    let first = fixture.initial();
    for _ in 0..34 {
        fixture.initial();
    }
    let manifest = read_manifest(&fixture.root, "chat-a").unwrap().unwrap();
    assert_eq!(manifest.revision, 35);
    assert_eq!(manifest.revisions.len(), 32);
    assert!(!manifest.revisions.contains(&first));
    let view = fixture.view().unwrap();
    assert_eq!(view.revision.unwrap().revision, 35);
    collect_roots(&fixture.root, &fixture.originals.session_ids).unwrap();
    let folder = manifest_path(&fixture.root, "chat-a")
        .parent()
        .unwrap()
        .to_path_buf();
    assert_eq!(fs::read_dir(folder).unwrap().count(), 33);
}

#[test]
fn source_tombstones_revoke_peer_evidence_before_the_session_list_finishes_saving() {
    let mut fixture = Fixture::new();
    task_fixture(&mut fixture);
    let mut candidate = fixture.candidate();
    candidate.sources.push(SourceLocator::TaskResult {
        task_id: "task-1".into(),
    });
    fixture.commit(candidate).unwrap();
    tombstone(&fixture.root, "chat-b").unwrap();
    assert_eq!(fixture.view().err().unwrap(), "memory_source_revoked");
}

#[test]
fn corrupt_memory_never_blocks_explicit_deletion_of_derived_state() {
    let fixture = Fixture::new();
    fixture.initial();
    fs::write(manifest_path(&fixture.root, "chat-a"), b"invalid json").unwrap();
    assert!(fixture.view().is_err());
    tombstone(&fixture.root, "chat-a").unwrap();
    assert_eq!(fixture.view().err().unwrap(), "memory_session_deleted");
}

#[test]
fn wrong_attachment_sizes_and_inconsistent_original_hashes_fail_closed() {
    let mut fixture = Fixture::new();
    let stored = put_content_in(&fixture.content, b"content").unwrap();
    fixture.originals.messages[0]["parts"]
        .as_array_mut()
        .unwrap()
        .push(json!({"type":"data-clack-attachment","data":{
        "contentId":stored.id,"contentHash":stored.id,"byteSize":999}}));
    let manifest = synchronize(&fixture.root, &fixture.originals).unwrap();
    let candidate = Candidate {
        preparation: preparation(&manifest, &fixture.owner),
        policy_version: "test".into(),
        start: 0,
        end: 2,
        sources: vec![SourceLocator::Message {
            message_id: "u1".into(),
        }],
        claims: vec![],
    };
    assert_eq!(
        fixture.commit(candidate).unwrap_err(),
        "memory_content_size_mismatch"
    );
    let mut refs = BTreeSet::new();
    assert!(content_refs(
        &json!({"archiveContentId":"a".repeat(64),"archiveContentHash":"b".repeat(64)}),
        &mut refs
    )
    .is_err());
}

#[test]
fn ipc_source_locators_use_the_frontend_camel_case_contract() {
    let source: SourceLocator =
        serde_json::from_value(json!({"kind":"part","messageId":"a1","partIndex":0})).unwrap();
    assert_eq!(
        source,
        SourceLocator::Part {
            message_id: "a1".into(),
            part_index: 0
        }
    );
    assert!(
        serde_json::from_value::<SourceLocator>(json!({"kind":"file","path":"/secret"})).is_err()
    );
}

#[test]
fn invalid_revision_predecessors_are_rejected_on_restart() {
    let fixture = Fixture::new();
    fixture.initial();
    let id = fixture.initial();
    let mut revision = read_revision(&fixture.root, "chat-a", &id).unwrap();
    revision.preparation.previous = None;
    let bytes = serde_json::to_vec(&revision).unwrap();
    let corrupt_id = digest(&bytes);
    atomic_write(
        &manifest_path(&fixture.root, "chat-a").with_file_name(format!("{corrupt_id}.json")),
        &bytes,
    )
    .unwrap();
    let mut manifest = read_manifest(&fixture.root, "chat-a").unwrap().unwrap();
    *manifest.revisions.last_mut().unwrap() = corrupt_id;
    write_manifest(&fixture.root, &manifest).unwrap();
    assert_eq!(fixture.view().err().unwrap(), "memory_invalid_lineage");
}

#[test]
fn preparation_from_a_previous_process_cannot_publish_after_restart() {
    let fixture = Fixture::new();
    let mut candidate = fixture.candidate();
    candidate.preparation.runtime_id = "previous-process".into();
    assert_eq!(
        fixture.commit(candidate).unwrap_err(),
        "memory_stale_preparation"
    );
    assert!(fixture.view().unwrap().revision.is_none());
}

#[test]
fn contradictory_branch_revisions_keep_distinct_evidence_for_the_same_message_id() {
    let mut fixture = Fixture::new();
    let previous = fixture.initial();
    let original = fixture.view().unwrap().revision.unwrap().evidence[0].clone();
    fixture.originals.messages[0]["parts"][0]["text"] = json!("Change the port to 1421.");
    let mut candidate = fixture.candidate();
    let mut correction = candidate.claims[0].clone();
    correction.id = "correction".into();
    correction.text = "Change the port to 1421.".into();
    correction.contradicts = vec![candidate.claims[0].id.clone()];
    candidate.claims[0].sources = vec![original.id.clone()];
    candidate.claims[0].contradicts = vec![correction.id.clone()];
    candidate.claims.push(correction);
    candidate.sources.push(SourceLocator::Retained {
        revision_id: previous,
        evidence_id: original.id,
    });
    fixture.commit(candidate).unwrap();
    let revision = fixture.view().unwrap().revision.unwrap();
    assert_eq!(revision.evidence.len(), 2);
    assert_ne!(revision.evidence[0].id, revision.evidence[1].id);
    assert_eq!(revision.claims.len(), 2);
}
