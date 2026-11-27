pub mod background;
pub mod ringbuffer;
pub mod session;
pub mod verification;

use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{mpsc, Arc, RwLock};
use std::thread;
use std::time::{Duration, Instant};

struct CancelForegroundOnDrop(Arc<AtomicBool>);
impl Drop for CancelForegroundOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}

use serde::Serialize;
use shared_child::SharedChild;

#[cfg(windows)]
use crate::modules::workspace::validate_wsl_distro_name;
use crate::modules::workspace::{authorize_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};

use background::{BackgroundLogResponse, BackgroundProc, BackgroundProcInfo};
use session::{SessionRunOutput, ShellSession};

const DEFAULT_TIMEOUT_SECS: u64 = 30;
const MAX_TIMEOUT_SECS: u64 = 300;
const MAX_OUTPUT_BYTES: usize = 256 * 1024;

#[derive(Serialize)]
pub struct CommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ShellIdentity {
    pub name: String,
    pub syntax: String,
}

#[tauri::command]
pub fn shell_identity(workspace: Option<WorkspaceEnv>) -> Result<ShellIdentity, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if workspace.is_wsl() {
        return Ok(ShellIdentity {
            name: "WSL /bin/sh".into(),
            syntax: "POSIX sh".into(),
        });
    }
    #[cfg(unix)]
    {
        Ok(ShellIdentity {
            name: "/bin/sh".into(),
            syntax: "POSIX sh".into(),
        })
    }
    #[cfg(windows)]
    {
        let shell = crate::modules::pty::shell_init::windows_shell_path();
        let executable = shell
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if executable.eq_ignore_ascii_case("pwsh.exe") {
            Ok(ShellIdentity {
                name: "PowerShell (pwsh.exe)".into(),
                syntax: "PowerShell; not POSIX Bash".into(),
            })
        } else if executable.eq_ignore_ascii_case("powershell.exe") {
            Ok(ShellIdentity {
                name: "Windows PowerShell (powershell.exe)".into(),
                syntax: "PowerShell; not POSIX Bash".into(),
            })
        } else {
            Ok(ShellIdentity {
                name: "Command Prompt (cmd.exe)".into(),
                syntax: "cmd.exe; not POSIX Bash".into(),
            })
        }
    }
}

