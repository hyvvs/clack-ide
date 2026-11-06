# Clack Agent-history compaction segmentation: preserved-run offline result

> **2026-11-07 superseding regression attribution:** The 12 historical broad-suite failures have now been compared to an independent clean worktree at the exact starting HEAD. Ten AI-library and the one native failure reproduce at baseline; the other target-switch timeout passes at baseline, patched isolation and the final patched broad run. The final classification is **AGENT-HISTORY SEGMENTATION CLEARED FOR LIVE ACCEPTANCE** and **ONE FURTHER FORGEBOARD RETRY JUSTIFIED: YES** (recommendation only; no ForgeBoard or model run). The original **retry NO** statement below records this report's *earlier, pre-attribution state*, not the present gate. See `CLACK_AGENT_HISTORY_SEGMENTATION_REGRESSION_ATTRIBUTION_2026-11-07.md` for all 12 test names, exact results, and final broad counts.

Investigation started at **`47da08dba08f9a3635aaaca4ec737c37f1283253`**. This report is exclusively an offline examination and a generic, optional implementation. **No ForgeBoard application, model, Ollama, hosted inference, acceptance run, streaming diagnostic, or notes acceptance was executed.** The existing ForgeBoard mission remains **FORGEBOARD INVALIDATED BY CLACK DEFECT**, not a model-performance verdict. Historical Muse acceptance is not revisited.

## Original pre-attribution decision (superseded on 2026-11-07)

**GENERIC CLACK AGENT-HISTORY SEGMENTATION DEFECT PROVEN**

**ONE FURTHER FORGEBOARD RETRY JUSTIFIED: NO**

The frozen transcript establishes a real, unnecessary grouping dependency: its 58 complete, paired SDK steps were all coarsened into a single original assistant UI-message group and one failed result protected that whole group. Splitting at SDK `step-start` boundaries without altering the SDK-converted sequence makes 50 of those 58 historical steps independently eligible while keeping seven failed steps and the latest acknowledged plan verbatim. An offline bounded-extraction coordinator replay now commits, reloads, advances through the remaining frozen steps and fits the trusted budget; a separate **real native Rust commit/reload test uses the original 58-step source** and verifies stable coverage and evidence through the step-42-to-58 append.

This is **not** a live on-device Tauri IPC/Agent acceptance run, and extraction outputs are deterministic **mocked summaries**, not a real model's verified account of the generated ForgeBoard workspace. The code path is structurally exercised, not a guarantee that any arbitrary summary or future application will be satisfactory. The broader source regression sweep also remains red (details below), including independent production-safety expectation failures; hence **no new acceptance retry is justified**.

## Original production coarsening and protected-budget guard

1. `src/modules/ai/lib/conversationCompaction.ts::conversationCompactionUnits` projected/materialized each **durable original UI message**, called `convertToModelMessages([message])` and `pruneMessages`, then emitted one `CompactionUnit` per message. All 168 assistant parts, including 58 `step-start` boundaries and 55 completed tool interactions, remained a single unit.
2. `src/modules/ai/lib/compactionPlan.ts::groupCompactionUnits` scans all SDK `tool-call`/`tool-result` entries, demands unique call IDs and preceding calls, closes start-to-end groups over every pair, and marks system/user/attachments/approvals, failed outputs, the latest successful `todo_write`, and pending calls protected. A result without a preceding call fails with `orphan-result`.
3. When closing each group, `protectedGroup ||= protectedUnits.has(i)` propagates **any one** protected reason to the full containing unit/group. Because the whole 58-step assistant transcript was one unit, the failed bash result at step 28 (plus six later failures and plan 50) protected every earlier successful write and inspection. The user request was the other protected unit. **Original groups: two; eligible groups: zero.**
4. `planCompaction` assembles protected units and the recent complete tail verbatim, computes `protectedBudget` with `resolveContextBudget`, and correctly throws `compaction-protected-budget` when they do not fit. The previous live forensic audit established an **exact 594-token terminal excess** against **49,152** trusted effective context with an unchanged **6,144** output reserve. Moving the trigger earlier alone could not solve the coarse two-group case. **The guard itself is correct and unchanged.**

