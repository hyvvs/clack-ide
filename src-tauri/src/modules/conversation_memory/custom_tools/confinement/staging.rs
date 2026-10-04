//! Shared independent-copy materialization. Preparing files does not authorize
//! execution: each backend must separately satisfy the entire native contract.
#[cfg(all(windows, test, feature = "native-confinement-probes"))]
use super::{process, psec};
use super::{Cleanup, Failure, Policy, Receipt, CAPABILITY_VERSION, POLICY_VERSION};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
#[cfg(windows)]
use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
use std::path::{Path, PathBuf};
#[cfg(windows)]
use windows_sys::Win32::Storage::FileSystem::*;

type Result<T> = std::result::Result<T, Failure>;
const MAX_INPUT_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Clone, Serialize)]
pub struct Input {
    pub source: PathBuf,
    pub sha256: String,
    pub name: String,
}

pub struct Prepared {
    policy: Policy,
    receipt: Receipt,
    outputs: Vec<String>,
    materialized: BTreeMap<String, String>,
    pins: Vec<File>,
    root: tempfile::TempDir,
    json_input: Option<Vec<u8>>,
}

#[derive(Debug)]
pub struct Completed {
    pub receipt: Receipt,
    pub output: Vec<u8>,
    pub stderr: Vec<u8>,
    pub files: BTreeMap<String, Vec<u8>>,
}

impl Prepared {
    #[cfg(test)]
    pub(super) fn directory(&self) -> &Path {
        self.root.path()
    }
    pub fn new(policy: Policy, inputs: Vec<Input>, outputs: Vec<String>) -> Result<Self> {
        policy.validate()?;
        if !matches!(policy.network, super::Network::Deny) {
            return Err(Failure::UnsupportedNetwork);
        }
        // Live writes and a caller-selected child cwd are not staging features.
        if !policy.write_roots.is_empty()
            || policy.cwd != policy.workspace
            || inputs.len() > 32
            || outputs.len() > 16
        {
            return Err(Failure::InvalidPolicy);
        }
        let mut names = BTreeSet::from(["program.exe".to_string(), "scratch".into()]);
        let mut materialized =
            BTreeMap::from([("program.exe".into(), policy.executable.sha256.clone())]);
        for input in &inputs {
            name(&input.name)?;
            if input.sha256.len() != 64
                || !input.sha256.bytes().all(|c| c.is_ascii_hexdigit())
                || input.source.as_os_str().len() > 2048
            {
                return Err(Failure::InvalidPolicy);
            }
            if !names.insert(input.name.to_ascii_lowercase()) {
                return Err(Failure::InvalidPolicy);
            }
            materialized.insert(input.name.clone(), input.sha256.clone());
        }
        let mut names = BTreeSet::new();
        for output in &outputs {
            name(output)?;
            if !names.insert(output.to_ascii_lowercase()) {
                return Err(Failure::InvalidPolicy);
            }
        }
        let hash = super::super::hash(&serde_json::json!({
            "filesystem": "independent-copies-v1", "policy": policy,
            "inputs": inputs, "outputs": outputs,
        }))
        .map_err(|_| Failure::InvalidPolicy)?;
        let temp = std::env::temp_dir();
        #[cfg(unix)]
        let temp = temp.canonicalize().map_err(|_| Failure::Initialization)?;
        let root = tempfile::Builder::new()
            .prefix("clack-staged-")
            .tempdir_in(temp)
            .map_err(|_| Failure::Initialization)?;
        private_root(root.path())?;
        std::fs::create_dir(root.path().join("scratch")).map_err(|_| Failure::Initialization)?;
        let mut pins = Vec::new();
        pin_ancestors(&policy.workspace, true, &mut pins)?;
        if policy
            .denied_paths
            .iter()
            .any(|p| under_case_insensitive(&policy.executable.path, p))
        {
            return Err(Failure::UnsupportedSecrets);
        }
        let executable = reviewed(&policy.executable.path, &mut pins, true)?;
        copy(
            &executable,
            &root.path().join("program.exe"),
            &policy.executable.sha256,
            super::wasi::MAX_MODULE_BYTES as u64,
        )?;
        pins.push(executable);
        let mut total = 0;
        for input in &inputs {
            if !input.source.starts_with(&policy.workspace)
                || !policy
                    .read_roots
                    .iter()
                    .any(|r| input.source.starts_with(r))
                || policy
                    .denied_paths
                    .iter()
                    .any(|r| under_case_insensitive(&input.source, r))
            {
                return Err(Failure::InvalidPolicy);
            }
            let source = reviewed(&input.source, &mut pins, true)?;
            total += source
                .metadata()
                .map_err(|_| Failure::WorkspaceChanged)?
                .len();
            if total > MAX_INPUT_BYTES {
                return Err(Failure::InvalidPolicy);
            }
            copy(
                &source,
                &root.path().join(&input.name),
                &input.sha256,
                MAX_INPUT_BYTES,
            )?;
            pins.push(source);
        }
        // Keep the reviewed module immutable until the guest Store is dropped.
        #[cfg(windows)]
        pins.push(
            OpenOptions::new()
                .read(true)
                .share_mode(FILE_SHARE_READ)
                .open(root.path().join("program.exe"))
                .map_err(|_| Failure::ExecutableChanged)?,
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(
                root.path().join("program.exe"),
                std::fs::Permissions::from_mode(0o500),
            )
            .map_err(|_| Failure::Initialization)?;
        }
        Ok(Self {
            policy,
            outputs,
            materialized,
            pins,
            root,
            json_input: None,
            receipt: Receipt {
                schema_version: 1,
                policy_version: POLICY_VERSION,
                policy_hash: hash,
                capability_version: CAPABILITY_VERSION.into(),
                failure: None,
                cleanup: Cleanup::NotStarted,
                platform_report: Some(super::platform::current()),
            },
        })
    }

