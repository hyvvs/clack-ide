use serde_json::Value;
use std::sync::Mutex;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

pub(super) const KEY: &str = "selfHostedInference";
pub(super) static WRITE_LOCK: Mutex<()> = Mutex::new(());
// Keep in sync with the bounded TypeScript CONTEXT_CALIBRATION ceiling and
// request limit. This validates persisted native evidence; it never grants
// context allocation or substitutes for an actual successful Ollama probe.
const MAX_CONTEXT_CALIBRATION_TOKENS: u64 = 73_728;
const MAX_CONTEXT_CALIBRATION_ATTEMPTS: usize = 8;
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

pub(super) fn validate(value: &Value) -> Result<(), String> {
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
    for endpoint in value["endpoints"].as_array().into_iter().flatten() {
        super::remote_ssh::validate_endpoint(endpoint)?;
    }
    for profile in value["profiles"].as_array().into_iter().flatten() {
        if let Some(record) = profile.get("toolVerification") {
            if !record["configuration"].is_null() {
                return Err("Provider-default tool evidence cannot be explicit".into());
            }
            validate_tool_verification(value, profile, record)?;
        }
        if let Some(records) = profile.get("agentToolConfigurations") {
            let records = records
                .as_array()
                .filter(|r| r.len() <= 2)
                .ok_or("Invalid Agent tool configurations")?;
            let mut wires = std::collections::HashSet::new();
            for record in records {
                if record["configuration"].is_null()
                    || !wires.insert(record["configuration"]["wire"].to_string())
                {
                    return Err("Duplicate or missing Agent tool configuration".into());
                }
                validate_tool_verification(value, profile, record)?;
            }
        }
        let Some(record) = profile.get("contextCalibration") else {
            continue;
        };
        let scope = &record["scope"];
        let tokens = |v: &Value| {
            v.as_u64()
                .is_some_and(|n| n > 0 && n <= MAX_CONTEXT_CALIBRATION_TOKENS)
        };
        let string = |v: &Value, max: usize| {
            v.as_str().is_some_and(|s| {
                !s.is_empty() && s.len() <= max && !s.chars().any(char::is_control)
            })
        };
        let outcome = |v: &Value| {
            matches!(
                v.as_str(),
                Some(
                    "success"
                        | "capacity"
                        | "allocation-mismatch"
                        | "transient"
                        | "timeout"
                        | "offline"
                        | "revision-changed"
                        | "cancelled"
                        | "unsupported"
                        | "interrupted"
                )
            )
        };
        let valid = record["version"] == 1
            && record.to_string().len() <= 16 * 1024
            && string(&record["id"], 128)
            && scope["endpointId"] == profile["endpointId"]
            && scope["model"] == profile["transportModelId"]
            && scope["digest"] == profile["modelRevision"]
            && scope["deployment"] == profile["deploymentId"]
            && scope["backend"] == "ollama"
            && string(&scope["digest"], 1024)
            && string(&scope["runtimeEpoch"], 128)
            && string(&scope["providerVersion"], 64)
            && string(&scope["reasoning"], 2048)
            && value["endpoints"].as_array().is_some_and(|es| {
                es.iter().any(|e| {
                    e["id"] == scope["endpointId"]
                        && e["configurationRevision"] == scope["configurationRevision"]
                })
            })
            && matches!(
                record["status"].as_str(),
                Some(
                    "verifying"
                        | "verified"
                        | "incomplete"
                        | "capacity"
                        | "cancelled"
                        | "unsupported"
                )
            )
            && ["startedAt", "updatedAt", "expiresAt", "retryAfter"]
                .iter()
                .all(|k| record[*k].as_u64().is_some())
            && (record["highest"].is_null() || tokens(&record["highest"]))
            && (record["failedNext"].is_null() || tokens(&record["failedNext"]))
            && (record["allocation"].is_null() || string(&record["allocation"], 1024))
            && (record["failure"].is_null() || outcome(&record["failure"]))
            && record["attempts"].as_array().is_some_and(|a| {
                a.len() <= MAX_CONTEXT_CALIBRATION_ATTEMPTS
                    && a.iter().all(|entry| {
                        tokens(&entry["context"])
                            && entry["requested"] == entry["context"]
                            && entry["think"] == "omitted"
                            && matches!(
                                entry["thermal"].as_str(),
                                Some("cold" | "warm" | "unknown")
                            )
                            && (entry["finish"].is_null() || string(&entry["finish"], 64))
                            && entry["at"].as_u64().is_some()
                            && entry["latencyMs"]
                                .as_f64()
                                .is_some_and(|n| n.is_finite() && (0.0..=600_000.0).contains(&n))
                            && (entry["loaded"].is_null()
                                || entry["loaded"]
                                    .as_u64()
                                    .is_some_and(|n| n > 0 && n <= 2_000_000))
                            && (entry["outcome"] != "success"
                                || entry["loaded"] == entry["context"])
                            && outcome(&entry["outcome"])
                    })
                    && (record["highest"].is_null()
                        || a.iter().any(|e| {
                            e["context"] == record["highest"] && e["outcome"] == "success"
                        }))
            });
        if !valid {
            return Err("Invalid context calibration ownership or record".into());
        }
    }
    if let Some(inventories) = value.get("inventories") {
        let rows = inventories
            .as_array()
            .filter(|a| a.len() <= 256)
            .ok_or("Invalid self-hosted inventory")?;
        let mut endpoints = std::collections::HashSet::new();
        for row in rows {
            let endpoint = row["endpointId"]
                .as_str()
                .filter(|v| !v.is_empty() && v.len() <= 2048)
                .ok_or("Invalid inventory ownership")?;
            if !endpoints.insert(endpoint)
                || row["observedAt"].as_u64().is_none()
                || row["connected"].as_bool().is_none()
                || !value["endpoints"].as_array().is_some_and(|items| {
                    items.iter().any(|e| {
                        e["id"] == endpoint
                            && e["configurationRevision"] == row["configurationRevision"]
                    })
                })
            {
                return Err("Invalid inventory ownership".into());
            }
            let models = row["models"]
                .as_array()
                .filter(|a| a.len() <= 5000)
                .ok_or("Invalid inventory models")?;
            let mut ids = std::collections::HashSet::new();
            for model in models {
                let name = model["id"]
                    .as_str()
                    .filter(|v| {
                        !v.is_empty() && v.len() <= 1024 && !v.chars().any(char::is_control)
                    })
                    .ok_or("Invalid inventory identity")?;
                if !ids.insert(name)
                    || !matches!(
                        model["chat"].as_str(),
                        Some("supported" | "unsupported" | "unknown")
                    )
                {
                    return Err("Invalid inventory identity".into());
                }
                for field in ["name", "digest", "modifiedAt"] {
                    if !model[field].is_null()
                        && model[field]
                            .as_str()
                            .is_none_or(|s| s.len() > 1024 || s.chars().any(char::is_control))
                    {
                        return Err("Invalid inventory metadata".into());
                    }
                }
                if !model["size"].is_null()
                    && model["size"]
                        .as_u64()
                        .is_none_or(|s| s > 9_007_199_254_740_991)
                {
                    return Err("Invalid inventory size".into());
                }
            }
        }
    }
    Ok(())
}

