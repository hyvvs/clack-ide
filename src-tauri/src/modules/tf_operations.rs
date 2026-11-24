//! Windows native typed Tool Fabric operations. No second workspace authority:
//! every request is checked against the existing WorkspaceRegistry. Write
//! capabilities are short-lived and require an OS-owned approval dialog.
//! Windows Job ownership is process lifetime control, NOT a filesystem sandbox.

use crate::modules::workspace::WorkspaceRegistry;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TfOperation {
    FileRead,
    FileStat,
    DirectoryList,
    FileFind,
    TextSearch,
    FileCreate,
    FileReplace,
    FilePatch,
    FileDelete,
    DirectoryCreate,
    FileMove,
    RepoStatus,
    RepoBranch,
    RepoHead,
    RepoChanged,
    RepoDiff,
    RepoStagedDiff,
    RepoLog,
    RepoShow,
    RepoRefs,
    RepoStage,
    RepoUnstage,
    RepoCreateBranch,
    RepoSwitchBranch,
    BuildTypecheck,
    BuildFrontend,
    BuildCargoCheck,
    BuildCargoTest,
    BuildCargoBuild,
}

impl TfOperation {
    pub fn is_write(self) -> bool {
        matches!(
            self,
            Self::FileCreate
                | Self::FileReplace
                | Self::FilePatch
                | Self::FileDelete
                | Self::DirectoryCreate
                | Self::FileMove
                | Self::RepoStage
                | Self::RepoUnstage
                | Self::RepoCreateBranch
                | Self::RepoSwitchBranch
                | Self::BuildTypecheck
                | Self::BuildFrontend
                | Self::BuildCargoCheck
                | Self::BuildCargoTest
                | Self::BuildCargoBuild
        )
    }
    fn is_repo(self) -> bool {
        matches!(
            self,
            Self::RepoStatus
                | Self::RepoBranch
                | Self::RepoHead
                | Self::RepoChanged
                | Self::RepoDiff
                | Self::RepoStagedDiff
                | Self::RepoLog
                | Self::RepoShow
                | Self::RepoRefs
                | Self::RepoStage
                | Self::RepoUnstage
                | Self::RepoCreateBranch
                | Self::RepoSwitchBranch
        )
    }
    fn is_build(self) -> bool {
        matches!(
            self,
            Self::BuildTypecheck
                | Self::BuildFrontend
                | Self::BuildCargoCheck
                | Self::BuildCargoTest
                | Self::BuildCargoBuild
        )
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TfOperationRequest {
    pub operation: TfOperation,
    pub actor: String,
    pub workspace_root: String,
    pub cwd: String,
    pub path: Option<String>,
    pub destination: Option<String>,
    pub content: Option<String>,
    pub expected_sha256: Option<String>,
    pub old_text: Option<String>,
    pub new_text: Option<String>,
    pub pattern: Option<String>,
    pub query: Option<String>,
    pub ref_name: Option<String>,
    pub paths: Option<Vec<String>>,
    pub offset: Option<u64>,
    pub limit: Option<u64>,
    pub depth: Option<u64>,
    pub timeout_ms: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TfOperationPrepared {
    pub token: String,
    pub request_id: String,
    pub operation: TfOperation,
    pub cwd: String,
    pub workspace_root: String,
    pub canonical_cwd: String,
    pub canonical_workspace_root: String,
    pub requires_approval: bool,
    pub expires_in_secs: u64,
    pub isolation: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TfOperationReceipt {
    pub tool_id: &'static str,
    pub request_id: String,
    pub actor: String,
    pub operation: TfOperation,
    /// Fixed native adapter identity; never a renderer-supplied command.
    pub command_adapter: &'static str,
    pub executable: Option<String>,
    pub argv: Vec<String>,
    pub command_cwd: String,
    pub started_at: u64,
    pub ended_at: u64,
    pub terminal: &'static str,
    pub effect_state: &'static str,
    pub before_sha256: Option<String>,
    pub after_sha256: Option<String>,
    pub before_exists: Option<bool>,
    pub after_exists: Option<bool>,
    /// Exact byte count from a verified file create/replace/patch/delete/move.
    /// Null for directory effects, conflicts, uncertain effects and processes.
    pub bytes_affected: Option<u64>,
    /// Git object IDs (SHA-1 or SHA-256 depending on repository format), not
    /// filesystem-content SHA-256. Missing/unverifiable observations are null.
    pub before_head: Option<String>,
    pub after_head: Option<String>,
    pub before_branch: Option<String>,
    pub after_branch: Option<String>,
    pub ref_name: Option<String>,
    pub before_ref_exists: Option<bool>,
    pub after_ref_exists: Option<bool>,
    pub before_ref_oid: Option<String>,
    pub after_ref_oid: Option<String>,
    /// Only sanitized, independently probed repo-relative paths; null if a
    /// probe fails, truncates or encounters a sensitive/unsafe path.
    pub before_changed_paths: Option<Vec<String>>,
    pub after_changed_paths: Option<Vec<String>>,
    pub before_staged_paths: Option<Vec<String>>,
    pub after_staged_paths: Option<Vec<String>>,
    pub canonical_paths: Vec<String>,
    pub requested_resources: Vec<String>,
    pub affected_resources: Vec<String>,
    pub approval_id: Option<String>,
    pub retry: &'static str,
    pub auto_retry: bool,
    pub stdout: String,
    pub stderr: String,
    pub stdout_sha256: String,
    pub stderr_sha256: String,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
    pub pid: Option<u32>,
    pub exit_code: Option<i32>,
    pub uncertainty: &'static str,
    pub sandbox: &'static str,
    pub isolation: &'static str,
}

/// A private native browser evidence result. The PNG bytes never appear in
/// this receipt; only its independent TF2-verified workspace file identity.
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tf4ScreenshotEvidence {
    pub format: &'static str,
    pub width: u32,
    pub height: u32,
    pub captured_at_ms: u64,
    pub page_id: String,
    pub page_generation: u64,
    pub snapshot_id: String,
    pub url_sha256: String,
    pub content_sha256: String,
    pub bytes_verified: usize,
    pub workspace_relative_file: String,
    pub effect_state: &'static str,
    pub retry: &'static str,
}

#[derive(Clone)]
struct Pending {
    request_id: String,
    request: TfOperationRequest,
    workspace_root: PathBuf,
    cwd: PathBuf,
    canonical_paths: Vec<PathBuf>,
    expires: Instant,
    approved: bool,
}

#[derive(Default)]
pub struct TfOperationState {
    pending: Mutex<HashMap<String, Pending>>,
    active: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

pub fn cancel(token: &str, state: &TfOperationState) -> Result<bool, String> {
    // pending -> active moves with both locks held in this order.
    if state
        .pending
        .lock()
        .map_err(|_| "Operation state unavailable")?
        .remove(token)
        .is_some()
    {
        return Ok(true);
    }
    let active = state
        .active
        .lock()
        .map_err(|_| "Operation state unavailable")?;
    if let Some(flag) = active.get(token) {
        flag.store(true, Ordering::Release);
        return Ok(true);
    }
    Ok(false)
}

#[cfg(windows)]
mod windows {
    use super::*;
    use crate::modules::tf_command::{run_bounded_process, BoundedProcessResult};
    use sha2::{Digest, Sha256};
    use std::fs::{self, File, OpenOptions};
    use std::io::{Read, Write};
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use std::path::{Component, Path};
    use std::process::{Command, Stdio};
    use std::sync::LazyLock;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    use tokio::sync::Semaphore;

    const TOKEN_TTL: Duration = Duration::from_secs(60);
    const FILE_CAP: u64 = 1024 * 1024;
    const WRITE_CAP: usize = 512 * 1024;
    const SEARCH_BYTES_CAP: u64 = 2 * 1024 * 1024;
    const SEARCH_ENTRY_CAP: usize = 2048;
    const OUTPUT_CAP: usize = 32 * 1024;
    const GIT: &str = r"C:\Program Files\Git\cmd\git.exe";
    static APPROVAL_SLOTS: LazyLock<Arc<Semaphore>> = LazyLock::new(|| Arc::new(Semaphore::new(4)));

    fn nonce() -> Result<String, String> {
        let mut bytes = [0u8; 24];
        getrandom::fill(&mut bytes).map_err(|_| "Secure operation token unavailable")?;
        Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
    }
    fn sha(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }
    fn epoch_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .min(u64::MAX as u128) as u64
    }
    fn failure<E: std::fmt::Display>(error: E) -> String {
        format!("TF2 denied: {error}")
    }
    fn is_reparse(p: &Path) -> Result<bool, String> {
        match fs::symlink_metadata(p) {
            Ok(meta) => Ok(meta.file_type().is_symlink() || (meta.file_attributes() & 0x400) != 0),
            Err(e) => Err(failure(e)),
        }
    }
    fn check_secret_component(s: &str) -> Result<(), String> {
        let lower = s.to_ascii_lowercase();
        if lower == ".git"
            || lower == ".ssh"
            || lower == ".aws"
            || lower == ".gnupg"
            || lower == ".clack"
            || lower == ".env"
            || lower.starts_with(".env.")
            || lower == ".npmrc"
            || lower == ".pypirc"
            || lower == ".git-credentials"
            || lower == "credentials"
            || lower == "id_rsa"
            || lower == "id_ed25519"
            || lower.ends_with(".pem")
            || lower.ends_with(".key")
            || lower == "secrets.json"
            || lower == "secrets.toml"
        {
            return Err("Secret or Git metadata path denied".into());
        }
        Ok(())
    }
    fn check_lexical(input: &str) -> Result<PathBuf, String> {
        if input.is_empty()
            || input.len() > 4096
            || input.starts_with(r"\\")
            || input.starts_with("//")
            || input.contains('\0')
            || input
                .chars()
                .any(|c| c.is_control() || matches!(c, '<' | '>' | '"' | '|' | '?' | '*'))
        {
            return Err("Invalid path or UNC/device syntax".into());
        }
        let path = PathBuf::from(input);
        if (path.has_root() || path.components().any(|c| matches!(c, Component::Prefix(_))))
            && !path.is_absolute()
        {
            return Err("Drive-relative path denied".into());
        }
        for component in path.components() {
            match component {
                Component::Prefix(prefix) => {
                    if !matches!(prefix.kind(), std::path::Prefix::Disk(_)) {
                        return Err("UNC, device, verbatim and alias paths denied".into());
                    }
                }
                Component::ParentDir | Component::CurDir => {
                    return Err("Traversal or dot alias denied".into())
                }
                Component::Normal(name) => {
                    let value = name.to_str().ok_or("Non-Unicode path denied")?;
                    if value.contains(':')
                        || value.ends_with('.')
                        || value.ends_with(' ')
                        || value.bytes().any(|b| b == 0)
                    {
                        return Err("ADS or path alias denied".into());
                    }
                    let stem = value.split('.').next().unwrap_or("").to_ascii_uppercase();
                    if matches!(
                        stem.as_str(),
                        "CON"
                            | "PRN"
                            | "AUX"
                            | "NUL"
                            | "COM1"
                            | "COM2"
                            | "COM3"
                            | "COM4"
                            | "COM5"
                            | "COM6"
                            | "COM7"
                            | "COM8"
                            | "COM9"
                            | "LPT1"
                            | "LPT2"
                            | "LPT3"
                            | "LPT4"
                            | "LPT5"
                            | "LPT6"
                            | "LPT7"
                            | "LPT8"
                            | "LPT9"
                    ) {
                        return Err("Reserved DOS device path denied".into());
                    }
                    check_secret_component(value)?;
                }
                Component::RootDir => {}
            }
        }
        Ok(path)
    }
    fn inspect_components(path: &Path) -> Result<(), String> {
        let mut prefix = PathBuf::new();
        for component in path.components() {
            prefix.push(component);
            // A lone Windows disk or verbatim prefix (e.g. "C:" or "\\?\C:")
            // is not an openable directory; inspect from the rooted path.
            if matches!(component, Component::Prefix(_)) || !prefix.has_root() {
                continue;
            }
            match fs::symlink_metadata(&prefix) {
                Ok(meta) => {
                    if meta.file_type().is_symlink() || meta.file_attributes() & 0x400 != 0 {
                        return Err("Reparse point, symlink or junction path denied".into());
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(format!("Path component {} denied: {e}", prefix.display())),
            }
        }
        Ok(())
    }
    fn scope(
        registry: &WorkspaceRegistry,
        input_root: &str,
        input_cwd: &str,
    ) -> Result<(PathBuf, PathBuf), String> {
        let raw_root = check_lexical(input_root)?;
        let raw_cwd = check_lexical(input_cwd)?;
        if !raw_root.is_absolute() || !raw_cwd.is_absolute() {
            return Err("Explicit absolute selected root and cwd required".into());
        }
        inspect_components(&raw_root)?;
        inspect_components(&raw_cwd)?;
        let root = fs::canonicalize(&raw_root).map_err(failure)?;
        let cwd = fs::canonicalize(&raw_cwd).map_err(failure)?;
        if !root.is_dir()
            || !cwd.is_dir()
            || !cwd.starts_with(&root)
            || !registry.is_authorized(&root)
        {
            return Err("Selected workspace root or cwd not registry-authorized".into());
        }
        Ok((root, cwd))
    }
    fn target(
        input: &str,
        root: &Path,
        cwd: &Path,
        missing: bool,
        allow_root: bool,
    ) -> Result<PathBuf, String> {
        let raw = check_lexical(input)?;
        let full = if raw.is_absolute() {
            raw
        } else {
            cwd.join(raw)
        };
        inspect_components(&full)?;
        let result = match fs::canonicalize(&full) {
            Ok(path) => path,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound && missing => {
                let parent = full.parent().ok_or("Missing target parent")?;
                let canonical_parent = fs::canonicalize(parent).map_err(failure)?;
                canonical_parent.join(full.file_name().ok_or("Invalid target name")?)
            }
            Err(e) => return Err(failure(e)),
        };
        if !result.starts_with(root) || (!allow_root && result == root) {
            return Err("Target must remain inside selected workspace".into());
        }
        inspect_components(&result)?;
        Ok(result)
    }
    fn check_repo(root: &Path) -> Result<(), String> {
        let git = root.join(".git");
        let meta = fs::symlink_metadata(&git).map_err(|_| "Standalone Git directory required")?;
        if !meta.is_dir() || is_reparse(&git)? {
            return Err("Git file/link/reparse repo denied".into());
        }
        if fs::canonicalize(&git).map_err(failure)? != git {
            return Err("Git metadata alias denied".into());
        }
        for name in ["commondir", "objects/info/alternates"] {
            match fs::symlink_metadata(git.join(name)) {
                Ok(_) => return Err("External Git common directory/alternates denied".into()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(failure(e)),
            }
        }
        let config = git.join("config");
        if is_reparse(&config)? || !fs::metadata(&config).map_err(failure)?.is_file() {
            return Err("Git configuration alias denied".into());
        }
        let bytes = fs::read(&config).map_err(failure)?;
        if bytes.len() > 64 * 1024 {
            return Err("Oversize repository configuration denied".into());
        }
        let config_text = String::from_utf8_lossy(&bytes).to_ascii_lowercase();
        if config_text.lines().any(|line| {
            let l = line.trim();
            l.starts_with("[include")
                || l.starts_with("[filter")
                || l.starts_with("[diff ")
                || l.starts_with("[core") && (l.contains("worktree") || l.contains("hooks"))
                || l.starts_with("worktree")
                || l.starts_with("fsmonitor")
                || l.starts_with("hookspath")
                || l.starts_with("excludesfile")
                || l.starts_with("attributesfile")
                || l.starts_with("extensions.worktreeconfig")
        }) {
            return Err("Git configuration may redirect execution or paths".into());
        }
        // Exact Git file handles can escape an otherwise canonical .git via
        // nested refs/objects/logs/HEAD junctions. A bounded full scan is
        // deliberately fail-closed for very large or unreadable repositories.
        let mut stack = vec![git];
        let mut scanned = 0usize;
        while let Some(dir) = stack.pop() {
            for item in fs::read_dir(&dir).map_err(failure)? {
                scanned += 1;
                if scanned > 8192 {
                    return Err("UNSUPPORTED: Git metadata safety scan exceeds budget".into());
                }
                let item = item.map_err(failure)?;
                let meta = fs::symlink_metadata(item.path()).map_err(failure)?;
                if meta.file_type().is_symlink() || meta.file_attributes() & 0x400 != 0 {
                    return Err("Nested Git metadata reparse/symlink denied".into());
                }
                if meta.is_dir() {
                    stack.push(item.path());
                }
            }
        }
        Ok(())
    }
    fn validate_ref(value: &str) -> Result<(), String> {
        if value.is_empty()
            || value.len() > 96
            || value.starts_with('-')
            || value.starts_with('.')
            || value.ends_with('/')
            || value.ends_with('.')
            || value.contains("..")
            || value.contains("//")
            || value.contains("@{")
            || value.ends_with(".lock")
            || !value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._-/".contains(&b))
        {
            return Err("Invalid Git ref name".into());
        }
        Ok(())
    }
    fn read_small(path: &Path) -> Result<Vec<u8>, String> {
        let m = fs::symlink_metadata(path).map_err(failure)?;
        if !m.is_file() || m.len() > FILE_CAP || m.file_attributes() & 0x400 != 0 {
            return Err("File must be regular and <= 1 MiB".into());
        }
        let file = File::open(path).map_err(failure)?;
        let mut content = Vec::new();
        file.take(FILE_CAP + 1)
            .read_to_end(&mut content)
            .map_err(failure)?;
        if content.len() as u64 > FILE_CAP {
            return Err("File grew beyond 1 MiB during read".into());
        }
        Ok(content)
    }
    /// Lease the selected root and each target parent without FILE_SHARE_DELETE.
    /// An ordinary rename/junction swap cannot redirect pathname effects while
    /// these directory handles are held. No broader sandbox is implied.
    fn lease_write_parents(root: &Path, paths: &[PathBuf]) -> Result<Vec<File>, String> {
        let mut dirs = std::collections::BTreeSet::new();
        for path in paths {
            let parent = path.parent().ok_or("Missing target parent")?;
            let rel = parent.strip_prefix(root).map_err(failure)?;
            let mut current = root.to_path_buf();
            dirs.insert(current.clone());
            for comp in rel.components() {
                if !matches!(comp, Component::Normal(_)) {
                    return Err("Unexpected write parent component".into());
                }
                current.push(comp);
                dirs.insert(current.clone());
            }
        }
        let mut leases = Vec::with_capacity(dirs.len());
        for dir in dirs {
            let mut options = OpenOptions::new();
            // FILE_READ_ATTRIBUTES, FILE_SHARE_READ|FILE_SHARE_WRITE,
            // FILE_FLAG_BACKUP_SEMANTICS|FILE_FLAG_OPEN_REPARSE_POINT.
            let file = options
                .read(true)
                .access_mode(0x80)
                .share_mode(0x3)
                .custom_flags(0x0200_0000 | 0x0020_0000)
                .open(&dir)
                .map_err(failure)?;
            let meta = file.metadata().map_err(failure)?;
            if !meta.is_dir()
                || (meta.file_attributes() & 0x400) != 0
                || fs::canonicalize(&dir).map_err(failure)? != dir
            {
                return Err("Write directory lease aliased or changed".into());
            }
            leases.push(file);
        }
        Ok(leases)
    }
    fn is_file_operation(op: TfOperation) -> bool {
        !op.is_repo() && !op.is_build()
    }
    fn requires_path(op: TfOperation) -> bool {
        matches!(
            op,
            TfOperation::FileRead
                | TfOperation::FileStat
                | TfOperation::DirectoryList
                | TfOperation::FileFind
                | TfOperation::TextSearch
                | TfOperation::FileCreate
                | TfOperation::FileReplace
                | TfOperation::FilePatch
                | TfOperation::FileDelete
                | TfOperation::DirectoryCreate
                | TfOperation::FileMove
        )
    }
    fn is_new_path(op: TfOperation) -> bool {
        matches!(op, TfOperation::FileCreate | TfOperation::DirectoryCreate)
    }
    fn validate_request(
        req: &TfOperationRequest,
        registry: &WorkspaceRegistry,
    ) -> Result<(PathBuf, PathBuf, Vec<PathBuf>), String> {
        if req.actor.is_empty()
            || req.actor.len() > 128
            || !req
                .actor
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_:".contains(&b))
        {
            return Err("Invalid actor label".into());
        }
        let (root, cwd) = scope(registry, &req.workspace_root, &req.cwd)?;
        if req.operation.is_repo() {
            if cwd != root {
                return Err("Git ops require selected repo root as cwd".into());
            }
            check_repo(&root)?;
            if !Path::new(GIT).is_file() {
                return Err("UNSUPPORTED: pinned Git unavailable".into());
            }
        }
        if let Some(v) = req.content.as_deref() {
            if v.len() > WRITE_CAP {
                return Err("Content exceeds 512 KiB".into());
            }
        }
        if let Some(v) = req.expected_sha256.as_deref() {
            if v.len() != 64 || !v.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err("Invalid exact expected SHA-256".into());
            }
        }
        if req.old_text.as_ref().is_some_and(|v| v.len() > WRITE_CAP)
            || req.new_text.as_ref().is_some_and(|v| v.len() > WRITE_CAP)
        {
            return Err("Patch text too large".into());
        }
        if req.offset.unwrap_or(0) > FILE_CAP
            || req.limit.unwrap_or(200) > OUTPUT_CAP as u64
            || req.depth.unwrap_or(4) > 8
            || req.timeout_ms.unwrap_or(10_000) > 120_000
            || req.timeout_ms == Some(0)
        {
            return Err("Operation bounds exceeded".into());
        }
        let mut paths = Vec::new();
        if requires_path(req.operation) {
            let raw = req.path.as_deref().ok_or("Operation path required")?;
            let root_read = matches!(
                req.operation,
                TfOperation::DirectoryList | TfOperation::FileFind | TfOperation::TextSearch
            );
            paths.push(target(
                raw,
                &root,
                &cwd,
                is_new_path(req.operation),
                root_read,
            )?);
            if req.operation == TfOperation::FileMove {
                paths.push(target(
                    req.destination
                        .as_deref()
                        .ok_or("Move destination required")?,
                    &root,
                    &cwd,
                    true,
                    false,
                )?);
            }
        } else if req.path.is_some() || req.destination.is_some() {
            return Err("Path parameter unsupported for this operation".into());
        }
        if req.operation.is_repo() {
            if let Some(ref_name) = req.ref_name.as_deref() {
                validate_ref(ref_name)?;
            }
            let input_paths = req.paths.as_deref().unwrap_or(&[]);
            if input_paths.len() > 64 {
                return Err("Too many repo paths".into());
            }
            for item in input_paths {
                paths.push(target(item, &root, &cwd, true, false)?);
            }
            if matches!(
                req.operation,
                TfOperation::RepoStage | TfOperation::RepoUnstage
            ) && paths.is_empty()
            {
                return Err("Explicit Git paths required".into());
            }
            if matches!(
                req.operation,
                TfOperation::RepoDiff | TfOperation::RepoStagedDiff | TfOperation::RepoShow
            ) && paths.is_empty()
            {
                return Err(
                    "Explicit vetted paths required to prevent secret diff disclosure".into(),
                );
            }
            if matches!(
                req.operation,
                TfOperation::RepoCreateBranch | TfOperation::RepoSwitchBranch
            ) && req.ref_name.is_none()
            {
                return Err("Git branch name required".into());
            }
        } else if req.paths.is_some() || req.ref_name.is_some() {
            return Err("Git-only parameters denied".into());
        }
        if matches!(
            req.operation,
            TfOperation::FileReplace
                | TfOperation::FilePatch
                | TfOperation::FileDelete
                | TfOperation::FileMove
        ) && req.expected_sha256.is_none()
        {
            return Err("Exact SHA-256 precondition required".into());
        }
        if matches!(
            req.operation,
            TfOperation::FileCreate | TfOperation::FileReplace
        ) && req.content.is_none()
        {
            return Err("File content required".into());
        }
        if req.operation == TfOperation::FilePatch
            && (req.old_text.as_deref().unwrap_or("").is_empty() || req.new_text.is_none())
        {
            return Err("Unique nonempty oldText and newText required".into());
        }
        if req.operation == TfOperation::TextSearch && req.query.as_deref().unwrap_or("").is_empty()
        {
            return Err("Search query required".into());
        }
        if req.operation == TfOperation::FileFind
            && req.pattern.as_deref().unwrap_or("").is_empty()
            && req.query.as_deref().unwrap_or("").is_empty()
        {
            return Err("Filename pattern or query required".into());
        }
        if let Some(pattern) = req.pattern.as_deref() {
            if pattern.len() > 256 || pattern.contains("..") {
                return Err("Unsafe search glob".into());
            }
            globset::Glob::new(pattern).map_err(failure)?;
        }
        if req.query.as_ref().is_some_and(|v| v.len() > 256) {
            return Err("Search query too long".into());
        }
        if req.operation.is_build() {
            let required = if matches!(
                req.operation,
                TfOperation::BuildTypecheck | TfOperation::BuildFrontend
            ) {
                root.join("package.json")
            } else {
                root.join("src-tauri/Cargo.toml")
            };
            if !required.is_file() || is_reparse(&required)? {
                return Err("Trusted build manifest missing or aliased".into());
            }
        }
        if is_file_operation(req.operation) && paths.is_empty() {
            return Err("Missing target path".into());
        }
        if is_new_path(req.operation) && paths[0].exists() {
            return Err("Creation target already exists".into());
        }
        if req.operation == TfOperation::FileMove && paths[1].exists() {
            return Err("Move destination already exists".into());
        }
        Ok((root, cwd, paths))
    }

    pub fn prepare(
        req: TfOperationRequest,
        registry: &WorkspaceRegistry,
        state: &TfOperationState,
    ) -> Result<TfOperationPrepared, String> {
        let (root, cwd, paths) = validate_request(&req, registry)?;
        let token = nonce()?;
        let request_id = nonce()?;
        let mut pending = state
            .pending
            .lock()
            .map_err(|_| "Operation state unavailable")?;
        pending.retain(|_, v| v.expires > Instant::now());
        if pending.len() >= 64 {
            return Err("Operation capacity exceeded".into());
        }
        pending.insert(
            token.clone(),
            Pending {
                request_id: request_id.clone(),
                request: req.clone(),
                workspace_root: root.clone(),
                cwd: cwd.clone(),
                canonical_paths: paths,
                expires: Instant::now() + TOKEN_TTL,
                approved: !req.operation.is_write(),
            },
        );
        Ok(TfOperationPrepared {
            token,
            request_id,
            operation: req.operation,
            workspace_root: req.workspace_root.clone(),
            cwd: req.cwd.clone(),
            canonical_workspace_root: root.display().to_string(),
            canonical_cwd: cwd.display().to_string(),
            requires_approval: req.operation.is_write(),
            expires_in_secs: TOKEN_TTL.as_secs(),
            isolation: "unsupported_filesystem_network_isolation",
        })
    }

    /// Headless acceptance approval; never exported as a Tauri command.
    pub fn approve(token: &str, state: &TfOperationState) -> Result<(), String> {
        let mut pending = state
            .pending
            .lock()
            .map_err(|_| "Operation state unavailable")?;
        let p = pending
            .get_mut(token)
            .ok_or("Unknown or consumed operation token")?;
        if p.expires <= Instant::now() {
            pending.remove(token);
            return Err("Approval expired".into());
        }
        if !p.request.operation.is_write() || p.approved {
            return Err("Operation does not have an unapproved write".into());
        }
        p.approved = true;
        Ok(())
    }

    pub async fn approve_modal(token: String, app: tauri::AppHandle) -> Result<(), String> {
        use tauri::Manager;
        let state = app.state::<TfOperationState>();
        let snapshot = {
            let pending = state
                .pending
                .lock()
                .map_err(|_| "Operation state unavailable")?;
            let p = pending
                .get(&token)
                .ok_or("Unknown or consumed operation token")?;
            if p.expires <= Instant::now() || !p.request.operation.is_write() || p.approved {
                return Err("Missing live unapproved write".into());
            }
            p.clone()
        };
        let mut summary = format!(
            "Clack Tool Fabric native write approval\n\nRequest: {}\nActor: {}\nOperation: {:?}\nSelected workspace: {}\nWorking directory: {}\n",
            snapshot.request_id, snapshot.request.actor, snapshot.request.operation,
            snapshot.workspace_root.display(), snapshot.cwd.display());
        for path in &snapshot.canonical_paths {
            summary.push_str(&format!("Affected path: {}\n", path.display()));
        }
        if let Some(name) = &snapshot.request.ref_name {
            summary.push_str(&format!("Git ref: {name}\n"));
        }
        if let Some(content) = &snapshot.request.content {
            summary.push_str(&format!(
                "Content SHA-256: {} ({} bytes)\n",
                sha(content.as_bytes()),
                content.len()
            ));
        }
        if let Some(before) = &snapshot.request.expected_sha256 {
            summary.push_str(&format!("Expected pre-image: {before}\n"));
        }
        if snapshot.request.operation.is_build() {
            summary.push_str("WARNING: Build scripts and tests can execute project code, modify arbitrary filesystem paths or use the network. No sandbox is enforced.\n");
        }
        summary.push_str(
            "\nFilesystem/network sandbox: UNSUPPORTED. Allow this exact single operation once?",
        );
        let slot = APPROVAL_SLOTS
            .clone()
            .try_acquire_owned()
            .map_err(|_| "Native approval dialog capacity exhausted")?;
        let dialog_app = app.clone();
        let shown = tokio::task::spawn_blocking(move || {
            let _slot = slot;
            dialog_app
                .dialog()
                .message(summary)
                .title("Clack Tool Fabric operation approval")
                .buttons(MessageDialogButtons::OkCancel)
                .blocking_show()
        });
        let consent = tokio::time::timeout(TOKEN_TTL, shown)
            .await
            .map_err(|_| "Operation approval expired")?
            .map_err(|_| "Native approval dialog unavailable")?;
        if !consent {
            let _ = super::cancel(&token, &state);
            return Err("Native operation denied by user".into());
        }
        let registry = app.state::<WorkspaceRegistry>();
        let (root, cwd, paths) = validate_request(&snapshot.request, &registry)?;
        if root != snapshot.workspace_root
            || cwd != snapshot.cwd
            || paths != snapshot.canonical_paths
        {
            return Err("Operation approval scope changed".into());
        }
        let mut pending = state
            .pending
            .lock()
            .map_err(|_| "Operation state unavailable")?;
        let p = pending
            .get_mut(&token)
            .ok_or("Unknown or consumed operation token")?;
        if p.expires <= Instant::now() {
            pending.remove(&token);
            return Err("Operation approval expired".into());
        }
        if p.request_id != snapshot.request_id
            || p.request.actor != snapshot.request.actor
            || p.workspace_root != root
            || p.cwd != cwd
            || p.canonical_paths != paths
            || p.request.operation != snapshot.request.operation
            || p.approved
        {
            return Err("Native approval target changed".into());
        }
        p.approved = true;
        Ok(())
    }

    #[derive(Default)]
    struct Outcome {
        terminal: &'static str,
        effect_state: &'static str,
        executable: Option<String>,
        argv: Vec<String>,
        command_cwd: Option<String>,
        before_repo: Option<RepoSnapshot>,
        after_repo: Option<RepoSnapshot>,
        before_sha256: Option<String>,
        after_sha256: Option<String>,
        before_exists: Option<bool>,
        after_exists: Option<bool>,
        bytes_affected: Option<u64>,
        stdout: String,
        stderr: String,
        stdout_truncated: bool,
        stderr_truncated: bool,
        affected: Vec<String>,
        pid: Option<u32>,
        exit_code: Option<i32>,
        uncertainty: &'static str,
    }
    #[derive(Default)]
    struct RepoSnapshot {
        head: Option<String>,
        branch: Option<String>,
        ref_exists: Option<bool>,
        ref_oid: Option<String>,
        changed_paths: Option<Vec<String>>,
        staged_paths: Option<Vec<String>>,
    }
    impl Outcome {
        fn no_effect(stdout: String) -> Self {
            Self {
                terminal: "completed",
                effect_state: "NoEffect",
                stdout,
                uncertainty: "none",
                ..Self::default()
            }
        }
    }
    fn bounded_output(mut value: String, output: &mut Outcome) {
        if value.len() > OUTPUT_CAP {
            let cut = value.floor_char_boundary(OUTPUT_CAP);
            value.truncate(cut);
            output.stdout_truncated = true;
        }
        output.stdout = value;
    }
    fn ensure_sha(bytes: &[u8], expected: &Option<String>) -> Result<String, String> {
        let current = sha(bytes);
        if !expected
            .as_ref()
            .is_some_and(|e| e.eq_ignore_ascii_case(&current))
        {
            return Err("Stale file SHA-256 precondition; no mutation".into());
        }
        Ok(current)
    }
    fn same_dir_write(dest: &Path, bytes: &[u8], replace: bool) -> Result<(), String> {
        let parent = dest.parent().ok_or("File has no parent")?;
        let mut tmp = tempfile::Builder::new()
            .prefix(".clack-tf-")
            .tempfile_in(parent)
            .map_err(failure)?;
        tmp.write_all(bytes).map_err(failure)?;
        tmp.flush().map_err(failure)?;
        tmp.as_file().sync_all().map_err(failure)?;
        if replace {
            tmp.persist(dest).map_err(failure)?;
        } else {
            tmp.persist_noclobber(dest).map_err(failure)?;
        }
        // Best effort persistence on Windows; NamedTempFile is in destination directory.
        Ok(())
    }

    /// The native TF4 Screenshot caller must move its genuine, consumed
    /// application-approval witness into this existing TF2 path/lease/write
    /// authority. No separate filesystem policy, caller-supplied destination,
    /// browser process file handle or unapproved raw model download exists.
    #[cfg(feature = "tf-browser-native-runtime")]
    pub(crate) fn commit_native_screenshot_evidence(
        grant: crate::modules::net::tf_browser::NativeScreenshotConsent,
        capture: crate::modules::net::tf_browser_runtime::NativeScreenshotCapture,
        registry: &WorkspaceRegistry,
    ) -> Result<Tf4ScreenshotEvidence, String> {
        if !grant.matches_capture(&capture)
            || capture.png.len() < 45
            || capture.png.len() > 64 * 1024
            || !capture.png.starts_with(b"\x89PNG\r\n\x1a\n")
            || !capture.png.ends_with(b"\x00\x00\x00\x00IEND\xaeB\x60\x82")
            || !matches!(capture.width, 1..=1024)
            || !matches!(capture.height, 1..=768)
        {
            return Err("TF2 native screenshot: consumed consent or PNG scope denied".into());
        }
        // Rust's Windows canonicalize may return a \\?\C:\... result.
        // The existing TF2 public lexical boundary intentionally refuses
        // device/verbatim user input. Translate ONLY this authenticated,
        // already-canonical internal path to its plain DOS spelling, then
        // let the identical TF2 scope()/reparse checks independently resolve
        // it and require exact equality with the consumed grant's path.
        let raw_root = grant.approved_workspace().to_string_lossy();
        let scoped_root = if let Some(plain) = raw_root.strip_prefix(r"\\?\") {
            if plain.as_bytes().get(1) != Some(&b':')
                || plain.as_bytes().get(2) != Some(&b'\\')
                || !plain.as_bytes()[0].is_ascii_alphabetic()
            {
                return Err("TF2 native screenshot canonical path is not a local disk".into());
            }
            plain.to_owned()
        } else {
            raw_root.into_owned()
        };
        let (root, cwd) = scope(registry, &scoped_root, &scoped_root)?;
        if root != grant.approved_workspace() || cwd != root {
            return Err("TF2 screenshot selected workspace identity changed".into());
        }
        let filename = grant.evidence_file_name();
        let path = target(&filename, &root, &cwd, true, false)?;
        if path.exists() {
            return Err("TF2 screenshot evidence already exists; never replay".into());
        }
        let _leases = lease_write_parents(&root, std::slice::from_ref(&path))?;
        inspect_components(&path)?;
        if path.exists() {
            return Err("TF2 screenshot evidence appeared before write".into());
        }
        let digest = sha(&capture.png);
        if digest != capture.sha256 {
            return Err("TF2 screenshot changed before write".into());
        }
        // After this point even an error may mean an external file effect.
        // No retry-to-PASS, overwrite or second destination is ever issued.
        same_dir_write(&path, &capture.png, false)?;
        inspect_components(&path)?;
        if fs::canonicalize(&path).map_err(failure)? != path {
            return Err("TF2 screenshot final path identity changed; effect unknown".into());
        }
        let independently_read = read_small(&path)?;
        if independently_read.len() != capture.png.len() || sha(&independently_read) != digest {
            return Err("TF2 screenshot independent final digest mismatch; effect unknown".into());
        }
        Ok(Tf4ScreenshotEvidence {
            format: "png",
            width: capture.width,
            height: capture.height,
            captured_at_ms: capture.captured_at_ms,
            page_id: capture.page_id,
            page_generation: capture.page_generation,
            snapshot_id: capture.snapshot_id,
            url_sha256: sha(capture.url.as_bytes()),
            content_sha256: digest,
            bytes_verified: independently_read.len(),
            workspace_relative_file: filename,
            effect_state: "Observed",
            retry: "NEVER_REPLAY",
        })
    }
    fn checked_file_mutation(
        p: &Pending,
        cancelled: &AtomicBool,
        mutation_attempted: &AtomicBool,
    ) -> Result<Outcome, String> {
        let _leases = lease_write_parents(&p.workspace_root, &p.canonical_paths)?;
        let path = &p.canonical_paths[0];
        let mut result = Outcome {
            terminal: "completed",
            effect_state: "Unknown",
            uncertainty: "may_have_written",
            ..Outcome::default()
        };
        let mut intended_sha: Option<String> = None;
        let mut source_bytes: Option<u64> = None;
        let op = p.request.operation;
        if matches!(op, TfOperation::FileCreate | TfOperation::DirectoryCreate) {
            if path.exists() {
                return Err("Create target appeared after prepare".into());
            }
            result.before_exists = Some(false);
        } else {
            let existing = read_small(path)?;
            source_bytes = Some(existing.len() as u64);
            result.before_sha256 = Some(ensure_sha(&existing, &p.request.expected_sha256)?);
            result.before_exists = Some(true);
        }
        if cancelled.load(Ordering::Acquire) {
            return Err("Cancelled before filesystem effect".into());
        }
        match op {
            TfOperation::FileCreate | TfOperation::FileReplace => {
                let bytes = p
                    .request
                    .content
                    .as_deref()
                    .ok_or("Missing content")?
                    .as_bytes();
                if op == TfOperation::FileReplace {
                    // Revalidate immediately before replacement. No append or in-place writes.
                    ensure_sha(&read_small(path)?, &p.request.expected_sha256)?;
                }
                intended_sha = Some(sha(bytes));
                mutation_attempted.store(true, Ordering::Release);
                same_dir_write(path, bytes, op == TfOperation::FileReplace)?;
            }
            TfOperation::FilePatch => {
                let original = read_small(path)?;
                ensure_sha(&original, &p.request.expected_sha256)?;
                let content =
                    std::str::from_utf8(&original).map_err(|_| "Text patch requires UTF-8 file")?;
                let old = p.request.old_text.as_deref().ok_or("Missing oldText")?;
                if content.match_indices(old).count() != 1 {
                    return Err("Patch conflict: oldText must occur exactly once".into());
                }
                let updated = content.replacen(old, p.request.new_text.as_deref().unwrap_or(""), 1);
                if updated.len() > WRITE_CAP {
                    return Err("Patch result exceeds write cap".into());
                }
                intended_sha = Some(sha(updated.as_bytes()));
                mutation_attempted.store(true, Ordering::Release);
                same_dir_write(path, updated.as_bytes(), true)?;
            }
            TfOperation::FileDelete => {
                ensure_sha(&read_small(path)?, &p.request.expected_sha256)?;
                mutation_attempted.store(true, Ordering::Release);
                fs::remove_file(path).map_err(failure)?;
            }
            TfOperation::DirectoryCreate => {
                mutation_attempted.store(true, Ordering::Release);
                fs::create_dir(path).map_err(failure)?;
            }
            TfOperation::FileMove => {
                if p.canonical_paths[1].exists() {
                    return Err("Move destination appeared".into());
                }
                ensure_sha(&read_small(path)?, &p.request.expected_sha256)?;
                mutation_attempted.store(true, Ordering::Release);
                fs::rename(path, &p.canonical_paths[1]).map_err(failure)?;
            }
            _ => return Err("Unsupported filesystem write".into()),
        }
        // Read back the *actual* path, contents and identity. A successful
        // syscall alone is never proof of the intended filesystem effect.
        // Failed independent verification is Unknown, never Observed.
        let verify: Result<(Option<String>, Option<u64>), String> = (|| {
            for path in &p.canonical_paths {
                inspect_components(path)?;
                let current = fs::canonicalize(path);
                if !(op == TfOperation::FileDelete && path == &p.canonical_paths[0])
                    && !(op == TfOperation::FileMove && path == &p.canonical_paths[0])
                    && current.map_err(failure)? != *path
                {
                    return Err("Post-effect path identity changed".into());
                }
            }
            match op {
                TfOperation::FileCreate | TfOperation::FileReplace => {
                    let actual = read_small(path)?;
                    let digest = sha(&actual);
                    if intended_sha.as_deref() != Some(digest.as_str()) {
                        return Err("Post-write content mismatch".into());
                    }
                    Ok((Some(digest), Some(actual.len() as u64)))
                }
                TfOperation::FilePatch => {
                    let actual = read_small(path)?;
                    let digest = sha(&actual);
                    if intended_sha.as_deref() != Some(digest.as_str()) {
                        return Err("Post-patch content mismatch".into());
                    }
                    Ok((Some(digest), Some(actual.len() as u64)))
                }
                TfOperation::FileDelete => {
                    if path.exists() {
                        Err("Delete target still exists".into())
                    } else {
                        Ok((None, source_bytes))
                    }
                }
                TfOperation::DirectoryCreate => {
                    if fs::metadata(path).map_err(failure)?.is_dir() {
                        Ok((None, None))
                    } else {
                        Err("Created target is not a directory".into())
                    }
                }
                TfOperation::FileMove => {
                    if path.exists() {
                        return Err("Move source still exists".into());
                    }
                    let actual = read_small(&p.canonical_paths[1])?;
                    let digest = sha(&actual);
                    if result.before_sha256.as_ref() != Some(&digest) {
                        return Err("Move destination content mismatch".into());
                    }
                    Ok((Some(digest), Some(actual.len() as u64)))
                }
                _ => Err("Unsupported write verification".into()),
            }
        })();
        match verify {
            Ok((actual_digest, verified_bytes)) => {
                result.effect_state = "Observed";
                result.uncertainty = "none";
                result.after_sha256 = actual_digest;
                result.after_exists = Some(op != TfOperation::FileDelete);
                result.bytes_affected = verified_bytes;
                result.affected = p
                    .canonical_paths
                    .iter()
                    .map(|v| v.display().to_string())
                    .collect();
            }
            Err(e) => {
                result.terminal = "verification_failed";
                result.effect_state = "Unknown";
                result.uncertainty = "post_write_verification_failed";
                result.stderr = e;
            }
        }
        Ok(result)
    }

    fn list_directory(path: &Path, max: usize) -> Result<(Vec<serde_json::Value>, bool), String> {
        let mut result = Vec::new();
        for item in fs::read_dir(path).map_err(failure)? {
            let item = item.map_err(failure)?;
            let name = item.file_name().to_string_lossy().to_string();
            if check_secret_component(&name).is_err() {
                continue;
            }
            let meta = fs::symlink_metadata(item.path()).map_err(failure)?;
            if meta.file_type().is_symlink() || meta.file_attributes() & 0x400 != 0 {
                continue;
            }
            if result.len() >= max {
                return Ok((result, true));
            }
            result.push(serde_json::json!({
                "name": name, "directory": meta.is_dir(), "bytes": meta.len()
            }));
        }
        result.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
        Ok((result, false))
    }
    fn walk(
        path: &Path,
        root: &Path,
        depth: u64,
        max_depth: u64,
        visited: &mut usize,
        bytes: &mut u64,
        req: &TfOperationRequest,
        matches: &mut Vec<serde_json::Value>,
        cancelled: &AtomicBool,
        deadline: Instant,
        truncated: &mut bool,
    ) -> Result<(), String> {
        if depth > max_depth || matches.len() >= 200 {
            *truncated = true;
            return Ok(());
        }
        for item in fs::read_dir(path).map_err(failure)? {
            if Instant::now() >= deadline {
                return Err("Directory search wall-time budget exhausted".into());
            }
            if cancelled.load(Ordering::Acquire) {
                return Err("Search cancelled".into());
            }
            *visited += 1;
            if *visited > SEARCH_ENTRY_CAP {
                return Err("Directory search entry budget exhausted".into());
            }
            let item = item.map_err(failure)?;
            let p = item.path();
            let name = item.file_name().to_string_lossy().to_string();
            if check_secret_component(&name).is_err() {
                continue;
            }
            let meta = fs::symlink_metadata(&p).map_err(failure)?;
            if meta.file_type().is_symlink() || meta.file_attributes() & 0x400 != 0 {
                continue;
            }
            if meta.is_dir() {
                if depth < max_depth {
                    walk(
                        &p,
                        root,
                        depth + 1,
                        max_depth,
                        visited,
                        bytes,
                        req,
                        matches,
                        cancelled,
                        deadline,
                        truncated,
                    )?;
                } else {
                    *truncated = true;
                }
                continue;
            }
            if !meta.is_file() {
                continue;
            }
            let relative = p
                .strip_prefix(root)
                .map_err(failure)?
                .to_string_lossy()
                .replace('\\', "/");
            if req.operation == TfOperation::FileFind {
                let glob_match = match req.pattern.as_deref() {
                    Some(pattern) => globset::Glob::new(pattern)
                        .map_err(failure)?
                        .compile_matcher()
                        .is_match(&relative),
                    None => true,
                };
                let query_match = req.query.as_deref().is_none_or(|q| {
                    relative
                        .to_ascii_lowercase()
                        .contains(&q.to_ascii_lowercase())
                });
                if glob_match && query_match {
                    matches.push(serde_json::json!({"path": relative, "bytes": meta.len()}));
                }
            } else {
                if meta.len() > FILE_CAP {
                    continue;
                }
                *bytes += meta.len();
                if *bytes > SEARCH_BYTES_CAP {
                    return Err("Search scanned byte budget exhausted".into());
                }
                let content = read_small(&p)?;
                if let Ok(content) = std::str::from_utf8(&content) {
                    let needle = req.query.as_deref().ok_or("Search query missing")?;
                    for (line, content) in content.lines().enumerate() {
                        if content.contains(needle) {
                            matches.push(serde_json::json!({
                                "path": relative, "line": line + 1,
                                "text": content.chars().take(256).collect::<String>()
                            }));
                            if matches.len() >= 200 {
                                *truncated = true;
                                break;
                            }
                        }
                    }
                }
            }
            if matches.len() >= 200 {
                *truncated = true;
                break;
            }
        }
        Ok(())
    }
    fn read_effect(p: &Pending, cancelled: &AtomicBool) -> Result<Outcome, String> {
        let path = &p.canonical_paths[0];
        match p.request.operation {
            TfOperation::FileRead => {
                let bytes = read_small(path)?;
                let start = p.request.offset.unwrap_or(0) as usize;
                let end = start
                    .saturating_add(p.request.limit.unwrap_or(8192) as usize)
                    .min(bytes.len());
                if start > bytes.len() {
                    return Err("Read offset past end of file".into());
                }
                let chunk = std::str::from_utf8(&bytes[start..end])
                    .map_err(|_| "Non-UTF-8 file content denied")?;
                let mut out = Outcome::no_effect(chunk.to_owned());
                out.stdout_truncated = start != 0 || end != bytes.len();
                Ok(out)
            }
            TfOperation::FileStat => {
                let meta = fs::symlink_metadata(path).map_err(failure)?;
                let digest = if meta.is_file() && meta.len() <= FILE_CAP {
                    Some(sha(&read_small(path)?))
                } else {
                    None
                };
                Ok(Outcome::no_effect(
                    serde_json::json!({
                        "path": path.display().to_string(), "directory": meta.is_dir(),
                        "bytes": meta.len(), "sha256": digest
                    })
                    .to_string(),
                ))
            }
            TfOperation::DirectoryList => {
                let (items, truncated) =
                    list_directory(path, p.request.limit.unwrap_or(200).min(512) as usize)?;
                let mut out = Outcome::no_effect(serde_json::to_string(&items).map_err(failure)?);
                out.stdout_truncated = truncated;
                Ok(out)
            }
            TfOperation::FileFind | TfOperation::TextSearch => {
                let mut visited = 0;
                let mut bytes = 0;
                let mut results = Vec::new();
                let mut truncated = false;
                walk(
                    path,
                    path,
                    0,
                    p.request.depth.unwrap_or(4),
                    &mut visited,
                    &mut bytes,
                    &p.request,
                    &mut results,
                    cancelled,
                    Instant::now() + Duration::from_millis(p.request.timeout_ms.unwrap_or(5_000)),
                    &mut truncated,
                )?;
                let mut out = Outcome::no_effect(serde_json::to_string(&results).map_err(failure)?);
                out.stdout_truncated = truncated;
                Ok(out)
            }
            _ => Err("Unsupported filesystem read".into()),
        }
    }

    fn ensure_clean_git_effect_surface(root: &Path) -> Result<(), String> {
        // Git attributes may dispatch arbitrary filter.<driver>.process/clean
        // executables during add/switch; do not silently treat Git as a sandbox.
        let git = root.join(".git");
        if git.join("info/attributes").exists() {
            return Err("UNSUPPORTED: custom Git info attributes".into());
        }
        let mut stack = vec![root.to_path_buf()];
        let mut entries = 0usize;
        while let Some(dir) = stack.pop() {
            for item in fs::read_dir(&dir).map_err(failure)? {
                entries += 1;
                if entries > 8192 {
                    return Err("UNSUPPORTED: repository tree safety scan exceeds budget".into());
                }
                let item = item.map_err(failure)?;
                let name = item.file_name().to_string_lossy().to_ascii_lowercase();
                if name == ".git" {
                    if dir == root && item.path() == git {
                        continue;
                    }
                    return Err("UNSUPPORTED: nested repository/submodule Git metadata".into());
                }
                if name == ".gitattributes" || name == ".gitmodules" {
                    return Err("UNSUPPORTED: Git attributes could select external filters".into());
                }
                let meta = fs::symlink_metadata(item.path()).map_err(failure)?;
                if meta.file_type().is_symlink() || meta.file_attributes() & 0x400 != 0 {
                    return Err(
                        "UNSUPPORTED: Git working tree contains link or reparse point".into(),
                    );
                }
                if meta.is_dir() {
                    stack.push(item.path());
                }
            }
        }
        Ok(())
    }
    fn git_windows_disk_path(canonical: &Path) -> Result<PathBuf, String> {
        let spelling = canonical.to_str().ok_or("Non-Unicode Git path denied")?;
        // Rust canonical paths use Windows verbatim disk spelling. Git for
        // Windows does not accept --git-dir=\\?\C:\... on this platform.
        // Convert only a previously canonicalized *local disk* path; never
        // accept a UNC/device/verbatim path provided by the renderer.
        let disk = spelling.strip_prefix(r"\\?\").unwrap_or(spelling);
        let b = disk.as_bytes();
        if b.len() < 3 || !b[0].is_ascii_alphabetic() || b[1] != b':' || b[2] != b'\\' {
            return Err("Git requires canonical local Windows disk path".into());
        }
        Ok(PathBuf::from(disk))
    }
    fn pinned_git_command(root: &Path) -> Result<Command, String> {
        let executable =
            fs::canonicalize(GIT).map_err(|_| "UNSUPPORTED: pinned Windows Git unavailable")?;
        let git = fs::canonicalize(root.join(".git")).map_err(failure)?;
        if git != root.join(".git") {
            return Err("Git metadata redirected".into());
        }
        let git_cli = git_windows_disk_path(&git)?;
        let root_cli = git_windows_disk_path(root)?;
        let mut cmd = Command::new(executable);
        // No renderer-supplied executable, env, shell, argv prefix, or config
        // path. Explicit Git flags + env disable extension execution paths.
        cmd.current_dir(&root_cli).env_clear();
        if let Some(system_root) = std::env::var_os("SystemRoot") {
            cmd.env("SystemRoot", system_root);
        }
        cmd.env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_SYSTEM", "NUL")
            .env("GIT_CONFIG_GLOBAL", "NUL")
            .env("GIT_ATTR_NOSYSTEM", "1")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_NO_REPLACE_OBJECTS", "1")
            .env("GIT_LFS_SKIP_SMUDGE", "1")
            .env("GIT_CONFIG_COUNT", "6")
            .env("GIT_CONFIG_KEY_0", "core.hooksPath")
            .env("GIT_CONFIG_VALUE_0", "NUL")
            .env("GIT_CONFIG_KEY_1", "core.fsmonitor")
            .env("GIT_CONFIG_VALUE_1", "false")
            .env("GIT_CONFIG_KEY_2", "diff.external")
            .env("GIT_CONFIG_VALUE_2", "")
            .env("GIT_CONFIG_KEY_3", "core.attributesFile")
            .env("GIT_CONFIG_VALUE_3", "NUL")
            .env("GIT_CONFIG_KEY_4", "protocol.ext.allow")
            .env("GIT_CONFIG_VALUE_4", "never")
            .env("GIT_CONFIG_KEY_5", "protocol.file.allow")
            .env("GIT_CONFIG_VALUE_5", "never")
            .arg("-c")
            .arg("core.hooksPath=NUL")
            .arg("-c")
            .arg("core.fsmonitor=false")
            .arg("--git-dir")
            .arg(&git_cli)
            .arg("--work-tree")
            .arg(&root_cli)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        Ok(cmd)
    }
    fn as_relative<'a>(root: &Path, path: &'a Path) -> Result<&'a Path, String> {
        path.strip_prefix(root).map_err(failure)
    }
    fn repo_command(p: &Pending) -> Result<Command, String> {
        let root = &p.workspace_root;
        check_repo(root)?;
        let mut cmd = pinned_git_command(root)?;
        match p.request.operation {
            TfOperation::RepoStatus => {
                cmd.args(["status", "--porcelain=v1", "--untracked-files=no"]);
            }
            TfOperation::RepoBranch => {
                cmd.args(["branch", "--show-current"]);
            }
            TfOperation::RepoHead => {
                cmd.args(["rev-parse", "--verify", "HEAD"]);
            }
            TfOperation::RepoChanged => {
                cmd.args(["diff", "--name-only", "--no-ext-diff", "--no-textconv"]);
            }
            TfOperation::RepoDiff => {
                cmd.args(["diff", "--no-ext-diff", "--no-textconv", "--no-renames"]);
                cmd.arg("--");
                for path in &p.canonical_paths {
                    cmd.arg(as_relative(root, path)?);
                }
            }
            TfOperation::RepoStagedDiff => {
                cmd.args([
                    "diff",
                    "--cached",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--no-renames",
                ]);
                cmd.arg("--");
                for path in &p.canonical_paths {
                    cmd.arg(as_relative(root, path)?);
                }
            }
            TfOperation::RepoLog => {
                cmd.args(["log", "-n", "30", "--format=%h %aI"]);
            }
            TfOperation::RepoShow => {
                cmd.args(["show", "--no-ext-diff", "--no-textconv", "--format="]);
                cmd.arg(p.request.ref_name.as_deref().unwrap_or("HEAD"));
                cmd.arg("--");
                for path in &p.canonical_paths {
                    cmd.arg(as_relative(root, path)?);
                }
            }
            TfOperation::RepoRefs => {
                cmd.args(["for-each-ref", "--format=%(refname:short)"]);
            }
            TfOperation::RepoStage => {
                ensure_clean_git_effect_surface(root)?;
                cmd.args(["add", "-A", "--"]);
                for path in &p.canonical_paths {
                    cmd.arg(as_relative(root, path)?);
                }
            }
            TfOperation::RepoUnstage => {
                ensure_clean_git_effect_surface(root)?;
                cmd.args(["restore", "--staged", "--"]);
                for path in &p.canonical_paths {
                    cmd.arg(as_relative(root, path)?);
                }
            }
            TfOperation::RepoCreateBranch => {
                ensure_clean_git_effect_surface(root)?;
                cmd.arg("branch")
                    .arg(p.request.ref_name.as_deref().ok_or("Branch name missing")?);
            }
            TfOperation::RepoSwitchBranch => {
                ensure_clean_git_effect_surface(root)?;
                cmd.args(["switch", "--no-guess"]);
                cmd.arg(p.request.ref_name.as_deref().ok_or("Branch name missing")?);
            }
            _ => return Err("Not a supported repository operation".into()),
        }
        crate::modules::proc::hide_console(&mut cmd);
        Ok(cmd)
    }
    fn build_command(p: &Pending) -> Result<Command, String> {
        let npm = Path::new(r"C:\Program Files\nodejs\npm.cmd");
        let cargo = std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .ok_or("UNSUPPORTED: no trusted Cargo installation")?
            .join(".cargo/bin/cargo.exe");
        let op = p.request.operation;
        let program = if matches!(op, TfOperation::BuildTypecheck | TfOperation::BuildFrontend) {
            npm
        } else {
            cargo.as_path()
        };
        if !program.is_file() || is_reparse(program)? {
            return Err("UNSUPPORTED: pinned build executable unavailable/aliased".into());
        }
        let mut cmd = Command::new(fs::canonicalize(program).map_err(failure)?);
        cmd.current_dir(&p.workspace_root).env_clear();
        // Cargo and npm require host roots and a narrowly scoped PATH for
        // toolchains. Do not carry renderer-supplied env through to the child.
        for name in [
            "SystemRoot",
            "WINDIR",
            "TEMP",
            "TMP",
            "USERPROFILE",
            "APPDATA",
            "LOCALAPPDATA",
        ] {
            if let Some(value) = std::env::var_os(name) {
                cmd.env(name, value);
            }
        }
        if let Some(home) = std::env::var_os("USERPROFILE") {
            let home = PathBuf::from(home);
            cmd.env("CARGO_HOME", home.join(".cargo"))
                .env("RUSTUP_HOME", home.join(".rustup"));
        }
        let mut path_dirs = vec![
            PathBuf::from(r"C:\Windows\System32"),
            PathBuf::from(r"C:\Windows"),
            PathBuf::from(r"C:\Program Files\nodejs"),
        ];
        if !matches!(op, TfOperation::BuildTypecheck | TfOperation::BuildFrontend) {
            let bin = cargo.parent().ok_or("Cargo bin directory missing")?;
            if is_reparse(bin)? {
                return Err("UNSUPPORTED: Cargo bin directory aliased".into());
            }
            path_dirs.push(fs::canonicalize(bin).map_err(failure)?);
        }
        let safe_path = std::env::join_paths(path_dirs).map_err(failure)?;
        cmd.env("CARGO_NET_OFFLINE", "true")
            .env("CI", "1")
            .env("ComSpec", r"C:\Windows\System32\cmd.exe")
            .env("PATH", safe_path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        match op {
            TfOperation::BuildTypecheck => {
                cmd.args(["run", "check-types", "--ignore-scripts"]);
            }
            TfOperation::BuildFrontend => {
                cmd.args(["run", "build", "--ignore-scripts"]);
            }
            TfOperation::BuildCargoCheck => {
                cmd.args([
                    "check",
                    "--locked",
                    "--offline",
                    "--manifest-path",
                    "src-tauri/Cargo.toml",
                ]);
            }
            TfOperation::BuildCargoTest => {
                cmd.args([
                    "test",
                    "--locked",
                    "--offline",
                    "--manifest-path",
                    "src-tauri/Cargo.toml",
                ]);
            }
            TfOperation::BuildCargoBuild => {
                cmd.args([
                    "build",
                    "--locked",
                    "--offline",
                    "--manifest-path",
                    "src-tauri/Cargo.toml",
                ]);
            }
            _ => return Err("Not a supported build operation".into()),
        }
        crate::modules::proc::hide_console(&mut cmd);
        Ok(cmd)
    }
    fn git_index_sha(root: &Path) -> Result<Option<String>, String> {
        let path = root.join(".git/index");
        match fs::symlink_metadata(&path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(failure(e)),
            Ok(meta) => {
                if !meta.is_file() || meta.file_attributes() & 0x400 != 0 {
                    return Err("Git index file alias denied".into());
                }
                if meta.len() > 16 * 1024 * 1024 {
                    return Err("UNSUPPORTED: Git index exceeds verification budget".into());
                }
                Ok(Some(sha(&fs::read(path).map_err(failure)?)))
            }
        }
    }
    fn verify_staging(
        p: &Pending,
        cancelled: Arc<AtomicBool>,
        deadline: Instant,
    ) -> Result<bool, String> {
        let mut cmd = pinned_git_command(&p.workspace_root)?;
        cmd.args([
            "diff",
            "--cached",
            "--name-only",
            "--no-ext-diff",
            "--no-textconv",
            "--",
        ]);
        for path in &p.canonical_paths {
            cmd.arg(as_relative(&p.workspace_root, path)?);
        }
        crate::modules::proc::hide_console(&mut cmd);
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("Staging verification time budget exhausted".into());
        }
        let result = run_bounded_process(cmd, cancelled, Duration::from_secs(5).min(remaining))?;
        if result.terminal != "completed"
            || result.exit_code != Some(0)
            || result.stdout_truncated
            || result.stderr_truncated
        {
            return Err("Staging verification process incomplete".into());
        }
        Ok(if p.request.operation == TfOperation::RepoStage {
            !result.stdout.trim().is_empty()
        } else {
            result.stdout.trim().is_empty()
        })
    }
    fn git_probe(
        root: &Path,
        args: &[&str],
        cancelled: &Arc<AtomicBool>,
        deadline: Instant,
    ) -> Option<BoundedProcessResult> {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return None;
        }
        let mut command = pinned_git_command(root).ok()?;
        command.args(args);
        crate::modules::proc::hide_console(&mut command);
        let result = run_bounded_process(
            command,
            cancelled.clone(),
            Duration::from_secs(3).min(remaining),
        )
        .ok()?;
        (result.terminal == "completed" && !result.stdout_truncated && !result.stderr_truncated)
            .then_some(result)
    }
    fn git_probe_text(
        root: &Path,
        args: &[&str],
        cancelled: &Arc<AtomicBool>,
        deadline: Instant,
    ) -> Option<String> {
        let result = git_probe(root, args, cancelled, deadline)?;
        if result.exit_code != Some(0) || result.stdout.contains('\u{fffd}') {
            return None;
        }
        Some(result.stdout.trim().to_owned())
    }
    fn valid_git_oid(value: &str) -> bool {
        matches!(value.len(), 40 | 64) && value.bytes().all(|b| b.is_ascii_hexdigit())
    }
    fn git_probe_oid(
        root: &Path,
        reference: &str,
        cancelled: &Arc<AtomicBool>,
        deadline: Instant,
    ) -> Option<String> {
        let value = git_probe_text(
            root,
            &["rev-parse", "--verify", reference],
            cancelled,
            deadline,
        )?;
        valid_git_oid(&value).then_some(value)
    }
    fn git_probe_paths(
        root: &Path,
        staged: bool,
        cancelled: &Arc<AtomicBool>,
        deadline: Instant,
    ) -> Option<Vec<String>> {
        let args: &[&str] = if staged {
            &[
                "diff",
                "--cached",
                "--name-only",
                "-z",
                "--no-ext-diff",
                "--no-textconv",
                "--no-renames",
            ]
        } else {
            &[
                "diff",
                "--name-only",
                "-z",
                "--no-ext-diff",
                "--no-textconv",
                "--no-renames",
            ]
        };
        let result = git_probe(root, args, cancelled, deadline)?;
        if result.exit_code != Some(0) || result.stdout.contains('\u{fffd}') {
            return None;
        }
        if !result.stdout.is_empty() && !result.stdout.ends_with('\0') {
            return None;
        }
        let mut paths = Vec::new();
        for name in result.stdout.split_terminator('\0') {
            if paths.len() >= 128 || name.len() > 4096 {
                return None;
            }
            let path = check_lexical(name).ok()?;
            if path.is_absolute()
                || path
                    .components()
                    .any(|c| !matches!(c, Component::Normal(_)))
            {
                return None;
            }
            // Do not leak credential filenames in an otherwise innocent
            // repository status receipt, even when Git itself lists them.
            paths.push(name.replace('\\', "/"));
        }
        Some(paths)
    }
    fn git_probe_snapshot(
        p: &Pending,
        cancelled: &Arc<AtomicBool>,
        deadline: Instant,
    ) -> RepoSnapshot {
        let root = &p.workspace_root;
        let head = git_probe_oid(root, "HEAD", cancelled, deadline);
        let branch = git_probe_text(
            root,
            &["symbolic-ref", "--quiet", "--short", "HEAD"],
            cancelled,
            deadline,
        )
        .filter(|value| validate_ref(value).is_ok());
        let (ref_exists, ref_oid) = if let Some(name) = p.request.ref_name.as_deref().filter(|_| {
            matches!(
                p.request.operation,
                TfOperation::RepoCreateBranch | TfOperation::RepoSwitchBranch
            )
        }) {
            // The refName was validated at prepare, approval and execution.
            let reference = format!("refs/heads/{name}");
            let exists = git_probe(
                root,
                &["show-ref", "--verify", "--quiet", &reference],
                cancelled,
                deadline,
            )
            .and_then(|result| match result.exit_code {
                Some(0) => Some(true),
                Some(1) => Some(false),
                _ => None,
            });
            let oid = exists.and_then(|present| {
                present
                    .then(|| git_probe_oid(root, &reference, cancelled, deadline))
                    .flatten()
            });
            (exists, oid)
        } else {
            (None, None)
        };
        // Branch/HEAD/ref operations do not need extra status/diff subprocesses
        // to prove their narrow ref state. All optional snapshot probes share
        // the operation deadline; missing observations remain None.
        let include_paths = matches!(
            p.request.operation,
            TfOperation::RepoStatus
                | TfOperation::RepoChanged
                | TfOperation::RepoDiff
                | TfOperation::RepoStagedDiff
                | TfOperation::RepoStage
                | TfOperation::RepoUnstage
        );
        RepoSnapshot {
            head,
            branch,
            ref_exists,
            ref_oid,
            changed_paths: include_paths
                .then(|| git_probe_paths(root, false, cancelled, deadline))
                .flatten(),
            staged_paths: include_paths
                .then(|| git_probe_paths(root, true, cancelled, deadline))
                .flatten(),
        }
    }
    fn process_effect(p: &Pending, cancelled: Arc<AtomicBool>) -> Result<Outcome, String> {
        let stage_operation = matches!(
            p.request.operation,
            TfOperation::RepoStage | TfOperation::RepoUnstage
        );
        let before_index = if stage_operation {
            Some(git_index_sha(&p.workspace_root)?)
        } else {
            None
        };
        let cmd = if p.request.operation.is_repo() {
            repo_command(p)?
        } else {
            build_command(p)?
        };
        // Capture the *actual* allowlisted native Command before ownership is
        // transferred. This is argv, never a shell string or user content.
        let executable = cmd.get_program().to_string_lossy().into_owned();
        let argv: Vec<String> = cmd
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        let command_cwd = cmd.get_current_dir().map(|path| path.display().to_string());
        let ms = p
            .request
            .timeout_ms
            .unwrap_or(if p.request.operation.is_build() {
                90_000
            } else {
                10_000
            });
        // Pin a shared deadline across before/after snapshot subprocesses and
        // the primary command. Exhausted probes become null rather than
        // silently stacking independent three-second timeouts.
        let deadline = Instant::now() + Duration::from_millis(ms);
        let before_repo = p
            .request
            .operation
            .is_repo()
            .then(|| git_probe_snapshot(p, &cancelled, deadline));
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Ok(Outcome {
                terminal: "timed_out_before_spawn",
                effect_state: "NoEffect",
                executable: Some(executable),
                argv,
                command_cwd,
                before_repo,
                uncertainty: "observation_budget_exhausted_without_spawn",
                ..Outcome::default()
            });
        }
        let r: BoundedProcessResult = match run_bounded_process(cmd, cancelled.clone(), remaining) {
            Ok(result) => result,
            Err(error) => {
                // Spawn can fail after some child setup: never claim a write
                // was absent merely because process supervision failed.
                return Ok(Outcome {
                    terminal: "failed",
                    effect_state: if p.request.operation.is_write() {
                        "Unknown"
                    } else {
                        "NoEffect"
                    },
                    executable: Some(executable),
                    argv,
                    command_cwd,
                    before_repo,
                    stderr: error,
                    uncertainty: "process_spawn_or_supervision_failed",
                    ..Outcome::default()
                });
            }
        };
        let success = r.terminal == "completed" && r.exit_code == Some(0);
        let write = p.request.operation.is_write();
        let after_repo = p
            .request
            .operation
            .is_repo()
            .then(|| git_probe_snapshot(p, &cancelled, deadline));
        let mut out = Outcome {
            executable: Some(executable),
            argv,
            command_cwd,
            before_repo,
            after_repo,
            terminal: if r.terminal == "completed" && !success {
                "failed"
            } else {
                r.terminal
            },
            effect_state: if write && r.pid.is_some() {
                "Unknown"
            } else {
                "NoEffect"
            },
            stdout: r.stdout,
            stderr: r.stderr,
            stdout_truncated: r.stdout_truncated,
            stderr_truncated: r.stderr_truncated,
            pid: r.pid,
            exit_code: r.exit_code,
            uncertainty: if write && r.pid.is_some() {
                "process_effect_not_independently_observed"
            } else if success {
                "none"
            } else {
                "process_incomplete"
            },
            ..Outcome::default()
        };
        if stage_operation {
            out.before_sha256 = before_index.clone().flatten();
            out.before_exists = Some(before_index.as_ref().is_some_and(Option::is_some));
            if let Ok(after_index) = git_index_sha(&p.workspace_root) {
                out.after_exists = Some(after_index.is_some());
                out.after_sha256 = after_index.clone();
                if success
                    && before_index.as_ref() != Some(&after_index)
                    && matches!(verify_staging(p, cancelled, deadline), Ok(true))
                {
                    out.effect_state = "Observed";
                    out.uncertainty = "none";
                    out.affected = vec![p.workspace_root.join(".git/index").display().to_string()];
                }
            }
        }
        if success {
            let before = out.before_repo.as_ref();
            let after = out.after_repo.as_ref();
            let verified = match p.request.operation {
                TfOperation::RepoCreateBranch => {
                    before.zip(after).is_some_and(|(before, after)| {
                        before.ref_exists == Some(false)
                            && after.ref_exists == Some(true)
                            && before.head.is_some()
                            && after.ref_oid == before.head
                            && after.head == before.head
                            && before.branch == after.branch
                    })
                }
                TfOperation::RepoSwitchBranch => {
                    before.zip(after).is_some_and(|(before, after)| {
                        let requested = p.request.ref_name.as_deref();
                        before.branch.as_deref() != requested
                            && after.branch.as_deref() == requested
                            && after.head.is_some()
                            && after.ref_exists == Some(true)
                            && after.head == after.ref_oid
                    })
                }
                _ => false,
            };
            if verified {
                // Branch creation modifies only a ref and can be proven by
                // the ref's previous absence, newly observed OID, and
                // unchanged HEAD/branch. Switch may also mutate the worktree:
                // matching HEAD/branch/ref does NOT prove its whole effect.
                if p.request.operation == TfOperation::RepoCreateBranch {
                    out.effect_state = "Observed";
                }
                out.uncertainty = "branch_ref_verified_worktree_not_independently_verified";
                if let Some(name) = p.request.ref_name.as_deref() {
                    out.affected = match p.request.operation {
                        TfOperation::RepoCreateBranch => vec![p
                            .workspace_root
                            .join(".git/refs/heads")
                            .join(name)
                            .display()
                            .to_string()],
                        TfOperation::RepoSwitchBranch => vec![
                            p.workspace_root.join(".git/HEAD").display().to_string(),
                            p.workspace_root.display().to_string(),
                        ],
                        _ => Vec::new(),
                    };
                }
            }
        }
        Ok(out)
    }
    fn receipt(p: Pending, mut out: Outcome, started_at: u64) -> TfOperationReceipt {
        // Returned text is bounded independently of pipe draining in TF1.
        if out.stdout.len() > OUTPUT_CAP {
            let old = std::mem::take(&mut out.stdout);
            bounded_output(old, &mut out);
        }
        if out.stderr.len() > OUTPUT_CAP {
            let cut = out.stderr.floor_char_boundary(OUTPUT_CAP);
            out.stderr.truncate(cut);
            out.stderr_truncated = true;
        }
        let before = out.before_repo.take().unwrap_or_default();
        let after = out.after_repo.take().unwrap_or_default();
        let command_adapter = if p.request.operation.is_repo() {
            "pinned_git"
        } else if matches!(
            p.request.operation,
            TfOperation::BuildTypecheck | TfOperation::BuildFrontend
        ) {
            "pinned_npm"
        } else if p.request.operation.is_build() {
            "pinned_cargo"
        } else {
            "native_filesystem"
        };
        let command_cwd = out.command_cwd.unwrap_or_else(|| {
            if p.request.operation.is_repo() || p.request.operation.is_build() {
                p.workspace_root.display().to_string()
            } else {
                p.cwd.display().to_string()
            }
        });
        // Preserve the spelling submitted by the already-validated request.
        // canonicalPaths separately records the native-resolved target(s).
        // Never surface content/queries or unvalidated filesystem input.
        let mut requested_resources = Vec::new();
        if let Some(path) = p.request.path.as_ref() {
            requested_resources.push(path.clone());
        }
        if let Some(destination) = p.request.destination.as_ref() {
            requested_resources.push(destination.clone());
        }
        if let Some(paths) = p.request.paths.as_ref() {
            requested_resources.extend(paths.iter().cloned());
        }
        if requested_resources.is_empty() {
            requested_resources.push(p.request.workspace_root.clone());
        }
        TfOperationReceipt {
            tool_id: "tf.operation.v1",
            request_id: p.request_id.clone(),
            actor: p.request.actor,
            operation: p.request.operation,
            command_adapter,
            executable: out.executable,
            argv: out.argv,
            command_cwd,
            started_at,
            ended_at: epoch_ms(),
            terminal: out.terminal,
            effect_state: out.effect_state,
            before_sha256: out.before_sha256,
            after_sha256: out.after_sha256,
            before_exists: out.before_exists,
            after_exists: out.after_exists,
            bytes_affected: out.bytes_affected,
            before_head: before.head,
            after_head: after.head,
            before_branch: before.branch,
            after_branch: after.branch,
            ref_name: p.request.ref_name,
            before_ref_exists: before.ref_exists,
            after_ref_exists: after.ref_exists,
            before_ref_oid: before.ref_oid,
            after_ref_oid: after.ref_oid,
            before_changed_paths: before.changed_paths,
            after_changed_paths: after.changed_paths,
            before_staged_paths: before.staged_paths,
            after_staged_paths: after.staged_paths,
            canonical_paths: p
                .canonical_paths
                .iter()
                .map(|v| v.display().to_string())
                .collect(),
            requested_resources,
            affected_resources: out.affected,
            approval_id: (p.approved && p.request.operation.is_write())
                .then(|| format!("approval:{}", p.request_id)),
            retry: if out.effect_state == "Unknown" {
                "UNKNOWN"
            } else if !p.request.operation.is_write() {
                "SAFE_RETRY"
            } else if matches!(
                p.request.operation,
                TfOperation::FileCreate | TfOperation::FileReplace | TfOperation::FilePatch
            ) {
                "CONDITIONAL_RETRY"
            } else {
                "UNSAFE_RETRY"
            },
            auto_retry: false,
            stdout_sha256: sha(out.stdout.as_bytes()),
            stderr_sha256: sha(out.stderr.as_bytes()),
            stdout: out.stdout,
            stderr: out.stderr,
            stdout_truncated: out.stdout_truncated,
            stderr_truncated: out.stderr_truncated,
            pid: out.pid,
            exit_code: out.exit_code,
            uncertainty: out.uncertainty,
            sandbox: "unsupported",
            isolation: "unsupported_filesystem_network_isolation",
        }
    }
    pub fn execute(
        token: &str,
        registry: &WorkspaceRegistry,
        state: &TfOperationState,
    ) -> Result<TfOperationReceipt, String> {
        let cancelled = Arc::new(AtomicBool::new(false));
        let pending = {
            // Atomic handoff matches TF1: cancel observes either pending or active.
            let mut items = state
                .pending
                .lock()
                .map_err(|_| "Operation state unavailable")?;
            let p = items
                .remove(token)
                .ok_or("Unknown or consumed operation token")?;
            if p.expires <= Instant::now() {
                return Err("Operation token expired".into());
            }
            if !p.approved {
                return Err("Native write approval required".into());
            }
            state
                .active
                .lock()
                .map_err(|_| "Operation state unavailable")?
                .insert(token.to_owned(), cancelled.clone());
            p
        };
        let started_at = epoch_ms();
        let result = (|| {
            let (root, cwd, paths) = validate_request(&pending.request, registry)?;
            if pending.workspace_root != root
                || pending.cwd != cwd
                || pending.canonical_paths != paths
            {
                return Err("Operation selected workspace/path identity changed".into());
            }
            if cancelled.load(Ordering::Acquire) {
                return Ok(receipt(
                    pending.clone(),
                    Outcome {
                        terminal: "cancelled_before_effect",
                        effect_state: "NoEffect",
                        uncertainty: "none",
                        ..Outcome::default()
                    },
                    started_at,
                ));
            }
            let mutation_attempted = AtomicBool::new(false);
            let effect =
                if pending.request.operation.is_repo() || pending.request.operation.is_build() {
                    process_effect(&pending, cancelled.clone())
                } else if pending.request.operation.is_write() {
                    checked_file_mutation(&pending, &cancelled, &mutation_attempted)
                } else {
                    read_effect(&pending, &cancelled)
                };
            let out = match effect {
                Ok(out) => out,
                Err(e) => Outcome {
                    terminal: if mutation_attempted.load(Ordering::Acquire) {
                        "failed"
                    } else {
                        "conflict"
                    },
                    effect_state: if mutation_attempted.load(Ordering::Acquire) {
                        "Unknown"
                    } else {
                        "NoEffect"
                    },
                    stderr: e,
                    uncertainty: if mutation_attempted.load(Ordering::Acquire) {
                        "effect_failed"
                    } else {
                        "none"
                    },
                    ..Outcome::default()
                },
            };
            Ok(receipt(pending, out, started_at))
        })();
        state
            .active
            .lock()
            .map_err(|_| "Operation state unavailable")?
            .remove(token);
        result
    }
}

#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
pub(crate) use windows::commit_native_screenshot_evidence;
#[cfg(windows)]
pub use windows::{approve, execute, prepare};

#[tauri::command]
pub fn tf_operation_prepare(
    request: TfOperationRequest,
    registry: tauri::State<'_, WorkspaceRegistry>,
    state: tauri::State<'_, TfOperationState>,
) -> Result<TfOperationPrepared, String> {
    #[cfg(windows)]
    {
        prepare(request, &registry, &state)
    }
    #[cfg(not(windows))]
    {
        let _ = (request, registry, state);
        Err("UNSUPPORTED: native TF operations require Windows".into())
    }
}

#[tauri::command]
pub async fn tf_operation_approve(token: String, app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        windows::approve_modal(token, app).await
    }
    #[cfg(not(windows))]
    {
        let _ = (token, app);
        Err("UNSUPPORTED: native TF operations require Windows".into())
    }
}

#[tauri::command]
pub async fn tf_operation_execute(
    token: String,
    app: tauri::AppHandle,
) -> Result<TfOperationReceipt, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || {
            use tauri::Manager;
            let registry = app.state::<WorkspaceRegistry>();
            let state = app.state::<TfOperationState>();
            execute(&token, &registry, &state)
        })
        .await
        .map_err(|_| "Native operation worker unavailable".to_owned())?
    }
    #[cfg(not(windows))]
    {
        let _ = (token, app);
        Err("UNSUPPORTED: native TF operations require Windows".into())
    }
}

