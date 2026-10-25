# R5as — Flint qualification PASS; one unchanged notes API mission FAIL

**Date:** 2026-10-25. **Baseline HEAD:** `1338381b13739a4c8143040dbee4a4643f05655e`. **Decision:** Flint **QUALIFIED** for the Clack production-context/native-tool gate, but **FAILED practical notes-app acceptance (MODEL)**. Exactly one standalone qualification, exactly one conditional unchanged notes mission, exactly one frozen independent evaluator. No alternate model, ForgeBoard, production Clack modification, mission retry, coaching, cloud inference, app fix or provider/storage change.

## Live identity and preserved host

- Existing tunnel `127.0.0.1:11435` was healthy with the same listener PID **35272**, Ollama **0.40.11** from `/api/version` both before and after.
- `/api/tags` returned exact `flint:40b` full digest **`489a2052da79e2717c099fbb77718ca3caf5d782a9e93ebde3d901560a859707`**; `/api/show` confirmed 39.8B, NVFP4, GGUF `flint` architecture, tools, thinking and **advertised** 262144 context. `/api/ps` initially had no loaded model. All ten previously recorded installed model tags remained available; there are now fifteen tags including Flint and other operator-installed models. Did not modify any model/store.
- Both original Git stashes and six original user-dirty files were present with unchanged expected SHA-256, index empty, `autonomous_tracker/` retained. Original provider settings file SHA-256 remained `2d39dcfdd946acc733ba77ac1c8e68a226aeb46f013e68902a71002bd54592bb`. The original saved profiles and all historical acceptance evidence were not changed.
- New test-only `r5as` runner, TS acceptance/calibration host, and Rust acceptance host are scoped to Flint. Separate isolated host data copies use the normal production Ollama discovery, `saveSelfHostedModel` persistence, calibration, tool-verification, agent/permissions and runtime. The saved Flint profile is bound to the above digest, `backend=ollama`, `overrides={}` and Automatic reasoning. Existing historical task text and evaluator are reused unchanged. No production-code patches.

## Qualification-only — PASS

Evidence: `src-tauri/target/real-qwen-product/flint-r5as-qualification-20261025-01/`; initial empty `.git` workspace `src-tauri/target/flint-r5as-qualification-20261025-01/`.

- Six real Ollama calibration requests, `num_ctx` **4096, 8192, 16384, 32768, 49152, 65536**, with `num_predict=32`, no tools and omitted `think`; all succeeded, observed loaded context exactly matched each target.
- Scoped calibration: status **verified**, `highest=65536`, current `providerVersion=0.40.11`, runtime epoch **`36216:1792888558019385100`**, fresh allocation, lease and epoch match; snapshot/direct/budget trusted targets each **65536**.
- Seventh inference sent genuine production verification schema `get_probe_value` at 65536 context with Automatic `think` omitted. Persisted `toolVerification`: `status=verified`, `outcome=native-call`, `calls=1`, `validArguments=true`, `finish=tool-calls`, `textualIntent=false`. **This is a qualification tool call, NOT an Agent coding call.**

## One real Agent mission — FAIL (MODEL)

Evidence: `src-tauri/target/real-qwen-product/flint-r5as-notes-20261025-01/`; empty source workspace `src-tauri/target/flint-r5as-notes-20261025-01/`. Exact original notes mission string is identical to historical `r5ap` in cloned TS source (no text changes). Built-in Coder; `CLACK_PRODUCT_SINGLE_SPEC=1`; Automatic reasoning, 18 production tools, original 2048-token Agent output limit and normal continuation/safety/approval rules.

- Mission independently completed **six fresh 4096–65536** calibration requests. Saved mission calibration `verified`, numeric trusted target **65536**, provider 0.40.11, runtime epoch **`25232:1792888683277216000`**.
- Mission's seventh request independently **verified one native structured `get_probe_value`** with valid arguments and `finish=tool-calls`; do not count it as an Agent coding call.
- The **eighth** request was the **first actual Coder generation**, with all **18 native schemas** exposed, `num_ctx=65536`, `num_predict=2048`, and Automatic `think` absent. Provider streamed normally and returned `finish=length` with **2048 output tokens**. The persisted assistant message contains a reasoning part and **zero structured tool parts**; generated source remained completely empty. No tool execution, build/test, or server start.
- Final persisted session state **`failed`** and terminal error **`Answer continuation made insufficient progress.`**; `clackAnswer.state=incomplete`, no repairs or continuations. Harness final reporter `ok=true`/process exit 0 means only that evidence was durably recorded, **not** that the Agent or application passed.
- **Agent genuine native coding tool calls = 0**. Qualification/probe genuine native tool calls = **2**, one in qualification and one in mission's separate pre-Agent verification. Eight mission inference requests total, but only **one Agent generation**, no tool results.
- **Classification: MODEL** for practical coding mission failure. Flint consumed its first original-length output in reasoning/planning instead of actually invoking any available native coding tool, triggering Clack's unchanged bounded insufficient-progress rule. Healthy responding provider, verified context/native probe and unchanged Clack contracts do not establish a provider outage or generic CLACK defect. Internal model reasoning cannot be independently diagnosed beyond the preserved response/receipts.

## Frozen independent unchanged evaluator — FAIL

Ran original `scripts/r5ap-independent-notes.mjs` **once after the Agent stopped**, with the Flint workspace and its exclusive evidence path; it wrote `frozen-source-manifest.json` and `independent-notes-check.json`. **`frozenFiles=[]`, `sourceUntouched=true`, `passed=false`**. The evaluator's historical runId label remains `qwen-smoke-r5ap-20261024-01` by design; paths and invocation establish the Flint run.

| Check | Outcome |
| --- | --- |
| App/config/source files authored | **NONE** (`.git` only) |
| Automated test file, README, runtime `.gitignore` | **FAIL** (all absent) |
| Tests executed, production build, TypeScript compilation | **BLOCKED** (no `package.json` or compiler) |
| Server startup | **FAIL** (no start/dev script) |
| Health, CRUD, input validation, missing resource, persistence after restart | **BLOCKED** (no healthy backend) |
| Source freeze integrity | **PASS** (zero files before/after) |

Clack harness checks: `npm.cmd run check-types` **PASS**; `cargo test --example r5as_acceptance --locked --target-dir target/codex-test` **6/6 PASS**; `npm.cmd run build` **PASS**. These checks validate the Clack host, **not the generated notes application**. No independent npm install was applicable without an authored `package.json`.

**Final gate:** FLINT QUALIFICATION **PASS**; NOTES APPLICATION ACCEPTANCE **FAIL**; **ForgeBoard NOT authorized**, no other model run. **R3d OPEN**, P2–P19 **MANDATORY / DEFERRED**. All user dirty work, both stashes, tracker, saved profiles, previous evidence, operator model inventory and tunnel protected. **STOP.**
