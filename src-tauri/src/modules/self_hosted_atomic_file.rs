//! Physical write boundary for the EXISTING terax-settings.json authority.
//! This is not a qualification store or a transaction ledger. The complete
//! settings object is staged and its existing pathname replaced once.
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::Path;
use tempfile::Builder;

const TEMP_PREFIX: &str = ".terax-settings.json.txn-";
const TEMP_SUFFIX: &str = ".pending";
// Windows ReplaceFileW can move the replaced file before failing to rename
// the staged replacement. A fixed same-directory recovery name preserves the
// OLD complete settings file in that documented failure window. It is never
// an authority and is never replayed as a new qualifying effect.
const REPLACED_BACKUP: &str = ".terax-settings.json.replaced-backup";

fn old_backup_path(path: &Path) -> std::path::PathBuf {
    path.with_file_name(REPLACED_BACKUP)
}

/// Call under the existing native/interprocess lock, before reading the
/// authoritative path. After an interrupted Windows replacement, restore the
/// last intact old revision only when the authoritative name is ABSENT.
/// Never overwrite a present committed state, and never trust corrupt backup
/// bytes as an authoritative revision.
pub(super) fn recover_missing_replaced_file(path: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        if path.exists() { return Ok(()); }
        let backup = old_backup_path(path);
        if !backup.exists() { return Ok(()); }
        if !fs::symlink_metadata(&backup)?.file_type().is_file() {
            return Err(io::Error::other("Unsafe Windows settings backup type"));
        }
        let previous = fs::read(&backup)?;
        serde_json::from_slice::<serde_json::Map<String, serde_json::Value>>(&previous)
            .map_err(|_| io::Error::other("Corrupt Windows replacement recovery evidence"))?;
        fs::rename(&backup, path)?;
    }
    #[cfg(not(windows))]
    { let _ = path; }
    Ok(())
}

/// A single previous-revision Windows recovery artifact is intentionally
/// retained after successful replacement: Windows has no portable directory
/// entry fsync, and an OS crash can lose the new name. When the NEXT write is
/// safely staged, discard that obsolete old revision BEFORE the next fence,
/// so ReplaceFileW can preserve the current authoritative file in its place.
fn make_room_for_next_backup(path: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        let backup = old_backup_path(path);
        if backup.exists() {
            if !fs::symlink_metadata(&backup)?.file_type().is_file() {
                return Err(io::Error::other("Unsafe Windows settings backup type"));
            }
            fs::remove_file(backup)?;
        }
    }
    #[cfg(not(windows))]
    { let _ = path; }
    Ok(())
}

// No volume/driver changes: acceptance-only deterministic ENOSPC after the
// actual temp file has accepted its first half. Never compiled into normal
// Clack. The path MUST resolve inside the explicitly owned isolated root.
#[cfg(all(windows, feature = "lm11-b03-acceptance-harness"))]
fn acceptance_inject_disk_full(path: &Path) -> bool {
    if std::env::var("CLACK_LM11_B03_ACCEPTANCE_DISK_FULL").as_deref() != Ok("1") {
        return false;
    }
    acceptance_injection_path_owned(path)
}

#[cfg(all(windows, feature = "lm11-b03-acceptance-harness"))]
fn acceptance_injection_path_owned(path: &Path) -> bool {
    let Ok(root) = std::env::var("CLACK_LM11_B03_ACCEPTANCE_ROOT") else {return false};
    let Ok(root) = Path::new(&root).canonicalize() else {return false};
    super::managed_local_runtime::acceptance_is_owned_scenario_root(&root) &&
        path.file_name().is_some_and(|n| n == "terax-settings.json") &&
        path.parent().and_then(|p| p.canonicalize().ok()) ==
            root.join("data").canonicalize().ok()
}

