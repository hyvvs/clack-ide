# Single authorized live post-policy Laguna notes control — frozen failure

**Starting HEAD:** `d92ad015ea06005e9db97aef3a9446af645e320a`.

**Final classification:** `POST-POLICY HOSTED MODEL/AGENT-BEHAVIOR FAIL`.

**Original notes acceptance:** **FAIL** (independently frozen and evaluated exactly once).

**Hosted policy proved on an actual live outbound request:** **YES** for the final serialized OpenRouter output control, not for successful notes completion.

**Generic Clack production defect established:** **NO**. **Production files changed:** **NO**.

**Further live controls or ForgeBoard authorized:** **NO**.

## Isolation of the one-shot run

The user explicitly authorized one intentional live OpenRouter control and external inference traffic, distinct from the previously prohibited *supposedly offline* WebView verification. The old offline runner modes remain unconditionally fail-closed. No disposable VM, firewall, proxy, sandbox, or networking modification was attempted. No local Ollama, second model, ForgeBoard, repair, reset, clean, or push was performed.

The old, already occupied one-shot root `post-policy-laguna-notes-20261029-01` was not reused. Only the harness runner's normal **live** output path and the independent evaluator's matching path were retargeted, to:

`src-tauri/target/remote-controls/post-policy-laguna-notes-live-20261029-02/`

Workspace: `post-policy-hosted-notes-20261029-02/`. The run's exclusive-root existence assertion and evaluator's one-shot `independent-evaluation.started` marker prevent replay. The frontend, production adapter, policy, native tools, approval rules, mission text and prior frozen evidence were untouched.

The notes mission was reverified at **1,081 UTF-8 bytes**, SHA-256 `5eb456e93b15add0e2cdbbb2d695a390c80fb0e2995b83d33b1f4c4bd89ad4ff`, identical to the original contract. The native test host exited **0**, and the mission-start flag is **true**.

## Live, exact outbound request boundary

Provider: **OpenRouter**, model: **`poolside/laguna-s-2.1:free`**, existing saved production model identity.

The frontend's passive browser `globalThis.fetch` observer recorded only bounded numerical/control metadata from the actual `init.body`, after the OpenRouter AI SDK serialized the request and Clack's preflight ran. The observer forwards the original fetch arguments and response untouched; requests are acknowledged by the receipt collector *before* network dispatch. No prompt, authorization header, tool argument, raw request body, or key was written to the wire receipts.

| Live first request check | Evidence |
| --- | --- |
| Reported context | **262,144** |
| Provider output maximum | **32,768** |
| Default-on reasoning generation | **true** |
| Reasoning-effort capability / choice | **unknown / automatic** |
| Production-computed Agent allowance | **8,192** |
| Actual *after-preflight*, serialized OpenRouter field | **`max_tokens: 8192`** |
| Native tool schemas in the serialized body | **18** |
| Unsupported `reasoning_effort`, `reasoning`, `include_reasoning`, `max_completion_tokens`, `max_output_tokens` fields | **All absent** |

**All 11 captured actual live outgoing requests** have `max_tokens: 8192`, match the computed allowance, and omit the forbidden control fields. No 2,048-token regression was observed. This is **real after-SDK/after-preflight wire-boundary evidence**, not the earlier mocked result.

**Measurement distinction:** the run records the production-computed allowance and the final request body *after* SDK and preflight. There is **no independent pre-middleware SDK-visible parameter receipt or separate intermediate preflight-number receipt** in this harness. The live observed *final preflight/serialized* allowance was 8,192; separate intermediate values must not be described as independently measured. Production `streamText` passes `preparationBudget.output` to `maxOutputTokens`, and the unchanged middleware may constrain that value before serialization.

## Provider progression and error signature

The one mission produced **11 serialized provider request attempts** and **8 completed provider segments** with reported input/output usage, consistent with retry/recovery activity. The preserved `clackActivity` history contains **3 retry**, **2 recovered**, and **1 error** activity receipts. The exact per-attempt failed-request token usage is not available.

| Completed segment | Finish reason | Provider input tokens | Provider output tokens | Reasoning characters | Visible answer characters |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | `tool-calls` | 6,342 | 4,954 | 17,941 | 100 |
| 2 | `tool-calls` | 11,455 | 119 | 256 | 91 |
| 3 | `tool-calls` | 11,842 | 138 | 342 | 69 |
| 4 | `tool-calls` | 12,151 | 58 | 127 | 0 |
| 5 | `tool-calls` | 12,629 | 636 | 0 | 76 |
| 6 | `tool-calls` | 13,518 | 115 | 126 | 58 |
| 7 | `tool-calls` | 13,823 | 299 | 0 | 0 |
| **8** | **`length`** | **14,207** | **8,192** | **30,751** | **0** |
| **Sum** | | **95,967** | **14,511** | | |

