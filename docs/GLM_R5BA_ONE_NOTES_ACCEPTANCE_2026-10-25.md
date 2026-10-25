# R5ba — one original GLM-4.7-Flash notes-API mission: MODEL FAIL

**2026-10-25.** Started from HEAD `a744ba75ab06dad29743d6746c130c6b8a3382a7`. This is **exactly one** additional GLM-only, full, byte-identical original notes API mission, followed by **one independent frozen-source application evaluator**. It is not another model test, a ForgeBoard attempt or a retry. No manual Agent coaching, source repairs, permission weakening, production inference fix, Ollama tuning or timeout changes were made. The original six dirty files/settings, two stashes, tracker and earlier evidence remain protected.

## Prerequisite and preserved identity

The previously protected original manual SSH forward PID `32620` had vanished before this task started, with no process or listener at `127.0.0.1:11435`. After checking the **existing** original `%USERPROFILE%/.ssh/clack_hylab_ed25519` and pinned `known_hosts` record, no other `ssh.exe` process and reachability of `192.168.1.44:22`, restored **exactly the documented original** `hylab@192.168.1.44` `-N -T -L 127.0.0.1:11435:127.0.0.1:11434` route with BatchMode, strict host-key checking and original keepalives. Sole restored listener PID **`27688`**. No remote shell, service or model modifications.

Read-only metadata: Ollama `0.40.11`, 15 installed tags, target model `glm-4.7-flash:q4_K_M`, full digest **`4475827791a269b02c8ec49b1c3bc1abb5846bacf3fae015b75d33986322d8f6`**. Preserved original saved Automatic settings SHA-256 **`2d39dcfdd946acc733ba77ac1c8e68a226aeb46f013e68902a71002bd54592bb`**; copied verbatim only into the isolated acceptance host. No persistent provider settings changed.

## Single native mission and context trust

Exclusive empty Git app workspace: `src-tauri/target/glm47flash-r5ba-notes-20261025-01/`. Native logs, copied settings, WebView data, frozen source and evaluator results: `src-tauri/target/real-qwen-product/glm47flash-r5ba-notes-20261025-01/`. The existing R5av GLM acceptance host and WebView were copied under new R5ba names; the **1081-character literal notes requirement is byte-identical** to the previous notes mission. Only the copied acceptance-native monitor's historical fixed `65536` Agent assertion was generalized to accept a **production-selected verified calibration tier** (still checking allowed candidate and bounded output); **production request preflight remains the owner** of context/proof/permission gates. Process-local WebView2 `--disable-gpu --disable-gpu-compositing` retained. Saved Automatic reasoning / omitted `think`, native tools and approval policy unchanged, Agent output still `8192` and original Rust self-hosted stream idle **60 seconds**. No correction mission.

Harness checks before inference: TypeScript PASS, acceptance Rust example **7/7 tests PASS**, native example build PASS; protected SHA-256s all matched.

The normal Clack calibration finished **all 6 verified loaded/requested candidates**: 4096, 8192, 16384, 32768, 49152, 65536, `num_predict=32`, no tool schemas. Real primary native `get_probe_value` request `inference-7` at 65536/512 returned a **persisted verified proof**. After production selected smallest fitting complete-context tier, `inference-8` verified **32768/512**, one actual canonical tool schema and independent persisted `status=verified` proof for 32768. On history growth, `inference-12` freshly verified **49152/512** and persisted its own tier proof. The 65536 primary proof was independently retained, not inherited at 32K or 49K. All proofs bind exact backend/model/digest, provider version, runtime epoch, configuration and reasoning.

| Actual native IDs | Allocation | `num_predict` | Tools | Count |
| --- | ---: | ---: | --- | ---: |
| `inference-1`–`6` | 4K → 65K | 32 | none: calibration | 6 |
| `inference-7` | 65536 | 512 | `get_probe_value` | 1 |
| `inference-8` | **32768** | 512 | `get_probe_value` | 1 |
| `inference-9`–`11` | **32768** | **8192** | original 18 real Agent native schemas | 3 |
| `inference-12` | 49152 | 512 | `get_probe_value` | 1 |
| `inference-13`–`22` | **49152** | **8192** | same 18 schemas | 10 |
| `inference-23`–`28` | **65536** | **8192** | same 18 schemas | 6 |

