# R5 — Independent Real-World Local-Model Application Acceptance

**Outcome: R5 LIMITED.** On 2026-10-22 the sole authorized live, normally configured Clack Agent mission reached its natural terminal state, after seven genuine mission inference requests and seven genuine native tool calls. It produced an npm/TypeScript scaffold but **no runnable ForgeBoard backend, UI, or application functionality**. The Agent stopped with a *local Clack context-route preflight rejection*, not a model answer asserting completion, a provider HTTP outage, a continuation/budget expiration, or a verified model-quality conclusion. The independent software checks below fail to qualify a product. **R3d packaged-desktop acceptance remains BLOCKED. Local/self-hosted Agent readiness is NOT established.** This result does not generalize to other installed local models.

## Identity, isolation and source custody

- Authorized original `main` HEAD: `ae8d48c9da9f2e4d326583d2e77bd706cbd40e8d` (`test(ai): measure native checkpoint savings at Ollama dispatch boundary`). Exact at intake; no tracked source edits during mission.
- Exactly **one** mission: `forgeboard-nemotron-r5-20261022-03`, `mission-a-1`, hosted by the **existing hidden native Tauri production-IPC acceptance host**, not a packaged Clack app. The retained runner session `68776` naturally exited; `runner-exit.json`: child code **0**, `signal:null`, `runnerPid:47964`; `mission-a-1.json` and `.native-report.json` exist. The host's report has `ok:true` (successful evidence collection) while the **Agent's own run is `failed`**. Native host PID `23196` and runner PID `47964` no longer exist after exit.
- Isolated generated root: `C:/Users/Hayden/Documents/forgeboard-nemotron35-lightning-20261022-03`; run artifacts: `src-tauri/target/real-qwen-product/forgeboard-nemotron-r5-20261022-03/`. Both are outside the tracked commit; logs may contain full prompts and remain ignored/local. R5 used an ignored copy of the existing runner with only setup path, expected HEAD and run-ID prefix changed. Original acceptance spec hash remained `f97ec34eefa136ac5be5847187f768b64bf5587d36140d9fcc53b695fa3e4801`.
- Authoritative evidence SHA-256: `runner-exit.json` `B4E913C5574BF04A82869076FAF55FCD8A518F23927FE89C4D472265BD6C7C4C`; `mission-a-1.json` `0B2D31CA2CF00DCBFAB7AF1399A2186666343573E93140941C91C6489BEB6D37`; `mission-a-1.requests.jsonl` `21437F7E243A65FA7F666C860AA364798A88A738C443935D486B83866507148F`; `mission-a-1.jsonl` `C44B5D59D8C64C296B954B3F867D622A77CE85E917F8B37FC98261E1AD93D893`. The native-report, stream-receive and attempt files are retained in the same ignored directory. Do not replay them as new inference.
- Six original dirty user files remained byte-for-byte identical to their intake SHA-256 hashes; no staging before closeout. The two original Git stashes and `autonomous_tracker/` stayed present. Manual SSH `ssh.exe` PID `34144` was still running after mission, untouched; no remote/model/network configuration changes, model downloads, cloud requests, second missions or source repairs.

## Readiness and effective provider settings

| Observation | Native/live evidence |
| --- | --- |
| Production Clack endpoint | `real-qwen`, `http://127.0.0.1:11435/`, native `/api/chat`; manually owned SSH tunnel left intact; saved connection has no managed SSH configuration and no credential reference |
| Engine and model | Ollama **0.40.5**; `nemotron-3.5-lightning:30b-a3b-q4_K_M`, digest `e7a64ff15fb174c42b4f463e5c888c4f2c7b9cabf9e8d65a1c0874405426c1b2`; GGUF/Q4_K_M Nemotron MoE, installed; `/api/show` advertises completion/tools/thinking |
| Saved normal profile | Matching endpoint/digest; verified context calibration and native-tool capability; overrides `{}`; no model switch or manual runtime settings |
| Readiness | Ten real native requests (`inference-1`–`10`) including bounded context calibration and tool/thinking probes, separate from mission; successful Ollama metadata and native stream readiness |
| Mission | **Seven** actual requests (`inference-11`–`17`), all to expected Ollama URL/model, `options.num_ctx:65536`, `options.num_predict:2048`, **14 native tool schemas**, `think:true`; Clack reasoning selection `automatic` (effective provider control, not a manual forced effort). All seven ended `done_reason:stop`, with valid provider delivery |
| Context | Captured `runtimeTarget:65536`, deployed `65536`, advertised maximum `1048576`, no manual working-context override. Last audited request: system estimate 3,755, tools 6,499, conversation 5,689 (~15,943 estimated tokens), working budget 51,639, ~35,696 estimated headroom; provider `prompt_eval_count:7727` on `inference-17` (a different measurement). No material natural pressure |
| Network/release | 17 accepted native inference attempts (10 readiness + 7 mission), 0 cloud, 0 fallback, no second model; postmission `/api/ps` reported same digest and loaded context 65,536, `/api/version` still 0.40.5 |

