use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use tauri::Manager;
use tempfile::NamedTempFile;

const ATTACHMENT_STORE_DIR: &str = "ai-attachments";
const MAX_ATTACHMENT_BYTES: usize = 8 * 1024 * 1024;

// Publication may run concurrently across conversations; collection must not
// remove evidence between its write and the durable memory manifest commit.
pub(crate) static CONTENT_COLLECTION: RwLock<()> = RwLock::new(());

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAttachmentContent {
    pub(crate) id: String,
    pub(crate) content_hash: String,
    pub(crate) byte_size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentReconcileResult {
    removed_count: usize,
    issues: Vec<AttachmentContentIssue>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentContentIssue {
    id: String,
    code: &'static str,
    message: String,
}

fn content_hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn valid_content_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn store_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(ATTACHMENT_STORE_DIR))
        .map_err(|error| format!("Could not locate Clack attachment storage: {error}"))
}

pub(crate) fn read_content_from(store: &Path, id: &str) -> Result<Vec<u8>, String> {
    if !valid_content_id(id) {
        return Err("Attachment content ID is invalid.".into());
    }
    let path = store.join(id);
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Stored attachment content is unavailable: {error}"))?;
    if !metadata.file_type().is_file() || metadata.len() > MAX_ATTACHMENT_BYTES as u64 {
        return Err("Stored attachment content is invalid.".into());
    }
    let bytes = fs::read(&path)
        .map_err(|error| format!("Could not read stored attachment content: {error}"))?;
    if content_hash(&bytes) != id {
        return Err("Stored attachment content failed integrity validation.".into());
    }
    Ok(bytes)
}

fn inspect_content_from(store: &Path, id: &str) -> Result<StoredAttachmentContent, String> {
    let bytes = read_content_from(store, id)?;
    Ok(StoredAttachmentContent {
        id: id.to_string(),
        content_hash: id.to_string(),
        byte_size: bytes.len() as u64,
    })
}

pub(crate) fn put_content_in(
    store: &Path,
    bytes: &[u8],
) -> Result<StoredAttachmentContent, String> {
    if bytes.is_empty() {
        return Err("Empty attachment content cannot be stored.".into());
    }
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(format!(
            "Attachment content exceeds the {MAX_ATTACHMENT_BYTES}-byte storage limit."
        ));
    }
    fs::create_dir_all(store)
        .map_err(|error| format!("Could not create Clack attachment storage: {error}"))?;
    let id = content_hash(bytes);
    let destination = store.join(&id);
    if destination.exists() {
        let existing = read_content_from(store, &id)?;
        if existing.len() != bytes.len() {
            return Err("Stored attachment content has an unexpected size.".into());
        }
        return Ok(StoredAttachmentContent {
            content_hash: id.clone(),
            id,
            byte_size: bytes.len() as u64,
        });
    }

    let mut temporary = NamedTempFile::new_in(store)
        .map_err(|error| format!("Could not create attachment staging file: {error}"))?;
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| format!("Could not write attachment content: {error}"))?;
    if let Err(error) = temporary.persist_noclobber(&destination) {
        if destination.exists() {
            read_content_from(store, &id)?;
        } else {
            return Err(format!(
                "Could not finalize attachment content: {}",
                error.error
            ));
        }
    }
    Ok(StoredAttachmentContent {
        content_hash: id.clone(),
        id,
        byte_size: bytes.len() as u64,
    })
}

pub(crate) fn reconcile_store(
    store: &Path,
    retain_ids: &[String],
) -> Result<AttachmentReconcileResult, String> {
    reconcile_store_with_collection(store, retain_ids, true)
}

fn reconcile_store_with_collection(
    store: &Path,
    retain_ids: &[String],
    collect: bool,
) -> Result<AttachmentReconcileResult, String> {
    let mut retained_ids = retain_ids.to_vec();
    retained_ids.sort();
    retained_ids.dedup();
    if !store.exists() {
        let issues = retained_ids
            .into_iter()
            .map(|id| AttachmentContentIssue {
                code: if valid_content_id(&id) {
                    "attachment_content_missing"
                } else {
                    "attachment_content_invalid"
                },
                message: if valid_content_id(&id) {
                    "Stored attachment content is unavailable.".into()
                } else {
                    "Attachment content ID is invalid.".into()
                },
                id,
            })
            .collect();
        return Ok(AttachmentReconcileResult {
            removed_count: 0,
            issues,
        });
    }
    let retained: HashSet<&str> = retained_ids
        .iter()
        .filter_map(|id| valid_content_id(id).then_some(id.as_str()))
        .collect();
    let mut removed = 0;
    for entry in fs::read_dir(store)
        .map_err(|error| format!("Could not inspect Clack attachment storage: {error}"))?
    {
        if !collect {
            continue;
        }
        let entry = entry
            .map_err(|error| format!("Could not inspect stored attachment content: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Could not inspect stored attachment type: {error}"))?;
        if !file_type.is_file() {
            continue;
        }
        let name = entry.file_name();
        let id = name.to_string_lossy();
        if valid_content_id(&id) && retained.contains(id.as_ref()) {
            continue;
        }
        fs::remove_file(entry.path())
            .map_err(|error| format!("Could not remove unused attachment content: {error}"))?;
        removed += 1;
    }
    let issues = retained_ids
        .into_iter()
        .filter_map(|id| {
            if !valid_content_id(&id) {
                return Some(AttachmentContentIssue {
                    id,
                    code: "attachment_content_invalid",
                    message: "Attachment content ID is invalid.".into(),
                });
            }
            match read_content_from(store, &id) {
                Ok(_) => None,
                Err(message) => Some(AttachmentContentIssue {
                    id,
                    code: if message.contains("unavailable") {
                        "attachment_content_missing"
                    } else if message.contains("integrity validation") {
                        "attachment_content_integrity_failed"
                    } else {
                        "attachment_content_invalid"
                    },
                    message,
                }),
            }
        })
        .collect();
    Ok(AttachmentReconcileResult {
        removed_count: removed,
        issues,
    })
}

