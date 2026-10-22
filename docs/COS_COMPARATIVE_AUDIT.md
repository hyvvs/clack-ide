# CoS Comparative Audit

This is a historical focused investigation of CoS session/workflow mechanisms. For the **whole public CoS platform** at pinned `f50a8d3` (2026-10-21), including Agent, Goal/Loop, workers, planning, scheduling, code mode, plugin ecosystem, browser/desktop tools, UI, local-model implications and Clack's future checkpoint roadmap, see [`COS_FULL_PLATFORM_AUDIT_2026-10-22.md`](COS_FULL_PLATFORM_AUDIT_2026-10-22.md). Current cross-agent handoff is in [`AGENT_ENGINEERING_STATE.md`](AGENT_ENGINEERING_STATE.md).

## Independent Re-Investigation: 2026-10-15

Revisited upstream source and tests at
[`083d22d28fa3546ccea8c5d3810a9feaea5b6855`](https://github.com/totec448-spec/chat-on-steroids/tree/083d22d28fa3546ccea8c5d3810a9feaea5b6855),
using `git show origin/main:<path>` after refreshing only the existing temporary
audit checkout. Its working checkout remains pinned to the earlier revision.
No upstream dependencies or application were executed, and no code was copied.

Additional findings beyond the original audit:

- [Plan tool](https://github.com/totec448-spec/chat-on-steroids/blob/083d22d28fa3546ccea8c5d3810a9feaea5b6855/src/main/mcp/plan-tool.ts)
  bounds plan steps/details and rejects stale exact-caller updates. The
  [handoff owner](https://github.com/totec448-spec/chat-on-steroids/blob/083d22d28fa3546ccea8c5d3810a9feaea5b6855/src/main/session/continuation.ts)
  explicitly identifies saved plans as reported progress, not verification
  evidence. Clack now protects its latest accepted todo call/result in C1;
  successful file/test results remain separate evidence, not inferred from ticks.
- [Finish ownership](https://github.com/totec448-spec/chat-on-steroids/blob/083d22d28fa3546ccea8c5d3810a9feaea5b6855/src/main/session/finish.ts)
  hashes authored objective/input/context and suppresses duplicate follow-ups.
  It waits for owned workers before drafting and revokes decisions after new
  input/settings changes. Its semantic Goal decision calls a helper model;
  this is not evidence of autonomous local-engine intelligence. Clack adapts
  only the deterministic unfinished-obligation boundary through its existing
  run budget. No Goal service, helper model or cloud evaluator was added.
- [Finish tests](https://github.com/totec448-spec/chat-on-steroids/blob/083d22d28fa3546ccea8c5d3810a9feaea5b6855/test/session-finish.test.ts)
  distinguish releasing a finish hold from fabricating a final answer or queued
  instruction. [Continuation tests](https://github.com/totec448-spec/chat-on-steroids/blob/083d22d28fa3546ccea8c5d3810a9feaea5b6855/test/continuation.test.ts)
  cover partial briefs and destination-recording races. Clack retains strict
  C1/C2 source CAS, D3 no-replay and exact PeerTask ownership; SDK assistant-tail
  append proofs are checked natively instead of adopting browser timing gates.
- [Progress](https://github.com/totec448-spec/chat-on-steroids/blob/083d22d28fa3546ccea8c5d3810a9feaea5b6855/src/main/session/progress.ts)
  derives worker/tool activity from actual owners. [Head/tail buffering](https://github.com/totec448-spec/chat-on-steroids/blob/083d22d28fa3546ccea8c5d3810a9feaea5b6855/src/main/codex/head-tail-buffer.ts)
  records omissions separately from retained output. These remain useful
  principles, not grounds to replace Clack's Dispatcher, bounded file windows,
  shell lifecycle or content-addressed artifacts.

The inspected current `src/main`/`src/shared` tree still provided no direct
Ollama/LM Studio/vLLM adapter evidence. None of these findings establishes real
local-model task quality. See `LOCAL_AGENT_USABILITY_ACCEPTANCE.md` for the
separate Clack runtime evidence and remaining acceptance limitations.

## Scope And Evidence

This pass starts from Clack `6d770ec`. The independently inspected public
repository is [totec448-spec/chat-on-steroids](https://github.com/totec448-spec/chat-on-steroids),
pinned at `495848f4ed1beb4ebb42dde4519b8ad2ae8999f1` (2026-10-11).
The source was cloned into a task-owned temporary directory, without installing
or executing it. Findings below are source/test inspection, not claims of having
run CoS. The MIT license was inspected. No CoS implementation was copied.

All CoS file links below refer to that immutable revision. Clack paths identify
the existing production owner, not a proposed second subsystem.

## Mechanism Comparison

### Durable History And Working Context

CoS's [read model](https://github.com/totec448-spec/chat-on-steroids/blob/495848f4ed1beb4ebb42dde4519b8ad2ae8999f1/src/main/session/read-model.ts)
calculates pressure from `summary.contextTokens`, separately from lifetime
history. Compact and resume changes the attached model context without deleting
the logical session's recording. Its [context meter tests](https://github.com/totec448-spec/chat-on-steroids/blob/495848f4ed1beb4ebb42dde4519b8ad2ae8999f1/test/context-meter.test.ts)
check estimates, configured capacity, unsupported Pro behavior, accessibility
labels, Escape and locale-specific numbers. They do not prove model fidelity.

Clack's C1 durable sources and revisions live in
`src-tauri/src/modules/conversation_memory.rs`; working preparation lives in
`conversationCompaction.ts`, `compactionPlan.ts` and `requestPreflight.ts`.
`chatRuntime.ts` separately accumulates lifetime usage. B1 owns the actual
request boundary. Clack additionally has authoritative target-specific capacity
and source-linked retrieval; CoS uses configured browser-model limits.

**ADAPT IDEA:** test lifetime/current-context separation and source preservation
through repeated cycles. **KEEP CLACK:** target-aware B1 and native memory CAS.
Do not label a lifetime counter as current context or infer a capacity from
CoS's configured limits. Local preparation must use the selected local route.

### Continuation Transactions And Uncertain Sends

CoS's [continuation owner](https://github.com/totec448-spec/chat-on-steroids/blob/495848f4ed1beb4ebb42dde4519b8ad2ae8999f1/src/main/session/continuation.ts)
has open, capture, exclusive claim, durable commit and abort phases. Commit
freezes source ownership before durable rebinding and only then publishes the
new attachment. The [tests](https://github.com/totec448-spec/chat-on-steroids/blob/495848f4ed1beb4ebb42dde4519b8ad2ae8999f1/test/continuation.test.ts)
exercise competing claims, durable failure, late summary writes after cancel,
restored captured model intent and refusal to declare a dispatched-unresolved
source send unsent. Saved-summary reuse creates a new ticket with provenance,
not a second summary request. The
[resume gate](https://github.com/totec448-spec/chat-on-steroids/blob/495848f4ed1beb4ebb42dde4519b8ad2ae8999f1/src/main/session/resume-gate.ts)
prevents a recorder from creating a shadow session before ownership commits.

Clack's C1/C2 revision validation, captured runs, D2 continuation allowance,
D3 recovery and peer ledger already own the equivalent native transitions.
`targetPreparation.ts`, `streamRecovery.ts`, `peerTaskCoordinator.ts` and
`conversation_memory/target_context.rs` must remain those owners.

**ADAPT IDEA:** fault tests must distinguish known-unsent from uncertain
transmission; reserve ownership before any asynchronous send. **KEEP CLACK:**
native CAS and no-replay. **REJECT IDEA:** browser recorder gates, DOM
acknowledgment heuristics and long browser-specific expiry constants. A timeout
is not proof that a local tool or provider request had no effects.

### Handoff Content And Identity

CoS's [shared handoff prompt](https://github.com/totec448-spec/chat-on-steroids/blob/495848f4ed1beb4ebb42dde4519b8ad2ae8999f1/src/shared/handoff.ts)
asks for original user corrections, exact identifiers and verified tool state,
with configurable brief lengths. Its
[native handoff code](https://github.com/totec448-spec/chat-on-steroids/blob/495848f4ed1beb4ebb42dde4519b8ad2ae8999f1/src/main/session/handoff.ts)
mints IDs in code, hashes continuation tokens and binds source session/turn.
Oversized text uses a head/tail excerpt. Minimum character counts are rejection
heuristics, not proof that operational facts survived.

Clack's `peerHandoffRuntime.ts` / `peerHandoff.ts` capture recipient Agent,
model, permissions, task/workspace identity, dependency artifacts and current
schemas. `peerHandoffFailure.ts` gives bounded typed failure reasons. G1
retrieval can recover original evidence without sharing private parent history.

**KEEP CLACK:** recipient-sized mandatory/optional budget, immutable hashes and
material revalidation. **ADAPT IDEA:** preservation tests for corrections,
negation, exact values and failed effects. **REJECT IDEA:** CoS's absolute
10k-30k-token brief defaults and generic middle truncation for mandatory facts;
they cannot fit an 8k recipient. Browser text canonicalization must not weaken
native content identity.

### Worker Lifecycle, Waiting And Slots

CoS's [agent broker](https://github.com/totec448-spec/chat-on-steroids/blob/495848f4ed1beb4ebb42dde4519b8ad2ae8999f1/src/main/agents.ts)
distinguishes terminal workers from detached, sleeping and waking workers.
Invited/waking reservations consume working slots; sleeping retains history
without consuming a slot. `waitingForSubAgents` is opt-in and checks the owning
family, including reservations. A worker's proven call cannot revive a failed
or retired identity. This is separately discussed in its
[tool surface](https://github.com/totec448-spec/chat-on-steroids/blob/495848f4ed1beb4ebb42dde4519b8ad2ae8999f1/docs/tool-surface.md).

Clack's durable PeerTask graph, `peerTaskDependencies.ts`, scheduler, write
leases and native `net/inference/admission.rs` separate task eligibility from
endpoint inference capacity. Independent child sessions have captured models
and permissions. Clack permits independent source-chat activity and explicit
required dependencies instead of treating every family as one blocking turn.

**ADAPT IDEA:** a reservation is real visible work; test pending workers,
clarification and cancellation, not just generating streams. **KEEP CLACK:**
task dependencies and endpoint-wide admission, including distinct models on the
same local server. **REJECT IDEA:** unconditional family-wide parent freezing,
browser chat revival and sharing identity credentials with model text.

### Bounded Output And Durable Evidence

CoS's [session store](https://github.com/totec448-spec/chat-on-steroids/blob/495848f4ed1beb4ebb42dde4519b8ad2ae8999f1/src/main/session/store.ts)
uses bounded event fields and larger overflow assets, per-session serialized
writes and coalesced metadata. This separates the recording from the model's
immediate payload. Its
[exec output tests](https://github.com/totec448-spec/chat-on-steroids/blob/495848f4ed1beb4ebb42dde4519b8ad2ae8999f1/test/exec-output-budget.test.ts)
distinguish requested output, default output and collection ceiling, and check
text/structured parity. CoS's four-bytes-per-token conversion is a policy
approximation, not a multilingual tokenizer guarantee.

Clack has `toolExposure.ts` (F1), native bounded file/search/shell results,
immutable attachment content, task artifacts, G1 retrieval and WASI/MCP output
bounds. These have different collection and model-facing limits; tests must
not confuse a truncated collection with a fully retained original.

**ADAPT IDEA:** explicitly measure all three budgets and retain a truthful
read-more/source path. **KEEP CLACK:** existing content-addressed store,
bounded schemas and permission checks. **REJECT IDEA:** a second recording
database or assuming ASCII byte estimates prove CJK/JSON/diff capacity.

### Recovery And Audit Lessons

The inspected [2026-09-02 audit](https://github.com/totec448-spec/chat-on-steroids/blob/495848f4ed1beb4ebb42dde4519b8ad2ae8999f1/docs/bug-audit-2026-09-02.md)
distinguishes correct refusals from false identity failures, documents bounded
dormant retention and a committed-continuation restart bug, and explicitly
labels static-only platform inspection. It also exposes hazards from browser
background throttling and user navigation in worker windows.
The current [changelog](https://github.com/totec448-spec/chat-on-steroids/blob/495848f4ed1beb4ebb42dde4519b8ad2ae8999f1/CHANGELOG.md)
adds visible queue reasons, saved-summary reuse, uncertain-delivery fixes and
terminal shutdown changes. Changelog claims are not independent test evidence.

Clack's own native cancellation/admission settlement, restart recovery,
task-effect receipts, archive/retry policy and immutable patches are stronger
direct controls than reconstructing a ChatGPT page. Prior composed Clack tests
use real Git and loopback but stub recipient construction and native IPC; they
are supplementary, not evidence for a full composed mission.

**ADAPT IDEA:** adversarial composed acceptance with exact evidence labels,
second-level lifecycle times and visible queue reasons. **KEEP CLACK:** no
replay after ambiguous effects. **REJECT IDEA:** automatic browser reloads,
DOM status inference and interpreting a tool refusal as a product defect.

### Local Models, Privacy And Platform Differences

Targeted inspection of CoS `src/main` and `src/shared` found no Ollama,
LM Studio, vLLM or OpenAI-compatible provider adapter. Its inspected setup/tool
architecture is a desktop MCP broker connected to ChatGPT through an extension
and connectors. This does not establish anything about direct local-model
capacity, local compaction privacy or endpoint-wide inference admission.

Clack's A/E/G provider setup, native HTTP boundary, B1 capacity resolver, E2
calibration, G3 explicit fallback consent and T3 embedded WASI confinement are
the appropriate owners. User credentials must stay native; local extraction,
retrieval and coordination must not become hidden cloud inference.

**KEEP CLACK:** exact routes, unknown-capacity policy, local privacy, guarded
fallback and shared embedded confinement. **REJECT IDEA:** connector tunnels,
browser account state, native process tools as a substitute for WASI, and
CoS-specific context/concurrency defaults. Platform-independent design is not
proof of a Windows, Linux or macOS native run.

## Integration Map

| Concern | Clack authoritative owner |
| --- | --- |
| Conversation/run/Agent/model capture | `store/chatStore.ts`, `store/chatRuntime.ts`, `lib/sessions.ts` |
| Actual request and capacity boundary | `lib/transport.ts`, `lib/agent.ts`, `lib/requestPreflight.ts`, `lib/contextBudget.ts` |
| Current working context and recovery | `lib/conversationCompaction.ts`, `lib/compactionPlan.ts`, `lib/streamRecovery.ts`, native conversation memory |
| Local metadata and admission | `lib/inferenceCalibration.ts`, `lib/inferenceAdmission.ts`, `lib/modelCapabilities.ts`, native `net/inference` and `inference_probe` |
| Project/evidence ownership | `lib/projectMemory.ts`, native `conversation_memory/project`, retrieval |
| Delegation and handoff | `lib/peerTaskCoordinator.ts`, `lib/peerHandoffRuntime.ts`, `store/peerTaskStore.ts`, native peer ledger |
| Dependencies and communication | `lib/peerTaskDependencies.ts`, `lib/peerCommunicationCoordinator.ts`, `lib/peerReview.ts` |
| Results and isolated writes | `lib/peerTaskArtifacts.ts`, `lib/taskResultActions.ts`, `lib/workspaceWriteLease.ts`, native Git agent worktrees |
| Tool surface and safety | `lib/toolExposure.ts`, `tools/tools.ts`, native custom tools/WASI/MCP |
| Live presentation and navigation | `lib/inferenceLifecycle.ts`, `components/DispatcherNavigator.tsx`, `components/PeerTaskFeed.tsx`, `store/dispatcherNavigation.ts` |

## Implementation Constraint

The acceptance pass must extend these owners, not create another scheduler,
context manager, memory store, retry engine or agent protocol. Test-only native
composition infrastructure must execute the production commands and never
become an alternative product runtime. Native GUI interaction and live-provider
quality remain distinct from controlled backend evidence.
