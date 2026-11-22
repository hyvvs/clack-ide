//! One-shot, no-inference native production-store provisioner using the SAME
//! Tauri command invoked by Clack Settings. Strictly a managed CUDA payload
//! install/verification operation; never changes conversation, model selection,
//! qualification receipts, sessions, LM6, settings, or Agent state.
#[cfg(windows)]
use std::{fs,path::{Path,PathBuf}};
#[cfg(windows)]
use serde_json::json;
#[cfg(windows)]
use sha2::{Sha256,Digest};
#[cfg(windows)]
use tauri::{Manager,WebviewUrl,WebviewWindowBuilder};
#[cfg(windows)]
use terax_lib::modules::managed_local_runtime as managed;

#[cfg(windows)]
fn hash_file(path:&Path)->Result<Option<String>,String> {
    if !path.exists() {return Ok(None);}
    let bytes=fs::read(path).map_err(|_|format!("Could not safely fingerprint {}",path.display()))?;
    Ok(Some(format!("{:x}",Sha256::digest(bytes))))
}

#[cfg(windows)]
fn provision(app:tauri::AppHandle,output:&Path)->Result<(),String> {
    let local=app.path().app_local_data_dir().map_err(|e|e.to_string())?;
    let config=app.path().app_config_dir().map_err(|e|e.to_string())?;
    if !local.to_string_lossy().ends_with("app.clack.dev") ||
       !config.to_string_lossy().ends_with("app.clack.dev") {
        return Err("Refusing provisioning outside the canonical production app ID".into());
    }
    let cpu=local.join("managed-local-runtime/engine/b12248/llama-server.exe");
    let cpu_before=hash_file(&cpu)?.ok_or("Cannot verify the existing pinned managed CPU runtime")?;
    if cpu_before!="106ad878b697cccdc601b83a483c9649489c7c7fd3043e08cf7e292039a9cd8a" {
        return Err("Existing managed CPU binary digest differs from authoritative b12248 pin".into());
    }
    let protected=[
        config.join("terax-settings.json"),
        config.join("terax-ai-sessions.json"),
        config.join("clack-ai-peer-tasks.json"),
    ];
    let before:Vec<_>=protected.iter().map(|p|hash_file(p)).collect::<Result<_,_>>()?;
    let engine=std::env::var("CLACK_CUDA_ENGINE_ZIP")
        .map_err(|_|"Official CUDA ZIP path missing")?;
    let dlls=std::env::var("CLACK_CUDA_DLL_ZIP")
        .map_err(|_|"Official CUDA DLL ZIP path missing")?;
    managed::managed_local_runtime_install_cuda_bundles(app.clone(),engine,dlls)?;
    let status=managed::managed_local_runtime_cuda_variant_status(app);
    if !status.installed {return Err(format!("Native CUDA variant failed pinned manifest verification: {:?}",status.error));}
    if hash_file(&cpu)?.as_deref()!=Some(cpu_before.as_str()) {
        return Err("Existing managed CPU binary was modified during CUDA provisioning".into());
    }
    let after:Vec<_>=protected.iter().map(|p|hash_file(p)).collect::<Result<_,_>>()?;
    if before != after {return Err("Protected production settings/session/history hashes changed during CUDA install".into());}
    let evidence=json!({
        "provisioned":true,"productionId":"app.clack.dev",
        "runtimeVariant":"b12248/cuda","installed":status.installed,
        "archiveSha256":status.engine_archive_sha256,
        "dependencySha256":status.dependency_archive_sha256,
        "executableSha256":status.executable_sha256,
        "cpuEngineSha256BeforeAfter":cpu_before,
        "productionSettingsSessionsLedgerUnchanged":true,
        "protectedStateHashes":before,
        "cudaInstallDirectory":local.join("managed-local-runtime/engine/b12248/cuda").to_string_lossy(),
        "modelRequests":0,"qualificationRuns":0,
    });
    fs::write(output.join("managed-cuda-production-install.json"),
        serde_json::to_vec_pretty(&evidence).map_err(|e|e.to_string())?)
        .map_err(|e|e.to_string())?;
    println!("MANAGED_CUDA_PRODUCTION_PROVISIONED={evidence}");
    Ok(())
}

#[cfg(windows)]
fn main() {
    let root=std::env::var("CLACK_CUDA_PRODUCTION_EVIDENCE_ROOT")
        .expect("Explicit owned production-install evidence directory required");
    let root=fs::canonicalize(root).expect("Production-install evidence root must exist");
    assert!(root.ends_with(PathBuf::from("clack-cuda-b12248-upstream/production-install")));
    let mut context=tauri::generate_context!();
    context.config_mut().identifier="app.clack.dev".into();
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(move |app| {
            WebviewWindowBuilder::new(app,"provision",WebviewUrl::App("index.html".into()))
                .title("Clack Managed CUDA Provisioning").visible(false).build()?;
            let handle=app.handle().clone();
            std::thread::spawn(move || {
                let code=match provision(handle.clone(),&root) {
                    Ok(())=>0,
                    Err(error)=>{
                        eprintln!("MANAGED_CUDA_PRODUCTION_PROVISION_FAILED={error}");
                        let _=fs::write(root.join("managed-cuda-production-error.txt"),error);
                        1
                    }
                };
                handle.exit(code);
            });
            Ok(())
        }).run(context).expect("Native managed CUDA production provisioner host");
}

#[cfg(not(windows))]
fn main(){eprintln!("Managed CUDA provisioning is only supported on verified Windows x64 NVIDIA hosts");}
