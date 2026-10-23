# R5l — corrected native IPC, fresh 65,536 calibration, one failed genuine ForgeBoard mission

**Decision: NATIVE IPC GATE PASS; PRODUCTION CALIBRATION PASS; ONE GENUINE FORGEBOARD AGENT MISSION RAN AND FAILED; APPLICATION NOT ACCEPTED.** Continued from exact committed `485c7775b5732dec819be43f5587943c9ef70845`. This checkpoint exercised the original Clack native path and unaltered Automatic Nemotron settings in **one** fresh combined calibration→mission run, with no automatic retry, manual continuation, source repair, cloud fallback, remote modification or P2–P19 activity. The Tauri native host and runner exited 0 because evidence completed; the **actual Agent session finished `failed`** and its output did not implement a functional application.

## Gate 1 — corrected native IPC contract, real WebView, no inference: PASS

Static registration parity against production `src-tauri/src/lib.rs` confirmed both `self_hosted_context_lease` and `self_hosted_context_runtime` in the previously compiled `r5k_acceptance.exe`. Rather than repeating R5j CORS/report qualification or constructing another harness, the checkpoint-owned `scripts/r5l-forgeboard.mjs` minimally reused the established native Tauri host and durable collector with an isolated `ipc-contract` phase. The small frontend `src/test/r5lIpcContractWebview.ts` imported **no AI SDK/inference/tools** and used normal `invoke` contracts to acquire a native lease for `real-qwen`, read the native runtime, compare lease/runtime epochs, provider version **0.40.5**, endpoint revision **1**, then release its own lease. Four true boolean checks were durably appended and acknowledged. Native host exit 0, **0 model requests**. The original `r5k` compiled host was used unchanged; no production handler, profile or safety rule was modified.

Exclusive ignored IPC root: `src-tauri/target/real-qwen-product/forgeboard-nemotron-r5l-ipc-20261023-01/`; its `ipc-contract-1.jsonl` contains only four allowlisted true booleans. The existing SSH PID **34900** still owned the sole listener on `127.0.0.1:11435`. Read-only `/api/version`, `/api/tags`, `/api/ps` confirmed original Ollama 0.40.5, installed Nemotron model digest `e7a64ff15fb174c42b4f463e5c888c4f2c7b9cabf9e8d65a1c0874405426c1b2`, and original saved settings file SHA-256 `b6b48848b5144e7ec1205f3633974aad15c627fd54b5a645ee637ca369e4cca2`. No SSH restart/download/configuration change.

## Gate 2 — fresh real production Automatic calibration: PASS

One fresh Tauri host/workspace, copied original saved Automatic profile with `overrides:{}`, invoked unchanged `calibrateModelContext`. **Six native Ollama calibration inference requests** with contexts **4096, 8192, 16384, 32768, 49152 and 65536**, serialized `num_predict:32`, each model-matched and with corresponding successful **loaded allocation equal to requested context**. The user-scoped `mission-a-1.native-report.json` from the existing strict disk-before-ack collector confirms `status:verified`, fresh nonexpired calibration, **runtime epoch match**, loaded-context match, and all three independently computed numeric targets (`snapshotTrustedTarget`, `directTrustedTarget`, `budgetRuntimeTarget`) equal **65536**. There was **no context fabrication/expiry extension/manual pin**.

All **24 actual Agent requests** used the intended Nemotron model, serialized `num_ctx:65536`, `num_predict:2048`, streaming and **14 native tool schemas**. One separate normal Automatic tool-verification request used `num_ctx:65536`, `num_predict:512`, one schema. Thus **31 total provider/native inference requests = 6 calibration + 1 automatic tool verification + 24 Agent**, not the legacy success-report field `missionRequests:0` (an unchanged acceptance wrapper placeholder, **not an actual mission-request count**). No cloud inference.

## Gate 3 — ONE original ForgeBoard mission: EXECUTED, FAILED

One original ForgeBoard Agent session `real-mission-a`, standard permissions/tools/budgets, original task and correction observer, generated workspace:

`src-tauri/target/r5l-forgeboard-workspace-20261023-01/`

The native tool-part ledger preserves **24 distinct real tool-call IDs with `output-available`**: `list_directory` **4**, `todo_write` **3**, `bash_run` **11**, `write_file` **2**, `read_file` **2**, `edit` **2**. The independent correction observer recorded **three verified write/edit operations touching only two backend configuration files**. Eligibility for the original page-size correction **50 → 25** was not established, its ledger stayed `pending`, and the correction was **not sent**. The Todo ledger retained **11 obligations: one completed, one in progress, nine pending**. A native `auto-continue-pending` boundary occurred **once** and returned to `running`; no operator continuation or second mission. No checkpoint/compaction events or measured live token savings were observed; earlier R4 estimated savings are not R5l evidence.

