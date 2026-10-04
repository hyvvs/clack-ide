use super::super::{
    staging::{Input, Prepared},
    tests::policy,
    Cleanup,
};
use super::*;
use sha2::{Digest, Sha256};
use std::fs;

fn fixture(wat: &str) -> (tempfile::TempDir, Policy, Input) {
    let root = tempfile::tempdir().unwrap();
    #[cfg(windows)]
    let path = root.path().to_path_buf();
    #[cfg(unix)]
    let path = root.path().canonicalize().unwrap();
    let bytes = wat::parse_str(wat).unwrap();
    let mut p = policy();
    p.workspace = path.clone();
    p.cwd = path.clone();
    p.read_roots = vec![path.clone()];
    p.executable.path = path.join("fixture.wasm");
    p.executable.sha256 = format!("{:x}", Sha256::digest(&bytes));
    fs::write(&p.executable.path, bytes).unwrap();
    let input = Input {
        source: path.join("approved.txt"),
        name: "input.txt".into(),
        sha256: format!("{:x}", Sha256::digest(b"approved")),
    };
    fs::write(&input.source, b"approved").unwrap();
    (root, p, input)
}

const EMPTY: &str = r#"(module (memory (export "memory") 1) (func (export "_start")))"#;
const LOOP: &str = r#"(module (memory (export "memory") 1) (func (export "_start") (loop br 0)))"#;
const OPEN: &str = r#"(import "wasi_snapshot_preview1" "path_open" (func $open (param i32 i32 i32 i32 i32 i64 i64 i32 i32) (result i32)))"#;
const WRITE: &str = r#"(import "wasi_snapshot_preview1" "fd_write" (func $write (param i32 i32 i32 i32) (result i32)))"#;

fn bytes(value: &str) -> String {
    value.bytes().map(|b| format!("\\{b:02x}")).collect()
}
fn open(path: &str, expected_success: bool) -> String {
    let call = format!("(call $open (i32.const 3) (i32.const 1) (i32.const 100) (i32.const {}) (i32.const 0) (i64.const 2) (i64.const 0) (i32.const 0) (i32.const 0))", path.len());
    let condition = if expected_success {
        call
    } else {
        format!("(i32.eqz {call})")
    };
    format!(
        r#"(module {OPEN} (memory (export "memory") 1)
        (data (i32.const 100) "{}")
        (func (export "_start")
            (if {condition} (then unreachable))))"#,
        bytes(path)
    )
}

fn execute(wat: &str) -> super::super::staging::Completed {
    let (_root, p, input) = fixture(wat);
    Prepared::new(p, vec![input], vec![])
        .unwrap()
        .run(&|| false)
}

#[test]
fn empty_guest_completes_and_staging_is_removed() {
    let (_root, p, input) = fixture(EMPTY);
    let stage = Prepared::new(p, vec![input.clone()], vec![]).unwrap();
    let path = stage.directory().to_owned();
    let result = stage.run(&|| false);
    assert_eq!(result.receipt.failure, None);
    assert_eq!(result.receipt.cleanup, Cleanup::Verified);
    assert!(!path.exists());
    assert_eq!(fs::read(input.source).unwrap(), b"approved");
}

#[test]
fn only_staged_copy_is_readable_not_workspace_paths_or_hardlink_aliases() {
    assert_eq!(execute(&open("input.txt", true)).receipt.failure, None);
    let (root, p, input) = fixture(EMPTY);
    let outside = root.path().join("outside.txt");
    fs::write(&outside, "SECRET").unwrap();
    fs::hard_link(&outside, root.path().join("outside-alias.txt")).unwrap();
    let paths = vec![
        input.source.to_string_lossy().into_owned(),
        outside.to_string_lossy().into_owned(),
        root.path()
            .join("outside-alias.txt")
            .to_string_lossy()
            .into_owned(),
        "../approved.txt".into(),
        "/etc/passwd".into(),
        "C:/Windows/win.ini".into(),
        r"\\localhost\C$\Windows\win.ini".into(),
        ".env".into(),
        "../../.ssh/id_rsa".into(),
    ];
    for path in paths {
        assert_eq!(execute(&open(&path, false)).receipt.failure, None, "{path}");
    }
    assert!(p.workspace.exists());
    assert_eq!(fs::read(outside).unwrap(), b"SECRET");
}

#[test]
fn injected_stage_hardlink_is_rejected_before_guest_execution() {
    let (_root, p, input) = fixture(EMPTY);
    let stage = Prepared::new(p, vec![input.clone()], vec![]).unwrap();
    fs::hard_link(&input.source, stage.directory().join("scratch/alias.txt")).unwrap();
    let result = stage.run(&|| false);
    assert_eq!(result.receipt.failure, Some(Failure::InvalidPolicy));
    assert_eq!(result.receipt.cleanup, Cleanup::NotStarted);
    assert_eq!(fs::read(input.source).unwrap(), b"approved");
}

