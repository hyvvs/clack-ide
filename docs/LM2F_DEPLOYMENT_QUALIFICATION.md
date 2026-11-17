# LM2F — Deployment qualification architecture and evidence

## Baseline architecture audit (before LM2F changes)

Baseline HEAD: `18c755f30019f14bd44920e24d56f64219e2515a`; parent
`660343f0f819361c5f15a1679c043a93768abfbc`. The Git index was
empty, both prior stashes were intact, and the exact 16 modified tracked +
65 untracked paths had a sorted `path<TAB>SHA256<LF>` digest of
`339aba89d167b45a0cca1f663293fd3fa6197f63f0b2e4cab7f444b90670c104`.
Those paths, the model import, LM2D/LM2E evidence and native runtime must
remain untouched. LM2E acceptance is not part of this qualification milestone.

The authoritative store is `selfHostedInference` in native compare-and-swap
settings (`selfHostedPersistence.ts`), not an independent qualification DB.
`localComputeFabric.ts` projects `ComputeHost → LocalRuntime →
ModelArtifact → ModelDeployment` from the endpoint/profile/inventory registry;
independent conceptual managed GGUF deployments live within the same
`state.fabric`. The legacy Ollama profile owns native-tool proofs and
calibration records, checked by `toolVerification.ts` and
`agentConfiguration.ts`. The managed GGUF adapter uses native runtime
admission and explicitly denies automatic native Agent tools. Existing
`deploymentQualificationScope` and `deploymentQualificationState` provide
strong host/runtime/artifact/config/epoch matching and negative-transfer tests,
but their v1 receipt is transient, lacks a procedure/observed-evidence record,
and is not persisted as an authoritative generic capability qualification.

Runtime declarations (`localRuntimeAdapters.ts`) intentionally distinguish
`supported / unsupported / unknown / requires-qualification`, but declarations
are not model qualification. The Ollama native-tool proof is an independent,
runtime-epoch/context/reasoning/protocol-scoped lease. The model picker in
`AiStatusBarControls.tsx` distinguishes Ready Chat-only managed deployment
from Agent readiness, but has no cross-capability qualification summary.
`runAgentStream` rejects managed Automatic Agent before providing any native
tools; Ollama automatic selection reads the exact legacy proof.

## LM2F invariants and intended extension

1. **Never transfer from a runtime declaration.** A positive authorization
   requires an independent current deployment receipt, in addition to a
   compatible declared runtime capability. An unsupported declaration denies.
2. **Single registry.** Bounded historical capability receipts live as an
   additive versioned field of the existing CAS-owned `state.fabric`. No
   writable parallel qualification store; no mutation of legacy Ollama proofs.
3. **Exact identity.** The execution-bound scope includes authoritative
   deployment ID and configuration, host/runtime IDs, implementation/version,
   runtime configuration revision, model artifact ID/digest and epoch. A
   deleted/recreated deployment cannot inherit a preceding ID's proof.
   Explicit procedure-specific context, tool protocol/schema, and persona
   identities are included wherever relevant.
4. **Observed evidence only.** Receipts identify a deterministic bounded
   observation and procedure version, its outcome and expiration. Provider or
   model self-assertions cannot be accepted as verifier evidence.
5. **Historical vs. current.** Old receipts remain for audit but are never
   authority after invalidation, expiry, offline/disabled state, missing fresh
   native observation, schema mismatch or unknown capability.
6. **Independent capability decisions.** Chat, streaming, cancellation,
   terminal completion, JSON mode/schema/grammar, and stages of native tools
   are independent. Native-tools or Agent eligibility additionally requires
   verified Ollama-style tool arguments/effects/continuation proof and correct
   protocol; a Chat receipt never implies native Agent qualification.
7. **Instruction adherence is a separate bounded signal.** Exact-output and
   concise-format tests capture active persona/system-context identity; a
   failed adherence contract does not revoke separately qualified Chat.
8. **No implicit live probes.** Qualification is an explicit opt-in bounded
   procedure; ordinary routing, recovery and model selection must never spawn
   extra inference to make an unavailable capability appear eligible.

## Execution ownership

Existing native trust, endpoint enable/disable, profile/model digest,
managed-runtime Ready observation and legacy tool qualification remain the
authoritative gatekeepers. Additional LM2F decisions may **further restrict**
an action but must not bypass the already required native checks. User-facing
reasons distinguish unavailable/unknown, unqualified, stale, failed and
explicitly unsupported. Receipt details belong in a progressively disclosed
deployment view, not the main picker rows.

## Known limits

An existing Ollama tool-verification record is not retroactively evidence
for every structured-output or instruction-adherence dimension. A legacy
record can authorize only the native-tool behavior it actually checked.
Model metadata, chat templates and server version claims are informative
but insufficient as proof of model instruction adherence. Remote runtime
observations must be fresh before any new receipt can authorize a capability.

