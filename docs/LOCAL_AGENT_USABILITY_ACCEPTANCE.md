# Independent local-agent usability acceptance

**2026-10-22 R5d resumed one-shot after user-restored SSH:** [Resumed R5d exact boundary report](R5D_RESUMED_LIVE_RECEIPT_OBSERVATION_2026-10-22.md) records exactly **one live native Clack dispatch**, with the unchanged saved Nemotron/Automatic profile and reachable Ollama 0.40.5. Its native trace observed **no headers or response bytes** and **cancellation at ~29.94 seconds**; no durable SDK finish, incremental event or final report arrived. The test host exited 0, the one-shot runner failed the receipt gate. The browser showed `Failed to fetch` for both JSON receipt POSTs; an offline red test demonstrated the acceptance collector returned HTTP **404 to CORS OPTIONS**. A narrow collector-only OPTIONS 204 fix now passes offline regression **4/4**, not a live fix qualification. No second inference, ForgeBoard, remote/tunnel mutation, production model/Agent fix, or P2–P19. R5 remains LIMITED, R3d BLOCKED. The historical original R5 preflight rejection and the 30-second provider no-header observation remain unproven in cause. Only future separately authorized short repaired-reporter receipt-closure work may close this boundary.

**2026-10-22 R5d connectivity stop:** [R5d evidence](R5D_LIVE_FRONTEND_RECEIPT_CLOSURE_2026-10-22.md) confirms **zero new inference**: historical manual SSH PID 34144 was absent at checkpoint intake, no other `ssh` or `127.0.0.1:11435` listener was found, bounded TCP and Ollama version checks failed. No new Tauri host/preflight/SDK/final receipt was run, and no tunnel/service setting was changed. Offline only: redacted `headers`, `chunk`, and `settled` receipt POSTs were acknowledged by the existing collector, persisted durably and verified after an isolated HTTP-receipt-only child was terminated without a final report. This does **not** qualify a live frontend stream. Six protected files, stashes, tracker and full P2–P19 plan retain their custody; original tunnel is *absent, not preserved running*. R5 LIMITED; packaged R3d BLOCKED. Next separately authorized dependency: operator restoration of the same approved manual loopback route, verified digest, then one independently approved short live receipt-closure check—not another infrastructure audit or ForgeBoard mission.

**2026-10-22 R5c addendum:** [R5c frontend stream and receipt report](R5C_FRONTEND_STREAM_RECEIPT_BOUNDARY_2026-10-22.md) independently revisits R5b's single 623-byte native-delivered response. It was `generateText`/native Ollama `doGenerate` JSON over streaming IPC, *not proof of a valid parsed SDK final event*. Actual frontend Channel handling, SDK completion, and `/report` remained UNKNOWN when the prior native host hit 90 seconds. **Zero R5c inference**; offline real proxy+SDK deterministic cases prove equal-size complete and incomplete provider responses lead to different results. Extracted test-only incremental receipt POST is durably acknowledged and persists after deliberately killing a receipt-only child process without a final report. The later, unexercised R5b harness had an **unbounded flush wait** that could conceal a completed SDK request; R5c bounds it and adds distinct sanitized Channel/SDK stages for future separate verification. This is a **harness fix**, not a demonstrated cause of the earlier R5b timeout or the original R5 context-route failure. R5 LIMITED, packaged R3d BLOCKED, P2–P19 mandatory/deferred; no automatic next live run.

Audit baseline: `09f4a69`, clean `main`, 29 commits ahead of `origin/main`.
This is an independent audit, not a new runtime or roadmap. No push or Computer
Use is authorized. Deterministic protocol fixtures prove runtime behavior, not
the intelligence of a real local model. Native GUI acceptance is not performed.

## Historical regression map

This map was assembled from current files and consumers before production edits,
then completed with current regression evidence. Test names are relative to
`src/modules/ai/` unless explicitly native. D means deterministic/mocked boundary;
N means Windows native backend; B means headless browser, never native GUI.
PASS applies only to those evidence classes, not real-model intelligence.

