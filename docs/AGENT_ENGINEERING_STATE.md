# Clack Shared Engineering State

Updated: 2026-10-22. Scope: public Chat On Steroids full-platform P0 source audit and long-term Clack roadmap. This is the **shared checkpoint index** for ChatGPT, Chat On Steroids and Codex; it is not an alternative runtime memory or a source of executed-tool truth.

## Current verified state

| Fact | Value and evidence |
| --- | --- |
| Clack baseline | `0ace76822ea02f71204dfba8a1fd4796811e661d`, `main`; `test(ai): evaluate nemotron with agent checkpoints` |
| Cached upstream relation at P0 intake | 89 commits ahead / 0 behind `origin/main`; no fetch of Clack origin, so remote freshness is **not** verified |
| Index | Empty at P0 intake; only explicitly owned documentation changes prepared for the P0 checkpoint, with no application source edits |
| Existing dirty paths | `docs/REAL_LOCAL_MODEL_ACCEPTANCE.md`, `scripts/acceptance-approval.mjs`, `scripts/check-real-local-product.mjs`, `src-tauri/examples/coworking_acceptance.rs`, `src/test/acceptanceComparison.test.ts`, `src/test/realLocalProductAcceptance.tsx` |
| Existing stashes | `stash@{0}` delegation modal safety, `stash@{1}` provider-rework rollback; do not apply, clear or overwrite |
| Existing ignored systems | `autonomous_tracker/`, large local fixtures, build products and the P0 CoS snapshot are unrelated |
| CoS evidence | Public revision [`f50a8d3`](https://github.com/totec448-spec/chat-on-steroids/tree/f50a8d30c1903193a9346f155431b4c57e730955), full local source in ignored `src-tauri/target/p0-cos-audit` at intake; no upstream binaries executed |
| New P0 artifacts | [`COS_FULL_PLATFORM_AUDIT_2026-10-22.md`](COS_FULL_PLATFORM_AUDIT_2026-10-22.md) is the source-backed product inventory, gap matrix, decisions and R/P roadmap |

### Pre-existing modified file fingerprints at intake

These hashes detect accidental replacement of user work; they are not claims that files will never legitimately change.

| Path (relative to `/clack`) | SHA-256 |
| --- | --- |
| `docs/REAL_LOCAL_MODEL_ACCEPTANCE.md` | `05B97FE4AE7B1F6992477CBF4D503D53F32C256DEF1C7DEEBAE201DA18712B7D` |
| `scripts/acceptance-approval.mjs` | `A4DD5E4BA76D6286218F39338C43FC616733C27528497CDFC5CA865E5CEBE837` |
| `scripts/check-real-local-product.mjs` | `D0F5DBFC6431C80608A39FEDA19EBF645D70991014B1A6DAB951CDB3C7693C90` |
| `src-tauri/examples/coworking_acceptance.rs` | `B5928A00BD21261A899B3A9D6D93685B9BF2F8464F64FE3318D77C5E0EB5A059` |
| `src/test/acceptanceComparison.test.ts` | `577C8A163AE3D9092AC97256095F15C45E5CC919D432E44FD51D4394F52BAEF1` |
| `src/test/realLocalProductAcceptance.tsx` | `74388D4786898E96DE2DB5F999D11403CEAE30D0DA5162376955F41429B06687` |

## Source of truth and document ownership

1. **User direction:** newest explicit objective and checkpoint boundaries win. The complete product vision is in [`COS_FULL_PLATFORM_AUDIT_2026-10-22.md`](COS_FULL_PLATFORM_AUDIT_2026-10-22.md). It covers the entire useful CoS platform, not just the Plugins screen.
2. **Current engineering rules:** [`../CLACK.md`](../CLACK.md) is the canonical tracked contract; `../AGENTS.md` points here and to that file. Legacy ignored `TERAX.md` may contain useful historical platform notes but cannot be assumed present in a fresh Git checkout.
3. **Current behavior:** Clack source/tests and exact scoped runtime evidence outrank old README/roadmap summaries. Failing/missing acceptance is documented explicitly.
4. **Historical completed programs:** [`AI_MULTI_AGENT_BUILD_PLAN.md`](AI_MULTI_AGENT_BUILD_PLAN.md) phases 0-7 and [`AI_SELF_HOSTED_INFERENCE_PLAN.md`](AI_SELF_HOSTED_INFERENCE_PLAN.md) checkpoint ledger A1-Z. Do not restart or replace their canonical subsystems.
5. **Acceptance and limitations:** [`REAL_LOCAL_MODEL_ACCEPTANCE.md`](REAL_LOCAL_MODEL_ACCEPTANCE.md) for the Oct 22 Nemotron evidence; [`LOCAL_AGENT_USABILITY_ACCEPTANCE.md`](LOCAL_AGENT_USABILITY_ACCEPTANCE.md), [`MULTI_AGENT_COWORKING_ACCEPTANCE.md`](MULTI_AGENT_COWORKING_ACCEPTANCE.md), [`REAL_WORLD_ACCEPTANCE.md`](REAL_WORLD_ACCEPTANCE.md), [`FINAL_ACCEPTANCE.md`](FINAL_ACCEPTANCE.md). Test/fixture layers are not live model/GUI proof.
6. **UI owner:** [`CHAT_CONTROL_SURFACE.md`](CHAT_CONTROL_SURFACE.md). Settings owns reusable config; Chat owns current conversation and approvals; Dispatcher owns navigation across tasks; backend ledgers own truth.
7. **Older comparative evidence:** [`COS_COMPARATIVE_AUDIT.md`](COS_COMPARATIVE_AUDIT.md) remains an archived narrow comparison. The new P0 document is the complete platform architecture and future checkpoint authority.

## P0 closeout and next checkpoint

**P0 deliverable:** source-backed inventory, seven reviewed CoS plugin recipes plus custom source types, whole Agent/Goal/Loop/worker/workflow/context/recovery/code-mode/desktop/browser/UI/capability architecture, Clack classification, explicit adopt/adapt/improve/avoid decisions and ordered engineering checkpoints. Do not interpret source inspection as live runtime validation.

**Independent verification performed before/during takeover:** 117 focused frontend tests passed in five suites; `npm run check-types` passed; latest Nemotron fixture suite 12/12 passed. These are intake baseline checks from the earlier turn, not checks of any newly implemented feature. No model inference, benchmark, plugin installation, upstream CoS test execution or Clack app changes have been performed for P0.

**Recommended next bounded checkpoint: `R1`**, offline audit of why verified native Nemotron calls transitioned to unexecuted textual tool drafts and reached the answer-continuation deadline. Start from immutable captured requests, parser behavior and partial answers. Its exit is an evidence-backed owner classification and narrow corrective specification, including an explicit no-defect finding if appropriate. No fresh inference, broad provider tuning, timeline extension or code policy change is implied. After R1, begin `P1` capability registry/index extension through existing Tauri/AI tool authorities.

## Shared ChatGPT / Codex workflow

1. **Intake:** read this file, `CLACK.md`, `AGENTS.md`, the active roadmap row and its source/acceptance files. Check `git rev-parse HEAD`, `git status --short --branch`, index, stashes, local instructions and protected-file fingerprints before edits. Verify a reported commit really exists in this checkout. Never infer fresh remote state from cached `origin/main`.
2. **Pick one checkpoint:** state exact intended user result, input/output boundary, file owners, run/model/hardware permission limits, tests, definition of done and rollback. Record why this is the next dependency rather than an ad hoc feature batch.
3. **One writer per surface:** coordinate changes through a checkpoint-owned worktree or disjoint files. Preserve the six pre-existing dirty paths unless the user deliberately assigns that work. Never `reset`, `clean`, apply stashes or overwrite unrelated work.
4. **Implement then verify:** reuse current session/runtime/tool/security owners, run focused and required broader gates appropriate to touched code, and preserve original receipts, partials, unresolved effects and external artifacts. Model inference, downloads, release, network mutations and push require their own checkpoint authorization.
5. **Close the checkpoint:** record commit hash (only after it exists), exact passing/failing commands, controlled/native/live evidence type, unresolved limits, follow-on risk and next checkpoint in this index and the relevant canonical document. Historical reports should stay historically accurate; append correction/forward reference rather than rewriting the past.
6. **Exchange control:** the incoming agent independently checks repository state, diff, tests and owner source. An agent summary is a navigational aid, not factual proof. If the index differs from HEAD, prefer code/commit evidence and correct the index during an authorized documentation checkpoint.

## Status ledger for new roadmap

| Checkpoint | State | Evidence and next action |
| --- | --- | --- |
| P0 Whole-CoS capability assessment | Complete, source-backed documentation checkpoint | Audit, source map and this shared index; 21 pinned source links and local links validated, no trailing whitespace, `git diff --check` passed for tracked changes, existing dirty hashes preserved |
| R1 Native-to-textual transition audit | Pending | Use committed `0ace768` local-model fixture and frozen wire evidence |
| R2-R5 Local model reliability/productivity | Planned | See full roadmap and predecessor gates in `COS_FULL_PLATFORM_AUDIT_2026-10-22.md` |
| P1-P19 Agent capability platform | Planned | One focused verified checkpoint at a time; preserve existing Clack subsystems |

No push, release or broad implementation is authorized by this P0 planning record.
