# Final correlated Muse notes acceptance — 2026-11-03

## Outcome and classification

**Application verdict:** `NOTES_APP_FAIL` (the one independent frozen evaluator, completed 08:55 CET). **Diagnostic classification:** **`CLACK CONTINUATION PREFLIGHT FAILURE — UNINTERRUPTED MODEL ACCEPTANCE NOT PROVEN`**, with independently demonstrated application defects. **Not accepted; stop.** This is an evidence-based exception to declaring either `MUSE ACCEPTED — LOCAL AGENT PROVEN` or `MUSE MODEL FAIL — FINAL`: the latter requires a fair **uninterrupted** attempt, and this Agent did not finish uninterrupted. No second run, recovery replay, evaluator repeat, model switch, hosted inference, or ForgeBoard is authorized or performed.

The native acceptance **host** exited 0 and its wrapper reported `resultOk=true`; this does **not** mean the **Agent** succeeded. The separately persisted Agent session `real-mission-a` ended **`state=failed`** at 08:53:19.215 CET. Its actual terminal error was:

- `errorCode: ollama-continuation-allocation-stale`, `kind: bad_request`, `disposition: terminal`, `retryable: false`.
- The recorded message: “Automatic Agent working context changed during continuation. No inference was sent; reverify context and tools for a new run.”
- The existing production preflight at `src/modules/ai/lib/requestPreflight.ts`, lines 553–558, deliberately rejects a continuation when the required runtime context or fresh verified context tier no longer agrees. The associated future was dropped after `native-ipc-ready` and **before** request build, dispatch or `reqwest.send()`. This confirms a **Clack-side pre-dispatch context-allocation guard**, **not** a stalled Ollama receive, scheduler/admission, runner, or HTTP transport. Evidence does **not** establish that the guard implementation itself is defective, nor which underlying state changed; do not invent a bug or change production policy.

The Agent also produced an independently inadequate application: no README and a failing `npm test`. These are real frozen acceptance failures, but the pre-dispatch terminal stop prevents the stipulated uninterrupted **model-only** attribution.

## Exclusive run and preserved evidence

- One already-executed original notes mission, `mission-a-1`, in ignored `src-tauri/target/real-qwen-product/museparallelnotes-20261103-01/`. Wrapper start `2026-11-03 08:36:20.061 CET`; end `08:53:20.402 CET`. Original mission prompt: `src/test/r5dbMuseNotesAgent.tsx`, lines 97–99. This investigation did **not** invoke that harness, restart the mission, or modify its workspace.
- One already-executed frozen evaluation: exclusive `independent-evaluation.started` marker (08:54:53 CET); `independent-evaluation.json` finished 08:55:02 CET. Neither tests, API evaluator, nor model inference was run again.
- One local unprivileged parallel Ollama `0.40.11` on lab loopback `127.0.0.1:11436`, with a dedicated pinned SSH forward. Model **only** `muse-glimmer:30b`, installed digest `de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1`. Production host/settings/tool contracts were not edited.
- All `37` native attempts match that model, are loopback-only where HTTP dispatched, and `cloudInference=0`. Seven fresh production context calibrations (4,096 / 8,192 / 16,384 / 32,768 / 49,152 / 65,536 / 73,728) have outcome success, fresh verified gate and runtime-epoch match. Three separate genuine native `get_probe_value` verifier requests (`inference-8` at 73,728/512, `inference-9` at 32,768/512, and `inference-26` at 49,152/512) all completed. These are **not** Agent generations.
- `27` Agent attempts: `inference-10..25`, `27..34`, `35..37`. `26` completed HTTP 200 with provider-done and EOF; the final `inference-37` was rejected before HTTP dispatch. The native report's `missionRequests=0` is not a reliable generation count; the per-request records and the `agentBatch` field provide the actual count.
- Native reasoning metadata `thinkKind=absent` and ordinary output allowances were left as recorded. Initial Agent requests used `num_ctx=32768, num_predict=8192`, then `49152/8192`; automatic continuation used `49152/6144`. The native tool schema changed from 18 to 17 at automatic continuation (the `propose_custom_tool` entry was absent in `inference-35..37`). This is recorded context, **not** proof of the specific stale-allocation check that failed.
- All request IDs, phases, `num_ctx`/`num_predict`, native IPC/serialization/`request-built`/dispatch/send/header/first-body/provider-done/EOF/drop fields, transport timings, maximum client gaps, chronological TRACE receipts, runner PIDs, and same-window resources are in [the correlated 37-row request CSV](MUSE_PARALLEL_TRACE_FINAL_NOTES_2026-11-03.requests.csv). No separate durable generation ID was present in the sanitized evidence: column `generationId=not-recorded`; do not fabricate one.