| Historical system | Current owner | Existing guarantees | New scenarios exercised | Regression found? | Fix |
|---|---|---|---|---|---|
| A1 profiles | `lib/selfHostedProfiles.ts`, `selfHostedMigration.ts`, settings | Stable endpoint/model revisions, additive migration; transport consumes snapshots | Profile/migration tests; captured native missions | PASS D/N | None |
| A2 handshake | `lib/selfHostedProbe.ts`, `selfHostedCapabilities.ts`, native `inference_probe` | Bounded supplied endpoint probes, credential boundaries, unknown evidence | Probe/health tests; four local metadata requests | PASS D/N | None |
| A3 setup/routing | `selfHostedSetup.ts`, `selfHostedModels.ts`, `store/selfHostedRouting.test.ts` | Exact saved route captured by chat/PeerTasks, no hidden cloud | Routing tests; A3/G2 browser fixture; exact native model assertions | PASS D/N/B | None |
| D1 cancellation | `store/chatRuntime.ts`, `inferenceLifecycle.ts`, native `net/inference` | Exact owner cancellation, queue/tool gates, sibling isolation | Runtime/cancellation tests; native stream/first-output/queue Stop | PASS D/N/B | None |
| E1 admission | `inferenceAdmission.ts`, native `net/inference` scheduler | Endpoint FIFO/capacity, release, independent endpoints | Admission/native scheduler tests; observed peaks 1 and 2 | PASS D/N | None |
| B1 budget | `contextBudget.ts`, `requestPreflight.ts`, `contextBudgetProfile.ts` | Exact capacity, output reserve, safety, schemas, fail-closed unknown | Context/preflight tests; actual-wire accounting; protected 8k overflow | PASS D/N | B1 unchanged |
| C1a durable memory | `conversationMemory.ts`, native `conversation_memory` | Private conversation ownership, CAS/source hashes, immutable transcript | 58 native memory tests; two-process restoration | REGRESSION FIXED D/N | Append-only SDK assistant-tail proof |
| C1b compaction | `conversationCompaction.ts`, `compactionPlan.ts`, `compactionExtraction.ts` | Bounded local extraction, protected requirements, source coverage | Ten cycles each at 8k/16k/32k; four native long-mission revisions | REGRESSION FIXED D/N | Protect latest accepted plan and failed shell results |
| G1a history | `conversationRetrieval.ts`, native memory sources | Same-conversation authorized originals, bounded relevance | Retrieval/quality corpus; resumed native long mission | REGRESSION FIXED D/N | Optional exhaustion receipt; required evidence remains fail-closed |
| M1 project ownership | `projectMemory.ts`, native `conversation_memory/project` | Separate authorized workspace records, explicit promotion only | Project ownership/privacy/promotion tests | PASS D/N | None |
| M2 freshness | `projectFreshness.test.ts`, native project freshness, `scopedEvidence.ts` | Content identity, stale/conflict qualification | Freshness/correction tests; current native file observations | PASS D/N | Workspace-instruction cache fixed separately below |
| G1b scoped evidence | `scopedEvidence.ts`, native project freshness retrieval | Recipient-scoped task/artifact/file evidence, bounds and revalidation | Scoped-evidence tests; native immutable reviews and own writes | PASS D/N | None |
| C2 optimize/switch | `store/modelSwitch.ts`, `targetPreparation.ts`, `targetContext.ts` | Same session, actual target, CAS/no partial activation, B1 | Capacity/sync/target preparation tests; switch browser fixture | PASS D/B | No new native switched coding mission |
| H1 communication | `peerCommunication.ts`, `peerCommunicationRuntime.ts` | Task-linked notes, clarification, cancellation; not attachment storage | 17 coordinator tests; native clarification; browser activity | PASS D/N/B | Clarification mock now records its normal final batch |
| H2 recipient handoff | `peerHandoff.ts`, `peerHandoffRuntime.ts`, `peerReview.ts` | Recipient-sized handoff, immutable review provenance | Handoff/review tests; 135-task native corpus | PASS D/N/B | None |
| Attachments | `attachments.ts`, `attachmentMessages.ts`, `attachmentTransfer.ts`, native `attachments` | Immutable CAS/leases, binary truth, secret denial, evidenced vision routing | Attachment/CAS/native artifact and browser pane-targeting tests | PASS D/N/B | No live vision model claim |
| R1 activity | `activity.ts`, `activityStream.ts`, `activityRecord.ts` | Structured exact-owner activity, no private reasoning invention | Activity tests; native phase/cancel persistence; browser | PASS D/N/B | None |
| R2 effort | `reasoningEffort.ts`, `store/reasoningEffort.ts` | Evidence-backed provider controls, separately captured | Effort/request/provider tests; browser locks/unsupported state | PASS D/N/B | No live effort-quality claim |
| T1 definitions | `customTools.ts`, `store/customToolCapture.ts` | Versioned definitions, scopes and assignment | Custom definition/capture tests | PASS D/N | None |
| T2 execution | `customToolExecution.ts`, native `custom_tools` | Exact approval, bounded results, effect/history safety | Execution/HTTP/error/cancel tests; T2 browser fixture | PASS D/N/B | None |
| T3a confinement | Native `custom_tools` WASI backend | Embedded Wasmtime, staging-only preopen, no inherited network/env/processes | Windows native adversarial WASI suite | PASS N | Linux/macOS native NOT EXERCISED |
| T3b functions | `tools/custom.ts`, `customToolExecution.ts` | Authorized exact module/version, staged output/review path | Function module/substitution/output/history native tests | PASS D/N | None |
| T3c MCP | `mcpConnections.ts`, native `custom_tools/mcp` | Scoped HTTP only, exact schema/consent/credentials, no local launcher | MCP/schema/consent/error/disconnect native tests | PASS D/N/B | No local MCP launcher added |
| F1 tool exposure | `toolExposure.ts`, `agent.ts` prepareStep | Permission intersection, target relevance, bounded schemas, later escalation | Exposure tests; all 90 local requests inspected | REGRESSION FIXED D/N | Bounded continuation-objective ranking; new task resets it |
| D2 continuation | `answerContinuation.ts`, `runBudget.ts`, `chatRuntime.ts` | Finish provenance, bounded turns/time/output, no tool replay | Length/provider tests; premature-stop native missions; blocker/budget tests | REGRESSION FIXED D/N/B | Pending plan gate, blocked pause, no false PeerTask completion |
| D3 recovery | `streamRecovery.ts`, `restartRecovery.ts`, native transport | Pre-output retry only, partials durable, no restart replay | Recovery/provider tests; two native restart corpora | PASS D/N | No native GUI restart interaction |
| E2 calibration | `inferenceCalibration.ts`, `calibrationCapture.ts`, native telemetry | Passive samples, bounded opt-in recommendations, manual pins | Calibration capture/optimization/native tests; browser pins/reset | PASS D/N/B | No hardware tuning claim |
| F2 watchdog | `outputWatchdog.ts`, `answerContinuation.ts` | Whitespace/repetition/malformed tools, Stop and useful output preservation | Real SDK watchdog integration; native cancellation; browser controls | PASS D/N/B | Failed command classification now preserves evidence |
| U1 controls | `AiChat`, chat controls, Context/Source/Task surfaces | Pane ownership, real approvals, focus, narrow layout | Eleven browser fixtures; Continue and pane/store tests | PASS D/B | Native GUI NOT EXERCISED by request |
| G2 discovery | `serverDiscovery.ts`, native discovery | Supplied address, opt-in, bounded attempts, no LAN scan | Discovery/credential/SSRF native tests; browser opt-in fixture | PASS D/N/B | No user LAN scanning |
| G3 fallback | `inferenceFallback.ts`, `store/inferenceFallback.ts` | Never/Ask/exact trusted, scope, no post-effect fallback | Fallback scope/partial/effect tests; local-only destination assertions | PASS D/N/B | No live cloud requests |
| Q1 intelligence quality | `quality/*`, compaction/retrieval/handoff consumers | Exact constraints, authorized retrieval, no orphan pairs/effect replay | Dedicated 38-test quality/stress group plus native corpus | PASS D/N | Runtime evidence, not real-model intelligence |
| Z integration | Browser runner, native acceptance examples | Composed production commands, files, worktrees, restart | 64 + 5 + 4 native scenarios; full repository gates | PASS D/N/B; release L/GUI/platform gates NOT EXERCISED | Release acceptance remains limited |
| UX simplification | Settings connections/agent/tool panels | Discoverable exact destinations/scopes/consent | Product UX browser and first-use fixtures | PASS B | No redesign |
| Exact target context | `targetContext.ts`, `providerContext.ts` | Exact target evidence and conservative unknown | Resolver/switch/preflight tests | PASS D/B | None |
| Exact variants | `providerContext.ts`, `providerContextVariants.test.ts` | Exact suffix lookup/cache, no base inheritance | Exact variant and genuine unknown tests | PASS D | No live OpenRouter lookup needed |
| Capability retention | `providerModelEvidence.ts`, saved models, transport | Context/output/tools/modalities/effort survives selection/capture | Evidence/restore/capture tests | PASS D/N | None |
| Agent precedence/first use | `agent.ts` system assembly, `agentHierarchy.test.ts` | Core invariants > captured Agent > user; default persona fallback | Hierarchy/permission tests; every local request checks captured Coder | PASS D/N/B | None |
| Unified chat controls | Chat controls, `chatConnectionSummary.ts`, `chatToolSummary.ts` | Conversation owns Agent/model/permissions/context | Chat browser fixture, private panes/drafts | PASS D/B | None |
| Tools/Dispatcher/results | `taskPresentation.ts`, `taskResultActions.ts`, Dispatcher/Feed | Real result actions, workspace vs private-history separation | Task/browser tests; actual native review/correction/Apply | PASS D/N/B | Completion guard strengthens task truth |
| Real-world workflow | `realWorldAcceptance.integration.test.ts`, native example | Real Git edit/review/correct/apply, new-file provenance | Native temp repos and three FS/Git integration tests | PASS D/N | None |
| Retry/navigation | `taskRetryEffects.ts`, dispatcher navigation store | Pre-effect only, linked retry, duplicate click/navigation order | Retry/navigation tests; native safe Retry and mutating denial | PASS D/N/B | None |
| Archive/appearance | `taskArchive.ts`, Dispatcher surfaces | Non-destructive archive/restore/clear, theme integration | Archive/browser tests; native archive/restore | PASS D/N/B | None |
| Handoff stale fix | `peerTaskCoordinator.ts`, `peerHandoffRuntime.ts` | Material identities, not reference equality; harmless churn allowed | Stale/coordinator tests; 50 mixed + 50 read native missions | PASS D/N | No duplicate owner |
| 09f4a69 hardening | Existing coworking runner, `peerHistory.ts`, memory rebase | Queues, private history, exact capacity, unique effects, restart | 64 scenarios/135 tasks/301 requests plus 8k Coder/16k Reviewer | PASS D/N/B | New regressions add to, not replace, earlier acceptance |