The run's saved native Agent state is **`failed`**, budget phase still `running` (not budget exhaustion). The persisted normalized error was `kind:unknown`, `disposition:terminal`, `retryable:false`; its exact known fixed guard message is **`Automatic Agent configuration is not verified. Use Chat Only or verify tools in model settings.`** This is thrown by the production fail-closed `applyAgentRecommendation` in `src/modules/ai/lib/agentConfiguration.ts`. Intriguingly, the isolated saved profile **also contains** a `verified` native tool record with `native-call` outcome, 65536 context and an unexpired proof, plus one separately verified confirmed configuration. The exact predicate that made the Automatic recommendation unavailable on the last continuation was **not captured**. A mismatch between the decision-time expected context, runtime-scope freshness, reasoning identity or selection state remains a **candidate, not a proven cause**. Do not infer a model incapability, provider outage or permission defect, and do not bypass this safety gate. The final native host/runner exit 0 is only receipt/exit completion, **not Agent or software success**.

## Frozen independent application evaluation

Source was hashed **before** any independent build/test commands, in ignored `frozen-source-manifest.json` (SHA-256 `703aa923086de962435f178b5acad17986bb835d77d3654d0fdd9cb03cc5d268`), excluding dependencies and `.git`. The freeze contains **exactly five project files**: root `package.json`, root `tsconfig.json`, backend `package.json`, backend `package-lock.json`, backend `tsconfig.json`; **0 backend source files, 0 frontend source files, 0 application tests**. Commands were executed on an **independent disposable copy**, not on the Agent output. Structured evaluator receipt `independent-evaluator.json` was written exclusively into the R5l evidence root.

| Real application obligation | Independent result |
| --- | --- |
| Backend start | **FAIL** — `npm run start` exited 1, nonexistent `dist/index.js` |
| Backend API / project-task CRUD / missing resource errors | **BLOCKED** — no running backend or handlers |
| Combined filtering, search, input validation, pagination 50/25 | **BLOCKED** — no application logic; correction was ineligible |
| Persistent storage across restart, SSE push | **BLOCKED** — no backend |
| Frontend and actual UI behavior | **FAIL** — zero frontend source |
| Root `npm test` | **FAIL** — default placeholder exit 1 |
| Backend `npm test` | **FAIL** — missing script, exit 1 |
| Root production build | **FAIL** — missing `build` script, exit 1 |
| Backend `npm run build` | **FAIL** — TypeScript `TS18003` no inputs, exit 2 |
| README, substantive end-to-end app behavior | **NOT EXECUTED** — no completed runnable app |

No generated application source was edited or fixed manually, and no fake API/SSE server or invented passing endpoint check was used. Frozen mission truth: **limited real native tool productivity / application incomplete and Agent failed**.

## Technical evidence and next boundary

Exclusive ignored native evidence root `src-tauri/target/real-qwen-product/forgeboard-nemotron-r5l-20261023-01/` holds `mission-a-1.native-report.json`, `mission-a-1.requests.jsonl`, `mission-a-1.receive.jsonl`, `mission-a-1.jsonl`, `correction-state.json`, `frozen-source-manifest.json`, `independent-evaluator.json` and `r5l-final-technical-ledger.json`. The latter SHA-256 is `1f827afb3cfc4cfa9dd8fa1201159c781e7788ad7f2419ed9db58fff21316852`. These outputs retain bounded metadata, not private model prompts/tool payloads; the application workspace and historical acceptance roots are preserved separately. Focused checks: native IPC real-WebView **PASS**; strict report Node tests **4/4 PASS**; production context/calibration/preflight tests **73/73 PASS**; TypeScript `npm.cmd run check-types` **PASS**; Node syntax **PASS**.

**One next highest-value action, separately scoped:** instrument/diagnose **decision-time Automatic Agent verification eligibility on natural continuation** (the specific safe booleans for stored proof validity, expected numeric context, runtime-scope age/epoch, reasoning identity and effective selected configuration), and reproduce the failing boundary deterministically **without a new model mission or weakening any guard**. Only after a proven owning-layer repair should another real mission be separately authorized. Full packaged-desktop **R3d remains OPEN/BLOCKED**, and complete mandatory CoS-inspired **P2–P19** with real-Agent, integration, security, cross-platform and end-to-end testing remains preserved/deferred. No reset/clean, Git push, model download, remote service mutation or cloud fallback.
