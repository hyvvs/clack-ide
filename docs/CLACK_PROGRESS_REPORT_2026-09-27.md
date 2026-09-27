# Clack Progress, Features and Remaining Work

Date: 2026-09-27

Implementation baseline: `ffd874d feat(ai): clarify reasoning and agent activity`

Repository: [hyvvs/clack-ide](https://github.com/hyvvs/clack-ide)

## Executive Summary

Clack now combines its native IDE and terminal workspace with independently
owned conversations, multiple saved models, durable context memory, controlled
project knowledge, evidence retrieval, safer model switching and task-scoped
multi-agent collaboration. The latest checkpoint makes agent activity and
returned provider reasoning inspectable without claiming access to hidden reasoning.

Two programs must be distinguished:

- **Multi-model/multi-agent foundation:** all eight phases, 0-7, complete.
- **Self-hosted inference and advanced intelligence:** 16 of 32 ordered
  checkpoints complete, through R1. The next checkpoint is **R2: Functional
  reasoning effort**, which has not started.

This is a substantial implemented foundation, not a claim that the entire
roadmap or release acceptance is complete. Half the checkpoint count does not
mean half the engineering effort. Cross-feature quality evaluation, additional
native UX verification and final real-provider/hardware acceptance remain ahead.

The [authoritative implementation plan](AI_SELF_HOSTED_INFERENCE_PLAN.md)
contains checkpoint contracts, dependencies, rollback instructions and detailed
test records. This report summarizes those records and Git history; it does not
replace them or reopen completed checkpoints.

## Existing Application Foundation

Clack is a Tauri 2, Rust, React 19 and TypeScript IDE/agent application forked
from Terax. Its existing working surfaces include:

- Real native PTY terminals in a bottom dock, with tabs, splits, shell working
  directories and Windows/WSL support, rather than simulated terminal output.
- A central editor workspace, file explorer, Markdown and web previews, source
  control, diffs and Git history.
- Workspace switching, visible workspace/breadcrumb navigation, themes,
  backgrounds and editor preferences.
- Optional BYOK and local/compatible-model AI, attachments, tool approvals,
  proposed edit diffs and background agent execution.

These are the application foundation, not features all newly introduced by R1.
The advanced program extends existing stores, native authorization and runtime
owners rather than replacing the IDE, terminal, provider stack or task scheduler.

## Completed Multi-Agent Foundation

The [earlier implementation plan](AI_MULTI_AGENT_BUILD_PLAN.md#status-ledger)
records these completed phases:

| Phase | Achievement | Commit |
| --- | --- | --- |
| 0 | Preserved the known-good AI runtime baseline | `e427a4b` |
| 1 | Stable saved-model identity and migration | `8af9b12` |
| 2 | Multiple saved models per provider in settings and selection | `08d079c` |
| 3 | Conversation-owned agent, model and workspace identity | `09ca89c` |
| 4 | Per-session runtime isolation and background execution | `c865027` |
| 5 | Durable delegation and review through PeerTask | `61f0363` |
| 6 | Concurrent mutation isolation and conflict handling | `cc6c310` |
| 7 | Integrated UX, migration audit and recorded release verification | `cb9d081` |

The additional `5415e5d` model-switch safety checkpoint introduced shared
compatibility/context checks, unsettled-run selection locks and truthful
selected-model display. Its recorded 879 tests in 105 files are historical
evidence, not the current suite total. Completion of this older program does
not stand in for the advanced program's pending Q1/Z acceptance.

## Completed Advanced Checkpoints

### Self-Hosted Setup and Request Safety

| Checkpoint | Implemented achievement | Commit |
| --- | --- | --- |
| A1 | Persistent endpoint/profile identity with evidence and overrides | `1884e3b` |
| A2 | Bounded authenticated backend handshakes | `53a67d2` |
| A3 | Server setup, endpoint/model bindings and capability-aware routing | `48cba84` |
| D1 | Native request lifecycle, cancellation and truthful timed states | `aa7e125` |
| E1 | Shared endpoint inference admission, including PeerTask use | `6d7285e` |
| B1 | Shared actual-request context-budget preflight | `460465a` |

Endpoint knowledge is evidence-based rather than guessed from model or server
names. Configured endpoints and models retain distinct identities. Request
lifecycle and admission are shared by existing execution paths, so independent
chats do not each assume exclusive endpoint capacity.

B1 remains the authoritative request-size boundary, accounting for prepared
messages, tool schemas, attachments and output reserves. Memory, retrieval,
switching and collaboration do not bypass it. Local cancellation is not a
guarantee that a remote server has stopped GPU computation. Automatic calibration,
network discovery and consent-bound fallback are still separate pending work.

### Durable Conversation Memory and Compaction

**C1a, `e2f6a39`: durable conversation memory foundations.** Memory belongs to
the stable session, not its title, pane, agent or model. Original messages and
attachment references remain the source of truth. Existing session persistence
uses a native atomic adapter; derived memory is additional, not a duplicate
chat database or a destructive transcript summary.

Schema-1 manifests and immutable hash-addressed revisions retain source
revisions, coverage, evidence, typed claims, producer identity and revision
lineage. Records are bounded to 256 KiB, with up to 32 retained revision hashes.
Evidence uses the existing attachment content store and retention reconciliation.
Native compare-and-swap checks reject stale, cross-owner or cancelled publication;
restart loads committed state rather than resuming an unfinished model request.
Corrupt memory remains distinguishable from usable evidence and leaves original
conversation history intact.

**C1b, `a90221f`: bounded automatic context compaction.** The existing agent
preparation path can extract source-linked structured memory as context grows.
The implemented policy triggers at 70% and targets 55% of the applicable working
budget. Small fitting chats incur no memory-read or extraction-model call.
User/system messages, required attachment context, unresolved tool groups and
a recent coherent tail remain protected. If mandatory content cannot fit, the
request blocks instead of silently discarding it. Working context changes;
the persisted original transcript does not.

**G1a, `3808693`: original conversation evidence retrieval.** Bounded automatic
retrieval can recover relevant original evidence from the same conversation.
It does not authorize browsing another chat. This supplies a path back to
original evidence when derived memory is insufficient, without introducing an
embedding database or global private-history index.

### Authorized Project Knowledge and Freshness

**M1, `ffe61ee`: scoped project-memory ownership.** Project memory is separate
from private conversation memory and belongs to an authorized canonical workspace
and checkout. Sharing requires an explicit bounded proposal and native user
confirmation. Only the selected evidence slice is published, not adjacent private
messages or a whole conversation. Model, agent and chat-title changes do not
change project ownership.

Published records retain source message/tool/task/artifact provenance, qualification,
consent, conflict and supersession relationships. Pending proposals remain private
to their source conversation. Agent-supplied approval flags do not grant publication
authority. Native authorization is rechecked; an ID alone never grants access.
Atomic immutable revisions preserve recoverable previous state. Unknown or moved
workspace roots are not silently mapped to another project.

**M2, `0402099`: project evidence freshness.** Additive schema-2 project snapshots
can retain explicitly selected file dependencies, canonical identities, full-content
hashes, immutable excerpts and declared environment/Git evidence. Current, stale,
invalidated, missing, conflicting and superseded states stay distinct.

Existing filesystem events mark relevant dependency closures dirty; bounded
revalidation hashes selected content, including same-mtime edits and untracked
files. Restart requires revalidation rather than trusting an old advisory cache.
There is no idle full-repository scan or silent semantic conflict resolution.
Hashes establish content identity, not the truth of a claim or proof that tests ran.

**G1b, `639542d`: scoped project and task evidence retrieval.** Authorized shared
project knowledge and task evidence become bounded retrieval sources with scope,
provenance and freshness checks. This remains separate from G1a's private
same-conversation retrieval and does not create cross-workspace/global fallback
search. Existing permission and B1 context limits continue to apply.

### Safer Model Switching

**C2, `2816065`: Optimize and switch.** Existing model selectors use one shared
coordinator to prepare target-sized context and commit the selected model and
matching target view atomically. Conversation identity and original history stay
unchanged. Captured capabilities, instructions, source hashes, tools, permissions
and budget evidence determine whether a target view is valid and reusable.

Deterministic fitting is attempted first. When extraction is necessary, explicit
confirmation authorizes use of the conversation's current configured model.
Cancellation, source changes or stale preparation cannot publish a mismatched
selection/context pair. Active and draining runs retain their selection locks.
Unsupported attachments or oversized mandatory context still block switching;
optimization is not a way around compatibility or B1 safety.

### Task-Scoped Collaboration

**H1, `e57deb7`: scoped peer clarification.** Durable PeerTask communication
supports clarification requests/responses, findings, blockers, review messages,
dependency updates and notes. Routing follows authorized task relationships,
not arbitrary chat IDs or a global agent inbox. Sender, recipient, run, workspace,
source and delivery provenance persist through the existing task ledger.

Communication is bounded: 4 KiB text, eight evidence references, 32 events per
task, one outstanding question, two clarification rounds per task, four per root
and a ten-minute timeout. Continuation uses existing settled-run boundaries and
scheduling. Ambiguous interrupted work is not automatically replayed after restart.

**H2, `9bb58aa`: recipient-aware evidence handoffs.** Handoffs account for the
recipient's actual model, instructions, permissions, history, attachments and B1
budget. If a safe package does not fit, preparation refuses it instead of silently
copying private history or invoking an unrelated summarizer.

Prepared receipts identify recipient and source evidence. Review/correction flows
bind to artifact, patch and result identities; revalidation prevents a changed
file or task result from masquerading as the reviewed one. Explicit result-excerpt
promotion still uses native consent and project verification. These are foundations
for coordinated work, not a claim that multi-agent results are automatically correct.

### Truthful Reasoning and Activity

**R1, `ffd874d`: chronological source-linked activity.** The chat now has a compact,
collapsed activity timeline derived from real messages, captured runs and authorized
PeerTask records. It distinguishes assistant progress, returned reasoning, runtime
phases, tool requests/results/approvals, retries, cancellation and collaboration.
Requesting a command or write is not displayed as successful execution.

Additive `clackActivity` message metadata preserves captured ownership and bounded
receipts through existing session persistence, without a new database or model
request. Limits are 512 receipts and 128 KiB per assistant message; excess receipt
counts remain explicit. Open timelines use 40-event pages and bounded scrolling.
Original final answers and actionable tool cards remain visible.

Provider output is labelled according to actual adapter evidence: summary,
returned reasoning content, or format unspecified. Ordinary prose, token counts
and model names do not become invented reasoning. Encrypted/redacted content and
signatures are not exposed. Known sensitive patterns are redacted and raw command
arguments/tool payloads withheld; this is not exhaustive secret detection.
R1 presents output only. Functional reasoning-effort controls belong to R2.

## Reliability and Development Fixes

- **`7747cce`, window close and stylesheet scanning:** the existing shutdown
  handler prevented normal close before requesting window destruction, but its
  required Tauri destroy permission was absent. The fix granted that capability
  and bounded Tailwind source scanning. Its commit records a native dev launch
  and the user's confirmation that the X button closes the window, separately
  from automated capability/compiler regression tests.
- **`7371f7c`, startup and early memory manifests:** Vite watching was scoped to
  relevant frontend/assets/scripts/configuration, avoiding unrelated projects
  and native build output. Recorded frontend CPU profiles improved from about
  99 seconds to 7-17 seconds, including isolated cold caches. These are profiling
  observations, not a universal or native-window launch-time guarantee.
- The same isolated fix recovers only qualifying source-only schema-1 memory
  manifests lacking a revision counter. It retains strict identity/history
  validation and does not silently repair arbitrary corrupt revision history.

## Verification and Evidence Boundaries

The latest implementation verification is R1's recorded result, not a new test
run performed for this documentation-only report:

| Check | Recorded result |
| --- | --- |
| Focused R1 activity, adapter, SDK stream, persistence/recovery and switching tests | 130 passed in 9 files |
| Full frontend suite | 1,558 passed in 142 files |
| TypeScript check | Passed |
| Lint | Passed; established 71 warnings, 2 informational notices, 0 errors |
| Production build | Passed; existing mixed static/dynamic import and plugin-timing notices |
| Whitespace check | Passed; normal Git CRLF conversion notices |
| Browser interaction/visual checks | Passed at 1100px, 390px and 280px; screenshots inspected |
| Most recent recorded Rust gate in this checkpoint sequence | H1: 504 tests, comprising 454 library, 25 filesystem and 25 Git; fmt and strict Clippy passed |

Browser checks covered keyboard disclosure, 122-event pagination, source navigation,
redacted full provider output, bounded scrolling, visible final answers and no
horizontal overflow/page errors. Actual installed provider adapters were exercised
with mocked HTTP fixtures. Native persistence was mocked at IPC in R1 integration
fixtures. R1 made no Rust implementation changes and did not rerun Rust gates.

No R1 native GUI session, actual Clack restart or live-provider inference was
performed. Earlier native/user observations above are specific to their fixes,
not evidence that all current flows pass on every platform. Automated test volume
does not establish semantic memory fidelity or flawless agent collaboration.
Q1 and Z explicitly own the remaining integrated quality and hardware evidence.

## Remaining Implementation, in Authoritative Order

Every item below is pending. Full acceptance and rollback requirements remain in
the [checkpoint definitions](AI_SELF_HOSTED_INFERENCE_PLAN.md#checkpoint-order-and-gates).

| Order | Checkpoint | Work and key boundary |
| --- | --- | --- |
| 17 | R2: Functional reasoning effort | Resolve evidenced supported levels, capture per-chat/model choices and map exact adapter request fields with B1 reserves; never invent support. |
| 18 | T1: Tool definitions and authorization | Versioned definitions, validated schemas, visible review/assignment/revocation and scoped persistence; unsupported executable kinds stay inactive. |
| 19 | T2: Guarded tool execution | Reviewed native/HTTP bindings, real approval-aware tests, bounded results, timeouts and cancellation; no arbitrary scripts or MCP processes yet. |
| 20 | T3a: Native confinement | Enforce process/filesystem/secret/egress boundaries and test escapes/cleanup; unsupported platforms remain explicitly blocked. |
| 21 | T3b: Confined scripts/functions | Execute reviewed immutable code/argv versions through T3a; no automatic dependency installation or in-process plugin evaluation. |
| 22 | T3c: Scoped MCP tools | Explicit local/remote connections, bounded discovery, schemas, consent and lifecycle; local confinement is not a claim that remote services are sandboxed. |
| 23 | F1: Efficiency with policy parity | Relevant permitted schemas, compact prompt experiments and scope-safe caching, with repeated B1 checks and measured correctness/security parity. |
| 24 | D2: Safe length continuation | Finish-aware bounded continuation and stitching; never execute incomplete tool JSON or replay completed effects. |
| 25 | D3: Partial-stream/offline recovery | Extend existing recovery for disconnects, retries and partial output without duplicate text/tools or an independent retry loop. |
| 26 | E2: Calibration | Bounded passive observations/recommendations and optional synthetic optimization through the shared scheduler; preserve user pins. |
| 27 | F2: Watchdogs and controls | Detect pathological output/loops while preserving legitimate code; improve health/Advanced UI with truthful limits. |
| 28 | U1: Integrated collaboration UX | Bring context, preparation, tasks, custom tools and effort together; verify native narrow panes, 200% zoom, keyboard/accessibility and visible workspace flows. |
| 29 | G2: Optional discovery | User-initiated bounded server discovery, cancellation and selection; no silent network scans or credential-bearing probes. |
| 30 | G3: Trusted fallback | Destination-specific consent, safe request-boundary routing and compatibility/budget checks; unknown effects block unsafe rerouting. |
| 31 | Q1: Integrated quality | Reproducible evidence/fidelity/freshness/collaboration corpus and adversarial scenarios, with real small-model results distinguished from fixtures. |
| 32 | Z: Final integration/handoff | Native GUI, real providers, localhost/LAN hardware, platform regressions and acceptance documentation; no automatic release publication. |

## Next Step and Stop Boundary

The exact next implementation task is **R2: Functional reasoning effort**. It
depends on completed R1 and B1. Its acceptance must verify exposed options against
serialized provider requests, output reserves, independent conversations, model
switching and immutable active-run capture. Unknown support must not produce
guessed wire parameters.

This update documents existing achievements and remaining work only. It does not
implement R2, custom tools, MCP, automatic fallback or any later checkpoint, and
does not publish a packaged release.
