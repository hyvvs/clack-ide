# Offline Agent-history segmentation regression attribution — 2026-11-07

**Final classification: `AGENT-HISTORY SEGMENTATION CLEARED FOR LIVE ACCEPTANCE`**

**ONE FURTHER FORGEBOARD RETRY JUSTIFIED: YES** — this is a recommendation only. **No** ForgeBoard, Muse, other model, hosted inference, Ollama modification, streaming/inference diagnostic, or acceptance run occurred during this investigation.

This report supersedes the **retry NO** decision in `CLACK_AGENT_HISTORY_SEGMENTATION_OFFLINE_2026-11-06.md`, which was necessarily conservative before clean-HEAD baseline attribution. The original defect classification **GENERIC CLACK AGENT-HISTORY SEGMENTATION DEFECT PROVEN** remains unchanged.

## Method: exact-HEAD baseline without disturbing the working tree

- Starting and precommit HEAD: `47da08dba08f9a3635aaaca4ec737c37f1283253`.
- Created a **separate detached, clean Git worktree** at `$env:TEMP\clack-agent-history-baseline-47da08d`, verified its exact HEAD and empty `git status --porcelain`. The original `/clack` tree was not reset, cleaned, stashed, or overwritten.
- The baseline linked the existing local `node_modules` and **read-only** `src-tauri/target/real-qwen-product` archived evidence with Windows junctions. Native baseline used the existing local Cargo target *build cache* and `--offline`; no historical archive contents were modified. Dependency versions therefore matched the patched tree, and both checkouts used the same original source evidence.
- Re-ran each failing **file or single test** from the 2026-11-06 broad sweep against the exact clean HEAD and then the patched working tree. The three routing failures, four captured Qwen fixture failures, three production-safety expectation failures and one native monitor failure reproduce at baseline with the same stack/location and actual outcomes.
- The remaining target-context switch test passed at baseline in isolation (3.75 seconds) and on the patched tree in isolation (3.93 seconds). It also passed on the patched tree in the final broad run. Its one historical 15-second broad-suite timeout is **timing/parallel-load sensitive**, not a demonstrated segmentation failure.
- The native timing assertion **failed at starting HEAD in isolation**, previously **failed on the patched tree in isolation**, subsequently **passed on the patched tree in isolation** (0.02 seconds), and failed again in the final broad native run. It is an independently demonstrated **pre-existing timing-sensitive test**.

**No additional production changes, test suppressions, stale expectation updates, arbitrary timeout changes, inference, or hosted fallback were needed or made as part of regression attribution.**

## All twelve original failures: exact baseline / patched results

Classification codes: **B** = failure exists at clean starting HEAD, unrelated to segmentation; **C** = original failure is timing-sensitive, with successful isolated patched validation. A/B/C/D/E are mutually useful labels but some evidence supports both B and C for the native timing case. **A: none; E: none.** A fixture could be stale (D) without being a segmentation regression; no such expectation was changed without a separately demonstrated contract requirement.

