//! TF browser isolation: acceptance-only *physical* Windows AppContainer probe.
//!
//! Run after building the real Wry/WebView2 host with the nondefault feature:
//!   cargo build --manifest-path src-tauri/Cargo.toml --locked \
//!       --features tf-browser-isolation-acceptance --bin clack-browser-host \
//!       --example tf_browser_isolation_acceptance
//!   cargo run --manifest-path src-tauri/Cargo.toml --locked \
//!       --features tf-browser-isolation-acceptance --example tf_browser_isolation_acceptance
//!
//! Never enables a product browser. Never changes the host firewall, WFP,
//! network adapter, installed browser or user application data. This test must
//! observe a real WebView2 browser AND renderer, both actually confined to the
//! same zero-network-capability AppContainer as the acceptance host. A token
//! claim from the host alone, a failed launch, a missing renderer or a silent
//! localhost listener is not a successful isolation proof.

#[cfg(not(all(windows, feature = "tf-browser-isolation-acceptance")))]
fn main() {
    eprintln!("UNVERIFIED: Windows and --features tf-browser-isolation-acceptance are required");
    std::process::exit(2);
}

#[cfg(all(windows, feature = "tf-browser-isolation-acceptance"))]
fn main() {
    if let Err(reason) = windows::run() {
        eprintln!("TF_BROWSER_ISOLATION_UNVERIFIED: {reason}");
        std::process::exit(1);
    }
}

