use super::*;
use std::path::PathBuf;

const LEASE_TTL: Duration = Duration::from_secs(90);
const IDLE_TTL: Duration = Duration::from_secs(60);

fn register(slot: &Slot, owner: &str, at: Instant) -> Result<(), String> {
    if owner.is_empty() || owner.len() > 128 || owner.chars().any(char::is_control) {
        return Err("invalid-connection-consumer".into());
    }
    let mut r = slot.runtime.lock().map_err(|_| "ssh-error")?;
    if r.consumers.len() >= 128 && !r.consumers.contains_key(owner) {
        return Err("connection-consumer-limit".into());
    }
    r.consumers.insert(owner.into(), Some(at + LEASE_TTL));
    r.idle_since = None;
    Ok(())
}
fn release(slot: &Slot, owner: &str) {
    let cancel = if let Ok(mut r) = slot.runtime.lock() {
        if r.consumers.remove(owner).is_none() {
            return;
        }
        if r.consumers.is_empty() && !r.pinned {
            r.idle_since = Some(Instant::now());
            r.child.is_none() && matches!(r.status.state.as_str(), "connecting" | "reconnecting")
        } else {
            false
        }
    } else {
        false
    };
    if cancel {
        stop_if_unused(slot);
    }
}
fn stop_if_unused(slot: &Slot) {
    if let Ok(mut r) = slot.runtime.lock() {
        if !r.pinned && r.consumers.is_empty() {
            slot.generation.fetch_add(1, Ordering::SeqCst);
            r.child = None;
            r.port = None;
            r.pending = None;
            r.status = Status::new("disconnected");
        }
    }
}
fn maintain(slot: &Slot, at: Instant) {
    let idle = if let Ok(mut r) = slot.runtime.lock() {
        let expired = r
            .consumers
            .values()
            .any(|expiry| expiry.is_some_and(|expiry| expiry <= at));
        r.consumers
            .retain(|_, expiry| expiry.is_none_or(|expiry| expiry > at));
        if expired && r.consumers.is_empty() && r.idle_since.is_none() {
            r.idle_since = Some(at);
        }
        !requires_attention(&r.status.state)
            && !r.pinned
            && r.consumers.is_empty()
            && r.idle_since
                .is_some_and(|start| at.saturating_duration_since(start) >= IDLE_TTL)
    } else {
        false
    };
    if idle {
        stop_if_unused(slot);
    }
}
pub(super) fn start_maintenance() {
    static STARTED: OnceLock<()> = OnceLock::new();
    STARTED.get_or_init(|| {
        tauri::async_runtime::spawn(async {
            loop {
                tokio::time::sleep(Duration::from_secs(5)).await;
                let current: Vec<_> = slots()
                    .lock()
                    .map(|m| m.values().cloned().collect())
                    .unwrap_or_default();
                for slot in current {
                    maintain(&slot, Instant::now());
                }
            }
        });
    });
}
fn requires_attention(state: &str) -> bool {
    matches!(
        state,
        "host-key-changed"
            | "authentication-failed"
            | "key-unreadable"
            | "verification-required"
            | "ssh-unavailable"
            | "unsafe-ssh-host"
            | "invalid-ssh-configuration"
            | "trust-store-unavailable"
    )
}
pub(super) async fn establish(
    slot: Arc<Slot>,
    root: PathBuf,
    approval: Option<String>,
    consumer: Option<String>,
) -> Result<Status, String> {
    let _flight = slot.flight.lock().await;
    for attempt in 0..2 {
        if consumer.as_ref().is_some_and(|id| {
            !slot
                .runtime
                .lock()
                .is_ok_and(|r| r.consumers.contains_key(id))
        }) {
            return Ok(Status::new("cancelled"));
        }
        let status = current_status(&slot);
        if status.state == "connected" {
            return Ok(status);
        }
        if consumer.is_some() && requires_attention(&status.state) {
            return Ok(status);
        }
        let delay = slot
            .runtime
            .lock()
            .map_err(|_| "ssh-error")?
            .retry_at
            .saturating_duration_since(Instant::now());
        if delay > Duration::from_secs(2) {
            return Ok(Status::new("offline"));
        }
        if !delay.is_zero() {
            tokio::time::sleep(delay).await;
        }
        if consumer.as_ref().is_some_and(|id| {
            !slot
                .runtime
                .lock()
                .is_ok_and(|r| r.consumers.contains_key(id))
        }) {
            return Ok(Status::new("cancelled"));
        }
        let owned = slot.clone();
        let root = root.clone();
        let approval = approval.clone();
        let owner = consumer.clone();
        let status = tauri::async_runtime::spawn_blocking(move || {
            connect(&owned, &root, approval.as_deref(), owner.as_deref())
        })
        .await
        .map_err(|_| "ssh-error")??;
        if status.state == "connected"
            || requires_attention(&status.state)
            || status.state == "disconnected"
            || status.state == "cancelled"
            || consumer.is_none()
        {
            return Ok(status);
        }
        if attempt == 0 {
            let mut r = slot.runtime.lock().map_err(|_| "ssh-error")?;
            r.status.state = "reconnecting".into();
            r.retry_at = Instant::now() + Duration::from_secs(2);
        } else {
            let mut r = slot.runtime.lock().map_err(|_| "ssh-error")?;
            r.retry_at = Instant::now() + Duration::from_secs(30);
            return Ok(status);
        }
    }
    Ok(Status::new("offline"))
}

