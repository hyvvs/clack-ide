use super::*;

pub(super) fn policy() -> Policy {
    let root = std::env::current_dir().unwrap();
    Policy {
        version: POLICY_VERSION,
        capability_version: CAPABILITY_VERSION.into(),
        executable: Executable {
            path: std::env::current_exe().unwrap(),
            sha256: "a".repeat(64),
            argv: vec![],
        },
        workspace: root.clone(),
        cwd: root.clone(),
        read_roots: vec![root],
        write_roots: vec![],
        denied_paths: vec![],
        environment: Default::default(),
        children: Children::Forbidden,
        network: Network::Deny,
        limits: limits(),
        owner: "window:main/run:42".into(),
        definition_hash: "b".repeat(64),
    }
}
pub(super) fn limits() -> Limits {
    Limits {
        timeout_ms: 3000,
        output_bytes: 16384,
        memory_bytes: 128 * 1024 * 1024,
        processes: 1,
        cpu_time_ms: 2000,
    }
}

#[test]
fn confinement_policy_is_bounded_versioned_and_never_permission_bypassable() {
    let p = policy();
    assert!(p.validate().is_ok());
    assert!(p.check_host().is_ok());
    assert!(!capabilities().process_tools_enabled);
    assert!(capabilities().exact_filesystem_roots);
    assert!(capabilities().denied_secret_paths);
    let mut changed = p.clone();
    changed.version += 1;
    assert_eq!(changed.check_host(), Err(Failure::StalePolicy));
    changed = p.clone();
    changed.capability_version = "old".into();
    assert_eq!(changed.check_host(), Err(Failure::StalePolicy));
    changed = p.clone();
    changed.executable.path = "unreviewed.exe".into();
    assert_eq!(changed.validate(), Err(Failure::InvalidPolicy));
    for key in [
        "PATH",
        "OPENAI_API_KEY",
        "GITHUB_TOKEN",
        "AWS_SECRET_ACCESS_KEY",
        "SSH_AUTH_SOCK",
        "HTTP_PROXY",
        "NODE_OPTIONS",
        "PYTHONPATH",
        "USERPROFILE",
        "CLACK_CONFIG",
    ] {
        changed = p.clone();
        changed.environment.insert(key.into(), "CANARY".into());
        assert_eq!(changed.validate(), Err(Failure::InvalidPolicy), "{key}");
    }
    changed = p.clone();
    changed.environment.insert("LANG".into(), "C".into());
    assert!(changed.validate().is_ok());
    assert_ne!(changed.digest().unwrap(), p.digest().unwrap());
}

#[test]
fn confinement_identity_changes_invalidate_the_native_policy_digest() {
    let p = policy();
    let mut changes = vec![p.clone(); 7];
    changes[0].executable.sha256 = "c".repeat(64);
    changes[1].executable.argv.push("different".into());
    changes[2].owner = "another-window/run:7".into();
    changes[3].definition_hash = "d".repeat(64);
    changes[4].limits.timeout_ms += 1;
    changes[5].denied_paths.push(p.workspace.join(".env"));
    changes[6].cwd = p.workspace.join("other");
    for changed in changes {
        assert_ne!(changed.digest().unwrap(), p.digest().unwrap());
    }
}

#[test]
fn confinement_receipt_is_bounded_and_cleanup_never_implies_verified_recovery() {
    let mut unsupported = policy();
    unsupported.children = Children::Contained;
    let receipt = Receipt::blocked(&unsupported).unwrap();
    assert_eq!(receipt.cleanup, Cleanup::NotStarted);
    assert!(receipt.validate().is_ok());
    let json = serde_json::to_value(&receipt).unwrap();
    assert!(serde_json::to_vec(&receipt).unwrap().len() < 4096);
    for (field, value) in [
        ("policyVersion", serde_json::json!(999)),
        ("capabilityVersion", serde_json::json!("unknown")),
        ("policyHash", serde_json::json!("invalid")),
        ("cleanup", serde_json::json!("failed")),
    ] {
        let mut broken = json.clone();
        broken[field] = value;
        assert!(serde_json::from_value::<Receipt>(broken)
            .unwrap()
            .validate()
            .is_err());
    }
    let mut untrusted = json;
    untrusted["pid"] = serde_json::json!(1234);
    assert!(serde_json::from_value::<Receipt>(untrusted).is_err());
}