## Native execution, correction and terminal truth

- The seven genuine structured native tool calls are: `list_directory`, `todo_write`, then `bash_run` five times. The first shell command (`cd ... && npm init -y`) **failed with exit 1** because Windows PowerShell 5.1 does not recognize `&&`. The model's next shell call, `npm init -y`, succeeded. `npm install express cors ts-node typescript @types/express @types/cors concurrently nodemon` succeeded and created the lockfile/dependencies (npm output reported three high-severity audit findings); `npx tsc --init ...` succeeded; `mkdir -p .../src` succeeded. No `write_file` or `edit` call or model-authored application source was observed. Shell-created npm/config artifacts are not equivalent to independently confirmed native source edits. There were **zero** confirmed writes in `correction-state.json`.
- The genuine accepted structured Todo contained seven items: backend initialization `in_progress`; backend API, frontend initialization, frontend UI, backend tests, production build and README all `pending`. No independent native verification receipt, test/build receipt, completed objective, correction reconciliation or final app-claim evidence exists. The last state is `run.state:"failed"`, not success; all seven obligations remain outstanding. One failed shell call and four successful shell calls have their actual receipts, but none certifies ForgeBoard semantics.
- Conditional correction was **not** sent (`correctionSent:false`; correction observer status `pending`, `writes:[]`): the mandatory three independently confirmed writes **did not occur**, regardless of original page-size 50 being present in the initial user spec. Thus page-size **50** remained the uncorrected mission requirement. A 25-page implementation was neither requested nor verified; never inject the update after the fact.
- Seven mission responses had actual native Ollama `tool_calls` delivered/recognized by Clack; no `<tool_call>` / `<function=...>` pseudo-tool markers appeared in the captured assistant text portions, and no pseudo-tools were executed. The earlier R1 model-vs-Ollama renderer/template question remains a *separate historical unresolved matter*, not proven to recur here.
- At ~**05:00:22 UTC** the Agent ended after only seven steps (`softStepLimit:24`, `hardStepLimit:240`, `autoContinue:true`, nine allowed auto-continuations, **zero used**, `stopReason:null`). Terminal nonretryable `bad_request`, `errorCode:"ollama-context-route"`, title `Context preflight`: **“Ollama runtime context/model does not match the captured profile.”** The prior seven observed bodies all matched 65,536 and the configured model. Source at `src/modules/ai/lib/requestPreflight.ts` rejects when the next serialized body model differs from the captured model or its `options.num_ctx` differs from current `runtimeTarget()`. The rejected next body and contemporaneous runtime target were **not preserved as a provider-bound request**, so the precise mismatch is **not independently attributable** to model generation, the SDK serializer, a refreshed target, or a generic production bug. There was no `inference-18` provider dispatch. Do not label this transport failure, timeout, limit exhaustion, or proven parser defect. A narrowly scoped future investigation is warranted; no production fix or retry was authorized in R5.
- No naturally eligible/activated native checkpoint, live projection or provider-bound token reduction is evidenced. **LIVE CHECKPOINT PRESSURE NOT EXERCISED**; actual R5 live savings: **not measured**. The previous R4 **16,504 estimated tokens** was an intercepted production serializer comparison, **not** savings in this run. No same-run checkpoint continuation or pressured safety could be qualified. No deadline or budget cap ended this run.

## Frozen, independent ForgeBoard acceptance

The external workspace source was inventoried immediately after natural terminal state (excluding generated `node_modules/` and `.git/`). Its **only files** were `package.json` (501 bytes, SHA-256 `EACEC70849F59D7485F1177455E42ACA8F4AAC4AD13834769D775F6310C6B9B9`), `package-lock.json` (73,930 bytes, SHA-256 `9548AAC47ADAD80A78DE4300BBEE7F7A79A7EAA6A3398881D28BD9DF892E8022`) and `tsconfig.json` (1,175 bytes, SHA-256 `68A42A50A9F152663569F8DA01129D32A1744DE6ACF768BFEC0D25FF7D8B9C68`). The `src/` directory was **empty**. No generated source was edited or repaired. The project's initial Git state had only these untracked files and `node_modules/`.

