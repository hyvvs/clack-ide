# Multi-Agent Coworking Acceptance

## Status

**Controlled acceptance complete, with the limitations below.** Base is
`6d770ec767c173ffcc4b0a999e4da36b2d568aea` on `main` (28 commits ahead of origin
at the start). This is an implementation/acceptance record, not a release claim.
Native GUI interaction and Computer Use are explicitly excluded by the user.

## Evidence Classes

- F: composed real temporary filesystem/Git/loopback workflow.
- D: deterministic runtime tests; mocked boundaries must be named.
- B: headless browser fixtures, not native GUI acceptance.
- N: native Rust commands/backend on the host actually tested.
- L: live provider/local server; not implied by a controlled protocol server.

## Production Ownership

The inventory and independently pinned CoS comparison are in
`COS_COMPARATIVE_AUDIT.md`. Existing session, memory, tool exposure, preflight,
task ledger, dependency graph, admission and review/write owners remain the
production architecture. No CoS code was copied.

## Composed Native Harness

`scripts/check-coworking-native.mjs` builds the test-only Rust example
`src-tauri/examples/coworking_acceptance.rs`, starts an owned Vite server and a
controlled loopback OpenAI-compatible protocol server, and loads
`coworking-acceptance.html` invisibly. `src/test/coworkingAcceptance.tsx` uses
the real Chat SDK, chat runtime, task coordinator, handoff, queue/Agent bridges,
native IPC, HTTP admission/preflight, session/memory persistence, workspace
authorization, attachment store and Git commands. No production function is
mocked or replaced in this harness.

All app data and WebView storage are redirected to the owned temporary root.
Windows Known Folders do not honor APPDATA redirection, so the test-only Tauri
context uses an absolute temporary identifier for app-directory joins. An
assertion verifies isolation before loading the fixture. The native child has a
filtered environment and no credential/keychain command routes. The example
has no production entry point. Only loopback URLs are permitted by its launcher.

The fixture creates a real Git repository with config, README, architecture
notes, source, a failing test and an obsolete/corrected requirement. It verifies
a 16k team mission, 50 mixed sequential tasks and 12 parallel/queued tasks. The
controlled responses are protocol fixtures, not evidence of real-model coding
quality. Native GUI controls are not used. No Linux/macOS native run is claimed.

Ignored reports are under `src-tauri/target/coworking-report/`. Failed reports
are diagnostics, not passed scenarios. The launcher cleans only its own server,
native child and temporary files. Production build entries are unchanged.

## Reproduced Defects And Corrections

