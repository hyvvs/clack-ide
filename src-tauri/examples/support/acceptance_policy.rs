use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs::OpenOptions, io::Write, path::PathBuf};

pub const MAX_CONTEXT: u64 = 65536;
pub const REJECTION_EXIT: i32 = 73;
pub const EVIDENCE_EXIT: i32 = 74;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PolicyReason {
    InvalidPayload,
    UnexpectedDestination,
    InvalidBody,
    UnauthorizedModel,
    MissingContext,
    MalformedContext,
    ContextAboveMaximum,
    ReasoningOutputChanged,
    Offline,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Attempt {
    pub schema: u32,
    pub kind: String,
    pub run_id: String,
    pub phase: String,
    pub attempt_id: String,
    pub order: u64,
    pub at: u128,
    pub model: Option<String>,
    pub model_matches: bool,
    pub model_digest: Option<String>,
    pub endpoint: String,
    pub destination_matches: bool,
    pub native_request_id: Option<String>,
    pub provider_request_id: Option<String>,
    pub requested_num_ctx: Value,
    pub requested_num_ctx_exact: Option<String>,
    pub context_state: String,
    pub max_allowed_num_ctx: u64,
    pub requested_output: Value,
    pub output_state: String,
    pub think: Value,
    pub think_state: String,
    pub message_count: Option<usize>,
    pub tool_count: Option<usize>,
    pub serialized_bytes: Option<usize>,
    pub protected_budget: Option<u64>,
    pub policy_decision: String,
    pub policy_reason: Option<PolicyReason>,
    pub dispatch_state: String,
    pub network_dispatch: bool,
}

pub struct Config {
    pub root: PathBuf,
    pub run_id: String,
    pub phase: Option<String>,
    pub endpoint: String,
    pub model: String,
    pub digest: Option<String>,
    pub expected_think: Option<String>,
}

impl Config {
    pub fn from_env(root: PathBuf) -> Result<Option<Self>, &'static str> {
        let Ok(endpoint) = std::env::var("CLACK_ACCEPTANCE_OLLAMA_URL") else {
            return Ok(None);
        };
        let phase = std::env::var("CLACK_REAL_PRODUCT_PHASE").ok();
        let run_id = std::env::var("CLACK_ACCEPTANCE_RUN_ID").unwrap_or_else(|_| "legacy".into());
        if !safe_label(&run_id) || phase.as_deref().is_some_and(|p| !safe_label(p)) {
            return Err("invalid acceptance evidence identity");
        }
        let expected_think = std::env::var("CLACK_ACCEPTANCE_EXPECTED_THINK").ok();
        if expected_think
            .as_deref()
            .is_some_and(|t| !matches!(t, "low" | "false" | "omitted"))
        {
            return Err("invalid acceptance reasoning guard");
        }
        Ok(Some(Self {
            root,
            run_id,
            phase,
            endpoint,
            model: std::env::var("CLACK_ACCEPTANCE_MODEL")
                .unwrap_or_else(|_| "qwen38-uncensored:latest".into()),
            digest: std::env::var("CLACK_ACCEPTANCE_DIGEST")
                .ok()
                .filter(|d| d.len() == 64 && d.bytes().all(|b| b.is_ascii_hexdigit())),
            expected_think,
        }))
    }
}

