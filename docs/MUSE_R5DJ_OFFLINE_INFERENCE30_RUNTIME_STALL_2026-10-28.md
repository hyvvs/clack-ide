# R5dj — Offline `inference-30` request-phase and provider-recovery forensics

**Starting HEAD:** `faf30503b5fb5c1beae35909914777596105ab97`. **Run:** `museglimmer-r5di-final-notes-20261028-01`. This is an evidence/source audit, **not** an additional acceptance or inference. **Frozen outcome remains `LOCAL ACCEPTANCE BLOCKED BY RUNTIME RELIABILITY`.** Historical evidence and frozen evaluation were read, not rerun or modified.

## Finding and proof boundary

`inference-30` passed Clack's admission/preflight path and reached its native `reqwest` *send await* (the preserved `dispatch` event immediately precedes `req.send().await`). No `reqwest` response object/HTTP response headers, native body chunk, provider completion, or EOF was observed before parent cancellation. The **immediate termination mechanism** is the Agent provider-recovery wrapper's 120-second first-meaningful-SDK-output ceiling. The **underlying cause** of the unresolved `send().await` is **UNRESOLVED**. Native dispatch is **not** proof of TCP connect, full request write, SSH forwarding, Ollama receipt/admission, Ollama execution, or a provider lock. No causative Clack defect, Ollama defect, transport fault or resource pressure can be established from the preserved historical evidence.

The Rust transport emits `Phase::Connecting` *before* DNS resolution and `Phase::WaitingFirstOutput` *before* calling `.send()`. These names are UI states, not physical socket phase markers. In this run the latter appeared at 02:00:06.012 UTC. A new `reqwest::Client` is built inside **each** `execute_traced` call; there is no shared connection pool carried over from `inference-29` in this path. A 10-second reqwest connect timeout was configured, but the trace lacks TCP/connect state; its non-occurrence is not standalone proof that Ollama received bytes.

## Exact observed historical timeline

Values below are Unix epoch **milliseconds**, from R5di persisted receipts; UTC on **2026-10-28**. Times marked *unrecorded* are intentionally not inferred.

| Event | Unix ms | UTC / evidence |
|---|---:|---|
| `inference-29` native dispatch | `1793152772776` | 01:59:32.776; native trace |
| `inference-29` response headers and first chunk | `1793152773795` | 01:59:33.795; native trace; 225 chunks total |
| `inference-29` `done`, EOF, completed | `1793152805549` | 02:00:05.549; native trace |
| `inference-29` WebView settlement | `1793152805552` | 02:00:05.552; boundary |
| Production provider inspection | `1793152805569` | 02:00:05.569, `self_hosted_probe` (command metadata only) |
| Production context-runtime inspection | `1793152805787` | 02:00:05.787 (command metadata only) |
| Pre-request cache inspections | `1793152805895`–`1793152805997` | 02:00:05.895–05.997; six cache probes (only command times saved) |
| Agent provider-recovery 120s clock start | **unrecorded** | starts *before* `underlying.doStream`; approximately 120s before the `1793152925932` deadline observation, **not an independently measured start timestamp** |
| WebView serialized native request record | `1793152805986` | 02:00:05.986; `49152` context, `8192` output, 18 schemas |
| Native `ai_http_open` / `ai_http_stream` IPC exact start | **unrecorded** | required for dispatch, but no separate timestamp saved |
| Clack native admission marker and HTTP `dispatch` | `1793152806010` | 02:00:06.010; Clack-side capacity granted, not Ollama admission |
| Native `connecting` UI phase | `1793152806011` | 02:00:06.011; before DNS/socket connect |
| Native `waiting-first-output` UI phase | `1793152806012` | 02:00:06.012; after reqwest request-building, **before** `.send().await` |
| TCP connection begin/end; request-write begin/end | **unrecorded** | reqwest's combined `.send()` future did not expose these boundaries in this trace |
| SSH forwarding; Ollama receipt/queue/scheduler/runner execution | **unrecorded** | no correlated provider/transport telemetry preserved |
| HTTP headers, first body byte/chunk, provider `done`, EOF | **never observed** | zero chunks, zero bytes, no headers marker |
| Agent recovery owner stop fired | `1793152925932` | 02:02:05.932; source `provider-timeout`, policy `provider-recovery-120s`, reason `provider-retry-deadline` |
| First structured cancel cause and native cancel IPC | `1793152925935` | 02:02:05.935; `webview-cancel-ipc`, `parent-abort-signal`; native `parent-signal` |
| Native cancellation observed | `1793152925936` | 02:02:05.936; **119,926 ms** after dispatch |
| Agent session failed | `1793152925938` | 02:02:05.938, `overall-deadline`; terminal, no retry |
| Native admission released / cancelled settlement | `1793152925940` / `1793152925941` | 02:02:05.940–41; Clack cleanup; **provider-side cleanup unrecorded** |
| Parser diagnostic closure | `1793152926979` | 02:02:06.979; installed, zero failures |
| Native host exit / runner end | `1793152927005` / `1793152927117` | 02:02:07.005 / 02:02:07.117 |

