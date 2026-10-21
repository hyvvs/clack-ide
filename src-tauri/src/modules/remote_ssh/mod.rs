pub mod guardian;
pub mod lifecycle;
mod process;
pub use lifecycle::{
    acquire_for_endpoint, remote_ssh_acquire, remote_ssh_heartbeat, remote_ssh_release,
};
#[cfg(test)]
mod tests;

use process::{capture, command, OwnedChild};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    net::{TcpListener, TcpStream, ToSocketAddrs},
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

const HOST: &str = "clack-ssh.invalid";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub host: String,
    pub username: String,
    pub port: u16,
    pub key_path: Option<String>,
    pub remote_host: String,
    pub remote_port: u16,
}
impl Config {
    pub fn validate(&self) -> Result<(), String> {
        let atom = |s: &str| {
            !s.is_empty()
                && s.len() <= 253
                && !s.starts_with('-')
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b".-_".contains(&b))
        };
        if !atom(&self.host)
            || !atom(&self.username)
            || self.port == 0
            || self.remote_port == 0
            || !matches!(self.remote_host.as_str(), "localhost" | "127.0.0.1" | "::1")
            || self
                .key_path
                .as_ref()
                .is_some_and(|s| s.is_empty() || s.len() > 4096 || s.contains(['\0', '\r', '\n']))
        {
            return Err("invalid-ssh-configuration".into());
        }
        Ok(())
    }
    fn trust_id(&self) -> String {
        format!(
            "{:x}",
            Sha256::digest(format!("{}:{}", self.host, self.port))
        )
    }
    fn host_pattern(&self) -> String {
        if self.port == 22 {
            self.host.clone()
        } else {
            format!("[{}]:{}", self.host, self.port)
        }
    }
}

pub fn logical_url(id: &str) -> String {
    let encoded: String = id.as_bytes().iter().map(|b| format!("{b:02x}")).collect();
    format!("http://{HOST}/{encoded}/")
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub state: String,
    pub fingerprint: Option<String>,
    pub trust_source: Option<String>,
}
impl Status {
    fn new(state: &str) -> Self {
        Self {
            state: state.into(),
            fingerprint: None,
            trust_source: None,
        }
    }
}
struct Runtime {
    child: Option<OwnedChild>,
    port: Option<u16>,
    status: Status,
    pending: Option<(String, String)>,
    retry_at: Instant,
    consumers: HashMap<String, Option<Instant>>,
    pinned: bool,
    idle_since: Option<Instant>,
}
impl Default for Runtime {
    fn default() -> Self {
        Self {
            child: None,
            port: None,
            status: Status::new("disconnected"),
            pending: None,
            retry_at: Instant::now(),
            consumers: HashMap::new(),
            pinned: false,
            idle_since: None,
        }
    }
}
struct Slot {
    config: Config,
    revision: u64,
    generation: AtomicU64,
    operation: Mutex<()>,
    flight: tokio::sync::Mutex<()>,
    runtime: Mutex<Runtime>,
}
type Slots = HashMap<String, Arc<Slot>>;
fn slots() -> &'static Mutex<Slots> {
    static SLOTS: OnceLock<Mutex<Slots>> = OnceLock::new();
    SLOTS.get_or_init(Mutex::default)
}
fn stop(slot: &Slot) {
    if let Ok(mut r) = slot.runtime.lock() {
        slot.generation.fetch_add(1, Ordering::SeqCst);
        r.child = None;
        r.port = None;
        r.pending = None;
        r.consumers.clear();
        r.pinned = false;
        r.idle_since = None;
        r.status = Status::new("disconnected");
    }
}
pub fn shutdown() {
    if let Ok(mut slots) = slots().lock() {
        for slot in slots.values() {
            stop(slot);
        }
        slots.clear();
    }
}
pub fn reconcile(value: &Value) {
    if let Ok(mut slots) = slots().lock() {
        slots.retain(|id, slot| {
            let keep = value["endpoints"].as_array().is_some_and(|es| {
                es.iter().any(|e| {
                    e["id"] == *id
                        && e["deletedAt"].is_null()
                        && e["allowPrivateNetwork"] == true
                        && e["configurationRevision"].as_u64() == Some(slot.revision)
                        && serde_json::from_value::<Config>(e["ssh"].clone())
                            .ok()
                            .as_ref()
                            == Some(&slot.config)
                })
            });
            if !keep {
                stop(slot);
            }
            keep
        });
    }
}
fn current_status(slot: &Slot) -> Status {
    let Ok(mut r) = slot.runtime.lock() else {
        return Status::new("ssh-error");
    };
    if r.child.as_mut().is_some_and(|child| !child.alive()) {
        r.status.state = "offline".into();
        r.child = None;
        r.port = None;
    }
    r.status.clone()
}
fn finish(slot: &Slot, generation: u64, status: Status) -> Result<Status, String> {
    let mut r = slot.runtime.lock().map_err(|_| "ssh-error")?;
    if slot.generation.load(Ordering::SeqCst) != generation {
        return Ok(Status::new("disconnected"));
    }
    r.status = status.clone();
    Ok(status)
}

