# Hosted reasoning-generation output policy: capability separation

**Starting HEAD:** `08fb3d4649a9625dfc88c5c65a754fef1b6408a8`.
**Decision:** **Generic policy compatibility issue YES**; narrow production policy correction YES; no claim that the prior implementation violated its documented contract.
**Control status:** no inference of any kind, no hosted-control replay, no ForgeBoard, no additional acceptance evaluation, no security/continuation bypass.
**Historical implication:** `HOSTED CONTROL INVALIDATED BY OUTPUT-BUDGET POLICY COMPATIBILITY` for *both* previously failed OpenRouter controls. Historical artifacts and their failed frozen notes evaluations remain immutable; no successful Agent control is established.

## Why the prior coupling was conservative but unnecessarily restrictive

Clack has *different* capability contracts:

1. **Reasoning generation / activation:** exact OpenRouter provider model metadata `ProviderModelEvidence.capabilities.reasoning` (normalized from `reasoning.mandatory` and `reasoning.default_enabled`), observed with a 15-minute TTL, exact identity and validated context/output. It describes whether the model reasons by default, **not** whether Clack can change its effort.
2. **Reasoning effort control:** `EffortCapture.capability` from `reasoningEffort.ts`, whose `supported` status requires an exact verified provider/API mapping or backend-scoped native evidence. `effortProviderOptions` sends controls only for a verified, non-automatic selected effort choice; automatic emits none. A default-on reasoning OpenRouter model can have `EffortCapture.capability.status=unknown`.
3. **Output capacity / context:** `resolveProviderContext` supplies the exact provider-reported context and a separate `top_provider.max_completion_tokens` as `BudgetLimits.outputCap`; `resolveContextBudget` also honors `maxOutput`, `outputReserve`, runtime-target/deployed context, context ceiling, measured input and safety margin.
4. **Agent output:** `resolveAgentOutputBudget` computes the common fallback and may promote to `min(8192, floor(trustedContext/8))`, bounded by every inherited output cap/pin. Before this change it only promoted when *reasoning effort* was supported.

The old gate protected against speculative reasoning settings and provider/model assumptions. Its reliance on effort control as a proxy for **generation** was an intentional conservative approximation (confirmed by the explicit original regression), **not** a correctness/security necessity for independently evidenced default-on reasoning. A provider can support hidden/default reasoning, bound output through `max_tokens`, yet offer no effort-level API Clack can safely map.

## New minimal production rule

Two small production changes: `src/modules/ai/lib/agentOutputBudget.ts` (capacity eligibility) and `src/modules/ai/lib/agent.ts` (native-Agent vs ordinary-chat boundary). Preserve the existing supported-effort path, the 1/8-context maximum-8K formula and the shared context-budget resolver. Add an alternative, model-neutral Agent-only eligibility path when effort control is unknown/unsupported:

- captured reasoning choice **automatic** (never silently override an explicit disabled choice);
- provider metadata is **fresh** and successfully normalized using `freshProviderModelEvidence`, exact matched to the captured provider and transport model ID; no aliases/name heuristics or provider-ID crossover;
- `limits.reported` is present and equals the provider metadata's validated context;
- `limits.outputCap` is present and no greater than the same provider metadata's validated positive `output` maximum;
- the metadata explicitly declares `defaultEnabled=true`, or `mandatory=true` without contradictory `defaultEnabled=false`. Merely listing `reasoning` as a supported parameter or advertising effort levels is insufficient.

If any prerequisite fails, the existing ordinary fallback applies. No new provider option is emitted, no unsupported `reasoning_effort` or `reasoning` flag is invented and no reasoning is disabled. The *output-control* field alone becomes larger where eligible. The existing trust-bound preflight still refreshes capabilities, constrains the outgoing SDK `maxOutputTokens` against current `outputCap`, and validates context fit. For free endpoints the catalog describes their maximum, not a guarantee of the specific future routed backend.

**Chat boundary:** `runAgentStream` is shared by Coder/native-tool Agent requests and ordinary hosted chat messages. A broad initial patch increased an ordinary MiniMax chat request to 8,192, caught by the existing `modelSwitchCapacity.integration.test.ts` regression. The production fix now computes the prospective larger reserve during native-tool discovery, then **keeps the new metadata-only promotion only when at least one native tool is actually exposed**. A request with no exposed native tool retains its prior ordinary fallback; this does not restrict the old verified-effort path. The final preparation/continuation/preflight budget uses the selected post-exposure limit. This is the smallest reliable distinction available in the existing request structure; merely choosing the built-in Coder persona does not classify a greeting as a tool-driven Agent task.

### Capability case matrix

| Case | Trusted model state | Agent allowance after change | Explanation |
|---|---|---|---|
| A | Reasoning effort supported, enabled; known context | Existing up to **8,192** | Preserved verified-effort path; any known output cap overrides |
| B | Default-on/mandatory reasoning proven; effort unknown **or unsupported**; exact fresh context and output max | Up to **8,192** | New generation-based path; **no effort field sent** |
| C | Reasoning unsupported/off by default; effort unsupported | Ordinary **2,048** or lower | No default reasoning justification |
| D | Reasoning generation unknown, even with large context | Ordinary **2,048** or lower | Tool/effort parameter lists alone insufficient |
| E | Reasoning supported, but context untrusted or **output max unknown** for new hosted path | Ordinary fallback or lower | No promotion without verified capacity |
| F | Explicit lower manual/captured output requirement | Explicit amount, e.g. **2,048** or **1,024**, subject to hard cap | Manual limit authoritative; never promote past it |

