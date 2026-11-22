//! Isolated, manually invoked native TF command acceptance. Uses only a temporary
//! standalone Git repository; never touches Clack production AppData or user repos.
//! Run: cargo run --example tf_command_native_acceptance

#[cfg(windows)]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    use std::process::Command;
    use terax_lib::modules::tf_command::{
        approve, cancel, execute, prepare, TfCommandAction, TfCommandRequest, TfCommandState,
    };
    use terax_lib::modules::workspace::WorkspaceRegistry;

    let directory = tempfile::tempdir()?;
    let cwd = directory.path().to_string_lossy().into_owned();
    let registry = WorkspaceRegistry::default();
    let state = TfCommandState::default();
    let git = r"C:\Program Files\Git\cmd\git.exe";
    let read_request = || TfCommandRequest {
        action: TfCommandAction::ReadStatus,
        executable: git.into(),
        args: vec![
            "status".into(),
            "--short".into(),
            "--untracked-files=no".into(),
        ],
        actor: "acceptance".into(),
        cwd: cwd.clone(),
        workspace_root: cwd.clone(),
    };
    let write_request = || TfCommandRequest {
        action: TfCommandAction::WriteMarker,
        executable: git.into(),
        args: vec![
            "config".into(),
            "--local".into(),
            "tf.command.marker".into(),
            "approved".into(),
        ],
        actor: "acceptance".into(),
        cwd: cwd.clone(),
        workspace_root: cwd.clone(),
    };
    let denied = prepare(read_request(), &registry, &state);
    assert!(
        denied.is_err(),
        "unregistered workspace must deny before spawn"
    );

    let initialized = Command::new(git)
        .arg("init")
        .arg("--quiet")
        .arg(directory.path())
        .status()?;
    assert!(initialized.success(), "temporary git init failed");
    registry.authorize(directory.path())?;

    let unrelated = tempfile::tempdir()?;
    let unrelated_root = unrelated.path().to_string_lossy().into_owned();
    registry.authorize(unrelated.path())?;
    let mut wrong_root = read_request();
    wrong_root.workspace_root = unrelated_root.clone();
    assert!(
        prepare(wrong_root, &registry, &state).is_err(),
        "registry-authorized but wrong selected workspace must deny"
    );
    let broader = tempfile::tempdir()?;
    registry.authorize(broader.path())?;
    let mut wrong_root = read_request();
    wrong_root.workspace_root = broader.path().to_string_lossy().into_owned();
    assert!(
        prepare(wrong_root, &registry, &state).is_err(),
        "wrong root must deny"
    );

    let read = prepare(read_request(), &registry, &state)?;
    assert_eq!(
        std::path::PathBuf::from(&read.workspace_root),
        std::fs::canonicalize(directory.path())?
    );
    assert!(!read.requires_approval);
    let result = execute(&read.token, &registry, &state)?;
    assert_eq!(result.terminal, "completed");
    assert_eq!(result.exit_code, Some(0));
    assert_eq!(result.side_effect, "read_only");
    assert!(result.pid.is_some());
    assert!(!result.auto_retry);
    assert!(
        execute(&read.token, &registry, &state).is_err(),
        "read token replay"
    );

    let write = prepare(write_request(), &registry, &state)?;
    assert!(
        execute(&write.token, &registry, &state).is_err(),
        "unapproved write must deny before spawn"
    );
    assert!(
        approve(&write.token, &state).is_err(),
        "denied write token must be consumed"
    );

    let write = prepare(write_request(), &registry, &state)?;
    approve(&write.token, &state)?;
    let result = execute(&write.token, &registry, &state)?;
    assert_eq!(result.terminal, "completed");
    assert_eq!(result.exit_code, Some(0));
    assert_eq!(result.side_effect, "write_reported_success");
    assert!(!result.auto_retry);
    let value = Command::new(git)
        .args([
            "-C",
            &cwd,
            "config",
            "--local",
            "--get",
            "tf.command.marker",
        ])
        .output()?;
    assert_eq!(String::from_utf8_lossy(&value.stdout).trim(), "approved");

    let cancelled = prepare(read_request(), &registry, &state)?;
    assert!(cancel(&cancelled.token, &state)?);
    assert!(
        execute(&cancelled.token, &registry, &state).is_err(),
        "cancelled token must be consumed"
    );
    println!("TF native isolated acceptance PASS: zero-spawn denied, read, approved write/readback, cancellation, one-shot; timeout/ambiguous effect are unit-level only");
    Ok(())
}

#[cfg(not(windows))]
fn main() {
    println!("UNSUPPORTED: Windows Job Object native command acceptance only");
}
