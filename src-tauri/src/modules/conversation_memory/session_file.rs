use super::{atomic_write, Result};
use serde_json::{Map, Value};
use std::fs;
use std::path::Path;
use std::sync::Mutex;

/// Atomic ownership of the existing session and PeerTask JSON formats.
#[derive(Default)]
pub(super) struct SessionFile(Mutex<Option<Map<String, Value>>>);

impl SessionFile {
    pub(super) fn revisioned(&self, path: &Path) -> Result<Value> {
        self.with_cache(path, |cache| {
            let revision = match cache.get("revision") {
                None => 0,
                Some(value) => value
                    .as_u64()
                    .filter(|value| *value < 9_007_199_254_740_991)
                    .ok_or("peer_revision_invalid")?,
            };
            if cache.get("tasks").is_some_and(|tasks| !tasks.is_array()) {
                return Err("peer_tasks_invalid".into());
            }
            Ok(serde_json::json!({
                "revision": revision,
                "tasks": cache.get("tasks").cloned().unwrap_or(serde_json::json!([]))
            }))
        })
    }

    pub(super) fn compare_tasks(&self, path: &Path, expected: u64, tasks: Value) -> Result<u64> {
        self.compare_tasks_with(path, expected, tasks, atomic_write)
    }

    fn compare_tasks_with(
        &self,
        path: &Path,
        expected: u64,
        tasks: Value,
        persist: impl FnOnce(&Path, &[u8]) -> Result<()>,
    ) -> Result<u64> {
        self.with_cache(path, |cache| {
            let revision = cache.get("revision").and_then(Value::as_u64).unwrap_or(0);
            if revision != expected {
                return Err("peer_ledger_stale: reload before dispatching work".into());
            }
            let next_revision = revision.checked_add(1).ok_or("peer_revision_exhausted")?;
            let mut next = cache.clone();
            next.insert("tasks".into(), tasks);
            next.insert("revision".into(), next_revision.into());
            let bytes = serde_json::to_vec(&next).map_err(|e| e.to_string())?;
            if let Err(error) = persist(path, &bytes) {
                if let Some(disk) = fs::read(path)
                    .ok()
                    .and_then(|bytes| serde_json::from_slice(&bytes).ok())
                {
                    *cache = disk;
                }
                return Err(error);
            }
            *cache = next;
            Ok(next_revision)
        })
    }

    fn with_cache<T>(
        &self,
        path: &Path,
        work: impl FnOnce(&mut Map<String, Value>) -> Result<T>,
    ) -> Result<T> {
        let mut cache = self.0.lock().map_err(|e| e.to_string())?;
        if cache.is_none() {
            *cache = Some(match fs::read(path) {
                Ok(bytes) => serde_json::from_slice(&bytes)
                    .map_err(|e| format!("session_store_corrupt: {e}"))?,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Map::new(),
                Err(error) => return Err(format!("session_store_unavailable: {error}")),
            });
        }
        work(cache.as_mut().ok_or("session_store_unavailable")?)
    }

    pub(super) fn get(&self, path: &Path, key: &str) -> Result<Option<Value>> {
        self.with_cache(path, |cache| Ok(cache.get(key).cloned()))
    }

    pub(super) fn entries(&self, path: &Path) -> Result<Vec<(String, Value)>> {
        self.with_cache(path, |cache| {
            Ok(cache
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect())
        })
    }

    pub(super) fn set(&self, path: &Path, key: &str, value: Option<Value>) -> Result<()> {
        self.update(path, key, value, atomic_write)
    }