### Native transport and TRACE join

Of the `37` requests, `36` have `request-built`, `dispatch`, `send-await-start`, HTTP 200, `headers`, first-body, `provider-done`, `eof` and normal settlement; **zero** parser failures in `mission-a-1.parser-final.json`. `inference-37` has only `native-ipc-ready` at 08:53:19.200 CET and `future-dropped` 10 ms later; Clack `channel-settled-failed` at 08:53:19.211 CET, and persisted terminal session failure four milliseconds later. It has **no** destination port, HTTP status, request-built, send, headers, chunks or corresponding Ollama incoming event. No target retry, native cancellation/recovery replay or additional inference is recorded.

The copied unprivileged Ollama TRACE has **36 successful `POST /api/chat` HTTP 200 access completions**, **36** `llama-server completion request` records, **36** `context for request finished` scheduler records and **36** post-processing finish records. The 36 TRACE HTTP completions join chronologically to the 36 native EOFs; their second-resolution TRACE timestamps trail corresponding native EOFs by `1,122–2,001 ms`. There are only **nine** explicit `processing incoming request` markers and **nine** runner-start records (all associated with calibration/verifier context loads); the other requests reused warm runners. The marker is not emitted reliably for every warm-runner request: the affirmative 200/runner/scheduler/done evidence is decisive. TRACE does not expose a shared Clack request ID; the join is by exact request order, timestamps, loaded context and completion cardinality, **not** an invented cross-system ID.

Runner PID/task and model-context evidence is included per dispatch in the CSV via the same-window task-owned `llama-server` PID and the actual native `num_ctx`; there were no new Agent-phase runner-start markers. In the long Agent intervals, runner `89270` serviced `inference-10,20,24,25` at 32,768 context, and `97892` serviced `inference-27` at 49,152 context. TRACE's runner load/completion and scheduler finish logs support positive admission and completion for each of those dispatched requests. Explicit ingress markers alone cannot resolve individual warm-runner dispatches.

### Long generations, stream gaps and observed resources

Agent generations strictly **over 30 seconds: five**; strictly **over 60 seconds: two**. Durations are from native `reqwest.send-await-start` through native EOF. These **completed** with HTTP 200/provider-done/EOF; there was no comparable 120-second **no-header** stall.

| Agent request | Send → EOF | Send → headers | Max client stream gap | Same-window runner | Resource sample observations |
| --- | ---: | ---: | ---: | ---: | --- |
| `inference-10` | 33,773 ms | 9,258 ms | 7,686 ms | 89270 | 25 samples; max VRAM 14,981 MiB; minimum MemAvailable 27,944,340 KiB; no swap delta |
| `inference-20` | 85,620 ms | 970 ms | 84,441 ms | 89270 | 61; max VRAM 14,983 MiB; minimum MemAvailable 26,715,696 KiB; swap used +28,752 KiB, `pswpout` +6,678 pages |
| `inference-24` | 30,834 ms | 989 ms | 7,963 ms | 89270 | 23; max VRAM 14,983 MiB; minimum MemAvailable 26,124,056 KiB; swap used +204 KiB |
| `inference-25` | **145,308 ms** | **997 ms** | **143,997 ms** | 89270 | 106; max VRAM 14,983 MiB; minimum MemAvailable 25,987,628 KiB; swap used +8,784 KiB, `pswpout` +149 pages |
| `inference-27` | 41,819 ms | 18,149 ms | 23,336 ms | 97892 | 30; max VRAM 15,189 MiB; minimum MemAvailable 28,344,464 KiB; no swap delta |

Longest generation: `inference-25` at 145.308 seconds. Maximum completed-client stream gap: `inference-25` at 143.997 seconds **after headers and an initial body chunk**, not the October 28 120-second no-header failure. `inference-20` likewise eventually completed after an 84.441-second client gap. `inference-35` had 22.637 seconds to headers and completed; `inference-37` is a 10 ms pre-send failure, not a no-header timeout.

