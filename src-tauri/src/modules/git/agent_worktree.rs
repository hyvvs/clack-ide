use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use tempfile::NamedTempFile;

use crate::modules::git::errors::{GitError, Result};
use crate::modules::git::process::{
    ensure_git_available, ensure_success, git_stdout_line_opt, run_git,
};
use crate::modules::git::types::{AgentWorktreeInfo, AgentWorktreePatch, DEFAULT_TIMEOUT_SECS};
use crate::modules::git::utils::{authorized_repo_root, display_path};
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

const WORKTREE_DIR: &str = "agent-worktrees";

pub fn create(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    task_id: &str,
    cache_root: &Path,
    workspace: &WorkspaceEnv,
) -> Result<AgentWorktreeInfo> {
    ensure_local_workspace(workspace)?;
    validate_task_id(task_id)?;
    let repo = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(workspace)?;
    ensure_clean(&repo.git_path, workspace)?;

    let base_sha = git_stdout_line_opt(workspace, &repo.git_path, ["rev-parse", "HEAD"])?
        .ok_or_else(|| GitError::command("failed to resolve worktree base", "HEAD is missing"))?;
    let checkout = checkout_path(cache_root, task_id)?;
    if checkout.exists() {
        return Err(GitError::command(
            "agent worktree already exists",
            display_path(&checkout),
        ));
    }
    let parent = checkout
        .parent()
        .ok_or_else(|| GitError::command("invalid agent worktree path", task_id))?;
    fs::create_dir_all(parent)?;

    let args = vec![
        OsString::from("worktree"),
        OsString::from("add"),
        OsString::from("--detach"),
        checkout.as_os_str().to_os_string(),
        OsString::from(&base_sha),
    ];
    let output = run_git(workspace, Some(&repo.git_path), args, DEFAULT_TIMEOUT_SECS)?;
    ensure_success(&output, "failed to create isolated agent worktree")?;
    let canonical = fs::canonicalize(&checkout)?;
    registry.authorize(&canonical)?;

    Ok(AgentWorktreeInfo {
        checkout_root: display_path(&canonical),
        base_sha,
    })
}

