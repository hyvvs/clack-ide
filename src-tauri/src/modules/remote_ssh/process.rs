use std::{
    collections::VecDeque,
    io::Read,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

pub struct OwnedChild {
    pub child: Child,
    errors: Arc<Mutex<VecDeque<u8>>>,
    #[cfg(windows)]
    _job: crate::modules::pty::job::PtyJob,
}

pub fn command(name: &str) -> Result<Command, String> {
    #[cfg(windows)]
    let path = std::path::PathBuf::from(std::env::var_os("SystemRoot").ok_or("ssh-unavailable")?)
        .join("System32/OpenSSH")
        .join(format!("{name}.exe"));
    #[cfg(not(windows))]
    let path = std::path::PathBuf::from("/usr/bin").join(name);
    if !path.is_file() {
        return Err("ssh-unavailable".into());
    }
    let mut command = Command::new(path);
    command.env_clear();
    // OpenSSH uses the platform agent; no provider credentials or arbitrary
    // SSH_ASKPASS / preload / proxy configuration crosses this boundary.
    for name in ["SystemRoot", "WINDIR", "ProgramData", "SSH_AUTH_SOCK"] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    Ok(command)
}

fn drain(
    mut reader: impl Read + Send + 'static,
    bytes: Arc<Mutex<VecDeque<u8>>>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut buffer = [0; 1024];
        while let Ok(n) = reader.read(&mut buffer) {
            if n == 0 {
                break;
            }
            if let Ok(mut bytes) = bytes.lock() {
                for byte in &buffer[..n] {
                    if bytes.len() == 16 * 1024 {
                        bytes.pop_front();
                    }
                    bytes.push_back(*byte);
                }
            }
        }
    })
}

impl OwnedChild {
    pub fn spawn(mut command: Command) -> Result<Self, String> {
        let mut child = command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|_| "ssh-unavailable")?;
        #[cfg(windows)]
        let job = match crate::modules::pty::job::PtyJob::create_for(child.id()) {
            Ok(job) => job,
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("ssh-ownership-failed".into());
            }
        };
        let errors = Arc::new(Mutex::new(VecDeque::new()));
        if let Some(stderr) = child.stderr.take() {
            drain(stderr, errors.clone());
        }
        Ok(Self {
            child,
            errors,
            #[cfg(windows)]
            _job: job,
        })
    }
    pub fn alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }
    pub fn error(&self) -> String {
        let bytes: Vec<u8> = self
            .errors
            .lock()
            .map(|v| v.iter().copied().collect())
            .unwrap_or_default();
        let text = String::from_utf8_lossy(&bytes).to_lowercase();
        if text.contains("host key verification failed")
            || text.contains("host identification has changed")
        {
            "host-key-changed"
        } else if text.contains("permission denied")
            || text.contains("load key")
            || text.contains("bad permissions")
        {
            "authentication-failed"
        } else if text.contains("address already in use") {
            "port-collision"
        } else {
            "host-unreachable"
        }
        .into()
    }
    pub fn listening(&self, port: u16) -> bool {
        let bytes: Vec<u8> = self
            .errors
            .lock()
            .map(|v| v.iter().copied().collect())
            .unwrap_or_default();
        String::from_utf8_lossy(&bytes).contains(&format!(
            "Local forwarding listening on 127.0.0.1 port {port}."
        ))
    }
}
impl Drop for OwnedChild {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub fn capture(mut command: Command) -> Result<String, String> {
    command
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .stdin(Stdio::null());
    let mut child = command.spawn().map_err(|_| "ssh-unavailable")?;
    let output = Arc::new(Mutex::new(VecDeque::new()));
    let reader = child
        .stdout
        .take()
        .map(|stdout| drain(stdout, output.clone()));
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            _ if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("host-unreachable".into());
            }
            _ => std::thread::sleep(Duration::from_millis(20)),
        }
    }
    if let Some(reader) = reader {
        let _ = reader.join();
    }
    let bytes: Vec<u8> = output
        .lock()
        .map_err(|_| "ssh-error")?
        .iter()
        .copied()
        .collect();
    String::from_utf8(bytes).map_err(|_| "ssh-error".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn installed_client_version_works_without_provider_environment_or_askpass() {
        let Ok(mut cmd) = command("ssh") else {
            return;
        };
        assert!(!cmd
            .get_envs()
            .any(|(key, value)| value.is_some() && key.to_string_lossy().contains("ASKPASS")));
        assert!(!cmd
            .get_envs()
            .any(|(key, value)| value.is_some() && key.to_string_lossy().contains("API_KEY")));
        assert!(cmd
            .arg("-V")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success());
    }
    #[test]
    fn missing_utility_is_an_actionable_client_error_not_raw_os_output() {
        assert!(
            matches!(command("clack-nonexistent-utility"),Err(code) if code=="ssh-unavailable")
        );
    }
}