| Acceptance category | Status | Independent evidence / why not runnable |
| --- | --- | --- |
| Exact mission, selected model, real provider and 14 native tools | **PASS** | Real recorded requests, provider/host report; not application success |
| npm scaffold and TypeScript config | **PASS (scaffold only)** | Actual package/lock/tsconfig present, installed Express/TypeScript dependencies; no app sources |
| Backend executable/startup on initial port **4317** | **BLOCKED** | No source entrypoint or server script; no owned server could be launched |
| Project create/list/update/delete/open | **BLOCKED** | No backend/API; not 5 fabricated failing HTTP calls |
| Task create/list/update/delete/view | **BLOCKED** | No backend/API |
| Statuses, priorities, tags, timestamps and title max **120** | **FAIL** | No implementing schema/validation/source exists |
| Combined project/status/priority/tag filters | **BLOCKED** | No handler/data route for executable query |
| Free-text title/description search | **BLOCKED** | No API or search handler |
| Task pagination, initial page size **50** | **BLOCKED** | No query handler, page implementation or server; no page-25 correction was sent |
| HTTP validation, deterministic errors/status codes, missing resources | **BLOCKED** | No HTTP endpoint; cannot test error payloads without fabricating a server |
| Persist across actual backend process restart | **BLOCKED** | No backend/database/restartable service |
| True SSE events, mutation delivery (not polling) | **BLOCKED** | No backend event stream or UI subscriber |
| React/TypeScript frontend and substantive project/task UI | **FAIL** | No React frontend files or React dependencies; `src/` empty |
| Loading, error, empty states and keyboard accessibility | **BLOCKED** | No UI exists to exercise; absence of implementation independently confirmed |
| Editable/search debounce **750 ms** | **FAIL** | No application component or debounce logic |
| API, validation, persistence, search and frontend automated tests | **FAIL** | No test files; `npm.cmd test` executes default placeholder and exits **1** (`Error: no test specified`) |
| Production build | **FAIL** | `npm.cmd run build` exits **1**, missing `build` script; `npx.cmd tsc --noEmit --incremental false` exits **2**, `TS18003 No inputs were found` |
| README/setup/dev/test/build/persistence instructions | **FAIL** | `README.md` absent |
| Runtime database/user-data ignore, Git exclusions | **FAIL** | `.gitignore` absent; `node_modules/` untracked |
| Cloud dependencies/telemetry | **PASS (limited negative evidence)** | No app code, telemetry or cloud inference; no feature claim possible |
| Corrected 25-page value | **SKIPPED (not applicable)** | Three-write correction gate never met; no correction dispatched |
| Normal packaged Clack approval + persisted native check/restart/current/stale | **BLOCKED** | No current installed packaged app/normal GUI interactive approval controller; hidden acceptance host is not this test |

No meaningful HTTP or frontend behavior could be independently executed; **API checks are BLOCKED**, not nineteen supposed failing endpoints. The independent evaluator ran source inventory/hash, `npm.cmd run`, actual `npm.cmd test`, `npm.cmd run build`, and `npx.cmd tsc --noEmit --incremental false`, without modifying application source or launching another local-model inference. The absence of an app and the incomplete plan prevent `R5 PRODUCTIVE BUT INCOMPLETE` or `R5 READY`; the limited classification describes **observed output**, not intrinsic model capability under an uninterrupted run.

## Boundaries, cause assignment and highest-value next action

| Layer | R5-specific finding |
| --- | --- |
| Local model/task quality | Real native calls and shell bootstrap, no meaningful working application; interrupted too early to isolate full-task model ability; never extrapolate to all local models |
| Engine/tool rendering | Seven mission native `tool_calls` recognized; no current textual pseudo-tool transition; R1 attribution unresolved |
| Clack schema/dispatch | All 14 schemas exposed, seven legitimate calls dispatched; one model shell command incompatible with PowerShell corrected by later model call |
| Context/compaction/checkpoint | 65K target, large headroom, no pressure, no checkpoint eligibility/activation or measurable live savings; nonretryable context-route preflight error at the next request, exact disagreement not captured |
| Agent continuation/task truth | Seven Todo obligations outstanding, no completion receipts, 0 continuation, no budget/deadline ending; accurate `failed` session state |
| SSH/Ollama/provider | Existing 11435 tunnel and Ollama 0.40.5 functional throughout 17 requests, same loaded model digest/context after mission; no demonstrated connectivity outage |
| Desktop | **R3d BLOCKED**: only October 9 `Clack_0.8.0_x64-setup.exe`, no current installed packaged build or supported ordinary chat/interactive approval/restart GUI controller. R3c isolated two-process Tauri/WebView2 test stays historical, not full Clack qualification |
| Harness/environment | Existing controlled hidden native Tauri host; `result.ok` only means the runner obtained a report. The wrapper's 90-minute safety ceiling was not hit. Normal packaged user permissions/UI were not exercised |

**One highest-value next action (requires separate authorization):** a *bounded, non-inference* investigation of the exact Clack `ollama-context-route` preflight disagreement at the next-request boundary, including rejected serialized model/context and current runtime target with provenance, using an isolated deterministic regression fixture **before** considering a separately authorized additional real-model mission. This is **not** permission to patch/reconfigure production code, restart R5, alter context settings or try other models now. After local-Agent functionality is independently delivered, the separately required current packaged desktop approval/restart qualification remains open; neither gate may be silently waived.

This checkpoint is documentation/evidence-only; no production source, SSH, server, model, permission, Automatic budget or original dirty file was changed. The previously intermittent Rust 10 ms timeout/revocation race remains unresolved, not tested or repaired in R5. The **entire mandatory P2–P19 roadmap remains required and deferred**; no phase is started or narrowed.
