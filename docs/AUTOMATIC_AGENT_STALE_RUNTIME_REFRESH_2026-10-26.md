# Automatic Agent stale runtime-observation continuation repair — 2026-10-26

## Scope and decision

Starting HEAD: `d2eea4d4672d259bb80a5912e6f31323ad9e1914`.
This is a generic self-hosted Ollama Automatic logical-continuation fix, **not** a Muse-only policy change. The 30,000ms observation TTL, calibration candidate ladder, exact-tier native-tool proof, prompts, output allowance, Automatic reasoning, approvals, 180s stream-idle and 600s overall deadlines remain unchanged.

**Final Muse acceptance mission not started:** the required broad continuation/native-safety suite is not completely green at starting HEAD or at this fix. Three existing R5y tests fail identically in an isolated read-only archive of the exact starting HEAD. These failures were not repaired or silently excused. A further authorization/validation decision is required before spending the conditionally authorized single final Muse mission.

## Exact production defect

`runAgentStream` in `src/modules/ai/lib/agent.ts` enters Automatic logical-continuation eligibility before invoking `buildConfiguredLanguageModel`. It reads cached native reasoning evidence and calls `agentContinuationReasoningMetadata`, `modelOnboarding`, `automaticAgentBatchContext`, and `applyAgentRecommendation`. `toolVerificationState`/`toolScope` and `trustedContext` require a native runtime observation newer than 30s. A healthy native generation exceeding 30s can therefore make the original native-tool scope appear `Stale` even though model digest, provider version, native runtime epoch, exact native proof and calibration remain valid. `applyAgentRecommendation` throws `Automatic Agent configuration is not verified...`. The subsequent `requestPreflight.refresh()` would inspect the runtime, but is never reached.

Historical evidence: Muse `inference-34` dispatched at `1792967446611`; the continuation rejected at `1792967492953`, a 46,342ms gap. The recorded 49,152 native proof and calibration were both unexpired. The existing read-only production-predicate reproduction switched from `Stale` to `Verified` by changing only the runtime observation age. This report does not revise the historical acceptance result.

## Scoped fix and failure closure

Only on a *stale observed* native runtime at an Automatic logical continuation, `refreshStaleAutomaticContinuationRuntime` screens the captured record and exact context against retained ID/variant, native-tool protocol, fresh proof/confirmation, negative observations, recorded model ID/full digest/deployment/endpoint/backend, provider version, epoch, reasoning identity, calibration expiry and identity, recently observed loaded tier, and a fresh matching cached native provider model. Missing or mismatched operands stop before inspection.

It then performs **one** bounded forced native context-runtime inspection (`self_hosted_context_runtime`) and **one** bounded genuine native provider refresh (`self_hosted_probe`), each with a 30s failure/cancellation boundary, and demands the original epoch/version/configuration, full model digest and loaded context. It checks `snapshotContext` (unchanged trusted calibration and requested/loaded/allocation evidence) and `configuredToolState` (unchanged native proof validator) before allowing the existing Automatic selectors to run. Any failure, timeout, cancellation or changed evidence fails closed. The original proof and calibration are never written or reissued. No fallback to another proof/context and no refresh loop is introduced. Normal preflight, including authoritative stored-proof comparison and native-HTTP final ACK revalidation, remains in place.

## Tests and validation

- New production-path Vitest coverage in `r5zCurrentProof.test.ts`: 14 passing cases, covering unchanged in-TTL behavior; 46,342ms matching native refresh and immutable proof/calibration; digest/epoch/version changes; native inspection failure and timeout; expired proof/calibration; invalid protocol; mismatched loaded context; peer-reply-only tool restrictions; last-moment proof revocation at native ACK; failed provider refresh without repeated inspection.
- Full `r5zCurrentProof.test.ts` plus its existing companion suite: **88/88 pass**.
- Focused 10-file eligibility/runtime/trust/proof/preflight/continuation sweep (`--exclude '**/src-tauri/target/**'` to exclude the isolated baseline copy): **356 passed, 3 failed / 359**. All three failures are from unmodified `r5yProductionSafety.test.ts`: (1) changed loaded context 4096 expects a different error string, (2) unavailable loaded context 0 expects an early rejection, and (3) wrong alternate proof expects a different error string. On an independent `git archive HEAD` snapshot of exact original `d2eea4d`, the same three failed and the other 32 R5y cases passed. Therefore none are introduced by this patch; importantly, the suite as a whole is **not PASS**.
- `npm.cmd run check-types`: **PASS**.
- `npm.cmd run build`: **PASS**; existing Vite chunking/performance warnings only.
- Native Rust `modules::inference_probe::context::tests::`: **1/1 PASS**.
- Native Rust `modules::net::inference::tests::`: **39/39 PASS**, including real 61-second native silence/resume.
- `git diff --check`: **PASS** (Windows line-ending conversion warnings on existing files).

## Preserved state and acceptance gate

The six original user-owned dirty files were not changed, staged, formatted or reverted. Their SHA256 hashes match the protected records at `docs/AGENT_ENGINEERING_STATE.md` lines 76–81; the original operator settings SHA256 remains `2d39dcfdd946acc733ba77ac1c8e68a226aeb46f013e68902a71002bd54592bb`. Both stashes, `autonomous_tracker/`, historical evidence and all provider/models/settings/SSH identities were left intact. No Git reset/clean/push, model inference, fresh Muse qualification, notes acceptance mission, manual notes-app repair, or ForgeBoard mission was performed in this repair task.

**Gate status:** generic fix tested and committed separately; full required regression suite remains RED due to three independently baseline-reproduced failures. The conditional single `muse-glimmer:30b` mission must **not** be called accepted, model failed, or attempted. Those classifications require a genuine, fair, fully validated post-fix run.