pub fn resolve(mut url: reqwest::Url) -> Result<reqwest::Url, String> {
    if url.host_str() != Some(HOST) {
        return Ok(url);
    }
    if url.scheme() != "http"
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("ssh-unavailable".into());
    }
    let path = url.path().to_owned();
    let slots = slots().lock().map_err(|_| "ssh-error")?;
    let (slot, rest) = slots
        .iter()
        .find_map(|(id, slot)| {
            let base = logical_url(id);
            let prefix = reqwest::Url::parse(&base).ok()?.path().to_owned();
            path.strip_prefix(&prefix)
                .map(|rest| (slot.clone(), rest.to_owned()))
        })
        .ok_or("ssh-disconnected")?;
    drop(slots);
    if current_status(&slot).state != "connected" {
        return Err("ssh-disconnected".into());
    }
    let r = slot.runtime.lock().map_err(|_| "ssh-error")?;
    url.set_host(Some("127.0.0.1")).map_err(|_| "ssh-error")?;
    url.set_port(Some(r.port.ok_or("ssh-disconnected")?))
        .map_err(|_| "ssh-error")?;
    url.set_path(&format!("/{rest}"));
    Ok(url)
}

pub fn validate_endpoint(e: &Value) -> Result<(), String> {
    if let Some(raw) = e.get("ssh").filter(|v| !v.is_null()) {
        let config: Config =
            serde_json::from_value(raw.clone()).map_err(|_| "invalid-ssh-configuration")?;
        config.validate()?;
        let id = e["id"]
            .as_str()
            .filter(|id| !id.is_empty() && id.len() <= 2048)
            .ok_or("invalid-ssh-configuration")?;
        if e["baseURL"] != logical_url(id) || !e["credentialRef"].is_null() {
            return Err("invalid-ssh-configuration".into());
        }
    } else if e["baseURL"]
        .as_str()
        .and_then(|u| reqwest::Url::parse(u).ok())
        .is_some_and(|u| u.host_str() == Some(HOST))
    {
        return Err("invalid-ssh-configuration".into());
    }
    Ok(())
}