| Finding | Owner and correction | Current evidence |
| --- | --- | --- |
| Active count excluded live clarification work | Dispatcher counts durable active states independently of attention grouping | New focused regression passes |
| List rows called capacity waits Running | Shared live status hook checks captured task/run ownership; queued/admission, approval, preparing and applying are distinct | Pure phase regressions, actual capacity barriers and browser matrix pass |
| Lifecycle timestamps absent | Locale-specific second-level Created/Started/Ended/Archived from persisted numeric events | Serialization/format/browser regressions pass; numeric task records survive native restart |
| A handoff policy checksum became a missing G1a source | Unlabelled hashes become anchors only with owned-source proof; explicit missing anchors still reject | Native repeated workflow reproduced it; focused retrieval regressions pass |
| Incidental tool-description ties broadened a clear read intent to the full schema set | F1 ranks task objective rather than handoff control metadata; full fallback is retained for truly undifferentiated ties | 48 focused exposure tests pass, including 100 incidental tools and current-request schema headroom |
| Finished machine handoffs acted like permanent human requirements | Code-owned handoff message ID plus exact receipt, owner/result and terminal-state proof qualify historical working context; human/pasted/legacy/active/failed/attachment/pending-effect messages remain protected | 9 focused ownership tests pass; native original/working diagnostics verify projection without transcript edits |
| Arbitrary four-message extraction chunks could exhaust four calls on modest history | Source batches use existing input/evidence bounds plus an output-aware claim allowance; four-call/generated-token ceilings remain | Focused bounds and complete long native cohorts pass |
| Optional evidence omission preamble caused a false B1 block | Use a bounded notice only for automatic optional evidence without issues or required chunks; mandatory/explicit evidence still blocks | New red/green scoped regression; 19 scoped tests pass |
| Starting a child invalidates the source's native G1b collection | Capture/revalidate the actual candidate source task set, preserving active dependency authorization; display timestamps/archive state are not material evidence | 21 native scoped retrieval tests pass; native Architect proceeds through real child dispatch |
| Removed completed worktree denies immutable patch retrieval | Validate captured change-set base SHA when the checkout is gone; exact task/hash/content provenance remains required | Native patch retrieval and principal re-review pass |
| Next worker inherits a removed checkout | Only a running captured run supplies working checkout/Agent/environment; idle preparation uses its current conversation profile | 50 chat runtime tests plus native idle-checkout regression pass |
| A confirmed workspace write invalidates the next step's file evidence | Reserved successful built-in write receipt permits bounded file-observation refresh; the captured ownership/Git/task identity stays sealed | Focused confirmed-write/identity tests and actual correction run pass |
| Relative delegated attachment path resolves against native launch cwd | Resolve against captured workspace root/environment before canonicalization; retain immutable original source references | 67 attachment/artifact/coordinator tests passed before the later source-ownership additions |
| Warm handoff sizes the entire transcript despite valid durable memory | Reuse C1's actual verified revision and compaction planner, with protected originals and current target limits; no hidden extraction call | 57 handoff tests passed before the later idle-source tests; repeated native cohort passes |
| Cached optional G1a groups become mandatory after a tool step grows | Resize only whole optional groups at each B1 attachment, keeping anchored/unresolved evidence pinned and publishing omission state | Focused red/green retrieval tests; long native read cohort passes |
| Late React snapshots overwrite newer durable history | Reject superseded SDK message-array snapshots when scheduled and when flushed; no per-token full serialization | Two reproduced regressions now pass in the 50-test runtime group |
| Live output appended during extraction invalidates a still-exact original prefix | Explicit native append-only rebase verifies complete prefix hash/count, same owner/profile/run epoch, previous revision and generation relation; bounded two rebases retry only persistence/source reads, not model calls | Two native tests cover successful append and seven denial classes; coordinator rebase regression passes |
| Native JSON reconstruction changes budget identity | Canonical object-key serialization, retaining all actual pin/endpoint/effort values and array order | 51 budget/preflight/target tests pass; original red native settings rejection resolved |
| A modest recipient spends its remaining room on optional schemas | Optional allowance is capped by the lesser of 25% of target ceiling and half current remaining input space; required and uncertain exposure remain intact | Actual 8k bounded team passes with explicit 512-token output pin |
| Idle source keeps its old Agent/model and collaboration chain | Capture the active source run only while running; independent idle requests use current profile and a new root, unless explicitly following/retrying | Four reproduced regressions and old-terminal handoff checks pass in the 150-test ownership group |
| Extraction validates old file evidence before the successful-write refresh | Refresh confirmed built-in write observations before extraction transport; task/Agent/model/workspace/Git identity remains sealed | Red/green regression and all ten actual mixed edits pass |
| Rebase succeeds but an append arrives before the following CAS | At most two verified append rebases per operation, eight total per compactor; source read/commit only, never extraction replay | Reproduced inter-IPC race regression and complete native cohort pass |
| Bounded compaction blocks a fitting request solely because it missed the ideal 55% target | After four chunks, continue only with B1 fit and at least the existing 30% headroom; otherwise retain the honest block | Exact headroom boundary regression passes; four-call ceiling unchanged |
| Generic handoff source metadata pins every completed claim | Rank memory relevance from the actual task objective; page only optional completed claims in the next derived revision | Fifty mixed plus fifty additional reads complete; ten-cycle 8k/16k facts tests pass |
| Completed derived claims fill extraction metadata indefinitely | Carry user requirements, unresolved/contradicting/relevant claims and the existing bounded optional page; retain original evidence/coverage and prior valid revisions | Original histories survive native restart; finite 64-claim/128-evidence bounds remain |
| Shared live label loses terminal cancellation/outcome detail | Preserve established terminal outcome labels, while active/applying work uses exact live ownership | Task-card/Dispatcher regressions pass, including descendant cancellation counts |
| Cancelling background work drops its final activity-only SDK message | Persist the stopped SDK snapshot directly after drain, also at shutdown; stale React snapshots still cannot overwrite it | Red/green cancellation regression; second native process compares retained originals successfully |
| Provider unavailable errors are called missing artifacts | Artifact error heuristics require artifact/attachment/immutable-content context; typed package errors remain authoritative | Two provider-failure classification regressions pass |

