# Long-running Agent context-calibration lease: production lifecycle audit and fix

**Audit baseline:** Git HEAD `3b4deb18e7210e5ee77480defd2e4dc5fbc26edb`, November 4, 2026.
**Classification:** **LONG-RUNNING AGENT CALIBRATION RENEWAL GAP PROVEN** (at baseline).
**Generic Agent orchestration defect:** **YES; a bounded, production-safe, model-neutral fix is implemented and verified offline in this commit.**
**Original November 3 incident classification:** **CONTINUATION ALLOCATION PROTECTION OPERATED CORRECTLY** (unchanged).
**Muse acceptance:** **UNINTERRUPTED MODEL ACCEPTANCE NOT PROVEN** (unchanged).

## 1. Original production lifecycle (before this commit)

Clack's context trust consists of **independent**, separately time-scoped objects:

| Component | Owner, qualification and lifetime |
| --- | --- |
| Context calibration | `contextCalibration.ts:runContextCalibration`; native-context model inference at each ladder tier and subsequent metadata inspection; `CONTEXT_CALIBRATION.evidenceMs = 900_000` (15 minutes) |
| Calibration lifecycle and persistence | `contextCalibrationRuntime.ts:calibrateModelContext` acquires/releases an exclusive native `self_hosted_context_lease`, sets a distinct inference owner, invokes the calibration engine, persists via `updateSelfHostedProfiles` / `contextCalibration.ts:commitContextCalibration`; `ensureSelectedContext` is the normal selection helper |
| Runtime identity | `contextRuntimeClient.ts:inspectContextRuntime` and `contextCalibrationTrust.ts:contextRuntime`, binds provider version, process/runtime epoch and endpoint revision; 30-second fresh observation |
| Native loaded allocation | `selfHostedProbe.ts:createSelfHostedProbeClient`, `contextCalibrationTrust.ts:contextMetadata` and `observedRequestedContext`, binds measured requested context and subsequently reported `loadedContext` / `runtimeAllocation`; 30-second live observation |
| Tool proof | `toolVerificationRuntime.ts:verifyModelTools`, `ensureVerifiedAgentTier`, `toolVerification.ts:runToolVerification`, `configuredToolState`; exact tier/protocol/model/epoch/reasoning, 24-hour proof TTL, separately checked |
| Final dispatch | `requestPreflight.ts:createRequestPreflight.prepare` closure; evaluates runtime target, digest, fresh calibrated tier and captured exact proof **immediately before the native HTTP acknowledgment** |

The calibration record scope includes endpoint ID/revision, model ID, deployment, digest, backend, runtime epoch, provider version and reasoning identity. The seven possible candidates are 4,096, 8,192, 16,384, 32,768, 49,152, 65,536 and 73,728. `runContextCalibration` validates actual requested/loaded context and allocation after each real stream; it cannot be renewed merely by `self_hosted_probe` or `self_hosted_context_runtime`. A new cold full-ladder qualification may perform up to seven candidate inference requests, plus at most one restore attempt on the supported failure path, with eight total request budget, 240-second wall limit, 75-second per-request limit, and 32-token output.

Other original entry points:

- `src/modules/ai/hooks/useModelSwitch.ts:request` invokes `ensureSelectedContext` upon model selection.
- `src/settings/components/ContextCalibrationControl.tsx` lets the operator force a calibration from Settings.
- `src/modules/ai/lib/transport.ts:run` invokes `ensureSelectedContext` at **non-logical** initial Agent/chat batch preparation.
- `src/modules/ai/lib/agent.ts:runAgentStream` invokes `ensureSelectedTools` for initial Automatic Agent qualification, then pins the accepted exact-tier native proof on logical continuation. `agentConfiguration.ts:refreshStaleAutomaticContinuationRuntime` can refresh an aging **runtime observation**, but expressly refuses to use an expired calibration as a waiver.
- `contextCalibrationTrust.ts:trustedContext` invalidates calibration on expiry, runtime epoch/version, digest, endpoint revision, reasoning or loaded/allocation mismatch. `minimumSafeContext.ts:freshVerifiedContextTiers` then returns no qualified tiers.