/// Runs a one-shot command via the user's login shell. Output is capped and
/// the process is force-killed on timeout. We deliberately do NOT pipe into
/// the user's interactive PTY — that would fight their input. AI tool calls
/// are presented in chat as their own structured result.
#[tauri::command]
pub async fn shell_run_command(
    command: String,
    cwd: Option<String>,
    timeout_secs: Option<u64>,
    workspace: Option<WorkspaceEnv>,
    registry: tauri::State<'_, WorkspaceRegistry>,
) -> Result<CommandOutput, String> {
    let trimmed = command.trim().to_string();
    if trimmed.is_empty() {
        return Err("empty command".into());
    }

    let workspace = WorkspaceEnv::from_option(workspace);
    authorize_spawn_cwd(&registry, cwd.as_deref(), &workspace)?;
    let cwd_path = cwd
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let dur = Duration::from_secs(
        timeout_secs
            .unwrap_or(DEFAULT_TIMEOUT_SECS)
            .clamp(1, MAX_TIMEOUT_SECS),
    );

    let cancelled = Arc::new(AtomicBool::new(false));
    let _cancel_on_drop = CancelForegroundOnDrop(cancelled.clone());
    tokio::task::spawn_blocking(move || {
        run_blocking_cancelable(trimmed, cwd_path, workspace, dur, cancelled)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
pub(crate) fn run_blocking_inner(
    command: String,
    cwd: Option<String>,
    workspace: WorkspaceEnv,
    dur: Duration,
) -> Result<CommandOutput, String> {
    run_blocking(command, cwd, workspace, dur)
}

#[cfg(test)]
fn run_blocking(
    command: String,
    cwd: Option<String>,
    workspace: WorkspaceEnv,
    dur: Duration,
) -> Result<CommandOutput, String> {
    run_blocking_cancelable(
        command,
        cwd,
        workspace,
        dur,
        Arc::new(AtomicBool::new(false)),
    )
}

fn run_blocking_cancelable(
    command: String,
    cwd: Option<String>,
    workspace: WorkspaceEnv,
    dur: Duration,
    cancelled: Arc<AtomicBool>,
) -> Result<CommandOutput, String> {
    let mut cmd = build_oneshot_command(&command, &workspace, cwd.as_deref())?;
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    if let (WorkspaceEnv::Local, Some(dir)) = (&workspace, cwd) {
        cmd.current_dir(dir);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::modules::proc::hide_console(&mut cmd);

    let child = Arc::new(SharedChild::spawn(&mut cmd).map_err(|e| {
        log::warn!("shell_run_command spawn failed: {e}");
        e.to_string()
    })?);
    #[cfg(windows)]
    let owned_job = crate::modules::pty::job::PtyJob::create_for(child.id()).map_err(|e| {
        let _ = child.kill();
        format!("Unable to bind foreground command to owned Windows job: {e}")
    })?;
    #[cfg(unix)]
    let owned_group = child.id() as i32;
    let mut stdout_pipe = child.take_stdout().ok_or_else(|| {
        let _ = child.kill();
        "no stdout pipe".to_string()
    })?;
    let mut stderr_pipe = child.take_stderr().ok_or_else(|| {
        let _ = child.kill();
        "no stderr pipe".to_string()
    })?;

    let stdout_handle = thread::spawn(move || drain(&mut stdout_pipe));
    let stderr_handle = thread::spawn(move || drain(&mut stderr_pipe));

    let (tx, rx) = mpsc::channel();
    let waiter = Arc::clone(&child);
    thread::spawn(move || {
        let _ = tx.send(waiter.wait());
    });

    let start = Instant::now();
    let mut was_cancelled = false;
    let mut wait_error = None;
    let (exit_code, timed_out) = loop {
        if cancelled.load(Ordering::Acquire) {
            was_cancelled = true;
            break (None, false);
        }
        let remaining = dur.saturating_sub(start.elapsed());
        if remaining.is_zero() {
            break (None, true);
        }
        match rx.recv_timeout(remaining.min(Duration::from_millis(50))) {
            Ok(Ok(status)) => break (status.code(), false),
            Ok(Err(e)) => {
                log::warn!("foreground shell wait error: {e}");
                wait_error = Some(e.to_string());
                break (None, false);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                wait_error = Some("Foreground shell wait disconnected".to_string());
                break (None, false);
            }
        }
    };
    // The process tree owns the pipes. Always dispose it BEFORE joining
    // readers, even when the shell exited but a dev-server child survived.
    #[cfg(windows)]
    drop(owned_job);
    #[cfg(unix)]
    unsafe {
        libc::kill(-owned_group, libc::SIGKILL);
    }
    if exit_code.is_none() {
        let _ = child.kill();
        let _ = child.wait();
    }

    let (stdout_bytes, stdout_truncated) = stdout_handle.join().unwrap_or((Vec::new(), false));
    let (stderr_bytes, stderr_truncated) = stderr_handle.join().unwrap_or((Vec::new(), false));
    if was_cancelled {
        return Err("Foreground shell command cancelled; owned processes terminated".into());
    }
    if let Some(error) = wait_error {
        return Err(error);
    }

    Ok(CommandOutput {
        stdout: String::from_utf8_lossy(&stdout_bytes).into_owned(),
        stderr: String::from_utf8_lossy(&stderr_bytes).into_owned(),
        exit_code,
        timed_out,
        truncated: stdout_truncated || stderr_truncated,
    })
}

// ──────────────────────────────────────────────────────────────────────────
// Persistent agent shell state + background process state.
// ──────────────────────────────────────────────────────────────────────────

pub struct ShellState {
    sessions: RwLock<HashMap<u32, Arc<ShellSession>>>,
    bg: RwLock<HashMap<u32, Arc<BackgroundProc>>>,
    next_session_id: AtomicU32,
    next_bg_id: AtomicU32,
}

impl Default for ShellState {
    fn default() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            bg: RwLock::new(HashMap::new()),
            next_session_id: AtomicU32::new(1),
            next_bg_id: AtomicU32::new(1),
        }
    }
}

impl Drop for ShellState {
    fn drop(&mut self) {
        // Readers retain Arc<BackgroundProc> while descendants hold pipes open.
        // Stop only this state's registered processes rather than relying on
        // BackgroundProc's final Arc reference to close its owned job/group.
        if let Ok(sessions) = self.sessions.get_mut() {
            for session in sessions.values() {
                session.close();
            }
        }
        if let Ok(background) = self.bg.get_mut() {
            for proc in background.values() {
                proc.kill();
            }
        }
    }
}

#[tauri::command]
pub fn shell_session_open(
    state: tauri::State<ShellState>,
    registry: tauri::State<WorkspaceRegistry>,
    cwd: Option<String>,
    workspace: Option<WorkspaceEnv>,
) -> Result<u32, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    authorize_spawn_cwd(&registry, cwd.as_deref(), &workspace)?;
    let initial = match cwd.as_deref().filter(|s| !s.is_empty()) {
        Some(c) => c.to_string(),
        None => {
            if let WorkspaceEnv::Wsl { distro } = &workspace {
                crate::modules::workspace::wsl_home(distro.clone())?
            } else {
                crate::modules::fs::to_canon(dirs::home_dir().unwrap_or_else(|| PathBuf::from("/")))
            }
        }
    };
    let session = Arc::new(ShellSession::new(initial, workspace));
    let id = state.next_session_id.fetch_add(1, Ordering::Relaxed);
    state.sessions.write().unwrap().insert(id, session);
    Ok(id)
}

#[tauri::command]
pub async fn shell_session_run(
    state: tauri::State<'_, ShellState>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    id: u32,
    command: String,
    cwd: Option<String>,
    timeout_secs: Option<u64>,
    workspace: Option<WorkspaceEnv>,
) -> Result<SessionRunOutput, String> {
    let session = state
        .sessions
        .read()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| "no shell session".to_string())?;
    let effective_workspace = workspace
        .clone()
        .unwrap_or_else(|| session.workspace.clone());
    authorize_spawn_cwd(&registry, cwd.as_deref(), &effective_workspace)?;
    let dur = Duration::from_secs(
        timeout_secs
            .unwrap_or(DEFAULT_TIMEOUT_SECS)
            .clamp(1, MAX_TIMEOUT_SECS),
    );
    let cancelled = Arc::new(AtomicBool::new(false));
    let _cancel_on_drop = CancelForegroundOnDrop(cancelled.clone());
    tokio::task::spawn_blocking(move || {
        session.run_cancelable(command, cwd, workspace, dur, cancelled)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn shell_session_close(state: tauri::State<ShellState>, id: u32) -> Result<(), String> {
    if let Some(session) = state.sessions.write().unwrap().remove(&id) {
        session.close();
    }
    Ok(())
}

#[tauri::command]
pub fn shell_bg_spawn(
    state: tauri::State<ShellState>,
    registry: tauri::State<WorkspaceRegistry>,
    command: String,
    cwd: Option<String>,
    workspace: Option<WorkspaceEnv>,
) -> Result<u32, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    authorize_spawn_cwd(&registry, cwd.as_deref(), &workspace)?;
    let proc = background::spawn(command, cwd, workspace)?;
    let id = state.next_bg_id.fetch_add(1, Ordering::Relaxed);
    state.bg.write().unwrap().insert(id, proc);
    Ok(id)
}

#[tauri::command]
pub fn shell_bg_logs(
    state: tauri::State<ShellState>,
    handle: u32,
    since_offset: Option<u64>,
) -> Result<BackgroundLogResponse, String> {
    let proc = state
        .bg
        .read()
        .unwrap()
        .get(&handle)
        .cloned()
        .ok_or_else(|| "no background handle".to_string())?;
    Ok(proc.read_logs(since_offset.unwrap_or(0)))
}

#[tauri::command]
pub fn shell_bg_kill(state: tauri::State<ShellState>, handle: u32) -> Result<(), String> {
    if let Some(proc) = state.bg.read().unwrap().get(&handle).cloned() {
        proc.kill();
    }
    Ok(())
}

#[tauri::command]
pub fn shell_bg_list(state: tauri::State<ShellState>) -> Result<Vec<BackgroundProcInfo>, String> {
    let map = state.bg.read().unwrap();
    let mut out = Vec::with_capacity(map.len());
    for (id, p) in map.iter() {
        out.push(p.info(*id));
    }
    out.sort_by_key(|i| i.handle);
    Ok(out)
}

pub(crate) fn build_oneshot_command(
    command: &str,
    #[cfg_attr(not(windows), allow(unused_variables))] workspace: &WorkspaceEnv,
    #[cfg_attr(not(windows), allow(unused_variables))] cwd: Option<&str>,
) -> Result<Command, String> {
    #[cfg(windows)]
    if let WorkspaceEnv::Wsl { distro } = workspace {
        validate_wsl_distro_name(distro)?;
        let mut cmd = Command::new("wsl.exe");
        cmd.arg("-d").arg(distro);
        if let Some(cwd) = cwd.filter(|s| !s.is_empty()) {
            cmd.arg("--cd").arg(cwd);
        }
        cmd.arg("--exec").arg("sh").arg("-lc").arg(command);
        return Ok(cmd);
    }
    #[cfg(unix)]
    {
        let mut cmd = Command::new("/bin/sh");
        cmd.arg("-c").arg(command);
        for (key, value) in crate::modules::workspace::appimage_env_overrides() {
            match value {
                Some(v) => {
                    cmd.env(key, v);
                }
                None => {
                    cmd.env_remove(key);
                }
            }
        }
        Ok(cmd)
    }
    #[cfg(windows)]
    {
        let shell = crate::modules::pty::shell_init::windows_shell_path();
        let mut cmd = Command::new(&shell);
        let is_cmd = shell
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.eq_ignore_ascii_case("cmd.exe"))
            .unwrap_or(false);
        if is_cmd {
            cmd.arg("/C").arg(command);
        } else {
            cmd.arg("-NoProfile").arg("-Command").arg(command);
        }
        Ok(cmd)
    }
}

fn drain<R: Read>(reader: &mut R) -> (Vec<u8>, bool) {
    let mut out = Vec::new();
    let mut buf = [0u8; 8192];
    let mut truncated = false;
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if out.len() >= MAX_OUTPUT_BYTES {
                    truncated = true;
                    continue;
                }
                let take = (MAX_OUTPUT_BYTES - out.len()).min(n);
                out.extend_from_slice(&buf[..take]);
                if take < n {
                    truncated = true;
                }
            }
            Err(_) => break,
        }
    }
    (out, truncated)
}

