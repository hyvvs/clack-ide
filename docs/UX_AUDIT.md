# Product UX Audit

Date: 2026-10-09. Base: `4f193b4 chore(ai): complete final acceptance handoff`.
One bounded post-roadmap audit and presentation pass. No new roadmap,
inference architecture, permissions, managers, persistence schema or routing.
No push, release, Computer Use, native GUI interaction or live-provider calls.

## Executive Summary

The evidence supports clearer management labels, readable narrow Settings,
more explicit chat/model/agent scope, visible connection destinations, easier
approval inspection and repaired agent-editor keyboard focus return. It does
**not** establish that ordinary users find Clack intuitive.

Findings: **0 P0, 6 P1, 6 P2, 5 Observations**. All six P1 findings and six
straightforward P2 findings received bounded presentation fixes. No wrong-pane
action, authorization bypass or automatic cloud disclosure was demonstrated.
Observations and unperformed acceptance checks remain explicit below.

The existing information architecture is usable as a foundation: Connections
expose Models; a Chat owns its history and selected Model/Agent; an Agent has
instructions and authorized Tools; Tasks connect authorized conversations;
Workspace identity bounds files and shared project knowledge. Context and
Activity are inspectable adjuncts, not alternative chat managers. No second
agent, connection, tool manager or Dispatcher was introduced.

Evidence classes used throughout:

- **B**: headless Chromium interactions with production components, synthetic
  state and mocked native/storage/generation boundaries.
- **T**: automated unit, server-rendered component or integration tests.
- **I**: targeted navigation, visible-string and call-path inspection.
- **H**: human understanding or native interaction still needs validation.

Four independent cold simulated reviewers received screenshots and short
goals, not source, roadmap or implementation explanations. They did not
actually navigate the complete native application. The initial map below was
recorded before product edits. Screenshots supplement behavior assertions;
they are not evidence of live inference or successful native window behavior.

## Information Architecture

### Navigation Map

This is the initial entry-point inventory with final labels and assessment.
Counts refer to distinct entry-point families, not every repeated icon.

| Concept | Starting point and final label | Canonical home / destination | Scope | Competing entry points and return |
| --- | --- | --- | --- | --- |
| Chats/history | Status bar AI Chat; compact composer; pane title Choose chat | Existing AI Chat and pane chat picker | Conversation; selected pane | Three access families, one history store. Picker stays in pane; native rediscovery H |
| New chat | Pane title New chat; empty split pane | Existing new-conversation action | New conversation in chosen pane | Two intentional shortcuts; not a model switch |
| Models | Pane header; compact composer Model | Existing ModelDropdown | Explicit target chat; active selection for future chats | Two instances of one selector/guard; menu closes to same work |
| Saved models | Picker entries; Settings Connections & models | Existing ModelsSection | App connection/model configuration | Two access families, not duplicate managers; Settings close returns to app |
| Connections/providers | Header Settings; picker configure links; Add provider | ModelsSection, Provider connections | App configuration and connection | Three entry families converge on the same category |
| Self-hosted servers | Connections & models, Add self-hosted server; compatible-server shortcut | Existing SelfHostedServers | Versioned connection/profile | Two shortcuts; edit/check/save in place, then return to chat |
| Agents | Chat picker Manage agents; Settings Agents & tools | Existing AgentsSection | Agent definition/default, separately chat selection | Two access families; editor returns focus to actual opener |
| Tasks/delegation | Ask another agent; task message card | Existing task dialog/feed | Task, sender/recipient conversation, workspace | Creation versus inspection, not two schedulers; recipient/parent links retained |
| Background work | Header notification bell; AI Chat Delegated work | Existing Dispatcher | Global/background runtime | Two intentional entrances; distinct from pane-local Stop |
| Workspace | Workspace chip; breadcrumb; explorer folder context menu | Existing chooser and folder actions | Stable workspace identity | Three visible routes; command palette remains backup, not primary |
| Tools | Chat Manage tools gear; Agents & tools | Existing CustomToolsManager | Workspace plus explicit conversation/agent grants | Two compositions of the same manager; contextual dialog returns focus |
| MCP | Custom tool manager connection section | Existing McpConnections | Connection consent and scoped assignment | One connection manager, reused with tool manager; disconnect retained |
| Sources/context | Chat Sources & context; project knowledge panel | Existing ContextSources / ProjectMemoryPanel | Private conversation versus authorized project records | Two different ownership types, not a merged memory store; transcript source focus stays in pane |
| Activity | Pane run status; message Agent activity | Existing activity timeline | Captured conversation/run | Summary versus detail; answer stays primary |
| Approvals | Pending tool card; waiting chat/task status | Existing approval/result card | Exact call, captured agent/chat/workspace | No alternate approval workflow; one-time and broader grants remain separate |
| Permissions | Chat agent permission control; Agents & tools | Existing permission controls | Agent profile and explicit chat/workspace grants | Contextual and canonical views; no grant changes from this audit |
| Fallback | Chat fallback control | Existing ChatFallbackControl | Per-conversation Never / Ask / exact Trusted destination | One canonical per-chat policy; not a global automatic cloud route |
| Discovery | Add server discovery disclosure | Existing explicit discovery form | User-started metadata request | One optional route; manual address entry remains available |
| Settings | Header gear; contextual management shortcuts | Existing separate Settings window | App configuration with explicitly scoped subsections | One six-category surface; actual native close/focus return H |
| Advanced inference | Saved server/model profile disclosure | Existing Advanced model controls | Connection/model profile | Not the Keyboard shortcuts category; disclosure returns in place |

