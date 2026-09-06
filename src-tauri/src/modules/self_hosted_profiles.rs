use serde_json::Value;
use std::sync::Mutex;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const KEY: &str = "selfHostedInference";
static WRITE_LOCK: Mutex<()> = Mutex::new(());
const SNAPSHOT_KEYS: &[&str] = &[
    KEY,
    "ollamaBaseURL",
    "ollamaModelId",
    "lmstudioBaseURL",
    "lmstudioModelId",
    "mlxBaseURL",
    "mlxModelId",
    "customEndpoints",
    "openaiCompatibleBaseURL",
    "openaiCompatibleModelId",
    "openaiCompatibleContextLimit",
];

#[tauri::command]
pub fn self_hosted_profiles_snapshot(app: AppHandle) -> Result<Vec<(String, Value)>, String> {
    let _lock = WRITE_LOCK
        .lock()
        .map_err(|_| "Self-hosted settings lock unavailable")?;
    let store = app
        .store("terax-settings.json")
        .map_err(|_| "Settings unavailable")?;
    Ok(SNAPSHOT_KEYS
        .iter()
        .filter_map(|key| store.get(key).map(|value| ((*key).into(), value)))
        .collect())
}

fn validate(value: &Value) -> Result<(), String> {
    if value.get("version").and_then(Value::as_u64) != Some(1)
        || value.get("revision").and_then(Value::as_u64).is_none()
        || value
            .get("endpoints")
            .and_then(Value::as_array)
            .is_none_or(|a| a.len() > 256)
        || value
            .get("profiles")
            .and_then(Value::as_array)
            .is_none_or(|a| a.len() > 2048)
        || value.to_string().len() > 2 * 1024 * 1024
    {
        return Err("Invalid or oversized self-hosted settings".into());
    }
    Ok(())
}

fn compare_and_save(
    current: Value,
    expected: Value,
    value: Value,
    save: impl FnOnce(Value) -> Result<(), String>,
) -> Result<bool, String> {
    validate(&value)?;
    if current != expected {
        return Ok(false);
    }
    save(value)?;
    Ok(true)
}

#[tauri::command]
pub fn self_hosted_profiles_compare_and_swap(
    app: AppHandle,
    expected: Value,
    value: Value,
) -> Result<bool, String> {
    let _lock = WRITE_LOCK
        .lock()
        .map_err(|_| "Self-hosted settings lock unavailable")?;
    let store = app
        .store("terax-settings.json")
        .map_err(|_| "Settings unavailable")?;
    let previous = store.get(KEY);
    compare_and_save(
        previous.clone().unwrap_or(Value::Null),
        expected,
        value,
        |next| {
            store.set(KEY, next);
            if store.save().is_err() {
                if let Some(old) = previous {
                    store.set(KEY, old);
                } else {
                    store.delete(KEY);
                }
                return Err("Could not save self-hosted settings".into());
            }
            Ok(())
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn state() -> Value {
        json!({"version": 1, "revision": 1, "endpoints": [], "profiles": []})
    }

    #[test]
    fn matching_snapshot_saves() {
        assert_eq!(
            compare_and_save(Value::Null, Value::Null, state(), |_| Ok(())),
            Ok(true)
        );
    }

    #[test]
    fn stale_window_cannot_overwrite() {
        assert_eq!(
            compare_and_save(state(), Value::Null, state(), |_| panic!("must not write")),
            Ok(false)
        );
    }

    #[test]
    fn persistence_failure_is_not_success() {
        assert!(
            compare_and_save(Value::Null, Value::Null, state(), |_| Err("disk".into())).is_err()
        );
    }

    #[test]
    fn malformed_and_oversized_envelopes_rejected() {
        assert!(validate(&json!({"version": 2})).is_err());
        let mut oversized = state();
        oversized["endpoints"] = json!(vec![Value::Null; 257]);
        assert!(validate(&oversized).is_err());
        oversized = state();
        oversized["unexpected"] = json!("x".repeat(2 * 1024 * 1024));
        assert!(validate(&oversized).is_err());
    }
}