#[cfg(test)]
mod identity_tests {
    use super::*;

    #[test]
    fn wsl_shell_identity_is_explicitly_posix() {
        let identity = shell_identity(Some(WorkspaceEnv::Wsl {
            distro: "Ubuntu".into(),
        }))
        .unwrap();
        assert_eq!(identity.name, "WSL /bin/sh");
        assert_eq!(identity.syntax, "POSIX sh");
        assert_eq!(
            serde_json::to_value(&identity).unwrap(),
            serde_json::json!({
                "name": "WSL /bin/sh", "syntax": "POSIX sh"
            })
        );
    }

    #[cfg(unix)]
    #[test]
    fn local_unix_shell_identity_matches_launcher() {
        let identity = shell_identity(Some(WorkspaceEnv::Local)).unwrap();
        assert_eq!(identity.name, "/bin/sh");
        assert_eq!(identity.syntax, "POSIX sh");
        assert_eq!(
            serde_json::to_value(&identity).unwrap(),
            serde_json::json!({
                "name": "/bin/sh", "syntax": "POSIX sh"
            })
        );
    }

    #[cfg(windows)]
    #[test]
    fn local_windows_shell_identity_matches_launcher() {
        let identity = shell_identity(Some(WorkspaceEnv::Local)).unwrap();
        let json = serde_json::to_value(&identity).unwrap();
        assert_eq!(json["name"], identity.name);
        assert_eq!(json["syntax"], identity.syntax);
        let shell = crate::modules::pty::shell_init::windows_shell_path();
        let executable = shell
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if executable.eq_ignore_ascii_case("pwsh.exe") {
            assert_eq!(identity.name, "PowerShell (pwsh.exe)");
            assert_eq!(identity.syntax, "PowerShell; not POSIX Bash");
        } else if executable.eq_ignore_ascii_case("powershell.exe") {
            assert_eq!(identity.name, "Windows PowerShell (powershell.exe)");
            assert_eq!(identity.syntax, "PowerShell; not POSIX Bash");
        } else {
            assert_eq!(identity.name, "Command Prompt (cmd.exe)");
            assert_eq!(identity.syntax, "cmd.exe; not POSIX Bash");
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn run(cmd: &str, timeout_secs: u64) -> CommandOutput {
        run_blocking_inner(
            cmd.into(),
            None,
            WorkspaceEnv::Local,
            Duration::from_secs(timeout_secs),
        )
        .expect("run")
    }

    #[test]
    fn run_blocking_captures_stdout_and_zero_exit() {
        let out = run("printf 'hello\\n'", 5);
        assert_eq!(out.stdout, "hello\n");
        assert_eq!(out.exit_code, Some(0));
        assert!(!out.timed_out);
        assert!(!out.truncated);
    }

    #[test]
    fn run_blocking_captures_stderr_and_nonzero_exit() {
        let out = run("printf 'oops\\n' >&2; exit 3", 5);
        assert!(out.stderr.contains("oops"));
        assert_eq!(out.exit_code, Some(3));
    }

    #[test]
    fn run_blocking_times_out_long_running_command() {
        let out = run("sleep 10", 1);
        assert!(out.timed_out);
        assert_eq!(out.exit_code, None);
    }

    #[test]
    fn run_blocking_truncates_huge_output() {
        let big = MAX_OUTPUT_BYTES + 4096;
        let out = run(&format!("head -c {big} /dev/zero"), 10);
        assert!(out.truncated);
        assert!(out.stdout.len() <= MAX_OUTPUT_BYTES);
    }

    #[test]
    fn build_oneshot_command_uses_sh_minus_c_on_unix() {
        let cmd = build_oneshot_command("echo hi", &WorkspaceEnv::Local, None).unwrap();
        assert_eq!(cmd.get_program(), "/bin/sh");
        let args: Vec<_> = cmd.get_args().collect();
        assert_eq!(args, vec!["-c", "echo hi"]);
    }
}

#[cfg(all(test, windows))]
mod foreground_lifecycle_tests {
    use super::*;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;
    use std::time::Instant;

    #[test]
    fn foreground_normal_exit_and_failure_are_truthful() {
        let ok = run_blocking_inner(
            "Write-Output 'shell-finite-ok'".into(),
            None,
            WorkspaceEnv::Local,
            Duration::from_secs(5),
        )
        .unwrap();
        assert_eq!(ok.exit_code, Some(0));
        assert!(!ok.timed_out);
        assert!(ok.stdout.contains("shell-finite-ok"));
        let fail = run_blocking_inner(
            "Write-Error 'shell-finite-failed'; exit 7".into(),
            None,
            WorkspaceEnv::Local,
            Duration::from_secs(5),
        )
        .unwrap();
        assert_eq!(fail.exit_code, Some(7));
        assert!(!fail.timed_out);
    }

    #[test]
    fn cancellation_token_and_session_close_settle_foreground_commands() {
        let cancelled = Arc::new(AtomicBool::new(false));
        let cancel = cancelled.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(400));
            cancel.store(true, Ordering::Release);
        });
        let started = Instant::now();
        let err = run_blocking_cancelable(
            "Start-Sleep -Seconds 30".into(),
            None,
            WorkspaceEnv::Local,
            Duration::from_secs(30),
            cancelled,
        )
        .err()
        .expect("cancellation must terminate owned command");
        assert!(err.contains("cancelled"));
        assert!(started.elapsed() < Duration::from_secs(8));