Examples for native-tool Agent requests: reported context 262,144 with provider output cap 32,768 and default-on reasoning → 8,192. Same context with output cap 4,096 → **4,096**. A 1,024 provider cap → **1,024**. A manual maxOutput of 2,048 → **2,048**. Advertised context without provider-reported/deployed context → no promotion. Stale/wrong-identity metadata or missing provider output maximum → no new promotion. The existing verified self-hosted path remains unchanged, including its `num_predict` behavior. Normal chat shares the stream implementation but is not promoted through the new metadata-only path when no native tools are exposed.

### OpenRouter wire contract

The current production OpenRouter adapter remains `@ai-sdk/openai-compatible`, using Chat Completions. The Agent supplies `maxOutputTokens`, which the unchanged adapter serializes to **`max_tokens`**. A synthetic, offline, fetch-intercepted production-path test verifies output **8,192** for both earlier model identities when fresh metadata advertises default-on reasoning and provider max 65,536 / 32,768. This is only a model-neutral **fixture**; no inference was dispatched or the old frozen runs replayed. The same tests verify 4,096 with an output-limited *synthetic* provider, and 2,048 with absent output-maximum or disabled-default reasoning evidence. `max_completion_tokens` is catalog metadata used for the cap; it is **not** this route's outgoing field. No `reasoning_effort`, `reasoning` or `include_reasoning` field was added.

Reasoning and answer text can consume the same completion allowance. OpenRouter's reasoning documentation describes output exhaustion yielding length with empty visible content. A model can legitimately use all its output budget on reasoning; the increased allowance **reduces starvation risk, not guarantees an answer**. Clack's non-progress and answer-continuation safeguards remain unchanged and tested.

## Acceptance implications and next authorized control

The two preserved OpenRouter controls failed in a shared, exact **2,048 output-token, reasoning-only, length** pattern. The new production rule would have chosen a larger Agent budget with adequately fresh/trusted matching metadata, whereas old production intentionally did not. Per the user-specified policy/design decision, both historical controls are reclassified as **`HOSTED CONTROL INVALIDATED BY OUTPUT-BUDGET POLICY COMPATIBILITY`**. This does **not** rewrite either frozen run, assert they would pass with 8K, establish a generic Clack orchestration bug, or change the closed local Ollama status.

**Exactly ONE new hosted notes Agent control becomes justified as a *future* separately authorized check**, not part of this task. Prerequisites:

- new production output policy active in the executable;
- preserve the original unchanged notes acceptance contract;
- capture request-scoped Clack computed output and SDK-visible output;
- **observe the actual final serialized provider field/value** at the fetch/proxy boundary, including provider/model identity, without retaining secrets or prompts;
- capture provider-reported usage, reasoning and visible token accounting if available, finish reasons, native tool results, Agent continuation/compaction/retries and truthful final state;
- do not use a model-specific workaround, force effort settings or relax the insufficient-progress safeguard;
- independently freeze/evaluate once after termination; ForgeBoard only if notes pass under the separately authorized workflow.

This task intentionally does **not** run that control. It also does not claim a provider would honor the new allowance without a future captured request and result.

## Offline regression and preservation record

Final focused regression run: **12 test files, 308 tests PASS** (including live-session-path mocked send, the old ordinary hosted MiniMax chat guard, native Agent output serialization, and unchanged reasoning-only length continuation protection). TypeScript and Vite production build also PASS. These tests contain synthetic provider responses only; they are **not** model inference. The existing unrelated full suite, Rust/Cargo build and a new acceptance mission were not run for this task.

- `src/modules/ai/lib/agentOutputBudget.test.ts`: cases A–F, positive/default-on/mandatory, unknown/unsupported effort, disabled/unknown reasoning, contradictory evidence, missing/stale/cross-identity metadata, missing and smaller output caps, explicit lower pins; preserves self-hosted native `num_predict=8192` fixture.
- `src/modules/ai/lib/hostedOutputBudgetAudit.test.ts`: production OpenRouter model construction + preflight + real AI SDK serializer with **all fetches intercepted**, output/control-field assertions, chat unchanged, provider-cap/missing-cap/disabled-reasoning variants, no model requests.
- `src/modules/ai/lib/contextPreflight.integration.test.ts`: a **real Clack transport/runAgentStream path** selects a native directory tool under a fresh trusted default-on hosted reasoning catalog record and verifies `max_tokens: 8192`, nonempty native tool schema and **no effort-control field**. Provider calls are intercepted with synthetic SSE.
- Existing `providerModelEvidence`, `providerContext`, `reasoningEffort`, `requestPreflight`, `contextBudget`, `answerContinuation` and `lengthContinuationAudit` tests continue to protect metadata identity/freshness, serialization semantics and fail-closed continuation.
- `modelSwitchCapacity.integration.test.ts` exercises the shared real session-send path and preserves `max_tokens: 2048` for an ordinary hosted MiniMax chat with no exposed native tools. This regression directly prevents the broader first attempt from shipping.

No changes to production context/timeout calibration, Ollama, settings/profiles, tools/permissions, compaction, continuation, provider adapter or frozen run artifacts. No local or hosted inference, ForgeBoard, reset, clean, push or destructive cleanup.
