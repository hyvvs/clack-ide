# Offline Clack context-budget / compaction audit — 2026-10-25

## Scope and decision

Starting HEAD: `409471c106dd3b7706ecdd7668ee24bbecf19092`.
The existing GLM notes mission was not rerun. No Ollama generation, context-allocation probe, another model or ForgeBoard run was authorized or performed during this audit. Frozen acceptance and previous proof evidence were read, not modified.

**Decision:** add the **smallest bounded, untrusted context-calibration candidate (73,728)**. Do not generally remove protected context or relax native tool permissions/proof. A new candidate is *not* verified usable context: Clack must make an actual successful allocation request, observe the exact loaded context, validate fresh runtime allocation/identity and independently prove genuine native tools at the exact selected tier before Agent inference. Allocation mismatch, capacity failure, stale proof and manual pins remain fail-closed. The 8,192-token output allowance and existing safety margin are unchanged.

## Why the original mission stopped

Source: original saved `data/terax-ai-sessions.json`, session `real-mission-a`, `run.error.details`, in `src-tauri/target/real-qwen-product/glm47flash-r5ba-notes-20261025-01/`.

| Persisted request-cost category | Estimated tokens |
| --- | ---: |
| Core system instructions | 3,313 |
| Agent instructions | 1,416 |
| Workspace/project instructions | 0 |
| User custom instructions | 0 |
| Conversation history and tool state | 42,575 |
| Environment metadata | 151 |
| Derived conversation memory | 0 |
| Retrieved conversation/project/task evidence | 0 |
| Attachments/selections | 0 |
| Built-in tool schemas | 7,776 |
| Custom/MCP tool schemas | 0 |
| Other request structure/options | 265 |
| **Input** | **55,496** |
| Output allowance, unchanged | 8,192 |
| Safety margin (10% of input, rounded up) | 5,550 |
| **Required** | **69,238** |
| Largest freshly verified allocated context | 65,536 |
| **Shortfall** | **3,702** |

The saved aggregates are `system=4,729`, `tools/options=7,888`, `conversation=42,879`, 18 exposed tool schemas and 16,180 bytes of schema JSON. The categories are Clack's *deterministic token estimates*, not the model's tokenizer. The error was `compaction-protected-budget` **before request 29**. The prior 28 provider requests completed; 26 native Agent tool calls executed. No streaming idle timeout occurred at the stop.

## Precise protection boundary and source inspection

The retained saved UI transcript has one original user message and one 65-part assistant message (19 step-start, 19 reasoning, 1 text and 26 executed tool-call parts). Its assistant tool types are: 12 `write_file`, 5 `bash_run`, 4 `read_file`, 2 `create_directory`, 1 `list_directory`, 1 `bash_background`, 1 `bash_logs`. There are no `todo_write` parts; the saved todo array is empty. Stored `write_file` inputs total 61,636 serialized characters (not tokens); `bash_run` outputs total 6,019 characters and `read_file` outputs total 4,381 characters. Five writes target `tests/test.js`, two `src/server.ts`, and two `README.md`; these demonstrate likely repeated/superseded source but do not prove safe replaceability by themselves.

`chatRuntime.ts:prepareCompactionContext()` captures original messages at preparation start. `agent.ts:prepareStep()` passes the **new SDK step suffix** `stepMessages.slice(finalMessages.length)` as `extra`. `conversationCompactionUnits()` groups only the captured original UI messages; `planCompaction().assemble()` always retains `extra`. Thus earlier *completed steps of this still-running SDK generation* are included in an indivisible mandatory current-step suffix, outside the ordinary durable extraction groups. The saved in-memory revision manifest for the mission has `revision: 0`; no durable extraction replaced these steps. The code's suffix operation does not demonstrate duplication of the original prefix, and no duplicate serialized request has been proved.

`groupCompactionUnits()` additionally protects original user/system requirements, attachment references, approval boundaries, failed results, unresolved calls, latest acknowledged plan, and pinned original IDs, and closes entire call/result spans. Its first selected recent whole group may exceed the nominal 20% tail target. These safeguards were not modified. In the **specific** mission the large current SDK `extra` suffix, rather than a proven unnecessary requirement group, explains the compaction refusal. The stored category breakdown cannot apportion the 42,575 history tokens precisely among all individual calls, reasoning, logs and inputs: no per-part B1 token ledger was persisted. Byte/character subtotals must not be misrepresented as such a ledger.

Clack already includes `projectCheckpointWrites` and `compactVerifiedWriteBlocks`, limited to evidence-linked verified writes with preserved original retrieval anchors and later revalidation, as well as narrow acknowledged todo and resolved shell-control refusal receipts. `agent.ts` permission-gates checkpoint preparation and source confirmation through `request_conversation_evidence`, with additional `read_file` checks for checkpoints. That tool was absent among the 18 exposed schemas, but absence from *exposure* is not proof of absent *permission* or that a checkpoint would satisfy every proof requirement. The mission lacks recorded valid checkpoint receipts sufficient to justify deleting old payloads. Arbitrarily discarding former write bodies, test output, reasoning, or permissions would not be a defensible generic change. No compaction production logic changed.