## 2026-11-17 implementation verification and initial live attempt

The v2 implementation now stores versioned, procedure-matched historical
receipts under the existing `selfHostedInference.fabric` CAS envelope. It
requires a fresh native observation and matching deployment, artifact digest,
configuration, runtime epoch and process identity for current qualification.
The advanced model control separates Chat, streaming, completion,
instruction adherence, structured output and native tools, and exposes the
latest receipt status without interpreting a declaration as proof. The explicit
managed test runs as a separate retained **Coder / Chat Only** session with
no tool exposure, automatic retry, continuation or fallback; its observer
checks the actual prepared request and parsed stream, then the persisted
assistant message. A failure notification is not an authorization receipt.

The existing **Qwen2.5-0.5B-Instruct Q4_K_M** GGUF and official llama.cpp
**b12248** runtime were verified against the original SHA-256 identities.
The pinned development build verified the original archive, installed
executable and all 52 native runtime files. From Clack's Settings UI, the
original managed GGUF entered native **Ready** under CPU-only `2048` context,
with a new runtime process/epoch. No model or engine file was replaced.

**One** explicit bounded qualification was then invoked through the running
Clack Chat UI. The retained session `s-mwk76gaa-h170qt` used Coder and the
exact prompt `Reply with exactly LM2F-CHAT-QUALIFIED and nothing else.`
The actual persisted assistant text instead echoed an environment/context
block (336 characters). Its Clack activity records one completed request and
a `stop` finish; its run records zero automatic continuations/repairs and no
tool invocation. **Exact-output instruction adherence failed.** The app did
**not** persist a new v2 qualification receipt for this run, so even Chat,
streaming and terminal-completion behavior remain **unqualified** for
authorization purposes. Do not convert the completed transport trace or a
synthetic offline fixture into a passing receipt. Afterward, read-only
inspection of the **actual persisted pre-LM2F managed runtime row** identified
the missing `terminal-completion` and `instruction-adherence` declarations.
The four-receipt CAS commit rejects `unknown` capability declarations, so
this legacy registration is a reproducible persistence blocker. A targeted
**read-only projection** now supplies only `requires-qualification` for those
two missing verifier protocols on the exact pinned b12248 managed runtime;
explicit `unknown` or `unsupported` values are not overwritten. A new offline
regression reproduced the legacy shape, recorded a synthetic **failed** exact
adherence result separately from synthetic successful Chat, and verified
that the original persisted runtime and native tool denial were unchanged.
The five focused qualification files passed **88/88 tests**. This fixes a
concrete commit blocker; because the actual live exception was not logged and
the user-triggered test was **not repeated**, no additional current-model
capability is claimed. The UI must continue to fail closed.

The final post-fix scoped suite passed **230/230 across 13 current-source
files**, and both TypeScript typechecking and frontend production build passed.

The current procedure registry, immutable negative evidence ordering, epoch
transfer prevention and split Chat/stream/completion/adherence verdicts have
offline regression coverage. The current-source TypeScript suite previously
passed **935/935 tests across 50 files**; Rust library tests passed **728**
with **2 ignored**; the frontend production build, native debug build and
TypeScript typecheck passed. A final post-live check additionally passed
**229/229 tests across 13 focused files**, typecheck and the production build.
The runner now reports fixed, content-free failure stages for future explicit
qualifications; this was not followed by another live model request. These
are **offline code results**, not model
behavior qualifications. Any later rerun must recheck the live native identity
and execute a new *explicitly authorized* bounded procedure, never infer a
PASS from the earlier partial result.

**Initial live attempt: PARTIAL / unqualified**, with a concrete failed exact
acknowledgement and no stored receipt. Native tools and Agent remain
unsupported/unavailable. The separate LM2E investigation remains
`Inconclusive` / `PARTIAL`, and its evidence is not modified. The full scoped
run and preservation report is kept under the ignored
`src-tauri/target/lm2f-validation-20261117/` directory.

The final preservation audit recovered the original **16 modified tracked +
65 untracked** paths from the expanded dirty tree by subtracting 12 known
LM2F modified tracked and 11 new LM2F paths. SHA-256 over the 81 files,
sorted by **ordinal** path with `path<TAB>lowercase SHA256<LF>`, reproduced the
original protected-set digest **exactly**:
`339aba89d167b45a0cca1f663293fd3fa6197f63f0b2e4cab7f444b90670c104`.
HEAD, parent, both original stashes, index, imported GGUF, installed native
binary, LM2E diagnosis and original LM2E acceptance report also matched
their recorded baseline identities. No broad source cleanup, stash change,
commit or push was performed.

## Final LM2F live acceptance — one additional authorized Qwen run

