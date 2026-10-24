use std::io::Read;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::SystemTime;

use serde::Serialize;
use shared_child::SharedChild;

use super::ringbuffer::BoundedRingBuffer;
use crate::modules::workspace::{resolve_path, WorkspaceEnv};

const RING_CAP: usize = 4 * 1024 * 1024;

pub struct BackgroundProc {
    pub command: String,
    pub cwd: Option<String>,
    pub started_at_ms: u64,
    pub child: Arc<SharedChild>,
    #[cfg(windows)]
    pub owned_job: crate::modules::pty::job::PtyJob,
    #[cfg(unix)]
    pub owned_group: i32,
    pub buffer: Mutex<BoundedRingBuffer>,
    pub exited: AtomicBool,
    pub exit_code: AtomicI32,
    pub exit_unknown: AtomicBool,
}

#[derive(Serialize)]
pub struct BackgroundLogResponse {
    pub bytes: String,
    pub next_offset: u64,
    pub dropped: u64,
    pub exited: bool,
    pub exit_code: Option<i32>,
}

#[derive(Serialize)]
pub struct BackgroundProcInfo {
    pub handle: u32,
    pub command: String,
    pub cwd: Option<String>,
    pub started_at_ms: u64,
    pub exited: bool,
    pub exit_code: Option<i32>,
}

impl BackgroundProc {
    pub fn read_logs(&self, since: u64) -> BackgroundLogResponse {
        let (bytes, next_offset, dropped) = self.buffer.lock().unwrap().read_from(since);
        let exited = self.exited.load(Ordering::Acquire);
        let exit_code = if exited && !self.exit_unknown.load(Ordering::Acquire) {
            Some(self.exit_code.load(Ordering::Acquire))
        } else {
            None
        };
        BackgroundLogResponse {
            bytes: String::from_utf8_lossy(&bytes).into_owned(),
            next_offset,
            dropped,
            exited,
            exit_code,
        }
    }

    pub fn kill(&self) {
        #[cfg(windows)]
        self.owned_job.terminate();
        #[cfg(unix)]
        unsafe {
            libc::kill(-self.owned_group, libc::SIGKILL);
        }
        let _ = self.child.kill();
    }

    pub fn info(&self, handle: u32) -> BackgroundProcInfo {
        let exited = self.exited.load(Ordering::Acquire);
        let exit_code = if exited && !self.exit_unknown.load(Ordering::Acquire) {
            Some(self.exit_code.load(Ordering::Acquire))
        } else {
            None
        };
        BackgroundProcInfo {
            handle,
            command: self.command.clone(),
            cwd: self.cwd.clone(),
            started_at_ms: self.started_at_ms,
            exited,
            exit_code,
        }
    }
}

impl Drop for BackgroundProc {
    fn drop(&mut self) {
        self.kill();
    }
}

pub fn spawn(
    command: String,
    cwd: Option<String>,
    workspace: WorkspaceEnv,
) -> Result<Arc<BackgroundProc>, String> {
    let trimmed = command.trim().to_string();
    if trimmed.is_empty() {
        return Err("empty command".into());
    }
    if let Some(ref dir) = cwd {
        if !resolve_path(dir, &workspace).is_dir() {
            return Err(format!("cwd is not a directory: {dir}"));
        }
    }

    let mut cmd = super::build_oneshot_command(&trimmed, &workspace, cwd.as_deref())?;
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    if let (WorkspaceEnv::Local, Some(ref dir)) = (&workspace, &cwd) {
        cmd.current_dir(dir);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::modules::proc::hide_console(&mut cmd);

    let shared = Arc::new(SharedChild::spawn(&mut cmd).map_err(|e| e.to_string())?);
    #[cfg(windows)]
    let owned_job = crate::modules::pty::job::PtyJob::create_for(shared.id()).map_err(|e| {
        let _ = shared.kill();
        format!("Unable to bind background process to owned Windows job: {e}")
    })?;
    #[cfg(unix)]
    let owned_group = shared.id() as i32;
    let kill_on_fail = || {
        let _ = shared.kill();
    };
    let stdout_pipe = shared.take_stdout().ok_or_else(|| {
        kill_on_fail();
        "no stdout pipe".to_string()
    })?;
    let stderr_pipe = shared.take_stderr().ok_or_else(|| {
        kill_on_fail();
        "no stderr pipe".to_string()
    })?;
    let child = shared;

    let started_at_ms = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let proc = Arc::new(BackgroundProc {
        command: trimmed,
        cwd,
        started_at_ms,
        child,
        #[cfg(windows)]
        owned_job,
        #[cfg(unix)]
        owned_group,
        buffer: Mutex::new(BoundedRingBuffer::new(RING_CAP)),
        exited: AtomicBool::new(false),
        exit_code: AtomicI32::new(0),
        exit_unknown: AtomicBool::new(false),
    });

    {
        let proc_ref = proc.clone();
        let mut pipe = stdout_pipe;
        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match pipe.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => proc_ref.buffer.lock().unwrap().push(&buf[..n]),
                    Err(_) => break,
                }
            }
        });
    }
    {
        let proc_ref = proc.clone();
        let mut pipe = stderr_pipe;
        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match pipe.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => proc_ref.buffer.lock().unwrap().push(&buf[..n]),
                    Err(_) => break,
                }
            }
        });
    }
    {
        let proc_ref = proc.clone();
        let child_for_wait = proc.child.clone();
        thread::spawn(move || {
            match child_for_wait.wait() {
                Ok(status) => match status.code() {
                    Some(code) => proc_ref.exit_code.store(code, Ordering::Release),
                    None => proc_ref.exit_unknown.store(true, Ordering::Release),
                },
                Err(_) => proc_ref.exit_unknown.store(true, Ordering::Release),
            }
            proc_ref.exited.store(true, Ordering::Release);
        });
    }

    Ok(proc)
}