There are exactly two `inference-30` native trace events: `dispatch` and `cancellation-observed`. `mission-a-1.client-stream.jsonl` contains 29 settled successful streams and no entry for this request because its collector starts on received headers. WebView heartbeat boundaries continued during the 120-second wait; they demonstrate the observer was active, **not** the health of the HTTP or Ollama request.

## Production clock/retry audit

`src/modules/ai/lib/agent.ts` calls `withProviderRetryTracking` for each Agent generation. In `src/modules/ai/lib/providerRetry.ts`, `wrapStream` creates a new `AbortController`, starts a fresh **120,000 ms** timer before the first `underlying.doStream`, and invokes `inferenceScope.onStop({source:"provider-timeout",reason:"provider-retry-deadline",policy:"provider-recovery-120s"})` **before** aborting with `InferenceTransportError("overall-deadline")`. `waitForRecovery` races opening and reading against that signal. The clock is cleared at the first *meaningful* SDK part or during settlement. Response metadata/other structural SDK parts alone do not clear it. It is **not** a recovery timer that starts only after a prior failure; "recovery" is the wrapper policy name. There is no recorded error/retry before this in-flight dispatch, and the total 30 native dispatches reconcile exactly to 7 calibration + 3 verifier + 20 Agent generation requests, with no extra internal attempted generation. `inference-30` is the twentieth Agent **first** attempt, not a proven retry.

If an early failure occurs in a different request, the same timer encompasses at most two bounded retries, delay/backoff, tool revalidation and call charging; it **does not reset** on an internal retry. In the actual `inference-30` history none of those retry transitions was observed. Native self-hosted `first-output-timeout=120s` starts when the HTTP execution begins (after admission/preflight), separate from the earlier JavaScript wrapper clock; Rust `stream-idle-timeout=180s` and `overall=600s` are distinct. The parent wrapper fired about 78ms before its native-dispatch-to-120s interval would have elapsed. **Do not change any deadline.**

## Comparison with earlier requests

| Request | Agent control / context | Native dispatch → headers | Native dispatch → final | Result |
|---|---|---:|---:|---|
| `inference-26` | 18 tools, `32768/8192` | 1,008 ms | 87,364 ms | 5 chunks, 3,982 bytes, `done`/EOF; 86,149 ms inter-callback gap |
| `inference-27` | verifier, `49152/512`, one tool | 5,850 ms | completed normally | Native exact-tier proof, not Agent generation |
| `inference-28` | 18 tools, `49152/8192` | 16,833 ms | 28,793 ms | 6 chunks, `done`/EOF |
| `inference-29` | 18 tools, `49152/8192` | 1,019 ms | 32,773 ms | 225 chunks, 34,417 bytes, `done`/EOF |
| `inference-30` | 18 tools, `49152/8192` | **none observed** | cancelled at 119,926 ms | Zero chunks, no `done`/EOF |

