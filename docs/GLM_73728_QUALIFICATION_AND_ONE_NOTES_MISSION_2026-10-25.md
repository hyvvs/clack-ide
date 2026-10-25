# GLM 73,728 production qualification and one unchanged notes mission

**Date:** 2026-10-25. **Starting HEAD:** `b9b475ee2b7956d9ef69c45ef15fcd03db0ac142`. **Authorization consumed:** exactly one fresh live GLM qualification, followed by exactly one unchanged original notes-app mission and exactly one frozen independent evaluation. No other model, second notes mission, ForgeBoard, manually repaired app, context override, speculative compaction, Ollama setting change or stream-timeout change.

## Identity, isolation and evidence

Read-only live Ollama `0.40.11`, target `glm-4.7-flash:q4_K_M`, exact full digest `4475827791a269b02c8ec49b1c3bc1abb5846bacf3fae015b75d33986322d8f6`, 15 installed tags, preserved SSH tunnel `127.0.0.1:11435`. New isolated WebView host inherited only `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--disable-gpu --disable-gpu-compositing`, never altered the operator's profile or GPU settings. Saved Automatic settings were SHA256-checked and copied into *new* independent native-host data directories; no original evidence root was changed.

Exclusive qualification root: `src-tauri/target/real-qwen-product/glm47flash-r5bd-qualification-20261025-01/`.
Exclusive mission/workspace root: `src-tauri/target/real-qwen-product/glm47flash-r5bd-notes-20261025-01/`.
The new launch/report wrappers are `scripts/r5bd-glm-notes.mjs`, `scripts/r5bd-safe-report.mjs`, and `src/test/r5bdSmokeCalibrationAgent.tsx`. **Mission text and actual Agent behavior remain the original, unchanged** `src/test/r5baSmokeAgentAcceptance.tsx`. The frozen evaluator is the original code copied to `scripts/r5bd-independent-notes.mjs`, changed only to label this exclusive new run ID. All newly added source is diagnostic-only; no production code changed.

## Fresh qualification: PASS

- `qualification-1.requests.jsonl`: seven native calibrations `num_ctx=4096,8192,16384,32768,49152,65536,73728` with `num_predict=32`, no tools, completed normally. All **seven** exact requested/loaded-context successes **persisted** with fresh provider/runtime model identity, `status=verified`, `highest=73728`.
- `qualification-1.native-report.json`: independent snapshots (`snapshotTrustedTarget`, `directTrustedTarget`, `budgetRuntimeTarget`) all exactly `73728`; calibration freshness, current runtime epoch and exact loaded evidence all true.
- Genuine `inference-8`: `num_ctx=73728`, `num_predict=512`, one real `get_probe_value` native schema, structured native call, **valid arguments**. The persisted native profile's primary tool proof has `status=verified`, `outcome=native-call`, `calls=1`, `validArguments=true`, `context=73728`, and a nonnull proof. The proof was read back independently from native settings; its digest and provider version match live evidence; runtime epoch **`15736:1792958173139904100`**. There is no inherited 65K proof.
- Qualification process exited 0. There were **eight** native requests and **zero** Agent mission requests. Native evidence: `qualification-1.requests.jsonl`, `.receive.jsonl`, `.jsonl`, `.native-report.json`, `.json`, and saved `data/terax-settings.json`.

## One unchanged notes mission: STOPPED (FAIL)

- New isolated WebView native host PID `33996`, runtime epoch `33996:1792958316195219800`, same digest/version. Its **own** fresh normal production ladder verified all seven contexts through `73728`; primary 73K proof independently verified and persisted.
- Actual native wire requests: `inference-1`–`7` calibration; `inference-8` native verification at **73728/512**; `inference-9` independent tool verification at **32768/512**; `inference-10`–`22` thirteen Agent requests at **32768/8192** with 18 real built-in tool schemas; `inference-23` independent tool verification at **49152/512**; `inference-24`–`28` five Agent requests at **49152/8192**, same 18 native tool schemas. **28 native requests total; 18 Agent generations**, with output allowance dictated by unchanged generic policy. The model was not forced to 73K. No 65K or 73K Agent generation was needed or attempted, so this run does **not** prove a real protected-history continuation of 69,238 tokens.
- The persisted mission profile contains **fresh exact-tier proofs** for 73,728 (primary), 32,768 and 49,152 (separate tier proofs), each `status=verified`, `outcome=native-call`, correct current runtime epoch, digest and provider version. No cross-tier proof was reused.
- The isolated saved session `real-mission-a` persisted `run.state=failed`, `error.kind=timeout`, `error.errorCode=stream-idle-timeout`, `error.requestId=inference-28`, `stop.source=provider-timeout`. The native request was generating at 49,152; 28 response-body events were forwarded, the last meaningful one at `1792958501801`, and native observed the 60-second inactivity deadline at `1792958561802` (+60,001 ms). The remaining timeout elapsed with no forwarded progress; there was **no** provider-done / normal EOF for the timed-out request. Earlier native requests completed, and this was not the old hardcoded context-preflight failure. No timeout was changed, and no retry was attempted. A new generic Clack defect was **not demonstrated** by the native idle-timeout behavior; the backend/model's reason for stopping output was not established.
- Persisted structured SDK messages contain **17 genuine Agent tool calls**: `todo_write` 4 (three output-available, one output-error), `list_directory` 1, `bash_run` 2, `read_file` 1, `write_file` 7, `create_directory` 2. The last 13 named filesystem/terminal calls had successful output states. No fake textual tool result was counted. The Agent did not reach truthful completion.

## Frozen independent notes-app evaluation: FAIL

**Run exactly once after Agent stop:** `scripts/r5bd-independent-notes.mjs`, against the new mission workspace, with frozen hashes in `frozen-source-manifest.json` and results in `independent-notes-check.json`. `sourceUntouched=true`; no evaluator repairs.

Model-authored tracked/source files: `package.json`, `package-lock.json`, `tsconfig.json`, `src/dataStore.ts`, `src/index.ts`, `src/server.ts`, `src/types.ts`. There is **no** authored automated test file, **no** README and **no** `.gitignore`. `npm test` **FAIL**: `package.json` references missing `src/test.ts` through `ts-node-dev`; the test file was never authored. `npm run build` and independent TypeScript `tsc --noEmit` **FAIL** with `TS5108`, removed `moduleResolution=node10` option in `tsconfig.json`. No manual edits permitted.

Independent startup **PASS**. `/health` **PASS**; list/create/get/update/delete **PASS**; empty and oversized titles **400 PASS**; malformed title type **400 PASS**; missing ID **404 PASS**; deletion followed by **404 PASS**; notes **survived real server stop and restart PASS**. The failed test/build/docs checks prevent acceptance despite the working API. Full matrix is preserved in `independent-notes-check.json`.

## Classification and protected state

**GLM ACCEPTANCE FAIL — MODEL FAIL** under the user's classification: genuine production qualification completed with verified 73K capability, but the one fair Agent mission ended with a 49K streaming stall, without tests/working TypeScript build/README/.gitignore or truthful completion. The 73K historical-continuation case was **not exercised**, and success there is not claimed. **No newly demonstrated generic Clack production defect**. No ForgeBoard.

Only exclusive new harness/report sources belong to this task. The seven historical protected SHA256s and six original dirty tracked files, both stashes, tracker, original settings, historical evidence roots, model inventory and original SSH tunnel must remain unchanged. The known earlier unrelated cloud model-switch test was not modified or run to make a suite green.