No duplicate manager or dead-end requiring a new page was identified. There
are real discoverability risks: chat history is behind a title menu; global
background work is reached through Delegated work/notifications; fallback is
conversation-local rather than an obvious global Settings category. These
routes remain visible, but natural discovery requires human testing.

### Settings Organization

Six categories remain: **General, Connections & models, Agents & tools,
Appearance, Keyboard shortcuts, About**. Existing tab IDs and legacy `ai` /
`connections` deep links retain their destinations.

Before: Overview, Models & Providers, Agent Permissions, Appearance, Advanced,
About. The Advanced tab actually contained keyboard commands, not inference
controls; Agent Permissions hid agent creation and tools behind a narrow name.
Connection configuration followed Defaults and Voice before the actual setup.

After: connections/server setup precedes defaults and voice; agents precede
tool, permission and instruction sections. Narrow screens use a two-column
category strip above content instead of squeezing content beside a 256px rail.
Advanced inference remains inside its model profile. Fallback remains in the
chat that owns its consent, not duplicated into app Settings. The Startup model
preference is a restoration fallback, not a command to change existing chats;
usable last-used selection and hydrated chat profiles can take precedence.

### Ownership Assessment

| Control | Actual owner / effect | Presentation and qualification |
| --- | --- | --- |
| Settings connection and saved-model controls | App configuration; individual versioned connection | Connections & models, distinct from selecting a chat's model |
| Startup model / autocomplete / voice / appearance | App-global defaults | Startup model replaces ambiguous Chat model; no chat profile rewrite |
| Chat model picker, both entry points | Explicit conversation model; new chats inherit active selection | Model for this chat; existing chats keep their model; new-chat inheritance stated |
| Settings agent card Set as default | App default agent for new conversations | Replaces misleading Active / Use agent |
| Chat agent picker | Selected chat; existing implementation also sets new-chat default agent | Agent for this chat plus explicit default side effect; other chat unchanged |
| Draft, attachment, source focus, pane Stop | Pane's conversation/run | Two-pane fixture assertions; native split/Stop H |
| Tool assignment and permission controls | Authorized workspace/conversation/agent | Existing scope controls retained; exact one-time call separate from broader grant |
| Task, review, clarification, correction | Captured task/sender/recipient/workspace | Actors and status readable; provenance identifiers remain expandable |
| Fallback consent | Conversation and exact trusted destination | Existing modes and confirmation retained; address classification added |
| Dispatcher and notification bell | Global background work | Not renamed into a pane-local control |
| Workspace chip / breadcrumb / explorer | Workspace or terminal-navigation action as currently defined | No behavior change; breadcrumb is not falsely presented as changing every pane |

## Cold Simulated Reviews

Four independent, screenshot-only perspectives were used, without shared
implementation context. The supplied U1 stress fixture had synthetic names,
mock composer controls and intentionally absent task recipients. Reviewers
were told not to treat that composer as the production composer or infer a
missing feature solely from omitted fixture navigation.

| Perspective | Main findings | Outcome / limitation |
| --- | --- | --- |
| Ordinary user | Model versus connection unclear; context/compaction terminology; too much equal-weight detail; uncertainty about where earlier chats live | Clearer model and source labels; chat terminology unified at title picker. First-run/history discovery remains H |
| Developer new to Clack | Approval target buried in long path; model switch versus configuration; task says running while clarification is present; desire direct diff action | Target/scope and selector signals fixed. Task-state semantics and diff navigation not redesigned |
| Privacy-conscious | Self-hosted does not mean same PC; LAN versus local; fallback destination; Refresh/Optimize/Save models effects; permission duration | Actual configured-address signals added, exact consent retained. Trust/wording comprehension remains H |
| Accessibility/usability | Focus return; missing agent-field/icon names; low-emphasis stale/missing evidence; long addresses and narrow layout | Focus, names, status emphasis, layout and disclosure fixes. No screen-reader/native acceptance claimed |