## Independent Findings And Fixes

Four initial red regressions reproduced premature completion, unprotected current
plans, stale positive instruction caching and stale negative instruction caching.
The new native mission then exposed additional composition failures, not merely
unit-helper discrepancies:

1. A normal provider stop completed a run with explicitly pending obligations.
   `onFinishMeta` now reads the current session's accepted todos and routes a
   normal stop through the existing run budget. Full/trusted access can continue;
   Ask/Custom/Chat Only require explicit Continue. Explicit blocked items pause
   for the user. Length/error/policy/unknown finishes do not trigger this gate.
   Existing 240-step/nine-auto-continuation ceilings and Stop ownership remain.
2. PeerTask dispatch could publish Completed when a worker's budget was still
   paused or exhausted. It now refuses that result, preserves effects/worktree
   safety and identifies unfinished work. No completed effect is blindly retried.
3. The latest accepted todo call/result was ordinary compactable assistant
   history. C1 now keeps that complete source group verbatim. Plans remain
   reported progress, never verification proof. Old plans remain in originals;
   a newer accepted full plan supersedes their hot-context priority.
4. Active-strip cleanup deleted durable reported progress. Terminalized todos
   now remain in the existing session-owned todo store with explicit saves.
   New runs still clear the active list, terminal strips remain hidden, deletion
   removes the session's record, and original plan tool calls remain durable.
   New plans are bounded to 16 items/8,192 serialized characters, IDs 128,
   titles 160, descriptions 512, unique IDs and at most one active item.
5. `CLACK.md`/`TERAX.md` reads used a 30-second positive/negative cache. Removing
   it observes changed/new instructions at the next batch, retaining native
   workspace authorization. Cost: one bounded instruction read per batch
   (fallback file if absent), not a repository rescan or file-monitoring service.
6. Shell exit code 1/null or timeout without an `error` member was treated as a
   successful run observation and unprotected history. The existing observer and
   compactor now recognize those states only for the builtin `bash_run` tool;
   unrelated custom result data is not reclassified by a coincidental field.
7. F1 lost the substantive task when a short same-task continuation became the
   latest query. At pressure it exposed delegation but omitted the required file
   reader. Ranking now carries the most recent substantive objective through
   explicit Continue/Resume/Finish-same-task messages, bounded to 128 user turns
   and the existing 8,192-character ranking limit. This is selection context,
   not new system authority. New objectives/PeerTask handoffs reset it.
8. A recreated G1a retriever with an exhausted shared run allowance blocked
   optional retrieval during safe continuation. It now publishes an omission
   receipt without IO or stale reuse. Explicit requests, anchors, stale or
   relevant unresolved/conflicting claims still fail closed. No quota increased.
9. SDK auto-continuation appends parts to its existing assistant message. C1's
   full-message-prefix proof misclassified that as changed evidence during a
   later extraction. Rebase now optionally proves the earlier complete-message
   prefix, active assistant ID/header, part count and exact prior-parts hash.
   Only appended parts and host-owned `clackActivity`/`clackAnswer` metadata may
   advance. Role/ID/header changes, removed/rewritten parts, changed earlier
   messages, model/workspace/run changes, cancellation and competing revisions
   still reject. Native tests exercise nine tail mutations plus prior CAS tests.
   Rebase retries source/CAS only, never the extraction model call.