fn public_key(text: &str) -> Option<String> {
    text.lines()
        .filter(|l| !l.starts_with('#'))
        .find_map(|line| {
            let mut parts = line.split_whitespace();
            parts.next()?;
            let kind = parts.next()?;
            let data = parts.next()?;
            (kind == "ssh-ed25519"
                && data.len() <= 512
                && data
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"+/=".contains(&b)))
            .then(|| format!("{kind} {data}"))
        })
}
fn trust_decision(
    trusted: Option<&str>,
    key: &str,
    fp: &str,
    pending: Option<&(String, String)>,
    approval: Option<&str>,
    system: bool,
) -> Result<&'static str, String> {
    if let Some(trusted) = trusted {
        return if public_key(trusted).as_deref() == Some(key) {
            Ok("Clack trusted host")
        } else {
            Err("host-key-changed".into())
        };
    }
    if system {
        return Ok("System known_hosts");
    }
    if approval == Some(fp) && pending == Some(&(key.into(), fp.into())) {
        return Ok("Explicit fingerprint confirmation");
    }
    Err("verification-required".into())
}
fn safe_address(config: &Config) -> Result<String, String> {
    use super::net::{ip_kind, is_blocked_host_name, IpKind};
    if is_blocked_host_name(&config.host) {
        return Err("unsafe-ssh-host".into());
    }
    let ips: Vec<_> = (config.host.as_str(), config.port)
        .to_socket_addrs()
        .map_err(|_| "host-unreachable")?
        .take(65)
        .collect();
    if ips.is_empty()
        || ips.len() > 64
        || ips.iter().any(|a| {
            a.ip().is_unspecified()
                || a.ip().is_multicast()
                || matches!(ip_kind(a.ip()), IpKind::BlockedMetadata)
        })
    {
        return Err("unsafe-ssh-host".into());
    }
    Ok(ips[0].ip().to_string())
}
fn observe_args(config: &Config, address: &str, quarantine: &Path) -> Vec<String> {
    let mut args: Vec<String> = [
        "-F",
        "none",
        "-N",
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "GlobalKnownHostsFile=none",
        "-o",
        "UpdateHostKeys=no",
        "-o",
        "HashKnownHosts=no",
        "-o",
        "HostKeyAlgorithms=ssh-ed25519",
        "-o",
        "ConnectTimeout=5",
        "-o",
        "ConnectionAttempts=1",
        "-o",
        "PreferredAuthentications=none",
        "-o",
        "PubkeyAuthentication=no",
        "-o",
        "IdentityAgent=none",
        "-o",
        "PasswordAuthentication=no",
        "-o",
        "KbdInteractiveAuthentication=no",
        "-o",
        "ForwardAgent=no",
    ]
    .iter()
    .map(|s| (*s).into())
    .collect();
    args.extend([
        "-o".into(),
        format!(
            "UserKnownHostsFile=\"{}\"",
            quarantine.to_string_lossy().replace('\\', "/")
        ),
        "-o".into(),
        format!("HostName={address}"),
        "-o".into(),
        format!("HostKeyAlias={}", config.host_pattern()),
        "-p".into(),
        config.port.to_string(),
        "-l".into(),
        config.username.clone(),
        config.host.clone(),
    ]);
    args
}
fn observe(config: &Config, address: &str, quarantine: &Path) -> Result<String, String> {
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(quarantine)
        .map_err(|_| "trust-store-unavailable")?;
    let result = (|| {
        let mut cmd = command("ssh")?;
        cmd.args(observe_args(config, address, quarantine));
        let mut child = OwnedChild::spawn(cmd)?;
        let until = Instant::now() + Duration::from_secs(8);
        while child.alive() && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(20));
        }
        drop(child);
        public_key(&std::fs::read_to_string(quarantine).map_err(|_| "host-unreachable")?)
            .ok_or_else(|| "host-unreachable".into())
    })();
    let _ = std::fs::remove_file(quarantine);
    result
}
fn fingerprint(path: &Path) -> Result<String, String> {
    let mut cmd = command("ssh-keygen")?;
    cmd.args(["-l", "-E", "sha256", "-f"]).arg(path);
    capture(cmd)?
        .split_whitespace()
        .nth(1)
        .filter(|s| s.starts_with("SHA256:") && s.len() < 128)
        .map(str::to_owned)
        .ok_or_else(|| "invalid-host-key".into())
}
fn system_trusted(config: &Config, key: &str) -> Result<bool, String> {
    let Some(home) = dirs::home_dir() else {
        return Ok(false);
    };
    let mut cmd = command("ssh-keygen")?;
    cmd.args(["-F", &config.host_pattern(), "-f"])
        .arg(home.join(".ssh/known_hosts"));
    system_key_decision(&capture(cmd)?, key)
}
fn system_key_decision(text: &str, key: &str) -> Result<bool, String> {
    if text.lines().any(|l| l.starts_with('@')) {
        return Err("host-key-changed".into());
    }
    let keys: Vec<_> = text.lines().filter_map(public_key).collect();
    if keys.iter().any(|trusted| trusted != key) {
        return Err("host-key-changed".into());
    }
    Ok(!keys.is_empty())
}
fn ssh_args(config: &Config, known_hosts: &Path, local: u16) -> Vec<String> {
    let mut args: Vec<String> = [
        "-F",
        "none",
        "-N",
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "GlobalKnownHostsFile=none",
        "-o",
        "UpdateHostKeys=no",
        "-o",
        "HostKeyAlgorithms=ssh-ed25519",
        "-o",
        "ExitOnForwardFailure=yes",
        "-o",
        "ConnectTimeout=8",
        "-o",
        "ConnectionAttempts=1",
        "-o",
        "ServerAliveInterval=15",
        "-o",
        "ServerAliveCountMax=2",
        "-o",
        "ForwardAgent=no",
        "-o",
        "ForwardX11=no",
        "-o",
        "PermitLocalCommand=no",
        "-o",
        "ControlMaster=no",
        "-o",
        "ControlPath=none",
        "-o",
        "ProxyCommand=none",
        "-o",
        "PasswordAuthentication=no",
        "-o",
        "KbdInteractiveAuthentication=no",
        "-o",
        "LogLevel=DEBUG1",
    ]
    .iter()
    .map(|s| (*s).into())
    .collect();
    args.extend([
        "-o".into(),
        format!(
            "UserKnownHostsFile=\"{}\"",
            known_hosts.to_string_lossy().replace('\\', "/")
        ),
    ]);
    if let Some(key) = &config.key_path {
        args.extend([
            "-o".into(),
            "IdentitiesOnly=yes".into(),
            "-i".into(),
            key.clone(),
        ]);
    }
    let remote = if config.remote_host == "::1" {
        "[::1]"
    } else {
        &config.remote_host
    };
    args.extend([
        "-L".into(),
        format!("127.0.0.1:{local}:{remote}:{}", config.remote_port),
        "-p".into(),
        config.port.to_string(),
        "-l".into(),
        config.username.clone(),
        config.host.clone(),
    ]);
    args
}