Reviewers independently converged on model scope, technical source language
and destination clarity. Agreement is heuristic prioritization, not a novice
success rate, scientific usability score or human validation.

## Core Navigation Task Suite

All 24 requested tasks were audited. "Obvious" here is a label/placement
assessment, not a measured first click from an uninstructed real person.
The explicit path records competing routes, wrong turns, terms, dead ends,
outcome and ownership. B/T/I are not interchangeable with H.

| # / task | Start / first click assessment | Competing paths / wrong-turn risk | Terminology / dead-end assessment | Result / ownership / evidence |
| --- | --- | --- | --- | --- |
| 1 New chat | AI Chat pane title -> New chat; visible once picker is found | Empty split action also creates chat; switching model is not creation | Session removed from ordinary picker; no code-path dead end | New identity, pane-local; I/T, unprompted discovery H |
| 2 Existing chat | Pane title -> Choose chat; title-menu discoverability uncertain | New chat is an easy wrong turn | Chat primary; existing list remains canonical | Existing history stays with identity; I/T, native rediscovery H |
| 3 Two chats | AI Chat split control -> choose other conversation | Global Dispatcher is not a split | Pane versus chat must be learned; width guards intentional | Independent owners and guarded split capacity; T/B adjuncts, native split H |
| 4 Each chat's model | Read Model in each pane | Compact composer duplicates selection, not configuration | Connection shown below model; full name via title/accessibility | Two explicit owners; B/T |
| 5 Switch A not B | A's Model -> desired model | Startup preference is not current-chat switch | Same chat/history and future messages stated; blocked switch explains why | A retains ID, B model/draft unchanged; B/T |
| 6 Add server | Settings -> Connections & models -> Add self-hosted server | Add provider compatible shortcut; not Agent settings | Address, Connect, health, models; manual route never removed | Explicit connection and consent; B/T, no real connection tested |
| 7 Server model | Connected server -> model choice -> Save models -> chat picker | Server model list config versus current-chat picker | Save models means save selection, not download; human interpretation H | Selected entries reach picker; controlled B/T |
| 8 Return to chat | Close Settings or contextual dialog | Separate window has no app-wide Back button | Close is return, not delete conversation | Mock close preserves drafts; B/T, native focus/scroll H |
| 9 Create agent | Settings -> Agents & tools -> New agent | Manage agents shortcut goes to same home | Named fields and instructions; no new provider required | Real store create/edit, Save/Escape focus restored; B |
| 10 Agent model | Select model in that agent's chat or task recipient | Agent editor versus chat model picker | Agent definition is not an independent model connection; no fake editor model control | Conversation/task captures selected model; I/T; mental model H |
| 11 Agent tools | Agents & tools or chat Manage tools | Same tool manager, not two databases | Assigned, authorized, unsupported and version state remain distinct | Explicit scope/owner visible; B/T |
| 12 Use agent | Chat Change agent -> selected agent | Set as default is configuration, not a different chat | Agent for this chat; new-chat default side effect stated | A agent changes, B stays unchanged; B/T |
| 13 Assign task | Ask another agent -> recipient -> Review/Task -> Send task | Selecting agent in own chat is different | No PeerTask required in ordinary form; no-recipient state explains blocker | Read-only review b -> a, no whole-history copy; B/T |
| 14 Find running task | Chat task card; Delegated work for background | Notifications are another global entrance | Pane task versus global work still needs learning | Card retained with captured actors; B/T/I; natural discovery H |
| 15 Task states | Read task badge and communication | Running with a clarification is not necessarily scheduler-paused | Queued/blocked/done plus explanation; contradictory interpretation risk | Dependency/queued/clarification rendering T/B; human interpretation H |
| 16 Task result | Task card -> result/review/provenance -> recipient/parent | Source inspection is evidence, not accepting a patch | Deleted-recipient fixture cannot navigate; not inferred product dead end | History/actors retained, review states inspectable; T/B; native return H |
| 17 Answer sources | Sources & context -> source link | Project knowledge is authorized shared material, not private chat memory | Saved summary replaces compaction-first wording; missing evidence explicit | Original focus stays in correct transcript; lazy access; B/T |
| 18 Approve | Pending card -> full target/diff as needed -> Allow once | More permissions is a broader grant route | Filename/owner first; exact workspace/path retained; no ambiguous duration | Correct pane callback and unchanged exact approval guard; B/T |
| 19 Deny | Pending card -> Deny | Do not confuse closing inspection with denial | Explicit refusal; no execution implied | Correct pane denial; denied result remains distinct; B/T |
| 20 Destination | Model label / connection address / approval destination | Provider name or Self-hosted alone can mislead | Same-PC address, Private-network address, Network unverified, Cloud connection | Configured identity used; no DNS/locality guarantee; B/T/I |
| 21 Ask fallback | Chat fallback -> Ask -> exact destination | Trusted automatic mode is intentionally different | Existing disclosure and confirmation; not silent global fallback | Never/Ask/Trusted guards unchanged; controlled B/T; comprehension H |
| 22 Advanced | Server/model profile -> Advanced controls / Details | Former Settings Advanced actually meant shortcuts | Keyboard shortcuts now correctly named; evidence/revisions stay advanced | Existing controls retained; I/B; advanced jargon residual H |
| 23 Offline/interrupted | Read structured error -> Connect/settings, Retry or Continue Partial Answer when allowed | Retry, length Continue and Continue anyway have different semantics | No universal retry for unknown effects; restart cannot replay old request | Distinct errors/no-replay/watchdog/continuation T, supplementary B; native recovery H |
| 24 Return to work | Close/Escape inspection -> original composer | Closing pane is not cancelling all background work | No new dashboard or command-palette detour | Draft/attachment/model/pane isolation T/B; native scroll/window restoration H |

