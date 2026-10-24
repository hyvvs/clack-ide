# R5al — Native tool imitation correction and one Qwen coding acceptance

**Date:** 2026-10-24 · **Base:** `f153dfdf34003e8aed5051e8081146115f3ad50c` · **Scope:** one focused model-neutral Agent behavior change, offline verification, at most one original notes-API real local Qwen run.

## Confirmed native-provider contract

The installed AI SDK v6 accepts `toolChoice: "required"` as a generic control. However the production `createOllamaModel` adapter uses Ollama's **native** `/api/chat`, not an OpenAI-compatible `/v1/chat/completions` serialization path. In `src/modules/ai/lib/ollamaModel.ts`, `ollamaBody` limits exposure for named/none choices but omits a `tool_choice` request field entirely, and `warnings` explicitly reports required/named choice unsupported because the native Ollama API cannot force a tool call. A real production-adapter + SDK serialized-request test confirms that `toolChoice:"required"` is accepted as an API parameter **but does not enforce native calling**: Ollama may return ordinary text with no `tool_calls`. No unsupported protocol field, model-specific override or stronger qualification claim was introduced.

The R5ak persisted Agent text `<function=list_directory>` was **not** an SDK tool-call event, despite 18 exposed native schemas. Clack correctly left it inert, with zero source files and a naturally stopped one-step coding run. This is not evidence that the text should be executable.

## Smallest bounded implementation

- `src/modules/ai/lib/nativeToolImitation.ts` identifies only unmistakable standalone XML/function/JSON *imitations* of a currently exposed tool. No tool-call payload is parsed, synthesized, forwarded or executed from this text. An actionable imperative in the latest Coder user request is required; ordinary explanations/reviews/final responses are unaffected.
- `agent.ts` enables the guard only for built-in Coder, not plan mode, with an actionable user request and a currently exposed tool allowed by existing permission policy. The guard uses the actual per-request `params.tools` exposure, never expands F1 or permissions.
- `answerContinuation.ts` uses its **existing** native model re-inference, live ownership validation, cancellation, context measurement, output/continuation caps and run-budget charge to send **at most one** explicit correction that the prior tool-looking text did not execute. The previous pseudo response is included as *text evidence*, not a native call. If the next response genuinely calls a native tool, the SDK's normal schema/approval/execution path handles it. If it again returns text, the answer state is **incomplete** with `nativeToolImitationBlocked=true`; native tool execution remains zero.
- `runBudget.ts`, `transport.ts` and `chatRuntime.ts` carry that terminal failure to a **soft-limit/blocked-work** rather than a falsely successful finished task. This blocked result does **not** trigger automatic Agent continuation; only the existing explicit continuation UX remains available.

No global force-tool policy, text-to-tool parser, universal loop, tool-selection exposure change, new privilege, native-verification weakening, reasoning/profile/transport change, context trust change, permission bypass, budget increase, or model download. Existing stopped-foreground/background server handling from R5ak remains intact.

## Offline verification

| Check | Result |
| --- | --- |
| Adapter + SDK required-tool serialized wire is not enforced | **PASS** (no `tool_choice`, warning; text-only without execution) |
| Fake XML, JSON/function calls never execute, one bounded retry invokes true SDK structured call | **PASS** |
| Repeated text blocked, legitimate prose unchanged, missing/denied tools inert, cancellation and run-budget limits | **PASS** |
| Focused 11 Vitest suites | **PASS 302/302** |
| `npm.cmd run check-types` | **PASS** |
| `npm.cmd run lint` | **PASS** (existing warnings) |
| `npm.cmd run build` | **PASS** (Clack production frontend) |
| Isolated R5al Rust acceptance-host wire guards | **PASS 6/6**; example build **PASS** |
| Windows foreground lifecycle regression | **PASS 4/4** |
| Linux/macOS runtime qualification | **NOT EXECUTED** |

## Exactly one unchanged real Qwen acceptance