The independent read-only resource collector contains **845 sample-start markers**, **844 complete successful samples**, from approximately 08:35:14 to 08:54:19 CET; the final unfinished sample was excluded from numeric aggregation. Across complete samples, maximum GPU utilization **100%**, peak GPU VRAM used **15,201 MiB**, lowest free GPU VRAM **809 MiB**, minimum host `MemAvailable` **25,987,628 KiB** (~24.78 GiB), swap used from **184 KiB** initially to **569,768 KiB** in the last complete sample (observed maximum **569,988 KiB**), `pswpin` 9→68 and `pswpout` 55→138,259 pages. Thus real paging occurred; **do not claim zero resource pressure**. However no matching Ollama WARN/ERROR, OOM, allocation-failure, runner cancellation or failed HTTP/scheduler completion was recorded. Paging is not evidence that it caused the Clack preflight block or a failed runner.

Native Agent tool summary reports **26 actual native tool calls**, all `output-available`: `list_directory` ×2, `todo_write` ×3, `bash_run` ×7, `write_file` ×8, `create_directory` ×2, `read_file` ×2, `bash_background` ×1 and `bash_logs` ×1. The presence of real native tool execution, test source and runnable API is affirmative; however **Agent terminal state was failed**, not a truthful successful final state.

### Frozen independent application evaluation

The evaluator froze eight authored source files with hashes in `independent-evaluation.json`. It did **not** repair the app. The frozen `evaluation-snapshot` and Agent `workspace` were not edited during recovery. The resulting Boolean checks were:

| Check | Result |
| --- | --- |
| TypeScript no-emit check | PASS (`code=0`) |
| Production `npm run build` | PASS (`code=0`) |
| Authored test source / static discovery | PASS (one `test/api.test.ts`; `testsDiscovered=true`) |
| Executable `npm test` | **FAIL (`code=1`)** |
| README / install and npm usage instructions | **FAIL (`readmePresent=false`)** |
| `.gitignore` for runtime data | PASS |
| Server start and `GET /health` | PASS |
| Create, list, get, patch, delete | PASS |
| Malformed input and title validation | PASS |
| Missing-ID GET/PATCH/DELETE | PASS |
| Stop/restart and persisted note | PASS |
| No external model | PASS |

Recorded `npm test` command: `ts-node test/api.test.ts`. It crashed before tests could execute: `TypeError: Cannot read properties of undefined (reading 'fileExists')` inside `node_modules/ts-node/dist/configuration.js:91`, running Node `v22.20.0`. The frozen manifest specifies `ts-node ^10.9.2` and `typescript ^7.0.2`. **The evaluator found a test file, but no test suite passed/executed successfully**; static test discovery is not a passing test run. Do not infer exact root cause beyond the captured startup exception, and do not run repair tests. `README.md` was absent, not merely missing a particular command. The frozen evaluator recorded `errors=[]` (no evaluator orchestration exception) alongside `verdict=NOTES_APP_FAIL`.

## Cleanup and protected state verification

1. Remote task-owned unprivileged Ollama **PID 84441**, user `hylab`, bound only to `127.0.0.1:11436`, received only `SIGTERM` and was confirmed absent; the temporary lab port `11436` closed. The task-owned Windows diagnostic SSH forward **PID 30768**, local `127.0.0.1:11436`, was identity-checked, terminated, and its listener confirmed absent. No task-owned collector was active at the final process checks; the bounded foreground resource collector had already finished.
2. Remote scratch `/tmp/clack-muse-parallel-notes-20261103-01` was removed **after** the raw TRACE was copied under ignored local `museparallelnotes-telemetry-20261103-01/ollama-trace.raw.log` and SHA-256 verified identical to the remote log. Post-cleanup lab check confirmed that exact remote scratch directory no longer exists. The separate protected October 29 restricted raw scratch was **not touched**.
3. Original **system** Ollama remained active on `127.0.0.1:11434` as PID **1536**, `ollama` user, with `OLLAMA_MODELS=/var/lib/ollama`, **no `OLLAMA_DEBUG`** environment setting, and exact system unit SHA-256 `e65cda8b2426dc30e876899dce98ac4cf6d7ff138c529ef19692f39692142e06` plus override SHA-256 `813fb1433d898cf01162e6b70ec8f10beb1e02575761737283b021bf0220a80a`, both matching the October 29 baseline report. Its API showed **15 installed models**, **zero loaded models**, and unchanged selected Muse model digest. No system service restart/override/store permission changes.
4. The original pinned Windows SSH forward **PID 27948**, local `127.0.0.1:11435` to system `11434`, remained running and listening. Clack starting HEAD `8ad3f3d6b40eb2f860dcefaa5f59ff52fca9c387`, six pre-existing modified tracked files, both stashes, `autonomous_tracker` and operator settings were left untouched. No reset, clean, push, production policy change, or manual application repair.

