# LM6 — bounded deployment qualification and measured performance

## Acceptance basis and preservation (Phase 0)

Accepted starting HEAD: `e084572a49de11ad39904e628be59842ad0d67e7`; accepted LM3–LM5 parent: `da81aa2bb8126dc0fba8d71c04e4682991193f78`. Git's authoritative `diff-tree` shows exactly seven paths in the accepted telemetry commit, not the three reported by a transient UI footer (`Changed 3 files · +124 −35`). Git has no matching three-path commit or staged three-path patch. This is a UI-summary discrepancy, **not** grounds to reset, stash, or reconstruct user files. The repository's other dirty paths were pre-existing and remain user-owned.

The canonical audit of the original **81 protected paths** returned `mismatches=[]`, `baselineMatch=true`, hash `339aba89d167b45a0cca1f663293fd3fa6197f63f0b2e4cab7f444b90670c104`. The two original stash objects remain `6a7bc6beef913a323052b277f766ae32be11bae1` and `b96fc46d783f1635acec2278deed7b43479f5f9a`. The original index was empty. The approved Qwen GGUF and b12248 llama.cpp engine hashes were confirmed at admission. Do not include unrelated existing `localDeliveryObserver.*` modifications in this task's commit.

The accepted LM2F behavioral qualification receipts, LM3–LM5 hardware/suitability source and installed Secondary PC Ollama registration were inspected before LM6 edits. The existing model/host/runtime/deployment registry is authoritative; LM6 does not create a replacement.

## Existing signal inventory and gaps (Phase 1)

| Authority | Reused signal | Important limitation |
| --- | --- | --- |
| `proxyFetch` + native `ai_http_stream` | Native request opened, provider admission, first WebView-received native response bytes, native settled/cancelled event, native request identity | HTTP transport chunk **is not** a decoded provider protocol frame; native IDs use `inference-N` |
| `inferenceLifecycle` / `providerRetry` | Per-session attempt/stop, existing native abort/cancel, runtime phase and typed timeout codes | A cancelled SDK promise alone does not prove the remote decoder stopped or that no later output is possible |
| `deploymentQualificationFlight` / LM2F real Chat | Actual prepared system/persona, bounded one-request construction, SDK text-start/delta/end, terminal stream, activity/answer receipts | Chat activity request IDs are **UUIDs**, distinct from Rust's `inference-N`; never equate them |
| AI SDK `onStepFinish` | Provider-structured input/output token counts when present | llama.cpp b12248 OpenAI-compatible stream did not provide certified counts in the two fixtures |
| `ollamaModel` terminal frame | Native Ollama `prompt_eval_count`, `eval_count`, `load_duration`, `prompt_eval_duration`, `eval_duration`; individually validated nonnegative safe integers | Only present on a validated terminal frame. Partial native metadata remains partial |
| `local_hardware_observation` | Native OS available RAM and independently verified NVIDIA free VRAM point samples | Samples are **free host resources**, not per-process usage or peak allocation; no remote hardware probe |
| `localComputeFabric` and settings CAS | Exactly scoped LM2F authority and durable local deployment registry | LM6 history is a separate `measurementRuns` ledger and cannot grant capabilities |

Not implemented as authoritative LM6 observations: native provider connection establishment, parsed provider protocol-frame boundary for the managed OpenAI stream, first visible painted assistant text, provider-specific llama.cpp evaluation durations without structured fields, per-process peak RAM/VRAM, and independently confirmed remote Ollama model residency/remote PID. These remain `Unknown`, not zero and not estimated.

## Run identity and provenance (Phases 2–5)

