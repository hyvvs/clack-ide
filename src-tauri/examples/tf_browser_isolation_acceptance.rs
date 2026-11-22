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
    use serde::{Deserialize, Serialize};
    use serde_json::{json, Value};
    use sha2::{Digest, Sha256};
    use std::{
        collections::{BTreeMap, BTreeSet},
        ffi::{c_void, OsStr},
        fs::{self, File},
        io::{Read, Write},
        mem::{size_of, size_of_val, zeroed, ManuallyDrop},
        net::{SocketAddr, TcpListener, TcpStream, UdpSocket},
        os::windows::{ffi::OsStrExt, io::FromRawHandle},
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
    use terax_lib::modules::{net::tf_web, workspace::WorkspaceRegistry};
    use windows_sys::Win32::{
        Foundation::*,
        Security::{
            Authorization::{
                ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
            },
            Isolation::{CreateAppContainerProfile, DeleteAppContainerProfile},
            *,
        },
        System::{Diagnostics::ToolHelp::*, JobObjects::*, Pipes::*, Threading::*},
    };

    const WAIT_MS: u32 = 18_500;
    const POLL_INTERVAL: Duration = Duration::from_millis(200);
    const ALLOWLIST_HOST: &str = "127.0.0.1";
    const MAX_SHUTDOWN_DRAIN_EVENTS: usize = 64;
    // Retain at most this many bytes from EACH host stream. Continue draining
    // pipes after the limit to keep a noisy host from blocking on stdout.
    const HOST_STREAM_LIMIT: usize = 32 * 1024;
    const HOST_DRAIN_QUANTUM: usize = 128 * 1024;
    const BROKER_MAX_FRAME_BYTES: usize = 128 * 1024;
    const BROKER_MAX_REQUESTS: usize = 20;
    // Each host request is answered synchronously before the next one. Keep
    // response frames within the anonymous pipe's small capacity so writes do
    // not require an unbounded peer drain to make forward progress.
    const BROKER_MAX_RESPONSE_FRAME_BYTES: usize = 3 * 1024;
    const BROKER_PNG: &[u8] = &[
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 4,
        0, 0, 0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 252, 255, 31, 0, 2,
        235, 1, 245, 106, 87, 144, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ];

    fn preserve_json(path: &Path, value: &Value) -> Result<(), String> {
        // Every run has a fresh tempfile-owned directory. Never replace an
        // existing diagnosis or verdict, including an earlier FAILED case.
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map_err(|e| format!("create immutable evidence {}: {e}", path.display()))?;
        serde_json::to_writer_pretty(&mut file, value)
            .map_err(|e| format!("serialize immutable evidence {}: {e}", path.display()))?;
        file.write_all(b"\n")
            .and_then(|_| file.flush())
            .map_err(|e| format!("flush immutable evidence {}: {e}", path.display()))
    }

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
        // The host's private UDF probe must be able to DELETE its own temp
        // file. SD grants that single standard file right in addition to the
        // existing read/write/execute access, only on this fresh test fixture.
        let rights = if writable { "GRGWGXSD" } else { "GRGX" };
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

    #[derive(Default, Clone, Debug, serde::Serialize)]
    struct TcpFamilyCounts {
        connections: u32,
        http_requests: u32,
        websocket_upgrades: u32,
        paths: BTreeMap<String, u32>,
        // Counts only a GET to the exact per-run /ipv6/<mode>/<nonce> fixture
        // route on the independent IPv6 listener, never an arbitrary socket.
        ipv6_fixture_requests: u32,
    }

    #[derive(Default, Clone, Debug, serde::Serialize)]
    struct Counts {
        // Preserve original aggregate evidence fields for historical comparison.
        tcp_connections: u32,
        http_requests: u32,
        websocket_upgrades: u32,
        // This acceptance currently exercises UDP/STUN on IPv4 only. Never
        // interpret this aggregate as a measured IPv6 UDP observation.
        udp_datagrams: u32,
        paths: BTreeMap<String, u32>,
        ipv4: TcpFamilyCounts,
        ipv6: TcpFamilyCounts,
    }
    struct Destination {
        addr: SocketAddr,
        ipv6_addr: SocketAddr,
        seen: Arc<Mutex<BTreeMap<String, Counts>>>,
        phase: Arc<Mutex<String>>,
        stop: Arc<AtomicBool>,
        listener_errors: Arc<Mutex<Vec<String>>>,
        worker: Option<thread::JoinHandle<()>>,
        ipv6_worker: Option<thread::JoinHandle<()>>,
        udp_worker: Option<thread::JoinHandle<()>>,
    }
    impl Destination {
        fn tcp_worker(
            listener: TcpListener,
            seen: Arc<Mutex<BTreeMap<String, Counts>>>,
            phase: Arc<Mutex<String>>,
            stop: Arc<AtomicBool>,
            errors: Arc<Mutex<Vec<String>>>,
            ipv6: bool,
            nonce: String,
        ) -> thread::JoinHandle<()> {
            thread::spawn(move || {
                let family = if ipv6 { "IPv6" } else { "IPv4" };
                let mut drained_after_stop = 0;
                loop {
                    let shutting_down = stop.load(Ordering::Acquire);
                    if shutting_down && drained_after_stop >= MAX_SHUTDOWN_DRAIN_EVENTS {
                        if let Ok(mut errors) = errors.lock() {
                            errors.push(format!(
                                "{family} TCP listener exceeded bounded shutdown drain"
                            ));
                        }
                        break;
                    }
                    match listener.accept() {
                        Ok((mut stream, _)) => {
                            if shutting_down {
                                drained_after_stop += 1;
                            }
                            // Count accepted sockets before HTTP parsing, so a
                            // malformed or broken request remains a negative
                            // observation in its ACTUAL address family.
                            let mode = phase.lock().map(|s| s.clone()).unwrap_or_default();
                            if let Ok(mut rows) = seen.lock() {
                                let row = rows.entry(mode.clone()).or_default();
                                row.tcp_connections += 1;
                                if ipv6 {
                                    row.ipv6.connections += 1;
                                } else {
                                    row.ipv4.connections += 1;
                                }
                            }
                            let _ = Self::handle(
                                &mut stream,
                                &mode,
                                &nonce,
                                ipv6,
                                shutting_down,
                                &seen,
                            );
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            if shutting_down {
                                break;
                            }
                            thread::sleep(Duration::from_millis(10));
                        }
                        Err(e) => {
                            if let Ok(mut errors) = errors.lock() {
                                errors.push(format!("{family} TCP listener failed: {e}"));
                            }
                            break;
                        }
                    }
                }
            })
        }

        fn new(nonce: &str) -> Result<Self, String> {
            let listener = TcpListener::bind((ALLOWLIST_HOST, 0))
                .map_err(|e| format!("bind independent IPv4 destination: {e}"))?;
            let addr = listener.local_addr().map_err(|e| e.to_string())?;
            listener.set_nonblocking(true).map_err(|e| e.to_string())?;
            // Bind the exact same randomly selected port, but a distinct
            // IPv6 loopback socket. Failure fails closed: this machine has
            // IPv6, and we must not silently claim dual-family isolation.
            let ipv6_listener = TcpListener::bind(("::1", addr.port())).map_err(|e| {
                format!(
                    "independent IPv6 ::1 TCP destination on fixture port {} unavailable; dual-family isolation unverified: {e}",
                    addr.port()
                )
            })?;
            let ipv6_addr = ipv6_listener
                .local_addr()
                .map_err(|e| format!("IPv6 destination address: {e}"))?;
            ipv6_listener
                .set_nonblocking(true)
                .map_err(|e| format!("nonblocking IPv6 destination: {e}"))?;
            let udp = UdpSocket::bind((ALLOWLIST_HOST, addr.port()))
                .map_err(|e| format!("bind independent IPv4 UDP destination: {e}"))?;
            udp.set_nonblocking(true).map_err(|e| e.to_string())?;
            let seen = Arc::new(Mutex::new(BTreeMap::<String, Counts>::new()));
            let phase = Arc::new(Mutex::new("unarmed".to_owned()));
            let stop = Arc::new(AtomicBool::new(false));
            let listener_errors = Arc::new(Mutex::new(Vec::new()));
            let worker = Self::tcp_worker(
                listener,
                seen.clone(),
                phase.clone(),
                stop.clone(),
                listener_errors.clone(),
                false,
                nonce.to_owned(),
            );
            let ipv6_worker = Self::tcp_worker(
                ipv6_listener,
                seen.clone(),
                phase.clone(),
                stop.clone(),
                listener_errors.clone(),
                true,
                nonce.to_owned(),
            );
            let udp_rows = seen.clone();
            let udp_phase = phase.clone();
            let udp_halted = stop.clone();
            let udp_errors = listener_errors.clone();
            let udp_worker = thread::spawn(move || {
                let mut bytes = [0_u8; 2048];
                let mut drained_after_stop = 0;
                loop {
                    let shutting_down = udp_halted.load(Ordering::Acquire);
                    if shutting_down && drained_after_stop >= MAX_SHUTDOWN_DRAIN_EVENTS {
                        if let Ok(mut errors) = udp_errors.lock() {
                            errors.push("IPv4 UDP listener exceeded bounded shutdown drain".into());
                        }
                        break;
                    }
                    match udp.recv_from(&mut bytes) {
                        Ok((length, peer)) if length > 0 && peer.ip().is_loopback() => {
                            if shutting_down {
                                drained_after_stop += 1;
                            }
                            let mode = udp_phase.lock().map(|s| s.clone()).unwrap_or_default();
                            if let Ok(mut rows) = udp_rows.lock() {
                                rows.entry(mode).or_default().udp_datagrams += 1;
                            }
                        }
                        Ok(_) => {
                            if shutting_down {
                                drained_after_stop += 1;
                            }
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            if shutting_down {
                                break;
                            }
                            thread::sleep(Duration::from_millis(10));
                        }
                        Err(e) => {
                            if let Ok(mut errors) = udp_errors.lock() {
                                errors.push(format!("IPv4 UDP listener failed: {e}"));
                            }
                            break;
                        }
                    }
                }
            });
            Ok(Self {
                addr,
                ipv6_addr,
                seen,
                phase,
                stop,
                listener_errors,
                worker: Some(worker),
                ipv6_worker: Some(ipv6_worker),
                udp_worker: Some(udp_worker),
            })
        }
        fn handle(
            stream: &mut TcpStream,
            mode: &str,
            nonce: &str,
            ipv6: bool,
            draining: bool,
            seen: &Mutex<BTreeMap<String, Counts>>,
        ) -> std::io::Result<()> {
            // Bound a late socket's read after the verified process group is
            // empty. Even malformed queued requests must be counted promptly.
            stream.set_read_timeout(Some(if draining {
                Duration::from_millis(50)
            } else {
                Duration::from_secs(2)
            }))?;
            stream.set_write_timeout(Some(Duration::from_secs(2)))?;
            let mut bytes = [0_u8; 4096];
            let read = stream.read(&mut bytes)?;
            let line = String::from_utf8_lossy(&bytes[..read]);
            let request = line.lines().next().unwrap_or("");
            let mut parts = request.split_ascii_whitespace();
            let method = parts.next().unwrap_or("");
            let path = parts.next().unwrap_or("/");
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
                let websocket = line.to_ascii_lowercase().contains("upgrade: websocket");
                if websocket {
                    row.websocket_upgrades += 1;
                }
                let family_row = if ipv6 { &mut row.ipv6 } else { &mut row.ipv4 };
                family_row.http_requests += 1;
                *family_row
                    .paths
                    .entry(family.chars().take(48).collect())
                    .or_default() += 1;
                if ipv6 && method == "GET" && path == format!("/ipv6/{mode}/{nonce}") {
                    family_row.ipv6_fixture_requests += 1;
                }
                if websocket {
                    family_row.websocket_upgrades += 1;
                }
            }
            let broker_fixture = mode == "brokered" && path == format!("/{family}/broker/{nonce}");
            let (status, content, kind, redirect): (&str, Vec<u8>, &str, Option<String>) = if mode
                == "brokered"
                && !broker_fixture
            {
                (
                    "404 Not Found",
                    b"unknown fixture".to_vec(),
                    "text/plain",
                    None,
                )
            } else if broker_fixture {
                match family {
                        "document" => (
                            "200 OK",
                            format!(
                                "<!doctype html><html><head><link rel=\"stylesheet\" href=\"/css/broker/{nonce}\"><script defer src=\"/script/broker/{nonce}\"></script></head><body><main id=\"broker-proof\">Clack brokered WebView2</main><img src=\"/image/broker/{nonce}\"><iframe src=\"/iframe/broker/{nonce}\"></iframe><script>for(const kind of ['fetch','redirect-ok','redirect-private','deny']){{fetch('/'+kind+'/broker/{nonce}',{{mode:'no-cors'}}).catch(()=>{{}})}}</script></body></html>"
                            ).into_bytes(),
                            "text/html",
                            None,
                        ),
                        "css" => ("200 OK", b"#broker-proof { display: block }".to_vec(), "text/css", None),
                        "script" => ("200 OK", format!("globalThis.__clackBrokerScript = true; document.title='clack-renderer-js-{nonce}';").into_bytes(), "application/javascript", None),
                        // Static valid one-pixel PNG: binary content exercises
                        // TF3's actual browser-resource bytes, not text coercion.
                        "image" => ("200 OK", BROKER_PNG.to_vec(), "image/png", None),
                        "iframe" => ("200 OK", b"<!doctype html><p>broker iframe</p>".to_vec(), "text/html", None),
                        "fetch" => ("200 OK", b"broker-fetch-ok".to_vec(), "text/plain", None),
                        "redirect-ok" => ("302 Found", Vec::new(), "text/plain", Some(format!("/fetch/broker/{nonce}"))),
                        "redirect-private" => ("302 Found", Vec::new(), "text/plain", Some("http://169.254.169.254/latest/meta-data".to_owned())),
                        "deny" => ("403 Forbidden", b"broker denied".to_vec(), "text/plain", None),
                        _ => ("404 Not Found", b"unknown fixture".to_vec(), "text/plain", None),
                    }
            } else if family == "page" {
                (
                        "200 OK",
                        b"<!doctype html><script>fetch('/beacon', {cache:'no-store'}).catch(()=>{})</script>".to_vec(),
                        "text/html",
                        None,
                    )
            } else if family.ends_with(".js") || family == "script" {
                (
                    "200 OK",
                    b"globalThis.__tfIsolationFixture = true;".to_vec(),
                    "application/javascript",
                    None,
                )
            } else if family.ends_with(".css") || family == "style" {
                (
                    "200 OK",
                    b"body { color: black }".to_vec(),
                    "text/css",
                    None,
                )
            } else {
                ("200 OK", b"ok".to_vec(), "text/plain", None)
            };
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n",
                content.len()
            )?;
            if let Some(redirect) = redirect {
                write!(stream, "Location: {redirect}\r\n")?;
            }
            stream.write_all(b"\r\n")?;
            stream.write_all(&content)?;
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
            let mut panics = Vec::new();
            if let Some(worker) = self.worker.take() {
                if worker.join().is_err() {
                    panics.push("IPv4 TCP listener");
                }
            }
            if let Some(worker) = self.ipv6_worker.take() {
                if worker.join().is_err() {
                    panics.push("IPv6 TCP listener");
                }
            }
            if let Some(worker) = self.udp_worker.take() {
                if worker.join().is_err() {
                    panics.push("IPv4 UDP listener");
                }
            }
            if !panics.is_empty() {
                return Err(format!(
                    "independent destination listeners panicked: {}",
                    panics.join(", ")
                ));
            }
            let errors = self
                .listener_errors
                .lock()
                .map_err(|_| "independent destination listener error lock poisoned")?;
            if !errors.is_empty() {
                return Err(format!(
                    "independent destination listeners incomplete: {}",
                    errors.join("; ")
                ));
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
            if let Some(worker) = self.ipv6_worker.take() {
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

    #[derive(Debug, serde::Serialize)]
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

    fn pipe(inherit_read: bool) -> Result<(Handle, Handle), String> {
        let mut read = null_mut();
        let mut write = null_mut();
        let attributes = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: null_mut(),
            bInheritHandle: 1,
        };
        if unsafe { CreatePipe(&mut read, &mut write, &attributes, 4096) } == 0 {
            return Err(err("CreatePipe(restricted host capture)"));
        }
        let read = Handle::new(read, "capture pipe read")?;
        let write = Handle::new(write, "capture pipe write")?;
        if !inherit_read && unsafe { SetHandleInformation(read.0, HANDLE_FLAG_INHERIT, 0) } == 0 {
            return Err(err("SetHandleInformation(capture pipe read)"));
        }
        Ok((read, write))
    }

    struct HostStream {
        pipe: Handle,
        bytes: Vec<u8>,
        truncated: bool,
    }
    impl HostStream {
        fn new(pipe: Handle) -> Self {
            Self {
                pipe,
                bytes: Vec::new(),
                truncated: false,
            }
        }
        fn drain(&mut self) -> Result<(), String> {
            let mut drained = 0;
            loop {
                if drained >= HOST_DRAIN_QUANTUM {
                    // A chatty child cannot keep a single poll busy forever.
                    return Ok(());
                }
                let mut available = 0;
                if unsafe {
                    PeekNamedPipe(
                        self.pipe.0,
                        null_mut(),
                        0,
                        null_mut(),
                        &mut available,
                        null_mut(),
                    )
                } == 0
                {
                    return if unsafe { GetLastError() } == ERROR_BROKEN_PIPE {
                        Ok(())
                    } else {
                        Err(err("PeekNamedPipe(restricted host output)"))
                    };
                }
                if available == 0 {
                    return Ok(());
                }
                let mut chunk = [0u8; 4096];
                // Borrow the owned pipe without giving File permission to close it.
                let mut file = ManuallyDrop::new(unsafe { File::from_raw_handle(self.pipe.0) });
                let count = (available as usize)
                    .min(chunk.len())
                    .min(HOST_DRAIN_QUANTUM - drained);
                let len = file
                    .read(&mut chunk[..count])
                    .map_err(|e| format!("read restricted host output: {e}"))?;
                if len == 0 {
                    return Ok(());
                }
                drained += len;
                let retained = len.min(HOST_STREAM_LIMIT.saturating_sub(self.bytes.len()));
                self.bytes.extend_from_slice(&chunk[..retained]);
                self.truncated |= retained != len;
            }
        }
        fn text(&self) -> String {
            String::from_utf8_lossy(&self.bytes).into_owned()
        }
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct BrokerRequest {
        version: u8,
        session: String,
        request_id: u64,
        method: String,
        url: String,
    }
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct BrokerResponse {
        version: u8,
        session: String,
        request_id: u64,
        status: u16,
        content_type: String,
        body_base64: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    }
    #[derive(Default, Serialize)]
    struct BrokerEvidence {
        requests_received: u32,
        responses_sent: u32,
        delivered: BTreeMap<String, u32>,
        denied: BTreeMap<String, u32>,
        receipts: Vec<Value>,
    }
    fn encode_base64(bytes: &[u8]) -> String {
        const TABLE: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);
        for chunk in bytes.chunks(3) {
            let first = chunk[0];
            let second = chunk.get(1).copied().unwrap_or(0);
            let third = chunk.get(2).copied().unwrap_or(0);
            output.push(TABLE[(first >> 2) as usize] as char);
            output.push(TABLE[(((first & 3) << 4) | (second >> 4)) as usize] as char);
            output.push(if chunk.len() >= 2 {
                TABLE[(((second & 15) << 2) | (third >> 6)) as usize] as char
            } else {
                '='
            });
            output.push(if chunk.len() >= 3 {
                TABLE[(third & 63) as usize] as char
            } else {
                '='
            });
        }
        output
    }
    struct BrokerBridge {
        request_pipe: Handle,
        response_pipe: Handle,
        pending: Vec<u8>,
        last_request_id: Option<u64>,
        nonce: String,
        port: u16,
        root: PathBuf,
        registry: WorkspaceRegistry,
        state: tf_web::TfWebState,
        runtime: tokio::runtime::Runtime,
        evidence: BrokerEvidence,
    }
    impl BrokerBridge {
        fn new(
            request_pipe: Handle,
            response_pipe: Handle,
            root: &Path,
            port: u16,
            nonce: &str,
        ) -> Result<Self, String> {
            let registry = WorkspaceRegistry::default();
            let root = registry
                .authorize(root)
                .map_err(|e| format!("authorize case-owned broker fixture: {e}"))?;
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|e| format!("initialize TF3 browser acceptance executor: {e}"))?;
            Ok(Self {
                request_pipe,
                response_pipe,
                pending: Vec::new(),
                last_request_id: None,
                nonce: nonce.to_owned(),
                port,
                root,
                registry,
                state: tf_web::TfWebState::default(),
                runtime,
                evidence: BrokerEvidence::default(),
            })
        }

        fn service_request(&mut self, bytes: &[u8]) -> Result<(), String> {
            let request: BrokerRequest = serde_json::from_slice(bytes)
                .map_err(|e| format!("broker request frame malformed: {e}"))?;
            if request.version != 1
                || request.session != self.nonce
                || request.method != "GET"
                || self
                    .last_request_id
                    .is_some_and(|last| request.request_id <= last)
                || self.evidence.requests_received as usize >= BROKER_MAX_REQUESTS
            {
                return Err("broker version/session/method/requestId/budget mismatch".into());
            }
            self.last_request_id = Some(request.request_id);
            self.evidence.requests_received += 1;
            // This fixed acceptance actor can only request the exact owned
            // loopback fixture. A private redirect is independently denied
            // by TF3's native per-hop policy, never fetched by a second client.
            let parsed =
                reqwest::Url::parse(&request.url).map_err(|_| "broker request invalid URL")?;
            let suffix = format!("/broker/{}", self.nonce);
            let kind = parsed
                .path()
                .strip_prefix('/')
                .and_then(|path| path.strip_suffix(&suffix));
            let fixture = parsed.scheme() == "http"
                && parsed.host_str() == Some("127.0.0.1")
                && parsed.port() == Some(self.port)
                && parsed.query().is_none()
                && parsed.fragment().is_none()
                && kind.is_some_and(|name| {
                    matches!(
                        name,
                        "document"
                            | "css"
                            | "script"
                            | "image"
                            | "iframe"
                            | "fetch"
                            | "redirect-ok"
                            | "redirect-private"
                            | "deny"
                    )
                });
            if !fixture {
                return Err("broker request outside fixed acceptance targets".into());
            }
            let kind = kind.ok_or("missing acceptance broker fixture kind")?;
            let native = tf_web::TfWebRequest {
                operation: tf_web::TfWebOperation::HttpGet,
                actor: "tf-browser-broker-acceptance".into(),
                session_id: self.nonce.clone(),
                workspace_root: self.root.to_string_lossy().into_owned(),
                url: Some(request.url),
                query: None,
                search_result_id: None,
                timeout_ms: Some(4_000),
                max_bytes: Some(32 * 1024),
                max_redirects: Some(2),
            };
            // The deliberate /deny request must go through ordinary PUBLIC
            // TF3 validation and be rejected before hitting the owned origin.
            // A fixture-server 403 alone would not prove native policy deny.
            let prepared = if kind == "deny" {
                tf_web::prepare(native, &self.registry, &self.state)
            } else {
                tf_web::prepare_browser_fixture(native, &self.registry, &self.state, self.port)
            };
            let resource = match prepared {
                Ok(prepared) => {
                    let execution = self.runtime.block_on(async {
                        tokio::time::timeout(Duration::from_secs(5), async {
                            if kind == "deny" {
                                tf_web::execute_browser_resource(
                                    &prepared.token,
                                    &self.registry,
                                    &self.state,
                                )
                                .await
                            } else {
                                tf_web::execute_browser_fixture(
                                    &prepared.token,
                                    &self.registry,
                                    &self.state,
                                )
                                .await
                            }
                        })
                        .await
                    });
                    match execution {
                        Ok(resource) => resource,
                        Err(_) => {
                            let _ = tf_web::cancel(&prepared.token, &self.state);
                            Err("broker-native-executor-timeout".into())
                        }
                    }
                }
                Err(e) => Err(e),
            };
            let (status, kind_header, body, error, reason, receipt): (
                u16,
                String,
                Vec<u8>,
                Option<String>,
                String,
                Option<Value>,
            ) = match resource {
                Ok(resource) => {
                    if kind == "image" {
                        let expected_hash = format!("{:x}", Sha256::digest(BROKER_PNG));
                        if resource.bytes.as_slice() != BROKER_PNG
                            || resource.receipt.content_sha256.as_deref()
                                != Some(expected_hash.as_str())
                        {
                            return Err("TF3 broker image bytes/hash did not match the immutable binary fixture".into());
                        }
                    }
                    let receipt = resource.receipt;
                    let success = receipt.terminal == "completed"
                        && receipt.reason_code == "ok"
                        && receipt
                            .status_code
                            .is_some_and(|status| (200..300).contains(&status));
                    let status = if success {
                        receipt.status_code.unwrap_or(502)
                    } else {
                        403
                    };
                    let error = (!success).then(|| receipt.reason_code.to_owned());
                    let reason = receipt.reason_code.to_owned();
                    let body = if success { resource.bytes } else { Vec::new() };
                    let evidence = json!({
                        "nativeTerminal":receipt.terminal,
                        "reasonCode":receipt.reason_code,
                        "policyDecision":receipt.policy_decision,
                        "statusCode":receipt.status_code,
                        "bytesRetained":receipt.bytes_retained,
                        "contentSha256":receipt.content_sha256,
                        "redirectChain":receipt.redirect_chain,
                        "dnsEvidence":receipt.dns_evidence,
                    });
                    (
                        status,
                        receipt.content_type.unwrap_or_else(|| "text/plain".into()),
                        body,
                        error,
                        reason,
                        Some(evidence),
                    )
                }
                Err(e) => {
                    let reason = e.chars().take(128).collect::<String>();
                    (
                        403,
                        "text/plain".into(),
                        Vec::new(),
                        Some(reason.clone()),
                        reason,
                        None,
                    )
                }
            };
            let delivered = error.is_none();
            let response = BrokerResponse {
                version: 1,
                session: self.nonce.clone(),
                request_id: request.request_id,
                status,
                content_type: kind_header,
                body_base64: encode_base64(&body),
                error,
            };
            let payload = serde_json::to_vec(&response)
                .map_err(|e| format!("serialize bounded broker response: {e}"))?;
            if payload.len() > BROKER_MAX_FRAME_BYTES
                || payload.len() > BROKER_MAX_RESPONSE_FRAME_BYTES
            {
                return Err("broker response exceeds bounded anonymous-pipe frame".into());
            }
            // The restricted host reads this exact response before producing
            // the next request. These bounded frames fit the pipe without an
            // unbounded producer/consumer buffer.
            let mut writer =
                ManuallyDrop::new(unsafe { File::from_raw_handle(self.response_pipe.0) });
            writer
                .write_all(&(payload.len() as u32).to_le_bytes())
                .and_then(|_| writer.write_all(&payload))
                .map_err(|e| format!("write broker response frame: {e}"))?;
            self.evidence.responses_sent += 1;
            let counts = if delivered {
                &mut self.evidence.delivered
            } else {
                &mut self.evidence.denied
            };
            *counts.entry(kind.to_owned()).or_default() += 1;
            self.evidence.receipts.push(json!({
                "requestId":request.request_id,
                "kind":kind,
                "result":if delivered {"delivered"} else {"denied"},
                "reason":reason,
                "status":status,
                "bodyBytes":body.len(),
                "bodySha256":format!("{:x}",Sha256::digest(&body)),
                "tf3":receipt,
            }));
            Ok(())
        }

        fn poll(&mut self) -> Result<(), String> {
            let mut bytes_read = 0usize;
            loop {
                while self.pending.len() >= 4 {
                    let len = u32::from_le_bytes(self.pending[..4].try_into().unwrap()) as usize;
                    if len == 0 || len > BROKER_MAX_FRAME_BYTES {
                        return Err("broker request frame length outside 1..128KiB".into());
                    }
                    if self.pending.len() < len + 4 {
                        break;
                    }
                    let frame = self.pending[4..len + 4].to_vec();
                    self.pending.drain(..len + 4);
                    self.service_request(&frame)?;
                }
                if bytes_read >= BROKER_MAX_FRAME_BYTES {
                    return Ok(());
                }
                let mut available = 0;
                if unsafe {
                    PeekNamedPipe(
                        self.request_pipe.0,
                        null_mut(),
                        0,
                        null_mut(),
                        &mut available,
                        null_mut(),
                    )
                } == 0
                {
                    return if unsafe { GetLastError() } == ERROR_BROKEN_PIPE {
                        if self.pending.is_empty() {
                            Ok(())
                        } else {
                            Err("broker request stream closed mid-frame".into())
                        }
                    } else {
                        Err(err("PeekNamedPipe(broker request)"))
                    };
                }
                if available == 0 {
                    return Ok(());
                }
                let mut chunk = [0u8; 4096];
                let len = (available as usize)
                    .min(chunk.len())
                    .min(BROKER_MAX_FRAME_BYTES - bytes_read);
                let mut reader =
                    ManuallyDrop::new(unsafe { File::from_raw_handle(self.request_pipe.0) });
                let read = reader
                    .read(&mut chunk[..len])
                    .map_err(|e| format!("read broker request bytes: {e}"))?;
                if read == 0 {
                    return Err("broker request stream ended during read".into());
                }
                self.pending.extend_from_slice(&chunk[..read]);
                bytes_read += read;
                if self.pending.len() > BROKER_MAX_FRAME_BYTES + 4 {
                    return Err("broker request accumulated buffer exceeds 128KiB".into());
                }
            }
        }

        fn verify(&self) -> Result<(), String> {
            if !self.pending.is_empty() {
                return Err("broker ended with a partial request frame".into());
            }
            if self.evidence.requests_received != self.evidence.responses_sent {
                return Err("broker request/response frame counts mismatched".into());
            }
            for kind in [
                "document",
                "css",
                "script",
                "image",
                "iframe",
                "fetch",
                "redirect-ok",
            ] {
                if self.evidence.delivered.get(kind).copied().unwrap_or(0) == 0 {
                    return Err(format!(
                        "brokered TF3 resource {kind} not physically delivered"
                    ));
                }
            }
            for kind in ["redirect-private", "deny"] {
                if self.evidence.denied.get(kind).copied().unwrap_or(0) == 0 {
                    return Err(format!(
                        "brokered TF3 denial {kind} not physically observed"
                    ));
                }
            }
            let deny = self.evidence.receipts.iter().any(|receipt| {
                receipt["kind"] == "deny"
                    && receipt["result"] == "denied"
                    && matches!(
                        receipt["reason"].as_str(),
                        Some("nonstandard-port-denied" | "dns-private-or-reserved-denied")
                    )
            });
            if !deny {
                return Err("broker deny lacked native TF3 public-policy rejection proof".into());
            }
            let private_redirect = self.evidence.receipts.iter().any(|receipt| {
                receipt["kind"] == "redirect-private"
                    && receipt["result"] == "denied"
                    && receipt["tf3"]["reasonCode"] == "dns-private-or-reserved-denied"
                    && receipt["tf3"]["redirectChain"]
                        .as_array()
                        .is_some_and(|chain| !chain.is_empty())
            });
            if !private_redirect {
                return Err("broker private redirect lacked TF3 per-hop deny proof".into());
            }
            Ok(())
        }
    }

    struct Launched {
        process: Handle,
        _thread: Handle,
        job: Handle,
        pid: u32,
        stdout: HostStream,
        stderr: HostStream,
        broker: Option<BrokerBridge>,
    }
    impl Launched {
        fn spawn(
            bin: &Path,
            root: &Path,
            profile: Option<&Profile>,
            port: u16,
            nonce: &str,
            brokered: bool,
        ) -> Result<Self, String> {
            if brokered && profile.is_none() {
                return Err(
                    "brokered host requires the existing zero-capability AppContainer".into(),
                );
            }
            let (out_read, out_write) = pipe(false)?;
            let (err_read, err_write) = pipe(false)?;
            let (in_read, in_write) = pipe(true)?;
            drop(in_write); // The host must receive EOF, never the runner's stdin.
                            // Only the restricted brokered child inherits the READ end of
                            // responses and WRITE end of requests. The trusted parent retains
                            // the opposite two ends, which cannot be inherited by WebView2.
            let broker_handles = if brokered {
                let (parent_request_read, child_request_write) = pipe(false)?;
                let (child_response_read, parent_response_write) = pipe(true)?;
                if unsafe { SetHandleInformation(parent_response_write.0, HANDLE_FLAG_INHERIT, 0) }
                    == 0
                {
                    return Err(err("SetHandleInformation(parent broker response write)"));
                }
                let bridge = BrokerBridge::new(
                    parent_request_read,
                    parent_response_write,
                    root,
                    port,
                    nonce,
                )?;
                Some((bridge, child_response_read, child_request_write))
            } else {
                None
            };
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
            // Three restricted attributes: owned job, explicit stdio handles,
            // and unique zero-capability AppContainer SID. Do not opt out of
            // ALL APPLICATION PACKAGES: LPAC would remove the basic Windows
            // Runtime/COM access needed for this real WebView2 acceptance.
            let mut attrs = Attributes::new(if profile.is_some() { 3 } else { 2 })?;
            let jobs = [job.0];
            attrs.add(PROC_THREAD_ATTRIBUTE_JOB_LIST, &jobs)?;
            // An exact, explicit Windows inheritance whitelist; never inherit
            // the parent-facing pipe handles or any unrelated runner objects.
            let broker_stdio = broker_handles
                .as_ref()
                .map(|(_, read, write)| [out_write.0, err_write.0, in_read.0, read.0, write.0]);
            let stdio = [out_write.0, err_write.0, in_read.0];
            // Keep both arrays alive until CreateProcessW consumes the
            // pointer-bearing attribute list, including when brokered.
            if let Some(ref handles) = broker_stdio {
                attrs.add(PROC_THREAD_ATTRIBUTE_HANDLE_LIST, handles)?;
            } else {
                attrs.add(PROC_THREAD_ATTRIBUTE_HANDLE_LIST, &stdio)?;
            }
            let security = profile.map(|p| SECURITY_CAPABILITIES {
                AppContainerSid: p.sid.0,
                Capabilities: null_mut(),
                CapabilityCount: 0,
                Reserved: 0,
            });
            if let Some(ref security) = security {
                attrs.add(PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, security)?;
            }
            let mut startup: STARTUPINFOEXW = unsafe { zeroed() };
            startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
            startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
            startup.StartupInfo.hStdInput = in_read.0;
            startup.StartupInfo.hStdOutput = out_write.0;
            startup.StartupInfo.hStdError = err_write.0;
            startup.lpAttributeList = attrs.ptr();
            let root_str = root.to_string_lossy().into_owned();
            let bin_str = bin.to_string_lossy().into_owned();
            let mode = if brokered {
                "--brokered-child"
            } else if profile.is_some() {
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
            // The host supplies its exact unique webview2-<pid>-<salt> UDF.
            // Do not override that explicit path with the WebView2 environment
            // variable: doing so would invalidate the reported UDF evidence.
            let broker_env = broker_handles.as_ref().map_or_else(String::new, |(_, read, write)| {
                format!(
                    "CLACK_TF_BROWSER_BROKER_READ_HANDLE={}\0CLACK_TF_BROWSER_BROKER_WRITE_HANDLE={}\0",
                    read.0 as usize, write.0 as usize
                )
            });
            let env = wide(format!(
                "LOCALAPPDATA={root_str}\0SystemRoot={system_root}\0TEMP={root_str}\0TMP={root_str}\0{broker_env}"
            ));
            let mut info: PROCESS_INFORMATION = unsafe { zeroed() };
            if unsafe {
                CreateProcessW(
                    wide(bin).as_ptr(),
                    command.as_mut_ptr(),
                    null(),
                    null(),
                    1,
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
                let terminated = unsafe { TerminateProcess(process.0, 1) } != 0;
                let exited = unsafe { WaitForSingleObject(process.0, 3000) } == WAIT_OBJECT_0;
                if !terminated || !exited {
                    return Err("STOP: suspended restricted host job assignment failed; explicit process termination unverified".into());
                }
                return Err("suspended WebView2 host was not in owned kill-on-close job".into());
            }
            if unsafe { ResumeThread(thread.0) } == u32::MAX {
                let reason = err("ResumeThread(WebView2 host)");
                let launched = Self {
                    process,
                    _thread: thread,
                    job,
                    pid: info.dwProcessId,
                    stdout: HostStream::new(out_read),
                    stderr: HostStream::new(err_read),
                    broker: broker_handles.map(|(bridge, _, _)| bridge),
                };
                // The host is suspended, but its job must still be empty
                // before a caller is allowed to delete its AppContainer.
                return match launched.stop_and_verify() {
                    Ok(()) => Err(reason),
                    Err(cleanup) => {
                        Err(format!("STOP: {reason}; job cleanup unverified: {cleanup}"))
                    }
                };
            }
            drop(out_write);
            drop(err_write);
            drop(in_read);
            Ok(Self {
                process,
                _thread: thread,
                job,
                pid: info.dwProcessId,
                stdout: HostStream::new(out_read),
                stderr: HostStream::new(err_read),
                broker: broker_handles.map(|(bridge, _, _)| bridge),
            })
        }
        fn exit_before_cleanup(&self) -> Result<Option<u32>, String> {
            match unsafe { WaitForSingleObject(self.process.0, 0) } {
                WAIT_OBJECT_0 => {
                    let mut code = 0;
                    if unsafe { GetExitCodeProcess(self.process.0, &mut code) } == 0 {
                        Err(err("GetExitCodeProcess(restricted host)"))
                    } else {
                        Ok(Some(code))
                    }
                }
                WAIT_TIMEOUT => Ok(None),
                _ => Err(err("WaitForSingleObject(restricted host)")),
            }
        }
        fn drain_output(&mut self) -> Result<(), String> {
            self.stdout.drain()?;
            self.stderr.drain()
        }
        fn stop_and_verify(&self) -> Result<(), String> {
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
        // The host's early startup-error report intentionally has no normal
        // success or identity fields. Surface its actual failing stage first.
        if value["error"].as_str().is_some_and(|e| !e.is_empty()) {
            return Err(format!(
                "real WebView2 reported launch failure: {}",
                value["error"]
            ));
        }
        if value["appContainer"].as_bool() != Some(isolated) {
            return Err("host reported wrong AppContainer identity".into());
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
        let mut child = match Launched::spawn(bin, root, profile, port, nonce, mode == "brokered") {
            Ok(child) => child,
            Err(e) => {
                preserve_json(
                    &root.join("acceptance-diagnosis.json"),
                    &json!({"case": mode, "stage": "spawn", "failure": e, "hostPid": null}),
                )
                .map_err(|failure| {
                    format!("STOP: {mode} spawn diagnosis persistence failed: {failure}")
                })?;
                if e.starts_with("STOP:") {
                    return Err(e);
                }
                return Err(format!("{mode}: restricted host spawn failed: {e}"));
            }
        };
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
            if let Err(e) = child.drain_output() {
                failure = Some(format!("restricted host output capture failed: {e}"));
                break;
            }
            if let Some(broker) = child.broker.as_mut() {
                if let Err(e) = broker.poll() {
                    failure = Some(format!("restricted broker frame/TF3 dispatch failed: {e}"));
                    break;
                }
            }
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
                let exit = child
                    .exit_before_cleanup()
                    .map(|code| format!("{code:?}"))
                    .unwrap_or_else(|e| format!("unknown ({e})"));
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
        if failure.is_none()
            && Instant::now() >= deadline
            && !root.join("browser-host-report.json").exists()
        {
            failure = Some(format!(
                "real Wry/WebView2 host timed out after {WAIT_MS} ms before report"
            ));
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
        if let Some(broker) = child.broker.as_mut() {
            if let Err(e) = broker.poll() {
                failure = Some(format!("restricted broker final frame read failed: {e}"));
            }
        }
        let broker_verified = child.broker.as_ref().map_or(Ok(()), BrokerBridge::verify);
        let report = check_report(root, pid, isolated);
        let exit_before_cleanup = child.exit_before_cleanup();
        // Preserve diagnostic content even if job cleanup cannot be verified.
        // Job termination/verification STILL precedes case classification.
        let cleanup = child.stop_and_verify();
        let capture = child.drain_output();
        let browser = roles.values().any(|r| r == "browser");
        let renderer = roles.values().any(|r| r == "renderer");
        let unsafe_tokens = isolated
            && (proofs.len() < roles.len()
                || roles.keys().any(|pid| !proofs.contains_key(pid))
                || proofs.values().any(|p| {
                    !p.appcontainer || !p.sid_matches || p.capability_count != 0 || !p.in_owned_job
                }));
        let mut reason = failure
            .or_else(|| report.as_ref().err().cloned())
            .or_else(|| broker_verified.as_ref().err().cloned())
            .or_else(|| roles.is_empty().then(|| format!("roles unavailable: {roles_error:?}")))
            .or_else(|| (!browser || !renderer).then(|| format!("real browser/renderer role unverified: {roles:?}")))
            .or_else(|| unsafe_tokens.then(|| format!("WebView2 browser/renderer AppContainer SID or zero-capability proof failed: {proofs:?}")));
        let stdout = child.stdout.text();
        let stderr = child.stderr.text();
        if let Err(e) = &capture {
            reason.get_or_insert_with(|| format!("restricted host output capture failed: {e}"));
        }
        if let Err(e) = &exit_before_cleanup {
            reason.get_or_insert_with(|| format!("restricted host exit query failed: {e}"));
        }
        if let Some(ref mut explanation) = reason {
            // A rust panic or Wry startup-stage error is typically emitted to
            // stderr before the host is capable of writing its JSON report.
            // Include the exact bounded stream in the immediate FAILED reason.
            *explanation = format!(
                "{explanation}; restricted host exit before job cleanup={exit_before_cleanup:?}; stderr={stderr:?}{}; stdout={stdout:?}{}",
                if child.stderr.truncated { " (truncated)" } else { "" },
                if child.stdout.truncated { " (truncated)" } else { "" },
            );
        }
        preserve_json(
            &root.join("acceptance-diagnosis.json"),
            &json!({
                "case": mode,
                "hostPid": pid,
                "hostAppContainerZeroCapabilitiesJobProven": host_token_proven,
                "hostJobAssignmentVerifiedAtSpawn": true,
                "hostExitBeforeCleanup": exit_before_cleanup.as_ref().ok().copied().flatten(),
                "hostExitQueryError": exit_before_cleanup.as_ref().err(),
                "jobCleanupVerifiedEmpty": cleanup.is_ok(),
                "jobCleanupError": cleanup.as_ref().err(),
                "stdout": stdout,
                "stderr": stderr,
                "stdoutTruncated": child.stdout.truncated,
                "stderrTruncated": child.stderr.truncated,
                "streamBytesLimitEach": HOST_STREAM_LIMIT,
                "captureError": capture.as_ref().err(),
                "broker": child.broker.as_ref().map(|broker| &broker.evidence),
                "brokerVerificationError": broker_verified.as_ref().err(),
                "webviewRoles": roles,
                "webviewTokenProofs": proofs,
                "observedDescendants": observed.values().map(|p| json!({"pid": p.pid, "parent": p.parent, "image": p.image})).collect::<Vec<_>>(),
                "reportError": report.as_ref().err(),
                "result": if reason.is_none() && cleanup.is_ok() { "PASS" } else { "FAILED" },
                "failure": reason,
            }),
        )
        .map_err(|e| format!("STOP: {mode} failed to preserve diagnosis: {e}; root retained: {}", root.display()))?;
        cleanup.map_err(|e| {
            format!(
                "STOP: {mode} unsafe process cleanup: {e}; root retained: {}",
                root.display()
            )
        })?;
        if let Some(e) = reason {
            return Err(format!("{mode}: {e}"));
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

    fn case_result_json(
        result: Option<&Result<(u32, Vec<(u32, String, TokenProof)>), String>>,
    ) -> Value {
        match result {
            Some(Ok((pid, proofs))) => json!({
                "status": "PASS",
                "hostPid": pid,
                "webviewTokenProofs": proofs.iter().map(|(pid, image, token)| {
                    json!({"pid": pid, "image": image, "token": token})
                }).collect::<Vec<_>>(),
            }),
            Some(Err(reason)) => json!({"status": "FAILED", "reason": reason}),
            None => json!({"status": "NOT_RUN", "reason": "positive-control gate not established"}),
        }
    }

    fn clean_owned_udf(root: &Path) -> Result<(), String> {
        // Only this run's new case directory is passed in. Preserve host report
        // and diagnosis, remove the copied host binary and both known possible
        // owned WebView2 UDF locations. Refuse to follow reparse/symlink paths.
        for entry in fs::read_dir(root).map_err(|e| format!("list owned case UDFs: {e}"))? {
            let entry = entry.map_err(|e| format!("read owned case entry: {e}"))?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == "webview" || name.starts_with("webview2-") {
                let kind = entry
                    .file_type()
                    .map_err(|e| format!("stat owned UDF {name}: {e}"))?;
                if !kind.is_dir() || kind.is_symlink() {
                    return Err(format!(
                        "refuse unsafe owned UDF path: {}",
                        entry.path().display()
                    ));
                }
                fs::remove_dir_all(entry.path())
                    .map_err(|e| format!("remove owned UDF {name}: {e}"))?;
            }
        }
        let copied_host = root.join("clack-browser-host.exe");
        if copied_host.exists() {
            fs::remove_file(copied_host)
                .map_err(|e| format!("remove copied acceptance host: {e}"))?;
        }
        Ok(())
    }

    struct BrokerCaseOutcome {
        result: Result<(u32, Vec<(u32, String, TokenProof)>), String>,
        counts: Counts,
        evidence: Option<Value>,
        ipv4_listener: SocketAddr,
        ipv6_listener: SocketAddr,
        listener_cleanup: Result<(), String>,
    }

    fn run_broker_case(
        owned: &Path,
        binary: &[u8],
        profile: &Profile,
        sid: &str,
        nonce: &str,
    ) -> Result<BrokerCaseOutcome, String> {
        // Only after the independent NO-EGRESS case has PASSED. The same
        // unique AppContainer SID is retained; the UDF, executable and broker
        // pipe handles are fresh and owned exclusively by this new case.
        let root = owned.join("brokered");
        fs::create_dir(&root).map_err(|e| format!("create brokered case: {e}"))?;
        fs::create_dir(root.join("webview"))
            .map_err(|e| format!("create brokered owned UDF root: {e}"))?;
        let bin = root.join("clack-browser-host.exe");
        fs::write(&bin, binary).map_err(|e| format!("copy brokered host: {e}"))?;
        grant(&root, sid, true)?;
        grant(&bin, sid, false)?;
        grant(&root.join("webview"), sid, true)?;
        let mut destination = Destination::new(nonce)?;
        destination.set_phase("brokered")?;
        let ipv4_listener = destination.addr;
        let ipv6_listener = destination.ipv6_addr;
        let result = run_case(
            &bin,
            &root,
            "brokered",
            Some(profile),
            ipv4_listener.port(),
            nonce,
        );
        // The case diagnosis was written immutably by run_case, after job
        // teardown. Require the exact same bounded TF3 receipts in the final
        // verdict, including if later fixture cleanup removes its UDF.
        let evidence = fs::read(root.join("acceptance-diagnosis.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .and_then(|value| value.get("broker").cloned());
        let listener_cleanup = destination.shutdown();
        let counts = destination.counts("brokered");
        Ok(BrokerCaseOutcome {
            result,
            counts,
            evidence,
            ipv4_listener,
            ipv6_listener,
            listener_cleanup,
        })
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
        let mut destination = Destination::new(&nonce)?;
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
        if control_result.is_ok()
            && (good.ipv4.connections == 0 || good.ipv6.ipv6_fixture_requests == 0)
        {
            eprintln!(
                "CONTROL network request counts {good:?}: real WebView2 control did not prove both IPv4 reachability and the exact independent IPv6 ::1 fixture GET"
            );
        }
        destination.set_phase("isolated")?;
        let isolated_result = if control_result.is_ok()
            && good.ipv4.connections > 0
            && good.ipv6.ipv6_fixture_requests > 0
        {
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
        let destination_cleanup = destination.shutdown();
        // Both TCP listeners and the IPv4 UDP listener drain their queued
        // observations before this snapshot. An early zero cannot prove deny.
        let denied = destination.counts("isolated");
        // This original, independently verified physical isolation gate is
        // mandatory before even constructing a broker pipe or child process.
        let isolation_verdict = (|| {
            control_result.as_ref().map_err(Clone::clone)?;
            if good.ipv4.connections == 0 {
                return Err(format!(
                    "UNVERIFIED: positive-control WebView2 did not reach independent IPv4 127.0.0.1 TCP listener: {good:?}"
                ));
            }
            if good.ipv6.ipv6_fixture_requests == 0 {
                return Err(format!(
                    "UNVERIFIED: positive-control WebView2 did not send exact per-run /ipv6/control/<nonce> GET to independent IPv6 ::1 TCP listener on same fixture port: {good:?}"
                ));
            }
            isolated_result
                .as_ref()
                .ok_or("positive-control WebView2 navigation/JS probe not established")?
                .as_ref()
                .map_err(Clone::clone)?;
            if denied.tcp_connections != 0
                || denied.ipv4.connections != 0
                || denied.ipv6.connections != 0
                || denied.udp_datagrams != 0
            {
                return Err(format!(
                    "FAIL: isolated WebView2 reached an independent IPv4/IPv6 TCP or IPv4 UDP destination: {denied:?}"
                ));
            }
            if good.udp_datagrams == 0 {
                return Err(format!(
                    "UNVERIFIED: real positive-control WebView2 delivered TCP but no UDP/STUN datagram; separate UDP isolation gate remains open (control={good:?}, isolated={denied:?})"
                ));
            }
            Ok::<(), String>(())
        })();
        let broker_stage = if isolation_verdict.is_ok() && destination_cleanup.is_ok() {
            Some(run_broker_case(&owned, &bytes, &profile, &sid, &nonce))
        } else {
            None
        };
        // Cleanup is attempted only after each child has been *verified* to
        // have zero active job processes. Abort profile deletion otherwise.
        let job_cleanup_uncertain = control_result
            .as_ref()
            .is_err_and(|e| e.starts_with("STOP:"))
            || isolated_result
                .as_ref()
                .is_some_and(|r| r.as_ref().is_err_and(|e| e.starts_with("STOP:")))
            || broker_stage.as_ref().is_some_and(|stage| match stage {
                Ok(broker) => broker
                    .result
                    .as_ref()
                    .is_err_and(|e| e.starts_with("STOP:")),
                Err(e) => e.starts_with("STOP:"),
            });
        let profile_cleanup = if job_cleanup_uncertain {
            Err("process group cleanup uncertain; AppContainer profile retained".to_owned())
        } else {
            profile.delete()
        };
        let verdict = (|| {
            isolation_verdict.as_ref().map_err(Clone::clone)?;
            let control_result = control_result.as_ref().map_err(Clone::clone)?;
            let isolated_result = isolated_result
                .as_ref()
                .ok_or("positive-control WebView2 navigation/JS probe not established")?
                .as_ref()
                .map_err(Clone::clone)?;
            let broker = broker_stage
                .as_ref()
                .ok_or("physical no-egress gate did not authorize broker case")?
                .as_ref()
                .map_err(Clone::clone)?;
            let broker_result = broker.result.as_ref().map_err(Clone::clone)?;
            if let Err(e) = &broker.listener_cleanup {
                return Err(format!(
                    "STOP: brokered destination listener cleanup not verified: {e}"
                ));
            }
            // Only the trusted parent TF3 executor may connect to its exact
            // IPv4 loopback fixture. The restricted brokered renderer's DOM,
            // browser/renderer role and zero-capability tokens are separately
            // proven inside run_case() before this resource classification.
            if broker.counts.ipv4.connections == 0
                || broker.counts.ipv6.connections != 0
                || broker.counts.udp_datagrams != 0
            {
                return Err(format!(
                    "brokered fixture used unverified network families: {:?}",
                    broker.counts
                ));
            }
            for kind in [
                "document",
                "css",
                "script",
                "image",
                "iframe",
                "fetch",
                "redirect-ok",
                "redirect-private",
            ] {
                if broker.counts.ipv4.paths.get(kind).copied().unwrap_or(0) == 0 {
                    return Err(format!(
                        "real TF3 brokered fixture path {kind} was never observed: {:?}",
                        broker.counts
                    ));
                }
            }
            if broker.counts.ipv4.paths.get("deny").copied().unwrap_or(0) != 0 {
                return Err(
                    "TF3 brokered /deny reached origin despite public-policy rejection".into(),
                );
            }
            let receipts = broker
                .evidence
                .as_ref()
                .and_then(|evidence| evidence["receipts"].as_array())
                .ok_or("broker TF3 case diagnosis lacks immutable native receipt trace")?;
            for (path, count) in &broker.counts.ipv4.paths {
                let dispatched = receipts
                    .iter()
                    .filter(|receipt| receipt["kind"].as_str() == Some(path.as_str()))
                    .count();
                // TF3 follows the one controlled /redirect-ok -> /fetch hop,
                // so that additional GET belongs to the same exact receipt.
                let redirected = if path == "fetch" {
                    receipts
                        .iter()
                        .filter(|receipt| {
                            receipt["kind"] == "redirect-ok" && receipt["result"] == "delivered"
                        })
                        .count()
                } else {
                    0
                };
                if *count as usize > dispatched + redirected {
                    return Err(format!(
                        "brokered fixture origin path {path} had {count} requests, exceeding {dispatched} TF3 receipts and {redirected} verified redirects"
                    ));
                }
            }
            Ok::<_, String>((control_result, isolated_result, broker_result))
        })();
        let fixture_cleanup = if profile_cleanup.is_ok() {
            clean_owned_udf(&control)
                .and_then(|_| clean_owned_udf(&isolated))
                .and_then(|_| {
                    let broker_root = owned.join("brokered");
                    if broker_root.exists() {
                        clean_owned_udf(&broker_root)
                    } else {
                        Ok(())
                    }
                })
        } else {
            Err("profile/job cleanup uncertain; owned UDFs retained".into())
        };
        let cleanup_failure = destination_cleanup
            .as_ref()
            .err()
            .map(|e| format!("destination shutdown: {e}"))
            .or_else(|| {
                profile_cleanup
                    .as_ref()
                    .err()
                    .map(|e| format!("profile cleanup: {e}"))
            })
            .or_else(|| {
                fixture_cleanup
                    .as_ref()
                    .err()
                    .map(|e| format!("owned UDF cleanup: {e}"))
            });
        let failure = cleanup_failure
            .as_ref()
            .map(|e| format!("STOP: {e}"))
            .or_else(|| verdict.as_ref().err().cloned());
        // Deliberately retain this unique run's immutable artifacts, including
        // FAILED evidence, after verified-safe process/profile/UDF cleanup.
        preserve_json(
            &owned.join("acceptance-verdict.json"),
            &json!({
                "status": if failure.is_some() { "FAILED" } else { "PASS" },
                "failure": failure,
                "fixtureNonce": nonce,
                "appContainerSid": sid,
                "independentDestinations": {
                    "tcpIpv4": destination.addr.to_string(),
                    "tcpIpv6": destination.ipv6_addr.to_string(),
                    "udpIpv4": destination.addr.to_string(),
                    "udpIpv6": null,
                },
                "control": {"case": case_result_json(Some(&control_result)), "destination": good},
                "isolated": {"case": case_result_json(isolated_result.as_ref()), "destination": denied},
                "brokered": match &broker_stage {
                    Some(Ok(broker)) => json!({
                        "case":case_result_json(Some(&broker.result)),
                        "destination":broker.counts,
                        "tf3Evidence":broker.evidence,
                        "tcpIpv4":broker.ipv4_listener.to_string(),
                        "tcpIpv6":broker.ipv6_listener.to_string(),
                        "destinationShutdown":broker.listener_cleanup.is_ok(),
                        "destinationError":broker.listener_cleanup.as_ref().err(),
                    }),
                    Some(Err(e)) => json!({"case":{"status":"FAILED","reason":e}}),
                    None => json!({"case":{"status":"NOT_RUN","reason":"independent no-egress isolation gate not established"}}),
                },
                "jobProcessesVerifiedGone": !job_cleanup_uncertain,
                "profileDeleted": profile_cleanup.is_ok(),
                "ownedUdfCleaned": fixture_cleanup.is_ok(),
                "destinationShutdown": destination_cleanup.is_ok() && broker_stage.as_ref().is_none_or(|stage| stage.as_ref().is_ok_and(|b|b.listener_cleanup.is_ok())),
                "cleanupError": cleanup_failure,
            }),
        )
        .map_err(|e| format!("STOP: failed to preserve immutable acceptance verdict in {}: {e}", owned.display()))?;
        if let Some(failure) = failure {
            return Err(format!(
                "{failure}; control={good:?}; isolated={denied:?}; retained evidence={}",
                owned.display()
            ));
        }
        let (control_result, isolated_result, broker_result) = verdict?;
        println!(
            "TF_BROWSER_ISOLATION_AND_BROKER_PASS (independent IPv4/IPv6 TCP and IPv4 UDP zero-egress, then TF3 brokered binary resources and native denials): independent IPv4 {} / IPv6 {}; control {good:?}; isolated {denied:?}; control_host={}; isolated_host={}; brokered_host={}; child_tokens={:?}; unique_owned_UDF_cleaned=true; retained evidence={}",
            destination.addr, destination.ipv6_addr,
            control_result.0, isolated_result.0, broker_result.0, isolated_result.1, owned.display(),
        );
        Ok(())
    }
}
