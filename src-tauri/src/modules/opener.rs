use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::modules::workspace::{resolve_path, WorkspaceEnv};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemRevealResult {
    fallback_used: bool,
}

fn canonical_workspace_file(
    path: &str,
    workspace_root: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<PathBuf, String> {
    let root = workspace_root
        .map(str::trim)
        .filter(|root| !root.is_empty())
        .ok_or_else(|| "No trusted workspace root is available.".to_string())?;
    let root = std::fs::canonicalize(resolve_path(root, workspace))
        .map_err(|e| format!("Workspace root is unavailable: {e}"))?;
    if !root.is_dir() {
        return Err(format!(
            "Workspace root is not a directory: {}",
            root.display()
        ));
    }

    let target = std::fs::canonicalize(resolve_path(path, workspace))
        .map_err(|e| format!("Image file is unavailable: {e}"))?;
    let meta = std::fs::metadata(&target).map_err(|e| format!("Image file is unavailable: {e}"))?;
    if !meta.is_file() {
        return Err(format!(
            "Expected an image file, found {}",
            file_kind(&meta)
        ));
    }
    if !path_is_within(&target, &root) {
        return Err(format!(
            "Image file is outside the active workspace: {}",
            target.display()
        ));
    }
    Ok(target)
}

fn file_kind(meta: &std::fs::Metadata) -> &'static str {
    if meta.is_dir() {
        "dir"
    } else if meta.is_file() {
        "file"
    } else {
        "other"
    }
}

fn path_is_within(path: &Path, root: &Path) -> bool {
    path.starts_with(root)
}

#[tauri::command]
pub fn open_path_externally_checked(
    path: String,
    workspace_root: Option<String>,
    workspace: Option<WorkspaceEnv>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let target = canonical_workspace_file(&path, workspace_root.as_deref(), &workspace)?;
    tauri_plugin_opener::open_path(&target, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reveal_path_in_system_file_explorer_checked(
    path: String,
    workspace_root: Option<String>,
    workspace: Option<WorkspaceEnv>,
) -> Result<SystemRevealResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let target = canonical_workspace_file(&path, workspace_root.as_deref(), &workspace)?;
    match tauri_plugin_opener::reveal_item_in_dir(&target) {
        Ok(()) => Ok(SystemRevealResult {
            fallback_used: false,
        }),
        Err(reveal_error) => {
            let parent = target.parent().ok_or_else(|| {
                format!("Image file has no containing folder: {}", target.display())
            })?;
            tauri_plugin_opener::open_path(parent, None::<&str>)
                .map(|()| SystemRevealResult {
                    fallback_used: true,
                })
                .map_err(|fallback_error| {
                    format!(
                        "Exact file reveal failed: {reveal_error}; folder fallback failed: {fallback_error}"
                    )
                })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_file_inside_workspace_root() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("cover.png");
        std::fs::write(&file, b"png").unwrap();

        let result = canonical_workspace_file(
            &file.to_string_lossy(),
            Some(&dir.path().to_string_lossy()),
            &WorkspaceEnv::Local,
        )
        .unwrap();

        assert_eq!(result, std::fs::canonicalize(&file).unwrap());
    }

    #[test]
    fn rejects_file_outside_workspace_root() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let file = outside.path().join("cover.png");
        std::fs::write(&file, b"png").unwrap();

        let err = canonical_workspace_file(
            &file.to_string_lossy(),
            Some(&root.path().to_string_lossy()),
            &WorkspaceEnv::Local,
        )
        .unwrap_err();

        assert!(err.contains("outside the active workspace"));
    }

    #[test]
    fn rejects_directories() {
        let dir = tempfile::tempdir().unwrap();

        let err = canonical_workspace_file(
            &dir.path().to_string_lossy(),
            Some(&dir.path().to_string_lossy()),
            &WorkspaceEnv::Local,
        )
        .unwrap_err();

        assert_eq!(err, "Expected an image file, found dir");
    }

    #[test]
    fn rejects_missing_workspace_root() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("cover.png");
        std::fs::write(&file, b"png").unwrap();

        let err = canonical_workspace_file(&file.to_string_lossy(), None, &WorkspaceEnv::Local)
            .unwrap_err();

        assert_eq!(err, "No trusted workspace root is available.");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_that_escapes_workspace_root() {
        use std::os::unix::fs::symlink;

        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let outside_file = outside.path().join("cover.png");
        std::fs::write(&outside_file, b"png").unwrap();
        let link = root.path().join("link.png");
        symlink(&outside_file, &link).unwrap();

        let err = canonical_workspace_file(
            &link.to_string_lossy(),
            Some(&root.path().to_string_lossy()),
            &WorkspaceEnv::Local,
        )
        .unwrap_err();

        assert!(err.contains("outside the active workspace"));
    }
}