Harness setup errors found and corrected are not counted as production defects:
Windows app-data isolation, an incorrect settings export, normal settings
initialization before native CAS, streaming versus non-streaming fixture replies,
and selecting the authorized source workspace. An accidental schema helper edit
was corrected before proceeding; it is not an original product finding.

## Focused Verification History

These are focused runs, not additive unique-test totals:

- Dispatcher navigation: 16/16 after 3 newly reproduced regressions.
- Conversation retrieval: 51/51 after the checksum regression.
- Exposure + retrieval + Dispatcher: 113/113 across 3 files.
- Peer history + exposure + compaction + handoff runtime + coordinator:
  162/162 across 5 files (before the latest source-batch adjustment).
- Compaction + peer history: 28/28 after output-aware source batching.
- Scoped evidence + compaction + peer history: 47/47 across 3 files.
- `cargo check --example coworking_acceptance --locked --target-dir
  target/codex-test`: passed on Windows with escalation for build resources.
- `npm.cmd exec tsc -- --noEmit`: passed after mission imports were used.

Two intermediate successful native runs completed the 16k research/edit/review/
correction/re-review/aggregation/Apply mission, 50 sequential read-only tasks and
12 worker tasks: 52 scenarios, 67 durable tasks, 200 native HTTP requests and
maximum endpoint inference concurrency 1. The stronger second run used a real
capacity barrier, verified immediate durable visibility and Dispatcher Active=12,
and executed the Node test against the actually applied workspace file. These
are not the requested mixed-50 result.

The final expanded run passes: **64 composed scenario entries, 135 durable
tasks, 301 actual native HTTP requests**, peak endpoint concurrency **1 at
capacity 1 and 2 at capacity 2**. It completes **50 mixed successful
delegations**, then **50 additional read-only delegations**, **12 workers**,
four capacity-two workers, clarification, dependencies, immutable review,
correction, real Apply and native Source Control commits. The 503 attempt and
its successful explicit Retry remain distinct records. Intentional 4k capacity,
503 and post-write failures are not counted as successful delegations.

Before restart: **128 completed, 3 failed, 3 cancelled, 1 running**. A second
real native process restores all **135 tasks and 20 conversations**, preserving
completed task records and compared original messages; the held running task
becomes `peer_task_interrupted` with recovery. Repeated hydration is idempotent
and sends **zero new inference requests**. All **13 acknowledged filesystem
write call IDs are unique** in restored history: twelve Coder edits/writes plus
the deliberately failed worker's staged write. The applied Node test passes.

Captured traffic contains **283 streaming requests and 18 local extraction
requests**. All 269 worker streaming requests, including same-Agent Architect
workers, are checked retrospectively against the private-parent canary: **zero
leaks**. The fixture's ongoing assertion identifies workers by handoff ownership,
not Agent name. The 4k greeting exposes zero tools; 8k bounded reads expose at
most four; the main 16k mission/cohort exposes at most nine schemas (8,305 bytes),
not the entire catalog. These are actual wire counts/bytes, not provider tokens.