    fn update(
        &self,
        path: &Path,
        key: &str,
        value: Option<Value>,
        persist: impl FnOnce(&Path, &[u8]) -> Result<()>,
    ) -> Result<()> {
        self.with_cache(path, |cache| {
            let previous = cache.get(key).cloned();
            if value == previous {
                return Ok(());
            }
            match value {
                Some(value) => {
                    cache.insert(key.into(), value);
                }
                None => {
                    cache.remove(key);
                }
            }
            let result = serde_json::to_vec(cache)
                .map_err(|e| e.to_string())
                .and_then(|bytes| persist(path, &bytes));
            if result.is_err() {
                // A directory sync can fail after atomic replacement succeeded.
                // Keep the cache on the actual old-or-new durable file.
                if let Some(disk) = fs::read(path)
                    .ok()
                    .and_then(|bytes| serde_json::from_slice(&bytes).ok())
                {
                    *cache = disk;
                } else {
                    match previous {
                        Some(previous) => {
                            cache.insert(key.into(), previous);
                        }
                        None => {
                            cache.remove(key);
                        }
                    }
                }
            }
            result
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn peer_ledger_migrates_existing_file_without_losing_legacy_metadata() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("clack-ai-peer-tasks.json");
        fs::write(&path, br#"{"tasks":[{"id":"old"}],"legacy":"keep"}"#).unwrap();
        let store = SessionFile::default();
        assert_eq!(
            store.revisioned(&path).unwrap(),
            json!({"revision":0,"tasks":[{"id":"old"}]})
        );
        assert_eq!(
            store
                .compare_tasks(&path, 0, json!([{"id":"old","communication":[]}]))
                .unwrap(),
            1
        );
        let reopened = SessionFile::default();
        assert_eq!(reopened.get(&path, "legacy").unwrap(), Some(json!("keep")));
        assert_eq!(reopened.revisioned(&path).unwrap()["revision"], 1);
    }

    #[test]
    fn peer_receipt_cas_rejects_second_window_without_overwriting_the_winner() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("peers.json");
        let store = SessionFile::default();
        std::thread::scope(|scope| {
            let first = scope.spawn(|| store.compare_tasks(&path, 0, json!([{"id":"a"}])));
            let second = scope.spawn(|| store.compare_tasks(&path, 0, json!([{"id":"b"}])));
            let results = [first.join().unwrap(), second.join().unwrap()];
            assert_eq!(results.iter().filter(|value| value.is_ok()).count(), 1);
            assert!(results.iter().any(|value| value
                .as_ref()
                .is_err_and(|error| error.contains("peer_ledger_stale"))));
        });
        assert_eq!(
            SessionFile::default().revisioned(&path).unwrap()["revision"],
            1
        );
    }

    #[test]
    fn peer_receipt_failed_write_keeps_previous_revision_and_allows_retry() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("peers.json");
        let store = SessionFile::default();
        store
            .compare_tasks(&path, 0, json!([{"state":"queued"}]))
            .unwrap();
        let before = store.revisioned(&path).unwrap();
        assert!(store
            .compare_tasks_with(&path, 1, json!([{"state":"acknowledged"}]), |_, _| Err(
                "disk full".into()
            ))
            .is_err());
        assert_eq!(store.revisioned(&path).unwrap(), before);
        assert_eq!(SessionFile::default().revisioned(&path).unwrap(), before);
        store
            .compare_tasks(&path, 1, json!([{"state":"acknowledged"}]))
            .unwrap();
        assert_eq!(
            SessionFile::default().revisioned(&path).unwrap()["tasks"][0]["state"],
            "acknowledged"
        );
    }

    #[test]
    fn peer_receipt_post_replace_failure_forces_reconciliation_not_duplicate_commit() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("peers.json");
        let store = SessionFile::default();
        assert!(store
            .compare_tasks_with(
                &path,
                0,
                json!([{"state":"acknowledged"}]),
                |path, bytes| {
                    atomic_write(path, bytes)?;
                    Err("directory sync failed".into())
                }
            )
            .is_err());
        assert!(store
            .compare_tasks(&path, 0, json!([]))
            .unwrap_err()
            .contains("stale"));
        assert_eq!(store.revisioned(&path).unwrap()["revision"], 1);
    }

