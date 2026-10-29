# Offline OpenRouter Agent output-budget forensics: why 2,048?

Starting HEAD: d2cfba8e5eed4a93d008b82cfba381210015b6c6.
Classification: **HOSTED 2048 POLICY INTENTIONAL**.
Generic Clack implementation defect proven: **NO**.
Production change: **NONE**.
Model inference, independent acceptance reevaluation and ForgeBoard: **NONE**.
Prior Nemotron/Laguna acceptance verdicts and the separate closed local status are **UNCHANGED**.

## Evidence boundaries and source of the limit

The two existing frozen hosted controls both have a final response segment with finish=length, reported outputTokens=2048, no current-segment assistant answer text and no current-segment native tool call. Both stopped at the intentional insufficient-progress safeguard. Each control successfully executed real native tools earlier (Nemotron eight; Laguna two). The historical provider request body was **not** persisted.

**The shared 2,048 is a deliberate Clack ordinary-chat fallback**, not an installed OpenRouter adapter default. In src/modules/ai/lib/contextBudget.ts, lines 156-163, the fallback is min(2048, max(256, floor(ceiling*0.15))) plus any explicitly known reasoningBudget. Both OpenRouter models have large reported context; the ordinary output therefore computes to **2048**.

src/modules/ai/lib/agentOutputBudget.ts, lines 4-34, contains an already-corrected bounded policy for reasoning-capable Agents: 1/8 of trusted reported/deployed context, up to **8192**, respecting explicit pins and provider maximums. But it deliberately refuses promotion if:

- the captured reasoning-effort contract is not status=supported, or thinking is disabled;
- trusted reported/deployed context is absent;
- requiredOutput, maxOutput or outputReserve was explicitly supplied.

This restriction is **explicitly tested** in agentOutputBudget.test.ts, including the case of unknown reasoning capability and large reported context. No separate hosted-only copy of the old 2048 fallback was found.

Both exact saved OpenRouter models are *unknown for the effort-control contract* under reasoningEffort.ts: effortCapability accepts only an exact registered provider/model API contract (or separately verified self-hosted evidence), and EFFORT_CONTRACTS has **no entries** for either OpenRouter ID. The current model catalog advertises default-on reasoning; that is **not the same fact** as a verified Clack effort-control mapping. captureEffort defaults to choice=automatic and status=unknown. Therefore the Agent promotion **intentionally does not apply** even though the model may generate substantial reasoning.

Agent.ts, lines 923-929, **does call the corrected generic resolveAgentOutputBudget** for all models, hosted and local. It returns the limits with outputReserve=max(existing reserve, computed allowance), then tool exposure/compaction shares these limits. At lines 1176-1186 the prepared budget remains 2048, and line 1331 sets streamText.maxOutputTokens to the same value. No Agent bypass of the corrected helper was observed.

requestPreflight.ts, lines 188-224 and 352-395, refreshes the provider's reported context/output cap and resolves output using params.maxOutputTokens. Its transformParams **also supplies the same conservative 2048 fallback** if a caller omitted maxOutputTokens. prepare() then measures/asserts the serialized body; it does not insert another 2048 limit. The ordinary cloud Fetch path uses preflightFetch and verifiedProviderFetch, not native Ollama IPC. Agent.ts, lines 403-417, constructs the unchanged OpenRouter production adapter using @ai-sdk/openai-compatible.

The installed @ai-sdk/openai-compatible v2 package maps SDK maxOutputTokens directly to JSON **max_tokens** (node_modules/@ai-sdk/openai-compatible/dist/index.mjs, roughly line 516). It does **not** send max_completion_tokens on this adapter's Chat Completions route. This mapping is verified by the offline tests.

## Reconstructed request budget and frozen outcome

| Layer / field | Nemotron 3 Ultra free | Poolside Laguna S 2.1 free | Evidence |
|---|---:|---:|---|
| Exact OpenRouter ID | nvidia/nemotron-3-ultra-550b-a55b:free | poolside/laguna-s-2.1:free | Frozen selection/session |
| Current catalog reported context | 1,000,000 | 262,144 | Public catalog, October 29 |
| Current catalog top_provider.max_completion_tokens | **65,536** | **32,768** | Public catalog, October 29 |
| Original saved-model output override | **Absent** | **Absent** | Both isolated saved settings |
| Clack captured effort capability | **unknown** | **unknown** | Exact-id effort policy; default automatic |
| resolveContextBudget ordinary fallback | **2,048** | **2,048** | Production source and synthetic offline run |
| resolveAgentOutputBudget promotion | **Not eligible** | **Not eligible** | Deliberate unknown-effort guard |
| Agent preparation and SDK maxOutputTokens, expected | **2,048** | **2,048** | Current production-path reproduction |
| Preflight output, expected | **2,048** | **2,048** | Current production-path reproduction |
| Serialized Chat Completions field, **offline synthetic** | **max_tokens: 2048** | **max_tokens: 2048** | Mocked fetch caught real adapter body |
| Serialized max_completion_tokens, offline synthetic | **Omitted** | **Omitted** | Mocked fetch |
| **Actual preserved historical HTTP field/value** | **Unknown/not captured** | **Unknown/not captured** | Frozen evidence audit |
| Frozen provider-reported last-segment output tokens | **2,048** | **2,048** | Saved clackAnswer.segments |
| Frozen final-segment finish | **length** | **length** | Saved clackAnswer.segments |
| Final-segment assistant text/tool calls | **0 / 0** | **0 / 0** | Saved transcript |
| Final outcome | Agent failed; notes failed | Agent failed; notes failed | Frozen independent evaluations |

