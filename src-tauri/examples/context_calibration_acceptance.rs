//! Isolated native production-path acceptance, no tools or user settings.
use std::{
    io::Write,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use terax_lib::modules::{inference_probe, net, self_hosted_profiles};

#[tauri::command]
fn calibration_exit(app: tauri::AppHandle) {
    app.exit(0);
}

fn main() {
    let root =
        std::fs::canonicalize(std::env::var("CLACK_CONTEXT_ACCEPTANCE_ROOT").expect("owned root"))
            .expect("owned root exists");
    assert!(root
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("context-calibration-"));
    let url: tauri::Url = std::env::var("CLACK_CONTEXT_ACCEPTANCE_URL")
        .expect("fixture URL")
        .parse()
        .expect("valid URL");
    assert_eq!(url.scheme(), "http");
    assert_eq!(url.host_str(), Some("127.0.0.1"));
    assert_eq!(url.path(), "/context-calibration-acceptance.html");
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = root.join("data").to_string_lossy().replace('\\', "/");
    context.config_mut().build.dev_url = Some(url.clone());
    let audit = root.join("requests.jsonl");
    let counter = Arc::new(AtomicUsize::new(0));
    tauri::Builder::default().plugin(tauri_plugin_store::Builder::new().build())
        .manage(net::inference::InferenceState::default()).manage(inference_probe::ProbeState::default())
        .setup(move |app| {
            let data = app.path().app_data_dir()?; std::fs::create_dir_all(&data)?;
            assert!(std::fs::canonicalize(data)?.starts_with(&root));
            WebviewWindowBuilder::new(app,"main",WebviewUrl::External(url)).visible(false).data_directory(root.join("webview")).build()?;
            Ok(())
        })
        .invoke_handler({
            let handler: Box<dyn Fn(tauri::ipc::Invoke<tauri::Wry>)->bool+Send+Sync> = Box::new(tauri::generate_handler![
                calibration_exit, self_hosted_profiles::self_hosted_profiles_snapshot, self_hosted_profiles::self_hosted_profiles_compare_and_swap,
                inference_probe::self_hosted_probe, inference_probe::self_hosted_probe_cache, inference_probe::self_hosted_probe_cancel,
                inference_probe::context::self_hosted_context_lease, inference_probe::context::self_hosted_context_runtime,
                net::inference::ai_http_open, net::inference::ai_http_preflight, net::inference::ai_http_stream, net::inference::ai_http_cancel,
            ]);
            move |invoke: tauri::ipc::Invoke<tauri::Wry>| {
                if invoke.message.command() == "ai_http_stream" {
                    let tauri::ipc::InvokeBody::Json(value) = invoke.message.payload() else { panic!("JSON request required") };
                    assert_eq!(value["url"],"http://127.0.0.1:11435/api/chat");
                    let bytes: Vec<u8> = serde_json::from_value(value["body"].clone()).expect("request bytes");
                    assert!(bytes.len() < 16384);
                    let body: serde_json::Value = serde_json::from_slice(&bytes).expect("request JSON");
                    assert!(matches!(body["model"].as_str(),Some("qwen3-coder:30b"|"nemotron-3.5-lightning:30b-a3b-q4_K_M")));
                    assert!(matches!(body["options"]["num_ctx"].as_u64(),Some(4096|8192|16384|32768|49152)));
                    assert_eq!(body["options"]["num_predict"],32);
                    assert!(body.get("think").is_none()); assert!(body["tools"].is_null() || body["tools"] == serde_json::json!([]));
                    assert_eq!(body["messages"].as_array().expect("messages").len(),1);
                    assert_eq!(body["messages"][0]["content"],"Reply with OK.");
                    assert!(counter.fetch_add(1,Ordering::SeqCst)<14);
                    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(&audit).expect("audit");
                    writeln!(file,"{}",serde_json::json!({"at":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis(),"requestId":value["requestId"],"body":body})).expect("audit persisted");
                }
                handler(invoke)
            }
        }).build(context).expect("native fixture start").run(|app,event| {
            if matches!(event,tauri::RunEvent::Exit) {app.state::<net::inference::InferenceState>().shutdown();}
        });
}
