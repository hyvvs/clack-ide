//! Windows TF4 browser session owner. No model or Tauri IPC entry point.
//!
//! A production host is an untrusted, zero-network-capability AppContainer
//! child. The parent is the *only* network authority and forwards bounded GET
//! requests through the existing TF3 prepare/execute/receipt implementation.
//! Browser readiness requires retained kernel process identity, matching SID,
//! job membership and the WebView2 COM effective UDF *before navigation*.
//! The acceptance-only host/fixture mode is never launched by this module.

use super::tf_web::{self, TfWebOperation, TfWebReceipt, TfWebRequest, TfWebState};
use crate::modules::workspace::WorkspaceRegistry;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

const FRAME_MAX: usize = 128 * 1024;
const RESOURCE_MAX: usize = 32 * 1024;
const REQUEST_MAX: usize = 20;
const SESSION_NONCE_BYTES: usize = 24;

/// Must be built by trusted TF4 native prepare/approve/execute ownership.
/// Actor, session and workspace are *not* authenticated by arbitrary IPC text.
pub(crate) struct BrowserRuntimeStart {
    pub actor: String,
    pub session_id: String,
    pub workspace_root: PathBuf,
    pub initial_url: String,
    /// Existing trusted application-owned directory; one new child per flight.
    pub private_parent: PathBuf,
    /// Installed production-capable host, never the acceptance fixture runner.
    pub host_executable: PathBuf,
    /// Digest pinned by the installed application, independent of the child.
    pub host_sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrokerResourceReceipt {
    pub request_id: u64,
    pub page_generation: u64,
    /// True only after the native UI-apartment COM deferral was completed.
    pub native_com_completed: bool,
    pub terminal: &'static str,
    pub reason: String,
    pub bytes: usize,
    pub tf3: Option<TfWebReceipt>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChildReady {
    version: u8,
    session: String,
    request_id: u64,
    kind: String,
    effective_udf: String,
    host_pid: u32,
    browser_pid: u32,
    renderer_pid: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChildGet {
    version: u8,
    session: String,
    request_id: u64,
    method: String,
    url: String,
    /// Production requests must carry the actual native page epoch.
    /// The acceptance-only v1 fixture has its own unchanged wire contract.
    page_generation: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChildComAck {
    version: u8,
    session: String,
    request_id: u64,
    kind: String,
    status: u16,
    page_generation: u64,
}

/// This is deliberately only a non-sensitive DOM *structure* probe. It is not
/// a semantic or accessible-name snapshot and cannot authorize an action.
/// Arbitrary page strings are omitted because heuristic redaction cannot
/// establish that visible text/ARIA labels/URLs are secret-free.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NativeElementStructure {
    pub index: u32,
    pub role: String,
    pub depth: u8,
    pub heading_level: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NativeDomStructure {
    pub version: u8,
    pub kind: String,
    pub session: String,
    pub observation_id: u64,
    pub page_generation: u64,
    pub source_id: String,
    pub terminal: String,
    pub reason: String,
    pub truncated: bool,
    pub visited: u32,
    pub elements: Vec<NativeElementStructure>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ParentObserve<'a> {
    version: u8,
    kind: &'static str,
    session: &'a str,
    observation_id: u64,
    page_generation: u64,
    source_id: &'a str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParentReply<'a> {
    version: u8,
    session: &'a str,
    request_id: u64,
    status: u16,
    content_type: &'a str,
    body_base64: String,
    error: Option<&'a str>,
}

fn random_nonce() -> Result<String, String> {
    let mut bytes = [0u8; SESSION_NONCE_BYTES];
    getrandom::fill(&mut bytes).map_err(|_| "browser-random-unavailable")?;
    Ok(bytes.iter().map(|v| format!("{v:02x}")).collect())
}

fn validate_get(frame: &ChildGet, nonce: &str, last_id: u64) -> Result<(), &'static str> {
    if frame.version != 1
        || frame.session != nonce
        || frame.request_id == 0
        || Some(frame.request_id) != last_id.checked_add(1)
        || frame.method != "GET"
        || frame.url.len() > 2048
        || frame.page_generation == 0
    {
        return Err("browser-broker-request-invalid");
    }
    let url = reqwest::Url::parse(&frame.url).map_err(|_| "browser-url-invalid")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|p| p != 443)
    {
        return Err("browser-broker-https-only");
    }
    Ok(())
}

/// A successful pipe write or WebView2 SetResponse is *not* a completed
/// browser response. This independently validates the UI-apartment native
/// deferral completion attestation, before an effect is recorded terminal.
fn validate_com_ack(
    frame: &ChildComAck,
    nonce: &str,
    id: u64,
    generation: u64,
    status: u16,
) -> Result<(), &'static str> {
    if frame.version != 1
        || frame.session != nonce
        || frame.kind != "com-completed"
        || frame.request_id != id
        || frame.page_generation != generation
        || frame.status != status
    {
        return Err("browser-com-deferral-completion-unverified");
    }
    Ok(())
}

fn validate_dom_structure(
    value: &NativeDomStructure,
    nonce: &str,
    id: u64,
    generation: u64,
    expected_source: &str,
) -> Result<(), &'static str> {
    if value.version != 2
        || value.kind != "dom-snapshot"
        || value.session != nonce
        || value.observation_id != id
        || value.page_generation != generation
        || value.source_id != expected_source
        || !matches!(value.terminal.as_str(), "completed" | "denied")
        || !matches!(
            value.reason.as_str(),
            "ok" | "source-mismatch"
                | "page-stale"
                | "bounds-exceeded"
                | "observation-failed"
                | "dom-unavailable"
                | "version-denied"
                | "unknown"
        )
        || value.visited > 512
        || value.elements.len() > 64
        || (value.terminal == "denied" && !value.elements.is_empty())
        || (value.terminal == "denied" && value.reason == "ok")
        || (value.terminal == "completed" && value.reason != "ok")
    {
        return Err("browser-structure-identity-or-bounds-invalid");
    }
    let mut previous = 0;
    for item in &value.elements {
        if item.index <= previous
            || item.index > value.visited
            || item.depth > 32
            || item
                .heading_level
                .is_some_and(|level| !(1..=6).contains(&level))
            || !matches!(
                item.role.as_str(),
                "main"
                    | "navigation"
                    | "article"
                    | "heading"
                    | "link"
                    | "button"
                    | "img"
                    | "image"
                    | "paragraph"
                    | "listitem"
                    | "label"
                    | "input"
                    | "select"
                    | "textbox"
                    | "checkbox"
                    | "radio"
                    | "option"
                    | "form"
            )
        {
            return Err("browser-structure-element-invalid");
        }
        previous = item.index;
    }
    Ok(())
}

fn checked_mime(value: Option<&str>) -> Option<&'static str> {
    match value?
        .split(';')
        .next()?
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "text/html" => Some("text/html"),
        "text/plain" => Some("text/plain"),
        "text/css" => Some("text/css"),
        "application/javascript" => Some("application/javascript"),
        "application/x-javascript" => Some("application/x-javascript"),
        "text/javascript" => Some("text/javascript"),
        "application/json" => Some("application/json"),
        "image/png" => Some("image/png"),
        "image/jpeg" => Some("image/jpeg"),
        "image/gif" => Some("image/gif"),
        "image/webp" => Some("image/webp"),
        "image/avif" => Some("image/avif"),
        "image/svg+xml" => Some("image/svg+xml"),
        "font/woff" => Some("font/woff"),
        "font/woff2" => Some("font/woff2"),
        "application/font-woff" => Some("application/font-woff"),
        "application/font-woff2" => Some("application/font-woff2"),
        "application/vnd.ms-fontobject" => Some("application/vnd.ms-fontobject"),
        "font/ttf" => Some("font/ttf"),
        "font/otf" => Some("font/otf"),
        "application/octet-stream" => Some("application/octet-stream"),
        _ => None,
    }
}

fn encode_base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for triple in bytes.chunks(3) {
        let a = triple[0];
        let b = triple.get(1).copied().unwrap_or(0);
        let c = triple.get(2).copied().unwrap_or(0);
        result.push(ALPHABET[(a >> 2) as usize] as char);
        result.push(ALPHABET[(((a & 3) << 4) | (b >> 4)) as usize] as char);
        result.push(if triple.len() > 1 {
            ALPHABET[(((b & 15) << 2) | (c >> 6)) as usize] as char
        } else {
            '='
        });
        result.push(if triple.len() > 2 {
            ALPHABET[(c & 63) as usize] as char
        } else {
            '='
        });
    }
    result
}

/// A reusable, non-networking frame reader used by the Windows pipe transport.
fn read_frame_from<R: std::io::Read>(reader: &mut R) -> Result<Vec<u8>, String> {
    let mut header = [0; 4];
    reader
        .read_exact(&mut header)
        .map_err(|_| "browser-pipe-header-closed")?;
    let len = u32::from_le_bytes(header) as usize;
    if len == 0 || len > FRAME_MAX {
        return Err("browser-frame-bounds-denied".into());
    }
    let mut bytes = vec![0; len];
    reader
        .read_exact(&mut bytes)
        .map_err(|_| "browser-pipe-frame-closed")?;
    Ok(bytes)
}

fn validate_host_binary(path: &Path, expected: &str) -> Result<PathBuf, String> {
    if expected.len() != 64 || !expected.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("browser-host-digest-required".into());
    }
    let path = std::fs::canonicalize(path).map_err(|_| "browser-host-not-installed")?;
    if !path.is_file()
        || path.file_name().and_then(|s| s.to_str()) != Some("clack-browser-host.exe")
    {
        return Err("browser-host-name-denied".into());
    }
    let bytes = std::fs::read(&path).map_err(|_| "browser-host-unreadable")?;
    let actual = format!("{:x}", Sha256::digest(bytes));
    if !actual.eq_ignore_ascii_case(expected) {
        return Err("browser-host-digest-mismatch".into());
    }
    Ok(path)
}

