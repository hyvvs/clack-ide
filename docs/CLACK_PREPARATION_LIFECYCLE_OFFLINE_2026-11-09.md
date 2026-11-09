# Clack offline preparation-lifecycle reliability checkpoint — 2026-11-09

## Decision and authorized boundary

Starting verified HEAD: `a93ee086ba762596e130e6fc14e2e770ebe005d9`.
Task-owned production/test commit:
`790a608fabef046e3b97deb3b756dda2dc04e8bc` (`fix(ai): cancel read-only
preparation waits and trace lifecycle phases`). An additional targeted
near-deadline success regression was committed at
`dee8371e6c1626f12224c4030175fad80e915b81` (`test(ai): preserve successful
near-deadline compaction result`). This report and the new shared state pointer
are a separate documentation commit.

**Offline engineering: implemented and focused-validation passed.**
**Live ForgeBoard acceptance: NOT achieved.** Historical classification
`COMPACTION TIMEOUT FAILURE UNRESOLVED`, HTTP ordering **Case C** and
`ONE FURTHER FORGEBOARD RETRY JUSTIFIED: NO` remain unchanged. Neither a
production patch nor new mocked tests can retroactively prove that a particular
silent nonstreaming Muse extraction was genuinely progressing before its
deadline. The earlier narrower `MUSE ACCEPTED — LOCAL AGENT PROVEN` result
remains historical evidence; the final objective `FORGEBOARD_PASS, LOCAL MUSE
AGENT PROVEN` still requires a separately authorized live local Muse run and
independent frozen ForgeBoard evaluation, neither of which occurred here.

This assignment was exclusively offline production-code work. **No** ForgeBoard
mission, evaluator, Muse or other-model inference, hosted fallback, notes
acceptance, native Rust or Ollama service/model/configuration modification,
tunnel/service manipulation, model download, P2–P19 work, reset, clean, push,
generated-app repair, or
historical-evidence alteration took place. The previously consumed live
authorization was not reused.

## Demonstrated lifecycle issues and corrections

1. **Extractor limits deadlock.** `createBoundedExtractor()` previously awaited
   `options.limits()` without an abort race. An unresolving limit promise kept
   `extract()` pending after the existing absolute extractor timer had aborted.
   The production extractor now uses `awaitAbortableRead()` with its existing
   `AbortSignal`. Fake-clock production-function regression proves the pending
   extraction rejects with `compaction-timeout` at 120 seconds even while the
   mock limits promise remains unresolved. Resolving the original promise
   later does not dispatch model inference or commit memory.
2. **Compaction read-only coordinator waits.** The post-commit
   `conversation_memory_load` previously awaited native IPC without racing the
   active extractor deadline. Initial loads could likewise ignore operator
   cancellation until native returned. Read-only memory load, evidence-source
   read, route-limit refresh and post-commit limits now use the captured
   cancellation signal. The coordinator checks extractor currency before
   reloading memory. Regressions verify a hung post-commit load rejects on the
   same original 120-second deadline, blocks optimization/next prompt, and a
   hung initial load rejects promptly on operator cancellation without a
   model call or memory publication. An **already committed** valid native CAS
   revision is not falsely represented as rolled back merely because a later
   read failed; reopening must inspect actual durable memory state.
3. **Target-context cached read and preview.** `loadTargetContext` can now
   abort a hanging read-only native IPC when supplied a caller signal; a
   pre-aborted signal prevents launching it. A target preview's late native
   response cannot activate or replace the staged draft after operator abort.
   Agent's target-context load and the model-switch target-preparation path
   pass their captured `AbortSignal`; preview remains uncommitted until source
   ownership/candidate checks succeed. Native target CAS remains the
   publication owner.
