//! Acceptance-only real Windows WebView2 host for TF4 network isolation.
//! Build with --features tf-browser-isolation-acceptance --bin clack-browser-host.
//! The acceptance launcher must create a fresh case root and supply a listener.
//! Isolated mode requires an AppContainer token with zero capabilities.
//! Positive-control mode renders identical HTML with the ordinary caller token.
//! Both modes permit network references ONLY to the loopback fixture listener.

#[cfg(not(windows))]
fn main() {
    eprintln!("clack-browser-host is Windows acceptance-only");
    std::process::exit(1);
}

#[cfg(windows)]
mod host {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
    use serde::{Deserialize, Serialize};
    use serde_json::json;
    use std::cell::RefCell;
    use std::collections::{BTreeMap, HashSet};
    use std::error::Error;
    use std::ffi::OsString;
    use std::fs;
    use std::fs::{File, OpenOptions};
    use std::io::{self, Read, Write};
    use std::mem::{size_of, zeroed};
    use std::os::windows::{
        ffi::OsStringExt,
        io::{AsRawHandle, FromRawHandle},
    };
    use std::path::{Path, PathBuf};
    use std::ptr::null_mut;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::{mpsc, Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
    use tauri::{webview::PageLoadEvent, WebviewUrl, WebviewWindowBuilder};
    use webview2_com::{
        take_pwstr, BrowserProcessExitedEventHandler, CallDevToolsProtocolMethodCompletedHandler,
        ExecuteScriptCompletedHandler, Microsoft::Web::WebView2::Win32::*,
        NavigationStartingEventHandler, ProcessFailedEventHandler,
        WebResourceRequestedEventHandler,
    };
    use windows::{
        core::{Interface, HSTRING, PWSTR},
        Win32::UI::Shell::SHCreateMemStream,
    };
    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, LocalFree, SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT,
        HLOCAL, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows_sys::Win32::Security::{
        GetTokenInformation, TokenAppContainerSid, TokenCapabilities, TokenIsAppContainer,
        TOKEN_APPCONTAINER_INFORMATION, TOKEN_GROUPS, TOKEN_QUERY,
    };
    use windows_sys::Win32::Storage::FileSystem::{GetFileType, FILE_TYPE_PIPE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Pipes::PeekNamedPipe;
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    const WATCHDOG: Duration = Duration::from_secs(16);
    // Fixture-only parent OS-role acknowledgement, not a browser authority.
    const PHASE_A_OS_BROWSER_ACK_FILE: &str = "parent-os-browser-proven.ack";
    const PHASE_A_OS_BROWSER_ACK_BYTES: &[u8] = b"independent-os-browser-token-job-proven\n";
    const RENDER_MARKER: &str = "clack-renderer-js-";
    const STARTUP_LOG_LIMIT: usize = 32 * 1024;
    const STARTUP_FIELD_LIMIT: usize = 384;
    const BROKER_FRAME_LIMIT: usize = 128 * 1024;
    const BROKER_QUEUE_LIMIT: usize = 32;
    // The parent has a bounded TF3 fetch; a dead parent or missing reply must
    // not leave a pending COM deferral blocked until process teardown.
    const BROKER_REPLY_DEADLINE: Duration = Duration::from_secs(9);
    const BROKER_FAULT_DEADLINE: Duration = Duration::from_millis(900);
    const SEMANTIC_MAX_VISITS: u32 = 512;
    const SEMANTIC_MAX_ELEMENTS: usize = 64;
    const SEMANTIC_MAX_LABEL_CHARS: usize = 200;
    const SEMANTIC_MAX_TEXT_BYTES: usize = 32 * 1024;
    const SEMANTIC_MAX_JSON_BYTES: usize = 64 * 1024;
    // Fixed acceptance-only semantic-lite script. It never reads input values,
    // cookies, localStorage, HTML markup, arbitrary selectors, or page scripts.
    // This is a bounded DOM summary, NOT an accessibility-tree attestation.
    // The synchronous loop is bounded before serializing or returning to COM.
    const SEMANTIC_SNAPSHOT_JS: &str = r#"(() => {
      'use strict';
      const maxVisits = 512, maxElements = 64, maxTextBytes = 32768;
      const result = { version: 1, url: String(location.href).slice(0, 2048),
        title: String(document.title).slice(0, 128), visited: 0,
        textBytes: 0, truncated: false, elements: [] };
      const roles = Object.freeze({
        MAIN: 'main', NAV: 'navigation', ARTICLE: 'article',
        H1: 'heading', H2: 'heading', H3: 'heading',
        A: 'link', BUTTON: 'button', IMG: 'img',
        P: 'paragraph', LI: 'listitem', LABEL: 'label',
        INPUT: 'input', SELECT: 'select', TEXTAREA: 'textbox'
      });
      const encoder = new TextEncoder();
      if (!document.body) return result;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let node = walker.currentNode;
      while (node && result.visited < maxVisits) {
        ++result.visited;
        const role = roles[node.tagName];
        if (role) {
          if (node.tagName === 'INPUT') {
            const type = (node.getAttribute('type') || 'text').slice(0, 16).toLowerCase();
            if (!['button','submit','reset','checkbox','radio'].includes(type)) {
              node = walker.nextNode();
              continue;
            }
          }
          if (result.elements.length >= maxElements) {
            result.truncated = true;
            break;
          }
          const directText = node.firstChild && node.firstChild.nodeType === 3
            ? node.firstChild.nodeValue : '';
          const rawName = node.getAttribute('aria-label') ||
            node.getAttribute('alt') || directText || '';
          const sample = String(rawName).slice(0, 220);
          const name = sample.replace(/[\u0000-\u001f\u007f]/g, ' ')
            .replace(/\s+/g, ' ').trim().slice(0, 200);
          if (String(rawName).length > 200) result.truncated = true;
          const nextBytes = encoder.encode(name).length;
          if (result.textBytes + nextBytes > maxTextBytes) {
            result.truncated = true;
            break;
          }
          result.textBytes += nextBytes;
          result.elements.push({ index: result.visited, role, name });
        }
        node = walker.nextNode();
      }
      if (node) result.truncated = true;
      return result;
    })()"#;

    struct StartupTrace {
        start: Instant,
        output: Mutex<StartupOutput>,
    }

    #[derive(Default)]
    struct StartupOutput {
        file: Option<File>,
        written: usize,
    }

    // Startup and panic diagnostics intentionally never include command-line
    // values, environment values, paths, URLs, or fixture nonce material.
    fn safe_detail(detail: &str) -> String {
        let mut text = String::new();
        let mut words = detail.split_whitespace();
        for word in words.by_ref().take(48) {
            let unquoted = word.trim_matches(|c: char| !c.is_ascii_alphanumeric());
            let long_hex = unquoted.len() > 20 && unquoted.bytes().all(|c| c.is_ascii_hexdigit());
            let suspicious = word.len() > 96
                || long_hex
                || word.contains(RENDER_MARKER)
                || word.contains("webview2-")
                || word.chars().any(|c| {
                    matches!(
                        c,
                        '/' | '\\' | '@' | '=' | '%' | '$' | '?' | '&' | '<' | '>'
                    ) || !c.is_ascii_graphic()
                })
                || [
                    "nonce",
                    "secret",
                    "password",
                    "bearer",
                    "token",
                    "credential",
                    "apikey",
                ]
                .iter()
                .any(|s| word.to_ascii_lowercase().contains(s));
            let clean = if suspicious { "[redacted]" } else { word };
            if text.len() + clean.len() + 1 > STARTUP_FIELD_LIMIT {
                text.push_str(" [truncated]");
                break;
            }
            if !text.is_empty() {
                text.push(' ');
            }
            text.push_str(clean);
        }
        if words.next().is_some() {
            text.push_str(" [truncated]");
        }
        text
    }

    fn error_chain(error: &(dyn Error + 'static)) -> String {
        let mut parts = Vec::with_capacity(4);
        let mut next = Some(error);
        for _ in 0..4 {
            let Some(current) = next else { break };
            parts.push(current.to_string());
            next = current.source();
        }
        parts.join(" caused-by ")
    }

    impl StartupTrace {
        fn new() -> Self {
            Self {
                start: Instant::now(),
                output: Mutex::new(StartupOutput::default()),
            }
        }

        fn record(&self, stage: &'static str, detail: &str) {
            let event = format!(
                "clack-browser-host-startup pid={} elapsedMs={} stage={stage} {}\n",
                std::process::id(),
                self.start.elapsed().as_millis(),
                safe_detail(detail)
            );
            let _ = io::stderr().write_all(event.as_bytes());
            let mut recorded = false;
            if let Ok(mut output) = self.output.try_lock() {
                if output.written + event.len() <= STARTUP_LOG_LIMIT {
                    if let Some(file) = output.file.as_mut() {
                        recorded = file.write_all(event.as_bytes()).is_ok() && file.flush().is_ok();
                        if recorded {
                            output.written += event.len();
                        }
                    }
                }
            }
            if !recorded {
                let _ = io::stdout().write_all(event.as_bytes());
            }
        }

        fn error(&self, stage: &'static str, detail: &str) {
            self.record(stage, detail);
        }

        fn attach_case_root(&self, root: &Path) {
            let clock = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let mut last_error = None;
            for attempt in 0..8 {
                let file_name = format!(
                    "browser-host-startup-{}-{clock:x}-{attempt}.log",
                    std::process::id()
                );
                match OpenOptions::new()
                    .create_new(true)
                    .write(true)
                    .open(root.join(file_name))
                {
                    Ok(file) => {
                        if let Ok(mut output) = self.output.lock() {
                            output.file = Some(file);
                        }
                        self.record("case.log.ready", "unique per-process log opened");
                        return;
                    }
                    Err(e) => last_error = Some(e),
                }
            }
            if let Some(e) = last_error {
                self.error("case.log.unavailable", &io_error(&e));
            }
        }

        fn panic(&self, info: &std::panic::PanicHookInfo<'_>) {
            let payload = info
                .payload()
                .downcast_ref::<&str>()
                .copied()
                .or_else(|| info.payload().downcast_ref::<String>().map(String::as_str))
                .unwrap_or("non-string panic payload");
            let location = info.location().map_or("unknown".to_owned(), |location| {
                let name = location
                    .file()
                    .rsplit(&['/', '\\'][..])
                    .next()
                    .unwrap_or("unknown");
                format!("{name}:{}:{}", location.line(), location.column())
            });
            self.record("panic", &format!("location {location} payload {payload}"));
        }
    }

    fn io_error(error: &io::Error) -> String {
        format!(
            "kind {:?} osCode {:?} detail {}",
            error.kind(),
            error.raw_os_error(),
            error
        )
    }

    struct Handle(HANDLE);
    impl Handle {
        fn new(value: HANDLE) -> Result<Self, String> {
            if value.is_null() || value == INVALID_HANDLE_VALUE {
                Err(format!("Win32 handle error {}", unsafe { GetLastError() }))
            } else {
                Ok(Self(value))
            }
        }
    }
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }

    #[derive(Serialize, Clone)]
    #[serde(rename_all = "camelCase")]
    struct TokenDetails {
        app_container: bool,
        app_container_sid: Option<String>,
        capability_sids: Vec<String>,
    }

    #[derive(Serialize, Clone)]
    #[serde(rename_all = "camelCase")]
    struct ProcessRecord {
        pid: u32,
        parent_pid: u32,
        image_name: String,
        token: Option<TokenDetails>,
        token_error: Option<String>,
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Mode {
        Isolated,
        PositiveControl,
        Brokered,
    }
    #[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
    enum BrokerFault {
        #[default]
        None,
        MissingIntercept,
        MissingReply,
        Crash,
        Timeout,
        Cancel,
        StaleId,
        StaleSession,
        AbnormalExit,
        PageRace,
        DuplicateParent,
        DuplicateLate,
        DependentDrain,
        CancelPending,
        RendererCrashPending,
        BrowserCrashPending,
        HostExitPending,
        ShutdownPending,
    }
    impl BrokerFault {
        fn parse(value: &str) -> Result<Self, String> {
            match value {
                "none" => Ok(Self::None),
                "no-intercept" | "missing-intercept" => Ok(Self::MissingIntercept),
                "missing-reply" => Ok(Self::MissingReply),
                "crash" => Ok(Self::Crash),
                "timeout" => Ok(Self::Timeout),
                "cancel" => Ok(Self::Cancel),
                "stale-id" => Ok(Self::StaleId),
                "stale-session" => Ok(Self::StaleSession),
                "abnormal-exit" => Ok(Self::AbnormalExit),
                "page-race" | "stale-page-generation" => Ok(Self::PageRace),
                "duplicate-parent" | "stale-broker-request" => Ok(Self::DuplicateParent),
                "duplicate-late" | "duplicate-completion" => Ok(Self::DuplicateLate),
                "dependent-drain" | "dependent-resource" => Ok(Self::DependentDrain),
                "cancel-pending" | "pending-cancel" => Ok(Self::CancelPending),
                "renderer-crash-pending" | "renderer-crash" => Ok(Self::RendererCrashPending),
                "browser-crash-pending" => Ok(Self::BrowserCrashPending),
                "host-exit-pending" | "host-crash" => Ok(Self::HostExitPending),
                "shutdown-pending" => Ok(Self::ShutdownPending),
                _ => Err("unsupported acceptance broker fault".to_owned()),
            }
        }

        fn label(self) -> &'static str {
            match self {
                Self::None => "none",
                Self::MissingIntercept => "no-intercept",
                Self::MissingReply => "missing-reply",
                Self::Crash => "crash",
                Self::Timeout => "timeout",
                Self::Cancel => "cancel",
                Self::StaleId => "stale-id",
                Self::StaleSession => "stale-session",
                Self::AbnormalExit => "abnormal-exit",
                Self::PageRace => "stale-page-generation",
                Self::DuplicateParent => "stale-broker-request",
                Self::DuplicateLate => "duplicate-completion",
                Self::DependentDrain => "dependent-resource",
                Self::CancelPending => "pending-cancel",
                Self::RendererCrashPending => "renderer-crash",
                Self::BrowserCrashPending => "browser-crash-pending",
                Self::HostExitPending => "host-crash",
                Self::ShutdownPending => "shutdown-pending",
            }
        }

