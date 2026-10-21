// Also runnable with rustc --test: this exercises the actual dependency-free
// guardian on POSIX without needing a display server or a Tauri webview.
#[path = "../src/modules/remote_ssh/guardian.rs"]
#[allow(dead_code)]
mod guardian;

#[cfg(unix)]
mod posix {
    use super::guardian;
    use std::{
        io::Write,
        net::{TcpListener, TcpStream},
        path::{Path, PathBuf},
        process::{Child, Command, Stdio},
        time::{Duration, Instant},
    };
    struct Owned(Child);
    impl Drop for Owned {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    fn root() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "clack-ssh-guardian-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&path).unwrap();
        path
    }
    fn fixture(name: &str, root: &Path) -> Command {
        let mut c = Command::new(std::env::current_exe().unwrap());
        c.args(["--exact", name, "--ignored", "--nocapture"])
            .env("CLACK_SSH_GUARD_FIXTURE", root)
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        c
    }
    fn wait_file(root: &Path, name: &str) -> String {
        let end = Instant::now() + Duration::from_secs(8);
        loop {
            if let Ok(text) = std::fs::read_to_string(root.join(name)) {
                if !text.is_empty() {
                    return text;
                }
            }
            assert!(Instant::now() < end, "missing fixture {name}");
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    fn closed(port: u16) {
        let end = Instant::now() + Duration::from_secs(5);
        while TcpStream::connect(("127.0.0.1", port)).is_ok() {
            assert!(Instant::now() < end, "owned listener survived parent death");
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    #[test]
    #[ignore]
    fn worker_fixture() {
        let Some(root) = std::env::var_os("CLACK_SSH_GUARD_FIXTURE") else {
            return;
        };
        let root = PathBuf::from(root);
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        std::fs::write(
            root.join("port"),
            listener.local_addr().unwrap().port().to_string(),
        )
        .unwrap();
        for connection in listener.incoming() {
            drop(connection.unwrap());
        }
    }
    #[test]
    #[ignore]
    fn guardian_fixture() {
        let Some(root) = std::env::var_os("CLACK_SSH_GUARD_FIXTURE") else {
            return;
        };
        let root = PathBuf::from(root);
        let mut worker = fixture("posix::worker_fixture", &root);
        worker.stdin(Stdio::null());
        let code = guardian::run(worker, std::io::stdin());
        std::fs::write(root.join("guardian-done"), code.to_string()).unwrap();
    }
    #[test]
    #[ignore]
    fn parent_fixture() {
        let Some(root) = std::env::var_os("CLACK_SSH_GUARD_FIXTURE") else {
            return;
        };
        let root = PathBuf::from(root);
        let mut guard = fixture("posix::guardian_fixture", &root);
        guard.stdin(Stdio::piped());
        let mut child = Owned(guard.spawn().unwrap());
        child
            .0
            .stdin
            .as_mut()
            .unwrap()
            .write_all(b"parent alive")
            .unwrap();
        std::fs::write(root.join("parent-ready"), "ready").unwrap();
        std::thread::sleep(Duration::from_secs(60));
    }
    #[test]
    fn abrupt_parent_death_closes_only_its_owned_listener() {
        let owned = root();
        let other = root();
        let mut unrelated = Owned(fixture("posix::worker_fixture", &other).spawn().unwrap());
        let other_port: u16 = wait_file(&other, "port").parse().unwrap();
        let mut parent = Owned(fixture("posix::parent_fixture", &owned).spawn().unwrap());
        wait_file(&owned, "parent-ready");
        let port: u16 = wait_file(&owned, "port").parse().unwrap();
        assert!(TcpStream::connect(("127.0.0.1", port)).is_ok());
        parent.0.kill().unwrap();
        parent.0.wait().unwrap();
        assert_eq!(wait_file(&owned, "guardian-done"), "0");
        closed(port);
        assert!(unrelated.0.try_wait().unwrap().is_none());
        assert!(TcpStream::connect(("127.0.0.1", other_port)).is_ok());
        drop(unrelated);
        std::fs::remove_dir_all(owned).unwrap();
        std::fs::remove_dir_all(other).unwrap();
    }
    #[test]
    fn graceful_pipe_close_cleans_up_without_a_stored_pid() {
        let root = root();
        let mut command = fixture("posix::guardian_fixture", &root);
        command.stdin(Stdio::piped());
        let mut guard = Owned(command.spawn().unwrap());
        let port: u16 = wait_file(&root, "port").parse().unwrap();
        guard.0.stdin.take();
        assert_eq!(wait_file(&root, "guardian-done"), "0");
        closed(port);
        assert!(guard.0.wait().unwrap().success());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn actual_native_binary_enters_guard_mode_before_gui_initialization() {
        let root = root();
        let mut command = Command::new(env!("CARGO_BIN_EXE_clack"));
        command
            .arg(guardian::FLAG)
            .arg(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "posix::worker_fixture",
                "--ignored",
                "--nocapture",
            ])
            .env("CLACK_SSH_GUARD_FIXTURE", &root)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut guard = Owned(command.spawn().unwrap());
        let port: u16 = wait_file(&root, "port").parse().unwrap();
        guard.0.stdin.take();
        closed(port);
        assert!(guard.0.wait().unwrap().success());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn guardian_arguments_keep_unicode_and_spaces_as_separate_os_arguments() {
        let mut original = Command::new("/path with spaces/ssh");
        original.args(["-i", "/home/test/clé key", "-N"]);
        let guard = guardian::command(original).unwrap();
        let args: Vec<_> = guard
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert_eq!(
            args,
            [
                guardian::FLAG,
                "/path with spaces/ssh",
                "-i",
                "/home/test/clé key",
                "-N"
            ]
        );
    }
}
