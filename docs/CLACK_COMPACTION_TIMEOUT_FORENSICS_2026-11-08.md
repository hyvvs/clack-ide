# Clack production compaction-timeout forensics — 2026-11-08

## Scope, verdict, and retry decision

This is an **offline production-code and preserved-evidence investigation** of
the sealed single ForgeBoard Muse mission `forgeboardmuse-20261108-01`, starting
at commit `df255cdefc192b0c5bca5983990e247a6e5fce26`. The original mission,
evaluator and evidence were **not rerun**. No model, hosted service, Ollama
administrative action, network inference, native runtime change, acceptance
suite or generated workspace was invoked/altered. Tests below use fake clocks,
mocked inference and mocked native IPC.

**Classification: `COMPACTION TIMEOUT FAILURE UNRESOLVED`.**

**Ordering: Case C — insufficient timestamps/race cannot distinguish.** Native
HTTP 200 and its bridge settlement precede the recorded Agent failure, but do
not establish when Clack's AI SDK obtained, parsed, and validated usable
extraction output relative to the extractor deadline. The recorded `stream=false`
request was silent until its final HTTP response; no independent evidence proves
genuine model-generation progress before the deadline or a genuine stall.
Therefore neither `GENERIC CLACK COMPACTION TIMEOUT DEFECT PROVEN` (requires
preserved incident match to genuinely progressing work) nor
`COMPACTION TIMEOUT OPERATED CORRECTLY` (requires evidence of a genuine stall)
meets the user's proof standard.

**`ONE FURTHER FORGEBOARD RETRY JUSTIFIED: NO`.** No timeout policy or other
production source was modified. The historical narrower finding **`MUSE
ACCEPTED — LOCAL AGENT PROVEN`** remains intact; the sealed ForgeBoard mission
remains **`FORGEBOARD INVALIDATED BY CLACK DEFECT`** as originally classified,
not independently rejudged as a Muse failure. A further live mission was not
authorized or performed.

## Exact production timer and ownership

In `src/modules/ai/lib/compactionExtraction.ts`:

- `COMPACTION_POLICY.timeoutMs = 120_000` (lines 17–29), policy version
  `c1b-extraction-v1`. `createBoundedExtractor()` (lines 340–534) captures
  `started = (options.now ?? Date.now)()` **at extractor construction** (356–357),
  installs a single `setTimeout(..., 120_000)` (362–371) that aborts its
  `AbortController` with `CompactionError("timeout", ...)`, and also checks
  `now() - started >= 120_000` in `check()` (383–395). This is **one absolute,
  aggregate lifetime limit**, not a sliding idle timer and not a new timer per
  extraction chunk or retry. The timer is cleared by `dispose()` (527–533).
- `CompactionError` extends `ContextBudgetError` and prefixes the code with
  `compaction-`; thus `"timeout"` becomes **`compaction-timeout`** and the
  exact message becomes **`Conversation preparation exceeded 120 seconds.
  Retry a bounded preparation batch. Original conversation history is
  unchanged.`** The caller's abort propagates into the same controller.
- `extract()` awaits `options.limits`, `options.onCall`, then the model call.
  Its `untilAborted()` (325–337) races the model promise against cancellation.
  `defaultCall()` (313–323) uses AI SDK `generateText(..., maxRetries: 0)`.
  Following the result are token/usage accounting, JSON/schema, evidence-source
  and quote validation, and an expiry check before claims can return. These
  operations share the same lifetime deadline.
- `src/modules/ai/lib/conversationCompaction.ts` creates the extractor lazily in
  `summarize()` (380–395), after initial planning and memory loading. Its
  `.prepare()` calls `batch.extract()` at 667, checks `batch.assertCurrent()` at
  670, then may perform candidate validation, `memory.commit(..., batch.signal)`
  at 708, `memory.load()` at 712, refresh limits and further compaction chunks.
  The extractor remains alive until compactor disposal; therefore **some
  post-extraction work consumes the aggregate deadline**, and checks can report
  expiry there. It is **not** a deadline covering the complete Agent
  preparation pipeline; several awaited operations are not raced against its
  signal.
- `src/modules/ai/lib/agent.ts` (1225–1264) computes a target-context key and
  awaits `loadTargetContext()` **before** constructing the compactor. Target
  staging/preview/commit in `targetContext.ts` and subsequent cache/trust
  revalidation have separate ownership. No record proves that target-context
  loading occurred in this specific failed mission.

In particular, the error text overstates the scope: the timer measures the
**bounded extractor's lifetime**, not all conversation preparation. The time
between extractor construction and first provider dispatch is not recorded.

