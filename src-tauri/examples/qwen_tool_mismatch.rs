//! Exact-body bounded diagnostic host with no tool execution commands.
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
fn diagnostic_exit(app: tauri::AppHandle) {
    app.exit(0);
}
fn main() {
    let root = std::fs::canonicalize(std::env::var("CLACK_MISMATCH_ROOT").unwrap()).unwrap();
    assert!(
        root.file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("qwen-tool-mismatch-")
            || root
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("automatic-agent-configuration-")
    );
    let expected: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.join("expected.json")).unwrap()).unwrap();
    let url: tauri::Url = std::env::var("CLACK_MISMATCH_URL")
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(url.scheme(), "http");
    assert_eq!(url.host_str(), Some("127.0.0.1"));
    assert_eq!(url.path(), "/qwen-tool-mismatch.html");
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = root.join("data").to_string_lossy().replace('\\', "/");
    context.config_mut().build.dev_url = Some(url.clone());
    let audit = root.join("requests.jsonl");
    let count = Arc::new(AtomicUsize::new(0));
    let model_counts = std::sync::Mutex::new(std::collections::HashMap::<String, usize>::new());
    tauri::Builder::default().plugin(tauri_plugin_store::Builder::new().build())
      .manage(net::inference::InferenceState::default()).manage(inference_probe::ProbeState::default())
      .setup(move |app| {
        let data = app.path().app_data_dir()?; std::fs::create_dir_all(&data)?; assert!(std::fs::canonicalize(data)?.starts_with(&root));
        WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url)).visible(false).data_directory(root.join("webview")).build()?;
        Ok(())
      }).invoke_handler({
        let handler: Box<dyn Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync> = Box::new(tauri::generate_handler![
          diagnostic_exit, self_hosted_profiles::self_hosted_profiles_snapshot, self_hosted_profiles::self_hosted_profiles_compare_and_swap,
          inference_probe::self_hosted_probe, inference_probe::self_hosted_probe_cache, inference_probe::self_hosted_probe_cancel,
          inference_probe::context::self_hosted_context_lease, inference_probe::context::self_hosted_context_runtime,
          net::inference::ai_http_open, net::inference::ai_http_preflight, net::inference::ai_http_stream, net::inference::ai_http_cancel,
        ]);
        move |invoke: tauri::ipc::Invoke<tauri::Wry>| {
          if invoke.message.command() == "ai_http_stream" {
            let tauri::ipc::InvokeBody::Json(value) = invoke.message.payload() else { panic!("JSON required") };
            assert_eq!(value["url"], "http://127.0.0.1:11435/api/chat");
            let bytes: Vec<u8> = serde_json::from_value(value["body"].clone()).unwrap(); assert!(bytes.len() <= 16384);
            let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            if let Some(bodies) = expected["bodies"].as_array() {
              assert!(bodies.contains(&body),"diagnostic changed an unapproved variable");
              assert!(count.fetch_add(1,Ordering::SeqCst)<4,"four-request acceptance bound");
              let model = body["model"].as_str().unwrap();
              let mut counts = model_counts.lock().unwrap();
              let seen = counts.entry(model.into()).or_default(); *seen += 1;
              assert!(*seen <= expected["limits"][model].as_u64().unwrap() as usize,"model request bound");
            } else {
              assert_eq!(body, expected, "diagnostic changed more than the approved variable");
              assert_eq!(count.fetch_add(1, Ordering::SeqCst), 0, "one diagnostic request only");
            }
            let mut file = std::fs::OpenOptions::new().create(true).append(true).open(&audit).unwrap();
            writeln!(file, "{}", serde_json::json!({"at":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis(),"requestId":value["requestId"],"body":body})).unwrap();
          }
          handler(invoke)
        }
      }).build(context).unwrap().run(|app,event| { if matches!(event,tauri::RunEvent::Exit) { app.state::<net::inference::InferenceState>().shutdown(); } });
}