Protection semantics: a *pending* call has no result and may still create an effect; an *unmatched* result has unverifiable provenance and must be rejected; a *failed* result preserves the original error and downstream repair context; an approval is an authorization boundary, not generic text; the latest acknowledged `todo_write` retains the live plan; user/system and attachments stay in their original role; reasoning is pruned to exactly the original SDK policy, not newly revealed by step slicing; previous committed memory coverage and target-context policies cannot silently be reinterpreted as new indices. A completed, older failed step may be followed by repair, but this implementation conservatively **still retains the failed step verbatim**. It does not relax protection for unresolved or current failed calls.

## Structural map of all 58 preserved generations

Read-only source: `src-tauri/target/real-qwen-product/forgeboardmuse-20261106-01/data/terax-ai-sessions.json`, key `messages:real-mission-a`; request/batch source: `mission-a-1.requests.jsonl`, `mission-a-1.jsonl`. Per-step forensic JSON with original part ranges, full request IDs, references and boundaries: `src-tauri/target/real-qwen-product/late-compaction-audit-20261106-01/preserved-58-step-structural-map.json`. There are two durable messages (`8VApXqXdM1bTHJ92`, user, one part; `gN5H8FNonx3DINAy`, assistant, 168 parts), with **55 calls, 55 associated output-available results, 55 unique IDs and no pending results in the frozen completed transcript**.

Each row below is exactly one assistant step; all calls/results are paired, chronological and resolved. `R` = reasoning part; `T` = text part; `—` = no text/reasoning. `!` = failed result. `B` = logical continuation batch; continuation boundaries occur after steps **24, 43, 46, 52**. `Ref` counts later path references found by the forensic structural scanner; **these are evidence of syntactic references, not exhaustive semantic dependency inference**. `Keep` means permanently protected under the unchanged result/plan guard; `Eligible` means separately compactable once old enough and outside the active tail. Every row belonged to the **same original assistant group**; its proposed group is its own step, with no split within a call/result pair.

