# Chat Control Surface

## Responsibilities

Chat owns the current conversation, draft, attachments, agent/model selection,
approvals, evidence inspection and recovery. Settings owns reusable configuration.
Dispatcher owns navigation across conversations and delegated/background work.
Context is a presentation umbrella, not a merged memory store.

## Inventory Before Integration

| Feature | Current surface / discovery | Scope / canonical owner | Chat action |
| --- | --- | --- | --- |
| Conversation and workspace | Pane picker, workspace chip/breadcrumb/explorer | Session and workspace stores | Keep visible; no new workspace manager |
| Agent/instructions | Header selector; instructions only in Settings | Conversation binding; Agents & tools | Inspect directive, edit exact agent |
| Model, destination, connection | Header model picker; Settings connections | Conversation route; Connections & models | Exact identity/destination, switch, manage connection |
| Effort and activity | Header effort; transcript activity | Captured run/provider support | Secondary effort; truthful activity |
| Permissions | Header mode; Settings agent profile | Agent-wide profile and workspace grants | Explain scope; keep confirmations |
| Attachments | Composer chips and transcript | Pane draft; immutable content store | Context reference and original composer targeting |
| Tools, MCP, approvals | Gear opens full manager; inline approval cards | Scoped native registries; Settings | Scoped summary, destinations, canonical manager link |
| Sources and conversation memory | Sources & context disclosure | Private conversation memory | Context inspection with original evidence |
| Project knowledge, freshness | Separate project-memory disclosure | Authorized project memory | Context disclosure; retain stale/disputed states |
| Model preparation/capacity | Context meter and switch notice | B1/C2 | Keep bounded preflight and switch review |
| Tasks/results | Pane task feed; Dispatcher menu | PeerTask records; Dispatcher | Assign, inspect results, View in Dispatcher |
| Fallback | Header icon/dialog | Conversation-owned explicit consent | Human-readable status; existing consent dialog |
| Endpoint health | Switch/connection diagnostics | Settings endpoint probes | Connection details; no new polling |
| Retry/recovery/continuation/watchdog | Inline notices/actions | Captured logical run | Preserve distinct recovery actions |
| Calibration, keys, endpoints, definitions | Settings | Existing canonical managers | Deep links only; no duplicated editing forms |

## Agent Hierarchy

1. Clack core invariants: permissions, scope, approvals, secrets, runtime,
   persistence/no replay, transport consent and tool contracts.
2. Active agent: trusted Clack configuration for role, style, strategy, domain
   and output preferences within those invariants.
3. User request. Default engineering/output guidance fills only unspecified
   behavior and must yield to compatible agent configuration.

External evidence, project files and tool output remain evidence, never trusted
agent configuration. Prompt hierarchy does not guarantee every model's obedience.

## Navigation Map

| Entry in chat | Current state / action | Canonical destination |
| --- | --- | --- |
| Agent selector | Name, description, full directive, captured-run instructions, agent-wide permissions; switch only when unlocked | Edit the exact custom agent or inspect built-in agent in Agents & tools; Manage agents |
| Model selector | Current model and destination; existing same-conversation switch/preparation review | Connections & models for reusable defaults/configuration |
| Controls | Expand effort, permissions, tools, connection, fallback and context capacity; permission/fallback summary stays visible | Existing configuration owners, not a new manager |
| Connection | Exact transport model/provider, local/private-network/cloud address, capability/context status, cached self-hosted health and HTTP warning | Exact provider, saved endpoint or self-hosted server in Connections & models |
| Tools | Human-readable file/terminal/collaboration capabilities with permission, model and read-only states; optional external integrations; raw names under Details | Manage Agent tools opens the canonical Custom Tools Manager in Agents & tools for this conversation |
| Context | Existing sources/conversation memory, project knowledge/freshness, immutable attachment references and pane-owned task artifacts | Existing evidence inspection; no merged store, automatic promotion or extra context injection |
| Agent activity | Truthful run/inference status with expandable existing receipts/provider output | Existing activity presentation; effort remains separate from visibility |
| Ask another agent | Existing bounded task dialog and explicit artifact/context selection | Existing task creation, not Agent selection |
| Task card | Result actions first: Review/Apply isolated edits, Open authorized current files, View immutable artifact or textual result; visible task access and secondary provenance/navigation | Existing file tabs, patch application, Dispatcher and owning conversations |
| Dispatcher link | Needs attention, Active and Completed work; selected task detail; Chats remain distinct dispatch destinations | Existing global PeerTask records and navigation; exact task selection/focus; workspace evidence remains owner-checked |
| Inline approvals/recovery | Existing pane-bound approval, Continue, Retry, partial/offline recovery and watchdog actions | Existing run lifecycle; no new replay or fallback authorization |