The supplemental `--small-team` native run passes **5 scenario entries, 10
tasks, 35 HTTP requests**, peak concurrency 1. The 8k Coder reads real config
and source, edits one function in an isolated checkout and returns a real patch.
Its fresh 8k Reviewer correctly blocks required evidence: estimated input
**6,984**, output **512**, safety **699**, ceiling **8,192** (three tokens over).
Breakdown: system **3,295**, schemas/options **944**, conversation **2,745**,
including retrieved required evidence **1,393**. No requirement or reserve was
removed. An explicit new verification with a **16k local Reviewer** checks the
same immutable patch and permits real Apply. The blocked 8k record is retained;
an identical repeated request remains denied by the existing duplicate guard.
This is not claimed as a successful all-8k editing/review team.

The focused collaboration browser matrix passed at 1280/390/320/280px and
640px with 200% scaling, light/dark, including pane-bound drafts/attachments/
approvals/Stop, context integrity, provenance, clarification, keyboard and
dialog focus, and long-content overflow assertions. Native GUI is not implied.

## Roadmap Cross-Check

| Area | Existing owners to exercise | Pass status |
| --- | --- | --- |
| A1-A3 / G2 | Exact local endpoint identity, probe/cache/discovery and unknown capabilities | F/N explicit native profiles; D adapter/probe/identity failures; B setup/discovery. No real engine discovery claim |
| E1/E2 | Capacity 1/2, model loading, output/reserve/calibration pins and no hidden warm-up | F/N real admission barriers at 1/2; D calibration/OOM/failure/pin tests; B controls. No GPU/throughput claim |
| B1 / F1 | 4k/8k/16k/32k/128k wire costs, required/optional schema bounds, 100+ tools | F actual routes/bytes and honest overflow; D 100-tool selection, wire preflight, capacity/canonical identity regressions |
| C1a/C1b / C2 | Durable originals, 10 compaction cycles, exact corrections, model switching, interrupted preparation | F/N 18 extraction calls/restart, idle source switch; D ten cycles each at 8k/16k and real SDK target-switch preparation with mocked native persistence; B switch controls |
| G1a/G1b / M1/M2 | Same-chat retrieval, authorized project/task evidence, conflicts/freshness and canaries | F/N actual immutable patch/dependency retrieval and canary; D/N missing/corrupt/material source/permission/workspace failures; B stale/conflicting source inspection |
| H1/H2 | Explicit task communication, clarification, dependencies, review/correction, bounded handoff | F/N full 16k mission and mixed clarification/dependency/review; D communication bounds, stale routing, cancellation/deletion and conflict tests; B provenance/navigation |
| PeerTask lifecycle | 50 mixed sequential and 12 parallel/queued, same/distinct Agents, immediate visibility, no wrong-owner/duplicate/orphan work | F/N 50 mixed + 50 reads + 12 workers + capacity-two; 128 exact-owner completions, unique effects, safe Retry, archive/restore/clear/restart |
| R1/R2 / U1 | Live phases, seconds, panes/drafts/attachments, activity/effort, keyboard/focus/navigation | F live queue/count; D actual run ownership and timestamp serialization; B pane targeting/activity/effort/keyboard and 280px/200% layouts |
| T1/T2/T3a-b-c | HTTP/WASI/MCP scope, consent, approval, destination, bounded results and effect receipts | Existing D/N scoped HTTP/WASI/MCP suites pass in full gates; B custom tool/MCP approvals/results. Not custom-tool execution through this principal PeerTask mission |
| D1-D3 / F2 | Cancel live phases, free capacity, length/partial recovery, watchdog, restart no replay | F generating/first-output/queued cancellation and immediate capacity reuse, second-process recovery; D/N preparation/approval/tool/length/partial/watchdog/ambiguous-effect regressions; B controls |
| G3 | Never/Ask/Trusted fallback and zero unconsented cloud inference | F all captured inference/extraction local, no cloud credentials; D exact consent/route/privacy/effect safeguards; B pane-owned consent. No live cloud request made |
| Q1 / product regression | Integrated chaos, workspace chip/breadcrumb/explorer, terminal and Source Control | D quality/integration failure corpus and full regressions; N real Git/worktree/FS suites; F reviewed Apply/stage/commit; B workspace navigation/terminal/Source Control fixtures |