#[tauri::command]
pub fn attachment_store_put(
    app: tauri::AppHandle,
    request: tauri::ipc::Request,
) -> Result<StoredAttachmentContent, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("attachment_store_put expected a raw byte body.".into());
    };
    put_content_in(&store_dir(&app)?, bytes)
}

#[tauri::command]
pub fn attachment_store_get(
    app: tauri::AppHandle,
    id: String,
) -> Result<tauri::ipc::Response, String> {
    let bytes = read_content_from(&store_dir(&app)?, &id)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn attachment_store_inspect(
    app: tauri::AppHandle,
    id: String,
) -> Result<StoredAttachmentContent, String> {
    inspect_content_from(&store_dir(&app)?, &id)
}

#[tauri::command]
pub fn attachment_store_reconcile(
    app: tauri::AppHandle,
    retain_ids: Vec<String>,
) -> Result<AttachmentReconcileResult, String> {
    let _collection = CONTENT_COLLECTION.write().map_err(|e| e.to_string())?;
    let mut retained = retain_ids;
    match super::conversation_memory::retention_roots(&app) {
        Ok(roots) => {
            retained.extend(roots);
            reconcile_store(&store_dir(&app)?, &retained)
        }
        Err(error) => {
            log::warn!("Attachment collection paused; conversation memory needs recovery: {error}");
            reconcile_store_with_collection(&store_dir(&app)?, &retained, false)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_is_hashed_deduplicated_and_verified() {
        let store = tempfile::tempdir().unwrap();
        let first = put_content_in(store.path(), b"same content").unwrap();
        let second = put_content_in(store.path(), b"same content").unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(first.content_hash, first.id);
        assert_eq!(
            read_content_from(store.path(), &first.id).unwrap(),
            b"same content"
        );
        assert_eq!(fs::read_dir(store.path()).unwrap().count(), 1);
    }

    #[test]
    fn invalid_ids_and_corrupted_content_are_rejected() {
        let store = tempfile::tempdir().unwrap();
        assert!(read_content_from(store.path(), "../secret").is_err());
        let stored = put_content_in(store.path(), b"original").unwrap();
        fs::write(store.path().join(&stored.id), b"changed").unwrap();
        let error = read_content_from(store.path(), &stored.id).unwrap_err();
        assert!(error.contains("integrity validation"));
    }

    #[test]
    fn reconcile_keeps_references_and_removes_orphans() {
        let store = tempfile::tempdir().unwrap();
        let keep = put_content_in(store.path(), b"keep").unwrap();
        let remove = put_content_in(store.path(), b"remove").unwrap();
        fs::write(store.path().join("stale-temporary-file"), b"temp").unwrap();
        let result = reconcile_store(store.path(), std::slice::from_ref(&keep.id)).unwrap();
        assert_eq!(result.removed_count, 2);
        assert!(result.issues.is_empty());
        assert!(store.path().join(keep.id).is_file());
        assert!(!store.path().join(remove.id).exists());
    }

    #[test]
    fn reconcile_reports_missing_and_corrupt_references_without_removing_them() {
        let store = tempfile::tempdir().unwrap();
        let corrupt = put_content_in(store.path(), b"original").unwrap();
        fs::write(store.path().join(&corrupt.id), b"changed").unwrap();
        let missing = "b".repeat(64);

        let result = reconcile_store(store.path(), &[corrupt.id.clone(), missing.clone()]).unwrap();

        assert_eq!(result.removed_count, 0);
        assert_eq!(result.issues.len(), 2);
        assert_eq!(result.issues[0].id, corrupt.id);
        assert_eq!(result.issues[0].code, "attachment_content_integrity_failed");
        assert_eq!(result.issues[1].id, missing);
        assert_eq!(result.issues[1].code, "attachment_content_missing");
    }

    #[test]
    fn reconcile_missing_store_reports_each_reference_once() {
        let parent = tempfile::tempdir().unwrap();
        let missing_store = parent.path().join("not-created");
        let missing = "b".repeat(64);

        let result = reconcile_store(
            &missing_store,
            &[missing.clone(), missing.clone(), "invalid".into()],
        )
        .unwrap();

        assert_eq!(result.removed_count, 0);
        assert_eq!(result.issues.len(), 2);
        assert_eq!(result.issues[0].code, "attachment_content_missing");
        assert_eq!(result.issues[1].code, "attachment_content_invalid");
    }

    #[test]
    fn oversized_content_is_rejected() {
        let store = tempfile::tempdir().unwrap();
        let bytes = vec![0_u8; MAX_ATTACHMENT_BYTES + 1];
        let error = put_content_in(store.path(), &bytes).unwrap_err();
        assert!(error.contains("storage limit"));
    }

    #[test]
    fn paused_collection_still_checks_existing_attachments_without_deleting_unknown_roots() {
        let directory = tempfile::tempdir().unwrap();
        let keep = put_content_in(directory.path(), b"memory-only evidence").unwrap();
        let result =
            reconcile_store_with_collection(directory.path(), &["a".repeat(64)], false).unwrap();
        assert_eq!(result.removed_count, 0);
        assert_eq!(result.issues.len(), 1);
        assert!(directory.path().join(keep.id).exists());
    }
}