## Preserved live timeline (recorded wall-clock only)

Sources are under the read-only evidence root
`src-tauri/target/real-qwen-product/forgeboardmuse-20261108-01/`:
`mission-a-1.requests.jsonl`, `mission-a-1.native-events.jsonl`,
`mission-a-1.receive.jsonl`, `mission-a-1.native-inspection.jsonl`,
`mission-a-1.jsonl`, `mission-a-1.client-stream.jsonl`,
`mission-a-1.trust-timeline.jsonl`, and the frozen mission/session report.
The relevant native request is **`inference-39`**, with
`modelMatches=true`, `stream=false`, `numCtx=49152`, `numPredict=1024`,
`toolSchemas=0`, `agentBatch="not-agent"`; legitimate local
`muse-glimmer:30b` extraction. Times below are UTC on 2026-11-08.

| Phase or observation | Exact recorded UTC | Recorded Unix ms / qualification |
| --- | --- | --- |
| Previous Agent streaming request settled | 09:06:50.745 | `1794128810745`; no precise compaction-trigger event |
| Agent running heartbeat | 09:06:51.100 | `1794128811100` |
| Extraction request created in Clack | **not recorded** | Later wire receipt is not creation timestamp |
| Extractor construction / timer start | **not recorded** | Timer starts on construction before the model dispatch |
| Native request receipt | 09:06:51.136 | `1794128811136`, requests JSONL |
| Native IPC ready | 09:06:51.138 | `1794128811138` |
| Resolve start/end | 09:06:51.157 | `1794128811157` |
| HTTP client ready / request built | 09:06:51.158 | `1794128811158` |
| Native HTTP dispatch / send-await start | 09:06:51.159 | `1794128811159` |
| HTTP 200 headers | 09:08:50.871 | `1794128930871` |
| First native body bytes | 09:08:50.871 | `1794128930871` |
| Native body: 3,959 bytes | 09:08:50.872 | `1794128930872` |
| First IPC-forwarded bytes | 09:08:50.873 | `1794128930873` |
| Native body: 1,114 bytes | 09:08:50.874 | `1794128930874` |
| Last IPC-forwarded bytes / EOF / native completed | 09:08:50.875 | `1794128930875` |
| WebView headers | 09:08:50.872 | `1794128930872` |
| WebView first chunk | 09:08:50.876 | `1794128930876` |
| WebView first-byte / channel settled / completed phase | 09:08:50.877 | `1794128930877` |
| Full AI SDK `response.json()` and `generateText()` result | **not recorded** | HTTP bridge completion is not an SDK parse acknowledgment |
| Extraction parse start/end, claims/source/quote validation | **not recorded** | No validated claims established |
| Memory commit start/end or new revision | **not recorded** | No completed revision established in frozen result |
| Target preparation/load start/end | **not recorded** | Not confirmed active or reached |
| Final context/trust revalidation | **not recorded** | No completed continuation established |
| Extractor timeout callback / first timeout throw | **not recorded** | The error code is known, the firing instant is not |
| Agent still running | 09:08:50.992 | `1794128930992` |
| Agent marked failed | 09:08:50.994 | `1794128930994` |
| Native Agent tool summary recorded | 09:08:52.049 | `1794128932049` |

The native diagnostic reports **HTTP 200**, 2 body chunks, **5,073 bytes**, no
dropped events, `eof`, elapsed **119,737,499 microseconds** from IPC readiness
to completion. Dispatch-to-completion is approximately **119,716 ms**;
dispatch-to-first-headers **119,712 ms**. Most time was spent waiting for
headers/first body. Both native chunks arrived within about four milliseconds
at the end. No native meaningful-progress event was recorded during this
request. WebView bridge settlement preceded persisted Agent failure by **117
ms** (native completion by **119 ms**). That interval is **not** a measured
parse/validation duration: it includes unknown scheduling, error propagation
and Agent state publication. Extraction inference duration as observed by
Clack, parsing duration, post-extraction duration and actual timeout-firing
instant **cannot be calculated** from this evidence.

**Case A** would require proof the SDK obtained *usable* extraction before its
120-second deadline and a later stage stalled. **Case B** would require proof
the deadline fired while awaiting the nonstreaming result, even though native
HTTP eventually succeeded. The timestamps do not establish either. The
119.7-second native result sits close to the earlier-started 120-second
extractor clock: the outcome could be an inference/abort race or a
post-result expiry. Hence **Case C**. HTTP status 200 must not substitute for
the missing SDK/parser timestamps.

## Local Muse historical comparison and progress visibility

