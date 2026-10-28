# Remote Clack Agent control: one OpenRouter notes mission, failed frozen evaluation

**Starting HEAD:** `d89bf8a9e513b457620696ec116d4c33118fee04`. **Scope:** ONE genuine hosted-model notes Agent mission, followed by ONE independent frozen evaluation. **Result:** `REMOTE CONTROL FAIL — CLACK END-TO-END NOT YET PROVEN`. Local bake-off remains separately CLOSED: `LOCAL ACCEPTANCE BLOCKED BY RUNTIME RELIABILITY`. **ForgeBoard was not started** because the notes gate failed.

## Actual remote provider and test isolation

- Clack's existing production `openrouter` adapter, implemented with `@ai-sdk/openai-compatible`, was used unchanged. The selected pre-existing enabled saved model is `nvidia/nemotron-3-ultra-550b-a55b:free`, selection `saved-provider:spm-d41c6c81-b202-454d-9cd1-7bcbd75e6354`. The model's precise underlying checkpoint/version was **not exposed/attested** in this run.
- Read-only OpenRouter `/api/v1/auth/key` returned HTTP **200**, and reported free-tier key. Its public model catalog listed this model with 1,000,000 advertised context and tool support. Credential values were neither reported nor written to the repository/evidence. These are availability/capability prerequisites, **not** evidence of inference success.
- The original notes prompt from `src/test/r5dbMuseNotesAgent.tsx` matches `src/test/remoteControlNotesAgent.tsx` byte-for-byte (1,081 UTF-8 bytes). It requests an empty-workspace Node/TypeScript notes API, CRUD/validation/persistence/restart, tests, build and README; forbids ForgeBoard. The WebView invoked Clack's normal `prepareSessionChat`, `sendMessageToSession`, `AgentRunBridge`, built-in Coder, normal tool permissions, approvals, continuation and completion logic. It did **not** invoke any local Ollama, self-hosted calibration or native self-hosted verification. No production provider/Agent policies were modified.
- The test-specific native host `src-tauri/examples/remote_control_host.rs` is an unchanged copy of the earlier isolated acceptance host **except** for registering Clack's existing production `SecretsState`, `secrets_get`, `secrets_get_all` IPC commands. These are needed to use the already stored OpenRouter key in an isolated app, not a new provider. The historical Muse-only wire gate activates only when `CLACK_ACCEPTANCE_OLLAMA_URL` exists; it was not set.
- Original app settings were **read** and copied only to the new isolated Tauri data root. No original profile/credential was rewritten. Test-specific workspace-approval policy was a copy of the original policy with one exact scratch workspace name added, retaining its original path and effect checks. No approvals were pending/blocked during the measured run.

## Exclusive single mission

**Evidence root:** `src-tauri/target/remote-controls/remote-nemotron-ultra-notes-20261028-01/`, intentionally ignored by the repository. **Scratch workspace:** `remote-notes-control-20261028-01/`, ordinary new Git repository under that evidence root; all application files were authored by the actual Agent. **Agent session:** `remote-notes-control`.

- One and only one invocation: `node scripts/remote-control-notes.mjs`. The one-shot entry refuses a previously existing run root, and no retry/replay was executed. Native host process **30552** exited normally, code **0**; a successful host exit is **not** a successful Agent state.
- Persisted Agent `run.state=failed`; `run.error.kind=unknown`, `disposition=terminal`, `retryable=false`. Exact persisted non-content failure cause: **“Answer continuation made insufficient progress.”** No safety approval failure was reported (`harnessBlocked=false`). No remote HTTP transport error or generic Clack defect is established.
- Exactly **8 genuine Clack native tool calls** in the persisted conversation, uniquely keyed by SDK tool call IDs: `list_directory` ×1, `create_directory` ×1, `write_file` ×6. All **8** have `output-available` results, rather than textual pseudo-tool responses. The retained assistant message has **9 `step-start` parts** and **9 `reasoning` parts**; these prove recorded SDK steps, **not** a guaranteed count of distinct provider HTTP requests. Exact remote provider request/generation count was **not instrumented**. At least one response produced actual native tool calls.
- Run budget reports `totalSteps=0`, `continuationCount=0`, `phase=running` at failure despite 9 persisted `step-start` markers and 8 real tools. Treat zero as **the stored budget counter**, not evidence that no model generation occurred. No automatic continuation, compaction event, or retry was recorded in the bounded event receipts; this does not prove none happened at an unobserved provider layer. No trustworthy per-request provider context/output controls were captured; do not infer Ollama controls or replace them with a guessed hosted wire limit. Production model budgeting and tool trust logic remained in effect.
- Files actually present at termination: `.gitignore`, `package.json`, `tsconfig.json`, `src/index.ts`, `src/storage.ts`, `src/types.ts`. No README, automated tests or demonstrable working backend. No operator app repair or second mission was attempted.

