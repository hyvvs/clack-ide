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
| Tools | Permission-qualified built-in candidates, native assignment/eligibility, unsupported runtimes, MCP status/destination and approval requirements | Custom Tools Manager in Agents & tools, initially selecting this conversation |
| Context | Existing sources/conversation memory, project knowledge/freshness, immutable attachment references and pane-owned task artifacts | Existing evidence inspection; no merged store, automatic promotion or extra context injection |
| Agent activity | Truthful run/inference status with expandable existing receipts/provider output | Existing activity presentation; effort remains separate from visibility |
| Ask another agent | Existing bounded task dialog and explicit artifact/context selection | Existing task creation, not Agent selection |
| Task card | Recipient, task, state, result, clarification/review/provenance and View task in Dispatcher | Existing Dispatcher and owned recipient/parent conversation |
| Dispatcher link | All known assigned tasks plus active-task/running-chat counts | Existing global Dispatcher, with workspace/parent labels; task evidence access remains owner-checked |
| Inline approvals/recovery | Existing pane-bound approval, Continue, Retry, partial/offline recovery and watchdog actions | Existing run lifecycle; no new replay or fallback authorization |

Settings remains the only full editor for agent definitions, connection credentials,
servers, reusable tools/MCP configuration, calibration pins and provider diagnostics.
Fallback keeps its existing conversation-scoped consent dialog; it is not permanently
expanded in the header. The tools count is candidate availability, not a promise that
every tool will be selected or that every path/input is authorized.

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
