//! T3a embedded WASI policy boundary, not a model tool or process-launch IPC.
//! Permissions and approval never substitute for enforced guest capabilities.
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::path::PathBuf;

// Historical native experiments require an explicit diagnostic-only feature.
pub mod platform;
#[cfg(all(windows, test, feature = "native-confinement-probes"))]
mod process;
#[cfg(all(windows, test, feature = "native-confinement-probes"))]
mod psec;
pub mod staging;
mod wasi;
#[cfg(all(windows, test, feature = "native-confinement-probes"))]
use staging as staged;
#[cfg(test)]
mod tests;
#[cfg(all(windows, test, feature = "native-confinement-probes"))]
mod windows;

pub const POLICY_VERSION: u32 = 1;
pub const CAPABILITY_VERSION: &str = "clack-wasi-1";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Failure {
    UnsupportedPlatform,
    UnsupportedFilesystem,
    UnsupportedSecrets,
    UnsupportedNetwork,
    UnsupportedResources,
    InvalidPolicy,
    StalePolicy,
    ExecutableChanged,
    WorkspaceChanged,
    Initialization,
    Spawn,
    Timeout,
    Cancelled,
    ForcedTermination,
    Cleanup,
    OutputLimit,
    Interrupted,
    Persistence,
    InvalidModule,
    GuestTrap,
    FuelLimit,
    MemoryLimit,
}

/// Versioned per-platform evidence, never an authorization token.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub version: &'static str,
    pub backend: &'static str,
    pub supported_targets: [&'static str; 3],
    pub exact_filesystem_roots: bool,
    pub denied_secret_paths: bool,
    pub process_tools_enabled: bool,
    pub platforms: [platform::Report; 3],
}

/// Production support and native verification evidence are separate. Historical
/// native-process experiments never authorize execution through this backend.
pub fn capabilities() -> Capabilities {
    Capabilities {
        version: CAPABILITY_VERSION,
        backend: "embedded-wasmtime-wasip1",
        supported_targets: ["windows", "linux", "macos"],
        exact_filesystem_roots: true,
        denied_secret_paths: true,
        process_tools_enabled: false,
        platforms: platform::matrix(),
    }
}

pub(super) fn unavailable_reason() -> &'static str {
    "Execution unavailable: script/function/MCP registration is deferred; embedded WASI confinement does not execute native programs"
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Cleanup {
    NotStarted,
    Verified,
    Failed,
    UnknownAfterRestart,
    Unverified,
}

