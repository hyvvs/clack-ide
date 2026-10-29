# Post-policy hosted notes: pre-mission harness failure, no model dispatch

**Starting HEAD:** `72b6ffdc68b2b4462976f0faada371c6fa8530b6`.
**Outcome:** **POST-POLICY HOSTED CONTROL INVALIDATED BY PRE-MISSION HARNESS INITIALIZATION FAILURE**.
**Notes acceptance:** **NOT EXECUTED / NOT PROVEN** (not a notes PASS and not an evaluated notes FAIL).
**Generic Clack policy/output defect proven:** **NO**.
**Post-policy live outbound output allowance proven:** **NO**.
**Further hosted runs:** **NONE**; a new separately authorized attempt is required.
**ForgeBoard:** **NOT STARTED**.

## Selected, production-configured hosted model

- Existing production provider: **OpenRouter** through Clack's unchanged `@ai-sdk/openai-compatible` adapter.
- Saved selected model: `saved-provider:spm-79c4acdb-3952-4379-a3e2-55d9a38928e3`; exact ID `poolside/laguna-s-2.1:free`; endpoint tier **free**.
- Original settings contain four enabled free OpenRouter selections, **no saved paid/stronger production endpoint**. No custom provider integration or paid-tier entitlement was assumed.
- The public model catalog observed October 29, 2026 advertised **262,144 context**, **32,768 maximum completion tokens**, `reasoning.default_enabled=true`, native `tools`/`tool_choice`, and completion/prompt price reported as zero. No deployed checkpoint or model quality superiority is attested.
- Production `captureEffort`: **unknown** reasoning-effort contract and **automatic** choice. The policy accepts default-on reasoning independently of unsupported/unknown effort controls.

## One-shot isolated harness and unchanged specification

- New exclusive control root: `src-tauri/target/remote-controls/post-policy-laguna-notes-20261029-01/`.
- Scratch Git workspace: `post-policy-hosted-notes-20261029-01/` inside that root. Its only entry after termination was its own `.git`, **no application files**.
- New one-shot runner: `scripts/post-policy-hosted-notes.mjs`, invoked **exactly once**. New frontend: `src/test/postPolicyHostedNotesAgent.tsx`. The original native host example, approval policy, production Clack Agent logic, provider adapter, settings, notes acceptance definition and insufficient-progress safeguard were not modified.
- Mission wording was **byte-identical** to the original `src/test/r5dbMuseNotesAgent.tsx` and previous hosted scripts: 1,081 UTF-8 bytes, SHA-256 `5eb456e93b15add0e2cdbbb2d695a390c80fb0e2995b83d33b1f4c4bd89ad4ff`.
- The harness attempted a nonproduction, content-free interception of the **final** `ai_http_stream` Tauri IPC body (which is downstream of AI SDK serialization and request preflight). It would have recorded exact `max_tokens`, `max_completion_tokens` presence, tool count, native request ID and forbidden reasoning-control field presence, forwarding unchanged after receipt acknowledgment. It was intentionally fail-closed. No passwords, prompts, raw request bodies, API headers or tool inputs were written to its diagnostics.
- The original user application settings were only copied into an isolated new data directory; the original settings were unchanged.

## What was actually observed

The native test host started and exited normally (**exit code 0**) after receiving a frontend terminal report. The *frontend* failed during initialization **before calling `sendMessageToSession`**:

```json
{
  "missionStarted": false,
  "state": "failed",
  "failureStage": "initialization",
  "failureClass": "TypeError"
}
```

The original harness reports only the exception class, not a message or stack. The exact TypeError source is therefore **not proven**. It occurred after the computed-budget event had been persisted and before any Agent message or provider dispatch. A harness/IPC instrumentation incompatibility is plausible but cannot be asserted as fact from the preserved evidence.

**Captured, genuine production-side pre-mission computed budget:**

| Field | Preserved value |
|---|---|
| Model/provider | `poolside/laguna-s-2.1:free` / OpenRouter |
| Fresh provider-reported context | **262,144** |
| Fresh provider maximum output | **32,768** |
| Exact provider reasoning generation | **default-on** |
| Effort control | **unknown**, choice **automatic** |
| Explicit max output / output reserve | **null / null** |
| `resolveAgentOutputBudget` result | **8,192** |
| Final request-preflight output | **Not reached** |
| SDK-visible output | **Not reached** |
| Actual serialized outbound `max_tokens` | **NOT OBSERVED** |
| Actual provider-reported output/reasoning/visible tokens | **None: no inference** |
| SDK/hosted generation count | **0** |
| Native tool calls and results | **0** |
| Answer segments / reasoning-only length segments | **0 / 0** |
| Answer continuations / logical Agent continuations / retries / compaction | **0 / 0 / 0 / 0** |
| Agent terminal state | **Never entered**; frontend harness terminal receipt `failed` |

**No inference was sent.** Specifically, the new `mission-a-1.wire-controls.jsonl` does **not** exist and the harness terminal wrapper reports `capturedOutboundGenerations=0`. This is **not** evidence that Clack serialized 2048, nor evidence that it serialized 8192, nor evidence of post-policy model behavior.

The intended one-shot independent evaluator, `scripts/post-policy-hosted-freeze-evaluate.mjs`, requires `native-report.missionStarted===true` before writing its one-shot marker or evaluating anything. Since `missionStarted=false`, **the evaluator was intentionally not run**: an empty Git workspace and an unstarted Agent cannot support the authorized notes evaluation. No test discovery, npm tests, app server, CRUD or actual restart evaluation took place. No repairs were made. The old Nemotron and Laguna frozen workspaces and evaluator markers were not reopened for mutation.

## Frozen receipt hashes

Immutable evidence under the ignored new control root:

| Artifact | SHA-256 |
|---|---|
| `mission-a-1.computed-budget.json` | `3d672c06c0ba8ae520d1d9ac6615ffb73e33b33d8d221caa07b1f67de9cd3e4f` |
| `mission-a-1.native-report.json` | `7a2dfb51019c94374fb3303f65028e468802f1c8c98bdaec6d0c4b4fd81e0d7d` |
| `mission-a-1.json` | `6265ebc27fcb13182bd34f4747a5c303cfea630ed6cbde3406561b7d16650dfa` |
| `data/terax-ai-sessions.json` | `7ffda30ff737bc14e4678564628d646772c4122a949ac5958b6a5d4d93e63f5e` |
| `data/terax-settings.json` | `2a274f75578e6a363813e68d31160621cc0fc5e103197b8d6f6b9d15a9a0f868` |

## Classification and next step

The user's three outcome categories for a **completed hosted Agent mission** (notes PASS, ordinary model/Agent FAIL, incorrect serialized output defect) cannot truthfully apply: the control **never reached the Agent or provider**. This report therefore uses the narrower, necessary **pre-mission harness initialization failure** classification. The prior two frozen hosted controls retain their existing **HOSTED CONTROL INVALIDATED BY OUTPUT-BUDGET POLICY COMPATIBILITY** classification. No generic Clack defect is proven and the new policy has **not** been validated by live inference.

A future task can identify the TypeError with a bounded, content-free frontend failure stack, verify the IPC interception without inference, and separately authorize **one new** real notes Agent control. This turn did **not** repair and rerun the failed control, test a second model, start ForgeBoard, perform local Ollama inference, or relax continuation/output policy.
