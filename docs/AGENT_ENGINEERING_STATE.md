# Clack Shared Engineering State

Updated: 2026-10-22. Scope: completed P0/R1/P1 **and the user-corrected local-AI-first development order**. This is the **shared checkpoint index** for ChatGPT, Chat On Steroids and Codex; it is not an alternative runtime memory or a source of executed-tool truth.

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
| P0 commit | `f0a099eb389fa04592760cf5f1e1c4b10b568201`, `docs: audit complete CoS platform for Clack roadmap`; no push |
| R1 committed evidence | [`R1_NATIVE_TOOL_TRANSITION_2026-10-22.md`](R1_NATIVE_TOOL_TRANSITION_2026-10-22.md), an offline source/trace audit; original raw Ollama artifacts remain ignored and protected |
| P1 current verified HEAD at priority-alignment intake | `9c7ea0c7f28a99a52c086f0f7349ed1ccc994cfb`, `feat(ai): unify capability contracts and tool indexing`; 12 P1-owned files, local `main` 92 commits ahead of cached `origin/main`; no fetch/push or claim of remote freshness |
| P1 verification limitation | P1-focused 109/109 Rust custom-tool tests, full Clack-owned 3,507 frontend tests and type/lint/fmt/clippy passed; **full Rust `cargo test --locked` remained red** (683 passed, 1 existing timeout-vs-revocation 10-ms race test failed, 2 ignored). Isolated race test passed; cause of full-suite failure not established. Preserve in [P1 evidence](P1_CAPABILITY_INDEX_2026-10-22.md). |

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

**P0 follow-on `R1` is completed in the source-backed audit linked above.** It found an observed model/engine **text-content** tool-format transition with no missing exposed tools or native frames and a correctly enforced 120-second cumulative continuation deadline. Model-versus-template internal attribution is unresolved. No generic Clack/SDK/harness defect was proven, so no production fix was made. See the detailed chronology and owner classification in `R1_NATIVE_TOOL_TRANSITION_2026-10-22.md`.

**P1 implementation/evidence:** [`P1_CAPABILITY_INDEX_2026-10-22.md`](P1_CAPABILITY_INDEX_2026-10-22.md) documents the schema-preserving, source-qualified capability index, 4,096 metadata entries and 64-result discovery pages, F1-preserving candidate bridge, 32-tool remote MCP discovery and native Rust execution/scope proof. No plugin executor, installer, local MCP process host, marketplace or P2 adaptive Tool Broker was introduced. Further model/template A/B experiments require separate authorization; inert XML drafts remain non-executable.

## Active priorities and acceptance handoff (user correction, 2026-10-22)

**Mandatory sequence:** **P0 complete (`f0a099e`) → R1 complete (`2648bcb`) → P1 complete (`9c7ea0c`) → finish local/self-hosted AI Agent reliability → resume ALL of P2–P19.** This supersedes the older next-P2 language in the historical P1 report and any older roadmap pointers. It applies to **ChatGPT, Chat On Steroids and Codex**. The complete CoS-inspired platform—plugins, managed local/remote MCP, adaptive discovery, browser QA, memory, composition, goals/workers, workflows, scheduling, GitHub/DBs, creative/hosted integrations, security, UX and Windows/Linux/macOS—remains a **required future goal**. None of P2–P19 has begun; never collapse this into a basic MCP manager. Do not begin the next R or P checkpoint without a new user request.

**Existing R-track evidence / unresolved work:**

- **R1 complete; R2 strictly conditional.** Frozen Nemotron inference-18 produced the last valid native write; inference-19 through -21 supplied textual pseudo-tool drafts, while 14 tool schemas and the same system prompt stayed intact. Model versus Ollama engine/template cannot be distinguished from that trace. The cumulative 120-second answer-continuation deadline worked correctly. Do **not** parse pseudo-tools, raise limits or start another model/engine run without a specific independently testable hypothesis and separate authorization.
- **R3 remaining: evidence-based objectives and finish truth.** The ForgeBoard run recorded nine real native calls and two source writes, but its 13 planned items remained pending, most application requirements lacked tested artifacts and the run ended incomplete. Existing `toolObjective.ts` already recovers objectives/corrections and `chatRuntime.ts` feeds pending Todos into `runBudget.ts`. However `runBudget.phase = "complete"` can mean a model batch finished, **not** proven application completion; an arbitrary task's acceptance criteria are not yet independently discharged. This is a product-quality gap and a bounded checkpoint candidate, **not** proof Clack falsely completed the frozen mission.
- **R4 remaining:** revision-pinned write observation and conditional projection exist, but the actual Nemotron run had no eligible overwrite and no context pressure: zero provider-bound reduction. Future R4 must compare **actual prepared/provider-bound payloads**, source hashes, dependencies and exact restoration under genuinely eligible pressure; never claim synthetic cost alone is autonomous benefit.
- **R5 remaining:** establish separate gates for endpoint/discovery/Automatic model configuration, native calls and verified effects, objective/correction retention, long runs, recovery, functional app build/tests/runtime/persistence, repeatability and independent artifact inspection. Classify **product runtime readiness**, **engine/model compatibility**, and **particular model task quality** separately. Compatible-model live acceptance is needed before claiming the track complete; no run authorized by this document.

