# Ornith prospective frozen-request A/B/C diagnostic — bounded; no acceptance

**October 25, 2026. Starting HEAD:** `d9c2042df6dca1c1cd4381f61055954ad7c5c5b9`. **Outcome:** legitimate single prospective payload captured and A/B/C byte-controlled at the adapter boundary; **no proven generic output-budget or tool-exposure improvement, no production change**. No model other than Ornith, no notes-app Agent mission/acceptance, no ForgeBoard, no tool side effects, no destructive cleanup or profile/tunnel/inventory changes.

## Identity, exact frozen payload, and limitation of production-path scope

- Live existing forwarded provider `127.0.0.1:11435`, Ollama **0.40.11**, selected model **`ornith-1.5:35b`**, live full digest **`9f3b89b2521908dd2e6f7a11fa368e62c8f89e1075f22604e4d1a76dd1240fcc`**. Initially `/api/ps` empty. During A, read-only `/api/ps` confirmed model genuinely loaded at **32768**. Original inventory remained 15 tags; original listener PID 27688 remained on 127.0.0.1:11435.
- One single new, exclusive evidence root: `src-tauri/target/real-qwen-product/ornith15-r5cc-diagnostic-20261025-01/`. `baseline.exact.json` is the **literal UTF-8 JSON string** handed by Clack's production `createOllamaModel` adapter `send()` at its final `fetch` interception boundary, **persisted before any inference**. The capture-only `fetch` callback always threw without making a network request. **27853 bytes**, SHA256 **`a083548b19d1578d77e6e1f8b7a247dae7f719849b1269b776f1feadcd0f5580`**.
- Five serialized messages: (1) real stable system containing the normal Clack core/default/Coder persona instructions (**9152 characters**); (2) representative previously authorized notes implementation instruction (**1081 bytes**); (3) earlier saved assistant response with genuine previously completed structured `list_directory` and `bash_run` calls (text 76 characters); (4–5) the actual preserved output contents of those two calls, used **only as immutable synthetic previous history**. No second-turn failed reasoning was injected and **no tool call was executed**.
- Full set of **18** observed historically exposed built-in native schemas was recreated through **production tool factories**, `serializedToolSchemas`, and normal `resolveCurrentAgentPermission` filtering under a diagnostic-only trusted-workspace Coder profile. All names were confirmed permission-eligible; no invented tools. A deliberately **historical fixed selection** of those 18 names, not a fresh invocation of `prepareToolExposure` to pick a new set. Production `buildStableSystem`, AI SDK `convertToModelMessages`/`pruneMessages`, `streamText` and Clack's actual native Ollama provider serializer were used. **Do not assert full `runAgentStream` lifecycle equivalence:** the prospective harness calls production components directly, and intentionally bypasses Agent execution/continuation/approval and the native IPC proxy for these direct provider comparisons.
- Automatic reasoning option **omitted**: no `think` field. Full provider `options` are **exactly `{"num_predict":8192,"num_ctx":32768}`** at baseline; **no temperature, seed, sampling override, or hidden numeric option**. `model="ornith-1.5:35b"`, `stream=true`; all 18 complete native JSON function schemas persisted. The real `minimumSafeContext` implementation selected **32768** from the earlier verified 4096–73728 tier ladder given the complete request estimate; the live Ollama process independently confirmed the loaded 32768 on A. This diagnostic reused previously established tier trust instead of re-qualifying/rebinding a current Clack runtime epoch, so **do not claim fresh current-epoch exact-tier native verifier proof**.
- Clack conservative admission estimator for complete A: system **4729**, tools **7875**, conversation **1166** estimate tokens; 18 tools serialized **16167 bytes**; 8192 reserved output, 1377 margin, 32768 fits. Complete B also **fits 32768 with a 12288 reserve** and identical input; no output-budget-driven context change. These are Clack estimates, **not** Ollama tokenizer counts.
- The SDK surfaced the deliberate capture sentinel as a stream error and the initial one-shot capture process mistakenly expected it to propagate via `finishReason`; the payload had **already been safely written**. A separate offline `finalize` step constructed its metadata from those bytes without any recapture or HTTP inference. The diagnostic script was corrected afterward for future use; the baseline was never regenerated/replaced.

## Byte-level A/B/C parity, all from the same frozen raw capture

`parity.json` verifies at JSON structure level that model, messages, system text, history/tool results, stream, reasoning option and **all non-output options are exactly identical** for A/B/C; A's raw payload is byte-for-byte identical to the capture. The only allowed changes were B `options.num_predict`, and C `tools` array filtering. No new task wording, prelude, reset, prompting, temperature, seed or context mutation. All returned calls were intercepted as serialized objects, **never executed**, and did not touch any application/source/processes.

| Variant | Payload SHA256 | Bytes | Tools | `num_predict` | Context |
| --- | --- | ---: | ---: | ---: | ---: |
| A | `a083548b19d1578d77e6e1f8b7a247dae7f719849b1269b776f1feadcd0f5580` | 27853 | 18 | 8192 | 32768 |
| B | `80a9fbccfd5f2db54aae4978211ee171547165a5727953299f22cdfc1eda816a` | 27854 | 18 | 12288 | 32768 |
| C | `c71c25529f80c158c9b9c13a3f071fb7d55692b14cf61449ccd372538d1e606c` | 15225 | 5 | 8192 | 32768 |