**28 native inference requests total; 19 real Agent generations** (no other model). The 18 exposed functions on Agent turns were `read_file`, `list_directory`, `write_file`, `create_directory`, `grep`, `glob`, `bash_run`, `bash_background`, `bash_logs`, `bash_list`, `bash_kill`, `run_subagent`, `get_terminal_output`, `open_preview`, `todo_write`, `promote_peer_finding`, `request_peer_task`, `propose_custom_tool`. From persisted structured SDK conversation parts and tool-result states, **26 unique genuine Agent calls**: `write_file` **12**, `read_file` **4**, `list_directory` **1**, `create_directory` **2**, `bash_run` **5**, `bash_background` **1**, `bash_logs` **1**. All 26 had `output-available`; **zero explicit denied/error states**, **zero unexposed tool names**, and no pseudo `<tool_call>` / `<function=` markers in the isolated persisted assistant text. This is not a claim about unobservable imitation text outside that scan. No delegation or cloud inference; no operator assistance.

### Terminal failure and timeout classification

The genuine Agent session persisted **`state=failed`**, nonretryable **`compaction-protected-budget`**. Its protected full input estimate was **55,496 tokens**, plus **8,192** full output reserve, plus **5,550** margin = **69,238**, exceeding the largest calibrated safe tier **65,536**. This fail-closed preflight prevented a 29th native request; no history/tool output, permission or context proof was discarded or weakened. The model's 19-turn recovery/coding path was too expensive to finish within verified context. This is **ordinary Agent/model task-completion failure, not a demonstrated generic Clack defect**.

All **28 native receive/settlement requests ended completed**; **zero stream-idle-timeout, native transport error, cancellation or model-switch events**. There was therefore no timeout to investigate with remote `n_gen` progress; do not attribute this stop to an idle provider. The user-authorized one-shot is fully consumed and was not retried.

## Post-stop independent frozen application matrix

The acceptance host terminated normally (reported `ok=true` only signifies reporting success, **not** Agent or notes success). App authored `package.json`, `package-lock.json`, `tsconfig.json`, `src/server.ts`, `tests/test.js`, `README.md`, `.gitignore`; generated `dist/server.js` and runtime `notes-data.json`. Frozen evaluator `scripts/r5ba-independent-notes.mjs` is the unchanged prior R5ap notes evaluator with only the unique run ID substituted. It ran exactly once after Agent stopped; no app source was edited or fixed.

| Independent requirement | Result | Basis |
| --- | --- | --- |
| TypeScript | **PASS** | Local `tsc --noEmit` |
| Production build | **PASS** | `npm run build` (`tsc`) |
| Authored automated tests | **PRESENT / FAIL execution** | `tests/test.js` exists; **`npm test` exit 1**. It calls `GET /notes` before starting its own test server, requiring an external running service, and failed standalone at setup. Its supposed persistence test rewrites JSON in-process rather than performing a true restart. |
| Startup | **PASS** | Independent `npm start`, healthy `/health` on port 4321 |
| API CRUD | **PASS** | Create/list/get/patch/delete; after-delete 404 |
| Validation / errors | **PASS** | Empty/121-char/non-string title rejected 400; missing ID returned 404 |
| Persistence across actual restart | **PASS** | Independent evaluator stopped and restarted backend; created note survived |
| README | **PRESENT, accuracy FAIL** | Documents commands and API, but claims `npm run dev` automatically reloads even though the script uses Node without `--watch`; claims a fully passing test suite which fails standalone |
| `.gitignore` / runtime data | **PASS** | `git check-ignore` confirms `notes-data.json`, `dist/server.js` and `node_modules` are ignored |
| Source untouched by evaluator | **PASS for authored source** | All other frozen hashes match. The preexisting evaluator's generic exclusion regex incorrectly included generated `notes-data.json` in its source manifest; API evaluation legitimately changed that **ignored runtime file**, causing the saved evaluator's `sourceUntouched=false` flag. The original FAIL flag is retained honestly; `post-evaluation-source-audit.json` separately proves **no app source changed**. |

Native/report evidence: `mission-a-1.requests.jsonl`, `mission-a-1.receive.jsonl`, `mission-a-1.jsonl`, `mission-a-1.json`, `mission-a-1.native-report.json`. Frozen evaluation: `frozen-source-manifest.json`, `independent-notes-check.json`, `post-evaluation-source-audit.json`. The independent original evaluator reported `passed=false`, correctly because authored tests failed (in addition to its known runtime-file false-positive).

## Final classification

**GLM NOTES-APP ACCEPTANCE: FAIL. Classification: MODEL FAIL.** The core HTTP app functioned, but standalone authored tests failed, README claims were inaccurate, and the Agent terminated without truthful task completion at the nontruncatable, verified 65K context budget. **No new generic production Clack defect established; no timeout-policy changes. ForgeBoard was NOT started.** Preserve the single-run evidence, all earlier acceptance artefacts, protected dirty files, settings, stashes, tracker, 15 models and the restored original SSH tunnel.