Archived **local** native events/requests only; no new requests were made:

| Preserved run | Healthy example | Native duration | Stream | First headers | Meaningful native progress events |
| --- | --- | ---: | --- | ---: | ---: |
| `forgeboardmuse-20261106-01` | `inference-60` | 175,261 ms | `true` | ~1,335 ms | 15 |
| same | `inference-25` | 140,955 ms | `true` | ~1,033 ms | 4 |
| `forgeboardmuse-20261107-01` | `inference-28` | 140,498 ms | `true` | ~17,392 ms | 2 |
| `forgeboardmuse-20261108-01` | `inference-29` | 154,230 ms | `true` | ~18,511 ms | 4 |
| failed extraction | `inference-39` | 119,737 ms | **`false`** | ~119,733 ms from IPC readiness | **0** |

The longer successful examples were **streaming Agent generation** with actual
visible body progress, not prior compaction `stream=false` calls. They establish
that this local Muse runtime legitimately supports some >120-second streaming
requests, **not** that `inference-39` was provably healthy throughout its silent
interval. Neither periodic WebView heartbeats nor native phase/admission events
demonstrate model-token progress.

`src/modules/ai/lib/ollamaModel.ts` `send()` supplies `params.abortSignal`
to `fetch`. `doGenerate()` uses `send(false)` and then `await response.json()`;
it exposes only the final parsed frame to AI SDK `generateText` and extraction.
The separate `doStream()` can expose NDJSON progress. The native bridge can
observe headers, body chunks, lease/transport state and true meaningful bytes;
`inferenceLifecycle.ts` offers phase/response diagnostics. **No trusted
extraction-progress callback is plumbed into `createBoundedExtractor`.** Its
120-second timer cannot distinguish ongoing local model computation, a
network/provider stall, CPU parse/validation stall, a deadlocked local promise
or superficial metadata updates. For this particular nonstreaming call, there
were no pre-result response bytes to establish native transport progress.

## Deadline layering and original intent

| Owner | Current limit / semantics | Relationship to incident |
| --- | --- | --- |
| Extraction batch, `compactionExtraction.ts` | **120s absolute aggregate** from construction, abort/check | Can terminate awaiting `generateText` even if native transport has not exhausted its own overall limit |
| Native self-hosted transport, `src-tauri/src/modules/net/inference/mod.rs` | connect **10s**; first headers/output **120s**; meaningful stream idle **180s**; overall **600s** | Native HTTP 200 arrived just inside first-output budget; overall 600s never exhausted |
| Agent streaming provider recovery, `providerRetry.ts` | total **120s** before meaningful Agent output, max 2 retries / 30s recovery delay | Separate from extraction's `baseModel` `generateText` path |
| Answer continuation, `answerContinuation.ts` | **120s** selected continuation bound | Independent of compaction extractor |
| Calibration, `contextCalibrationSchema.ts` | wall **240s**; request **75s**; evidence **900s**; runtime **30s** | Not the failed extraction timer |
| Native tool verification, `toolVerificationSchema.ts` | **120s** proof deadline | Separate safety workflow |
| Target context load/staging and post-commit memory reload | No 120s extractor-owned awaited-operation race | Can remain pending past extractor abort; target load precedes extractor construction |

The 180s native idle limit **was not changed**. Native meaningful body-progress
handling (not metadata/heartbeats) and a hard overall deadline are separate
from the outer compaction timer. That creates a structural mismatch: a slow
request may be transport-legal while the extractor's aggregate wall timer
aborts it. This **possible** defect is demonstrated offline, not proven as
the cause of the sealed ForgeBoard failure.

`git log -S 'timeoutMs: 120_000'` traces the unchanged constant to
`a90221f5bae07dbc8c5f14ef86738414904c250d`, 2026-09-20,
`feat(ai): add bounded automatic context compaction`. The C1b plan in
`docs/AI_SELF_HOSTED_INFERENCE_PLAN.md` (around 2279–2360) mandates aggregate
calls/tokens/time, cancellation, evidence validation, rollback and bounded
chunks. `compactionExtraction.test.ts` (333–357) deliberately tests a
non-resetting batch deadline and pending call abort. The **reason for the exact
numeric 120 seconds** and its suitability for a slow local *nonstreaming*
model are **not recorded**. Runaway protection and fail-closed behavior are
documented; a hosted-only or inference-excluded intent is not.

## Offline production-function reproduction: ten requested scenarios