        fn reply_deadline(self) -> Duration {
            if matches!(
                self,
                Self::MissingReply | Self::Crash | Self::Timeout | Self::DuplicateParent
            ) {
                BROKER_FAULT_DEADLINE
            } else {
                BROKER_REPLY_DEADLINE
            }
        }
        fn is_phase_a(self) -> bool {
            matches!(
                self,
                Self::PageRace
                    | Self::DuplicateParent
                    | Self::DuplicateLate
                    | Self::DependentDrain
                    | Self::CancelPending
                    | Self::RendererCrashPending
                    | Self::BrowserCrashPending
                    | Self::HostExitPending
                    | Self::ShutdownPending
            )
        }
        fn awaits_actual_renderer_failure(self, has_pending: bool, process_failed: bool) -> bool {
            self == Self::RendererCrashPending && has_pending && !process_failed
        }
        fn awaits_parent_os_browser_proof(self) -> bool {
            matches!(self, Self::CancelPending | Self::ShutdownPending)
        }
    }
    struct Args {
        mode: Mode,
        root: PathBuf,
        fixture_port: u16,
        nonce: String,
        broker_fault: BrokerFault,
    }
    fn args() -> Result<Args, String> {
        let argv: Vec<OsString> = std::env::args_os().collect();
        if argv.len() < 7 {
            return Err("expected --isolated-child|--positive-control|--brokered-child <absolute-root> --fixture-port <u16> --fixture-nonce <32-64 hex> [--broker-fault <mode>]".into());
        }
        let mode = match argv[1].to_str() {
            Some("--isolated-child") => Mode::Isolated,
            Some("--positive-control") => Mode::PositiveControl,
            Some("--brokered-child") => Mode::Brokered,
            _ => return Err("unsupported mode".into()),
        };
        let broker_fault = match (mode, argv.len()) {
            (Mode::Brokered, 9) if argv[7] == "--broker-fault" => {
                BrokerFault::parse(argv[8].to_str().ok_or("invalid broker fault encoding")?)?
            }
            (_, 7) => BrokerFault::None,
            _ => {
                return Err(
                    "--broker-fault requires --brokered-child and an exact known mode".into(),
                )
            }
        };
        if argv[3] != "--fixture-port" || argv[5] != "--fixture-nonce" {
            return Err("missing required fixture arguments".into());
        }
        let root = PathBuf::from(&argv[2]);
        if !root.is_absolute()
            || !root.is_dir()
            || root
                .symlink_metadata()
                .map_err(|e| e.to_string())?
                .file_type()
                .is_symlink()
        {
            return Err("case root must exist as an absolute real directory".into());
        }
        let root = root.canonicalize().map_err(|e| format!("case root: {e}"))?;
        let fixture_port = argv[4]
            .to_str()
            .ok_or("invalid port encoding")?
            .parse::<u16>()
            .map_err(|_| "invalid port")?;
        if fixture_port == 0 {
            return Err("fixture port zero is forbidden".into());
        }
        let nonce = argv[6].to_str().ok_or("invalid nonce encoding")?.to_owned();
        if !(32..=64).contains(&nonce.len()) || !nonce.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err("nonce must be 32-64 hexadecimal characters".into());
        }
        Ok(Args {
            mode,
            root,
            fixture_port,
            nonce,
            broker_fault,
        })
    }

    fn sid_string(sid: *mut core::ffi::c_void) -> Result<String, String> {
        if sid.is_null() {
            return Err("null SID".into());
        }
        let mut raw: *mut u16 = null_mut();
        if unsafe { ConvertSidToStringSidW(sid, &mut raw) } == 0 {
            return Err(format!("ConvertSidToStringSidW: {}", unsafe {
                GetLastError()
            }));
        }
        let mut length = 0;
        unsafe {
            while *raw.add(length) != 0 {
                length += 1;
            }
        }
        let text = unsafe { String::from_utf16_lossy(std::slice::from_raw_parts(raw, length)) };
        unsafe {
            LocalFree(raw as HLOCAL);
        }
        Ok(text)
    }

    // Keep pointer-bearing Windows token structures in aligned, owned memory
    // until their embedded SID pointers have been converted.
    fn token_info(handle: HANDLE, field: i32) -> Result<Vec<u64>, String> {
        let mut bytes = 0;
        unsafe {
            GetTokenInformation(handle, field, null_mut(), 0, &mut bytes);
        }
        if bytes == 0 || bytes > 65536 {
            return Err(format!(
                "GetTokenInformation field={field} size failure {}",
                unsafe { GetLastError() }
            ));
        }
        let mut buffer = vec![0u64; (bytes as usize).div_ceil(8)];
        if unsafe {
            GetTokenInformation(handle, field, buffer.as_mut_ptr().cast(), bytes, &mut bytes)
        } == 0
        {
            return Err(format!("GetTokenInformation field={field}: {}", unsafe {
                GetLastError()
            }));
        }
        Ok(buffer)
    }

    fn token_details(handle: HANDLE) -> Result<TokenDetails, String> {
        let is_container = token_info(handle, TokenIsAppContainer)?;
        let app_container = is_container[0] as u32 != 0;
        let app_container_sid = if app_container {
            let info = token_info(handle, TokenAppContainerSid)?;
            let sid = unsafe {
                (*(info.as_ptr().cast::<TOKEN_APPCONTAINER_INFORMATION>())).TokenAppContainer
            };
            Some(sid_string(sid)?)
        } else {
            None
        };
        let caps = token_info(handle, TokenCapabilities)?;
        let groups = unsafe { &*(caps.as_ptr().cast::<TOKEN_GROUPS>()) };
        if groups.GroupCount > 256 {
            return Err("unexpected token capability count".into());
        }
        let mut capability_sids = Vec::new();
        for i in 0..groups.GroupCount as usize {
            let sid = unsafe { (*groups.Groups.as_ptr().add(i)).Sid };
            capability_sids.push(sid_string(sid)?);
        }
        Ok(TokenDetails {
            app_container,
            app_container_sid,
            capability_sids,
        })
    }

    fn process_token(pid: u32) -> Result<TokenDetails, String> {
        let proc_handle =
            Handle::new(unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) })?;
        let mut raw = null_mut();
        if unsafe { OpenProcessToken(proc_handle.0, TOKEN_QUERY, &mut raw) } == 0 {
            return Err(format!("OpenProcessToken {pid}: {}", unsafe {
                GetLastError()
            }));
        }
        let token = Handle::new(raw)?;
        token_details(token.0)
    }

    fn own_token() -> Result<TokenDetails, String> {
        let mut raw = null_mut();
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut raw) } == 0 {
            return Err(format!("OpenProcessToken current: {}", unsafe {
                GetLastError()
            }));
        }
        let token = Handle::new(raw)?;
        token_details(token.0)
    }

    fn own_parent_pid() -> Result<u32, String> {
        let snapshot = Handle::new(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) })?;
        let mut entry: PROCESSENTRY32W = unsafe { zeroed() };
        entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        let mut ok = unsafe { Process32FirstW(snapshot.0, &mut entry) };
        while ok != 0 {
            if entry.th32ProcessID == std::process::id() {
                return Ok(entry.th32ParentProcessID);
            }
            ok = unsafe { Process32NextW(snapshot.0, &mut entry) };
        }
        Err("process absent from ToolHelp snapshot".into())
    }

    fn udf_access_probe(udf: &Path, trace: &StartupTrace) -> io::Result<()> {
        let probe = udf.join(".clack-host-access-probe");
        trace.record("udf.probe.create.begin", "opening a new UDF probe file");
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&probe)
            .map_err(|e| {
                trace.error("udf.probe.create.failed", &io_error(&e));
                e
            })?;
        trace.record("udf.probe.create.ok", "UDF probe file created");
        let result = (|| {
            trace.record("udf.probe.write.begin", "writing UDF probe bytes");
            file.write_all(b"clack acceptance access probe\n")
                .map_err(|e| {
                    trace.error("udf.probe.write.failed", &io_error(&e));
                    e
                })?;
            trace.record("udf.probe.write.ok", "UDF probe bytes written");
            trace.record("udf.probe.flush.begin", "flushing UDF probe bytes");
            file.flush().map_err(|e| {
                trace.error("udf.probe.flush.failed", &io_error(&e));
                e
            })?;
            trace.record("udf.probe.flush.ok", "UDF probe bytes flushed");
            trace.record("udf.probe.read.begin", "reading UDF probe bytes");
            fs::read(&probe).map_err(|e| {
                trace.error("udf.probe.read.failed", &io_error(&e));
                e
            })?;
            trace.record("udf.probe.read.ok", "UDF probe bytes read");
            Ok::<(), io::Error>(())
        })();
        drop(file);
        trace.record("udf.probe.remove.begin", "removing UDF probe file");
        let cleanup = fs::remove_file(&probe).map_err(|e| {
            trace.error("udf.probe.remove.failed", &io_error(&e));
            e
        });
        if cleanup.is_ok() {
            trace.record("udf.probe.remove.ok", "UDF probe file removed");
        }
        result?;
        cleanup
    }

    fn wide_text(raw: &[u16]) -> String {
        let len = raw.iter().position(|c| *c == 0).unwrap_or(raw.len());
        OsString::from_wide(&raw[..len])
            .to_string_lossy()
            .into_owned()
    }
    fn inventory(root: u32) -> Result<Vec<ProcessRecord>, String> {
        let snapshot = Handle::new(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) })?;
        let mut entry: PROCESSENTRY32W = unsafe { zeroed() };
        entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        let mut all = Vec::new();
        let mut ok = unsafe { Process32FirstW(snapshot.0, &mut entry) };
        while ok != 0 {
            all.push((
                entry.th32ProcessID,
                entry.th32ParentProcessID,
                wide_text(&entry.szExeFile),
            ));
            ok = unsafe { Process32NextW(snapshot.0, &mut entry) };
        }
        let mut owned = HashSet::from([root]);
        for _ in 0..all.len() {
            let mut added = false;
            for (pid, parent, _) in &all {
                if owned.contains(parent) && owned.insert(*pid) {
                    added = true;
                }
            }
            if !added {
                break;
            }
        }
        let mut result = Vec::new();
        for (pid, parent_pid, image_name) in all {
            if !owned.contains(&pid) {
                continue;
            }
            let checked = process_token(pid);
            result.push(ProcessRecord {
                pid,
                parent_pid,
                image_name,
                token: checked.as_ref().ok().cloned(),
                token_error: checked.err(),
            });
        }
        result.sort_by_key(|p| p.pid);
        Ok(result)
    }

    #[derive(Default)]
    struct Observed {
        loaded: AtomicBool,
        scripted: AtomicBool,
        processes: Mutex<BTreeMap<u32, ProcessRecord>>,
    }

    // The case fixture is immutable source code: every subresource request and
    // API is pinned to literal 127.0.0.1, with a narrow injected port and nonce.
    // The last JS action navigates to an offline fragment. Seeing that second
    // document load proves the renderer executed JavaScript, even if its
    // preceding requests are denied before reaching the loopback listener.
    fn fixture_html(port: u16, nonce: &str, mode: &str) -> String {
        format!(
            r#"<!doctype html><html><head><meta charset="utf-8">
<title>Clack WebView2 acceptance</title>
<link rel="stylesheet" href="http://127.0.0.1:{port}/css/{mode}/{nonce}">
<style>@import url('http://127.0.0.1:{port}/css-import/{mode}/{nonce}');</style>
</head><body><main id="proof">WebView2 real renderer acceptance</main>
<img src="http://127.0.0.1:{port}/image/{mode}/{nonce}" alt="">
<iframe src="http://127.0.0.1:{port}/iframe/{mode}/{nonce}"></iframe>
<script async src="http://127.0.0.1:{port}/script/{mode}/{nonce}"></script>
<script>
(()=>{{
  const base='http://127.0.0.1:{port}/', suffix='/{mode}/{nonce}';
  const target=(kind)=>base+kind+suffix;
  document.body.dataset.probe='{nonce}';
  try {{ fetch(target('fetch'),{{mode:'no-cors'}}).catch(()=>{{}}); }} catch(_e) {{}}
  try {{ let x=new XMLHttpRequest(); x.open('GET',target('xhr')); x.send(); }} catch(_e) {{}}
  try {{ let e=new EventSource(target('events')); setTimeout(()=>e.close(),1300); }} catch(_e) {{}}
  try {{ let w=new WebSocket('ws://127.0.0.1:{port}/ws'+suffix); setTimeout(()=>w.close(),1300); }} catch(_e) {{}}
  try {{ navigator.sendBeacon(target('beacon'),'synthetic'); }} catch(_e) {{}}
  try {{
    let s="fetch('http://127.0.0.1:{port}/worker/{mode}/{nonce}',{{mode:'no-cors'}}).catch(()=>{{}})";
    let w=new Worker('data:text/javascript,'+encodeURIComponent(s));
    setTimeout(()=>w.terminate(),1300);
  }} catch(_e) {{}}
  try {{
    let s="fetch('http://127.0.0.1:{port}/shared-worker/{mode}/{nonce}',{{mode:'no-cors'}}).catch(()=>{{}})";
    let w=new SharedWorker('data:text/javascript,'+encodeURIComponent(s));
    setTimeout(()=>w.port.close(),1300);
  }} catch(_e) {{}}
  try {{ navigator.serviceWorker.register(target('service-worker')); }} catch(_e) {{}}
  try {{
    let ice=new RTCPeerConnection({{iceServers:[{{urls:'stun:127.0.0.1:{port}'}}]}});
    ice.createDataChannel('probe');
    ice.createOffer().then(o=>ice.setLocalDescription(o)).catch(()=>{{}});
    setTimeout(()=>ice.close(),1600);
  }} catch(_e) {{}}
  try {{ fetch('http://localhost:{port}/localhost/{mode}/{nonce}',{{mode:'no-cors'}}).catch(()=>{{}}); }} catch(_e) {{}}
  try {{ fetch('http://2130706433:{port}/alternate-ip/{mode}/{nonce}',{{mode:'no-cors'}}).catch(()=>{{}}); }} catch(_e) {{}}
  try {{ fetch('http://[::1]:{port}/ipv6/{mode}/{nonce}',{{mode:'no-cors'}}).catch(()=>{{}}); }} catch(_e) {{}}
  // A native document-title event is an independent renderer/DOM signal.
  // about:blank does not guarantee Tauri page-load events on Windows.
  document.title='{RENDER_MARKER}{nonce}';
  setTimeout(()=>location.replace('about:blank?{RENDER_MARKER}{nonce}'),3000);
}})();
</script></body></html>"#
        )
    }
    fn report(root: &Path, value: &serde_json::Value, trace: &StartupTrace) {
        let output = value.to_string();
        println!("{output}");
        match fs::write(root.join("browser-host-report.json"), format!("{output}\n")) {
            Ok(()) => trace.record("report.write.ok", "case report written"),
            Err(e) => trace.error("report.write.failed", &io_error(&e)),
        }
    }

    #[derive(Clone, Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct SemanticElement {
        index: u32,
        role: String,
        name: String,
    }

    #[derive(Clone, Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct SemanticSnapshot {
        version: u8,
        url: String,
        title: String,
        visited: u32,
        text_bytes: usize,
        truncated: bool,
        elements: Vec<SemanticElement>,
    }

    #[derive(Clone, Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct VerifiedSemanticSnapshot {
        session: String,
        page_generation: u64,
        snapshot_generation: u64,
        observed_at_ms: u64,
        origin: String,
        session_verified: bool,
        redacted_labels: usize,
        snapshot: SemanticSnapshot,
    }

    #[derive(Default)]
    struct SemanticSnapshotState {
        requested: AtomicBool,
        finished: AtomicBool,
        proof: Mutex<Option<VerifiedSemanticSnapshot>>,
        failure: Mutex<Option<&'static str>>,
    }

    impl SemanticSnapshotState {
        fn succeed(&self, value: VerifiedSemanticSnapshot) {
            if let Ok(mut guard) = self.proof.lock() {
                *guard = Some(value);
            } else {
                self.fail("snapshot-state-unavailable");
                return;
            }
            self.finished.store(true, Ordering::Release);
        }

        fn fail(&self, reason: &'static str) {
            if let Ok(mut guard) = self.failure.lock() {
                *guard = Some(reason);
            }
            self.finished.store(true, Ordering::Release);
        }

        fn receipt(
            &self,
        ) -> (
            &'static str,
            Option<&'static str>,
            Option<VerifiedSemanticSnapshot>,
        ) {
            if !self.requested.load(Ordering::Acquire) {
                return ("not-requested", None, None);
            }
            if !self.finished.load(Ordering::Acquire) {
                return ("pending", None, None);
            }
            let proof = self.proof.lock().ok().and_then(|guard| guard.clone());
            if proof.is_some() {
                ("verified", None, proof)
            } else {
                let reason = self.failure.lock().ok().and_then(|guard| *guard);
                (
                    "rejected",
                    Some(reason.unwrap_or("snapshot-state-unavailable")),
                    None,
                )
            }
        }
    }

    fn semantic_fixture_identity(
        expected_url: &str,
        expected_title: &str,
    ) -> Result<(String, String), &'static str> {
        let (origin, nonce) = expected_url
            .rsplit_once("/document/broker/")
            .ok_or("snapshot-source-not-controlled")?;
        let port = origin
            .strip_prefix("http://127.0.0.1:")
            .and_then(|value| value.parse::<u16>().ok())
            .filter(|value| *value != 0)
            .ok_or("snapshot-origin-not-controlled")?;
        if port == 0
            || !(32..=64).contains(&nonce.len())
            || !nonce.bytes().all(|c| c.is_ascii_hexdigit())
            || expected_title != format!("{RENDER_MARKER}{nonce}")
        {
            return Err("snapshot-session-or-source-mismatch");
        }
        Ok((origin.to_owned(), nonce.to_owned()))
    }

    fn sensitive_semantic_label(name: &str) -> bool {
        // Deliberately conservative: these native-only acceptance summaries
        // are never a channel for passwords, auth headers or query tokens.
        let compact = name.to_ascii_lowercase().replace(['-', '_', ' ', '.'], "");
        [
            "token",
            "password",
            "passwd",
            "secret",
            "apikey",
            "authorization",
            "bearer",
            "cookie",
            "credential",
            "privatekey",
            "sessionid",
            "jwt",
        ]
        .iter()
        .any(|needle| compact.contains(needle))
            || name.starts_with("sk-")
    }

    fn verify_semantic_snapshot(
        raw: &str,
        expected_url: &str,
        expected_title: &str,
        request_generation: u64,
        current_generation: u64,
    ) -> Result<VerifiedSemanticSnapshot, &'static str> {
        if request_generation == 0 || request_generation != current_generation {
            return Err("snapshot-page-stale");
        }
        if raw.len() > SEMANTIC_MAX_JSON_BYTES {
            return Err("snapshot-json-over-limit");
        }
        let (origin, session) = semantic_fixture_identity(expected_url, expected_title)?;
        let mut candidate: SemanticSnapshot =
            serde_json::from_str(raw).map_err(|_| "snapshot-json-invalid")?;
        if candidate.version != 1
            || candidate.url != expected_url
            || candidate.title != expected_title
            || candidate.url.len() > 2048
            || candidate.title.len() > 128
        {
            return Err("snapshot-session-or-source-mismatch");
        }
        if candidate.visited == 0
            || candidate.visited > SEMANTIC_MAX_VISITS
            || candidate.elements.len() > SEMANTIC_MAX_ELEMENTS
            || candidate.text_bytes > SEMANTIC_MAX_TEXT_BYTES
        {
            return Err("snapshot-bounds-invalid");
        }
        let mut previous_index = 0;
        let mut actual_text_bytes = 0usize;
        for element in &candidate.elements {
            if element.index <= previous_index || element.index > candidate.visited {
                return Err("snapshot-element-index-invalid");
            }
            previous_index = element.index;
            if !matches!(
                element.role.as_str(),
                "main"
                    | "navigation"
                    | "article"
                    | "heading"
                    | "link"
                    | "button"
                    | "img"
                    | "paragraph"
                    | "listitem"
                    | "label"
                    | "input"
                    | "select"
                    | "textbox"
            ) || element.name.chars().count() > SEMANTIC_MAX_LABEL_CHARS
                || element.name.chars().any(char::is_control)
            {
                return Err("snapshot-element-invalid");
            }
            actual_text_bytes = actual_text_bytes.saturating_add(element.name.len());
        }
        if actual_text_bytes != candidate.text_bytes || actual_text_bytes > SEMANTIC_MAX_TEXT_BYTES
        {
            return Err("snapshot-text-bounds-invalid");
        }
        // The actual controlled fixture has this independent main landmark.
        // A title event alone is insufficient evidence of DOM extraction.
        if !candidate
            .elements
            .iter()
            .any(|element| element.role == "main" && element.name == "Clack brokered WebView2")
        {
            return Err("snapshot-fixture-landmark-missing");
        }
        let mut redacted_labels = 0usize;
        for element in &mut candidate.elements {
            if sensitive_semantic_label(&element.name) {
                element.name = "[redacted]".to_owned();
                redacted_labels += 1;
            }
        }
        candidate.text_bytes = candidate.elements.iter().map(|item| item.name.len()).sum();
        Ok(VerifiedSemanticSnapshot {
            session,
            page_generation: request_generation,
            snapshot_generation: 1, // one-shot only; no interactive DOM references
            observed_at_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                .min(u128::from(u64::MAX)) as u64,
            origin,
            session_verified: true,
            redacted_labels,
            snapshot: candidate,
        })
    }

    #[derive(Default)]
    struct BrokerStats {
        hook_ready: AtomicBool,
        broken: AtomicBool,
        fault_triggered: AtomicBool,
        intercepted: AtomicU64,
        forwarded: AtomicU64,
        answered: AtomicU64,
        pending: AtomicU64,
        denied: AtomicU64,
        errors: AtomicU64,
        timeouts: AtomicU64,
        cancelled: AtomicU64,
        // Count only responses successfully installed by WebView2 COM. For
        // deferred requests the deferral must also Complete() successfully.
        status_2xx: AtomicU64,
        status_4xx: AtomicU64,
        status_5xx: AtomicU64,
        synthetic_502: AtomicU64,
        synthetic_503: AtomicU64,
        synthetic_504: AtomicU64,
        last_synthetic_status: AtomicU64,
    }

    // Acceptance-only event facts. Events are static labels, bounded, and
    // contain no URLs, user content, tokens, credentials or process arguments.
    #[derive(Default)]
    struct PhaseA {
        triggered: AtomicBool,
        pending_at_trigger: AtomicU64,
        events: Mutex<Vec<&'static str>>,
        stale_page_denied: AtomicU64,
        duplicate_parent_rejected: AtomicU64,
        duplicate_completion_suppressed: AtomicU64,
        dependent_drained: AtomicU64,
        cancelled_pending: AtomicU64,
        suppressed_late: AtomicU64,
        process_failed: AtomicU64,
        browser_exited: AtomicU64,
        native_crash_dispatched: AtomicU64,
        navigation_attempted: AtomicU64,
    }
    impl PhaseA {
        fn event(&self, name: &'static str, pending: u64) {
            if !self.triggered.swap(true, Ordering::AcqRel) {
                self.pending_at_trigger.store(pending, Ordering::Release);
            }
            if let Ok(mut events) = self.events.lock() {
                if events.len() < 20 {
                    events.push(name);
                }
            }
        }
        fn note(&self, name: &'static str) {
            if let Ok(mut events) = self.events.lock() {
                if events.len() < 20 {
                    events.push(name);
                }
            }
        }
        fn receipt(&self, fault: BrokerFault, stats: &BrokerStats) -> serde_json::Value {
            json!({
                "scenario": fault.label(),
                "triggered": self.triggered.load(Ordering::Acquire),
                "events": self.events.lock().map(|e| e.clone()).unwrap_or_default(),
                "pendingAtTrigger": self.pending_at_trigger.load(Ordering::Acquire),
                "pendingAtExit": stats.pending.load(Ordering::Acquire),
                "completedResponseCount": stats.answered.load(Ordering::Acquire),
                "suppressedLateCount": self.suppressed_late.load(Ordering::Acquire),
                "stalePageDenied": self.stale_page_denied.load(Ordering::Acquire),
                "duplicateParentRejected": self.duplicate_parent_rejected.load(Ordering::Acquire),
                "duplicateCompletionSuppressed": self.duplicate_completion_suppressed.load(Ordering::Acquire),
                "dependentDrained": self.dependent_drained.load(Ordering::Acquire),
                "cancelledPending": self.cancelled_pending.load(Ordering::Acquire),
                "processFailedEvents": self.process_failed.load(Ordering::Acquire),
                "browserExitedEvents": self.browser_exited.load(Ordering::Acquire),
                "nativeCrashDispatched": self.native_crash_dispatched.load(Ordering::Acquire),
                "nativeNavigationAttempts": self.navigation_attempted.load(Ordering::Acquire),
                "networkEgressVerified": null
            })
        }
    }

    impl BrokerStats {
        fn note_com_response(&self, payload: &BrokerPayload) {
            let counter = match payload.status {
                200..=299 => &self.status_2xx,
                400..=499 => &self.status_4xx,
                _ => &self.status_5xx,
            };
            counter.fetch_add(1, Ordering::Relaxed);
            if payload.synthetic {
                self.last_synthetic_status
                    .store(u64::from(payload.status), Ordering::Release);
                let exact = match payload.status {
                    502 => Some(&self.synthetic_502),
                    503 => Some(&self.synthetic_503),
                    504 => Some(&self.synthetic_504),
                    _ => None,
                };
                if let Some(exact) = exact {
                    exact.fetch_add(1, Ordering::Relaxed);
                }
            }
        }

        fn last_synthetic_status(&self) -> Option<u16> {
            let value = self.last_synthetic_status.load(Ordering::Acquire);
            (value != 0).then_some(value as u16)
        }
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct BrokerRequest<'a> {
        version: u8,
        session: &'a str,
        request_id: u64,
        method: &'static str,
        url: &'a str,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct BrokerReply {
        version: u8,
        session: String,
        request_id: u64,
        status: u16,
        content_type: String,
        body_base64: String,
        error: Option<String>,
    }

    #[derive(Clone)]
    struct BrokerTicket {
        id: u64,
        url: String,
        session: String,
        page_generation: u64,
    }
    #[derive(Clone, Debug)]
    struct BrokerBinding {
        request_id: u64,
        session: String,
        url: String,
        page_generation: u64,
    }

    #[derive(Debug)]
    struct BrokerPayload {
        status: u16,
        content_type: String,
        body: Vec<u8>,
        synthetic: bool,
        binding: Option<BrokerBinding>,
    }

    impl BrokerPayload {
        fn denied(status: u16) -> Self {
            Self {
                status,
                content_type: "text/plain".to_owned(),
                body: Vec::new(),
                synthetic: true,
                binding: None,
            }
        }
    }

    struct PendingBrokerRequest {
        args: ICoreWebView2WebResourceRequestedEventArgs,
        deferral: ICoreWebView2Deferral,
        environment: ICoreWebView2Environment,
        page_generation: u64,
        session: String,
        url: String,
    }

    thread_local! {
        // COM objects are owned by the Tauri/WebView2 UI apartment, not Send.
        static BROKER_PENDING: RefCell<BTreeMap<u64, PendingBrokerRequest>> = const { RefCell::new(BTreeMap::new()) };
    }

    fn broker_handle(name: &str) -> Result<File, String> {
        let value = std::env::var(name).map_err(|_| format!("missing {name}"))?;
        if value.is_empty() || !value.bytes().all(|c| c.is_ascii_digit()) {
            return Err(format!("invalid {name} encoding"));
        }
        let value = value
            .parse::<usize>()
            .map_err(|_| format!("invalid {name}"))?;
        if value == 0 || value == usize::MAX {
            return Err(format!("invalid {name} handle"));
        }
        let handle = value as HANDLE;
        if unsafe { GetFileType(handle) } != FILE_TYPE_PIPE {
            return Err(format!("{name} is not an anonymous pipe"));
        }
        if unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 0) } == 0 {
            return Err(format!("{name} inheritance: {}", unsafe { GetLastError() }));
        }
        // The launcher's inherited handle belongs exclusively to the brokered
        // host. Clearing HANDLE_FLAG_INHERIT prevents WebView2 descendants from
        // inheriting the broker channel.
        Ok(unsafe { File::from_raw_handle(handle.cast()) })
    }

    fn broker_pipes() -> Result<(File, File), String> {
        let read_name = "CLACK_TF_BROWSER_BROKER_READ_HANDLE";
        let write_name = "CLACK_TF_BROWSER_BROKER_WRITE_HANDLE";
        let read_value = std::env::var(read_name).map_err(|_| format!("missing {read_name}"))?;
        let write_value = std::env::var(write_name).map_err(|_| format!("missing {write_name}"))?;
        if read_value == write_value {
            return Err("broker pipes must be distinct".into());
        }
        Ok((broker_handle(read_name)?, broker_handle(write_name)?))
    }

    fn broker_write_frame(pipe: &mut File, json: &[u8]) -> io::Result<()> {
        if json.is_empty() || json.len() > BROKER_FRAME_LIMIT {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "broker request frame exceeds cap",
            ));
        }
        pipe.write_all(&(json.len() as u32).to_le_bytes())?;
        pipe.write_all(json)?;
        pipe.flush()
    }

    fn broker_read_exact_bounded(
        pipe: &mut File,
        mut output: &mut [u8],
        deadline: Instant,
    ) -> io::Result<()> {
        while !output.is_empty() {
            if Instant::now() >= deadline {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "broker reply deadline elapsed",
                ));
            }
            let mut available = 0u32;
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
                return Err(io::Error::last_os_error());
            }
            if available == 0 {
                thread::sleep(Duration::from_millis(10));
                continue;
            }
            // Read only bytes already present in the pipe. Waiting for the
            // entire frame would deadlock if the parent writes more than the
            // finite Windows anonymous-pipe buffer can hold.
            let count = (available as usize).min(output.len()).min(4096);
            let read = pipe.read(&mut output[..count])?;
            if read == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "broker reply pipe closed",
                ));
            }
            output = &mut output[read..];
        }
        Ok(())
    }

    fn broker_read_frame(pipe: &mut File, timeout: Duration) -> io::Result<Vec<u8>> {
        let deadline = Instant::now() + timeout;
        let mut size = [0u8; 4];
        broker_read_exact_bounded(pipe, &mut size, deadline)?;
        let size = u32::from_le_bytes(size) as usize;
        if size == 0 || size > BROKER_FRAME_LIMIT {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "broker response frame exceeds cap",
            ));
        }
        let mut bytes = vec![0; size];
        broker_read_exact_bounded(pipe, &mut bytes, deadline)?;
        Ok(bytes)
    }

    fn broker_reply(bytes: &[u8], nonce: &str, id: u64) -> Result<BrokerPayload, &'static str> {
        let reply: BrokerReply =
            serde_json::from_slice(bytes).map_err(|_| "malformed broker reply")?;
        if reply.version != 1 {
            return Err("broker reply version mismatch");
        }
        if reply.session != nonce {
            return Err("broker reply session mismatch");
        }
        if reply.request_id != id {
            return Err("broker reply requestId mismatch");
        }
        if !(200..=599).contains(&reply.status) || (300..400).contains(&reply.status) {
            // No Location header is part of protocol v1. A 3xx without a
            // synthetic redirect target must never reach the network stack.
            return Err("unsupported broker status");
        }
        if reply.content_type.len() > 96
            || !reply
                .content_type
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"/+-._".contains(&b))
            || !matches!(
                reply.content_type.as_str(),
                "text/html"
                    | "text/plain"
                    | "text/css"
                    | "application/javascript"
                    | "application/json"
                    | "image/png"
                    | "image/jpeg"
                    | "image/gif"
                    | "image/svg+xml"
                    | "application/octet-stream"
            )
        {
            return Err("unsupported broker content type");
        }
        if reply.error.as_deref().is_some_and(|e| !e.is_empty()) {
            return Ok(BrokerPayload::denied(reply.status.max(400)));
        }
        let body = BASE64
            .decode(reply.body_base64.as_bytes())
            .map_err(|_| "bad broker base64")?;
        if body.len() > BROKER_FRAME_LIMIT {
            return Err("broker response body exceeds cap");
        }
        Ok(BrokerPayload {
            status: reply.status,
            content_type: reply.content_type,
            body,
            synthetic: false,
            binding: None,
        })
    }

    fn broker_owned_url(url: &str, port: u16, nonce: &str) -> bool {
        [
            "document",
            "css",
            "script",
            "image",
            "iframe",
            "fetch",
            "redirect-ok",
            "redirect-private",
            "deny",
        ]
        .iter()
        .any(|name| url == format!("http://127.0.0.1:{port}/{name}/broker/{nonce}"))
    }

    unsafe fn broker_set_response(
        args: &ICoreWebView2WebResourceRequestedEventArgs,
        environment: &ICoreWebView2Environment,
        payload: &BrokerPayload,
    ) -> windows::core::Result<()> {
        let stream = if payload.body.is_empty() {
            None
        } else {
            Some(
                SHCreateMemStream(Some(&payload.body))
                    .ok_or_else(windows::core::Error::from_win32)?,
            )
        };
        let status = HSTRING::from(match payload.status {
            200..=299 => "OK",
            400..=499 => "Blocked",
            _ => "Broker Error",
        });
        let headers = HSTRING::from(format!(
            "Content-Type: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n",
            payload.content_type
        ));
        let response = environment.CreateWebResourceResponse(
            stream.as_ref(),
            payload.status as i32,
            &status,
            &headers,
        )?;
        args.SetResponse(&response)
    }

    fn broker_deny_on_ui(
        args: &ICoreWebView2WebResourceRequestedEventArgs,
        environment: &ICoreWebView2Environment,
        status: u16,
        trace: &StartupTrace,
        stats: &BrokerStats,
    ) -> windows::core::Result<()> {
        stats.denied.fetch_add(1, Ordering::Relaxed);
        let payload = BrokerPayload::denied(status);
        match unsafe { broker_set_response(args, environment, &payload) } {
            Ok(()) => {
                // Synchronous handlers have no outstanding COM deferral.
                stats.note_com_response(&payload);
                Ok(())
            }
            Err(error) => {
                stats.errors.fetch_add(1, Ordering::Relaxed);
                stats.broken.store(true, Ordering::Release);
                trace.error(
                    "broker.deny.set.failed",
                    &format!("HRESULT {}", error.code().0),
                );
                // Returning an error without an installed WebView2 response
                // could permit browser-network fallback. This standalone,
                // zero-capability acceptance host must terminate instead.
                std::process::exit(1)
            }
        }
    }

    fn broker_finish_on_ui(
        id: u64,
        mut payload: BrokerPayload,
        trace: &StartupTrace,
        stats: &BrokerStats,
        page_generation: &AtomicU64,
        phase_a: &PhaseA,
    ) {
        BROKER_PENDING.with(|pending| {
            let Some(pending) = pending.borrow_mut().remove(&id) else {
                // An earlier timeout may already have drained this pending
                // request. Ignore an obsolete late dispatcher, never install
                // its response into a newer page or request.
                trace.record(
                    "broker.pending.stale",
                    "late or already drained COM request ignored",
                );
                phase_a.suppressed_late.fetch_add(1, Ordering::Relaxed);
                return;
            };
            stats.pending.fetch_sub(1, Ordering::Relaxed);
            if !payload.synthetic
                && !payload
                    .binding
                    .as_ref()
                    .is_some_and(|binding| broker_binding_matches(id, &pending, binding))
            {
                trace.error(
                    "broker.reply.native_binding",
                    "request session URL or page identity rejected",
                );
                stats.errors.fetch_add(1, Ordering::Relaxed);
                stats.broken.store(true, Ordering::Release);
                phase_a.stale_page_denied.fetch_add(1, Ordering::Relaxed);
                payload = BrokerPayload::denied(502);
            }
            if broker_reply_must_be_denied(
                payload.synthetic,
                stats.broken.load(Ordering::Acquire),
                pending.page_generation,
                page_generation.load(Ordering::Acquire),
            ) {
                trace.error(
                    "broker.response.stale_page",
                    "late reply invalidated by fault or navigation",
                );
                stats.errors.fetch_add(1, Ordering::Relaxed);
                stats.broken.store(true, Ordering::Release);
                phase_a.stale_page_denied.fetch_add(1, Ordering::Relaxed);
                payload = BrokerPayload::denied(502);
            }
            if let Err(error) =
                unsafe { broker_set_response(&pending.args, &pending.environment, &payload) }
            {
                trace.error(
                    "broker.response.set.failed",
                    &format!("HRESULT {}", error.code().0),
                );
                stats.errors.fetch_add(1, Ordering::Relaxed);
                stats.broken.store(true, Ordering::Release);
                payload = BrokerPayload::denied(502);
                if let Err(fallback_error) =
                    unsafe { broker_set_response(&pending.args, &pending.environment, &payload) }
                {
                    trace.error(
                        "broker.response.fallback.failed",
                        &format!("HRESULT {}", fallback_error.code().0),
                    );
                    // Do not Complete() a deferral with no installed response:
                    // WebView2 may otherwise continue through its own stack.
                    std::process::exit(1);
                }
            }
            if let Err(error) = unsafe { pending.deferral.Complete() } {
                trace.error(
                    "broker.deferral.complete.failed",
                    &format!("HRESULT {}", error.code().0),
                );
                stats.errors.fetch_add(1, Ordering::Relaxed);
                stats.broken.store(true, Ordering::Release);
                std::process::exit(1);
            }
            // This is the first point at which a deferred response can be
            // recorded as successfully answered by WebView2.
            stats.note_com_response(&payload);
            stats.answered.fetch_add(1, Ordering::Release);
        });
    }

    fn broker_binding_matches(
        id: u64,
        pending: &PendingBrokerRequest,
        binding: &BrokerBinding,
    ) -> bool {
        broker_binding_matches_values(
            id,
            &pending.session,
            &pending.url,
            pending.page_generation,
            binding,
        )
    }

    fn broker_binding_matches_values(
        id: u64,
        session: &str,
        url: &str,
        generation: u64,
        binding: &BrokerBinding,
    ) -> bool {
        binding.request_id == id
            && binding.session == session
            && binding.url == url
            && binding.page_generation == generation
    }

    fn broker_reply_must_be_denied(
        synthetic: bool,
        broken: bool,
        request_generation: u64,
        current_generation: u64,
    ) -> bool {
        request_generation != current_generation || (broken && !synthetic)
    }

    fn broker_drain_on_ui(
        id: u64,
        failed_response: BrokerPayload,
        trace: &StartupTrace,
        stats: &BrokerStats,
        page_generation: &AtomicU64,
        phase_a: &PhaseA,
    ) {
        // A fatal pipe/session failure revokes the entire pending set, not
        // merely the request which happened to be active in the pipe worker.
        let others: Vec<u64> = BROKER_PENDING.with(|pending| {
            pending
                .borrow()
                .keys()
                .copied()
                .filter(|other| *other != id)
                .collect()
        });
        let status = if failed_response.status == 504 {
            504
        } else {
            502
        };
        broker_finish_on_ui(id, failed_response, trace, stats, page_generation, phase_a);
        for other in others {
            broker_finish_on_ui(
                other,
                BrokerPayload::denied(status),
                trace,
                stats,
                page_generation,
                phase_a,
            );
        }
    }

    fn broker_drain_all_on_ui(
        status: u16,
        trace: &StartupTrace,
        stats: &BrokerStats,
        page_generation: &AtomicU64,
        phase_a: &PhaseA,
    ) -> usize {
        let ids: Vec<u64> =
            BROKER_PENDING.with(|pending| pending.borrow().keys().copied().collect());
        for id in &ids {
            broker_finish_on_ui(
                *id,
                BrokerPayload::denied(status),
                trace,
                stats,
                page_generation,
                phase_a,
            );
        }
        ids.len()
    }

    // The broker never opens sockets. One bounded pipe worker owns all frames;
    // COM deferrals are completed only on the original WebView2 UI apartment.
    fn run_brokered(
        args: Args,
        trace: Arc<StartupTrace>,
        token: TokenDetails,
        udf: PathBuf,
    ) -> Result<(), String> {
        let fault = args.broker_fault;
        trace.record("broker.fault.configured", fault.label());
        trace.record(
            "broker.pipes.begin",
            "opening inherited anonymous pipe handles",
        );
        let (mut broker_read, mut broker_write) = broker_pipes().map_err(|e| {
            trace.error("broker.pipes.failed", &e);
            e
        })?;
        trace.record(
            "broker.pipes.ok",
            "inherited pipes validated and inheritance cleared",
        );

        let stats = Arc::new(BrokerStats::default());
        let phase_a = Arc::new(PhaseA::default());
        let observer = Arc::new(Observed::default());
        let semantic = Arc::new(SemanticSnapshotState::default());
        let marker = format!("{RENDER_MARKER}{}", args.nonce);
        let document_url = format!(
            "http://127.0.0.1:{}/document/broker/{}",
            args.fixture_port, args.nonce
        );
        let mut context = tauri::generate_context!();
        context.config_mut().app.windows.clear();
        let result_flag = Arc::new(AtomicBool::new(false));
        let result_from_thread = result_flag.clone();
        // Pre-arm epoch 1 before CoreWebView2.Navigate: some runtime versions
        // dispatch WebResourceRequested before NavigationStarting. The first
        // controlled navigation stays on epoch 1 regardless of event order.
        let page_generation = Arc::new(AtomicU64::new(1));
        let root = args.root.clone();
        let pid = std::process::id();
        let port = args.fixture_port;
        let session = args.nonce.clone();
        let init_trace = trace.clone();
        let setup_stats = stats.clone();
        let setup_observer = observer.clone();

        trace.record(
            "broker.tauri.build.begin",
            "initializing brokered Tauri host",
        );
        let app = tauri::Builder::default()
            .setup(move |app| {
                let (tx, rx) = mpsc::sync_channel::<BrokerTicket>(BROKER_QUEUE_LIMIT);
                let worker_trace = init_trace.clone();
                let worker_stats = setup_stats.clone();
                let worker_session = session.clone();
                let worker_fault = fault;
                let worker_generation = page_generation.clone();
                let worker_phase_a = phase_a.clone();
                let handle = app.handle().clone();
                thread::spawn(move || {
                    while let Ok(ticket) = rx.recv() {
                        if worker_stats.broken.load(Ordering::Acquire) {
                            let trace = worker_trace.clone();
                            let stats = worker_stats.clone();
                            let generation = worker_generation.clone();
                            let phase = worker_phase_a.clone();
                            if handle.run_on_main_thread(move || {
                                broker_drain_on_ui(ticket.id, BrokerPayload::denied(502), &trace, &stats, &generation, &phase);
                            }).is_err() {
                                worker_trace.error("broker.ui.dispatch.failed", "cannot drain after session invalidation");
                                worker_stats.errors.fetch_add(1, Ordering::Relaxed);
                            }
                            break;
                        }
                        let wire = BrokerRequest {
                            version: 1,
                            session: &worker_session,
                            request_id: ticket.id,
                            method: "GET",
                            url: &ticket.url,
                        };
                        let mut finished_early = false;
                        let answer = (|| -> io::Result<BrokerPayload> {
                            if ticket.session != worker_session
                                || ticket.page_generation == 0
                                || ticket.page_generation > worker_generation.load(Ordering::Acquire)
                            {
                                return Err(io::Error::new(
                                    io::ErrorKind::InvalidData,
                                    "broker request native session or page identity invalid",
                                ));
                            }
                            let body = serde_json::to_vec(&wire)
                                .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "broker request serialization failed"))?;
                            broker_write_frame(&mut broker_write, &body)?;
                            if worker_fault == BrokerFault::CancelPending && ticket.id == 1 {
                                // A real parent GET is already in flight. Cancel its
                                // native COM deferral *before reading* any parent
                                // reply, with UI-thread acknowledgment rather than
                                // a timing-dependent sleep.
                                let (ack_tx, ack_rx) = mpsc::sync_channel(1);
                                let trace = worker_trace.clone();
                                let stats = worker_stats.clone();
                                let phase = worker_phase_a.clone();
                                let generation = worker_generation.clone();
                                handle.run_on_main_thread(move || {
                                    phase.event("pending-cancel-before-reply", stats.pending.load(Ordering::Acquire));
                                    stats.fault_triggered.store(true, Ordering::Release);
                                    stats.broken.store(true, Ordering::Release);
                                    stats.cancelled.fetch_add(1, Ordering::Relaxed);
                                    phase.cancelled_pending.fetch_add(1, Ordering::Relaxed);
                                    broker_drain_all_on_ui(503, &trace, &stats, &generation, &phase);
                                    let _ = ack_tx.send(());
                                }).map_err(|_| io::Error::other("native pending cancellation dispatch failed"))?;
                                if ack_rx.recv_timeout(Duration::from_secs(2)).is_err() {
                                    // The UI apartment is not servicing COM
                                    // deferrals. Never continue the browser.
                                    worker_trace.error("broker.phase-a.cancel.ack.failed", "COM cancellation acknowledgment unavailable");
                                    std::process::exit(1);
                                }
                                finished_early = true;
                                // Consume at most one buffered reply solely to
                                // prove it is not installed/replayed after cancel.
                                if let Ok(frame) = broker_read_frame(&mut broker_read, BROKER_FAULT_DEADLINE) {
                                    if broker_reply(&frame, &worker_session, ticket.id).is_ok() {
                                        worker_phase_a.suppressed_late.fetch_add(1, Ordering::Relaxed);
                                        worker_phase_a.note("late-parent-reply-discarded");
                                    } else {
                                        worker_phase_a.note("late-parent-reply-invalid");
                                    }
                                } else {
                                    worker_phase_a.note("late-parent-reply-not-observed");
                                }
                                return Err(io::Error::new(io::ErrorKind::Interrupted, "pending cancellation completed locally"));
                            }
                            let frame = broker_read_frame(&mut broker_read, worker_fault.reply_deadline())?;
                            // The stale-session seam validates the *actual* parent
                            // reply against a deliberately different session.
                            // No altered request or secret is transmitted.
                            let expected_session = if worker_fault == BrokerFault::StaleSession {
                                format!("x{worker_session}")
                            } else {
                                worker_session.clone()
                            };
                            let mut payload = broker_reply(&frame, &expected_session, ticket.id)
                                .map_err(|reason| io::Error::new(io::ErrorKind::InvalidData, reason))?;
                            if worker_fault == BrokerFault::DuplicateParent && ticket.id == 1 {
                                // The runner must send two same-session/id v1
                                // frames without a second GET. The second is a
                                // true unsolicited parent replay, never applied.
                                let replay = broker_read_frame(&mut broker_read, BROKER_FAULT_DEADLINE)?;
                                if broker_reply(&replay, &worker_session, ticket.id).is_ok() {
                                    worker_phase_a.event("duplicate-parent-frame-rejected", worker_stats.pending.load(Ordering::Acquire));
                                    worker_phase_a.duplicate_parent_rejected.fetch_add(1, Ordering::Relaxed);
                                    worker_phase_a.suppressed_late.fetch_add(1, Ordering::Relaxed);
                                } else {
                                    worker_phase_a.note("stale-parent-frame-rejected");
                                    worker_phase_a.event("stale-parent-frame-rejected", worker_stats.pending.load(Ordering::Acquire));
                                    worker_phase_a.duplicate_parent_rejected.fetch_add(1, Ordering::Relaxed);
                                }
                                return Err(io::Error::new(io::ErrorKind::InvalidData, "unsolicited parent broker reply rejected"));
                            }
                            payload.binding = Some(BrokerBinding {
                                request_id: ticket.id,
                                session: worker_session.clone(),
                                url: ticket.url.clone(),
                                page_generation: ticket.page_generation,
                            });
                            Ok(payload)
                        })();
                        if finished_early {
                            break;
                        }
                        let failure = answer.is_err();
                        let response = match answer {
                            Ok(payload) => payload,
                            Err(error) => {
                                worker_stats.errors.fetch_add(1, Ordering::Relaxed);
                                worker_stats.broken.store(true, Ordering::Release);
                                if error.kind() == io::ErrorKind::TimedOut {
                                    worker_stats.timeouts.fetch_add(1, Ordering::Relaxed);
                                }
                                if worker_fault != BrokerFault::None {
                                    worker_stats.fault_triggered.store(true, Ordering::Release);
                                }
                                worker_trace.error("broker.pipe.failed", &io_error(&error));
                                BrokerPayload::denied(if error.kind() == io::ErrorKind::TimedOut { 504 } else { 502 })
                            }
                        };
                        let reply_trace = worker_trace.clone();
                        let reply_stats = worker_stats.clone();
                        let reply_generation = worker_generation.clone();
                        let reply_phase_a = worker_phase_a.clone();
                        let duplicate_late = worker_fault == BrokerFault::DuplicateLate && ticket.id == 1;
                        if let Err(error) = handle.run_on_main_thread(move || {
                            if failure {
                                broker_drain_on_ui(
                                    ticket.id, response, &reply_trace, &reply_stats, &reply_generation, &reply_phase_a,
                                );
                            } else {
                                broker_finish_on_ui(
                                    ticket.id, response, &reply_trace, &reply_stats, &reply_generation, &reply_phase_a,
                                );
                                if duplicate_late {
                                    reply_phase_a.event("duplicate-completion-replayed", reply_stats.pending.load(Ordering::Acquire));
                                    reply_stats.fault_triggered.store(true, Ordering::Release);
                                    // Invoke the genuine native completion path a
                                    // second time for the exact same requestId.
                                    // The completed COM request is no longer in
                                    // BROKER_PENDING: no second SetResponse.
                                    broker_finish_on_ui(
                                        ticket.id, BrokerPayload::denied(502),
                                        &reply_trace, &reply_stats, &reply_generation, &reply_phase_a,
                                    );
                                    reply_phase_a.duplicate_completion_suppressed.fetch_add(1, Ordering::Relaxed);
                                    reply_stats.broken.store(true, Ordering::Release);
                                }
                            }
                        }) {
                            worker_trace.error("broker.ui.dispatch.failed", &error.to_string());
                            worker_stats.errors.fetch_add(1, Ordering::Relaxed);
                            worker_stats.broken.store(true, Ordering::Release);
                            break;
                        }
                        if failure {
                            // Do not service new requests over a compromised or
                            // stalled reply channel. Future intercepted requests
                            // receive local 502 with no direct-network fallback.
                            break;
                        }
                    }
                });
                init_trace.record("broker.worker.ready", "bounded pipe request worker started");

                let title_trace = init_trace.clone();
                let title_observer = setup_observer.clone();
                let title_stats = setup_stats.clone();
                let expected_title = marker.clone();
                let title_semantic = semantic.clone();
                let title_generation = page_generation.clone();
                let title_expected_url = document_url.clone();
                let title_session = session.clone();
                let webview = WebviewWindowBuilder::new(
                    app,
                    "browser-host",
                    WebviewUrl::External("about:blank".parse().map_err(std::io::Error::other)?),
                )
                .visible(false)
                .drag_and_drop(false)
                .data_directory(udf.clone())
                .on_document_title_changed(move |webview, title| {
                    if title == expected_title && !title_stats.broken.load(Ordering::Acquire) {
                        title_observer.scripted.store(true, Ordering::Release);
                        title_trace.record("broker.dom.marker", "native document title marker observed");
                        if fault == BrokerFault::RendererCrashPending {
                            // Renderer-crash acceptance cannot operate on an
                            // unrendered first-document deferral. The parent
                            // first delivers one controlled HTML document;
                            // this native callback attests its actual JS title
                            // and only NOW starts a single controlled pending
                            // dependent GET, so the subsequent Page.crash is
                            // an actual renderer/process failure experiment.
                            if title_semantic.requested.swap(true, Ordering::AcqRel) {
                                return;
                            }
                            let expected_url = title_expected_url.clone();
                            let trace = title_trace.clone();
                            let script = format!(
                                "fetch('/fetch/broker/{}').catch(()=>{{}});",
                                title_session
                            );
                            if webview.with_webview(move |native| {
                                let core = match unsafe { native.controller().CoreWebView2() } {
                                    Ok(core) => core,
                                    Err(_) => {
                                        trace.error("broker.phase-a.renderer-core.failed", "native controller unavailable");
                                        return;
                                    }
                                };
                                let mut raw = PWSTR::null();
                                if unsafe { core.Source(&mut raw) }.is_err()
                                    || take_pwstr(raw) != expected_url
                                {
                                    trace.error("broker.phase-a.renderer-page.stale", "actual rendered page source mismatch");
                                    return;
                                }
                                let completion_trace = trace.clone();
                                let completed = ExecuteScriptCompletedHandler::create(Box::new(
                                    move |result, _| {
                                        if result.is_err() {
                                            completion_trace.error("broker.phase-a.renderer-fetch.failed", "controlled native script rejected");
                                        }
                                        Ok(())
                                    },
                                ));
                                if unsafe {
                                    core.ExecuteScript(&HSTRING::from(script), &completed)
                                }.is_err() {
                                    trace.error("broker.phase-a.renderer-fetch.dispatch-failed", "controlled dependent fetch not dispatched");
                                } else {
                                    trace.record("broker.phase-a.renderer-fetch.dispatched", "fixed native dependent fetch after actual renderer marker");
                                }
                            }).is_err() {
                                title_trace.error("broker.phase-a.renderer-ui.failed", "native UI callback unavailable");
                            }
                            return;
                        }
                        // The existing external fixture script set the title.
                        // Probe that real renderer once, with a fixed script;
                        // never execute model-supplied JavaScript or selectors.
                        if fault != BrokerFault::None
                            || title_semantic.requested.swap(true, Ordering::AcqRel)
                        {
                            return;
                        }
                        let expected_url = title_expected_url.clone();
                        let title = expected_title.clone();
                        let state = title_semantic.clone();
                        let stats = title_stats.clone();
                        let generation = title_generation.clone();
                        let trace = title_trace.clone();
                        let epoch = generation.load(Ordering::Acquire);
                        let dispatched = webview.with_webview(move |native| {
                            let core = match unsafe { native.controller().CoreWebView2() } {
                                Ok(core) => core,
                                Err(_) => {
                                    trace.error("semantic.snapshot.core.failed", "native controller unavailable");
                                    state.fail("snapshot-native-controller-unavailable");
                                    return;
                                }
                            };
                            let mut source = PWSTR::null();
                            if unsafe { core.Source(&mut source) }.is_err() {
                                state.fail("snapshot-native-source-unavailable");
                                return;
                            }
                            if take_pwstr(source) != expected_url
                                || stats.broken.load(Ordering::Acquire)
                                || epoch != generation.load(Ordering::Acquire)
                            {
                                state.fail("snapshot-native-page-stale");
                                return;
                            }
                            let callback_core = core.clone();
                            let callback_state = state.clone();
                            let callback_stats = stats.clone();
                            let callback_generation = generation.clone();
                            let callback_trace = trace.clone();
                            let callback_url = expected_url.clone();
                            let callback_title = title.clone();
                            let completed = ExecuteScriptCompletedHandler::create(Box::new(
                                move |hr, output| {
                                    if hr.is_err() {
                                        callback_state.fail("snapshot-native-script-failed");
                                        callback_trace.error("semantic.snapshot.script.failed", "WebView2 script completion failed");
                                        return Ok(());
                                    }
                                    let mut current_source = PWSTR::null();
                                    if unsafe { callback_core.Source(&mut current_source) }.is_err() {
                                        callback_state.fail("snapshot-native-source-unavailable");
                                        return Ok(());
                                    }
                                    if take_pwstr(current_source) != callback_url
                                        || callback_stats.broken.load(Ordering::Acquire)
                                    {
                                        callback_state.fail("snapshot-native-page-stale");
                                        return Ok(());
                                    }
                                    match verify_semantic_snapshot(
                                        &output,
                                        &callback_url,
                                        &callback_title,
                                        epoch,
                                        callback_generation.load(Ordering::Acquire),
                                    ) {
                                        Ok(proof) => {
                                            callback_trace.record("semantic.snapshot.verified", "bounded native-validated real DOM summary");
                                            callback_state.succeed(proof);
                                        }
                                        Err(reason) => {
                                            callback_trace.error("semantic.snapshot.rejected", reason);
                                            callback_state.fail(reason);
                                        }
                                    }
                                    Ok(())
                                },
                            ));
                            if unsafe {
                                core.ExecuteScript(&HSTRING::from(SEMANTIC_SNAPSHOT_JS), &completed)
                            }
                            .is_err()
                            {
                                state.fail("snapshot-native-dispatch-failed");
                                trace.error("semantic.snapshot.dispatch.failed", "WebView2 ExecuteScript rejected");
                            } else {
                                trace.record("semantic.snapshot.dispatched", "fixed bounded DOM script dispatched");
                            }
                        });
                        if dispatched.is_err() {
                            title_semantic.fail("snapshot-native-ui-dispatch-failed");
                            title_trace.error("semantic.snapshot.ui.failed", "native WebView2 dispatch failed");
                        }
                    }
                })
                .build()
                .map_err(|e| {
                    init_trace.error("broker.webview.create.failed", &error_chain(&e));
                    e
                })?;
                init_trace.record("broker.webview.created", "hidden WebView2 shell initialized");

                let callback_trace = init_trace.clone();
                let callback_stats = setup_stats.clone();
                let callback_url = document_url.clone();
                let callback_session = session.clone();
                let callback_port = port;
                let callback_tx = tx;
                let callback_fault = fault;
                let callback_generation = page_generation.clone();
                let callback_phase_a = phase_a.clone();
                let callback_observer = setup_observer.clone();
                let counter = Arc::new(AtomicU64::new(0));
                webview.with_webview(move |native| {
                    if callback_fault == BrokerFault::MissingIntercept {
                        // Deterministic configuration-denial seam, NOT proof that
                        // an actual missed hook blocked a network request.
                        // Never navigate with interception deliberately absent.
                        callback_stats.fault_triggered.store(true, Ordering::Release);
                        callback_stats.broken.store(true, Ordering::Release);
                        callback_trace.record("broker.fault.no_intercept", "hook omitted and navigation suppressed");
                        return;
                    }
                    let installed = (|| -> windows::core::Result<()> {
                        let environment = native.environment();
                        let controller = native.controller();
                        let core = unsafe { controller.CoreWebView2()? };
                        // The _22 API is required. Its ALL source kinds include
                        // document, iframe, worker, and shared-worker requests.
                        // Never silently downgrade to a filter omitting sources.
                        let core22: ICoreWebView2_22 = core.cast()?;
                        // Native events, never window polling or a debug port,
                        // prove that a renderer/browser actually failed. Any
                        // outstanding COM deferrals are revoked on the same UI
                        // apartment. If the crashed COM interface will not
                        // accept a synthetic response, broker_finish_on_ui
                        // terminates the host rather than allow fallback.
                        let failed_stats = callback_stats.clone();
                        let failed_phase = callback_phase_a.clone();
                        let failed_trace = callback_trace.clone();
                        let failed_generation = callback_generation.clone();
                        let process_failed = ProcessFailedEventHandler::create(Box::new(
                            move |_, args| {
                                let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND(0);
                                if let Some(args) = args {
                                    let _ = unsafe { args.ProcessFailedKind(&mut kind) };
                                }
                                failed_phase.process_failed.fetch_add(1, Ordering::Relaxed);
                                failed_phase.note("native-process-failed");
                                failed_trace.record("broker.phase-a.process-failed", "WebView2 native process failed event");
                                if failed_stats.pending.load(Ordering::Acquire) != 0 {
                                    failed_phase.event("process-failure-with-pending-deferrals", failed_stats.pending.load(Ordering::Acquire));
                                    failed_stats.fault_triggered.store(true, Ordering::Release);
                                    failed_stats.broken.store(true, Ordering::Release);
                                    failed_generation.fetch_add(1, Ordering::AcqRel);
                                    broker_drain_all_on_ui(502, &failed_trace, &failed_stats, &failed_generation, &failed_phase);
                                } else {
                                    failed_stats.broken.store(true, Ordering::Release);
                                }
                                Ok(())
                            }
                        ));
                        let mut failed_token = 0;
                        unsafe { core.add_ProcessFailed(&process_failed, &mut failed_token)?; }
                        if let Ok(env5) = environment.cast::<ICoreWebView2Environment5>() {
                            let exit_stats = callback_stats.clone();
                            let exit_phase = callback_phase_a.clone();
                            let exit_trace = callback_trace.clone();
                            let exit_generation = callback_generation.clone();
                            let browser_exited = BrowserProcessExitedEventHandler::create(Box::new(
                                move |_, _| {
                                    exit_phase.browser_exited.fetch_add(1, Ordering::Relaxed);
                                    exit_phase.note("native-browser-process-exited");
                                    exit_trace.record("broker.phase-a.browser-exited", "WebView2 browser process exited event");
                                    if exit_stats.pending.load(Ordering::Acquire) != 0 {
                                        exit_phase.event("browser-exit-with-pending-deferrals", exit_stats.pending.load(Ordering::Acquire));
                                        exit_stats.fault_triggered.store(true, Ordering::Release);
                                        exit_stats.broken.store(true, Ordering::Release);
                                        exit_generation.fetch_add(1, Ordering::AcqRel);
                                        broker_drain_all_on_ui(502, &exit_trace, &exit_stats, &exit_generation, &exit_phase);
                                    }
                                    Ok(())
                                }
                            ));
                            let mut browser_exit_token = 0;
                            unsafe { env5.add_BrowserProcessExited(&browser_exited, &mut browser_exit_token)?; }
                            callback_trace.record("broker.phase-a.browser-exit-hook", "WebView2 environment browser exit hook registered");
                        } else {
                            callback_phase_a.note("browser-exit-hook-unavailable");
                        }
                        let nav_generation = callback_generation.clone();
                        let nav_trace = callback_trace.clone();
                        let nav_stats = callback_stats.clone();
                        let nav_phase_a = callback_phase_a.clone();
                        let nav_fault = callback_fault;
                        let nav_expected_url = callback_url.clone();
                        let nav_first_expected = Arc::new(AtomicBool::new(false));
                        let navigation_handler = NavigationStartingEventHandler::create(Box::new(
                            move |_, args| {
                                let Some(args) = args else {
                                    nav_stats.errors.fetch_add(1, Ordering::Relaxed);
                                    nav_stats.broken.store(true, Ordering::Release);
                                    nav_trace.error("broker.navigation.unavailable", "native navigation args absent");
                                    return Ok(());
                                };
                                let mut raw = PWSTR::null();
                                if unsafe { args.Uri(&mut raw) }.is_err() {
                                    nav_stats.errors.fetch_add(1, Ordering::Relaxed);
                                    nav_stats.broken.store(true, Ordering::Release);
                                    nav_trace.error("broker.navigation.uri.failed", "native navigation URI unavailable");
                                    unsafe { args.SetCancel(true)?; }
                                    return Ok(());
                                }
                                let current_url = take_pwstr(raw);
                                if current_url == "about:blank"
                                    && !nav_first_expected.load(Ordering::Acquire)
                                {
                                    return Ok(());
                                }
                                if nav_fault == BrokerFault::PageRace
                                    && nav_phase_a.triggered.load(Ordering::Acquire)
                                    && current_url == "about:blank"
                                {
                                    nav_generation.fetch_add(1, Ordering::AcqRel);
                                    nav_phase_a.note("native-about-blank-navigation-cancelled");
                                    nav_trace.record("broker.phase-a.navigation-cancelled", "controlled networkless navigation rejected");
                                    unsafe { args.SetCancel(true)?; }
                                    return Ok(());
                                }
                                let epoch = if current_url == nav_expected_url
                                    && !nav_first_expected.swap(true, Ordering::AcqRel)
                                {
                                    nav_generation.load(Ordering::Acquire)
                                } else {
                                    nav_generation.fetch_add(1, Ordering::AcqRel) + 1
                                };
                                if current_url != nav_expected_url {
                                    nav_stats.errors.fetch_add(1, Ordering::Relaxed);
                                    nav_stats.broken.store(true, Ordering::Release);
                                    nav_trace.error("broker.navigation.cancelled", "unexpected top-level navigation denied");
                                    unsafe { args.SetCancel(true)?; }
                                } else {
                                    nav_trace.record("broker.navigation.allowed", &format!("pageGeneration {epoch}"));
                                }
                                Ok(())
                            },
                        ));
                        let mut nav_token = 0;
                        unsafe { core.add_NavigationStarting(&navigation_handler, &mut nav_token)?; }
                        for scheme in ["http://*", "https://*"] {
                            unsafe {
                                core22.AddWebResourceRequestedFilterWithRequestSourceKinds(
                                    &HSTRING::from(scheme),
                                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                                    COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
                                )?;
                            }
                        }
                        let event_env = environment.clone();
                        let event_stats = callback_stats.clone();
                        let event_trace = callback_trace.clone();
                        let event_counter = counter.clone();
                        let event_generation = callback_generation.clone();
                        let event_phase_a = callback_phase_a.clone();
                        let event_observer = callback_observer.clone();
                        let event_core = core.clone();
                        let event_document_url = callback_url.clone();
                        let held_dependent = Arc::new(AtomicU64::new(0));
                        let event_held_dependent = held_dependent.clone();
                        let handler = WebResourceRequestedEventHandler::create(Box::new(
                            move |_, args| {
                                let Some(args) = args else { return Ok(()); };
                                event_stats.intercepted.fetch_add(1, Ordering::Relaxed);
                                event_trace.record("broker.request.intercepted", &format!("pageGeneration {}", event_generation.load(Ordering::Acquire)));
                                let request = match unsafe { args.Request() } {
                                    Ok(request) => request,
                                    Err(_) => {
                                        return broker_deny_on_ui(&args, &event_env, 502, &event_trace, &event_stats);
                                    }
                                };
                                let mut uri = PWSTR::null();
                                let mut method = PWSTR::null();
                                if unsafe { request.Uri(&mut uri) }.is_err()
                                    || unsafe { request.Method(&mut method) }.is_err()
                                {
                                    return broker_deny_on_ui(&args, &event_env, 502, &event_trace, &event_stats);
                                }
                                let uri = take_pwstr(uri);
                                let method = take_pwstr(method);
                                if method != "GET"
                                    || !broker_owned_url(&uri, callback_port, &callback_session)
                                {
                                    return broker_deny_on_ui(&args, &event_env, 403, &event_trace, &event_stats);
                                }
                                if event_stats.broken.load(Ordering::Acquire) {
                                    return broker_deny_on_ui(&args, &event_env, 502, &event_trace, &event_stats);
                                }
                                let deferral = match unsafe { args.GetDeferral() } {
                                    Ok(deferral) => deferral,
                                    Err(_) => {
                                        return broker_deny_on_ui(&args, &event_env, 502, &event_trace, &event_stats);
                                    }
                                };
                                let id = event_counter.fetch_add(1, Ordering::Relaxed) + 1;
                                let request_generation = event_generation.load(Ordering::Acquire);
                                let is_document = uri == event_document_url;
                                BROKER_PENDING.with(|pending| {
                                    pending.borrow_mut().insert(id, PendingBrokerRequest {
                                        args,
                                        deferral,
                                        environment: event_env.clone(),
                                        page_generation: request_generation,
                                        session: callback_session.clone(),
                                        url: uri.clone(),
                                    });
                                });
                                event_stats.pending.fetch_add(1, Ordering::Relaxed);
                                if callback_fault == BrokerFault::HostExitPending && id == 1 {
                                    event_phase_a.event("host-exit-with-pending-deferral", event_stats.pending.load(Ordering::Acquire));
                                    event_stats.fault_triggered.store(true, Ordering::Release);
                                    // Keep the real COM GetDeferral pending. The
                                    // unconfined parent terminates ONLY the
                                    // original owned host process handle with
                                    // code 87 after separately attesting a
                                    // live AppContainer browser child and this
                                    // exact native arming event. Exiting here
                                    // raced process-role observation and could
                                    // not prove browser startup.
                                    event_trace.record("broker.phase-a.host-exit.armed", "real GetDeferral pending; parent-owned host termination armed");
                                    return Ok(());
                                }
                                if callback_fault == BrokerFault::ShutdownPending && id == 1 {
                                    event_phase_a.event("shutdown-pending-drained", event_stats.pending.load(Ordering::Acquire));
                                    event_stats.fault_triggered.store(true, Ordering::Release);
                                    event_stats.broken.store(true, Ordering::Release);
                                    event_trace.record("broker.phase-a.shutdown-pending.armed", "real pending deferral completing before shutdown");
                                    let drained = broker_drain_all_on_ui(
                                        503, &event_trace, &event_stats, &event_generation, &event_phase_a
                                    );
                                    event_phase_a.note(if drained > 0 { "shutdown-deferrals-completed" } else { "shutdown-no-deferrals" });
                                    return Ok(());
                                }
                                if callback_fault == BrokerFault::DependentDrain && !is_document {
                                    if event_held_dependent
                                        .compare_exchange(0, id, Ordering::AcqRel, Ordering::Acquire)
                                        .is_ok()
                                    {
                                        // Hold a genuine subresource deferral,
                                        // without forwarding a request, until a
                                        // *second* independent WebView2 context
                                        // arrives. No sleep or fabricated GET.
                                        event_phase_a.note("first-dependent-deferral-held");
                                        return Ok(());
                                    }
                                    event_phase_a.event(
                                        "two-dependent-deferrals-observed",
                                        event_stats.pending.load(Ordering::Acquire),
                                    );
                                    event_stats.fault_triggered.store(true, Ordering::Release);
                                    event_stats.broken.store(true, Ordering::Release);
                                    let drained = broker_drain_all_on_ui(
                                        502, &event_trace, &event_stats, &event_generation, &event_phase_a
                                    );
                                    event_phase_a.dependent_drained.fetch_add(drained as u64, Ordering::Relaxed);
                                    event_trace.record("broker.phase-a.dependent-drained", "multiple real pending WebView2 resource deferrals denied");
                                    return Ok(());
                                }
                                if callback_fault == BrokerFault::PageRace && id == 1 {
                                    event_phase_a.event(
                                        "page-generation-invalidated-with-pending-deferral",
                                        event_stats.pending.load(Ordering::Acquire),
                                    );
                                    event_stats.fault_triggered.store(true, Ordering::Release);
                                    // The parent must not release its valid 200
                                    // until this exact stage was emitted.
                                    event_generation.fetch_add(1, Ordering::AcqRel);
                                    event_trace.record("broker.phase-a.page-invalidated", "page generation incremented with live COM deferral");
                                    event_phase_a.navigation_attempted.fetch_add(1, Ordering::Relaxed);
                                    if unsafe { event_core.Navigate(&HSTRING::from("about:blank")) }.is_err() {
                                        event_phase_a.note("native-navigation-attempt-failed");
                                    } else {
                                        event_phase_a.note("native-navigation-attempt-accepted");
                                    }
                                }
                                if callback_fault == BrokerFault::RendererCrashPending
                                    && !is_document
                                    && event_observer.scripted.load(Ordering::Acquire)
                                {
                                    event_phase_a.event(
                                        "renderer-termination-with-pending-dependent-deferral-armed",
                                        event_stats.pending.load(Ordering::Acquire),
                                    );
                                    event_stats.fault_triggered.store(true, Ordering::Release);
                                    // A DevTools Page.crash dispatch only
                                    // confirmed method invocation, not actual
                                    // renderer death in physical case xyMLZl.
                                    // Instead arm the parent to terminate its
                                    // *independently token-proven retained*
                                    // exact renderer HANDLE. The native
                                    // ProcessFailed event must then drain this
                                    // pending COM deferral or the test fails.
                                    event_trace.record(
                                        "broker.phase-a.renderer-crash.armed",
                                        "native renderer JS observed; real dependent COM deferral pending",
                                    );
                                    return Ok(());
                                }
                                if matches!(
                                    callback_fault,
                                    BrokerFault::BrowserCrashPending
                                ) && id == 1 {
                                    event_phase_a.event("native-crash-with-pending-deferral-armed", event_stats.pending.load(Ordering::Acquire));
                                    event_stats.fault_triggered.store(true, Ordering::Release);
                                    let method = if callback_fault == BrokerFault::RendererCrashPending {
                                        "Page.crash"
                                    } else {
                                        "Browser.crash"
                                    };
                                    let completion_trace = event_trace.clone();
                                    let completion_stats = event_stats.clone();
                                    let completion_generation = event_generation.clone();
                                    let completion_phase = event_phase_a.clone();
                                    let completion = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                                        move |result, _| {
                                            if result.is_err() {
                                                completion_phase.note("native-crash-command-rejected");
                                                completion_trace.error("broker.phase-a.native-crash.failed", "fixed native crash command rejected");
                                                completion_stats.errors.fetch_add(1, Ordering::Relaxed);
                                                completion_stats.broken.store(true, Ordering::Release);
                                                broker_drain_all_on_ui(
                                                    502, &completion_trace, &completion_stats,
                                                    &completion_generation, &completion_phase,
                                                );
                                            }
                                            Ok(())
                                        },
                                    ));
                                    if unsafe {
                                        event_core.CallDevToolsProtocolMethod(
                                            &HSTRING::from(method),
                                            &HSTRING::from("{}"),
                                            &completion,
                                        )
                                    }.is_ok() {
                                        event_phase_a.native_crash_dispatched.fetch_add(1, Ordering::Relaxed);
                                        event_trace.record("broker.phase-a.native-crash.dispatched", "fixed native crash COM method dispatched");
                                    } else {
                                        event_phase_a.note("native-crash-method-unavailable");
                                        event_stats.errors.fetch_add(1, Ordering::Relaxed);
                                        event_stats.broken.store(true, Ordering::Release);
                                        broker_drain_all_on_ui(
                                            502, &event_trace, &event_stats, &event_generation, &event_phase_a,
                                        );
                                    }
                                    // A native ProcessFailed or BrowserProcessExited
                                    // callback (never an artificial sleep)
                                    // completes/fails every outstanding deferral.
                                    return Ok(());
                                }
                                if callback_fault == BrokerFault::Cancel {
                                    event_stats.fault_triggered.store(true, Ordering::Release);
                                    event_stats.cancelled.fetch_add(1, Ordering::Relaxed);
                                    event_stats.denied.fetch_add(1, Ordering::Relaxed);
                                    event_stats.broken.store(true, Ordering::Release);
                                    event_trace.record("broker.fault.cancelled", "pending COM deferral cancelled locally");
                                    broker_finish_on_ui(
                                        id, BrokerPayload::denied(503), &event_trace, &event_stats, &event_generation, &event_phase_a,
                                    );
                                    return Ok(());
                                }
                                if callback_tx.try_send(BrokerTicket {
                                    id,
                                    url: uri,
                                    session: callback_session.clone(),
                                    page_generation: request_generation,
                                }).is_err() {
                                    event_stats.denied.fetch_add(1, Ordering::Relaxed);
                                    broker_finish_on_ui(
                                        id, BrokerPayload::denied(503), &event_trace, &event_stats, &event_generation, &event_phase_a,
                                    );
                                } else {
                                    event_stats.forwarded.fetch_add(1, Ordering::Relaxed);
                                }
                                Ok(())
                            }
                        ));
                        let mut token = 0;
                        unsafe {
                            core.add_WebResourceRequested(&handler, &mut token)?;
                        }
                        callback_stats.hook_ready.store(true, Ordering::Release);
                        callback_trace.record("broker.hook.ready", "HTTP HTTPS all contexts and sources filtered");
                        if callback_fault == BrokerFault::AbnormalExit {
                            // The runner terminates this bounded, real WebView2
                            // process to exercise job cleanup. Never navigate or
                            // issue a broker GET in this mode.
                            callback_stats.fault_triggered.store(true, Ordering::Release);
                            callback_trace.record("broker.fault.abnormal_exit.armed", "real WebView2 ready; navigation suppressed");
                            return Ok(());
                        }
                        unsafe { core.Navigate(&HSTRING::from(callback_url))?; }
                        callback_trace.record("broker.document.navigate", "controlled broker document navigation dispatched");
                        Ok(())
                    })();
                    if let Err(error) = installed {
                        callback_stats.errors.fetch_add(1, Ordering::Relaxed);
                        callback_stats.broken.store(true, Ordering::Release);
                        callback_trace.error("broker.hook.failed", &format!("HRESULT {}", error.code().0));
                    }
                }).map_err(|e| {
                    init_trace.error("broker.hook.dispatch.failed", &e.to_string());
                    e
                })?;

                let monitor_trace = init_trace.clone();
                let monitor_stats = setup_stats.clone();
                let monitor_observer = setup_observer.clone();
                let monitor_semantic = semantic.clone();
                let monitor_generation = page_generation.clone();
                let monitor_phase_a = phase_a.clone();
                let app_handle = app.handle().clone();
                thread::spawn(move || {
                    let start = Instant::now();
                    let mut script_at = None;
                    let mut broken_at = None;
                    let mut os_browser_acknowledged = false;
                    while start.elapsed() < WATCHDOG {
                        if let Ok(rows) = inventory(pid) {
                            if let Ok(mut owned) = monitor_observer.processes.lock() {
                                for row in rows { owned.insert(row.pid, row); }
                            }
                        }
                        if monitor_observer.scripted.load(Ordering::Acquire) && script_at.is_none() {
                            script_at = Some(Instant::now());
                        }
                        if fault.awaits_parent_os_browser_proof() && !os_browser_acknowledged {
                            // Pre-document cancellation/shutdown can finish
                            // genuine COM 503 before Win32_Process returns the
                            // child role. Wait for the case-owned parent to
                            // attest an original, live OS HANDLE + SID/job;
                            // a missing/malformed marker hits the existing
                            // WATCHDOG, never a successful physical receipt.
                            if fs::read(root.join(PHASE_A_OS_BROWSER_ACK_FILE))
                                .is_ok_and(|bytes| bytes == PHASE_A_OS_BROWSER_ACK_BYTES)
                            {
                                os_browser_acknowledged = true;
                                monitor_phase_a.note("independent-os-browser-acknowledged");
                                monitor_trace.record(
                                    "broker.phase-a.parent-os-browser-verified",
                                    "parent independently attested live browser and zero-capability job",
                                );
                            }
                        }
                        // A renderer-crash fixture cannot close the host just
                        // because its test document executed two seconds ago.
                        // The separately owned Windows runner must first find
                        // a live renderer, verify its original process HANDLE,
                        // token and job membership, then terminate precisely
                        // that handle. Keep the pending COM deferral armed until
                        // native ProcessFailed arrives (or the existing hard
                        // WATCHDOG bounds the case). This is an event barrier,
                        // not a longer sleep or permission to infer a crash.
                        let awaiting_renderer_failure = fault.awaits_actual_renderer_failure(
                            monitor_stats.pending.load(Ordering::Acquire) != 0,
                            monitor_phase_a.process_failed.load(Ordering::Acquire) != 0,
                        );
                        if !awaiting_renderer_failure
                            && script_at.is_some_and(|t| t.elapsed() >= Duration::from_secs(2))
                            && (fault != BrokerFault::None
                                || monitor_semantic.finished.load(Ordering::Acquire)
                                || script_at.is_some_and(|t| t.elapsed() >= Duration::from_secs(4)))
                        {
                            break;
                        }
                        if monitor_stats.broken.load(Ordering::Acquire)
                            && (!fault.awaits_parent_os_browser_proof() || os_browser_acknowledged)
                        {
                            // Allow a bounded UI-thread dispatch to complete the
                            // synthetic 502/503/504 and its COM deferral before
                            // stopping WebView2 for a fault-injection case.
                            let since = broken_at.get_or_insert_with(Instant::now);
                            let forwarded = monitor_stats.forwarded.load(Ordering::Acquire);
                            let answered = monitor_stats.answered.load(Ordering::Acquire);
                            if (answered >= forwarded && monitor_stats.pending.load(Ordering::Acquire) == 0)
                                || since.elapsed() >= Duration::from_millis(900) {
                                break;
                            }
                        }
                        thread::sleep(Duration::from_millis(120));
                    }
                    if fault.is_phase_a() && monitor_stats.pending.load(Ordering::Acquire) != 0 {
                        // Do not tear down Tauri with an outstanding native
                        // deferral. The existing global watchdog is the only
                        // fallback when a prerequisite WebView2 event never
                        // arrives. Drain on the UI apartment and wait for an
                        // explicit acknowledgment, not an arbitrary delay.
                        let (ack_tx, ack_rx) = mpsc::sync_channel(1);
                        let trace = monitor_trace.clone();
                        let stats = monitor_stats.clone();
                        let phase = monitor_phase_a.clone();
                        let generation = monitor_generation.clone();
                        let dispatched = app_handle.run_on_main_thread(move || {
                            stats.broken.store(true, Ordering::Release);
                            phase.note("watchdog-draining-unresolved-deferrals");
                            let drained = broker_drain_all_on_ui(
                                504, &trace, &stats, &generation, &phase
                            );
                            let _ = ack_tx.send(drained);
                        });
                        if dispatched.is_err()
                            || ack_rx.recv_timeout(Duration::from_secs(2)).is_err()
                        {
                            monitor_trace.error("broker.phase-a.watchdog-drain.failed", "native deferral completion acknowledgement unavailable");
                            std::process::exit(1);
                        }
                    }
                    let scripted = monitor_observer.scripted.load(Ordering::Acquire);
                    let children: Vec<_> = monitor_observer.processes.lock()
                        .map(|held| held.values().cloned().collect())
                        .unwrap_or_default();
                    let webview_pids: Vec<_> = children.iter()
                        .filter(|p| p.image_name.eq_ignore_ascii_case("msedgewebview2.exe"))
                        .map(|p| p.pid).collect();
                    let ready = monitor_stats.hook_ready.load(Ordering::Acquire);
                    let forwarded = monitor_stats.forwarded.load(Ordering::Acquire);
                    let answered = monitor_stats.answered.load(Ordering::Acquire);
                    let errors = monitor_stats.errors.load(Ordering::Acquire);
                    let (semantic_status, semantic_error, semantic_proof) = monitor_semantic.receipt();
                    let semantic_current = semantic_proof.as_ref().is_some_and(|proof| {
                        proof.page_generation == monitor_generation.load(Ordering::Acquire)
                            && !monitor_stats.broken.load(Ordering::Acquire)
                    });
                    let semantic_status = if semantic_status == "verified" && !semantic_current {
                        "invalidated"
                    } else {
                        semantic_status
                    };
                    let semantic_proof = if semantic_current { semantic_proof } else { None };
                    let success = fault == BrokerFault::None && ready && scripted && !webview_pids.is_empty()
                        && forwarded > 0 && answered > 0 && errors == 0
                        && monitor_stats.pending.load(Ordering::Acquire) == 0
                        && !monitor_stats.broken.load(Ordering::Acquire);
                    result_from_thread.store(success, Ordering::Release);
                    report(&root, &json!({
                        "kind": "clack-browser-host",
                        "mode": "brokered-child",
                        "brokerFaultMode": fault.label(),
                        "brokerFaultTriggered": monitor_stats.fault_triggered.load(Ordering::Acquire),
                        "brokerTimeouts": monitor_stats.timeouts.load(Ordering::Acquire),
                        "brokerCancelled": monitor_stats.cancelled.load(Ordering::Acquire),
                        "hostPid": pid,
                        "hostToken": token,
                        "appContainer": token.app_container,
                        "udf": udf,
                        "fixtureHost": "127.0.0.1",
                        "fixturePort": port,
                        "fixtureNonce": args.nonce,
                        "brokerHookReady": ready,
                        "brokerIntercepted": monitor_stats.intercepted.load(Ordering::Acquire),
                        "brokerForwarded": forwarded,
                        "brokerAnswered": answered,
                        "brokerPendingCount": monitor_stats.pending.load(Ordering::Acquire),
                        "brokerDenied": monitor_stats.denied.load(Ordering::Acquire),
                        "brokerErrors": errors,
                        "brokerLastSyntheticStatus": monitor_stats.last_synthetic_status(),
                        "brokerCompleted2xx": monitor_stats.status_2xx.load(Ordering::Acquire),
                        "brokerCompleted4xx": monitor_stats.status_4xx.load(Ordering::Acquire),
                        "brokerCompleted5xx": monitor_stats.status_5xx.load(Ordering::Acquire),
                        "brokerSynthetic502": monitor_stats.synthetic_502.load(Ordering::Acquire),
                        "brokerSynthetic503": monitor_stats.synthetic_503.load(Ordering::Acquire),
                        "brokerSynthetic504": monitor_stats.synthetic_504.load(Ordering::Acquire),
                        "scriptObserved": scripted,
                        "rendererDomProof": scripted,
                        "brokerSemanticSnapshotStatus": semantic_status,
                        "brokerSemanticSnapshotVerified": semantic_current,
                        "brokerSemanticSnapshotError": semantic_error,
                        "brokerSemanticSnapshot": semantic_proof,
                        "phaseA": if fault.is_phase_a() {
                            Some(monitor_phase_a.receipt(fault, &monitor_stats))
                        } else {
                            None
                        },
                        "webviewProcessIds": webview_pids,
                        "processes": children,
                        "elapsedMs": start.elapsed().as_millis(),
                        "success": success,
                        "error": if !ready { Some("native WebView2 HTTP/HTTPS request interception unavailable") }
                            else if errors != 0 { Some("broker pipe or COM request failed") }
                            else if fault != BrokerFault::None && !monitor_stats.fault_triggered.load(Ordering::Acquire) { Some("configured broker fault was not observed") }
                            else if fault != BrokerFault::None { Some("acceptance-only broker fault triggered") }
                            else if !scripted { Some("brokered renderer document title not observed") }
                            else if forwarded == 0 || answered == 0 { Some("brokered request/response proof missing") }
                            else if webview_pids.is_empty() { Some("WebView2 child process not observed") }
                            else { None::<&str> },
                    }), &monitor_trace);
                    app_handle.exit(if success { 0 } else { 1 });
                });
                init_trace.record("broker.tauri.setup.ok", "broker UI and monitor scheduled");
                Ok(())
            })
            .build(context).map_err(|e| format!("brokered WebView2 host init: {e}"))?;
        trace.record(
            "broker.tauri.run",
            "entering native brokered WebView2 event loop",
        );
        app.run(|_, _| {});
        if !result_flag.load(Ordering::Acquire) {
            trace.error(
                "broker.tauri.no_success",
                "event loop ended without brokered renderer proof",
            );
            std::process::exit(1);
        }
        Ok(())
    }

    fn run(args: Args, trace: Arc<StartupTrace>) -> Result<(), String> {
        trace.record(
            "environment.checked",
            &format!(
                "webviewUdfOverride {} webviewExecutableOverride {} webviewArgumentsPresent {} tempPresent {} tmpPresent {} localAppDataPresent {} appDataPresent {} cwdAccessible {}",
                std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_some(),
                std::env::var_os("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER").is_some(),
                std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_some(),
                std::env::var_os("TEMP").is_some(),
                std::env::var_os("TMP").is_some(),
                std::env::var_os("LOCALAPPDATA").is_some(),
                std::env::var_os("APPDATA").is_some(),
                std::env::current_dir().is_ok(),
            ),
        );
        trace.record("identity.token.begin", "querying current process token");
        let token = own_token().map_err(|e| {
            trace.error("identity.token.failed", &e);
            e
        })?;
        trace.record(
            "identity.token.ok",
            &format!(
                "appContainer {} capabilityCount {} appContainerSid {}",
                token.app_container,
                token.capability_sids.len(),
                token.app_container_sid.as_deref().unwrap_or("none")
            ),
        );
        match args.mode {
            Mode::Isolated | Mode::Brokered
                if !token.app_container || !token.capability_sids.is_empty() =>
            {
                return Err(format!("isolated child requires AppContainer no-capabilities token, actual container={} capabilities={}",
                    token.app_container, token.capability_sids.len()));
            }
            Mode::PositiveControl if token.app_container => {
                return Err("positive control requires ordinary token".into())
            }
            _ => {}
        }
        trace.record("identity.mode.ok", "token matches acceptance mode");
        trace.record("udf.entropy.begin", "requesting unique UDF entropy");
        let mut bytes = [0u8; 12];
        getrandom::fill(&mut bytes).map_err(|e| {
            trace.error("udf.entropy.failed", &e.to_string());
            format!("UDF entropy: {e}")
        })?;
        trace.record("udf.entropy.ok", "unique UDF entropy acquired");
        let salt = bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
        let udf = args
            .root
            .join(format!("webview2-{}-{salt}", std::process::id()));
        trace.record("udf.create.begin", "creating unique case-owned UDF");
        fs::create_dir(&udf).map_err(|e| {
            trace.error("udf.create.failed", &io_error(&e));
            format!("create unique UDF: {e}")
        })?;
        trace.record("udf.create.ok", "unique case-owned UDF created");
        trace.record("udf.access.begin", "probing read write and delete access");
        udf_access_probe(&udf, &trace).map_err(|e| {
            trace.error("udf.access.failed", &io_error(&e));
            format!("UDF access: {e}")
        })?;
        trace.record(
            "udf.access.ok",
            "host token has UDF read write delete access",
        );
        if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_some() {
            trace.record(
                "udf.override.present",
                "environment may override requested data directory",
            );
        }
        if args.mode == Mode::Brokered {
            return run_brokered(args, trace, token, udf);
        }
        let observer = Arc::new(Observed::default());
        let marker = format!("{RENDER_MARKER}{}", args.nonce);
        let fixture_mode = if args.mode == Mode::Isolated {
            "isolated"
        } else {
            "control"
        };
        let html = fixture_html(args.fixture_port, &args.nonce, fixture_mode);
        let inject_html = format!(
            "document.open();document.write({});document.close();",
            serde_json::to_string(&html).map_err(|e| e.to_string())?
        );
        trace.record("fixture.prepared", "fixed loopback fixture encoded");
        let root = args.root.clone();
        let mode = args.mode;
        let pid = std::process::id();
        trace.record("tauri.context.begin", "constructing Tauri context");
        let mut context = tauri::generate_context!();
        context.config_mut().app.windows.clear();
        trace.record(
            "tauri.context.ok",
            "Tauri context configured without default windows",
        );
        let on_load = observer.clone();
        let on_title = observer.clone();
        let title_marker = marker.clone();
        let on_run = observer.clone();
        let result_flag = Arc::new(AtomicBool::new(false));
        let result_from_thread = result_flag.clone();
        let load_trace = trace.clone();
        let setup_trace = trace.clone();
        let title_trace = trace.clone();
        let monitor_trace = trace.clone();
        trace.record("tauri.builder.begin", "constructing Tauri builder");
        let builder = tauri::Builder::default()
            .on_page_load(move |_webview, event| {
                if matches!(event.event(), PageLoadEvent::Finished) {
                    load_trace.record("tauri.page.finished", "WebView document load finished");
                    on_load.loaded.store(true, Ordering::Release);
                    if event.url().as_str().contains(&marker) {
                        on_load.scripted.store(true, Ordering::Release);
                        load_trace.record("tauri.page.marker", "WebView document marker observed");
                    }
                }
            })
            .setup(move |app| {
                setup_trace.record("tauri.setup.enter", "Tauri setup callback entered");
                setup_trace.record("webview.controller.begin", "building hidden WebView2 controller");
                let webview = WebviewWindowBuilder::new(
                    app, "browser-host",
                    WebviewUrl::External("about:blank".parse().map_err(std::io::Error::other)?),
                )
                .visible(false)
                // The zero-capability AppContainer cannot register an OS drag/drop target.
                // This hidden acceptance window never accepts native file drops.
                .drag_and_drop(false)
                .data_directory(udf.clone())
                .on_document_title_changed(move |_webview, title| {
                    if title == title_marker {
                        on_title.scripted.store(true, Ordering::Release);
                        title_trace.record("webview.dom.marker", "native DOM title event observed");
                    }
                })
                .build()
                .map_err(|e| {
                    setup_trace.error("webview.controller.failed", &error_chain(&e));
                    e
                })?;
                setup_trace.record("webview.controller.ok", "hidden WebView2 controller created");
                // Initial about:blank does not necessarily dispatch an ordinary
                // navigation-completed event. The controller exists here; send
                // the fixed HTML immediately through the real WebView2 engine.
                setup_trace.record("webview.eval.begin", "sending fixed HTML into controller");
                webview.eval(&inject_html).map_err(|e| {
                    setup_trace.error("webview.eval.failed", &error_chain(&e));
                    e
                })?;
                setup_trace.record("webview.eval.ok", "fixed HTML dispatched to controller");
                let app = app.handle().clone();
                setup_trace.record("watchdog.spawn.begin", "starting bounded child monitor");
                thread::spawn(move || {
                    let start = Instant::now();
                    let mut script_at = None;
                    loop {
                        if let Ok(rows) = inventory(pid) {
                            if let Ok(mut owned) = on_run.processes.lock() {
                                for row in rows { owned.insert(row.pid, row); }
                            }
                        }
                        if on_run.scripted.load(Ordering::Acquire) && script_at.is_none() {
                            script_at = Some(Instant::now());
                        }
                        if script_at.is_some_and(|t| t.elapsed() >= Duration::from_secs(2))
                            || start.elapsed() >= WATCHDOG { break; }
                        thread::sleep(Duration::from_millis(120));
                    }
                    let loaded = on_run.loaded.load(Ordering::Acquire);
                    let scripted = on_run.scripted.load(Ordering::Acquire);
                    let children: Vec<_> = on_run.processes.lock()
                        .map(|held| held.values().cloned().collect())
                        .unwrap_or_default();
                    let webview_pids: Vec<u32> = children.iter()
                        .filter(|p| p.image_name.eq_ignore_ascii_case("msedgewebview2.exe"))
                        .map(|p| p.pid).collect();
                    // A verified native title event proves the DOM script ran
                    // even when about:blank has no PageLoad Finished callback.
                    let success = scripted && !webview_pids.is_empty();
                    result_from_thread.store(success, Ordering::Release);
                    monitor_trace.record(
                        "watchdog.complete",
                        &format!("scripted {} webviewChildren {} success {}", scripted, webview_pids.len(), success),
                    );
                    report(&root, &json!({
                        "kind":"clack-browser-host",
                        "mode":if mode == Mode::Isolated {"isolated-child"} else {"positive-control"},
                        "hostPid":pid,
                        "hostToken":token,
                        "appContainer":token.app_container,
                        "udf":udf,
                        "fixtureHost":"127.0.0.1",
                        "fixturePort":args.fixture_port,
                        "fixtureNonce":args.nonce,
                        "webviewLoadFinished":loaded,
                        "scriptObserved":scripted,
                        "rendererDomProof":scripted,
                        "webviewProcessIds":webview_pids,
                        "processes":children,
                        "elapsedMs":start.elapsed().as_millis(),
                        "success":success,
                        "error":if !scripted { Some("native renderer DOM title / JS navigation not observed") }
                                 else if webview_pids.is_empty() { Some("WebView2 child process not observed") }
                                 else { None::<&str> },
                    }), &monitor_trace);
                    app.exit(if success { 0 } else { 1 });
                });
                setup_trace.record("tauri.setup.ok", "controller and bounded monitor initialized");
                Ok(())
            });
        trace.record("tauri.build.begin", "initializing native Tauri runtime");
        let app = builder.build(context).map_err(|e| {
            trace.error("tauri.build.failed", &error_chain(&e));
            format!("WebView2 host init: {e}")
        })?;
        trace.record("tauri.build.ok", "native Tauri runtime initialized");
        trace.record("tauri.run.begin", "entering native event loop");
        app.run(|_, _| {});
        trace.record("tauri.run.returned", "native event loop finished");
        if !result_flag.load(Ordering::Acquire) {
            // Tauri's run callback may return normally even following
            // AppHandle::exit(1); keep the process exit code trustworthy.
            trace.error(
                "tauri.run.no_success",
                "event loop ended without successful renderer proof",
            );
            std::process::exit(1);
        }
        Ok(())
    }

    pub fn main() {
        let trace = Arc::new(StartupTrace::new());
        let panic_trace = trace.clone();
        std::panic::set_hook(Box::new(move |info| panic_trace.panic(info)));
        trace.record(
            "process.entry",
            "panic hook installed before argument parsing",
        );
        match own_parent_pid() {
            Ok(parent) => trace.record("process.identity", &format!("parentPid {parent}")),
            Err(e) => trace.error("process.parent.unavailable", &e),
        }
        trace.record("args.parse.begin", "parsing bounded acceptance arguments");
        let mut validated_root = None;
        let result = match args() {
            Ok(args) => {
                validated_root = Some(args.root.clone());
                trace.attach_case_root(&args.root);
                trace.record(
                    "args.parse.ok",
                    "validated absolute case root and fixture arguments",
                );
                run(args, trace.clone())
            }
            Err(e) => {
                trace.error("args.parse.failed", &e);
                Err(e)
            }
        };
        if let Err(error) = result {
            trace.error("process.failed", &error);
            let failed = json!({"kind":"clack-browser-host","hostPid":std::process::id(),
                "success":false,"error":safe_detail(&error)});
            if let Some(root) = validated_root {
                report(&root, &failed, &trace);
            } else {
                println!("{failed}");
            }
            std::process::exit(1);
        }
        trace.record("process.success", "acceptance host exited successfully");
    }

    #[cfg(test)]
    mod broker_contract_tests {
        use super::*;

        const NONCE: &str = "0123456789abcdef0123456789abcdef";

        #[test]
        fn only_exact_case_owned_get_urls_can_reach_the_parent() {
            assert!(broker_owned_url(
                &format!("http://127.0.0.1:1234/document/broker/{NONCE}"),
                1234,
                NONCE
            ));
            assert!(broker_owned_url(
                &format!("http://127.0.0.1:1234/deny/broker/{NONCE}"),
                1234,
                NONCE
            ));
            for url in [
                format!("http://[::1]:1234/document/broker/{NONCE}"),
                format!("https://127.0.0.1:1234/document/broker/{NONCE}"),
                format!("http://127.0.0.1:1234/document/broker/{NONCE}?extra=1"),
                format!("http://127.0.0.1:1235/document/broker/{NONCE}"),
                format!("http://127.0.0.1:1234/document/broker/other"),
                format!("http://example.com:1234/document/broker/{NONCE}"),
            ] {
                assert!(
                    !broker_owned_url(&url, 1234, NONCE),
                    "url was incorrectly accepted: {url}"
                );
            }
        }

        #[test]
        fn parent_reply_must_match_session_id_and_bounded_body() {
            let body = BASE64.encode([0, 255, 1, 2]);
            let wire = json!({
                "version":1, "session":NONCE, "requestId":3, "status":200,
                "contentType":"image/png", "bodyBase64":body,
            });
            let bytes = serde_json::to_vec(&wire).unwrap();
            let ok = broker_reply(&bytes, NONCE, 3).unwrap();
            assert_eq!(ok.body, [0, 255, 1, 2]);
            assert!(broker_reply(&bytes, NONCE, 4).is_err());
            assert!(broker_reply(&bytes, "wrong", 3).is_err());
            let mut tampered = wire;
            tampered["contentType"] = json!("text/plain\r\nLocation: http://example.com/");
            assert!(broker_reply(&serde_json::to_vec(&tampered).unwrap(), NONCE, 3).is_err());
            tampered["contentType"] = json!("image/png");
            tampered["status"] = json!(302);
            assert!(broker_reply(&serde_json::to_vec(&tampered).unwrap(), NONCE, 3).is_err());
        }

        #[test]
        fn broker_fault_flags_are_explicit_and_short_lived() {
            for label in [
                "none",
                "crash",
                "timeout",
                "no-intercept",
                "stale-id",
                "stale-session",
                "abnormal-exit",
                "cancel",
                "missing-reply",
                "stale-page-generation",
                "stale-broker-request",
                "duplicate-completion",
                "dependent-resource",
                "pending-cancel",
                "renderer-crash",
                "host-crash",
                "shutdown-pending",
                "browser-crash-pending",
            ] {
                assert!(
                    BrokerFault::parse(label).is_ok(),
                    "unsupported label {label}"
                );
            }
            assert!(BrokerFault::parse("network-allow").is_err());
            assert!(BrokerFault::parse("CRASH").is_err());
            assert!(BrokerFault::Timeout.reply_deadline() < BROKER_REPLY_DEADLINE);
            assert!(BROKER_REPLY_DEADLINE < WATCHDOG);
            assert_eq!(BrokerFault::MissingIntercept.label(), "no-intercept");
            let canonical = [
                ("page-race", "stale-page-generation"),
                ("duplicate-parent", "stale-broker-request"),
                ("duplicate-late", "duplicate-completion"),
                ("dependent-drain", "dependent-resource"),
                ("cancel-pending", "pending-cancel"),
                ("renderer-crash-pending", "renderer-crash"),
                ("host-exit-pending", "host-crash"),
            ];
            for (alias, report_label) in canonical {
                assert_eq!(BrokerFault::parse(alias).unwrap().label(), report_label);
                assert!(BrokerFault::parse(alias).unwrap().is_phase_a());
            }
            assert!(!BrokerFault::StaleId.is_phase_a());
            assert!(!BrokerFault::Cancel.is_phase_a());
            assert!(BrokerFault::ShutdownPending.is_phase_a());
        }

        #[test]
        fn pending_renderer_failure_cannot_be_replaced_by_a_script_timeout() {
            assert!(BrokerFault::RendererCrashPending.awaits_actual_renderer_failure(true, false));
            assert!(!BrokerFault::RendererCrashPending.awaits_actual_renderer_failure(false, false));
            assert!(!BrokerFault::RendererCrashPending.awaits_actual_renderer_failure(true, true));
            for kind in [
                BrokerFault::None,
                BrokerFault::DependentDrain,
                BrokerFault::HostExitPending,
            ] {
                assert!(!kind.awaits_actual_renderer_failure(true, false));
            }
        }

        #[test]
        fn pre_document_cancel_and_shutdown_require_independent_os_ack() {
            assert!(BrokerFault::CancelPending.awaits_parent_os_browser_proof());
            assert!(BrokerFault::ShutdownPending.awaits_parent_os_browser_proof());
            for kind in [
                BrokerFault::None,
                BrokerFault::HostExitPending,
                BrokerFault::RendererCrashPending,
            ] {
                assert!(!kind.awaits_parent_os_browser_proof());
            }
        }

        fn local_pipe() -> (File, File) {
            use windows_sys::Win32::System::Pipes::CreatePipe;
            let mut reader = null_mut();
            let mut writer = null_mut();
            let ok = unsafe { CreatePipe(&mut reader, &mut writer, null_mut(), 4096) };
            assert_ne!(ok, 0, "create test-owned anonymous pipe");
            (unsafe { File::from_raw_handle(reader.cast()) }, unsafe {
                File::from_raw_handle(writer.cast())
            })
        }

        #[test]
        fn bounded_reply_reader_drains_frames_larger_than_pipe_buffer() {
            let (mut reader, mut writer) = local_pipe();
            let data = vec![b'a'; 120 * 1024];
            let expected = data.clone();
            let producer = thread::spawn(move || broker_write_frame(&mut writer, &data));
            let actual = broker_read_frame(&mut reader, Duration::from_secs(4)).unwrap();
            assert_eq!(actual, expected);
            producer.join().unwrap().unwrap();
        }

        #[test]
        fn missing_reply_times_out_without_blocking_forever() {
            let (mut reader, writer) = local_pipe();
            let start = Instant::now();
            let error = broker_read_frame(&mut reader, Duration::from_millis(60)).unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::TimedOut);
            assert!(start.elapsed() < Duration::from_secs(1));
            drop(writer);
        }

        #[test]
        fn closed_broker_reply_pipe_fails_before_deadline() {
            let (mut reader, writer) = local_pipe();
            drop(writer);
            let start = Instant::now();
            let error = broker_read_frame(&mut reader, Duration::from_secs(3)).unwrap_err();
            assert_ne!(error.kind(), io::ErrorKind::TimedOut);
            assert!(start.elapsed() < Duration::from_secs(1));
        }

        #[test]
        fn stale_session_and_stale_request_id_never_deliver_html() {
            let response = serde_json::to_vec(&json!({
                "version": 1, "session": NONCE, "requestId": 42,
                "status": 200, "contentType": "text/html",
                "bodyBase64": BASE64.encode(b"<html>synthetic</html>"),
            }))
            .unwrap();
            assert!(broker_reply(&response, NONCE, 42).is_ok());
            assert_eq!(
                broker_reply(&response, &format!("x{NONCE}"), 42).unwrap_err(),
                "broker reply session mismatch"
            );
            assert_eq!(
                broker_reply(&response, NONCE, 41).unwrap_err(),
                "broker reply requestId mismatch"
            );
        }

        #[test]
        fn response_counters_do_not_claim_com_completion_before_recording() {
            let stats = BrokerStats::default();
            assert_eq!(stats.last_synthetic_status(), None);
            assert_eq!(stats.answered.load(Ordering::Relaxed), 0);
            assert_eq!(stats.status_5xx.load(Ordering::Relaxed), 0);

            // The helper is called only after SetResponse AND Complete (or
            // synchronous SetResponse with no deferral) succeed in production.
            stats.note_com_response(&BrokerPayload {
                status: 200,
                content_type: "text/html".to_owned(),
                body: b"ok".to_vec(),
                synthetic: false,
                binding: None,
            });
            assert_eq!(stats.status_2xx.load(Ordering::Relaxed), 1);
            assert_eq!(stats.last_synthetic_status(), None);
            for code in [502u16, 503, 504] {
                stats.note_com_response(&BrokerPayload::denied(code));
                assert_eq!(stats.last_synthetic_status(), Some(code));
            }
            assert_eq!(stats.status_5xx.load(Ordering::Relaxed), 3);
            assert_eq!(stats.synthetic_502.load(Ordering::Relaxed), 1);
            assert_eq!(stats.synthetic_503.load(Ordering::Relaxed), 1);
            assert_eq!(stats.synthetic_504.load(Ordering::Relaxed), 1);
            // This pure helper never grants an implicit deferred answer.
            assert_eq!(stats.answered.load(Ordering::Relaxed), 0);
        }

        #[test]
        fn session_fault_or_new_page_revokes_late_valid_response() {
            assert!(!broker_reply_must_be_denied(false, false, 1, 1));
            assert!(broker_reply_must_be_denied(false, true, 1, 1));
            assert!(broker_reply_must_be_denied(false, false, 1, 2));
            // A synthetic 504 still completes the current request after a
            // pipe fault; it must not silently turn into a successful 200.
            assert!(!broker_reply_must_be_denied(true, true, 1, 1));
            assert!(broker_reply_must_be_denied(true, true, 1, 2));
        }

        #[test]
        fn phase_a_identity_binds_exact_session_request_url_and_generation() {
            let binding = BrokerBinding {
                request_id: 7,
                session: NONCE.into(),
                url: semantic_case_url(),
                page_generation: 1,
            };
            assert!(broker_binding_matches_values(
                7,
                NONCE,
                &semantic_case_url(),
                1,
                &binding
            ));
            assert!(!broker_binding_matches_values(
                8,
                NONCE,
                &semantic_case_url(),
                1,
                &binding
            ));
            assert!(!broker_binding_matches_values(
                7,
                "invalid-session",
                &semantic_case_url(),
                1,
                &binding
            ));
            assert!(!broker_binding_matches_values(
                7,
                NONCE,
                "http://127.0.0.1:1234/other",
                1,
                &binding
            ));
            assert!(!broker_binding_matches_values(
                7,
                NONCE,
                &semantic_case_url(),
                2,
                &binding
            ));
        }

        #[test]
        fn phase_a_replayed_parent_frame_is_detectable_without_second_request() {
            let (mut reader, mut writer) = local_pipe();
            let response = serde_json::to_vec(&json!({
                "version": 1, "session": NONCE, "requestId": 5,
                "status": 200, "contentType": "text/html",
                "bodyBase64": BASE64.encode(b"approved fixture")
            }))
            .unwrap();
            broker_write_frame(&mut writer, &response).unwrap();
            broker_write_frame(&mut writer, &response).unwrap();
            let first = broker_read_frame(&mut reader, Duration::from_millis(500)).unwrap();
            let unsolicited = broker_read_frame(&mut reader, Duration::from_millis(500)).unwrap();
            assert_eq!(first, unsolicited);
            assert_eq!(
                broker_reply(&first, NONCE, 5).unwrap().body,
                b"approved fixture"
            );
            assert!(broker_reply(&unsolicited, NONCE, 5).is_ok());
            // The worker's DuplicateParent branch rejects the second frame,
            // and returns a local synthetic 502 without installing either.
            assert_eq!(
                broker_reply(&unsolicited, NONCE, 6).unwrap_err(),
                "broker reply requestId mismatch"
            );
        }

        #[test]
        fn phase_a_static_event_report_is_bounded_and_no_user_values_escape() {
            let phase = PhaseA::default();
            let stats = BrokerStats::default();
            stats.pending.store(3, Ordering::Release);
            phase.event(
                "pending-cancel-before-reply",
                stats.pending.load(Ordering::Acquire),
            );
            for _ in 0..100 {
                phase.note("native-com-event");
            }
            phase.suppressed_late.store(1, Ordering::Release);
            let receipt = phase.receipt(BrokerFault::CancelPending, &stats);
            assert_eq!(receipt["scenario"], "pending-cancel");
            assert_eq!(receipt["triggered"], true);
            assert_eq!(receipt["pendingAtTrigger"], 3);
            assert_eq!(receipt["pendingAtExit"], 3);
            assert_eq!(receipt["completedResponseCount"], 0);
            assert_eq!(receipt["suppressedLateCount"], 1);
            assert!(receipt["events"].as_array().unwrap().len() <= 20);
            assert!(receipt["networkEgressVerified"].is_null());
        }

        #[test]
        fn phase_a_cancellation_ack_is_event_driven_and_parent_reply_never_replays() {
            let (ack_tx, ack_rx) = mpsc::sync_channel(1);
            let stats = BrokerStats::default();
            stats.pending.store(1, Ordering::Release);
            let phase = PhaseA::default();
            phase.event(
                "pending-cancel-before-reply",
                stats.pending.load(Ordering::Acquire),
            );
            stats.cancelled.fetch_add(1, Ordering::Release);
            // The real worker waits for a UI thread acknowledgment before
            // consuming parent reply bytes; this test needs no delay.
            ack_tx.send(()).unwrap();
            ack_rx.recv_timeout(Duration::from_millis(100)).unwrap();
            let response = BrokerPayload::denied(503);
            assert!(response.synthetic);
            assert!(response.binding.is_none());
            assert!(broker_reply_must_be_denied(false, true, 1, 1));
        }

        fn semantic_case_url() -> String {
            format!("http://127.0.0.1:1234/document/broker/{NONCE}")
        }

        fn semantic_case_title() -> String {
            format!("{RENDER_MARKER}{NONCE}")
        }

        fn semantic_case_json() -> serde_json::Value {
            let landmark = "Clack brokered WebView2";
            json!({
                "version": 1,
                "url": semantic_case_url(),
                "title": semantic_case_title(),
                "visited": 3,
                "textBytes": landmark.len(),
                "truncated": false,
                "elements": [{
                    "index": 1,
                    "role": "main",
                    "name": landmark
                }]
            })
        }

        #[test]
        fn semantic_script_is_fixed_and_bounds_traversal_before_emitting_json() {
            assert!(SEMANTIC_SNAPSHOT_JS.contains("maxVisits = 512"));
            assert!(SEMANTIC_SNAPSHOT_JS.contains("maxElements = 64"));
            assert!(SEMANTIC_SNAPSHOT_JS.contains("maxTextBytes = 32768"));
            assert!(SEMANTIC_SNAPSHOT_JS.contains("createTreeWalker"));
            for forbidden in [
                "innerHTML",
                "outerHTML",
                "innerText",
                "querySelectorAll",
                ".value",
                "document.cookie",
                "localStorage",
                "sessionStorage",
                "fetch(",
                "XMLHttpRequest",
            ] {
                assert!(
                    !SEMANTIC_SNAPSHOT_JS.contains(forbidden),
                    "unsafe script feature: {forbidden}"
                );
            }
            assert!(SEMANTIC_SNAPSHOT_JS.contains("['button','submit','reset','checkbox','radio']"));
        }

        #[test]
        fn semantic_snapshot_verified_against_native_session_source_and_epoch() {
            let raw = semantic_case_json().to_string();
            let proof =
                verify_semantic_snapshot(&raw, &semantic_case_url(), &semantic_case_title(), 1, 1)
                    .unwrap();
            assert!(proof.session_verified);
            assert_eq!(proof.session, NONCE);
            assert_eq!(proof.origin, "http://127.0.0.1:1234");
            assert_eq!(proof.page_generation, 1);
            assert_eq!(proof.snapshot_generation, 1);
            assert!(proof.observed_at_ms > 0);
            assert_eq!(proof.snapshot.elements[0].role, "main");
            assert_eq!(proof.redacted_labels, 0);
            assert!(!proof.snapshot.truncated);
        }

        #[test]
        fn semantic_snapshot_fails_closed_for_stale_or_spoofed_page() {
            let raw = semantic_case_json().to_string();
            assert_eq!(
                verify_semantic_snapshot(&raw, &semantic_case_url(), &semantic_case_title(), 1, 2,)
                    .unwrap_err(),
                "snapshot-page-stale"
            );
            assert_eq!(
                verify_semantic_snapshot(&raw, &semantic_case_url(), &semantic_case_title(), 0, 0,)
                    .unwrap_err(),
                "snapshot-page-stale"
            );
            assert!(verify_semantic_snapshot(
                &raw,
                "https://example.com/document/broker/other",
                &semantic_case_title(),
                1,
                1,
            )
            .is_err());
            assert!(
                verify_semantic_snapshot(&raw, &semantic_case_url(), "wrong-title", 1, 1,).is_err()
            );
            let mut spoofed = semantic_case_json();
            spoofed["url"] = json!("http://127.0.0.1:1234/other");
            assert!(verify_semantic_snapshot(
                &spoofed.to_string(),
                &semantic_case_url(),
                &semantic_case_title(),
                1,
                1,
            )
            .is_err());
        }

        #[test]
        fn semantic_snapshot_rejects_oversized_malformed_or_forged_fields() {
            let valid_url = semantic_case_url();
            let valid_title = semantic_case_title();
            let check = |value: &serde_json::Value| {
                verify_semantic_snapshot(&value.to_string(), &valid_url, &valid_title, 1, 1)
            };
            assert_eq!(
                verify_semantic_snapshot(
                    &"x".repeat(SEMANTIC_MAX_JSON_BYTES + 1),
                    &valid_url,
                    &valid_title,
                    1,
                    1,
                )
                .unwrap_err(),
                "snapshot-json-over-limit"
            );
            let mut invalid = semantic_case_json();
            invalid["visited"] = json!(SEMANTIC_MAX_VISITS + 1);
            assert!(check(&invalid).is_err());
            invalid = semantic_case_json();
            invalid["elements"][0]["name"] = json!("x".repeat(SEMANTIC_MAX_LABEL_CHARS + 1));
            invalid["textBytes"] = json!(SEMANTIC_MAX_LABEL_CHARS + 1);
            assert!(check(&invalid).is_err());
            invalid = semantic_case_json();
            invalid["elements"][0]["role"] = json!("script");
            assert!(check(&invalid).is_err());
            invalid = semantic_case_json();
            invalid["elements"][0]["index"] = json!(4);
            assert!(check(&invalid).is_err());
            invalid = semantic_case_json();
            invalid["textBytes"] = json!(SEMANTIC_MAX_TEXT_BYTES + 1);
            assert!(check(&invalid).is_err());
            invalid = semantic_case_json();
            invalid["rawHtml"] = json!("<script>not permitted</script>");
            assert!(check(&invalid).is_err());
            invalid = semantic_case_json();
            invalid["elements"] = json!([]);
            invalid["textBytes"] = json!(0);
            assert!(check(&invalid).is_err());
        }

        #[test]
        fn semantic_snapshot_redacts_bounded_auth_like_labels_before_reporting() {
            let mut value = semantic_case_json();
            let secret = "API_KEY=top-secret-should-not-be-reported";
            value["elements"] = json!([
                {"index":1,"role":"main","name":"Clack brokered WebView2"},
                {"index":2,"role":"label","name":secret}
            ]);
            value["textBytes"] = json!("Clack brokered WebView2".len() + secret.len());
            let proof = verify_semantic_snapshot(
                &value.to_string(),
                &semantic_case_url(),
                &semantic_case_title(),
                1,
                1,
            )
            .unwrap();
            assert_eq!(proof.redacted_labels, 1);
            assert_eq!(proof.snapshot.elements[1].name, "[redacted]");
            assert!(!serde_json::to_string(&proof)
                .unwrap()
                .contains("top-secret"));
            assert!(sensitive_semantic_label("Authorization: Bearer abc"));
            assert!(sensitive_semantic_label("session_token=qwerty"));
            assert!(!sensitive_semantic_label("Clack brokered WebView2"));
        }
    }
}

#[cfg(windows)]
fn main() {
    host::main();
}