Required browser widths are 1280, 390, 320 and 280, plus 200% equivalent scaling,
light/dark/custom backgrounds and long/many-task content. Existing browser
fixtures remain supplementary and must be rerun only when their affected
presentation state is stable.

## Hard Acceptance Criteria

Every row below has controlled evidence; this is not live-model certification.

| # | Invariant | Evidence |
| --- | --- | --- |
| 1 | Fifty sequential delegations | F mixed-50, all successful, distinct task IDs |
| 2 | Parallel isolation/visibility | F twelve immediate records, exact-owner results, B pane isolation |
| 3 | Benign handoff churn | F sustained cohorts; D/N selected-source and display-change regressions |
| 4 | Material changes fail closed | D/N Agent/model/workspace/permission/dependency/source/CAS tests |
| 5 | Immediate Dispatcher ownership | F assert immediately after each request; B task routing/focus |
| 6 | Truthful live phases | F capacity waiting; D captured run checks; B shared live labels |
| 7 | Second-level timestamps | D numeric serialization/format; F completed records survive restart; B rendered Created times |
| 8 | Clarification/dependencies/review/correction | F actual mixed clarification and complete primary review loop |
| 9 | Real reviewable/applicable edits | F ten generated files, corrected timeout, immutable artifacts, real Apply/test |
| 10 | Safe Retry/no ambiguous replay | F intentional read failure/new Retry, staged write failure/denial; D/N unknown effects |
| 11 | Private isolation | F all 269 worker requests inspected including same-Agent workers; D/N project/workspace boundaries |
| 12 | No duplicate effect/wrong owner/orphan execution | F 13 unique acknowledged write IDs, exact captured completion owners, drained owned native hosts; D/N effect/lease/recovery tests |
| 13 | No silent cloud | F owned loopback requests, keychain routes/credentials absent; D G3 policies |
| 14 | Recipient-sized handoffs | F per-target profiles, 4k honest block, 8k task/coding and required-review block; D H2/B1 |
| 15 | Small-context schema bounds | F 4k zero tools, 8k 2-4 schemas; D 100-tool pressure/mandatory pinning |
| 16 | Safe automatic context preparation | F 18 local extraction calls plus evidence retrieval; D thresholds/budget and race fixes |
| 17 | No mandatory loss | D/N protected originals, exact requirements, unresolved/contradictory evidence and actual B1 overflow |
| 18 | Durable full history | F second native process restores 20 conversations/135 tasks; D/N original hashes/coverage/provenance |
| 19 | Endpoint capacity respected | F controlled barriers: peaks 1/2 at respective capacities; N admission tests |
| 20 | 16k team mission | F research/edit/review/correction/re-review/aggregation/Apply with real disk verification |
| 21 | Useful 8k work | F bounded research/review and real isolated function edit; full immutable review's measured limit disclosed |
| 22 | Bounded outputs/source evidence | F 60,000-line file returns requested two-line window; immutable native patch/artifact store; D/N quotas/integrity |
| 23 | Long work under pressure | F mixed-50 then read-50 without manual token resets; D ten cycles each at 8k/16k |
| 24 | Safe model identity | F idle source 16k/32k/16k and independent 32k/128k recipients; D captured-run/target-switch tests |
| 25 | Restart/no replay | F actual second process, unchanged transmission count, interrupted task not revived; D/N external-effect recovery |
| 26 | Dispatcher matches runtime | F Active=12/4 and exact capacity phase; B task/cards/Previous/Next/archive/clarification; D ownership/timestamps |
| 27 | Independent CoS investigation | Pinned source audit with KEEP/ADAPT/REJECT and licensing, no copied code or new runtime |