## Core Workflow and Journey Results

| Journey | Result and evidence | Confusing point / bounded fix | Unresolved question |
| --- | --- | --- | --- |
| First chat | Empty/no-provider route and message branches T; entry/composer I | Model and destination now explicit; no onboarding/configuration wizard added | Will a novice find AI Chat and send/Stop without help? |
| Connection setup | Add/edit/auth/private access/model list/search/manual entry in controlled B | Canonical Connections & models, configuration before Defaults/Voice | Do people distinguish Provider, connection and server? |
| Self-hosted setup | Health, auth, stale results, manual model path and large model list B/T | Same-PC versus private/public address signal; no inferred localhost from provider name | Do Connect, Refresh and Save models communicate that no model is installed/downloaded? |
| Same-conversation model switch | Lock, prepare, cancel, review, commit, incompatible/blocked and overflow B/T | Same chat/history/future messages; explicit scope in both selector instances | Is preparation versus ordinary switching understandable? |
| Attachments | Actual composer ownership/submit isolation B; attachment compatibility and restart T | No representation or safety changes; unsupported attachments remain explicit | Do users notice which pane owns attachment chips? |
| Split panes | A/B drafts, attachments, models, agents, approval and Stop callbacks isolated B/T | Model/agent scope and captured approval owner clearer | Native split layout, focus and Stop deliberately not performed |
| Agent creation/use | Create real agent store entry; edit/Escape/Save focus; chat assignment B | Agents & tools, named fields/icons; default versus chat selection distinguished | Is Agent understood as instructions/tools rather than Model? |
| Task assignment | Real unchanged dialog submits one read-only review to correct recipient in new B harness; T payload/isolation | Uses Review/Task and recipient chat; no architecture change | Recipient conversation requirement and running-task discovery H |
| Tools | Actual manager dialog B with fixed conversation owner, runtime/unsupported status and Escape return | Canonical manager reused; no duplicate management surface | Are assigned, authorized, enabled and executable states easy to distinguish? |
| Approvals/results | A allows, B denies; ownership and result states T/B | Agent/chat, filename, full target disclosure and Allow once duration clear | Native diff tab navigation and nondeveloper risk judgment H |
| Sources/context | Lazy read; verified/stale/conflicting/missing evidence; original focus and stale-response isolation B/T | Sources & context and Saved summary; missing/stale status more legible | Do users know when they need original evidence rather than summary? |
| Activity/background work | Actual activity/task cards B and captured actor/dependency/review/clarification T | Existing human status summaries kept; no fabricated reasoning | Will users look in Delegated work for background tasks? |
| Offline/recovery | Structured provider/retry/tool error, partial answer, watchdog and continuation T; supplementary notices B | Existing distinct recovery semantics kept rather than indiscriminate rename | Live offline timing, restart and native recovery not tested |
| Fallback/privacy | Never, Ask, exact destination, keyboard consent, isolation B/T | Destination classification supplements existing consent and address | Is Ask reassuring and accurately understood as data leaving its original route? |
| Settings -> return | Category navigation, agent dialog and mock close retain both drafts B | Narrow hierarchy, correct tab labels and actual opener focus return | Real multi-window activation, scroll restoration and OS close behavior H |