Fixture-only corrections: isolated native test environments now preserve
`PATHEXT` so Windows can resolve `node`; scripted protocol assertions no longer
advance a phase before checking tool availability or silently recover a 500
using an old result. The clarification mock records its final successful batch,
as real transport does. No production assertion, deadline or security bound was
weakened to fix these fixtures.

## Production Call Paths And Preserved Owners

`chatStore.beginRun` captures the conversation profile, Agent persona, exact
provider/model, workspace, permissions, effort and custom-tool revisions.
`chatRuntime` supplies that owner to `transport`, attachment materialization,
project instructions and `runAgentStream`. The Agent builds permission-filtered
tools, F1 exposure and the stable core/Agent system frame. C1/G1/M1/M2 prepare
source-linked working context; B1 measures the actual serialized provider body
and revalidates it at native admission. E1 owns capacity and D1 cancellation.
Tool calls retain the existing permission, lease, read-snapshot, approval,
review/write, WASI/MCP, activity and effect boundaries. D2/D3/F2 retain finish,
recovery and watchdog ownership. `PeerTaskQueueBridge` and the existing ledger
own delegation, dependencies, clarification, immutable artifacts and Apply.

The hot context is still a projection, operational truth is still session/task/
effect state, durable accepted knowledge is still C1/M1/M2, and deep history is
still the original transcript/CAS evidence. The todo record is a bounded reported
plan, not another task database. No second compactor, memory server, scheduler,
vector database, cloud evaluator, effect ledger or local-only runtime was added.
H1/H2 are communication/handoff checkpoints in the actual roadmap; attachments
have their own existing contract despite the addendum's older shorthand labels.

## Independently Constructed Native Missions

Command: `node scripts/check-coworking-native.mjs --local-agent`.
The new `local-agent-protocol.mjs` is an explicitly scripted response peer.
`localAgentAcceptance.ts` uses the production Chat SDK, transport, native command
registry, context owners, filesystem, shell and session persistence. It does not
mock those boundaries. The existing invisible native host gained only production
shell command registration so a requested focused test really executes.

Each mission receives its objective once: inspect source, implement exact
`timeoutMs=750` (900 obsolete), preserve `port=1420`, `allowRemote=false` and
`src/public-api.ts`, add/run a focused test and document the actual result.
Every serialized request asserts those constraints and the captured Coder/model.
Subsequent phase messages do not restate the numbers or prohibitions.

| Mission | Actual outcome | Evidence |
|---|---|---|
| 8k single Agent | Capacity-blocked, NOT complete | Source and test file actually written; verification/documentation not finished; failed plan retained; no fallback |
| 16k single Agent | Five obligations complete | Four real writes, one intentionally failing Node test, corrective write, successful test, real documentation; one unfinished-plan continuation |
| 32k long single Agent | Five obligations complete after 24 investigation turns | 26 real ranged reads, three writes, focused Node test, four durable memory revisions; exact source-window assertions; one final unfinished-plan continuation |
| 128k single Agent | Five obligations complete | Two reads, three writes, focused Node test, documentation; one continuation; no extraction needed |

The three successful missions have 15/15 observed obligations complete. The
8k mission is reported separately, not averaged into a fake quality score.
All 12 acknowledged writes across the four missions have distinct SDK call IDs;
one of the 16k writes is an intentional correction, not a repeated completed
effect. Four actual Node invocations occurred inside Clack: one failed and three
passed. The host independently reran each successful mission's final test against
disk (three additional successful invocations). Natural-language claims alone
were never accepted as file/test evidence by this acceptance harness.

The 32k conversation has 24 investigation phases plus its final coding request,
58 streaming requests and four extraction requests. Prior phase windows are
distinct real reads of a 60,000-line file, not repeated reads of an unchanged
window. The response peer verifies returned start-line identity before advancing.
The forbidden public API file is compared byte-for-byte at the end.

A second native process restores all four conversation records and the long
mission's memory revision 4, including completed reported plans, with zero new
inference. Recovered originals are compared with the first process. This is
backend restart evidence, not native window interaction. Explicit model-switched
coding after a process restart was not newly composed in this native corpus;
existing C2/D3 target/recovery integration and native persistence tests cover
those owners separately.

## Context Fidelity And Retrieval

- Ten incremental coordinator compactions each at 8,192, 16,384 and 32,768
  deployed fixture ceilings preserve exact numbers, negations, architecture,
  dependency identity, paths, an unresolved external effect, a denied secret
  read, current todo statuses and the original transcript. Every cycle checks
  source coverage/provenance, B1 fit and unchanged originals.
- The dedicated Q1 memory corpus adds ten history/compaction cycles with four
  critical facts retained at every cycle; intentionally optional details leave
  hot context and are recovered from exact authorized originals later. This is
  deterministic source fidelity, not a measured real model's recall.
- The native long mission adds four real persisted compaction revisions. All
  extraction requests use its selected loopback route. It never replaces the
  original messages with a summary.
- Existing G1 tests exercise earlier requirements, corrections, findings,
  omitted decisions, historical failures, source anchors, secret/cross-chat
  denial, unavailable evidence, source mutation and bounded expansion. G1b and
  native reviews resolve original immutable patches and qualified task results.
- Optional evidence may be omitted with an explicit receipt when budget or
  lookup allowance is spent. Required/anchored/stale/conflicting evidence still
  blocks. Missing evidence is never replaced by rereading a similarly named file.

## Actual-Wire Efficiency

The native local corpus sent 90 inference requests: 86 streaming and four local
extractions; four metadata requests were recorded separately. Every captured
body is independently remeasured with the unchanged B1 `assertRequestBudget`.
All transmitted bodies fit; the failed 8k preparation is absent from inference
traffic. Counts are conservative B1 estimates, NOT engine tokenizer measurements.

Representative peak streaming requests from that run:

| Ceiling | System (core + Agent) | Schemas/options | Conversation/operational/evidence | Final input | Output reserve | Safety margin | Exposed schemas |
|---|---|---|---|---|---|---|---|
| 8,192 | 3,293 = 3,001 + 292 | 1,891 | 1,625 | 6,809 | 512 | 681 | 5 |
| 16,384 | 3,378 = 3,086 + 292 | 3,951 | 4,037 | 11,366 | 1,024 | 1,137 | 12 |
| 32,768 | 3,293 = 3,001 + 292 | 6,109 | 12,904 | 22,306 | 1,024 | 2,231 | 16 |
| 131,072 | 3,378 = 3,086 + 292 | 6,932 | 3,189 | 13,499 | 1,024 | 1,350 | 18 |