Two new tests, `compactionTimeoutForensics.test.ts` (11 checks) and
`compactionTargetStallForensics.test.ts` (1 check), all passed with fake clocks,
real `createBoundedExtractor`, real conversation-compaction coordinator and
fixture, real Ollama `doGenerate` adapter over **fake fetch only**, and mocked
`target_context_load` native wrapper. These verify **current behavior**, not a
changed policy or a healthy live model:

| Scenario | Offline observation | Interpretation |
| --- | --- | --- |
| 1. Extraction at 60s | succeeds, validates claims and records one chunk | Pass |
| 2. Silent extraction at 120s | pending model call aborts with `compaction-timeout` | Current hard cap reproduced |
| 3. Over 120s with reported native-like progress | fake observations at 30/60/90s do not reset timer; separate real `doGenerate` over mock fetch is aborted at 120s while scheduled 150s response remains inside simulated native overall 600s | Architecture blind; **not proof** that live silent model was genuinely progressing |
| 4. Memory commit stalls | cooperative abort leaves revision unchanged | Fail-closed on cooperative native CAS |
| 5. Target preparation stalls | actual `loadTargetContext()` wrapper over mocked native IPC does not settle at extractor 120s; post-commit `memory.load()` also hangs until released | **Not bounded by extractor**, negative diagnostic; target load precedes extractor in Agent |
| 6. Operator cancellation | rejects stalled inference promptly | Pass |
| 7. Provider failure | original error propagates, no fake deadline or retry | Pass |
| 8. Genuine local prep deadlock remains bounded | **Not satisfied** for a never-settling `limits()` promise: controller aborts at 120s, but awaited prep promise remains pending until externally released | Negative safety observation; unlike an inference await, not directly abort-raced |
| 9. Original transcript on timeout | original messages/tool history unchanged, no commit | Pass |
| 10. No partial memory after timeout | aborted cooperative commit never publishes revision/optimization | Pass |

The tests also show missing stronger *future fix* coverage: trusted native
liveness feeding a deadline, resistance to trivial progress flooding, complete
post-inference phase bounding, and same-logical-run success following a revised
deadline owner. Those would be required before deploying any generic correction;
no such unproven mechanism was introduced in this task.

## Decision and forward requirements

**No production timeout policy change.** The current hard cap demonstrably
lacks phase/progress awareness, while independent local awaits can lack
cancellable bounds, but the preserved live record does **not** satisfy the
mandatory cause-and-health proof gate for changing production. In particular,
do not replace 120 with 300/600, relax native first-output or 180s stream idle,
or infer model liveness from HTTP 200 or progress-free heartbeats.

If a future separately authorized evidence collection can establish
extractor-construction, timeout callback, SDK parsed-result/validation,
memory-CAS phase and trusted native transport/liveness timestamps, revisit a
minimal **phase-aware** correction: native inference is owned by trusted
native transport and cancellation (still hard bounded); local parsing,
validation, persistence, target context, and post-inference checks have their
own abortable finite deadlines. Trivial metadata must not refresh them.
Preserve immutable original history, atomic CAS, source/trust validation,
cancel/fail-closed semantics, no repeated tool effects, and single logical-run
continuation. This paragraph is **not a proposed deployed change**.

## Focused validation and preservation

- `npm.cmd exec vitest run ...` with 15 named compaction/continuation/
  memory/target/provider/calibration test paths: **25 discovered files,
  584/584 passing**, including Vitest's automatically discovered archived
  baseline copies under `src-tauri/target` (not new production coverage).
- The two new forensic files alone: **12/12 passing**. The Ollama fake-provider
  test can emit an AI SDK informational system-message warning; no network
  request was made.
- TypeScript: `npm.cmd run check-types` **passed**.
- Additional preflight/trust/native-admission/diagnostic/cancellation/correction-
  observer focused paths: **17 discovered files, 345/345 passing**, including
  Vitest's archived copies. `contextPreflight.integration.test.ts` logs an
  expected fail-closed `context-overflow` assertion while its test passes;
  this is not a test failure or a live model request. The correction observer
  tests operate in disposable OS-temp fixtures, not the sealed workspace.
- Production build: `npm.cmd run build` (**`tsc && vite build`**) **passed**,
  Vite finished in 12.15s; nonfatal dynamic-import/plugin-timing notices.
- Native Rust tests: **not rerun** (no Rust source modified).
- No broad Vitest aggregate or known unrelated baseline failure repair.

Preserve the six original dirty user files, their hashes, both stashes,
`autonomous_tracker/`, operator settings, original ForgeBoard/Muse telemetry,
frozen workspaces, and acceptance verdict. Only this report and the two
offline forensic test files are eligible for the current evidence commit.