fn validate_tool_verification(
    state: &Value,
    profile: &Value,
    record: &Value,
) -> Result<(), String> {
    let scope = &record["scope"];
    let bounded = |value: &Value, max: usize| {
        value
            .as_str()
            .is_some_and(|s| !s.is_empty() && s.len() <= max && !s.chars().any(char::is_control))
    };
    let time = |v: &Value| v.as_u64().is_some_and(|n| n <= 9_007_199_254_740_991);
    let proof = &record["proof"];
    let failure = &record["failure"];
    let configuration = &record["configuration"];
    let confirmation = &record["confirmation"];
    if record.to_string().len() > 16 * 1024
        || record["version"] != 1
        || !bounded(&record["id"], 128)
        || scope["endpointId"] != profile["endpointId"]
        || scope["model"] != profile["transportModelId"]
        || scope["digest"] != profile["modelRevision"]
        || scope["deployment"] != profile["deploymentId"]
        || scope["backend"] != "ollama"
        || scope["protocol"] != "native-tools-v1"
        || !bounded(&scope["digest"], 1024)
        || !bounded(&scope["runtimeEpoch"], 128)
        || !bounded(&scope["providerVersion"], 64)
        || !bounded(&scope["reasoning"], 2048)
        || !state["endpoints"].as_array().is_some_and(|es| {
            es.iter().any(|e| {
                e["id"] == scope["endpointId"]
                    && e["configurationRevision"] == scope["configurationRevision"]
            })
        })
        || !matches!(
            record["status"].as_str(),
            Some(
                "verifying"
                    | "verified"
                    | "incompatible"
                    | "needs-attention"
                    | "incomplete"
                    | "unsupported"
            )
        )
        || !matches!(
            record["outcome"].as_str(),
            Some(
                "native-call"
                    | "wrong-tool"
                    | "invalid-arguments"
                    | "multiple-calls"
                    | "text-only"
                    | "empty"
                    | "output-length"
                    | "timeout"
                    | "transport"
                    | "offline"
                    | "revision-changed"
                    | "cancelled"
                    | "unsupported"
                    | "interrupted"
                    | "request-limit"
            )
        )
        || !matches!(record["output"].as_u64(), Some(512 | 1024 | 2048))
        || record.get("attempts").is_some_and(|attempts| {
            attempts.as_array().is_none_or(|attempts| {
                attempts.len() > 3
                    || attempts.iter().any(|attempt| {
                        attempt.as_object().is_none_or(|object| object.len() != 5)
                            || !matches!(attempt["output"].as_u64(), Some(512 | 1024 | 2048))
                            || !matches!(
                                attempt["outcome"].as_str(),
                                Some(
                                    "native-call"
                                        | "wrong-tool"
                                        | "invalid-arguments"
                                        | "multiple-calls"
                                        | "text-only"
                                        | "empty"
                                        | "output-length"
                                        | "transport"
                                )
                            )
                            || !bounded(&attempt["finish"], 64)
                            || !time(&attempt["startedAt"])
                            || !time(&attempt["completedAt"])
                    })
            })
        })
        || !record["context"]
            .as_u64()
            .is_some_and(|n| n > 0 && n <= 2_000_000)
        || !time(&record["startedAt"])
        || !time(&record["retryAfter"])
        || !["completedAt", "firstBodyAt", "callAt"]
            .iter()
            .all(|k| record[*k].is_null() || time(&record[*k]))
        || record["calls"].as_u64().is_none_or(|n| n > 2)
        || record["textChars"].as_u64().is_none_or(|n| n > 65536)
        || record["validArguments"].as_bool().is_none()
        || record["textualIntent"].as_bool().is_none()
        || !(record["finish"].is_null() || bounded(&record["finish"], 64))
        || !(proof.is_null() || (time(&proof["at"]) && time(&proof["expiresAt"])))
        || !(failure.is_null()
            || (time(&failure["at"])
                && time(&failure["expiresAt"])
                && matches!(
                    failure["outcome"].as_str(),
                    Some("text-only" | "wrong-tool" | "invalid-arguments" | "multiple-calls")
                )))
        || (record["status"] == "needs-attention" && failure.is_null())
        || !(configuration.is_null()
            || (bounded(&configuration["choice"], 32)
                && (configuration["wire"].is_boolean() || bounded(&configuration["wire"], 32))))
        || !(confirmation.is_null()
            || (!configuration.is_null()
                && !proof.is_null()
                && bounded(&confirmation["id"], 128)
                && confirmation["id"] != record["id"]
                && time(&confirmation["at"])
                && time(&confirmation["expiresAt"])
                && confirmation["at"].as_u64() <= proof["at"].as_u64()
                && confirmation["expiresAt"].as_u64() > confirmation["at"].as_u64()))
        || (record["status"] == "verified"
            && (record["outcome"] != "native-call"
                || record["calls"] != 1
                || record["validArguments"] != true
                || record["callAt"].is_null()
                || record["completedAt"].is_null()
                || proof.is_null()))
    {
        return Err("Invalid tool verification ownership or record".into());
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
            store.set(KEY, next.clone());
            if store.save().is_err() {
                if let Some(old) = previous {
                    store.set(KEY, old);
                } else {
                    store.delete(KEY);
                }
                return Err("Could not save self-hosted settings".into());
            }
            super::inference_probe::settings_changed(&app, &next);
            super::remote_ssh::reconcile(&next);
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

    fn calibrated() -> Value {
        json!({"version":1,"revision":1,"endpoints":[{"id":"a","configurationRevision":1}],"profiles":[{
            "endpointId":"a","transportModelId":"model","modelRevision":"digest","deploymentId":null,
            "contextCalibration":{"version":1,"id":"calibration","scope":{"endpointId":"a","configurationRevision":1,
                "model":"model","digest":"digest","deployment":null,"backend":"ollama","runtimeEpoch":"native-epoch",
                "providerVersion":"1.2.3","reasoning":"[false]"},"status":"verified","highest":8192,"failedNext":null,
                "failure":null,"allocation":"receipt","startedAt":1,"updatedAt":2,"expiresAt":3,"retryAfter":3,
                "attempts":[{"context":8192,"requested":8192,"loaded":8192,"outcome":"success","at":2,"latencyMs":10,
                    "thermal":"cold","finish":"stop","think":"omitted"}]}
        }]})
    }

    #[test]
    fn context_calibration_is_restart_safe_and_compare_and_swap_owned() {
        let value = calibrated();
        let restored: Value = serde_json::from_slice(&serde_json::to_vec(&value).unwrap()).unwrap();
        validate(&restored).unwrap();
        assert_eq!(
            compare_and_save(
                restored.clone(),
                restored.clone(),
                value.clone(),
                |_| Ok(())
            ),
            Ok(true)
        );
        assert_eq!(
            compare_and_save(restored, Value::Null, value, |_| panic!(
                "stale owner must not write"
            )),
            Ok(false)
        );
    }

    #[test]
    fn seven_exact_loaded_context_tiers_through_73728_are_persistable_but_larger_or_unproved_are_not(
    ) {
        let mut value = calibrated();
        let original = value["profiles"][0]["contextCalibration"]["attempts"][0].clone();
        let ladder = [4096_u64, 8192, 16384, 32768, 49152, 65536, 73728];
        let attempts: Vec<Value> = ladder
            .iter()
            .enumerate()
            .map(|(i, context)| {
                let mut attempt = original.clone();
                attempt["context"] = json!(context);
                attempt["requested"] = json!(context);
                attempt["loaded"] = json!(context);
                attempt["at"] = json!(i + 1);
                attempt
            })
            .collect();
        let record = &mut value["profiles"][0]["contextCalibration"];
        record["attempts"] = json!(attempts);
        record["highest"] = json!(73728);
        record["updatedAt"] = json!(7);
        record["expiresAt"] = json!(15);
        record["retryAfter"] = json!(15);
        validate(&value).unwrap();
        let roundtrip: Value =
            serde_json::from_slice(&serde_json::to_vec(&value).unwrap()).unwrap();
        validate(&roundtrip).unwrap();
        assert_eq!(roundtrip, value);
        assert_eq!(
            compare_and_save(value.clone(), value.clone(), roundtrip, |_| Ok(())),
            Ok(true)
        );

        let mut invalid = value.clone();
        invalid["profiles"][0]["contextCalibration"]["highest"] = json!(81920);
        assert!(validate(&invalid).is_err());
        invalid = value.clone();
        invalid["profiles"][0]["contextCalibration"]["attempts"][6]["loaded"] = json!(65536);
        assert!(validate(&invalid).is_err());
        invalid = value.clone();
        invalid["profiles"][0]["contextCalibration"]["attempts"][6]["context"] = json!(81920);
        invalid["profiles"][0]["contextCalibration"]["attempts"][6]["requested"] = json!(81920);
        invalid["profiles"][0]["contextCalibration"]["attempts"][6]["loaded"] = json!(81920);
        invalid["profiles"][0]["contextCalibration"]["highest"] = json!(81920);
        assert!(validate(&invalid).is_err());

        let mut bounded_restore = value.clone();
        let retained = bounded_restore["profiles"][0]["contextCalibration"]["attempts"][5].clone();
        bounded_restore["profiles"][0]["contextCalibration"]["attempts"]
            .as_array_mut()
            .unwrap()
            .push(retained);
        validate(&bounded_restore).unwrap(); // seventh probe plus a bounded restore
        let overflow = bounded_restore["profiles"][0]["contextCalibration"]["attempts"][0].clone();
        bounded_restore["profiles"][0]["contextCalibration"]["attempts"]
            .as_array_mut()
            .unwrap()
            .push(overflow);
        assert!(validate(&bounded_restore).is_err());
        let mut legacy = value;
        legacy["profiles"][0]["contextCalibration"]["highest"] = json!(65536);
        legacy["profiles"][0]["contextCalibration"]["attempts"]
            .as_array_mut()
            .unwrap()
            .pop();
        validate(&legacy).unwrap();
    }

    #[test]
    fn context_calibration_rejects_cross_owner_false_allocation_and_unbounded_metadata() {
        for (path, invalid) in [
            ("/scope/endpointId", json!("other")),
            ("/scope/configurationRevision", json!(2)),
            ("/scope/digest", json!("changed")),
            ("/highest", json!(131072)),
            ("/attempts/0/loaded", json!(4096)),
            ("/failure", json!("fabricated")),
            ("/attempts/0/thermal", json!("fabricated")),
            ("/allocation", json!("x".repeat(1025))),
        ] {
            let mut value = calibrated();
            *value["profiles"][0]["contextCalibration"]
                .pointer_mut(path)
                .unwrap() = invalid;
            assert!(validate(&value).is_err(), "accepted {path}");
        }
        let mut value = calibrated();
        value["profiles"][0]["contextCalibration"]["attempts"] = json!([]);
        assert!(validate(&value).is_err());
        let mut value = calibrated();
        let record = &mut value["profiles"][0]["contextCalibration"];
        record["highest"] = Value::Null;
        record["failure"] = json!("transient");
        record["status"] = json!("incomplete");
        record["attempts"][0]["loaded"] = json!(131072);
        record["attempts"][0]["outcome"] = json!("transient");
        validate(&value).unwrap();
    }

    fn tool_verified() -> Value {
        let mut value = calibrated();
        value["profiles"][0]["toolVerification"] = json!({"version":1,"id":"tools","scope":{"endpointId":"a","configurationRevision":1,
            "model":"model","digest":"digest","deployment":null,"backend":"ollama","runtimeEpoch":"native","providerVersion":"1.2.3",
            "reasoning":"[false]","protocol":"native-tools-v1"},"status":"verified","outcome":"native-call","context":8192,"output":512,
            "startedAt":1,"completedAt":2,"firstBodyAt":2,"callAt":2,"calls":1,"validArguments":true,"textualIntent":false,"textChars":0,
            "finish":"tool-calls","proof":{"at":2,"expiresAt":3},"retryAfter":3});
        value
    }

    #[test]
    fn tool_verification_roundtrip_and_cas_preserve_context_and_ownership() {
        let value = tool_verified();
        let restored: Value = serde_json::from_slice(&serde_json::to_vec(&value).unwrap()).unwrap();
        validate(&restored).unwrap();
        assert_eq!(
            restored["profiles"][0]["contextCalibration"],
            calibrated()["profiles"][0]["contextCalibration"]
        );
        assert_eq!(
            compare_and_save(value.clone(), value.clone(), restored, |_| Ok(())),
            Ok(true)
        );
        assert_eq!(
            compare_and_save(value.clone(), Value::Null, value, |_| panic!("stale write")),
            Ok(false)
        );
    }

    #[test]
    fn tool_verification_rejects_wrong_owner_version_and_fabricated_success() {
        for (path, invalid) in [
            ("/scope/digest", json!("other")),
            ("/scope/endpointId", json!("other")),
            ("/scope/protocol", json!("future")),
            ("/version", json!(2)),
            ("/validArguments", json!(false)),
            ("/calls", json!(2)),
            ("/proof", Value::Null),
            ("/output", json!(4096)),
        ] {
            let mut value = tool_verified();
            *value["profiles"][0]["toolVerification"]
                .pointer_mut(path)
                .unwrap() = invalid;
            assert!(validate(&value).is_err(), "accepted {path}");
        }
    }

    #[test]
    fn tool_verification_preserves_bounded_conflicting_evidence() {
        let mut value = tool_verified();
        let record = &mut value["profiles"][0]["toolVerification"];
        record["failure"] = json!({"at":2,"expiresAt":3,"outcome":"text-only"});
        validate(&value).unwrap();
        let record = &mut value["profiles"][0]["toolVerification"];
        record["status"] = json!("needs-attention");
        record["outcome"] = json!("text-only");
        record["calls"] = json!(0);
        record["validArguments"] = json!(false);
        let restored: Value = serde_json::from_slice(&serde_json::to_vec(&value).unwrap()).unwrap();
        validate(&restored).unwrap();
        assert_eq!(
            restored["profiles"][0]["toolVerification"]["proof"],
            json!({"at":2,"expiresAt":3})
        );
        for invalid in [
            Value::Null,
            json!({"at":2,"expiresAt":3,"outcome":"native-call"}),
            json!({"at":-1,"expiresAt":3,"outcome":"text-only"}),
        ] {
            let mut invalid_record = value.clone();
            invalid_record["profiles"][0]["toolVerification"]["failure"] = invalid;
            assert!(validate(&invalid_record).is_err());
        }
    }

    #[test]
    fn escalated_tool_evidence_is_bounded_and_survives_native_cas() {
        for output in [512, 1024, 2048] {
            let mut value = tool_verified();
            value["profiles"][0]["toolVerification"]["output"] = json!(output);
            value["profiles"][0]["toolVerification"]["attempts"] = json!([
                {"output":output,"outcome":"native-call","finish":"tool-calls","startedAt":1,"completedAt":2}
            ]);
            let restored: Value =
                serde_json::from_slice(&serde_json::to_vec(&value).unwrap()).unwrap();
            assert_eq!(
                compare_and_save(value.clone(), value, restored, |_| Ok(())),
                Ok(true)
            );
        }
        let mut incomplete = tool_verified();
        let record = &mut incomplete["profiles"][0]["toolVerification"];
        record["status"] = json!("incomplete");
        record["outcome"] = json!("request-limit");
        record["proof"] = Value::Null;
        record["calls"] = json!(0);
        record["validArguments"] = json!(false);
        validate(&incomplete).unwrap();
    }

    #[test]
    fn native_tool_attempt_metadata_rejects_unbounded_or_malformed_records() {
        let attempt = json!({"output":512,"outcome":"output-length","finish":"length","startedAt":1,"completedAt":2});
        for invalid in [
            json!([
                attempt.clone(),
                attempt.clone(),
                attempt.clone(),
                attempt.clone()
            ]),
            Value::Null,
            json!({}),
        ] {
            let mut value = tool_verified();
            value["profiles"][0]["toolVerification"]["attempts"] = invalid;
            assert!(validate(&value).is_err());
        }
        for (field, invalid) in [
            ("output", json!(4096)),
            ("outcome", json!("invented")),
            ("finish", json!("x".repeat(65))),
            ("startedAt", json!(-1)),
            ("extra", json!(true)),
        ] {
            let mut value = tool_verified();
            let mut changed = attempt.clone();
            changed[field] = invalid;
            value["profiles"][0]["toolVerification"]["attempts"] = json!([changed]);
            assert!(validate(&value).is_err(), "accepted {field}");
        }
    }

    #[test]
    fn agent_configuration_confirmation_is_bounded_owned_and_restart_safe() {
        let mut value = tool_verified();
        let mut record = value["profiles"][0]["toolVerification"].clone();
        record["configuration"] = json!({"choice":"none","wire":false});
        record["confirmation"] = json!({"id":"earlier-native-pass","at":1,"expiresAt":3});
        value["profiles"][0]["agentToolConfigurations"] = json!([record.clone()]);
        let restored: Value = serde_json::from_slice(&serde_json::to_vec(&value).unwrap()).unwrap();
        validate(&restored).unwrap();
        for records in [
            json!([record.clone(), record.clone()]),
            json!([record.clone(), record.clone(), record.clone()]),
        ] {
            let mut invalid = value.clone();
            invalid["profiles"][0]["agentToolConfigurations"] = records;
            assert!(validate(&invalid).is_err());
        }
        for (path, invalid) in [
            ("/scope/digest", json!("other")),
            ("/configuration/wire", json!({})),
            ("/confirmation/id", json!("tools")),
            ("/confirmation/at", json!(4)),
        ] {
            let mut changed = value.clone();
            *changed["profiles"][0]["agentToolConfigurations"][0]
                .pointer_mut(path)
                .unwrap() = invalid;
            assert!(validate(&changed).is_err(), "accepted {path}");
        }
    }
}
