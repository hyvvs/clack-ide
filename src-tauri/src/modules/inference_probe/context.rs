use super::*;
use std::{
    collections::HashMap,
    sync::OnceLock,
    time::{Duration, Instant},
};

fn epoch() -> &'static str {
    static EPOCH: OnceLock<String> = OnceLock::new();
    EPOCH.get_or_init(|| {
        format!(
            "{}:{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        )
    })
}
fn leases() -> &'static Mutex<HashMap<String, (String, Instant)>> {
    static LEASES: OnceLock<Mutex<HashMap<String, (String, Instant)>>> = OnceLock::new();
    LEASES.get_or_init(Mutex::default)
}
fn lease(
    map: &mut HashMap<String, (String, Instant)>,
    endpoint: &str,
    owner: &str,
    release: bool,
    at: Instant,
) -> Result<(), String> {
    map.retain(|_, (_, expiry)| *expiry > at);
    if release {
        if map.get(endpoint).is_some_and(|(id, _)| id == owner) {
            map.remove(endpoint);
        }
        return Ok(());
    }
    if map.contains_key(endpoint) {
        return Err("Context verification is already running on this server".into());
    }
    if map.len() >= 256 {
        return Err("Context verification queue is full".into());
    }
    map.insert(
        endpoint.into(),
        (owner.into(), at + Duration::from_secs(300)),
    );
    Ok(())
}
#[tauri::command]
pub fn self_hosted_context_lease(
    app: AppHandle,
    endpoint_id: String,
    owner: String,
    release: bool,
) -> Result<String, String> {
    if owner.is_empty() || owner.len() > 128 {
        return Err("Invalid verification owner".into());
    }
    if !release {
        let _guard = WRITE_LOCK.lock().map_err(|_| "Settings unavailable")?;
        let store = app
            .store("terax-settings.json")
            .map_err(|_| "Settings unavailable")?;
        configured(&store.get(KEY).unwrap_or(Value::Null), &endpoint_id)
            .map_err(|_| "Server unavailable")?;
    }
    let mut guard = leases().lock().map_err(|_| "Verification unavailable")?;
    lease(&mut guard, &endpoint_id, &owner, release, Instant::now())?;
    Ok(epoch().into())
}
#[tauri::command]
pub async fn self_hosted_context_runtime(
    app: AppHandle,
    endpoint_id: String,
    allow_private_network: bool,
) -> Result<Value, ProbeError> {
    let endpoint = {
        let _guard = WRITE_LOCK.lock().map_err(|_| internal())?;
        let store = app.store("terax-settings.json").map_err(|_| internal())?;
        configured(&store.get(KEY).unwrap_or(Value::Null), &endpoint_id)?
    };
    if endpoint.backend() != Some(Backend::Ollama) {
        return Err(ProbeError::new(ErrorCode::UnsupportedProbeRoute));
    }
    let secret = credential(&app, &endpoint).await?;
    let value = app
        .state::<ProbeState>()
        .transport
        .request(
            &endpoint,
            Route::OllamaVersion,
            None,
            secret.as_deref(),
            allow_private_network,
            &mut 0,
        )
        .await?;
    let version = value["version"]
        .as_str()
        .filter(|v| !v.is_empty() && v.len() <= 64 && !v.chars().any(char::is_control))
        .ok_or_else(ProbeError::metadata)?;
    {
        let _guard = WRITE_LOCK.lock().map_err(|_| internal())?;
        let store = app.store("terax-settings.json").map_err(|_| internal())?;
        if configured(&store.get(KEY).unwrap_or(Value::Null), &endpoint_id)? != endpoint {
            return Err(ProbeError::new(ErrorCode::InvalidConfiguration));
        }
    }
    Ok(
        json!({"epoch":epoch(), "version":version, "configurationRevision":endpoint.configuration_revision, "at":now()}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn endpoint_leases_are_independent_bounded_owned_and_expire_without_replay() {
        let mut map = HashMap::new();
        let now = Instant::now();
        lease(&mut map, "a", "one", false, now).unwrap();
        assert!(lease(&mut map, "a", "two", false, now).is_err());
        lease(&mut map, "b", "two", false, now).unwrap();
        lease(&mut map, "a", "wrong", true, now).unwrap();
        assert!(map.contains_key("a"));
        lease(&mut map, "a", "two", false, now + Duration::from_secs(301)).unwrap();
        assert_eq!(map.len(), 1);
    }
}
