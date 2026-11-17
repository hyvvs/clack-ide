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

### Continuation audit and bounded evidence correction (17 November 2026)

After local commit `976920e6f08c52793f9b2a3872b559a68bce9688`, a new read-only Git/81-path/stash audit again matched the accepted protected baseline. The already running Clack PID 7132 and CPU-only managed Qwen PID 39004 were reused without restart. Both original LM6 measurement rows remain unaltered. Read-only inspection of the separately persisted Chat conversation records confirmed five original non-cancellation responses with real, correctly scoped Clack Chat request UUIDs, completed answer metadata, and `stop` finish; the cancellation case retained an incomplete/cancelled answer. **This is independent Chat completion evidence, not proof of the separately required native LM6 terminal event.** It does not recalculate or rewrite either strict `0/3` historical run result.

One separately justified normal no-tool Qwen Chat smoke request completed and was retained in a new session. Its ad hoc diagnostic observer did **not** attach to the production qualification flight (no preparation or stream callbacks were observed), so it is **not** accepted as post-fix LM6 terminal/usage qualification and it did not append a measurement ledger row. No failed instruction-adherence prompt was retried. LM6 now gives an already dispatched request a fixed maximum **1,500 ms** native-settlement observation grace after Chat settles, before disarming its existing flight. The grace starts no request and fabricates no terminal proof; absent native events still yield `Unknown`. This adjustment has deterministic tests but has not been proven by a fresh live LM6 procedure.

A subsequent fresh **read-only** Secondary PC native Ollama `/api/version` inspection did return version and epoch fields. Inspection of `src-tauri/src/modules/inference_probe/context.rs` established, however, that the reported epoch is generated by **Clack's own native process**, not the remote Ollama process. Neither remote service identity nor model residency is certified. Accordingly remote LM6 run admission and current-authority display are now disabled until an independent remote runtime epoch/provenance observer is implemented; the prior registration and historical data remain intact. There was **no Devstral inference, SSH, service modification or remote configuration change**. This corrects a provenance risk without suggesting that the Secondary model is unavailable for every ordinary Chat workflow.

Continuation validation for the narrow six-file LM6 follow-up: **44/44** LM6 deterministic tests, **6/6** Measurement UI cases and **7/7** adjacent flight tests passed; the original accepted 55-file regression list was rerun and passed **55/55 files, 1,071/1,071 tests** (three additional LM6 cases). `npm run check-types` and `npm run build` both passed; no Rust implementation changed. These are follow-up **working-tree** changes, not a second commit, new installed desktop binary or new live LM6 qualification receipt. The previously accepted 16-file commit remains the HEAD until any separately authorized future narrow commit.

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

## FINAL authorized three-request live acceptance — 17 November 2026

**This section supersedes the earlier chronological PARTIAL disposition above; the historical records and prior limitations are preserved as originally recorded.** The specifically authorized final-live-three procedure uses two ordinary short Chat prompts, then one harmless cancellation prompt. The original standard LM2F instruction-adherence procedure is unchanged; **no adherence challenge was repeated**. The final procedure had a fixed maximum of three dispatches, no retries, no tools or fallback, and no Secondary PC inference. One new run was persisted through the existing settings CAS ledger:

`ae758b0c-3702-44e9-a887-2e729016bbc8` — host `clack-this-pc`, runtime `clack-managed-llama.cpp` **b12248**, artifact `sha256:74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db` (491,400,032 bytes), CPU backend, context **2048**, native process **PID 30532**, epoch `0f38ddb793cf331902d997f433525fa5c3f5f77f08ad0017d10a15743e909791`. Starting native status was **Stopped** with no live model PID; Clack started this *same existing installation and artifact* through its normal managed lifecycle, establishing Cold before the first request. The native Ready/PID/epoch remained unchanged before the Warm and cancellation requests and after cancellation. There was no driver, GPU, model, service or artifact reconfiguration.

| Actual workload | Independent Chat UUID | Native inference ID | First native bytes | First meaningful model text | Native normal completion | Provider prompt/generated tokens | Result |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| Cold Chat | `05ab660f-9a34-4d00-a71e-65d0010c05a0` | `inference-1` | **991 ms** Measured | **995 ms** Measured | **1,104 ms** Measured | **1170 / 13** Measured | Passed |
| Same-epoch Warm Chat | `45e51a13-1f83-46f0-85fb-086591ce9826` | `inference-2` | **20 ms** Measured | **21 ms** Measured | **153 ms** Measured | **1170 / 16** Measured | Passed |
| Bounded cancellation | `abd1a81f-abc5-486e-a02f-0b046dfd1dce` | `inference-3` | **50 ms** Measured | **51 ms** Measured | Not normal completion; **Unknown** | **Unknown** | Cancelled with native acknowledgement |

Each actual attempt had one native `ai_http_open`, one distinct `inference-N`, its own independent Clack Chat UUID, no duplicate native dispatch, and the exact same attached deployment/process/epoch. Both normal responses had verified Chat activity + answer `stop` completion and independently observed native `completed` settlement; Clack did **not** equate the two ID namespaces. A late provider/native event from a foreign ID is rejected; a missing settlement never becomes a pass and prevents a subsequent dispatch. First provider **parsed protocol frame** and first actual **visible UI paint** remain `Unknown`: native response chunk is *not* substituted for either.