Run root: `src-tauri/target/real-qwen-product/qwen-smoke-r5al-20261024-01/`.
Workspace: `src-tauri/target/qwen-smoke-r5al-20261024-01/`.
New harness copied from R5ak with only identifier/file-name substitutions; the user-facing notes API task is **byte-identical**. Saved `qwen3-coder:30b` Automatic profile hash `2d39dcfdd946acc733ba77ac1c8e68a226aeb46f013e68902a71002bd54592bb`; same calibration, native verification and permission/continuation behavior. Exactly one mission; no manual coaching, app-source repair, custom retry or cloud fallback.

### Observed terminal outcome — **FAIL: coding mission; PASS: bounded correction enforcement**

- The one host completed normally (native process exit 0 and runner report `resultOk=true`). Those statuses are **not** application acceptance.
- **9 native HTTP dispatches**: six Automatic calibration contexts (4096, 8192, 16384, 32768, 49152, 65536), one real native-tool verification at 65536 with one schema, and **two Agent-generation requests** at 65536/2048 with **18 native tool schemas each**. All requests retained omitted/default Automatic `think`; no model/profile/permission changes.
- First Agent response repeated a text-only `<function=list_directory>` imitation. The model-neutral correction dispatched exactly **one** additional real inference (`inference-9`) under the same native path and tool exposure. Its reply produced **no structured tool call** (second response accounted for one output token). There were **zero** real Agent filesystem, shell, background or other native tool invocations.
- Persisted `clackAnswer`: `state=incomplete`, `nativeToolImitationBlocked=true`, `continuations=1`, two `stop` answer segments, with the explicit reason: **“Coder did not invoke a native tool after the bounded pseudo-tool correction; no tool executed.”** Persisted run budget: `phase=soft-limit`, `stopReason=blocked-work`; *not* a task-success certification or an automatic retry. The saved run top-level state remains `running` while soft-limited, reflecting its existing user-controlled continuation eligibility. No second mission or intervention occurred.
- Thus the correction and truthful blocked-state handling **were exercised live**, but Qwen still failed to use actual native tools. This is a repeatable model/provider tool-use reliability limitation in these runs; the available evidence does not justify another Clack-wide tool parser or tool-selection bypass.

After natural stop, the workspace contained **only its `.git`**. The independent evaluator was executed exactly once and wrote `frozen-source-manifest.json` containing `{}` before any tests. Its `independent-notes-check.json` confirms unchanged frozen source afterward.

| Independent application requirement | Result |
| --- | --- |
| Source files and runnable app | **FAIL** (zero files) |
| Authored API tests | **FAIL** (absent) |
| README/setup | **FAIL** (absent) |
| Runtime data file ignore | **FAIL** (absent) |
| TypeScript compilation | **BLOCKED** (no local compiler) |
| Production build and authored test execution | **BLOCKED** (no package.json) |
| Port 4321 API startup | **FAIL** (no npm start/dev script) |
| Health, notes CRUD, input validation and error codes | **BLOCKED** (no server) |
| Persistence across restart | **BLOCKED** (no server) |
| Frozen source unchanged during evaluation | **PASS** |

**Decision — one next action, separately authorized:** evaluate a **different already-installed local coding model** under unchanged Automatic/native verification and one independently evaluated small coding mission, rather than repeatedly weakening Clack around Qwen text-only function imitation. This checkpoint **does not** launch that evaluation. R3d packaged desktop and full ForgeBoard acceptance remain open.

## Preservation and next boundary

The six pre-existing dirty files, two stashes, `autonomous_tracker/`, historical R5af–R5ak evidence, inactive Codex worktree, saved profiles, and the user-owned `127.0.0.1:11435` SSH tunnel (initial PID `36768`) are excluded from the commit and may not be changed. R3d packaged desktop qualification remains **OPEN**. Full original ForgeBoard acceptance remains unproven. The complete P2–P19 CoS-inspired capability-platform roadmap (security, integrations, real-Agent E2E and Windows/Linux/macOS) remains **MANDATORY / DEFERRED**. No future mission is authorized by this report.