Settings remains the only full editor for agent definitions, connection credentials,
servers, reusable tools/MCP configuration, calibration pins and provider diagnostics.
Fallback keeps its existing conversation-scoped consent dialog; it is not permanently
expanded in the header. Technical tool counts describe permission-eligible candidates,
not a promise of runtime/model support or authorization for every path/input.

Contextual Settings links reuse the separate native Settings window and encoded,
bounded agent/session/connection IDs. Both initial URL and existing-window events
select the intended manager. Custom-agent links open its existing editor; connection
and tool targets receive focus. Closing the agent editor returns focus to its card.
No link changes chat pane bindings, drafts or attachments. Agent selection continues
to set the default for new chats, now explicitly disclosed. Permission profiles remain
agent-wide; workspace grants and one-time approvals stay distinct.

## Compatibility And Verification

The old forceful engineering/output persona preceded the agent directive and could
compete with it. Composition is now core, trusted active agent, conditional fallback,
user customization, then project evidence. Core policy is present exactly once.
The context-budget diagnostic splitter recognizes the fallback section; B1's actual
request measurement/enforcement is unchanged. External evidence is still untrusted.

Provider-wire contracts cover POOPER prefix, exactly `poop` for simple conversation,
no unsolicited bullets, Captain, TypeScript preference and silent-agent defaults.
Six counter-agent directives retain core precedence and cannot bypass actual denied
tool execution. Existing permission, workspace/file mutation, approval/effect history,
fallback consent and PeerTask tests cover their respective enforcement boundaries;
prompt wording is not presented as a native security enforcement mechanism.
Captured-persona coverage includes send, edited-agent retry, D2 continuation, D3
recovery, model/agent changes, restart and split-chat isolation. Task creation continues
through the existing coordinator; private history is not automatically copied.

Final focused regression: **225 tests / 17 files passed**. The final permission-control
composition and Dispatcher corrections also passed **14 tests / 2 files** (overlapping,
not additive to the focused count). Full suite: **2,381 tests / 189 files passed**.
TypeScript, production build and `git diff --check` passed. Lint stayed at the existing
**71 warnings / 2 informational notices**, with no errors. Build retains mixed
static/dynamic import warnings and plugin-timing notices. No Rust code changed;
Rust gates were not rerun for this frontend-only pass.

Headless browser evidence, with native IPC/storage/provider boundaries mocked:

- `check-chat-controls.mjs`: 10 cases at 1280/390/320/280 CSS pixels and 200% equivalent
  scaling (640 physical pixels / 320 CSS pixels, DPR 2), each light/dark. Keyboard-open
  Agent and Controls, exact-agent editor and focus return, tools/MCP summaries, exact
  connection targeting/focus, private drafts and pane bindings, captured directive,
  Context/attachment identity, global Dispatcher and horizontal-overflow assertions.
- `check-product-ux.mjs`: 10 cases at the same widths/scaling/themes using production
  Settings/selectors and delegation dialog. Existing connection/agent/model/task
  navigation remains covered; canonical tools are not duplicated in chat.
- `check-collaboration-ux.mjs`: 4 cases (1280 dark, 640 light, 320 dark, 640 at 200% light).
  Pane-bound drafts/attachments/approval/Stop callbacks, verified/stale/conflicting
  sources, evidence focus/stale-read isolation, handoffs/clarification/review,
  effort locks, unknown effects and canonical tool-manager dialog focus/overflow.