The 8k rejected protected frame was **7,027 input + 512 output + 703 margin =
8,242**, 50 estimated tokens above 8,192: system 3,378, schemas/options 1,889,
conversation/tool state 1,760. B1 was not weakened. Its full diagnostic is retained
in the local report, including section and schema-byte counts. This particular
long current SDK tool frame cannot be safely made to fit by dropping required
instructions, completed tool relationships, the latest plan or safety margin.
That does not prove every possible smaller coding request is impossible at 8k.

Manual useful-context inspection: core/Agent instructions, exact current
requirements, pending plan, tool results and failure evidence are required;
current file observations are useful but freshness-qualified; older completed
log discussion is optional/retrievable, and superseded narrative should not
dominate. No attachments are sent in these single-Agent missions. Environment
metadata contributes 92 estimated tokens in the representative frame. Initial
G1b file evidence contributes 769; it is not counted as new user instructions.
At the peak 32k request, older optional retrieval is omitted and original history
accounts for 12,791 estimated tokens. Raw reports retain every breakdown.

The pure no-tools normal-wire fixture in the full suite measured system 3,443,
conversation 15, schemas zero. Native 4k greeting sends zero tool schemas.
Broad coding tasks can still expose 12-18 builtin schemas at larger capacities;
that is bounded, not an optimality claim. The measured schema cost is a remaining
efficiency limitation. F1's existing conservative fallback and exact permitted
tool/version ownership are preserved rather than deleting tools to win a score.

No TTFT, GPU, prefill, generation-rate or real-model tuning conclusions are drawn
from deliberately paced protocol fixtures. Manual context/concurrency/effort
pins and E2 evidence precedence are covered by their current regression tests.

## Preserved Coworking And Small-Team Acceptance

Both preserved corpora were rerun, not accepted from prior reports:

- `node scripts/check-coworking-native.mjs`: **64 scenarios, 135 durable tasks,
  301 native inference requests** (283 streaming, 18 extraction), nine metadata
  requests. Includes 50 mixed delegations, 50 more reads, 12 queued/parallel
  workers, observed capacity peaks exactly 1/2, real isolated edits, immutable
  review, correction, Apply and disk tests. At shutdown: 128 completed, three
  intentional failures, three explicit cancellations, one held running task.
  Restart restores 135 records, turns the held task into interrupted recovery,
  preserves completed records/originals, and sends zero new inference.
- `--small-team`: **five scenarios, ten tasks, 35 native inference requests**.
  Preserves 4k basic chat, 8k read-only workers, a fresh 8k isolated Coder edit,
  a truthfully blocked 8k immutable review and explicit 16k review/Apply of the
  original patch. It is NOT a successful all-8k coding/review team.

Parent-private canary isolation is checked on every worker streaming request,
including same-Agent workers. Private history is not made project-global. Safe
read-only Retry remains linked and bounded; acknowledged/uncertain mutation
prevents blind Retry. Archive/restore, material handoff identity, queued and
in-stream cancellation, original artifact provenance and failed Apply/conflict
preservation remain under the existing owners and tests.

## Completion And Failure Classification

The new peer deliberately says Done after reading only the config. Each complete
mission rejects that finish as a completed job and continues once, without
replaying the read/write IDs. The 8k attempt similarly continues once but later
blocks truthfully. A concise answer with no unfinished explicit obligations does
not continue. A model repeatedly ignoring its plan reaches the existing nine
continuation ceiling; Ask/Custom/Chat Only and explicit blockers do not start
autonomous continuations. Stop, errors, partial outputs and uncertain effects
retain D1/D3 ownership.

Failure taxonomy: premature completion, context omission, stale instruction
caching, optional retrieval exhaustion and SDK-tail CAS failures were Clack
runtime/context/state defects and were fixed. Missing PATHEXT and speculative
scripted-peer phase advancement were test-fixture defects. The protected 8k
overflow is a disclosed capacity/representation limit, not a model-intelligence
failure. The deliberate 800-ms implementation in the 16k fixture produces a
real failed test before correction; this is controlled failure evidence, not a
claim that a live model made or corrected that mistake.

The completion gate evaluates only accepted structured plan state. It cannot
formally prove arbitrary natural-language obligations, detect every dishonest
model completion tick, or certify an arbitrary external effect. A model with no
explicit plan can still give an inadequate answer; live task competence remains
unverified. Tool/effect history and verification outputs remain the evidence the
user/reviewer should inspect. No semantic completion helper or cloud judge was
introduced.

## Small-Model Capability Verdict

| Capability | 4k | 8k | 16k | 32k | 128k |
|---|---|---|---|---|---|
| Simple chat | Native controlled PASS | Runtime PASS | Runtime PASS | Runtime PASS | Runtime PASS |
| Read-only tools | Rich handoff truthfully blocked | Native PASS | Native PASS | Native PASS | Native PASS |
| Single-file edit | Not proven | Native isolated edit PASS | Native PASS | Native PASS | Native PASS |
| Implement + test + document | Not proven | New mission capacity-blocked | Native PASS, with failed-test correction | Native PASS after 24 phases | Native PASS |
| Delegation/review | Rich handoff too large | Bounded read PASS; full review blocked | Native team PASS | Recipient isolation PASS | Recipient isolation PASS |
| Ten context cycles | Not proven | Deterministic PASS | Deterministic PASS | Deterministic PASS; four native revisions | No extraction needed in new mission |
| Actual model intelligence | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED |

## Privacy, Live Testing And Usability Limits

Only the already-configured `localhost:3001/v1/models` was checked, with a
five-second bound and no credentials/conversation. It refused the connection.
No model/server was downloaded, installed, started or reconfigured. Therefore
there is **zero live local-model quality evidence** in this pass. Deterministic
inference destinations are only the owned loopback endpoint; cloud calls and
unexpected inference destinations are zero. This is application-request evidence,
not packet capture of unrelated programs on the machine.

