# Clack Multi-Model and Multi-Agent Build Plan

Status: Approved architecture plan, implementation not started
Baseline commit: `e427a4b086781ff21461eef808985d234304e50a`
Last updated: 2026-08-28

This is the authoritative plan for three product goals:

1. Allow several saved models under one configured provider credential.
2. Bind every conversation to one agent, one model, and one workspace identity.
3. Let conversation-owned agents delegate, review, and communicate safely,
   visibly, and concurrently.

Complete the phases in order. Update the status ledger, decision log, tests, and
verification record as work lands. Do not revive the rolled-back provider
connection or live model discovery architecture unless the user explicitly
changes the scope.

## Status Ledger

| Phase | Deliverable | Status | Commit |
| --- | --- | --- | --- |
| 0 | Preserve the known-good AI runtime baseline | Complete | `e427a4b` |
| 1 | Stable saved-model identity and migration core | Pending | |
| 2 | Multiple models per provider in settings and picker | Pending | |
| 3 | Conversation-owned agent, model, and workspace identity | Pending | |
| 4 | Per-session runtime isolation and background execution | Pending | |
| 5 | Durable inter-agent delegation and review protocol | Pending | |
| 6 | Concurrent mutation isolation and conflict handling | Pending | |
| 7 | Integrated UX, migration audit, and release verification | Pending | |

Allowed status values are `Pending`, `In progress`, `Blocked`, and `Complete`.
A phase is complete only after its exit criteria and verification gate pass.

## Fixed Product Decisions

### Provider and model scope

- Provider credentials remain keyed by the existing `ProviderId`.
- OpenRouter initially keeps one API key and supports many saved model IDs under
  that key.
- Do not add provider connection IDs, multiple OpenRouter accounts, account
  health, or live model discovery.
- Keep the current provider fields recognizable. The OpenRouter model field
  becomes a repeatable list with add and remove actions.
- A saved model is not a credential and never contains a raw API key.
- Existing static models and custom OpenAI-compatible endpoints remain valid.

### Conversation scope

- Each conversation owns one idle agent and one idle model selection.
- Each conversation is bound to a canonical workspace identity before it may
  perform workspace operations.
- The history list may remain global. Workspace binding is runtime ownership and
  does not restore the rolled-back workspace-filtered history UI.
- A run captures an immutable identity snapshot. Later settings, agent, model,
  or workspace changes cannot mutate that run.
- Changing Chat B never changes Chat A's configuration or active run.

### Collaboration scope

- Inter-agent work uses durable, visible tasks and replies.
- Agents do not write directly into another conversation's transcript.
- Delegation carries selected context and artifact references, not an invisible
  copy of the complete source transcript.
- Every delegation records source, target, status, lineage, timestamps, and a
  visible result.
- Communication consumes real run budget and cannot recurse indefinitely.
- Reviewers may inspect the same workspace read-only.
- Concurrent mutation requires isolation or serialization. Last-writer-wins is
  prohibited.

## Non-Negotiable Guardrails

Preserve all behavior committed at the baseline:

- Chat Only, Ask, Trusted Workspace, Full Access, and Custom permissions
- secret-path, workspace, Tauri, operating-system, and tool safety boundaries
- run budgets, autonomous continuation, failure-loop detection, and hard limits
- structured provider errors, retrying versus terminal semantics, and
  OpenRouter diagnostics
- Stop, cancellation, approvals, minimize and restore, and approval attention
- todo lifecycle, interrupted-run recovery, notifications, and Ctrl+I
- terminal, explorer, editor, Markdown, image, source-control, theme, Windows,
  Linux, Arch, and NVIDIA Wayland behavior
- OS keychain storage for credentials
- npm as the only JavaScript package manager

Do not add fake models, fallback catalogs, hidden agent traffic, unbounded loops,
global environment changes, or automatic conflict resolution.

## Baseline Architecture