#[cfg(windows)]
mod windows_owner {
    use super::*;
    use std::ffi::{c_void, OsStr};
    use std::fs::{self, File};
    use std::io::{Read, Write};
    use std::mem::{size_of, size_of_val, zeroed};
    use std::os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle},
    };
    use std::ptr::{null, null_mut};
    use std::time::{Duration, Instant};
    use windows_sys::Win32::{
        Foundation::*,
        Security::{Authorization::*, Isolation::*, *},
        Storage::FileSystem::{
            GetFileAttributesW, FILE_ATTRIBUTE_REPARSE_POINT, INVALID_FILE_ATTRIBUTES,
        },
        System::{JobObjects::*, Pipes::*, Threading::*},
    };

    const PIPE_TIMEOUT: Duration = Duration::from_secs(5);
    const JOB_STOP_TIMEOUT_MS: u32 = 3000;
    const PROCESS_SYNCHRONIZE: u32 = 0x0010_0000;

    // The future that owns this fence may be dropped on native caller
    // cancellation. A still-running pipe reader, network fetch or writer can
    // then never deliver a stale successful reply to the old browser session.
    struct FlightFence {
        job: usize,
        committed: bool,
    }
    impl FlightFence {
        fn new(job: HANDLE) -> Self {
            Self {
                job: job as usize,
                committed: false,
            }
        }
    }
    impl Drop for FlightFence {
        fn drop(&mut self) {
            if !self.committed {
                unsafe {
                    TerminateJobObject(self.job as HANDLE, 1);
                }
            }
        }
    }

    fn win_err(step: &'static str) -> String {
        format!("{step}: Win32 {}", unsafe { GetLastError() })
    }
    fn wide(v: impl AsRef<OsStr>) -> Vec<u16> {
        v.as_ref().encode_wide().chain([0]).collect()
    }
    fn quote(input: &str) -> String {
        let mut result = String::from("\"");
        let mut slashes = 0;
        for ch in input.chars() {
            if ch == '\\' {
                slashes += 1;
                continue;
            }
            result.extend(std::iter::repeat_n(
                '\\',
                slashes * if ch == '"' { 2 } else { 1 },
            ));
            if ch == '"' {
                result.push('\\');
            }
            result.push(ch);
            slashes = 0;
        }
        result.extend(std::iter::repeat_n('\\', slashes * 2));
        result.push('"');
        result
    }
    struct OwnedHandle(HANDLE);
    impl OwnedHandle {
        fn checked(raw: HANDLE, step: &'static str) -> Result<Self, String> {
            if raw.is_null() || raw == INVALID_HANDLE_VALUE {
                Err(win_err(step))
            } else {
                Ok(Self(raw))
            }
        }
    }
    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
    struct OwnedSid(PSID);
    impl Drop for OwnedSid {
        fn drop(&mut self) {
            unsafe {
                FreeSid(self.0);
            }
        }
    }
    struct LocalMemory(*mut c_void);
    impl Drop for LocalMemory {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    LocalFree(self.0);
                }
            }
        }
    }
    struct Attributes {
        words: Vec<usize>,
        initialized: bool,
    }
    impl Attributes {
        fn new() -> Result<Self, String> {
            let mut bytes = 0;
            unsafe {
                InitializeProcThreadAttributeList(null_mut(), 3, 0, &mut bytes);
            }
            if bytes == 0 {
                return Err(win_err("browser-attributes-size"));
            }
            let mut result = Self {
                words: vec![0; bytes.div_ceil(size_of::<usize>())],
                initialized: false,
            };
            if unsafe { InitializeProcThreadAttributeList(result.ptr(), 3, 0, &mut bytes) } == 0 {
                return Err(win_err("browser-attributes-init"));
            }
            result.initialized = true;
            Ok(result)
        }
        fn ptr(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
            self.words.as_mut_ptr().cast()
        }
        fn add<T>(&mut self, key: u32, value: &T) -> Result<(), String> {
            if unsafe {
                UpdateProcThreadAttribute(
                    self.ptr(),
                    0,
                    key as usize,
                    (value as *const T).cast(),
                    size_of::<T>(),
                    null_mut(),
                    null(),
                )
            } == 0
            {
                Err(win_err("browser-attributes-assign"))
            } else {
                Ok(())
            }
        }
    }
    impl Drop for Attributes {
        fn drop(&mut self) {
            if self.initialized {
                unsafe {
                    DeleteProcThreadAttributeList(self.ptr());
                }
            }
        }
    }
    struct AppProfile {
        name: Vec<u16>,
        sid: OwnedSid,
        deleted: bool,
    }
    impl AppProfile {
        fn create(name: &str) -> Result<Self, String> {
            let wide_name = wide(name);
            let mut sid = null_mut();
            let hr = unsafe {
                CreateAppContainerProfile(
                    wide_name.as_ptr(),
                    wide_name.as_ptr(),
                    wide_name.as_ptr(),
                    null(),
                    0,
                    &mut sid,
                )
            };
            if hr < 0 || sid.is_null() {
                return Err("browser-appcontainer-profile-denied".into());
            }
            Ok(Self {
                name: wide_name,
                sid: OwnedSid(sid),
                deleted: false,
            })
        }
        fn sid_text(&self) -> Result<String, String> {
            let mut raw = null_mut();
            if unsafe { ConvertSidToStringSidW(self.sid.0, &mut raw) } == 0 {
                return Err(win_err("browser-sid-string"));
            }
            let owned = LocalMemory(raw.cast());
            let mut end = 0;
            unsafe {
                while *raw.add(end) != 0 {
                    end += 1;
                }
            }
            let text = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(raw, end) });
            drop(owned);
            Ok(text)
        }
        fn delete(&mut self) -> Result<(), String> {
            if self.deleted {
                return Ok(());
            }
            let hr = unsafe { DeleteAppContainerProfile(self.name.as_ptr()) };
            if hr < 0 {
                return Err("browser-appcontainer-cleanup-failed".into());
            }
            self.deleted = true;
            Ok(())
        }
    }

    // Failure at any launch phase must not strand a live browser or erase a
    // profile still in use. A failed proof leaves resources in place for
    // diagnosis rather than guessing that a PID has exited.
    struct LaunchRollback {
        root: PathBuf,
        profile: Option<AppProfile>,
        job: Option<OwnedHandle>,
        host: Option<OwnedHandle>,
        disarmed: bool,
    }
    impl LaunchRollback {
        fn new(root: PathBuf) -> Self {
            Self {
                root,
                profile: None,
                job: None,
                host: None,
                disarmed: false,
            }
        }
    }
    impl Drop for LaunchRollback {
        fn drop(&mut self) {
            if self.disarmed {
                return;
            }
            if let Some(job) = &self.job {
                if unsafe { TerminateJobObject(job.0, 1) } == 0 {
                    return;
                }
                if let Some(host) = &self.host {
                    if unsafe { WaitForSingleObject(host.0, JOB_STOP_TIMEOUT_MS) } != WAIT_OBJECT_0
                    {
                        return;
                    }
                }
                let mut accounting: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { zeroed() };
                if unsafe {
                    QueryInformationJobObject(
                        job.0,
                        JobObjectBasicAccountingInformation,
                        (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                        size_of_val(&accounting) as u32,
                        null_mut(),
                    )
                } == 0
                    || accounting.ActiveProcesses != 0
                {
                    return;
                }
            }
            if ensure_plain_dir(&self.root).is_err() {
                return;
            }
            if self.root.join("udf").exists() && ensure_plain_dir(&self.root.join("udf")).is_err() {
                return;
            }
            if fs::remove_dir_all(&self.root).is_ok() {
                if let Some(profile) = &mut self.profile {
                    let _ = profile.delete();
                }
            }
        }
    }
    fn grant_udf(path: &Path, sid: &str) -> Result<(), String> {
        // Private owner + SYSTEM and only the session's AppContainer SID.
        let descriptor = wide(format!(
            "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;OW)(A;OICI;GRGWGXSD;;;{sid})S:(ML;OICI;NW;;;LW)"
        ));
        let mut raw = null_mut();
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                descriptor.as_ptr(),
                1,
                &mut raw,
                null_mut(),
            )
        } == 0
        {
            return Err(win_err("browser-udf-descriptor"));
        }
        let owned = LocalMemory(raw);
        if unsafe {
            SetFileSecurityW(
                wide(path).as_ptr(),
                DACL_SECURITY_INFORMATION
                    | PROTECTED_DACL_SECURITY_INFORMATION
                    | LABEL_SECURITY_INFORMATION,
                owned.0,
            )
        } == 0
        {
            return Err(win_err("browser-udf-acl"));
        }
        Ok(())
    }
    fn ensure_plain_dir(path: &Path) -> Result<(), String> {
        let metadata = fs::symlink_metadata(path).map_err(|_| "browser-udf-directory-missing")?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err("browser-udf-path-unsafe".into());
        }
        let attrs = unsafe { GetFileAttributesW(wide(path).as_ptr()) };
        if attrs == INVALID_FILE_ATTRIBUTES || attrs & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err("browser-udf-reparse-path-denied".into());
        }
        Ok(())
    }
    fn new_pipe(child_reads: bool) -> Result<(OwnedHandle, OwnedHandle), String> {
        let mut read = null_mut();
        let mut write = null_mut();
        let attr = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: null_mut(),
            bInheritHandle: 1,
        };
        if unsafe { CreatePipe(&mut read, &mut write, &attr, 4096) } == 0 {
            return Err(win_err("browser-pipe-create"));
        }
        let read = OwnedHandle::checked(read, "browser-pipe-read")?;
        let write = OwnedHandle::checked(write, "browser-pipe-write")?;
        // Parent-end must never be inherited into child/Chromium descendants.
        let parent = if child_reads { write.0 } else { read.0 };
        if unsafe { SetHandleInformation(parent, HANDLE_FLAG_INHERIT, 0) } == 0 {
            return Err(win_err("browser-pipe-inheritance"));
        }
        Ok((read, write))
    }
    fn read_pipe_bounded(pipe: &mut File) -> Result<Vec<u8>, String> {
        let deadline = Instant::now() + PIPE_TIMEOUT;
        let mut header = [0u8; 4];
        read_exact_deadline(pipe, &mut header, deadline)?;
        let len = u32::from_le_bytes(header) as usize;
        if len == 0 || len > FRAME_MAX {
            return Err("browser-pipe-frame-bounds".into());
        }
        let mut body = vec![0; len];
        read_exact_deadline(pipe, &mut body, deadline)?;
        Ok(body)
    }
    fn read_exact_deadline(
        pipe: &mut File,
        output: &mut [u8],
        deadline: Instant,
    ) -> Result<(), String> {
        let mut cursor = 0;
        while cursor < output.len() {
            if Instant::now() >= deadline {
                return Err("browser-broker-reply-timeout".into());
            }
            let mut available = 0;
            if unsafe {
                PeekNamedPipe(
                    pipe.as_raw_handle().cast(),
                    null_mut(),
                    0,
                    null_mut(),
                    &mut available,
                    null_mut(),
                )
            } == 0
            {
                return Err("browser-broker-pipe-closed".into());
            }
            if available == 0 {
                std::thread::sleep(Duration::from_millis(10));
                continue;
            }
            let count = (available as usize).min(output.len() - cursor).min(4096);
            let read = pipe
                .read(&mut output[cursor..cursor + count])
                .map_err(|_| "browser-broker-pipe-read-failed")?;
            if read == 0 {
                return Err("browser-broker-pipe-eof".into());
            }
            cursor += read;
        }
        Ok(())
    }
    fn token_attest(process: HANDLE, expected_sid: PSID, job: HANDLE) -> Result<(), String> {
        let mut member = 0;
        if unsafe { IsProcessInJob(process, job, &mut member) } == 0 || member == 0 {
            return Err("browser-owned-job-mismatch".into());
        }
        if unsafe { WaitForSingleObject(process, 0) } != WAIT_TIMEOUT {
            return Err("browser-process-not-live".into());
        }
        let mut raw = null_mut();
        if unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut raw) } == 0 {
            return Err(win_err("browser-process-token"));
        }
        let token = OwnedHandle::checked(raw, "browser-token-handle")?;
        let mut flag = 0u32;
        let mut returned = 0;
        if unsafe {
            GetTokenInformation(
                token.0,
                TokenIsAppContainer,
                (&mut flag as *mut u32).cast(),
                size_of::<u32>() as u32,
                &mut returned,
            )
        } == 0
            || flag != 1
        {
            return Err("browser-token-not-appcontainer".into());
        }
        let mut len = 0u32;
        unsafe {
            GetTokenInformation(token.0, TokenAppContainerSid, null_mut(), 0, &mut len);
        }
        if len < size_of::<TOKEN_APPCONTAINER_INFORMATION>() as u32 {
            return Err("browser-appcontainer-sid-absent".into());
        }
        let mut buffer = vec![0u64; (len as usize).div_ceil(8)];
        if unsafe {
            GetTokenInformation(
                token.0,
                TokenAppContainerSid,
                buffer.as_mut_ptr().cast(),
                len,
                &mut len,
            )
        } == 0
        {
            return Err("browser-appcontainer-sid-unavailable".into());
        }
        let sid = unsafe {
            (*(buffer.as_ptr().cast::<TOKEN_APPCONTAINER_INFORMATION>())).TokenAppContainer
        };
        if sid.is_null() || unsafe { EqualSid(sid, expected_sid) } == 0 {
            return Err("browser-appcontainer-sid-mismatch".into());
        }
        let mut caps_len = 0;
        unsafe {
            GetTokenInformation(token.0, TokenCapabilities, null_mut(), 0, &mut caps_len);
        }
        if caps_len != 0 {
            let mut caps = vec![0u64; (caps_len as usize).div_ceil(8)];
            if unsafe {
                GetTokenInformation(
                    token.0,
                    TokenCapabilities,
                    caps.as_mut_ptr().cast(),
                    caps_len,
                    &mut caps_len,
                )
            } == 0
                || unsafe { (*caps.as_ptr().cast::<TOKEN_GROUPS>()).GroupCount } != 0
            {
                return Err("browser-token-capability-denied".into());
            }
        }
        Ok(())
    }
    fn verify_child(pid: u32, profile: &AppProfile, job: HANDLE) -> Result<OwnedHandle, String> {
        if pid == 0 {
            return Err("browser-child-pid-invalid".into());
        }
        let raw = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                0,
                pid,
            )
        };
        let process = OwnedHandle::checked(raw, "browser-child-handle")?;
        token_attest(process.0, profile.sid.0, job)?;
        let mut image = vec![0u16; 32768];
        let mut len = image.len() as u32;
        if unsafe { QueryFullProcessImageNameW(process.0, 0, image.as_mut_ptr(), &mut len) } == 0 {
            return Err("browser-child-image-unavailable".into());
        }
        let path = String::from_utf16_lossy(&image[..len as usize]);
        if !Path::new(&path)
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("msedgewebview2.exe"))
        {
            return Err("browser-child-image-unexpected".into());
        }
        Ok(process)
    }

    pub(crate) struct BrowserRuntimeSession {
        pub nonce: String,
        pub workspace_root: PathBuf,
        pub actor: String,
        pub session_id: String,
        pub initial_url: String,
        pub private_root: PathBuf,
        pub effective_udf: PathBuf,
        pub host_pid: u32,
        host: OwnedHandle,
        job: OwnedHandle,
        profile: AppProfile,
        browser: Option<OwnedHandle>,
        renderer: Option<OwnedHandle>,
        requests: File,
        responses: File,
        last_request_id: u64,
        last_page_generation: u64,
        last_observation_id: u64,
        ready: bool,
        // Futures may be cancelled while a blocking pipe reader is still
        // executing. An interrupted readiness/request can never be retried on
        // this session: its frame and external-effect state is uncertain.
        poisoned: bool,
        job_drained: bool,
        stopped: bool,
    }

    // OS process/job/pipe handles and the owned AppContainer SID are valid
    // across Windows threads. Every operation needs &mut self; no WebView2
    // COM interface or UI-apartment object is stored in this owner.
    // A production registry may therefore hold it behind a native Mutex.
    unsafe impl Send for BrowserRuntimeSession {}

    impl BrowserRuntimeSession {
        pub(crate) fn launch(
            start: BrowserRuntimeStart,
            registry: &WorkspaceRegistry,
        ) -> Result<Self, String> {
            if !start.workspace_root.is_dir() || !start.private_parent.is_dir() {
                return Err("browser-owner-root-unavailable".into());
            }
            let workspace = fs::canonicalize(&start.workspace_root)
                .map_err(|_| "browser-owner-workspace-unavailable")?;
            if !registry.is_authorized(&workspace) {
                return Err("browser-owner-workspace-denied".into());
            }
            if start.actor.is_empty()
                || start.session_id.is_empty()
                || start.actor.len() > 128
                || start.session_id.len() > 128
                || !start
                    .actor
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"._:-".contains(&c))
                || !start
                    .session_id
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"._:-".contains(&c))
            {
                return Err("browser-owner-actor-session-invalid".into());
            }
            let initial = reqwest::Url::parse(&start.initial_url)
                .map_err(|_| "browser-initial-url-invalid")?;
            if initial.scheme() != "https" || initial.host_str().is_none()
                || !initial.username().is_empty() || initial.password().is_some()
                || initial.port().is_some_and(|p| p != 443)
                // A command-line URL is visible to local process inspection.
                // Sensitive query strings must never reach the host argv.
                || initial.query().is_some() || initial.fragment().is_some()
            {
                return Err("browser-initial-url-https-required".into());
            }
            // No environment-supplied WebView2 UDF, executable or browser args.
            for override_name in [
                "WEBVIEW2_USER_DATA_FOLDER",
                "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER",
                "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                "WEBVIEW2_RELEASE_CHANNEL_PREFERENCE",
            ] {
                if std::env::var_os(override_name).is_some() {
                    return Err("browser-webview2-environment-override-denied".into());
                }
            }
            let host_exe = validate_host_binary(&start.host_executable, &start.host_sha256)?;
            let nonce = random_nonce()?;
            let private_parent = fs::canonicalize(&start.private_parent)
                .map_err(|_| "browser-owner-private-parent-unavailable")?;
            ensure_plain_dir(&private_parent)?;
            let private_root = private_parent.join(format!("tf4-{nonce}"));
            fs::create_dir(&private_root)
                .map_err(|_| "browser-owner-private-session-create-denied")?;
            ensure_plain_dir(&private_root)?;
            let mut rollback = LaunchRollback::new(private_root.clone());
            let udf = private_root.join("udf");
            let profile_name = format!("ClackTf4{nonce}");
            rollback.profile = Some(AppProfile::create(&profile_name)?);
            let profile = rollback.profile.as_ref().expect("created profile");
            let sid = profile.sid_text()?;
            grant_udf(&private_root, &sid)?;
            fs::create_dir(&udf).map_err(|_| "browser-udf-create-denied")?;
            ensure_plain_dir(&udf)?;
            grant_udf(&udf, &sid)?;

            let (child_response_read, parent_response_write) = new_pipe(true)?;
            let (parent_request_read, child_request_write) = new_pipe(false)?;
            // Explicit inherited stdio points to the same sealed child channels.
            rollback.job = Some(OwnedHandle::checked(
                unsafe { CreateJobObjectW(null(), null()) },
                "browser-job-create",
            )?);
            let job = rollback.job.as_ref().expect("created job");
            let mut limit: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
            limit.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if unsafe {
                SetInformationJobObject(
                    job.0,
                    JobObjectExtendedLimitInformation,
                    (&limit as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                    size_of_val(&limit) as u32,
                )
            } == 0
            {
                return Err(win_err("browser-job-kill-on-close"));
            }

            let mut attrs = Attributes::new()?;
            let jobs = [job.0];
            attrs.add(PROC_THREAD_ATTRIBUTE_JOB_LIST, &jobs)?;
            let inherited = [child_response_read.0, child_request_write.0];
            attrs.add(PROC_THREAD_ATTRIBUTE_HANDLE_LIST, &inherited)?;
            let security = SECURITY_CAPABILITIES {
                AppContainerSid: profile.sid.0,
                Capabilities: null_mut(),
                CapabilityCount: 0,
                Reserved: 0,
            };
            attrs.add(PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, &security)?;
            let mut startup: STARTUPINFOEXW = unsafe { zeroed() };
            startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
            startup.lpAttributeList = attrs.ptr();
            let env_root =
                std::env::var("SystemRoot").map_err(|_| "browser-system-root-missing")?;
            let folder = private_root.to_string_lossy();
            let env_block = wide(format!(
                "CLACK_TF_BROWSER_BROKER_READ_HANDLE={}\0CLACK_TF_BROWSER_BROKER_WRITE_HANDLE={}\0LOCALAPPDATA={folder}\0SystemRoot={env_root}\0TEMP={folder}\0TMP={folder}\0",
                child_response_read.0 as usize, child_request_write.0 as usize
            ));
            let exe_path = host_exe.to_string_lossy();
            let mut argv = wide(format!(
                "{} --production-broker {} --broker-session {nonce} --initial-url {}",
                quote(&exe_path),
                quote(&folder),
                quote(&start.initial_url)
            ));
            let mut info: PROCESS_INFORMATION = unsafe { zeroed() };
            if unsafe {
                CreateProcessW(
                    wide(&host_exe).as_ptr(),
                    argv.as_mut_ptr(),
                    null(),
                    null(),
                    1,
                    EXTENDED_STARTUPINFO_PRESENT
                        | CREATE_UNICODE_ENVIRONMENT
                        | CREATE_SUSPENDED
                        | CREATE_NO_WINDOW,
                    env_block.as_ptr().cast(),
                    wide(&private_root).as_ptr(),
                    &startup.StartupInfo,
                    &mut info,
                )
            } == 0
            {
                return Err(win_err("browser-restricted-host-spawn"));
            }
            rollback.host = Some(OwnedHandle::checked(info.hProcess, "browser-host-handle")?);
            let host = rollback.host.as_ref().expect("created host");
            let thread = OwnedHandle::checked(info.hThread, "browser-host-thread")?;
            // Before first instruction, verify the original retained process
            // object, the exact owned job and the zero-capability container.
            if let Err(reason) = token_attest(host.0, profile.sid.0, job.0) {
                unsafe {
                    TerminateProcess(host.0, 1);
                }
                return Err(reason);
            }
            if unsafe { ResumeThread(thread.0) } == u32::MAX {
                unsafe {
                    TerminateProcess(host.0, 1);
                }
                return Err(win_err("browser-host-resume"));
            }
            drop(thread);
            drop(child_response_read);
            drop(child_request_write);
            let requests = unsafe { File::from_raw_handle(parent_request_read.0.cast()) };
            let responses = unsafe { File::from_raw_handle(parent_response_write.0.cast()) };
            std::mem::forget(parent_request_read);
            std::mem::forget(parent_response_write);
            let host = rollback.host.take().expect("retained host");
            let job = rollback.job.take().expect("retained job");
            let profile = rollback.profile.take().expect("retained profile");
            rollback.disarmed = true;
            Ok(Self {
                nonce,
                workspace_root: workspace,
                actor: start.actor,
                session_id: start.session_id,
                initial_url: initial.to_string(),
                private_root,
                effective_udf: udf,
                host_pid: info.dwProcessId,
                host,
                job,
                profile,
                browser: None,
                renderer: None,
                requests,
                responses,
                last_request_id: 0,
                last_page_generation: 0,
                last_observation_id: 0,
                ready: false,
                poisoned: false,
                job_drained: false,
                stopped: false,
            })
        }

        pub(crate) async fn verify_ready(&mut self) -> Result<(), String> {
            if self.ready || self.stopped || self.poisoned {
                return Err("browser-readiness-replayed".into());
            }
            self.poisoned = true;
            let mut flight = FlightFence::new(self.job.0);
            // Keep potentially stalled anonymous pipe reads off the Tauri
            // runtime thread; timeout remains bounded even for a dead host.
            let mut reader = self
                .requests
                .try_clone()
                .map_err(|_| "browser-pipe-clone-denied")?;
            let bytes = tokio::task::spawn_blocking(move || read_pipe_bounded(&mut reader))
                .await
                .map_err(|_| "browser-pipe-worker-failed")??;
            let ready: ChildReady =
                serde_json::from_slice(&bytes).map_err(|_| "browser-readiness-invalid-frame")?;
            if ready.version != 1
                || ready.kind != "ready"
                || ready.session != self.nonce
                || self.nonce.len() != SESSION_NONCE_BYTES * 2
                || ready.request_id != 0
                || ready.host_pid != self.host_pid
                || ready.browser_pid == ready.renderer_pid
                || ready.browser_pid == self.host_pid
                || ready.renderer_pid == self.host_pid
            {
                return Err("browser-readiness-identity-mismatch".into());
            }
            let effective = fs::canonicalize(&ready.effective_udf)
                .map_err(|_| "browser-effective-udf-unavailable")?;
            let owned = fs::canonicalize(&self.effective_udf)
                .map_err(|_| "browser-owned-udf-unavailable")?;
            if effective != owned {
                return Err("browser-effective-udf-mismatch".into());
            }
            ensure_plain_dir(&self.private_root)?;
            ensure_plain_dir(&self.effective_udf)?;
            token_attest(self.host.0, self.profile.sid.0, self.job.0)?;
            let browser = verify_child(ready.browser_pid, &self.profile, self.job.0)?;
            let renderer = verify_child(ready.renderer_pid, &self.profile, self.job.0)?;
            self.browser = Some(browser);
            self.renderer = Some(renderer);
            self.send_reply(0, 204, "text/plain", &[], None).await?;
            self.ready = true;
            self.poisoned = false;
            flight.committed = true;
            Ok(())
        }

        async fn send_reply(
            &mut self,
            id: u64,
            status: u16,
            mime: &str,
            data: &[u8],
            error: Option<&str>,
        ) -> Result<(), String> {
            if data.len() > RESOURCE_MAX {
                return Err("browser-reply-size-denied".into());
            }
            let response = ParentReply {
                version: 1,
                session: &self.nonce,
                request_id: id,
                status,
                content_type: mime,
                body_base64: encode_base64(data),
                error,
            };
            let frame = serde_json::to_vec(&response).map_err(|_| "browser-reply-serialization")?;
            self.write_parent_frame(frame).await
        }

        async fn write_parent_frame(&mut self, frame: Vec<u8>) -> Result<(), String> {
            if frame.is_empty() || frame.len() > FRAME_MAX {
                return Err("browser-reply-frame-bounds".into());
            }
            let mut writer = self
                .responses
                .try_clone()
                .map_err(|_| "browser-reply-pipe-clone")?;
            let sent = tokio::task::spawn_blocking(move || {
                writer
                    .write_all(&(frame.len() as u32).to_le_bytes())
                    .and_then(|_| writer.write_all(&frame))
                    .and_then(|_| writer.flush())
                    .map_err(|_| "browser-reply-pipe-broken".to_owned())
            });
            match tokio::time::timeout(PIPE_TIMEOUT, sent).await {
                Ok(Ok(result)) => result,
                Ok(Err(_)) => Err("browser-reply-writer-failed".into()),
                Err(_) => Err("browser-reply-write-timeout".into()),
            }
        }

        async fn verify_com_completion(
            &mut self,
            request_id: u64,
            page_generation: u64,
            installed_status: u16,
        ) -> Result<(), String> {
            let mut reader = self
                .requests
                .try_clone()
                .map_err(|_| "browser-com-ack-pipe-clone-denied")?;
            let frame = tokio::task::spawn_blocking(move || read_pipe_bounded(&mut reader))
                .await
                .map_err(|_| "browser-com-ack-worker-failed")??;
            let ack: ChildComAck =
                serde_json::from_slice(&frame).map_err(|_| "browser-com-ack-invalid-frame")?;
            validate_com_ack(
                &ack,
                &self.nonce,
                request_id,
                page_generation,
                installed_status,
            )?;
            Ok(())
        }

        async fn send_and_verify(
            &mut self,
            request_id: u64,
            page_generation: u64,
            status: u16,
            mime: &str,
            data: &[u8],
            error: Option<&str>,
        ) -> Result<(), String> {
            self.send_reply(request_id, status, mime, data, error)
                .await?;
            // No success receipt until the child completes exactly this native
            // COM deferral; missing, stale, duplicate or unexpected ACK poisons
            // the session and its Job is terminated by the flight fence.
            self.verify_com_completion(request_id, page_generation, status)
                .await
        }

        /// Security-limited, *internal only* native structural observation.
        /// This cannot issue an action or produce a model-facing semantic
        /// snapshot. All page-derived names, text, destinations and values are
        /// intentionally absent until adequate production secret protection
        /// and exact live DOM element binding can be demonstrated.
        pub(crate) async fn observe_structure(&mut self) -> Result<NativeDomStructure, String> {
            if !self.ready
                || self.stopped
                || self.poisoned
                || self.last_request_id == 0
                || self.last_page_generation == 0
            {
                return Err("browser-structure-session-not-ready".into());
            }
            self.poisoned = true;
            let mut flight = FlightFence::new(self.job.0);
            let observation_id = self
                .last_observation_id
                .checked_add(1)
                .ok_or("browser-structure-observation-exhausted")?;
            self.last_observation_id = observation_id;
            let generation = self.last_page_generation;
            let source = format!("{:x}", Sha256::digest(self.initial_url.as_bytes()));
            let observed = self
                .observe_structure_inner(observation_id, generation, &source)
                .await;
            if observed.is_ok() {
                self.poisoned = false;
                flight.committed = true;
            }
            observed
        }

        async fn observe_structure_inner(
            &mut self,
            observation_id: u64,
            generation: u64,
            source: &str,
        ) -> Result<NativeDomStructure, String> {
            token_attest(self.host.0, self.profile.sid.0, self.job.0)?;
            if self
                .browser
                .as_ref()
                .is_none_or(|p| token_attest(p.0, self.profile.sid.0, self.job.0).is_err())
                || self
                    .renderer
                    .as_ref()
                    .is_none_or(|p| token_attest(p.0, self.profile.sid.0, self.job.0).is_err())
            {
                return Err("browser-structure-child-unattested".into());
            }
            let frame = serde_json::to_vec(&ParentObserve {
                version: 2,
                kind: "observe-dom",
                session: &self.nonce,
                observation_id,
                page_generation: generation,
                source_id: source,
            })
            .map_err(|_| "browser-structure-control-serialization")?;
            self.write_parent_frame(frame).await?;
            let mut reader = self
                .requests
                .try_clone()
                .map_err(|_| "browser-structure-result-pipe-clone-denied")?;
            let bytes = tokio::task::spawn_blocking(move || read_pipe_bounded(&mut reader))
                .await
                .map_err(|_| "browser-structure-result-worker-failed")??;
            let result: NativeDomStructure =
                serde_json::from_slice(&bytes).map_err(|_| "browser-structure-invalid-result")?;
            validate_dom_structure(&result, &self.nonce, observation_id, generation, source)?;
            Ok(result)
        }

        /// One frame is one new, native TF3 policy decision; no retries,
        /// alternate HTTP stack, proxy fallback or implicit credentials.
        pub(crate) async fn serve_one(
            &mut self,
            registry: &WorkspaceRegistry,
            web_state: &TfWebState,
        ) -> Result<BrokerResourceReceipt, String> {
            self.serve_one_scoped(registry, web_state, None).await
        }

        /// In-process physical acceptance only: the real production host,
        /// original AppContainer and COM pipe remain unchanged. The parent
        /// uses a *test-only* exact loopback HTTPS TF3 policy with ephemeral
        /// certificate trust. No production binary or IPC can invoke this.
        #[cfg(test)]
        pub(crate) async fn serve_one_owned_https_for_test(
            &mut self,
            registry: &WorkspaceRegistry,
            web_state: &TfWebState,
            public_cert: &reqwest::Certificate,
        ) -> Result<BrokerResourceReceipt, String> {
            self.serve_one_scoped(registry, web_state, Some(public_cert))
                .await
        }

        async fn serve_one_scoped(
            &mut self,
            registry: &WorkspaceRegistry,
            web_state: &TfWebState,
            test_public_cert: Option<&reqwest::Certificate>,
        ) -> Result<BrokerResourceReceipt, String> {
            if !self.ready
                || self.stopped
                || self.poisoned
                || self.last_request_id as usize >= REQUEST_MAX
            {
                return Err("browser-broker-not-ready-or-budget-exhausted".into());
            }
            self.poisoned = true;
            let mut flight = FlightFence::new(self.job.0);
            let outcome = self
                .serve_one_inner(registry, web_state, test_public_cert)
                .await;
            if outcome.is_ok() {
                self.poisoned = false;
                flight.committed = true;
            }
            outcome
        }

        async fn serve_one_inner(
            &mut self,
            registry: &WorkspaceRegistry,
            web_state: &TfWebState,
            test_public_cert: Option<&reqwest::Certificate>,
        ) -> Result<BrokerResourceReceipt, String> {
            token_attest(self.host.0, self.profile.sid.0, self.job.0)?;
            if self
                .browser
                .as_ref()
                .is_none_or(|p| token_attest(p.0, self.profile.sid.0, self.job.0).is_err())
                || self
                    .renderer
                    .as_ref()
                    .is_none_or(|p| token_attest(p.0, self.profile.sid.0, self.job.0).is_err())
            {
                return Err("browser-child-process-unattested".into());
            }
            let mut reader = self
                .requests
                .try_clone()
                .map_err(|_| "browser-pipe-clone-denied")?;
            let bytes = tokio::task::spawn_blocking(move || read_pipe_bounded(&mut reader))
                .await
                .map_err(|_| "browser-pipe-worker-failed")??;
            let req: ChildGet =
                serde_json::from_slice(&bytes).map_err(|_| "browser-broker-request-malformed")?;
            validate_get(&req, &self.nonce, self.last_request_id)?;
            if req.page_generation < self.last_page_generation {
                return Err("browser-broker-stale-page-generation".into());
            }
            self.last_request_id = req.request_id;
            self.last_page_generation = req.page_generation;
            if !registry.is_authorized(&self.workspace_root) {
                return Err("browser-broker-workspace-revoked".into());
            }
            // The session's approved origin is the only remote HTTPS origin
            // accessible to this child. Cross-origin URLs and redirects are
            // rejected before a new DNS resolution or network connection.
            let requested =
                reqwest::Url::parse(&req.url).map_err(|_| "browser-request-url-invalid")?;
            let approved = reqwest::Url::parse(&self.initial_url)
                .map_err(|_| "browser-approved-origin-invalid")?;
            if requested.origin() != approved.origin() {
                self.send_and_verify(
                    req.request_id,
                    req.page_generation,
                    403,
                    "text/plain",
                    &[],
                    Some("origin-denied"),
                )
                .await?;
                return Ok(BrokerResourceReceipt {
                    request_id: req.request_id,
                    page_generation: req.page_generation,
                    native_com_completed: true,
                    terminal: "denied",
                    reason: "browser-origin-denied".into(),
                    bytes: 0,
                    tf3: None,
                });
            }
            let native = TfWebRequest {
                operation: TfWebOperation::HttpGet,
                actor: self.actor.clone(),
                session_id: self.session_id.clone(),
                workspace_root: self.workspace_root.to_string_lossy().into_owned(),
                url: Some(req.url),
                query: None,
                search_result_id: None,
                timeout_ms: Some(5_000),
                max_bytes: Some(RESOURCE_MAX),
                // TF3 reclassifies DNS/IP/SSRF on every hop; the native
                // same-origin executor additionally refuses a redirected
                // origin *before* resolving or connecting to it.
                max_redirects: Some(3),
            };
            let prepared_result = {
                #[cfg(test)]
                {
                    if test_public_cert.is_some() {
                        tf_web::prepare_owned_https_for_test(native, registry, web_state)
                    } else {
                        tf_web::prepare(native, registry, web_state)
                    }
                }
                #[cfg(not(test))]
                {
                    let _ = test_public_cert;
                    tf_web::prepare(native, registry, web_state)
                }
            };
            let prepared = match prepared_result {
                Ok(prepared) => prepared,
                Err(_) => {
                    self.send_and_verify(
                        req.request_id,
                        req.page_generation,
                        403,
                        "text/plain",
                        &[],
                        Some("tf3-preflight-denied"),
                    )
                    .await?;
                    return Ok(BrokerResourceReceipt {
                        request_id: req.request_id,
                        page_generation: req.page_generation,
                        native_com_completed: true,
                        terminal: "denied",
                        reason: "tf3-preflight-denied".into(),
                        bytes: 0,
                        tf3: None,
                    });
                }
            };
            let result = {
                #[cfg(test)]
                {
                    if let Some(cert) = test_public_cert {
                        tf_web::execute_owned_https_for_test(
                            &prepared.token,
                            registry,
                            web_state,
                            &approved,
                            cert,
                        )
                        .await
                    } else {
                        tf_web::execute_browser_resource_same_origin(
                            &prepared.token,
                            registry,
                            web_state,
                            &approved,
                        )
                        .await
                    }
                }
                #[cfg(not(test))]
                {
                    tf_web::execute_browser_resource_same_origin(
                        &prepared.token,
                        registry,
                        web_state,
                        &approved,
                    )
                    .await
                }
            };
            match result {
                Ok(result) => {
                    let receipt = result.receipt;
                    let mime = checked_mime(receipt.content_type.as_deref());
                    let delivered = receipt.terminal == "completed"
                        && receipt.reason_code == "ok"
                        && receipt.status_code.is_some_and(|s| (200..300).contains(&s))
                        && !receipt.truncated
                        && result.bytes.len() <= RESOURCE_MAX
                        && mime.is_some();
                    let size = if delivered { result.bytes.len() } else { 0 };
                    self.send_and_verify(
                        req.request_id,
                        req.page_generation,
                        if delivered { 200 } else { 403 },
                        mime.unwrap_or("text/plain"),
                        if delivered { &result.bytes } else { &[] },
                        (!delivered).then_some("tf3-resource-denied"),
                    )
                    .await?;
                    Ok(BrokerResourceReceipt {
                        request_id: req.request_id,
                        page_generation: req.page_generation,
                        native_com_completed: true,
                        terminal: if delivered { "completed" } else { "denied" },
                        reason: receipt.reason_code.into(),
                        bytes: size,
                        tf3: Some(receipt),
                    })
                }
                Err(_) => {
                    self.send_and_verify(
                        req.request_id,
                        req.page_generation,
                        502,
                        "text/plain",
                        &[],
                        Some("tf3-execution-failed"),
                    )
                    .await?;
                    Ok(BrokerResourceReceipt {
                        request_id: req.request_id,
                        page_generation: req.page_generation,
                        native_com_completed: true,
                        terminal: "failed",
                        reason: "tf3-execution-failed".into(),
                        bytes: 0,
                        tf3: None,
                    })
                }
            }
        }

        pub(crate) fn shutdown(&mut self) -> Result<(), String> {
            if self.stopped {
                return Ok(());
            }
            if !self.job_drained {
                if unsafe { TerminateJobObject(self.job.0, 1) } == 0 {
                    return Err(win_err("browser-terminate-job"));
                }
                if unsafe { WaitForSingleObject(self.host.0, JOB_STOP_TIMEOUT_MS) } != WAIT_OBJECT_0
                {
                    return Err("browser-host-job-not-drained".into());
                }
                let deadline = Instant::now() + Duration::from_secs(3);
                loop {
                    let mut accounting: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION =
                        unsafe { zeroed() };
                    if unsafe {
                        QueryInformationJobObject(
                            self.job.0,
                            JobObjectBasicAccountingInformation,
                            (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                            size_of_val(&accounting) as u32,
                            null_mut(),
                        )
                    } == 0
                    {
                        return Err(win_err("browser-job-accounting"));
                    }
                    if accounting.ActiveProcesses == 0 {
                        break;
                    }
                    if Instant::now() >= deadline {
                        return Err("browser-job-processes-still-live".into());
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
                self.job_drained = true;
            }
            // Only explicitly created per-session UDF and directory are
            // eligible; avoid following symlinks/reparse points during cleanup.
            ensure_plain_dir(&self.private_root)?;
            ensure_plain_dir(&self.effective_udf)?;
            fs::remove_dir_all(&self.private_root)
                .map_err(|_| "browser-session-udf-cleanup-failed")?;
            self.profile.delete()?;
            self.stopped = true;
            Ok(())
        }
    }
    impl Drop for BrowserRuntimeSession {
        fn drop(&mut self) {
            // Closing the Job Object is last-resort kill-on-close. Never
            // silently erase AppContainer/UDF if orderly cleanup was unproved.
            if !self.stopped {
                let _ = self.shutdown();
            }
        }
    }
}

#[cfg(windows)]
pub(crate) use windows_owner::BrowserRuntimeSession;

#[cfg(not(windows))]
pub(crate) struct BrowserRuntimeSession;

#[cfg(not(windows))]
impl BrowserRuntimeSession {
    pub(crate) fn launch(
        _start: BrowserRuntimeStart,
        _registry: &WorkspaceRegistry,
    ) -> Result<Self, String> {
        Err("browser-appcontainer-windows-only".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn broker_allows_bounded_web_fonts_and_common_script_mime_without_untrusted_headers() {
        for mime in [
            "text/javascript; charset=utf-8",
            "font/woff",
            "font/woff2",
            "application/font-woff",
            "application/font-woff2",
            "application/vnd.ms-fontobject",
            "application/x-javascript",
            "image/webp",
            "image/avif",
            "font/ttf",
            "font/otf",
        ] {
            assert!(checked_mime(Some(mime)).is_some(), "{mime}");
        }
        for mime in [
            "text/html\r\nSet-Cookie: x=y",
            "application/x-sh",
            "text/xml",
        ] {
            assert!(checked_mime(Some(mime)).is_none(), "{mime}");
        }
    }
    #[test]
    fn rejects_replay_forged_session_and_non_https_before_network() {
        let nonce = "a".repeat(48);
        let good = ChildGet {
            version: 1,
            session: nonce.clone(),
            request_id: 1,
            method: "GET".into(),
            url: "https://example.org/a".into(),
            page_generation: 1,
        };
        assert!(validate_get(&good, &nonce, 0).is_ok());
        assert!(validate_get(&good, &nonce, 1).is_err());
        assert!(validate_get(
            &ChildGet {
                session: "b".repeat(48),
                ..good.clone()
            },
            &nonce,
            0
        )
        .is_err());
        assert!(validate_get(
            &ChildGet {
                url: "http://127.0.0.1/".into(),
                ..good.clone()
            },
            &nonce,
            0
        )
        .is_err());
        assert!(validate_get(
            &ChildGet {
                method: "POST".into(),
                ..good.clone()
            },
            &nonce,
            0
        )
        .is_err());
        assert!(validate_get(
            &ChildGet {
                page_generation: 0,
                ..good
            },
            &nonce,
            0
        )
        .is_err());
    }
    #[test]
    fn com_ack_requires_exact_native_completion_identity_and_status() {
        let nonce = "b".repeat(48);
        let accepted = ChildComAck {
            version: 1,
            session: nonce.clone(),
            request_id: 2,
            kind: "com-completed".into(),
            status: 403,
            page_generation: 5,
        };
        assert!(validate_com_ack(&accepted, &nonce, 2, 5, 403).is_ok());
        assert!(validate_com_ack(&accepted, &nonce, 2, 5, 200).is_err());
        assert!(validate_com_ack(&accepted, &nonce, 2, 4, 403).is_err());
        assert!(validate_com_ack(&accepted, &nonce, 1, 5, 403).is_err());
        let wrong_session = ChildComAck {
            session: "c".repeat(48),
            ..accepted
        };
        assert!(validate_com_ack(&wrong_session, &nonce, 2, 5, 403).is_err());
    }
    #[test]
    fn native_structure_never_accepts_page_derived_text_or_stale_identity() {
        let session = "d".repeat(48);
        let source = "e".repeat(64);
        let raw = serde_json::json!({
            "version":2, "kind":"dom-snapshot", "session":session,
            "observationId":4,"pageGeneration":7, "sourceId":source,
            "terminal":"completed","reason":"ok","truncated":false,
            "visited":2, "elements":[
                {"index":1,"role":"heading","depth":1,"headingLevel":2},
                {"index":2,"role":"link","depth":2,"headingLevel":null}
            ]
        });
        let expected: NativeDomStructure = serde_json::from_value(raw.clone()).unwrap();
        assert!(validate_dom_structure(&expected, &session, 4, 7, &source).is_ok());
        assert!(validate_dom_structure(&expected, &session, 3, 7, &source).is_err());
        assert!(validate_dom_structure(&expected, &session, 4, 8, &source).is_err());
        assert!(validate_dom_structure(&expected, &session, 4, 7, &"f".repeat(64)).is_err());
        let mut leaked = raw.clone();
        leaked["elements"][0]["name"] =
            serde_json::json!("opaque-secret-without-any-sensitive-keyword");
        assert!(serde_json::from_value::<NativeDomStructure>(leaked).is_err());
        let mut leaked = raw.clone();
        leaked["url"] = serde_json::json!("https://example.org/?x=secret");
        assert!(serde_json::from_value::<NativeDomStructure>(leaked).is_err());
        let mut impossible = expected.clone();
        impossible.elements[1].index = 1;
        assert!(validate_dom_structure(&impossible, &session, 4, 7, &source).is_err());
        impossible.elements[1].index = 2;
        impossible.elements[1].role = "unsafe-untrusted-role".into();
        assert!(validate_dom_structure(&impossible, &session, 4, 7, &source).is_err());
    }
    #[test]
    fn bounded_frames_reject_zero_oversize_and_incomplete_input() {
        use std::io::Cursor;
        assert!(read_frame_from(&mut Cursor::new(0u32.to_le_bytes())).is_err());
        assert!(read_frame_from(&mut Cursor::new(((FRAME_MAX + 1) as u32).to_le_bytes())).is_err());
        assert!(read_frame_from(&mut Cursor::new(
            [4u32.to_le_bytes().as_slice(), b"no"].concat()
        ))
        .is_err());
        assert_eq!(
            read_frame_from(&mut Cursor::new(
                [2u32.to_le_bytes().as_slice(), b"ok"].concat()
            ))
            .unwrap(),
            b"ok"
        );
    }

    /// This is an explicitly invoked physical Windows probe of the real
    /// production launcher and child COM readiness channel. The reserved
    /// loopback URL is never broker-served, and the caller shuts down directly
    /// after attesting the actual renderer/browser and COM effective UDF. It
    /// cannot be mistaken for the full HTTPS or interactive native E2E gate.
    /// No default cargo test launches a browser or touches a real website.
    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "explicit Windows original-HANDLE AppContainer/COM pre-navigation probe only"]
    async fn physical_production_child_readiness_no_network_fixture() {
        let host = std::env::var_os("CLACK_TF4_NATIVE_PROBE_HOST")
            .map(PathBuf::from)
            .expect("a specifically built native production host executable is required");
        let expected = format!(
            "{:x}",
            Sha256::digest(std::fs::read(&host).expect("read exact built host for digest"))
        );
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let workspace = manifest.parent().expect("manifest under project root");
        let private = manifest
            .join("target")
            .join("tf4-production-readiness-acceptance");
        std::fs::create_dir_all(&private).expect("create dedicated owned physical test root");
        let registry = WorkspaceRegistry::default();
        registry
            .authorize(workspace)
            .expect("authorize exact /clack workspace for test");
        let mut browser = BrowserRuntimeSession::launch(
            BrowserRuntimeStart {
                actor: "tf4-physical-probe".into(),
                session_id: "tf4-physical-probe-once".into(),
                workspace_root: workspace.to_path_buf(),
                initial_url: "https://127.0.0.1/".into(),
                private_parent: private,
                host_executable: host,
                host_sha256: expected,
            },
            &registry,
        )
        .expect(
            "actual AppContainer child launched under original Job with 0 network capabilities",
        );
        let ready = browser.verify_ready().await;
        let closed = browser.shutdown();
        assert!(
            closed.is_ok(),
            "original owned Job and UDF cleanup: {closed:?}"
        );
        assert!(
            ready.is_ok(),
            "actual native WebView2 COM readiness and process proof: {ready:?}"
        );
    }

    /// Explicitly opted-in production-mode HTTPS interception negative. The
    /// private loopback destination must be rejected by TF3 Public policy,
    /// and the parent must not count success until the child reports native
    /// COM deferral completion. No uncontrolled destination is contacted.
    /// This is not remote HTTPS success, public egress certification or E2E.
    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "explicit real Windows production TF3 private-target denial and COM terminal probe"]
    async fn physical_production_browser_https_private_denial_com_terminal() {
        // Only an owned loopback target is inspected. If port 443 is already
        // occupied, preserve the COM/TF3 denial result but explicitly report
        // native listener isolation UNAVAILABLE rather than inventing PASS.
        let owned_tcp = std::net::TcpListener::bind("127.0.0.1:443").ok();
        if let Some(listener) = owned_tcp.as_ref() {
            let positive = std::net::TcpStream::connect("127.0.0.1:443")
                .expect("ordinary parent positive control must reach owned TCP listener");
            let (accepted, _peer) = listener
                .accept()
                .expect("ordinary parent TCP positive control must be observed");
            drop(accepted);
            drop(positive);
            listener
                .set_nonblocking(true)
                .expect("bounded owned listener polling");
        } else {
            eprintln!("PRODUCTION_DIRECT_TCPV4_ISOLATION=UNAVAILABLE owned 127.0.0.1:443 busy");
        }
        let host = std::env::var_os("CLACK_TF4_NATIVE_PROBE_HOST")
            .map(PathBuf::from)
            .expect("explicitly built trusted host required");
        let digest = format!(
            "{:x}",
            Sha256::digest(std::fs::read(&host).expect("read exact test host"))
        );
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let workspace = manifest.parent().expect("approved project root");
        let private_parent = manifest
            .join("target")
            .join("tf4-production-private-denial-acceptance");
        std::fs::create_dir_all(&private_parent).expect("dedicated owned case root");
        let registry = WorkspaceRegistry::default();
        registry
            .authorize(workspace)
            .expect("authorize exact workspace");
        let mut browser = BrowserRuntimeSession::launch(
            BrowserRuntimeStart {
                actor: "tf4-physical-denial".into(),
                session_id: "tf4-physical-denial-once".into(),
                workspace_root: workspace.to_path_buf(),
                initial_url: "https://127.0.0.1/".into(),
                private_parent,
                host_executable: host,
                host_sha256: digest,
            },
            &registry,
        )
        .expect("confined production host launch");
        let result = async {
            browser.verify_ready().await?;
            let bounded = tokio::time::timeout(
                std::time::Duration::from_secs(15),
                browser.serve_one(&registry, &TfWebState::default()),
            )
            .await
            .map_err(|_| "production-private-denial-com-timeout".to_owned())??;
            Ok::<_, String>(bounded)
        }
        .await;
        let closed = browser.shutdown();
        assert!(closed.is_ok(), "job/UDF/profile cleanup: {closed:?}");
        let receipt = result.expect("actual WebView2 native resource must reach TF3");
        assert_eq!(receipt.request_id, 1);
        assert!(receipt.page_generation > 0);
        assert!(
            receipt.native_com_completed,
            "COM terminal must be attested"
        );
        assert_eq!(receipt.terminal, "denied");
        assert_eq!(receipt.bytes, 0);
        assert!(receipt
            .tf3
            .as_ref()
            .is_none_or(|r| r.terminal != "completed"));
        if let Some(listener) = owned_tcp {
            let result = listener.accept();
            assert!(
                matches!(&result, Err(e) if e.kind() == std::io::ErrorKind::WouldBlock),
                "unauthorized renderer TCP connected to owned localhost:443: {result:?}"
            );
            eprintln!("PRODUCTION_DIRECT_TCPV4_ISOLATION=PASS owned positive=1 restricted=0");
        }
    }

    /// Dedicated, explicit real WebView2 sealed-pipe observation control
    /// probe. A private HTTPS document is denied by TF3, so the result may
    /// legitimately be a DOM-unavailable denial; even then the native child
    /// must return the correctly scoped, secret-free v2 terminal. This does
    /// NOT satisfy a real accessible-name/element semantic E2E acceptance.
    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "explicit production WebView2 structural observation protocol probe"]
    async fn physical_production_dom_structure_control_after_tf3_denial() {
        let host = std::env::var_os("CLACK_TF4_NATIVE_PROBE_HOST")
            .map(PathBuf::from)
            .expect("explicit native production host required");
        let digest = format!(
            "{:x}",
            Sha256::digest(std::fs::read(&host).expect("read exact production host"))
        );
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let workspace = manifest.parent().expect("approved root");
        let private_parent = manifest
            .join("target")
            .join("tf4-production-structure-acceptance");
        std::fs::create_dir_all(&private_parent).expect("dedicated owned case root");
        let registry = WorkspaceRegistry::default();
        registry.authorize(workspace).expect("authorize workspace");
        let mut browser = BrowserRuntimeSession::launch(
            BrowserRuntimeStart {
                actor: "tf4-physical-structure".into(),
                session_id: "tf4-physical-structure-once".into(),
                workspace_root: workspace.to_path_buf(),
                initial_url: "https://127.0.0.1/structure".into(),
                private_parent,
                host_executable: host,
                host_sha256: digest,
            },
            &registry,
        )
        .expect("launch exact owned zero-cap host");
        let observed = async {
            browser.verify_ready().await?;
            let result = tokio::time::timeout(
                std::time::Duration::from_secs(15),
                browser.serve_one(&registry, &TfWebState::default()),
            )
            .await
            .map_err(|_| "production-structure-resource-deadline".to_owned())??;
            if result.terminal != "denied" || !result.native_com_completed {
                return Err("production-structure-resource-not-closed".into());
            }
            tokio::time::timeout(
                std::time::Duration::from_secs(10),
                browser.observe_structure(),
            )
            .await
            .map_err(|_| "production-structure-observation-deadline".to_owned())?
        }
        .await;
        let closed = browser.shutdown();
        assert!(
            closed.is_ok(),
            "owned process/profile/UDF cleanup: {closed:?}"
        );
        let value = observed.expect("native source/epoch-bound bounded DOM control must reply");
        assert_eq!(value.observation_id, 1);
        assert!(matches!(value.terminal.as_str(), "completed" | "denied"));
        assert!(value.visited <= 256);
        assert!(value.elements.len() <= 48);
        let serialized = serde_json::to_string(&value).unwrap();
        for forbidden in [
            "title",
            "href",
            "password",
            "accessibleName",
            "rawHtml",
            "fieldValue",
        ] {
            assert!(
                !serialized.contains(forbidden),
                "forbidden model-facing DOM value/attribute field reached parent: {forbidden}"
            );
        }
        eprintln!(
            "PRODUCTION_DOM_CONTROL={} visited={} elements={}",
            value.terminal,
            value.visited,
            value.elements.len()
        );
    }

    /// Separate real production browser negative against an owned local
    /// RFC1918 interface address, never an arbitrary LAN target. The test
    /// requires the operator to select an address physically assigned to
    /// this machine. The listener's successful bind AND positive connection
    /// establish ownership before the confined child is ever launched.
    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "explicit owned-interface RFC1918 TCPv4 production direct-network negative"]
    async fn physical_production_owned_rfc1918_denial_no_tcp_fallback() {
        let ip: std::net::Ipv4Addr = std::env::var("CLACK_TF4_OWNED_RFC1918_ADDRESS")
            .expect("UNAVAILABLE: select an address assigned to this Windows machine")
            .parse()
            .expect("explicit owned test address must be IPv4");
        let octets = ip.octets();
        assert!(
            octets[0] == 10
                || (octets[0] == 172 && (16..=31).contains(&octets[1]))
                || (octets[0] == 192 && octets[1] == 168),
            "explicit test address must be RFC1918, never an arbitrary public/LAN target"
        );
        let listener = std::net::TcpListener::bind((ip, 443))
            .expect("UNAVAILABLE: cannot bind port 443 on the exact owned local interface");
        let positive = std::net::TcpStream::connect((ip, 443))
            .expect("owned parent positive control must reach exact listener");
        let (accepted, _peer) = listener.accept().expect("owned positive control observed");
        drop(accepted);
        drop(positive);
        listener
            .set_nonblocking(true)
            .expect("bounded owned listener read");

        let host = std::env::var_os("CLACK_TF4_NATIVE_PROBE_HOST")
            .map(PathBuf::from)
            .expect("explicit exact native host build required");
        let digest = format!(
            "{:x}",
            Sha256::digest(std::fs::read(&host).expect("exact built host"))
        );
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let workspace = manifest.parent().expect("approved root");
        let private_parent = manifest
            .join("target")
            .join("tf4-production-owned-rfc1918-acceptance");
        std::fs::create_dir_all(&private_parent).expect("scoped evidence root");
        let registry = WorkspaceRegistry::default();
        registry
            .authorize(workspace)
            .expect("authorize exact workspace");
        let mut browser = BrowserRuntimeSession::launch(
            BrowserRuntimeStart {
                actor: "tf4-physical-owned-rfc1918".into(),
                session_id: "tf4-physical-owned-rfc1918-once".into(),
                workspace_root: workspace.to_path_buf(),
                initial_url: format!("https://{ip}/"),
                private_parent,
                host_executable: host,
                host_sha256: digest,
            },
            &registry,
        )
        .expect("owned zero-network-capability production host launch");
        let outcome = async {
            browser.verify_ready().await?;
            tokio::time::timeout(
                std::time::Duration::from_secs(15),
                browser.serve_one(&registry, &TfWebState::default()),
            )
            .await
            .map_err(|_| "production-owned-rfc1918-com-timeout".to_owned())?
        }
        .await;
        let cleanup = browser.shutdown();
        assert!(
            cleanup.is_ok(),
            "original owned Job/UDF/profile cleanup: {cleanup:?}"
        );
        let receipt = outcome.expect("TF3 must deny actual native HTTPS request");
        assert_eq!(receipt.terminal, "denied");
        assert!(receipt.native_com_completed);
        assert!(receipt.page_generation > 0);
        assert_eq!(receipt.bytes, 0);
        assert!(receipt
            .tf3
            .as_ref()
            .is_none_or(|r| r.terminal != "completed"));
        let unauthorized = listener.accept();
        assert!(
            matches!(&unauthorized, Err(err) if err.kind() == std::io::ErrorKind::WouldBlock),
            "restricted browser reached independently owned RFC1918 TCP listener: {unauthorized:?}"
        );
        eprintln!("PRODUCTION_OWNED_RFC1918_TCPV4_DENIAL=PASS ordinary_positive=1 restricted=0");
    }

    /// Explicit positive public-HTTPS qualification of the *production* owner,
    /// not the fixture network policy. Uses only IANA documentation domains,
    /// no credentials, no form writes and no alternate HTTP client. A TF3
    /// denial/network failure is a real failure, not a fixture-equivalent PASS.
    /// The active AppContainer has zero generic network capabilities and the
    /// first WebView2 document must finish its actual COM deferral before any
    /// DOM result can be accepted. This alone is not the full interactive E2E.
    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "opt-in physical production positive public HTTPS/COM/document DOM probe"]
    async fn physical_production_allowed_https_document_and_dom() {
        let target = std::env::var("CLACK_TF4_POSITIVE_HTTPS_URL")
            .expect("explicit HTTPS documentation target opt-in required");
        assert!(
            matches!(
                target.as_str(),
                "https://example.com/" | "https://example.org/"
            ),
            "only static IANA documentation origins may be contacted by this physical probe"
        );
        let host = std::env::var_os("CLACK_TF4_NATIVE_PROBE_HOST")
            .map(PathBuf::from)
            .expect("exact production host executable required");
        let digest = format!(
            "{:x}",
            Sha256::digest(std::fs::read(&host).expect("read exact production host"))
        );
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let workspace = manifest
            .parent()
            .expect("workspace parent of native manifest");
        let private_parent = manifest
            .join("target")
            .join("tf4-production-positive-https-acceptance");
        std::fs::create_dir_all(&private_parent).expect("dedicated positive test private parent");
        let registry = WorkspaceRegistry::default();
        registry
            .authorize(workspace)
            .expect("authorize exact workspace");
        let mut browser = BrowserRuntimeSession::launch(
            BrowserRuntimeStart {
                actor: "tf4-physical-positive".into(),
                session_id: "tf4-physical-positive-once".into(),
                workspace_root: workspace.to_path_buf(),
                initial_url: target.clone(),
                private_parent,
                host_executable: host,
                host_sha256: digest,
            },
            &registry,
        )
        .expect("physical production AppContainer launch");
        let outcome = async {
            browser.verify_ready().await?;
            let resource = tokio::time::timeout(
                std::time::Duration::from_secs(17),
                browser.serve_one(&registry, &TfWebState::default()),
            )
            .await
            .map_err(|_| "positive-https-com-deadline".to_owned())??;
            eprintln!(
                "PRODUCTION_POSITIVE_HTTPS_RESOURCE terminal={} reason={} bytes={} native_com={} tf3_terminal={} tf3_reason={} tls={} dns_hops={}",
                resource.terminal,
                resource.reason,
                resource.bytes,
                resource.native_com_completed,
                resource.tf3.as_ref().map_or("none", |r| r.terminal),
                resource.tf3.as_ref().map_or("none", |r| r.reason_code),
                resource.tf3.as_ref().map_or("none", |r| r.tls_state),
                resource.tf3.as_ref().map_or(0, |r| r.dns_evidence.len()),
            );
            if resource.terminal != "completed"
                || !resource.native_com_completed
                || resource.bytes == 0
                || resource.tf3.as_ref().is_none_or(|r| {
                    r.terminal != "completed"
                        || r.reason_code != "ok"
                        || r.tls_state != "https_transport_observed"
                        || r.content_type.as_deref().is_none_or(|mime| {
                            !mime.starts_with("text/html")
                        })
                        || r.dns_evidence.is_empty()
                        || r.dns_evidence.iter().any(|d| d.classification != "all-allowed")
                })
            {
                return Err("positive-production-tf3-https-document-not-completed".into());
            }
            let dom = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                browser.observe_structure(),
            )
            .await
            .map_err(|_| "positive-https-structural-observation-deadline".to_owned())??;
            eprintln!(
                "PRODUCTION_POSITIVE_HTTPS_DOM terminal={} reason={} visited={} elements={} generation={}",
                dom.terminal,
                dom.reason,
                dom.visited,
                dom.elements.len(),
                dom.page_generation
            );
            if dom.terminal != "completed" || dom.visited == 0 || dom.elements.is_empty() {
                return Err("positive-production-webview2-document-not-observed".into());
            }
            Ok::<_, String>((resource, dom))
        }
        .await;
        let cleanup = browser.shutdown();
        assert!(
            cleanup.is_ok(),
            "owned process/Job/UDF/profile cleanup: {cleanup:?}"
        );
        let (resource, dom) = outcome.expect("real production HTTPS document must render");
        assert_eq!(resource.page_generation, dom.page_generation);
        eprintln!("PRODUCTION_POSITIVE_HTTPS_DOCUMENT=PASS TF3 HTTPS COM DOM Job UDF");
    }

    /// Controlled HTTPS alternative when public egress is unavailable. This
    /// uses the *production* AppContainer, WebView2 and native COM broker; only
    /// the Rust test binary receives a scoped TF3 owned-127.0.0.1 exception and
    /// an ephemeral public trust anchor. No release code, host, or general
    /// network policy can use that exception. A separate strictly-owned TLS
    /// fixture must be listening at 127.0.0.1:443 with a matching certificate.
    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "explicit scoped HTTPS fixture with real production WebView2/TF3 COM path"]
    async fn physical_production_owned_https_document_resources_and_dom() {
        let host = std::env::var_os("CLACK_TF4_NATIVE_PROBE_HOST")
            .map(PathBuf::from)
            .expect("exact feature-enabled production host required");
        let digest = format!(
            "{:x}",
            Sha256::digest(std::fs::read(&host).expect("read exact production host"))
        );
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let evidence_dir = manifest.join("target").join("tf4-owned-https");
        let expected_cert = evidence_dir.join("server.cer");
        let supplied_cert = std::env::var_os("CLACK_TF4_OWNED_HTTPS_CERT")
            .map(PathBuf::from)
            .expect("explicit owned HTTPS public certificate is required");
        assert_eq!(
            std::fs::canonicalize(&supplied_cert).expect("owned public cert available"),
            std::fs::canonicalize(&expected_cert).expect("expected exact cert file"),
            "only the owned acceptance public certificate is permitted"
        );
        let cert = reqwest::Certificate::from_der(
            &std::fs::read(&expected_cert).expect("read the temporary public TLS cert"),
        )
        .expect("valid DER public certificate");
        let private_parent = manifest
            .join("target")
            .join("tf4-production-owned-https-acceptance");
        std::fs::create_dir_all(&private_parent).expect("create exact owned browser parent");
        let workspace = manifest.parent().expect("approved project root");
        let registry = WorkspaceRegistry::default();
        registry
            .authorize(workspace)
            .expect("approve only workspace");
        let web = TfWebState::default();
        let mut browser = BrowserRuntimeSession::launch(
            BrowserRuntimeStart {
                actor: "tf4-owned-https".into(),
                session_id: "tf4-owned-https-once".into(),
                workspace_root: workspace.to_path_buf(),
                initial_url: "https://127.0.0.1/".into(),
                private_parent,
                host_executable: host,
                host_sha256: digest,
            },
            &registry,
        )
        .expect("real zero-network-capability production AppContainer launch");
        let outcome = async {
            browser.verify_ready().await?;
            let mut paths = std::collections::HashSet::<String>::new();
            let mut generation = None;
            // The real production host intentionally disables untrusted
            // remote JavaScript until effect classification/approval exists.
            // Read-only acceptance proves HTML, CSS, PNG and font, each via
            // a new TF3 token and a completed native COM deferral.
            for expected_id in 1..=4u64 {
                let resource = tokio::time::timeout(
                    std::time::Duration::from_secs(17),
                    browser.serve_one_owned_https_for_test(&registry, &web, &cert),
                )
                .await
                .map_err(|_| "owned-https-native-resource-deadline".to_owned())??;
                let tf3 = resource.tf3.as_ref().ok_or("owned-https-tf3-receipt-missing")?;
                eprintln!(
                    "PRODUCTION_OWNED_HTTPS_RESOURCE id={} terminal={} tf3={} reason={} tls={} bytes={} com={} dns_hops={}",
                    resource.request_id,
                    resource.terminal,
                    tf3.terminal,
                    tf3.reason_code,
                    tf3.tls_state,
                    resource.bytes,
                    resource.native_com_completed,
                    tf3.dns_evidence.len(),
                );
                if resource.request_id != expected_id
                    || resource.terminal != "completed"
                    || !resource.native_com_completed
                    || resource.bytes == 0
                    || tf3.terminal != "completed"
                    || tf3.reason_code != "ok"
                    || tf3.tls_state != "https_transport_observed"
                    || tf3.truncated
                    || tf3.content_sha256.as_deref().is_none_or(|s| s.len() != 64)
                    || tf3.dns_evidence.is_empty()
                    || tf3.dns_evidence.iter().any(|d| {
                        d.host != "127.0.0.1" || d.classification != "all-allowed"
                    })
                {
                    return Err("owned-https-tf3-com-or-ssl-delivery-failed".into());
                }
                if generation.is_some_and(|g| g != resource.page_generation) {
                    return Err("owned-https-generation-changed".into());
                }
                generation = Some(resource.page_generation);
                let requested = tf3
                    .requested_url
                    .as_deref()
                    .ok_or("owned-https-request-url-missing")?;
                let uri = reqwest::Url::parse(requested)
                    .map_err(|_| "owned-https-request-url-invalid")?;
                let owned_origin = reqwest::Url::parse("https://127.0.0.1/").unwrap().origin();
                if uri.origin() != owned_origin
                    || tf3
                        .final_url
                        .as_deref()
                        .and_then(|url| reqwest::Url::parse(url).ok())
                        .is_none_or(|final_url| final_url.origin() != owned_origin)
                {
                    return Err("owned-https-origin-escaped".into());
                }
                let expected_mime = match uri.path() {
                    "/" => "text/html",
                    "/page.css" => "text/css",
                    "/page.js" => return Err("owned-https-untrusted-script-not-disabled".into()),
                    "/pixel.png" => "image/png",
                    "/font.woff2" => "font/woff2",
                    _ => return Err("owned-https-unexpected-browser-resource".into()),
                };
                if checked_mime(tf3.content_type.as_deref()) != Some(expected_mime) {
                    return Err("owned-https-resource-content-type-mismatch".into());
                }
                if uri.path() == "/page.css" {
                    if tf3.redirect_chain.len() != 1
                        || tf3.redirect_chain[0] != "https://127.0.0.1/page.css"
                        || tf3.final_url.as_deref() != Some("https://127.0.0.1/style.css")
                        || tf3.dns_evidence.len() != 2
                    {
                        return Err("owned-https-same-origin-css-redirect-not-revalidated".into());
                    }
                } else if !tf3.redirect_chain.is_empty() {
                    return Err("owned-https-unexpected-redirect".into());
                }
                paths.insert(uri.path().to_owned());
            }
            for expected in ["/", "/page.css", "/pixel.png", "/font.woff2"] {
                if !paths.contains(expected) {
                    return Err("owned-https-required-dependent-resource-not-delivered".into());
                }
            }
            let dom = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                browser.observe_structure(),
            )
            .await
            .map_err(|_| "owned-https-dom-observation-timeout".to_owned())??;
            if dom.terminal != "completed"
                || dom.elements.is_empty()
                || dom.visited == 0
                || Some(dom.page_generation) != generation
            {
                return Err("owned-https-rendered-dom-not-verified".into());
            }
            eprintln!(
                "PRODUCTION_OWNED_HTTPS_DOM=PASS visited={} elements={} generation={}",
                dom.visited,
                dom.elements.len(),
                dom.page_generation
            );
            Ok::<_, String>(())
        }
        .await;
        let cleanup = browser.shutdown();
        assert!(cleanup.is_ok(), "real Job/UDF/profile cleanup: {cleanup:?}");
        outcome.expect("real production COM must receive all owned HTTPS resources and DOM");
        eprintln!(
            "PRODUCTION_OWNED_HTTPS_READ_ONLY=PASS four native COM resources, TF3 TLS, structural DOM, owned Job/UDF; UNTRUSTED_JAVASCRIPT=DISABLED"
        );
    }
}
