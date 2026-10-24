# R5ak — Coding Agent shell lifecycle and one real application acceptance

**Date:** 2026-10-24 · **Base commit:** `69afec09c697a9d8adb26c72458247e5d5316ade` · **Scope:** one focused, Windows-tested shell lifecycle correction and at most one fresh real local Qwen notes API Agent run.

## Frozen R5ai evidence and classification

The R5ai native Agent used the exposed `bash_run` foreground shell tool for `npm run dev`, despite having `bash_background`, `bash_list`, `bash_logs` and `bash_kill` available. Its tool part was `tool-bash_run/input-available` with no tool result, followed by no more native inference; the persisted Agent stayed `running`. R5ai previously produced real native source/test writes and 25 settled tool results from 33 completed inference requests, but neither completed nor independently passed its notes application acceptance. The acceptance host recorded the operator-stopped run as failed; no separate host hang defect was demonstrated.

The original Clack Rust `run_blocking` killed only the immediate shell on timeout, then unconditionally joined stdout/stderr drains. An owned `nodemon`/server descendant could inherit the pipe write handles, preventing EOF and leaving the Tauri tool invocation and Agent unresolved. A disposable **real Windows** regression reproduced the production defect *before* the fix: configured timeout **1 second**, actual shell call **~30.68 seconds**, assertion `timeout blocked on inherited pipe`. With the correction the same regression passed in ~1.04 seconds. Root cause is **both model tool selection and proven production shell process-tree/pipe-lifetime defect**, not a proven acceptance-host error.

The separately frozen eight-file R5ai app was copied, hash-checked and evaluated in `src-tauri/target/r5ak-frozen-r5ai-evaluator/` only, with existing dependencies linked read-only from its old workspace. **Build FAIL** (exit 2; TS2322 handler returns and TS6133 unused arguments). **Tests FAIL** (exit 1; missing `ts-jest` preset). Startup, REST CRUD, persisted restart and README verification did not pass. The eight original historical application file hashes remained unchanged; no source fixes were applied.

## Minimal production and Coder changes

- `src-tauri/src/modules/shell/mod.rs`: generic foreground commands have Windows private, kill-on-close Job Objects (reusing existing `PtyJob`) or Unix private process groups. On success, failure, timeout and cancellation, dispose **owned** process trees before awaiting output drains. Poll exit and cancellation at bounded intervals. Timeouts return `timed_out=true` with no exit code; cancellation errors are distinct. Async Tauri command future disposal signals the owned blocking call. `ShellState` disposal closes its sessions and explicitly stops only background handles in that state.
- `src-tauri/src/modules/shell/session.rs`: active command cancellation tokens and close checks terminate pending shell calls instead of detaching unowned workers.
- `src-tauri/src/modules/shell/background.rs` and `src-tauri/src/modules/pty/job.rs`: managed background commands get exclusive Windows jobs/Unix process groups; explicit stop terminates the owned descendants. State teardown does not depend on reader thread `Arc` references releasing a job. No global PID/name kill fallback.
- `src/modules/ai/tools/shell.ts`: exact native shell cancellation is recorded as `cancelled` rather than `not-started`, with `cancelled:true` returned; failure, timeout, success and blocked outcomes keep their existing meaning and approval behavior.
- `src/modules/ai/lib/agents.ts` and `coderCompletionGuidance.test.ts`: narrow model-neutral Coder guidance to use exposed managed background handle/list/log/kill tools for persistent watchers/servers, keeping foreground shell for terminating commands. No forced tool calls, model/transport/permission/context/proof/continuation/timeout policy changes.

## Offline proof before new acceptance

| Gate | Outcome | Qualification |
| --- | --- | --- |
| Windows foreground finite success/failure, timeout + inherited pipe, cancellation/session close, owned descendant vs unrelated process | **PASS 4/4** | Real Windows PowerShell/Job Object processes; timeout settles within seconds, ownership isolation verified |
| Windows managed background start/log/explicit descendant stop, owner-drop descendant cleanup | **PASS 2/2** | Real managed process trees |
| Windows PTY Job Object invalid PID and kill-on-drop tests | **PASS 2/2** | Real Windows |
| R5ak isolated native acceptance host wire/Automatic proof guards | **PASS 6/6** | Rust example tests; example builds |
| Focused Agent/continuation/tool-exposure/frontend tests | **PASS 188/188**, 10 Vitest files | No normal permission/verification bypass |
| `npm.cmd run check-types` | **PASS** | TypeScript |
| `npm.cmd run build` | **PASS** | Clack production frontend, 1,280 modules transformed |
| `npm.cmd run lint` | **PASS** | Existing warnings, no automatic code fixes |
| Scoped `rustfmt --check` for four edited production Rust files | **PASS** | Whole-crate fmt remains red due unrelated existing example/code format differences, left untouched |
| Linux/macOS native execution | **NOT EXECUTED** | Unix process-group code exists; cannot claim OS qualification from Windows |

