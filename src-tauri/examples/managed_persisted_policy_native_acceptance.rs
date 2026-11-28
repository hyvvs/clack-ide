//! Real Windows native PERSISTED CPU/CUDA policy acceptance under an isolated
//! Tauri application ID. Uses the SAME pinned provision/import/start/status/
//! route/stop functions as production Clack. No qualification campaign, no
//! product settings changes and no synthetic execution result.
#[cfg(windows)]
use serde_json::{json, Value};
#[cfg(windows)]
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
#[cfg(windows)]
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
#[cfg(windows)]
use terax_lib::modules::{managed_local_runtime as managed, self_hosted_profiles as prefs};

#[cfg(windows)]
const DIGEST: &str = "sha256:74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db";
#[cfg(windows)]
const DEVICE: &str = "clack-this-pc:accelerator:GPU-30ab48fd-809d-dc7d-c437-6ad626ece81a";
#[cfg(windows)]
const CPU_DEVICE: &str = "clack-this-pc:cpu:0";

#[cfg(windows)]
#[derive(Clone)]
struct Selection {
    id: String,
    identity: String,
    backend: &'static str,
}
#[cfg(windows)]
fn policy_selection(backend: &'static str, allow_cpu: bool) -> (Selection, Value) {
    let host = "clack-this-pc";
    let runtime = "clack-managed-llama.cpp";
    let artifact = json!(["digest", DIGEST]).to_string();
    let config = r#"{"version":3,"context":2048,"tool":false,"grammar":false}"#;
    let cpu_candidate = format!(
        r#"{{"backend":"cpu","deviceIds":[{}],"gpuLayers":0,"runtimeVariantId":"b12248/cpu","runtimeBuildDigest":"sha256:bb306bfd390f8782c0acaba490505d12f07392791b48f1dd039387a5bacf1181"}}"#,
        json!(CPU_DEVICE)
    );
    let cuda_candidate = format!(
        r#"{{"backend":"cuda","deviceIds":[{}],"gpuLayers":40,"runtimeVariantId":"b12248/cuda","runtimeBuildDigest":"sha256:ae0a1e064a94db82f3352c843ffa96eb190254fefafc29ce0213798c549a2799"}}"#,
        json!(DEVICE)
    );
    let (device, layers, fallback, candidates) = if backend == "cpu" {
        (
            CPU_DEVICE,
            0,
            r#"{"policy":"disabled"}"#.to_owned(),
            cpu_candidate,
        )
    } else if allow_cpu {
        (
            DEVICE,
            40,
            r#"{"policy":"explicit-order","order":["cpu"]}"#.to_owned(),
            format!("{cuda_candidate},{cpu_candidate}"),
        )
    } else {
        (
            DEVICE,
            40,
            r#"{"policy":"disabled"}"#.to_owned(),
            cuda_candidate,
        )
    };
    let request_json = format!(
        r#"{{"backend":"{backend}","deviceIds":[{}],"gpuLayers":{layers},"contextLength":2048,"fallback":{fallback},"candidates":[{candidates}],"memoryBudget":{{"maxDeviceBytes":8589934592,"maxHostBytes":8589934592,"reserveDeviceBytes":134217728,"reserveHostBytes":134217728}},"deviceStrategy":{{"kind":"single","primaryDeviceId":{},"splitStrategy":"none"}}}}"#,
        json!(device),
        json!(device)
    );
    let request: Value = serde_json::from_str(&request_json).expect("canonical v3 policy");
    let id_base = json!(["managed-gguf-policy-v3", DIGEST, config]).to_string();
    let id = format!("{},{}]", id_base.trim_end_matches(']'), request_json);
    let seven = json!([
        host,
        runtime,
        artifact,
        format!("managed-gguf:{DIGEST}"),
        1,
        Value::Null,
        config
    ])
    .to_string();
    let identity = format!("{},{}]", seven.trim_end_matches(']'), request_json);
    let row = json!({"id":id,"hostId":host,"runtimeId":runtime,
        "artifactId":artifact,"runtimeModelName":format!("managed-gguf:{DIGEST}"),
        "configurationRevision":1,"configurationIdentity":config,
        "requestedExecution":request});
    (
        Selection {
            id,
            identity,
            backend,
        },
        row,
    )
}
#[cfg(windows)]
fn cuda_selection(policy: &str) -> (Selection, Value) {
    policy_selection("cuda", policy == "allow-compatible")
}
#[cfg(windows)]
fn cpu_selection() -> (Selection, Value) {
    policy_selection("cpu", false)
}

