# Clack — next bounded implementation handoff

Prepared after the 18 November 2026 master roadmap reconciliation. **Prepared only; not sent.** This is the **single** next bounded implementation specification, selected by critical B01–B03 prerequisites ahead of runnable qualification rather than by historical ordinal number. Product edits begin only after the user explicitly authorizes this task; the reconciliation itself authorizes documentation changes only.

## Objective

Close the LM11 execution-safety prerequisites **offline**: one enforceable aggregate wall-clock budget from admission through pre-dispatch/readiness/inference/native settlement and evidence persistence, plus cancellation that prevents any later dispatch when requested before inference registration. Keep Qualification Lab Run actions disabled in this checkpoint. Do not start LM16, a qualification campaign, another architecture, or broad UI work.

## Read and establish the actual baseline

Work in the existing /clack repository. Read AGENTS.md, CLACK.md, docs/AGENT_ENGINEERING_STATE.md, docs/COS_FULL_PLATFORM_AUDIT_2026-10-22.md, docs/PRODUCTION_HARNESS_RECONCILIATION_2026-11-18.md, docs/PRODUCTION_HARNESS_TRACEABILITY_2026-11-18.md and docs/LM11_LM15_LOCAL_MODEL_QUALIFICATION.md. **Governing specification:** user-designated 20-page `CLACK — Master Project Handoff + Authoritative Roadmap Requirements` (18 November 2026). The separate earlier text source docs/PRODUCTION_HARNESS_SOURCE_2026-11-18.txt has verified SHA-256 0d4e23f0d107b2f44391790ad6e3d98e702f973c68aa4590571ae7f642d704d1 and underlies the retained R-series, **not** the governing DOCX. The H-series maps its available requirements; original DOCX digest and mechanical page-level audit remain Unverified. If the exact DOCX is available in the next authorized session, verify its provenance and omissions without rewriting historical evidence. Preserve the full LM/TF/AR/P2–P19 roadmap; do not narrow it to this task.

Do a read-only audit before editing. Last verified HEAD was 50fca4689692bc1e85f9ffd4ae644ff528cc056e, main, parent bb8dc47577e2339531b1710e591b0db67365f9c9. This is a checkpoint reference, never an assumption about your current checkout. Inspect actual HEAD/parent/branch, expanded tracked/untracked status, staged diff/raw index, stashes, accepted history, roadmap edits and evidence.

The original 81 user-owned paths must match src-tauri/target/lm2f-validation-20261117/reconstructed-protected-81.tsv; ordinal path<TAB>lowercase-sha256<LF> aggregate is 339aba89d167b45a0cca1f663293fd3fa6197f63f0b2e4cab7f444b90670c104. Original stashes: 6a7bc6beef913a323052b277f766ae32be11bae1 and b96fc46d783f1635acec2278deed7b43479f5f9a. Raw index hash at reconciliation entry was 5cd3574caaa8fc3ec4d01e79cbd8f6edb90573600df927e068a3d1b1c144f211 with no staged changes. Preserve subsequent authorized work too; never reconstruct files to match a stale baseline.

New unstaged roadmap documents from this reconciliation are authorized planning work, not unexpected source damage. Distinguish them from the original 81 protected paths. STOP without modification on any unexplained preservation discrepancy. Intentional deletion of src-tauri/target/debug and src-tauri/target/codex-test is accepted cleanup: no recovery or restoration.

## Existing owners and candidate edit boundary

Inspect current implementations and tests first:

- src/modules/ai/lib/deploymentQualificationRuntime.ts and deploymentQualificationFlight.ts;
- src/modules/ai/lib/deploymentMeasurementRuntime.ts and deploymentMeasurement.ts;
- src/modules/ai/lib/qualificationLabPlan.ts and the existing Lab component/tests;
- existing inferenceLifecycle/inferenceAdmission, session write/CAS and chatRuntime dispatch boundaries;
- native net/inference admission/cancellation only if required by a reproduced ownership gap.

Use the existing Compute Fabric deployment identity, LM2F qualificationReceipts, LM6 measurementRuns, native cancellation, session persistence and permission/effect authorities. Do not add another model registry, scheduler, permission engine or result ledger. Name a narrow file allowlist, baseline tests and rollback before editing. Avoid every original protected path. If a necessary change overlaps user work, stop that dependent edit and report the precise conflict.

## Required behavior

