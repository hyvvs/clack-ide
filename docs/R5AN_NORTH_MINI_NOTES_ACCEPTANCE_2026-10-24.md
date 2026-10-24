# R5an — One installed North Mini coding-model qualification and notes API acceptance

**Date:** 2026-10-24. **Baseline:** `ebfdff1bee6c19ba6b541fee420c9e9be31dc0a1`. **Decision: MODEL UNSUITABLE / UNRELIABLE** for the next coding stage; **not accepted for ForgeBoard**. One model, one qualification, and one conditional notes mission only. No production Clack changes.

## Identity and fresh qualification

- Installed Ollama model **`north-mini-code-1.0:q4_K_M`**, exact digest **`d8b269ad5c7c7144ce104b83ce93bc3efb85e0f74e01be6be5f5d6f7ca90b60f`**, metadata `completion,tools,thinking`. Original persisted endpoint `real-qwen`, configuration revision 1, model revision matched, profile overrides `{}`, Automatic reasoning. Original R5af saved settings SHA-256 `2d39dcfdd946acc733ba77ac1c8e68a226aeb46f013e68902a71002bd54592bb` copied into **isolated** evaluation app data only; no source profile modifications, no downloads or remote changes.
- **Fresh native qualification PASS:** separate `src-tauri/target/real-qwen-product/north-mini-r5an-qualification-20261024-01/` completed **six own context requests** at 4096/8192/16384/32768/49152/65536, verified loaded/trusted target **65536**, then native verification at 65536/512 with exactly one exposed schema. `think` omitted in all seven requests. Profile proof persisted **`status=verified`, `outcome=native-call`, `calls=1`, `validArguments=true`, `finish=tool-calls`**. Qualification host produced its acknowledged `qualification-1.native-report.json` with `ok=true`, `missionStarted=false`, numeric gate true and process exit 0. No other model's proof was imported.
- **Offline isolated host and harness:** copied the existing R5am acceptance and evaluator under unique R5an names; only selected-model identity, digest, unique run IDs/paths and harness labeling changed. Original notes-API mission is **byte-identical (1100 characters)** to R5am. The qualification host's strict existing report stage names were retained. Isolated Rust host tests **6/6 PASS** and `npm.cmd run check-types` **PASS** before inference.

## Exactly one notes API mission

- Exclusive target: `src-tauri/target/north-mini-r5an-notes-20261024-01/`; redacted native evidence: `src-tauri/target/real-qwen-product/north-mini-r5an-notes-20261024-01/`.
- Run used the full original backend specification, built-in Coder Agent, unmodified normal permissions/F1 exposure and native proof, original output/continuation/cancellation limits, and Automatic reasoning; no prompts after dispatch, override, source fixes, cloud fallback, model download, manual continuation or second run.
- Its own fresh **six context calibration + one native tool verification succeeded**, followed by **22 Agent native requests** with **18 exposed schemas** each, **29 total native requests**, all expected model ID, context 65536 and absent `think` field. Host process exit 0 and runner `resultOk=true` only attest to transport/report preservation, **not** acceptance.
- **Genuine SDK tool execution PASS:** the persisted Agent conversation has **21 `output-available` native tool results**, including `list_directory`, `bash_run`, `read_file`, `write_file` and `create_directory`. Text imitation was **not** executed. The Agent ran npm dependency installation in the isolated target workspace, creating `node_modules` and a lockfile; whether npm used its cache or fetched packages was not independently established. No model download was initiated.
- Persisted Agent terminal state **`failed`**, with error **“Answer continuation made insufficient progress.”** Its run-budget bookkeeping reports `totalSteps=0`/`phase=running` at terminalization despite the real 21 tool receipts; do not read that summary field as zero work or as a successful finish. The bounded continuation guard stopped the run, no automatic retry was launched. Nothing in this evidence demonstrates a generic production Clack defect.
- Frozen non-dependency application consists of exactly seven files: `package.json`, `package-lock.json`, `tsconfig.json`, `src/index.ts`, `src/storage.ts`, `src/types.ts`, `src/validation.ts`. **No README, automated tests or runtime-file .gitignore.**

## Independent acceptance — original evaluator, run once after natural stop

Evaluator: `scripts/r5an-independent-notes.mjs`; evidence `frozen-source-manifest.json` and `independent-notes-check.json` in the same run directory. **`sourceUntouched=true`**, no source edits during evaluation.

| Requirement | Result | Grounded failure |
| --- | --- | --- |
| Native coding tools | **PASS** | 21 genuine tool results; application files created |
| TypeScript compilation | **FAIL** | Missing `@types/express`, Node type definitions and other TS declarations |
| Production build | **FAIL** | No npm `build` script |
| Authored automated tests | **FAIL** | No authored tests |
| Automated test execution | **FAIL** | Placeholder npm `test` script exits 1 |
| Server startup | **FAIL** | No npm `start`/`dev` script |
| GET /health, notes CRUD, validation/error codes | **BLOCKED** | No successfully started backend |
| Persistence across backend restart | **BLOCKED** | No running backend |
| README/setup | **FAIL** | Missing README |
| Runtime data-file ignore | **FAIL** | Missing .gitignore |
| Frozen original source retained | **PASS** | File content hashes unchanged after independent evaluation |

**Classification: MODEL UNSUITABLE / UNRELIABLE for practical app completion**, **not LOCAL MODEL ACCEPTED FOR FORGEBOARD**. Native provider qualification and true tool-use both work, but the product is not buildable/runnable/tested. **No CLACK DEFECT established**; do not compensate by editing production Agent/tool logic around this model. Next move, if separately authorized, is to revisit candidate/model selection and practical coding reliability—not to launch ForgeBoard on this evidence.

## Preservation

The six pre-existing dirty source/doc files, two original stashes, `autonomous_tracker/`, saved profiles, original Qwen/Devstral/Nemotron historical records, inactive Codex worktree and user SSH tunnel are out of scope and preserved. No reset, clean, push, model download or intentional remote configuration changes. App-local npm dependencies were installed by the unchanged coding task as noted above. **R3d packaged desktop qualification remains OPEN**; original ForgeBoard is not accepted; **P2–P19 capability-platform roadmap remains MANDATORY and DEFERRED**. **STOP after this one model evaluation.**