| Step | B | Content | Tool call ID (result) | Ref | Finer policy |
|---:|---:|:---:|---|---:|---|
| 1 | 1 | R | list_directory `call_4wp0ol1z` | 38 | Eligible |
| 2 | 1 | R | todo_write `call_a21tjo3q` | 0 | Eligible |
| 3 | 1 | R | todo_write `call_xrwnz0zd` | 0 | Eligible |
| 4 | 1 | R | create_directory `call_c4ivs9eb` | 15 | Eligible |
| 5 | 1 | — | create_directory `call_gdtrghpk` | 20 | Eligible |
| 6 | 1 | R | write_file `call_ae08qk63` | 0 | Eligible |
| 7 | 1 | R | write_file `call_sz6g7lg9` | 0 | Eligible |
| 8 | 1 | R | write_file `call_dy18cjl3` | 0 | Eligible |
| 9 | 1 | R | write_file `call_mrc7iz64` | 2 | Eligible |
| 10 | 1 | R | write_file `call_658s8avf` | 0 | Eligible |
| 11 | 1 | R | write_file `call_c68vcfsb` | 0 | Eligible |
| 12 | 1 | R | todo_write `call_82n8frf8` | 0 | Eligible |
| 13 | 1 | R | create_directory `call_08aylre8` | 11 | Eligible |
| 14 | 1 | R | create_directory `call_ahsps8w4` | 2 | Eligible |
| 15 | 1 | R | create_directory `call_bhyt65rs` | 0 | Eligible |
| 16 | 1 | R | write_file `call_w7quiszm` | 0 | Eligible |
| 17 | 1 | R | write_file `call_0gha55z8` | 0 | Eligible |
| 18 | 1 | R | write_file `call_4mty8hg2` | 0 | Eligible |
| 19 | 1 | R | write_file `call_1kjaviyj` | 0 | Eligible |
| 20 | 1 | — | write_file `call_w69eem6e` | 0 | Eligible |
| 21 | 1 | R | write_file `call_o1ft4wdd` | 1 | Eligible |
| 22 | 1 | R | write_file `call_r77hblw8` | 0 | Eligible |
| 23 | 1 | R | todo_write `call_fcfppiud` | 0 | Eligible |
| 24 | 1 | R | create_directory `call_9wopfqcf` | 2 | Eligible |
| 25 | 2 | R | write_file `call_x5puddqx` | 0 | Eligible |
| 26 | 2 | R | write_file `call_ozirx0ax` | 0 | Eligible |
| 27 | 2 | R | todo_write `call_s77akcjm` | 0 | Eligible |
| 28 | 2 | R | bash_run! `call_qtfypi1c` | 0 | **Keep: failure** |
| 29 | 2 | R | bash_run `call_flo3ofso` | 0 | Eligible |
| 30 | 2 | R | bash_run `call_kik3025q` | 0 | Eligible |
| 31 | 2 | R | todo_write `call_ftfyxw5y` | 0 | Eligible |
| 32 | 2 | R | bash_run `call_yn22shd9` | 0 | Eligible |
| 33 | 2 | R | bash_run `call_yzqx0r7i` | 0 | Eligible |
| 34 | 2 | R | create_directory `call_v8l6okn4` | 13 | Eligible |
| 35 | 2 | — | create_directory `call_3qufkgdt` | 0 | Eligible |
| 36 | 2 | — | create_directory `call_k0sji3xe` | 4 | Eligible |
| 37 | 2 | — | create_directory `call_htz7u8rk` | 3 | Eligible |
| 38 | 2 | R | write_file `call_zlrjtpyr` | 0 | Eligible |
| 39 | 2 | R | write_file `call_adu6obau` | 0 | Eligible |
| 40 | 2 | R | write_file `call_lkrdn7gd` | 0 | Eligible |
| 41 | 2 | R | write_file `call_ot5r3v5v` | 0 | Eligible |
| 42 | 2 | R | write_file `call_2mdkgnfe` | 0 | Eligible |
| 43 | 2 | R,T | — | 0 | Eligible |
| 44 | 3 | R | read_file! `call_ka0b6pal` | 1 | **Keep: failure** |
| 45 | 3 | R | write_file `call_fiznp3a1` | 0 | Eligible |
| 46 | 3 | R,T | — | 0 | Eligible |
| 47 | 4 | R | read_file! `call_2nwspkqb` | 1 | **Keep: failure** |
| 48 | 4 | R | write_file `call_zxty9r1n` | 0 | Eligible |
| 49 | 4 | R | write_file `call_g9mymfuj` | 0 | Eligible |
| 50 | 4 | R | todo_write `call_h4il3cla` | 0 | **Keep: latest plan** |
| 51 | 4 | R | create_directory `call_akgc2e0v` | 0 | Eligible |
| 52 | 4 | T | — | 0 | Eligible |
| 53 | 5 | R | bash_run! `call_v4fwj6hd` | 0 | **Keep: failure** |
| 54 | 5 | R | read_file `call_laysof4l` | 1 | Eligible |
| 55 | 5 | R | edit! `call_lrosrx82` | 0 | **Keep: failure** |
| 56 | 5 | R | bash_run! `call_ymrve3pa` | 0 | **Keep: failure** |
| 57 | 5 | R | bash_run `call_xd0twxjv` | 0 | Eligible |
| 58 | 5 | R | bash_run! `call_vd8j2q1y` | 0 | **Keep: failure/current tail** |

## Granularity choice and guard

Evaluated: **A** whole assistant history (unsafely coarse as a retention group); **B** assistant plus its associated result (can still include many steps); **C** completed Agent step; **D** individual call/result transaction (can split multi-call generations or lose preceding reasoning); **E** logical continuation batch (24/43/46/52 are unnecessarily large and may merge errors with prior successes); and **F** **chronological step-boundary units with call/result closure and source identity**, chosen. F uses the ordinary `groupCompactionUnits` closure to merge adjacent virtual units whenever a tool call/result spans a step, and protects partial, orphan, failed or approval state. There is no special ForgeBoard or model-dependent branch.