/// Optional T2 receipt extension, not another execution store. Only bounded
/// policy identity and truthful outcomes persist; never handles, PIDs, environment,
/// output, arbitrary diagnostics, credentials or a launch/replay recipe.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Receipt {
    pub schema_version: u32,
    pub policy_version: u32,
    pub policy_hash: String,
    pub capability_version: String,
    pub failure: Option<Failure>,
    pub cleanup: Cleanup,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform_report: Option<platform::Report>,
}
impl Receipt {
    pub fn blocked(policy: &Policy) -> Result<Self, Failure> {
        let failure = policy.check_host().err().ok_or(Failure::InvalidPolicy)?;
        Ok(Self {
            schema_version: 1,
            policy_version: POLICY_VERSION,
            policy_hash: policy.digest()?,
            capability_version: CAPABILITY_VERSION.into(),
            failure: Some(failure),
            cleanup: Cleanup::NotStarted,
            platform_report: Some(platform::current()),
        })
    }
    pub fn validate(&self) -> Result<(), Failure> {
        if self.schema_version != 1
            || self.policy_version != POLICY_VERSION
            || !matches!(
                self.capability_version.as_str(),
                CAPABILITY_VERSION | "clack-confinement-1"
            )
            || self.policy_hash.len() != 64
            || !self.policy_hash.bytes().all(|b| b.is_ascii_hexdigit())
            || self.cleanup == Cleanup::Failed && self.failure != Some(Failure::Cleanup)
            || self.cleanup == Cleanup::UnknownAfterRestart
                && self.failure != Some(Failure::Interrupted)
            || self.cleanup == Cleanup::Unverified && self.failure.is_none()
            || self
                .platform_report
                .as_ref()
                .is_some_and(|r| r.validate().is_err())
        {
            return Err(Failure::InvalidPolicy);
        }
        Ok(())
    }
    pub(super) fn interrupted(&mut self) {
        self.failure = Some(Failure::Interrupted);
        // No guest survives its host, but recovery cannot attest to temporary
        // directory cleanup. Never replay a saved run or kill a PID from disk.
        self.cleanup = Cleanup::UnknownAfterRestart;
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Executable {
    pub path: PathBuf,
    pub sha256: String,
    pub argv: Vec<String>,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Children {
    Forbidden,
    Contained,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "mode", rename_all = "kebab-case")]
pub enum Network {
    Deny,
    Destinations { hosts: Vec<String> },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    pub timeout_ms: u64,
    pub output_bytes: usize,
    pub memory_bytes: usize,
    pub processes: u32,
    pub cpu_time_ms: u64,
}

/// Native-only input. Deliberately not Deserialize: arguments from the model or
/// webview cannot become OS policy. T3b must derive this from T1/T2 authorization.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    pub version: u32,
    pub capability_version: String,
    pub executable: Executable,
    pub workspace: PathBuf,
    pub cwd: PathBuf,
    pub read_roots: Vec<PathBuf>,
    pub write_roots: Vec<PathBuf>,
    pub denied_paths: Vec<PathBuf>,
    pub environment: std::collections::BTreeMap<String, String>,
    pub children: Children,
    pub network: Network,
    pub limits: Limits,
    pub owner: String,
    pub definition_hash: String,
}

impl Policy {
    pub fn validate(&self) -> Result<(), Failure> {
        if self.version != POLICY_VERSION || self.capability_version != CAPABILITY_VERSION {
            return Err(Failure::StalePolicy);
        }
        let hash = |v: &str| v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit());
        let text = |v: &str| v.len() <= 2048 && !v.chars().any(char::is_control);
        if !hash(&self.definition_hash)
            || !hash(&self.executable.sha256)
            || self.owner.is_empty()
            || self.owner.len() > 256
            || !text(&self.owner)
            || !self.executable.path.is_absolute()
            || !self.workspace.is_absolute()
            || !self.cwd.is_absolute()
            || self.executable.argv.len() > 32
            || self.executable.argv.iter().any(|v| !text(v))
            || self.executable.argv.iter().map(String::len).sum::<usize>() > 8192
            || self.read_roots.len() > 16
            || self.write_roots.len() > 16
            || self.denied_paths.len() > 64
            || self
                .read_roots
                .iter()
                .chain(&self.write_roots)
                .chain(&self.denied_paths)
                .any(|p| !p.is_absolute() || p.as_os_str().len() > 2048)
            || self.environment.len() > 8
            || matches!(&self.network, Network::Destinations { hosts } if hosts.is_empty() || hosts.len() > 16 || hosts.iter().any(|h| !text(h) || h.len() > 256))
            || self.environment.iter().any(|(k, v)| {
                // No PATH, interpreter startup hooks, proxy, credential, profile,
                // home or dynamic-loader variables. Extend only after review.
                !matches!(k.as_str(), "LANG" | "LC_ALL" | "TZ") || !text(v) || v.len() > 128
            })
            || !(100..=120_000).contains(&self.limits.timeout_ms)
            || !(1024..=262_144).contains(&self.limits.output_bytes)
            || !(16 * 1024 * 1024..=1024 * 1024 * 1024).contains(&self.limits.memory_bytes)
            || !(1..=8).contains(&self.limits.processes)
            || !(100..=120_000).contains(&self.limits.cpu_time_ms)
            || matches!(self.children, Children::Forbidden) && self.limits.processes != 1
        {
            return Err(Failure::InvalidPolicy);
        }
        Ok(())
    }

    /// Validate at the point of use, not at registration. No Full Access input
    /// exists here. No relaxed fallback or public escape hatch exists either.
    pub fn check_host(&self) -> Result<(), Failure> {
        self.validate()?;
        if !matches!(self.network, Network::Deny) {
            return Err(Failure::UnsupportedNetwork);
        }
        if !matches!(self.children, Children::Forbidden) || self.limits.processes != 1 {
            return Err(Failure::UnsupportedResources);
        }
        platform::check_host()
    }

    pub fn digest(&self) -> Result<String, Failure> {
        self.validate()?;
        super::hash(self).map_err(|_| Failure::InvalidPolicy)
    }
}