        let session = Arc::new(ShellSession::new(
            std::env::temp_dir().to_string_lossy().to_string(),
            WorkspaceEnv::Local,
        ));
        let running = session.clone();
        let started = Instant::now();
        let worker = thread::spawn(move || {
            running.run_cancelable(
                "Start-Sleep -Seconds 30".into(),
                None,
                None,
                Duration::from_secs(30),
                Arc::new(AtomicBool::new(false)),
            )
        });
        thread::sleep(Duration::from_millis(400));
        session.close();
        match worker.join().unwrap() {
            Err(error) => assert!(error.contains("cancelled")),
            Ok(_) => panic!("closed session must cancel running command"),
        }
        assert!(started.elapsed() < Duration::from_secs(8));
        assert!(session
            .run(
                "Write-Output ignored".into(),
                None,
                None,
                Duration::from_secs(1)
            )
            .is_err());
    }

    #[test]
    fn owned_child_is_killed_but_unrelated_process_is_not() {
        use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
        use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject};
        const SYNCHRONIZE: u32 = 0x0010_0000;
        let temp = tempfile::tempdir().unwrap();
        let marker = temp.path().join("owned-pid.txt");
        let path = marker.to_string_lossy().replace('\'', "''");
        // Place marker before long sleep, so the checked PID belongs
        // only to this disposable command tree.
        let script = format!("$p = Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile -Command Start-Sleep -Seconds 30' -NoNewWindow -PassThru; [IO.File]::WriteAllText('{path}', [string]$p.Id); Start-Sleep -Seconds 30");
        let mut unrelated = Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", "Start-Sleep -Seconds 30"])
            .spawn()
            .expect("isolated unrelated process");
        let output = run_blocking_inner(script, None, WorkspaceEnv::Local, Duration::from_secs(2))
            .expect("foreground timeout");
        assert!(output.timed_out);
        let pid: u32 = std::fs::read_to_string(marker)
            .expect("owned child marker")
            .trim()
            .parse()
            .unwrap();
        let handle = unsafe { OpenProcess(SYNCHRONIZE, 0, pid) };
        let exited = if !handle.is_null() {
            // Job termination is asynchronous; the command can settle before
            // the kernel has signalled every descendant process handle.
            let exited = unsafe { WaitForSingleObject(handle, 3000) } == WAIT_OBJECT_0;
            unsafe {
                CloseHandle(handle);
            }
            exited
        } else {
            true
        };
        let unrelated_alive = unrelated.try_wait().unwrap().is_none();
        if unrelated_alive {
            unrelated.kill().unwrap();
        }
        unrelated.wait().unwrap();
        assert!(exited, "owned descendant survived shell timeout");
        assert!(unrelated_alive, "unrelated process was killed");
    }

    #[test]
    fn foreground_timeout_kills_owned_descendants_and_settles_with_open_pipes() {
        // The grandchild inherits stdout/stderr. Killing the shell alone
        // leaves read_to_end blocked even after the timeout fires.
        let started = Instant::now();
        let output = run_blocking_inner(
            "Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile -Command Start-Sleep -Seconds 30' -NoNewWindow; Start-Sleep -Seconds 30".into(),
            None, WorkspaceEnv::Local, Duration::from_secs(1),
        ).expect("bounded foreground result");
        assert!(output.timed_out);
        assert!(output.exit_code.is_none());
        assert!(
            started.elapsed() < Duration::from_secs(8),
            "timeout blocked on inherited pipe"
        );
    }
}