## Origin and scope of 65,536

- `src/modules/ai/lib/contextCalibrationSchema.ts`: hardcoded six-element 4,096→65,536 ladder, ceiling 65,536, request cap seven (six upward probes plus a possible restoration), persisted candidate/attempt validation.
- `contextCalibration.ts:calibrationCandidates()`: explicitly clamps the ladder to that policy ceiling, advertised upper bound, explicit caller ceiling and previously known failed tier.
- `requestPreflight.ts`: a second literal calibration-request 65,536 cap.
- This is Clack's bounded policy, **not** a demonstrated RTX GPU limit, Ollama native allocation integer limit, model/profile default or acceptance harness ceiling. Its context selection and per-tier proof machinery accept general numeric contexts; native inference forwards JSON `num_ctx`, and proof's numeric context schema is not limited to 65K.

## Hardware estimates, not fresh tests

Existing controlled RTX 4060 Ti 16 GB / approximately 31 GiB host RAM evidence (from `docs/GLM_QWEN_OLLAMA_CLACK_RUNTIME_AUDIT_2026-10-25.md`) recorded around 16,008 MiB llama.cpp GPU availability. At actual 65,536, GPU fit was ~14,628 MiB, sampled VRAM peak ~14,935 MiB, f16 GPU KV ~3,384 MiB, host fit ~7,243 MiB, 20 overflow partitions, minimum `MemAvailable` ~28.13 GiB, no swap-outs. Generation samples at 16K / 32K / 65K were ~55.27 / 53.51 / 48.60 tok/s; these are **short direct-text tests**, not a full 55K Agent transcript replay.

| Bounded candidate | Estimated f16 KV | Increase from 65,536 | Naive sampled-VRAM projection if all additional KV stays on GPU | Required 69,238 fits? |
| --- | ---: | ---: | ---: | --- |
| 73,728 | 3,807 MiB | +423 MiB | 15,358 MiB | Yes; 4,490 spare |
| 81,920 | 4,230 MiB | +846 MiB | 15,781 MiB | Yes; unnecessary larger step |
| 98,304 | 5,076 MiB | +1,692 MiB | 16,627 MiB | Yes; higher GPU/offload risk |

GPU placement may change, requiring additional CPU KV/layer overflow, more host allocations, reduced throughput or a refusal. These projections are not measured performance or a promise of successful allocation. The smallest candidate provides a limited opportunity to qualify an additional tier, with substantially less memory pressure than the larger alternatives. Actual selection is still governed by independently fresh model/runtime/native evidence. No provider settings or production 60-second idle timeout changed.

## Generic patch

1. Append only 73,728 to central candidates and ceiling; preserve schema version 1 (old verified 65K records still parse), raise per-run request cap 7→8 and array bound to the central request cap for seven probes plus bounded restore.
2. Use the central ceiling in the Ollama calibration preflight guard instead of a disconnected literal 65,536. All existing no-tools calibration, runtime identity, current model and exact native-tool proof conditions remain.
3. Add regressions for the 69,238 budget, unverified/proof-ineligible high tier, legacy record compatibility, failed high allocation and protected in-run suffix.

## Independent acceptance interpretation

The frozen notes app passed TypeScript, build, server start, CRUD, validation, missing-ID, actual restart persistence and `.gitignore` checks. Its model-authored standalone `npm test` fails without an already-started server, and the README incorrectly promises live reload. Those remain real generated-app defects. The terminal refusal is attributable to Clack's 65K admission policy at the time, not a completed GLM response proving an inability to fix them. Therefore the previous unconditional **model-only** `MODEL FAIL` explanation is invalidated, but this offline audit cannot certify overall GLM acceptance or successful repair after a larger allocation. A retry requires fresh separate user authorization.

## Validation / preservation record

Validation was entirely offline:

- Broad focused Vitest selection: **522 passed, 1 failed, 523 total in 18 suites**. The single deterministic failing assertion is in the *untouched* cloud model-switch test `agentCompaction.integration.test.ts`, line 279, `target_context_load` key expected `eed094ae...` but received `4071548a...`. It also failed when run alone. Nothing in this patch modifies target-context key calculation, cloud model selection or that test. Its cause was not repaired in this scoped audit; the full targeted-suite result must not be reported as green.
- New 73,728 calibration / proof and protected-history test suites alone: **82/82 passed**.
- `npm.cmd run check-types`: **passed**.
- `npm.cmd run build`: **passed**, with the project's dynamic-import warnings.
- `cargo test --locked --lib modules::net::inference --target-dir target/codex-test`: **55/55 passed**, exit code zero.

Protected user-dirty files, saved provider settings/profiles, original stashes, evidence roots and SSH tunnel are preservation requirements. Neither the frozen app nor acceptance evidence was repaired or overwritten.
