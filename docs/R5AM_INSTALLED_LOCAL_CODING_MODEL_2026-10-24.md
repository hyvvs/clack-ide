# R5am — One installed alternative local coding model

**Date:** 2026-10-24 · **Base:** `e6d14bdc1e06caca774f8455624a9585ea1130e8` · **Scope:** read-only installed Ollama inventory, one selected alternative's native qualification, at most one unchanged notes API mission. **No Clack production changes.**

## Read-only candidate selection

`GET /api/tags`, `POST /api/show` (metadata only) and preserved saved Clack settings under the existing `127.0.0.1:11435` SSH tunnel show **10 installed model IDs**. All ten have saved profile entries on endpoint `real-qwen`; none was installed or reconfigured. A saved profile alone is **not** fresh Automatic context or native-tool proof.

| Exact installed model ID | SHA-256 digest | Selected role |
| --- | --- | --- |
| `devstral-small-2:24b` | `24277f07f62db8f9cb68e9dfc679ea1818a7fbac47a50eff0a701d3f645b63c8` | **Selected**: explicitly agent/coding-oriented, advertises `completion,vision,tools`, tool-aware Ollama template, saved unmodified profile, normal Automatic route |
| `north-mini-code-1.0:q4_K_M` | `d8b269ad5c7c7144ce104b83ce93bc3efb85e0f74e01be6be5f5d6f7ca90b60f` | Installed coding alternative, `completion,tools,thinking`, profile exists; no Clack-native proof established here |
| `muse-glimmer:30b` | `de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1` | Tools advertised, saved profile; less direct coding specialization, no fresh native proof |
| `nemotron-3.5-lightning:30b-a3b-q4_K_M` | `e7a64ff15fb174c42b4f463e5c888c4f2c7b9cabf9e8d65a1c0874405426c1b2` | Historical genuine native verification **and failures/nonrepeatability**, not first choice |
| `qwen3-coder:30b` | `06c1097efce0431c2045fe7b2e5108366e43bee1b4603a7aded8f21689e90bca` | **Excluded** by user: R5al textual pseudo-tool failure despite previous native tool proof |
| `qwen38-iq4xs:latest` | `daabf3aac7f641eb4d89fd39b53cbb2ce25fc7cd27256369a3797ff0e6b239dc` | Installed general Qwen variant; not selected |
| `qwen38-uncensored:latest` | `0e163794a8b9cdd6e234013b1a27d2e58f06f48d20413a0c2e3e370faaef5505` | Installed Qwen variant; not selected |
| `hf.co/HauhauCS/Qwen3.6-27B-Uncensored-HauhauCS-Aggressive:IQ3_M` | `12ffb1ffc35b5fe7c283f7c5184999faf4376965df2afab26358d4db4e17ce5c` | Installed Qwen variant; not selected |
| `hf.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:Q4_K_M` | `5bc355c7f631b3e94fe6434a750da9deda8b3fd0345c004dd954558df6a43926` | Installed Qwen variant; not selected |
| `hf.co/HauhauCS/Gemma4-26B-A4B-QAT-Uncensored-HauhauCS-Balanced-MTP:Q4_K_M` | `c8d2e9add7d6b5a9b1d32d35ae02d1d1a9292a51622209f46c23fa83a1a95670` | Installed general alternative; not selected |

The existing saved Automatic profile for Devstral had no manual overrides and a matching model revision. Ollama's metadata reported an architectural context window above 65,536, but that alone was not treated as a verified running allocation.

## Single fresh qualification — isolated from the coding mission

Exclusive qualification root: `src-tauri/target/real-qwen-product/devstral-r5am-qualification-20261024-01/`. A copied source settings file was used only inside this test-host-owned fixture, retaining the exact known original SHA-256 `2d39dcfdd946acc733ba77ac1c8e68a226aeb46f013e68902a71002bd54592bb`.

**Native verification PASS (production proof):** the ordinary production calibration produced six successful native requests at 4,096, 8,192, 16,384, 32,768, 49,152 and **65,536** context; loaded context was 65,536 with a fresh runtime epoch. The production Automatic `ensureSelectedTools` path then made one native `get_probe_value` request at `num_ctx=65536`, `num_predict=512`, one schema, `think` absent, and stored a `toolVerification` record `status=verified`, `outcome=native-call`, `calls=1`, `validArguments=true`, `finish=tool-calls`, with own fresh proof. None of Qwen/Nemotron's evidence was reused.