#[tauri::command]
pub async fn remote_ssh_acquire(
    app: AppHandle,
    endpoint_id: String,
    consumer: String,
) -> Result<Status, String> {
    if revoked(&endpoint_id, &consumer, false) {
        return Ok(Status::new("cancelled"));
    }
    let slot = configured(&app, &endpoint_id)?;
    register(&slot, &consumer, Instant::now())?;
    if revoked(&endpoint_id, &consumer, false) {
        release(&slot, &consumer);
        return Ok(Status::new("cancelled"));
    }
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "trust-store-unavailable")?
        .join("ssh-hosts");
    let result = establish(slot.clone(), root, None, Some(consumer.clone())).await;
    if !matches!(&result,Ok(status) if status.state=="connected") {
        release(&slot, &consumer);
    }
    result
}
#[tauri::command]
pub fn remote_ssh_release(endpoint_id: String, consumer: String) {
    revoked(&endpoint_id, &consumer, true);
    if let Ok(map) = slots().lock() {
        if let Some(slot) = map.get(&endpoint_id) {
            release(slot, &consumer);
        }
    }
}
#[tauri::command]
pub fn remote_ssh_heartbeat(endpoint_id: String, consumer: String) -> Result<(), String> {
    let map = slots().lock().map_err(|_| "ssh-error")?;
    let slot = map.get(&endpoint_id).ok_or("connection-lease-expired")?;
    let mut r = slot.runtime.lock().map_err(|_| "ssh-error")?;
    let expiry = r
        .consumers
        .get_mut(&consumer)
        .filter(|expiry| expiry.is_some_and(|expiry| expiry > Instant::now()))
        .ok_or("connection-lease-expired")?;
    *expiry = Some(Instant::now() + LEASE_TTL);
    Ok(())
}
pub struct ConnectionLease {
    endpoint: String,
    consumer: String,
}
impl Drop for ConnectionLease {
    fn drop(&mut self) {
        remote_ssh_release(self.endpoint.clone(), self.consumer.clone());
    }
}
pub async fn acquire_for_endpoint(
    app: &AppHandle,
    id: &str,
) -> Result<Option<ConnectionLease>, String> {
    let managed = {
        let _lock = super::super::self_hosted_profiles::WRITE_LOCK
            .lock()
            .map_err(|_| "settings-unavailable")?;
        let value = app
            .store("terax-settings.json")
            .map_err(|_| "settings-unavailable")?
            .get(super::super::self_hosted_profiles::KEY)
            .unwrap_or(Value::Null);
        value["endpoints"].as_array().is_some_and(|es| {
            es.iter()
                .any(|e| e["id"] == id && e["deletedAt"].is_null() && e["ssh"].is_object())
        })
    };
    if !managed {
        return Ok(None);
    }
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let consumer = format!(
        "native:{}:{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::SeqCst)
    );
    let status = remote_ssh_acquire(app.clone(), id.into(), consumer.clone()).await?;
    if status.state != "connected" {
        return Err(status.state);
    }
    if let Some(slot) = slots().lock().map_err(|_| "ssh-error")?.get(id) {
        let mut r = slot.runtime.lock().map_err(|_| "ssh-error")?;
        let expiry = r.consumers.get_mut(&consumer).ok_or("cancelled")?;
        *expiry = None;
    } else {
        return Err("cancelled".into());
    }
    Ok(Some(ConnectionLease {
        endpoint: id.into(),
        consumer,
    }))
}

