# R5ah — first real Agent inference transport boundary

Date: 2026-10-24. Starting commit: 0ef791182ca929b390cbd5059d9719134911a495. Scope: one confirmed acceptance-host correction, focused offline regressions, exactly one real Qwen notes API coding smoke; no ForgeBoard.

## First positively proven R5ag failing boundary

Frozen evidence: src-tauri/target/real-qwen-product/qwen-smoke-r5ag-20261024-01/; run real-mission-a, inference-10.

- Inference-1 through -6 (calibration) and -7 through -9 (native verification) have reqwest receive traces with headers, body chunks, IPC forwarding, provider done, EOF and completed. Inference-8 and -9 were distinct native tool calls with Boolean thinking, qualifying/confirming the alternative after the default text-only result.
- Inference-10 is present in mission-a-1.requests.jsonl, created by the acceptance-only Tauri ai_http_stream interceptor: model matches, num_ctx=65536, num_predict=2048, toolSchemas=18, thinkKind=boolean. It has **no entry** in mission-a-1.receive.jsonl; no logged native admission, response headers, streamed chunks, engine-finish or settled. Persisted Agent error native-transport is a generic TypeScript classification, not Ollama error evidence. Agent failed at 0 steps.
- The original acceptance-only Rust host src-tauri/examples/r5k_acceptance.rs at lines 561–569 logs the serialized request and rejects any Agent request whose thinking control does not match its initial CLACK_ACCEPTANCE_EXPECTED_THINK=omitted. Its strict acceptance_wire_controls_match deliberately accepted Boolean alternatives **only for verification probes**. This is upstream of handler(invoke) / production net::inference::ai_http_stream. Native preflight and final ACK, provider HTTP receipt and SDK stream completion were therefore never reached for inference-10. No cancellation, owner closure or deadline is recorded; the synchronous host rejection explains the immediate failure.
- Frozen R5ag saved profile records Qwen Automatic with a **verified and confirmed** configuration choice none, wire false native-tool proof at 65536. Production agent.ts calls applyAgentRecommendation and legitimately uses the proof-backed think:false variant for Agent inference without changing saved Automatic. This mismatch is a **confirmed acceptance-host wire guard defect**, not an Ollama transport fault or a production Clack inference defect.

## Smallest isolated correction

New exclusive acceptance-only host: src-tauri/examples/r5ah_acceptance.rs, derived from the earlier host without modifying historical fixtures. The R5ah runner uses this host. The existing strict wire validator remains intact. An additional host predicate permits a Boolean Agent think value only when:

1. CLACK_ACCEPTANCE_EXPECTED_THINK is omitted (saved Automatic), not explicit.
2. The host observed two matching, previously accepted native tool verification requests for the same Boolean variant at the Agent context.
3. The Agent Boolean exactly matches that variant.
4. Stripping only that selected variant yields the **original fully valid Agent wire**: approved tool names, context, output allowance, streaming and schema shapes.

Observing two requests in the host is not itself proof of success: production independently requires successful native tool calls and confirmation, fresh context/scope metadata, ordinary reason selection, permission and preflight. No production source, proof, model setting, timeout, cancellation, native tools, SDK transport or retry logic changed. The host does not add tools or bypass approval.

Rust acceptance-host tests cover qualified variant, no/one/mismatched probe, context, wrong tool, explicit choice, and unchanged default and verification behavior.

## Offline gates

- cargo test --example r5ah_acceptance --locked --target-dir target/codex-test: **6/6 PASS**.
- cargo build --example r5ah_acceptance --locked --target-dir target/codex-test: **PASS**.
- npm run check-types: **PASS**.
- Focused Vitest (proxyFetch, inferenceToolGate, localAgentContinuity, agentConfiguration, AgentRunBridge): **93/93 PASS**, 5 suites.
- npm run lint: exit 0; 76 warnings and 2 informational diagnostics; no fixes.
- npm run build: **PASS**; existing dynamic-import and plugin-timing advisories.
- Isolated R5ah WebView contains the exact same notes API mission as R5ag/R5af, byte-for-byte.

## Exactly one fresh real Agent notes API acceptance

Run ID: qwen-smoke-r5ah-20261024-01. Fresh Git workspace: src-tauri/target/qwen-smoke-r5ah-20261024-01/. Evidence: src-tauri/target/real-qwen-product/qwen-smoke-r5ah-20261024-01/. Saved Qwen Automatic profile, no injected proof status. Exactly **one** mission-a launch through Clack real Agent and native tools; no retry, other model, or ForgeBoard.

- Six fresh numeric context calibration requests passed through 65536; native tool qualification passed once at default omitted-thinking control. **Unlike R5ag, successful default qualification means Boolean host fix was not exercised in this live sample.**
- Eight real native dispatches: six calibration, one native qualification, one genuine Agent inference (inference-8); no cloud fallback.
- Agent inference used 18 native tool schemas, context 65536, output allowance 2048, thinking omitted. Its native receive has headers, 46 chunks / 6522 bytes, IPC forwarding, EOF and completed; native engine-finish and settlement were recorded. **The SDK completed the first Agent step.**
- Saved Agent state completed, lastFinishReason stop, totalSteps 1, continuationCount 0, no budget exhaustion or transport error. Its only assistant text described listing the directory followed by a **textual imitation of a list_directory tool call** instead of an actual SDK native tool call. No native Agent tool-call part, no source writes, no shells, builds, tests or repairs. Coder guidance was present but not followed through an implementation/verification cycle.
- The acceptance host resultOk=true means its IPC/report protocol succeeded, **not** that the coding mission passed.

## Independent application evaluation

The R5ah independent evaluator froze untouched application source before inspection. Its authored-source manifest is **empty**, and remains byte-identical afterward (sourceUntouched=true). Authored tests, README and .gitignore: **FAIL** (missing). npm tests, production build, local TypeScript compiler, health, notes CRUD, validation and persistence/restart: **BLOCKED** (no package, source or server); startup: **FAIL** (no launch script). No evaluator repair or accidental parent Clack test execution. **Software delivery failed despite a working Agent inference transport.**

## Preservation and single next action

Commit only new R5ah acceptance host, runner, WebViews, independent evaluator, ledger and this report. Preserve all six dirty user files, both stashes, autonomous_tracker/, saved settings, SSH listener 127.0.0.1:11435, historical R5af/R5ag evidence, inactive Codex worktree and the original ForgeBoard specification. No reset, clean, push, download, cloud fallback, remote config or unrelated refactoring.

**Single next practical action for a separately authorized checkpoint:** identify why a successfully settled real Agent request with 18 native tools returned textual tool imitation and natural stop rather than an SDK-native list_directory call, using frozen R5ah output and verified native proof. Do not equate completed with acceptance. R3d packaged desktop stays **OPEN**; the complete P2–P19 security, integration, real-Agent, E2E and Windows/Linux/macOS roadmap remains **MANDATORY / DEFERRED**. **STOP**.