    /// No caller can choose the diagnostic launcher or turn a persisted platform
    /// report into execution authority.
    pub fn check_host(&self) -> Result<()> {
        self.policy.check_host()
    }

    pub fn receipt(&self) -> &Receipt {
        &self.receipt
    }

    pub(crate) fn json_input(mut self, bytes: Vec<u8>) -> Result<Self> {
        if bytes.len() > 16 * 1024 {
            return Err(Failure::InvalidPolicy);
        }
        self.receipt.policy_hash = super::super::hash(&serde_json::json!({
            "staging": self.receipt.policy_hash, "abi": "wasi-preview1-json-v1",
            "input": format!("{:x}", Sha256::digest(&bytes))
        }))
        .map_err(|_| Failure::InvalidPolicy)?;
        self.json_input = Some(bytes);
        Ok(self)
    }

    pub fn close(self) -> Result<()> {
        let Self { pins, root, .. } = self;
        drop(pins);
        root.close().map_err(|_| Failure::Cleanup)
    }

    pub async fn execute(
        self,
        lease: crate::modules::net::inference::Lease,
        journal: super::super::execution::confinement::Journal,
    ) -> Result<Completed> {
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };
        static SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);
        let slot = SLOTS
            .try_acquire()
            .map_err(|_| Failure::UnsupportedResources)?;
        if lease.owner() != self.policy.owner {
            return Err(Failure::InvalidPolicy);
        }
        journal.validate(&self.policy)?;
        let stop = Arc::new(AtomicBool::new(false));
        struct CancelOnDrop(Arc<AtomicBool>);
        impl Drop for CancelOnDrop {
            fn drop(&mut self) {
                self.0.store(true, Ordering::Release);
            }
        }
        let _cancel = CancelOnDrop(stop.clone());
        tokio::task::spawn_blocking(move || {
            let _slot = slot;
            let _lease = lease;
            let policy = self.policy.clone();
            journal.validate(&policy)?;
            if _lease.cancelled() || stop.load(Ordering::Acquire) {
                return Err(Failure::Cancelled);
            }
            journal.begin(&self.receipt)?;
            let revoked = std::cell::Cell::new(false);
            let last_check = std::cell::Cell::new(std::time::Instant::now());
            let result = self.run(&|| {
                if last_check.get().elapsed() >= std::time::Duration::from_millis(100) {
                    last_check.set(std::time::Instant::now());
                    if journal.validate(&policy).is_err() {
                        revoked.set(true);
                    }
                }
                _lease.cancelled() || stop.load(Ordering::Acquire) || revoked.get()
            });
            let mut result = result;
            if revoked.get() || journal.validate(&policy).is_err() {
                result.receipt.failure = Some(Failure::StalePolicy);
            } else if result.receipt.failure.is_none()
                && (_lease.cancelled() || stop.load(Ordering::Acquire))
            {
                result.receipt.failure = Some(Failure::Cancelled);
            }
            if result.receipt.failure.is_some() {
                result.files.clear();
            }
            journal.finish(&result.receipt)?;
            Ok(result)
        })
        .await
        .map_err(|_| Failure::Interrupted)?
    }

    pub(super) fn run(mut self, cancelled: &dyn Fn() -> bool) -> Completed {
        let mut completed = Completed {
            receipt: self.receipt.clone(),
            output: vec![],
            stderr: vec![],
            files: BTreeMap::new(),
        };
        let operation = || -> Result<super::wasi::Outcome> {
            self.policy.check_host()?;
            if cancelled() {
                return Err(Failure::Cancelled);
            }
            self.validate_materialized()?;
            let bytes = std::fs::read(self.root.path().join("program.exe"))
                .map_err(|_| Failure::ExecutableChanged)?;
            Ok(super::wasi::run(
                &bytes,
                self.root.path(),
                &self.policy,
                cancelled,
                self.json_input.as_deref(),
            ))
        };
        match operation() {
            Ok(outcome) => {
                completed.output = outcome.output;
                completed.stderr = outcome.stderr;
                completed.receipt.failure = outcome.failure;
                // No host process/thread capability is exposed to the guest.
                // run() returns only after its future, Store and WASI handles drop.
                completed.receipt.cleanup = Cleanup::Verified;
                if completed.receipt.failure.is_none() {
                    if let Err(failure) = self.collect(&mut completed) {
                        completed.receipt.failure = Some(failure);
                    }
                }
            }
            Err(failure) => completed.receipt.failure = Some(failure),
        }
        self.pins.clear();
        if self.root.close().is_err() {
            completed.receipt.failure = Some(Failure::Cleanup);
            completed.receipt.cleanup = Cleanup::Failed;
        }
        if completed.receipt.failure.is_some() {
            completed.files.clear();
        }
        completed
    }

    fn validate_materialized(&self) -> Result<()> {
        let entries = std::fs::read_dir(self.root.path()).map_err(|_| Failure::Initialization)?;
        let mut count = 0;
        for entry in entries {
            let entry = entry.map_err(|_| Failure::Initialization)?;
            count += 1;
            if count > self.materialized.len() + 1 {
                return Err(Failure::InvalidPolicy);
            }
            if entry.file_name() == "scratch" {
                let metadata =
                    std::fs::symlink_metadata(entry.path()).map_err(|_| Failure::Initialization)?;
                if !metadata.is_dir() || metadata.is_symlink() {
                    return Err(Failure::InvalidPolicy);
                }
                let mut pins = vec![];
                pin_ancestors(&entry.path(), true, &mut pins)?;
                if std::fs::read_dir(entry.path())
                    .map_err(|_| Failure::Initialization)?
                    .next()
                    .is_some()
                {
                    return Err(Failure::InvalidPolicy);
                }
                continue;
            }
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| Failure::InvalidPolicy)?;
            let expected = self.materialized.get(&name).ok_or(Failure::InvalidPolicy)?;
            let mut pins = vec![];
            let mut file = reviewed(&entry.path(), &mut pins, false)?;
            let mut hasher = Sha256::new();
            let mut block = [0; 16384];
            let mut length = 0;
            loop {
                let read = file
                    .read(&mut block)
                    .map_err(|_| Failure::ExecutableChanged)?;
                if read == 0 {
                    break;
                }
                length += read;
                if length > MAX_INPUT_BYTES as usize {
                    return Err(Failure::InvalidPolicy);
                }
                hasher.update(&block[..read]);
            }
            if format!("{:x}", hasher.finalize()) != expected.to_ascii_lowercase() {
                return Err(Failure::ExecutableChanged);
            }
        }
        if count != self.materialized.len() + 1 {
            return Err(Failure::InvalidPolicy);
        }
        Ok(())
    }

    #[cfg(all(windows, test, feature = "native-confinement-probes"))]
    pub(super) fn run_native_probe(self, cancelled: &dyn Fn() -> bool) -> Completed {
        self.run_with(cancelled, psec::Environment::create_staged)
    }

    #[cfg(all(windows, test, feature = "native-confinement-probes"))]
    pub(super) fn run_drive_only_probe(self, cancelled: &dyn Fn() -> bool) -> Completed {
        self.run_with(cancelled, psec::Environment::create_drive_only_probe)
    }

    #[cfg(all(windows, test, feature = "native-confinement-probes"))]
    fn run_with(
        mut self,
        cancelled: &dyn Fn() -> bool,
        create: fn(&Path) -> std::result::Result<psec::Environment, i32>,
    ) -> Completed {
        let mut completed = Completed {
            receipt: self.receipt.clone(),
            output: vec![],
            stderr: vec![],
            files: BTreeMap::new(),
        };
        let attempted = std::cell::Cell::new(false);
        let mut operation = || -> Result<process::Outcome> {
            if cancelled() {
                return Err(Failure::Cancelled);
            }
            let environment = create(self.root.path()).map_err(|code| {
                #[cfg(test)]
                eprintln!("Materialized PSEC HRESULT={code:#x}");
                let _ = code;
                Failure::UnsupportedFilesystem
            })?;
            for runtime in psec::runtime_paths().map_err(|_| Failure::UnsupportedPlatform)? {
                pin_ancestors(&runtime, false, &mut self.pins)?;
                let file = OpenOptions::new()
                    .read(true)
                    .share_mode(FILE_SHARE_READ)
                    .open(&runtime)
                    .map_err(|_| Failure::ExecutableChanged)?;
                verify_path(&file, &runtime)?;
                self.pins.push(file);
            }
            let cwd = self.root.path().join("scratch");
            let env = environment_block(&cwd, &self.policy.environment)?;
            attempted.set(true);
            process::run(process::Launch {
                executable: &self.root.path().join("program.exe"),
                args: &self.policy.executable.argv,
                cwd: &cwd,
                environment: &env,
                limits: &self.policy.limits,
                children: self.policy.children,
                security: process::Security::Psec(&environment),
                cancelled,
            })
        };
        match operation() {
            Ok(result) => {
                completed.output = result.output;
                completed.receipt.failure = result
                    .failure
                    .or((result.exit != 0).then_some(Failure::ForcedTermination));
                completed.receipt.cleanup = if result.cleaned {
                    Cleanup::Verified
                } else {
                    Cleanup::Failed
                };
                if result.cleaned && result.failure.is_none() {
                    if let Err(error) = self.collect(&mut completed) {
                        completed.receipt.failure = Some(error);
                    }
                }
            }
            Err(failure) => {
                completed.receipt.failure = Some(failure);
                // Early native failure may have occurred after creation. Do not
                // infer that job-handle drop was an observed cleanup completion.
                completed.receipt.cleanup = if attempted.get() {
                    Cleanup::Unverified
                } else {
                    Cleanup::NotStarted
                };
            }
        }
        let Self { pins, root, .. } = self;
        drop(pins);
        if root.close().is_err() {
            completed.receipt.failure = Some(Failure::Cleanup);
            completed.receipt.cleanup = Cleanup::Failed;
        }
        completed
    }

    fn collect(&self, completed: &mut Completed) -> Result<()> {
        let mut remaining = self
            .policy
            .limits
            .output_bytes
            .saturating_sub(completed.output.len())
            .saturating_sub(completed.stderr.len());
        for name in &self.outputs {
            let path = self.root.path().join("scratch").join(name);
            let mut pins = Vec::new();
            let file = reviewed(&path, &mut pins, true)?;
            let mut bytes = Vec::new();
            (&file)
                .take(remaining as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| Failure::Cleanup)?;
            if bytes.len() > remaining {
                return Err(Failure::OutputLimit);
            }
            remaining -= bytes.len();
            completed.files.insert(name.clone(), bytes);
        }
        Ok(())
    }
}