/// Acceptance-only barrier after the actual staged temp is synced but before
/// the final guarded replacement. A second thread/process can revoke, rotate,
/// expire or kill the host while the native boundary is genuinely in flight.
#[cfg(all(windows, feature = "lm11-b03-acceptance-harness"))]
fn acceptance_pause_before_fence(path: &Path) {
    if std::env::var("CLACK_LM11_B03_ACCEPTANCE_PRE_FENCE").as_deref() != Ok("1") ||
        !acceptance_injection_path_owned(path) { return; }
    let root = std::path::PathBuf::from(
        std::env::var("CLACK_LM11_B03_ACCEPTANCE_ROOT").expect("owned root"));
    let marker = File::create(root.join("real-pre-fence.json")).expect("pre-fence marker");
    serde_json::to_writer(&marker, &serde_json::json!({
        "stage":"staged-and-synced-before-fence", "pid":std::process::id(), "target":path
    })).expect("pre-fence marker serialization");
    marker.sync_all().expect("pre-fence marker sync");
    std::thread::sleep(std::time::Duration::from_millis(1800));
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PhysicalOutcome {
    /// Explicit pre-replacement refusal; the authoritative pathname is intact.
    Fenced,
    /// Only the disposable temporary file was touched.
    FailedBeforeCommit,
    /// Replacement occurred, file readback/durability reconciliation follows.
    Crossed,
    /// Replacement may have occurred, or post-replace sync/ack was interrupted.
    RecoveryRequired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Step {
    Created, PartialWrite, Written, BeforeSync, Synced, BeforeFence, BeforeReplace,
    AfterReplace, DirectorySynced,
}

/// On Unix this is atomic namespace replacement on a local filesystem.
/// On Windows use ReplaceFileW (rather than truncation or ordinary rename);
/// only a previously absent target uses MoveFileExW with WRITE_THROUGH.
#[cfg(windows)]
pub(super) fn replace_file(temp: &Path, target: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, ReplaceFileW, MOVEFILE_WRITE_THROUGH,
    };
    let wide = |path: &Path| path.as_os_str().encode_wide()
        .chain(std::iter::once(0)).collect::<Vec<u16>>();
    let temp_name = wide(temp);
    let target_name = wide(target);
    let backup_name = wide(&old_backup_path(target));
    let success = unsafe {
        if target.exists() {
            ReplaceFileW(target_name.as_ptr(), temp_name.as_ptr(),
                backup_name.as_ptr(), 0, std::ptr::null(), std::ptr::null())
        } else {
            MoveFileExW(temp_name.as_ptr(), target_name.as_ptr(), MOVEFILE_WRITE_THROUGH)
        }
    };
    if success == 0 { Err(io::Error::last_os_error()) } else { Ok(()) }
}

#[cfg(unix)]
pub(super) fn replace_file(temp: &Path, target: &Path) -> io::Result<()> {
    fs::rename(temp, target)
}

#[cfg(not(any(unix, windows)))]
pub(super) fn replace_file(_temp: &Path, _target: &Path) -> io::Result<()> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "No atomic settings replacement primitive"))
}