The durable original UI conversation remains **two messages**. `conversationCompactionUnits(..., stepUnits=true)` derives virtual units `agent-step:<original-message-id>:<0-based-index>`, validates that its **concatenated SDK messages are bytewise JSON-equivalent** to normal whole-message conversion, and applies the **original reasoning pruning at the whole-message boundary**, not once per step. Unsupported forms fail closed or use legacy whole-message policy; synthetic IDs must be valid and unique. The new mode is activated only where a **protected coarse assistant group masks older compactable steps**, avoiding regression of short successful-tool/verified-write history. A previously committed step-mode revision continues using its **same mode** even if a pending call later resolves; old message-index revisions cannot silently migrate.

Native `src-tauri/src/modules/conversation_memory.rs` adds `Coverage.unitMode`, `Candidate.unitMode`, `SourceLocator::AgentStep`, `agent_step_ranges`, `agent_step_value`, `coverage_units`, and source identity/hashing/reload in this coordinate system. It does **not** rewrite original messages, and it rejects unknown modes, mismatched policy, duplicate synthetic IDs, changed covered prefixes, and implicit legacy-step migration. `target_context.rs::validate_snapshot`, `targetContext.ts::createTargetDraft` and `peerHandoffRuntime.ts` verify/reconstruct the revision mode rather than treating virtual steps as durable UI indices. Original-message retrieval can resolve virtual-step evidence citations to the original assistant message. Previously committed legacy mode remains legible; automatic migration remains intentionally unsupported.

`planCompaction::assemble` keeps **all protected groups verbatim even after the covered cursor advances over them**. The new extraction loop cites only eligible **unprotected** virtual source groups with the native source locators and verifies their exact derived original parts. Its bounded extractor requires source-linked claims and marks assistant assertions as **inferences**, not verified workspace effects; write confirmations rely on the existing independent `VerifiedWriteSource` receipt mechanism. An observed write, read, failed command, inspection, repair and test outcome can be reported as *historical evidence* with original citations, not fabricated present filesystem state, completed side effects, or permission to replay tool calls. The protected error, latest plan, current working step, system and user requirements stay intact; exact original evidence remains retrievable subject to ordinary retrieval limits.

## Original vs new grouping and budget opportunity

| Preserved boundary | Original groups / eligible | New groups / eligible | Eligible step-model estimated tokens | Full conversation estimated tokens |
|---|---:|---:|---:|---:|
| Step 12 | 2 / 0 | 13 / 11 | 4,992 | 6,809 |
| Step 24 | 2 / 0 | 25 / 23 | 17,195 | 19,010 |
| Step 28 | 2 / 0 | 29 / 26 | 19,653 | 21,846 |
| Step 42 | 2 / 0 | 43 / 40 | **27,119** | 29,308 |
| Step 50 | 2 / 0 | 51 / 46 | 33,673 | 36,432 |
| Step 58 | 2 / 0 | **59 / 50** | **35,229** | 40,577 |

Figures are production `measureRequest` estimates on the frozen SDK-converted step data, **not original exact on-wire context usage**. The private early hypothetical step-42 probe had coverage 31, 29 proposed claims and projected final conversation 24,435 (fits), but explicitly had `nativeCommit=false`: that projection alone was not proof.

The new **current-source** `preservedAgentStepReplay.offline.test.ts` reproduces the protected old failure on the frozen 58-step source, stages bounded deterministic extraction using the production coordinator and a memory **test bridge**, resumes at step 58, and reports: step-42 first coverage **25 virtual units**, **24 claims / 24 evidence sources**, system **4,814**, tool/schema **2,819**, step-42 conversation **15,799**; after the actual 58 steps and further bounded consolidation, final coverage **49 units**, final conversation **15,412**, both under trusted **49,152** with full **6,144** output reserve preserved. The source transcript is unchanged. The bridge is not native Tauri IPC and the configured system/schema text reconstructs the archived **aggregate estimate** rather than literal prompts/schemas.

