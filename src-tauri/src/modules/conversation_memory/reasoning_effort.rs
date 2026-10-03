//! Idle effort choices share the session's atomic model-configuration revision.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EffortUpdate {
    owner: Owner,
    expected_session: Value,
    key: String,
    choice: String,
    revision: String,
}

fn updated(meta: &Value, update: &EffortUpdate) -> Result<Value> {
    if meta != &update.expected_session || meta["id"] != update.owner.session_id {
        return Err("reasoning_effort_stale_session".into());
    }
    target_context::idle_token(meta)?;
    if update.key.is_empty()
        || update.key.len() > 8192
        || update.revision.len() > 8192
        || update.revision.is_empty()
        || ![
            "automatic",
            "none",
            "minimal",
            "low",
            "medium",
            "high",
            "xhigh",
            "max",
            "0",
            "1024",
            "4096",
            "8192",
        ]
        .contains(&update.choice.as_str())
    {
        return Err("reasoning_effort_invalid_choice".into());
    }
    let mut next = meta.clone();
    let mut choices = if meta["effortPreferences"]["version"] == 1 {
        meta["effortPreferences"]["choices"]
            .as_array()
            .cloned()
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    choices.retain(|entry| entry["key"] != update.key);
    if update.choice != "automatic" {
        if choices.len() >= 32 {
            return Err("reasoning_effort_capacity".into());
        }
        choices.push(json!({"key":update.key,"choice":update.choice,"revision":update.revision}));
    }
    let preferences = json!({"version":1,"choices":choices});
    if serde_json::to_vec(&preferences)
        .map_err(|e| e.to_string())?
        .len()
        > 64 * 1024
    {
        return Err("reasoning_effort_capacity".into());
    }
    next["effortPreferences"] = preferences;
    next.as_object_mut()
        .ok_or("memory_invalid_session")?
        .remove("targetContext");
    next["modelRevision"] = json!(meta["modelRevision"]
        .as_u64()
        .unwrap_or(0)
        .checked_add(1)
        .ok_or("reasoning_effort_revision_overflow")?);
    next["updatedAt"] = json!(now());
    Ok(next)
}

#[tauri::command]
pub async fn conversation_effort_set(app: tauri::AppHandle, update: EffortUpdate) -> Result<Value> {
    blocking(move || {
        let state = app.state::<MemoryState>();
        let _metadata = state.metadata.lock().map_err(|e| e.to_string())?;
        let lock = state.owner(&update.owner.session_id)?;
        let _owner = lock.lock().map_err(|e| e.to_string())?;
        let originals = originals(&app, &update.owner.session_id)?;
        authorize(&app, &originals, &update.owner)?;
        let next = updated(&originals.meta, &update)?;
        let path = session_path(&app)?;
        let mut sessions = state
            .sessions
            .get(&path, "sessions")?
            .ok_or("memory_invalid_sessions")?;
        let entry = sessions
            .as_array_mut()
            .ok_or("memory_invalid_sessions")?
            .iter_mut()
            .find(|entry| entry["id"] == update.owner.session_id)
            .ok_or("memory_missing_session")?;
        *entry = next.clone();
        if let Err(error) = state.sessions.set(&path, "sessions", Some(sessions)) {
            let persisted = state.sessions.get(&path, "sessions")?;
            if persisted
                .as_ref()
                .and_then(Value::as_array)
                .and_then(|entries| entries.iter().find(|e| e["id"] == update.owner.session_id))
                != Some(&next)
            {
                return Err(error);
            }
        }
        let _ = app.emit("clack:model-switch", &next);
        Ok(next)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Value, EffortUpdate) {
        let meta = json!({"id":"a","profile":{"modelId":"model"},"targetContext":{"key":"old"}});
        let update = EffortUpdate {
            owner: Owner {
                session_id: "a".into(),
                workspace_id: None,
            },
            expected_session: meta.clone(),
            key: "model-key".into(),
            choice: "high".into(),
            revision: "evidence-1".into(),
        };
        (meta, update)
    }
    #[test]
    fn additive_update_invalidates_target_and_preserves_other_fields() {
        let (meta, update) = fixture();
        let next = updated(&meta, &update).unwrap();
        assert_eq!(next["profile"], meta["profile"]);
        assert_eq!(next["modelRevision"], 1);
        assert!(next.get("targetContext").is_none());
        assert_eq!(next["effortPreferences"]["choices"][0]["choice"], "high");
        assert_eq!(meta["targetContext"]["key"], "old");
    }
    #[test]
    fn stale_concurrent_update_and_running_owner_are_rejected() {
        let (meta, mut update) = fixture();
        let next = updated(&meta, &update).unwrap();
        assert!(updated(&next, &update).unwrap_err().contains("stale"));
        let mut running = meta;
        running["run"] = json!({"state":"running"});
        update.expected_session = running.clone();
        assert!(updated(&running, &update).unwrap_err().contains("busy"));
    }
    #[test]
    fn automatic_removes_only_selected_choice_and_old_writers_fail() {
        let (meta, mut update) = fixture();
        let next = updated(&meta, &update).unwrap();
        assert!(
            target_context::guard_session_updates(std::slice::from_ref(&next), &[meta]).is_err()
        );
        update.expected_session = next.clone();
        update.choice = "automatic".into();
        assert_eq!(
            updated(&next, &update).unwrap()["effortPreferences"]["choices"],
            json!([])
        );
    }
    #[test]
    fn unknown_values_and_foreign_owner_are_rejected() {
        let (meta, mut update) = fixture();
        update.choice = "ultra".into();
        assert!(updated(&meta, &update).is_err());
        update.choice = "low".into();
        update.owner.session_id = "other".into();
        assert!(updated(&meta, &update).is_err());
    }

    #[test]
    fn effort_restart_and_interrupted_writes_preserve_original_transcript() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sessions.json");
        let store = session_file::SessionFile::default();
        let (meta, update) = fixture();
        let next = updated(&meta, &update).unwrap();
        let messages = json!([{"id":"original","parts":[{"type":"text","text":"Keep"}]}]);
        store
            .set(&path, "messages:a", Some(messages.clone()))
            .unwrap();
        store.set(&path, "sessions", Some(json!([meta]))).unwrap();
        assert!(store
            .update(&path, "sessions", Some(json!([next])), |_, _| Err(
                "disk full".into()
            ))
            .is_err());
        let reopened = session_file::SessionFile::default();
        assert_eq!(
            reopened.get(&path, "sessions").unwrap(),
            Some(json!([meta]))
        );
        assert!(store
            .update(&path, "sessions", Some(json!([next])), |path, bytes| {
                atomic_write(path, bytes)?;
                Err("sync failed after replace".into())
            })
            .is_err());
        let reopened = session_file::SessionFile::default();
        assert_eq!(
            reopened.get(&path, "sessions").unwrap(),
            Some(json!([next]))
        );
        assert_eq!(store.get(&path, "sessions").unwrap(), Some(json!([next])));
        assert_eq!(reopened.get(&path, "messages:a").unwrap(), Some(messages));
        assert!(updated(&next, &update).is_err());
    }

    #[test]
    fn existing_metadata_lock_serializes_competing_chat_updates_without_lost_choices() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sessions.json");
        let state = MemoryState::default();
        let (a, _) = fixture();
        let mut b = a.clone();
        b["id"] = json!("b");
        state
            .sessions
            .set(&path, "sessions", Some(json!([a, b])))
            .unwrap();
        std::thread::scope(|scope| {
            let attempts: Vec<_> = [("a", "high"), ("a", "low"), ("b", "medium")]
                .into_iter()
                .map(|(id, choice)| {
                    let state = &state;
                    let path = &path;
                    let original = if id == "a" { a.clone() } else { b.clone() };
                    scope.spawn(move || -> Result<()> {
                        let _metadata = state.metadata.lock().unwrap();
                        let lock = state.owner(id)?;
                        let _owner = lock.lock().unwrap();
                        let mut sessions = state.sessions.get(path, "sessions")?.unwrap();
                        let meta = sessions
                            .as_array_mut()
                            .unwrap()
                            .iter_mut()
                            .find(|entry| entry["id"] == id)
                            .unwrap();
                        *meta = updated(
                            meta,
                            &EffortUpdate {
                                owner: Owner {
                                    session_id: id.into(),
                                    workspace_id: None,
                                },
                                expected_session: original,
                                key: "model-key".into(),
                                choice: choice.into(),
                                revision: "evidence-1".into(),
                            },
                        )?;
                        state.sessions.set(path, "sessions", Some(sessions))
                    })
                })
                .collect();
            let results: Vec<_> = attempts
                .into_iter()
                .map(|thread| thread.join().unwrap())
                .collect();
            assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 2);
            assert_eq!(
                results
                    .iter()
                    .filter(|result| result.as_ref().is_err_and(|e| e.contains("stale")))
                    .count(),
                1
            );
        });
        let restored = session_file::SessionFile::default()
            .get(&path, "sessions")
            .unwrap()
            .unwrap();
        assert_eq!(restored[0]["modelRevision"], 1);
        assert_eq!(restored[1]["modelRevision"], 1);
        assert_eq!(
            restored[1]["effortPreferences"]["choices"][0]["choice"],
            "medium"
        );
    }
}
