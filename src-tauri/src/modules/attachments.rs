use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;
use tempfile::NamedTempFile;

const ATTACHMENT_STORE_DIR: &str = "ai-attachments";
const MAX_ATTACHMENT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAttachmentContent {
    id: String,
    content_hash: String,
    byte_size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentReconcileResult {
    removed_count: usize,
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

fn read_content_from(store: &Path, id: &str) -> Result<Vec<u8>, String> {
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

fn put_content_in(store: &Path, bytes: &[u8]) -> Result<StoredAttachmentContent, String> {
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

fn reconcile_store(store: &Path, retain_ids: &[String]) -> Result<usize, String> {
    if !store.exists() {
        return Ok(0);
    }
    let retained: HashSet<&str> = retain_ids
        .iter()
        .filter_map(|id| valid_content_id(id).then_some(id.as_str()))
        .collect();
    let mut removed = 0;
    for entry in fs::read_dir(store)
        .map_err(|error| format!("Could not inspect Clack attachment storage: {error}"))?
    {
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
    Ok(removed)
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
pub fn attachment_store_reconcile(
    app: tauri::AppHandle,
    retain_ids: Vec<String>,
) -> Result<AttachmentReconcileResult, String> {
    let removed_count = reconcile_store(&store_dir(&app)?, &retain_ids)?;
    Ok(AttachmentReconcileResult { removed_count })
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
        let removed = reconcile_store(store.path(), std::slice::from_ref(&keep.id)).unwrap();
        assert_eq!(removed, 2);
        assert!(store.path().join(keep.id).is_file());
        assert!(!store.path().join(remove.id).exists());
    }

    #[test]
    fn oversized_content_is_rejected() {
        let store = tempfile::tempdir().unwrap();
        let bytes = vec![0_u8; MAX_ATTACHMENT_BYTES + 1];
        let error = put_content_in(store.path(), &bytes).unwrap_err();
        assert!(error.contains("storage limit"));
    }
}