fn safe_label(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 96
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

fn authorized_model(model: &str) -> bool {
    matches!(
        model,
        "qwen3-coder:30b" | "nemotron-3.5-lightning:30b-a3b-q4_K_M"
    )
}

fn number(value: Option<&Value>) -> (Value, String) {
    match value {
        None => (Value::Null, "missing".into()),
        Some(Value::Number(n)) => (
            json!(n),
            if n.as_u64().is_some() {
                "unsigned"
            } else {
                "invalid_number"
            }
            .into(),
        ),
        Some(value) => (
            Value::Null,
            match value {
                Value::Null => "null",
                Value::String(_) => "string_redacted",
                Value::Bool(_) => "boolean",
                Value::Array(_) => "array_redacted",
                _ => "object_redacted",
            }
            .into(),
        ),
    }
}

fn reasoning(value: Option<&Value>) -> (Value, String) {
    match value {
        None => (Value::Null, "omitted".into()),
        Some(Value::Bool(v)) => (json!(v), if *v { "true" } else { "false" }.into()),
        Some(Value::String(v)) if matches!(v.as_str(), "low" | "medium" | "high") => {
            (json!(v), "named".into())
        }
        Some(_) => (Value::Null, "invalid_redacted".into()),
    }
}

fn endpoint_identity(raw: &str) -> String {
    match tauri::Url::parse(raw) {
        Ok(url) if matches!(url.scheme(), "http" | "https") => {
            // Never persist userinfo, arbitrary paths, queries, fragments or opaque URLs.
            let path = if url.path() == "/api/chat" {
                "/api/chat"
            } else {
                "/[redacted]"
            };
            format!("{}{path}", url.origin().ascii_serialization())
        }
        _ => "[invalid endpoint]".into(),
    }
}

pub struct Gate {
    pub config: Config,
    order: u64,
    stopped: Option<Attempt>,
    evidence_failed: bool,
}

pub enum Outcome {
    Accepted(Attempt),
    AcceptancePolicyRejected(Attempt),
    EvidenceFailure,
}

impl Gate {
    pub fn new(config: Config) -> Self {
        Self {
            config,
            order: 0,
            stopped: None,
            evidence_failed: false,
        }
    }

    pub fn inspect(&mut self, payload: Option<&Value>) -> Outcome {
        if self.evidence_failed {
            return Outcome::EvidenceFailure;
        }
        if let Some(attempt) = &self.stopped {
            return Outcome::AcceptancePolicyRejected(attempt.clone());
        }
        self.order += 1;
        let bytes = payload.and_then(|p| serde_json::from_value::<Vec<u8>>(p["body"].clone()).ok());
        let body = bytes
            .as_deref()
            .and_then(|b| serde_json::from_slice::<Value>(b).ok());
        let body = body.as_ref().filter(|b| b.is_object());
        let ctx = body
            .and_then(|b| b.get("options"))
            .and_then(|o| o.get("num_ctx"));
        let output = body
            .and_then(|b| b.get("options"))
            .and_then(|o| o.get("num_predict"));
        let think = body.and_then(|b| b.get("think"));
        let (requested_num_ctx, context_state) = number(ctx);
        let (requested_output, output_state) = number(output);
        let (think_value, think_state) = reasoning(think);
        let model_matches = body.is_some_and(|b| b["model"] == self.config.model);
        let destination_matches =
            payload.is_some_and(|p| p["url"].as_str() == Some(self.config.endpoint.as_str()));
        let mut reason = if payload.is_none() {
            Some(PolicyReason::InvalidPayload)
        } else if !destination_matches {
            Some(PolicyReason::UnexpectedDestination)
        } else {
            None
        };
        if reason.is_none() && self.config.phase.is_some() {
            reason = if body.is_none() {
                Some(PolicyReason::InvalidBody)
            } else if !authorized_model(&self.config.model) || !model_matches {
                Some(PolicyReason::UnauthorizedModel)
            } else if ctx.is_none() {
                Some(PolicyReason::MissingContext)
            } else if ctx.and_then(Value::as_u64).is_none() {
                Some(PolicyReason::MalformedContext)
            } else if ctx.and_then(Value::as_u64).is_some_and(|n| n > MAX_CONTEXT) {
                Some(PolicyReason::ContextAboveMaximum)
            } else if self
                .config
                .expected_think
                .as_deref()
                .is_some_and(|expected| {
                    let matches = match expected {
                        "omitted" => think.is_none(),
                        "false" => think == Some(&Value::Bool(false)),
                        "low" => think == Some(&json!("low")),
                        _ => false,
                    };
                    !matches || output != Some(&json!(2048))
                })
            {
                Some(PolicyReason::ReasoningOutputChanged)
            } else if self
                .config
                .phase
                .as_deref()
                .is_some_and(|p| p.starts_with("offline"))
            {
                Some(PolicyReason::Offline)
            } else {
                None
            };
        }
        let phase = self.config.phase.as_deref().unwrap_or("direct").to_string();
        let native_request_id = payload
            .and_then(|p| p["requestId"].as_str())
            .filter(|id| {
                id.strip_prefix("inference-").is_some_and(|n| {
                    !n.is_empty() && n.len() <= 10 && n.bytes().all(|b| b.is_ascii_digit())
                })
            })
            .map(str::to_owned);
        let attempt = Attempt {
            schema: 1,
            kind: "acceptance-request-attempt".into(),
            run_id: self.config.run_id.clone(),
            phase: phase.clone(),
            attempt_id: format!(
                "{}:{phase}:{}:{}",
                self.config.run_id,
                std::process::id(),
                self.order
            ),
            order: self.order,
            at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis(),
            model: body
                .and_then(|b| b["model"].as_str())
                .filter(|m| authorized_model(m))
                .map(str::to_owned),
            model_matches,
            model_digest: self.config.digest.clone(),
            endpoint: endpoint_identity(payload.and_then(|p| p["url"].as_str()).unwrap_or("")),
            destination_matches,
            native_request_id,
            provider_request_id: None,
            requested_num_ctx,
            requested_num_ctx_exact: ctx.and_then(Value::as_number).map(ToString::to_string),
            context_state,
            max_allowed_num_ctx: MAX_CONTEXT,
            requested_output,
            output_state,
            think: think_value,
            think_state,
            message_count: body.and_then(|b| b["messages"].as_array()).map(Vec::len),
            tool_count: body
                .and_then(|b| b["tools"].as_array())
                .map(Vec::len)
                .or_else(|| body.filter(|b| b.get("tools").is_none()).map(|_| 0)),
            serialized_bytes: bytes.as_ref().map(Vec::len),
            protected_budget: None,
            policy_decision: if reason.is_some() {
                "rejected"
            } else {
                "accepted"
            }
            .into(),
            policy_reason: reason,
            dispatch_state: if reason.is_some() {
                "blocked"
            } else {
                "eligible"
            }
            .into(),
            network_dispatch: false,
        };
        let path = self.config.root.join(format!("{phase}.attempts.jsonl"));
        if append(&path, &attempt).is_err() {
            self.evidence_failed = true;
            return Outcome::EvidenceFailure;
        }
        if reason.is_some() {
            self.stopped = Some(attempt.clone());
            return Outcome::AcceptancePolicyRejected(attempt);
        }
        // Keep accepted legacy request audits compatible. Rejected bodies are never dumped.
        if self.config.phase.is_some()
            && append(
                &self.config.root.join(format!("{phase}.requests.jsonl")),
                &json!({
                    "at": attempt.at, "requestId": attempt.native_request_id,
                    "url": attempt.endpoint, "body": body,
                }),
            )
            .is_err()
        {
            self.evidence_failed = true;
            return Outcome::EvidenceFailure;
        }
        Outcome::Accepted(attempt)
    }
}

fn append(path: &std::path::Path, value: &impl Serialize) -> std::io::Result<()> {
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    serde_json::to_writer(&mut file, value)?;
    file.write_all(b"\n")?;
    file.sync_all()
}

// Executes the same boundary without WebView/network initialization for deterministic process tests.
pub fn fixture(root: PathBuf) -> i32 {
    use std::io::Read;
    let Ok(Some(config)) = Config::from_env(root) else {
        return EVIDENCE_EXIT;
    };
    let mut input = String::new();
    if std::io::stdin()
        .take(4 * 1024 * 1024)
        .read_to_string(&mut input)
        .is_err()
    {
        return EVIDENCE_EXIT;
    }
    let Ok(payload) = serde_json::from_str::<Value>(&input) else {
        return EVIDENCE_EXIT;
    };
    match Gate::new(config).inspect(Some(&payload)) {
        Outcome::Accepted(a) => {
            println!(
                "{}",
                json!({"dispatchable":true,"attempt":a,"network_dispatch":false})
            );
            0
        }
        Outcome::AcceptancePolicyRejected(a) => {
            println!("{}", json!({"kind":"AcceptancePolicyRejected","attempt":a}));
            REJECTION_EXIT
        }
        Outcome::EvidenceFailure => EVIDENCE_EXIT,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gate() -> (tempfile::TempDir, Gate) {
        let root = tempfile::tempdir().unwrap();
        let config = Config {
            root: root.path().to_owned(),
            run_id: "boundary-test".into(),
            phase: Some("mission-a-1".into()),
            endpoint: "http://127.0.0.1:11435/api/chat".into(),
            model: "qwen3-coder:30b".into(),
            digest: Some("a".repeat(64)),
            expected_think: None,
        };
        (root, Gate::new(config))
    }

    fn body(ctx: Value) -> Value {
        json!({"model":"qwen3-coder:30b", "options":{"num_ctx":ctx,"num_predict":512},
            "messages":[{"role":"user","content":"private fixture"}],"tools":[{"function":{"name":"fixture"}}],"stream":true})
    }

    fn payload(body: &Value) -> Value {
        json!({"url":"http://127.0.0.1:11435/api/chat","requestId":"inference-2","body":serde_json::to_vec(body).unwrap()})
    }

    fn rejected(outcome: Outcome) -> Attempt {
        match outcome {
            Outcome::AcceptancePolicyRejected(a) => a,
            _ => panic!("expected typed policy rejection"),
        }
    }

    fn records(gate: &Gate) -> Vec<Value> {
        std::fs::read_to_string(gate.config.root.join("mission-a-1.attempts.jsonl"))
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    #[test]
    fn boundary_65536_retains_exact_accepted_controls_and_legacy_audit() {
        let (_root, mut gate) = gate();
        let body = body(json!(65536));
        let payload = payload(&body);
        let original = payload.clone();
        let Outcome::Accepted(a) = gate.inspect(Some(&payload)) else {
            panic!("boundary must be dispatchable")
        };
        assert_eq!(payload, original);
        assert_eq!(a.requested_num_ctx, 65536);
        assert_eq!(a.dispatch_state, "eligible");
        assert!(!a.network_dispatch);
        let legacy: Value = serde_json::from_str(
            &std::fs::read_to_string(gate.config.root.join("mission-a-1.requests.jsonl")).unwrap(),
        )
        .unwrap();
        assert_eq!(legacy["body"], body);
        assert_eq!(legacy["requestId"], "inference-2");
        assert_eq!(legacy["url"], gate.config.endpoint);
        assert_eq!(records(&gate).len(), 1);
    }

    #[test]
    fn above_maximum_persists_exact_numbers_and_never_becomes_dispatchable() {
        for n in [65537_u64, 1048576, u64::MAX] {
            let (_root, mut gate) = gate();
            let payload = payload(&body(json!(n)));
            let original = payload.clone();
            let a = rejected(gate.inspect(Some(&payload)));
            assert_eq!(a.policy_reason, Some(PolicyReason::ContextAboveMaximum));
            assert_eq!(a.requested_num_ctx, n);
            assert_eq!(a.requested_num_ctx_exact, Some(n.to_string()));
            assert_eq!(a.max_allowed_num_ctx, 65536);
            assert_eq!(a.provider_request_id, None);
            assert_eq!(a.native_request_id.as_deref(), Some("inference-2"));
            assert_eq!(a.order, 1);
            assert!(a.attempt_id.starts_with("boundary-test:mission-a-1:"));
            assert!(a.at > 0);
            assert!(!a.network_dispatch);
            assert_eq!(a.dispatch_state, "blocked");
            assert_eq!(payload, original);
            assert_eq!(records(&gate)[0]["requested_num_ctx"], n);
            assert!(!gate.config.root.join("mission-a-1.requests.jsonl").exists());
        }
    }

    #[test]
    fn old_guard_panicked_but_new_guard_returns_normally() {
        let value = json!(65537);
        assert!(
            std::panic::catch_unwind(|| assert!(value.as_u64().is_some_and(|n| n <= 65536)))
                .is_err()
        );
        let (_root, mut gate) = gate();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            gate.inspect(Some(&payload(&body(value))))
        }));
        assert!(matches!(result, Ok(Outcome::AcceptancePolicyRejected(_))));
    }

    #[test]
    fn metadata_captures_reasoning_output_counts_size_and_unknown_budget() {
        for (think, state) in [
            (None, "omitted"),
            (Some(json!(false)), "false"),
            (Some(json!(true)), "true"),
            (Some(json!("medium")), "named"),
        ] {
            let (_root, mut gate) = gate();
            let mut body = body(json!(65537));
            if let Some(value) = &think {
                body["think"] = value.clone();
            }
            let bytes = serde_json::to_vec(&body).unwrap().len();
            let a = rejected(gate.inspect(Some(&payload(&body))));
            assert_eq!(a.think_state, state);
            assert_eq!(a.think, think.unwrap_or(Value::Null));
            assert_eq!(a.requested_output, 512);
            assert_eq!(a.message_count, Some(1));
            assert_eq!(a.tool_count, Some(1));
            assert_eq!(a.serialized_bytes, Some(bytes));
            assert_eq!(a.protected_budget, None);
            assert_eq!(a.model_digest, Some("a".repeat(64)));
            assert_eq!(a.model.as_deref(), Some("qwen3-coder:30b"));
        }
    }

    #[test]
    fn malformed_or_missing_context_preserves_old_rejection_semantics() {
        for (ctx, state) in [
            (None, "missing"),
            (Some(Value::Null), "null"),
            (Some(json!("65536")), "string_redacted"),
            (Some(json!(-1)), "invalid_number"),
            (Some(json!(1.5)), "invalid_number"),
            (Some(json!(true)), "boolean"),
            (Some(json!({})), "object_redacted"),
        ] {
            let (_root, mut gate) = gate();
            let mut b = body(Value::Null);
            if let Some(value) = ctx {
                b["options"]["num_ctx"] = value;
            } else {
                b["options"].as_object_mut().unwrap().remove("num_ctx");
            }
            let a = rejected(gate.inspect(Some(&payload(&b))));
            assert_eq!(a.context_state, state);
            assert_eq!(
                a.policy_reason,
                Some(if state == "missing" {
                    PolicyReason::MissingContext
                } else {
                    PolicyReason::MalformedContext
                })
            );
        }
    }

    #[test]
    fn rejection_is_terminal_no_retry_clamp_or_later_acceptance() {
        let (_root, mut gate) = gate();
        let a = rejected(gate.inspect(Some(&payload(&body(json!(65537))))));
        let b = rejected(gate.inspect(Some(&payload(&body(json!(65536))))));
        assert_eq!(a.attempt_id, b.attempt_id);
        assert_eq!(b.requested_num_ctx, 65537);
        assert_eq!(records(&gate).len(), 1);
    }

    #[test]
    fn preceding_accepted_timeout_evidence_is_not_rewritten() {
        let (_root, mut gate) = gate();
        assert!(matches!(
            gate.inspect(Some(&payload(&body(json!(4096))))),
            Outcome::Accepted(_)
        ));
        let events = gate.config.root.join("mission-a-1.jsonl");
        let timeout = "{\"kind\":\"timeout\",\"elapsedMs\":75002}\n";
        std::fs::write(&events, timeout).unwrap();
        let a = rejected(gate.inspect(Some(&payload(&body(json!(65537))))));
        assert_eq!(a.order, 2);
        assert_eq!(std::fs::read_to_string(events).unwrap(), timeout);
        assert_eq!(records(&gate).len(), 2);
        assert_eq!(
            std::fs::read_to_string(gate.config.root.join("mission-a-1.requests.jsonl"))
                .unwrap()
                .lines()
                .count(),
            1
        );
    }

    #[test]
    fn rejected_diagnostics_do_not_contain_credentials_or_prompt_content() {
        let (_root, mut gate) = gate();
        let secret = "SENTINEL-PRIVATE-SSH-PASSWORD-API-CREDENTIAL";
        let mut b = body(json!(65537));
        b["messages"] = json!([{"content":secret}]);
        b["tools"] = json!([{"description":secret}]);
        b["think"] = json!(secret);
        b["options"]["num_predict"] = json!(secret);
        b["credentialRef"] = json!(secret);
        let mut p = payload(&b);
        p["headers"] = json!({"Authorization":secret,"X-Api-Key":secret});
        p["url"] = json!(format!(
            "https://user:{secret}@example.invalid/{secret}?key={secret}#{secret}"
        ));
        p["requestId"] = json!(secret);
        let a = rejected(gate.inspect(Some(&p)));
        let persisted =
            std::fs::read_to_string(gate.config.root.join("mission-a-1.attempts.jsonl")).unwrap();
        assert!(!persisted.contains(secret));
        assert!(!persisted.contains("Authorization"));
        assert_eq!(a.endpoint, "https://example.invalid/[redacted]");
        assert_eq!(a.think_state, "invalid_redacted");
        assert_eq!(a.native_request_id, None);
    }

    #[test]
    fn adjacent_invalid_payload_body_destination_and_model_fail_without_panics() {
        let (_root, mut g) = gate();
        assert_eq!(
            rejected(g.inspect(None)).policy_reason,
            Some(PolicyReason::InvalidPayload)
        );
        let (_root, mut g) = gate();
        let mut p = payload(&body(json!(65536)));
        p["body"] = json!([0, 255]);
        assert_eq!(
            rejected(g.inspect(Some(&p))).policy_reason,
            Some(PolicyReason::InvalidBody)
        );
        let (_root, mut g) = gate();
        p["url"] = json!("https://other.invalid/api/chat");
        assert_eq!(
            rejected(g.inspect(Some(&p))).policy_reason,
            Some(PolicyReason::UnexpectedDestination)
        );
        let (_root, mut g) = gate();
        let mut b = body(json!(65536));
        b["model"] = json!("unauthorized");
        assert_eq!(
            rejected(g.inspect(Some(&payload(&b)))).policy_reason,
            Some(PolicyReason::UnauthorizedModel)
        );
    }

    #[test]
    fn direct_non_agent_policy_still_only_checks_destination() {
        let (_root, mut g) = gate();
        g.config.phase = None;
        let mut b = body(json!(1048576));
        b["model"] = json!("direct-chat-model");
        assert!(matches!(
            g.inspect(Some(&payload(&b))),
            Outcome::Accepted(_)
        ));
    }

    #[test]
    fn reasoning_guard_preserves_omitted_false_and_named_semantics() {
        for expected in ["omitted", "false", "low"] {
            let (_root, mut g) = gate();
            g.config.expected_think = Some(expected.into());
            let mut b = body(json!(65536));
            b["options"]["num_predict"] = json!(2048);
            if expected != "omitted" {
                b["think"] = if expected == "false" {
                    json!(false)
                } else {
                    json!("low")
                };
            }
            assert!(matches!(
                g.inspect(Some(&payload(&b))),
                Outcome::Accepted(_)
            ));
            b["options"]["num_predict"] = json!(512);
            assert_eq!(
                rejected(g.inspect(Some(&payload(&b)))).policy_reason,
                Some(PolicyReason::ReasoningOutputChanged)
            );
        }
    }

    #[test]
    fn evidence_failure_is_fail_closed_and_does_not_recover_into_dispatch() {
        let (_root, mut g) = gate();
        g.config.root = g.config.root.join("missing-directory");
        for _ in 0..2 {
            assert!(matches!(
                g.inspect(Some(&payload(&body(json!(65536))))),
                Outcome::EvidenceFailure
            ));
        }
    }

    #[test]
    fn concurrent_requests_have_serial_order_and_terminal_rejection() {
        let (_root, gate) = gate();
        let gate = std::sync::Arc::new(std::sync::Mutex::new(gate));
        std::thread::scope(|s| {
            for _ in 0..8 {
                let gate = gate.clone();
                s.spawn(move || {
                    let _ = gate
                        .lock()
                        .unwrap()
                        .inspect(Some(&payload(&body(json!(65537)))));
                });
            }
        });
        assert_eq!(records(&gate.lock().unwrap()).len(), 1);
    }
}