- OpenRouter stores one `openrouterModelId` preference and one keychain key.
- The picker represents it through `openrouter-custom`.
- `selectedModelId` is global in the chat store.
- `activeId` is global in the agents store.
- `SessionMeta` does not own agent, model, or workspace identity.
- `SessionRun` already snapshots `agentId` and `modelId` at run start.
- chat instances and messages are keyed by session ID.
- some approvals and todos are session-keyed, while status, approval response
  routing, model selection, and Stop still depend on the active session.
- `run_subagent` is an ephemeral read-only worker, not a persistent peer chat.
- managed Claude Code terminal agents are session-associated but separate from
  the Clack Agent Switcher persona.

## Target Ownership Model

Names may adapt to local conventions, but these boundaries are required.

### Saved provider model

```ts
type SavedProviderModel = {
  id: string;
  providerId: ProviderId;
  transportModelId: string;
  displayName?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};
```

- `id` is generated once and survives display-name changes.
- `transportModelId` is the exact provider-facing identifier.
- duplicate provider and model pairs are rejected.
- OpenRouter records resolve through the existing OpenRouter key.
- records never contain credentials, headers, or secret references.

### Model selection

```ts
type ModelSelectionRef =
  | { kind: "catalog"; modelId: string }
  | { kind: "saved-provider"; savedModelId: string }
  | { kind: "compat-endpoint"; endpointId: string };
```

The concrete store may serialize this as an opaque string. Pure tested helpers
must own parsing and resolution. React and transport code must not parse it ad
hoc.

### Conversation profile

```ts
type ConversationProfile = {
  agentId: string;
  modelSelection: ModelSelectionRef;
  workspaceId: string | null;
};
```

`SessionMeta` owns this profile. Workspace identity includes the environment and
normalized root so equal display names do not collide. Reuse the workspace
permission identity rules where possible.

### Immutable run identity

```ts
type RunIdentitySnapshot = {
  agentId: string;
  modelSelection: ModelSelectionRef;
  providerId: ProviderId;
  transportModelId: string;
  workspaceId: string;
  workspaceRoot: string;
};
```

The snapshot contains no credentials. Transport, tools, permissions,
diagnostics, todos, and status use it throughout the logical run.

### Session runtime

```ts
type SessionRuntime = {
  status: AgentRunStatus;
  error: NormalizedAiError | null;
  providerRetry: ProviderRetryState | null;
  approvals: PendingToolApproval[];
  approvalResponder: ApprovalResponder | null;
  tokens: TokenUsage;
  step: string | null;
};
```

Runtime state is keyed by session ID. Stop and approval responses take an
explicit session ID. The visible UI reads the active entry and summarizes real
background entries.

### Peer task

```ts
type PeerTask = {
  id: string;
  sourceSessionId: string;
  targetSessionId: string;
  kind: "delegate" | "review" | "question";
  prompt: string;
  artifactRefs: PeerArtifactRef[];
  parentTaskId: string | null;
  rootTaskId: string;
  hopCount: number;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  createdAt: number;
  updatedAt: number;
  result?: PeerTaskResult;
};
```

Peer tasks persist separately from ordinary messages and render in both chats as
linked, user-visible events.

## Phase 0: Baseline Preservation

Status: Complete

Baseline commit `e427a4b` contains the permission system, autonomous run budget,
session lifecycle, structured errors, cancellation, AI shell behavior, and
regression coverage that every phase must preserve.

Completed:

- committed and pushed the pre-provider-rework AI runtime state
- verified TypeScript, 472 tests, production build, and diff whitespace
- kept provider connection and discovery code out of the tree
- retained the rollback safety stash without applying it

## Phase 1: Stable Saved-Model Identity

Goal: Build the functional core for several models under one credential without
changing visible behavior yet.

Tasks:

1. Add a versioned saved-provider-model preference schema.
2. Add pure constructors, validators, deduplication, and resolvers.
3. Define a stable selection serialization format.
4. Resolve a saved OpenRouter model through the existing endpoint and key lookup
   while sending the exact transport model ID.
5. Add an idempotent migration from non-empty `openrouterModelId` to one saved
   OpenRouter model.