fn name(value: &str) -> Result<()> {
    let stem = value
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    if value.is_empty()
        || value.len() > 96
        || value.starts_with('.')
        || value.ends_with('.')
        || !value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
        || matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")))
        || ["exe", "dll", "com", "bat", "cmd", "ps1"].contains(
            &value
                .rsplit('.')
                .next()
                .unwrap_or_default()
                .to_ascii_lowercase()
                .as_str(),
        )
        || sensitive(Path::new(value))
    {
        return Err(Failure::InvalidPolicy);
    }
    Ok(())
}

fn under_case_insensitive(path: &Path, root: &Path) -> bool {
    PathBuf::from(path.to_string_lossy().to_lowercase())
        .starts_with(PathBuf::from(root.to_string_lossy().to_lowercase()))
}

#[cfg(windows)]
pub(super) fn supported_host() -> bool {
    use windows_sys::Win32::System::Registry::*;
    if !cfg!(target_arch = "x86_64") {
        return false;
    }
    let key = wide("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion");
    let mut build = [0u16; 64];
    let mut size = std::mem::size_of_val(&build) as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            key.as_ptr(),
            wide("CurrentBuildNumber").as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            build.as_mut_ptr().cast(),
            &mut size,
        )
    };
    if status != 0 {
        return false;
    }
    let n = build.iter().position(|v| *v == 0).unwrap_or(build.len());
    let mut revision = 0u32;
    let mut size = 4;
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            key.as_ptr(),
            wide("UBR").as_ptr(),
            RRF_RT_REG_DWORD,
            std::ptr::null_mut(),
            (&mut revision as *mut u32).cast(),
            &mut size,
        )
    };
    status == 0 && String::from_utf16_lossy(&build[..n]) == "26200" && revision == 9457
}

