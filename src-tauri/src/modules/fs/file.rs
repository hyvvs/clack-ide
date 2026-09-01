use std::path::Path;
use std::time::UNIX_EPOCH;
use std::{
    fs,
    io::{Read, Write},
};

use serde::Serialize;
use tauri::Emitter;
use tempfile::NamedTempFile;

use crate::modules::workspace::{resolve_path, WorkspaceEnv, WorkspaceRegistry};

const MAX_READ_BYTES: u64 = 10 * 1024 * 1024; // 10 MB
const BINARY_SNIFF_BYTES: usize = 8 * 1024;
const MAX_ATTACHMENT_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ReadResult {
    Text {
        content: String,
        size: u64,
    },
    Binary {
        size: u64,
    },
    /// File exceeds MAX_READ_BYTES. UI decides whether to offer "open anyway".
    TooLarge {
        size: u64,
        limit: u64,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StatKind {
    File,
    Dir,
    Symlink,
}

#[derive(Serialize)]
pub struct FileStat {
    pub size: u64,
    pub mtime: u64,
    pub kind: StatKind,
}

#[tauri::command]
pub fn fs_read_file(path: String, workspace: Option<WorkspaceEnv>) -> Result<ReadResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    let meta = std::fs::metadata(&p).map_err(|e| {
        log::debug!("fs_read_file stat({}) failed: {e}", p.display());
        e.to_string()
    })?;

    let size = meta.len();
    if size > MAX_READ_BYTES {
        return Ok(ReadResult::TooLarge {
            size,
            limit: MAX_READ_BYTES,
        });
    }

    let bytes = std::fs::read(&p).map_err(|e| {
        log::debug!("fs_read_file read({}) failed: {e}", p.display());
        e.to_string()
    })?;

    // Null-byte sniff on the first chunk. Not perfect (misses UTF-16 BOM
    // cases) but catches the common "this is a PNG" mistake cheaply.
    let sniff_len = bytes.len().min(BINARY_SNIFF_BYTES);
    if bytes[..sniff_len].contains(&0) {
        return Ok(ReadResult::Binary { size });
    }

    match String::from_utf8(bytes) {
        Ok(content) => Ok(ReadResult::Text { content, size }),
        Err(_) => Ok(ReadResult::Binary { size }),
    }
}

fn read_attachment_bytes(
    path: &str,
    workspace_root: &str,
    workspace: &WorkspaceEnv,
    registry: &WorkspaceRegistry,
    requested_limit: u64,
) -> Result<Vec<u8>, String> {
    let resolved_root = resolve_path(workspace_root, workspace);
    let canonical_root = registry
        .canonicalize_cached(&resolved_root)
        .map_err(|error| format!("Attachment workspace is not accessible: {error}"))?;
    if !canonical_root.is_dir() || !registry.is_authorized(&canonical_root) {
        return Err("Attachment workspace is not authorized.".into());
    }

    let resolved_path = resolve_path(path, workspace);
    let canonical_path = registry
        .canonicalize_cached(&resolved_path)
        .map_err(|error| format!("Attachment path is not accessible: {error}"))?;
    if !canonical_path.starts_with(&canonical_root) || !registry.is_authorized(&canonical_path) {
        return Err("Attachment path is outside the authorized workspace.".into());
    }

    let metadata = std::fs::metadata(&canonical_path)
        .map_err(|error| format!("Could not inspect attachment: {error}"))?;
    if !metadata.file_type().is_file() {
        return Err("Only regular files can be attached.".into());
    }

    let limit = requested_limit.clamp(1, MAX_ATTACHMENT_BYTES);
    if metadata.len() > limit {
        return Err(format!(
            "Attachment is too large ({} bytes; limit is {} bytes).",
            metadata.len(),
            limit
        ));
    }

    let file = std::fs::File::open(&canonical_path)
        .map_err(|error| format!("Could not open attachment: {error}"))?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read attachment: {error}"))?;
    if bytes.len() as u64 > limit {
        return Err(format!(
            "Attachment grew beyond the {limit}-byte read limit."
        ));
    }
    Ok(bytes)
}

#[tauri::command]
pub fn fs_read_attachment(
    path: String,
    workspace_root: String,
    workspace: Option<WorkspaceEnv>,
    max_bytes: Option<u64>,
    registry: tauri::State<'_, WorkspaceRegistry>,
) -> Result<tauri::ipc::Response, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let bytes = read_attachment_bytes(
        &path,
        &workspace_root,
        &workspace,
        &registry,
        max_bytes.unwrap_or(MAX_ATTACHMENT_BYTES),
    )?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[derive(Serialize, Clone)]
struct FileWrittenEvent {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
}

/// Atomic write via O_EXCL tempfile in the target's parent, then rename.
/// The random suffix is what blocks pre-staged symlink attacks.
fn write_atomic(target: &Path, content: &[u8]) -> std::io::Result<()> {
    let parent = target.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no parent")
    })?;
    let mut tmp = NamedTempFile::new_in(parent)?;
    tmp.as_file_mut().write_all(content)?;
    tmp.as_file_mut().sync_all()?;
    tmp.persist(target).map_err(|e| e.error)?;
    Ok(())
}