Task results preserve success, failure, denial, cancellation, timeout,
interruption and unknown external effect as distinct states. Unknown effect
must not become an ordinary harmless failure or automatically retryable action.
Reasoning effort remains a supported model setting; visibility/activity is
provider-exposed presentation, not a change to how much a model reasons.
Unsupported effort is absent/disabled, with active-run locks tested. Neither
system was redesigned in this audit.

### Empty and Recovery States

| State | Existing next action / audit result |
| --- | --- |
| No chats / empty pane | Existing New chat action; name normalized; first-run discovery H |
| No provider/connection | Existing connection Settings route, Add provider; rendered T and setup B |
| No self-hosted server | Add self-hosted server remains first-class and visible B |
| No discovered/saved models | Manual model entry or explicit connection refresh; uncertainty is not fabricated capability B/T |
| No custom agents | Built-in agents plus New agent; no empty dead-end B |
| No custom tools / unsupported tool | Canonical manager and runtime state, not a false executable action B/T |
| No other task recipient | Existing no-configured-chats explanation; no submit until eligible recipient T/I |
| No sources/summary | Original messages remain available; missing evidence cannot be opened as verified B/T |
| No discovery results | Results are candidates; manual entry remains; none found is not proof none exist B/T |
| Offline / auth required / loading / rate limit | Existing health/error distinctions and settings/refresh/retry path; controlled B/T, no live timing |
| Partial interruption / cancellation / watchdog | Preserved partial output and reason; explicit recovery only when safe T/B |
| Restart without captured request | Send a new instruction; no automatic resume or tool replay T/I |

Recovery wording was searched rather than mass-renamed: **Retry** restarts an
eligible failed request; **Continue Partial Answer** follows retained partial
output; **Continue** follows a step/length boundary; **Continue anyway** is an
explicit loop-warning choice. These are different actions. Internal recovery
terms remain in diagnostics and provenance. No hidden retries were added.

## Findings

| ID | Severity | Surface / problem | Evidence | Fix / recommendation | Status |
| --- | --- | --- | --- | --- | --- |
| F01 | P1 | Settings fixed rail makes narrow content unusable | Before B: 390px content 134px, 320px content 64px, internal scroll width 393px | Category strip above content below sm, responsive fields/min-width constraints | Fixed; B across 10 configurations |
| F02 | P1 | Canonical Settings labels conceal connections/agents and mislabel keyboard commands as Advanced | Initial map I; cold review convergence | Connections & models, Agents & tools, Keyboard shortcuts; stable IDs | Fixed; B category/heading routes |
| F03 | P1 | Chat model/agent choices look like global default controls | All cold perspectives; I confirms different ownership plus new-chat inheritance side effects | Explicit chat scope, default labels, Startup model; keep side effects stated honestly | Fixed presentation; B/T isolation; H understanding |
| F04 | P1 | Self-hosted/local provider naming cannot establish actual destination | Privacy/dev cold review; configured private/remote addresses T | Classify actual configured address, qualify unknown location, show known cloud route in picker | Fixed signals; no authorization/routing changes |
| F05 | P1 | Long approval paths bury target/actor and Scope obscures duration | Three cold reviews and U1 stress screenshot | Filename/actor/chat first, full workspace/target disclosure, Allow once and More permissions | Fixed; exact target and approval semantics retained B/T |
| F06 | P1 | Saving agent editor loses keyboard focus to body | New B harness reproduced failure before correction | Capture actual opener; restore on Save/Cancel/Escape if still connected | Fixed; Save and edit/Escape B |
| F07 | P2 | Source/compaction-first language and low-emphasis missing/stale state | Four cold reviews, I/B | Sources & context, Saved summary, explicit newer-message coverage and high-emphasis changed state | Fixed; lazy read/source fidelity unchanged |
| F08 | P2 | Chat/session naming varies at normal history entry | Initial I and ordinary-user review | Choose chat / New chat at title picker | Fixed; internal session identity unchanged |
| F09 | P2 | Very long discovery address crowds candidate/action | Cold reviews and small discovery fixture | Full address disclosure, compact host/port, existing Use address visible | Fixed; discovery remains opt-in/untrusted B |
| F10 | P2 | Agent fields/icons and edit/delete lack specific names; hover-only actions weak on touch | I and accessibility cold review | Field/icon accessible names and state; agent-specific edit/delete names; touch/focus visibility | Fixed; B field and specific edit opener |
| F11 | P2 | Defaults/voice and permission detail precede normal setup/create actions | Initial map and rendered Settings | Connections before defaults/voice; agent list before tools/permissions/instructions | Fixed, no new category/manager |
| F12 | P2 | Narrow model row leaves name/destination almost unreadable beside capability bars | Settled 280px screenshot B | Wrap row, preserve useful name width and move secondary capability bars as needed | Fixed; B menu bounds and screenshots |
| F13 | Observation | Running task plus clarification can look contradictory | Developer cold review; existing communication/scheduler distinctions T | Human test who owes answer; do not relabel scheduler or modify protected delegation files | Open interpretation question |
| F14 | Observation | Direct diff-review/recipient/parent return can be hard to discover | Cold review; actual diff opens via existing bridge I | Validate real tab/return navigation; no speculative button/runtime bridge | Native verification deferred |
| F15 | Observation | First-chat/history/Settings/task discovery and Agent mental model | All cold perspectives, incomplete rendered product navigation | Short uninstructed real-person test below | Human validation required |
| F16 | Observation | Advanced provenance/capacity jargon and broader accessibility debt remain | I, existing lint warnings, screenshot heuristics | Keep evidence inspectable; validate comprehension and native/screen-reader behavior before broader redesign | Not full accessibility certification |
| F17 | Observation | Older standalone delegation browser fixture timed out before initial dialog | This pass's isolated script run: getByRole(dialog) 30s timeout, no product regression demonstrated | Protected files unchanged; actual dialog exercised successfully in new isolated harness with explicit mocks | Standalone fixture limitation recorded, not claimed passed |