**Isolated reporter FAIL (qualification-only harness):** the new qualification-only harness tried to submit terminal `lastDurableStage=native-tool-verified`, which is absent from the pre-existing `scripts/r5h-safe-report.mjs` reporting enum; its fallback `failureStage=native-tool-qualification` was likewise outside the existing strict failure-stage enum. Consequently the WebView host exited code 0 but no `qualification-1.native-report.json` was acknowledged; the runner recorded `qualification-1.failure.json`, **“Native host exited before report: 0.”** This was after the production native proof was durably committed, and is a narrow **acceptance-only reporter mismatch**, not evidence of provider/tool-verification failure or a general Clack production defect. The qualification was **not rerun**, and the rejected terminal receipt is preserved. The isolated new harness's stage names were corrected to existing strict allowlisted labels *after the completed run*; that adjustment is **not claimed live-tested** and does not alter production validation policy. The conditional coding mission requalified normally in its own runtime epoch.

## Exactly one conditional original notes API Agent acceptance

**Exclusive mission:** `src-tauri/target/real-qwen-product/devstral-r5am-notes-20261024-01/` with empty Git target `src-tauri/target/devstral-r5am-notes-20261024-01/`. The mission text in `src/test/r5amSmokeAgentAcceptance.tsx` was compared against R5al and is byte-identical. Normal, unchanged 90-minute host bound, 2,048 Agent output allowance, local tools/permission policy, Automatic omitted reasoning, 65,536 context and native verification. No unrequested prompt, retry, agent source repair or manual continuation.

**Live qualification PASS again:** six fresh native calibration requests at the original contexts, one native default tool verification, and four Agent-generation native requests with **18 tool schemas**, for **11 total** requests, all at expected model/digest context and omitted `think`. Host transport ended normally with `resultOk=true` and process exit code 0; neither is application acceptance.

**Genuine Agent tools: YES, but task failed.** Persisted Clack conversation contains two completed native `write_file` results and one completed `create_directory` result; created exactly **`package.json` (764 bytes)** and **`tsconfig.json` (256 bytes)**, plus an empty source folder. After **three** recorded Agent steps and without a finished textual answer, the run persisted `state=failed`. Its fourth Agent inference reached native `channel-settled-cancelled`; this observation by itself does **not** prove a generic Clack infrastructure defect or justify modifying production. No source code, README, executable tests, local server, API behavior or persistence was completed. The failed run was preserved with no second mission.

The two files were SHA-256 recorded before independent evaluation:

| Frozen file | SHA-256 |
| --- | --- |
| `package.json` | `113162fc669d5ce160355f14136d0cc78481483f73eb7cbb82f02da072c71040` |
| `tsconfig.json` | `0947f2e7b56e6e7b2d1ff9aa74c8b32aa0ec46f3827b83cfd6bc70e8673bf5c3` |

The independent evaluator `scripts/r5am-independent-notes.mjs` ran **once** against the naturally stopped app, froze the file manifest before any tests, and confirmed **`sourceUntouched=true`** afterward. It did not repair any application sources.

| Independent app requirement | Outcome |
| --- | --- |
| Native Clack Agent workspace tools | **PASS** (three real completed calls, not pseudo-tools) |
| Authored automated tests, README, runtime-file `.gitignore` | **FAIL** (all absent) |
| Automated test command execution | **FAIL** |
| Production build | **FAIL** |
| Independent TypeScript compilation | **BLOCKED** (no installed local compiler) |
| Server startup at port 4321 | **FAIL** (no healthy backend) |
| Health, notes CRUD, validation, missing-resource responses | **BLOCKED** (no backend) |
| Persistence across restart | **BLOCKED** (no backend) |
| Frozen files unchanged after evaluation | **PASS** |

**Decision: MODEL UNSUITABLE / UNRELIABLE for the next practical coding stage.** Devstral is capable of real native tool invocations and independently passed fresh qualification, but this single small-app run did not deliver runnable tested software. Do **not** begin ForgeBoard from these results. No general production Clack defect is established by the incomplete Agent output; the reporter mismatch belongs only to the isolated qualification host.

**Single next action, subject to separate authorization:** assess the **already-installed `north-mini-code-1.0:q4_K_M`** as the next coding-oriented model candidate under the same strict Automatic native-proof and independent single-app criteria. Do not download a model or start a second model run from this checkpoint.

## Boundaries preserved

Six original user-dirty files remain out of scope. Both stashes, `autonomous_tracker/`, saved profiles, historical evidence, inactive Codex worktree and the existing SSH tunnel must remain untouched. No push/reset/clean/download/remote changes. Packaged desktop **R3d OPEN**, original ForgeBoard still not accepted, entire **P2–P19 mandatory and deferred**. **STOP** after this single model's evaluation.