An initial rerun of the owned-vs-unrelated test assumed every terminated Windows process handle was signalled immediately; it failed once. The test now allows up to 3 seconds for asynchronous Windows Job termination, and always cleans its disposable unrelated test process before assertions. The final four-case foreground suite passes; no product timeout duration or ownership policy was relaxed.

## One fresh real Qwen coding run

**Reserved run:** `qwen-smoke-r5ak-20261024-01` · **Spec:** byte-identical to `r5aiSmokeAgentAcceptance.tsx`, local-first Node+TypeScript notes API, port 4321 · **Profile:** unchanged saved Automatic `qwen3-coder:30b` profile and native qualification/permissions.

**Actual one-run outcome: FAIL for coding mission; shell regression NOT EXERCISED live.** `mission-a-1.json` records 6/6 calibration contexts through 65,536 and **8** completed native HTTP inferences total: six calibration, one 65,536/512 single-tool native verification, and one 65,536/2048 Agent-generation request with **18** real exposed schemas, all provider-default `think` omitted. The saved Agent conversation identifies **one normal terminal `stop` step**, zero auto-continuations and no real coding tool calls. Its answer starts with an implementation intention but then contains **textual pseudo-tool markup** for `list_directory`, not an actual SDK/native tool call. The Agent state is `completed`; the requested software task is **not** completed. The host exit was 0 with report `resultOk=true`, but `missionRequests=0` in the narrow acceptance report is not a proof of coding progress; the raw wire and session persistence show the single Agent request and text-only result. There was no live persistent server, shell timeout, tool process cleanup or application build to exercise.

At the **natural stop**, the exclusive workspace contained only `.git`. Before independent checks, `scripts/r5ak-independent-notes.mjs` froze its application-source manifest as the empty JSON object `{}`, and verified it remained unchanged after evaluation. Evidence: `src-tauri/target/real-qwen-product/qwen-smoke-r5ak-20261024-01/frozen-source-manifest.json` and `independent-notes-check.json`. The script was run once; no app source was repaired, no coaching or repeat mission occurred.

| Independently evaluated app requirement | Result |
| --- | --- |
| Generated application files | **FAIL** (zero source files) |
| Authored automated tests | **FAIL** (absent) |
| README and runtime Git ignore | **FAIL** (absent) |
| Executable tests and production TypeScript build | **BLOCKED** (no package.json) |
| Independent TypeScript compilation | **BLOCKED** (no local installed compiler) |
| API server startup on port 4321 | **FAIL** (no start/dev script) |
| Health, notes CRUD, malformed input, validation, missing resource, persistence across restart | **BLOCKED** (no healthy backend) |
| Evaluator source preservation | **PASS** (empty frozen manifest unchanged) |

**Conclusion:** the narrowly reproduced shell/process-tree defect is fixed with real Windows evidence; **this one live Qwen attempt did not exercise that fix**, because the model stopped after a non-executable pseudo-tool response. There is no evidence that Clack falsely performed the text as a native tool or that the acceptance host prevented a valid call. The run does not complete the user's application objective and cannot qualify full ForgeBoard. No extra attempt is authorized in this checkpoint.

## Preservation and deferred goals

Protected six pre-existing user-dirty files retain their recorded SHA-256 fingerprints; saved Automatic Qwen settings hash remains `2d39dcfdd946acc733ba77ac1c8e68a226aeb46f013e68902a71002bd54592bb`. Existing two Git stashes, `autonomous_tracker/`, historical R5ai evidence/partial application, inactive Codex worktree, and pre-existing SSH tunnel listener `127.0.0.1:11435` PID `36768` are not checkpoint-owned. No push/reset/clean/cloud fallback/model download/remote changes are authorized. Reverify final state at closeout.

**Still open:** R3d current packaged-desktop chat/approval/restart qualification; an independently passing full original ForgeBoard application acceptance; repeatability under real-Agent long tasks; Linux/macOS OS execution and the **entire mandatory P2–P19 CoS-inspired capability-platform roadmap** (security, integrations, agent E2E, multi-platform) remain **DEFERRED**, not cancelled. Stop after this single checkpoint.