1. An immutable absolute monotonic deadline owns the complete operation. Propagate remaining budget and cancellation through admission, native status/readiness, route preflight, session writes/preparation, dispatch, inference, native terminal/quiescence observation, receipt evaluation and CAS persistence. Keep existing requested budgets/output/attempt limits; no timeout extensions or retry-to-pass.
2. Cancellation before an inference ID exists establishes an operation-owned no-dispatch state. Recheck after each await and immediately at the native dispatch boundary. Cancel any genuinely late registered request by exact owner/ID without affecting other consumers. A Promise.race returning early while work can later send a request is a failing implementation.
3. Distinguish SDK settlement, native terminal acknowledgement, bounded quiescence, persisted outcome and unknown persistence. Define safe behavior when CAS/storage cannot acknowledge inside the budget. Late callbacks cannot fabricate success, overwrite a cancelled/failed outcome, add dispatches or replay effects.
4. Preserve deployment/artifact/configuration/runtime version/PID/epoch and procedure scope; identity, revocation, shutdown and wrong-owner changes fail closed. Existing negative/historical receipts remain unchanged. Unsupported procedures retain null runners/zero allowance.
5. Keep Lab Run disabled until a separate independent safety review and separately authorized real UI/runtime acceptance satisfy B01–B03. Offline success is not production qualification or authorization to run a model.

## Independent verification

First reproduce the gaps with deterministic delayed admission/readiness/session-write/preparation/dispatch/persistence boundaries. Cancel or expire at each boundary, then release the delayed work and prove zero later dispatch and no late success receipt. Include pre-registration and post-registration cancellation, deadline just before/after dispatch, stalled native terminal, SDK success without terminal, CAS conflict/stall/ambiguous completion, identity/epoch change, shutdown/restart, concurrent unrelated consumer and duplicate call. Verify bounded terminal reasons, unchanged attempt/output counters and no effect replay.

Run focused current-source tests and type checking/build as appropriate to actual edits. If native code changes, run focused native cancellation/admission/ownership tests and applicable required Rust checks. Exclude archived src-tauri/target source copies. Record exact executed commands, exit/results, failures and limitations; do not reuse historical test counts as new results. No model or runtime process launch is needed or authorized.

Update only affected canonical status/acceptance docs with exact source/test evidence and residual gaps; preserve the entire architecture requirement matrix and historical records.

## Restrictions and closeout

No reset, clean, stash, amend, rebase, overwrite of unrelated work, commit or push. Leave task changes unstaged. No inference, model download, runtime installation, GPU/driver/system/Ollama/network/SSH setting change, ForgeBoard, recovery attempt, historical-evidence mutation or protected-source mutation. Do not kill/restart the user's applications. Do not spawn other workers unless separately requested.

Return RESULT / CHANGES / VALIDATION / BLOCKERS: exact files, reproduced defects and final semantics, actual passing/failing checks, preserved 81-file aggregate/index/HEAD/stashes and subsequent roadmap work, remaining safety/acceptance gaps, and the next bounded recommendation. Do not claim Lab runnable, candidate-ready, Agent proven or production-ready without the corresponding independent evidence.

## Next bounded implementation task after this offline checkpoint

**Prior prompt status:** the user subsequently authorized and executed the LM11 **source-only** B01–B03 hardening described above. The resulting [LM11 checkpoint](LM11_LM15_LOCAL_MODEL_QUALIFICATION.md#authorized-lm11-offline-execution-safety-checkpoint--18-november-2026) is Partial: current-source offline tests pass, but a native B03 storage-commit uncertainty prevents complete deadline/terminal acceptance. This section is a new **prepared, unsent and not yet authorized** next task, preserving the original prompt as its historical input.

**Paste-ready next implementation authorization request:**

> CLACK — LM11 B03 Native CAS Deadline/Unknown-Commit Closure (offline only). Recheck current /clack HEAD/main/index/original stashes/81 protected SHA baseline and preserve all prior authorized source and roadmap edits. Inspect the existing `src-tauri/src/modules/self_hosted_profiles.rs`, `src/modules/settings/selfHostedPersistence.ts`, LM2F/LM6 qualification runtime/flight/transport, native inference cancellation and their current test suites. Reuse the **existing** native self-hosted store and effect/receipt ownership: do not create new persistence or effect ledgers. Implement the minimum operation/epoch-bound commit admission, deterministic native outcome/acknowledgement or recoverable ambiguous-commit reconciliation necessary to prove that an aggregate-deadline cancellation cannot silently become a qualifying receipt after the webview has returned Unknown. Distinguish aborted before native commit, atomically acknowledged commit, CAS conflict, stalled native disk save, stale deployment/runtime epoch, restart during commit and unacknowledged outcome. No retry-to-PASS, duplicate or revoked effects, and no callback that treats a late IPC success as current qualification. Fault-inject every native await/lock/save/ack boundary offline with a fixed attempt denominator; prove unrelated settings/readers and both original stashes remain intact. Update the affected LM11/tracker acceptance status only from independently executed current tests. Keep **all Lab Run controls disabled**. No live model inference, runtime/model download, GPU/driver/system/Ollama/network/SSH changes, ForgeBoard, deleted Cargo cache restoration, source archive or historical receipt mutation, staging, commit or push. Return exact files/tests, preserved baseline, residual ambiguity, and whether B03 then qualifies for a *separately authorized* live/native UI acceptance milestone. Do not infer a production-ready Local Model Compute or Agent candidate from offline tests.