fn connect(
    slot: &Slot,
    root: &Path,
    approval: Option<&str>,
    consumer: Option<&str>,
) -> Result<Status, String> {
    let _operation = slot.operation.try_lock().map_err(|_| "connecting")?;
    if current_status(slot).state == "connected" {
        return Ok(current_status(slot));
    }
    let generation = {
        let mut r = slot.runtime.lock().map_err(|_| "ssh-error")?;
        if consumer.is_some_and(|id| !r.consumers.contains_key(id))
            || (consumer.is_none() && !r.pinned)
        {
            return Ok(Status::new("cancelled"));
        }
        if Instant::now() < r.retry_at {
            return Err("retry-later".into());
        }
        r.status = Status::new("connecting");
        r.retry_at = Instant::now() + Duration::from_secs(2);
        slot.generation.load(Ordering::SeqCst)
    };
    let cfg = &slot.config;
    let result = (|| {
        cfg.validate()?;
        if let Some(key) = &cfg.key_path {
            let path = Path::new(key);
            if !path.is_absolute() || !path.is_file() || std::fs::File::open(path).is_err() {
                return Err("key-unreadable".into());
            }
        }
        let mut version = command("ssh")?;
        version.arg("-V");
        // Version exits before any network/authentication operation.
        if !version
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map_err(|_| "ssh-unavailable")?
            .success()
        {
            return Err("ssh-unavailable".into());
        }
        std::fs::create_dir_all(root).map_err(|_| "trust-store-unavailable")?;
        let address = safe_address(cfg)?;
        let known = root.join(cfg.trust_id());
        static NONCE: AtomicU64 = AtomicU64::new(0);
        let nonce = format!(
            "{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
            NONCE.fetch_add(1, Ordering::SeqCst)
        );
        let key = observe(cfg, &address, &root.join(format!("{nonce}.observed")))?;
        let pending_file = root.join(format!("{nonce}.pending"));
        std::fs::write(&pending_file, format!("{} {key}\n", cfg.host_pattern()))
            .map_err(|_| "trust-store-unavailable")?;
        let fp = fingerprint(&pending_file);
        let _ = std::fs::remove_file(&pending_file);
        let fp = fp?;
        let trusted = match std::fs::metadata(&known) {
            Ok(meta) if meta.is_file() && meta.len() <= 16 * 1024 => {
                Some(std::fs::read_to_string(&known).map_err(|_| "trust-store-unavailable")?)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            _ => return Err("trust-store-unavailable".into()),
        };
        let system = if trusted.is_none() {
            system_trusted(cfg, &key)?
        } else {
            false
        };
        let source = {
            let mut r = slot.runtime.lock().map_err(|_| "ssh-error")?;
            if slot.generation.load(Ordering::SeqCst) != generation {
                return Err("cancelled".into());
            }
            match trust_decision(
                trusted.as_deref(),
                &key,
                &fp,
                r.pending.as_ref(),
                approval,
                system,
            ) {
                Ok(source) => source,
                Err(code) if code == "verification-required" => {
                    r.pending = Some((key.clone(), fp.clone()));
                    return Ok(Status {
                        state: "verification-required".into(),
                        fingerprint: Some(fp),
                        trust_source: None,
                    });
                }
                Err(code) => return Err(code),
            }
        };
        // create_new never replaces a trusted key, including two simultaneous connections.
        {
            let _commit = slot.runtime.lock().map_err(|_| "ssh-error")?;
            if slot.generation.load(Ordering::SeqCst) != generation {
                return Err("cancelled".into());
            }
            if !known.exists() {
                use std::io::Write;
                let mut file = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&known)
                    .map_err(|_| "trust-store-unavailable")?;
                file.write_all(format!("{} {key}\n", cfg.host_pattern()).as_bytes())
                    .and_then(|_| file.sync_all())
                    .map_err(|_| "trust-store-unavailable")?;
            }
        }
        let mut last_error = "port-collision".to_string();
        for _ in 0..3 {
            let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|_| "port-unavailable")?;
            let port = listener
                .local_addr()
                .map_err(|_| "port-unavailable")?
                .port();
            drop(listener);
            let mut cmd = command("ssh")?;
            cmd.args([
                "-o",
                &format!("HostName={address}"),
                "-o",
                &format!("HostKeyAlias={}", cfg.host_pattern()),
            ]);
            cmd.args(ssh_args(cfg, &known, port));
            let mut child = OwnedChild::spawn(cmd)?;
            let deadline = Instant::now() + Duration::from_secs(12);
            loop {
                if slot.generation.load(Ordering::SeqCst) != generation {
                    return Err("cancelled".into());
                }
                if !child.alive() {
                    last_error = child.error();
                    break;
                }
                if child.listening(port)
                    && TcpStream::connect_timeout(
                        &([127, 0, 0, 1], port).into(),
                        Duration::from_millis(100),
                    )
                    .is_ok()
                {
                    let mut r = slot.runtime.lock().map_err(|_| "ssh-error")?;
                    if slot.generation.load(Ordering::SeqCst) != generation {
                        return Err("cancelled".into());
                    }
                    r.child = Some(child);
                    r.port = Some(port);
                    r.pending = None;
                    return Ok(Status {
                        state: "connected".into(),
                        fingerprint: Some(fp),
                        trust_source: Some(source.into()),
                    });
                }
                if Instant::now() >= deadline {
                    last_error = "host-unreachable".into();
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            if last_error != "port-collision" {
                break;
            }
        }
        Err(last_error)
    })();
    let status = result.unwrap_or_else(|code: String| Status::new(&code));
    finish(slot, generation, status)
}

fn configured(app: &AppHandle, id: &str) -> Result<Arc<Slot>, String> {
    let _lock = super::self_hosted_profiles::WRITE_LOCK
        .lock()
        .map_err(|_| "settings-unavailable")?;
    let value = app
        .store("terax-settings.json")
        .map_err(|_| "settings-unavailable")?
        .get(super::self_hosted_profiles::KEY)
        .ok_or("server-unavailable")?;
    let e = value["endpoints"]
        .as_array()
        .and_then(|es| {
            es.iter()
                .find(|e| e["id"] == id && e["deletedAt"].is_null())
        })
        .ok_or("server-unavailable")?;
    validate_endpoint(e)?;
    if e["allowPrivateNetwork"] != true {
        return Err("private-network-consent-required".into());
    }
    let config: Config =
        serde_json::from_value(e["ssh"].clone()).map_err(|_| "invalid-ssh-configuration")?;
    let revision = e["configurationRevision"]
        .as_u64()
        .ok_or("invalid-ssh-configuration")?;
    let mut map = slots().lock().map_err(|_| "ssh-error")?;
    if let Some(old) = map.get(id) {
        if old.config == config && old.revision == revision {
            return Ok(old.clone());
        }
        stop(old);
    }
    if map.len() >= 256 {
        return Err("connection-limit".into());
    }
    let slot = Arc::new(Slot {
        config,
        revision,
        generation: AtomicU64::new(0),
        operation: Mutex::new(()),
        flight: tokio::sync::Mutex::new(()),
        runtime: Mutex::new(Runtime::default()),
    });
    map.insert(id.into(), slot.clone());
    lifecycle::start_maintenance();
    Ok(slot)
}
#[tauri::command]
pub async fn remote_ssh_connect(
    app: AppHandle,
    endpoint_id: String,
    approve_fingerprint: Option<String>,
) -> Result<Status, String> {
    let slot = configured(&app, &endpoint_id)?;
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "trust-store-unavailable")?
        .join("ssh-hosts");
    {
        let mut r = slot.runtime.lock().map_err(|_| "ssh-error")?;
        r.pinned = true;
        r.retry_at = Instant::now();
    }
    lifecycle::establish(slot, root, approve_fingerprint, None).await
}
#[tauri::command]
pub fn remote_ssh_disconnect(endpoint_id: String) {
    if let Ok(map) = slots().lock() {
        if let Some(slot) = map.get(&endpoint_id) {
            stop(slot);
        }
    }
}
#[tauri::command]
pub fn remote_ssh_status(endpoint_id: String) -> Status {
    slots()
        .lock()
        .ok()
        .and_then(|map| map.get(&endpoint_id).map(|slot| current_status(slot)))
        .unwrap_or_else(|| Status::new("disconnected"))
}