Protected pre-existing tracked file SHA-256s, checked before report-only staging:

| Protected dirty file | SHA-256 |
| --- | --- |
| `docs/REAL_LOCAL_MODEL_ACCEPTANCE.md` | `05B97FE4AE7B1F6992477CBF4D503D53F32C256DEF1C7DEEBAE201DA18712B7D` |
| `scripts/acceptance-approval.mjs` | `A4DD5E4BA76D6286218F39338C43FC616733C27528497CDFC5CA865E5CEBE837` |
| `scripts/check-real-local-product.mjs` | `D0F5DBFC6431C80608A39FEDA19EBF645D70991014B1A6DAB951CDB3C7693C90` |
| `src-tauri/examples/coworking_acceptance.rs` | `B5928A00BD21261A899B3A9D6D93685B9BF2F8464F64FE3318D77C5E0EB5A059` |
| `src/test/acceptanceComparison.test.ts` | `577C8A163AE3D9092AC97256095F15C45E5CC919D432E44FD51D4394F52BAEF1` |
| `src/test/realLocalProductAcceptance.tsx` | `74388D4786898E96DE2DB5F999D11403CEAE30D0DA5162376955F41429B06687` |

## Evidence integrity and retention

| File (ignored evidence root unless noted) | SHA-256 |
| --- | --- |
| `mission-a-1.requests.jsonl` | `3902DA357B5155A44CE64101252348B199D885208D6A08259F5387C114BB0277` |
| `mission-a-1.receive.jsonl` | `0787EBFCF99897BD76EF333E9FFD38A1CC14820AE4F0DF7B6865166F4AC81F3B` |
| `mission-a-1.jsonl` | `85247A4FE1E57BC4AD219215C1CD75FF5CA89A411C778195013C32DD458B7A88` |
| `mission-a-1.native-report.json` | `85714F3DFD76620B3D405AEBFDB0353BD79358B4C4C9F1940B49750952784156` |
| `mission-a-1.parser-final.json` | `DAD36A7D9E1EAB8FD1337B5B3D47BA54F3979AF970B93240D6087840C97D9A4F` |
| `independent-evaluation.json` | `1EA75B69A82817D032890344182F97DD24F47818E26CFB654837E8F827C55E83` |
| `museparallelnotes-telemetry-20261103-01/resources-foreground.txt` | `89ECB80C0BC7D190C8BCC92C500C9F28E67EA4C1835D62ABC1AA565B5F3C2606` |
| `museparallelnotes-telemetry-20261103-01/ollama-trace.raw.log` | `AA937CDC3AD94BCD3992ABA8A76F1BC2D62A7C5E562E7E3196C1ACC17D27EBAC` |
| `docs/MUSE_PARALLEL_TRACE_FINAL_NOTES_2026-11-03.requests.csv` | `E605B5A8E4939A0468768F80A5695F8C4E6639437E76B0DBCC6A923EB47F94CF` |

The task-only one-shot host `scripts/muse-parallel-trace-final-notes-20261103.mjs` has SHA-256 `EBCDB5B947EAD0C82D11059E16218DD5829D6DAFEA992AF95157082353123859`; the already-used freeze evaluator `scripts/muse-parallel-trace-freeze-evaluate-20261103.mjs` has SHA-256 `97FFE657A00FBD472FDD3A504BACE019A107D9294BBD1E0BA2D264E06F491D31`. They are test-only artifacts, with exclusive/one-shot protections, and not production changes. This commit preserves them for provenance **not** permission to execute them again.

## Decision

**Final observed result: not accepted.** The frozen application did not pass automated tests or README requirements, and the Agent's terminal continuation was blocked by a confirmed Clack preflight invalidation before dispatch. The underlying reason for the stale allocation is not fully localized from the saved receipts; no independent claim of a Clack **implementation bug** or Ollama/network/scheduler/runner/resource failure is warranted. The historical October 28 ~120-second **no-header** incident remains separately unattributed; this November 3 run instead demonstrated two longer **post-header** stream gaps that finished normally.

**Stop testing this local candidate under this authorization.** Do not automatically tune Clack, repair the app, rerun acceptance/evaluation, try another local or hosted model, or launch ForgeBoard. Further investigation of the continuation allocation guard requires a separate explicit authorization and should begin from the preserved receipts, not a replay.