| # | Original failing test and assertion location | Expected → actual (same at baseline and patch unless noted) | Production function and segmentation-path relation | Clean starting HEAD | Current patch / category |
|---:|---|---|---|---|---|
| 1 | `agentCompaction.integration.test.ts:659` — *switches a large cloud conversation to a smaller endpoint and actually sends the staged target context* | Complete preparation/send within **15,000 ms** → historical full parallel sweep timed out at **15,769 ms** | `prepareModelSwitch` → target preview/commit → `runAgentStream`/compaction; this **does** traverse affected integration paths, so tested directly | **PASS** isolated (~3.75 s) | **PASS** isolated (~3.93 s) **and PASS broad**; **C**, broad contention, no functional mismatch |
| 2 | `ollamaRouting.test.ts:390` — *reuses fresh post-request evidence without a metadata call on every inference* | Expected **1** `self_hosted_probe` invocation → actual **2** | `buildConfiguredLanguageModel` / self-hosted probe refresh; **no virtual-step or memory coverage** in failing branch | **FAIL**, same 1→2 | **FAIL**, same 1→2; **B** |
| 3 | `ollamaRouting.test.ts:764` — *does not manufacture support or repeatedly probe when refresh is unavailable* | Expected **1** `self_hosted_probe` → actual **2** | Same adapter/probe refresh logic; unrelated to history conversion | **FAIL**, same 1→2 | **FAIL**, same 1→2; **B** |
| 4 | `ollamaRouting.test.ts:764` — *does not manufacture support or repeatedly probe when refresh is missing support* | Expected **1** `self_hosted_probe` → actual **2** | Same adapter/probe refresh logic; no modified segmentation source reached | **FAIL**, same 1→2 | **FAIL**, same 1→2; **B** |
| 5 | `qwenToolMismatch.test.ts:30,37` — *replays captured 'a' native bytes through SDK without executing textual or structured calls* | Exact captured request body expected, then historical text/no tool call → mock `fetch` request-body equality assertion fails; stream ends `AI_NoOutputGeneratedError` | `createOllamaModel.doStream` / `send` (`ollamaModel.ts:285,345`), SDK `stream-text.ts:1138`; no compaction, ordering, or virtual ID involved | **FAIL**, same mocked request mismatch → no output | **FAIL** same; **B** |
| 6 | `qwenToolMismatch.test.ts:30,37` — *replays captured 'b' native bytes through SDK without executing textual or structured calls* | Captured explicit `think:false` request body/text/tool call expected → mocked body mismatch, then `AI_NoOutputGeneratedError` | Same unchanged `createOllamaModel`/SDK mocked-byte path | **FAIL**, same | **FAIL**, same; **B** |
| 7 | `qwenToolMismatch.test.ts:30,37` — *replays captured 'a-repeat' native bytes through SDK without executing textual or structured calls* | Repeat of A's captured body/response expected → mocked body mismatch, then `AI_NoOutputGeneratedError` | Same unchanged mocked native-byte adapter | **FAIL**, same | **FAIL**, same; **B** |
| 8 | `qwenToolMismatch.test.ts:30,37` — *replays captured 'b-repeat' native bytes through SDK without executing textual or structured calls* | Repeat of B's captured body/response expected → mocked body mismatch, then `AI_NoOutputGeneratedError` | Same unchanged mocked native-byte adapter | **FAIL**, same | **FAIL**, same; **B** |
| 9 | `r5yProductionSafety.test.ts:214` — *rejects initially changed/unavailable loaded context 4096* | Throw message matching `/working context changed/` → `Ollama reported 4096 loaded tokens after Clack requested 65536...` | `runAgentStream` → `requestPreflight` → `profileBudgetLimits`; **fail-closed before model request**, no step history | **FAIL**, same error-message mismatch | **FAIL**, same; **B** |
| 10 | `r5yProductionSafety.test.ts:214` — *rejects initially changed/unavailable loaded context 0* | Rejected promise → **resolved stream** with `start` followed by `error` event `ContextBudgetError(code=ollama-continuation-allocation-stale)`; no inference body | Same preflight/proxy boundary. Safety guard **rejects**, but error is delivered as stream event rather than promise rejection | **FAIL**, same delivery mismatch | **FAIL**, same; **B** |
| 11 | `r5yProductionSafety.test.ts:324` — *rejects a same-run Automatic alternative with another record or confirmed variant* | Throw `/proof selection changed/` → `Automatic Agent configuration is not verified...` | `runAgentStream`/tool verification selection rejects before dispatch, no compaction source index involved | **FAIL**, same fail-closed rejection text | **FAIL**, same; **B** |
| 12 | `src-tauri/src/modules/conversation_memory/custom_tools/execution/tests.rs:830` — `d1_cancellation_timeout_and_revocation_prevent_or_interrupt_work` | `tool-revoked` → sometimes `timed-out` | Unmodified `custom_tools/execution.rs::monitor` uses `tokio::select! { biased; cancellation; 10-ms timer; 100-ms check interval; operation; }`; after scheduling delay timer may be ready before revocation check. Not `coverage_units`, native memory commit, or virtual source evidence | **FAIL** isolated: `timed-out` vs `tool-revoked` | **FAIL** in historical patched isolation and final broad; **PASS** latest patched isolation; **B+C** |

The Qwen tests may have historical captured-body/fixture drift and R5y tests may expect an older diagnostic delivery contract. **The task does not authorize altering either fixture or production provider behavior.** Baseline reproduction proves they are not introduced by this segmentation patch, regardless of the unrelated underlying cause.

No actual tool call was executed in these mocked transport tests. No model dispatch occurred. Native tests invoke local Rust memory/tool-execution test harnesses, never an inference service.

## Regression causality and protected invariants

**Segmentation-caused regressions found: zero.** **Segmentation-specific fixes in this attribution turn: zero.** **Stale expectations updated: zero.**

The final failing test source files and their production routing, Ollama adapter, proof and custom-tool executor functions were not changed by the segmentation patch. The target-switch test **does** cross the modified compactor/target-context surface, which is why it was separately compared against the clean baseline; it passed in both checkouts and in the final current-source broad run. The native monitor is in the same Rust module tree as conversation memory but a distinct, unchanged custom-tool execution function, and the same race is observed at the unmodified starting HEAD.

