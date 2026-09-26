use super::*;

struct Fixture {
    _dir: tempfile::TempDir,
    root: PathBuf,
    content: PathBuf,
    originals: Originals,
    owner: Owner,
}
impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        Self {
            root: dir.path().join("memory"),
            content: dir.path().join("content"),
            _dir: dir,
            owner: Owner {
                session_id: "a".into(),
                workspace_id: Some("local:/work".into()),
            },
            originals: Originals {
                meta: json!({"id":"a","profile":{"workspaceId":"local:/work","agentId":"coder"}}),
                messages: vec![
                    json!({"id":"early","role":"assistant","parts":[{"type":"text","text":"Do not use port 8080. The original decision was 1420."}]}),
                    json!({"id":"tool","role":"assistant","parts":[{"type":"tool-read_file","toolCallId":"call","state":"output-available","input":{"path":"design.md"},"output":"original result"}]}),
                ],
                tasks: vec![],
                session_ids: BTreeSet::from(["a".into()]),
            },
        }
    }
    fn prep(&self) -> Preparation {
        preparation(
            &synchronize(&self.root, &self.originals).unwrap(),
            &self.owner,
        )
    }
    fn read(&self, ids: &[&str]) -> Result<Retrieved> {
        retrieve(
            &self.root,
            &self.content,
            &self.originals,
            &self.prep(),
            &ids.iter().map(|id| (*id).into()).collect::<Vec<_>>(),
            Bounds {
                bytes: MAX_BYTES,
                chunks: MAX_CHUNKS,
                attachments: true,
            },
            Instant::now(),
        )
    }
    fn attachment(&mut self, bytes: &[u8]) -> String {
        let reference = put_content_in(&self.content, bytes).unwrap();
        self.originals.messages[0]["parts"].as_array_mut().unwrap().push(json!({"type":"data-clack-attachment","data":{"contentKind":"text","contentId":reference.id,"contentHash":reference.id,"byteSize":bytes.len(),"displayName":"design.md"}}));
        reference.id
    }
}

#[test]
fn returns_exact_ordered_originals_and_identity_without_mutation() {
    let f = Fixture::new();
    let prep = f.prep();
    let before = fs::read(manifest_path(&f.root, "a")).unwrap();
    let result = f.read(&["tool", "early", "early"]).unwrap();
    assert_eq!(result.chunks.len(), 2);
    assert_eq!(result.chunks[0].message_id, "early");
    assert_eq!(
        result.chunks[0].evidence.digest,
        hash(&f.originals.messages[0]).unwrap()
    );
    assert_eq!(
        serde_json::from_str::<Value>(&result.chunks[1].text).unwrap(),
        f.originals.messages[1]
    );
    assert_eq!(prep, f.prep());
    assert_eq!(before, fs::read(manifest_path(&f.root, "a")).unwrap());
}

#[test]
fn reads_only_attached_immutable_content_and_never_a_changed_path() {
    let mut f = Fixture::new();
    let id = f.attachment(b"Original immutable architecture, not today's file.");
    let result = f.read(&["early"]).unwrap();
    assert_eq!(result.chunks.len(), 2);
    assert_eq!(result.chunks[1].content_id.as_deref(), Some(id.as_str()));
    assert!(result.chunks[1].text.starts_with("Original immutable"));
    assert_eq!(
        f.read(&["other-chat-private"]).unwrap().issues[0].status,
        "missing"
    );
}

#[test]
fn missing_and_corrupt_blobs_fail_closed() {
    let mut f = Fixture::new();
    let id = f.attachment(b"immutable content");
    fs::write(f.content.join(&id), b"corrupt").unwrap();
    let result = f.read(&["early"]).unwrap();
    assert!(result.chunks.is_empty());
    assert_eq!(result.issues[0].status, "unavailable-or-corrupt");
    fs::remove_file(f.content.join(id)).unwrap();
    assert!(f.read(&["early"]).unwrap().chunks.is_empty());
}