#[test]
fn environment_is_empty_and_no_extra_preopens_are_inherited() {
    let wat = r#"(module
      (import "wasi_snapshot_preview1" "environ_sizes_get" (func $env (param i32 i32) (result i32)))
      (import "wasi_snapshot_preview1" "fd_prestat_get" (func $pre (param i32 i32) (result i32)))
      (memory (export "memory") 1)
      (func (export "_start")
        (if (call $env (i32.const 0) (i32.const 4)) (then unreachable))
        (if (i32.load (i32.const 0)) (then unreachable))
        (if (i32.load (i32.const 4)) (then unreachable))
        (if (call $pre (i32.const 3) (i32.const 8)) (then unreachable))
        (if (i32.eqz (call $pre (i32.const 4) (i32.const 8))) (then unreachable))))"#;
    assert_eq!(execute(wat).receipt.failure, None);
}

#[test]
fn network_and_host_process_imports_cannot_be_linked() {
    for (module, function) in [
        ("env", "system"),
        ("wasi_snapshot_preview1", "proc_spawn"),
        ("wasi_snapshot_preview1", "sock_open"),
    ] {
        let wat = format!(
            r#"(module (import "{module}" "{function}" (func $f)) (memory (export "memory") 1) (func (export "_start") call $f))"#
        );
        assert!(matches!(
            execute(&wat).receipt.failure,
            Some(Failure::InvalidModule | Failure::GuestTrap)
        ));
    }
}

#[test]
fn wasi_socket_calls_cannot_repurpose_stdin_or_preopen() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let wat = r#"(module
      (import "wasi_snapshot_preview1" "sock_accept" (func $accept (param i32 i32 i32) (result i32)))
      (import "wasi_snapshot_preview1" "sock_send" (func $send (param i32 i32 i32 i32 i32) (result i32)))
      (memory (export "memory") 1)
      (func (export "_start")
        (if (i32.eqz (call $accept (i32.const 3) (i32.const 0) (i32.const 0))) (then unreachable))
        (if (i32.eqz (call $send (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 8))) (then unreachable))))"#;
    assert_eq!(execute(wat).receipt.failure, None);
    assert!(listener.accept().is_err());
}

#[test]
fn guest_start_section_uses_the_same_guarded_memory() {
    let wat = format!(
        r#"(module {WRITE} (memory (export "memory") 1)
      (data (i32.const 100) "start")
      (func $init
        (i32.store (i32.const 0) (i32.const 100)) (i32.store (i32.const 4) (i32.const 5))
        (if (call $write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 8)) (then unreachable)))
      (start $init) (func (export "_start")))"#
    );
    let result = execute(&wat);
    assert_eq!(result.receipt.failure, None);
    assert_eq!(result.output, b"start");
}

#[test]
fn stage_file_growth_and_open_count_are_bounded() {
    let flood = format!(
        r#"(module {OPEN} {WRITE} (memory (export "memory") 1)
      (data (i32.const 100) "scratch/flood.txt")
      (func (export "_start")
        (if (call $open (i32.const 3) (i32.const 0) (i32.const 100) (i32.const 17) (i32.const 1) (i64.const 64) (i64.const 0) (i32.const 0) (i32.const 16)) (then unreachable))
        (i32.store (i32.const 0) (i32.const 256)) (i32.store (i32.const 4) (i32.const 64000))
        (loop (drop (call $write (i32.load (i32.const 16)) (i32.const 0) (i32.const 1) (i32.const 8))) br 0)))"#
    );
    let result = execute(&flood);
    assert_eq!(result.receipt.failure, Some(Failure::OutputLimit));
    assert!(result.files.is_empty());
    let opens = format!(
        r#"(module {OPEN} (memory (export "memory") 1)
      (data (i32.const 100) "input.txt")
      (func (export "_start") (loop
        (drop (call $open (i32.const 3) (i32.const 0) (i32.const 100) (i32.const 9) (i32.const 0) (i64.const 2) (i64.const 0) (i32.const 0) (i32.const 0))) br 0)))"#
    );
    assert_eq!(execute(&opens).receipt.failure, Some(Failure::OutputLimit));
}