All eleven browser scripts passed: product UX, chat controls, first use,
collaboration, communication, self-hosted setup, custom tools, model switching,
fallback, calibration and watchdogs. Covered widths include 1280/390/320/280,
640 at equivalent 200% scaling, light/dark, keyboard/focus, long content, pane
isolation, approvals, source conflicts, Dispatcher Retry/archive/navigation and
result actions. The current 320px light model-selector screenshot was inspected.
Browser OS/storage/provider boundaries are explicitly mocked.

Workspace chip/breadcrumb/explorer, Source Control and terminal regressions pass
their existing frontend/native FS/Git tests and browser links; their production
implementations were not changed. Real PTY/window interaction was NOT performed.
Native GUI, native split-pane/Stop/minimize/restore/dialog/restart interaction is
**Not performed - explicitly deferred by user**. Linux/macOS native, actual
Ollama/LM Studio/vLLM/MLX engines, GPU/OOM hardware and live cloud providers were
not exercised. Engine adapter/wire variations, missing usage/capacity, unsupported
tools, delayed/partial/malformed output, auth/rate-limit/disconnect and cancellation
remain covered by deterministic/native protocol tests, not live engine runs.

## Final Verification

- Focused local/runtime group: **226 passed in nine files**; subsequent C1/G1
  source-proof group **82 passed in two files**; native memory group **58 passed**;
  corrected clarification group **17 passed**. These overlap; do not sum them.
- Dedicated context-quality/stress command: **38 passed in four files**. Generated
  Q1 A/B/C measurements are under ignored `src-tauri/target/local-agent-quality`.
- Final frontend: **2,641 passed in 194 files** at two workers. First full run
  had one outdated mocked clarification boundary; the focused correction and
  final full rerun passed. No timeout or assertion was weakened.
- Final Rust: **646 passed** (593 library, 25 FS, 25 Git, three real-world);
  zero failures/ignored. Used `--target-dir target/codex-test`.
- Types, lint, production build, rustfmt, strict all-target Clippy and whitespace
  checks pass. Lint remains **71 warnings, two infos, zero errors**. Build retains
  four preexisting ineffective-dynamic-import warnings and a plugin-time advisory.
- Native local/coworking/small-team counts and browser evidence are above.
  Detailed controlled requests/results are ignored local diagnostic artifacts,
  not bundled product data or a new persistent debug service.

## Acceptance And Handoff

**Independent runtime audit and targeted hardening complete. Full real-model
product acceptance is NOT established.** Evidence supports operational continuity
for the controlled 16k/32k/128k missions and preserves the historical regression
contracts, with explicit smaller-context limits. It does not establish that an
arbitrary weak local model will plan, remember or finish serious engineering
work competently. No perfect recall, optimal tuning or unlimited context claim
is made. The unqualified final product-acceptance statement in the request is
therefore intentionally not asserted.

One existing architecture remains. There are no new external runtime dependencies
or required VM/container services. Original messages, CAS content, private/project
ownership, approvals and review/write paths are preserved. No safety stash,
delegation user work or `autonomous_tracker/` was modified. No push is authorized.

Rollback is a normal revert of this checkpoint; memory record schema remains 1
and originals are intact. It requires no transcript rewrite, knowledge promotion,
model call replay or database migration. The new tail proof is ephemeral RPC
state, not a replacement memory format. Further live-model/hardware/platform and
native GUI acceptance remains separate work, not a silently started checkpoint.

## Focused Ollama Runtime Context Correction (2026-10-15)

Baseline verified: `1aa20f6`, clean `main`, 30 ahead / zero behind `origin/main`.
This focused correction supersedes the earlier no-live-Ollama statement only
for the acceptance below. It does not establish general local-model engineering
quality, other engines, native GUI acceptance or new roadmap work.

### Root Cause And Owners

`workingContext` previously limited Clack's conversation planning but did not
configure Ollama. Both saved profiles and `ollama-local` used the compatible
`/v1/chat/completions` adapter. Model maximum and asserted context were not proof
of runner allocation. The supplied deployment ignored compatible `options.num_ctx`
and loaded at 4096; native `/api/chat` supports runtime options.

`lib/ollamaModel.ts` now implements SDK v3 directly, without a new dependency,
proxy protocol, model alias or second Agent runtime. `agent.ts` routes saved,
migrated and legacy Ollama through it; E2's explicit optimization path uses the
same adapter. Shared native proxy/preflight, credentials, consent, SSRF/DNS
validation, E1 admission, D1 ownership, F1, F2, tool approvals/effects and D2/D3
remain the existing owners. Native progress inspection now recognizes NDJSON
text, thinking, tool events and completion, rather than timing out active output.

The existing profile `workingContext`, including an effective recommendation,
owns `options.num_ctx`. Positive integral targets up to 2,000,000 are bounded by
known advertised/asserted/configured ceilings and a fresh native API contract.
Manual values win. `configuredContext` is a ceiling assertion, never an automatic
runtime-allocation request. Automatic without guidance sends no `num_ctx` and
does not assume an earlier larger loaded allocation is the next server default;
without configured/default evidence it retains B1's conservative policy.

For controlled Ollama requests, B1 treats the target as the total context ceiling,
not merely conversation space. It still accounts for instructions, tools, history,
output reserve and unchanged safety margin. `source: requested` distinguishes a
supported per-request contract from `source: deployed` after matching loaded
evidence. Native output is bounded with `options.num_predict`; native JSON schemas
are counted and unknown image cost still fails closed. Endpoint/model/profile
identity is revalidated after queueing. The native acceptance caught and fixed
an existing pre-admission cache read that omitted private-network consent scope.

After normal inference, bounded A2 metadata probes observe `/api/ps`, without
warm-up generation, keep-warm calls or automatic retries. Fresh matching evidence
is reused for 30 seconds. A scoped `probe.requestedContext` receipt is persisted
with existing version-1 profile evidence and native cache/CAS/event ownership.
Probing another model on the endpoint does not discard the first model's receipt.
It is client-observed request intent, not a server-reported allocation. Subsequent
probes retain that comparison target. A reported 4096 allocation following a
32768 request remains visible and blocks subsequent B1 preparation with an
actionable mismatch error. Lowering the target or obtaining reconciled server
evidence can recover; the already-sent request is never replayed. Missing metadata
does not fabricate loaded capacity. Unloaded models show "Not currently loaded".