#[test]
fn owner_workspace_profile_and_generation_changes_reject_stale_reads() {
    let mut f = Fixture::new();
    let prep = f.prep();
    let run = |f: &Fixture, prep: &Preparation| {
        retrieve(
            &f.root,
            &f.content,
            &f.originals,
            prep,
            &["early".into()],
            Bounds {
                bytes: MAX_BYTES,
                chunks: MAX_CHUNKS,
                attachments: false,
            },
            Instant::now(),
        )
    };
    let mut foreign = prep.clone();
    foreign.owner.session_id = "other".into();
    assert!(run(&f, &foreign).is_err());
    foreign = prep.clone();
    foreign.owner.workspace_id = Some("local:/other".into());
    assert!(run(&f, &foreign).is_err());
    foreign = prep.clone();
    foreign.generation += 1;
    assert!(run(&f, &foreign).is_err());
    f.originals.meta["profile"]["agentId"] = json!("changed");
    assert!(run(&f, &prep).is_err());
}

#[test]
fn changed_transcript_and_prior_process_cannot_return_stale_sources() {
    let mut f = Fixture::new();
    let prep = f.prep();
    f.originals.messages[0]["parts"][0]["text"] = json!("changed");
    assert!(retrieve(
        &f.root,
        &f.content,
        &f.originals,
        &prep,
        &["early".into()],
        Bounds {
            bytes: MAX_BYTES,
            chunks: MAX_CHUNKS,
            attachments: false
        },
        Instant::now()
    )
    .is_err());
    let mut prep = f.prep();
    prep.runtime_id = "dead-process".into();
    assert!(retrieve(
        &f.root,
        &f.content,
        &f.originals,
        &prep,
        &["early".into()],
        Bounds {
            bytes: MAX_BYTES,
            chunks: MAX_CHUNKS,
            attachments: false
        },
        Instant::now()
    )
    .is_err());
}

#[test]
fn enforces_byte_chunk_time_and_input_bounds() {
    let mut f = Fixture::new();
    f.originals.messages[0]["parts"][0]["text"] = json!("x".repeat(MAX_BYTES));
    assert_eq!(f.read(&["early"]).unwrap().issues[0].status, "oversized");
    for (bytes, chunks) in [(0, 1), (MAX_BYTES + 1, 1), (10, 13)] {
        assert!(retrieve(
            &f.root,
            &f.content,
            &f.originals,
            &f.prep(),
            &["early".into()],
            Bounds {
                bytes,
                chunks,
                attachments: false
            },
            Instant::now()
        )
        .is_err());
    }
    assert!(retrieve(
        &f.root,
        &f.content,
        &f.originals,
        &f.prep(),
        &["early".into()],
        Bounds {
            bytes: MAX_BYTES,
            chunks: MAX_CHUNKS,
            attachments: false
        },
        Instant::now() - Duration::from_secs(11)
    )
    .is_err());
}

#[test]
fn secret_paths_are_filtered_before_content_reads() {
    let mut f = Fixture::new();
    for path in [".env", "C:\\work\\.ssh\\id_ed25519", "secrets.json"] {
        f.originals.messages[1]["parts"][0]["input"]["path"] = json!(path);
        let result = f.read(&["tool"]).unwrap();
        assert!(result.chunks.is_empty());
        assert_eq!(result.issues[0].status, "denied");
    }
}

#[test]
fn restart_rebuilds_from_original_store_without_a_second_database() {
    let f = Fixture::new();
    let a = serde_json::to_value(f.read(&["early"]).unwrap()).unwrap();
    let b = serde_json::to_value(f.read(&["early"]).unwrap()).unwrap();
    assert_eq!(a, b);
    assert!(read_manifest(&f.root, "a")
        .unwrap()
        .unwrap()
        .revisions
        .is_empty());
}

#[test]
fn malformed_and_duplicate_original_identities_fail_closed() {
    let mut f = Fixture::new();
    f.originals.messages[1]["id"] = json!("early");
    assert!(f.read(&["early"]).is_err());
    f.originals.messages[1]["id"] = Value::Null;
    assert!(f.read(&["early"]).is_err());
}

#[test]
fn malformed_message_shape_is_not_delivered_as_evidence() {
    let mut f = Fixture::new();
    f.originals.messages[0]["parts"] = json!("invalid");
    let result = f.read(&["early"]).unwrap();
    assert!(result.chunks.is_empty());
    assert_eq!(result.issues[0].status, "malformed");
}

#[test]
fn decoded_attachment_size_is_bounded_without_truncating_evidence() {
    let mut f = Fixture::new();
    f.attachment(&vec![b'x'; MAX_BYTES]);
    let result = f.read(&["early"]).unwrap();
    assert_eq!(result.chunks.len(), 1);
    assert_eq!(result.issues[0].status, "attachment-oversized");
    assert!(result.chunks[0].text.len() < MAX_BYTES);
}
