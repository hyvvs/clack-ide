//! Opt-in, Windows-only Tool Fabric command vertical. Native policy is authoritative:
//! no renderer-controlled binary, argument vector, environment or write authorization.
//! This is process ownership and command narrowing, NOT a filesystem/network sandbox.

use crate::modules::workspace::{authorize_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const TOKEN_LIFETIME: Duration = Duration::from_secs(60);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(5);
const OUTPUT_CAP: usize = 8192;
#[cfg(windows)]
const GIT_EXE: &str = r"C:\Program Files\Git\cmd\git.exe";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TfCommandAction {
    ReadStatus,
    WriteMarker,
}

#[derive(Debug, Deserialize)]
pub struct TfCommandRequest {
    pub action: TfCommandAction,
    pub executable: String,
    pub args: Vec<String>,
    pub cwd: String,
    #[serde(rename = "workspaceRoot")]
    pub workspace_root: String,
    pub actor: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TfPrepared {
    pub token: String,
    pub request_id: String,
    pub action: TfCommandAction,
    pub cwd: String,
    pub workspace_root: String,
    pub requires_approval: bool,
    pub expires_in_secs: u64,
    pub isolation: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TfCommandReceipt {
    pub request_id: String,
    pub tool_id: &'static str,
    pub actor: String,
    pub policy_decision: &'static str,
    pub approval_id: Option<String>,
    pub sandbox: &'static str,
    pub requested_resources: Vec<String>,
    pub affected_resources: Vec<String>,
    pub executable: String,
    pub args: Vec<String>,
    pub started_at: u64,
    pub ended_at: u64,
    pub retry: &'static str,
    pub action: TfCommandAction,
    pub terminal: &'static str,
    pub side_effect: &'static str,
    pub uncertainty: &'static str,
    pub auto_retry: bool,
    pub pid: Option<u32>,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub stdout_sha256: String,
    pub stderr_sha256: String,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
    pub isolation: &'static str,
}

struct Pending {
    request_id: String,
    actor: String,
    action: TfCommandAction,
    cwd: PathBuf,
    workspace_root: PathBuf,
    expires: Instant,
    approved: bool,
}

#[derive(Default)]
pub struct TfCommandState {
    pending: Mutex<HashMap<String, Pending>>,
    active: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

fn token() -> Result<String, String> {
    let mut bytes = [0u8; 24];
    getrandom::fill(&mut bytes).map_err(|_| "Secure token generation failed".to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn authorize_scope(
    registry: &WorkspaceRegistry,
    cwd: &str,
    workspace_root: &str,
) -> Result<(PathBuf, PathBuf), String> {
    if workspace_root.trim().is_empty() {
        return Err("Explicit selected workspace root required".into());
    }
    let root = std::fs::canonicalize(workspace_root)
        .map_err(|_| "Selected workspace root is inaccessible")?;
    if !root.is_dir() || !registry.is_authorized(&root) {
        return Err("Selected workspace root is not authorized".into());
    }
    if cwd.trim().is_empty() {
        return Err("Explicit workspace cwd required".into());
    }
    let path = authorize_spawn_cwd(registry, Some(cwd), &WorkspaceEnv::Local)?
        .ok_or("Explicit workspace cwd required")?;
    if !path.starts_with(&root) {
        return Err("Command cwd is outside selected workspace root".into());
    }
    // This first vertical deliberately supports only conventional standalone repos.
    // Reject worktrees, gitfile redirections and symlinked metadata.
    let git = path.join(".git");
    let meta = std::fs::symlink_metadata(&git).map_err(|_| "Standalone Git repository required")?;
    if !meta.file_type().is_dir() || meta.file_type().is_symlink() {
        return Err("Standalone Git repository required".into());
    }
    let canonical_git = std::fs::canonicalize(&git).map_err(|_| "Invalid Git metadata")?;
    if canonical_git != git {
        return Err("Git metadata path must be canonical".into());
    }
    // `git config --local` writes .git/config, not just the working tree.
    // Reject reparse-point/symlink redirections of that individual file:
    // checking only the .git directory would otherwise allow a workspace
    // actor to make the approved benign marker write escape the scope.
    let config = canonical_git.join("config");
    let config_meta = std::fs::symlink_metadata(&config)
        .map_err(|_| "Standalone Git configuration file required")?;
    if !config_meta.file_type().is_file() || config_meta.file_type().is_symlink() {
        return Err("Git config must be a regular non-symlink file".into());
    }
    let canonical_config =
        std::fs::canonicalize(&config).map_err(|_| "Git config file could not be canonicalized")?;
    if canonical_config.parent() != Some(canonical_git.as_path()) {
        return Err("Git config redirects outside the selected repository".into());
    }
    Ok((path, root))
}

fn is_write(action: TfCommandAction) -> bool {
    action == TfCommandAction::WriteMarker
}

#[cfg(windows)]
fn validate_command(request: &TfCommandRequest) -> Result<(), String> {
    let executable = std::fs::canonicalize(&request.executable)
        .map_err(|_| "Unknown executable: denied without spawn")?;
    let pinned = std::fs::canonicalize(GIT_EXE)
        .map_err(|_| "UNSUPPORTED: pinned Git executable unavailable")?;
    if executable != pinned {
        return Err("Executable is not native allowlisted".into());
    }
    let allowed: &[&str] = match request.action {
        TfCommandAction::ReadStatus => &["status", "--short", "--untracked-files=no"],
        TfCommandAction::WriteMarker => &["config", "--local", "tf.command.marker", "approved"],
    };
    if request.args.iter().map(String::as_str).collect::<Vec<_>>() != allowed {
        return Err("Arguments are not native allowlisted".into());
    }
    if request.actor.is_empty()
        || request.actor.len() > 128
        || !request
            .actor
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_:".contains(&b))
    {
        return Err("Invalid actor label".into());
    }
    Ok(())
}

pub fn prepare(
    request: TfCommandRequest,
    registry: &WorkspaceRegistry,
    state: &TfCommandState,
) -> Result<TfPrepared, String> {
    #[cfg(not(windows))]
    return Err("UNSUPPORTED: bounded native command requires Windows Job Objects".into());
    #[cfg(windows)]
    {
        validate_command(&request)?;
        let (cwd, workspace_root) =
            authorize_scope(registry, &request.cwd, &request.workspace_root)?;
        if !Path::new(GIT_EXE).is_file() {
            return Err("UNSUPPORTED: pinned Git executable unavailable".into());
        }
        let id = token()?;
        let request_id = token()?;
        let mut pending = state
            .pending
            .lock()
            .map_err(|_| "Command state unavailable")?;
        pending.retain(|_, p| p.expires > Instant::now());
        if pending.len() >= 64 {
            return Err("Too many prepared commands".into());
        }
        pending.insert(
            id.clone(),
            Pending {
                request_id: request_id.clone(),
                actor: request.actor,
                action: request.action,
                cwd: cwd.clone(),
                workspace_root: workspace_root.clone(),
                expires: Instant::now() + TOKEN_LIFETIME,
                approved: !is_write(request.action),
            },
        );
        Ok(TfPrepared {
            token: id,
            request_id,
            action: request.action,
            cwd: cwd.to_string_lossy().into_owned(),
            workspace_root: workspace_root.to_string_lossy().into_owned(),
            requires_approval: is_write(request.action),
            expires_in_secs: TOKEN_LIFETIME.as_secs(),
            isolation: "unsupported_filesystem_network_isolation",
        })
    }
}

pub fn approve(token: &str, state: &TfCommandState) -> Result<(), String> {
    let mut pending = state
        .pending
        .lock()
        .map_err(|_| "Command state unavailable")?;
    let item = pending
        .get_mut(token)
        .ok_or("Unknown or consumed command token")?;
    if item.expires <= Instant::now() {
        pending.remove(token);
        return Err("Command approval expired".into());
    }
    if !is_write(item.action) {
        return Err("Read operation does not require approval".into());
    }
    item.approved = true;
    Ok(())
}

pub fn cancel(token: &str, state: &TfCommandState) -> Result<bool, String> {
    if state
        .pending
        .lock()
        .map_err(|_| "Command state unavailable")?
        .remove(token)
        .is_some()
    {
        return Ok(true);
    }
    let active = state
        .active
        .lock()
        .map_err(|_| "Command state unavailable")?;
    if let Some(flag) = active.get(token) {
        flag.store(true, Ordering::Release);
        return Ok(true);
    }
    Ok(false)
}

pub fn execute(
    token: &str,
    registry: &WorkspaceRegistry,
    state: &TfCommandState,
) -> Result<TfCommandReceipt, String> {
    #[cfg(not(windows))]
    return Err("UNSUPPORTED: bounded native command requires Windows Job Objects".into());
    #[cfg(windows)]
    {
        let pending = state
            .pending
            .lock()
            .map_err(|_| "Command state unavailable")?
            .remove(token)
            .ok_or("Unknown or consumed command token")?;
        if pending.expires <= Instant::now() {
            return Err("Command token expired".into());
        }
        if !pending.approved {
            return Err("Write requires explicit approval".into());
        }
        // Validate again at the effect boundary to narrow workspace/cwd TOCTOU.
        let (canonical, canonical_root) = authorize_scope(
            registry,
            pending.cwd.to_str().ok_or("Invalid cwd encoding")?,
            pending
                .workspace_root
                .to_str()
                .ok_or("Invalid workspace root encoding")?,
        )?;
        if canonical != pending.cwd || canonical_root != pending.workspace_root {
            return Err("Workspace identity changed".into());
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        state
            .active
            .lock()
            .map_err(|_| "Command state unavailable")?
            .insert(token.to_string(), cancelled.clone());
        let receipt = run_native(
            pending.action,
            &canonical,
            &pending.request_id,
            &pending.actor,
            pending.approved && is_write(pending.action),
            cancelled,
        );
        state
            .active
            .lock()
            .map_err(|_| "Command state unavailable")?
            .remove(token);
        receipt
    }
}

#[cfg(windows)]
fn read_capped(mut pipe: impl std::io::Read) -> (String, bool) {
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 2048];
    let mut truncated = false;
    loop {
        match pipe.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let keep = n.min(OUTPUT_CAP.saturating_sub(bytes.len()));
                bytes.extend_from_slice(&buffer[..keep]);
                truncated |= keep != n;
            }
        }
    }
    (String::from_utf8_lossy(&bytes).into_owned(), truncated)
}

#[cfg(windows)]
fn run_native(
    action: TfCommandAction,
    cwd: &Path,
    request_id: &str,
    actor: &str,
    approved: bool,
    cancelled: Arc<AtomicBool>,
) -> Result<TfCommandReceipt, String> {
    use std::process::{Command, Stdio};
    let mut command = Command::new(GIT_EXE);
    command
        .current_dir(cwd)
        .env_clear()
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_CONFIG_GLOBAL", "NUL")
        .env("GIT_CONFIG_COUNT", "1")
        .env("GIT_CONFIG_KEY_0", "core.fsmonitor")
        .env("GIT_CONFIG_VALUE_0", "false")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    match action {
        TfCommandAction::ReadStatus => {
            command.args(["status", "--short", "--untracked-files=no"]);
        }
        TfCommandAction::WriteMarker => {
            command.args(["config", "--local", "tf.command.marker", "approved"]);
        }
    }
    crate::modules::proc::hide_console(&mut command);
    run_owned_command(
        command,
        action,
        cwd,
        request_id,
        actor,
        approved,
        cancelled,
        COMMAND_TIMEOUT,
    )
}

#[cfg(windows)]
fn run_owned_command(
    mut command: std::process::Command,
    action: TfCommandAction,
    cwd: &Path,
    request_id: &str,
    actor: &str,
    approved: bool,
    cancelled: Arc<AtomicBool>,
    deadline: Duration,
) -> Result<TfCommandReceipt, String> {
    use std::thread;
    let started_at = epoch_ms();
    if cancelled.load(Ordering::Acquire) {
        return Ok(receipt(
            action,
            cwd,
            request_id,
            actor,
            approved,
            started_at,
            "cancelled_before_spawn",
            "none",
            "none",
            None,
            None,
            String::new(),
            String::new(),
            false,
            false,
        ));
    }
    let mut child = command
        .spawn()
        .map_err(|_| "Pinned command spawn failed".to_string())?;
    let pid = child.id();
    let job = match crate::modules::pty::job::PtyJob::create_for(pid) {
        Ok(job) => job,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(receipt(
                action,
                cwd,
                request_id,
                actor,
                approved,
                started_at,
                "ownership_failed",
                "unknown",
                "unknown",
                Some(pid),
                None,
                String::new(),
                String::new(),
                false,
                false,
            ));
        }
    };
    let stdout = child.stdout.take().ok_or("Command stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("Command stderr unavailable")?;
    let out = thread::spawn(move || read_capped(stdout));
    let err = thread::spawn(move || read_capped(stderr));
    let started = Instant::now();
    let mut outcome = "completed";
    let mut code = None;
    loop {
        if cancelled.load(Ordering::Acquire) {
            outcome = "cancelled";
            break;
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                code = status.code();
                break;
            }
            Ok(None) => {}
            Err(_) => {
                outcome = "wait_failed";
                break;
            }
        }
        if started.elapsed() >= deadline {
            outcome = "timed_out";
            break;
        }
        thread::sleep(Duration::from_millis(10));
    }
    // Close the owned job to kill descendants even when the immediate Git process exits.
    drop(job);
    if code.is_none() {
        let _ = child.kill();
    }
    let _ = child.wait();
    let (stdout, out_truncated) = out.join().unwrap_or((String::new(), true));
    let (stderr, err_truncated) = err.join().unwrap_or((String::new(), true));
    let (effect, uncertainty) = match (action, outcome, code) {
        (_, "cancelled_before_spawn", _) => ("none", "none"),
        (TfCommandAction::ReadStatus, "completed", Some(0)) => ("read_only", "none"),
        (TfCommandAction::ReadStatus, _, _) => ("read_only", "execution_incomplete"),
        (TfCommandAction::WriteMarker, "completed", Some(0)) => {
            ("write_reported_success", "not_independently_verified")
        }
        (TfCommandAction::WriteMarker, _, _) => ("unknown", "may_have_written"),
    };
    Ok(receipt(
        action,
        cwd,
        request_id,
        actor,
        approved,
        started_at,
        outcome,
        effect,
        uncertainty,
        Some(pid),
        code,
        stdout,
        stderr,
        out_truncated,
        err_truncated,
    ))
}

#[cfg(windows)]
fn epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

#[cfg(windows)]
fn receipt(
    action: TfCommandAction,
    cwd: &Path,
    request_id: &str,
    actor: &str,
    approved: bool,
    started_at: u64,
    terminal: &'static str,
    side_effect: &'static str,
    uncertainty: &'static str,
    pid: Option<u32>,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    stdout_truncated: bool,
    stderr_truncated: bool,
) -> TfCommandReceipt {
    use sha2::{Digest, Sha256};
    let stdout_sha256 = format!("{:x}", Sha256::digest(stdout.as_bytes()));
    let stderr_sha256 = format!("{:x}", Sha256::digest(stderr.as_bytes()));
    let args = match action {
        TfCommandAction::ReadStatus => vec!["status", "--short", "--untracked-files=no"],
        TfCommandAction::WriteMarker => vec!["config", "--local", "tf.command.marker", "approved"],
    };
    // A requested local write is not an observed filesystem mutation on
    // timeout, cancellation, spawn/ownership failure, or unknown terminal.
    // Keep its target in requested_resources, and preserve side_effect=unknown
    // rather than falsely declaring the target modified.
    let affected_resources = if is_write(action) && side_effect == "write_reported_success" {
        vec![cwd.join(".git/config").display().to_string()]
    } else {
        Vec::new()
    };
    TfCommandReceipt {
        request_id: request_id.to_owned(),
        tool_id: "tf.bounded_command.v1",
        actor: actor.to_owned(),
        policy_decision: "native_allowlisted",
        approval_id: approved.then(|| format!("approval:{request_id}")),
        sandbox: "unsupported",
        requested_resources: vec![cwd.display().to_string()],
        affected_resources,
        executable: GIT_EXE.to_owned(),
        args: args.into_iter().map(str::to_owned).collect(),
        started_at,
        ended_at: epoch_ms(),
        retry: "no_auto_retry",
        action,
        terminal,
        side_effect,
        uncertainty,
        auto_retry: false,
        pid,
        exit_code,
        stdout,
        stderr,
        stdout_sha256,
        stderr_sha256,
        stdout_truncated,
        stderr_truncated,
        isolation: "unsupported_filesystem_network_isolation",
    }
}

#[tauri::command]
pub fn tf_command_prepare(
    request: TfCommandRequest,
    registry: tauri::State<'_, WorkspaceRegistry>,
    state: tauri::State<'_, TfCommandState>,
) -> Result<TfPrepared, String> {
    prepare(request, &registry, &state)
}

#[tauri::command]
pub fn tf_command_approve(
    token: String,
    state: tauri::State<'_, TfCommandState>,
) -> Result<(), String> {
    approve(&token, &state)
}

#[tauri::command]
pub async fn tf_command_execute(
    token: String,
    app: tauri::AppHandle,
) -> Result<TfCommandReceipt, String> {
    use tauri::Manager;
    tokio::task::spawn_blocking(move || {
        let registry = app.state::<WorkspaceRegistry>();
        let state = app.state::<TfCommandState>();
        execute(&token, &registry, &state)
    })
    .await
    .map_err(|_| "Command execution worker failed".to_string())?
}

#[tauri::command]
pub fn tf_command_cancel(
    token: String,
    state: tauri::State<'_, TfCommandState>,
) -> Result<bool, String> {
    cancel(&token, &state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unauthorized_scope_denied_before_spawn() {
        let dir = tempfile::tempdir().unwrap();
        let registry = WorkspaceRegistry::default();
        let result = prepare(
            TfCommandRequest {
                action: TfCommandAction::ReadStatus,
                executable: "unknown".into(),
                args: vec![],
                actor: "test".into(),
                cwd: dir.path().to_string_lossy().into_owned(),
                workspace_root: dir.path().to_string_lossy().into_owned(),
            },
            &registry,
            &TfCommandState::default(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn approval_token_cannot_be_replayed() {
        let state = TfCommandState::default();
        assert!(approve("unknown", &state).is_err());
        assert!(!cancel("unknown", &state).unwrap());
    }

    #[test]
    fn explicit_write_approval_required_and_consumed() {
        let state = TfCommandState::default();
        let cwd = std::env::current_dir().unwrap();
        let id = token().unwrap();
        state.pending.lock().unwrap().insert(
            id.clone(),
            Pending {
                request_id: token().unwrap(),
                actor: "test".into(),
                action: TfCommandAction::WriteMarker,
                workspace_root: cwd.clone(),
                cwd,
                expires: Instant::now() + Duration::from_secs(10),
                approved: false,
            },
        );
        assert!(state
            .pending
            .lock()
            .unwrap()
            .get(&id)
            .is_some_and(|p| !p.approved));
        approve(&id, &state).unwrap();
        assert!(state
            .pending
            .lock()
            .unwrap()
            .get(&id)
            .is_some_and(|p| p.approved));
        assert!(cancel(&id, &state).unwrap());
        assert!(approve(&id, &state).is_err());
    }

    #[test]
    fn environment_and_args_are_native_fixed() {
        assert_eq!(OUTPUT_CAP, 8192);
        assert_eq!(COMMAND_TIMEOUT, Duration::from_secs(5));
        assert!(is_write(TfCommandAction::WriteMarker));
        assert!(!is_write(TfCommandAction::ReadStatus));
    }

    #[cfg(windows)]
    #[test]
    fn arbitrary_arguments_and_executables_denied_before_spawn() {
        let base = TfCommandRequest {
            action: TfCommandAction::ReadStatus,
            executable: GIT_EXE.into(),
            args: vec![
                "status".into(),
                "--short".into(),
                "--untracked-files=no".into(),
            ],
            cwd: "irrelevant".into(),
            workspace_root: "irrelevant".into(),
            actor: "unit".into(),
        };
        assert!(validate_command(&base).is_ok());
        let mut wrong_arg = base;
        wrong_arg.args = vec!["-c".into(), "core.fsmonitor=evil".into()];
        assert!(validate_command(&wrong_arg).is_err());
        wrong_arg.executable = r"C:\Windows\System32\cmd.exe".into();
        assert!(validate_command(&wrong_arg).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn output_is_capped_even_when_pipe_exceeds_limit() {
        let (value, truncated) = read_capped(std::io::Cursor::new(vec![b'x'; OUTPUT_CAP + 4096]));
        assert_eq!(value.len(), OUTPUT_CAP);
        assert!(truncated);
    }

    #[cfg(windows)]
    #[test]
    fn authorized_registry_cwd_outside_selected_workspace_is_denied() {
        let temp = tempfile::tempdir().unwrap();
        let selected = temp.path().join("selected");
        let other = temp.path().join("other");
        std::fs::create_dir_all(&selected).unwrap();
        std::fs::create_dir_all(other.join(".git")).unwrap();
        let registry = WorkspaceRegistry::default();
        registry.authorize(temp.path()).unwrap();
        assert!(registry.is_authorized(&std::fs::canonicalize(&other).unwrap()));
        let err = authorize_scope(
            &registry,
            &other.to_string_lossy(),
            &selected.to_string_lossy(),
        )
        .unwrap_err();
        assert!(err.contains("outside selected workspace root"), "{err}");
    }

    #[cfg(windows)]
    #[test]
    fn wrong_or_unregistered_workspace_root_is_denied() {
        let temp = tempfile::tempdir().unwrap();
        let selected = temp.path().join("selected");
        let wrong = temp.path().join("wrong");
        std::fs::create_dir_all(selected.join(".git")).unwrap();
        std::fs::create_dir_all(&wrong).unwrap();
        let registry = WorkspaceRegistry::default();
        registry.authorize(&selected).unwrap();
        let cwd = selected.to_string_lossy();
        let err = authorize_scope(&registry, &cwd, &wrong.to_string_lossy()).unwrap_err();
        assert!(err.contains("not authorized"), "{err}");
        let err = authorize_scope(&registry, &cwd, "").unwrap_err();
        assert!(err.contains("required"), "{err}");
        // An authorized broader parent must not make a narrower wrong selection valid.
        registry.authorize(temp.path()).unwrap();
        let err = authorize_scope(&registry, &cwd, &wrong.to_string_lossy()).unwrap_err();
        assert!(err.contains("outside selected workspace root"), "{err}");
    }

    #[cfg(windows)]
    #[test]
    fn git_config_must_be_a_regular_file_not_an_indirect_write_target() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path().join("repo");
        std::fs::create_dir_all(repo.join(".git")).unwrap();
        let registry = WorkspaceRegistry::default();
        registry.authorize(&repo).unwrap();
        let invalid = authorize_scope(&registry, &repo.to_string_lossy(), &repo.to_string_lossy());
        assert!(invalid.unwrap_err().contains("configuration file required"));

        std::fs::create_dir_all(repo.join(".git/config")).unwrap();
        let invalid = authorize_scope(&registry, &repo.to_string_lossy(), &repo.to_string_lossy());
        assert!(invalid.unwrap_err().contains("regular non-symlink file"));

        std::fs::remove_dir(repo.join(".git/config")).unwrap();
        std::fs::write(
            repo.join(".git/config"),
            "[core]\nrepositoryformatversion = 0\n",
        )
        .unwrap();
        assert!(
            authorize_scope(&registry, &repo.to_string_lossy(), &repo.to_string_lossy()).is_ok()
        );
    }

    #[cfg(windows)]
    #[test]
    fn execution_rechecks_bound_workspace_root_and_consumes_token() {
        let temp = tempfile::tempdir().unwrap();
        let selected = temp.path().join("selected");
        let other = temp.path().join("other");
        std::fs::create_dir_all(selected.join(".git")).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        let registry = WorkspaceRegistry::default();
        registry.authorize(temp.path()).unwrap();
        let state = TfCommandState::default();
        let id = token().unwrap();
        state.pending.lock().unwrap().insert(
            id.clone(),
            Pending {
                request_id: token().unwrap(),
                actor: "unit".into(),
                action: TfCommandAction::ReadStatus,
                cwd: std::fs::canonicalize(&selected).unwrap(),
                workspace_root: std::fs::canonicalize(&other).unwrap(),
                approved: true,
                expires: Instant::now() + Duration::from_secs(30),
            },
        );
        let err = execute(&id, &registry, &state).unwrap_err();
        assert!(err.contains("outside selected workspace root"), "{err}");
        assert!(execute(&id, &registry, &state).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn timed_out_owned_process_reports_uncertain_write_without_retry() {
        let mut command = std::process::Command::new(r"C:\Windows\System32\ping.exe");
        command
            .args(["-n", "10", "127.0.0.1"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let receipt = run_owned_command(
            command,
            TfCommandAction::WriteMarker,
            Path::new(r"C:\"),
            "test-timeout",
            "unit",
            true,
            Arc::new(AtomicBool::new(false)),
            Duration::from_millis(40),
        )
        .unwrap();
        assert_eq!(receipt.terminal, "timed_out");
        assert_eq!(receipt.uncertainty, "may_have_written");
        assert_eq!(receipt.side_effect, "unknown");
        assert!(receipt.affected_resources.is_empty());
        assert!(receipt.pid.is_some());
        assert!(!receipt.auto_retry);
    }

    #[cfg(windows)]
    #[test]
    fn live_cancellation_kills_owned_process() {
        let mut command = std::process::Command::new(r"C:\Windows\System32\ping.exe");
        command
            .args(["-n", "10", "127.0.0.1"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let flag = Arc::new(AtomicBool::new(false));
        let cancel_flag = flag.clone();
        let cancel = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(80));
            cancel_flag.store(true, Ordering::Release);
        });
        let receipt = run_owned_command(
            command,
            TfCommandAction::ReadStatus,
            Path::new(r"C:\"),
            "test-cancel",
            "unit",
            false,
            flag,
            Duration::from_secs(3),
        )
        .unwrap();
        cancel.join().unwrap();
        assert_eq!(receipt.terminal, "cancelled");
        assert!(!receipt.auto_retry);
    }
}