### Native API Parity And UX

- Text/system/assistant/tool history, structured arguments and stable call/result
  identity, multi-step loops, usage, text/thinking deltas and finish reasons map
  directly to SDK v3. Missing final events and duplicate tool identities fail
  closed; cancellation reaches the owned reader/native request.
- Native `format` maps JSON/schema output. Image-capable fixtures serialize native
  `images` correctly, while preserving B1's unknown-media guard. Unsupported files,
  provider-defined tools and non-text tool results are rejected, not dropped.
- Fresh exact `/api/show` thinking values are used when supplied. Older thinking
  capability metadata maps the documented native Boolean on/off contract, not
  fabricated low/high levels. Automatic sends no thinking override. Existing
  structured reasoning presentation remains in charge; no private trace is
  included in the acceptance report.
- Ollama does not force `tool_choice`. Named choice restricts exposed tools;
  required/named forcing emits an unsupported warning and may still return text.
- Root, `/v1`, trailing-slash, HTTPS and reverse-proxy prefixes normalize by
  removing only a terminal version marker. Only the referenced credential is
  sent, with original private-network consent and scheduler endpoint identity.
  LM Studio/vLLM/MLX/generic compatible/cloud transports retain their semantics.
- The existing model controls expose model maximum, server context and working
  context separately. Ollama context controls are initially expanded and explain
  the runtime request concisely. There is no Modelfile/alias/global environment
  requirement, new Settings architecture, or change to server keep-alive defaults.

### Deterministic And Live Evidence

Focused frontend: **166 passed / eight files** (overlapping the full suite).
New native Ollama/probe/progress subset: **10 passed**, including existing tests.
Production C2 switching into an unloaded 32K target, exact outgoing body/B1,
Automatic/asserted distinction, invalid ceilings, queued stale settings,
recommendation/manual ownership, caching, native thinking contracts, streaming,
tool-result roundtrips, schema/images, malformed/partial output and cancellation
are covered. Existing full D1/D2/D3/E1/E2/F1/F2/G3/PeerTask regressions pass.

`node scripts/check-ollama-native.mjs` uses the existing invisible native Tauri
test host and real Rust networking, isolated app data, and owned fake Ollama
`tags/show/ps/chat` routes. It proves cold 262144 maximum / 32768 request / 32768
loaded evidence, then a 4096 reported mismatch retained across probe persistence
and blocked without another inference. Four actual native inference destinations
are audited; tool execution occurs once across two steps. This is not GUI evidence.

Final `node scripts/check-ollama-native.mjs --live` **passed** through production
Clack `runAgentStream`, shared preflight and native IPC/HTTP, not a substitute curl:

| Observation | Final live evidence |
|---|---|
| Exact model | `qwen38-uncensored:latest` (no replacement/download/alias) |
| Initial state | Unloaded, `/api/ps` empty |
| Model maximum | 262144 advertised tokens |
| Captured working target / native wire | 32768 / `options.num_ctx: 32768` |
| Refreshed native cache / `/api/ps` | 32768 loaded tokens |
| Normal Agent | 10 text deltas, expected answer, normal `stop` |
| Synthetic tool | `clack_echo({value:"clack-echo-7"})`, exactly once, result roundtrip and final response in two steps |
| Reasoning | Captured None, native `think:false`; no private trace reported |
| Output | Agent 256; both tool steps 512; bounded non-streaming check 64 |
| Inference destinations | All four audited native calls: `http://127.0.0.1:11435/api/chat` |
| Cloud inference / fallback | 0 / Never; no cloud credentials loaded |

This live pass was run twice successfully, including a final cold run with native
destination assertions. No service, firewall, listener/bind address, model
definition, alias, secondary-PC project or unrelated process/model was changed.
No SSH/service integration was added. No unload was sent because concurrent use
of this shared model could not be independently excluded; normal server-default
keep-alive was retained rather than disrupting another workload. Owned local
test hosts/servers were stopped and data cleaned. Early harness-only missing
CORS headers were diagnosed and corrected; no product test assertion was weakened.

### Final Gates And Limitations

- `npm.cmd run check-types`: passed.
- `npm.cmd run lint -- --max-diagnostics=0`: passed, unchanged **71 warnings /
  two infos / zero errors**.
- `npm.cmd test -- --maxWorkers=2`: **2683 passed / 196 files**.
- `npm.cmd run build`: passed; four preexisting ineffective-dynamic-import
  warnings and existing plugin-time advisory remain.
- `cargo fmt --check`, strict `cargo clippy --all-targets --locked -- -D warnings`:
  passed, using isolated `--target-dir target/codex-test` for Clippy/tests.
- `cargo test --locked --target-dir target/codex-test`: **649 passed** (596
  library, 25 FS, 25 Git, three real-world); zero failures/ignored.
- `git diff --check`: passed.
- Existing automated headless self-hosted setup/layout fixture passed at
  1100/390/320/280px, keyboard/focus, discovery/private-auth/binding regressions.
  Boundaries are mocked. No Computer Use or native GUI interaction was performed.

Native host evidence is Windows only. No Linux/macOS native, live vision,
destructive OOM test, broad real-model coding mission or other deployment is
claimed. Successful 32K on this deployment is not a universal recommendation.
Selected-model metadata uses the existing bounded cache; an absent/expired native
contract requires metadata refresh rather than silently assuming support.
E2 recommendations/manual ownership remain unchanged; engine OOM errors retain
resource classification and are not silently retried or converted to cloud calls.
No new schema/store, server manager, installer, tuning suite or roadmap was added.
Rollback is a normal revert; original conversations/profiles remain intact,
but the prior compatible route must no longer be described as runtime-controlled.

## 2026-10-22 R3b native revision-bound check qualification (partial)