fn sensitive(path: &Path) -> bool {
    crate::modules::archive::is_sensitive_archive_path(&path.to_string_lossy().replace('\\', "/"))
}

fn pin_ancestors(path: &Path, directory: bool, pins: &mut Vec<File>) -> Result<()> {
    super::clean_path(path)?;
    let parent = if directory {
        path
    } else {
        path.parent().ok_or(Failure::InvalidPolicy)?
    };
    let mut ancestors: Vec<_> = parent.ancestors().collect();
    ancestors.reverse();
    if ancestors.len() > 64 {
        return Err(Failure::InvalidPolicy);
    }
    for ancestor in ancestors {
        #[cfg(windows)]
        let file = OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(ancestor)
            .map_err(|_| Failure::WorkspaceChanged)?;
        #[cfg(unix)]
        let file = unix_open(ancestor, true)?;
        verify_path(&file, ancestor)?;
        let info = identity(&file)?;
        if info.reparse || !info.directory {
            return Err(Failure::WorkspaceChanged);
        }
        pins.push(file);
    }
    Ok(())
}

fn reviewed(path: &Path, pins: &mut Vec<File>, protect: bool) -> Result<File> {
    if protect && sensitive(path) {
        return Err(Failure::UnsupportedSecrets);
    }
    pin_ancestors(path, false, pins)?;
    #[cfg(windows)]
    let file = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|_| Failure::WorkspaceChanged)?;
    #[cfg(unix)]
    let file = unix_open(path, false)?;
    verify_path(&file, path)?;
    let info = identity(&file)?;
    if info.links != 1 || info.reparse || !info.regular {
        return Err(Failure::InvalidPolicy);
    }
    Ok(file)
}

