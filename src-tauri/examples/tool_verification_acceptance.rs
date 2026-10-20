//! Isolated automated native verification with no tool execution commands.
use std::{
    collections::HashSet,
    io::Write,
    sync::{Arc, Mutex},
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use terax_lib::modules::{inference_probe, net, self_hosted_profiles};

#[tauri::command]
fn verification_exit(app: tauri::AppHandle) {
    app.exit(0);
}
fn main() {
    let root =
        std::fs::canonicalize(std::env::var("CLACK_TOOL_ACCEPTANCE_ROOT").expect("owned root"))
            .expect("owned root exists");
    assert!(root
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("tool-verification-"));
    let url: tauri::Url = std::env::var("CLACK_TOOL_ACCEPTANCE_URL")
        .expect("fixture URL")
        .parse()
        .unwrap();
    assert_eq!(url.scheme(), "http");
    assert_eq!(url.host_str(), Some("127.0.0.1"));
    assert_eq!(url.path(), "/tool-verification-acceptance.html");
    let allowed: Vec<String> =
        serde_json::from_slice(&std::fs::read(root.join("models.json")).unwrap()).unwrap();
    assert_eq!(allowed.len(), 4);
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = root.join("data").to_string_lossy().replace('\\', "/");
    context.config_mut().build.dev_url = Some(url.clone());
    let audit = root.join("requests.jsonl");
    let seen = Arc::new(Mutex::new(HashSet::new()));
    tauri::Builder::default().plugin(tauri_plugin_store::Builder::new().build())
        .manage(net::inference::InferenceState::default()).manage(inference_probe::ProbeState::default())
        .setup(move |app| {
            let data = app.path().app_data_dir()?; std::fs::create_dir_all(&data)?;
            assert!(std::fs::canonicalize(data)?.starts_with(&root));
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url)).visible(false).data_directory(root.join("webview")).build()?;
            Ok(())
        })
        .invoke_handler({
            let handler: Box<dyn Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync> = Box::new(tauri::generate_handler![
                verification_exit, self_hosted_profiles::self_hosted_profiles_snapshot, self_hosted_profiles::self_hosted_profiles_compare_and_swap,
                inference_probe::self_hosted_probe, inference_probe::self_hosted_probe_cache, inference_probe::self_hosted_probe_cancel,
                inference_probe::context::self_hosted_context_lease, inference_probe::context::self_hosted_context_runtime,
                net::inference::ai_http_open, net::inference::ai_http_preflight, net::inference::ai_http_stream, net::inference::ai_http_cancel,
            ]);
            move |invoke: tauri::ipc::Invoke<tauri::Wry>| {
                if invoke.message.command() == "ai_http_stream" {
                    let tauri::ipc::InvokeBody::Json(value) = invoke.message.payload() else { panic!("JSON required") };
                    assert_eq!(value["url"], "http://127.0.0.1:11435/api/chat");
                    let bytes: Vec<u8> = serde_json::from_value(value["body"].clone()).unwrap(); assert!(bytes.len() < 16384);
                    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                    let model = body["model"].as_str().unwrap(); assert!(allowed.iter().any(|m| m == model));
                    assert!(seen.lock().unwrap().insert(model.to_owned()), "only one probe per model");
                    assert_eq!(body["options"]["num_predict"], 512); assert!(body.get("think").is_none());
                    assert_eq!(body["tools"].as_array().unwrap().len(), 1);
                    assert_eq!(body["tools"][0]["function"]["name"], "get_probe_value");
                    assert_eq!(body["messages"].as_array().unwrap().len(), 1);
                    assert_eq!(body["messages"][0]["content"], "Call get_probe_value exactly once with key \"clack-probe-v1\" and count 1. Use the native tool interface. Do not answer in text or simulate a tool call.");
                    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(&audit).unwrap();
                    writeln!(file, "{}", serde_json::json!({"at":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis(),"requestId":value["requestId"],"body":body})).unwrap();
                }
                handler(invoke)
            }
        }).build(context).expect("native fixture start").run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) { app.state::<net::inference::InferenceState>().shutdown(); }
        });
}