**Gap:** Before this change, `transport.ts:run` expressly **skipped** `ensureSelectedContext` when `batch.isLogicalContinuation` was true. During a single `streamText` batch, `agent.ts:prepareStep` could prepare further provider generations but never initiated calibration renewal. The next request therefore reached the still-correct `requestPreflight.ts` final stale-calibration guard and failed. No automatic path could obtain **new calibration** for the same run, and the native-tool verifier was deliberately unavailable in a logical continuation without new qualification. `streamRecovery.ts:recoveryAvailability` also treats the terminal `bad_request` as not automatically recoverable.

Thus, **not every Agent has a 15-minute wall-clock ceiling**. Ordinary chat, manually pinned contexts, non-Ollama/hosted models, short self-hosted runs and requests completed before expiry are different. But a sufficiently long-running **Automatic self-hosted Ollama Agent using calibrated context and native tools** could outlive the original calibration lease and have its **next** inference rejected. Fresh allocation/runtime/proof alone could not change that, and a completed in-flight generation must not be cancelled for expiry.

The November 3 Muse session exercised exactly this gap: `inference-36` started 6.884 seconds before calibration expiry and finished normally, while `inference-37` was submitted 3.317 seconds after expiry. All saved 49,152-tier metadata and tool proof could still be fresh; the 900-second calibration was not. **Its preflight rejection was correct. The missing new-trust orchestration before that rejection was the separate generic issue.**

## 2. Implemented safety-preserving lifecycle

Production uses one **bounded, real, selected-tier requalification**, never a TTL extension:

1. **Safe boundary:** `transport.ts` checks before a new logical continuation batch; `agent.ts:runAgentStream` checks inside `streamText.prepareStep` **between completed provider generations**, before the next provider request or tool-exposure recalculation. It does not inspect/cancel an in-flight generation. Renewal is due when the retained calibration will expire within 30 seconds or is expired.
2. **Scope/ownership:** `agentCalibrationRenewal.ts:renewAgentCalibrationAtBoundary` accepts only an already captured exact-tier proof from the same Agent/model; rejects changed owner/aborted signal, backend/manual pin, endpoint settings, digest, provider version, runtime epoch or proof identity. It re-reads authoritative persisted state and force-inspects the runtime **before** any qualification inference.
3. **Genuine selected-tier calibration:** `contextCalibration.ts:runContextCalibration` now accepts `renewalTier` only when the previous verified calibration contains an **actually successful requested-and-loaded** attempt at that same tier. Its calibration scope must still match. It creates a new record/ID and performs **one** actual output-limited native context calibration request at the exact tier. It does **not** carry forward the old upper ceiling, earlier attempts, old allocation or old expiry. Status/loaded allocation/epoch/digest must all pass as in the standard full-ladder path. Existing 75-second request, 240-second wall, exclusive native lease and error/backoff bounds still apply.
4. **Native tool proof:** If original exact-tier native proof remains fresh and eligible under the unchanged runtime/digest/reasoning scope, it remains valid without inference renewal. Otherwise `toolVerificationRuntime.ts:ensureVerifiedAgentTier` runs the real bounded `get_probe_value` verification at the selected tier and variant. It can issue up to five physical requests (output allowances 512, 1,024 and 2,048, plus bounded alternative handling), with its original 120-second deadline. No native proof is minted by metadata or context calibration.
5. **Loaded allocation:** After any proof verification, runtime identity is force-inspected again. Native cache is read and, if stale, missing or mismatched, refreshed **once**. The new calibration and native-loaded context/allocation must agree on the exact selected tier. Unavailable refresh fails closed. No loop.
6. **Same logical task:** `transport.ts` updates its run-scoped `preparedHosted` evidence and retained exact proof before entering `runAgentStream`; `agent.ts` updates the current stream's captured state/proof and notifies its existing `onSelfHostedPrepared` callback after a successful per-step renewal. No user message, prior tool effect, conversation or logical run ID is restarted. Provider retries and historical tool state remain governed by existing guards.
7. **Final preflight untouched:** `requestPreflight.ts:updateModelAgentTrust` swaps only private, newly qualified evidence in the already-selected model's preflight. An independent, exact `sameAgentRenewalIdentity` comparison allows just the *real calibrator's measured `recommendations.workingContext`* to change; all other original settings/recommendations still must match. The cached budget identity is replaced only after that narrowly verified update. **Original** exact-tier, final snapshot, proof ID/scope/timestamp, runtime target, validated cost and native ACK guards remain unchanged. A later changed allocation or superseded proof is refused before dispatch.