#[cfg(windows)]
fn verify_path(file: &File, path: &Path) -> Result<()> {
    let mut buffer = [0u16; 32768];
    let n = unsafe {
        GetFinalPathNameByHandleW(
            file.as_raw_handle(),
            buffer.as_mut_ptr(),
            buffer.len() as u32,
            0,
        )
    } as usize;
    if n == 0 || n >= buffer.len() {
        return Err(Failure::WorkspaceChanged);
    }
    let actual = String::from_utf16(&buffer[..n]).map_err(|_| Failure::WorkspaceChanged)?;
    let requested = format!("\\\\?\\{}", path.display());
    if !actual.eq_ignore_ascii_case(&requested) {
        return Err(Failure::WorkspaceChanged);
    }
    Ok(())
}

#[cfg(test)]
#[path = "staging_tests.rs"]
mod tests;
struct Identity {
    volume: u64,
    index: u64,
    links: u64,
    directory: bool,
    regular: bool,
    reparse: bool,
}

#[cfg(windows)]
fn identity(file: &File) -> Result<Identity> {
    let mut info = unsafe { std::mem::zeroed() };
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
        return Err(Failure::WorkspaceChanged);
    }
    Ok(Identity {
        volume: info.dwVolumeSerialNumber as u64,
        index: ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64,
        links: info.nNumberOfLinks as u64,
        directory: info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0,
        regular: info.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)
            == 0,
        reparse: info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0,
    })
}