- `check-first-use-ai-workflows.mjs`: 4 cases, 320/1280 light/dark. Assignment isolation,
  Dispatcher/parent navigation, retained results and narrow layout passed.

Terminal, Source Control and workspace chip/breadcrumb/explorer runtime owners were
not modified. Their automated regression tests passed in the full suite. Browser
fixtures are supplementary evidence, not native terminal/GUI acceptance.

## Cold Simulated Review

Two reviewers without roadmap/code/history context answered all 13 requested
discoverability questions from browser screenshots and visible text. Both identified
Pooper, its directive, the model/cloud route, Edit agent, task/Dispatcher navigation,
Context, Ask permissions and disabled fallback. Initial assignment-route confusion
was traced to the evidence fixture omitting Ask another agent; the corrected packet
made that entry distinct from switching the chat agent. Mid-animation Agent and
wrong-popover captures were also corrected before the reviewers' follow-up.

Remaining confusion was recorded, not treated as a human pass: collapsed built-in
tool inventory needs expansion; candidates do not establish model/request-specific
usability. Agent-wide permissions versus task read-only mode need careful reading.
The synthetic task received no chat attachments/history, so reviewers could not
attribute the placeholder answer to evidence. The packet did not demonstrate actual
failure recovery, and cannot establish its next action from Disabled fallback alone.
Long identifiers/destinations crowd scanning even though bounded scrolling and
overflow tests pass. A different active global Dispatcher conversation versus the
displayed fixture pane also required explanation. Existing task disclosure explicitly
reports what was sent; no private history sharing was added to remove that ambiguity.

## Human Validation Still Required

Native Tauri interaction: **Not performed - explicitly excluded by the user**.
No Computer Use was used. Native split-pane focus, Stop, minimize/restore, restart,
Settings-window return and native dialogs remain unverified in this pass. No Linux
or macOS native GUI verification is claimed. Live provider instruction-following was
not tested; correct serialized hierarchy does not guarantee every model obeys it.
Real humans still need to assess discovery, readability, task/context-sharing scope
and recovery workflows in actual conversations. No subsequent checkpoint was begun.

## Task And Capability Correction

Implemented from `c7558f3` without changing Chat/Dispatcher/Settings ownership or
introducing another task store, file store or agent communication protocol.

### Beginner Tools

Tools now starts with "What can this Agent do?" and descriptions of the actual
built-in tools, grouped into Files, Terminal, Collaboration and relevant supporting
categories. States distinguish permission-allowed, approval-required, denied,
read-only restrictions and unsupported/unverified model support. The existing
shared capability resolver and captured active-run evidence remain authoritative.
Raw function names and native registry reasons remain in expanded Details.

External integrations remain optional. Native eligibility/assignment and runtime
status determine custom-tool availability; MCP destinations, consent and approval
requirements remain explicit. Unconfigured integrations do not appear available.
The canonical custom manager explains that ordinary built-in capabilities use
Agent permissions; no authoring wizard or duplicate manager was added to chat.
Manage Agent tools remains a conversation-targeted Settings link. Its button stays
outside the scrolling inventory. Tools and the adjacent connection popover respect
Radix's available height, including a short 200% equivalent viewport.

### Work Navigation

Dispatcher retains its bottom-bar trigger and existing global ownership filters.
Needs attention contains failures, blocked work, clarification and unapplied patches.
Active contains running/queued/waiting work; Completed retains finished/cancelled
records. Chats are a separate disclosure for dispatch destinations, not task rows.
Rows prioritize Agent, description, state, parent chat/workspace and recorded outcome.
Selecting a row reveals the existing task card, including source/target conversations.
View task in Dispatcher selects, highlights and focuses the exact task. Arrow keys,
Home/End and ordinary Tab/Enter navigation work without changing the current chat
merely by inspecting a row. Background updates do not steal manual task selection.
Task details load on demand; the startup AI/editor/markdown bundle budget is preserved.