#[test]
fn concurrent_guests_have_independent_environment_and_output() {
    let guests: Vec<_> = (0..2).map(|n| std::thread::spawn(move || {
        let wat = r#"(module
          (import "wasi_snapshot_preview1" "environ_sizes_get" (func $env (param i32 i32) (result i32)))
          (memory (export "memory") 1)
          (func (export "_start")
            (drop (call $env (i32.const 0) (i32.const 4)))
            (if (i32.ne (i32.load (i32.const 0)) (i32.const 1)) (then unreachable))))"#;
        let (_root, mut p, input) = fixture(wat);
        p.environment.insert("LANG".into(), format!("C{n}"));
        p.owner = format!("window:independent-{n}");
        Prepared::new(p, vec![input], vec![]).unwrap().run(&|| false)
    })).collect();
    for guest in guests {
        assert_eq!(guest.join().unwrap().receipt.failure, None);
    }
    assert_eq!(execute(EMPTY).receipt.failure, None);
}

#[test]
fn stdout_and_stderr_share_one_strict_budget() {
    let wat = format!(
        r#"(module {WRITE} (memory (export "memory") 1)
       (data (i32.const 100) "output")
       (func (export "_start")
         (i32.store (i32.const 0) (i32.const 100)) (i32.store (i32.const 4) (i32.const 6))
         (loop (drop (call $write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 8)))
               (drop (call $write (i32.const 2) (i32.const 0) (i32.const 1) (i32.const 8))) br 0)))"#
    );
    let result = execute(&wat);
    assert_eq!(result.receipt.failure, Some(Failure::OutputLimit));
    assert!(result.output.len() <= policy().limits.output_bytes);
    assert!(!result.output.is_empty());
    assert_eq!(result.receipt.cleanup, Cleanup::Verified);
}

#[test]
fn declared_outputs_are_staged_and_never_applied_to_workspace() {
    let wat = format!(
        r#"(module {OPEN} {WRITE} (memory (export "memory") 1)
      (data (i32.const 100) "scratch/result.txt") (data (i32.const 200) "proposed")
      (func (export "_start")
        (if (call $open (i32.const 3) (i32.const 0) (i32.const 100) (i32.const 18) (i32.const 1) (i64.const 64) (i64.const 0) (i32.const 0) (i32.const 16)) (then unreachable))
        (i32.store (i32.const 0) (i32.const 200)) (i32.store (i32.const 4) (i32.const 8))
        (if (call $write (i32.load (i32.const 16)) (i32.const 0) (i32.const 1) (i32.const 8)) (then unreachable))))"#
    );
    let (_root, p, input) = fixture(&wat);
    let workspace = p.workspace.clone();
    let result = Prepared::new(p, vec![input], vec!["result.txt".into()])
        .unwrap()
        .run(&|| false);
    assert_eq!(result.receipt.failure, None);
    assert_eq!(result.files.get("result.txt").unwrap(), b"proposed");
    assert!(!workspace.join("result.txt").exists());
}

#[test]
fn memory_growth_is_bounded() {
    let wat = r#"(module (memory (export "memory") 1) (func (export "_start") (drop (memory.grow (i32.const 65535)))))"#;
    assert_eq!(execute(wat).receipt.failure, Some(Failure::GuestTrap));
}

#[test]
fn pure_loop_is_fuel_bounded_and_wall_clock_cancellable() {
    let (_root, mut p, input) = fixture(LOOP);
    p.limits.cpu_time_ms = 100;
    assert_eq!(
        Prepared::new(p, vec![input], vec![])
            .unwrap()
            .run(&|| false)
            .receipt
            .failure,
        Some(Failure::FuelLimit)
    );
    let (_root, mut p, input) = fixture(LOOP);
    p.limits.timeout_ms = 100;
    let started = Instant::now();
    assert_eq!(
        Prepared::new(p, vec![input], vec![])
            .unwrap()
            .run(&|| false)
            .receipt
            .failure,
        Some(Failure::Timeout)
    );
    assert!(started.elapsed() < Duration::from_secs(5));
    let (_root, p, input) = fixture(LOOP);
    let started = Instant::now();
    assert_eq!(
        Prepared::new(p, vec![input], vec![])
            .unwrap()
            .run(&|| started.elapsed() > Duration::from_millis(50))
            .receipt
            .failure,
        Some(Failure::Cancelled)
    );
}

#[test]
fn malformed_or_native_programs_never_execute() {
    let (_root, mut p, _) = fixture(EMPTY);
    for data in [b"MZ native executable".as_slice(), b"\0asm\x01\0\0\0broken"] {
        fs::write(&p.executable.path, data).unwrap();
        p.executable.sha256 = format!("{:x}", Sha256::digest(data));
        assert_eq!(
            Prepared::new(p.clone(), vec![], vec![])
                .unwrap()
                .run(&|| false)
                .receipt
                .failure,
            Some(Failure::InvalidModule)
        );
    }
}