## Exactly ONE independent frozen notes evaluation

Command executed **once**: `node scripts/remote-control-freeze-evaluate.mjs`; one-shot marker `independent-evaluation.started`, frozen `evaluation-snapshot/`, outcome `independent-evaluation.json`. The evaluator copies the unchanged R5di original notes API test matrix and only adjusts the isolated source path, replaces the Ollama dispatch-specific evidence field with an intended remote provider evidence check, and adds the required truthful terminal-Agent check. It neither calls the model nor repairs project files. It returned `NOTES_APP_FAIL`.

| Required check | Measured frozen outcome |
|---|---|
| TypeScript files / project config | 3 TS source files, `package.json` and `tsconfig.json` present |
| TypeScript validation | **FAIL**, process exit 2 |
| Production build | **FAIL**, process exit 2 |
| Authored test files / discovered tests | **FAIL**, zero authored/discovered |
| `npm test` | **FAIL**, exit 1 |
| README / setup | **FAIL**, absent |
| `.gitignore` | **PASS** |
| Startup / `GET /health` | **FAIL**, server not started successfully |
| Create, list, read, update, delete | **FAIL / not achieved** |
| Input validation and deterministic missing IDs | **FAIL / not achieved** |
| Persistence after real backend restart | **FAIL / not reached** |
| Truthful terminal Agent completion | **FAIL**, `run.state=failed` |
| Original evaluator's new remote-path check | **FAIL** because `runner.generationSteps=0`, a known **counter mismatch** despite `productionModelPath=true` and 8 real tool calls; do not interpret as missing provider use |

No repeated evaluation or post-freeze repair occurred. **Five frozen evidence hashes** (SHA-256):

| File in evidence root | SHA-256 |
|---|---|
| `mission-a-1.native-report.json` | `36cfc285b6072c75d9d0bbb078b36d4fccc32bc128a2409d613bc72b3b6c8917` |
| `mission-a-1.json` | `4ce6929eb45d04ead8ab9930f15b1dc85cfb81b15af75398b4c9eb7a475b95be` |
| `mission-a-1.events.jsonl` | `875fdf096c225c66e8e0fb5c043e92814bc07155fa68475c14f915e0b76460a3` |
| `independent-evaluation.json` | `80256bf634fd4222272e12942d22d900cd9f3e3bf5c3727823ee7eff35a8590c` |
| `independent-evaluation.started` | `3a8befc225697a56b17320fa80b127ee2a74ed912e6316911de88bb93f56797b` |

## Classification and limits

**`REMOTE CONTROL FAIL — CLACK END-TO-END NOT YET PROVEN`.** This run demonstrates that Clack can send a hosted provider model through its normal Agent session and execute **eight genuine native tool calls** with successful tool results; it does **not** demonstrate successful project delivery, test/build/repair loops, continuation, or completion. The immediate recorded terminal cause is insufficient answer-continuation progress. Ordinary model/application completion quality and/or Agent progression is implicated; without request-scoped provider traces and an independently proven orchestration defect, it would be unsound to label the cause a generic Clack bug or a hosted provider transport failure. The stored zero-step counter should be separately interpreted as a diagnostics mismatch, not a proof of zero inference.

**Phase 2:** NEVER STARTED. The full ForgeBoard control, its `50 → 25` correction and independent evaluation were intentionally withheld because notes did not pass. No ForgeBoard PASS/FAIL claim is made.

**Preservation:** The test did not run Muse, another installed local model, ForgeBoard, local acceptance, alter Ollama/hardware/SSH/config or push/reset/clean Git. The isolated scratch and evaluation evidence remain in place; all user-dirty files, stashes, tracker, protected hashes, and historical R5di evidence were preservation gates. Final checks and commit identity are recorded in the completion response.