6. Keep the legacy value until migrated state is persisted successfully.
7. Normalize malformed records and reject empty or duplicate model IDs.
8. Keep static models and custom endpoints unchanged.
9. Define cleanup for favorites, recents, defaults, and active selection when a
   saved model is removed.

Required tests:

- migration preserves the existing OpenRouter model
- migration is idempotent
- two OpenRouter models coexist under one key
- renaming a label preserves stable identity
- malformed records normalize safely
- static and custom endpoint selections still resolve
- resolution never exposes credentials
- removing one saved model leaves the others intact

Exit criteria:

- core and migration tests pass
- no visible provider or transport regression
- no provider connection or discovery types are introduced

## Phase 2: Multiple Models per Provider UX

Goal: Expose saved OpenRouter models through the existing settings and picker.

Tasks:

1. Keep the OpenRouter card and API key field.
2. Replace one model input with compact repeatable Model ID rows.
3. Add real add and remove controls using Clack primitives.
4. Allow an optional local label without inventing provider metadata.
5. Validate duplicate and empty IDs inline.
6. Generate one picker row per enabled saved model.
7. Show OpenRouter icon, label, and exact model ID clearly.
8. Preserve favorites, recents, search, filtering, and keyboard selection.
9. Make current selection clear in open and collapsed states.
10. Route every selection through the Phase 1 resolver and existing transport.
11. Keep one keychain key and one credential control.
12. Preserve structured errors and OpenRouter diagnostics.

Required tests:

- two saved IDs render as distinct choices
- each sends its exact provider-facing ID
- both use the existing credential lookup
- deleting one does not remove the key or another model
- search matches label and exact ID
- favorites and recents use stable selection IDs
- the old single model migrates and remains selected
- invalid configuration cannot send silently
- no discovery request or fallback catalog appears

Manual acceptance:

1. Configure one OpenRouter key.
2. Save at least three model IDs.
3. Select and send with each model.
4. Restart and confirm models and selection persist.
5. Remove one model and confirm the others and key remain.

Exit criteria: Goal 1 is complete and all provider paths still work.

## Phase 3: Conversation-Owned Identity

Goal: Make each conversation own its agent, model, and workspace while keeping
run snapshots immutable.

Tasks:

1. Add the conversation profile to `SessionMeta`.
2. Make New Chat capture visible agent, model, and canonical workspace.
3. Make Agent Switcher update the idle active conversation.
4. Make the model picker update the idle active conversation.
5. Restore both selectors when switching chats.
6. Keep global selections only as defaults for new chats and no-session state.
7. Resolve and capture complete run identity at `beginRun`.
8. Make transport, persona, permissions, todos, diagnostics, and continuation
   read from captured identity while running.
9. Prevent changing a running chat's agent, model, or workspace.
10. Permit another idle chat to change its own profile.
11. Show explicit missing-agent and missing-model states.
12. Treat legacy chats as unbound when workspace metadata is unreliable.
13. Require binding before an unbound chat starts a workspace run.

Migration rules:

- existing chats receive current valid agent and model defaults
- existing chats do not receive a guessed workspace
- migration is versioned and idempotent
- missing agents or models stay unresolved until the user chooses a replacement
- no messages, run history, errors, todos, or titles are deleted

Required tests:

- Chats A and B retain different agents and models
- switching and restart restore both profiles
- one run stays unchanged when another chat changes selections
- equal workspace names with different roots stay distinct
- Local and WSL workspace identities stay distinct
- legacy chats do not silently inherit a workspace
- deleted identities are explicit and recoverable
- permissions use captured agent and workspace identity

Manual acceptance:

1. Create Chat A with Coder and model A.
2. Create Chat B with Reviewer and model B.
3. Switch repeatedly and confirm selectors restore.
4. Run both sequentially and inspect captured identity.
5. Restart and confirm both profiles persist.
6. Switch workspace and confirm ownership does not change silently.

Exit criteria: Goal 2 is complete for sequential runs.

## Phase 4: Per-Session Runtime Isolation

Goal: Remove active-session global assumptions before adding communication.

Tasks:

1. Replace singleton `agentMeta` with state keyed by session ID.
2. Replace singleton approval responder with a session-keyed registry.
3. Key retry state, usage, step, errors, notices, and approval counts by session.
4. Change Stop to `cancelRun(sessionId)` with an active-chat UI wrapper.
5. Keep a lifecycle bridge for every running, retrying, or awaiting-approval
   chat, not only the visible chat.
6. Persist and finalize background chat runs.
7. Route diff approvals and tool responses to their owner.
8. Keep minimized state separate from runtime state.
9. Show a real background-run count and attention state.
10. Interrupt every active run predictably at shutdown.
11. Prevent the chat LRU from evicting a running chat.
12. Audit helpers for implicit active-session reads.

Required tests:

- two sessions run without sharing status
- stopping A does not stop B
- approving A cannot resolve B's request
- errors, todos, usage, and budgets remain isolated
- background completion persists messages and final state
- switching chats interrupts neither run
- running chats are not evicted
- recovery interrupts every stale running session

Manual acceptance:

1. Start a long read-only run in Chat A.
2. Switch to Chat B and start another.
3. Stop A and confirm B continues.
4. Trigger one approval and confirm it appears only in its owner.
5. Minimize and confirm both continue.

Exit criteria: concurrent independent conversations are reliable.

## Phase 5: Inter-Agent Delegation and Review

Goal: Let one chat request bounded work from another and receive a durable,
visible result.

Tasks:

1. Add a persisted peer-task store keyed by task ID.
2. Show target chat title, agent, model, workspace, and busy state.
3. Support delegate, review, and question tasks.
4. Add a permission category for starting another billed run.
5. Follow existing permission profiles for delegation approval.
6. Build explicit context packages from selected message excerpts, files,
   changed paths, diffs, and task text.
7. Exclude hidden reasoning, secrets, credentials, and unrelated history.
8. Queue work when a target is busy and allow cancellation.
9. Render linked task cards in source and target chats.
10. Return structured replies with provenance.
11. Preserve both conversation identities and histories.
12. Add lineage, hop limits, task ceilings, and repeated-request detection.
13. Charge peer work to the initiating logical budget.
14. Normalize peer failures through structured errors.
15. Keep `run_subagent` as the ephemeral read-only path.

Required tests:

- A sends a review task to B
- B receives only selected context
- reply is linked and visible in both chats
- source and target identities remain unchanged
- busy targets queue predictably
- cancellation affects only the target task
- permissions match the initiating agent profile
- cycles and excessive hops are blocked
- errors and usage belong to the correct sessions
- payloads contain no credentials or hidden transcript data

Manual acceptance:

1. Let Coder in A make a change.
2. Send a review to Reviewer in B.
3. Confirm B receives the mission and diff only.
4. Confirm B's result returns to A with provenance.
5. Request one follow-up and inspect lineage.
6. Attempt a loop and confirm Clack stops it.

Exit criteria: Goal 3 is complete for read-only and serialized work.

## Phase 6: Concurrent Mutation and Conflicts

Goal: Allow agents to modify the same project without silent corruption.

Tasks:

1. Classify peer tasks as read-only or mutating.
2. Allow concurrent safe reads under normal run limits.
3. Permit one mutating writer in a shared checkout through a workspace lease.
4. For Git repositories, support isolated worktrees for concurrent writers.
5. Retain canonical project identity plus checkout identity.
6. Exchange commits or patches through visible review actions.
7. Detect dirty-tree, overlapping-file, stale-base, and conflict states.
8. Never auto-resolve semantic conflicts or discard user changes.
9. Serialize mutations in non-Git projects and explain queued state.
10. Release leases and worktrees after completion, cancellation, or recovery.
11. Scope permissions to the correct checkout root.

Required tests:

- two read-only reviewers run concurrently
- shared-checkout mutations serialize
- worktree agents receive distinct roots
- agents cannot write outside authorized roots
- overlapping changes produce a visible conflict
- cancellation releases the write lease
- recovery handles stale leases safely
- non-Git projects never receive fake worktree behavior
- user changes are never reset automatically