#[tauri::command]
pub fn fs_write_file(
    path: String,
    content: String,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let target = resolve_path(&path, &workspace);
    let original_permissions = fs::metadata(&target).ok().map(|m| m.permissions());
    write_atomic(&target, content.as_bytes()).map_err(|e| {
        log::warn!("fs_write_file({}) failed: {e}", target.display());
        e.to_string()
    })?;

    if let Some(perms) = original_permissions {
        let _ = fs::set_permissions(&target, perms);
    }
    let _ = app.emit(
        "fs:file-written",
        FileWrittenEvent {
            path: path.clone(),
            source,
        },
    );

    Ok(())
}

#[tauri::command]
pub fn fs_canonicalize(path: String, workspace: Option<WorkspaceEnv>) -> Result<String, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    let canon = std::fs::canonicalize(&p).map_err(|e| e.to_string())?;
    Ok(super::to_canon(&canon))
}

#[tauri::command]
pub fn fs_stat(path: String, workspace: Option<WorkspaceEnv>) -> Result<FileStat, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    let meta = std::fs::metadata(&p).map_err(|e| e.to_string())?;
    let kind = if meta.is_dir() {
        StatKind::Dir
    } else if meta.file_type().is_symlink() {
        StatKind::Symlink
    } else {
        StatKind::File
    };
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(FileStat {
        size: meta.len(),
        mtime,
        kind,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_file_classifies_utf8_as_text() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.txt");
        std::fs::write(&f, b"hello world").unwrap();
        match fs_read_file(f.to_string_lossy().into_owned(), None).unwrap() {
            ReadResult::Text { content, size } => {
                assert_eq!(content, "hello world");
                assert_eq!(size, 11);
            }
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn read_file_detects_binary_via_null_byte() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.bin");
        std::fs::write(&f, b"PNG\0\x89image").unwrap();
        assert!(matches!(
            fs_read_file(f.to_string_lossy().into_owned(), None).unwrap(),
            ReadResult::Binary { .. }
        ));
    }

    #[test]
    fn read_file_detects_binary_via_invalid_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.bin");
        // Invalid UTF-8 with no null byte: must still classify as binary.
        std::fs::write(&f, [0xff, 0xfe, 0xfd, 0xfc]).unwrap();
        assert!(matches!(
            fs_read_file(f.to_string_lossy().into_owned(), None).unwrap(),
            ReadResult::Binary { .. }
        ));
    }

    #[test]
    fn attachment_read_requires_authorized_workspace_containment() {
        let workspace = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let inside_file = workspace.path().join("inside.txt");
        let outside_file = outside.path().join("outside.txt");
        std::fs::write(&inside_file, b"inside").unwrap();
        std::fs::write(&outside_file, b"outside").unwrap();
        let registry = WorkspaceRegistry::default();
        registry.authorize(workspace.path()).unwrap();

        let bytes = read_attachment_bytes(
            &inside_file.to_string_lossy(),
            &workspace.path().to_string_lossy(),
            &WorkspaceEnv::Local,
            &registry,
            1024,
        )
        .unwrap();
        assert_eq!(bytes, b"inside");

        let error = read_attachment_bytes(
            &outside_file.to_string_lossy(),
            &workspace.path().to_string_lossy(),
            &WorkspaceEnv::Local,
            &registry,
            1024,
        )
        .unwrap_err();
        assert!(error.contains("outside the authorized workspace"));
    }

    #[test]
    fn attachment_read_rejects_directories_and_oversized_files() {
        let workspace = tempfile::tempdir().unwrap();
        let file = workspace.path().join("large.bin");
        std::fs::write(&file, [0_u8; 32]).unwrap();
        let registry = WorkspaceRegistry::default();
        registry.authorize(workspace.path()).unwrap();

        let directory_error = read_attachment_bytes(
            &workspace.path().to_string_lossy(),
            &workspace.path().to_string_lossy(),
            &WorkspaceEnv::Local,
            &registry,
            1024,
        )
        .unwrap_err();
        assert!(directory_error.contains("regular files"));

        let size_error = read_attachment_bytes(
            &file.to_string_lossy(),
            &workspace.path().to_string_lossy(),
            &WorkspaceEnv::Local,
            &registry,
            16,
        )
        .unwrap_err();
        assert!(size_error.contains("too large"));
    }

    #[test]
    fn overwrites_existing_target() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("note.txt");
        std::fs::write(&target, b"old").unwrap();
        write_atomic(&target, b"new").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_legacy_staging_symlink() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let outside = dir.path().join("outside.txt");
        std::fs::write(&outside, b"untouched").unwrap();

        let target = dir.path().join("note.txt");
        // Pre-stage a symlink at the legacy deterministic staging path.
        let legacy = dir.path().join(".note.txt.terax.tmp");
        symlink(&outside, &legacy).unwrap();

        write_atomic(&target, b"payload").unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), b"payload");
        // The pre-staged symlink target must not have been written through.
        assert_eq!(std::fs::read(&outside).unwrap(), b"untouched");
    }
}