### Actual Outcomes And Safety

Chat and Dispatcher reuse `PeerTaskOutcome`, operating on the same durable records.
File changes appear before provenance. Isolated edits explicitly remain outside
the workspace until the existing review/lease/apply path succeeds; Review changes
and Apply to workspace precede Open. Apply errors stay recoverable, and no user
changes are committed/stashed or applied automatically.

Returned workspace/generated files can open through existing file/Markdown tabs.
Actions revalidate owning conversation, workspace/environment/root identity,
record membership, literal/canonical containment, secret-path policy and regular-file
existence, then reject stale asynchronous ownership before navigation. Applied patch
paths resolve against the real repository root, including workspace subdirectories.
Unapplied worktree paths never pretend to be main-workspace files. Missing, foreign
or protected files cannot open; a failure reports why rather than substituting a path.
The opened editor/tab receives focus through the existing application bridge.

View artifact reads the existing immutable content store, checking content ID/hash
and byte size. Metadata is bounded to 20 MiB; inline text preview to 128 KiB. Missing,
corrupt or recovery-marked evidence fails closed, without reading a filesystem
substitute. Binary formats disclose that inline text preview is unavailable. Open
file means the current workspace file; View artifact means the retained snapshot.
Text-only results have View result; an empty result truthfully reports no returned
files/artifacts. Assistant prose alone never manufactures a file-opening action.

Task access is visible: workspace, read-only/edit-isolated/edit-main mode qualified
by permissions, no copied conversation history and explicit attachment count/names.
Clarification routes to its owning recipient chat. Raw IDs/provenance remain in Details.

### Failure And Retry

Dirty-worktree failures explain uncommitted changes and link to Source Control in
the current authorized workspace; committing/stashing remains a manual user action.
Rate limits get a human summary, collapsed raw diagnostics and the task-chat model
selection route. Retry is conservative: exact failed captured Agent/model/run,
no result/patch/worktree/recovery, no earlier assistant output/tool parts, no
competing active target task, and successful native execution-history checks with
no current-run or unknown-run effects. Stale ownership is checked again before
the existing coordinator creates a new attempt; the failed original is retained.
Concurrent chat/Dispatcher clicks are guarded. If proof is unavailable, Retry is
not offered; no D3 peer-task recovery restriction or unknown effect is bypassed.

### Correction Verification

Focused regression: **124 tests / 6 files passed**, including **55 new outcome,
ownership, capability and retry tests**. The startup-bundle correction separately
passed 57 tests / 2 files, overlapping the outcome tests rather than adding 57.
Full suite after the correction: **2,436 tests / 190 files passed**. TypeScript passed.
Lint passed at the existing **71 warnings / 2 informational notices**, with no errors.
Production build and `git diff --check` passed. Build retains existing mixed
static/dynamic import warnings and plugin-timing notices. No Rust code changed;
Rust gates were not rerun for this frontend-only correction.

Headless evidence uses real React controls/stores/actions with native boundaries
mocked; it does not demonstrate real patch writes or native filesystem/GUI behavior:

- `check-first-use-ai-workflows.mjs`: 10 cases at 1280/390/320/280 CSS pixels and
  200% equivalent scale (640 physical / 320 CSS, DPR 2), light/dark. Grouping/counts,
  exact focus/highlight, keyboard task navigation, no selection theft, separate chat
  destinations, owned artifact reads, Review/Apply/Open sequencing, result focus,
  text/empty results, dirty/rate-limit actions and horizontal bounds passed.
- `check-chat-controls.mjs`: 10 cases at the same widths/scaling/themes. Beginner
  descriptions, raw Details, unsupported runtime/MCP status, keyboard access,
  canonical Settings routes, private drafts/pane bindings, captured instructions,
  Context and connection controls passed, including short-viewport Settings actions.
- `check-collaboration-ux.mjs`: 4 existing cases passed for pane-owned drafts,
  attachments/approvals/Stop callbacks, context/recovery/effort and tool-manager focus.

