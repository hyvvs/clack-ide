//! Explicit Windows-only TF2 native acceptance: temporary owned workspace/Git.
//! Run: cargo run --manifest-path src-tauri/Cargo.toml --locked
//!          --example tf_operations_native_acceptance
//! This headless example grants test approval through the isolated Rust helper;
//! it does NOT exercise or bypass the production Tauri OS-native modal path.

#[cfg(windows)]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    use sha2::{Digest, Sha256};
    use std::fs;
    use std::process::Command;
    use terax_lib::modules::tf_operations::{
        approve, cancel, execute, prepare, TfOperation, TfOperationRequest, TfOperationState,
    };
    use terax_lib::modules::workspace::WorkspaceRegistry;

    let root_dir = tempfile::tempdir()?;
    let root = root_dir.path().to_string_lossy().to_string();
    let registry = WorkspaceRegistry::default();
    let unregistered = WorkspaceRegistry::default();
    let state = TfOperationState::default();
    let request = |op: TfOperation| TfOperationRequest {
        operation: op,
        actor: "native-acceptance".into(),
        workspace_root: root.clone(),
        cwd: root.clone(),
        path: None,
        destination: None,
        content: None,
        expected_sha256: None,
        old_text: None,
        new_text: None,
        pattern: None,
        query: None,
        ref_name: None,
        paths: None,
        offset: None,
        limit: None,
        depth: None,
        timeout_ms: None,
    };
    let run = |req: TfOperationRequest, write: bool| -> Result<_, String> {
        let prepared = prepare(req, &registry, &state)?;
        assert_eq!(prepared.workspace_root, root);
        assert_eq!(prepared.cwd, root);
        assert_eq!(prepared.expires_in_secs, 60);
        if write {
            approve(&prepared.token, &state)?;
        }
        let receipt = execute(&prepared.token, &registry, &state)?;
        assert_eq!(receipt.tool_id, "tf.operation.v1");
        assert!(
            execute(&prepared.token, &registry, &state).is_err(),
            "replay"
        );
        Ok(receipt)
    };
    let mut noauth = request(TfOperation::FileRead);
    noauth.path = Some("note.txt".into());
    assert!(
        prepare(noauth, &unregistered, &state).is_err(),
        "unregistered root must deny"
    );
    registry.authorize(root_dir.path())?;
    let mut secret = request(TfOperation::FileRead);
    secret.path = Some(".env".into());
    assert!(
        prepare(secret, &registry, &state).is_err(),
        "secret path denied"
    );
    let mut escape = request(TfOperation::FileRead);
    escape.path = Some("..\\foreign.txt".into());
    assert!(
        prepare(escape, &registry, &state).is_err(),
        "parent traversal denied"
    );

    let mut create = request(TfOperation::FileCreate);
    create.path = Some("note.txt".into());
    create.content = Some("first text".into());
    let unapproved = prepare(create.clone(), &registry, &state)?;
    assert!(
        execute(&unapproved.token, &registry, &state).is_err(),
        "no approval no mutation"
    );
    assert!(!root_dir.path().join("note.txt").exists());
    let first = run(create, true)?;
    assert_eq!(first.effect_state, "Observed");
    assert_eq!(first.before_exists, Some(false));
    assert_eq!(first.after_exists, Some(true));
    assert_eq!(first.bytes_affected, Some("first text".len() as u64));
    assert_eq!(first.requested_resources, ["note.txt"]);
    assert_eq!(first.canonical_paths.len(), 1);
    assert!(first.canonical_paths[0].ends_with("note.txt"));
    assert_ne!(first.requested_resources, first.canonical_paths);
    assert_eq!(first.command_adapter, "native_filesystem");
    assert_eq!(first.executable, None);
    assert!(first.argv.is_empty(), "file adapter must not shell out");
    assert!(!first.command_cwd.is_empty());
    assert!(first.started_at > 1_000_000_000_000);
    assert!(first.ended_at >= first.started_at);
    assert!(first.before_head.is_none() && first.after_head.is_none());
    let mut read = request(TfOperation::FileRead);
    read.path = Some("note.txt".into());
    let seen = run(read, false)?;
    assert_eq!(seen.stdout, "first text");
    assert_eq!(seen.effect_state, "NoEffect");
    assert_eq!(seen.bytes_affected, None);
    assert_eq!(seen.requested_resources, ["note.txt"]);
    let mut stale = request(TfOperation::FileReplace);
    stale.path = Some("note.txt".into());
    stale.expected_sha256 = Some("0".repeat(64));
    stale.content = Some("MUST NOT WRITE".into());
    let denied = run(stale, true)?;
    assert_eq!(denied.effect_state, "NoEffect");
    assert_eq!(denied.terminal, "conflict");
    assert_eq!(denied.bytes_affected, None);
    assert_eq!(
        fs::read_to_string(root_dir.path().join("note.txt"))?,
        "first text"
    );
    let mut patch = request(TfOperation::FilePatch);
    patch.path = Some("note.txt".into());
    patch.expected_sha256 = Some(format!("{:x}", Sha256::digest(b"first text")));
    patch.old_text = Some("first".into());
    patch.new_text = Some("second".into());
    let patched = run(patch, true)?;
    assert_eq!(patched.effect_state, "Observed");
    assert_eq!(patched.bytes_affected, Some("second text".len() as u64));
    assert_eq!(
        fs::read_to_string(root_dir.path().join("note.txt"))?,
        "second text"
    );
    let mut cancelled = request(TfOperation::FileCreate);
    cancelled.path = Some("cancelled.txt".into());
    cancelled.content = Some("never".into());
    let token = prepare(cancelled, &registry, &state)?.token;
    assert!(cancel(&token, &state)?);
    assert!(execute(&token, &registry, &state).is_err());
    assert!(!root_dir.path().join("cancelled.txt").exists());

    let git = r"C:\Program Files\Git\cmd\git.exe";
    if !std::path::Path::new(git).is_file() {
        println!("TF2 native acceptance PARTIAL PASS: isolated file authorization, writes, readback, stale, cancel. Pinned Git missing; repo portion UNSUPPORTED.");
        return Ok(());
    }
    let status = Command::new(git)
        .args(["init", "-b", "main", "--quiet"])
        .current_dir(root_dir.path())
        .status()?;
    assert!(status.success(), "temporary Git init failed");
    fs::write(root_dir.path().join("tracked.txt"), "base\n")?;
    let status = Command::new(git)
        .args([
            "-c",
            "user.name=TF Test",
            "-c",
            "user.email=tf@example.invalid",
            "-c",
            "core.hooksPath=NUL",
            "add",
            "tracked.txt",
        ])
        .current_dir(root_dir.path())
        .status()?;
    assert!(status.success());
    let status = Command::new(git)
        .args([
            "-c",
            "user.name=TF Test",
            "-c",
            "user.email=tf@example.invalid",
            "-c",
            "core.hooksPath=NUL",
            "commit",
            "--quiet",
            "-m",
            "TF2 temporary fixture",
        ])
        .current_dir(root_dir.path())
        .status()?;
    assert!(status.success(), "fixture commit failed");
    let status = run(request(TfOperation::RepoStatus), false)?;
    assert_eq!(
        status.terminal, "completed",
        "repo_status stderr={}, stdout={}, exitCode={:?}, pid={:?}",
        status.stderr, status.stdout, status.exit_code, status.pid
    );
    assert_eq!(status.command_adapter, "pinned_git");
    assert!(status
        .executable
        .as_deref()
        .is_some_and(|s| s.to_ascii_lowercase().ends_with("git.exe")));
    assert!(status.argv.iter().any(|arg| arg == "status"));
    assert!(status.argv.iter().any(|arg| arg == "--git-dir"));
    assert!(!status.command_cwd.is_empty());
    assert!(status.started_at > 1_000_000_000_000 && status.ended_at >= status.started_at);
    assert_eq!(status.before_branch.as_deref(), Some("main"));
    assert_eq!(status.after_branch.as_deref(), Some("main"));
    assert_eq!(status.before_head, status.after_head);
    assert!(status.before_head.is_some());
    assert_eq!(status.before_changed_paths, Some(Vec::new()));
    assert_eq!(status.after_staged_paths, Some(Vec::new()));
    let head = run(request(TfOperation::RepoHead), false)?;
    assert_eq!(head.terminal, "completed");
    assert!(!head.stdout.is_empty());
    assert!(
        prepare(request(TfOperation::RepoDiff), &registry, &state).is_err(),
        "unscoped diff can disclose secrets"
    );
    let mut scoped = request(TfOperation::RepoDiff);
    scoped.paths = Some(vec!["tracked.txt".into()]);
    fs::write(root_dir.path().join("tracked.txt"), "base\nchanged\n")?;
    let diff = run(scoped, false)?;
    assert_eq!(diff.terminal, "completed");
    assert!(diff.stdout.contains("changed"));
    assert!(diff.argv.iter().any(|arg| arg == "--"));
    assert_eq!(diff.requested_resources, ["tracked.txt"]);
    assert_ne!(diff.requested_resources, diff.canonical_paths);
    assert_eq!(diff.bytes_affected, None);
    assert_eq!(
        diff.before_changed_paths.as_deref(),
        Some(["tracked.txt".to_owned()].as_slice())
    );
    assert_eq!(
        diff.after_changed_paths.as_deref(),
        Some(["tracked.txt".to_owned()].as_slice())
    );
    let mut stage = request(TfOperation::RepoStage);
    stage.paths = Some(vec!["tracked.txt".into()]);
    let staged = run(stage, true)?;
    assert_eq!(staged.terminal, "completed");
    assert_eq!(staged.requested_resources, ["tracked.txt"]);
    assert_eq!(staged.bytes_affected, None);
    assert_eq!(
        staged.effect_state, "Observed",
        "stage index and diff readback"
    );
    assert!(staged.before_sha256.is_some() && staged.after_sha256.is_some());
    assert_eq!(staged.before_staged_paths, Some(Vec::new()));
    assert_eq!(
        staged.after_staged_paths.as_deref(),
        Some(["tracked.txt".to_owned()].as_slice())
    );
    let mut unstage = request(TfOperation::RepoUnstage);
    unstage.paths = Some(vec!["tracked.txt".into()]);
    let unstaged = run(unstage, true)?;
    assert_eq!(unstaged.terminal, "completed");
    assert_eq!(
        unstaged.effect_state, "Observed",
        "unstage index and diff readback"
    );
    assert_eq!(unstaged.after_staged_paths, Some(Vec::new()));
    let mut create_branch = request(TfOperation::RepoCreateBranch);
    create_branch.ref_name = Some("tf2-verified".into());
    let created_branch = run(create_branch.clone(), true)?;
    assert_eq!(created_branch.command_adapter, "pinned_git");
    assert_eq!(created_branch.terminal, "completed");
    assert_eq!(created_branch.effect_state, "Observed");
    assert_eq!(created_branch.ref_name.as_deref(), Some("tf2-verified"));
    assert_eq!(created_branch.before_ref_exists, Some(false));
    assert_eq!(created_branch.after_ref_exists, Some(true));
    assert_eq!(created_branch.after_ref_oid, created_branch.before_head);
    assert_eq!(created_branch.before_head, created_branch.after_head);
    assert_eq!(created_branch.before_branch, created_branch.after_branch);
    assert!(!created_branch.affected_resources.is_empty());
    // A failed duplicate branch command may have spawned, but it cannot
    // claim a newly observed mutation without independently changed ref state.
    let duplicate = run(create_branch, true)?;
    assert_ne!(duplicate.terminal, "completed");
    assert_ne!(duplicate.effect_state, "Observed");
    assert_eq!(duplicate.before_ref_exists, Some(true));
    assert_eq!(duplicate.after_ref_exists, Some(true));
    let mut switch_branch = request(TfOperation::RepoSwitchBranch);
    switch_branch.ref_name = Some("tf2-verified".into());
    let switched = run(switch_branch.clone(), true)?;
    assert_eq!(
        switched.terminal, "completed",
        "switch stderr={}",
        switched.stderr
    );
    assert_eq!(
        switched.effect_state, "Unknown",
        "branch/HEAD/ref proof cannot verify the full switched worktree"
    );
    assert_eq!(switched.before_branch.as_deref(), Some("main"));
    assert_eq!(switched.after_branch.as_deref(), Some("tf2-verified"));
    assert_eq!(switched.after_head, switched.after_ref_oid);
    assert!(switched.uncertainty.contains("worktree"));
    assert_eq!(switched.retry, "UNKNOWN");
    assert!(!switched.auto_retry);
    let already_current = run(switch_branch, true)?;
    assert_ne!(
        already_current.effect_state, "Observed",
        "a no-op branch switch must not claim observed mutation"
    );
    assert_eq!(already_current.before_branch, already_current.after_branch);
    // The build adapter receives a deliberately trivial, temporary trusted
    // package, exercises the fixed native npm command and reports Unknown
    // effect even when the process exits successfully (project scripts are
    // not a filesystem/network sandbox).
    fs::write(
        root_dir.path().join("package.json"),
        r#"{"name":"tf2-native-acceptance","version":"0.0.0","private":true,"scripts":{"check-types":"node -e \"process.stdout.write('TF2-BUILD-ACCEPT')\""}} "#,
    )?;
    let mut typecheck = request(TfOperation::BuildTypecheck);
    typecheck.timeout_ms = Some(30_000);
    let built = run(typecheck, true)?;
    assert_eq!(
        built.terminal, "completed",
        "fixed npm build stderr={}",
        built.stderr
    );
    assert_eq!(
        built.exit_code,
        Some(0),
        "fixed npm test adapter must exit0"
    );
    assert!(
        built.stdout.contains("TF2-BUILD-ACCEPT"),
        "fixed npm script output missing: {}",
        built.stdout
    );
    assert_eq!(
        built.effect_state, "Unknown",
        "build execution cannot prove absence or shape of arbitrary script effects"
    );
    assert_eq!(built.retry, "UNKNOWN");
    assert!(!built.auto_retry);
    assert_eq!(built.bytes_affected, None);
    assert!(built.pid.is_some());
    assert_eq!(built.command_adapter, "pinned_npm");
    assert!(built
        .executable
        .as_deref()
        .is_some_and(|s| s.to_ascii_lowercase().ends_with("npm.cmd")));
    assert_eq!(built.argv, ["run", "check-types", "--ignore-scripts"]);
    assert!(!built.command_cwd.is_empty());
    assert!(built.started_at > 1_000_000_000_000 && built.ended_at >= built.started_at);
    assert!(built.before_head.is_none() && built.after_head.is_none());
    let mut dangerous = request(TfOperation::RepoDiff);
    dangerous.paths = Some(vec![".env".into()]);
    assert!(prepare(dangerous, &registry, &state).is_err());
    fs::write(root_dir.path().join(".git/commondir"), "..\\outside")?;
    assert!(
        prepare(request(TfOperation::RepoStatus), &registry, &state).is_err(),
        "linked Git common config must deny"
    );
    println!("TF2 native isolated acceptance PASS: deny, registry bind, one-shot, OS-approval required, file read/write/post-hash/stale/cancel, Git scoped diff/stage/unstage with independent verification, fixed approved npm build adapter (Unknown effects/no auto retry); actual production OS modal and cross-platform sandbox remain unverified/unsupported.");
    Ok(())
}

#[cfg(not(windows))]
fn main() {
    println!("UNSUPPORTED: TF2 native acceptance requires Windows Job Objects");
}