Five relevant schemas C: `read_file`, `list_directory`, `write_file`, `create_directory`, `bash_run`, in frozen original relative ordering. The remaining tools were withheld **only for this no-execution diagnostic**; production availability and permissions remain unchanged.

## Provider results and diagnostic collector limitation

| Measure | A (original) | B (output only) | C (tools only) |
| --- | --- | --- | --- |
| Provider prompt/input tokens | **5952**, server journal | **5952**, final frame | **3247**, final frame |
| Generated tokens | **7603**, server journal | **1343** | **1438** |
| Separate reasoning tokens | Not available | Not available | Not available |
| Observed streamed reasoning chars | Not captured | **4336** | **5153** |
| Observed text chars | Not captured | **133** | **200** |
| Time to first genuine structured call | **Unknown / not captured** | **20771 ms**, `todo_write` | **26547 ms**, `bash_run` |
| Native returned structured calls | Unknown | **`todo_write`, `bash_run`** | **`bash_run`, `bash_run`** |
| Arguments | Unknown | JSON object(s), **not independently JSON-schema validated** | JSON object(s), **not independently JSON-schema validated** |
| Ollama finish reason | Natural end in journal; exact `done_reason` **unknown** | **`stop`** | **`stop`** |
| Wall time | ~**132102 ms** client, 2m10s Ollama | **20794 ms** | **26566 ms** |
| Time to first streamed body | Not available | **179 ms** | **4824 ms** |
| Max measured response byte gap | Not available | **3689 ms** | **1320 ms** |
| Exhausted configured allowance? | **No:** 7603 < 8192 | **No:** 1343 < 12288 | **No:** 1438 < 8192 |

**Critical A instrumentation error:** The first direct provider run **was not repeated**. An assertion included a template literal that eagerly evaluated `await response.text()` even for successful HTTP 200, consuming the live NDJSON response stream before the metrics reader called `getReader()`. The collector thus recorded `TypeError [ERR_INVALID_STATE]: ReadableStream is locked`, with unknown calls/timing/content/finish. **This was NOT a native Clack, Ollama or model error.** The diagnostic helper's success-response handling was fixed before B/C. Read-only existing SSH to Ollama's service journal proves that A really dispatched a single `POST /api/chat` returning HTTP **200** at **22:58:59 CET** after **2m10s**; it processed **5952 input tokens** in ~9.432s and generated **7603 tokens** in ~118.402s (~64.21 tokens/s), then released the slot normally. It logged `common_reaso: deactivated (natural end)`. The service journal **does not preserve returned tool-call JSON, content, or exact `done_reason`**. We cannot infer a missing tool call or that A exhausted 8192. No second baseline or any extra inference was issued.

The reported B/C first-tool times are *end-of-generation times when Ollama emitted structured calls*, not evidence of gradual thinking-to-tool transition before that terminal chunk. Ollama `eval_count` combines reasoning and visible output; no separately trustworthy reasoning-token counter was returned. The raw reasoning **character** counts are observations, not tokens. The stream gap statistic is between client-readable body chunks, not token-by-token provider liveness.

## Evidence interpretation, D condition, and no generic policy changes

**Does an 8192 allowance starve Ornith before action? NOT demonstrated.** A's server-side natural completion occurred after 7603 generated tokens, *below* 8192, and its tool-call content is unavailable. Both B and C produced structured calls after much **less than 8192** tokens. Raising output to 12288 was **not necessary** for B's calls, and a single unseeded comparison cannot establish that the larger configured maximum caused its shorter generation.

**Does reducing tools help?** It demonstrably reduced the provider prompt from 5952 to 3247 tokens (**2705 / 45.4% fewer**) and raw schema bytes from 16167 to **3539**. However C's first tool arrived **5.776 seconds later** than B's; because B had a different output maximum and A has no tool timing, a fixed-output causal time-to-tool comparison is **not available**. The provider's seed/temperature were identically omitted, so even otherwise controlled single shots allow sampling variance. Do not claim a reliability or decision improvement based on a changed surface alone.

**D NOT RUN:** Neither B nor C demonstrates a reliable improvement against a complete A, and D's code gate now requires A's completed, error-free instrumentation. All proposed tool effects remained intercepted; zero writes/commands by the model.

**Generic Clack fix justified: NO.** Dynamic, permission-aware exposure already exists, and a reduction in prompt tokens by itself does not justify changing its fallback/phase-ranking behavior. This experiment did not independently test prompt deduplication, so production system/Coder prompts were unchanged. No output reserve, context trust, tool verification, permission, cancellation or stream-idle policy was modified. No production tests/build/Rust tests are required for a no-change diagnostic. Diagnostic script syntax and strict frozen payload parity were validated.

**Candidate for a separate, future ONE acceptance only IF a controlled benefit is subsequently proved:** **Ornith**, already qualified at 73728 with exact-tier proofs and a documented original reasoning-exhaustion symptom. **No acceptance is currently authorized; no acceptance should be launched based on this incomplete A/B/C experiment.** Existing classifications of GLM/Ornith remain unchanged.

Evidence files in the exclusive ignored run root: `baseline.exact.json`, `capture.meta.json`, `variant-[ABC].wire.json`, `result-[ABC].json`, `comparisons.json`, `parity.json`. The baseline contains real user/Agent/system text and should not be copied into a public commit. The only committed change is this report and its diagnostic-only script.