fn copy(mut source: &File, target: &Path, hash: &str, limit: u64) -> Result<()> {
    let original = identity(source)?;
    let mut target = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)
        .map_err(|_| Failure::Initialization)?;
    let copied = identity(&target)?;
    if copied.links != 1 || (original.volume == copied.volume && original.index == copied.index) {
        return Err(Failure::Initialization);
    }
    let mut digest = Sha256::new();
    let mut total = 0u64;
    let mut bytes = [0; 16384];
    loop {
        let n = source
            .read(&mut bytes)
            .map_err(|_| Failure::WorkspaceChanged)?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > limit {
            return Err(Failure::InvalidPolicy);
        }
        digest.update(&bytes[..n]);
        target
            .write_all(&bytes[..n])
            .map_err(|_| Failure::Initialization)?;
    }
    if format!("{:x}", digest.finalize()) != hash.to_ascii_lowercase() {
        return Err(Failure::ExecutableChanged);
    }
    target.sync_all().map_err(|_| Failure::Initialization)
}

#[cfg(windows)]
fn private_root(path: &Path) -> Result<()> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::{
        Authorization::ConvertStringSecurityDescriptorToSecurityDescriptorW, *,
    };
    let mut descriptor = std::ptr::null_mut();
    let sddl = wide(if cfg!(all(test, feature = "native-confinement-probes")) {
        "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;OW)S:(ML;OICI;NW;;;LW)"
    } else {
        "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;OW)"
    });
    if unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            1,
            &mut descriptor,
            std::ptr::null_mut(),
        )
    } == 0
    {
        return Err(Failure::Initialization);
    }
    let result = unsafe {
        SetFileSecurityW(
            wide(path).as_ptr(),
            DACL_SECURITY_INFORMATION
                | PROTECTED_DACL_SECURITY_INFORMATION
                | if cfg!(all(test, feature = "native-confinement-probes")) {
                    LABEL_SECURITY_INFORMATION
                } else {
                    0
                },
            descriptor,
        )
    };
    unsafe {
        LocalFree(descriptor);
    }
    if result == 0 {
        return Err(Failure::Initialization);
    }
    Ok(())
}