Independently, native Rust test `archived_58_step_forgeboard_native_commit_and_continuation_preserve_identity` reads the **same archived original bytes**, stages at step 42, commits a real on-disk **`agent-steps-v1` revision** covering virtual indices `[0,31)` with **29 evidence-linked inference claims** (excluding still-protected failed step 28), reloads its matching prefix, appends all remaining actual steps through 58, and validates source digests, stable cursor, 28 uncovered step units and corruption detection after modifying a covered call. This closes the original message-index/native persistence gap. The two tests jointly cover the bounded TypeScript coordinator path and native durable source identity; no live model-generated summary or application outcome has been validated.

## Regression and preservation status

Offline current-source focus:

- 14 targeted compaction, continuation, target, budget, preflight, calibration and retrieval test files: **324 passed**. This includes the frozen transcript replay, step mode, pending-to-resolved conversion, verified-write compatibility, protected failures, original evidence recall, and context keys.
- `scripts/acceptance-correction.test.mjs` unit-only observer tests: **50 passed**. `src/test/forgeboardCorrectionMode.test.ts` included in the targeted set: one-shot observer remains active with `singleSpec`; no observer production code was edited. Correction remains bounded to the original 50 → 25 rule after independently observed writes.
- Native `conversation_memory::tests::`: **61 passed** (includes native preserved-58-step commit). Native `conversation_memory::target_context::tests::`: **10 passed**.
- `npm run check-types`: **PASS**. `npm run build` (`tsc && vite build`): **PASS**, with existing nonfatal dynamic-import/bundle warnings.
- Broader current-source `src/modules/ai/lib` Vitest sweep: **2,769 passed; 11 failed; 2 skipped** (148 files). The earlier sweep had 16 failures; five verified-write integration failures were corrected and its full focused suite now passes. Remaining failures: three mocked Ollama routing probe-count expectations, four captured Qwen-byte replay cases, three `r5yProductionSafety.test.ts` error-shape/order expectations (still fail when isolated: **32 pass, 3 fail**), and one large target-switch test timing out during the parallel sweep (passes in the focused suite). These files/routes were **not modified** by this correction, but their baseline at starting HEAD was **not measured**, so do not call them proven pre-existing. Do not change timeouts or weaken trust to make them pass.
- Broader native `cargo test --lib conversation_memory`: **304 passed / 1 failed** in an unrelated `custom_tools::execution` cancellation/revocation timing assertion; the same assertion failed alone (reported `timed-out` instead of expected `tool-revoked`). The focused native memory/target tests pass. No timeout or custom-tool code changed.

Safety status: failure and unresolved tool guards, output reserve, requested-context and native verification gates, profile/digest/runtime epoch preparation identity, calibration and model-target key validation, maximum extraction source/claim bytes and number of chunks all remain intact. Bounded mocked tests verify those contracts, **not actual observed local-model behavior**, active context allocation, or the absence of a fallback on a live inference dispatch. A genuine protected-budget overrun is still rejected. No ForgeBoard continuation, application success or final Muse verdict is claimed.

**Reason for retry NO:** broad source/native safety regressions remain red; the correction has strong offline structural + native persistence evidence, but the required broad validation gate is not clean. Future authorization would require resolving/classifying those failures, rechecking target/retrieval/continuation in the intended production environment, and a separate explicit acceptance decision. This task never runs that acceptance.

Protected pre-existing dirty files, both stashes, the frozen transcript, tracker and operator settings must remain untouched. Selective changes should contain only generic compaction source, current-source tests and this report; **no reset, clean, push or source/archive repair**.

### Final working-tree disposition

**No commit was created** because the broad safety regression gate remains red, even though the scoped segmentation correction and preserved native/TypeScript replays pass. Final repository HEAD remains **`47da08dba08f9a3635aaaca4ec737c37f1283253`**. Generic changes and the report remain in the working tree for review rather than being staged as a purported fully-cleared release candidate. The six original dirty acceptance-related files, both original stashes, the archived Muse/ForgeBoard evidence and the protected operator/tracker state were not intentionally changed by this investigation. No push, clean or reset was performed.
