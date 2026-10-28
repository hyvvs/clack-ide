# Frozen remote control: insufficient-progress termination forensics (offline)

**Starting HEAD:** `c3651df8871850533744eb5b7f767748ddebc704`.
**Final classification:** `REMOTE CONTROL MODEL/AGENT-BEHAVIOR FAIL`.
**Generic Clack *progression* defect proven:** **NO**. No production change was warranted or made. The original remote notes control remains `REMOTE CONTROL FAIL — CLACK END-TO-END NOT YET PROVEN`; the local-model bake-off remains `LOCAL ACCEPTANCE BLOCKED BY RUNTIME RELIABILITY`.

This investigation read the preserved OpenRouter `nvidia/nemotron-3-ultra-550b-a55b:free` mission from `src-tauri/target/remote-controls/remote-nemotron-ultra-notes-20261028-01/`. It neither issued inference nor changed/restarted any local provider, SSH forwarding, frozen app, settings or model. The frozen independent app result remains `NOTES_APP_FAIL`. Tool/file input and generated reasoning text were not printed or copied into this report.

## Actual nine-segment timeline

Source: persisted `data/terax-ai-sessions.json`, `messages:remote-notes-control`, last assistant `parts` and `metadata.clackAnswer.segments`; `mission-a-1.native-report.json`, `mission-a-1.json`, `mission-a-1.events.jsonl`; frozen workspace and evaluator.

Every segment contains a saved `reasoning` part. **No segment has a saved assistant `text` part**. The reasoning character counts below are *only lengths*, not decoded/reprinted model content. One step-start part corresponds to each persisted answer segment, but persisted step-start does not by itself prove a separately correlated provider HTTP request.

| Step | Started at (Unix ms) | Duration ms | Reasoning characters | Provider finish / output tokens | Native tool and outcome | Observable workspace change |
|---|---:|---:|---:|---|---|---|
| 1 | 1793168873080 | 4305 | 1040 | `tool-calls` / 352 | `list_directory`, `output-available`, no error | Directory inspection, no mutation |
| 2 | 1793168877777 | 9486 | 261 | `tool-calls` / 362 | `write_file`, `output-available`, `ok=true` | `package.json` |
| 3 | 1793168887690 | 3643 | 40 | `tool-calls` / 260 | `write_file`, `output-available`, `ok=true` | `tsconfig.json` |
| 4 | 1793168891700 | 1446 | 38 | `tool-calls` / 118 | `write_file`, `output-available`, `ok=true` | `.gitignore` |
| 5 | 1793168893725 | 3112 | 91 | `tool-calls` / 102 | `create_directory`, `output-available`, `ok=true` | `src/` |
| 6 | 1793168897374 | 7374 | 39 | `tool-calls` / 412 | `write_file`, `output-available`, `ok=true` | `src/types.ts` |
| 7 | 1793168905285 | 13562 | 53 | `tool-calls` / 634 | `write_file`, `output-available`, `ok=true` | `src/storage.ts` |
| 8 | 1793168919412 | 14347 | 76 | `tool-calls` / 955 | `write_file`, `output-available`, `ok=true` | `src/index.ts` |
| 9 | 1793168934340 | 53010 | 32 | **`length` / 2048** | **No tool call** | No observed change |

All nine segments have `usageReported=true` and `pending=[]`; all have an end timestamp. Cumulative reported segment output tokens **5243**, less than the shared 16,384-token answer reserve. First-to-last answer segment window is **114,270 ms**; this is not the internal answer-continuation timer, which was never charged. The last 53,010 ms belongs to step 9's provider response window, not a Clack-generated continuation.

The original app workspace was frozen after termination and contains six authored project files (`package.json`, `tsconfig.json`, `.gitignore`, `src/types.ts`, `src/storage.ts`, `src/index.ts`) plus the Agent-created `src/` directory; no tests or README. There are no recorded `todo_write` calls, no todo progress, no built/running backend and no later corrective action. File writes are independently corroborated by the frozen workspace and `ok=true` native results, not inferred merely from tool call text.

## Exact code path and decisive guard

Source `src/modules/ai/lib/answerContinuation.ts`, function `withAnswerContinuation`. A provider `finish` records `normalizeAnswerFinish`, usage, generated token budget and validated tool calls. At lines ~954-990, `finish !== "length"` and absence of native-tool imitation normally finalize a segment without **any answer-continuation retry**. The first eight `tool-calls` segments passed through that path; SDK tool results could then be executed normally.

Step 9 instead reported `finish="length"` and `calls.size=0`. The state enters `preparing`, then the following guards occur **before any new provider call**:

1. Reasoning-output exhaustion requires more than reasoning: a single answer segment, output usage at the requested allowance, no text/calls and no current-turn progress (lines ~994-1009). The actual `state.segments.length=9`, so that special exception was not eligible. Prior successful tools also matter to `currentTurnHasProgress` when present in the prompt.
2. Shared answer limits check 120 seconds of *continuation time*, 16,384 generated tokens, run remaining calls, and whether automatic answer continuation is enabled (lines ~1010-1027). Saved `state.continuationTimeMs=0`, accumulated output tokens 5243, `state.continuations=0`. No evidence any earlier limit stopped the request.
3. When no imitation or interrupted tool needs repair, the exact predicate is **`text.trim().length < 16`** (lines ~1045-1055), after `state.continuations >= Math.min(3,maxContinuations)` is checked. `text` is the **current provider segment's `text-delta` buffer**, initialized to `""` at ~659 and appended only by `text-delta` at ~817; **`reasoning-delta` does not count**. The preserved step 9 has zero text parts, so `text.trim().length=0`. That makes the guard **true** and throws exactly **`Answer continuation made insufficient progress.`**.
4. The catch at ~1116-1147 records `clackAnswer.state="incomplete"`, exact reason, publishes it and enqueues the stream error. The outer error is normalized as terminal; saved `run.state="failed"`, `error.kind="unknown"`, `disposition="terminal"`, `retryable=false`. No additional `inner.doStream` occurs as a result of that guard.

**History window:** only the *current provider segment's* accumulated answer text (not N prior SDK steps). Prior assistant/tool progress is specifically considered by `currentTurnHasProgress(params.prompt)` for the **distinct reasoning-output-exhaustion diagnosis**, not for the minimal-text gate. The insufficient-progress predicate has no fingerprint, no repeated tool-call counter, no filesystem inspection, no todo-state read, no Agent run-step budget read, and no assistant prose quality scoring. Six successful writes therefore correctly count as actual SDK/tool work, but do not make the **ninth zero-text `length` answer** safe to extend automatically. This is a *fail-closed partial-answer safeguard*, not a claim that the Agent never made useful workspace progress. Repeated failed tool calls are handled by an independent `observeRunStep` fingerprint mechanism (`runBudget.ts`, `REPEATED_FAILURE_LIMIT=3`); the eight observed tool results were not failing tool loops. Todo-only churn is not an escape hatch for the minimal-text guard.

The archived test `answerContinuation.test.ts` already explicitly expects this message for a reasoning-only `length` response even **after current-turn successful tool progress** (test `does not advertise reasoning-only retry guidance after current-turn tool progress`, lines ~387-438). Other tests cover meaningful textual continuation, the three-output-continuation cap, SDK protocol and repeated length stops. This is evidence of an intentional generic guard, not a fresh model-specific branch.

## Why the zero-step budget did not cause termination

`agent.ts`'s `runAgentStream` passes `stopWhen: stepCountIs(24)` for a standard Coder (lines ~1393-1407), increments **in-memory** `stepsSeen` in SDK `onStepFinish` (~1409), and only invokes `onFinishMeta({steps:stepsSeen, ...})` from SDK **batch `onFinish`** (~1444). `transport.ts` passes `onFinishMeta` through to `chatRuntime.ts`; `chatRuntime.ts` calls `recordRunBatch`; `chatStore.ts`/ `runBudget.ts` then update the **persisted** `budget.totalSteps` and decide `auto-continue-pending`. No such successfully committed batch finalization appears in this failed run.

Consequently persisted `totalSteps=0`, `lastFinishReason=""`, `phase="running"`, `continuationCount=0`, even though eight full tool steps and a ninth partial step are saved in conversation data. This is **batch-commit vs SDK-step observation semantics (C)**, with an **important failure-time observability limitation**: `totalSteps` is not a live or failure-safe count of physical SDK/provider generations. It is the number of accounted steps from *finalized successful Agent batches* plus separately charged hidden preparation calls. The stored zero does not mean zero inference or zero successful native effects. Reproducing this with per-step callbacks on failed SDK batches can be a worthwhile subsequent **telemetry-only** enhancement, but correcting that counter is not a proven prerequisite to this outcome.

`answerContinuation.ts`'s insufficient-text predicate has no access to `run.budget.totalSteps`. The surrounding answer-continuation `remaining` callback subtracts local `stepsSeen` from remaining logical-run budget, but the run had `hardStepLimit=240`, `softStepLimit=24` and fewer than 24 observed steps; budget exhaustion was not the triggering condition. No evidence the persisted zero suppressed a valid continuation; if anything, zero overstates remaining room in a failed batch. A fresh automatic logical batch is never eligible because the active SDK stream fails before a successful batch-finish transition.

## Logical continuation ordering and historical comparison

These are distinct:

- **Within-answer extension** (`withAnswerContinuation`): only for a provider `length` segment with adequate *current-segment text* (or a separately constrained native-tool repair). Limit 3 extensions, shared 16,384-token output budget, and bounded continuation time. The step-9 insufficient-text exception fired **before** a provider extension was dispatched.
- **Logical Agent batch continuation** (`recordRunBatch` -> `auto-continue-pending` -> `consumeAutoContinuation` -> `sendAutomaticallyWhen`): reached only after the SDK batch ends and `onFinishMeta` evaluates the result. Requires eligible trusted-workspace/full-access permission mode, an ordinary soft tool boundary or unfinished-work contract, and remaining 240-step/9-continuation budgets. A failed stream does not pass that completion boundary.

**Actual remote:** `autoContinue=true`, `softStepLimit=24`, `hardStepLimit=240`, `maxAutoContinuations=9`, `totalSteps=0`, `continuationCount=0`, `lastFinishReason=""`, `phase="running"`, `continuationPromptPending=false`, Agent `failed`. The run was still inside the first normal Coder batch (step 9 of a maximum 24); it did **not** reach a 24-step logical continuation boundary. The failure occurred earlier, at the distinct answer-continuation guard. No continuation should automatically dispatch after that terminal stream error.

**Historical evidence only:** preserved R5x ForgeBoard `forgeboard-nemotron-r5x-20261023-01` accounted **25** Agent steps and **1** logical continuation after **24** `output-available` native tool effects, with an observed `auto-continue-pending -> running` transition; the following inference was *not* dispatched because self-hosted Automatic verification failed. R5v similarly accounted 24 steps and one attempted logical continuation. Archived GLM-4.7 Flash notes `glm47flash-r5be-notes-20261025-01` saved **36** accounted steps and `continuationCount=1`, but the overall mission failed. A read-only scan across **128** preserved session stores (109 run records) did **not** identify a `completed` run with `continuationCount>0`; **do not claim a proven fully successful post-boundary Agent completion**. These runs establish that the *batch-accounting/continuation transition* can be reached after SDK/tool steps, but do not prove a healthy complete end-to-end app.

## Decision and next action

**No generic Clack *progression* defect is proven.** Source, nine saved segments and existing offline regression expectations agree: the hosted model made eight legitimate tool edits and then emitted a ninth, reasoning-only, output-limit-truncated segment without an answer or native tool. The fail-closed answer-continuation guard detected precisely that non-progressing segment and terminated before another provider request. This is an **ordinary model/Agent-behavior failure at the output boundary**, not an erroneous assessment that those first eight file writes never occurred. The stored zero-step budget is **not an input** to the termination guard or a cause of suppressed logical continuation. There is a separate diagnostic limitation in the failed-batch counter, not a demonstrated shared-accounting progression bug.

**Next recommended action (NOT executed):** authorize a distinct control with **one materially stronger/different hosted coding model**, while retaining normal Clack tool and truthfulness rules. Do not re-run this frozen control, alter current output/step ceilings as a supposed fix, or generalize Ollama failures from this hosted result.

## Offline validation and state preservation

- Focused Vitest command targeted `answerContinuation.test.ts`, `runBudget.test.ts`, `chatRuntime.test.ts`, `streamRecovery.integration.test.ts`, `selfHostedRouting.test.ts` and `agentCompaction.integration.test.ts` (excluded `src-tauri/target/**`). Result: **193 pass; 1 fail**. The only failure is a **15-second timeout** in the unrelated compaction integration test *“switches a large cloud conversation to a smaller endpoint and actually sends the staged target context”*. The same test **timed out again in isolation**, with 10 other cases in that file skipped. This was not a predicate assertion or evidence of a Nemotron progression defect. Do **not** report the aggregate suite as all passing.
- `answerContinuation.test.ts`: **79/79 PASS**. `runBudget.test.ts`: **15/15 PASS**. The other four suites' remaining 99 focused tests passed in the aggregate command, including real mocked transport/continuation and accounting checks.
- `npm.cmd run check-types`: **PASS**. `npm.cmd run build`: **PASS** (existing dynamic import/plugin timing warnings). Native code was not changed; no native tests or live inference were run.
- Seven protected SHA-256 hashes: **7/7 match**. Historical R5di frozen hashes: **14/14 match**. Remote-control report/evaluation hashes: **5/5 match**. Original Clack settings match the pre-control SHA-256. The original six pre-existing dirty tracked files, two stashes, tracker, and frozen notes application were not changed.
- Read-only preflight found **no active TCP listener on `127.0.0.1:11435` and no original SSH tunnel PID 12932**. Provider metadata GETs failed because that forwarding path was unavailable. The tunnel had already been absent when this task began; it was **not** modified or re-established. Therefore the current live 15-model inventory **cannot be independently reverified**; no Ollama configuration, model state or hardware action was taken. Do not claim the absent listener was preserved as running.

No production behavior edits or regressions to weaken stagnation/loop protections were appropriate. The documentation-only forensic artifact is the sole task-owned change.