/// Read/validate a reviewed binary without PATH resolution. On Windows the
/// returned handle prevents replacement or modification until capture is dropped.
/// Capturing identity is not authorization and must never skip check_host().
#[cfg(all(windows, test, feature = "native-confinement-probes"))]
pub struct Capture {
    policy_hash: String,
    executable: std::fs::File,
    _directories: Vec<std::fs::File>,
}
#[cfg(all(windows, test, feature = "native-confinement-probes"))]
impl Capture {
    pub fn new(policy: &Policy) -> Result<Self, Failure> {
        #[cfg(windows)]
        use sha2::{Digest, Sha256};
        #[cfg(windows)]
        use std::io::Read;
        policy.validate()?;
        #[cfg(not(windows))]
        return Err(Failure::UnsupportedPlatform);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            use windows_sys::Win32::Storage::FileSystem::{
                FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_READ, FILE_SHARE_WRITE,
            };
            let mut directories = Vec::new();
            for path in std::iter::once(&policy.workspace)
                .chain(std::iter::once(&policy.cwd))
                .chain(&policy.read_roots)
                .chain(&policy.write_roots)
            {
                clean_path(path).map_err(|_| Failure::WorkspaceChanged)?;
                let file = std::fs::OpenOptions::new()
                    .read(true)
                    .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
                    .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
                    .open(path)
                    .map_err(|_| Failure::WorkspaceChanged)?;
                if !file
                    .metadata()
                    .map_err(|_| Failure::WorkspaceChanged)?
                    .is_dir()
                {
                    return Err(Failure::WorkspaceChanged);
                }
                directories.push(file);
            }
            if !policy.cwd.starts_with(&policy.workspace)
                || !policy
                    .read_roots
                    .iter()
                    .chain(&policy.write_roots)
                    .any(|r| policy.cwd.starts_with(r))
            {
                return Err(Failure::InvalidPolicy);
            }
            clean_path(&policy.executable.path).map_err(|_| Failure::ExecutableChanged)?;
            let mut executable = std::fs::OpenOptions::new()
                .read(true)
                .share_mode(FILE_SHARE_READ)
                .open(&policy.executable.path)
                .map_err(|_| Failure::ExecutableChanged)?;
            let meta = executable
                .metadata()
                .map_err(|_| Failure::ExecutableChanged)?;
            if !meta.is_file() || meta.len() == 0 || meta.len() > 128 * 1024 * 1024 {
                return Err(Failure::ExecutableChanged);
            }
            let mut digest = Sha256::new();
            let mut buffer = [0; 16384];
            loop {
                let size = executable
                    .read(&mut buffer)
                    .map_err(|_| Failure::ExecutableChanged)?;
                if size == 0 {
                    break;
                }
                digest.update(&buffer[..size]);
            }
            if format!("{:x}", digest.finalize()) != policy.executable.sha256.to_ascii_lowercase() {
                return Err(Failure::ExecutableChanged);
            }
            Ok(Self {
                policy_hash: policy.digest()?,
                executable,
                _directories: directories,
            })
        }
    }
    pub fn recheck(&self, policy: &Policy) -> Result<(), Failure> {
        if self.policy_hash != policy.digest()? {
            return Err(Failure::StalePolicy);
        }
        if !self
            .executable
            .metadata()
            .map_err(|_| Failure::ExecutableChanged)?
            .is_file()
        {
            return Err(Failure::ExecutableChanged);
        }
        policy.check_host()
    }
}

#[cfg(windows)]
fn clean_path(path: &Path) -> Result<(), Failure> {
    use std::os::windows::fs::MetadataExt;
    // No UNC/device prefixes, ADS, traversal, junctions or reparses. These
    // preflight checks are NOT advertised as confinement of child filesystem IO.
    let text = path.to_str().ok_or(Failure::InvalidPolicy)?;
    if !path.is_absolute()
        || text.starts_with(['\\', '/'])
        || text[2..].contains(':')
        || path.components().any(|c| {
            matches!(
                c,
                std::path::Component::ParentDir | std::path::Component::CurDir
            )
        })
    {
        return Err(Failure::InvalidPolicy);
    }
    for ancestor in path.ancestors() {
        let meta = std::fs::symlink_metadata(ancestor).map_err(|_| Failure::WorkspaceChanged)?;
        if meta.file_attributes() & 0x400 != 0 {
            return Err(Failure::WorkspaceChanged);
        }
    }
    Ok(())
}

#[cfg(unix)]
fn clean_path(path: &Path) -> Result<(), Failure> {
    if !path.is_absolute()
        || path.as_os_str().len() > 2048
        || path.components().any(|c| {
            !matches!(
                c,
                std::path::Component::RootDir | std::path::Component::Normal(_)
            )
        })
    {
        return Err(Failure::InvalidPolicy);
    }
    Ok(())
}
