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
    use std::os::windows::{ffi::OsStringExt, io::FromRawHandle};
    use std::path::{Path, PathBuf};
    use std::ptr::null_mut;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::{mpsc, Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
    use tauri::{webview::PageLoadEvent, WebviewUrl, WebviewWindowBuilder};
    use webview2_com::{
        take_pwstr, Microsoft::Web::WebView2::Win32::*, WebResourceRequestedEventHandler,
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
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    const WATCHDOG: Duration = Duration::from_secs(16);
    const RENDER_MARKER: &str = "clack-renderer-js-";
    const STARTUP_LOG_LIMIT: usize = 32 * 1024;
    const STARTUP_FIELD_LIMIT: usize = 384;
    const BROKER_FRAME_LIMIT: usize = 128 * 1024;
    const BROKER_QUEUE_LIMIT: usize = 32;

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
    struct Args {
        mode: Mode,
        root: PathBuf,
        fixture_port: u16,
        nonce: String,
    }
    fn args() -> Result<Args, String> {
        let argv: Vec<OsString> = std::env::args_os().collect();
        if argv.len() != 7 {
            return Err("expected --isolated-child|--positive-control|--brokered-child <absolute-root> --fixture-port <u16> --fixture-nonce <32-64 hex>".into());
        }
        let mode = match argv[1].to_str() {
            Some("--isolated-child") => Mode::Isolated,
            Some("--positive-control") => Mode::PositiveControl,
            Some("--brokered-child") => Mode::Brokered,
            _ => return Err("unsupported mode".into()),
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

    #[derive(Default)]
    struct BrokerStats {
        hook_ready: AtomicBool,
        broken: AtomicBool,
        intercepted: AtomicU64,
        forwarded: AtomicU64,
        answered: AtomicU64,
        denied: AtomicU64,
        errors: AtomicU64,
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

    struct BrokerTicket {
        id: u64,
        url: String,
    }

    struct BrokerPayload {
        status: u16,
        content_type: String,
        body: Vec<u8>,
    }

    impl BrokerPayload {
        fn denied(status: u16) -> Self {
            Self {
                status,
                content_type: "text/plain".to_owned(),
                body: Vec::new(),
            }
        }
    }

    struct PendingBrokerRequest {
        args: ICoreWebView2WebResourceRequestedEventArgs,
        deferral: ICoreWebView2Deferral,
        environment: ICoreWebView2Environment,
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

    fn broker_read_frame(pipe: &mut File) -> io::Result<Vec<u8>> {
        let mut size = [0u8; 4];
        pipe.read_exact(&mut size)?;
        let size = u32::from_le_bytes(size) as usize;
        if size == 0 || size > BROKER_FRAME_LIMIT {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "broker response frame exceeds cap",
            ));
        }
        let mut bytes = vec![0; size];
        pipe.read_exact(&mut bytes)?;
        Ok(bytes)
    }

    fn broker_reply(bytes: &[u8], nonce: &str, id: u64) -> Result<BrokerPayload, &'static str> {
        let reply: BrokerReply =
            serde_json::from_slice(bytes).map_err(|_| "malformed broker reply")?;
        if reply.version != 1 || reply.session != nonce || reply.request_id != id {
            return Err("broker reply session or request identity mismatch");
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
        let result =
            unsafe { broker_set_response(args, environment, &BrokerPayload::denied(status)) };
        if let Err(error) = &result {
            stats.errors.fetch_add(1, Ordering::Relaxed);
            stats.broken.store(true, Ordering::Release);
            trace.error(
                "broker.deny.set.failed",
                &format!("HRESULT {}", error.code().0),
            );
        }
        result
    }

    fn broker_finish_on_ui(
        id: u64,
        payload: BrokerPayload,
        trace: &StartupTrace,
        stats: &BrokerStats,
    ) {
        BROKER_PENDING.with(|pending| {
            let Some(pending) = pending.borrow_mut().remove(&id) else {
                trace.error(
                    "broker.pending.missing",
                    "request deferral absent on UI apartment",
                );
                stats.errors.fetch_add(1, Ordering::Relaxed);
                return;
            };
            let handled =
                unsafe { broker_set_response(&pending.args, &pending.environment, &payload) };
            if let Err(error) = handled {
                trace.error(
                    "broker.response.set.failed",
                    &format!("HRESULT {}", error.code().0),
                );
                stats.errors.fetch_add(1, Ordering::Relaxed);
                // A failed body/response must still produce a local denial when
                // the COM environment can create one.
                let _ = unsafe {
                    broker_set_response(
                        &pending.args,
                        &pending.environment,
                        &BrokerPayload::denied(502),
                    )
                };
            } else {
                stats.answered.fetch_add(1, Ordering::Relaxed);
            }
            if let Err(error) = unsafe { pending.deferral.Complete() } {
                trace.error(
                    "broker.deferral.complete.failed",
                    &format!("HRESULT {}", error.code().0),
                );
                stats.errors.fetch_add(1, Ordering::Relaxed);
            }
        });
    }

    // The broker never opens sockets. One bounded pipe worker owns all frames;
    // COM deferrals are completed only on the original WebView2 UI apartment.
    fn run_brokered(
        args: Args,
        trace: Arc<StartupTrace>,
        token: TokenDetails,
        udf: PathBuf,
    ) -> Result<(), String> {
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
        let observer = Arc::new(Observed::default());
        let marker = format!("{RENDER_MARKER}{}", args.nonce);
        let document_url = format!(
            "http://127.0.0.1:{}/document/broker/{}",
            args.fixture_port, args.nonce
        );
        let mut context = tauri::generate_context!();
        context.config_mut().app.windows.clear();
        let result_flag = Arc::new(AtomicBool::new(false));
        let result_from_thread = result_flag.clone();
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
                let handle = app.handle().clone();
                thread::spawn(move || {
                    while let Ok(ticket) = rx.recv() {
                        let wire = BrokerRequest {
                            version: 1,
                            session: &worker_session,
                            request_id: ticket.id,
                            method: "GET",
                            url: &ticket.url,
                        };
                        let answer = (|| -> Result<BrokerPayload, String> {
                            let body = serde_json::to_vec(&wire)
                                .map_err(|_| "request serialization failed".to_owned())?;
                            broker_write_frame(&mut broker_write, &body)
                                .map_err(|e| format!("broker write: {}", io_error(&e)))?;
                            let frame = broker_read_frame(&mut broker_read)
                                .map_err(|e| format!("broker read: {}", io_error(&e)))?;
                            broker_reply(&frame, &worker_session, ticket.id)
                                .map_err(str::to_owned)
                        })();
                        let response = match answer {
                            Ok(payload) => payload,
                            Err(error) => {
                                worker_stats.errors.fetch_add(1, Ordering::Relaxed);
                                worker_stats.broken.store(true, Ordering::Release);
                                worker_trace.error("broker.pipe.failed", &error);
                                BrokerPayload::denied(502)
                            }
                        };
                        let reply_trace = worker_trace.clone();
                        let reply_stats = worker_stats.clone();
                        if let Err(error) = handle.run_on_main_thread(move || {
                            broker_finish_on_ui(ticket.id, response, &reply_trace, &reply_stats);
                        }) {
                            worker_trace.error("broker.ui.dispatch.failed", &error.to_string());
                            worker_stats.errors.fetch_add(1, Ordering::Relaxed);
                            worker_stats.broken.store(true, Ordering::Release);
                            break;
                        }
                    }
                });
                init_trace.record("broker.worker.ready", "bounded pipe request worker started");

                let title_trace = init_trace.clone();
                let title_observer = setup_observer.clone();
                let expected_title = marker.clone();
                let webview = WebviewWindowBuilder::new(
                    app,
                    "browser-host",
                    WebviewUrl::External("about:blank".parse().map_err(std::io::Error::other)?),
                )
                .visible(false)
                .drag_and_drop(false)
                .data_directory(udf.clone())
                .on_document_title_changed(move |_webview, title| {
                    if title == expected_title {
                        title_observer.scripted.store(true, Ordering::Release);
                        title_trace.record("broker.dom.marker", "native document title marker observed");
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
                let counter = Arc::new(AtomicU64::new(0));
                webview.with_webview(move |native| {
                    let installed = (|| -> windows::core::Result<()> {
                        let environment = native.environment();
                        let controller = native.controller();
                        let core = unsafe { controller.CoreWebView2()? };
                        // The _22 API is required. Its ALL source kinds include
                        // document, iframe, worker, and shared-worker requests.
                        // Never silently downgrade to a filter omitting sources.
                        let core22: ICoreWebView2_22 = core.cast()?;
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
                        let handler = WebResourceRequestedEventHandler::create(Box::new(
                            move |_, args| {
                                let Some(args) = args else { return Ok(()); };
                                event_stats.intercepted.fetch_add(1, Ordering::Relaxed);
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
                                BROKER_PENDING.with(|pending| {
                                    pending.borrow_mut().insert(id, PendingBrokerRequest {
                                        args,
                                        deferral,
                                        environment: event_env.clone(),
                                    });
                                });
                                if callback_tx.try_send(BrokerTicket { id, url: uri }).is_err() {
                                    event_stats.denied.fetch_add(1, Ordering::Relaxed);
                                    broker_finish_on_ui(
                                        id, BrokerPayload::denied(503), &event_trace, &event_stats,
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
                let app_handle = app.handle().clone();
                thread::spawn(move || {
                    let start = Instant::now();
                    let mut script_at = None;
                    while start.elapsed() < WATCHDOG {
                        if let Ok(rows) = inventory(pid) {
                            if let Ok(mut owned) = monitor_observer.processes.lock() {
                                for row in rows { owned.insert(row.pid, row); }
                            }
                        }
                        if monitor_observer.scripted.load(Ordering::Acquire) && script_at.is_none() {
                            script_at = Some(Instant::now());
                        }
                        if script_at.is_some_and(|t| t.elapsed() >= Duration::from_secs(2)) {
                            break;
                        }
                        if monitor_stats.broken.load(Ordering::Acquire) {
                            break;
                        }
                        thread::sleep(Duration::from_millis(120));
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
                    let success = ready && scripted && !webview_pids.is_empty()
                        && forwarded > 0 && answered > 0 && errors == 0;
                    result_from_thread.store(success, Ordering::Release);
                    report(&root, &json!({
                        "kind": "clack-browser-host",
                        "mode": "brokered-child",
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
                        "brokerDenied": monitor_stats.denied.load(Ordering::Acquire),
                        "brokerErrors": errors,
                        "scriptObserved": scripted,
                        "rendererDomProof": scripted,
                        "webviewProcessIds": webview_pids,
                        "processes": children,
                        "elapsedMs": start.elapsed().as_millis(),
                        "success": success,
                        "error": if !ready { Some("native WebView2 HTTP/HTTPS request interception unavailable") }
                            else if errors != 0 { Some("broker pipe or COM request failed") }
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
    }
}

#[cfg(windows)]
fn main() {
    host::main();
}