## Final Gates And Browser Evidence

- Focused composed/context/security regression group: **301 tests / 11 files**
  before the last cancellation/card additions. Subsequent focused runtime/
  coordinator/recovery group: **102 / 3**; cards/navigation: **31 / 2**;
  compaction: **25 / 1**, including ten cycles each at 8k and 16k. These counts
  overlap and must not be summed.
- Full frontend: **2,617 passed / 193 files**, `npm.cmd test -- --maxWorkers=2`.
  The first full run exposed three card assertions and a terminal-label defect,
  corrected and focused-tested. A later concurrent build/native/full-test run
  timed out the existing 15-second large-switch fixture; it passes unchanged
  in isolation (1.61s) and in the lower-contention final full run. No deadline,
  assertion, B1 limit or security check was weakened.
- Full Windows Rust: **645 passed** (**592 library, 25 FS, 25 Git, 3 real-world
  acceptance**), no failed/ignored tests. `cargo test --locked --target-dir
  target/codex-test`; isolated target avoids the user's executable.
- Typecheck, production build, whitespace check, Rustfmt and strict all-target
  Clippy pass. Lint remains **71 warnings, 2 informational notices, zero errors**.
  Build retains four ineffective-dynamic-import warnings and the plugin-timing
  advisory. Test-only HTML/React/native hosts are not product build entries.
- All **11** headless browser fixture scripts pass, run incrementally rather
  than repeatedly rerunning successful scripts. Settings/chat/first-use cover
  1280/390/320/280px in light/dark and equivalent 200% scaling. Collaboration
  also covers those five viewport cases, source focus/integrity, pane-bound
  drafts/attachments/approvals/Stop and long-content overflow. First-use adds
  five background/opacity/blur configurations, keyboard navigation, Retry,
  archive/restore/clear, review/Apply/artifact opening and Source Control links.
  Model switch, communication, tools, discovery, fallback, calibration and
  watchdog fixtures test their named controls and narrow layouts. Screenshots
  at 280px and desktop were visually inspected; browser states use explicitly
  mocked native/storage/provider boundaries and are B, never native GUI.
- Browser fixture repairs are not product fixes: ambiguous/stale Context and
  Dispatcher locators, unhydrated synthetic task state, truthful Preparing
  assertion for an unowned run, HMR-disabled test isolation, bounded startup
  diagnostics. The custom-tool fixture's startup timeout passed on focused
  rerun; no native capability was inferred from that fixture.

## Limits And Rollback

The all-8k immutable editing/review chain does not fit this exact protected
frame; its complete measured breakdown is above. 4k supports a basic chat but
the richer protected delegation is genuinely too large. These limits were not
hidden by truncating instructions, stripping provenance or reducing pins.
Token values are B1 estimates, not exact tokenizer counts or real provider usage.
Controlled responses prove composition and policy, not intelligence, GPU/OOM
performance, caching savings, throughput, model-loading speed or perfect recall.

Custom HTTP/WASI/MCP, all cancellation phases and chaos combinations have D/N/B
regression evidence, not one grand native scenario exercising every combination.
Finite memory/task/attachment bounds remain: mandatory overflow, source quota,
continuing write churn or missing/corrupt evidence can still block safely. No
unlimited-context or exactly-once arbitrary external-effect guarantee is made.

Rollback should revert this checkpoint's code at the existing owners, retaining
all original sessions/tasks/content/artifacts/effect receipts and prior valid
revisions. New native request fields are additive/optional; old records remain
readable. Do not delete a memory/session store, weaken authorization, remove
known-effect history or replay an ambiguous task to repair a failure.

Native GUI acceptance is **Not performed - explicitly deferred by user**.
Live-provider/model quality and Linux/macOS native evidence require real runs;
no such claims have been made. Existing unrelated user work, safety stashes and
`autonomous_tracker/` are outside this pass.

No push, release, tag or subsequent feature checkpoint is part of this pass.
