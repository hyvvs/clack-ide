//! The writer belongs only to Clack. EOF also occurs on crash/SIGKILL, without
//! needing macOS to emulate Linux parent-death signals or trusting saved PIDs.
use std::{
    io::Read,
    process::{Child, Command, Stdio},
    time::Duration,
};

pub const FLAG: &str = "--clack-owned-ssh-guardian";

pub fn entry() -> bool {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new(FLAG)) {
        return false;
    }
    let Some(program) = args.next() else {
        std::process::exit(2);
    };
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    std::process::exit(run(command, std::io::stdin()));
}

struct Worker(Child);
impl Drop for Worker {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
pub fn run(mut command: Command, mut parent: impl Read + Send + 'static) -> i32 {
    let Ok(child) = command.spawn() else {
        return 127;
    };
    let mut child = Worker(child);
    let (closed, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut byte = [0];
        while matches!(parent.read(&mut byte),Ok(n) if n>0) {}
        let _ = closed.send(());
    });
    loop {
        match child.0.try_wait() {
            Ok(Some(status)) => return status.code().unwrap_or(1),
            Err(_) => return 1,
            Ok(None) => {}
        }
        match receiver.recv_timeout(Duration::from_millis(20)) {
            Ok(()) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return 0,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
}

// The POSIX integration suite imports this module with `cfg(test)` and verifies
// the command wrapper without spawning a real SSH connection.
#[cfg(unix)]
pub(super) fn command(original: Command) -> Result<Command, String> {
    use std::os::unix::process::CommandExt;
    let mut command = Command::new(std::env::current_exe().map_err(|_| "ssh-ownership-failed")?);
    command
        .arg(FLAG)
        .arg(original.get_program())
        .args(original.get_args())
        .env_clear();
    for (key, value) in original.get_envs() {
        if let Some(value) = value {
            command.env(key, value);
        }
    }
    if let Some(cwd) = original.get_current_dir() {
        command.current_dir(cwd);
    }
    command.process_group(0);
    Ok(command)
}
