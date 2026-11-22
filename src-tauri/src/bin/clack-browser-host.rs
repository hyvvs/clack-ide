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
    use serde::Serialize;
    use serde_json::json;
    use std::collections::{BTreeMap, HashSet};
    use std::ffi::OsString;
    use std::fs;
    use std::mem::{size_of, zeroed};
    use std::os::windows::ffi::OsStringExt;
    use std::path::{Path, PathBuf};
    use std::ptr::null_mut;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};
    use tauri::{webview::PageLoadEvent, WebviewUrl, WebviewWindowBuilder};
    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, LocalFree, HANDLE, HLOCAL, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows_sys::Win32::Security::{
        GetTokenInformation, TokenAppContainerSid, TokenCapabilities, TokenIsAppContainer,
        TOKEN_APPCONTAINER_INFORMATION, TOKEN_GROUPS, TOKEN_QUERY,
    };
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    const WATCHDOG: Duration = Duration::from_secs(16);
    const RENDER_MARKER: &str = "clack-renderer-js-";

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
            return Err("expected --isolated-child|--positive-control <absolute-root> --fixture-port <u16> --fixture-nonce <32-64 hex>".into());
        }
        let mode = match argv[1].to_str() {
            Some("--isolated-child") => Mode::Isolated,
            Some("--positive-control") => Mode::PositiveControl,
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
    fn report(root: &Path, value: &serde_json::Value) {
        let output = value.to_string();
        println!("{output}");
        let _ = fs::write(root.join("browser-host-report.json"), format!("{output}\n"));
    }

    fn run(args: Args) -> Result<(), String> {
        let token = own_token()?;
        match args.mode {
            Mode::Isolated if !token.app_container || !token.capability_sids.is_empty() => {
                return Err(format!("isolated child requires AppContainer no-capabilities token, actual container={} capabilities={}",
                    token.app_container, token.capability_sids.len()));
            }
            Mode::PositiveControl if token.app_container => {
                return Err("positive control requires ordinary token".into())
            }
            _ => {}
        }
        let mut bytes = [0u8; 12];
        getrandom::fill(&mut bytes).map_err(|e| format!("UDF entropy: {e}"))?;
        let salt = bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
        let udf = args
            .root
            .join(format!("webview2-{}-{salt}", std::process::id()));
        fs::create_dir(&udf).map_err(|e| format!("create unique UDF: {e}"))?;
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
        let root = args.root.clone();
        let mode = args.mode;
        let pid = std::process::id();
        let mut context = tauri::generate_context!();
        context.config_mut().app.windows.clear();
        let on_load = observer.clone();
        let on_title = observer.clone();
        let title_marker = marker.clone();
        let on_run = observer.clone();
        let result_flag = Arc::new(AtomicBool::new(false));
        let result_from_thread = result_flag.clone();
        tauri::Builder::default()
            .on_page_load(move |_webview, event| {
                if matches!(event.event(), PageLoadEvent::Finished) {
                    on_load.loaded.store(true, Ordering::Release);
                    if event.url().as_str().contains(&marker) {
                        on_load.scripted.store(true, Ordering::Release);
                    }
                }
            })
            .setup(move |app| {
                let webview = WebviewWindowBuilder::new(
                    app, "browser-host",
                    WebviewUrl::External("about:blank".parse().map_err(std::io::Error::other)?),
                )
                .visible(false)
                .data_directory(udf.clone())
                .on_document_title_changed(move |_webview, title| {
                    if title == title_marker {
                        on_title.scripted.store(true, Ordering::Release);
                    }
                })
                .build()?;
                // Initial about:blank does not necessarily dispatch an ordinary
                // navigation-completed event. The controller exists here; send
                // the fixed HTML immediately through the real WebView2 engine.
                webview.eval(&inject_html)?;
                let app = app.handle().clone();
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
                    }));
                    app.exit(if success { 0 } else { 1 });
                });
                Ok(())
            })
            .build(context).map_err(|e| format!("WebView2 host init: {e}"))?
            .run(|_, _| {});
        if !result_flag.load(Ordering::Acquire) {
            // Tauri's run callback may return normally even following
            // AppHandle::exit(1); keep the process exit code trustworthy.
            std::process::exit(1);
        }
        Ok(())
    }

    pub fn main() {
        let root = std::env::args_os().nth(2).map(PathBuf::from);
        if let Err(error) = args().and_then(run) {
            let failed = json!({"kind":"clack-browser-host","hostPid":std::process::id(),
                "success":false,"error":error});
            if let Some(root) = root.filter(|p| p.is_dir()) {
                report(&root, &failed);
            } else {
                println!("{failed}");
            }
            std::process::exit(1);
        }
    }
}

#[cfg(windows)]
fn main() {
    host::main();
}
