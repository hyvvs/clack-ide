//! Exact native managed CUDA runtime acceptance on a private, isolated Clack
//! identity. This is not a replacement for Clack runtime ownership: every
//! install/start/Ready/route/stop call uses the same production owner methods.
//! Never runs Qualification Lab, LM6, Agent or tool actions. Max ONE tiny
//! authenticated completion after independently proven CUDA offload.
#[cfg(windows)]
use std::{fs, path::{Path,PathBuf},time::{Duration,Instant}};
#[cfg(windows)]
use serde_json::{json,Value};
#[cfg(windows)]
use tauri::{Manager,WebviewUrl,WebviewWindowBuilder};
#[cfg(windows)]
use terax_lib::modules::{managed_local_runtime as local,self_hosted_profiles as prefs};

#[cfg(windows)]
fn native_case(app:tauri::AppHandle,root:&Path)->Result<Value,String> {
    let env_path=|name| std::env::var(name).map(PathBuf::from)
        .map_err(|_|format!("Required exact acceptance input absent: {name}"));
    let bundle=env_path("CLACK_CUDA_ENGINE_ZIP")?;
    let libraries=env_path("CLACK_CUDA_DLL_ZIP")?;
    let gguf=env_path("CLACK_CUDA_GGUF_SOURCE")?;
    let digest="sha256:74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db";
    if gguf.file_name().and_then(|v|v.to_str()) != Some("74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db.gguf") {
        return Err("Acceptance model file identity mismatch".into());
    }
    let local_path=app.path().app_local_data_dir().map_err(|e|e.to_string())?;
    let config_path=app.path().app_config_dir().map_err(|e|e.to_string())?;
    if !local_path.to_string_lossy().contains("app.clack.cuda.acceptance") ||
       !config_path.to_string_lossy().contains("app.clack.cuda.acceptance") {
        return Err("Refusing to run outside isolated CUDA acceptance settings/root".into());
    }
    let existing_settings=config_path.join("terax-settings.json");
    let first_acceptance= !existing_settings.exists();
    prefs::self_hosted_profiles_startup_storage_check(&app)?;
    local::managed_local_runtime_install_cuda_bundles(
        app.clone(),bundle.to_string_lossy().into_owned(),libraries.to_string_lossy().into_owned())?;
    let installed=local::managed_local_runtime_cuda_variant_status(app.clone());
    if !installed.installed {return Err(format!("Installed CUDA variant not verified: {:?}",installed.error));}
    let inspected=local::managed_local_runtime_import(
        app.clone(),gguf.to_string_lossy().into_owned(),digest.to_owned())?;
    if inspected.digest != digest {return Err("Imported model digest disagrees with source".into());}
    let host="clack-this-pc";
    let runtime="clack-managed-llama.cpp";
    let device="clack-this-pc:accelerator:GPU-30ab48fd-809d-dc7d-c437-6ad626ece81a";
    let hardware=terax_lib::modules::hardware_profile::cuda_device_for_request(device)?;
    let gpu_before=hardware.available_vram_bytes.as_ref().map(|v|v.value);
    let artifact=json!(["digest",digest]).to_string();
    let config=r#"{"version":2,"context":2048,"tool":false,"grammar":false}"#;
    let gpu_layers=40;
    let policy="disabled";
    let deployment_id=json!(["managed-gguf-cuda",digest,config,gpu_layers,device,policy]).to_string();
    let runtime_model=format!("managed-gguf:{digest}");
    let request=json!({"backend":"cuda","deviceIds":[device],"gpuLayers":gpu_layers,
        "contextLength":2048,"fallback":{"policy":policy}});
    let canonical_request=format!(r#"{{"backend":"cuda","deviceIds":[{}],"gpuLayers":40,"contextLength":2048,"fallback":{{"policy":"disabled"}}}}"#,json!(device));
    let seven=json!([host,runtime,artifact,runtime_model,1,"b12248/cuda",config]).to_string();
    let identity=format!("{},{}]",seven.trim_end_matches(']'),canonical_request);
    let fabric=json!({"version":1,
        "hosts":[{"id":host,"displayName":"This PC","enabled":true,"location":"local","reachability":"online","runtimeIds":[runtime]}],
        "runtimes":[{"id":runtime,"hostId":host,"type":runtime,"displayName":"Managed llama.cpp","enabled":true,"health":"online","configurationRevision":1,"version":"b12248","capabilities":{}}],
        "artifacts":[{"id":artifact,"digest":digest,"displayName":"Qwen2.5-0.5B-Instruct","format":"gguf","size":491400032,"provenance":"user-supplied"}],
        "deployments":[{"id":deployment_id,"hostId":host,"runtimeId":runtime,
            "artifactId":artifact,"runtimeModelName":runtime_model,"configurationRevision":1,
            "configurationIdentity":config,"variantId":"b12248/cuda","requestedExecution":request}],
        "qualificationReceipts":[],"measurementRuns":[]});
    let state=json!({"version":1,"revision":1,"endpoints":[],"inventories":[],"profiles":[],"fabric":fabric});
    if first_acceptance {
        if !prefs::self_hosted_profiles_compare_and_swap(app.clone(),Value::Null,state.clone())? {
            return Err("Isolated initial canonical Fabric CAS did not commit".into());
        }
    } else {
        let existing:Value=serde_json::from_slice(&fs::read(&existing_settings)
            .map_err(|_|"Previous isolated settings unreadable")?)
            .map_err(|_|"Previous isolated settings corrupt")?;
        if existing["selfHostedInference"]!=state {
            return Err("Existing isolated acceptance record changed; refusing a retry or production fallback".into());
        }
    }
    let mut accepted=local::managed_local_runtime_start(app.clone(),deployment_id.clone(),identity.clone())?;
    if accepted.selected_backend!=Some("cuda") || accepted.fallback_used {
        return Err("Native launch did not select CUDA with fallback disabled".into());
    }
    let pid=accepted.process_id.ok_or("CUDA start did not return a real native PID")?;
    let epoch=accepted.epoch.clone();
    let deadline=Instant::now()+Duration::from_secs(115);
    let mut last_log_capture=Instant::now();
    while Instant::now()<deadline {
        std::thread::sleep(Duration::from_millis(750));
        accepted=tauri::async_runtime::block_on(local::managed_local_runtime_status(
            app.clone(),Some(deployment_id.clone()),Some(identity.clone())))?;
        #[cfg(feature="managed-cuda-native-acceptance")]
        if last_log_capture.elapsed()>=Duration::from_secs(4) {
            last_log_capture=Instant::now();
            let lines=local::managed_cuda_acceptance_log_summary(&deployment_id,&identity);
            if !lines.is_empty() {
                let _=fs::write(root.join("cuda-native-startup-evidence-lines.json"),
                    serde_json::to_vec_pretty(&lines).unwrap_or_default());
            }
        }
        if accepted.state=="Ready" {break;}
        if accepted.state=="Failed" || accepted.state=="Not Installed" {
            #[cfg(feature="managed-cuda-native-acceptance")]
            {
                let lines=local::managed_cuda_acceptance_log_summary(&deployment_id,&identity);
                let _=fs::write(root.join("cuda-native-startup-evidence-lines.json"),
                    serde_json::to_vec_pretty(&lines).unwrap_or_default());
            }
            return Err(format!("Native CUDA lifecycle failed: {}",accepted.error.as_deref().unwrap_or("unspecified")));
        }
    }
    if accepted.state!="Ready" {
        #[cfg(feature="managed-cuda-native-acceptance")]
        {
            let lines=local::managed_cuda_acceptance_log_summary(&deployment_id,&identity);
            let _=fs::write(root.join("cuda-native-startup-evidence-lines.json"),
                serde_json::to_vec_pretty(&lines).unwrap_or_default());
        }
        return Err(format!("Managed CUDA readiness timeout; last native state {}",accepted.state));
    }
    let actual=accepted.actual_execution.as_ref().ok_or("CUDA Ready had no actual offload proof")?;
    if actual.backend!="cuda" || actual.gpu_layers==0 || actual.device_ids!=[device] ||
       actual.runtime_variant_id!="b12248/cuda" || accepted.process_id!=Some(pid) || accepted.epoch!=epoch {
        return Err("Native Ready did not prove exact CUDA backend/device/offload/epoch".into());
    }
    let route=tauri::async_runtime::block_on(local::managed_local_runtime_route(
        app.clone(),deployment_id.clone(),identity.clone(),Some(epoch.clone())))?;
    if route.process_id!=pid || route.epoch!=epoch || !route.base_url.starts_with("http://127.0.0.1:") {
        return Err("Native route PID, epoch or loopback owner mismatch".into());
    }
    // Exactly one bounded production-local transport call; no Qualification Lab.
    let response=tauri::async_runtime::block_on(async {
        reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(40))
            .build().map_err(|e|e.to_string())?
            .post(format!("{}/completions",route.base_url))
            .bearer_auth(&route.api_key)
            .header("content-type","application/json")
            .body(json!({"model":route.model_alias,"prompt":"The color of the clear sky is",
                "max_tokens":16,"stream":false}).to_string())
            .send().await.map_err(|e|format!("Bounded CUDA inference transport failed: {e}"))
    })?;
    let status=response.status();
    let bytes=tauri::async_runtime::block_on(response.bytes()).map_err(|e|e.to_string())?;
    if bytes.len()>128*1024 {return Err("CUDA inference response exceeds fixed acceptance budget".into());}
    let payload:Value=serde_json::from_slice(&bytes).map_err(|_|"CUDA inference response was not JSON")?;
    let text=payload["choices"][0]["text"].as_str().unwrap_or("");
    if !status.is_success() || text.is_empty() {
        return Err(format!("CUDA bounded completion failed (HTTP {status}, nonempty={})",!text.is_empty()));
    }
    let observed=tauri::async_runtime::block_on(local::managed_local_runtime_status(
        app.clone(),Some(deployment_id.clone()),Some(identity.clone())))?;
    if observed.state!="Ready" || observed.actual_execution.as_ref().is_none_or(|a|a.backend!="cuda") {
        return Err("Managed CUDA owner became unhealthy during bounded inference".into());
    }
    // Persist real execution/transport evidence BEFORE stop. If cleanup has
    // a reporting bug, an otherwise valid CUDA inference must not disappear
    // behind that terminal lifecycle assertion. No bearer token is logged.
    let before_stop=json!({
        "ready":true,"nativePid":pid,"epoch":epoch,"route":route.base_url,
        "requestedBackend":"cuda","selectedBackend":observed.selected_backend,
        "requestedGpuLayers":40,"actualBackend":observed.actual_execution.as_ref().map(|a|a.backend),
        "actualOffloadedLayers":observed.actual_execution.as_ref().map(|a|a.gpu_layers),
        "actualDevice":observed.actual_execution.as_ref().map(|a|&a.device_ids),
        "runtimeVariant":"b12248/cuda", "fallbackUsed":observed.fallback_used,
        "gpuFreeBeforeBytes":gpu_before,"gpuFreeAfterReadyBytes":observed.gpu_free_after_bytes,
        "cudaProcessVramBytes":observed.cuda_process_vram_bytes,
        "httpStatus":status.as_u16(),"outputNonEmpty":true,"outputCharacters":text.chars().count(),
        "qualificationRuns":0,"modelRequests":1,
    });
    fs::write(root.join("managed-cuda-native-prestop-evidence.json"),
        serde_json::to_vec_pretty(&before_stop).map_err(|e|e.to_string())?)
        .map_err(|e|e.to_string())?;
    let stopped=local::managed_local_runtime_stop(app.clone(),Some(deployment_id.clone()),Some(identity.clone()))?;
    if stopped.process_id.is_some() || stopped.epoch==epoch || stopped.state!="Stopped" {
        return Err("Native stop did not reap CUDA process and invalidate epoch".into());
    }
    if tauri::async_runtime::block_on(local::managed_local_runtime_route(
        app.clone(),deployment_id.clone(),identity.clone(),Some(epoch.clone()))).is_ok() {
        return Err("Stale CUDA epoch/route unexpectedly accepted after stop".into());
    }
    let out=json!({"accepted":true,"case":"one-native-managed-cuda-runtime-completion",
        "runtimeVersion":"b12248","runtimeVariant":"b12248/cuda",
        "engineArchiveSha256":installed.engine_archive_sha256,
        "dependencyArchiveSha256":installed.dependency_archive_sha256,
        "executableSha256":installed.executable_sha256,
        "deviceUuid":device,"gpuModel":hardware.model.map(|v|v.value),
        "gpuFreeBeforeBytes":gpu_before,"gpuFreeAtLaunchBytes":accepted.gpu_free_before_bytes,
        "gpuFreeAfterReadyBytes":observed.gpu_free_after_bytes,
        "cudaProcessVramBytes":observed.cuda_process_vram_bytes,
        "nativePid":pid,"epoch":epoch,"route":route.base_url,
        "requestedBackend":"cuda","requestedGpuLayers":40,
        "selectedBackend":observed.selected_backend,"actualBackend":"cuda",
        "actualOffloadedLayers":observed.actual_execution.map(|v|v.gpu_layers),
        "fallbackUsed":observed.fallback_used,"httpStatus":status.as_u16(),
        "outputNonEmpty":true,"outputCharacters":text.chars().count(),
        "postStopEpochRotated":true,"postStopRouteRejected":true,
        "qualificationRuns":0,"modelRequests":1,
        "isolatedConfigPath":config_path.to_string_lossy().into_owned(),
        "isolatedRuntimePath":local_path.to_string_lossy().into_owned()});
    let encoded=serde_json::to_vec_pretty(&out).map_err(|e|e.to_string())?;
    fs::write(root.join("managed-cuda-native-acceptance.json"),encoded)
        .map_err(|e|e.to_string())?;
    Ok(out)
}