Exit criteria: simultaneous mutations cannot overwrite each other silently.

## Phase 7: Integrated UX and Release Verification

UX tasks:

1. Show agent and model identity in each chat header without clutter.
2. Show workspace ownership and an explicit unbound state.
3. Show background status, attention, and Stop per chat.
4. Add real Send for Review and Delegate actions where context exists.
5. Add a compact task lineage view.
6. Cover missing identity, busy, conflict, failure, and empty states.
7. Preserve keyboard navigation, Ctrl+I, minimize, and status ergonomics.
8. Keep provider, model, agent, chat, and workspace labels distinct.

Security and performance audit:

- no secrets in settings, sessions, task payloads, logs, errors, or UI
- no arbitrary endpoint behavior beyond existing validation
- no unbounded model, runtime, task, transcript, or worktree cache
- no duplicated parsing or workspace normalization in components
- no per-chat polling when events are available
- no provider request on render
- no hidden token spending
- no permission, workspace, or run-budget bypass

Final automated verification:

```powershell
npm.cmd run check-types
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run tauri -- build --bundles nsis
git diff --check
```

If Rust changes:

```powershell
cd src-tauri
cargo fmt --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
cd ..
```

Final manual matrix:

- Windows installed NSIS build
- normal Linux development launch
- NVIDIA Wayland development launch
- native Arch launch when CachyOS is available
- one key with several OpenRouter models
- several chats with different agents and models
- restart and identity restoration
- two simultaneous read-only runs
- session-specific Stop and approval
- explicit peer review and reply
- delegation loop prevention
- shared-checkout mutation serialization
- Git worktree mutation and conflict review
- no terminal, explorer, editor, Markdown, image, source-control, background,
  settings, or packaging regression

Exit criteria:

- all three goals pass acceptance scenarios
- migration is tested from baseline data
- documentation matches behavior
- incomplete controls remain hidden
- the ledger records final commit hashes

## Checkpoint Policy

- Start each phase from a green checkpoint.
- Keep each phase in a focused commit or small reviewable series.
- Do not mix unrelated refactors, formatting churn, or packaging work.
- Record completed commit hashes in the ledger.
- Update this plan in the commit that completes a phase.
- Run the phase gate before pushing.
- Do not mark a phase Complete based only on types or appearance.

Suggested commit subjects:

```text
feat(ai): add stable saved provider model identities
feat(ai): support multiple models per provider
feat(ai): bind agent and model identity to conversations
refactor(ai): isolate runtime state by session
feat(ai): add audited inter-agent delegation
feat(ai): isolate concurrent agent mutations
feat(ai): complete multi-agent workflow polish
```

## Decision Log

### 2026-08-28: Preserve singleton provider credentials

OpenRouter receives several saved model IDs under its existing API key. Multiple
accounts and provider connection IDs are excluded.

### 2026-08-28: Bind model and workspace with the agent

An agent-only binding would still allow global model or workspace changes to
alter the next run. The conversation owns all three identities.

### 2026-08-28: Isolate runtime before communication

Peer communication cannot be reliable while status, approval routing, and Stop
depend on the active session. Runtime isolation is required, not cleanup.

### 2026-08-28: Make collaboration explicit

Agents communicate through durable peer tasks and replies. Hidden transcript
mutation and invisible autonomous messaging are prohibited.

### 2026-08-28: Never use last-writer-wins

Read-only review may share a checkout. Concurrent mutations require a write
lease or isolated Git worktrees with visible conflict handling.

## Definition of Complete

The work is complete only when:

1. A user can save and select several OpenRouter models under one API key.
2. Every chat restores its own agent, model, and workspace identity.
3. Active runs remain immutable and isolated across chat switches.
4. Several chats can run with session-specific status, Stop, approvals, errors,
   todos, and budgets.
5. One chat-agent can delegate to or request review from another through a
   visible, bounded, persisted protocol.
6. Concurrent mutations cannot silently overwrite user or agent changes.
7. Existing Clack security, runtime, UX, and packaging remain intact.
8. Automated and manual gates pass and this ledger records final commits.