All Agent requests exposed the same 18 native tool names and used the same validated model/digest/provider version and host runtime epoch (`31824:1793152085676932300`); all were `initial-batch`, not continuation. R5di deliberately saved **redacted controls**, not byte-exact request bodies, serialized prompt length, full history or exact HTTP request size. Therefore a context/request-size change between 29 and 30 cannot be measured. The 49,152-tier transition was preceded by a successful verifier; the immediately preceding successful Agent request already used that tier. The seven pre-30 inspections establish metadata checks occurred but are not snapshots of Ollama scheduler, allocated memory, or socket state.

## Provider, forwarding and resource limitations

The preserved R5di run root contains no Ollama daemon or runner journal, historical `/api/ps` snapshot, model load/eviction record, GPU or host memory metrics, SSH tunnel request trace, TCP socket trace, or transport write/connection milestones. Existing read-only metadata probes are only command-name/timestamp receipts; current provider state cannot prove historical state. The SSH listener on `127.0.0.1:11435` PID 12932 was present during this investigation, but **this does not establish per-request tunnel continuity**. No SSH shell, restart, tunnel modification or model endpoint was invoked. Neither Ollama request receipt nor admission, queueing, runner start, OOM, scheduler contention, lock contention, restart, or serving of another request during the interval can be established.

## Minimal generic diagnostics added for future opted-in observation

- Native debug acceptance trace (`src-tauri/src/modules/net/inference`): content-free, request-ID-associated, bounded markers `resolve-start`, `resolve-end`, `request-built`, `send-await-start`, in addition to existing headers/body/EOF/cancellation markers. These do not modify `reqwest`, connector, pooling, timeout, admission or stream semantics; release builds without an installed acceptance observer remain no-op.
- Optional Agent provider-recovery observer (`providerRetry.ts`, wired by `agent.ts`): timestamped attempt ordinals and stages `deadline-start`, `attempt-start`, `retry-scheduled`, `retry-ready`, `first-meaningful-output`, `deadline-fire`, `settled`; catches observer exceptions, no prompt or output content. In normal operation without an observer installed no log is emitted. Independent opt-in observers may join those events to existing session/native request metadata; the recovery event itself has no native request ID because the timer starts before that ID is assigned.
- **Explicitly incomplete:** `reqwest::RequestBuilder::send().await` does **not** provide separate genuine TCP-connect start/success, HTTP-write start/end or reused-connection metrics through this code's current API. The opt-in trace therefore labels none of those events and cannot locate a future stall below the `send-await-start`→headers interval. Actual Ollama admission/runner execution requires server-side logs/traces. Runtime epoch/model identity are available in separately correlated acceptance receipts but are not native `Trace` fields. The existing per-request `Client` design entails no cross-request connection reuse in this path; no connector was substituted or wrapped.

Tests: new Rust synthetic successful-response versus no-header stall verifies diagnostic ordering/absence of headers/body and no sensitive data capture; new Vitest fake-timer test confirms per-first-attempt clock start/fire, no retry transition. Offline verification: **61/61** Rust inference tests PASS (`--locked --lib`, 2 test threads), **9/9** targeted Vitest tests PASS (two discovered suites), TypeScript `check-types` PASS, and production Vite build PASS. The build emitted pre-existing dynamic-import/plugin timing warnings but exited 0. No Ollama generation/acceptance/evaluator was run.

## Classification and next direction

| Layer | Proven responsible? | Basis |
|---|---|---|
| Generic Clack defect | **NO** | Dispatch and parent cancellation followed current contracts; no faulty internal behavior proven |
| Ollama/provider runtime defect | **NO (unproven)** | Could be received-and-stalled, but provider receipt itself is not established |
| TCP/SSH/HTTP transport failure | **NO (unproven)** | Missing physical phase/forwarding evidence |
| Host/GPU/memory/resource pressure | **NO (unproven)** | No interval telemetry |
| Root cause | **UNRESOLVED** | Known stop mechanism; no supported localization below `reqwest.send()` |

**Stop the bake-off.** The evidence supports evaluating a more observable/reliable inference runtime or a materially stronger hardware/model tier as a subsequent strategic decision. A future remote-model Clack control is an *option for discussion only*, not an authorized test. No Muse rerun, other-model test, ForgeBoard, or new acceptance is permitted.
