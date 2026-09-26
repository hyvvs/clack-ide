//! Target views are session-owned derived data, not committed conversation memory.
use super::*;
use std::sync::atomic::{AtomicU64, Ordering};
static SWITCH_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub(crate) fn check_switch(app: &tauri::AppHandle, session_id: &str, token: &str) -> Result<()> {
    let state = app.state::<MemoryState>();
    let switches = state.switches.lock().map_err(|e| e.to_string())?;
    if !switches
        .get(session_id)
        .is_some_and(|(id, expires)| id == token && now() < *expires)
    {
        return Err("target_context_cancelled_or_expired".into());
    }
    Ok(())
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Snapshot {
    schema_version: u32,
    model_id: String,
    key: String,
    source_count: usize,
    source_hash: String,
    memory_id: Option<String>,
    revision: Option<Revision>,
    integrity: String,
}

fn snapshot_integrity(snapshot: &Snapshot) -> Result<String> {
    let mut value = serde_json::to_value(snapshot).map_err(|e| e.to_string())?;
    value
        .as_object_mut()
        .ok_or("target_context_corrupt")?
        .remove("integrity");
    hash(&value)
}

fn settings_hash(app: &tauri::AppHandle) -> Result<String> {
    let settings = app
        .store("terax-settings.json")
        .map_err(|e| e.to_string())?;
    let values: Vec<_> = [
        "selfHostedInference",
        "savedProviderModels",
        "customEndpoints",
        "customInstructions",
        "agentPermissionProfiles",
        "agentWorkspacePermissions",
        "lmstudioBaseURL",
        "lmstudioModelId",
        "mlxBaseURL",
        "mlxModelId",
        "ollamaBaseURL",
        "ollamaModelId",
        "openaiCompatibleBaseURL",
        "openaiCompatibleModelId",
        "openaiCompatibleContextLimit",
        "openrouterModelId",
    ]
    .iter()
    .map(|key| settings.get(*key))
    .collect();
    hash(&values)
}

pub(super) fn idle_token(meta: &Value) -> Result<String> {
    if meta["run"]["state"] == "running" {
        return Err("target_context_busy".into());
    }
    Ok(format!("switch:{}", hash(meta)?))
}

fn validate_snapshot(snapshot: &Snapshot, originals: &Originals) -> Result<bool> {
    if snapshot.schema_version != 1
        || snapshot_integrity(snapshot)? != snapshot.integrity
        || !valid_hash(&snapshot.key)
        || !valid_hash(&snapshot.source_hash)
        || snapshot.model_id.is_empty()
        || serde_json::to_vec(snapshot)
            .map_err(|e| e.to_string())?
            .len()
            > MAX_RECORD
    {
        return Err("target_context_corrupt".into());
    }
    if snapshot.source_count > originals.messages.len()
        || hash(&originals.messages[..snapshot.source_count])? != snapshot.source_hash
    {
        return Ok(false);
    }
    if let Some(revision) = &snapshot.revision {
        check_owner(originals, &revision.preparation.owner)?;
        if revision.schema_version != SCHEMA
            || revision.policy_version != "c1b-extraction-v1"
            || revision.coverage.start != 0
            || revision.coverage.end > snapshot.source_count
            || revision.coverage.end == 0
            || hash(&originals.messages[..revision.coverage.end])? != revision.coverage.digest
        {
            return Err("target_context_corrupt".into());
        }
        validate_claims(&revision.claims, &revision.evidence)?;
    }
    Ok(true)
}

#[tauri::command]
pub async fn target_context_begin(app: tauri::AppHandle, owner: Owner) -> Result<Value> {
    blocking(move || {
        let state = app.state::<MemoryState>();
        let lock = state.owner(&owner.session_id)?;
        let _owner = lock.lock().map_err(|e| e.to_string())?;
        let originals = originals(&app, &owner.session_id)?;
        authorize(&app, &originals, &owner)?;
        let (root, content) = paths(&app)?;
        let view = load(&root, &content, &originals, &owner)?;
        let token = format!("{}:{}:{}", idle_token(&originals.meta)?, *MEMORY_EPOCH, SWITCH_SEQUENCE.fetch_add(1, Ordering::Relaxed));
        let mut switches = state.switches.lock().map_err(|e| e.to_string())?;
        switches.retain(|_, (_, expires)| now() < *expires);
        if switches.len() >= 128 { return Err("target_context_preparation_limit".into()); }
        switches.insert(owner.session_id.clone(), (token.clone(), now() + 180_000));
        Ok(json!({"token":token, "session":originals.meta, "settingsHash":settings_hash(&app)?, "view":view}))
    }).await
}

#[tauri::command]
pub fn target_context_cancel(
    state: tauri::State<'_, MemoryState>,
    session_id: String,
    token: String,
) -> Result<()> {
    let mut switches = state.switches.lock().map_err(|e| e.to_string())?;
    if switches
        .get(&session_id)
        .is_some_and(|(id, _)| id == &token)
    {
        switches.remove(&session_id);
    }
    Ok(())
}

#[tauri::command]
pub async fn target_context_preview(
    app: tauri::AppHandle,
    candidate: Candidate,
    token: String,
) -> Result<Revision> {
    blocking(move || {
        let state = app.state::<MemoryState>();
        let lock = state.owner(&candidate.preparation.owner.session_id)?;
        let _owner = lock.lock().map_err(|e| e.to_string())?;
        let _collection = CONTENT_COLLECTION.read().map_err(|e| e.to_string())?;
        let mut originals = originals(&app, &candidate.preparation.owner.session_id)?;
        check_switch(&app, &candidate.preparation.owner.session_id, &token)?;
        idle_token(&originals.meta)?;
        load_tasks(&app, &mut originals)?;
        authorize(&app, &originals, &candidate.preparation.owner)?;
        let (root, content) = paths(&app)?;
        Ok(prepare_revision(&root, &content, &originals, candidate, false, |_| Ok(()))?.1)
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommitRequest {
    token: String,
    settings_hash: String,
    expected_session: Value,
    preparation: Preparation,
    model_id: String,
    key: String,
    candidate: Option<Candidate>,
}

fn switched_session(
    originals: &Originals,
    request: &CommitRequest,
    mut revision: Option<Revision>,
) -> Result<Value> {
    if originals.meta != request.expected_session {
        return Err("target_context_stale_session".into());
    }
    idle_token(&originals.meta)?;
    if request.model_id.is_empty() || request.model_id.len() > 512 || !valid_hash(&request.key) {
        return Err("target_context_invalid_target".into());
    }
    if let Some(revision) = &mut revision {
        revision.producer = json!({"sourceSelection": profile(&originals.meta), "targetSelection": request.model_id, "purpose":"target-context"});
    }
    let mut snapshot = Snapshot {
        schema_version: 1,
        model_id: request.model_id.clone(),
        key: request.key.clone(),
        source_count: originals.messages.len(),
        source_hash: hash(&originals.messages)?,
        memory_id: request.preparation.previous.clone(),
        revision,
        integrity: String::new(),
    };
    snapshot.integrity = snapshot_integrity(&snapshot)?;
    validate_snapshot(&snapshot, originals)?;
    let mut meta = originals.meta.clone();
    meta["profile"]["modelId"] = json!(request.model_id);
    meta["targetContext"] = serde_json::to_value(snapshot).map_err(|e| e.to_string())?;
    meta["modelRevision"] = json!(meta["modelRevision"].as_u64().unwrap_or(0) + 1);
    meta["updatedAt"] = json!(now());
    Ok(meta)
}

#[tauri::command]
pub async fn target_context_commit(
    app: tauri::AppHandle,
    mut request: CommitRequest,
) -> Result<Value> {
    blocking(move || {
        let state = app.state::<MemoryState>();
        // Same ordering as ordinary session writes. Preparation does not hold these locks.
        let _metadata = state.metadata.lock().map_err(|e| e.to_string())?;
        let lock = state.owner(&request.preparation.owner.session_id)?;
        let _owner = lock.lock().map_err(|e| e.to_string())?;
        let _collection = CONTENT_COLLECTION.read().map_err(|e| e.to_string())?;
        let mut originals = originals(&app, &request.preparation.owner.session_id)?;
        load_tasks(&app, &mut originals)?;
        authorize(&app, &originals, &request.preparation.owner)?;
        let (root, content) = paths(&app)?;
        let manifest = synchronize(&root, &originals)?;
        if preparation(&manifest, &request.preparation.owner) != request.preparation {
            return Err("memory_stale_preparation".into());
        }
        let revision = request
            .candidate
            .take()
            .map(|candidate| {
                if candidate.preparation != request.preparation {
                    return Err("memory_stale_preparation".into());
                }
                prepare_revision(&root, &content, &originals, candidate, false, |_| Ok(()))
                    .map(|(_, revision)| revision)
            })
            .transpose()?;
        let meta = switched_session(&originals, &request, revision)?;
        if settings_hash(&app)? != request.settings_hash {
            return Err("target_context_settings_changed".into());
        }
        let mut switches = state.switches.lock().map_err(|e| e.to_string())?;
        if !switches
            .get(&request.preparation.owner.session_id)
            .is_some_and(|(id, expires)| id == &request.token && now() < *expires)
        {
            return Err("target_context_cancelled_or_expired".into());
        }
        let path = session_path(&app)?;
        let mut sessions = state
            .sessions
            .get(&path, "sessions")?
            .ok_or("memory_invalid_sessions")?;
        let entry = sessions
            .as_array_mut()
            .ok_or("memory_invalid_sessions")?
            .iter_mut()
            .find(|entry| entry["id"] == originals.meta["id"])
            .ok_or("memory_missing_session")?;
        *entry = meta.clone();
        if let Err(error) = state.sessions.set(&path, "sessions", Some(sessions)) {
            let persisted = state.sessions.get(&path, "sessions")?;
            if persisted
                .as_ref()
                .and_then(Value::as_array)
                .and_then(|entries| {
                    entries
                        .iter()
                        .find(|entry| entry["id"] == originals.meta["id"])
                })
                != Some(&meta)
            {
                return Err(error);
            }
        }
        switches.remove(&request.preparation.owner.session_id);
        let _ = app.emit("clack:model-switch", &meta);
        Ok(meta)
    })
    .await
}

#[tauri::command]
pub async fn target_context_load(
    app: tauri::AppHandle,
    owner: Owner,
    key: String,
) -> Result<Option<Revision>> {
    blocking(move || {
        let state = app.state::<MemoryState>();
        let lock = state.owner(&owner.session_id)?;
        let _owner = lock.lock().map_err(|e| e.to_string())?;
        let _collection = CONTENT_COLLECTION.read().map_err(|e| e.to_string())?;
        let mut originals = originals(&app, &owner.session_id)?;
        authorize(&app, &originals, &owner)?;
        let Some(raw) = originals
            .meta
            .get("targetContext")
            .filter(|value| !value.is_null())
        else {
            return Ok(None);
        };
        let snapshot: Snapshot = serde_json::from_value(raw.clone())
            .map_err(|e| format!("target_context_corrupt: {e}"))?;
        if snapshot.key != key
            || originals.meta["profile"]["modelId"] != snapshot.model_id
            || !validate_snapshot(&snapshot, &originals)?
        {
            return Ok(None);
        }
        load_tasks(&app, &mut originals)?;
        let (root, content) = paths(&app)?;
        let manifest = synchronize(&root, &originals)?;
        if manifest.revisions.last() != snapshot.memory_id.as_ref() {
            return Ok(None);
        }
        if let Some(revision) = &snapshot.revision {
            for evidence in &revision.evidence {
                let (current, _) = evidence_for(
                    &root,
                    &content,
                    &originals,
                    &owner,
                    evidence.locator.clone(),
                )?;
                if current.id != evidence.id
                    || current.digest != evidence.digest
                    || current.content_ids != evidence.content_ids
                {
                    return Err("target_context_evidence_changed".into());
                }
            }
        }
        Ok(snapshot.revision)
    })
    .await
}

pub(super) fn guard_session_updates(old: &[Value], next: &[Value]) -> Result<()> {
    for entry in next {
        if let Some(previous) = old.iter().find(|p| p["id"] == entry["id"]) {
            if previous["modelRevision"] != entry["modelRevision"]
                || previous["targetContext"] != entry["targetContext"]
            {
                return Err("target_context_stale_session".into());
            }
        } else if entry.get("targetContext").is_some() || entry.get("modelRevision").is_some() {
            return Err("target_context_invalid_session".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::tests::Fixture;
    use super::*;

    fn request(f: &Fixture) -> CommitRequest {
        CommitRequest {
            token: "test".into(),
            settings_hash: "a".repeat(64),
            expected_session: f.originals.meta.clone(),
            preparation: f.view().unwrap().preparation,
            model_id: "target".into(),
            key: "a".repeat(64),
            candidate: None,
        }
    }
    fn draft(f: &Fixture) -> Revision {
        let mut candidate = f.candidate();
        candidate.policy_version = "c1b-extraction-v1".into();
        prepare_revision(&f.root, &f.content, &f.originals, candidate, false, |_| {
            Ok(())
        })
        .unwrap()
        .1
    }

    #[test]
    fn preview_does_not_publish_or_copy_source_blobs() {
        let f = Fixture::new();
        let before = serde_json::to_value(f.view().unwrap()).unwrap();
        let revision = draft(&f);
        assert!(!revision.claims.is_empty());
        assert_eq!(serde_json::to_value(f.view().unwrap()).unwrap(), before);
        assert!(!f.content.exists());
    }

    #[test]
    fn atomic_session_pair_survives_restart_with_original_transcript() {
        let f = Fixture::new();
        let next = switched_session(&f.originals, &request(&f), Some(draft(&f))).unwrap();
        let path = f.directory.path().join("sessions.json");
        let store = session_file::SessionFile::default();
        store
            .set(&path, "messages:chat-a", Some(json!(f.originals.messages)))
            .unwrap();
        store.set(&path, "sessions", Some(json!([next]))).unwrap();
        let reopened = session_file::SessionFile::default();
        let sessions = reopened.get(&path, "sessions").unwrap().unwrap();
        assert_eq!(sessions[0]["profile"]["modelId"], "target");
        assert_eq!(sessions[0]["targetContext"]["modelId"], "target");
        assert_eq!(
            reopened.get(&path, "messages:chat-a").unwrap(),
            Some(json!(f.originals.messages))
        );
        assert!(f.view().unwrap().revision.is_none());
    }

    #[test]
    fn stale_selection_and_busy_session_cannot_commit() {
        let mut f = Fixture::new();
        let captured = request(&f);
        f.originals.meta["profile"]["modelId"] = json!("other");
        assert!(switched_session(&f.originals, &captured, None).is_err());
        f.originals.meta["run"]["state"] = json!("running");
        assert!(switched_session(&f.originals, &request(&f), None).is_err());
    }

    #[test]
    fn stale_preview_rejects_new_messages_and_cancelled_preparation() {
        let mut f = Fixture::new();
        let candidate = f.candidate();
        f.originals
            .messages
            .push(json!({"id":"new","role":"user","parts":[]}));
        assert!(
            prepare_revision(&f.root, &f.content, &f.originals, candidate, false, |_| Ok(
                ()
            ))
            .is_err()
        );
        let mut candidate = f.candidate();
        candidate.preparation.runtime_id = "stale-process".into();
        assert!(
            prepare_revision(&f.root, &f.content, &f.originals, candidate, false, |_| Ok(
                ()
            ))
            .is_err()
        );
        assert!(f.view().unwrap().revision.is_none());
    }

    #[test]
    fn snapshot_allows_append_but_not_changed_covered_evidence() {
        let mut f = Fixture::new();
        let next = switched_session(&f.originals, &request(&f), Some(draft(&f))).unwrap();
        let snapshot: Snapshot = serde_json::from_value(next["targetContext"].clone()).unwrap();
        f.originals
            .messages
            .push(json!({"id":"new","role":"user","parts":[]}));
        assert!(validate_snapshot(&snapshot, &f.originals).unwrap());
        f.originals.messages[0]["parts"][0]["text"] = json!("changed requirement");
        assert!(!validate_snapshot(&snapshot, &f.originals).unwrap());
    }

    #[test]
    fn corrupt_or_foreign_snapshots_are_never_accepted() {
        let f = Fixture::new();
        let next = switched_session(&f.originals, &request(&f), Some(draft(&f))).unwrap();
        let snapshot: Snapshot = serde_json::from_value(next["targetContext"].clone()).unwrap();
        for field in ["schemaVersion", "key", "sourceHash"] {
            let mut value = next["targetContext"].clone();
            value[field] = if field == "schemaVersion" {
                json!(99)
            } else {
                json!("bad")
            };
            let invalid: Snapshot = serde_json::from_value(value).unwrap();
            assert!(validate_snapshot(&invalid, &f.originals).is_err());
        }
        let mut foreign = snapshot.clone();
        foreign
            .revision
            .as_mut()
            .unwrap()
            .preparation
            .owner
            .workspace_id = Some("elsewhere".into());
        assert!(validate_snapshot(&foreign, &f.originals).is_err());
        foreign = snapshot;
        foreign.revision.as_mut().unwrap().coverage.digest = "f".repeat(64);
        assert!(validate_snapshot(&foreign, &f.originals).is_err());
    }

    #[test]
    fn cross_window_stale_save_cannot_remove_or_forge_pair() {
        let f = Fixture::new();
        let next = switched_session(&f.originals, &request(&f), None).unwrap();
        assert!(guard_session_updates(
            std::slice::from_ref(&next),
            std::slice::from_ref(&f.originals.meta)
        )
        .is_err());
        let mut forged = next.clone();
        forged["targetContext"]["key"] = json!("f".repeat(64));
        assert!(guard_session_updates(std::slice::from_ref(&next), &[forged]).is_err());
        let mut renamed = next.clone();
        renamed["title"] = json!("New title");
        assert!(guard_session_updates(&[next], &[renamed]).is_ok());
    }

    #[test]
    fn independent_conversations_keep_separate_selection_revisions() {
        let f = Fixture::new();
        let next = switched_session(&f.originals, &request(&f), None).unwrap();
        let other = json!({"id":"chat-b","profile":{"modelId":"independent"}});
        assert!(guard_session_updates(&[next.clone(), other.clone()], &[next, other]).is_ok());
    }

    #[test]
    fn idle_receipt_expires_on_any_metadata_change_and_never_authorizes_active_run() {
        let f = Fixture::new();
        let token = idle_token(&f.originals.meta).unwrap();
        let mut meta = f.originals.meta.clone();
        meta["title"] = json!("changed");
        assert_ne!(idle_token(&meta).unwrap(), token);
        meta["run"]["state"] = json!("running");
        assert!(idle_token(&meta).is_err());
    }
}