The historic roots inspected were:

- src-tauri/target/remote-controls/remote-nemotron-ultra-notes-20261028-01/
- src-tauri/target/remote-controls/remote-laguna-s21-notes-20261029-01/

In each root, mission-a-1.json, mission-a-1.native-report.json, mission-a-1.events.jsonl and data/terax-ai-sessions.json contain **no** preserved serialized max_tokens, max_completion_tokens or maxOutputTokens field or full request body. The original harness collects state/tools and bounded receipts, **not** outbound HTTP JSON. Frozen output token counts must not be silently relabeled as wire tokens. SDK segment markers do not establish the physical HTTP-request count.

## Offline serialization proof (no provider traffic)

Task-owned regression file: src/modules/ai/lib/hostedOutputBudgetAudit.test.ts.

The test explicitly replaces global Fetch with an in-process handler that **only** accepts the public model-catalog URL (returning synthetic provider metadata) and the OpenRouter Chat Completions URL (recording the body and returning synthetic SSE). All other URLs are rejected. The test creates the **real Clack buildLanguageModel OpenRouter production adapter** with a dummy credential, obtains modelBudgetLimits, computes resolveAgentOutputBudget, passes it to real AI SDK streamText, and inspects the final body **after real Clack preflight**.

Confirmed:

- Nemotron and Laguna both serialize max_tokens: 2048, with genuine tool schema and no max_completion_tokens field.
- Bare OpenRouter-compatible SDK **without Clack preflight** does **not** invent max_tokens when the caller omits the parameter; Clack's preflight supplies 2048 in that omitted-input case.
- Synthetic verified-effort supported Agent with large context serializes 8192. Explicit lower SDK output 1024 serializes 1024.
- Existing policy respects outputCap 4096 or 1024, explicit maxOutput 1024 and requiredOutput 1024. Models without evidenced support remain conservatively bounded.
- Ordinary hosted chat without override remains 2048. Existing self-hosted Agent regression separately verifies num_predict: 8192 at a verified 65536 context. The full continuation regression suite still confirms that truncated reasoning-only, zero-text response is rejected.

The synthetic fixture does **not** assert either real hosted model is eligible for an effort-control promotion; its synthetic supported-effort case merely verifies that the corrected helper and SDK serialization are functional when that separate prerequisite is true.

## Self-hosted comparison and reasoning accounting

| Contract | Verified self-hosted Ollama Agent example | OpenRouter saved Agent controls |
|---|---|---|
| Context source | Fresh verified deployed/loaded context, e.g. 65,536 | Provider-reported context, 1,000,000 / 262,144 |
| Reasoning-effort capability | Verified native/endpoint-specific supported control for eligible local Agent | Unknown: no exact provider/model effort-control mapping |
| Agent helper | Same resolveAgentOutputBudget | Same resolveAgentOutputBudget |
| Agent output in stated scenario | **8,192** | **2,048** |
| Serialized control | Native options.num_predict: 8192 | OpenRouter Chat Completions max_tokens: 2048 (offline) |
| Provider outcome | Historical local reliability blocked; no new requests | Frozen length at 2048 with reasoning-only final segment |

The difference is **input evidence/effort-control eligibility**, not a generic hosted Agent that bypasses the fixed output-budget helper. The 8K budget is a **default promotion**, not a requirement that every advertised-thinking model always receive 8K.

OpenRouter's public Reasoning Tokens documentation states that on most providers reasoning and visible answer tokens **share max_tokens/max_completion_tokens**. It explicitly documents a length finish with empty visible content when reasoning consumes the allowance. The catalog's Nemotron and Laguna entries currently say reasoning is enabled by default, and output maxima 65536 and 32768 respectively. None constitutes a guarantee about their **historical routed backend**, actual request fields or deployed limits during the frozen runs. Whether a particular provider can enforce additional unadvertised caps remains **unresolved without historic wire/routing capture**. The reported 2048 counts are, however, exactly compatible with the Clack-side fallback shown above; Laguna's 8,178 reasoning characters are **not** 8,178 output tokens.

There is no explicit reasoning.max_tokens/effort override in these automatic, unknown-capability OpenRouter captures. Clack's independent effortBudget only adds numeric reasoning budget for recognized Google-thinking configurations; it does not silently reserve a hosted reasoning budget. No reasoning disable/forced budget or speculative output increase was attempted.

## Classification and consequences

**HOSTED 2048 POLICY INTENTIONAL** is the classification of the presently provable **Clack-side source** of 2048. It is an explicitly encoded and tested *conservative output-budget policy* for an Agent without a verified effort-control capability. There is **no proof of a model-neutral implementation mismatch**, no stale parallel hosted fallback, no SDK serialization bug, and no evidence of a provider-advertised 2048 maximum. The two actual historical wire fields and any independently imposed provider-side cap remain unobserved; do not claim exact wire capture.

No production code was changed: a generic correction would require a justified design decision to broaden how reliable reasoning-capability evidence qualifies an Agent, without conflating catalog reasoning support with verified effort-control mappings. That policy change, its model-neutral security/metadata constraints and a genuinely request-scoped capture require separate authorization and tests. Changing 2048 to 8192 globally would be unsound. Both earlier acceptance classifications remain unchanged: neither notes pass nor ForgeBoard proof is established. A new hosted control is **not** justified as automatic validation of a non-existent fix; one could be considered only under a new, explicit control authorization and adequate request-budget observability.

All user-owned state and the existing insufficient-progress guard remain protected. No local/hosted inference, frozen-evaluator replay, ForgeBoard, SSH/Ollama change, reset, clean or push was performed.
