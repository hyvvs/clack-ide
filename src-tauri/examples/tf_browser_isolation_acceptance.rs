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
        collections::BTreeMap,
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
    const MAX_ACTIVE_TCP_FIXTURE_HANDLERS: usize = 32;
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
    const ABNORMAL_EXIT_CODE: u32 = 79;
    #[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
    #[serde(rename_all = "kebab-case")]
    enum NegativeScenario {
        BrokerCrash,
        BrokerTimeout,
        NoIntercept,
        StaleId,
        AbnormalExit,
        Cancel,
        StaleSession,
        MissingReply,
    }
    impl NegativeScenario {
        const ALL: [Self; 8] = [
            Self::BrokerCrash,
            Self::BrokerTimeout,
            Self::NoIntercept,
            Self::StaleId,
            Self::AbnormalExit,
            Self::Cancel,
            Self::StaleSession,
            Self::MissingReply,
        ];
        fn label(self) -> &'static str {
            match self {
                Self::BrokerCrash => "broker-crash",
                Self::BrokerTimeout => "broker-timeout",
                Self::NoIntercept => "no-intercept",
                Self::StaleId => "stale-id",
                Self::AbnormalExit => "abnormal-exit",
                Self::Cancel => "cancel",
                Self::StaleSession => "stale-session",
                Self::MissingReply => "missing-reply",
            }
        }
        fn host_flag(self) -> &'static str {
            match self {
                Self::BrokerCrash => "crash",
                Self::BrokerTimeout => "timeout",
                Self::NoIntercept => "no-intercept",
                Self::StaleId => "stale-id",
                Self::AbnormalExit => "abnormal-exit",
                Self::Cancel => "cancel",
                Self::StaleSession => "stale-session",
                Self::MissingReply => "missing-reply",
            }
        }
    }
    const BROKER_PNG: &[u8] = &[
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 4,
        0, 0, 0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 252, 255, 31, 0, 2,
        235, 1, 245, 106, 87, 144, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ];

    // Only loopback destinations with a physical listener in Destination::new
    // are emitted by this bounded browser script. The literal port is read
    // from the previously authorized brokered document URL; there are no
    // additional listeners, arbitrary URLs, credentials or TF3 exceptions.
    // The external-script DOM title is set LAST, after the finite probes have
    // been initiated. This proves script execution, NOT per-API network IO.
    const HIDDEN_BROKER_PATHS: &[(&str, &str, &str)] = &[
        ("hidden-same-origin", "fetch", "IPv4 owned TCP"),
        (
            "hidden-mapped-v6",
            "fetch",
            "IPv4-mapped IPv6 conditional mapping to owned TCP",
        ),
        ("hidden-v6", "fetch", "IPv6 ::1 owned TCP"),
        (
            "hidden-decimal",
            "fetch",
            "IPv4 127.0.0.1 decimal notation owned TCP",
        ),
        (
            "hidden-hex",
            "fetch",
            "IPv4 127.0.0.1 hexadecimal notation owned TCP",
        ),
        (
            "hidden-localhost",
            "fetch",
            "localhost loopback resolution to owned IPv4/IPv6 TCP",
        ),
        (
            "hidden-eventsource",
            "EventSource bounded close",
            "IPv4 owned TCP",
        ),
        (
            "hidden-worker",
            "data Worker fetch bounded terminate",
            "IPv4 owned TCP",
        ),
        ("hidden-image", "image subresource", "IPv4 owned TCP"),
        ("hidden-css-import", "stylesheet import", "IPv4 owned TCP"),
        ("hidden-font", "font subresource", "IPv4 owned TCP"),
        ("hidden-xhr", "XMLHttpRequest", "IPv4 owned TCP"),
        ("hidden-ws", "WebSocket bounded close", "IPv4 owned TCP"),
        ("hidden-iframe", "iframe subresource", "IPv4 owned TCP"),
        ("hidden-beacon", "sendBeacon", "IPv4 owned TCP"),
    ];

    fn broker_probe_script(nonce: &str) -> String {
        // The script never references literal RFC1918 or link-local hosts:
        // there is no owned listener on those networks. A different-port or
        // out-of-loopback request would violate physical-test authorization.
        // IPv4-mapped IPv6 is attempted as a loopback-mapped candidate;
        // platforms may reject/normalize it before dispatch, so no per-case
        // successful interception is asserted for that representation.
        const SCRIPT: &str = r#"globalThis.__clackBrokerScript=true;
(()=>{const p=location.port,n='__NONCE__',q=k=>'/hidden-'+k+'/broker/'+n,v='http://127.0.0.1:'+p;
const f=u=>{try{fetch(u,{mode:'no-cors',cache:'no-store'}).catch(()=>{})}catch(_){}};
f(v+q('same-origin'));f('http://[::ffff:127.0.0.1]:'+p+q('mapped-v6'));
f('http://[::1]:'+p+q('v6'));f('http://2130706433:'+p+q('decimal'));
f('http://0x7f000001:'+p+q('hex'));f('http://localhost:'+p+q('localhost'));
try{let e=new EventSource(v+q('eventsource'));e.onerror=()=>e.close();setTimeout(()=>e.close(),400)}catch(_){}
try{let w=new Worker('data:text/javascript,'+encodeURIComponent("fetch('"+v+q('worker')+"',{mode:'no-cors'}).catch(()=>{})"));setTimeout(()=>w.terminate(),700)}catch(_){}
try{let i=new Image();i.hidden=true;i.src=v+q('image');document.body.appendChild(i)}catch(_){}
try{let s=document.createElement('style');s.textContent="@import url('"+v+q('css-import')+"');@font-face{font-family:clProbe;src:url('"+v+q('font')+"')}#broker-proof{font-family:clProbe}";document.head.appendChild(s)}catch(_){}
try{let x=new XMLHttpRequest();x.open('GET',v+q('xhr'));x.send()}catch(_){}
try{let i=document.createElement('iframe');i.hidden=true;i.src=v+q('iframe');document.body.appendChild(i)}catch(_){}
try{navigator.sendBeacon(v+q('beacon'),'probe')}catch(_){}
try{let w=new WebSocket('ws://127.0.0.1:'+p+q('ws'));setTimeout(()=>w.close(),400)}catch(_){}
try{let r=new RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:'+p}]});r.createDataChannel('probe');r.createOffer().then(o=>r.setLocalDescription(o)).catch(()=>{});setTimeout(()=>r.close(),900)}catch(_){}
})();
document.title='clack-renderer-js-__NONCE__';"#;
        SCRIPT.replace("__NONCE__", nonce)
    }

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
        // Classification only; never retain request bytes, URLs, or headers.
        transport_failures: BTreeMap<String, u32>,
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
        transport_failures: BTreeMap<String, u32>,
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
                let mut handlers: Vec<thread::JoinHandle<()>> = Vec::new();
                loop {
                    // A browser or HTTP client can open an idle/speculative
                    // socket without sending request bytes. The original
                    // single-threaded accept-and-read fixture blocked every
                    // later HTTP request behind that socket for two seconds.
                    // That can create a false native TF3 request failure.
                    // Reap completed workers and allow only bounded, owned
                    // parallel connections. No request is retried.
                    let mut index = 0;
                    while index < handlers.len() {
                        if handlers[index].is_finished() {
                            if handlers.swap_remove(index).join().is_err() {
                                if let Ok(mut faults) = errors.lock() {
                                    faults.push(format!("{family} TCP fixture handler panicked"));
                                }
                            }
                        } else {
                            index += 1;
                        }
                    }
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
                            if handlers.len() >= MAX_ACTIVE_TCP_FIXTURE_HANDLERS {
                                if let Ok(mut faults) = errors.lock() {
                                    faults.push(format!(
                                        "{family} bounded TCP fixture handler capacity exceeded"
                                    ));
                                }
                                continue;
                            }
                            let handler_seen = seen.clone();
                            let handler_nonce = nonce.clone();
                            let handler_mode = mode.clone();
                            match thread::Builder::new()
                                .name("tf4-controlled-tcp".into())
                                .spawn(move || {
                                    if let Err(reason) = Self::handle(
                                        &mut stream,
                                        &handler_mode,
                                        &handler_nonce,
                                        ipv6,
                                        shutting_down,
                                        &handler_seen,
                                    ) {
                                        // A connection alone is never an HTTP
                                        // success. Keep a category, not bytes.
                                        if let Ok(mut rows) = handler_seen.lock() {
                                            let row = rows.entry(handler_mode).or_default();
                                            *row.transport_failures
                                                .entry(reason.to_owned())
                                                .or_default() += 1;
                                            let family_row =
                                                if ipv6 { &mut row.ipv6 } else { &mut row.ipv4 };
                                            *family_row
                                                .transport_failures
                                                .entry(reason.to_owned())
                                                .or_default() += 1;
                                        }
                                    }
                                }) {
                                Ok(handler) => handlers.push(handler),
                                Err(_) => {
                                    if let Ok(mut faults) = errors.lock() {
                                        faults.push(format!(
                                            "{family} TCP fixture worker unavailable"
                                        ));
                                    }
                                }
                            }
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
                // All accepted connections are accounted for before shutdown
                // returns its listener-backed counts, including idle ones.
                for handler in handlers {
                    if handler.join().is_err() {
                        if let Ok(mut faults) = errors.lock() {
                            faults.push(format!(
                                "{family} TCP fixture handler panicked during shutdown"
                            ));
                        }
                    }
                }
            })
        }

        fn new(nonce: &str) -> Result<Self, String> {
            // Windows can reserve a port for UDP even when TCP successfully
            // assigned the same ephemeral number (observed 10013 in an
            // immutable earlier case). Let the kernel select an admissible
            // UDP port first; then bind both independent TCP families to that
            // exact port. No retry, sleep, or global network setting change.
            let udp = UdpSocket::bind((ALLOWLIST_HOST, 0))
                .map_err(|e| format!("bind independent IPv4 UDP destination: {e}"))?;
            let port = udp.local_addr().map_err(|e| e.to_string())?.port();
            let listener = TcpListener::bind((ALLOWLIST_HOST, port))
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
        ) -> Result<(), &'static str> {
            // Bound a late socket's read after the verified process group is
            // empty. Even malformed queued requests must be counted promptly.
            stream
                .set_read_timeout(Some(if draining {
                    Duration::from_millis(50)
                } else {
                    Duration::from_secs(2)
                }))
                .map_err(|_| "read-deadline-setup")?;
            stream
                .set_write_timeout(Some(Duration::from_secs(2)))
                .map_err(|_| "write-deadline-setup")?;
            // TCP reads can split a header at any byte boundary. Read this
            // SAME accepted connection until a full header terminator arrives,
            // with a strict 4KiB/2s (50ms cleanup) bound. Never re-connect or
            // retry a remote effect to obtain a nicer-looking HTTP count.
            let mut bytes = [0_u8; 4096];
            let mut used = 0;
            let deadline = Instant::now()
                + if draining {
                    Duration::from_millis(50)
                } else {
                    Duration::from_secs(2)
                };
            loop {
                if bytes[..used].windows(4).any(|w| w == b"\r\n\r\n")
                    || bytes[..used].windows(2).any(|w| w == b"\n\n")
                {
                    break;
                }
                if used == bytes.len() {
                    return Err("headers-oversize");
                }
                if Instant::now() >= deadline {
                    return Err(if used == 0 {
                        "headers-timeout-empty"
                    } else {
                        "headers-timeout-partial"
                    });
                }
                // Winsock rounds SO_RCVTIMEO to milliseconds; a sub-ms value
                // may become zero (infinite) unless explicitly bounded.
                let remaining = deadline
                    .saturating_duration_since(Instant::now())
                    .max(Duration::from_millis(1));
                stream
                    .set_read_timeout(Some(remaining))
                    .map_err(|_| "read-deadline-setup")?;
                match stream.read(&mut bytes[used..]) {
                    Ok(0) => {
                        return Err(if used == 0 {
                            "peer-closed-empty"
                        } else {
                            "peer-closed-partial"
                        })
                    }
                    Ok(n) => used += n,
                    Err(e)
                        if matches!(
                            e.kind(),
                            std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                        ) =>
                    {
                        return Err(if used == 0 {
                            "headers-timeout-empty"
                        } else {
                            "headers-timeout-partial"
                        })
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::ConnectionReset => {
                        return Err("peer-reset")
                    }
                    Err(_) => return Err("headers-read-failed"),
                }
            }
            let line = String::from_utf8_lossy(&bytes[..used]);
            let request = line.lines().next().unwrap_or("");
            let mut parts = request.split_ascii_whitespace();
            let method = parts.next().unwrap_or("");
            let path = parts.next().ok_or("request-line-incomplete")?;
            if !matches!(method, "GET" | "POST" | "HEAD" | "OPTIONS")
                || !path.starts_with('/')
                || !parts.next().is_some_and(|p| p.starts_with("HTTP/1."))
            {
                return Err("request-line-invalid");
            }
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
                                "<!doctype html><html><head><link rel=\"stylesheet\" href=\"/css/broker/{nonce}\"><script defer src=\"/script/broker/{nonce}\"></script></head><body><main id=\"broker-proof\">Clack brokered WebView2</main><label>Probe label</label><button type=\"button\" aria-label=\"Probe action\">Test action</button><input type=\"password\" value=\"TF4_TEST_ONLY_NEVER_EXPORT\"><input type=\"hidden\" value=\"TF4_TEST_ONLY_NEVER_EXPORT\"><img src=\"/image/broker/{nonce}\"><iframe src=\"/iframe/broker/{nonce}\"></iframe><script>for(const kind of ['fetch','redirect-ok','redirect-private','deny','unsupported']){{fetch('/'+kind+'/broker/{nonce}',{{mode:'no-cors'}}).catch(()=>{{}})}}</script></body></html>"
                            ).into_bytes(),
                            "text/html",
                            None,
                        ),
                        "css" => ("200 OK", b"#broker-proof { display: block }".to_vec(), "text/css", None),
                        "script" => ("200 OK", broker_probe_script(nonce).into_bytes(), "application/javascript", None),
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
            ).map_err(|_| "response-header-write-failed")?;
            if let Some(redirect) = redirect {
                write!(stream, "Location: {redirect}\r\n")
                    .map_err(|_| "response-redirect-write-failed")?;
            }
            stream
                .write_all(b"\r\n")
                .map_err(|_| "response-header-write-failed")?;
            stream
                .write_all(&content)
                .map_err(|_| "response-body-write-failed")?;
            stream.flush().map_err(|_| "response-flush-failed")
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
    fn owned_job_processes(rows: &[Process], job: HANDLE) -> Vec<Process> {
        // Toolhelp's th32ParentProcessID is NOT a live process-parent link.
        // Windows can reuse a dead parent's PID; recursively traversing that
        // number included unrelated user applications and their WebView2
        // descendants in a previous immutable negative case (lclkgY).
        //
        // Our unique, already-assigned Job Object is the authoritative
        // ownership boundary. Only inventory processes for which the OS
        // independently confirms membership in that exact job. A separate
        // WMI scan of the unique case UDF below still checks for WebView2
        // children *outside* the job (rather than silently ignoring escapes).
        rows.iter()
            .filter(|p| {
                let raw = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, p.pid) };
                if raw.is_null() {
                    // A short-lived process may disappear between Toolhelp
                    // snapshot and query. Never infer ownership from a stale
                    // parent PID when the kernel membership query is absent.
                    return false;
                }
                let process = Handle(raw);
                let mut in_job = 0;
                unsafe { IsProcessInJob(process.0, job, &mut in_job) != 0 && in_job != 0 }
            })
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
        fault_injections: Vec<Value>,
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
        response_pipe: Option<Handle>,
        pending: Vec<u8>,
        last_request_id: Option<u64>,
        fault: Option<NegativeScenario>,
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
            fault: Option<NegativeScenario>,
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
                response_pipe: Some(response_pipe),
                pending: Vec::new(),
                last_request_id: None,
                fault,
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
            if let Some(fault) = self.fault {
                // A negative case must not dispatch any native TF3 request.
                // That preserves zero independent-origin counts and proves
                // the host never silently falls back to direct network IO.
                if kind != "document"
                    || self.evidence.requests_received != 1
                    || request.request_id != 1
                {
                    return Err(format!(
                        "unexpected broker request or replay in {} negative case",
                        fault.label()
                    ));
                }
                let event = match fault {
                    NegativeScenario::BrokerCrash => {
                        // The trusted broker disappears by closing its only
                        // response-writer endpoint. The restricted host sees
                        // real EOF on its inherited anonymous pipe.
                        if self.response_pipe.take().is_none() {
                            return Err("broker crash injection pipe already closed".into());
                        }
                        json!({"kind":"broker-pipe-eof", "requestId":request.request_id,
                            "responseFramesSent":0, "nativeDispatches":0})
                    }
                    NegativeScenario::BrokerTimeout | NegativeScenario::MissingReply => {
                        // Keep the pipe open but never write any response;
                        // host-side bounded timeout must terminate this case.
                        // Missing-reply is a distinct host CLI configuration,
                        // not a retry of the prior timeout case.
                        json!({"kind":if fault == NegativeScenario::MissingReply {
                                "broker-missing-reply-withheld"
                            } else { "broker-response-withheld" }, "requestId":request.request_id,
                            "responseFramesSent":0, "nativeDispatches":0})
                    }
                    NegativeScenario::StaleId => {
                        // The response is well formed, but its identity is
                        // intentionally stale. The host must reject it rather
                        // than deliver HTML, retry or perform direct egress.
                        let forged_id = request.request_id.saturating_sub(1);
                        let response = BrokerResponse {
                            version: 1,
                            session: self.nonce.clone(),
                            request_id: forged_id,
                            status: 403,
                            content_type: "text/plain".into(),
                            body_base64: String::new(),
                            error: Some("negative-stale-request-id".into()),
                        };
                        let wire = serde_json::to_vec(&response)
                            .map_err(|e| format!("encode stale-id response frame: {e}"))?;
                        if wire.len() > BROKER_MAX_RESPONSE_FRAME_BYTES {
                            return Err("stale-id response exceeds bounded frame".into());
                        }
                        let handle = self
                            .response_pipe
                            .as_ref()
                            .ok_or("stale-id response pipe unexpectedly closed")?;
                        let mut writer =
                            ManuallyDrop::new(unsafe { File::from_raw_handle(handle.0) });
                        writer
                            .write_all(&(wire.len() as u32).to_le_bytes())
                            .and_then(|_| writer.write_all(&wire))
                            .map_err(|e| format!("write stale-id response frame: {e}"))?;
                        self.evidence.responses_sent += 1;
                        json!({"kind":"broker-stale-request-id", "requestId":request.request_id,
                            "forgedRequestId":forged_id, "responseFramesSent":1, "nativeDispatches":0})
                    }
                    NegativeScenario::StaleSession => {
                        // The parent speaks a fully valid v1 protocol reply:
                        // correct nonce, matching request ID, 200 and HTML.
                        // Only the FEATURE-ONLY host seam expects `x{nonce}`
                        // instead and must reject the otherwise valid frame,
                        // completing one synthetic 502 COM response. Never
                        // weaken parent session identity or dispatch TF3.
                        const BODY: &[u8] =
                            b"<!doctype html><title>stale session must be rejected</title>";
                        let response = BrokerResponse {
                            version: 1,
                            session: self.nonce.clone(),
                            request_id: request.request_id,
                            status: 200,
                            content_type: "text/html".into(),
                            body_base64: encode_base64(BODY),
                            error: None,
                        };
                        let wire = serde_json::to_vec(&response)
                            .map_err(|e| format!("encode valid stale-session test reply: {e}"))?;
                        if wire.len() > BROKER_MAX_RESPONSE_FRAME_BYTES {
                            return Err("stale-session response exceeds bounded frame".into());
                        }
                        let handle = self
                            .response_pipe
                            .as_ref()
                            .ok_or("stale-session response pipe unexpectedly closed")?;
                        let mut writer =
                            ManuallyDrop::new(unsafe { File::from_raw_handle(handle.0) });
                        writer
                            .write_all(&(wire.len() as u32).to_le_bytes())
                            .and_then(|_| writer.write_all(&wire))
                            .map_err(|e| format!("write valid stale-session test frame: {e}"))?;
                        self.evidence.responses_sent += 1;
                        json!({"kind":"broker-valid-reply-stale-session", "requestId":request.request_id,
                            "replySessionMatchesRequest":true, "replyStatus":200,
                            "replyContentType":"text/html", "replyBodySha256":format!("{:x}",Sha256::digest(BODY)),
                            "responseFramesSent":1, "nativeDispatches":0})
                    }
                    NegativeScenario::NoIntercept
                    | NegativeScenario::AbnormalExit
                    | NegativeScenario::Cancel => {
                        return Err(format!(
                            "{} unexpectedly forwarded a request despite its fail-closed seam",
                            fault.label()
                        ));
                    }
                };
                self.evidence.fault_injections.push(event);
                return Ok(());
            }
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
            let response = self
                .response_pipe
                .as_ref()
                .ok_or("normal broker response pipe unexpectedly closed")?;
            let mut writer = ManuallyDrop::new(unsafe { File::from_raw_handle(response.0) });
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
                    // Exact acceptance origin is checked BEFORE resolving or
                    // connecting to the metadata redirect's different host.
                    // Earlier immutable cases used per-hop DNS classification;
                    // the newer stronger fixture policy rejects even earlier.
                    && receipt["tf3"]["reasonCode"] == "fixture-redirect-origin-denied"
                    && receipt["tf3"]["redirectChain"]
                        .as_array()
                        .is_some_and(|chain| !chain.is_empty())
                    && receipt["tf3"]["dnsEvidence"]
                        .as_array()
                        .is_some_and(|rows| rows.len() == 1
                            && rows[0]["host"] == "127.0.0.1")
            });
            if !private_redirect {
                return Err(
                    "broker private redirect lacked TF3 exact-origin pre-connect deny proof".into(),
                );
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
            fault: Option<NegativeScenario>,
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
                    fault,
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
            let fault_arg = fault.map_or(String::new(), |fault| {
                format!(" --broker-fault {}", fault.host_flag())
            });
            let mut command = wide(format!(
                "{} {mode} {} --fixture-port {port} --fixture-nonce {nonce}{fault_arg}",
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
        fault: Option<NegativeScenario>,
    ) -> Result<(u32, Vec<(u32, String, TokenProof)>), String> {
        let isolated = profile.is_some();
        let mut child = match Launched::spawn(
            bin,
            root,
            profile,
            port,
            nonce,
            mode == "brokered" || fault.is_some(),
            fault,
        ) {
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
        let mut abnormal_exit_injected = false;
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
                    for process in owned_job_processes(&all, child.job.0) {
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
            if fault == Some(NegativeScenario::AbnormalExit)
                && !abnormal_exit_injected
                && host_token_proven
                && observed.values().any(|p| p.image == "msedgewebview2.exe")
                && String::from_utf8_lossy(&child.stderr.bytes)
                    .contains("broker.fault.abnormal_exit.armed")
            {
                // Terminate ONLY this launched, proven AppContainer host PID.
                // Require the host's *actual logged* post-WebView2 hook/arm
                // stage before the kill. Observing an early Chromium child
                // alone can precede controller setup, so killing on child
                // appearance would make navigation-suppression proof race.
                // There is no sleep/retry-for-green: this is an exact
                // readiness condition inside the existing bounded watchdog.
                // Its owned job still contains browser children; subsequent
                // stop_and_verify must terminate and account for every one.
                if unsafe { WaitForSingleObject(child.process.0, 0) } != WAIT_TIMEOUT {
                    failure = Some("abnormal-exit target already exited before injection".into());
                    break;
                }
                if unsafe { TerminateProcess(child.process.0, ABNORMAL_EXIT_CODE) } == 0 {
                    failure = Some(err("TerminateProcess(owned abnormal-exit host)"));
                    break;
                }
                abnormal_exit_injected = true;
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
                    for process in owned_job_processes(&all, child.job.0) {
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
                "negativeFault": fault.map(NegativeScenario::label),
                "abnormalHostTerminationInjected": abnormal_exit_injected,
                "abnormalHostTerminationExitCode": if abnormal_exit_injected {Some(ABNORMAL_EXIT_CODE)} else {None},
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
        host_report: Option<Value>,
        semantic_receipt: Value,
        hidden_probe_receipt: Value,
        ipv4_listener: SocketAddr,
        ipv6_listener: SocketAddr,
        listener_cleanup: Result<(), String>,
    }

    fn broker_semantic_receipt(host: Option<&Value>, nonce: &str, port: u16) -> Value {
        fn exact_keys(value: &Value, keys: &[&str]) -> bool {
            value.as_object().is_some_and(|object| {
                object.len() == keys.len() && keys.iter().all(|name| object.contains_key(*name))
            })
        }
        let proof = host.map(|h| &h["brokerSemanticSnapshot"]);
        let snapshot = proof.map(|p| &p["snapshot"]);
        let expected_origin = format!("http://127.0.0.1:{port}");
        let expected_url = format!("{expected_origin}/document/broker/{nonce}");
        let expected_title = format!("clack-renderer-js-{nonce}");
        let native_status_verified = host.is_some_and(|h| {
            h["brokerSemanticSnapshotStatus"] == "verified"
                && h["brokerSemanticSnapshotVerified"] == true
                && h["brokerSemanticSnapshotError"].is_null()
        });
        let identity = proof.is_some_and(|p| {
            exact_keys(
                p,
                &[
                    "session",
                    "pageGeneration",
                    "snapshotGeneration",
                    "observedAtMs",
                    "origin",
                    "sessionVerified",
                    "redactedLabels",
                    "snapshot",
                ],
            ) && p["session"] == nonce
                && p["origin"] == expected_origin
                && p["sessionVerified"] == true
                && p["pageGeneration"] == 1
                && p["snapshotGeneration"] == 1
                && p["observedAtMs"].as_u64().is_some_and(|t| t > 0)
                && p["redactedLabels"] == 0
        });
        let mut main = false;
        let mut label = false;
        let mut button = false;
        let mut last_index = 0u64;
        let mut total_name_bytes = 0usize;
        let mut labels_and_roles_are_safe = true;
        let elements = snapshot
            .and_then(|s| s["elements"].as_array())
            .map(|items| items.as_slice())
            .unwrap_or(&[]);
        let visits = snapshot.and_then(|s| s["visited"].as_u64()).unwrap_or(0);
        for item in elements {
            let role = item["role"].as_str().unwrap_or("");
            let name = item["name"].as_str().unwrap_or("");
            let index = item["index"].as_u64().unwrap_or(0);
            if !exact_keys(item, &["index", "role", "name"])
                || index <= last_index
                || index > visits
                || !matches!(role, "main" | "label" | "button" | "img")
                || !matches!(
                    name,
                    "" | "Clack brokered WebView2" | "Probe label" | "Probe action"
                )
            {
                labels_and_roles_are_safe = false;
            }
            last_index = index;
            total_name_bytes = total_name_bytes.saturating_add(name.len());
            main |= role == "main" && name == "Clack brokered WebView2";
            label |= role == "label" && name == "Probe label";
            button |= role == "button" && name == "Probe action";
        }
        let bounded = snapshot.is_some_and(|s| {
            exact_keys(
                s,
                &[
                    "version",
                    "url",
                    "title",
                    "visited",
                    "textBytes",
                    "truncated",
                    "elements",
                ],
            ) && s["version"] == 1
                && s["url"] == expected_url
                && s["title"] == expected_title
                && (3..=512).contains(&visits)
                && (3..=64).contains(&elements.len())
                && total_name_bytes <= 32 * 1024
                && s["textBytes"].as_u64() == Some(total_name_bytes as u64)
                && s["truncated"] == false
        });
        // The host's semantic-lite snapshot intentionally excludes PASSWORD
        // and HIDDEN INPUT values and never exports raw HTML or DOM handles.
        // This independent runner rejects unexpected fields and names without
        // copying any private fixture value into its own receipt or verdict.
        let safe_fixture = main && label && button && labels_and_roles_are_safe;
        let verified = native_status_verified && identity && bounded && safe_fixture;
        json!({
            "status":if verified {"PASS"} else {"UNVERIFIED_OR_FAILED"},
            "hostNativeSnapshotVerified":native_status_verified,
            "sourceSessionOriginPageAndGenerationVerified":identity,
            "boundedSafeSchemaAndText":bounded,
            "mainLandmarkAndBenignLabelButtonVerified":safe_fixture,
            "passwordAndHiddenInputExcludedFromSemanticOutput":labels_and_roles_are_safe,
            "visited":visits,
            "elements":elements.len(),
            "noRawDomOrInputValuesCopiedToThisReceipt":true,
            "scope":"feature-only native WebView2 semantic-lite DOM summary, not a full accessibility tree",
        })
    }

    fn hidden_probe_receipt(
        nonce: &str,
        ipv4: SocketAddr,
        ipv6: SocketAddr,
        counts: &Counts,
        broker: Option<&Value>,
        host: Option<&Value>,
        listener_shutdown: bool,
        normal_broker_succeeded: bool,
    ) -> Value {
        let script = broker_probe_script(nonce);
        let expected_hash = format!("{:x}", Sha256::digest(script.as_bytes()));
        let script_receipt_matches =
            broker
                .and_then(|e| e["receipts"].as_array())
                .is_some_and(|receipts| {
                    receipts.iter().any(|r| {
                        r["kind"] == "script"
                            && r["result"] == "delivered"
                            && r["tf3"]["nativeTerminal"] == "completed"
                            && r["tf3"]["contentSha256"] == expected_hash
                    })
                });
        let link_local_redirect_denied_without_connecting = broker
            .and_then(|e| e["receipts"].as_array())
            .is_some_and(|receipts| {
                receipts.iter().any(|r| {
                    r["kind"] == "redirect-private"
                        && r["result"] == "denied"
                        && r["tf3"]["reasonCode"] == "dns-private-or-reserved-denied"
                        && r["tf3"]["redirectChain"]
                            .as_array()
                            .is_some_and(|hops| !hops.is_empty())
                })
            });
        let mut all_hidden_paths_zero = true;
        let paths = HIDDEN_BROKER_PATHS
            .iter()
            .map(|(path, api, destination)| {
                let tcp4 = counts.ipv4.paths.get(*path).copied().unwrap_or(0);
                let tcp6 = counts.ipv6.paths.get(*path).copied().unwrap_or(0);
                all_hidden_paths_zero &= tcp4 == 0 && tcp6 == 0;
                json!({
                    "route":path,
                    "rendererApi":api,
                    "onlyControlledDestination":destination,
                    "javascriptInvocation":"bounded-best-effort",
                    "individualWebView2COMInterception":"NOT_INDEPENDENTLY_ATTESTED",
                    "ipv4ListenerHttpRequests":tcp4,
                    "ipv6ListenerHttpRequests":tcp6,
                    "physicalOriginObservation":if tcp4 == 0 && tcp6 == 0 {
                        "NO_REQUEST_REACHED_OWNED_LISTENERS"
                    } else {
                        "UNAUTHORIZED_REQUEST_REACHED_OWNED_LISTENER"
                    },
                })
            })
            .collect::<Vec<_>>();
        // Each accepted TCP connection is accounted for regardless of the
        // presence of a complete request line. A browser's speculative socket
        // is not made invisible just because it sent zero HTTP bytes.
        let v4_has_no_unparsed_connections = counts.ipv4.connections == counts.ipv4.http_requests;
        let completed_title = host.is_some_and(|h| {
            h["rendererDomProof"] == true && h["scriptObserved"] == true && h["success"] == true
        });
        let completed_local_denials = host.is_some_and(|h| {
            h["brokerDenied"].as_u64().unwrap_or(0) >= 3
                && h["brokerIntercepted"].as_u64().unwrap_or(0)
                    >= h["brokerForwarded"].as_u64().unwrap_or(0) + 3
                && h["brokerForwarded"].as_u64() == Some(9)
                && h["brokerAnswered"].as_u64() == Some(9)
                && h["brokerPendingCount"] == 0
                && h["brokerErrors"] == 0
        });
        let no_nonfixture_family_egress = counts.ipv6.connections == 0
            && counts.udp_datagrams == 0
            && all_hidden_paths_zero
            && v4_has_no_unparsed_connections;
        let pass = normal_broker_succeeded
            && listener_shutdown
            && script_receipt_matches
            && completed_title
            && completed_local_denials
            && no_nonfixture_family_egress;
        json!({
            "status":if pass {"PASS"} else {"UNVERIFIED_OR_FAILED"},
            "mode":"feature-only-brokered-hidden-network-class-probes",
            "scope":"fixed case-owned loopback ports only; browser script execution via native DOM title; per-API interception not directly witnessed",
            "fixtureEndpoints":{"tcpIpv4":ipv4.to_string(),"tcpIpv6":ipv6.to_string(),
                "udpIpv4":ipv4.to_string(),"udpIpv6":null},
            "nativeScript":{
                "sha256":expected_hash,
                "bytes":script.as_bytes().len(),
                "tf3ReceiptHashMatches":script_receipt_matches,
                "realRendererExecutedThroughFinalTitle":completed_title,
            },
            "browserComAggregate":{
                "atLeastThreeLocalDeniedRequestsCompleted":completed_local_denials,
                "intercepted":host.and_then(|h|h["brokerIntercepted"].as_u64()),
                "forwarded":host.and_then(|h|h["brokerForwarded"].as_u64()),
                "locallyDenied":host.and_then(|h|h["brokerDenied"].as_u64()),
                "pendingDeferrals":host.and_then(|h|h["brokerPendingCount"].as_u64()),
                "individualProbeUrlsOrSourceKinds":"NOT_REPORTED_BY_HOST",
            },
            "physicalListener":{
                "ipv4":counts.ipv4,
                "ipv6":counts.ipv6,
                "udpIpv4Datagrams":counts.udp_datagrams,
                "udpIpv6":"NOT_INSTRUMENTED",
                "hiddenPathsAllZero":all_hidden_paths_zero,
                "unparsedIpv4TcpConnectionsZero":v4_has_no_unparsed_connections,
                "ipv6TcpZero":counts.ipv6.connections == 0,
                "udpIpv4Zero":counts.udp_datagrams == 0,
                "listenerShutdown":listener_shutdown,
            },
            "httpSourceKinds":paths,
            "stun":{
                "uri":"stun:127.0.0.1:<case-owned-port>",
                "api":"RTCPeerConnection controlled ICE/STUN with close by 900ms",
                "udpIpv4Datagrams":counts.udp_datagrams,
                "note":"Browser may not issue ICE/STUN packets; zero datagrams is not proof ICE packet was attempted",
            },
            "unownedAddressClassesNotProbed":[
                {"class":"RFC1918-private-literal",
                 "status":"NOT_EXECUTED_NO_CASE_OWNED_DESTINATION",
                 "reason":"No owned TCP/UDP listener is bound to a private RFC1918 interface; routing there would target unapproved devices"},
                {"class":"IPv4-link-local-literal",
                 "status":"NOT_EXECUTED_NO_CASE_OWNED_DESTINATION",
                 "reason":"No owned TCP/UDP listener is bound to a link-local address; existing redirect-private uses TF3 per-hop denial before any link-local connection",
                 "existingTf3PrivateRedirectDeniedBeforeConnect":link_local_redirect_denied_without_connecting},
            ],
            "noExternalOrUnownedDestinationsAdded":true,
            "noParentTf3FixturePolicyChange":true,
            "note":"All loopback probes use new hidden paths prohibited by broker_owned_url; native TF3 still fetches only its original 9 fixed resource requests. An API being called does NOT prove WebView2 emitted an HTTP request; independent listeners establish only that none reached these specific destinations.",
        })
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
        // Keep the 3KiB anonymous-pipe response contract intact. Estimate the
        // complete serialized frame, not merely the JS payload; request IDs
        // remain <=20 under the existing bounded broker protocol.
        let script = broker_probe_script(nonce);
        let projected_frame = serde_json::to_vec(&BrokerResponse {
            version: 1,
            session: nonce.into(),
            request_id: 20,
            status: 200,
            content_type: "application/javascript".into(),
            body_base64: encode_base64(script.as_bytes()),
            error: None,
        })
        .map_err(|e| format!("serialize fixed hidden-probe frame for preflight: {e}"))?;
        if projected_frame.len() > BROKER_MAX_RESPONSE_FRAME_BYTES {
            return Err(format!(
                "fixed hidden browser script response would exceed bounded {} byte pipe frame ({} bytes)",
                BROKER_MAX_RESPONSE_FRAME_BYTES,
                projected_frame.len()
            ));
        }
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
            None,
        );
        // The case diagnosis was written immutably by run_case, after job
        // teardown. Require the exact same bounded TF3 receipts in the final
        // verdict, including if later fixture cleanup removes its UDF.
        let evidence = fs::read(root.join("acceptance-diagnosis.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .and_then(|value| value.get("broker").cloned());
        let host_report = fs::read(root.join("browser-host-report.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
        let listener_cleanup = destination.shutdown();
        let counts = destination.counts("brokered");
        let semantic_receipt =
            broker_semantic_receipt(host_report.as_ref(), nonce, ipv4_listener.port());
        preserve_json(
            &root.join("semantic-snapshot-receipt.json"),
            &semantic_receipt,
        )
        .map_err(|e| format!("STOP: preserve bounded native semantic receipt: {e}"))?;
        let hidden_probe_receipt = hidden_probe_receipt(
            nonce,
            ipv4_listener,
            ipv6_listener,
            &counts,
            evidence.as_ref(),
            host_report.as_ref(),
            listener_cleanup.is_ok(),
            result.is_ok(),
        );
        // Another create-new immutable record alongside, never replacing
        // browser-host-report, native TF3 receipts or prior physical cases.
        preserve_json(
            &root.join("hidden-network-probe-receipt.json"),
            &hidden_probe_receipt,
        )
        .map_err(|e| format!("STOP: preserve owned hidden-probe receipt: {e}"))?;
        Ok(BrokerCaseOutcome {
            result,
            counts,
            evidence,
            host_report,
            semantic_receipt,
            hidden_probe_receipt,
            ipv4_listener,
            ipv6_listener,
            listener_cleanup,
        })
    }

    struct NegativeCaseOutcome {
        fault: NegativeScenario,
        passed: bool,
        unsafe_cleanup: bool,
        evidence: Value,
    }

    fn run_negative_case(
        owned: &Path,
        binary: &[u8],
        profile: &Profile,
        sid: &str,
        nonce: &str,
        fault: NegativeScenario,
    ) -> Result<NegativeCaseOutcome, String> {
        let label = fault.label();
        let root = owned.join(format!("negative-{label}"));
        fs::create_dir(&root).map_err(|e| format!("create owned negative {label} root: {e}"))?;
        fs::create_dir(root.join("webview"))
            .map_err(|e| format!("create owned negative {label} UDF: {e}"))?;
        let bin = root.join("clack-browser-host.exe");
        fs::write(&bin, binary).map_err(|e| format!("copy negative {label} host: {e}"))?;
        grant(&root, sid, true)?;
        grant(&bin, sid, false)?;
        grant(&root.join("webview"), sid, true)?;

        // A new independently bound IPv4/IPv6 TCP + IPv4 UDP receiver for
        // EVERY negative. The broker is deliberately not allowed to dispatch
        // even an accepted fixture GET, so any accepted socket is a failure.
        let mut destination = Destination::new(nonce)?;
        destination.set_phase(label)?;
        let listener_v4 = destination.addr;
        let listener_v6 = destination.ipv6_addr;
        let result = run_case(
            &bin,
            &root,
            label,
            Some(profile),
            listener_v4.port(),
            nonce,
            Some(fault),
        );
        let shutdown = destination.shutdown();
        let counts = destination.counts(label);
        let diagnosis = fs::read(root.join("acceptance-diagnosis.json"))
            .ok()
            .and_then(|contents| serde_json::from_slice::<Value>(&contents).ok());
        let host_report = fs::read(root.join("browser-host-report.json"))
            .ok()
            .and_then(|contents| serde_json::from_slice::<Value>(&contents).ok());

        let verified = (|| {
            if result.is_ok() {
                return Err(
                    "faulted host unexpectedly completed its normal broker success gate".to_owned(),
                );
            }
            if result
                .as_ref()
                .err()
                .is_some_and(|e| e.starts_with("STOP:"))
            {
                return Err("negative process job cleanup reported STOP".to_owned());
            }
            let d = diagnosis
                .as_ref()
                .ok_or("negative host diagnosis not preserved")?;
            if d["hostAppContainerZeroCapabilitiesJobProven"] != true
                || d["hostJobAssignmentVerifiedAtSpawn"] != true
                || d["jobCleanupVerifiedEmpty"] != true
                || d["negativeFault"] != label
            {
                return Err(
                    "negative host SID/zero-capability/job/cleanup/fault proof missing".into(),
                );
            }
            if shutdown.is_err() {
                return Err("negative destination listener cleanup not verified".into());
            }
            if counts.tcp_connections != 0
                || counts.ipv4.connections != 0
                || counts.ipv6.connections != 0
                || counts.udp_datagrams != 0
            {
                return Err(
                    "negative case reached an independent IPv4/IPv6 TCP or IPv4 UDP listener"
                        .into(),
                );
            }
            // Any WebView2 process we actually observed must remain in the
            // same owned job and unique zero-capability AppContainer. A
            // teardown race may prevent observing all process roles; never
            // invent missing token proofs or imply a renderer was exercised.
            let proofs = d["webviewTokenProofs"]
                .as_object()
                .ok_or("negative WebView2 token proof map absent")?;
            let roles = d["webviewRoles"]
                .as_object()
                .ok_or("negative WebView2 role map absent")?;
            for pid in roles.keys() {
                let proof = proofs
                    .get(pid)
                    .ok_or("negative observed browser role lacks token proof")?;
                if proof["appcontainer"] != true
                    || proof["sid_matches"] != true
                    || proof["capability_count"] != 0
                    || proof["in_owned_job"] != true
                {
                    return Err(
                        "negative WebView2 role escaped AppContainer SID/zero capabilities/job"
                            .into(),
                    );
                }
            }
            for proof in proofs.values() {
                if proof["appcontainer"] != true
                    || proof["sid_matches"] != true
                    || proof["capability_count"] != 0
                    || proof["in_owned_job"] != true
                {
                    return Err("negative observed WebView2 process had unsafe token/job".into());
                }
            }
            let broker = &d["broker"];
            let requests = broker["requests_received"].as_u64().unwrap_or(0);
            let responses = broker["responses_sent"].as_u64().unwrap_or(0);
            let injections = broker["fault_injections"]
                .as_array()
                .map(|items| items.as_slice())
                .unwrap_or(&[]);
            if broker["receipts"]
                .as_array()
                .is_some_and(|rows| !rows.is_empty())
                || broker["delivered"]
                    .as_object()
                    .is_some_and(|rows| !rows.is_empty())
            {
                return Err("negative case unexpectedly dispatched a TF3 network request".into());
            }
            let forwarded = host_report
                .as_ref()
                .and_then(|h| h["brokerForwarded"].as_u64())
                .unwrap_or(0);
            let intercepted = host_report
                .as_ref()
                .and_then(|h| h["brokerIntercepted"].as_u64())
                .unwrap_or(0);
            if forwarded > 1 || intercepted > 1 || requests > 1 || responses > 1 {
                return Err("negative broker performed a silent retry or multiple requests".into());
            }
            match fault {
                NegativeScenario::BrokerCrash
                | NegativeScenario::BrokerTimeout
                | NegativeScenario::StaleId
                | NegativeScenario::StaleSession
                | NegativeScenario::MissingReply => {
                    let expected_kind = match fault {
                        NegativeScenario::BrokerCrash => "broker-pipe-eof",
                        NegativeScenario::BrokerTimeout => "broker-response-withheld",
                        NegativeScenario::StaleId => "broker-stale-request-id",
                        NegativeScenario::StaleSession => "broker-valid-reply-stale-session",
                        NegativeScenario::MissingReply => "broker-missing-reply-withheld",
                        _ => unreachable!(),
                    };
                    let reply_sent = matches!(
                        fault,
                        NegativeScenario::StaleId | NegativeScenario::StaleSession
                    );
                    if requests != 1
                        || forwarded != 1
                        || intercepted != 1
                        || injections.len() != 1
                        || injections[0]["kind"] != expected_kind
                        || injections[0]["requestId"] != 1
                        || responses != u64::from(reply_sent)
                        || injections[0]["responseFramesSent"] != u64::from(reply_sent)
                        || (fault == NegativeScenario::StaleId
                            && injections[0]["forgedRequestId"] != 0)
                        || (fault == NegativeScenario::StaleSession
                            && (injections[0]["replySessionMatchesRequest"] != true
                                || injections[0]["replyStatus"] != 200
                                || injections[0]["replyContentType"] != "text/html"
                                || injections[0]["responseFramesSent"] != 1))
                        || injections[0]["nativeDispatches"] != 0
                    {
                        return Err(
                            "negative broker request/EOF/timeout/stale-ID/stale-session/missing-reply injection proof missing"
                                .into(),
                        );
                    }
                    let report = host_report
                        .as_ref()
                        .ok_or("faulted WebView2 host report absent")?;
                    let timed_out = matches!(
                        fault,
                        NegativeScenario::BrokerTimeout | NegativeScenario::MissingReply
                    );
                    let expected_status = if timed_out { 504 } else { 502 };
                    if report["success"] != false
                        || report["rendererDomProof"] != false
                        || report["brokerHookReady"] != true
                        || report["brokerAnswered"].as_u64() != Some(1)
                        || report["brokerErrors"].as_u64().unwrap_or(0) == 0
                        || report["brokerFaultMode"] != fault.host_flag()
                        || report["brokerFaultTriggered"] != true
                        || report["brokerPendingCount"] != 0
                        || report["brokerLastSyntheticStatus"] != expected_status
                        || report["brokerCompleted5xx"].as_u64().unwrap_or(0) == 0
                    {
                        return Err(
                            "faulted host did not deliver exactly one synthetic denial with fault marker before document delivery".into()
                        );
                    }
                    if timed_out
                        && (report["brokerTimeouts"].as_u64().unwrap_or(0) == 0
                            || report["brokerSynthetic504"].as_u64().unwrap_or(0) == 0)
                    {
                        return Err(
                            "broker timeout/missing-reply lacked bounded pipe timeout and completed synthetic 504 evidence".into()
                        );
                    }
                    if !timed_out
                        && (report["brokerTimeouts"].as_u64().unwrap_or(0) != 0
                            || report["brokerSynthetic502"].as_u64().unwrap_or(0) == 0)
                    {
                        return Err("broker non-timeout fault unexpectedly timed out".into());
                    }
                }
                NegativeScenario::Cancel => {
                    // COM cancellation is local to the restricted host. A
                    // request is intercepted but never forwarded to the
                    // parent, and exactly one completed synthetic 503 must
                    // account for the pending deferral.
                    if requests != 0
                        || responses != 0
                        || !injections.is_empty()
                        || forwarded != 0
                        || intercepted != 1
                    {
                        return Err("cancel seam forwarded a request, retried, or failed to intercept exactly once".into());
                    }
                    let report = host_report
                        .as_ref()
                        .ok_or("cancelled WebView2 host report absent")?;
                    if report["success"] != false
                        || report["rendererDomProof"] != false
                        || report["brokerHookReady"] != true
                        || report["brokerFaultMode"] != fault.host_flag()
                        || report["brokerFaultTriggered"] != true
                        || report["brokerCancelled"].as_u64() != Some(1)
                        || report["brokerDenied"].as_u64() != Some(1)
                        || report["brokerAnswered"].as_u64() != Some(1)
                        || report["brokerPendingCount"] != 0
                        || report["brokerLastSyntheticStatus"] != 503
                        || report["brokerSynthetic503"].as_u64() != Some(1)
                        || report["brokerCompleted5xx"].as_u64() != Some(1)
                        || report["brokerTimeouts"].as_u64().unwrap_or(0) != 0
                        || report["brokerErrors"].as_u64().unwrap_or(0) != 0
                    {
                        return Err("cancel seam lacks completed COM synthetic 503 and zero-pending/no-forward proof".into());
                    }
                }
                NegativeScenario::NoIntercept => {
                    // Worker-54 deliberately skips BOTH filter and navigation.
                    // This is a safe-configuration denial, not proof of a
                    // browser navigating with an accidentally missing hook.
                    if requests != 0 || responses != 0 || !injections.is_empty() {
                        return Err(
                            "safe no-intercept configuration unexpectedly used broker pipes".into(),
                        );
                    }
                    let report = host_report
                        .as_ref()
                        .ok_or("no-intercept host report absent")?;
                    if report["success"] != false
                        || report["brokerHookReady"] != false
                        || report["brokerIntercepted"].as_u64().unwrap_or(0) != 0
                        || report["brokerForwarded"].as_u64().unwrap_or(0) != 0
                        || report["brokerFaultMode"] != fault.host_flag()
                        || report["brokerFaultTriggered"] != true
                        || report["rendererDomProof"] != false
                        || report["brokerPendingCount"] != 0
                        || !report["brokerLastSyntheticStatus"].is_null()
                    {
                        return Err("no-intercept safe gate did not explicitly suppress interception/navigation".into());
                    }
                }
                NegativeScenario::AbnormalExit => {
                    if d["abnormalHostTerminationInjected"] != true
                        || d["hostExitBeforeCleanup"] != ABNORMAL_EXIT_CODE
                        || requests != 0
                        || responses != 0
                        || !injections.is_empty()
                    {
                        return Err(
                            "abnormal host termination or missing retry proof not established"
                                .into(),
                        );
                    }
                    if !d["observedDescendants"]
                        .as_array()
                        .is_some_and(|rows| rows.iter().any(|r| r["image"] == "msedgewebview2.exe"))
                    {
                        return Err("abnormal host termination was not observed after real WebView2 startup".into());
                    }
                    if !d["stderr"]
                        .as_str()
                        .is_some_and(|trace| trace.contains("broker.fault.abnormal_exit.armed"))
                    {
                        return Err(
                            "abnormal host was not demonstrably armed with navigation suppressed"
                                .into(),
                        );
                    }
                }
            }
            Ok::<(), String>(())
        })();
        let unsafe_cleanup = diagnosis
            .as_ref()
            .is_none_or(|d| d["jobCleanupVerifiedEmpty"] != true)
            || result
                .as_ref()
                .err()
                .is_some_and(|e| e.starts_with("STOP:"));
        let receipt = json!({
            "case":label,
            "injectedFault":fault,
            "status":if verified.is_ok() {"PASS"} else {"FAILED"},
            "classification":if fault == NegativeScenario::NoIntercept {
                "simulated-safe-configuration-deny-no-navigation"
            } else {"physical-fault-injection"},
            "failure":verified.as_ref().err(),
            "normalCaseResult":case_result_json(Some(&result)),
            "listenerEndpoints":{"tcpIpv4":listener_v4.to_string(),"tcpIpv6":listener_v6.to_string(),
                "udpIpv4":listener_v4.to_string(),"udpIpv6":null},
            "independentDestination":counts,
            "listenerShutdown":shutdown.is_ok(),
            "listenerShutdownError":shutdown.as_ref().err(),
            "hostDiagnosis":diagnosis,
            "hostReport":host_report,
            "observedNoDuplicateBrokerFrames":diagnosis.as_ref().is_some_and(|d|
                d["broker"]["requests_received"].as_u64().is_some_and(|count|count <= 1))
                && host_report.as_ref().is_none_or(|h|
                    h["brokerForwarded"].as_u64().is_some_and(|count|count <= 1)),
            "networkEvidenceScope":"independent case-owned loopback IPv4/IPv6 TCP and IPv4 UDP listeners only; UDPv6 not measured; no global OS egress attestation",
            "ownedJobCleanupVerified":!unsafe_cleanup,
        });
        preserve_json(&root.join("negative-acceptance-receipt.json"), &receipt)
            .map_err(|e| format!("STOP: retain immutable {label} negative receipt: {e}"))?;
        Ok(NegativeCaseOutcome {
            fault,
            passed: verified.is_ok(),
            unsafe_cleanup,
            evidence: receipt,
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
            None,
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
                None,
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
        // Only proceed after the separate no-egress/real-renderer gate and a
        // successful normal broker. Every fault gets its own owned child, job,
        // anonymous pipes, UDF, v4/v6 TCP and v4 UDP listeners and immutable
        // receipt. Never replay an earlier case or weaken its observations.
        let mut negative_cases = Vec::<Result<NegativeCaseOutcome, String>>::new();
        if isolation_verdict.is_ok()
            && destination_cleanup.is_ok()
            && broker_stage.as_ref().is_some_and(|stage| {
                stage.as_ref().is_ok_and(|broker| {
                    broker.result.is_ok()
                        && broker.listener_cleanup.is_ok()
                        && broker.counts.ipv4.connections > 0
                        && broker.counts.ipv6.connections == 0
                        && broker.counts.udp_datagrams == 0
                })
            })
        {
            for fault in NegativeScenario::ALL {
                let outcome = run_negative_case(&owned, &bytes, &profile, &sid, &nonce, fault);
                if let Err(reason) = &outcome {
                    // Even pre-spawn failures should retain a create-new case
                    // receipt when their case-owned directory was created.
                    // Never overwrite an earlier receipt or remove evidence.
                    let root = owned.join(format!("negative-{}", fault.label()));
                    let receipt = root.join("negative-acceptance-receipt.json");
                    if root.is_dir() && !receipt.exists() {
                        let saved = preserve_json(
                            &receipt,
                            &json!({
                                "case":fault.label(),
                                "status":"FAILED",
                                "stage":"preflight-or-evidence",
                                "failure":reason,
                                "ownedJobCleanupVerified":false,
                                "independentDestination":"UNVERIFIED",
                            }),
                        );
                        if let Err(error) = saved {
                            eprintln!(
                                "STOP: negative {} preflight receipt preservation failed: {error}",
                                fault.label()
                            );
                        }
                    }
                }
                let unsafe_to_continue = outcome.as_ref().map_or(true, |case| case.unsafe_cleanup);
                negative_cases.push(outcome);
                if unsafe_to_continue {
                    // Retain the profile and all failure evidence rather than
                    // risk spawning another child into an uncertain job state.
                    break;
                }
            }
        }
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
            })
            || negative_cases
                .iter()
                .any(|case| case.as_ref().map_or(true, |case| case.unsafe_cleanup));
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
            if broker.hidden_probe_receipt["status"] != "PASS" {
                return Err(format!(
                    "brokered hidden network-class probes lack real renderer/script/COM/owned listener zero-egress proof: {}",
                    broker.hidden_probe_receipt["status"]
                ));
            }
            if broker.semantic_receipt["status"] != "PASS" {
                return Err("brokered native semantic-lite snapshot lacked scoped source/session/generation, bounded safe roles, or controlled main/label/button proof".into());
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
            if broker
                .counts
                .ipv4
                .paths
                .get("unsupported")
                .copied()
                .unwrap_or(0)
                != 0
            {
                return Err(
                    "unrecognized broker resource reached origin despite COM local-deny".into(),
                );
            }
            let receipts = broker
                .evidence
                .as_ref()
                .and_then(|evidence| evidence["receipts"].as_array())
                .ok_or("broker TF3 case diagnosis lacks immutable native receipt trace")?;
            let host = broker
                .host_report
                .as_ref()
                .ok_or("normal broker host report unavailable for unrecognized-resource test")?;
            if receipts.len() != 9
                || broker
                    .evidence
                    .as_ref()
                    .and_then(|e| e["requests_received"].as_u64())
                    != Some(9)
                || host["brokerDenied"].as_u64().unwrap_or(0) == 0
                || host["brokerIntercepted"].as_u64().unwrap_or(0)
                    <= host["brokerForwarded"].as_u64().unwrap_or(0)
                || host["brokerPendingCount"] != 0
                || host["brokerAnswered"].as_u64() != Some(9)
                || host["brokerCompleted2xx"].as_u64().unwrap_or(0) < 7
                || host["brokerCompleted4xx"].as_u64().unwrap_or(0) == 0
            {
                return Err("broker missing completed COM deferral/resource proof, independent COM-local 403 unknown-resource denial, or forwarded unknown request to TF3".into());
            }
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
            if negative_cases.len() != NegativeScenario::ALL.len() {
                return Err("physical deterministic negative suite was not fully executed".into());
            }
            for (index, case) in negative_cases.iter().enumerate() {
                let case = case.as_ref().map_err(Clone::clone)?;
                if case.fault != NegativeScenario::ALL[index] || !case.passed {
                    return Err(format!(
                        "physical negative {} failed required fault/zero-egress/cleanup proof: {}",
                        case.fault.label(),
                        case.evidence["failure"].as_str().unwrap_or("unverified")
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
                .and_then(|_| {
                    for fault in NegativeScenario::ALL {
                        let root = owned.join(format!("negative-{}", fault.label()));
                        if root.exists() {
                            clean_owned_udf(&root)?;
                        }
                    }
                    Ok(())
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
                        "hostBrokerDenied":broker.host_report.as_ref().and_then(|h|h["brokerDenied"].as_u64()),
                        "unknownResourceOriginZero":broker.counts.ipv4.paths.get("unsupported").copied().unwrap_or(0) == 0,
                        "hiddenNetworkProbes":broker.hidden_probe_receipt,
                        "nativeSemanticSnapshot":broker.semantic_receipt,
                        "tcpIpv4":broker.ipv4_listener.to_string(),
                        "tcpIpv6":broker.ipv6_listener.to_string(),
                        "destinationShutdown":broker.listener_cleanup.is_ok(),
                        "destinationError":broker.listener_cleanup.as_ref().err(),
                    }),
                    Some(Err(e)) => json!({"case":{"status":"FAILED","reason":e}}),
                    None => json!({"case":{"status":"NOT_RUN","reason":"independent no-egress isolation gate not established"}}),
                },
                "physicalNegativeSuite": {
                    "status":if negative_cases.len() == NegativeScenario::ALL.len() && negative_cases.iter().all(|case| case.as_ref().is_ok_and(|case| case.passed)) {"PASS"} else {"NOT_PROVEN"},
                    "scope":"eight-feature-only-physical-faults including cancel (completed COM 503), stale-session (valid parent frame rejected with completed COM 502), and missing-reply (bounded completed COM 504); UDPv6 not measured",
                    "expectedCount":NegativeScenario::ALL.len(),
                    "performedCount":negative_cases.len(),
                    "cases": negative_cases.iter().map(|case|match case {
                        Ok(case)=>case.evidence.clone(),
                        Err(reason)=>json!({"status":"FAILED","reason":reason}),
                    }).collect::<Vec<_>>(),
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
            "TF_BROWSER_ISOLATION_BROKER_AND_NEGATIVE_PASS (independent IPv4/IPv6 TCP and IPv4 UDP zero-egress, TF3 brokered binary resources/native denials, and eight deterministic fault cases): independent IPv4 {} / IPv6 {}; control {good:?}; isolated {denied:?}; control_host={}; isolated_host={}; brokered_host={}; child_tokens={:?}; unique_owned_UDF_cleaned=true; retained evidence={}",
            destination.addr, destination.ipv6_addr,
            control_result.0, isolated_result.0, broker_result.0, isolated_result.1, owned.display(),
        );
        Ok(())
    }
}