4. **Late target-begin lease.** `target_context_begin` may resolve with a
   session-owned switch token *after* its caller has aborted. A cancellation
   race now returns promptly while awaiting the authoritative native result
   only to revoke that **exact** late token via `target_context_cancel`.
   Regression proves the late returned token is revoked. It cannot cancel a
   replacement token because native cancellation matches the token. The
   native 180,000 ms switch-token expiry and existing owner/session/CAS checks
   remain unchanged.
5. **Observable phase ordering.** The previous preserved mission logged native
   HTTP and Agent state, but not the SDK JSON/validated-claims/deadline and
   memory-commit boundaries required to distinguish Case A/B. This checkpoint
   adds an **opt-in**, in-memory-only, synchronous, exception-isolated
   `installPreparationObserver(callback)` in
   `src/modules/ai/lib/preparationLifecycle.ts`. Production emits separately:
   extractor construction, abort/deadline/disposal; read-only limits and run
   charge entry/settlement; model call entry/return; SDK response headers, JSON
   settlement and validated final frame; extraction-source/claim validation;
   native request ID linked, response headers and native terminal settlement;
   memory load/CAS entry and settlement/failure; target begin/load/preview,
   final validation/CAS; Agent preparation/trust entry/settlement/failure; and
   actual front-end Agent run state terminalization. Fake-network integration
   proves native terminal event precedes extraction result/claim validation;
   SDK-mocked Ollama tests establish `sdk-json-settled` before validation.

The 120,000 ms extractor aggregate timeout, 120s first-output native limit,
180s native stream-idle policy, 600s native overall cap, other provider recovery
timeouts and all token/call/chunk budgets remain **unaltered**. Progress-phase
observations never control the deadline, never refresh native progress, and
cannot make a silent `stream=false` call appear healthy.

## Safety and cancellation ownership

`awaitAbortableRead()` only races **read-only** operations. Late results are
consumed but discarded by the already-settled wrapper. Abort listeners are
removed after settlement; no second native read/model call or memory mutation
is issued. The helper is *not* used around `context.chargeCall()`,
`conversation_memory_commit`, `target_context_commit`, or other potentially
mutating native CAS operations: detaching these promises could return failure
while a durable side effect still commits. Budget-charge pending work and
native publication may therefore remain pending until authoritative storage
settlement. That is a **known, separately owned remaining lifetime limit**;
it must not be described as bounded merely because the controller has aborted.
Native memory commits already own generation-checked cancel/invalidation and
owner locks; target context uses a token-checked native atomic session switch.
Post-commit cancellation is allowed to block continuation without claiming a
successfully published revision was undone.

Target reads with **no signal** are not newly endowed with an unproven timer.
For signalled operations, cancellation is prompt, but native Tauri command
completion and underlying OS/storage progress are not thereby guaranteed;
do not infer native CPU/disk liveness. Other coordinator preparation paths
outside the active extractor phase may still have non-raced awaits and have
not been proven universally bounded. No timeout-policy change was justified.

Security and trust remain: immutable original UI transcript, exact source
locators and evidence, linked Agent step/tool-call-result groups, context
budget/preflight, source hash/profile identity, CAS generations, scoped
permissions and trust revalidation, tool verification, non-replay of uncertain
effects, and same-logical-run continuation. Focused tests exercise those paths;
they do **not** replace a real provider/desktop acceptance mission.

## Diagnostics contract and future forensic use

`PreparationObservation` is a frozen object with precisely
`{ at, sessionId, runId, phase, nativeRequestId? }`. The scope identifiers
and optional native request ID are length/character-restricted; invalid scope
strings become `unavailable`, invalid native IDs are omitted. Observations
contain no message text, prompt, response body, source quote, claim, workspace
path, tool content, authentication, model digest, or error message. Callback
exceptions are swallowed without affecting inference, budgets, memory,
transport, or cancellation. There is **no installed collector or automatic
telemetry persistence** in ordinary production. A future **separately
authorized** acceptance harness should opt in *before* initiating the logical
run and record observations with independently sourced native HTTP/IPC events
and UI Agent settlement, preserving request and run identities. Unobserved
events mean **not recorded**, not that a stage did not happen. The time stamps
derive from `Date.now()` at each callback and are neither a monotonic runtime
proof nor native transport truth on their own.