pub fn capture_and_remove(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    task_id: &str,
    base_sha: &str,
    cache_root: &Path,
    workspace: &WorkspaceEnv,
) -> Result<AgentWorktreePatch> {
    ensure_local_workspace(workspace)?;
    validate_task_id(task_id)?;
    validate_sha(base_sha)?;
    let repo = authorized_repo_root(registry, repo_root, workspace)?;
    let checkout = checkout_path(cache_root, task_id)?;
    let canonical = fs::canonicalize(&checkout).map_err(GitError::Io)?;
    let managed_root = fs::canonicalize(worktree_root(cache_root))?;
    if !canonical.starts_with(&managed_root) {
        return Err(GitError::PathOutsideWorkspace(canonical));
    }

    let add = run_git(
        workspace,
        Some(&display_path(&canonical)),
        ["add", "-A"],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&add, "failed to stage isolated agent changes")?;
    let diff = run_git(
        workspace,
        Some(&display_path(&canonical)),
        [
            "diff",
            "--cached",
            "--binary",
            "--full-index",
            "--no-ext-diff",
            base_sha,
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&diff, "failed to capture isolated agent changes")?;
    if diff.truncated {
        return Err(GitError::command(
            "isolated agent patch is too large",
            "the worktree was preserved for manual recovery",
        ));
    }
    let patch = String::from_utf8_lossy(&diff.stdout).into_owned();
    let names = run_git(
        workspace,
        Some(&display_path(&canonical)),
        ["diff", "--cached", "--name-only", base_sha],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&names, "failed to list isolated agent changes")?;
    let changed_paths = String::from_utf8_lossy(&names.stdout)
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(str::to_string)
        .collect();

    remove_checkout(&repo.git_path, &canonical, workspace)?;
    Ok(AgentWorktreePatch {
        patch,
        changed_paths,
    })
}

pub fn remove(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    task_id: &str,
    cache_root: &Path,
    workspace: &WorkspaceEnv,
) -> Result<()> {
    ensure_local_workspace(workspace)?;
    validate_task_id(task_id)?;
    let repo = authorized_repo_root(registry, repo_root, workspace)?;
    let checkout = checkout_path(cache_root, task_id)?;
    if !checkout.exists() {
        return Ok(());
    }
    let canonical = fs::canonicalize(&checkout)?;
    let managed_root = fs::canonicalize(worktree_root(cache_root))?;
    if !canonical.starts_with(&managed_root) {
        return Err(GitError::PathOutsideWorkspace(canonical));
    }
    remove_checkout(&repo.git_path, &canonical, workspace)
}

pub fn apply_patch(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    base_sha: &str,
    patch: &str,
    workspace: &WorkspaceEnv,
) -> Result<()> {
    ensure_local_workspace(workspace)?;
    validate_sha(base_sha)?;
    if patch.trim().is_empty() {
        return Err(GitError::command(
            "agent patch is empty",
            "nothing to apply",
        ));
    }
    let repo = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_clean(&repo.git_path, workspace)?;
    let current = git_stdout_line_opt(workspace, &repo.git_path, ["rev-parse", "HEAD"])?
        .ok_or_else(|| GitError::command("failed to resolve current HEAD", "HEAD is missing"))?;
    if current != base_sha {
        return Err(GitError::command(
            "agent patch base is stale",
            "the workspace HEAD changed; review and integrate the patch manually",
        ));
    }

    let mut file = NamedTempFile::new()?;
    std::io::Write::write_all(&mut file, patch.as_bytes())?;
    let patch_path = file.path().as_os_str().to_os_string();
    let check = run_git(
        workspace,
        Some(&repo.git_path),
        [
            OsString::from("apply"),
            OsString::from("--check"),
            OsString::from("--whitespace=nowarn"),
            patch_path.clone(),
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&check, "agent patch conflicts with the workspace")?;
    let apply = run_git(
        workspace,
        Some(&repo.git_path),
        [
            OsString::from("apply"),
            OsString::from("--whitespace=nowarn"),
            patch_path,
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&apply, "failed to apply agent patch")
}

fn ensure_clean(repo_root: &str, workspace: &WorkspaceEnv) -> Result<()> {
    let output = run_git(
        workspace,
        Some(repo_root),
        ["status", "--porcelain", "--untracked-files=normal"],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "failed to inspect workspace state")?;
    if !output.stdout.is_empty() {
        return Err(GitError::command(
            "workspace has uncommitted changes",
            "commit or stash them before using an isolated agent worktree",
        ));
    }
    Ok(())
}

fn remove_checkout(repo_root: &str, checkout: &Path, workspace: &WorkspaceEnv) -> Result<()> {
    let output = run_git(
        workspace,
        Some(repo_root),
        [
            OsString::from("worktree"),
            OsString::from("remove"),
            OsString::from("--force"),
            checkout.as_os_str().to_os_string(),
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "failed to remove isolated agent worktree")?;
    let prune = run_git(
        workspace,
        Some(repo_root),
        ["worktree", "prune"],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&prune, "failed to prune isolated agent worktree metadata")
}

fn checkout_path(cache_root: &Path, task_id: &str) -> Result<PathBuf> {
    validate_task_id(task_id)?;
    Ok(worktree_root(cache_root).join(task_id))
}

fn worktree_root(cache_root: &Path) -> PathBuf {
    cache_root.join(WORKTREE_DIR)
}

fn validate_task_id(task_id: &str) -> Result<()> {
    if task_id.is_empty()
        || task_id.len() > 96
        || !task_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(GitError::InvalidPath(task_id.to_string()));
    }
    Ok(())
}

fn validate_sha(sha: &str) -> Result<()> {
    if !(7..=64).contains(&sha.len()) || !sha.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(GitError::InvalidPath(sha.to_string()));
    }
    Ok(())
}

fn ensure_local_workspace(workspace: &WorkspaceEnv) -> Result<()> {
    if workspace.is_wsl() {
        return Err(GitError::command(
            "isolated agent worktrees are unavailable for WSL workspaces",
            "use serialized shared-workspace edits instead",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        apply_patch, capture_and_remove, checkout_path, create, validate_sha, validate_task_id,
    };
    use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    #[test]
    fn accepts_generated_peer_task_ids() {
        assert!(validate_task_id("pt-m7f2-abc123").is_ok());
        assert!(validate_sha("0123456789abcdef0123456789abcdef01234567").is_ok());
    }

    #[test]
    fn rejects_paths_and_shell_metacharacters() {
        assert!(validate_task_id("../escape").is_err());
        assert!(validate_task_id("task;rm").is_err());
        assert!(validate_sha("HEAD").is_err());
    }

    #[test]
    fn derives_checkout_only_under_managed_root() {
        let root = Path::new("/cache");
        let checkout = checkout_path(root, "pt-safe").unwrap();
        assert_eq!(checkout, root.join("agent-worktrees").join("pt-safe"));
    }

    #[test]
    fn captures_and_applies_an_isolated_change_set() {
        let repo = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        git(repo.path(), &["init"]);
        git(repo.path(), &["config", "user.email", "clack@example.test"]);
        git(repo.path(), &["config", "user.name", "Clack Test"]);
        fs::write(repo.path().join("tracked.txt"), "before\n").unwrap();
        git(repo.path(), &["add", "tracked.txt"]);
        git(repo.path(), &["commit", "-m", "initial"]);

        let registry = WorkspaceRegistry::default();
        registry.authorize(repo.path()).unwrap();
        let repo_root = repo.path().to_string_lossy();
        let created = create(
            &registry,
            &repo_root,
            "pt-roundtrip",
            cache.path(),
            &WorkspaceEnv::Local,
        )
        .unwrap();
        fs::write(
            Path::new(&created.checkout_root).join("tracked.txt"),
            "after\n",
        )
        .unwrap();
        fs::write(Path::new(&created.checkout_root).join("new.txt"), "new\n").unwrap();

        let captured = capture_and_remove(
            &registry,
            &repo_root,
            "pt-roundtrip",
            &created.base_sha,
            cache.path(),
            &WorkspaceEnv::Local,
        )
        .unwrap();

        assert!(captured.patch.contains("tracked.txt"));
        assert!(captured.patch.contains("new.txt"));
        assert_eq!(captured.changed_paths, vec!["new.txt", "tracked.txt"]);
        assert!(!Path::new(&created.checkout_root).exists());

        apply_patch(
            &registry,
            &repo_root,
            &created.base_sha,
            &captured.patch,
            &WorkspaceEnv::Local,
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(repo.path().join("tracked.txt"))
                .unwrap()
                .replace("\r\n", "\n"),
            "after\n"
        );
        assert_eq!(
            fs::read_to_string(repo.path().join("new.txt"))
                .unwrap()
                .replace("\r\n", "\n"),
            "new\n"
        );
    }

    fn git(cwd: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