The exact managed b12248 OpenAI-compatible streaming path now **opts into standardized `stream_options.include_usage=true` only for an explicitly armed LM6 flight**. That backward-compatible metadata opt-in in `src/modules/ai/lib/agent.ts` is the narrowly justified **seventh task-owned follow-up file**, beyond the original six. The real provider returned the prompt/generated counts above. It did **not** provide independently certified prompt-evaluation/generation durations or model load timing on this production stream. Therefore prompt/generation **tokens per second**, prefill speed, provider evaluation times and load duration remain `Unknown`, not inferred from wall time, generated text, or static estimates.

The cancellation request generated nonempty assistant output before Clack requested cancellation. It emitted the authoritative native `cancelled` acknowledgement (request timestamp `1794953581738`, acknowledgement `1794953581745`, 7 ms separation) for `inference-3`, produced a matching incomplete/cancelled Clack Chat record and an independent Chat UUID, then showed **no further output or another native request during the fixed 1,500 ms post-cancellation observation window**. The exact same managed runtime was Ready afterward without sending a fourth request. This proves *bounded observed quiescence*, not eternal absence of remote effects; no normal-completion terminal latency is claimed for the aborted request.

Reliability accounting for this three-attempt procedure: **requested=3; attempted=3; completed=2; cancelled=1; failed=0; unavailable=0**, with **2/3** normally completed and one *expected* cancellation. The cancelled request is not treated as a model response failure or silently omitted from the denominator. One cold and one warm observation do **not** constitute a statistically stable benchmark. Native OS free-RAM and NVIDIA free-VRAM values before/during/after were actually sampled at provider-specific timestamps; they are free-host **point** observations, not peak usage, process allocations or GPU execution for the CPU-only deployment.

The original two historical runs, `127ebd5f-d711-4ddd-8416-2aaf54812c9f` and `fc7f6f66-fb0c-4eab-984d-d960d1598e43`, remain **byte-for-byte unchanged in the persisted JSON comparison**; the ledger now has three entries. The new run's independent ID, procedure v1 and workload list, exact artifact/config, runtime PID/epoch and timestamps distinguish it from old incomplete observations. A later epoch restart stales only current epoch-scoped evidence while retaining all history.

**Live read-only suitability integration:** `deploymentMeasurementPanel` recognized the new exact-scope run as current and the two old runs as historical. It displayed Cold **995 ms Measured**, Warm **21 ms Measured**, and generation throughput **Unknown**; `assessDeploymentSuitability` accepted the two verified Chat samples as current performance, reported model **Observed Loaded**, RAM fit **Fits**, CPU placement and **Good** resource rating. LM2F instruction adherence's previous `failed` receipt remained intact but its current authorization was **Qualification Stale** after the deliberate runtime restart; native tools stayed **Unsupported** and Agent **unavailable**. Fast Chat timing does not grant behavioral authorization or turn a historical failed instruction receipt into PASS.

**Secondary Devstral live LM6 fixture: `UNAVAILABLE_FOR_TRUSTWORTHY_QUALIFICATION` / `REMOTE_DEVSTRAL_LIVE_FIXTURE=UNAVAILABLE`.** An Ollama version response alone does not attest remote process epoch or residency. No Devstral inference, SSH or Ollama reconfiguration occurred. The live Qwen success is sufficient for LM6 acceptance independently of remote fixture and unsupported tools/structured procedures.

**Final measured-evidence disposition, superseding the earlier PARTIAL state:**

```text
BOUNDED_QUALIFICATION_PIPELINE=IMPLEMENTED
MEASURED_TIMING_EVIDENCE=PASS
COLD_WARM_MEASUREMENT=PASS
CANCELLATION_QUALIFICATION=PASS
STRUCTURED_OUTPUT_QUALIFICATION=UNSUPPORTED
NATIVE_TOOL_QUALIFICATION=UNSUPPORTED
MEASURED_SUITABILITY_INTEGRATION=PASS
REMOTE_DEVSTRAL_LIVE_FIXTURE=UNAVAILABLE
LM6=PASS
```

**Final source regression and preservation gates after this live acceptance:** the exact accepted 55-path current-source Vitest selection (excluding archived `src-tauri/target/**`) passed **55/55 test suites and 1,078/1,078 tests**; this includes **51/51 LM6 measurement**, **7/7 LM2F flight** and **6/6 Measurement UI** tests. `npm run check-types` exited **0** and `npm run build` exited **0** (`vite` built 1,312 modules in 10.64 seconds; ineffective-dynamic-import/plugin-timing warnings were nonfatal). No native Rust source was changed by this follow-up; the earlier native Rust library regression recorded **735 passed, 0 failed, 2 ignored**. The reviewed seven-file task-owned Git patch passed `git diff --check` (0) before staging. A fresh canonical **81 protected path** audit reported zero mismatches and the exact preserved fingerprint `339aba89d167b45a0cca1f663293fd3fa6197f63f0b2e4cab7f444b90670c104`. Original stash objects remain `6a7bc6beef913a323052b277f766ae32be11bae1` and `b96fc46d783f1635acec2278deed7b43479f5f9a`. No new installed native Clack desktop binary or release installer was claimed: this live run used the already approved SHA-verified native executable and development frontend, followed by a separate successful production frontend build. These checks independently support, but do not substitute for, the **actual persisted live correlation evidence** above.