#[cfg(all(windows, test, feature = "native-confinement-probes"))]
fn environment_block(cwd: &Path, permitted: &BTreeMap<String, String>) -> Result<Vec<u16>> {
    use windows_sys::Win32::System::SystemInformation::GetWindowsDirectoryW;
    let mut system = [0u16; 32768];
    let n = unsafe { GetWindowsDirectoryW(system.as_mut_ptr(), system.len() as u32) } as usize;
    if n == 0 || n >= system.len() {
        return Err(Failure::Initialization);
    }
    let mut env = permitted.clone();
    env.insert(
        "LOCALAPPDATA".into(),
        dirs::data_local_dir()
            .ok_or(Failure::Initialization)?
            .to_string_lossy()
            .into_owned(),
    );
    env.insert("SystemRoot".into(), String::from_utf16_lossy(&system[..n]));
    env.insert("TEMP".into(), cwd.to_string_lossy().into_owned());
    env.insert("TMP".into(), cwd.to_string_lossy().into_owned());
    Ok(process::wide(
        env.iter()
            .map(|(k, v)| format!("{k}={v}\0"))
            .collect::<String>(),
    ))
}

#[cfg(windows)]
fn wide(value: impl AsRef<std::ffi::OsStr>) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    value.as_ref().encode_wide().chain(Some(0)).collect()
}

#[cfg(unix)]
fn private_root(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
        .map_err(|_| Failure::Initialization)
}

#[cfg(unix)]
fn unix_open(path: &Path, directory: bool) -> Result<File> {
    use std::os::{
        fd::{AsRawFd, FromRawFd},
        unix::ffi::OsStrExt,
    };
    super::clean_path(path)?;
    let mut parent = File::open("/").map_err(|_| Failure::WorkspaceChanged)?;
    let parts = path
        .components()
        .filter_map(|c| match c {
            std::path::Component::Normal(p) => Some(p),
            _ => None,
        })
        .collect::<Vec<_>>();
    for (index, component) in parts.iter().enumerate() {
        let name =
            std::ffi::CString::new(component.as_bytes()).map_err(|_| Failure::InvalidPolicy)?;
        let flags = libc::O_RDONLY
            | libc::O_CLOEXEC
            | libc::O_NOFOLLOW
            | libc::O_NONBLOCK
            | if directory || index + 1 < parts.len() {
                libc::O_DIRECTORY
            } else {
                0
            };
        let raw = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), flags) };
        if raw < 0 {
            return Err(Failure::WorkspaceChanged);
        }
        parent = unsafe { File::from_raw_fd(raw) };
    }
    Ok(parent)
}

#[cfg(unix)]
fn identity(file: &File) -> Result<Identity> {
    use std::os::unix::fs::MetadataExt;
    let info = file.metadata().map_err(|_| Failure::WorkspaceChanged)?;
    Ok(Identity {
        volume: info.dev(),
        index: info.ino(),
        links: info.nlink(),
        directory: info.is_dir(),
        regular: info.is_file(),
        reparse: info.is_symlink(),
    })
}

#[cfg(unix)]
fn verify_path(file: &File, path: &Path) -> Result<()> {
    use std::os::unix::fs::MetadataExt;
    let opened = identity(file)?;
    let current = std::fs::symlink_metadata(path).map_err(|_| Failure::WorkspaceChanged)?;
    if current.is_symlink() || current.dev() != opened.volume || current.ino() != opened.index {
        return Err(Failure::WorkspaceChanged);
    }
    Ok(())
}