#[tauri::command]
pub fn tf_operation_cancel(
    token: String,
    state: tauri::State<'_, TfOperationState>,
) -> Result<bool, String> {
    cancel(&token, &state)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::fs;
    use std::path::Path;
    use std::time::Duration;

    fn checksum(value: &str) -> String {
        format!("{:x}", Sha256::digest(value.as_bytes()))
    }
    fn fixture() -> (
        tempfile::TempDir,
        WorkspaceRegistry,
        TfOperationState,
        String,
    ) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let registry = WorkspaceRegistry::default();
        registry.authorize(&root).unwrap();
        (dir, registry, TfOperationState::default(), root)
    }
    fn request(op: TfOperation, root: &str) -> TfOperationRequest {
        TfOperationRequest {
            operation: op,
            actor: "native-test".into(),
            workspace_root: root.into(),
            cwd: root.into(),
            path: None,
            destination: None,
            content: None,
            expected_sha256: None,
            old_text: None,
            new_text: None,
            pattern: None,
            query: None,
            ref_name: None,
            paths: None,
            offset: None,
            limit: None,
            depth: None,
            timeout_ms: None,
        }
    }
    fn run(
        req: TfOperationRequest,
        registry: &WorkspaceRegistry,
        state: &TfOperationState,
        approve_write: bool,
    ) -> TfOperationReceipt {
        let prepared = prepare(req, registry, state).unwrap();
        if approve_write {
            approve(&prepared.token, state).unwrap();
        }
        execute(&prepared.token, registry, state).unwrap()
    }
    #[test]
    fn dto_serializes_camel_case_and_closed_enum() {
        let req: TfOperationRequest = serde_json::from_value(serde_json::json!({
            "operation": "file_patch", "actor": "agent:1", "workspaceRoot": "C:\\repo",
            "cwd": "C:\\repo", "path": "note.txt",
            "expectedSha256": "ab", "oldText": "old", "newText": "new",
            "timeoutMs": 5000
        }))
        .unwrap();
        assert_eq!(req.operation, TfOperation::FilePatch);
        let back = serde_json::to_value(req).unwrap();
        assert!(back.get("workspaceRoot").is_some());
        assert!(back.get("expectedSha256").is_some());
        assert!(
            serde_json::from_value::<TfOperationRequest>(serde_json::json!({
                "operation":"raw_command","actor":"agent","workspaceRoot":"x","cwd":"x"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<TfOperationRequest>(serde_json::json!({
                "operation":"file_read","actor":"agent","workspaceRoot":"x",
                "cwd":"x","executable":"powershell.exe"
            }))
            .is_err()
        );
    }
    #[test]
    fn unregistered_scope_traversal_ads_and_secrets_deny_before_execution() {
        let (dir, registry, state, root) = fixture();
        fs::write(dir.path().join("plain.txt"), "safe").unwrap();
        let unregistered = WorkspaceRegistry::default();
        let mut req = request(TfOperation::FileRead, &root);
        req.path = Some("plain.txt".into());
        assert!(prepare(req.clone(), &unregistered, &state).is_err());
        for bad in [
            "..\\outside.txt",
            ".\\plain.txt",
            "plain.txt:stream",
            ".env",
            ".env.production",
            ".git/config",
            "id_ed25519",
            "\\\\server\\share\\outside.txt",
            "CON",
            "readme.txt.",
        ] {
            req.path = Some(bad.into());
            assert!(
                prepare(req.clone(), &registry, &state).is_err(),
                "accepted {bad}"
            );
        }
        let foreign = tempfile::tempdir().unwrap();
        req.path = Some(foreign.path().join("foreign.txt").display().to_string());
        assert!(prepare(req, &registry, &state).is_err());
    }
    #[test]
    fn read_stat_list_find_search_are_bounded_and_one_shot() {
        let (dir, registry, state, root) = fixture();
        fs::write(dir.path().join("alpha.txt"), "hello world\nsecret? no\n").unwrap();
        fs::write(dir.path().join(".env"), "TOP_SECRET").unwrap();
        let mut read = request(TfOperation::FileRead, &root);
        read.path = Some("alpha.txt".into());
        read.limit = Some(5);
        let prepared = prepare(read, &registry, &state).unwrap();
        assert!(!prepared.requires_approval);
        assert_eq!(prepared.expires_in_secs, 60);
        let receipt = execute(&prepared.token, &registry, &state).unwrap();
        assert_eq!(receipt.stdout, "hello");
        assert!(receipt.stdout_truncated);
        assert_eq!(receipt.requested_resources, ["alpha.txt"]);
        assert_eq!(receipt.canonical_paths.len(), 1);
        assert!(receipt.canonical_paths[0].ends_with("alpha.txt"));
        assert_ne!(receipt.requested_resources, receipt.canonical_paths);
        assert_eq!(receipt.bytes_affected, None);
        assert_eq!(receipt.retry, "SAFE_RETRY");
        assert_eq!(receipt.effect_state, "NoEffect");
        assert!(!receipt.auto_retry);
        assert!(execute(&prepared.token, &registry, &state).is_err());
        let mut stat = request(TfOperation::FileStat, &root);
        stat.path = Some("alpha.txt".into());
        assert!(run(stat, &registry, &state, false)
            .stdout
            .contains("sha256"));
        let mut listing = request(TfOperation::DirectoryList, &root);
        listing.path = Some(".".into());
        // A literal dot path is intentionally rejected to avoid path aliases.
        assert!(prepare(listing.clone(), &registry, &state).is_err());
        listing.path = Some(root.clone());
        let root_listing = run(listing.clone(), &registry, &state, false);
        assert!(root_listing.stdout.contains("alpha.txt"));
        assert!(!root_listing.stdout.contains(".env"));
        // Recursive scans may start at the selected root, but root mutation
        // is always denied by the operation-specific target validator.
        let mut root_delete = request(TfOperation::FileDelete, &root);
        root_delete.path = Some(root.clone());
        root_delete.expected_sha256 = Some(checksum(""));
        assert!(prepare(root_delete, &registry, &state).is_err());
        let folder = dir.path().join("list");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("visible.txt"), "here").unwrap();
        fs::write(folder.join(".env"), "hidden").unwrap();
        listing.path = Some("list".into());
        let out = run(listing, &registry, &state, false);
        assert!(out.stdout.contains("visible.txt"));
        assert!(!out.stdout.contains(".env"));
        let mut find = request(TfOperation::FileFind, &root);
        find.path = Some(root.clone());
        find.pattern = Some("**/*.txt".into());
        assert!(run(find, &registry, &state, false)
            .stdout
            .contains("visible.txt"));
        let mut search = request(TfOperation::TextSearch, &root);
        search.path = Some(root.clone());
        search.query = Some("here".into());
        assert!(run(search, &registry, &state, false)
            .stdout
            .contains("visible.txt"));
    }
    #[test]
    fn approved_create_replace_patch_move_delete_and_directory_verify_actual_effects() {
        let (dir, registry, state, root) = fixture();
        let mut create = request(TfOperation::FileCreate, &root);
        create.path = Some("note.txt".into());
        create.content = Some("alpha one".into());
        let unapproved = prepare(create.clone(), &registry, &state).unwrap();
        assert!(unapproved.requires_approval);
        assert!(execute(&unapproved.token, &registry, &state).is_err());
        assert!(!dir.path().join("note.txt").exists());
        let made = run(create, &registry, &state, true);
        assert_eq!(made.effect_state, "Observed");
        assert_eq!(made.before_exists, Some(false));
        assert_eq!(made.after_exists, Some(true));
        assert_eq!(made.requested_resources, ["note.txt"]);
        assert_eq!(made.bytes_affected, Some("alpha one".len() as u64));
        assert_eq!(
            made.after_sha256.as_deref(),
            Some(checksum("alpha one").as_str())
        );
        assert_eq!(made.retry, "CONDITIONAL_RETRY");
        let mut stale = request(TfOperation::FileReplace, &root);
        stale.path = Some("note.txt".into());
        stale.content = Some("MUST NOT WRITE".into());
        stale.expected_sha256 = Some(checksum("wrong"));
        let denied = run(stale, &registry, &state, true);
        assert_eq!(denied.effect_state, "NoEffect");
        assert_eq!(denied.terminal, "conflict");
        assert_eq!(denied.bytes_affected, None);
        assert_eq!(
            fs::read_to_string(dir.path().join("note.txt")).unwrap(),
            "alpha one"
        );
        let mut external_edit = request(TfOperation::FileReplace, &root);
        external_edit.path = Some("note.txt".into());
        external_edit.content = Some("MUST NOT OVERWRITE EXTERNAL CHANGE".into());
        external_edit.expected_sha256 = Some(checksum("alpha one"));
        let prepared = prepare(external_edit, &registry, &state).unwrap();
        // Change source AFTER prepare, BEFORE approval/execute.
        fs::write(dir.path().join("note.txt"), "external changed").unwrap();
        approve(&prepared.token, &state).unwrap();
        let conflict = execute(&prepared.token, &registry, &state).unwrap();
        assert_eq!(conflict.effect_state, "NoEffect");
        assert_eq!(conflict.terminal, "conflict");
        assert!(!conflict.auto_retry);
        assert_eq!(conflict.bytes_affected, None);
        assert_eq!(
            fs::read_to_string(dir.path().join("note.txt")).unwrap(),
            "external changed"
        );
        // Restore our fixture before exercising a fresh matching precondition.
        fs::write(dir.path().join("note.txt"), "alpha one").unwrap();
        let mut replace = request(TfOperation::FileReplace, &root);
        replace.path = Some("note.txt".into());
        replace.content = Some("alpha two".into());
        replace.expected_sha256 = Some(checksum("alpha one"));
        let written = run(replace, &registry, &state, true);
        assert_eq!(written.effect_state, "Observed");
        assert_eq!(written.bytes_affected, Some("alpha two".len() as u64));
        assert_eq!(
            written.before_sha256.as_deref(),
            Some(checksum("alpha one").as_str())
        );
        assert_eq!(
            written.after_sha256.as_deref(),
            Some(checksum("alpha two").as_str())
        );
        let mut patch = request(TfOperation::FilePatch, &root);
        patch.path = Some("note.txt".into());
        patch.expected_sha256 = Some(checksum("alpha two"));
        patch.old_text = Some("alpha".into());
        patch.new_text = Some("bravo".into());
        let patched = run(patch, &registry, &state, true);
        assert_eq!(patched.effect_state, "Observed");
        assert_eq!(patched.bytes_affected, Some("bravo two".len() as u64));
        assert_eq!(
            fs::read_to_string(dir.path().join("note.txt")).unwrap(),
            "bravo two"
        );
        let mut conflict = request(TfOperation::FilePatch, &root);
        conflict.path = Some("note.txt".into());
        conflict.expected_sha256 = Some(checksum("bravo two"));
        conflict.old_text = Some("o".into());
        conflict.new_text = Some("x".into());
        let receipt = run(conflict, &registry, &state, true);
        assert_eq!(receipt.effect_state, "NoEffect");
        assert_eq!(receipt.terminal, "conflict");
        assert_eq!(receipt.bytes_affected, None);
        let mut move_req = request(TfOperation::FileMove, &root);
        move_req.path = Some("note.txt".into());
        move_req.destination = Some("moved.txt".into());
        move_req.expected_sha256 = Some(checksum("bravo two"));
        let moved = run(move_req, &registry, &state, true);
        assert_eq!(moved.effect_state, "Observed");
        assert_eq!(moved.requested_resources, ["note.txt", "moved.txt"]);
        assert_eq!(moved.canonical_paths.len(), 2);
        assert_ne!(moved.canonical_paths, moved.requested_resources);
        assert_eq!(moved.bytes_affected, Some("bravo two".len() as u64));
        assert!(!dir.path().join("note.txt").exists());
        assert_eq!(
            fs::read_to_string(dir.path().join("moved.txt")).unwrap(),
            "bravo two"
        );
        let mut delete = request(TfOperation::FileDelete, &root);
        delete.path = Some("moved.txt".into());
        delete.expected_sha256 = Some(checksum("bravo two"));
        let deleted = run(delete, &registry, &state, true);
        assert_eq!(deleted.effect_state, "Observed");
        assert_eq!(deleted.after_exists, Some(false));
        assert_eq!(deleted.bytes_affected, Some("bravo two".len() as u64));
        assert!(!dir.path().join("moved.txt").exists());
        let mut mkdir = request(TfOperation::DirectoryCreate, &root);
        mkdir.path = Some("new-directory".into());
        let made = run(mkdir, &registry, &state, true);
        assert_eq!(made.effect_state, "Observed");
        assert_eq!(made.bytes_affected, None);
        assert!(dir.path().join("new-directory").is_dir());
    }
    #[test]
    fn expired_and_cancelled_tokens_deny_without_mutation() {
        let (dir, registry, state, root) = fixture();
        let mut req = request(TfOperation::FileCreate, &root);
        req.path = Some("never.txt".into());
        req.content = Some("denied".into());
        let expired = prepare(req.clone(), &registry, &state).unwrap();
        state
            .pending
            .lock()
            .unwrap()
            .get_mut(&expired.token)
            .unwrap()
            .expires = Instant::now() - Duration::from_secs(1);
        assert!(approve(&expired.token, &state).is_err());
        assert!(execute(&expired.token, &registry, &state).is_err());
        let prepared = prepare(req, &registry, &state).unwrap();
        assert!(cancel(&prepared.token, &state).unwrap());
        assert!(execute(&prepared.token, &registry, &state).is_err());
        assert!(!dir.path().join("never.txt").exists());
        let active = Arc::new(AtomicBool::new(false));
        state
            .active
            .lock()
            .unwrap()
            .insert("active-test".into(), active.clone());
        assert!(cancel("active-test", &state).unwrap());
        assert!(active.load(Ordering::Acquire));
    }
    #[test]
    fn symlink_outside_workspace_is_denied_when_supported() {
        use std::os::windows::fs::symlink_file;
        let (dir, registry, state, root) = fixture();
        let foreign = tempfile::tempdir().unwrap();
        let secret = foreign.path().join("external.txt");
        fs::write(&secret, "foreign").unwrap();
        let link = dir.path().join("linked.txt");
        if symlink_file(&secret, &link).is_err() {
            // Some Windows configurations disallow test symlink creation.
            return;
        }
        let mut req = request(TfOperation::FileRead, &root);
        req.path = Some("linked.txt".into());
        assert!(prepare(req, &registry, &state).is_err());
        assert_eq!(fs::read_to_string(secret).unwrap(), "foreign");
    }
    #[test]
    fn repo_diff_requires_explicit_non_secret_path_and_blocks_commondir() {
        let (dir, registry, state, root) = fixture();
        let git = Path::new(r"C:\Program Files\Git\cmd\git.exe");
        if !git.is_file() {
            return;
        }
        assert!(std::process::Command::new(git)
            .args(["init", "--quiet"])
            .current_dir(dir.path())
            .status()
            .unwrap()
            .success());
        let missing_paths = request(TfOperation::RepoDiff, &root);
        assert!(prepare(missing_paths.clone(), &registry, &state).is_err());
        let mut secret = missing_paths.clone();
        secret.paths = Some(vec![".env".into()]);
        assert!(prepare(secret, &registry, &state).is_err());
        fs::write(dir.path().join("normal.txt"), "safe").unwrap();
        let mut safe = missing_paths;
        safe.paths = Some(vec!["normal.txt".into()]);
        assert!(prepare(safe.clone(), &registry, &state).is_ok());
        fs::write(dir.path().join(".git/commondir"), "..\\outside").unwrap();
        assert!(prepare(safe, &registry, &state).is_err());
    }
}