#[cfg(all(test, windows))]
mod managed_background_tests {
    use super::*;
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject};

    #[test]
    fn managed_server_has_handle_logs_and_kills_its_owned_descendant() {
        const SYNCHRONIZE: u32 = 0x0010_0000;
        let temp = tempfile::tempdir().unwrap();
        let marker = temp.path().join("server-owned-pid.txt");
        let path = marker.to_string_lossy().replace('\'', "''");
        let command = format!(
            "Write-Output 'managed-ready'; $p = Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile -Command Start-Sleep -Seconds 30' -NoNewWindow -PassThru; [IO.File]::WriteAllText('{path}', [string]$p.Id); Start-Sleep -Seconds 30"
        );
        let proc = spawn(command, None, WorkspaceEnv::Local).unwrap();
        let deadline = Instant::now() + Duration::from_secs(8);
        while !marker.is_file() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(50));
        }
        assert!(
            marker.is_file(),
            "background server did not spawn owned child"
        );
        let pid: u32 = std::fs::read_to_string(marker)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        assert!(!proc.info(91).exited);
        let (logs, _, _, _, _) = {
            let r = proc.read_logs(0);
            (r.bytes, r.next_offset, r.dropped, r.exited, r.exit_code)
        };
        assert!(logs.contains("managed-ready"));
        proc.kill();
        let handle = unsafe { OpenProcess(SYNCHRONIZE, 0, pid) };
        if !handle.is_null() {
            let status = unsafe { WaitForSingleObject(handle, 3000) };
            unsafe {
                CloseHandle(handle);
            }
            assert_eq!(
                status, WAIT_OBJECT_0,
                "managed background descendant was not stopped"
            );
        }
    }

    #[test]
    fn dropping_shell_owner_stops_registered_server_even_with_reader_refs() {
        const SYNCHRONIZE: u32 = 0x0010_0000;
        let temp = tempfile::tempdir().unwrap();
        let marker = temp.path().join("owned-background-pid.txt");
        let path = marker.to_string_lossy().replace('\'', "''");
        let command = format!(
            "$p = Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile -Command Start-Sleep -Seconds 30' -NoNewWindow -PassThru; [IO.File]::WriteAllText('{path}', [string]$p.Id); Start-Sleep -Seconds 30"
        );
        let proc = spawn(command, None, WorkspaceEnv::Local).unwrap();
        let deadline = Instant::now() + Duration::from_secs(8);
        while !marker.is_file() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(50));
        }
        assert!(
            marker.is_file(),
            "registered server did not start its child"
        );
        let pid: u32 = std::fs::read_to_string(marker)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        let owner = super::super::ShellState::default();
        owner.bg.write().unwrap().insert(1, proc.clone());
        drop(owner);
        let handle = unsafe { OpenProcess(SYNCHRONIZE, 0, pid) };
        if !handle.is_null() {
            let status = unsafe { WaitForSingleObject(handle, 3000) };
            unsafe {
                CloseHandle(handle);
            }
            assert_eq!(status, WAIT_OBJECT_0, "owner disposal left a child alive");
        }
        // The extra reference proves disposal doesn't wait for pipe readers or Arc::drop.
        drop(proc);
    }
}