No P0 finding is claimed from the available evidence. The existing guards
already require exact approval, workspace authorization and explicit fallback
consent. Poor destination labeling was treated as P1 presentation confusion,
not evidence that a hidden cloud transfer or wrong-pane action occurred.

## Terminology

| Competing terms | Primary ordinary term / relationship | Intentionally retained detail |
| --- | --- | --- |
| Chat / conversation / session / thread | Chat in picker/new action; conversation for continuity/history | Session IDs and persistence terminology internal; no internal rename |
| Connection / provider / endpoint / server | Connections & models; provider connection; self-hosted server is a kind of connection | Exact endpoint, transport and profile evidence in detail |
| Model / saved model / default | Model answering this chat; saved model is a configured choice; Startup model is app restoration fallback | Runtime/provider identity and compatibility details |
| Agent / assistant / persona | Agent for this chat; definition contains instructions/tools/permissions | Provider assistant content remains assistant; no model/agent merger |
| Task / assignment / delegation / PeerTask | Ask another agent, Review / Task, Send task / Queue task | PeerTask/root/dependency/receipt identifiers in provenance |
| Sources / context / memory / compaction / evidence | Sources & context; Saved summary; original messages retained | Private conversation memory versus authorized project knowledge; source hash/version in details |
| Scope / one-time approval / permissions | Allow once; More permissions is explicitly broader | Exact permission scope choices and authorization untouched |
| Retry / Continue / Resume / Recover | Retry or Continue Partial Answer when safe; Continue at a limit | Different no-replay, loop and restart semantics kept |
| Reasoning effort / visibility / activity | Effort is supported generation configuration; Activity is observed work | Provider-exposed reasoning only, never invented hidden reasoning |
| Local / self-hosted / LAN / cloud | Same-PC address; Private-network address; Cloud connection; Network address location unverified | Address classification is not locality attestation or onward-egress guarantee |

## Complexity Exposure and Structural Metrics

These are structural observations, not a usability score or measured novice
success rate. No average time-to-task claim is made.

- Settings categories: **6 before, 6 after**; four labels clarified, no new
  dashboard/sidebar/wizard. Inference Advanced is not keyboard configuration.
- Model-selection entry families: **2 before, 2 after**, both the same
  ModelDropdown and guarded transaction. Agent management: **2 access
  families, 1 manager**. Tool management: **2 compositions, 1 manager**.
  Connection configuration: **3 entry families, 1 canonical category**.
- Workspace navigation: **3 visible entry families** retained. No command
  palette promoted to the main workspace workflow.
- Ambiguous primary scope controls repaired: **4** (chat model picker, chat
  agent picker, Settings agent default, Settings startup model). Existing
  new-chat inheritance is disclosed, not silently changed.
- Management duplication introduced: **0**. Runtime/persistence/security
  subsystems changed: **0**. Identified return-path architectural dead ends:
  **0**; real native activation/scroll checks remain unperformed.