One fixture bootstrap timed out; a diagnostic rerun passed without a production
bootstrap change. The full suite found and caught an eager-import regression; it
was fixed with on-demand task details before the final passing run. Short-viewport
fixtures exposed clipped Settings actions and verified the bounded-scroll fixes.
Native Tauri, live providers, real patch application and Linux/macOS GUI interaction:
**Not performed - explicitly excluded by the user**. Real human validation of
discoverability and recovery remains necessary. No push or subsequent checkpoint.

## Failed Task Retry And Previous/Next Navigation

Historical implementation record for `67c0a75`. The coarse effect exclusions below
were replaced by the Dispatcher task-management refinement in the next section;
the original verification results remain recorded here.

Both the chat task card and Dispatcher selected-task detail use `PeerTaskOutcome`
and the same `checkTaskRetry` / `retryTaskWithoutEffects` coordinator path. Retry is
enabled only after native execution history validates the absence of effects. The
existing PeerTask store owns transient `retryingTaskIds`, so both surfaces disable
duplicate clicks and immediately show `Retrying...`. Creating the new attempt opens
its exact Dispatcher row without changing the active conversation or pane bindings.
If that task surface is dismissed/replaced during checks, a stale callback does not
reopen Dispatcher or steal focus; the new attempt remains in the same shared store.

Eligible failures are captured-run rate limits, provider unavailability, model
loading/backend restart, network/timeouts and context preflight before output/tool
state. Context preflight still runs normally on the new attempt; Retry does not
override B1. Setup/handoff preparation failures are eligible only with a durable
`preRunFailure` receipt written in the same existing ledger update as the failure.
That receipt is never granted after a possible worktree creation or inference run.
Isolated setup first checks Git cleanliness under the existing setup write lease;
native worktree creation retains its own cleanliness/authorization enforcement.

No blind retry is allowed for returned results, patches, preserved worktrees,
restart/recovery ambiguity, assistant output/reasoning/tool parts, current-run or
unknown-run native executions (including completed reads and MCP/custom-tool
effects), missing execution history, changed captured Agent/model/workspace/run,
or another active target assignment. Authentication/authorization failures offer
`Fix connection` instead. Dirty workspaces offer Source Control; Retry stays disabled
until an explicit `Check retry availability` verifies clean, non-truncated status.
Clack never commits or stashes on the user's behalf. Legacy setup failures lacking
a receipt remain conservative; prior assistant evidence can also prevent retry.
Changing the captured target Agent/model requires an explicit new assignment.

Retry retains the failed record and creates a new PeerTask with `retryOfTaskId` and
`parentTaskId` pointing to it, preserving the existing root and delegation hop count.
Original prompt, target identities, execution/permission mode and dependencies are
retained; the failed attempt is not added as a completion prerequisite. Explicit
immutable artifacts are reused with their complete original provenance, bounded by
existing artifact limits and hash/size checks. Missing/corrupt content is never
substituted from a filesystem path. Existing active/root/dependency limits, write
leases, approvals, cancellation, persistence CAS and no-replay recovery still apply.
An original can have only one direct retry; later explicit attempts retry the newest
eligible failure. Both lineage directions are inspectable after serialization/restart
through the existing bounded version-7 task ledger's additive optional metadata.

Previous/Next uses the exact displayed sequence: Needs attention, Active, Completed,
then descending update time and stable ID within each group. Availability/owner
filtering is applied before navigation. The shared sequence helper also supports a
group-filtered input; the current Dispatcher displays all available groups, not a
new filter UI. First/last buttons are disabled without wrapping, `Task N of M` gives
position, and selection remains keyed by task ID when updates reorder the list.
Deleted/unavailable selections safely show no selection with disabled navigation.
Buttons have explicit accessible names, select/focus the neighboring visible row,
and preserve the existing Arrow Up/Down/Home/End list behavior.