The subsequent user authorization permitted **exactly one** new bounded
qualification on the existing deployment. Prior to inference, the approved
Qwen GGUF/llama.cpp b12248 hashes, original protected 81-file fingerprint,
both stashes and empty Git index were checked. The managed legacy-registration
compatibility projection was verified: absent terminal/adherence declarations
are read-only `requires-qualification` (not proof), explicit unsupported or
unknown declarations remain fail-closed, and native tools/Agent/structured
output cannot be promoted from a runtime claim. The offline mixed-result
regression was extended to verify all four independent statuses survive a
save/reload of the existing CAS fabric envelope.

The user-triggered action ran once through the **real Clack Chat UI**, under
the existing `builtin:coder` Chat-only persona, no exposed tools, no fallback,
no automatic retries/continuations, CPU-only Qwen2.5-0.5B-Instruct Q4_K_M,
native `--ctx-size 2048 --n-gpu-layers 0`. The exact single user prompt was
`Reply with exactly LM2F-CHAT-QUALIFIED and nothing else.` The distinct
retained session `s-mwk8vew1-1irxli` has one completed provider request,
`finish=stop`, one real assistant text part of 468 characters and no tool or
recovery receipts. Its text **did not** match the exact output contract;
instruction adherence **failed**.

Unlike the initial partial attempt, Clack's single authoritative
`selfHostedInference.fabric.qualificationReceipts` now contains **four actual
version-2 receipts**, all with the same exact scoped deployment and time:

| Capability | Observed receipt | Evidence / procedure |
| --- | --- | --- |
| Chat | `verified` | `clack-transport`, `complete-chat-text:pass`; `clack-managed-chat-bounded` v1 |
| Streaming | `verified` | `clack-transport`, `stream-deltas:pass`; `clack-managed-chat-bounded` v1 |
| Terminal completion | `verified` | `clack-transport`, `terminal-stop:pass`; `clack-managed-chat-bounded` v1 |
| Instruction adherence | `failed` | `deterministic-evaluator`, `exact-no-extra-text:fail`; `clack-instruction-adherence` v1 |

All bind to host `clack-this-pc`, runtime `clack-managed-llama.cpp` v`b12248`,
artifact SHA-256 `74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db`,
the exact digest-derived deployment/configuration identity, runtime revision
`1`, native PID `34748` and epoch
`67dff287bd0cdaa10ed593f0ff82d2915f6ecb5704cdadbec2f48c9f5d6f1e7b`.
The adherence receipt additionally binds Coder and a SHA-256 of the true
constructed system/persona context. Neither the raw system prompt nor raw
assistant response is persisted in qualification receipts.

**Live policy before runtime restart:** Chat, streaming and completion were
each `Qualified`/available. Exact-context adherence was `Qualification Failed`,
independently of those three. The advanced control showed the three passes
and **Last failed** for adherence (the generic-context view intentionally
withholds context-bound adherence authority). Native tools stayed
`Unsupported`; JSON Schema and grammar stayed `Requires Qualification`;
Agent eligibility remained false. Ordinary native managed Chat transport was
still available, without inventing tool/Agent reliability.

**Epoch invalidation:** After receipts were safely persisted, Clack's native
Stop control terminated PID `34748`; one normal Start created PID `35056`,
epoch `05b61cea4c860c146cf3f3b16d3fb12b0ff18dcebe9556de90b26fd259b4faa1`.
All four receipts remain historical but each process/epoch-scoped
qualification is now `Qualification Stale`/not available under the new Ready
process. No qualification inference was rerun following the restart.

**Secondary Ollama isolation:** Existing `Secondary PC` Devstral Small 2
native-tool evidence belongs to its own Ollama host/runtime/deployment. Its
saved legacy proof exists but is **expired and Stale**, not current authority.
It was inspected read-only; no Devstral probe occurred. Neither deployment
can consume the other's receipts, and a Qwen Chat PASS did not authorize
Devstral, tools, or automatic Agent behavior.

This final run demonstrates **real mixed-result receipt persistence and
fail-closed enforcement**. A failed exact-output adherence test is a valid
observed LM2F outcome, not an overall qualification-system failure. Historical
LM2E remains `Inconclusive` / `PARTIAL` and is unchanged. The detailed,
ignored local report and sanitized live receipts are under
`src-tauri/target/lm2f-validation-20261117/lm2f-final-20261117/`.

**Final regression:** 50 current-source Vitest files / **936 passed**, with
preserved `src-tauri/target` source snapshots excluded; Rust library tests
**728 passed, 2 ignored**; native debug build, TypeScript typecheck, and
frontend production build all succeeded. The imported model, approved native
engine, both historic LM2E reports, original HEAD/parent, original stashes,
and exact **81-protected-file SHA-256 aggregate** were reverified before the
scoped commit gate. This is a successful qualification *system* acceptance
despite the separately recorded model adherence failure.