fn sync_payload(file: &File) -> io::Result<()> {
    file.sync_all()?;
    // macOS fsync is not equivalent to asking the device to flush its cache.
    #[cfg(target_os = "macos")]
    {
        use std::os::fd::AsRawFd;
        if unsafe { libc::fcntl(file.as_raw_fd(), libc::F_FULLFSYNC) } != 0 {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(())
}

fn sync_parent(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    { File::open(path)?.sync_all() }
    #[cfg(windows)]
    {
        // Windows has no portable documented user-mode fsync(directory).
        // ReplaceFileW offers namespace replacement but *not* a claim of
        // power-loss durable directory metadata on every filesystem.
        let _ = path;
        Ok(())
    }
    #[cfg(not(any(unix, windows)))]
    { let _ = path; Err(io::Error::other("Unsupported settings directory sync")) }
}

pub(super) fn replace_settings_file(
    path: &Path, bytes: &[u8], fence: impl FnOnce() -> bool,
) -> PhysicalOutcome {
    replace_settings_file_with(path, bytes, fence, |_| Ok(()))
}

/// The guard is held by the caller until the replacement syscall has returned.
/// For qualification, this guard nests the existing ticket/cancellation mutex
/// and the managed RuntimeOwner lock. Do not release either in a bool callback.
pub(super) fn replace_settings_file_with_guard(
    path: &Path, bytes: &[u8],
    guarded_commit: impl FnOnce(&Path, &Path) -> PhysicalOutcome,
) -> PhysicalOutcome {
    replace_settings_file_with_guard_and_steps(path, bytes, guarded_commit, |_| Ok(()))
}

/// Deterministic test seam around the EXACT physical staging/replacement path.
/// A fault after replacement can only mean recovery-required, never a rollback
/// of an already-crossed commit. The caller must read the authoritative file.
pub(super) fn replace_settings_file_with(
    path: &Path, bytes: &[u8], fence: impl FnOnce() -> bool,
    step: impl FnMut(Step) -> io::Result<()>,
) -> PhysicalOutcome {
    replace_settings_file_with_guard_and_steps(path, bytes, |staged, target| {
        if !fence() { return PhysicalOutcome::Fenced; }
        if replace_file(staged, target).is_ok() {
            PhysicalOutcome::Crossed
        } else {
            PhysicalOutcome::RecoveryRequired
        }
    }, step)
}

fn replace_settings_file_with_guard_and_steps(
    path: &Path, bytes: &[u8],
    guarded_commit: impl FnOnce(&Path, &Path) -> PhysicalOutcome,
    mut step: impl FnMut(Step) -> io::Result<()>,
) -> PhysicalOutcome {
    let Some(parent) = path.parent() else { return PhysicalOutcome::FailedBeforeCommit };
    if fs::create_dir_all(parent).is_err() { return PhysicalOutcome::FailedBeforeCommit; }
    let mut file = match Builder::new().prefix(TEMP_PREFIX).suffix(TEMP_SUFFIX)
        .tempfile_in(parent) {
        Ok(file) => file,
        Err(_) => return PhysicalOutcome::FailedBeforeCommit,
    };
    if step(Step::Created).is_err() { return PhysicalOutcome::FailedBeforeCommit; }
    let split = bytes.len() / 2;
    if file.write_all(&bytes[..split]).is_err() {
        return PhysicalOutcome::FailedBeforeCommit;
    }
    #[cfg(all(windows, feature = "lm11-b03-acceptance-harness"))]
    if acceptance_inject_disk_full(path) {
        return PhysicalOutcome::FailedBeforeCommit;
    }
    if
        step(Step::PartialWrite).is_err() ||
        file.write_all(&bytes[split..]).is_err() ||
        step(Step::Written).is_err() ||
        step(Step::BeforeSync).is_err() ||
        sync_payload(file.as_file()).is_err() ||
        step(Step::Synced).is_err()
    {
        return PhysicalOutcome::FailedBeforeCommit;
    }
    let staged = file.into_temp_path(); // closes the write handle for ReplaceFileW
    if make_room_for_next_backup(path).is_err() {
        return PhysicalOutcome::FailedBeforeCommit;
    }
    if step(Step::BeforeFence).is_err() {
        return PhysicalOutcome::Fenced;
    }
    if step(Step::BeforeReplace).is_err() {
        return PhysicalOutcome::FailedBeforeCommit;
    }
    #[cfg(all(windows, feature = "lm11-b03-acceptance-harness"))]
    acceptance_pause_before_fence(path);
    let result = guarded_commit(&staged, path);
    if result == PhysicalOutcome::RecoveryRequired {
        // ReplaceFileW can report errors after moving one of its inputs;
        // retain the temp if present. Recovery judges the authoritative path.
        let _ = staged.keep();
        return PhysicalOutcome::RecoveryRequired;
    }
    // TempPath will observe that replacement consumed the source path.
    if result != PhysicalOutcome::Crossed {
        return result;
    }
    if step(Step::AfterReplace).is_err() ||
        sync_parent(parent).is_err() ||
        step(Step::DirectorySynced).is_err()
    {
        return PhysicalOutcome::RecoveryRequired;
    }
    PhysicalOutcome::Crossed
}

/// Temp files are *never* replayed. After an authoritative JSON load succeeds,
/// a remaining source name proves it was not adopted by the single replacement
/// boundary. Remove bounded abandoned artifacts; never touch any other file.
pub(super) fn discard_abandoned_temps(path: &Path) -> io::Result<usize> {
    let Some(parent) = path.parent() else { return Ok(0) };
    if !parent.exists() { return Ok(0); }
    let mut abandoned = Vec::new();
    for item in fs::read_dir(parent)? {
        let item = item?;
        let name = item.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(TEMP_PREFIX) && name.ends_with(TEMP_SUFFIX) &&
            item.file_type()?.is_file() {
            if abandoned.len() == 64 {
                return Err(io::Error::other("Too many interrupted settings transactions"));
            }
            abandoned.push(item.path());
        }
    }
    let count = abandoned.len();
    for temp in abandoned { fs::remove_file(temp)?; }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use tempfile::tempdir;

    #[test]
    fn b03_atomic_fence_and_failpoints_never_publish_partial_authority() {
        for fault in [Step::Created, Step::PartialWrite, Step::Written,
                      Step::BeforeSync, Step::Synced, Step::BeforeFence, Step::BeforeReplace] {
            let dir = tempdir().unwrap();
            let target = dir.path().join("terax-settings.json");
            fs::write(&target, b"{\"revision\":1}").unwrap();
            let result = replace_settings_file_with(
                &target, b"{\"revision\":2,\"qualificationCas\":\"acknowledged\"}",
                || true, |phase| if phase == fault {
                    Err(io::Error::other("deterministic interrupted phase"))
                } else { Ok(()) });
            assert!(matches!(result, PhysicalOutcome::Fenced |
                PhysicalOutcome::FailedBeforeCommit), "{fault:?} {result:?}");
            assert_eq!(fs::read(&target).unwrap(), b"{\"revision\":1}");
        }
        let dir = tempdir().unwrap();
        let target = dir.path().join("terax-settings.json");
        fs::write(&target, b"original").unwrap();
        let revoked = AtomicBool::new(false);
        assert_eq!(replace_settings_file_with(&target, b"new",
            || !revoked.load(Ordering::Acquire), |phase| {
                if phase == Step::BeforeFence { revoked.store(true, Ordering::Release); }
                Ok(())
            }), PhysicalOutcome::Fenced);
        assert_eq!(fs::read(target).unwrap(), b"original");
    }

    #[test]
    fn b03_real_replace_survives_lost_ack_and_restart_without_replaying_temp() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("terax-settings.json");
        fs::write(&target, b"{\"revision\":1}").unwrap();
        let expected = b"{\"revision\":2,\"qualificationCas\":\"acknowledged\"}";
        assert_eq!(replace_settings_file_with(&target, expected, || true,
            |phase| if phase == Step::AfterReplace {
                Err(io::Error::other("lost native acknowledgement"))
            } else { Ok(()) }), PhysicalOutcome::RecoveryRequired);
        // Read-only recovery determines the physical state; the old caller
        // remains failed/Unknown and no second write is attempted.
        assert_eq!(fs::read(&target).unwrap(), expected);
        assert_eq!(discard_abandoned_temps(&target).unwrap(), 0);
    }

    #[test]
    fn b03_corrupt_temp_and_stale_temp_cleanup_never_change_valid_authority() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("terax-settings.json");
        fs::write(&target, b"{\"revision\":1}").unwrap();
        fs::write(dir.path().join(format!("{TEMP_PREFIX}corrupt{TEMP_SUFFIX}")), b"{").unwrap();
        fs::write(dir.path().join("other-evidence"), b"keep").unwrap();
        assert_eq!(discard_abandoned_temps(&target).unwrap(), 1);
        assert_eq!(fs::read(&target).unwrap(), b"{\"revision\":1}");
        assert_eq!(fs::read(dir.path().join("other-evidence")).unwrap(), b"keep");
    }

    #[cfg(windows)]
    #[test]
    fn b03_windows_replacefile_failure_backup_recovers_old_revision_without_replay() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("terax-settings.json");
        let old = b"{\"revision\":1,\"priorReceipt\":\"preserve\"}";
        let candidate = b"{\"revision\":2,\"qualifyingReceipt\":\"active\"}";
        // Documented ReplaceFileW error 1176/1177: old name disappears
        // while the replacement remains under its staged name.
        fs::write(old_backup_path(&target), old).unwrap();
        let abandoned = dir.path().join(format!("{TEMP_PREFIX}interrupted{TEMP_SUFFIX}"));
        fs::write(&abandoned, candidate).unwrap();
        recover_missing_replaced_file(&target).unwrap();
        assert_eq!(fs::read(&target).unwrap(), old);
        // The old revision is retained after the recovery completed until
        // a subsequent native transaction needs the backup name.
        make_room_for_next_backup(&target).unwrap();
        assert_eq!(discard_abandoned_temps(&target).unwrap(), 1);
        assert!(!old_backup_path(&target).exists());
        assert_eq!(fs::read(&target).unwrap(), old);
    }

    #[cfg(windows)]
    #[test]
    fn b03_windows_committed_new_authority_wins_over_old_backup_and_corrupt_backup_fails_closed() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("terax-settings.json");
        let old = b"{\"revision\":1}";
        let new = b"{\"revision\":2,\"qualificationCas\":\"acknowledged\"}";
        fs::write(&target, old).unwrap();
        assert_eq!(replace_settings_file(&target, new, || true), PhysicalOutcome::Crossed);
        assert_eq!(fs::read(&target).unwrap(), new);
        assert_eq!(fs::read(old_backup_path(&target)).unwrap(), old);
        recover_missing_replaced_file(&target).unwrap();
        assert_eq!(fs::read(&target).unwrap(), new);
        // Keeping the old complete file until another write strengthens
        // recovery if Windows cannot durably sync the directory entry.
        assert_eq!(fs::read(old_backup_path(&target)).unwrap(), old);
        let next = b"{\"revision\":3}";
        assert_eq!(replace_settings_file(&target, next, || true), PhysicalOutcome::Crossed);
        assert_eq!(fs::read(&target).unwrap(), next);
        assert_eq!(fs::read(old_backup_path(&target)).unwrap(), new);
        make_room_for_next_backup(&target).unwrap();
        assert!(!old_backup_path(&target).exists());

        fs::remove_file(&target).unwrap();
        fs::write(old_backup_path(&target), b"{corrupt-recovery}").unwrap();
        assert!(recover_missing_replaced_file(&target).is_err());
        assert!(!target.exists());
        assert_eq!(fs::read(old_backup_path(&target)).unwrap(), b"{corrupt-recovery}");
    }

    #[test]
    fn b03_atomic_replacement_never_exposes_partial_json() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("terax-settings.json");
        let old = b"{\"revision\":1}";
        let new = b"{\"revision\":2,\"receipt\":\"committed\"}";
        fs::write(&path, old).unwrap();
        let result = replace_settings_file(&path, new, || true);
        assert_eq!(result, PhysicalOutcome::Crossed);
        assert_eq!(fs::read(&path).unwrap(), new);
    }

    #[test]
    fn b03_native_fence_covers_cancel_deadline_epoch_and_process_change() {
        for reason in ["cancel", "deadline", "runtime-epoch", "managed-pid"] {
            let dir = tempdir().unwrap();
            let target = dir.path().join("terax-settings.json");
            fs::write(&target, b"{\"revision\":1}").unwrap();
            let valid = AtomicBool::new(true);
            let outcome = replace_settings_file_with(&target, b"{\"revision\":2}",
                || valid.load(Ordering::Acquire), |phase| {
                    if phase == Step::BeforeFence {
                        valid.store(false, Ordering::Release);
                    }
                    Ok(())
                });
            assert_eq!(outcome, PhysicalOutcome::Fenced, "{reason}");
            assert_eq!(fs::read(&target).unwrap(), b"{\"revision\":1}", "{reason}");
        }
    }

    #[test]
    fn b03_disk_full_create_and_failed_replacement_are_nonqualifying() {
        let dir = tempdir().unwrap();
        // A parent that is a regular file cannot hold a transaction temp.
        let blocker = dir.path().join("no-directory");
        fs::write(&blocker, b"not-a-directory").unwrap();
        assert_eq!(replace_settings_file(&blocker.join("terax-settings.json"),
            b"candidate", || true), PhysicalOutcome::FailedBeforeCommit);

        let path = dir.path().join("terax-settings.json");
        fs::write(&path, b"original").unwrap();
        let disk_full = replace_settings_file_with(&path, b"candidate", || true, |phase| {
            if phase == Step::PartialWrite {
                Err(io::Error::from_raw_os_error(28)) // ENOSPC fault injected
            } else { Ok(()) }
        });
        assert_eq!(disk_full, PhysicalOutcome::FailedBeforeCommit);
        assert_eq!(fs::read(&path).unwrap(), b"original");

        // Replace an existing directory with a file: the platform replacement
        // primitive must fail without ever publishing partial JSON.
        let directory_target = dir.path().join("directory-target");
        fs::create_dir(&directory_target).unwrap();
        assert_eq!(replace_settings_file(&directory_target,
            b"candidate", || true), PhysicalOutcome::RecoveryRequired);
        assert!(directory_target.is_dir());
    }

    #[test]
    fn b03_expiry_after_atomic_replace_is_committed_not_rolled_back() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("terax-settings.json");
        fs::write(&target, b"{\"revision\":1}").unwrap();
        let valid = AtomicBool::new(true);
        let outcome = replace_settings_file_with(&target,
            b"{\"revision\":2,\"effect\":\"committed\"}",
            || valid.load(Ordering::Acquire), |phase| {
                if phase == Step::AfterReplace {
                    valid.store(false, Ordering::Release);
                }
                Ok(())
            });
        assert_eq!(outcome, PhysicalOutcome::Crossed);
        assert!(!valid.load(Ordering::Acquire)); // caller must fail closed
        assert_eq!(serde_json::from_slice::<serde_json::Value>(
            &fs::read(target).unwrap()).unwrap()["revision"], 2);
    }

    #[test]
    fn b03_post_replace_sync_failure_requires_reconciliation_not_rollback() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("terax-settings.json");
        fs::write(&target, b"{\"revision\":1}").unwrap();
        for fail in [Step::AfterReplace, Step::DirectorySynced] {
            let expected = format!("{{\"revision\":{},\"qualified\":true}}", 
                if fail == Step::AfterReplace { 2 } else { 3 });
            let outcome = replace_settings_file_with(&target, expected.as_bytes(),
                || true, |step| if step == fail {
                    Err(io::Error::other("post-replace durability/ack interrupted"))
                } else { Ok(()) });
            assert_eq!(outcome, PhysicalOutcome::RecoveryRequired);
            assert_eq!(fs::read(&target).unwrap(), expected.as_bytes());
        }
    }

    #[test]
    fn b03_native_process_crash_before_and_after_replace_has_one_recovery_answer() {
        let child_phase = std::env::var("CLACK_B03_OFFLINE_CHILD_CRASH").ok();
        let child_path = std::env::var_os("CLACK_B03_OFFLINE_CHILD_TARGET");
        if let (Some(phase), Some(path)) = (child_phase, child_path) {
            let target = std::path::PathBuf::from(path);
            let payload = b"{\"revision\":2,\"qualificationCas\":\"acknowledged\"}";
            let _ = replace_settings_file_with(&target, payload, || true, |at| {
                if phase == "before" && at == Step::BeforeReplace {
                    std::process::exit(71); // real child termination before syscall
                }
                if phase == "after" && at == Step::AfterReplace {
                    std::process::exit(72); // real child termination after syscall
                }
                Ok(())
            });
            panic!("child crash injection failed to reach its expected phase");
        }
        let full_name = "modules::self_hosted_atomic_file::tests::b03_native_process_crash_before_and_after_replace_has_one_recovery_answer";
        for (phase, expected_exit, changed) in [
            ("before", 71, false), ("after", 72, true),
        ] {
            let dir = tempdir().unwrap();
            let target = dir.path().join("terax-settings.json");
            let original = b"{\"revision\":1}";
            fs::write(&target, original).unwrap();
            let child = std::process::Command::new(std::env::current_exe().unwrap())
                .arg("--exact").arg(full_name).arg("--nocapture")
                .env("CLACK_B03_OFFLINE_CHILD_CRASH", phase)
                .env("CLACK_B03_OFFLINE_CHILD_TARGET", &target)
                .status().unwrap();
            assert_eq!(child.code(), Some(expected_exit), "{phase}");
            let recovered: serde_json::Value =
                serde_json::from_slice(&fs::read(&target).unwrap()).unwrap();
            assert_eq!(recovered["revision"], if changed { 2 } else { 1 });
            assert_eq!(discard_abandoned_temps(&target).unwrap(),
                if changed { 0 } else { 1 });
        }
    }
}