The implementation is intentionally restricted to **the provider that currently implements native context calibration: self-hosted Ollama**. It does not special-case Muse, any particular token count, long response duration or a backend beyond the existing native calibration contract. Manual working-context overrides and ordinary chat remain outside the Automatic Agent renewal path.

### Cost and boundaries

| Situation | Automatic additional qualification |
| --- | --- |
| Fresh calibration with more than 30 seconds remaining | None |
| In-flight generation crosses expiry | None during generation; may finish normally |
| Next Agent generation/batch due for renewal | **One** real calibration inference at the **previously successful active exact tier** |
| Matching unexpired native-tool proof after calibration | **Zero** additional tool-verifier inferences |
| Expired/missing exact-tier proof with otherwise unchanged identity | Existing native-tool verifier may run, bounded by its **five-request / 120-second** contract |
| Epoch, digest, settings or provider identity changed | No silent migration; fail closed |
| Calibration, proof or allocation cannot be freshly established | Fail closed with a specific renewal or existing context/proof error |
| More than one renewal needed over a multi-hour task | At most one qualification operation per due boundary; new lease starts from actual successful measurement; **no automatic retry/refresh loop within an operation** |

An Agent using the renewed 49,152 tier will have **49,152** as the fresh calibration's highest tier; it cannot borrow the old seven-tier ceiling or upgrade to 65,536/73,728 without separate real qualification. The next request's full serialized history, tool schemas, output reserve and margin must still fit this tier under ordinary preflight budgeting. This can legitimately fail as the conversation grows; renewal does not truncate history or expand context silently.

## 3. Offline simulation and regression evidence

`src/modules/ai/lib/agentCalibrationRenewal.test.ts` constructs a **generic synthetic** Automatic Ollama profile, genuine seven-tier calibration history and recorded exact-tier tool proof, then exercises the **actual production** `runContextCalibration`, `renewAgentCalibrationAtBoundary`, `freshVerifiedContextTiers`, `automaticAgentRecommendation` and `createRequestPreflight` functions with injected mock native observation, mock native generation completion and fake Date. **No Ollama, Muse, hosted model, network request or runner is invoked.**

Coverage includes fresh lease unaffected; in-flight generation not cancelled when expiry passes; expired next generation blocked; genuine one-tier renewal and restored eligibility; no immediate repeat-renewal loop; epoch change before or during qualification; digest change before/during renewal; noncalibration settings/recommendation mutation; fresh and expired exact-tier proof requiring bounded reverify; tool reverify failure; stale/offline allocation after requalification; loaded-context mismatch; failed calibration; superseded owner; **same preflight object** accepts freshly qualified evidence but still rejects a changed loaded allocation during its final dispatch closure.

**Recorded validation:** Offline lifecycle tests **14/14 passed**; expanded targeted continuation/preflight/calibration/native-tool/context/answer suite **619/619 tests passed across 20 discovered files**, including the latest hardening controls; no live model use. TypeScript `npm run check-types` **PASS**. Production `npm run build` **PASS** (non-fatal Vite dynamic-import/timing warnings). No Rust source was modified, so no Rust test was necessary.

## 4. Preserved evidence and acceptance

The historical 37 native requests, the complete Ollama TRACE, original November 3 frozen evaluator verdict, independent source hashes and previous acceptance reports are **unchanged**. Original six dirty tracked files and their hashes, both stashes, `autonomous_tracker`, operator/system Ollama settings, system service/model store and original forwarding remain protected. No reset, clean or push.

**Final classification: LONG-RUNNING AGENT CALIBRATION RENEWAL GAP PROVEN.** The generic safe-boundary orchestration gap was established and corrected; the original stale-calibration **guard itself remains correct**.

**Would another Muse acceptance be justified?** A separately authorized end-to-end acceptance could now meaningfully validate this new continuation capability, but **this report is not acceptance**. The code has only been verified through offline mocks and static build; it does not prove real long-session model behavior. **No new Muse or any other model run is authorized or initiated here.** The previous Muse result remains **UNINTERRUPTED MODEL ACCEPTANCE NOT PROVEN**.