    #[test]
    fn target_selection_and_context_are_old_or_new_even_on_interrupted_write() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sessions.json");
        let old = json!([{"id":"a","profile":{"modelId":"old"},"targetContext":{"modelId":"old"},"modelRevision":1}]);
        let next = json!([{"id":"a","profile":{"modelId":"new"},"targetContext":{"modelId":"new"},"modelRevision":2}]);
        let store = SessionFile::default();
        store.set(&path, "sessions", Some(old.clone())).unwrap();
        assert!(store
            .update(&path, "sessions", Some(next.clone()), |_, _| Err(
                "disk full".into()
            ))
            .is_err());
        assert_eq!(
            SessionFile::default().get(&path, "sessions").unwrap(),
            Some(old)
        );
        assert!(store
            .update(&path, "sessions", Some(next.clone()), |path, bytes| {
                atomic_write(path, bytes)?;
                Err("directory sync error after atomic replacement".into())
            })
            .is_err());
        assert_eq!(store.get(&path, "sessions").unwrap(), Some(next.clone()));
        assert_eq!(
            SessionFile::default().get(&path, "sessions").unwrap(),
            Some(next)
        );
    }

    #[test]
    fn legacy_keys_survive_additive_atomic_updates_and_restart() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("terax-ai-sessions.json");
        let legacy = json!({"sessions":[{"id":"legacy","title":"Title"}],"messages:legacy":[{"id":"u1","parts":[{"type":"text","text":"Original"}]}],"unknownLegacyMetadata":{"keep":true}});
        fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();
        let store = SessionFile::default();
        store.set(&path, "activeId", Some(json!("legacy"))).unwrap();
        let reopened = SessionFile::default();
        assert_eq!(
            reopened.get(&path, "messages:legacy").unwrap(),
            Some(legacy["messages:legacy"].clone())
        );
        assert_eq!(
            reopened.get(&path, "unknownLegacyMetadata").unwrap(),
            Some(json!({"keep":true}))
        );
        assert_eq!(
            reopened.get(&path, "activeId").unwrap(),
            Some(json!("legacy"))
        );
    }

    #[test]
    fn failed_save_preserves_disk_and_cache_then_allows_retry() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sessions.json");
        let store = SessionFile::default();
        store
            .set(&path, "messages:a", Some(json!(["original"])))
            .unwrap();
        let before = fs::read(&path).unwrap();
        assert!(store
            .update(&path, "messages:a", Some(json!(["new"])), |_, _| Err(
                "disk full".into()
            ))
            .is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        assert_eq!(
            store.get(&path, "messages:a").unwrap(),
            Some(json!(["original"]))
        );
        store
            .set(&path, "messages:a", Some(json!(["new"])))
            .unwrap();
        assert_eq!(
            SessionFile::default().get(&path, "messages:a").unwrap(),
            Some(json!(["new"]))
        );
    }

    #[test]
    fn corrupt_legacy_store_is_never_replaced_with_empty_defaults() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sessions.json");
        fs::write(&path, b"broken legacy json").unwrap();
        let store = SessionFile::default();
        assert!(store.set(&path, "activeId", Some(json!("a"))).is_err());
        assert_eq!(fs::read(path).unwrap(), b"broken legacy json");
    }

    #[test]
    fn two_windows_update_independent_keys_without_lost_writes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sessions.json");
        let store = SessionFile::default();
        std::thread::scope(|scope| {
            scope.spawn(|| store.set(&path, "messages:a", Some(json!(["a"]))).unwrap());
            scope.spawn(|| store.set(&path, "messages:b", Some(json!(["b"]))).unwrap());
        });
        let reopened = SessionFile::default();
        assert_eq!(
            reopened.get(&path, "messages:a").unwrap(),
            Some(json!(["a"]))
        );
        assert_eq!(
            reopened.get(&path, "messages:b").unwrap(),
            Some(json!(["b"]))
        );
    }

    #[test]
    fn pending_staging_file_is_not_loaded_and_deletion_is_durable() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sessions.json");
        let store = SessionFile::default();
        store
            .set(&path, "messages:a", Some(json!(["original"])))
            .unwrap();
        fs::write(directory.path().join(".tmp-interrupted"), b"partial").unwrap();
        assert_eq!(
            SessionFile::default().get(&path, "messages:a").unwrap(),
            Some(json!(["original"]))
        );
        store.set(&path, "messages:a", None).unwrap();
        assert_eq!(
            SessionFile::default().get(&path, "messages:a").unwrap(),
            None
        );
    }

    #[test]
    fn error_after_atomic_replacement_keeps_cache_consistent_with_disk() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sessions.json");
        let store = SessionFile::default();
        store
            .set(&path, "messages:a", Some(json!(["old"])))
            .unwrap();
        assert!(store
            .update(&path, "messages:a", Some(json!(["new"])), |path, bytes| {
                atomic_write(path, bytes)?;
                Err("injected directory sync failure".into())
            })
            .is_err());
        assert_eq!(
            store.get(&path, "messages:a").unwrap(),
            SessionFile::default().get(&path, "messages:a").unwrap()
        );
        assert_eq!(
            store.get(&path, "messages:a").unwrap(),
            Some(json!(["new"]))
        );
    }
}
