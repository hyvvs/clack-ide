//! R5k isolated acceptance host with production calibration lease/runtime commands: identical native Clack commands, redacted request
//! observation instead of a historical fixed 32K-context assertion.
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use terax_lib::modules::{
    attachments, conversation_memory as memory, fs, git, net, shell, workspace,
};

// Acceptance-only contract received from the current TypeScript production
// calibration/verification constants and native built-in tool definitions.
// No output ladder or model-family exception is duplicated in this host.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct AcceptanceWireContract {
    calibration: CalibrationWire,
    verification: VerificationWire,
    agent: AgentWire,
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct CalibrationWire {
    candidates: Vec<u64>,
    output: u64,
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct VerificationWire {
    outputs: Vec<u64>,
    name: String,
    parameters: serde_json::Value,
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentWire {
    output: u64,
    context: u64,
    #[serde(rename = "toolNames")]
    tool_names: Vec<String>,
}
fn schema_without_meta(value: &serde_json::Value) -> serde_json::Value {
    let mut schema = value.clone();
    if let Some(map) = schema.as_object_mut() {
        map.remove("$schema");
    }
    schema
}
fn acceptance_model_matches(body: &serde_json::Value, expected: &str) -> bool {
    body["model"] == expected
}
fn acceptance_wire_controls_match(
    body: &serde_json::Value,
    expected_think: &str,
    contract: &AcceptanceWireContract,
) -> bool {
    let think_matches = match expected_think {
        "low" => body["think"] == "low",
        "false" => body["think"] == false,
        "omitted" => body.get("think").is_none(),
        _ => false,
    };
    if body["stream"] != true
        || (body.get("tools").is_some() && !body["tools"].is_array())
    {
        return false;
    }
    let Some(output) = body["options"]["num_predict"].as_u64() else {
        return false;
    };
    let Some(context) = body["options"]["num_ctx"].as_u64() else {
        return false;
    };
    let tools = body["tools"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    if output == contract.calibration.output {
        return think_matches && tools.is_empty() && contract.calibration.candidates.contains(&context);
    }
    let valid_tools = tools.iter().all(|t| {
        t["type"] == "function"
            && t["function"]["name"].as_str().is_some()
            && t["function"]["description"]
                .as_str()
                .is_some_and(|d| !d.is_empty())
            && t["function"]["parameters"]["type"] == "object"
            && t["function"]["parameters"]["properties"].is_object()
    });
    if !valid_tools {
        return false;
    }
    let names: Vec<&str> = tools
        .iter()
        .filter_map(|t| t["function"]["name"].as_str())
        .collect();
    if names.len() != tools.len()
        || names
            .iter()
            .enumerate()
            .any(|(i, n)| names[..i].contains(n))
    {
        return false;
    }
    if names.contains(&contract.verification.name.as_str()) {
        // A saved Automatic choice omits `think` in normal inference, but
        // production may probe a separately verified boolean alternative.
        // Accept the exact native *verification* wire shape only; this does
        // not authorize a different reasoning control for Agent or calibration.
        let probe_think_matches = think_matches
            || (expected_think == "omitted" && body["think"].is_boolean());
        return probe_think_matches
            && tools.len() == 1
            // A model's verified runtime target may be below the previously
            // accepted ForgeBoard target. Production preflight is the owner
            // of actual context trust; the host checks its candidate range.
            && contract.calibration.candidates.contains(&context)
            && contract.verification.outputs.contains(&output)
            && schema_without_meta(&tools[0]["function"]["parameters"])
                == schema_without_meta(&contract.verification.parameters);
    }
    // The real production minimum-safe selector owns the precise Agent tier.
    // This acceptance guard only restricts it to freshly calibrated candidate
    // sizes and the unchanged output policy; never impose historical 65K.
    think_matches
        && contract.calibration.candidates.contains(&context)
        && context > output
        && output == contract.agent.output
        && names.iter().all(|name| {
            contract
                .agent
                .tool_names
                .iter()
                .any(|allowed| allowed == name)
        })
}

// Test-host compatibility with production's Automatic fallback: a genuinely
// verified Boolean tool variant is carried into the Agent even though the
// saved user preference remains Automatic. The host may only accept the same
// wire control after observing two matching *native verification requests*;
// production remains responsible for checking their responses, confirmation,
// freshness, and scopes before starting the Agent.
fn acceptance_confirmed_agent_variant_match(
    body: &serde_json::Value,
    expected_think: &str,
    contract: &AcceptanceWireContract,
    observed_variant: Option<bool>,
) -> bool {
    if expected_think != "omitted" || observed_variant.is_none()
        || body.get("think").and_then(serde_json::Value::as_bool) != observed_variant
        || body["options"]["num_predict"] != contract.agent.output
        || !body["options"]["num_ctx"].as_u64().is_some_and(|ctx|
            contract.calibration.candidates.contains(&ctx) && ctx > contract.agent.output)
        || !body["tools"].as_array().is_some_and(|tools| !tools.is_empty())
    {
        return false;
    }
    let mut without_variant = body.clone();
    without_variant.as_object_mut().expect("serialized object").remove("think");
    acceptance_wire_controls_match(&without_variant, expected_think, contract)
}

fn acceptance_host_wire_match(
    body: &serde_json::Value,
    expected_think: &str,
    contract: &AcceptanceWireContract,
    seen_probes: &mut std::collections::HashMap<bool, u8>,
) -> bool {
    if acceptance_wire_controls_match(body, expected_think, contract) {
        if body["options"]["num_ctx"].as_u64().is_some_and(|ctx|
            contract.calibration.candidates.contains(&ctx))
            && body["tools"].as_array().is_some_and(|tools| tools.len() == 1
                && tools[0]["function"]["name"] == contract.verification.name)
        {
            if let Some(variant) = body.get("think").and_then(serde_json::Value::as_bool) {
                let count = seen_probes.entry(variant).or_insert(0);
                *count = count.saturating_add(1);
            }
        }
        return true;
    }
    let observed = body.get("think").and_then(serde_json::Value::as_bool)
        .filter(|variant| seen_probes.get(variant).copied().unwrap_or(0) >= 2);
    acceptance_confirmed_agent_variant_match(body, expected_think, contract, observed)
}

#[cfg(test)]
mod acceptance_wire_tests {
    use super::{acceptance_confirmed_agent_variant_match, acceptance_host_wire_match, acceptance_model_matches, acceptance_wire_controls_match, AcceptanceWireContract};
    use serde_json::json;

    fn contract() -> AcceptanceWireContract {
        serde_json::from_value(json!({
            "calibration":{"candidates":[4096,8192,16384,32768,49152,65536],"output":32},
            "verification":{"outputs":[512,1024,2048],"name":"get_probe_value",
              "parameters":{"type":"object","properties":{"key":{"type":"string"},"count":{"type":"number"}}}},
            "agent":{"output":2048,"context":65536,"toolNames":["bash_run","read_file"]}
        })).unwrap()
    }
    fn probe(output: u64) -> serde_json::Value {
        json!({"stream":true,"options":{"num_ctx":65536,"num_predict":output},
            "tools":[{"type":"function","function":{"name":"get_probe_value","description":"Probe",
            "parameters":contract().verification.parameters}}]})
    }
    fn agent() -> serde_json::Value {
        json!({"stream":true,"options":{"num_ctx":65536,"num_predict":2048},
            "tools":[{"type":"function","function":{"name":"bash_run","description":"Shell",
            "parameters":{"type":"object","properties":{"command":{"type":"string"}}}}}]})
    }
    #[test]
    fn automatic_verified_boolean_agent_variant_does_not_fail_host_guard() {
        let mut request = agent();
        request["think"] = json!(false);
        assert!(!acceptance_wire_controls_match(&request, "omitted", &contract()));
        assert!(!acceptance_confirmed_agent_variant_match(&request, "omitted", &contract(), None));
        assert!(!acceptance_confirmed_agent_variant_match(&request, "omitted", &contract(), Some(true)));
        assert!(acceptance_confirmed_agent_variant_match(&request, "omitted", &contract(), Some(false)));
        request["options"]["num_ctx"] = json!(2048);
        assert!(!acceptance_confirmed_agent_variant_match(&request, "omitted", &contract(), Some(false)));
        request = agent();
        request["think"] = json!(false);
        request["tools"][0]["function"]["name"] = json!("not_a_builtin");
        assert!(!acceptance_confirmed_agent_variant_match(&request, "omitted", &contract(), Some(false)));
        request = agent();
        request["think"] = json!(false);
        assert!(!acceptance_confirmed_agent_variant_match(&request, "false", &contract(), Some(false)));
    }
    #[test]
    fn host_requires_two_matching_qualified_probe_requests_before_variant_agent() {
        let mut seen = std::collections::HashMap::new();
        let mut agent_request = agent();
        agent_request["think"] = json!(false);
        assert!(!acceptance_host_wire_match(&agent_request, "omitted", &contract(), &mut seen));
        let mut probe_request = probe(512);
        probe_request["think"] = json!(false);
        assert!(acceptance_host_wire_match(&probe_request, "omitted", &contract(), &mut seen));
        assert!(!acceptance_host_wire_match(&agent_request, "omitted", &contract(), &mut seen));
        // Another boolean but a different wire value cannot confirm the first.
        probe_request["think"] = json!(true);
        assert!(acceptance_host_wire_match(&probe_request, "omitted", &contract(), &mut seen));
        assert!(!acceptance_host_wire_match(&agent_request, "omitted", &contract(), &mut seen));
        probe_request["think"] = json!(false);
        assert!(acceptance_host_wire_match(&probe_request, "omitted", &contract(), &mut seen));
        assert!(acceptance_host_wire_match(&agent_request, "omitted", &contract(), &mut seen));
        agent_request["think"] = json!("low");
        assert!(!acceptance_host_wire_match(&agent_request, "omitted", &contract(), &mut seen));
        let default_agent = agent();
        assert!(acceptance_host_wire_match(&default_agent, "omitted", &contract(), &mut seen));
    }
    #[test]
    fn acceptance_observes_production_selected_smaller_agent_tier_without_forcing_65k() {
        let mut lower = agent();
        lower["options"]["num_ctx"] = json!(32768);
        assert!(acceptance_wire_controls_match(&lower, "omitted", &contract()));
        lower["options"]["num_ctx"] = json!(16384);
        assert!(acceptance_wire_controls_match(&lower, "omitted", &contract()));
        lower["options"]["num_ctx"] = json!(12345);
        assert!(!acceptance_wire_controls_match(&lower, "omitted", &contract()));
        lower["options"]["num_ctx"] = json!(2048);
        assert!(!acceptance_wire_controls_match(&lower, "omitted", &contract()));
    }
    #[test]
    fn accepts_all_production_calibration_and_verification_stages_and_agent() {
        for context in &contract().calibration.candidates {
            let body = json!({"stream":true,"options":{"num_ctx":context,"num_predict":32}});
            assert!(acceptance_wire_controls_match(
                &body,
                "omitted",
                &contract()
            ));
        }
        for output in &contract().verification.outputs {
            assert!(acceptance_wire_controls_match(
                &probe(*output),
                "omitted",
                &contract()
            ));
        }
        assert!(acceptance_wire_controls_match(
            &agent(),
            "omitted",
            &contract()
        ));
    }
    #[test]
    fn automatic_probe_alternatives_must_not_be_rejected_as_agent_overrides() {
        // Production Automatic may separately verify native-tool reasoning
        // variants after a text-only default. Those verification requests are
        // not user overrides and must retain their normal strict tool schema.
        for think in [true, false] {
            for output in contract().verification.outputs {
                let mut request = probe(output);
                request["think"] = json!(think);
                assert!(acceptance_wire_controls_match(&request, "omitted", &contract()));
            }
        }

        let mut request = agent();
        request["think"] = json!(true);
        assert!(!acceptance_wire_controls_match(&request, "omitted", &contract()));
        let mut request = json!({"stream":true,"options":{"num_ctx":4096,"num_predict":32}});
        request["think"] = json!(false);
        assert!(!acceptance_wire_controls_match(&request, "omitted", &contract()));

        let mut request = probe(512);
        request["think"] = json!("medium");
        assert!(!acceptance_wire_controls_match(&request, "omitted", &contract()));
        request["think"] = json!(true);
        request["tools"][0]["function"]["name"] = json!("different_tool");
        assert!(!acceptance_wire_controls_match(&request, "omitted", &contract()));
        request = probe(512);
        request["think"] = json!(true);
        request["options"]["num_ctx"] = json!(8192);
        assert!(acceptance_wire_controls_match(&request, "omitted", &contract()));
        request["options"]["num_ctx"] = json!(1234);
        assert!(!acceptance_wire_controls_match(&request, "omitted", &contract()));
        request = probe(512);
        request["think"] = json!(true);
        assert!(!acceptance_wire_controls_match(&request, "false", &contract()));
    }
    #[test]
    fn rejects_wrong_context_reasoning_and_unauthorized_tool_shapes() {
        let valid = json!({"stream":true,"options":{"num_ctx":4096,"num_predict":32}});
        assert!(!acceptance_wire_controls_match(&valid, "low", &contract()));
        let mut changed = valid.clone();
        changed["think"] = json!(true);
        assert!(!acceptance_wire_controls_match(
            &changed,
            "omitted",
            &contract()
        ));
        changed = valid.clone();
        changed["options"]["num_ctx"] = json!(1234);
        assert!(!acceptance_wire_controls_match(
            &changed,
            "omitted",
            &contract()
        ));
        changed = valid.clone();
        changed["options"]["num_predict"] = json!(1024);
        assert!(!acceptance_wire_controls_match(
            &changed,
            "omitted",
            &contract()
        ));
        changed = probe(1024);
        changed["options"]["num_ctx"] = json!(1234);
        assert!(!acceptance_wire_controls_match(
            &changed,
            "omitted",
            &contract()
        ));
        changed = probe(1024);
        changed["tools"][0]["function"]["name"] = json!("evil_probe");
        assert!(!acceptance_wire_controls_match(
            &changed,
            "omitted",
            &contract()
        ));
        changed = probe(1024);
        changed["tools"][0]["function"]["parameters"] =
            json!({"type":"object","properties":{"bad":{"type":"string"}}});
        assert!(!acceptance_wire_controls_match(
            &changed,
            "omitted",
            &contract()
        ));
        changed = probe(256);
        assert!(!acceptance_wire_controls_match(
            &changed,
            "omitted",
            &contract()
        ));
        changed = agent();
        changed["tools"][0]["function"]["name"] = json!("not_a_builtin");
        assert!(!acceptance_wire_controls_match(
            &changed,
            "omitted",
            &contract()
        ));
        changed = agent();
        changed["tools"][0]["type"] = json!("other");
        assert!(!acceptance_wire_controls_match(
            &changed,
            "omitted",
            &contract()
        ));
        changed = agent();
        changed["stream"] = json!(false);
        assert!(!acceptance_wire_controls_match(
            &changed,
            "omitted",
            &contract()
        ));
    }
    #[test]
    fn preserves_model_identity_and_explicit_reasoning_guards() {
        let wire = json!({"model":"allowed"});
        assert!(acceptance_model_matches(&wire, "allowed"));
        assert!(!acceptance_model_matches(&wire, "other-model"));
        let mut request = agent();
        request["think"] = json!("low");
        assert!(acceptance_wire_controls_match(&request, "low", &contract()));
        assert!(!acceptance_wire_controls_match(&request, "false", &contract()));
        request["think"] = json!(false);
        assert!(acceptance_wire_controls_match(&request, "false", &contract()));
        assert!(!acceptance_wire_controls_match(&request, "omitted", &contract()));
    }
}

#[tauri::command]
fn coworking_exit(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
async fn scoped_evidence_retrieve(
    app: tauri::AppHandle,
    request: memory::project::freshness::retrieval::Request,
) -> Result<memory::project::freshness::retrieval::Retrieved, String> {
    let started = std::time::Instant::now();
    let at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let captured = serde_json::to_value(&request).expect("request metadata");
    eprintln!(
        "CLACK_ACCEPTANCE_SCOPED_START {}",
        serde_json::json!({"at":at,"anchor":captured["anchor"],"files":captured["files"],"queryChars":captured["query"].as_str().map(str::len),"expected":captured["expected"],"taskIds":captured["taskIds"]})
    );
    let result =
        memory::project::freshness::retrieval::scoped_evidence_retrieve(app, request).await;
    let summary = match &result {
        Ok(value) => {
            let value = serde_json::to_value(value).expect("result metadata");
            serde_json::json!({"chunks":value["chunks"].as_array().map(Vec::len),"issues":value["issues"].as_array().map(Vec::len),"omitted":value["omitted"],"reads":value["reads"],"bytes":value["bytes"],"taskIds":value["taskIds"]})
        }
        Err(error) => serde_json::json!({"error":error}),
    };
    eprintln!(
        "CLACK_ACCEPTANCE_SCOPED_FINISH {}",
        serde_json::json!({"startedAt":at,"elapsedMs":started.elapsed().as_millis(),"result":summary})
    );
    result
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
    let builder = tauri::Builder::default();
    #[cfg(debug_assertions)]
    let builder = if std::env::var("CLACK_ACCEPTANCE_RECEIVE_TRACE").as_deref() == Ok("1") {
        use std::io::Write;
        let phase = std::env::var("CLACK_REAL_PRODUCT_PHASE").expect("diagnostic phase");
        assert!(
            phase.starts_with("stream-diagnostic-")
                || phase.starts_with("mission-a-")
                || phase.starts_with("qualification-")
                || phase.starts_with("system-preflight-")
        );
        assert!(phase
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-'));
        let destination = root.join(format!("{phase}.receive.jsonl"));
        let complete = move |snapshot: &net::inference::diagnostics::Snapshot| {
            let mut file = std::fs::OpenOptions::new()
                .create(true).append(true).open(&destination).expect("owned receive audit");
            writeln!(file, "{}", serde_json::to_string(snapshot).expect("receive metadata"))
                .expect("persist receive audit");
        };
        if phase == "stream-diagnostic-tier-02" {
            let events = root.join("stream-diagnostic-tier-02.native-events.jsonl");
            builder.manage(net::inference::diagnostics::AcceptanceDiagnostics::new_live(
                complete,
                move |snapshot| {
                    let Some(last) = snapshot.events.back() else { return };
                    let mut file = std::fs::OpenOptions::new()
                        .create(true).append(true).open(&events).expect("owned event audit");
                    writeln!(file, "{}", serde_json::json!({
                        "requestId": snapshot.request_id, "event":last,
                    })).expect("persist per-event receive audit");
                },
            ))
        } else {
            builder.manage(net::inference::diagnostics::AcceptanceDiagnostics::new(complete))
        }
    } else {
        builder
    };
    builder
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
            // Host-only compatibility observation. This does not grant a
            // production proof or alter Clack's Agent verifier in any way.
            let observed_probe_variants = std::sync::Mutex::new(std::collections::HashMap::<bool, u8>::new());
            let handler: Box<dyn Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync> =
                Box::new(tauri::generate_handler![
                    coworking_exit,
                    shell::shell_identity,
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
                    scoped_evidence_retrieve,
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
                    terax_lib::modules::inference_probe::context::self_hosted_context_lease,
                    terax_lib::modules::inference_probe::context::self_hosted_context_runtime,
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
                            let model = std::env::var("CLACK_ACCEPTANCE_MODEL")
                                .unwrap_or_else(|_| "qwen38-uncensored:latest".into());
                            assert_eq!(model, "ornith-1.5:35b", "Only Ornith is authorized");
                            assert!(acceptance_model_matches(&body, &model), "unexpected inference model");
                            // Observe real serialized context on all calibration and
                            // mission requests; NEVER assert or force a target here.
                            // Production requestPreflight is the fail-closed owner.
                            let directory = std::env::var("CLACK_ACCEPTANCE_ROOT").expect("owned root");
                            let mut file = std::fs::OpenOptions::new().create(true).append(true)
                                .open(std::path::Path::new(&directory).join(format!("{phase}.requests.jsonl")))
                                .expect("owned audit file");
                            let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).expect("clock").as_millis();
                            writeln!(file, "{}", serde_json::json!({
                                "at": at,
                                "requestId": value["requestId"],
                                "modelMatches": body["model"] == model,
                                "numCtx": body["options"]["num_ctx"],
                                "numPredict": body["options"]["num_predict"],
                                "thinkKind": if body["think"].is_boolean() {"boolean"} else if body["think"].is_null() {"absent"} else {"other"},
                                "stream": body["stream"],
                                "toolSchemas": body["tools"].as_array().map(|v|v.len()).unwrap_or(0),
                                // Acceptance-owned, names-only observation of the *actual*
                                // serialized native tool inventory; never store prompt,
                                // tool arguments, response text, headers, or credentials.
                                "toolNames": body["tools"].as_array().map(|tools|
                                    tools.iter().filter_map(|tool| tool["function"]["name"].as_str())
                                        .collect::<Vec<_>>()).unwrap_or_default()
                            })).expect("persist bounded redacted serialized request observation");
                            if let Ok(think) = std::env::var("CLACK_ACCEPTANCE_EXPECTED_THINK") {
                                assert!(matches!(think.as_str(), "low" | "false" | "omitted"));
                                let contract = std::env::var("CLACK_ACCEPTANCE_WIRE_CONTRACT")
                                    .ok().and_then(|s| serde_json::from_str::<AcceptanceWireContract>(&s).ok());
                                let mut seen = observed_probe_variants.lock().expect("host observation mutex");
                                let valid = contract.as_ref().is_some_and(|contract|
                                    acceptance_host_wire_match(&body, &think, contract, &mut seen));
                                if !valid {
                                    invoke.resolver.reject("Acceptance stopped: serialized reasoning/output controls changed");
                                    return true;
                                }
                            }
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