#[cfg(windows)]
fn main() {
    let root=std::env::var("CLACK_CUDA_ACCEPTANCE_ROOT").expect("explicit owned case root");
    let root=fs::canonicalize(root).expect("acceptance root already exists");
    assert!(root.ends_with(Path::new("clack-cuda-b12248-upstream").join("acceptance-one")));
    let mut context=tauri::generate_context!();
    context.config_mut().identifier="app.clack.cuda.acceptance".into();
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(move |app| {
            WebviewWindowBuilder::new(app,"acceptance",WebviewUrl::App("index.html".into()))
                .title("Managed CUDA Native Acceptance").visible(false).build()?;
            let handle=app.handle().clone();
            std::thread::spawn(move || {
                let code=match native_case(handle.clone(),&root) {
                    Ok(value)=>{
                        println!("MANAGED_CUDA_NATIVE_ACCEPTANCE_PASS={value}");
                        0
                    },
                    Err(error)=>{
                        eprintln!("MANAGED_CUDA_NATIVE_ACCEPTANCE_FAILED={error}");
                        let _=fs::write(root.join("managed-cuda-native-error.txt"),error);
                        1
                    },
                };
                handle.exit(code);
            });
            Ok(())
        }).run(context).expect("Tauri native acceptance host run");
}

#[cfg(not(windows))]
fn main(){ eprintln!("CUDA acceptance example is only for real Windows NVIDIA hosts"); }