#[cfg(windows)]
fn status(
    app: &tauri::AppHandle,
    selected: &Selection,
) -> Result<managed::ManagedRuntimeStatus, String> {
    tauri::async_runtime::block_on(managed::managed_local_runtime_status(
        app.clone(),
        Some(selected.id.clone()),
        Some(selected.identity.clone()),
    ))
}
#[cfg(windows)]
fn wait_ready(
    app: &tauri::AppHandle,
    selected: &Selection,
    expected: &str,
) -> Result<managed::ManagedRuntimeStatus, String> {
    let deadline = Instant::now() + Duration::from_secs(115);
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(400));
        let view = status(app, selected)?;
        if view.state == "Ready" {
            let actual = view
                .actual_execution
                .as_ref()
                .ok_or("Native Ready lacks actual execution evidence")?;
            let receipt = serde_json::to_value(actual).map_err(|e| e.to_string())?;
            if receipt["executionReceipt"]["version"] != 3
                || receipt["executionReceipt"]["processId"] != json!(view.process_id)
                || receipt["executionReceipt"]["deploymentId"] != selected.id
                || receipt["executionReceipt"]["deploymentIdentity"] != selected.identity
                || receipt["executionReceipt"]["policyIdentity"]
                    .as_str()
                    .is_none()
            {
                return Err("V3 Ready lacks exact native execution receipt/PID/policy".into());
            }
            if actual.backend != expected
                || actual.runtime_variant_id != format!("b12248/{expected}")
                || (expected == "cuda" && (actual.gpu_layers == 0 || actual.device_ids != [DEVICE]))
                || (expected == "cpu" && actual.gpu_layers != 0)
            {
                return Err(format!(
                    "Native Ready observed incompatible backend {expected}"
                ));
            }
            return Ok(view);
        }
        if view.state == "Failed" || view.state == "Not Installed" {
            return Err(format!(
                "Native startup failed: {} [{}]",
                view.error.as_deref().unwrap_or("unspecified"),
                view.failure_kind.unwrap_or("unclassified")
            ));
        }
    }
    Err(format!("Native {expected} readiness timeout"))
}
#[cfg(windows)]
fn route(
    app: &tauri::AppHandle,
    selected: &Selection,
    epoch: &str,
) -> Result<managed::ManagedRuntimeRoute, String> {
    tauri::async_runtime::block_on(managed::managed_local_runtime_route(
        app.clone(),
        selected.id.clone(),
        selected.identity.clone(),
        Some(epoch.into()),
    ))
}
#[cfg(windows)]
fn stop(app: &tauri::AppHandle, selected: &Selection, old_epoch: &str) -> Result<(), String> {
    let ended = managed::managed_local_runtime_stop(
        app.clone(),
        Some(selected.id.clone()),
        Some(selected.identity.clone()),
    )?;
    if ended.state != "Stopped" || ended.process_id.is_some() || ended.epoch == old_epoch {
        return Err("Native stop did not invalidate child/epoch".into());
    }
    if route(app, selected, old_epoch).is_ok() {
        return Err("Stale native route remains authorized after stop".into());
    }
    Ok(())
}
#[cfg(windows)]
fn restart(app: &tauri::AppHandle, selected: &Selection) -> Result<Value, String> {
    let first = managed::managed_local_runtime_start(
        app.clone(),
        selected.id.clone(),
        selected.identity.clone(),
    )?;
    let first_pid = first.process_id.ok_or("First native launch lacked a PID")?;
    let first_ready = wait_ready(app, selected, selected.backend)?;
    if first_ready.process_id != Some(first_pid) {
        return Err("First native PID changed before readiness".into());
    }
    let first_route = route(app, selected, &first_ready.epoch)?;
    stop(app, selected, &first_ready.epoch)?;
    let second = managed::managed_local_runtime_start(
        app.clone(),
        selected.id.clone(),
        selected.identity.clone(),
    )?;
    if second.process_id.is_none() || second.state != "Starting" {
        return Err("Second native launch never established a fresh starting child".into());
    }
    let second_ready = wait_ready(app, selected, selected.backend)?;
    let second_route = route(app, selected, &second_ready.epoch)?;
    let fresh = second_ready.process_id != Some(first_pid)
        && first_ready.epoch != second_ready.epoch
        && first_route.base_url != second_route.base_url
        && first_route.api_key != second_route.api_key;
    if !fresh || route(app, selected, &first_ready.epoch).is_ok() {
        return Err(
            "Restart failed distinct PID/epoch/port/credential or stale-route fence".into(),
        );
    }
    let result = json!({"backend":selected.backend,"firstPid":first_pid,
        "secondPid":second_ready.process_id,"firstEpoch":first_ready.epoch,
        "secondEpoch":second_ready.epoch,"firstRoute":first_route.base_url,
        "secondRoute":second_route.base_url,"nativeReadyTwice":true,
        "newPidEpochRouteAndCredential":true,"oldRouteRejected":true,
        "nativeActualBackend":second_ready.actual_execution.as_ref().map(|a|a.backend),
        "nativeOffloadedLayers":second_ready.actual_execution.as_ref().map(|a|a.gpu_layers)});
    // Exactly one bounded real inference on the second Ready for each variant.
    // This is functional smoke, NEVER a qualification procedure.
    {
        let response = tauri::async_runtime::block_on(async {
            let client = reqwest::Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(40))
                .build()
                .map_err(|e| e.to_string())?;
            let payload = client
                .post(format!("{}/completions", second_route.base_url))
                .bearer_auth(&second_route.api_key)
                .header("content-type", "application/json")
                .body(
                    json!({"model":second_route.model_alias,
                    "prompt":"Two plus two equals","max_tokens":12,"stream":false})
                    .to_string(),
                )
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let code = payload.status();
            let body = payload.bytes().await.map_err(|e| e.to_string())?;
            if body.len() > 128 * 1024 {
                return Err("CPU bounded inference exceeded output budget".into());
            }
            let parsed: Value = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
            let nonempty = parsed["choices"][0]["text"]
                .as_str()
                .is_some_and(|v| !v.is_empty());
            if !code.is_success() || !nonempty {
                return Err(format!(
                    "{expected} inference failed: HTTP {code}",
                    expected = selected.backend
                ));
            }
            Ok::<_, String>((code.as_u16(), nonempty))
        })?;
        let mut enriched = result.clone();
        enriched["boundedInferenceHttpStatus"] = json!(response.0);
        enriched["boundedInferenceNonempty"] = json!(response.1);
        // Correlate one completed bounded HTTP inference to the independently
        // authenticated native Ready receipt; never fabricate actual placement
        // from requested policy or retain the ephemeral bearer credential.
        enriched["completedInferenceReceipt"] = json!({
            "requestedBackend":selected.backend,
            "selectedBackend":second_ready.selected_backend,
            "actualExecution":second_ready.actual_execution,
            "httpStatus":response.0,"nonempty":response.1,
            "nativeEpoch":second_ready.epoch,
        });
        stop(app, selected, &second_ready.epoch)?;
        Ok(enriched)
    }
}
#[cfg(windows)]
fn kill_real_child(pid: u32) -> Result<(), String> {
    let system = std::env::var("SystemRoot").map_err(|_| "Windows root missing")?;
    let exe = PathBuf::from(system).join("System32/taskkill.exe");
    if !exe.is_file() {
        return Err("System32 taskkill unavailable".into());
    }
    let result = Command::new(exe)
        .args(["/PID", &pid.to_string(), "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("Cannot force real startup failure: {e}"))?;
    if !result.success() {
        return Err("OS did not terminate owned CUDA startup child".into());
    }
    Ok(())
}
#[cfg(windows)]
fn failed_cuda_start(
    app: &tauri::AppHandle,
    selected: &Selection,
    allow_cpu: bool,
) -> Result<Value, String> {
    let start = managed::managed_local_runtime_start(
        app.clone(),
        selected.id.clone(),
        selected.identity.clone(),
    )?;
    if start.selected_backend != Some("cuda") || start.fallback_used || start.state != "Starting" {
        return Err("Controlled failure did not actually spawn CUDA first".into());
    }
    let failed_pid = start.process_id.ok_or("CUDA startup lacked a child PID")?;
    let failed_epoch = start.epoch.clone();
    let failed_port = start.port.ok_or("CUDA startup lacked an owned port")?;
    kill_real_child(failed_pid)?;
    let after = status(app, selected)?;
    if !allow_cpu {
        if after.state != "Failed"
            || after.process_id.is_some()
            || after.epoch == failed_epoch
            || after.fallback_used
        {
            return Err("Fallback-disabled CUDA startup did not fail closed".into());
        }
        if route(app, selected, &failed_epoch).is_ok() {
            return Err("Failed CUDA retained a stale route".into());
        }
        return Ok(
            json!({"requestedBackend":"cuda","initialRealCudaPid":failed_pid,
            "initialEpoch":failed_epoch,"osChildTerminated":true,"fallbackAllowed":false,
            "explicitFailure":after.error,"failureKind":after.failure_kind,
            "actualBackend":Value::Null,"staleRouteRejected":true}),
        );
    }
    let ready = if after.state == "Ready" {
        after
    } else {
        wait_ready(app, selected, "cpu")?
    };
    if ready.selected_backend != Some("cpu")
        || !ready.fallback_used
        || !ready.fallback_authorized
        || ready.fallback_reason.is_none()
        || ready.process_id == Some(failed_pid)
        || ready.epoch == failed_epoch
        || ready.port == Some(failed_port)
    {
        return Err(
            "Real CUDA startup failure did not safely recover to independent CPU owner".into(),
        );
    }
    if route(app, selected, &failed_epoch).is_ok() {
        return Err("Old failed CUDA epoch accepted by recovered CPU".into());
    }
    let recovered_route = route(app, selected, &ready.epoch)?;
    let result = json!({"requestedBackend":"cuda","selectedBackend":ready.selected_backend,
        "actualBackend":ready.actual_execution.as_ref().map(|a|a.backend),
        "nativeVariant":ready.actual_execution.as_ref().map(|a|a.runtime_variant_id),
        "initialRealCudaPid":failed_pid,"initialEpoch":failed_epoch,
        "initialPort":failed_port,"osChildTerminated":true,
        "fallbackAllowed":true,"fallbackUsed":ready.fallback_used,
        "fallbackReason":ready.fallback_reason,"failureKind":ready.failure_kind,
        "newPid":ready.process_id,"newEpoch":ready.epoch,
        "newRoute":recovered_route.base_url,
        "nativeReady":true,"staleRouteRejected":true});
    stop(app, selected, &ready.epoch)?;
    Ok(result)
}
#[cfg(windows)]
fn native_case(app: tauri::AppHandle, root: &Path) -> Result<Value, String> {
    let env_path = |name| {
        std::env::var(name)
            .map(PathBuf::from)
            .map_err(|_| format!("Missing explicit acceptance input {name}"))
    };
    let cpu_zip = env_path("CLACK_ORCH_CPU_ZIP")?;
    let cuda_zip = env_path("CLACK_CUDA_ENGINE_ZIP")?;
    let deps_zip = env_path("CLACK_CUDA_DLL_ZIP")?;
    let gguf = env_path("CLACK_ORCH_GGUF_SOURCE")?;
    let expected_basename = format!("{}.gguf", &DIGEST[7..]);
    if gguf.file_name().and_then(|v| v.to_str()) != Some(expected_basename.as_str()) {
        return Err("Refusing unexpected GGUF acceptance model basename".into());
    }
    let local = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
    if !local
        .to_string_lossy()
        .contains("app.clack.persisted.policy.acceptance")
        || !config
            .to_string_lossy()
            .contains("app.clack.persisted.policy.acceptance")
    {
        return Err("Refusing production Settings/Data roots for isolated acceptance".into());
    }
    prefs::self_hosted_profiles_startup_storage_check(&app)?;
    managed::managed_local_runtime_install_bundle(
        app.clone(),
        cpu_zip.to_string_lossy().into_owned(),
    )?;
    managed::managed_local_runtime_install_cuda_bundles(
        app.clone(),
        cuda_zip.to_string_lossy().into_owned(),
        deps_zip.to_string_lossy().into_owned(),
    )?;
    if !managed::managed_local_runtime_cuda_variant_status(app.clone()).installed {
        return Err("Installed managed CUDA manifest is not fully verified".into());
    }
    let inspected = managed::managed_local_runtime_import(
        app.clone(),
        gguf.to_string_lossy().into_owned(),
        DIGEST.into(),
    )?;
    if inspected.digest != DIGEST {
        return Err("Pinned GGUF import digest failed".into());
    }
    let (cpu, cpu_row) = cpu_selection();
    let (cuda, cuda_row) = cuda_selection("disabled");
    let (fallback, allow_row) = cuda_selection("allow-compatible");
    let original_fallback_policy = allow_row["requestedExecution"].clone();
    let artifact = json!(["digest", DIGEST]).to_string();
    let fabric = json!({"version":1,
        "hosts":[{"id":"clack-this-pc","displayName":"This PC","enabled":true,
            "location":"local","reachability":"online","runtimeIds":["clack-managed-llama.cpp"]}],
        "runtimes":[{"id":"clack-managed-llama.cpp","hostId":"clack-this-pc",
            "type":"clack-managed-llama.cpp","displayName":"Managed llama.cpp",
            "enabled":true,"health":"online","configurationRevision":1,
            "version":"b12248","capabilities":{}}],
        "artifacts":[{"id":artifact,"digest":DIGEST,"displayName":"Qwen2.5 0.5B bounded acceptance",
            "format":"gguf","size":inspected.size,"provenance":"user-supplied"}],
        "deployments":[cpu_row,cuda_row,allow_row],
        "qualificationReceipts":[],"measurementRuns":[]});
    let state = json!({"version":1,"revision":1,"endpoints":[],"inventories":[],
        "profiles":[],"fabric":fabric});
    let path = config.join("terax-settings.json");
    if path.exists() {
        let raw: Value = serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        if raw["selfHostedInference"] == state {
            // A completed prior isolated registration is safe to reuse.
        } else if raw.as_object().is_some_and(|v| v.is_empty()) {
            // Startup storage check initializes a fresh, isolated authority to {}.
            if !prefs::self_hosted_profiles_compare_and_swap(app.clone(), Value::Null, state)? {
                return Err("Native CAS refused fresh isolated Fabric registration".into());
            }
        } else {
            return Err("Existing isolated acceptance Settings differs; refuse overwrite".into());
        }
    } else if !prefs::self_hosted_profiles_compare_and_swap(app.clone(), Value::Null, state)? {
        return Err("Native CAS refused first isolated Fabric registration".into());
    }
    let cpu_restart = restart(&app, &cpu)?;
    fs::write(
        root.join("cpu-regression.json"),
        serde_json::to_vec_pretty(&cpu_restart).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let cuda_restart = restart(&app, &cuda)?;
    fs::write(
        root.join("cuda-restart.json"),
        serde_json::to_vec_pretty(&cuda_restart).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    // Real persisted policy switch CPU -> CUDA -> CPU, after the previous
    // owners were stopped. A second CPU policy launch must not reuse an old
    // PID, epoch, port, credential or authorize any stale CPU/CUDA route.
    let restarted =
        managed::managed_local_runtime_start(app.clone(), cpu.id.clone(), cpu.identity.clone())?;
    if restarted.state != "Starting" {
        return Err("CPU switch-back was not a real new launch".into());
    }
    let switched = wait_ready(&app, &cpu, "cpu")?;
    let switched_route = route(&app, &cpu, &switched.epoch)?;
    if switched.process_id == cpu_restart["secondPid"].as_u64().map(|id| id as u32)
        || switched.process_id == cuda_restart["secondPid"].as_u64().map(|id| id as u32)
        || switched.epoch == cpu_restart["secondEpoch"]
        || switched.epoch == cuda_restart["secondEpoch"]
        || switched_route.base_url == cpu_restart["secondRoute"]
        || switched_route.base_url == cuda_restart["secondRoute"]
        || route(
            &app,
            &cpu,
            cpu_restart["secondEpoch"]
                .as_str()
                .ok_or("Missing CPU previous epoch")?,
        )
        .is_ok()
        || route(
            &app,
            &cuda,
            cuda_restart["secondEpoch"]
                .as_str()
                .ok_or("Missing CUDA previous epoch")?,
        )
        .is_ok()
    {
        return Err("Policy switch-back reused runtime authority or accepted stale route".into());
    }
    let switching = json!({"policyOrder":["cpu","cuda","cpu"],"switchBackActualBackend":"cpu",
        "switchBackPid":switched.process_id,"switchBackEpoch":switched.epoch,
        "switchBackRoute":switched_route.base_url,"oldCpuAndCudaRoutesRejected":true,
        "freshPidEpochRoute":true});
    stop(&app, &cpu, &switched.epoch)?;
    fs::write(
        root.join("policy-switching.json"),
        serde_json::to_vec_pretty(&switching).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let rejected = failed_cuda_start(&app, &cuda, false)?;
    fs::write(
        root.join("fallback-disabled.json"),
        serde_json::to_vec_pretty(&rejected).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let allowed = failed_cuda_start(&app, &fallback, true)?;
    fs::write(
        root.join("fallback-enabled.json"),
        serde_json::to_vec_pretty(&allowed).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let registered: Value = serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let retained = registered["selfHostedInference"]["fabric"]["deployments"]
        .as_array()
        .ok_or("Persisted Fabric missing after native fallback")?
        .iter()
        .find(|row| row["id"] == fallback.id)
        .is_some_and(|row| row["requestedExecution"] == original_fallback_policy);
    if !retained {
        return Err("CUDA-to-CPU fallback mutated persisted execution policy".into());
    }
    let result = json!({"accepted":true,"isolatedAppId":"app.clack.persisted.policy.acceptance",
        "canonicalFabric":true,"bothOfficialVariantsProvisionedAndVerified":true,
        "cpuRegression":cpu_restart,"cudaRestart":cuda_restart,"policySwitching":switching,
        "cudaFailureWithoutFallback":rejected,"realCudaToCpuFallback":allowed,
        "persistedFallbackPolicyUnchanged":retained,
        "qualificationRuns":0,"modelRequests":2,
        "productionSettingsUntouched":true});
    fs::write(
        root.join("native-persisted-policy-acceptance.json"),
        serde_json::to_vec_pretty(&result).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(result)
}
#[cfg(windows)]
fn main() {
    let root = std::env::var("CLACK_POLICY_ACCEPTANCE_ROOT").expect("Explicit isolated case root");
    let root = fs::canonicalize(root).expect("Acceptance case root exists");
    assert!(root.ends_with(PathBuf::from("target/clack-slice4-policy-acceptance")));
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "app.clack.persisted.policy.acceptance".into();
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(move |app| {
            WebviewWindowBuilder::new(
                app,
                "policy-acceptance",
                WebviewUrl::App("index.html".into()),
            )
            .title("Clack Native Persisted Policy Acceptance")
            .visible(false)
            .build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let code = match native_case(handle.clone(), &root) {
                    Ok(result) => {
                        println!("CLACK_NATIVE_POLICY_PASS={result}");
                        0
                    }
                    Err(error) => {
                        eprintln!("CLACK_NATIVE_POLICY_FAILED={error}");
                        let _ = fs::write(root.join("native-policy-error.txt"), error);
                        1
                    }
                };
                handle.exit(code);
            });
            Ok(())
        })
        .run(context)
        .expect("Tauri native runtime acceptance host run");
}
#[cfg(not(windows))]
fn main() {
    eprintln!("Windows-native CPU/CUDA orchestration acceptance requires a real NVIDIA host");
}
