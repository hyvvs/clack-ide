mod common;

use common::{git_available, GitRepoFixture};
use std::fs;
use std::path::Path;
use tempfile::TempDir;
use terax_lib::modules::git::agent_worktree;
use terax_lib::modules::git::types::AgentWorktreePatch;

fn seed() -> GitRepoFixture {
    assert!(
        git_available(),
        "real-world acceptance requires Git; do not silently skip"
    );
    let fx = GitRepoFixture::new();
    fx.write_file("seed.txt", "Original user file\n");
    fx.run_git(&["add", "."]);
    fx.run_git(&["commit", "-qm", "acceptance base"]);
    fx
}

fn capture(
    fx: &GitRepoFixture,
    cache: &Path,
    id: &str,
    text: &str,
) -> (String, AgentWorktreePatch) {
    let checkout =
        agent_worktree::create(&fx.registry, &fx.repo_str(), id, cache, &fx.workspace).unwrap();
    fs::write(
        Path::new(&checkout.checkout_root).join("README.acceptance.md"),
        text,
    )
    .unwrap();
    assert!(!fx.repo_path.join("README.acceptance.md").exists());
    let patch = agent_worktree::capture_and_remove(
        &fx.registry,
        &fx.repo_str(),
        id,
        &checkout.base_sha,
        cache,
        &fx.workspace,
    )
    .unwrap();
    assert_eq!(patch.changed_paths, ["README.acceptance.md"]);
    assert!(!Path::new(&checkout.checkout_root).exists());
    (checkout.base_sha, patch)
}

#[test]
fn isolated_creation_review_correction_and_apply_match_real_disk() {
    let fx = seed();
    let cache = TempDir::new().unwrap();
    let (_, flawed) = capture(
        &fx,
        cache.path(),
        "pt-flawed",
        "# Acceptance\nTimeout: 900\n",
    );
    assert!(flawed.patch.contains("+Timeout: 900"));
    let (base, corrected) = capture(
        &fx,
        cache.path(),
        "pt-corrected",
        "# Acceptance\nTimeout: 750\n",
    );
    assert!(corrected.patch.contains("+Timeout: 750"));
    agent_worktree::apply_patch(
        &fx.registry,
        &fx.repo_str(),
        &base,
        &corrected.patch,
        &fx.workspace,
    )
    .unwrap();
    assert_eq!(
        fs::read_to_string(fx.repo_path.join("README.acceptance.md")).unwrap(),
        "# Acceptance\nTimeout: 750\n"
    );
    assert_eq!(
        fs::read_to_string(fx.repo_path.join("seed.txt")).unwrap(),
        "Original user file\n"
    );
    assert!(agent_worktree::apply_patch(
        &fx.registry,
        &fx.repo_str(),
        &base,
        &corrected.patch,
        &fx.workspace
    )
    .is_err());
}

#[test]
fn user_edits_and_changed_head_block_apply_without_losing_captured_patch() {
    let fx = seed();
    let cache = TempDir::new().unwrap();
    let (base, patch) = capture(&fx, cache.path(), "pt-conflict", "# Agent version\n");
    fx.write_file("README.acceptance.md", "# User version\n");
    let error = agent_worktree::apply_patch(
        &fx.registry,
        &fx.repo_str(),
        &base,
        &patch.patch,
        &fx.workspace,
    )
    .unwrap_err();
    assert!(error.to_string().contains("uncommitted"));
    assert_eq!(
        fs::read_to_string(fx.repo_path.join("README.acceptance.md")).unwrap(),
        "# User version\n"
    );
    fx.run_git(&["add", "."]);
    fx.run_git(&["commit", "-qm", "user edit"]);
    let error = agent_worktree::apply_patch(
        &fx.registry,
        &fx.repo_str(),
        &base,
        &patch.patch,
        &fx.workspace,
    )
    .unwrap_err();
    assert!(error.to_string().contains("stale"));
    assert!(patch.patch.contains("+# Agent version"));
    assert_eq!(
        fs::read_to_string(fx.repo_path.join("README.acceptance.md")).unwrap(),
        "# User version\n"
    );
}

#[test]
fn independent_workers_are_isolated_and_dirty_workspace_is_not_stashed() {
    let fx = seed();
    let cache = TempDir::new().unwrap();
    let a = agent_worktree::create(
        &fx.registry,
        &fx.repo_str(),
        "pt-worker-a",
        cache.path(),
        &fx.workspace,
    )
    .unwrap();
    let b = agent_worktree::create(
        &fx.registry,
        &fx.repo_str(),
        "pt-worker-b",
        cache.path(),
        &fx.workspace,
    )
    .unwrap();
    assert_ne!(a.checkout_root, b.checkout_root);
    fs::write(Path::new(&a.checkout_root).join("worker-a.txt"), "A").unwrap();
    assert!(!Path::new(&b.checkout_root).join("worker-a.txt").exists());
    assert!(!fx.repo_path.join("worker-a.txt").exists());
    agent_worktree::remove(
        &fx.registry,
        &fx.repo_str(),
        "pt-worker-a",
        cache.path(),
        &fx.workspace,
    )
    .unwrap();
    agent_worktree::remove(
        &fx.registry,
        &fx.repo_str(),
        "pt-worker-b",
        cache.path(),
        &fx.workspace,
    )
    .unwrap();
    fx.write_file("seed.txt", "Uncommitted user work\n");
    assert!(agent_worktree::create(
        &fx.registry,
        &fx.repo_str(),
        "pt-dirty",
        cache.path(),
        &fx.workspace
    )
    .is_err());
    assert_eq!(
        fs::read_to_string(fx.repo_path.join("seed.txt")).unwrap(),
        "Uncommitted user work\n"
    );
}
