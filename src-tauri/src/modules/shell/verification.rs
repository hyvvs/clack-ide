//! Bounded read-only working-tree witness. Not a Git commit, test executor or
//! dependency oracle. Only complete small local source trees receive a digest.
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::modules::workspace::{authorize_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};

const MAX_ENTRIES: usize = 2048;
const MAX_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWitness {
    pub revision: Option<String>,
    pub qualification: &'static str,
    pub reason: Option<String>,
}

fn digest_tree(root: &Path) -> Result<String, String> {
    let mut stack = vec![root.to_path_buf()];
    let mut records: Vec<(String, bool, PathBuf)> = vec![];
    while let Some(dir) = stack.pop() {
        let children = fs::read_dir(&dir).map_err(|_| "unreadable directory")?;
        for entry in children {
            let entry = entry.map_err(|_| "unreadable directory entry")?;
            let path = entry.path();
            let relative = path.strip_prefix(root).map_err(|_| "path escaped root")?;
            // Repository metadata is deliberately not a source revision. Every
            // other file, including ignored and untracked files, is included.
            if relative.components().count() == 1 && entry.file_name() == ".git" {
                continue;
            }
            let meta = fs::symlink_metadata(&path).map_err(|_| "unreadable metadata")?;
            if meta.file_type().is_symlink() {
                return Err("symbolic link or junction: full coverage unavailable".into());
            }
            if !meta.is_dir() && !meta.is_file() {
                return Err("unsupported filesystem entry".into());
            }
            let rel = relative.to_str().ok_or("non-UTF8 path")?.replace('\\', "/");
            records.push((rel, meta.is_dir(), path.clone()));
            if records.len() > MAX_ENTRIES {
                return Err("working tree exceeds entry bound".into());
            }
            if meta.is_dir() {
                stack.push(path);
            }
        }
    }
    records.sort_by(|a, b| a.0.cmp(&b.0));
    let mut hash = Sha256::new();
    hash.update(b"clack-source-tree-v1\0");
    hash.update(root.to_string_lossy().as_bytes());
    let mut total = 0_u64;
    for (name, directory, path) in records {
        hash.update(if directory { b"d" } else { b"f" });
        hash.update((name.len() as u64).to_le_bytes());
        hash.update(name.as_bytes());
        if !directory {
            let meta = fs::symlink_metadata(&path).map_err(|_| "source disappeared")?;
            total = total.checked_add(meta.len()).ok_or("size overflow")?;
            if total > MAX_BYTES {
                return Err("working tree exceeds byte bound".into());
            }
            let file = fs::File::open(&path).map_err(|_| "source unreadable")?;
            let mut content = vec![];
            file.take(MAX_BYTES + 1)
                .read_to_end(&mut content)
                .map_err(|_| "source read failed")?;
            if content.len() as u64 != meta.len() {
                return Err("source changed while reading".into());
            }
            hash.update((content.len() as u64).to_le_bytes());
            hash.update(&content);
        }
    }
    Ok(format!("{:x}", hash.finalize()))
}

pub(crate) fn snapshot(root: &Path) -> WorkspaceWitness {
    match digest_tree(root) {
        Ok(revision) => WorkspaceWitness {
            revision: Some(revision),
            qualification: "bounded-local-source-tree-excluding-git-metadata",
            reason: None,
        },
        Err(reason) => WorkspaceWitness {
            revision: None,
            qualification: "unavailable",
            reason: Some(reason),
        },
    }
}

#[tauri::command]
pub fn agent_workspace_fingerprint(
    root: String,
    workspace: Option<WorkspaceEnv>,
    registry: tauri::State<'_, WorkspaceRegistry>,
) -> WorkspaceWitness {
    let workspace = WorkspaceEnv::from_option(workspace);
    if !matches!(workspace, WorkspaceEnv::Local) {
        return WorkspaceWitness {
            revision: None,
            qualification: "unavailable",
            reason: Some("non-local workspace not fingerprinted".into()),
        };
    }
    match authorize_spawn_cwd(&registry, Some(&root), &workspace) {
        Ok(Some(path)) => snapshot(&path),
        _ => WorkspaceWitness {
            revision: None,
            qualification: "unavailable",
            reason: Some("workspace root unavailable or unauthorized".into()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn real_native_check_and_revision_changes_are_observed() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::write(root.join("source.txt"), b"A").unwrap();
        let a = snapshot(root).revision.unwrap();
        let outcome = crate::modules::shell::run_blocking_inner(
            "echo verified".into(),
            Some(root.to_string_lossy().to_string()),
            WorkspaceEnv::Local,
            std::time::Duration::from_secs(10),
        )
        .unwrap();
        assert_eq!(outcome.exit_code, Some(0));
        assert!(!outcome.timed_out);
        assert_eq!(snapshot(root).revision.as_deref(), Some(a.as_str()));
        fs::write(root.join("source.txt"), b"B").unwrap();
        let b = snapshot(root).revision.unwrap();
        assert_ne!(a, b);
        fs::write(root.join("untracked.txt"), b"new").unwrap();
        let c = snapshot(root).revision.unwrap();
        assert_ne!(b, c);
        fs::remove_file(root.join("source.txt")).unwrap();
        assert_ne!(snapshot(root).revision.unwrap(), c);
        assert_eq!(snapshot(root).revision, snapshot(root).revision);
    }

    #[test]
    fn large_workspace_refuses_partial_proof() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("too-big"),
            vec![0_u8; (MAX_BYTES + 1) as usize],
        )
        .unwrap();
        assert!(snapshot(dir.path()).revision.is_none());
    }
}