The native bridge's `native-http-settled` is the transport terminal event,
not proof that AI SDK JSON was parsed or its claims validated. Similarly,
`sdk-json-settled` means parsed JSON became available, `sdk-frame-validated`
means the provider frame passed validation, `sdk-generate-settled` means AI SDK
`generateText()` returned, `extraction-validate-completed` means source/claim
validation finished, `memory-commit-settled` reports native commit response,
and `agent-run-failed` reflects actual front-end `finishRun` state transition
**before** asynchronous session-list persistence acknowledgment. No diagnostic
indicates partial tokens or inferential provider health. Metadata-only events
cannot prolong deadlines; the native transport liveness owner remains separate.

## Deterministic offline regression evidence

The existing 2026-11-08 forensic harness was **extended**, not duplicated.
New/adjusted cases cover silent extraction cutoff, late healthy-mock
completion before deadline, fake streaming-like metadata, long provider call
ignoring abort, budget charge awaiting durable settlement, initial and
post-commit memory read cancellation, source/claim validation order, native
request-ID join, JSON/frame parsing, observer exception isolation, target load
already/late-aborted, target begin late token cleanup, preview late response
ignored, no ghost memory publication/optimized continuation, original history
preservation, Agent failure settlement and preserved source/correction rules.

Validation after production changes (all **current-source**; Vitest
`--exclude='**/src-tauri/target/**'` excludes archived baseline copies):

| Gate | Result |
| --- | --- |
| Extraction/compaction/history/memory/Agent/target/context/preflight/capacity/calibration/provider, model-switch persistence, cancellation, correction observer | **30 test files; 673/673 passed** |
| Agent calibration renewal; long-run continuation audit; native-tool execution/imitation and trust verification; restart/stream recovery and production wire contract | **10 test files; 218/218 passed** |
| Additional production extractor fake-clock result at **119,000 ms**, before unchanged 120,000 ms deadline | **Targeted 17/17 forensic tests passed** after the two larger suite runs; one new near-deadline test in the same harness |
| TypeScript `npm.cmd run check-types` | **Passed** |
| Production `npm.cmd run build` (`tsc && vite build`) | **Passed**, Vite 11.52s; nonfatal dynamic-import and plugin-timing notices |
| Native Rust tests | **Not rerun**; no native Rust code touched |

All 40 focused files passed (**891 current-source tests** across the two
larger suites), followed by the targeted 17/17 forensic rerun after adding
the near-deadline regression. These counts are not represented as a new full
40-file run after the final test-only commit. Expected
AI SDK system-message warnings and simulated `context-overflow`/
`remote-disconnect` diagnostics are not failure results. No broad Vitest
aggregate was run and unrelated baseline failures were not chased.

## Source ownership, preservation and remaining external gate

Code commit modifies **only** 13 task-owned AI lifecycle source/test files;
the documentation-only closeout updates this report and
`docs/AGENT_ENGINEERING_STATE.md` for the shared ChatGPT/Codex handoff.
The six preexisting user-dirty tracked files, their exact SHA-256 values in
`docs/CLACK_FORGEBOARD_MUSE_SINGLE_RUN_2026-11-06.md`, both stashes,
`autonomous_tracker/`, operator settings, and every sealed historic Muse/
ForgeBoard original evidence file and frozen generated workspace are protected.
No direct edits to them are part of this task.

**Next necessary external authorization:** a *new*, explicit local-Muse
ForgeBoard live-run authorization, after deciding whether this checkpoint's
diagnostic harness will be captured, and subsequent independent frozen
evaluator authorization. A future run may establish fresh behavior, not
retroactively change the ambiguity in the historical Case C evidence.
Until then, `FORGEBOARD_PASS` and a further retry recommendation of YES are
**not** established.