**Single next checkpoint proposed, NOT STARTED: R3a — truthful run-finish and outstanding-obligation evidence.** Hypothesis: normal model `stop`/`runBudget.complete` and successful writes are insufficient to certify completion; a deterministic, owner-scoped projection from existing user turns/corrections, current Todos, tool/effect receipts and task-specific verification can represent `verified`, `unfinished`, `blocked` or `unverified` without an alternate goal store. **Boundary:** extend existing `toolObjective`, `runBudget`/`chatRuntime` and relevant tests to distinguish transport/batch completion from verified *task* fulfillment and expose truthful reasons on existing chat/run status; require authoritative evidence for each supported claim, and treat unevaluable requirements as unverified. Do not introduce a new orchestrator, implicit continuation, generalized semantic judge, inference policy change or live model trial. **Exit criteria:** deterministic replay of the frozen ForgeBoard partial does not say app-complete; genuine verified completed fixtures do not remain falsely blocked; late user correction, undone/failed build, pending PeerTask, stale workspace/file/test evidence, restart, foreign session/workspace and unknown effect do not grant completion; no tool replay or permission change; focused type/unit/integration/restart/regression suites pass. This is the *smallest first R3 slice*, not full R3/R5 completion. A full Rust-suite red baseline must still be reported and investigated when relevant.

**Final local-AI gate and future P-checkpoint testing:** The exact evidence tiers, scenarios and non-shippable limits are specified in [`COS_FULL_PLATFORM_AUDIT_2026-10-22.md`](COS_FULL_PLATFORM_AUDIT_2026-10-22.md) under the clarified order. Future P work requires seven distinct layers (deterministic, real integration, adversarial security, platform qualification, real compatible local Agent, independent user E2E, regression) before calling a feature complete. Labels must distinguish **implemented / tested / partially validated / platform-unverified / production-ready**; absence of a layer is documented, never silently promoted.

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
| P0 Whole-CoS capability assessment | Completed and committed `f0a099e` | Audit, source map and this shared index; 21 pinned source links and local links validated, no trailing whitespace, existing dirty hashes preserved |
| R1 Native-to-textual transition audit | Completed; documentation-only | Last native request `inference-18` / `call_ilruqg8d` -> first textual `inference-19`, 14 unchanged tools, `think:true`, length 2048; IDs 20/21 repeat inert drafts; ID22 cancelled with zero bytes at valid 120s deadline. MODEL/ENGINE not separable; no Clack defect proven. 236 focused tests/6 suites passed; TypeScript check passed; zero inference. Full R1 evidence and hashes in linked audit. |
| R2 Conditional compatibility correction | Not started; **only if proven** | R1 found no generic Clack native-tool-format defect; do not manufacture one or execute pseudo-tools. |
| R3a First objective/finish truth slice | **Recommended next, not started** | Source-linked outstanding obligations and verified-vs-batch completion; frozen partial ForgeBoard fixture, late corrections, failed tests, scope/stale evidence and restart cases; no live inference. |
| R3 remainder / R4 / R5 Local AI reliability and product acceptance | **Required, unfinished** | R3 remaining obligations; R4 real provider-bound context savings; R5 independent functional application, transport/model compatibility and repeatability gates. Only then local-AI track can be called complete. |
| P1 Capability contract and scalable tool index | Completed/committed `9c7ea0c`, **preserve** | 4,096 capability metadata entries, F1-preserving candidate bridge, MCP 32-tool discovery/24-tool registration; real native read fixture and revocation/scopes. Full Rust gate limitation remains in P1 evidence. |
| P2–P19 Complete CoS-inspired Agent platform | **Required, deferred, not started** | Resume *all* 18 checkpoints only after local-AI acceptance or explicit new user order; seven-layer tests and truthful platform/production status mandatory. See unchanged complete roadmap. |

This priority-alignment checkpoint authorizes documentation/coordination only. No next R3a implementation, inference, model download, service change, P2 expansion, push or release is authorized.