One LM6 record has a UUID run ID, procedure `clack-lm6-bounded-deployment` version **1**, exact ComputeHost, LocalRuntime type/version/configuration revision, runtime epoch and observed process identity where available, ModelArtifact ID/digest/format, ModelDeployment ID/**configuration identity**, backend, configured context, timestamps, fixed requested attempt denominator and three independently scoped attempt IDs. Native `inference-N` and the UUID Chat activity request ID are separate optional fields; neither substitutes for the other.

Each metric stores `{value, unit, provenance, source, observedAt, assumptions}` with `Measured`, `Derived`, `Estimated`, or `Unknown`. LM6 never copies the static LM3 estimate into the measurement ledger. SDK/terminal reported token counts and Ollama durations are Measured; throughput computed from a measured count divided by a measured evaluation duration is **Derived**; missing fields remain Unknown. Token counts are never inferred from output characters.

Timing boundaries:

| Field | Start → end, if both independently observed |
| --- | --- |
| `requestAdmissionMs` | LM6 attempt start → native provider admission |
| `connectionSetupMs` | Provider connection start → provider connected (currently Unknown) |
| `firstNativeChunkMs` | Native request dispatch → first native response chunk received in WebView |
| `firstFrameMs` | Request dispatch → parsed **provider protocol frame** (currently Unknown; old two runs used the earlier transport-chunk label) |
| `firstMeaningfulOutputMs` | Native request dispatch → first nonempty parsed Clack assistant text delta |
| `firstVisibleOutputMs` | Request dispatch → actual visible assistant output (Unknown without a UI paint boundary) |
| `terminalMs` | Native request dispatch → independently certified native terminal completion |
| `modelLoadMs`, `promptEvaluationMs`, `generationMs` | Ollama's own corresponding structured nanosecond fields converted to milliseconds, not wall time |

None of these distinct boundaries is simply labelled `TTFT`.

## Cold/warm, reliability and procedures (Phases 6–10)

One explicit user click invokes **three and only three** attempts; no inference starts on opening the Measurement popover:

1. The LM2F exact-text instruction-adherence Chat (also tests real streaming/terminal Chat); `cold` only if the native managed runtime was independently seen Stopped and Clack started this exact deployment before the attempt, otherwise `warm` if already Ready under the same native deployment/PID/epoch, otherwise `unknown`.
2. One short second Chat; `warm` only when the same managed deployment is Ready and resident with unchanged identity. Remote Ollama temperature is Unknown without authoritative model-residency evidence.
3. One bounded cancellation after generation begins, or after a short fixed limit. Clack invokes the existing per-session cancellation path and retains acknowledgement separately from requested stop, terminal/no-continuation, duplicate requests and subsequent usability.

Each send has an explicit bounded deadline and native preflight; no loop retries an attempt to obtain compliance. Results include `passed`, `failed`, `cancelled`, or `unavailable`, with a fixed failure taxonomy (connectivity, runtime unavailable/crash, first-output/idle/terminal timeout, cancellation, incomplete evidence, identity mismatch, provider/structured/tool failure). Reliability denominator equals the number of planned attempts; failed, unavailable and cancelled attempts are not silently omitted. A Chat can complete while instruction adherence fails. Unverified adherence is **Incomplete**, not model disobedience.

Structured output is a protocol-gated deterministic schema validator; JSON-like ordinary prose alone is not valid qualification. Native tools require a genuine structured SDK tool call, valid arguments, matching returned tool-call ID and harmless result. Both helpers have positive/negative deterministic tests; **neither** is automatically executed on a deployment without an implemented, permitted runtime/model protocol. No high-impact tool, automatic Agent eligibility or separate Agent benchmark is introduced.

## Historical evidence, UI and Suitability (Phases 11–13)

The bounded ledger is stored by the existing self-hosted settings compare-and-swap writer under `fabric.measurementRuns`, limited to 48 rows of at most 16 KiB each. Unknown-version rows remain inert and preserved. Changing the host, runtime type/version/process/epoch, artifact digest, deployment configuration, context, backend or procedure version stales current authority while retaining history. A current scope additionally requires a fresh independently observed runtime and a short measurement authority window. The separate LM2F `qualificationReceipts`, permissions and Agent eligibility are untouched.

The new **Measurement** Chat control displays current/historical results, exact procedure/epoch, attempt denominator, first native chunk versus provider frame, first meaningful text, first visible text, provider usage, Derived speed, resource point samples, failure, and each field's source/provenance. The adjacent **Suitability** control reads **only** current exact-scope LM6 performance. Where known, observed performance overrides static performance Unknown, not behavioral or tool authorization. Never average model compliance, hardware fit and speed into one Agent score.

## Actual bounded fixtures (Phases 14–16)

### A. Existing managed Qwen / llama.cpp

Existing Qwen2.5-0.5B-Instruct Q4_K_M GGUF, verified llama.cpp b12248 CPU server and configured **2,048** context tokens. No model downloaded, no GPU backend enabled, no server reconfiguration, no unrelated kernel/ForgeBoard/Muse work.

Two explicitly initiated, **historically retained** bounded three-attempt runs were captured on the actual Clack desktop and written into the existing settings ledger. These are **not** synthetic benchmark timings.

| Run | Attempts and reliability | First meaningful assistant output | Verified missing data |
| --- | --- | --- | --- |
| `127ebd5f-d711-4ddd-8416-2aaf54812c9f` | 0/3 strictly completed; three failed initial correlation checks | Cold instruction attempt **999 ms**; warm Chat **58 ms**; warm cancellation attempt **56 ms** | Terminal completion, prompt and generated token counts and throughput Unknown; earlier LM6 mistakenly expected UUID-format native IDs |
| `fc7f6f66-fb0c-4eab-984d-d960d1598e43` | 0/3 strictly completed; two incomplete and one acknowledged cancellation | Warm instruction attempt **62 ms**; warm Chat **55 ms**; warm cancellation **58 ms** | Terminal, prompt/generated tokens and throughput Unknown; one distinct native request was observed per attempt, but native `inference-N` had been compared to the separate Chat activity UUID |

The original failure receipts were **not deleted, relabelled in storage or rerun until passing**. Read-only source diagnosis proved Rust native IDs are `inference-N` while the Chat activity UUIDs are distinct. The current code stores both and no longer erroneously requires them to be equal; the fixed correlation path has deterministic tests but **was not live re-executed** after this correction. The older `firstFrameMs` measurements actually came from first native response chunks: the current schema/description records this as transport chunks and leaves the protocol-frame boundary Unknown. Treat older uncorrelated `instruction-adherence: failed` fields as **incomplete behavioral proof**, not independent model-disobedience evidence.

Both runs sampled real native OS free RAM and NVIDIA free VRAM before/during/after; for example the first cold attempt recorded free RAM **32,338,984,960**, **32,333,615,104** and **32,185,352,192** bytes, and NVIDIA free VRAM **13,999,538,176** bytes at all three points. These are point observations, **not** per-process consumption or a sufficiently sampled peak. The managed runtime b12248 remained CPU-only, consistent with LM3–LM5 placement; static fit was favorable but output/terminal reliability could not be promoted by hardware fit.

### B. Existing Secondary PC / Ollama Devstral

The saved Secondary deployment remains registered with a model digest, Ollama backend and explicitly enabled private-network routing. Its configured TCP port was reachable, and neither of its configured Ollama endpoints had an SSH tunnel. However, **one** invocation of Clack's existing read-only native version/epoch inspection did **not** produce verified current runtime evidence. No Devstral inference, tool calls, SSH, remote service change, firewall change, download or model configuration change followed. **Live Devstral metrics and remote resource observations: Unknown / unavailable.** A reachable socket is not evidence of a currently qualified model/runtime.

### Configuration snapshots and comparison

The ignored acceptance harness stored privacy-safe SHA-256 category snapshots before app boot, after boot and finally. From initial to final, deployment, runtime, artifact, host, endpoint configuration, LM2F receipts, Agent permissions and last-used model categories are **identical**. The intended LM6 measurement ledger grew from **0 to 2 rows**. Existing startup/registry discovery independently changed saved profile/inventory category hashes; these were not caused by the passive Measurement popup and were not reconstructed to match the baseline. The two accepted original Git stashes and 81 protected paths are unrelated to these isolated live settings changes.

## Validation, caveats and final disposition (Phases 17–19)

- LM6 deterministic suite covers the requested 30-case matrix plus independent provenance, native-ID namespace, one-dispatch proof and incomplete-adherence cases (**41/41**). No archived `src-tauri/target/**` Vitest copies are included.
- The six passive Measurement UI cases verify no invocation of runtime start, remote inspection or inference merely upon opening; current/historical/stale and Unknown provenance are asserted.
- Final TypeScript suite gate: **55/55 files, 1,068/1,068 tests** (includes LM2F/LM3–LM5, routing, managed local, native proxy, Ollama and LM6). Final `npm run check-types` and `npm run build` **PASS**. Existing Rust full offline library gate: **735 passed, 0 failed, 2 ignored** (no Rust source changed by LM6). Vite's plugin-timing and ineffective-dynamic-import notices were nonfatal.
- Both actual run ledgers have a strict **0/3 verified-completion** fraction, not a scientifically valid 0%-model-response reliability estimate. They contain observed assistant output and incomplete correlation evidence; the UI explicitly distinguishes this. The post-fix independent native/Chat identity and native terminal checks were confirmed by deterministic tests, **not** by an additional Qwen inference campaign.
- No local commit is allowed before exact task-path staging review, complete regression/build checks and protected-81/stash re-audit. Never push.
- Limits still open: no final post-fix production Chat terminal/usage correlation proof, no authoritative managed llama.cpp structured evaluation durations, no observed remote Devstral model runtime, no proved full cancellation no-continuation/post-cancel successful request, no safe on-device structured/native-tool execution path for these exact fixtures. These gaps must remain Unknown/Partial without retry-to-pass, invented metrics or Agent permission expansion.

LM6 component disposition: `BOUNDED_QUALIFICATION_PIPELINE=IMPLEMENTED`; `MEASURED_TIMING_EVIDENCE=PARTIAL`; `COLD_WARM_MEASUREMENT=PARTIAL`; `CANCELLATION_QUALIFICATION=PARTIAL`; `STRUCTURED_OUTPUT_QUALIFICATION=UNSUPPORTED` for the live fixtures (`PASS/FAIL` deterministic protocol validators only); `NATIVE_TOOL_QUALIFICATION=UNSUPPORTED` for the live fixtures; `MEASURED_SUITABILITY_INTEGRATION=PASS`; `LM6=PARTIAL` pending true post-fix live terminal/usage qualification and trustworthy Secondary runtime inspection. A failed capability does not automatically fail LM6, but **unproven data must never be reported as Measured**.