#[cfg(all(windows, feature = "native-confinement-probes"))]
mod native {
    use super::super::windows::{acl, Capsule};
    use super::*;
    use std::fs;
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        LazyLock,
    };
    use std::time::{Duration, Instant};

    static FIXTURE: LazyLock<Vec<u8>> = LazyLock::new(|| {
        let root = tempfile::tempdir().unwrap();
        let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/confinement_probe.rs");
        let result = Command::new("rustc")
            .arg(source)
            .args(["--edition=2021", "-C", "opt-level=1", "-o"])
            .arg(root.path().join("probe.exe"))
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        fs::read(root.path().join("probe.exe")).unwrap()
    });
    fn capsule() -> Capsule {
        Capsule::new(&FIXTURE).unwrap()
    }
    fn run(c: &Capsule, args: &[&str]) -> super::super::windows::Outcome {
        c.run(
            &args.iter().map(|s| (*s).into()).collect::<Vec<_>>(),
            &limits(),
            Children::Forbidden,
            &AtomicBool::new(false),
        )
        .unwrap()
    }

    fn staged_policy(root: &Path, args: &[&str]) -> Policy {
        use sha2::{Digest, Sha256};
        let mut p = policy();
        p.workspace = root.to_path_buf();
        p.cwd = p.workspace.clone();
        p.read_roots = vec![p.workspace.clone()];
        p.executable.path = root.join("reviewed.exe");
        fs::write(&p.executable.path, &*FIXTURE).unwrap();
        p.executable.sha256 = format!("{:x}", Sha256::digest(&*FIXTURE));
        p.executable.argv = args.iter().map(|v| v.to_string()).collect();
        p.environment.insert("LANG".into(), "C".into());
        p
    }

    #[test]
    fn native_materialized_boundary_independent_copy_and_hardlink_rejection() {
        use super::super::staged::{Input, Prepared};
        use sha2::{Digest, Sha256};
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        };
        let source = tempfile::tempdir().unwrap();
        let allowed = source.path().join("approved.txt");
        fs::write(&allowed, "allowed input").unwrap();
        let secret = source.path().join(".env");
        let alias = source.path().join("alias.txt");
        fs::write(&secret, "MATERIALIZED_SECRET").unwrap();
        fs::hard_link(&secret, &alias).unwrap();
        let input = Input {
            source: allowed.clone(),
            name: "input.txt".into(),
            sha256: format!("{:x}", Sha256::digest(b"allowed input")),
        };
        let p = staged_policy(
            source.path(),
            &["files", secret.to_str().unwrap(), alias.to_str().unwrap()],
        );
        let rejected = Input {
            source: alias.clone(),
            name: "innocent.txt".into(),
            sha256: format!("{:x}", Sha256::digest(b"MATERIALIZED_SECRET")),
        };
        assert!(matches!(
            Prepared::new(p.clone(), vec![rejected], vec![]),
            Err(Failure::InvalidPolicy)
        ));
        let staged = Prepared::new(p, vec![input], vec!["ok.txt".into()]).unwrap();
        let root = staged.directory().to_path_buf();
        let identity = |path: &Path| {
            let file = fs::File::open(path).unwrap();
            let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
            assert_ne!(
                unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) },
                0
            );
            (
                info.dwVolumeSerialNumber,
                info.nFileIndexHigh,
                info.nFileIndexLow,
                info.nNumberOfLinks,
            )
        };
        assert_ne!(identity(&allowed), identity(&root.join("input.txt")));
        assert_eq!(identity(&root.join("input.txt")).3, 1);
        let result = staged.run_drive_only_probe(&|| false);
        assert_eq!(result.receipt.failure, None, "{result:?}");
        assert_eq!(result.receipt.cleanup, Cleanup::Verified);
        let text = String::from_utf8_lossy(&result.output);
        assert!(text.contains("allowed=allowed input"), "{text}");
        assert!(
            text.contains("read0=false") && text.contains("read1=false"),
            "{text}"
        );
        assert_eq!(result.files["ok.txt"], b"scratch");
        assert!(!root.exists());
        assert_eq!(fs::read(&secret).unwrap(), b"MATERIALIZED_SECRET");
        assert_eq!(fs::read(&allowed).unwrap(), b"allowed input");
        assert!(!source.path().join("ok.txt").exists());
    }

    #[test]
    fn native_lpac_filesystem_canaries_and_exact_root_counterexample() {
        let c = capsule();
        let outside = tempfile::tempdir().unwrap();
        let private = outside.path().join(".env");
        fs::write(&private, "PRIVATE_SECRET_CANARY").unwrap();
        let broad = outside.path().join("outside-shared.txt");
        fs::write(&broad, "SHARED_PATH_STILL_OUTSIDE_POLICY").unwrap();
        // This is an owned test directory only. An attacker-controlled/shared
        // ACL proves LPAC cannot promise arbitrary denied-path confidentiality.
        acl(outside.path(), "S-1-15-2-2", "GRGX").unwrap();
        acl(&private, "S-1-15-2-1", "GR").unwrap();
        acl(&broad, "S-1-15-2-2", "GR").unwrap();
        let result = run(
            &c,
            &["files", private.to_str().unwrap(), broad.to_str().unwrap()],
        );
        let text = String::from_utf8_lossy(&result.output);
        assert_eq!(result.exit, 0, "{result:?}");
        assert!(result.cleaned);
        assert_eq!(result.failure, None, "{result:?}");
        assert!(text.contains("allowed=allowed input"), "{text}");
        assert!(text.contains("scratch=true"), "{text}");
        assert!(text.contains("readonly=false"), "{text}");
        assert!(text.contains("read0=false"), "{text}");
        assert!(
            text.contains("read1=true"),
            "Expected explicit unsupported-exact-root evidence: {text}"
        );
        assert!(
            text.contains("write0=false") && text.contains("write1=false"),
            "{text}"
        );
        assert!(policy().check_host().is_ok());
    }

    #[test]
    fn native_psec_direct_paths_respect_read_write_and_deny_rules() {
        let c = capsule();
        let outside = tempfile::tempdir().unwrap();
        let broad = outside.path().join("outside.txt");
        fs::write(&broad, "OUTSIDE_CANARY").unwrap();
        acl(outside.path(), "S-1-15-2-2", "GRGX").unwrap();
        acl(&broad, "S-1-15-2-2", "GR").unwrap();
        let denied = c.root.path().join("scratch").join(".env");
        fs::write(&denied, "DENIED_SECRET_CANARY").unwrap();
        let args = vec![
            "files".into(),
            broad.to_string_lossy().into_owned(),
            denied.to_string_lossy().into_owned(),
        ];
        let result = c
            .run_psec(
                &args,
                &limits(),
                Children::Forbidden,
                &AtomicBool::new(false),
                &denied,
            )
            .unwrap();
        let text = String::from_utf8_lossy(&result.output);
        assert_eq!(result.exit, 0, "{result:?}");
        assert!(text.contains("allowed=allowed input"), "{text}");
        assert!(text.contains("scratch=true"), "{text}");
        assert!(text.contains("readonly=false"), "{text}");
        assert!(
            text.contains("read0=false"),
            "PSEC exact-root failure: {text}"
        );
        assert!(
            text.contains("read1=false"),
            "PSEC denied-path failure: {text}"
        );
    }

    #[test]
    fn native_psec_alias_counterexample_keeps_production_disabled() {
        let c = capsule();
        let outside = tempfile::tempdir().unwrap();
        let broad = outside.path().join("outside.txt");
        fs::write(&broad, "OUTSIDE_CANARY").unwrap();
        acl(outside.path(), "S-1-15-2-2", "GRGX").unwrap();
        acl(&broad, "S-1-15-2-2", "GR").unwrap();
        let scratch = c.root.path().join("scratch");
        let denied = scratch.join(".env");
        fs::write(&denied, "DENIED_SECRET_CANARY").unwrap();
        let alias = scratch.join("innocent.txt");
        fs::hard_link(&denied, &alias).unwrap();
        let link = scratch.join("outside-link");
        let status = Command::new("cmd.exe")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(&link)
            .arg(outside.path())
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(status.status.success(), "{status:?}");
        let paths = [
            broad.clone(),
            PathBuf::from(broad.to_string_lossy().to_uppercase()),
            PathBuf::from(format!("\\\\?\\{}", broad.display())),
            link.join("outside.txt"),
            scratch.join("..").join("scratch").join(".env"),
            alias,
        ];
        let args = std::iter::once("files".to_string())
            .chain(paths.iter().map(|p| p.to_string_lossy().into_owned()))
            .collect::<Vec<_>>();
        let result = c
            .run_psec(
                &args,
                &limits(),
                Children::Forbidden,
                &AtomicBool::new(false),
                &denied,
            )
            .unwrap();
        fs::remove_dir(&link).unwrap();
        let text = String::from_utf8_lossy(&result.output);
        assert_eq!(result.exit, 0, "{result:?}");
        for index in 0..paths.len() - 1 {
            assert!(
                text.contains(&format!("read{index}=false")),
                "PSEC alias {index}: {text}"
            );
        }
        // This is a counterexample, NOT a passing exact-secret confinement test.
        // A path deny does not identify all links to the denied file object.
        assert!(
            text.contains("read5=true"),
            "Re-evaluate PSEC capability: {text}"
        );
        assert!(
            text.contains("write5=true"),
            "Re-evaluate PSEC capability: {text}"
        );
        assert!(!capabilities().process_tools_enabled);
        assert!(!capabilities().process_tools_enabled);
        assert!(policy().check_host().is_ok());
    }

    #[test]
    fn native_secret_pin_alone_does_not_prevent_new_hardlinks() {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ;
        let dir = tempfile::tempdir().unwrap();
        let secret = dir.path().join(".env");
        fs::write(&secret, "SECRET_CANARY").unwrap();
        let _pin = fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .open(&secret)
            .unwrap();
        let result = fs::hard_link(&secret, dir.path().join("alias.txt"));
        assert!(
            result.is_ok(),
            "Re-evaluate the file-pin counterexample: {result:?}"
        );
        assert!(!capabilities().process_tools_enabled);
    }

    #[test]
    fn native_psec_child_cannot_create_denied_secret_alias() {
        let c = capsule();
        let denied = c.root.path().join("scratch").join(".env");
        fs::write(&denied, "DENIED_SECRET_CANARY").unwrap();
        let result = c
            .run_psec(
                &["hardlink".into(), denied.to_string_lossy().into_owned()],
                &limits(),
                Children::Forbidden,
                &AtomicBool::new(false),
                &denied,
            )
            .unwrap();
        let text = String::from_utf8_lossy(&result.output);
        assert_eq!(result.exit, 0, "{result:?}");
        assert!(text.contains("link=false"), "{text}");
        assert!(text.contains("read=false"), "{text}");
    }

    #[test]
    fn native_sbox_contract_and_outside_secret_hardlink_probe() {
        let c = capsule();
        let outside = tempfile::tempdir().unwrap();
        let secret = outside.path().join(".env");
        fs::write(&secret, "SBOX_SECRET_CANARY").unwrap();
        acl(outside.path(), "S-1-15-2-2", "GRGX").unwrap();
        acl(&secret, "S-1-15-2-2", "GR").unwrap();
        let alias = c.root.path().join("scratch").join("alias.txt");
        fs::hard_link(&secret, &alias).unwrap();
        let args = vec![
            "sbox-files".into(),
            secret.to_string_lossy().into_owned(),
            alias.to_string_lossy().into_owned(),
        ];
        let unsupported = c.run_sbox(&args, "999.0.0");
        eprintln!("SBOX unsupported version result: {unsupported:?}");
        assert!(unsupported.is_err());
        let result = c.run_sbox(&args, "0.1.0");
        eprintln!("SBOX actual contract result: {result:?}");
        let result = result.unwrap();
        let text = String::from_utf8_lossy(&result.output);
        assert_eq!(result.exit, 0, "{result:?}");
        assert!(text.contains("allowed=allowed input"), "{text}");
        assert!(
            text.contains("read0=true"),
            "Re-evaluate SBOX counterexample: {text}"
        );
        assert!(
            text.contains("read1=true"),
            "Re-evaluate SBOX hardlink counterexample: {text}"
        );
        assert!(!capabilities().process_tools_enabled);
    }

    #[test]
    fn native_staged_minimal_runtime_denies_original_and_alias() {
        assert!(super::super::psec::Environment::supported());
        let c = capsule();
        let source = tempfile::tempdir().unwrap();
        let secret = source.path().join(".env");
        let alias = source.path().join("innocent.txt");
        fs::write(&secret, "STAGING_SECRET_CANARY").unwrap();
        fs::hard_link(&secret, &alias).unwrap();
        acl(source.path(), "S-1-15-2-2", "GRGX").unwrap();
        acl(&secret, "S-1-15-2-2", "GR").unwrap();
        let args = vec![
            "files".into(),
            secret.to_string_lossy().into_owned(),
            alias.to_string_lossy().into_owned(),
        ];
        let result = c
            .run_staged(
                &args,
                &limits(),
                Children::Forbidden,
                &AtomicBool::new(false),
            )
            .unwrap();
        let text = String::from_utf8_lossy(&result.output);
        assert_eq!(result.exit, 0, "{result:?}");
        assert!(text.contains("allowed=allowed input"), "{text}");
        assert!(
            text.contains("read0=false") && text.contains("read1=false"),
            "{text}"
        );
        assert!(
            text.contains("scratch=true") && text.contains("readonly=false"),
            "{text}"
        );
    }

    #[test]
    fn native_reviewed_fixture_runtime_dependencies() {
        let root = tempfile::tempdir().unwrap();
        let exe = root.path().join("runtime-probe.exe");
        fs::write(&exe, &*FIXTURE).unwrap();
        let result = Command::new(exe)
            .arg("runtime")
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(result.status.success(), "{result:?}");
        eprintln!(
            "Reviewed fixture runtime: {}",
            String::from_utf8_lossy(&result.stdout)
        );
    }

    #[test]
    fn native_staged_file_id_cannot_open_an_outside_secret() {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        };
        let c = capsule();
        let outside = tempfile::tempdir().unwrap();
        let secret = outside.path().join(".env");
        fs::write(&secret, "FILE_ID_CANARY").unwrap();
        acl(outside.path(), "S-1-15-2-2", "GRGX").unwrap();
        acl(&secret, "S-1-15-2-2", "GR").unwrap();
        let file = fs::File::open(&secret).unwrap();
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        assert_ne!(
            unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) },
            0
        );
        let id = ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64;
        let result = c
            .run_staged(
                &["file-id".into(), id.to_string()],
                &limits(),
                Children::Forbidden,
                &AtomicBool::new(false),
            )
            .unwrap();
        assert_eq!(result.exit, 0, "{result:?}");
        assert!(
            String::from_utf8_lossy(&result.output).contains("file-id-readable=false"),
            "{result:?}"
        );
    }

    #[test]
    fn native_staged_backend_lifecycle_and_network_probe() {
        let c = capsule();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let result = c
            .run_staged(
                &[
                    "network".into(),
                    listener.local_addr().unwrap().to_string(),
                    "192.0.2.1:9".into(),
                    "10.254.254.254:9".into(),
                    "[::1]:9".into(),
                ],
                &limits(),
                Children::Forbidden,
                &AtomicBool::new(false),
            )
            .unwrap();
        let text = String::from_utf8_lossy(&result.output);
        assert_eq!(result.exit, 0, "{result:?}");
        assert_eq!(text.matches("tcp=Some(10013)").count(), 4, "{text}");
        eprintln!("Staged socket API outcomes: {text}");
        assert!(listener.accept().is_err());
        let result = c
            .run_staged(
                &["flood".into()],
                &limits(),
                Children::Forbidden,
                &AtomicBool::new(false),
            )
            .unwrap();
        assert_eq!(result.failure, Some(Failure::OutputLimit), "{result:?}");
        assert!(result.cleaned);
        let mut bounds = limits();
        bounds.processes = 4;
        bounds.timeout_ms = 1500;
        for mode in ["tree", "parent-exit", "breakaway"] {
            let result = c
                .run_staged(
                    &[mode.into()],
                    &bounds,
                    Children::Contained,
                    &AtomicBool::new(false),
                )
                .unwrap();
            assert!(result.cleaned, "{result:?}");
            let text = String::from_utf8_lossy(&result.output);
            if mode == "tree" {
                assert_eq!(result.failure, Some(Failure::Timeout), "{result:?}");
                assert!(text.contains("spawned=grandchild"), "{text}");
            }
            if mode == "breakaway" {
                assert!(text.contains("child-denied"), "{text}");
            }
        }
        let cancel = AtomicBool::new(false);
        std::thread::scope(|scope| {
            scope.spawn(|| {
                std::thread::sleep(Duration::from_millis(700));
                cancel.store(true, Ordering::Release);
            });
            let result = c
                .run_staged(&["tree".into()], &bounds, Children::Contained, &cancel)
                .unwrap();
            assert_eq!(result.failure, Some(Failure::Cancelled), "{result:?}");
            assert!(result.cleaned);
        });
        // Release our executable pin before checking actual capsule cleanup.
        // A still-mapped fixture would prevent deletion on Windows.
        let root = c.root.path().to_path_buf();
        drop(c);
        assert!(!root.exists(), "Owned fixture still mapped: {root:?}");
    }

    #[test]
    fn native_staged_udp_packet_cannot_reach_host_receiver() {
        let receiver = std::net::UdpSocket::bind("0.0.0.0:0").unwrap();
        receiver
            .set_read_timeout(Some(Duration::from_millis(800)))
            .unwrap();
        let port = receiver.local_addr().unwrap().port();
        let control = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        control
            .send_to(b"positive-control", format!("127.0.0.1:{port}"))
            .unwrap();
        let mut control_bytes = [0; 128];
        assert_eq!(
            receiver.recv_from(&mut control_bytes).unwrap().0,
            b"positive-control".len()
        );
        let route = std::net::UdpSocket::bind("0.0.0.0:0").unwrap();
        route.connect("192.0.2.1:9").unwrap();
        let address = route.local_addr().unwrap().ip();
        let c = capsule();
        let result = c
            .run_staged(
                &[
                    "udp".into(),
                    format!("127.0.0.1:{port}"),
                    format!("{address}:{port}"),
                ],
                &limits(),
                Children::Forbidden,
                &AtomicBool::new(false),
            )
            .unwrap();
        eprintln!("Staged UDP sender: {result:?}");
        assert_eq!(result.exit, 0, "{result:?}");
        let mut bytes = [0; 128];
        let received = receiver.recv_from(&mut bytes);
        assert!(received.is_err(), "Confined UDP reached host: {received:?}");
    }

    #[test]
    fn native_namespace_deny_across_both_host_drives() {
        let c = capsule();
        let other = tempfile::Builder::new()
            .prefix("clack-confinement-drive-")
            .tempdir_in("A:\\")
            .unwrap();
        let system = tempfile::tempdir().unwrap();
        let paths = [
            system.path().join("canary.txt"),
            other.path().join("canary.txt"),
        ];
        for (directory, path) in [(system.path(), &paths[0]), (other.path(), &paths[1])] {
            fs::write(path, "OUTSIDE_DRIVE_CANARY").unwrap();
            if directory == system.path() {
                acl(directory, "S-1-15-2-2", "GRGX").unwrap();
                acl(path, "S-1-15-2-2", "GR").unwrap();
            }
        }
        let args = std::iter::once("files".to_string())
            .chain(paths.iter().map(|p| p.to_string_lossy().into_owned()))
            .collect::<Vec<_>>();
        for denied in ["\\", "\\Device\\"] {
            let result = c.run_namespace(&args, &[PathBuf::from(denied)]).unwrap();
            let text = String::from_utf8_lossy(&result.output);
            eprintln!("Namespace {denied:?}: exit={} {text}", result.exit);
            assert_eq!(result.exit, 0, "{result:?}");
            if denied == "\\Device\\" {
                assert!(
                    text.contains("read0=true"),
                    "Re-evaluate ineffective namespace rule: {text}"
                );
            } else {
                assert!(text.contains("read0=false"), "{text}");
            }
        }
    }

    #[tokio::test]
    async fn native_strict_materialization_refuses_incomplete_volume_policy_and_records_failure() {
        use super::super::{super::execution::confinement::fixture, staged::Prepared};
        use crate::modules::net::inference::InferenceState;
        use std::sync::Arc;
        let source = tempfile::tempdir().unwrap();
        let p = staged_policy(source.path(), &["sleep"]);
        let prepared = Prepared::new(p.clone(), vec![], vec![]).unwrap();
        let root = prepared.directory().to_path_buf();
        let state = InferenceState::default();
        let id = state.open(&p.owner).unwrap();
        let lease = state.start(&p.owner, &id).unwrap();
        let ledger = source.path().join("execution.json");
        let journal = fixture(
            ledger.clone(),
            &p,
            &id,
            Arc::new(AtomicBool::new(false)),
            false,
        );
        journal.begin(prepared.receipt()).unwrap();
        let result = prepared.run_native_probe(&|| false);
        journal.finish(&result.receipt).unwrap();
        drop(lease);
        assert_eq!(result.receipt.failure, Some(Failure::UnsupportedFilesystem));
        assert_eq!(result.receipt.cleanup, Cleanup::NotStarted);
        assert!(result.output.is_empty());
        assert!(!root.exists());
        let disk: serde_json::Value = serde_json::from_slice(&fs::read(ledger).unwrap()).unwrap();
        assert_eq!(disk["executions"]["records"][0]["state"], "failed");
        assert_eq!(
            disk["executions"]["records"][0]["confinement"]["failure"],
            "unsupported-filesystem"
        );
        assert!(state.completion(&id).is_none());
        assert!(!capabilities().process_tools_enabled);
    }

    #[test]
    fn native_environment_is_explicit_not_inherited() {
        let c = capsule();
        // A unique canary cannot interfere with other tests' provider settings.
        std::env::set_var("CLACK_CONFINEMENT_PARENT_CANARY", "never-inherit");
        let result = run(&c, &["env"]);
        std::env::remove_var("CLACK_CONFINEMENT_PARENT_CANARY");
        assert_eq!(result.exit, 0, "{result:?}");
        let text = String::from_utf8_lossy(&result.output);
        assert_eq!(text.trim(), "LANG,LOCALAPPDATA,SystemRoot,TEMP,TMP\nlang=C");
    }

    #[test]
    fn native_raw_socket_egress_is_denied_without_proxy_logic() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let result = run(
            &capsule(),
            &[
                "network",
                &listener.local_addr().unwrap().to_string(),
                "192.0.2.1:9",
            ],
        );
        assert_eq!(result.exit, 0, "{result:?}");
        let text = String::from_utf8_lossy(&result.output);
        assert_eq!(text.matches("tcp=Some(10013)").count(), 2, "{text}");
        assert!(text.contains("udp=Some(10013)"), "{text}");
        assert!(listener.accept().is_err());
    }

    #[test]
    fn native_output_flood_is_bounded_and_does_not_deadlock() {
        let started = Instant::now();
        let result = run(&capsule(), &["flood"]);
        assert_eq!(result.failure, Some(Failure::OutputLimit), "{result:?}");
        assert!(result.cleaned);
        assert!(result.output.len() <= limits().output_bytes);
        assert!(result.output.contains(&b'o') && result.output.contains(&b'e'));
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn native_children_forbidden_and_breakaway_denied() {
        let c = capsule();
        for mode in ["child", "breakaway"] {
            let result = run(&c, &[mode]);
            assert_eq!(result.exit, 0, "{result:?}");
            assert!(result.cleaned);
            assert!(
                String::from_utf8_lossy(&result.output).contains("child-denied"),
                "{result:?}"
            );
        }
    }

    #[test]
    fn native_job_removes_descendants_on_timeout_cancel_and_parent_exit() {
        let c = capsule();
        let mut bounds = limits();
        bounds.processes = 4;
        bounds.timeout_ms = 1500;
        for mode in ["tree", "parent-exit", "breakaway"] {
            let result = c
                .run(
                    &[mode.into()],
                    &bounds,
                    Children::Contained,
                    &AtomicBool::new(false),
                )
                .unwrap();
            assert!(result.cleaned, "{result:?}");
            let text = String::from_utf8_lossy(&result.output);
            if mode == "tree" {
                assert_eq!(result.failure, Some(Failure::Timeout), "{result:?}");
                assert!(
                    text.contains("spawned=tree") && text.contains("spawned=grandchild"),
                    "{text}"
                );
            } else if mode == "breakaway" {
                assert!(text.contains("child-denied"), "{text}");
            } else {
                assert!(text.contains("spawned=parent-exit"), "{text}");
            }
        }
        let cancel = AtomicBool::new(false);
        std::thread::scope(|scope| {
            scope.spawn(|| {
                std::thread::sleep(Duration::from_millis(700));
                cancel.store(true, Ordering::Release);
            });
            let result = c
                .run(&["tree".into()], &bounds, Children::Contained, &cancel)
                .unwrap();
            assert!(result.cleaned);
            assert_eq!(result.failure, Some(Failure::Cancelled), "{result:?}");
        });
    }

    #[test]
    fn native_job_cpu_memory_and_process_limits_are_real() {
        let c = capsule();
        let mut bounds = limits();
        // Windows job CPU-time accounting is periodic, not a precise wall timer.
        bounds.timeout_ms = 15_000;
        bounds.cpu_time_ms = 100;
        bounds.memory_bytes = 32 * 1024 * 1024;
        for mode in ["cpu", "memory"] {
            let result = c
                .run(
                    &[mode.into()],
                    &bounds,
                    Children::Forbidden,
                    &AtomicBool::new(false),
                )
                .unwrap();
            assert!(result.cleaned);
            assert_eq!(
                result.failure,
                Some(Failure::ForcedTermination),
                "{mode}: {result:?}"
            );
            assert_ne!(result.exit, 0);
        }
        bounds.processes = 2;
        let result = c
            .run(
                &["tree".into()],
                &bounds,
                Children::Contained,
                &AtomicBool::new(false),
            )
            .unwrap();
        let text = String::from_utf8_lossy(&result.output);
        assert!(result.cleaned);
        assert!(
            text.contains("spawned=tree") && text.contains("child-denied"),
            "{text}"
        );
        assert!(!text.contains("spawned=grandchild"));
    }

    #[test]
    fn native_capture_pins_reviewed_bytes_cwd_and_rejects_changed_policy() {
        use sha2::{Digest, Sha256};
        let root = tempfile::tempdir().unwrap();
        let executable = root.path().join("reviewed.exe");
        fs::write(&executable, &*FIXTURE).unwrap();
        let mut p = policy();
        p.workspace = root.path().into();
        p.cwd = root.path().into();
        p.read_roots = vec![root.path().into()];
        p.executable.path = executable.clone();
        p.executable.sha256 = format!("{:x}", Sha256::digest(fs::read(&executable).unwrap()));
        let captured = Capture::new(&p).unwrap();
        assert!(captured.recheck(&p).is_ok());
        assert!(fs::write(&executable, "substituted").is_err());
        assert!(fs::rename(&executable, root.path().join("renamed.exe")).is_err());
        assert!(fs::rename(root.path(), root.path().with_extension("moved")).is_err());
        p.executable.argv.push("unreviewed-argument".into());
        assert_eq!(captured.recheck(&p), Err(Failure::StalePolicy));
        drop(captured);
        fs::write(&executable, "substituted").unwrap();
        assert!(matches!(Capture::new(&p), Err(Failure::ExecutableChanged)));
        p.cwd = root.path().join("missing");
        assert!(matches!(Capture::new(&p), Err(Failure::WorkspaceChanged)));
    }

    #[test]
    fn native_profile_and_scratch_cleanup_is_execution_scoped() {
        let c = capsule();
        let path = c.root.path().to_path_buf();
        let cancel = AtomicBool::new(true);
        assert!(matches!(
            c.run(&["sleep".into()], &limits(), Children::Forbidden, &cancel),
            Err(Failure::Cancelled)
        ));
        drop(c);
        assert!(!path.exists());
    }

    #[test]
    fn native_lpac_denies_private_paths_through_aliases_and_nested_junctions() {
        let c = capsule();
        let outside = tempfile::tempdir().unwrap();
        fs::create_dir(outside.path().join(".ssh")).unwrap();
        let secret = outside.path().join(".ssh/secret");
        fs::write(&secret, "SSH_PRIVATE_CANARY").unwrap();
        let link = c.root.path().join("scratch").join("link");
        let nested = outside.path().join("nested");
        for (link, target) in [
            (&link, outside.path()),
            (&nested, outside.path().join(".ssh").as_path()),
        ] {
            let result = Command::new("cmd.exe")
                .args(["/C", "mklink", "/J"])
                .arg(link)
                .arg(target)
                .creation_flags(0x08000000)
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{} {}",
                String::from_utf8_lossy(&result.stdout),
                String::from_utf8_lossy(&result.stderr)
            );
        }
        let alias = secret.to_string_lossy().to_ascii_uppercase();
        let device = format!("\\\\?\\{}", secret.display());
        let result = run(
            &c,
            &[
                "files",
                secret.to_str().unwrap(),
                "link/.ssh/secret",
                "link/nested/secret",
                &alias,
                &device,
            ],
        );
        let text = String::from_utf8_lossy(&result.output);
        assert_eq!(result.exit, 0, "{result:?}");
        for index in 0..5 {
            assert!(text.contains(&format!("read{index}=false")), "{text}");
            assert!(text.contains(&format!("write{index}=false")), "{text}");
        }
        assert_eq!(fs::read_to_string(&secret).unwrap(), "SSH_PRIVATE_CANARY");
        // Remove owned junctions themselves; never recurse into their targets.
        fs::remove_dir(link).unwrap();
        fs::remove_dir(nested).unwrap();
    }

    #[test]
    fn native_job_handle_closure_after_broker_death_kills_owned_child() {
        use std::io::BufRead;
        use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
        use windows_sys::Win32::System::Threading::{
            OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
        };
        struct Broker(std::process::Child);
        impl Drop for Broker {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("broker.exe");
        fs::write(&path, &*FIXTURE).unwrap();
        let mut broker = Broker(
            Command::new(path)
                .arg("job-broker")
                .creation_flags(0x08000000)
                .stdout(std::process::Stdio::piped())
                .spawn()
                .unwrap(),
        );
        let output = broker.0.stdout.take().unwrap();
        let (send, receive) = std::sync::mpsc::channel();
        let reader = std::thread::spawn(move || {
            let mut line = String::new();
            let result = std::io::BufReader::new(output).read_line(&mut line);
            let _ = send.send((result, line));
        });
        let line = receive.recv_timeout(Duration::from_secs(5));
        if line.is_err() {
            drop(broker);
            reader.join().unwrap();
            panic!("broker fixture did not start");
        }
        let (read, line) = line.unwrap();
        read.unwrap();
        reader.join().unwrap();
        let pid = line.trim().parse().unwrap();
        // Open only a wait handle while the broker still owns the live child.
        // No terminate rights or persisted PID-based cleanup are used.
        let child = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
        assert!(!child.is_null());
        assert_ne!(unsafe { WaitForSingleObject(child, 0) }, WAIT_OBJECT_0);
        drop(broker); // Abrupt process termination, not its Rust destructors.
        let wait = unsafe { WaitForSingleObject(child, 3000) };
        unsafe {
            CloseHandle(child);
        }
        assert_eq!(wait, WAIT_OBJECT_0);
    }
}