The correction still enforces:

- **55/55 paired tool calls/results** and exact **114/114** original SDK model-message equivalence; chronological grouping and no orphan result.
- **2 → 59 compaction groups**, **0 → 50 eligible historical units**, **9 protected groups** (user, seven failed steps, latest plan). Pending/unmatched calls, approvals and the active working set remain protected and are not summarized.
- Historical failures and write/repair/test observations have exact source provenance; assistant statements are inferences, not automatically verified workspace effects. No duplicate tool side effects or tool replay.
- Original current user/system instructions and reasoning pruning remain semantically intact; target-context keys bind the actual target/model/tool/output context, and native step evidence uses explicit opt-in source coordinates, not UI-message indices.
- Trusted **49,152** context ceiling and **6,144** reserved output tokens unchanged. Genuine protected-budget and **4K** preflight failures still fail closed. No calibration/digest/runtime identity, requested-context, proof selection or trust bypass.

The previous report's actual preserved 58-step deterministic coordinator replay, native **on-disk** archived step-42 prefix commit/reload/step-58 append and 55/55 tool-pair identity tests remain valid and were rerun in the focused suite. No ForgeBoard application success or model outcome is claimed.

## Final validation after baseline comparison (all offline)

| Gate | Patched current-source result | Attribution |
|---|---|---|
| Expanded focused Agent/compaction/continuation/target/retrieval/context/preflight/calibration/verified-write suites | **683 passed / 32 files**, zero failures | Green, including actual preserved-run replay |
| ForgeBoard 50→25 correction-observer offline tests | **52 passed / 2 files** | Green; observer implementation unchanged |
| Native conversation-memory suite | **61 passed / 0 failed** | Green; native archived commit/reload test included |
| Native target-context snapshot suite | **10 passed / 0 failed** | Green |
| `npm run check-types` | **PASS** | Green |
| `npm run build` (`tsc && vite build`) | **PASS** | Green; existing nonfatal dynamic-import warnings only |
| Original failing routing/Qwen/R5y files rerun on patched tree | **79 pass / 10 baseline-identical fail** | All ten proven fail at clean HEAD |
| Original target-switch test rerun alone | **PASS (3.93 s)** | Clean baseline also PASS (3.75 s) |
| Native original custom-tool timing test rerun alone | **PASS on latest patched run**, historically FAIL | Baseline isolated FAIL, showing underlying flakiness |
| **One final broad AI-library sweep** `src/modules/ai/lib` (exclude `src-tauri/target`) | **2,771 passed / 10 failed / 2 skipped** (148 files: 144 pass, 3 fail, 1 skipped) | Ten exact baseline failures only; historical target-switch timeout did **not** recur |
| **One final broad native** `cargo test --lib conversation_memory --no-default-features --offline` | **305 passed / 1 failed**; 402 filtered | Single `custom_tools::execution` revocation timing test: same clean-baseline failure |

Original broad AI sweep (before attribution): **2,769 passed, 11 failed, 2 skipped**. The newer broad sweep contains **one more current-source test** and is **net green on the previously timed-out target-switch test**. Frozen tests under `src-tauri/target` are not treated as current-source regressions.

### Outcome

**`AGENT-HISTORY SEGMENTATION CLEARED FOR LIVE ACCEPTANCE`**

**`ONE FURTHER FORGEBOARD RETRY JUSTIFIED: YES`**

This clears the generic segmentation correction **for a separately authorized live acceptance attempt**. It does not launch one, certify ForgeBoard app success, or revise the historical Muse acceptance. The unrelated baseline failures are explicitly documented; they were **not** made green by weakening routing, safety guards or timeout rules.

### Preservation and commit scope

The six original protected dirty files (`docs/REAL_LOCAL_MODEL_ACCEPTANCE.md`, `scripts/acceptance-approval.mjs`, `scripts/check-real-local-product.mjs`, `src-tauri/examples/coworking_acceptance.rs`, `src/test/acceptanceComparison.test.ts`, `src/test/realLocalProductAcceptance.tsx`) are **not included** in the segmentation commit. Both original stashes, tracker, operator settings, frozen ForgeBoard/Muse evidence, and the independent baseline worktree are preserved. No reset, clean, stash operation, inference, Ollama modification, hosted request or push was performed.

The resulting commit hash and final HEAD are recorded in the final operator report after the selective index and preserved dirty files are verified.