The [R3b checkpoint report](R3B_NATIVE_REVISION_VERIFICATION_2026-10-22.md) records newly implemented local-only bounded source-tree fingerprints, existing-native-shell `bash_run` check results associated with an explicit accepted Todo and persisted in the existing Todo store, and R3a user-visible stale/unknown/current sampled-status reporting. Structured `supersedesIds` preserves 50→25 history and unrelated work. A Rust fixture executes an actual harmless local shell check against a temporary workspace; frontend tests separately replay native responses through store persistence and rendering. **No live model, complete packaged Tauri native→persisted→restart→GUI roundtrip, Linux/macOS check, or independent functional app acceptance was run.** Native results certify the command executed, not arbitrary feature semantics; R3b is **PARTIAL**. Refer to the report's executed-gate table for current results. Required complete P2–P19 roadmap remains deferred until local-AI acceptance.

## 2026-10-22 R3c real Windows Tauri roundtrip (partial)

[R3c evidence](R3C_NATIVE_ROUNDTRIP_2026-10-22.md) qualifies the R3b production shell IPC and fingerprint using a real isolated Tauri/Wry/WebView2 host and production Todo store in **two separate processes**: an actual `echo` check exited 0 on source A, its genuine receipt persisted to disk, a reopened host restored the receipt, external source A→B made it stale in the native WebView DOM, and another real command produced new current B evidence without reviving A. The app-host test window was **hidden**, accepted run metadata was **fixture-controlled**, and the full installed Clack chat/permission-approval/reopen GUI was **not executed**. Accordingly: real native integration **PASS**; packaged desktop user workflow **BLOCKED**; overall R3c **PARTIAL**. No model inference or unrelated host alteration. Local-model acceptance and all required but deferred P2–P19 remain open.

## 2026-10-22 R3d full Clack packaged Agent qualification (blocked)

[R3d qualification evidence](R3D_FULL_DESKTOP_2026-10-22.md) records **no actual current packaged Clack Agent/approval/reopen run**. The October 9 Windows installer/release binary predates R3b. An attempted current NSIS build completed `tsc && vite build` but was intentionally stopped during Rust release compilation because this environment had no supported deterministic full-Clack chat/approval driver without forbidden Computer Use or unapproved live inference; this was not a compiler failure. The previously successful R3c two-process **isolated** Tauri fixture remains valid native evidence but cannot be promoted to ordinary packaged Clack GUI acceptance. No permission rule, tool schema, provider profile, runtime source or protected user file was changed. Classify R3d **BLOCKED**, local-AI acceptance **not complete**, and return only upon authorization to R4/R5; all P2–P19 remain mandatory and deferred.

## 2026-10-22 R4 checkpoint pressure and Ollama request serialization (partial)

[R4 evidence](R4_PROVIDER_BOUND_CONTEXT_2026-10-22.md) uses an existing native Rust checkpoint test with *real disposable local file revisions and source evidence* plus an opt-in production TS compactor/SDK/Ollama serialization interception. The outgoing candidate shrank **46,693→17,551 bytes**, **25,982→9,478 estimated conversation tokens**, preserving user correction, current task/plan/partial, latest write, unresolved failure and tool exposure while safely refusing an oversized original restoration. This is **deterministic dispatch-boundary evidence, not a live provider request**: native test fixture inserts its verified filesystem observations in its test ledger, the TS evidence-validation callback is controlled, and network is intercepted before sending. **No live inference, pressure, safe model continuation or app delivery was verified** because the established local provider listener was unavailable and the existing SSH/remote infrastructure was not modified. R4 **PARTIAL**. R3d full packaged Agent approval/restart remains **BLOCKED** and is a mandatory R5 gate; all P2–P19 remain required/deferred.

## 2026-10-22 R5 actual local Nemotron mission and independent product audit (limited)

**R5b later targeted boundary check:** [R5b report](R5B_TARGETED_LIVE_OLLAMA_PREFLIGHT_2026-10-22.md) preserves exactly one verified small native Ollama `inference-1` dispatch with successful 623-byte response delivery, matching normal saved endpoint/digest metadata and no SSH changes. The single native Tauri host reached its 90-second bound without a final JavaScript decision receipt. The production route comparator necessarily admitted that dispatched request, but its exact wire context and trusted target were **not durably captured**; no second request was seen and R5's original failure is not explained. An opt-in same-instant sanitized callback and an **after-run, unexercised** incremental test receipt path are preserved for a new separately authorized qualification. R5 **LIMITED**, R3d **BLOCKED**, P2–P19 mandatory/deferred.

[R5 independent acceptance](R5_INDEPENDENT_LOCAL_AGENT_ACCEPTANCE_2026-10-22.md) is **R5 LIMITED, not READY**. The existing manual SSH tunnel recovered without intervention, and 10 native Ollama readiness requests plus **one** authorized ForgeBoard mission's seven provider requests succeeded using installed digest-pinned Nemotron, Automatic reasoning (`think:true` on the mission), `num_ctx:65536`, `num_predict:2048` and 14 actual schemas. Seven structured native calls created a seven-item unfinished plan and a three-file npm/TypeScript scaffold, not runnable application source. The Agent ended `failed` on a nonretryable Clack **`ollama-context-route` context preflight** before the next provider request; the particular mismatched operand was not captured and no generic Clack fix or model-quality attribution has been proven. The correction observer confirmed **zero** authoritative writes, so the 50→25 correction was not sent. There was no natural checkpoint pressure, activation or R5 live token-savings measurement; R4's historical estimate must not be described as live.

After naturally frozen completion, independent `npm test` exited 1 with only its placeholder, `npm run build` exited 1 because the script was absent, and `tsc --noEmit` exited 2 because there were no source inputs. There is no frontend/backend, API, SSE, local persistence, real HTTP contract or README; the relevant HTTP checks are **BLOCKED** for absence of an executable service, not claimed test failures. The runner exit 0 means its own evidence was written, not that its Agent or ForgeBoard succeeded. R3d **current packaged** Clack normal GUI approval, genuine receipt, restart and stale/current reopening remains **BLOCKED**; R3c's isolated Tauri host does not satisfy it. No second inference, repair, remote/SSH change, protected user-file change or production patch was made. The one next action requires separate authorization: **non-inference, bounded diagnosis of the context-route preflight mismatch**; all P2–P19 remain mandatory and deferred.
