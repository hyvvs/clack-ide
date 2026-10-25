# Per-tier genuine native-tool proof for minimum-safe Ollama Agent context

**Date:** 2026-10-25. **Starting HEAD:** `b034972952d65fe7cb6e729afff157a2fd6c17fc`. **Scoped production commit:** `1f787b5f6c549eaf041f9c7a290171c0f32c73eb`. No other model test, acceptance mission, ForgeBoard, hardware change, persistent Ollama tuning or unrelated repair.

## Previous behavior

Clack's earlier safe-tier selector measured the *entire serialized* Ollama request, full resolved output allowance and conservative margin, but for tool-bearing requests only selected a smaller tier when `automaticAgentRecommendation` already found an exact-context native-tool proof at that tier. Historical GLM proved its tools at 65,536. Consequently, even when a request fit 32,768, no proof existed at 32,768 and Clack retained 65,536. This was secure but defeated safe-tier optimization for previously verified Agents.

## New model-neutral production behavior

1. Retain prior fresh calibrated-tier selection: only proven requested=loaded successful tiers for the exact model digest, endpoint/revision, runtime epoch/version, provider reasoning identity, live allocation and expiration. Run `minimumSafeContext` on the final serialized *system + complete messages/history/tool results + exposed native schemas + full resolved output + margin*; select the smallest fitting tier. No request content is pruned to force a reduction.
2. A tool-bearing Agent may choose the safe lower tier even without an existing matching tool proof, but cannot dispatch then. A bounded preflight invokes `ensureVerifiedAgentTier`, which uses the **existing** `verifyModelTools` / `runToolVerification` and **real** `get_probe_value` native schema at exactly the selected `num_ctx`. The existing genuine arguments, output ladder (512/1024/2048), bounded request budget, negative observations, native transport, model/reasoning controls and alternate-reasoning independent confirmation are preserved. No simulated/textual tool call qualifies.
3. A bounded `agentToolTierProofs` array in the existing persisted profile (at most 18 independently scoped records, unique by tier and reasoning configuration) holds each additional context's proof. The original primary tool verification and alternate records remain untouched. Context-sensitive `verificationRecord`, `configuredToolState`, `automaticAgentRecommendation` and normal scope validation require the *exact* proof tier, protocol, reasoning identity, digest, runtime epoch/version and fresh TTL; a 65K proof never qualifies a 32K Agent.
4. If the tier has a current eligible matching record, reuse it without another probe. If not, genuine verification must succeed and be persisted. A failed, incompatible, incomplete, stale, revoked or mismatched probe blocks the entire new Agent dispatch; there is no silent fallback to the larger context or transfer of verification.
5. After verification changes the loaded KV allocation, refresh the native metadata, re-read authoritative current settings, verify scope, rerun full budget at selected tier and the original route, and compare **proof ID, exact context, complete scope, proof issuance and expiry and alternate confirmation again at the final native IPC preflight ACK**. A last-moment proof revocation is refused. Only `options.num_ctx` is rewritten; `num_predict`, messages, all tool schemas/results, permissions and cancellation remain unchanged.
6. Manual configured/working context, provider ceilings and caller output remain authoritative; a conflicting manual context or continuation pin fails closed. A logical Agent continuation finds the *retained record ID and its context*, not an arbitrary fresh 65K proof, and revalidates the exact stored record. It cannot reuse a proof from another tier or restart an interrupted external effect.

The prior calibration/Automatic setup still uses a genuine normal high-context proof. A new initial Agent response can downshift only after separate low-tier verification. A later larger request moves to the next fitting freshly calibrated tier and independently checks/probes **that** tier's native proof. This is generic Ollama policy, not a GLM-specific exception.

## Scoped regression and build evidence

* Focused **nine** Vitest suites **224/224 PASS**: context budget, calibration, source and proxy preflight, Ollama route capture, exact-tier verifier storage, genuine verification path decision, stale/failed/incompatible/revoked proof refusal, digest/runtime version/epoch changes, manual working limit, tool/history preservation, output reserve, request growth to 49K/65K, logical continuation record ID, existing tool verification and Agent budget. One final regression specifically revokes a tier proof *after* request preparation but *before* native ACK and proves refusal.
* `npm.cmd run check-types`: **PASS**. `npm.cmd run build` (`tsc && vite build`): **PASS**; 1,283 modules, Vite finished in 13.04s (existing import/plugin warnings).
* `cargo test --locked --lib modules::net::inference::tests --target-dir target/codex-test`: **37/37 PASS**. No Rust production timeout or native transport changes. Archived/full-suite and unrelated historical failures were not in scope.

## Exactly one bounded live GLM dry probe: blocked before the target tier

Exclusive ephemeral diagnostic root `src-tauri/target/glm47flash-tier-proof-20261025-01/`, using a separate initialized Git workspace, a separate copy of the original checked settings and original pinned SSH loopback. User's main settings, source workspace and earlier evidence untouched. Diagnostic scripts: `scripts/r5ax-glm-tier-probe.mjs` and `src/test/glmTierProbe.ts`. Host was the existing normal Rust Tauri example with production Clack modules and an Agent constrained to **one read-only list_directory tool**, no application-building instructions, no writes or tool effect.

Only approved installed `glm-4.7-flash:q4_K_M` digest `4475827791a269b02c8ec49b1c3bc1abb5846bacf3fae015b75d33986322d8f6` on Ollama `0.40.11` was involved. Host PID **34348**, runner session **10598**. One and only one native request in `glm-tier-proof-01.requests.jsonl`: **`inference-1`, `num_ctx=4096`, `num_predict=32`, 0 native tools, Automatic `think` omitted**. Ollama journal observed HTTP **200** for that calibration at about 07:32:27 local (~4.48 seconds HTTP wall), with a native 32-token evaluation (~59.64 tokens/s). Despite that provider completion, the isolated client issued **no second calibration request, 32K native-tool verification, or Agent request** and produced no browser final report. It remained nonprogressing. Do **not** infer that the provider was dead or the new selector was reached; the precise frontend/SDK boundary cause is unproven.

The task-owned host PID **34348** was stopped after the stall, and the one-shot runner exited nonzero; original probe evidence and isolated workspace were kept. **No retry, second model or acceptance mission** was performed. The dry run therefore **did not empirically demonstrate an actual 32K verification or 32K Agent wire**. In particular:

| Measurement | Result |
| --- | --- |
| 32K safe tier selection on complete test request | **PASS in production preflight/serialized-wire regression; NOT reached live** |
| Verification tier | **32,768 in real verifier-code/test harness regression; NOT dispatched live** |
| Live Agent context | **NOT OBSERVED** (no Agent inference) |
| Resolved `num_predict` | **8,192 in focused Agent request fixture; NOT OBSERVED live** |
| Live native requests | **1**, only calibration at 4,096/32 |
| Timeout policy | **Unchanged**; 60s meaningful-stream idle |

**Classification:** Generic scoped exact-tier proof feature is implemented and regression/build validated, but its requested GLM **live production-path demonstration remains incomplete**. This must not be described as a qualified or accepted notes mission or a successful live 32K dispatch. An independently authorized future isolation of the calibration-to-next-request boundary would be needed to complete that validation; do not implicitly rerun in the present task.

Six original user-dirty files, both stashes, original settings/profile data, tracker, operator model inventory, original pinned SSH tunnel and all historical evidence are preservation requirements. **STOP; R3d OPEN; P2–P19 deferred/mandatory; no model acceptance.**