- Narrow Settings baseline: section widths **134px at 390px** and **64px at
  320px**, with **393px** internal content width. After: automated section
  width is at least **240px** and no horizontal content overflow at every
  audited width, including 280px.
- Recorded workflow structure: existing-chat switch is picker -> model
  (preparation may add review -> confirm); agent create is Settings -> Agents
  & tools -> New agent -> Save -> chat agent picker; task is Ask another
  agent -> recipient/kind/prompt -> Send task. These are action groups,
  excluding typing/search, not timed or novice click-count measurements.
- Self-hosted flow remains Add server -> address/consent -> Connect -> model
  choices -> Save models -> return -> chat model picker. No new install step;
  manual model entry remains available when discovery is incomplete.

Normal flows still expose model capability bars, context capacity estimates,
permissions and tool runtime state because they affect a real choice. Server
model Details, calibration/Optimize controls and Advanced profiles retain
technical evidence: deployed capacity, uncertainty, concurrency, revisions,
hashes, timeouts and provenance. No normal setup input was added for KV cache,
prefill or admission arithmetic. A blanket technical-term purge would hide
uncertainty and safety; remaining advanced density is F16, not silently removed.

## Privacy Clarity

| Surface | Trust signal and boundary |
| --- | --- |
| Model picker/header | Model name plus actual configured destination; known built-in provider routes say Cloud connection; missing config says Destination unknown |
| Server address | HTTP(S) loopback says Same-PC address; literal RFC1918/link-local/private IPv6 says Private-network address; other hostnames/public addresses remain location unverified |
| Unknown/DNS/proxy | No DNS lookup, network request or inferred physical location; local/private addresses can proxy onward, so label is not an egress guarantee |
| Displayed configured identity | Derived via existing model transport resolver; presentation uses origin only, excluding user-info/query/fragment/private URL path; routing itself is untouched |
| Discovery | Explicit request and metadata consent; candidates are not automatically saved/trusted; manual entry and no-results uncertainty retained |
| Fallback | Never/Ask/exact Trusted policy, destination and consent unchanged; address signal added; no automatic cloud reroute introduced |
| Native/scoped tools | Captured actor/chat/target and important arguments; exact workspace/path remains inspectable; one-time approval separate from broader grants |
| MCP | Existing explicit remote destination, native connection consent, credential references and scoped authorization retained; no local launcher falsely enabled |
| Memory and sources | Conversation-private sources stay separate from authorized workspace knowledge; source viewing never fabricates missing evidence |

## Accessibility and Layout

Production Settings/selectors/task dialog passed **10 configurations**:
1280, 390, 320 and 280px at 100% in both light/dark themes, plus a 640px
reference viewport at **200% equivalent scaling** in both themes. The latter
uses a 320x500 CSS viewport with device scale factor 2, not a claim of native
browser menu zoom. Existing U1 supplementary checks also use CSS scaling.

Assertions cover category activation via keyboard Enter, named fields/icons,
agent Save and specific edit/Escape focus return, mock Settings close, model
destination/name accessibility, model/menu/section bounds, task prompt focus,
read-only recipient payload, draft retention and A/B isolation. Settled
screenshots disable transition animations; the 280px name and destination
remain legible after capability-row wrapping.

Existing collaboration/browser fixtures cover source-focus ownership, missing
source disabled state, tools dialog Escape/focus return, effort support/locks,
approval/result association, unknown effects, stale/conflicting evidence,
long paths/errors/task/model names and 320px/200% CSS scaling in light/dark.
Existing fallback fixtures cover keyboard consent/Escape and exact destination.
Status has readable text rather than color alone. No WCAG contrast score or
screen-reader certification is claimed; changed/missing evidence was made
more legible without changing meaning.

Limitations: General/Appearance/Shortcuts/About bodies and tool manager are
stubbed in the new Settings harness; the existing U1 harness exercises the
actual tool manager separately. Composers in product screenshots are fixture
controls; U1 uses the actual composer context with a fixture textarea/buttons.
The new task harness tests the real form and constructed payload, not a live
agent. Full-shell tab order, first-run navigation, native dialogs, OS focus,
minimize/restore/restart, screen readers and native split/Stop were not tested.
Existing lint includes accessibility warnings outside changed surfaces; this
pass is not a claim that all accessibility debt is resolved.

## Verification

