use super::super::tests::Fixture;
use super::*;

fn fixture() -> (Fixture, WorkspaceRegistry, String) {
    let mut f = Fixture::new();
    let project = f.directory.path().join("project");
    fs::create_dir(&project).unwrap();
    let registry = WorkspaceRegistry::default();
    registry.authorize(&project).unwrap();
    let path = crate::modules::fs::to_canon(project.join("module.ts"));
    f.originals.meta["profile"]["workspaceRoot"] = json!(crate::modules::fs::to_canon(&project));
    let mut observed = vec![];
    let mut parts = vec![];
    for n in 1..=3 {
        let text = format!("export const value = {n};\n").repeat(600);
        fs::write(project.join("module.ts"), &text).unwrap();
        let (_, canonical, result, input_hash) =
            project::freshness::checkpoint_observation(&registry, &f.originals, &path).unwrap();
        observed.push(ObservedWrite {
            tool_call_id: format!("write-{n}"),
            path: path.clone(),
            canonical,
            digest: result,
            input_hash,
            run_id: 1,
        });
        parts.push(json!({"type":"tool-write_file","state":"output-available","toolCallId":format!("write-{n}"),
            "input":{"path":path,"content":text},"output":{"path":path,"bytesWritten":text.encode_utf16().count(),"ok":true,"clackWorkspaceWrite":true}}));
    }
    f.originals.messages = vec![
        json!({"id":"u1","role":"user","parts":[{"type":"text","text":"Use 50 initially."}]}),
        json!({"id":"a1","role":"assistant","parts":parts[..2]}),
        json!({"id":"u2","role":"user","parts":[{"type":"text","text":"Use 25 instead of 50."}]}),
        json!({"id":"a2","role":"assistant","parts":[parts[2].clone()]}),
    ];
    let mut manifest = synchronize(&f.root, &f.originals).unwrap();
    publish(
        &f.root,
        &mut manifest,
        &State {
            version: 1,
            writes: observed,
            current: None,
            previous: None,
        },
    )
    .unwrap();
    (f, registry, path)
}
fn build(f: &Fixture, registry: &WorkspaceRegistry) -> Result<Option<Snapshot>> {
    let prep = f.view()?.preparation;
    prepare(
        &f.root,
        &f.content,
        &f.originals,
        &f.owner,
        &prep,
        &mut |p| project::freshness::checkpoint_observation(registry, &f.originals, p),
    )
}
fn mutate_state(f: &Fixture, change: impl FnOnce(&mut State)) {
    let mut manifest = read_manifest(&f.root, &f.owner.session_id)
        .unwrap()
        .unwrap();
    let mut value = state(&manifest).unwrap();
    change(&mut value);
    publish(&f.root, &mut manifest, &value).unwrap();
}