Verification: **227 focused tests / 9 files passed**, plus **17 clarification
regression tests / 1 file passed** after updating its clean-workspace fixture.
Full frontend: **2,460 tests / 191 files passed**. TypeScript, production build and
`git diff --check` passed. Lint remains **71 warnings / 2 informational notices**,
with no errors. Existing mixed static/dynamic import and plugin-timing build warnings
remain. No Rust code changed; Rust gates were not rerun.

`check-first-use-ai-workflows.mjs` passed all **10 headless browser cases** at
1280/390/320/280 CSS pixels and 200% equivalent scaling (640 physical / 320 CSS,
DPR 2), light/dark. Coverage includes exact visible-order Previous/Next, boundaries,
keyboard activation and row focus, shared retry/pending/lineage, unchanged chat/pane
ownership, dismissal during retry, deletion, grouping, immutable artifact and Review/Apply/Open regressions,
and horizontal bounds. Native IPC/provider/coordinator execution is mocked in this
browser fixture; actual coordinator and real-file/Git workflows run in the automated
integration group. **Computer Use, native GUI and live-provider verification were
not performed, as requested.** No push or subsequent checkpoint.

## Dispatcher Retry, Archive And Appearance

The failed rate-limit task had no Retry because the previous guard treated every
assistant tool part and current/unknown-run native execution as a possible effect,
including completed reads. Chat and Dispatcher still share `PeerTaskOutcome` and
the same final `checkTaskRetry` / `retryTaskWithoutEffects` coordinator checks.
The refinement classifies effects using existing transcripts, activity receipts
and native execution history, not another safety ledger.

### Retry Safety And Recovery

- Completed built-in `read_file`, `list_directory`, `grep`, `glob`,
  `request_conversation_evidence`, `read_agent_output`, `get_terminal_output`,
  `bash_logs` and `bash_list` are replay-safe based on their executor semantics.
  Pending calls remain ambiguous. Read/list/search followed by a rate limit now
  exposes an enabled `Retry task` in chat, Dispatcher and Archived.
- Custom tools require an exact output execution-ID/tool-name match to a terminal
  native `effect: none` receipt for the captured session/workspace/Agent/run/task.
  A preliminary UI candidate cannot authorize Retry. MCP/HTTP/WASI operations,
  mutating tools, shell execution and unknown effects remain blocked; remote
  read-only annotations are not proof. Missing native history fails closed.
- Existing results, patches, worktrees, recovery ambiguity, changed identities,
  active assignments and missing immutable evidence retain their exclusions.
  Authentication failures retain `Fix connection`. B1 is unchanged and runs again
  on any new attempt; no model/provider or permission check is bypassed.
- Current-run progress requires matching persisted activity ownership. Older
  completed history is excluded only with validated part-specific earlier-run
  receipts and no omitted receipts; unattributed/unfinished effects still block.
  Receipt validation was extracted unchanged into dependency-light
  `activityRecord.ts` so Dispatcher does not eagerly load provider runtime code.
- Unsafe tasks explain `Retry unavailable` instead of silently omitting recovery.
  Dirty candidates show `Retry after workspace is clean` and `Open Source Control`.
  Visible dirty candidates recheck on focus and every three seconds, with the
  existing explicit availability check retained. Clack never commits/stashes.
- Retry still creates one linked new attempt and preserves the failed record,
  immutable input provenance, root/parent/retry IDs and duplicate-click guard.
  A retry of an archived failure is a new current task, not a restored old run.

### Durable Archive And Clear Finished

`PeerTask.archivedAt?: number` is additive presentation metadata in the existing
version-7 bounded PeerTask ledger. IDs, status, update ordering, results, artifacts,
hashes, effects, lineage, dependencies, review/change sets and recovery evidence
remain intact. Archive does not delete content or introduce a store/cleanup policy;
existing content-reference collection and the 256-task ledger retention bound are
unchanged. It is not an unlimited historical backup.

Per-task Archive is shared by chat cards and Dispatcher. Terminal completed, failed,
cancelled or blocked tasks are eligible only without pending clarification, an
active dependent/descendant, Retry or an in-progress Apply/worktree-management
operation. Existing startup recovery must be ready. Coordinator-owned transient
busy IDs protect actual operations across surfaces, including write-lease waits.