fn revoked(endpoint: &str, consumer: &str, cancel: bool) -> bool {
    static REVOKED: OnceLock<Mutex<HashMap<(String, String), Instant>>> = OnceLock::new();
    if endpoint.len() > 2048 || consumer.len() > 128 {
        return true;
    }
    let Ok(mut records) = REVOKED.get_or_init(Mutex::default).lock() else {
        return true;
    };
    let at = Instant::now();
    records.retain(|_, expiry| *expiry > at);
    let key = (endpoint.into(), consumer.into());
    if cancel && records.len() < 4096 {
        records.insert(key.clone(), at + LEASE_TTL);
    }
    records.contains_key(&key) || records.len() >= 4096
}

pub fn pin_active_url(app: &AppHandle, raw: &str) -> Result<Option<ConnectionLease>, String> {
    let url = reqwest::Url::parse(raw).map_err(|_| "invalid-ssh-configuration")?;
    if url.host_str() != Some(HOST) {
        return Ok(None);
    }
    let value = app
        .store("terax-settings.json")
        .map_err(|_| "settings-unavailable")?
        .get(super::super::self_hosted_profiles::KEY)
        .unwrap_or(Value::Null);
    let id = value["endpoints"]
        .as_array()
        .and_then(|es| {
            es.iter().find(|e| {
                e["deletedAt"].is_null()
                    && e["ssh"].is_object()
                    && e["baseURL"]
                        .as_str()
                        .is_some_and(|base| raw.starts_with(base))
            })
        })
        .and_then(|e| e["id"].as_str())
        .ok_or("server-unavailable")?;
    let slot = configured(app, id)?;
    if current_status(&slot).state != "connected" {
        return Err("ssh-disconnected".into());
    }
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let consumer = format!(
        "http:{}:{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::SeqCst)
    );
    register(&slot, &consumer, Instant::now())?;
    let mut r = slot.runtime.lock().map_err(|_| "ssh-error")?;
    *r.consumers.get_mut(&consumer).ok_or("cancelled")? = None;
    Ok(Some(ConnectionLease {
        endpoint: id.into(),
        consumer,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::remote_ssh::tests::slot;
    #[test]
    fn independent_consumers_cancel_only_their_own_interest() {
        let s = slot();
        s.runtime.lock().unwrap().status = Status::new("connecting");
        register(&s, "a", Instant::now()).unwrap();
        register(&s, "b", Instant::now()).unwrap();
        release(&s, "a");
        assert!(s.runtime.lock().unwrap().consumers.contains_key("b"));
        assert_eq!(s.generation.load(Ordering::SeqCst), 0);
        release(&s, "b");
        assert_eq!(s.generation.load(Ordering::SeqCst), 1);
    }
    #[test]
    fn abandoned_leases_expire_and_idle_transport_does_not_live_forever() {
        let s = slot();
        let at = Instant::now();
        register(&s, "a", at).unwrap();
        maintain(&s, at + LEASE_TTL);
        assert!(s.runtime.lock().unwrap().consumers.is_empty());
        maintain(&s, at + LEASE_TTL + IDLE_TTL);
        assert_eq!(current_status(&s).state, "disconnected");
        assert_eq!(s.generation.load(Ordering::SeqCst), 1);
    }
    #[test]
    fn security_and_credential_errors_latch_without_automatic_retry() {
        for error in [
            "host-key-changed",
            "verification-required",
            "authentication-failed",
            "key-unreadable",
            "ssh-unavailable",
        ] {
            assert!(requires_attention(error));
        }
        assert!(!requires_attention("host-unreachable"));
    }
    #[test]
    fn failed_consumer_release_and_idle_cleanup_preserve_security_latches() {
        for state in [
            "host-key-changed",
            "authentication-failed",
            "key-unreadable",
            "verification-required",
        ] {
            let s = slot();
            register(&s, "owner", Instant::now()).unwrap();
            s.runtime.lock().unwrap().status = Status::new(state);
            release(&s, "owner");
            maintain(&s, Instant::now() + Duration::from_secs(3600));
            assert_eq!(current_status(&s).state, state);
            assert_eq!(s.generation.load(Ordering::SeqCst), 0);
        }
    }
    #[test]
    fn lease_count_and_identity_are_bounded() {
        let s = slot();
        assert!(register(&s, "", Instant::now()).is_err());
        for n in 0..128 {
            register(&s, &format!("consumer-{n}"), Instant::now()).unwrap();
        }
        assert!(register(&s, "overflow", Instant::now()).is_err());
    }
    #[test]
    fn cancellation_before_registration_is_remembered_without_saved_process_state() {
        assert!(!revoked("race-endpoint", "race-consumer", false));
        assert!(revoked("race-endpoint", "race-consumer", true));
        assert!(revoked("race-endpoint", "race-consumer", false));
    }
    #[test]
    fn cancelled_consumer_cannot_start_a_queued_blocking_worker() {
        let s = slot();
        register(&s, "queued", Instant::now()).unwrap();
        release(&s, "queued");
        let status = connect(&s, Path::new("/not-used"), None, Some("queued")).unwrap();
        assert_eq!(status.state, "cancelled");
        assert_eq!(
            connect(&s, Path::new("/not-used"), None, None)
                .unwrap()
                .state,
            "cancelled"
        );
        let r = s.runtime.lock().unwrap();
        assert_eq!(r.status.state, "disconnected");
        assert!(r.child.is_none());
    }
    #[test]
    fn active_native_request_is_not_expired_by_background_webview_timer_throttling() {
        let s = slot();
        register(&s, "http-owner", Instant::now()).unwrap();
        s.runtime
            .lock()
            .unwrap()
            .consumers
            .insert("http-owner".into(), None);
        maintain(&s, Instant::now() + Duration::from_secs(86400));
        assert!(s
            .runtime
            .lock()
            .unwrap()
            .consumers
            .contains_key("http-owner"));
    }
    #[tokio::test]
    async fn simultaneous_consumers_share_security_failure_without_retrying_the_client() {
        let s = slot();
        register(&s, "a", Instant::now()).unwrap();
        register(&s, "b", Instant::now()).unwrap();
        s.runtime.lock().unwrap().status = Status::new("host-key-changed");
        let (a, b) = tokio::join!(
            establish(s.clone(), PathBuf::from("unused"), None, Some("a".into())),
            establish(s.clone(), PathBuf::from("unused"), None, Some("b".into()))
        );
        assert_eq!(a.unwrap().state, "host-key-changed");
        assert_eq!(b.unwrap().state, "host-key-changed");
        assert!(s.runtime.lock().unwrap().child.is_none());
    }
    #[tokio::test]
    async fn cancelled_waiter_does_not_launch_after_an_earlier_flight_releases() {
        let s = slot();
        register(&s, "cancelled", Instant::now()).unwrap();
        let lock = s.flight.lock().await;
        let owned = s.clone();
        let waiting = tokio::spawn(async move {
            establish(
                owned,
                PathBuf::from("unused"),
                None,
                Some("cancelled".into()),
            )
            .await
        });
        release(&s, "cancelled");
        drop(lock);
        assert_eq!(waiting.await.unwrap().unwrap().state, "cancelled");
    }
}
