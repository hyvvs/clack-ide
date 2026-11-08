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
    extraction: ExtractionWire,
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
struct ExtractionWire {
    #[serde(rename = "maxOutput")]
    max_output: u64,
    #[serde(rename = "maxSources")]
    max_sources: usize,
    #[serde(rename = "maxSourceBytes")]
    max_source_bytes: usize,
    #[serde(rename = "maxClaims")]
    max_claims: usize,
    #[serde(rename = "systemPrompt")]
    system_prompt: String,
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentWire {
    output: u64,
    context: u64,
    #[serde(rename = "toolNames")]
    tool_names: Vec<String>,
    #[serde(rename = "continuationOutputs")]
    continuation_outputs: Vec<ContextOutput>,
    #[serde(rename = "continuationMarker")]
    continuation_marker: String,
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct ContextOutput {
    context: u64,
    output: u64,
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
fn acceptance_destination_matches(actual: Option<&str>, expected: &str) -> bool {
    actual == Some(expected)
}
fn acceptance_exact_output(body: &serde_json::Value, contract: &AcceptanceWireContract) -> Option<u64> {
    let context = body["options"]["num_ctx"].as_u64()?;
    let system = body["messages"].as_array()?.first()?;
    if system["role"] != "system" { return None; }
    let content = system["content"].as_str()?;
    let marker = contract.agent.continuation_marker.as_str();
    // This suffix is inserted by production runAgentStream *only* for the next
    // logical batch. Reject an empty/malformed marker rather than treating any
    // prompt as a continuation. No prompt text is logged or persisted here.
    if marker.len() < 32 || !marker.starts_with("\n\nThis generation continues the same logical run") {
        return None;
    }
    // Ollama's serializer joins multiple production system messages with
    // exactly two newlines. A compacted memory system message may follow the
    // first (Agent) system message, so the marker need not end the joined text.
    let offsets: Vec<usize> = content.match_indices(marker).map(|(at, _)| at).collect();
    let continuation = match offsets.as_slice() {
        [] => false,
        [at] => {
            let suffix = &content[at + marker.len()..];
            if !suffix.is_empty() && !suffix.starts_with("\n\n") { return None; }
            true
        }
        _ => return None,
    };
    if continuation {
        let matches = contract.agent.continuation_outputs.iter()
            .filter(|entry| entry.context == context && entry.output > 0);
        let outputs: Vec<u64> = matches.map(|entry| entry.output).collect();
        if outputs.len() == 1 { Some(outputs[0]) } else { None }
    } else {
        (contract.agent.context >= context && contract.agent.output > 0)
            .then_some(contract.agent.output)
    }
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
    let Some(stream) = body.get("stream").and_then(serde_json::Value::as_bool) else {
        return false;
    };
    if !body.as_object().is_some_and(|map| map.keys().all(|key|
            matches!(key.as_str(), "model" | "messages" | "stream" | "options" | "tools" | "think")))
        || !body["options"].as_object().is_some_and(|map|
            map.len() == 2 && map.contains_key("num_ctx") && map.contains_key("num_predict"))
        || !body["messages"].as_array().is_some_and(|messages| !messages.is_empty())
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
    // Production compaction extraction uses AI SDK generateText -> Ollama
    // doGenerate -> stream=false. Permit only that exact tool-free prompt shape;
    // the host observes and forwards the caller's mode without rewriting it.
    if !stream {
        return think_matches
            && acceptance_compaction_extraction_match(body, context, output, contract);
    }
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
    // Initial steps may use the 8192 upper-tier policy even if minimum-safe
    // selects 32768 or 49152 for their serialized runtime context. A logical
    // continuation *reselects* a pinned proof tier, and production then calls
    // resolveAgentOutputBudget against that tier. The runner obtains these
    // exact per-tier outputs by importing the real production helper, rather
    // than duplicating 1/8 arithmetic or allowing arbitrary values <= 8192.
    think_matches
        && contract.calibration.candidates.contains(&context)
        && context > output
        && !names.is_empty()
        && acceptance_exact_output(body, contract) == Some(output)
        && names.iter().all(|name| {
            contract
                .agent
                .tool_names
                .iter()
                .any(|allowed| allowed == name)
        })
}

fn acceptance_compaction_extraction_match(
    body: &serde_json::Value,
    context: u64,
    output: u64,
    contract: &AcceptanceWireContract,
) -> bool {
    if output == 0
        || output > contract.extraction.max_output
        || context <= output
        || !contract.calibration.candidates.contains(&context)
        || body.get("tools").is_some_and(|tools| !tools.as_array().is_some_and(Vec::is_empty))
    {
        return false;
    }
    let Some(messages) = body["messages"].as_array() else { return false };
    if messages.len() != 2
        || !messages[0].as_object().is_some_and(|message| message.len() == 2
            && message.get("role").and_then(serde_json::Value::as_str) == Some("system")
            && message.get("content").and_then(serde_json::Value::as_str) == Some(contract.extraction.system_prompt.as_str()))
        || !messages[1].as_object().is_some_and(|message| message.len() == 2
            && message.get("role").and_then(serde_json::Value::as_str) == Some("user")
            && message.get("content").is_some_and(serde_json::Value::is_string))
    {
        return false;
    }
    let Some(content) = messages[1]["content"].as_str() else { return false };
    let Ok(payload) = serde_json::from_str::<serde_json::Value>(content) else { return false };
    let Some(object) = payload.as_object() else { return false };
    if object.len() != 2 || !object.contains_key("existingClaims") || !object.contains_key("sources") {
        return false;
    }
    let Some(claims) = payload["existingClaims"].as_array() else { return false };
    let Some(sources) = payload["sources"].as_array() else { return false };
    let Ok(source_bytes) = serde_json::to_vec(&payload["sources"]) else { return false };
    if claims.len() > contract.extraction.max_claims
        || sources.is_empty()
        || sources.len() > contract.extraction.max_sources
        || source_bytes.len() > contract.extraction.max_source_bytes
    { return false; }
    let digest = |value: &serde_json::Value| value.as_str().is_some_and(|value|
        value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()));
    let mut claim_ids = std::collections::HashSet::new();
    if !claims.iter().all(|claim| {
        let Some(claim) = claim.as_object() else { return false };
        if claim.len() != 4 || !claim.contains_key("id") || !claim.contains_key("section")
            || !claim.contains_key("status") || !claim.contains_key("text")
        { return false; }
        let section = claim["section"].as_str();
        let status = claim["status"].as_str();
        digest(&claim["id"])
            && section.is_some_and(|value| matches!(value,
                "objective" | "requirements" | "constraints" | "decisions" | "completed-work"
                | "active-tasks" | "files-and-artifacts" | "unresolved-issues" | "errors"
                | "agent-findings" | "project-state" | "uncertainty"))
            && status.is_some_and(|value| matches!(value,
                "user-requirement" | "verified-observation" | "inference" | "unresolved" | "superseded" | "stale"))
            && claim["text"].as_str().is_some_and(|value| !value.trim().is_empty())
            && claim_ids.insert(claim["id"].as_str().unwrap().to_string())
    }) { return false; }
    let mut source_ids = std::collections::HashSet::new();
    sources.iter().all(|source| {
        let Some(source) = source.as_object() else { return false };
        if source.len() != 4
            || !source.contains_key("id")
            || !source.contains_key("digest")
            || !source.contains_key("role")
            || !source.contains_key("passages")
        { return false; }
        let passages = source["passages"].as_array();
        digest(&source["id"]) && digest(&source["digest"])
            && source_ids.insert(source["id"].as_str().unwrap().to_string())
            && matches!(source["role"].as_str(), Some("assistant" | "tool"))
            && passages.is_some_and(|passages| !passages.is_empty()
                && passages.iter().all(|passage| passage.as_str().is_some_and(|text| !text.trim().is_empty())))
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
        || !body["options"]["num_predict"].as_u64().is_some_and(|output|
            acceptance_exact_output(body, contract) == Some(output))
        || !body["options"]["num_ctx"].as_u64().is_some_and(|ctx|
            contract.calibration.candidates.contains(&ctx) &&
                ctx > body["options"]["num_predict"].as_u64().unwrap_or(u64::MAX))
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
    use super::{acceptance_confirmed_agent_variant_match, acceptance_destination_matches, acceptance_host_wire_match, acceptance_model_matches, acceptance_wire_controls_match, AcceptanceWireContract};
    use serde_json::json;

    fn contract() -> AcceptanceWireContract {
        serde_json::from_value(json!({
            "calibration":{"candidates":[4096,8192,16384,32768,49152,65536,73728],"output":32},
            "verification":{"outputs":[512,1024,2048],"name":"get_probe_value",
              "parameters":{"type":"object","properties":{"key":{"type":"string"},"count":{"type":"number"}}}},
            "extraction":{"maxOutput":1024,"maxSources":128,"maxSourceBytes":262144,"maxClaims":64,
              "systemPrompt":"Extract conversation evidence as JSON only."},
            "agent":{"output":8192,"context":73728,"toolNames":["bash_run","read_file"],
              "continuationOutputs":[
                {"context":4096,"output":2048},{"context":8192,"output":2048},
                {"context":16384,"output":2048},{"context":32768,"output":4096},
                {"context":49152,"output":6144},{"context":65536,"output":8192},
                {"context":73728,"output":8192}],
              "continuationMarker":"\n\nThis generation continues the same logical run after an internal step batch. Continue from the existing plan and tool results without recapping or restarting the task."}
        })).unwrap()
    }
    fn probe(output: u64) -> serde_json::Value {
        json!({"stream":true,"messages":[{"role":"user","content":"Tool verification"}],"options":{"num_ctx":65536,"num_predict":output},
            "tools":[{"type":"function","function":{"name":"get_probe_value","description":"Probe",
            "parameters":contract().verification.parameters}}]})
    }
    fn agent() -> serde_json::Value {
        json!({"stream":true,"messages":[{"role":"system","content":"Original instructions"}],"options":{"num_ctx":65536,"num_predict":8192},
            "tools":[{"type":"function","function":{"name":"bash_run","description":"Shell",
            "parameters":{"type":"object","properties":{"command":{"type":"string"}}}}}]})
    }
    fn extraction() -> serde_json::Value {
        json!({"model":"muse-glimmer:30b","stream":false,
            "messages":[
                {"role":"system","content":"Extract conversation evidence as JSON only."},
                {"role":"user","content":json!({"existingClaims":[],"sources":[{
                    "id":"a".repeat(64),"digest":"b".repeat(64),"role":"assistant",
                    "passages":["A completed historical Agent step."]
                }] }).to_string()}
            ],"options":{"num_ctx":49152,"num_predict":1024}})
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
            let body = json!({"stream":true,"messages":[{"role":"user","content":"Calibrate"}],"options":{"num_ctx":context,"num_predict":32}});
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
    fn accepts_exact_non_streaming_compaction_extraction_and_preserves_the_wire_body() {
        let body = extraction();
        let original = body.clone();
        let mut seen = std::collections::HashMap::new();
        assert!(acceptance_model_matches(&body, "muse-glimmer:30b"));
        assert!(acceptance_host_wire_match(&body, "omitted", &contract(), &mut seen));
        assert!(seen.is_empty(), "extraction cannot mint native-tool verification evidence");
        assert_eq!(body, original, "the acceptance host must observe, never rewrite, stream=false");
        assert_eq!(body["stream"], false);
        assert_eq!(body["options"]["num_ctx"], 49152);
        assert_eq!(body["options"]["num_predict"], 1024);
    }

    #[test]
    fn non_streaming_acceptance_is_narrow_and_malformed_or_untrusted_requests_still_fail() {
        let valid = extraction();
        let mut malformed = valid.clone();
        malformed["stream"] = json!("false");
        assert!(!acceptance_wire_controls_match(&malformed, "omitted", &contract()));
        malformed = valid.clone();
        malformed["messages"][0]["content"] = json!("unrecognized non-streaming prompt");
        assert!(!acceptance_wire_controls_match(&malformed, "omitted", &contract()));
        malformed = valid.clone();
        malformed["messages"][1]["content"] = json!("{bad-json");
        assert!(!acceptance_wire_controls_match(&malformed, "omitted", &contract()));
        malformed = valid.clone();
        malformed["options"]["num_predict"] = json!(2048);
        assert!(!acceptance_wire_controls_match(&malformed, "omitted", &contract()));
        malformed = valid.clone();
        malformed["options"]["num_ctx"] = json!(12345);
        assert!(!acceptance_wire_controls_match(&malformed, "omitted", &contract()));
        malformed = valid.clone();
        malformed["tools"] = json!([{"type":"function","function":{"name":"bash_run","description":"shell","parameters":{"type":"object","properties":{}}}}]);
        assert!(!acceptance_wire_controls_match(&malformed, "omitted", &contract()));
        // `maxChunks` is the number of extraction calls, not the number of
        // source records in one request. Production permits up to maxEvidence.
        let mut five_sources = valid.clone();
        let mut payload: serde_json::Value = serde_json::from_str(five_sources["messages"][1]["content"].as_str().unwrap()).unwrap();
        for index in 2..=5 {
            payload["sources"].as_array_mut().unwrap().push(json!({
                "id":format!("{:064x}", index), "digest":format!("{:064x}", index + 100),
                "role":"assistant", "passages":[format!("Historical step {index}")]
            }));
        }
        five_sources["messages"][1]["content"] = json!(payload.to_string());
        assert!(acceptance_wire_controls_match(&five_sources, "omitted", &contract()));
        let mut too_many_sources = five_sources.clone();
        let mut payload: serde_json::Value = serde_json::from_str(too_many_sources["messages"][1]["content"].as_str().unwrap()).unwrap();
        for index in 6..=129 {
            payload["sources"].as_array_mut().unwrap().push(json!({
                "id":format!("{:064x}", index), "digest":format!("{:064x}", index + 100),
                "role":"assistant", "passages":[format!("Historical step {index}")]
            }));
        }
        too_many_sources["messages"][1]["content"] = json!(payload.to_string());
        assert!(!acceptance_wire_controls_match(&too_many_sources, "omitted", &contract()));
        let mut oversized_sources = valid.clone();
        let mut payload: serde_json::Value = serde_json::from_str(oversized_sources["messages"][1]["content"].as_str().unwrap()).unwrap();
        payload["sources"][0]["passages"][0] = json!("x".repeat(262144));
        oversized_sources["messages"][1]["content"] = json!(payload.to_string());
        assert!(!acceptance_wire_controls_match(&oversized_sources, "omitted", &contract()));
        let mut too_many_claims = valid.clone();
        let mut payload: serde_json::Value = serde_json::from_str(too_many_claims["messages"][1]["content"].as_str().unwrap()).unwrap();
        payload["existingClaims"] = json!(vec![json!({}); 65]);
        too_many_claims["messages"][1]["content"] = json!(payload.to_string());
        assert!(!acceptance_wire_controls_match(&too_many_claims, "omitted", &contract()));
        let mut malformed_claim = valid.clone();
        let mut payload: serde_json::Value = serde_json::from_str(malformed_claim["messages"][1]["content"].as_str().unwrap()).unwrap();
        payload["existingClaims"] = json!([{"id":"c".repeat(64),"section":"requirements",
            "status":"user-requirement","text":"Keep the original requirement."}]);
        malformed_claim["messages"][1]["content"] = json!(payload.to_string());
        assert!(acceptance_wire_controls_match(&malformed_claim, "omitted", &contract()));
        let mut duplicate_claim = malformed_claim.clone();
        let mut payload: serde_json::Value = serde_json::from_str(duplicate_claim["messages"][1]["content"].as_str().unwrap()).unwrap();
        let duplicate = payload["existingClaims"][0].clone();
        payload["existingClaims"].as_array_mut().unwrap().push(duplicate);
        duplicate_claim["messages"][1]["content"] = json!(payload.to_string());
        assert!(!acceptance_wire_controls_match(&duplicate_claim, "omitted", &contract()));
        let mut duplicate_source = valid.clone();
        let mut payload: serde_json::Value = serde_json::from_str(duplicate_source["messages"][1]["content"].as_str().unwrap()).unwrap();
        let first_source = payload["sources"][0].clone();
        payload["sources"].as_array_mut().unwrap().push(first_source);
        duplicate_source["messages"][1]["content"] = json!(payload.to_string());
        assert!(!acceptance_wire_controls_match(&duplicate_source, "omitted", &contract()));
        let mut whitespace_source = valid.clone();
        let mut payload: serde_json::Value = serde_json::from_str(whitespace_source["messages"][1]["content"].as_str().unwrap()).unwrap();
        payload["sources"][0]["passages"][0] = json!("  \n  ");
        whitespace_source["messages"][1]["content"] = json!(payload.to_string());
        assert!(!acceptance_wire_controls_match(&whitespace_source, "omitted", &contract()));
        malformed = valid.clone();
        malformed["model"] = json!("other-model");
        assert!(!acceptance_model_matches(&malformed, "muse-glimmer:30b"));
        assert!(!acceptance_destination_matches(Some("https://hosted.example/api/chat"), "http://127.0.0.1:11435/api/chat"));
        assert!(!acceptance_destination_matches(None, "http://127.0.0.1:11435/api/chat"));
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
        let mut request = json!({"stream":true,"messages":[{"role":"user","content":"Calibrate"}],"options":{"num_ctx":4096,"num_predict":32}});
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
        let valid = json!({"stream":true,"messages":[{"role":"user","content":"Calibrate"}],"options":{"num_ctx":4096,"num_predict":32}});
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
        assert!(!acceptance_wire_controls_match(&changed, "omitted", &contract()));
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

    fn continuation(context: u64, output: u64) -> serde_json::Value {
        let mut body = agent();
        body["options"]["num_ctx"] = json!(context);
        body["options"]["num_predict"] = json!(output);
        let suffix = contract().agent.continuation_marker;
        body["messages"][0]["content"] = json!(format!("Original instructions{suffix}"));
        body
    }

    #[test]
    fn exact_production_continuation_policy_rejects_wrong_output_in_every_tier() {
        for (context, output) in [(32768,4096),(49152,6144),(65536,8192),(73728,8192)] {
            let body = continuation(context, output);
            assert!(acceptance_wire_controls_match(&body, "omitted", &contract()), "tier {context}");
            for incorrect in [output - 1, output + 1, 2048, 16384] {
                if incorrect != output {
                    let mut mutant = body.clone();
                    mutant["options"]["num_predict"] = json!(incorrect);
                    assert!(!acceptance_wire_controls_match(&mutant, "omitted", &contract()),
                        "accepted {context}/{incorrect} instead of {output}");
                }
            }
        }
        assert!(!acceptance_wire_controls_match(&continuation(49152,8192), "omitted", &contract()));
    }

    #[test]
    fn initial_batch_keeps_original_upper_tier_allowance_after_minimum_safe_selection() {
        let mut body = agent();
        for context in [32768,49152,65536,73728] {
            body["options"]["num_ctx"] = json!(context);
            assert!(acceptance_wire_controls_match(&body, "omitted", &contract()));
        }
        // The first batch may dispatch 32768/8192. The next logical batch's
        // same serialized context would require a separately computed 4096.
        assert!(!acceptance_wire_controls_match(&continuation(32768,8192), "omitted", &contract()));
    }

    #[test]
    fn observed_muse_inference_35_shape_uses_exact_same_host_dispatch_guard() {
        // Redacted mission-a-1.requests.jsonl, inference-35: 49152/6144,
        // omitted think and these 14 *native* tool names. Only schema shapes
        // are constructed here; no original prompt, arguments or API call.
        let names = ["read_file","list_directory","write_file","create_directory",
            "grep","glob","bash_run","run_subagent","get_terminal_output",
            "open_preview","todo_write","promote_peer_finding","request_peer_task",
            "propose_custom_tool"];
        let mut contract = contract();
        contract.agent.tool_names = names.iter().chain(["bash_background","bash_logs","bash_list","bash_kill"].iter())
            .map(|name| (*name).to_string()).collect();
        let mut body = continuation(49152,6144);
        body["model"] = json!("muse-glimmer:30b");
        body["tools"] = json!(names.iter().map(|name| json!({"type":"function","function":{
            "name":name,"description":"Allowed native tool","parameters":{"type":"object","properties":{}}
        }})).collect::<Vec<_>>());
        let mut seen = std::collections::HashMap::new();
        assert!(acceptance_model_matches(&body, "muse-glimmer:30b"));
        assert!(acceptance_host_wire_match(&body, "omitted", &contract, &mut seen));
        assert!(seen.is_empty(), "Agent continuation must not mint verifier evidence");
        let mut output_mutation = body.clone();
        output_mutation["options"]["num_predict"] = json!(8192);
        assert!(!acceptance_host_wire_match(&output_mutation, "omitted", &contract, &mut seen));
        let mut unknown_tool = body.clone();
        unknown_tool["tools"][0]["function"]["name"] = json!("rogue_tool");
        assert!(!acceptance_host_wire_match(&unknown_tool, "omitted", &contract, &mut seen));
        let mut duplicate_tool = body.clone();
        duplicate_tool["tools"][1]["function"]["name"] = json!("read_file");
        assert!(!acceptance_host_wire_match(&duplicate_tool, "omitted", &contract, &mut seen));
    }

    #[test]
    fn continuation_mutations_fail_closed_without_weakening_tool_proof_or_reasoning() {
        let mut valid = continuation(49152,6144);
        assert!(acceptance_wire_controls_match(&valid, "omitted", &contract()));
        for context in [0,49153,12345,131072] {
            let mut mutant = valid.clone();
            mutant["options"]["num_ctx"] = json!(context);
            assert!(!acceptance_wire_controls_match(&mutant, "omitted", &contract()));
        }
        for think in [json!(false),json!(true),json!("low")] {
            let mut mutant = valid.clone();
            mutant["think"] = think;
            assert!(!acceptance_host_wire_match(&mutant, "omitted", &contract(), &mut Default::default()));
        }
        // There is no matching genuine probe history to permit a Boolean mode.
        valid["think"] = json!(false);
        assert!(!acceptance_confirmed_agent_variant_match(&valid, "omitted", &contract(), None));
        let mut valid = continuation(49152,6144);
        for field in ["temperature","top_p","seed","num_thread"] {
            valid["options"][field] = json!(1);
            assert!(!acceptance_wire_controls_match(&valid, "omitted", &contract()));
            valid["options"].as_object_mut().unwrap().remove(field);
        }
        for field in ["provider","digest","format","sampling_override"] {
            valid[field] = json!("unexpected");
            assert!(!acceptance_wire_controls_match(&valid, "omitted", &contract()));
            valid.as_object_mut().unwrap().remove(field);
        }
        valid["messages"][0]["content"] = json!("bad prompt");
        valid["options"]["num_predict"] = json!(8192);
        // In an original batch this output is legitimate, but a marker in an
        // unexpected position may not impersonate a continuation.
        let marker = contract().agent.continuation_marker;
        valid["messages"][0]["content"] = json!(format!("Instructions{marker}\nextra suffix"));
        assert!(!acceptance_wire_controls_match(&valid, "omitted", &contract()));
        let mut wrong_model = continuation(49152,6144);
        wrong_model["model"] = json!("other-digest:latest");
        assert!(!acceptance_model_matches(&wrong_model, "muse-glimmer:30b"));
    }

    #[test]
    fn missing_or_ambiguous_tier_policy_is_rejected_without_fallback() {
        let mut contract = contract();
        let body = continuation(49152,6144);
        contract.agent.continuation_outputs.retain(|entry| entry.context != 49152);
        assert!(!acceptance_wire_controls_match(&body, "omitted", &contract));
        contract.agent.continuation_outputs.push(super::ContextOutput {context:49152,output:6144});
        contract.agent.continuation_outputs.push(super::ContextOutput {context:49152,output:6144});
        assert!(!acceptance_wire_controls_match(&body, "omitted", &contract));
        contract.agent.continuation_outputs.pop();
        contract.agent.continuation_marker.clear();
        assert!(!acceptance_wire_controls_match(&body, "omitted", &contract));
    }

    #[test]
    fn compaction_system_message_after_logical_suffix_keeps_same_exact_budget_guard() {
        let mut body = continuation(49152,6144);
        let marker = contract().agent.continuation_marker;
        body["messages"][0]["content"] = json!(format!("Original instructions{marker}\n\nCompacted memory context"));
        assert!(acceptance_host_wire_match(&body, "omitted", &contract(), &mut Default::default()));
        body["options"]["num_predict"] = json!(8192);
        assert!(!acceptance_host_wire_match(&body, "omitted", &contract(), &mut Default::default()));
        body["options"]["num_predict"] = json!(6144);
        body["messages"][0]["content"] = json!(format!("Original instructions{marker}\n\nHistory{marker}"));
        assert!(!acceptance_host_wire_match(&body, "omitted", &contract(), &mut Default::default()));
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
        // Debug acceptance-host-only live tap: every body and semantic event
        // survives the bounded terminal snapshot ring, without body content.
        if phase == "mission-a-1" {
            let events = root.join("mission-a-1.native-events.jsonl");
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
                // Passive acceptance-only provenance: these are genuine Tauri
                // IPC calls, observed before their original handlers run.
                // Never inspect private payloads or alter handler outcomes.
                let command = invoke.message.command();
                if matches!(command, "self_hosted_context_runtime" | "self_hosted_probe" | "self_hosted_probe_cache") {
                    if let (Ok(dir), Ok(phase)) = (std::env::var("CLACK_ACCEPTANCE_ROOT"), std::env::var("CLACK_REAL_PRODUCT_PHASE")) {
                        if phase == "mission-a-1" {
                            use std::io::Write;
                            if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true)
                                .open(std::path::Path::new(&dir).join("mission-a-1.native-inspection.jsonl")) {
                                let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
                                    .map(|duration| duration.as_millis()).unwrap_or(0);
                                let _ = writeln!(file, "{}", serde_json::json!({"at":at,"command":command}));
                            }
                        }
                    }
                }
                if command == "ai_http_cancel" {
                    // First-cause IPC evidence, passive and metadata-only. The
                    // production Rust inference registry remains the owner.
                    if let (Ok(dir), tauri::ipc::InvokeBody::Json(value)) =
                        (std::env::var("CLACK_ACCEPTANCE_ROOT"), invoke.message.payload()) {
                        use std::io::Write;
                        if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true)
                            .open(std::path::Path::new(&dir).join("mission-a-1.native-cancels.jsonl")) {
                            let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
                                .map(|d| d.as_millis()).unwrap_or(0);
                            let request_id = value["requestId"].as_str().filter(|id|
                                id.len() < 32 && id.starts_with("inference-")).unwrap_or("invalid");
                            let origin = value["cancellationOrigin"].as_str().filter(|origin|
                                matches!(*origin, "stream-consumer" | "sdk-stream-error" | "provider-retry-error" |
                                    "provider-retry-finalizer" | "settled-cleanup" | "parent-signal" |
                                    "session-stop" | "scope-superseded" | "preflight-failure" |
                                    "response-construction-failure" | "native-command-failure" |
                                    "fetch-preparation-failure")).unwrap_or("unspecified");
                            let _ = writeln!(file,"{}",serde_json::json!({"at":at,"requestId":request_id,"origin":origin}));
                        }
                    }
                }
                if invoke.message.command() == "ai_http_stream" {
                    if let Ok(expected) = std::env::var("CLACK_ACCEPTANCE_OLLAMA_URL") {
                        let tauri::ipc::InvokeBody::Json(value) = invoke.message.payload() else {
                            panic!("acceptance inference payload must be JSON");
                        };
                        assert!(
                            acceptance_destination_matches(value["url"].as_str(), &expected),
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
                            assert_eq!(model, "muse-glimmer:30b", "Only Muse is authorized");
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
                                "agentBatch": if body["tools"].as_array().is_some_and(|tools| !tools.is_empty()) &&
                                    !body["tools"].as_array().is_some_and(|tools| tools.len() == 1 &&
                                        tools[0]["function"]["name"] == "get_probe_value") {
                                    let system = body["messages"].as_array().and_then(|messages| messages.first())
                                        .and_then(|first| first["content"].as_str()).unwrap_or("");
                                    if system.contains("This generation continues the same logical run after an internal step batch")
                                        {"logical-continuation"} else {"initial-batch"}
                                } else {"not-agent"},
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