Archive/Restore updates use the existing ledger save/flush and native CAS revision.
Persistence failure restores the visibility field without overwriting concurrent
task data and leaves the existing recovery error/pause active. Loading is additive
and idempotent; invalid timestamps and malformed archived active tasks restore
visibility. Dependency/result lookups continue using all records, not visible rows.
Actions revalidate owning conversation and current authorized workspace.

Current/Archived filters have independent counts. Archived records retain inspection,
parent chat access, safe Retry and Restore. Chat offers an Archived tasks link.
Archiving the selection advances to its next visible neighbor, then previous when
needed; Previous/Next, exact list order and keyboard row focus remain intact.

`Clear finished` confirms that history/results remain in Archived and archives only
eligible completed tasks. It skips failures, cancelled/blocked work, preserved
worktrees, unapplied patches, recovery and active dependencies/operations. There is
no automatic failure archiving and no permanent purge.

### Layout And Appearance Ownership

Dispatcher retains task navigation plus selected details. Its header shows attention,
active and completed counts, Current/Archived, Clear finished and Close. Recovery/
result actions precede task/failure details; access/context and technical provenance
are collapsed, and Chats remains secondary and collapsed. Selected details are
unframed rather than a second opaque card inside the floating surface.

The surface uses existing `clack-workspace`, `--clack-bg-workspace`, border/focus/
accent/text tokens and the shared popover radius/shadow. The same contained
`ConfiguredBackgroundLayer` used by floating AI surfaces renders the configured
image, opacity (existing factor 0.5), blur, sizing and visibility. No independent
Dispatcher appearance settings or hard-coded opaque surface are added. The
application's current configurable blur is background-image blur, not a new
Dispatcher-specific backdrop-blur control. Both themes/custom alpha tokens remain
owned by the existing Settings/theme architecture.

### Verification And Limits

- Focused final group: **342 tests / 13 files passed**, covering retry effects,
  actual coordinator transitions, archive/store serialization and hydration,
  dependency/review/restart recovery, activity, startup budget, shared outcomes,
  background rendering, stream recovery and real-file/Git acceptance fixtures.
- Full frontend: **2,518 tests / 192 files passed**. A subsequent conservative
  omitted-receipt guard assertion passed in the final focused group; production
  build also passed after that tightening. TypeScript passed. Lint remains
  **71 warnings / 2 informational notices**, no errors. Existing mixed
  static/dynamic import and plugin-timing build notices remain.
- Headless `check-first-use-ai-workflows.mjs`: **10 cases passed**, at
  1280/390/320/280 CSS pixels plus equivalent 200% scaling (640 physical / 320 CSS,
  DPR 2), both light/dark. Each case checks default background and custom image
  opacity 0.15/0.9 with blur 0/12: **50 appearance configurations** total. Tests
  assert actual shared layer settings/image references, inherited surface variable,
  horizontal bounds, accessible action names, confirmation focus, row keyboard
  focus, neighbor navigation, archive/restore, retained ledger data, bulk exclusions,
  dirty-to-clean Retry, shared pending/lineage, stale callbacks and artifact/
  Review/Apply/Open/Source Control ownership. An initial neighbor-focus fixture
  race was corrected by waiting for the real mounted/focused row; production
  neighbor selection required no change.
- Browser native IPC/provider/coordinator boundaries use mocks. Automated
  coordinator tests exercise the actual coordinator with native/provider boundaries
  mocked; the acceptance integration group also uses temporary real files/Git and
  loopback provider fixtures, not live providers.
- No Rust changed; Rust gates were not rerun. Computer Use, native Tauri GUI,
  live providers and Linux/macOS native acceptance were **not performed**, as
  explicitly requested. Human validation of appearance/readability with the user's
  backgrounds, native keyboard/focus and real-provider recovery remains necessary.
  Legacy unattributed history or incomplete effect evidence remains conservative.
