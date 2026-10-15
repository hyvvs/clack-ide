//! Invisible native backend host for the composed acceptance fixture, not a product entry point.
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use terax_lib::modules::{
    attachments, conversation_memory as memory, fs, git, net, shell, workspace,
};

#[tauri::command]
fn coworking_exit(app: tauri::AppHandle) {
    app.exit(0);
}

fn main() {
    let root = std::env::var("CLACK_ACCEPTANCE_ROOT").expect("owned fixture root required");
    let root = std::fs::canonicalize(root).expect("fixture root must exist");
    let url: tauri::Url = std::env::var("CLACK_ACCEPTANCE_URL")
        .expect("fixture URL required")
        .parse()
        .expect("fixture URL must parse");
    assert_eq!(url.scheme(), "http");
    assert_eq!(url.host_str(), Some("127.0.0.1"));
    assert_eq!(url.path(), "/coworking-acceptance.html");
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    // Windows Known Folders ignore APPDATA overrides. An absolute test identifier
    // redirects all Tauri app-directory joins without changing production owners.
    context.config_mut().identifier = fs::to_canon(root.join("data"));
    context.config_mut().build.dev_url = Some(url.clone());
    let data = root.join("webview");
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(workspace::WorkspaceRegistry::default())
        .manage(memory::MemoryState::default())
        .manage(memory::project::freshness::FreshnessState::default())
        .manage(net::inference::InferenceState::default())
        .manage(terax_lib::modules::inference_probe::ProbeState::default())
        .manage(fs::grep::ContentSearchState::default())
        .manage(shell::ShellState::default())
        .setup(move |app| {
            let app_data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data)?;
            assert!(
                std::fs::canonicalize(&app_data)?.starts_with(&root),
                "acceptance data must be isolated"
            );
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .visible(false)
                .data_directory(data)
                .build()?;
            Ok(())
        })
        .invoke_handler({
            let handler: Box<dyn Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync> =
                Box::new(tauri::generate_handler![
                    coworking_exit,
                    shell::shell_session_open,
                    shell::shell_session_run,
                    shell::shell_session_close,
                    shell::shell_run_command,
                    shell::shell_bg_spawn,
                    shell::shell_bg_logs,
                    shell::shell_bg_kill,
                    shell::shell_bg_list,
                    workspace::workspace_authorize,
                    workspace::workspace_current_dir,
                    attachments::attachment_store_put,
                    attachments::attachment_store_get,
                    attachments::attachment_store_inspect,
                    attachments::attachment_store_reconcile,
                    memory::conversation_source_set,
                    memory::conversation_source_delete,
                    memory::conversation_session_entries,
                    memory::conversation_session_get,
                    memory::conversation_session_active,
                    memory::conversation_memory_sources,
                    memory::conversation_memory_extract_sources,
                    memory::conversation_memory_evidence,
                    memory::conversation_memory_load,
                    memory::conversation_memory_rebase,
                    memory::conversation_memory_commit,
                    memory::conversation_memory_cancel,
                    memory::retrieval::conversation_memory_retrieve,
                    memory::target_context::target_context_begin,
                    memory::target_context::target_context_cancel,
                    memory::target_context::target_context_preview,
                    memory::target_context::target_context_commit,
                    memory::target_context::target_context_load,
                    memory::reasoning_effort::conversation_effort_set,
                    memory::fallback::conversation_fallback_describe,
                    memory::fallback::conversation_fallback_set,
                    memory::fallback::conversation_fallback_begin,
                    memory::fallback::conversation_fallback_boundary,
                    memory::peer_ledger::peer_ledger_read,
                    memory::peer_ledger::peer_ledger_commit,
                    memory::project::project_memory_load,
                    memory::project::project_memory_propose,
                    memory::project::project_memory_decide,
                    memory::project::project_memory_inspect,
                    memory::project::freshness::project_memory_verify,
                    memory::project::freshness::project_memory_revalidate,
                    memory::project::freshness::retrieval::scoped_evidence_retrieve,
                    memory::custom_tools::custom_tools_load,
                    memory::custom_tools::custom_tools_validate,
                    memory::custom_tools::custom_tools_change,
                    memory::custom_tools::custom_tools_propose,
                    memory::custom_tools::functions::custom_tools_import_wasi,
                    memory::custom_tools::execution::custom_tool_prepare,
                    memory::custom_tools::execution::custom_tool_execute,
                    memory::custom_tools::execution::custom_tool_cancel,
                    memory::custom_tools::execution::custom_tool_history,
                    memory::custom_tools::mcp::mcp_connections_load,
                    memory::custom_tools::mcp::mcp_connection_change,
                    memory::custom_tools::mcp::mcp_connection_connect,
                    memory::custom_tools::mcp::mcp_connection_disconnect,
                    memory::custom_tools::mcp::mcp_connection_credential,
                    fs::file::fs_read_file,
                    fs::file::fs_read_attachment,
                    fs::file::fs_write_file,
                    fs::file::fs_canonicalize,
                    fs::file::fs_stat,
                    fs::mutate::fs_create_file,
                    fs::mutate::fs_create_dir,
                    fs::mutate::fs_rename,
                    fs::mutate::fs_delete,
                    fs::mutate::fs_copy,
                    fs::tree::fs_read_dir,
                    fs::grep::fs_grep,
                    fs::grep::fs_glob,
                    fs::search::fs_list_files,
                    fs::search::fs_search,
                    git::commands::git_resolve_repo,
                    git::commands::git_status,
                    git::commands::git_stage,
                    git::commands::git_commit,
                    git::commands::git_agent_worktree_create,
                    git::commands::git_agent_worktree_capture,
                    git::commands::git_agent_worktree_inspect,
                    git::commands::git_agent_worktree_remove,
                    git::commands::git_agent_worktree_cleanup,
                    git::commands::git_agent_patch_apply,
                    terax_lib::modules::self_hosted_profiles::self_hosted_profiles_compare_and_swap,
                    terax_lib::modules::self_hosted_profiles::self_hosted_profiles_snapshot,
                    terax_lib::modules::inference_probe::self_hosted_probe,
                    terax_lib::modules::inference_probe::self_hosted_probe_cache,
                    terax_lib::modules::inference_probe::self_hosted_probe_cancel,
                    net::ai_http_request,
                    net::inference::ai_http_open,
                    net::inference::ai_http_cancel,
                    net::inference::ai_http_preflight,
                    net::inference::ai_http_stream,
                ]);
            move |invoke: tauri::ipc::Invoke<tauri::Wry>| {
                if invoke.message.command() == "ai_http_stream" {
                    if let Ok(expected) = std::env::var("CLACK_ACCEPTANCE_OLLAMA_URL") {
                        let tauri::ipc::InvokeBody::Json(value) = invoke.message.payload() else {
                            panic!("acceptance inference payload must be JSON");
                        };
                        assert_eq!(
                            value["url"].as_str(),
                            Some(expected.as_str()),
                            "unexpected inference destination"
                        );
                        eprintln!("CLACK_ACCEPTANCE_INFERENCE {}", value["url"]);
                        if let Ok(phase) = std::env::var("CLACK_REAL_PRODUCT_PHASE") {
                            use std::io::Write;
                            assert!(phase.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'));
                            let bytes: Vec<u8> = serde_json::from_value(value["body"].clone())
                                .expect("serialized inference body required");
                            let body: serde_json::Value = serde_json::from_slice(&bytes).expect("JSON body required");
                            assert_eq!(body["model"], "qwen38-uncensored:latest");
                            assert_eq!(body["options"]["num_ctx"], 32768);
                            let directory = std::env::var("CLACK_ACCEPTANCE_ROOT").expect("owned root");
                            let mut file = std::fs::OpenOptions::new().create(true).append(true)
                                .open(std::path::Path::new(&directory).join(format!("{phase}.requests.jsonl")))
                                .expect("owned audit file");
                            let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).expect("clock").as_millis();
                            writeln!(file, "{}", serde_json::json!({"at": at, "requestId": value["requestId"], "url": value["url"], "body": body})).expect("persist request audit");
                            if phase.starts_with("offline") {
                                invoke.resolver.reject("Acceptance connection unavailable");
                                return true;
                            }
                        }
                    }
                }
                handler(invoke)
            }
        })
        .build(context)
        .expect("acceptance backend must start")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<net::inference::InferenceState>().shutdown();
            }
        });
}