#[cfg(all(windows, feature = "tf-browser-isolation-acceptance"))]
mod windows {
    use serde_json::Value;
    use std::{
        collections::{BTreeMap, BTreeSet},
        ffi::{c_void, OsStr},
        fs,
        io::{Read, Write},
        mem::{size_of, size_of_val, zeroed},
        net::{SocketAddr, TcpListener, TcpStream, UdpSocket},
        os::windows::ffi::OsStrExt,
        path::{Path, PathBuf},
        process::Command,
        ptr::{null, null_mut},
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Mutex,
        },
        thread,
        time::{Duration, Instant},
    };
    use windows_sys::Win32::{
        Foundation::*,
        Security::{
            Authorization::{
                ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
            },
            Isolation::{CreateAppContainerProfile, DeleteAppContainerProfile},
            *,
        },
        System::{
            Diagnostics::ToolHelp::*, JobObjects::*, Threading::*,
            WindowsProgramming::PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT,
        },
    };

    const WAIT_MS: u32 = 18_500;
    const POLL_INTERVAL: Duration = Duration::from_millis(200);
    const ALLOWLIST_HOST: &str = "127.0.0.1";

    fn err(step: &str) -> String {
        format!("{step}: Win32 {}", unsafe { GetLastError() })
    }
    fn wide(s: impl AsRef<OsStr>) -> Vec<u16> {
        s.as_ref().encode_wide().chain([0]).collect()
    }
    fn quoted(s: &str) -> String {
        // Windows argv quoting: escape embedded quotes and preceding slashes.
        let mut result = String::from("\"");
        let mut slash = 0;
        for ch in s.chars() {
            if ch == '\\' {
                slash += 1;
            } else {
                result.extend(std::iter::repeat_n(
                    '\\',
                    slash * if ch == '"' { 2 } else { 1 },
                ));
                if ch == '"' {
                    result.push('\\');
                }
                result.push(ch);
                slash = 0;
            }
        }
        result.extend(std::iter::repeat_n('\\', slash * 2));
        result.push('"');
        result
    }
    struct Handle(HANDLE);
    impl Handle {
        fn new(raw: HANDLE, step: &str) -> Result<Self, String> {
            if raw.is_null() || raw == INVALID_HANDLE_VALUE {
                Err(err(step))
            } else {
                Ok(Self(raw))
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
    struct Sid(PSID);
    impl Drop for Sid {
        fn drop(&mut self) {
            unsafe {
                FreeSid(self.0);
            }
        }
    }
    struct Local(*mut c_void);
    impl Drop for Local {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    LocalFree(self.0);
                }
            }
        }
    }
    struct Attributes {
        storage: Vec<usize>,
        initialized: bool,
    }
    impl Attributes {
        fn new(count: u32) -> Result<Self, String> {
            let mut bytes = 0;
            unsafe {
                InitializeProcThreadAttributeList(null_mut(), count, 0, &mut bytes);
            }
            if bytes == 0 {
                return Err(err("InitializeProcThreadAttributeList sizing"));
            }
            let mut a = Self {
                storage: vec![0usize; bytes.div_ceil(size_of::<usize>())],
                initialized: false,
            };
            if unsafe { InitializeProcThreadAttributeList(a.ptr(), count, 0, &mut bytes) } == 0 {
                return Err(err("InitializeProcThreadAttributeList"));
            }
            a.initialized = true;
            Ok(a)
        }
        fn ptr(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
            self.storage.as_mut_ptr().cast()
        }
        fn add<T>(&mut self, id: u32, value: &T) -> Result<(), String> {
            if unsafe {
                UpdateProcThreadAttribute(
                    self.ptr(),
                    0,
                    id as usize,
                    (value as *const T).cast(),
                    size_of::<T>(),
                    null_mut(),
                    null(),
                )
            } == 0
            {
                Err(err("UpdateProcThreadAttribute"))
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
    struct Profile {
        name: Vec<u16>,
        sid: Sid,
        deleted: bool,
    }
    impl Profile {
        fn new(name: &str) -> Result<Self, String> {
            let name = wide(name);
            let mut sid = null_mut();
            let hr = unsafe {
                CreateAppContainerProfile(
                    name.as_ptr(),
                    name.as_ptr(),
                    name.as_ptr(),
                    null(),
                    0,
                    &mut sid,
                )
            };
            if hr < 0 {
                return Err(format!("CreateAppContainerProfile HRESULT {hr:#x}"));
            }
            if sid.is_null() {
                return Err("CreateAppContainerProfile returned null SID".into());
            }
            Ok(Self {
                name,
                sid: Sid(sid),
                deleted: false,
            })
        }
        fn text_sid(&self) -> Result<String, String> {
            let mut ptr = null_mut();
            if unsafe { ConvertSidToStringSidW(self.sid.0, &mut ptr) } == 0 {
                return Err(err("ConvertSidToStringSidW"));
            }
            let owned = Local(ptr.cast());
            let mut length = 0;
            unsafe {
                while *ptr.add(length) != 0 {
                    length += 1;
                }
            }
            let result = unsafe { std::slice::from_raw_parts(ptr, length) };
            let result = String::from_utf16_lossy(result);
            drop(owned);
            Ok(result)
        }
        fn delete(&mut self) -> Result<(), String> {
            if self.deleted {
                return Ok(());
            }
            let hr = unsafe { DeleteAppContainerProfile(self.name.as_ptr()) };
            if hr < 0 {
                Err(format!("DeleteAppContainerProfile HRESULT {hr:#x}"))
            } else {
                self.deleted = true;
                Ok(())
            }
        }
    }
    // A leaked profile is preferable to deleting a profile still used by a
    // child whose safe termination has not been verified. Explicit cleanup is
    // mandatory before acceptance can pass.

    fn grant(path: &Path, sid: &str, writable: bool) -> Result<(), String> {
        let rights = if writable { "GRGWGX" } else { "GRGX" };
        let policy = wide(format!(
            "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;OW)(A;OICI;{rights};;;{sid})S:(ML;OICI;NW;;;LW)"
        ));
        let mut descriptor = null_mut();
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                policy.as_ptr(),
                1,
                &mut descriptor,
                null_mut(),
            )
        } == 0
        {
            return Err(err("ConvertStringSecurityDescriptorToSecurityDescriptorW"));
        }
        let desc = Local(descriptor);
        if unsafe {
            SetFileSecurityW(
                wide(path).as_ptr(),
                DACL_SECURITY_INFORMATION
                    | PROTECTED_DACL_SECURITY_INFORMATION
                    | LABEL_SECURITY_INFORMATION,
                desc.0,
            )
        } == 0
        {
            return Err(err("SetFileSecurityW"));
        }
        Ok(())
    }

    #[derive(Default, Clone, Debug)]
    struct Counts {
        tcp_connections: u32,
        http_requests: u32,
        websocket_upgrades: u32,
        udp_datagrams: u32,
        paths: BTreeMap<String, u32>,
    }
    struct Destination {
        addr: SocketAddr,
        seen: Arc<Mutex<BTreeMap<String, Counts>>>,
        phase: Arc<Mutex<String>>,
        stop: Arc<AtomicBool>,
        worker: Option<thread::JoinHandle<()>>,
        udp_worker: Option<thread::JoinHandle<()>>,
    }
    impl Destination {
        fn new() -> Result<Self, String> {
            let listener = TcpListener::bind((ALLOWLIST_HOST, 0))
                .map_err(|e| format!("bind independent destination: {e}"))?;
            let addr = listener.local_addr().map_err(|e| e.to_string())?;
            listener.set_nonblocking(true).map_err(|e| e.to_string())?;
            let udp = UdpSocket::bind((ALLOWLIST_HOST, addr.port()))
                .map_err(|e| format!("bind independent UDP destination: {e}"))?;
            udp.set_nonblocking(true).map_err(|e| e.to_string())?;
            let seen = Arc::new(Mutex::new(BTreeMap::<String, Counts>::new()));
            let phase = Arc::new(Mutex::new("unarmed".to_owned()));
            let stop = Arc::new(AtomicBool::new(false));
            let rows = seen.clone();
            let halted = stop.clone();
            let active = phase.clone();
            let worker = thread::spawn(move || {
                while !halted.load(Ordering::Acquire) {
                    match listener.accept() {
                        Ok((mut stream, _)) => {
                            // Count accepted TCP sockets before parsing HTTP: a
                            // broken/malformed request must not disappear from
                            // the negative observation.
                            let mode = active.lock().map(|s| s.clone()).unwrap_or_default();
                            if let Ok(mut rows) = rows.lock() {
                                rows.entry(mode.clone()).or_default().tcp_connections += 1;
                            }
                            let _ = Self::handle(&mut stream, &mode, &rows);
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(10));
                        }
                        Err(_) => break,
                    }
                }
            });
            let udp_rows = seen.clone();
            let udp_phase = phase.clone();
            let udp_halted = stop.clone();
            let udp_worker = thread::spawn(move || {
                let mut bytes = [0_u8; 2048];
                while !udp_halted.load(Ordering::Acquire) {
                    match udp.recv_from(&mut bytes) {
                        Ok((length, peer)) if length > 0 && peer.ip().is_loopback() => {
                            let mode = udp_phase.lock().map(|s| s.clone()).unwrap_or_default();
                            if let Ok(mut rows) = udp_rows.lock() {
                                rows.entry(mode).or_default().udp_datagrams += 1;
                            }
                        }
                        Ok(_) => {}
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(10));
                        }
                        Err(_) => break,
                    }
                }
            });
            Ok(Self {
                addr,
                seen,
                phase,
                stop,
                worker: Some(worker),
                udp_worker: Some(udp_worker),
            })
        }
        fn handle(
            stream: &mut TcpStream,
            mode: &str,
            seen: &Mutex<BTreeMap<String, Counts>>,
        ) -> std::io::Result<()> {
            stream.set_read_timeout(Some(Duration::from_secs(2)))?;
            stream.set_write_timeout(Some(Duration::from_secs(2)))?;
            let mut bytes = [0_u8; 4096];
            let read = stream.read(&mut bytes)?;
            let line = String::from_utf8_lossy(&bytes[..read]);
            let request = line.lines().next().unwrap_or("");
            let path = request.split_ascii_whitespace().nth(1).unwrap_or("/");
            let family = path.split('?').next().unwrap_or("/");
            let family = family
                .split('/')
                .filter(|p| !p.is_empty())
                .next()
                .unwrap_or("root");
            if let Ok(mut rows) = seen.lock() {
                let row = rows.entry(mode.to_owned()).or_default();
                row.http_requests += 1;
                *row.paths
                    .entry(family.chars().take(48).collect())
                    .or_default() += 1;
                if line.to_ascii_lowercase().contains("upgrade: websocket") {
                    row.websocket_upgrades += 1;
                }
            }
            let (status, content, kind) = if family == "page" {
                (
                    "200 OK",
                    "<!doctype html><script>fetch('/beacon', {cache:'no-store'}).catch(()=>{})</script>".to_owned(),
                    "text/html",
                )
            } else if family.ends_with(".js") || family == "script" {
                (
                    "200 OK",
                    "globalThis.__tfIsolationFixture = true;".to_owned(),
                    "application/javascript",
                )
            } else if family.ends_with(".css") || family == "style" {
                ("200 OK", "body { color: black }".to_owned(), "text/css")
            } else {
                ("200 OK", "ok".to_owned(), "text/plain")
            };
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{content}",
                content.len()
            )?;
            stream.flush()
        }
        fn counts(&self, mode: &str) -> Counts {
            self.seen
                .lock()
                .ok()
                .and_then(|r| r.get(mode).cloned())
                .unwrap_or_default()
        }
        fn set_phase(&self, mode: &str) -> Result<(), String> {
            *self
                .phase
                .lock()
                .map_err(|_| "destination phase lock poisoned")? = mode.into();
            Ok(())
        }
        fn shutdown(&mut self) -> Result<(), String> {
            self.stop.store(true, Ordering::Release);
            if let Some(worker) = self.worker.take() {
                worker
                    .join()
                    .map_err(|_| "independent destination listener panicked")?;
            }
            if let Some(worker) = self.udp_worker.take() {
                worker
                    .join()
                    .map_err(|_| "independent UDP destination panicked")?;
            }
            Ok(())
        }
    }
    impl Drop for Destination {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::Release);
            if let Some(worker) = self.worker.take() {
                let _ = worker.join();
            }
            if let Some(worker) = self.udp_worker.take() {
                let _ = worker.join();
            }
        }
    }

    #[derive(Debug, Clone)]
    struct Process {
        pid: u32,
        parent: u32,
        image: String,
    }
    fn snapshot() -> Result<Vec<Process>, String> {
        let raw = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        let snap = Handle::new(raw, "CreateToolhelp32Snapshot")?;
        let mut entry: PROCESSENTRY32W = unsafe { zeroed() };
        entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        if unsafe { Process32FirstW(snap.0, &mut entry) } == 0 {
            return Err(err("Process32FirstW"));
        }
        let mut result = Vec::new();
        loop {
            let end = entry
                .szExeFile
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(entry.szExeFile.len());
            result.push(Process {
                pid: entry.th32ProcessID,
                parent: entry.th32ParentProcessID,
                image: String::from_utf16_lossy(&entry.szExeFile[..end]).to_ascii_lowercase(),
            });
            if unsafe { Process32NextW(snap.0, &mut entry) } == 0 {
                break;
            }
        }
        Ok(result)
    }
    fn descendants(root: u32, rows: &[Process]) -> Vec<Process> {
        let mut found = BTreeSet::from([root]);
        loop {
            let len = found.len();
            for p in rows {
                if found.contains(&p.parent) {
                    found.insert(p.pid);
                }
            }
            if found.len() == len {
                break;
            }
        }
        rows.iter()
            .filter(|p| found.contains(&p.pid))
            .cloned()
            .collect()
    }

    #[derive(Debug)]
    struct TokenProof {
        appcontainer: bool,
        sid_matches: bool,
        capability_count: u32,
        in_owned_job: bool,
    }
    fn token_proof(pid: u32, expected_sid: PSID, job: HANDLE) -> Result<TokenProof, String> {
        let process = Handle::new(
            unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) },
            &format!("OpenProcess({pid})"),
        )?;
        let mut in_job = 0;
        if unsafe { IsProcessInJob(process.0, job, &mut in_job) } == 0 {
            return Err(err(&format!("IsProcessInJob({pid})")));
        }
        let mut raw = null_mut();
        if unsafe { OpenProcessToken(process.0, TOKEN_QUERY, &mut raw) } == 0 {
            return Err(err(&format!("OpenProcessToken({pid})")));
        }
        let token = Handle::new(raw, "OpenProcessToken handle")?;
        let mut is_appcontainer: u32 = 0;
        let mut returned = 0;
        if unsafe {
            GetTokenInformation(
                token.0,
                TokenIsAppContainer,
                (&mut is_appcontainer as *mut u32).cast(),
                size_of::<u32>() as u32,
                &mut returned,
            )
        } == 0
        {
            return Err(err("GetTokenInformation(TokenIsAppContainer)"));
        }
        let mut sid_len = 0;
        unsafe {
            GetTokenInformation(token.0, TokenAppContainerSid, null_mut(), 0, &mut sid_len);
        }
        if sid_len < size_of::<TOKEN_APPCONTAINER_INFORMATION>() as u32 {
            return Err(err("GetTokenInformation(TokenAppContainerSid) length"));
        }
        let mut sid_bytes = vec![0_u64; (sid_len as usize).div_ceil(8)];
        if unsafe {
            GetTokenInformation(
                token.0,
                TokenAppContainerSid,
                sid_bytes.as_mut_ptr().cast(),
                sid_len,
                &mut sid_len,
            )
        } == 0
        {
            return Err(err("GetTokenInformation(TokenAppContainerSid)"));
        }
        let actual_sid = unsafe {
            (*(sid_bytes.as_ptr().cast::<TOKEN_APPCONTAINER_INFORMATION>())).TokenAppContainer
        };
        let sid_matches =
            !actual_sid.is_null() && unsafe { EqualSid(actual_sid, expected_sid) } != 0;
        let mut caps_len = 0;
        unsafe {
            GetTokenInformation(token.0, TokenCapabilities, null_mut(), 0, &mut caps_len);
        }
        let capability_count = if caps_len == 0 {
            0
        } else {
            let mut caps = vec![0_u64; (caps_len as usize).div_ceil(8)];
            if unsafe {
                GetTokenInformation(
                    token.0,
                    TokenCapabilities,
                    caps.as_mut_ptr().cast(),
                    caps_len,
                    &mut caps_len,
                )
            } == 0
            {
                return Err(err("GetTokenInformation(TokenCapabilities)"));
            }
            unsafe { (*caps.as_ptr().cast::<TOKEN_GROUPS>()).GroupCount }
        };
        Ok(TokenProof {
            appcontainer: is_appcontainer != 0,
            sid_matches,
            capability_count,
            in_owned_job: in_job != 0,
        })
    }

    struct Launched {
        process: Handle,
        _thread: Handle,
        job: Handle,
        pid: u32,
    }
    impl Launched {
        fn spawn(
            bin: &Path,
            root: &Path,
            profile: Option<&Profile>,
            port: u16,
            nonce: &str,
        ) -> Result<Self, String> {
            let job = Handle::new(
                unsafe { CreateJobObjectW(null(), null()) },
                "CreateJobObjectW",
            )?;
            let mut bounds: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
            bounds.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if unsafe {
                SetInformationJobObject(
                    job.0,
                    JobObjectExtendedLimitInformation,
                    (&bounds as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                    size_of_val(&bounds) as u32,
                )
            } == 0
            {
                return Err(err("SetInformationJobObject(KILL_ON_CLOSE)"));
            }
            let mut attrs = Attributes::new(if profile.is_some() { 3 } else { 1 })?;
            let jobs = [job.0];
            attrs.add(PROC_THREAD_ATTRIBUTE_JOB_LIST, &jobs)?;
            let policy = PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT;
            let security = profile.map(|p| SECURITY_CAPABILITIES {
                AppContainerSid: p.sid.0,
                Capabilities: null_mut(),
                CapabilityCount: 0,
                Reserved: 0,
            });
            if let Some(ref security) = security {
                attrs.add(PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, security)?;
                attrs.add(
                    PROC_THREAD_ATTRIBUTE_ALL_APPLICATION_PACKAGES_POLICY,
                    &policy,
                )?;
            }
            let mut startup: STARTUPINFOEXW = unsafe { zeroed() };
            startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
            startup.lpAttributeList = attrs.ptr();
            let root_str = root.to_string_lossy().into_owned();
            let bin_str = bin.to_string_lossy().into_owned();
            let mode = if profile.is_some() {
                "--isolated-child"
            } else {
                "--positive-control"
            };
            let mut command = wide(format!(
                "{} {mode} {} --fixture-port {port} --fixture-nonce {nonce}",
                quoted(&bin_str),
                quoted(&root_str)
            ));
            let system_root = std::env::var("SystemRoot")
                .map_err(|_| "SystemRoot unavailable for WebView2 host")?;
            // A fresh UDF path is under each case root. No persistent profile
            // or native browser folder is shared with production Clack.
            let env = wide(format!(
                "LOCALAPPDATA={root_str}\0SystemRoot={system_root}\0TEMP={root_str}\0TMP={root_str}\0WEBVIEW2_USER_DATA_FOLDER={root_str}\\webview\0"
            ));
            let mut info: PROCESS_INFORMATION = unsafe { zeroed() };
            if unsafe {
                CreateProcessW(
                    wide(bin).as_ptr(),
                    command.as_mut_ptr(),
                    null(),
                    null(),
                    0,
                    EXTENDED_STARTUPINFO_PRESENT
                        | CREATE_UNICODE_ENVIRONMENT
                        | CREATE_SUSPENDED
                        | CREATE_NO_WINDOW,
                    env.as_ptr().cast(),
                    wide(root).as_ptr(),
                    &startup.StartupInfo,
                    &mut info,
                )
            } == 0
            {
                return Err(err("CreateProcessW(WebView2 host)"));
            }
            let process = Handle::new(info.hProcess, "host process")?;
            let thread = Handle::new(info.hThread, "host main thread")?;
            let mut member = 0;
            if unsafe { IsProcessInJob(process.0, job.0, &mut member) } == 0 || member == 0 {
                unsafe {
                    TerminateProcess(process.0, 1);
                    WaitForSingleObject(process.0, 3000);
                }
                return Err("suspended WebView2 host was not in owned kill-on-close job".into());
            }
            if unsafe { ResumeThread(thread.0) } == u32::MAX {
                return Err(err("ResumeThread(WebView2 host)"));
            }
            Ok(Self {
                process,
                _thread: thread,
                job,
                pid: info.dwProcessId,
            })
        }
        fn stop_and_verify(self) -> Result<(), String> {
            // Kill the whole assigned process group even after ordinary parent
            // exit; a browser/renderer surviving host shutdown fails the gate.
            if unsafe { TerminateJobObject(self.job.0, 1) } == 0 {
                return Err(err("TerminateJobObject"));
            }
            if unsafe { WaitForSingleObject(self.process.0, 3000) } != WAIT_OBJECT_0 {
                return Err("WebView2 host did not terminate with its job".into());
            }
            let deadline = Instant::now() + Duration::from_secs(3);
            loop {
                let mut accounting: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { zeroed() };
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
                    return Err(err("QueryInformationJobObject"));
                }
                if accounting.ActiveProcesses == 0 {
                    break;
                }
                if Instant::now() >= deadline {
                    return Err(format!(
                        "owned WebView2 job still has {} active processes",
                        accounting.ActiveProcesses
                    ));
                }
                thread::sleep(Duration::from_millis(20));
            }
            Ok(())
        }
    }

    fn webview_roles(pids: &[u32], root: &Path) -> Result<BTreeMap<u32, String>, String> {
        if pids.is_empty() {
            return Ok(BTreeMap::new());
        }
        let digits = pids
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let needle = root.to_string_lossy().replace('\'', "''");
        // WMI supplies COMMAND LINE only to distinguish actual chromium
        // renderer from the identically named browser process. Only a
        // whitelisted role and numeric PID are emitted, never raw arguments.
        // An out-of-tree WebView2 process using this unique case UDF is also
        // included, so broker-spawned children cannot evade token checks.
        let script = format!(
            "$ids=@({digits}); $needle='{needle}'; Get-CimInstance Win32_Process -Filter \"Name = 'msedgewebview2.exe'\" | Where-Object {{ ($ids -contains [int]$_.ProcessId) -or ($_.CommandLine -and $_.CommandLine.Contains($needle)) }} | ForEach-Object {{ $role=if($_.CommandLine -match '--type=renderer') {{ 'renderer' }} elseif($_.CommandLine -match '--type=gpu-process') {{ 'gpu' }} elseif($_.CommandLine -match '--type=utility') {{ 'utility' }} else {{ 'browser' }}; '{{0}}|{{1}}' -f $_.ProcessId,$role }}"
        );
        let result = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
            .map_err(|e| format!("Win32_Process role query unavailable: {e}"))?;
        if !result.status.success() {
            return Err("Win32_Process role query failed; renderer identity unverified".into());
        }
        let mut roles = BTreeMap::new();
        for line in String::from_utf8_lossy(&result.stdout).lines() {
            if let Some((pid, role)) = line.trim().split_once('|') {
                if let Ok(pid) = pid.trim().parse::<u32>() {
                    if matches!(role.trim(), "browser" | "renderer" | "gpu" | "utility") {
                        roles.insert(pid, role.trim().to_owned());
                    }
                }
            }
        }
        Ok(roles)
    }

    fn check_report(root: &Path, pid: u32, isolated: bool) -> Result<Value, String> {
        let bytes = fs::read(root.join("browser-host-report.json"))
            .map_err(|e| format!("real Wry/WebView2 host report absent: {e}"))?;
        let value: Value = serde_json::from_slice(&bytes)
            .map_err(|e| format!("Wry/WebView2 host report malformed: {e}"))?;
        if value["hostPid"].as_u64() != Some(u64::from(pid)) {
            return Err("real host report PID mismatches launched OS PID".into());
        }
        if value["appContainer"].as_bool() != Some(isolated) {
            return Err("host reported wrong AppContainer identity".into());
        }
        if value["error"].as_str().is_some_and(|e| !e.is_empty()) {
            return Err(format!(
                "real WebView2 reported launch failure: {}",
                value["error"]
            ));
        }
        // about:blank can execute injected DOM JS without producing a
        // PageLoadEvent::Finished callback. The native document-title event
        // with the exact fixture nonce is the required renderer observation.
        if value["rendererDomProof"].as_bool() != Some(true)
            || value["scriptObserved"].as_bool() != Some(true)
            || value["success"].as_bool() != Some(true)
        {
            return Err("real WebView2 renderer DOM script proof missing".into());
        }
        let root = root
            .canonicalize()
            .map_err(|e| format!("canonical case root: {e}"))?;
        if !value["udf"].as_str().is_some_and(|s| {
            let Ok(udf) = Path::new(s).canonicalize() else {
                return false;
            };
            udf.parent() == Some(root.as_path())
                && udf
                    .file_name()
                    .is_some_and(|n| n.to_string_lossy().starts_with("webview2-"))
        }) {
            return Err("real WebView2 did not report unique owned UDF".into());
        }
        Ok(value)
    }

    fn run_case(
        bin: &Path,
        root: &Path,
        mode: &str,
        profile: Option<&Profile>,
        port: u16,
        nonce: &str,
    ) -> Result<(u32, Vec<(u32, String, TokenProof)>), String> {
        let isolated = profile.is_some();
        let child = Launched::spawn(bin, root, profile, port, nonce)?;
        let pid = child.pid;
        let mut observed = BTreeMap::<u32, Process>::new();
        let mut proofs = BTreeMap::<u32, TokenProof>::new();
        let mut roles = BTreeMap::<u32, String>::new();
        let mut roles_error = None;
        let mut last_role_scan = Instant::now() - Duration::from_secs(2);
        let deadline = Instant::now() + Duration::from_millis(WAIT_MS as u64);
        let mut failure: Option<String> = None;
        let mut host_token_proven = false;
        if let Some(profile) = profile {
            match token_proof(pid, profile.sid.0, child.job.0) {
                Ok(p)
                    if p.appcontainer
                        && p.sid_matches
                        && p.capability_count == 0
                        && p.in_owned_job =>
                {
                    host_token_proven = true;
                }
                Ok(p) => failure = Some(format!("host AppContainer token mismatch: {p:?}")),
                Err(e) => failure = Some(e),
            }
        }
        while Instant::now() < deadline {
            match snapshot() {
                Ok(all) => {
                    for process in descendants(pid, &all) {
                        if process.pid != pid {
                            observed.insert(process.pid, process);
                        }
                    }
                }
                Err(e) => {
                    failure = Some(e);
                    break;
                }
            }
            if let Some(profile) = profile {
                for process in observed
                    .values()
                    .filter(|p| p.image == "msedgewebview2.exe")
                {
                    if proofs.contains_key(&process.pid) {
                        continue;
                    }
                    match token_proof(process.pid, profile.sid.0, child.job.0) {
                        Ok(proof) => {
                            if !proof.appcontainer
                                || !proof.sid_matches
                                || proof.capability_count != 0
                                || !proof.in_owned_job
                            {
                                failure = Some(format!(
                                    "WebView2 PID {} had unsafe token/job: {proof:?}",
                                    process.pid
                                ));
                            }
                            proofs.insert(process.pid, proof);
                        }
                        Err(e) => {
                            failure = Some(format!(
                                "WebView2 PID {} token or job unverified: {e}",
                                process.pid
                            ))
                        }
                    }
                }
            }
            let webview_pids = observed
                .values()
                .filter(|p| p.image == "msedgewebview2.exe")
                .map(|p| p.pid)
                .collect::<Vec<_>>();
            if webview_pids.len() >= 2
                && !roles.values().any(|r| r == "renderer")
                && last_role_scan.elapsed() > Duration::from_millis(1200)
            {
                last_role_scan = Instant::now();
                match webview_roles(&webview_pids, root) {
                    Ok(found) => roles.extend(found),
                    Err(e) => roles_error = Some(e),
                }
            }
            if root.join("browser-host-report.json").exists() {
                // Collect a little more process evidence after the host writes.
                thread::sleep(Duration::from_millis(300));
                if let Ok(all) = snapshot() {
                    for process in descendants(pid, &all) {
                        if process.pid != pid {
                            observed.insert(process.pid, process);
                        }
                    }
                }
                break;
            }
            if unsafe { WaitForSingleObject(child.process.0, 0) } == WAIT_OBJECT_0 {
                let mut code = 0;
                let exit = if unsafe { GetExitCodeProcess(child.process.0, &mut code) } != 0 {
                    format!("0x{code:08x}")
                } else {
                    format!("unknown ({})", err("GetExitCodeProcess"))
                };
                let children = observed
                    .values()
                    .filter(|p| p.image == "msedgewebview2.exe")
                    .count();
                failure = Some(format!(
                    "real Wry/WebView2 host exited before report (NT exit={exit}; host AppContainer SID/zero capabilities/job verified={host_token_proven}; observed WebView2 descendants={children})"
                ));
                break;
            }
            thread::sleep(POLL_INTERVAL);
        }
        let webview_pids = observed
            .values()
            .filter(|p| p.image == "msedgewebview2.exe")
            .map(|p| p.pid)
            .collect::<Vec<_>>();
        if !roles.values().any(|r| r == "renderer") {
            match webview_roles(&webview_pids, root) {
                Ok(found) => roles.extend(found),
                Err(e) => roles_error = Some(e),
            }
        }
        if let Some(profile) = profile {
            for role_pid in roles.keys().copied() {
                if proofs.contains_key(&role_pid) {
                    continue;
                }
                match token_proof(role_pid, profile.sid.0, child.job.0) {
                    Ok(proof) => {
                        if !proof.appcontainer
                            || !proof.sid_matches
                            || proof.capability_count != 0
                            || !proof.in_owned_job
                        {
                            failure = Some(format!(
                                "WebView2 out-of-tree role PID {role_pid}: {proof:?}"
                            ));
                        }
                        proofs.insert(role_pid, proof);
                    }
                    Err(e) => {
                        failure = Some(format!(
                            "WebView2 out-of-tree role PID {role_pid} unverified: {e}"
                        ))
                    }
                }
            }
        }
        let report = check_report(root, pid, isolated);
        // Job termination/cleanup ALWAYS precedes result classification.
        let cleanup = child.stop_and_verify();
        cleanup.map_err(|e| {
            format!(
                "STOP: {mode} unsafe process cleanup: {e}; root retained: {}",
                root.display()
            )
        })?;
        if let Some(e) = failure {
            return Err(format!("{mode}: {e}"));
        }
        let _ = report.map_err(|e| format!("{mode}: {e}"))?;
        if roles.is_empty() {
            return Err(format!("{mode}: roles unavailable: {roles_error:?}"));
        }
        let browser = roles.values().any(|r| r == "browser");
        let renderer = roles.values().any(|r| r == "renderer");
        if !browser || !renderer {
            return Err(format!(
                "{mode}: real browser/renderer role unverified: {roles:?}"
            ));
        }
        if isolated
            && (proofs.len() < roles.len()
                || roles.keys().any(|pid| !proofs.contains_key(pid))
                || proofs.values().any(|p| {
                    !p.appcontainer || !p.sid_matches || p.capability_count != 0 || !p.in_owned_job
                }))
        {
            return Err(format!(
                "{mode}: WebView2 browser/renderer AppContainer SID or zero-capability proof failed: {proofs:?}"
            ));
        }
        Ok((
            pid,
            proofs
                .into_iter()
                .map(|(pid, proof)| (pid, "msedgewebview2.exe".into(), proof))
                .collect(),
        ))
    }

    fn candidate_host() -> Result<PathBuf, String> {
        if let Ok(explicit) = std::env::var("CLACK_TF_BROWSER_HOST_EXE") {
            let path = PathBuf::from(explicit);
            if path.is_file() {
                return path.canonicalize().map_err(|e| e.to_string());
            }
            return Err("CLACK_TF_BROWSER_HOST_EXE points to no file".into());
        }
        let running = std::env::current_exe().map_err(|e| e.to_string())?;
        let parent = running
            .parent()
            .ok_or("acceptance runner has no parent folder")?;
        let path = if parent.file_name().is_some_and(|p| p == "examples") {
            parent
                .parent()
                .ok_or("missing target/debug parent")?
                .join("clack-browser-host.exe")
        } else {
            parent.join("clack-browser-host.exe")
        };
        if !path.is_file() {
            return Err(format!(
                "actual host executable missing: {} (build --bin clack-browser-host first)",
                path.display()
            ));
        }
        path.canonicalize().map_err(|e| e.to_string())
    }

    pub fn run() -> Result<(), String> {
        let binary = candidate_host()?;
        let bytes = fs::read(&binary).map_err(|e| format!("read host binary: {e}"))?;
        let mut random = [0u8; 24];
        getrandom::fill(&mut random).map_err(|e| format!("unique acceptance nonce: {e}"))?;
        let nonce = random
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        let cases = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("tf-browser-isolation-acceptance");
        fs::create_dir_all(&cases).map_err(|e| format!("create project-owned cases root: {e}"))?;
        let owned = tempfile::Builder::new()
            .prefix("clack-tf-browser-isolation-")
            .tempdir_in(&cases)
            .map_err(|e| e.to_string())?
            .keep();
        // Keep the owned root if cleanup is uncertain; no other user directory
        // or external profile may be touched. Output is failure, never PASS.
        let mut destination = Destination::new()?;
        let control = owned.join("control");
        let isolated = owned.join("isolated");
        for root in [&control, &isolated] {
            fs::create_dir(root).map_err(|e| e.to_string())?;
            fs::create_dir(root.join("webview")).map_err(|e| e.to_string())?;
        }
        let control_bin = control.join("clack-browser-host.exe");
        let isolated_bin = isolated.join("clack-browser-host.exe");
        fs::write(&control_bin, &bytes).map_err(|e| e.to_string())?;
        fs::write(&isolated_bin, &bytes).map_err(|e| e.to_string())?;
        let mut profile = Profile::new(&format!("ClackTfBrowser{}", &nonce[..20]))?;
        let sid = match profile.text_sid() {
            Ok(sid) => sid,
            Err(e) => {
                profile.delete().map_err(|cleanup| {
                    format!("STOP: SID conversion ({e}); profile cleanup also failed: {cleanup}")
                })?;
                return Err(e);
            }
        };
        let prepared = (|| {
            grant(&isolated, &sid, true)?;
            grant(&isolated_bin, &sid, false)?;
            grant(&isolated.join("webview"), &sid, true)
        })();
        if let Err(e) = prepared {
            profile.delete().map_err(|cleanup| {
                format!(
                    "STOP: ACL preparation failed ({e}); profile deletion also failed: {cleanup}"
                )
            })?;
            return Err(format!(
                "AppContainer-owned fixture ACL preparation failed: {e}"
            ));
        }
        destination.set_phase("control")?;
        let control_result = run_case(
            &control_bin,
            &control,
            "control",
            None,
            destination.addr.port(),
            &nonce,
        );
        // Drain the listener after the real host job has exited, before
        // assigning requests to the next case's phase.
        thread::sleep(Duration::from_millis(200));
        let good = destination.counts("control");
        if control_result.is_ok() && good.tcp_connections == 0 {
            eprintln!("CONTROL network request counts {good:?}: real WebView2 control did not prove JS destination reachability");
        }
        destination.set_phase("isolated")?;
        let isolated_result = if control_result.is_ok() && good.tcp_connections > 0 {
            Some(run_case(
                &isolated_bin,
                &isolated,
                "isolated",
                Some(&profile),
                destination.addr.port(),
                &nonce,
            ))
        } else {
            None
        };
        let denied = destination.counts("isolated");
        destination.shutdown()?;
        // Cleanup is attempted only after each child has been *verified* to
        // have zero active job processes. Abort profile deletion otherwise.
        if control_result
            .as_ref()
            .is_err_and(|e| e.starts_with("STOP:"))
            || isolated_result
                .as_ref()
                .is_some_and(|r| r.as_ref().is_err_and(|e| e.starts_with("STOP:")))
        {
            return Err("STOP: process group cleanup uncertain; AppContainer profile and case retained for manual investigation".into());
        }
        profile
            .delete()
            .map_err(|e| format!("STOP: profile cleanup uncertain: {e}"))?;
        let verdict = (|| {
            let control_result = control_result?;
            let isolated_result = isolated_result
                .ok_or("positive-control WebView2 navigation/JS probe not established")??;
            if denied.tcp_connections != 0 || denied.udp_datagrams != 0 {
                return Err(format!(
                    "FAIL: isolated WebView2 reached independent destination: {denied:?}"
                ));
            }
            if good.udp_datagrams == 0 {
                return Err(format!(
                "UNVERIFIED: real positive-control WebView2 delivered TCP but no UDP/STUN datagram; separate UDP isolation gate remains open (control={good:?}, isolated={denied:?})"
                ));
            }
            Ok::<_, String>((control_result, isolated_result))
        })();
        // A failed *verified-safe* test also tears down its UDF and case.
        // Only uncertain process/profile cleanup intentionally retains files.
        fs::remove_dir_all(&owned)
            .map_err(|e| format!("STOP: owned case cleanup failed {}: {e}", owned.display()))?;
        let (control_result, isolated_result) = verdict.map_err(|e| {
            format!("{e}; control={good:?}; isolated={denied:?}; job/profile/UDF cleaned")
        })?;
        println!(
            "TF_BROWSER_ISOLATION_PASS (tested localhost TCP/UDP fixture classes): independent control {good:?}; isolated {denied:?}; control_host={}; isolated_host={}; child_tokens={:?}; unique_owned_UDF_cleaned=true",
            control_result.0, isolated_result.0, isolated_result.1,
        );
        Ok(())
    }
}