| Check | Actual result |
| --- | --- |
| Focused presentation/ownership group | **71 tests, 5 files passed**, including **20 new destination tests**; repeated only after concrete final TypeScript correction |
| Full `npm.cmd test` | **2,221 tests, 176 files passed**, once; subsequent edits were target-compatible array syntax and required test-fixture metadata, rechecked with focused 71 |
| `npm.cmd run check-types` | Passed after correcting unsupported array `.at()` and missing test endpoint `contextLimit`; no target/compiler relaxation |
| `npm.cmd run lint` | Passed, existing **71 warnings, 2 informational notices**, no new warnings |
| `npm.cmd run build` | Passed; existing mixed static/dynamic import warnings for customExecution, agent, transport, chatRuntime and plugin timing notice |
| `git diff --check` | Passed; staged whitespace check also required before commit |
| New `check-product-ux.mjs` | 10 configurations passed; real Settings/agent/model/task components, isolated native boundaries |
| `check-collaboration-ux.mjs` | 4 configurations passed: 1280 dark, 640 light, 320 dark, 640 at 200% CSS scale light; pane ownership/context/tools/approval/activity |
| `check-model-switch.mjs` | Passed at 1100/390: preparation lock/cancel/review/details keyboard/commit/blocked/overflow |
| `check-self-hosted-setup.mjs` | Passed controlled setup/discovery/auth/private-access/stale/manual/large-list checks; discovery stress widths 1100/390/320/280 |
| `check-inference-fallback.mjs` | Passed Never/Ask isolation, long destination, keyboard confirmation/Escape, light/dark narrow/scaling fixtures |
| Older `check-delegation-dialog.mjs` | Not passed this run: initial-dialog timeout; unchanged protected fixture. Equivalent real form/recipient/read-only submit covered by new harness, not its entire stress matrix |
| Rust gates | Not rerun: no Rust, native security, IPC or runtime changes |
| Native Tauri / live inference / human testing | **Not performed**, explicitly excluded; no Linux/macOS native UX claims |

Model-switch browser infrastructure needed its obsolete reasoning-effort mock
updated and an isolated Vite cache/watch configuration; no guarded-switch
assertion was removed. Browser caches/screenshots stay outside tracked source.
Owned fixture servers/browsers are closed; unrelated user processes were not
terminated. Source Control, terminal, workspace navigation, persistence,
attachments, PeerTasks and security behavior were not edited; their existing
automated tests are included in the full suite. They were **not** claimed as
native/browser full-shell interaction passes.

## Human Validation: 10-15 Minutes

Use synthetic projects/conversations, a fixture or an already configured safe
test connection; no secrets, billing, downloads or installations. Recruit
nondevelopers as well as developers. Ask participants to think aloud, offer no
navigation hints, and record wrong turns rather than rescuing immediately.

1. **2 minutes:** "Start a chat, then find the chat you used earlier." Ask which
   model answers and where it runs. This probes AI Chat/history/Settings
   discovery, not whether the participant memorized a manual.
2. **2 minutes:** "Keep this chat but continue with another model. What else
   changes?" With two existing chats, ask whether the second and future chats
   are affected. Probe preparation and connection versus model understanding.
3. **3 minutes:** "Use the Reviewer to inspect this work. Find its task and
   result." Ask what Agent means, what happens when clarification is shown,
   and where work continues after closing the pane.
4. **2 minutes:** Show a synthetic file approval and source-changed card.
   "What would you check before allowing this? Where did this claim come
   from?" Probe filename/full path/diff/one-time versus broader permission.
5. **2 minutes:** "If the local server goes offline, ask before sending this
   conversation to that cloud model." Have them explain same-PC/private
   network/unverified/cloud and Ask versus Trusted in their own words.
6. **1-3 minutes:** "Return to your draft." Ask which controls felt misplaced
   or overwhelming, whether Sources & context made sense, and where they
   expected advanced configuration. Do not ask a leading "Was it intuitive?"

Remaining human-only questions: natural chat/task/settings discovery, Agent
versus Model comprehension, control overload, perceived privacy/reassurance,
source-summary understanding, same-conversation switching, clarification
responsibility, permission risk judgment and return-to-work expectations.
Actual native focus/diff/split/Stop/minimize/restart acceptance needs a separate
authorized native session; this report does not convert deferred checks into
passes or start another feature roadmap.

## Scope and Handoff

Only this audit, presentation helpers/components and focused browser/test
changes are staged for `fix(ui): simplify core AI workflows`. No roadmap
checkpoint was reopened. Protected delegation components/stylesheet, unrelated
dialogs, Source Control, terminal, safety stashes and `autonomous_tracker/`
were not modified, reverted, staged or cleaned. Main began clean at the base,
16 commits ahead of origin. Nothing is pushed by this pass. Stop after the
audit commit; observations above are validation limits, not a new roadmap.