#[test]
fn three_observed_full_writes_retain_every_source_and_exact_user_corrections() {
    let (f, registry, _) = fixture();
    let before = hash(&f.originals.messages).unwrap();
    let snapshot = build(&f, &registry).unwrap().unwrap();
    assert_eq!(snapshot.entries.len(), 2);
    assert_eq!(snapshot.evidence.len(), 5);
    assert_eq!(snapshot.entries[0].latest_tool_call_id, "write-3");
    assert_eq!(snapshot.entries[0].base, "full-overwrite-independent");
    for source in &snapshot.evidence {
        assert_eq!(
            digest(&read_content_from(&f.content, &source.digest).unwrap()),
            source.digest
        );
    }
    assert_eq!(hash(&f.originals.messages).unwrap(), before);
    verify_evidence(&f.root, &f.content, &snapshot.evidence, &f.originals).unwrap();
    if std::env::var_os("CLACK_CHECKPOINT_TEST_EVIDENCE").is_some() {
        fs::write(
            "target/checkpoint-native-evidence.json",
            serde_json::to_vec_pretty(
                &json!({"snapshot":snapshot,"messages":f.originals.messages}),
            )
            .unwrap(),
        )
        .unwrap();
    }
}
#[test]
fn legacy_success_without_native_observation_is_not_enough() {
    let (f, registry, _) = fixture();
    mutate_state(&f, |s| s.writes.clear());
    assert!(build(&f, &registry).unwrap().is_none());
}
#[test]
fn failed_denied_unverified_and_approval_writes_stay_raw() {
    for (key, value) in [
        ("state", json!("output-error")),
        ("approval", json!({"approved":false})),
        ("providerExecuted", json!(true)),
    ] {
        let (mut f, registry, _) = fixture();
        f.originals.messages[1]["parts"][0][key] = value;
        let snapshot = build(&f, &registry).unwrap();
        assert!(snapshot.is_none_or(|s| s.entries.iter().all(|e| e.tool_call_id != "write-1")));
    }
}
#[test]
fn missing_intermediate_observation_blocks_earlier_chain() {
    let (f, registry, _) = fixture();
    mutate_state(&f, |s| s.writes.retain(|w| w.tool_call_id != "write-2"));
    assert!(build(&f, &registry).unwrap().is_none());
}
#[test]
fn old_body_consumer_failure_read_shell_and_security_evidence_prevent_retirement() {
    for kind in [
        "tool-read_file",
        "tool-bash_run",
        "tool-edit",
        "tool-request_conversation_evidence",
    ] {
        let (mut f, registry, _) = fixture();
        f.originals.messages[3]["parts"].as_array_mut().unwrap().push(json!({"type":kind,"toolCallId":"other","state":"output-available","output":{"error":"denied"}}));
        assert!(build(&f, &registry).unwrap().is_none());
    }
}
#[test]
fn intermediate_reasoning_and_unfinished_source_answer_stay_hot() {
    let (mut f, registry, _) = fixture();
    f.originals.messages[1]["metadata"] = json!({"clackAnswer":{"state":"incomplete"}});
    assert!(build(&f, &registry).unwrap().is_none());
    f.originals.messages[1]
        .as_object_mut()
        .unwrap()
        .remove("metadata");
    f.originals.messages[1]["parts"]
        .as_array_mut()
        .unwrap()
        .push(json!({"type":"reasoning","text":"Need the old body to explain this failure"}));
    assert!(build(&f, &registry).unwrap().is_none());
}
#[test]
fn current_turn_and_latest_write_never_retire() {
    let (mut f, registry, _) = fixture();
    f.originals.messages.remove(2);
    assert!(build(&f, &registry).unwrap().is_none());
}
#[test]
fn external_change_missing_file_and_digest_divergence_fail_closed() {
    let (f, registry, path) = fixture();
    fs::write(&path, "external").unwrap();
    assert!(build(&f, &registry).unwrap().is_none());
    fs::remove_file(&path).unwrap();
    assert!(build(&f, &registry).unwrap().is_none());
}
#[test]
fn revoked_workspace_access_and_secret_paths_are_not_observations() {
    let (f, _, path) = fixture();
    assert!(project::freshness::checkpoint_observation(
        &WorkspaceRegistry::default(),
        &f.originals,
        &path
    )
    .is_err());
    let (f, registry, path) = fixture();
    let secret = Path::new(&path).with_file_name(".env");
    fs::write(&secret, "secret").unwrap();
    assert!(project::freshness::checkpoint_observation(
        &registry,
        &f.originals,
        &secret.to_string_lossy()
    )
    .is_err());
}
#[test]
fn wrong_owner_and_same_relative_path_other_workspace_are_denied() {
    let (f, registry, _) = fixture();
    let mut owner = f.owner.clone();
    owner.workspace_id = Some("local:/other".into());
    let result = prepare(
        &f.root,
        &f.content,
        &f.originals,
        &owner,
        &f.view().unwrap().preparation,
        &mut |p| project::freshness::checkpoint_observation(&registry, &f.originals, p),
    );
    assert!(result.is_err());
}
#[test]
fn new_correction_plan_failure_or_source_revision_rejects_stale_preparation() {
    for change in ["correction", "plan", "failure", "source"] {
        let (mut f, registry, _) = fixture();
        let prep = f.view().unwrap().preparation;
        f.originals
            .messages
            .push(json!({"id":change,"role":"user","parts":[{"type":"text","text":change}]}));
        assert!(prepare(
            &f.root,
            &f.content,
            &f.originals,
            &f.owner,
            &prep,
            &mut |p| project::freshness::checkpoint_observation(&registry, &f.originals, p)
        )
        .is_err());
    }
}
#[test]
fn restart_reconstruction_is_deterministic_and_c1_memory_stays_independent() {
    let (f, registry, _) = fixture();
    let snapshot = build(&f, &registry).unwrap().unwrap();
    mutate_state(&f, |s| s.current = Some(snapshot.clone()));
    let manifest = read_manifest(&f.root, &f.owner.session_id)
        .unwrap()
        .unwrap();
    assert_eq!(
        state(&manifest).unwrap().current.unwrap().revision,
        snapshot.revision
    );
    assert_eq!(
        build(&f, &registry).unwrap().unwrap().revision,
        snapshot.revision
    );
    assert!(f.view().unwrap().revision.is_none());
    assert_eq!(retention_roots(&manifest).unwrap().len(), 5);
}
#[test]
fn failed_publication_preserves_last_valid_manifest() {
    let (f, registry, _) = fixture();
    let snapshot = build(&f, &registry).unwrap().unwrap();
    mutate_state(&f, |s| s.current = Some(snapshot));
    let before = fs::read(manifest_path(&f.root, &f.owner.session_id)).unwrap();
    let mut manifest = read_manifest(&f.root, &f.owner.session_id)
        .unwrap()
        .unwrap();
    let mut stored = state(&manifest).unwrap();
    stored.writes[0].path = "x".repeat(MAX_RECORD);
    assert!(publish(&f.root, &mut manifest, &stored).is_err());
    assert_eq!(
        fs::read(manifest_path(&f.root, &f.owner.session_id)).unwrap(),
        before
    );
}
#[test]
fn corrupted_checkpoint_isolated_from_original_chat_and_collection_fails_closed() {
    let (f, registry, _) = fixture();
    let snapshot = build(&f, &registry).unwrap().unwrap();
    let mut malformed = snapshot.clone();
    malformed.evidence[0].digest = "invalid".into();
    malformed.revision = identity(&malformed).unwrap();
    assert!(validate(&malformed).is_err());
    malformed = snapshot.clone();
    malformed.evidence[0].related_sessions = vec!["other-chat".into()];
    malformed.revision = identity(&malformed).unwrap();
    assert!(validate(&malformed).is_err());
    mutate_state(&f, |s| s.current = Some(snapshot));
    let mut manifest = read_manifest(&f.root, &f.owner.session_id)
        .unwrap()
        .unwrap();
    manifest.checkpoint_state.as_mut().unwrap()["current"]["revision"] = json!("corrupt");
    write_manifest(&f.root, &manifest).unwrap();
    assert!(f.view().is_ok());
    assert!(retention_roots(&manifest).is_err());
    assert!(build(&f, &registry).is_err());
}
#[test]
fn current_and_previous_sources_survive_collection_and_unreferenced_blobs_do_not_become_roots() {
    let (f, registry, _) = fixture();
    let snapshot = build(&f, &registry).unwrap().unwrap();
    mutate_state(&f, |s| {
        s.current = Some(snapshot.clone());
        s.previous = Some(snapshot);
    });
    let orphan = put_content_in(&f.content, b"unreferenced").unwrap();
    let roots = collect_roots(&f.root, &BTreeSet::from([f.owner.session_id.clone()])).unwrap();
    assert_eq!(roots.len(), 5);
    assert!(!roots.contains(&orphan.id));
}
#[test]
fn generated_partial_append_is_allowed_but_user_and_tool_effect_append_are_not() {
    let (mut f, registry, _) = fixture();
    let snapshot = build(&f, &registry).unwrap().unwrap();
    let mut stale_revision = snapshot.source.clone();
    stale_revision.transcript_revision += 1;
    assert!(!source_current(&snapshot, &f.originals, &stale_revision).unwrap());
    f.originals.messages[3]["parts"]
        .as_array_mut()
        .unwrap()
        .push(json!({"type":"text","text":"unfinished answer exactly"}));
    let manifest = synchronize(&f.root, &f.originals).unwrap();
    assert!(source_current(&snapshot, &f.originals, &manifest.source).unwrap());
    f.originals.messages[3]["parts"]
        .as_array_mut()
        .unwrap()
        .push(json!({"type":"tool-write_file","state":"output-available"}));
    let manifest = synchronize(&f.root, &f.originals).unwrap();
    assert!(!source_current(&snapshot, &f.originals, &manifest.source).unwrap());
}
#[test]
fn model_switch_rebuilds_same_owner_without_transient_transport_identity() {
    let (mut f, registry, _) = fixture();
    let old = build(&f, &registry).unwrap().unwrap();
    f.originals.meta["profile"]["modelId"] = json!("another-model");
    let new = build(&f, &registry).unwrap().unwrap();
    assert_eq!(old.owner, new.owner);
    assert_ne!(old.revision, new.revision);
    assert_eq!(old.entries[0].result_digest, new.entries[0].result_digest);
}
#[test]
fn original_bodies_restore_exactly_without_reading_current_files_or_replaying_effects() {
    let (f, registry, path) = fixture();
    let snapshot = build(&f, &registry).unwrap().unwrap();
    fs::remove_file(&path).unwrap();
    for entry in snapshot.entries {
        let source = snapshot
            .evidence
            .iter()
            .find(|s| s.id == entry.source)
            .unwrap();
        let restored: Value =
            serde_json::from_slice(&read_content_from(&f.content, &source.digest).unwrap())
                .unwrap();
        assert_eq!(hash(&restored["input"]).unwrap(), entry.input_hash);
        assert_eq!(hash(&restored["output"]).unwrap(), entry.output_hash);
    }
}