The per-segment token counts come from the *persisted answer-continuation state*, each with `usageReported: true`. It retains provider-reported total output tokens, not separately itemized reasoning-versus-visible **token** counts. Character counts are explicit length measurements of persisted reasoning and text parts and **must not** be presented as token usage.

**Key reproduction:** segment 8 reached `finish=length`, consumed the **full live-verified 8,192-token allowance**, emitted reasoning but **zero visible answer characters**, and produced no new tool-call parts. The answer-continuation state is `incomplete`, with reason **`Answer continuation made insufficient progress.`** The established insufficient-progress safeguard remained unchanged. This is genuine post-policy model/Agent behavior, not evidence of incorrect 2,048-token serialization.

The Clack Agent terminal state was **`failed`**; **3** Agent generation steps, **0** logical Agent continuations and **0** answer-continuation attempts were recorded. No compaction event was recorded. Ten genuine native tool calls were persisted: `bash_run` **4**, `list_directory` **1**, `write_file` **4**, `read_file` **1**. All had tool-result parts. One `bash_run` returned exit code **1**; one `write_file` returned the existing `read_required_before_write` safety guard, after which the Agent read the file and successfully wrote it. This does not establish a generic Clack defect.

## Exactly-once frozen independent evaluation

The evaluator was invoked **once after the native host exited**. It required `missionStarted === true`, then wrote `independent-evaluation.started` with exclusive creation, hashed files, copied a separate source snapshot, and ran checks without modifying or repairing the Agent workspace.

**Verdict: `NOTES_APP_FAIL`.** The frozen snapshot has `.gitignore`, `package.json` and `tsconfig.json` only. Source directories exist but **no TypeScript source files or authored automated test files** were present.

| Acceptance check | Result |
| --- | --- |
| TypeScript project and `tsc` | **FAIL** — zero TypeScript source files; type check not executable under evaluator's conditions |
| Build script / production build | **FAIL**, `npm run build` exited 2 |
| Automated tests authored and discovered | **FAIL**, **0** authored test files and **0** discovered tests |
| `npm test` | **FAIL**, exit 2 |
| README/setup | **FAIL**, absent |
| `.gitignore` | **PASS**, present |
| Startup/health, CRUD, validation, missing IDs, persistence after actual backend restart | **FAIL / not demonstrated** |
| Genuine native Agent tool path | **PASS** |
| Truthful successful Agent terminal state | **FAIL**, terminal `failed` |

No manual repair, second model, replay, evaluator rerun or ForgeBoard followed.

## Frozen evidence and provenance

All files below are under the **new** exclusive ignored control root, never under historical control roots:

| Artifact | SHA-256 |
| --- | --- |
| `mission-a-1.computed-budget.json` | `c90ed8c227aa1c3ac8fa3df876b3c6ab1511b4073962f0fd1f271be24dd59424` |
| `mission-a-1.wire-controls.jsonl` | `8178bc2b877a6895c54bbf7781b99c43b05d68f2611684fb340309f9aa4a6747` |
| `mission-a-1.events.jsonl` | `f44c04afb0012de55710acfba375d8114861fa66bed9ebf33788c3bed4652e41` |
| `mission-a-1.native-report.json` | `29260897aed25218bf5b41fee6d65a4aea602ecb8d1ed36d7a06ed87589a76d9` |
| `mission-a-1.json` | `88064400b0cf466fab9e25781d5e1218578982ac40f41e277bd870f1a39759e5` |
| `data/terax-ai-sessions.json` | `352c0f37406117e9bd356cf716807fe5cbe48ff3768ca64a42d59035aadd1563` |
| `independent-evaluation.started` | `aad38cf8bc944789b72e74e51f09ec111f371a986f698fa588e0d83e054a99c5` |
| `independent-evaluation.json` | `d55b44f1850bb88b0b40643a0c81af53c25e0782249b8442b624cebe5fc9d1d9` |

The original application settings were read and copied only into the isolated one-shot test host; they were not edited. The original six dirty tracked files, both pre-existing stashes, `autonomous_tracker`, protected hashes and older control/evaluator artifacts are outside this task's changes. No credential or raw model body is included in this report.

**Final decision: `POST-POLICY HOSTED MODEL/AGENT-BEHAVIOR FAIL`.** The corrected generic hosted policy's outbound 8,192 allowance is verified live, but Laguna did not satisfy the notes contract. The user's explicit STOP applies; neither a new hosted attempt nor ForgeBoard is authorized.