#[test]
fn sparse_growth_links_and_descriptor_reassignment_are_disabled() {
    let wat = r#"(module
      (import "wasi_snapshot_preview1" "fd_allocate" (func $alloc (param i32 i64 i64) (result i32)))
      (import "wasi_snapshot_preview1" "path_symlink" (func $link (param i32 i32 i32 i32 i32) (result i32)))
      (import "wasi_snapshot_preview1" "path_link" (func $hard (param i32 i32 i32 i32 i32 i32 i32) (result i32)))
      (import "wasi_snapshot_preview1" "fd_renumber" (func $move (param i32 i32) (result i32)))
      (memory (export "memory") 1)
      (func (export "_start")
        (if (i32.ne (call $alloc (i32.const 3) (i64.const 0) (i64.const 999999999999)) (i32.const 58)) (then unreachable))
        (if (i32.ne (call $link (i32.const 0) (i32.const 0) (i32.const 3) (i32.const 0) (i32.const 0)) (i32.const 58)) (then unreachable))
        (if (i32.ne (call $hard (i32.const 3) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 3) (i32.const 0) (i32.const 0)) (i32.const 58)) (then unreachable))
        (if (i32.ne (call $move (i32.const 1) (i32.const 4)) (i32.const 58)) (then unreachable))))"#;
    assert_eq!(execute(wat).receipt.failure, None);
}

#[test]
fn guest_clock_wait_is_interruptible_without_consuming_wasm_fuel() {
    let wat = r#"(module
      (import "wasi_snapshot_preview1" "poll_oneoff" (func $poll (param i32 i32 i32 i32) (result i32)))
      (memory (export "memory") 1)
      (func (export "_start")
        (i64.store (i32.const 24) (i64.const 60000000000))
        (drop (call $poll (i32.const 0) (i32.const 64) (i32.const 1) (i32.const 128)))))"#;
    let (_root, mut p, input) = fixture(wat);
    p.limits.timeout_ms = 100;
    let started = Instant::now();
    let result = Prepared::new(p, vec![input], vec![])
        .unwrap()
        .run(&|| false);
    assert_eq!(result.receipt.failure, Some(Failure::Timeout));
    assert!(started.elapsed() < Duration::from_secs(5));
}

#[tokio::test]
async fn execution_lease_atomic_receipts_cancellation_and_failed_finish() {
    use super::super::super::execution::confinement::fixture as journal;
    use crate::modules::net::inference::InferenceState;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    // One async test owns admission slots so unrelated parallel unit tests do
    // not turn this production concurrency bound into a test ordering race.
    for mode in ["success", "cancel", "revoke", "failed-finish", "drop"] {
        let (root, p, input) = fixture(if mode == "success" || mode == "failed-finish" {
            EMPTY
        } else {
            LOOP
        });
        let prepared = Prepared::new(p.clone(), vec![input], vec![]).unwrap();
        let stage = prepared.directory().to_owned();
        let state = InferenceState::default();
        let id = state.open(&p.owner).unwrap();
        let lease = state.start(&p.owner, &id).unwrap();
        let path = root.path().join("ledger.json");
        let revoked = Arc::new(AtomicBool::new(false));
        let sink = journal(
            path.clone(),
            &p,
            &id,
            revoked.clone(),
            mode == "failed-finish",
        );
        let mut task = tokio::spawn(prepared.execute(lease, sink));
        if matches!(mode, "cancel" | "revoke" | "drop") {
            tokio::time::sleep(Duration::from_millis(50)).await;
            if mode == "cancel" {
                state.cancel(&p.owner, &id).await;
            }
            if mode == "revoke" {
                revoked.store(true, Ordering::Release);
            }
            if mode == "drop" {
                task.abort();
                assert!(task.await.unwrap_err().is_cancelled());
                tokio::time::timeout(Duration::from_secs(5), async {
                    while stage.exists() || state.completion(&id).is_some() {
                        tokio::time::sleep(Duration::from_millis(10)).await;
                    }
                })
                .await
                .unwrap();
                let disk: serde_json::Value =
                    serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
                assert_eq!(disk["executions"]["records"][0]["state"], "cancelled");
                continue;
            }
        }
        let result = tokio::time::timeout(Duration::from_secs(5), &mut task)
            .await
            .unwrap()
            .unwrap();
        if mode == "failed-finish" {
            assert!(matches!(result, Err(Failure::Persistence)));
        } else {
            assert_eq!(
                result.unwrap().receipt.failure,
                match mode {
                    "success" => None,
                    "cancel" => Some(Failure::Cancelled),
                    _ => Some(Failure::StalePolicy),
                }
            );
        }
        assert!(!stage.exists());
        assert!(state.completion(&id).is_none());
        let disk: serde_json::Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        let record = &disk["executions"]["records"][0];
        assert_eq!(
            record["state"],
            match mode {
                "success" => "succeeded",
                "failed-finish" => "running",
                _ => "cancelled",
            }
        );
        assert!(record["confinement"].get("environment").is_none());
    }
}
