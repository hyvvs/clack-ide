# Offline preparation-phase evidence collection readiness — 2026-11-09

## Scope and starting state

Verified starting HEAD `ea8a1878d754697c466409afccc64964e621b375`.
The preceding [preparation-lifecycle engineering checkpoint](CLACK_PREPARATION_LIFECYCLE_OFFLINE_2026-11-09.md)
and [shared engineering ledger](AGENT_ENGINEERING_STATE.md) agree with the
three commits `790a608`, `dee8371`, `ea8a187`. No prior compaction
forensics or verified broad lifecycle gates were repeated.

**Specific new gap demonstrated by production source inspection:**
`installPreparationObserver()` was only called by offline tests, not by any
running ForgeBoard evidence reporter. Thus a hypothetical live attempt using
the existing one-shot harness would have **zero durable new preparation-phase
records** despite production emitting those phases. The previous dated
one-shot runner additionally hard-codes the consumed November 8 run ID and
refuses reuse of an evidence-bearing directory. Changing that runner or
replaying it is neither needed nor authorized. The old frozen evidence is
not changed and cannot be retroactively supplemented.

## Task-owned offline result

Implemented and committed at
`75ec45839a3eb87907bd650ed68dc849a97aa7ca`:

- `src/test/preparationPhaseCapture.ts`: explicit *acceptance-only*, inert by
  default opt-in to the existing **production** phase observer. The subscriber
  copies only typed scalar fields and serializes acknowledgments in event
  order; limits to 2,048 events by default (hard cap 4,096). On delivery
  failure or overflow, it records an honest incomplete receipt, without
  throwing into inference or changing deadlines. `stop()` unsubscribes and
  awaits all pending acknowledgments. A hanging receipt endpoint can delay
  **collector shutdown**, never model inference or native cancellation.
- `scripts/preparation-phase-journal.mjs` (with `.d.mts` type surface):
  Node-only, standalone reporter component. **Does not launch or connect to a
  model, create a WebView, initialize a host or install a listener.** Its
  caller must provide an explicit fresh output path. The journal uses
  exclusive `wx` creation to refuse overwriting existing records, strict
  allowlisted phase names, fixed seven-field maximum schema, sequential
  record numbers, length-restricted run/request IDs, size limits, durable
  `FileHandle.sync()` before each acknowledgment, and a separate exclusive
  `*.receipt.json` containing collection-only count and SHA-256 (see the
  later byte-integrity and staged-publication follow-on below). A failed,
  dropped, overflowing, unsealed or interrupted capture has **no successful
  collector receipt**; partial JSONL is left visible, not erased or silently
  normalized. A receipt is a local capture-integrity marker, not an
  independent authenticated signature or proof of inference completion.
- `interpretPreparationPhaseRows()` validates the entire record sequence and
  optional collector receipt; **byte-exact verification also requires the
  original raw journal bytes, not just decoded JSON rows** as established in
  the later follow-on. With a fully acknowledged trace, one known
  observed run and exactly one observed linked native request, it may report
  the **observed JavaScript callback ordering** of native HTTP settlement and
  SDK JSON settlement. Otherwise ordering is **unknown**. In all cases
  inference progress remains `not-established` and ForgeBoard acceptance
  remains `not-evaluated`; a deadline-only trace cannot authorize a retry.

The producer, server journal and interpreter were exercised **offline** in
`src/test/preparationPhaseCapture.integration.test.ts` using the actual
production `createBoundedExtractor()` phase emissions with a mock extraction
call, real OS temporary files, and separately a real local-only HTTP receipt
roundtrip. These checks cover fsync-before-ACK, single observed request
ordering, missing or modified receipt, deadline-only failure, privacy fields
rejection, duplicate sequences, existing file refusal, delivery failure,
backpressure/overflow, and preservation of incomplete evidence. No actual
Muse call or ForgeBoard task was executed.

**Validation for this change only:**

| Offline gate | Result |
| --- | --- |
| `npm.cmd exec -- vitest run --exclude='**/src-tauri/target/**' src/test/preparationPhaseCapture.integration.test.ts` | 1 file, **6/6 passed** |
| `npm.cmd run check-types` | **Passed** |
| `npm.cmd run build` | **Passed**; existing nonfatal Vite dynamic import warnings |
| `node --check scripts/preparation-phase-journal.mjs` | **Passed** |

The historical 40-file/891-test lifetime suite and additional 17/17 forensic
rerun belong to **the prior checkpoint**. They were not rerun or relabeled as
new verification. No Rust code changed and no native Rust tests were needed.

## Future explicit authorization and integration contract

This is a **reusable opt-in facility**, not an installed/verified live recorder.
The older November 8 mission runner remains source- and evidence-frozen, and
its consumed ID must **never** be reused. A *newly authorized* fresh acceptance
runner must perform all of the following, before making claims about phase
coverage:

1. Install `startPreparationPhaseCapture()` **before** any model/calibration
   or Agent inference; supply a localhost-only reporter callback that POSTs
   `{ record }` to an explicitly new, run-owned route.
2. Initialize `createPreparationPhaseJournal(newOwnedFile)` with a fresh
   exclusive path, perform a non-model synthetic ACK self-test, and use the
   validated `journal.append(record)` as the receiver. Response ACKs must
   follow the synchronized append. Never include full prompts, model bodies,
   tool inputs or conversation content in phase evidence.
3. After the actual Agent terminal state and run/evidence synchronization,
   call `await capture.stop()` and `journal.seal(receipt)`; preserve failures,
   partial records and receipt absence. Do not equate a collector receipt with
   model progress, native transport correctness, task completion or acceptance.
   Associate native receipt IDs with the independent native HTTP events and
   use the existing separate, unchanged correction observer. For interpreting
   a completed capture, read the **raw JSONL file as a `Buffer`** and its
   separate receipt, parse the JSONL rows without rewriting the file, and call
   `interpretPreparationPhaseRows(rows, receipt, rawJournalBuffer)`. Without
   the original raw bytes, collection coverage is deliberately incomplete.
4. Use the unchanged original ForgeBoard specification and same-logical-Agent
   continuation. Only after genuine complete Agent-owned implementation and
   repair, perform **exactly one** independently frozen ForgeBoard acceptance
   evaluation if separately authorized. Do not repair the generated app by hand
   or assume a historical correction can be applied without proper eligibility.

These integration steps have **not** been installed in a new runnable live
runner or verified under a real WebView/Tauri/SDK/host lifecycle: such a run
requires new permission and a fresh evidence root. This checkpoint does not
claim the future harness is already automatically collecting. During offline
tests, local HTTP was only an ephemeral receipt server with mocked phase
events; it was not Ollama or an inference service. The current production
listener still records **nothing by default**.

## Preservation, classification and gate

No launch of ForgeBoard, `muse-glimmer:30b`, any other model, hosted inference,
notes acceptance or independent evaluator. No original script, generated app,
Ollama service, native stream-idle policy, deadline, operator settings, frozen
run root, archived file, protected dirty file, stash, or tracker was modified.
No reset, clean or push.

Historical findings are unchanged: **`COMPACTION TIMEOUT FAILURE UNRESOLVED`**,
native/SDK HTTP order **Case C**, and **`ONE FURTHER FORGEBOARD RETRY
JUSTIFIED: NO`**. The objective **`FORGEBOARD_PASS, LOCAL MUSE AGENT PROVEN`**
remains **NOT ACHIEVED**.

The remaining **external authorization blocker** is a genuinely new, explicit
authorization for one local `muse-glimmer:30b` ForgeBoard Agent mission with
the original spec, legitimate 50-to-25 correction-observer eligibility,
Agent-owned build/test/repair and one independent frozen evaluation after
genuine completion. A new permission does not by itself provide evidence for
the old historical timeout or reverse the standing `NO` retry assessment.

## 2026-11-09 follow-on: production native-to-SDK correlation verified offline

Verified entry HEAD: `83c06b00e9110d583b46a855a133f430695d87dd`.
The collector code, preceding six offline tests and original checkpoint were
already committed and preserved. This follow-on did **not** rerun historical
ForgeBoard/Muse inference, acceptance or broad unaffected lifecycle suites.

### Two concrete diagnostic defects, reproduced before correction

1. **The actual production Ollama nonstreaming SDK settlement omitted the
   native request ID.** A new regression exercised Clack's real
   `buildLanguageModel("ollama")` → `generateText()` → `doGenerate()` →
   `createProxyFetch()` → native Tauri bridge **with mocked native IPC, no
   HTTP/model inference**. Before correction, `native-request-linked` and
   `native-http-settled` carried the request ID, but `sdk-json-settled` did
   not. Thus a timestamp-only join could not meet the forensic proof standard.
2. **Interpretation required exactly one native request in the entire phase
   trace.** A focused regression with a prior native request and a later
   nonstreaming extraction failed to identify even a distinct, positively
   associated SDK JSON result. This would discard useful evidence in normal
   multi-request logical Agent runs.

A third lifecycle consequence was covered by regression: on cancellation,
extractor disposal previously removed its native diagnostic join immediately,
so a real *late* native terminal event could no longer be observed. The
production mock-native test now controls that event after cancellation and
disposal and verifies it is retained without restarting inference, publishing
claims or changing the cancellation result.

### Minimal correction and precise semantics

Committed source/tests: `0a69f54c48c62ba11fdffea12031158cbe9fec69`
(`fix(ai): correlate extraction SDK phases with native request receipts`).

- `preparationLifecycle.ts` keeps a **WeakMap keyed by the existing extraction
  AbortSignal** containing the captured session/run identity and at most the
  native ID learned directly from `native-id-linked`. A new extraction model
  attempt clears the previous ID before dispatch; SDK response headers, parsed
  JSON, validated provider frame and `generateText` settlement acquire this
  ID only through their real signal. Claim-validation and model-return phases
  use that same association. An arbitrary user-provided timestamp, metadata
  heartbeat or other session's request ID is not enough to establish a join.
- `compactionExtraction.ts` retains its **diagnostic-only** signal/native
  association after disposal while an already-dispatched model promise or
  linked native request is awaiting actual settlement. The connection is
  released when both settle. A native terminal event arriving after operator
  abort/timeout can be recorded even though the extraction itself failed.
  No native request is held open or triggered for observation, no local timer
  is reset, and an absent terminal callback is **not** invented.
- `preparation-phase-journal.mjs` adds `requestOrderings`, a per-request array
  of `{ nativeRequestId, ordering }`. A non-`unknown` ordering requires a
  sealed and fully acknowledged capture, a known run identity, **exactly one**
  same-run link, terminal observation and SDK JSON event for that *same*
  signal-derived native ID, plus their proper callback sequence. Uncorrelated
  JSON, duplicate links/terminals, missing receipts and reused IDs across runs
  remain `unknown`. The legacy top-level `nativeSdkOrdering` intentionally
  remains `unknown` when multiple native requests are linked; consult the
  per-request records instead. An independently observed native terminal
  does **not** assert HTTP 200, successful generation, or SDK JSON acceptance.

### Focused proof and no changes to policy

Initially the two newly written production path/interpretation tests failed
against the old implementation, demonstrating the gaps rather than inventing
new historical evidence. After correction:

| Validation | Actual result |
| --- | --- |
| Nine affected current-source files: extractor, real SDK/native mock integration, forensics, coordinator, Ollama adapter, native proxy, diagnostic joins and persisted phase capture | **176/176 passed** |
| `npm.cmd run check-types` | **Passed** |
| `npm.cmd run build` (`tsc && vite build`) | **Passed**; existing nonfatal Vite dynamic-import notices |
| Native Rust tests | Not rerun: **no Rust change** |

The integrated test uses **actual production** Clack model construction,
nonstreaming Ollama SDK, native proxy and bounded extractor (with deterministic
mocked Tauri events), then **actual** `startPreparationPhaseCapture()`,
exclusive disk journal, checksum receipt and `interpretPreparationPhaseRows()`.
It places an unrelated native event in the same run and proves only the
properly correlated extraction receives an observed native-before-SDK-JSON
ordering. Other tests check a second extraction request gets a different ID,
SDK events without native IDs stay unknown, and a late cancelled terminal
remains observable after extractor disposal. No conversation content enters
the journal. The 120s extractor deadline, native connect/first-output/idle/
overall policies, provider settings, cancellation semantics, memory CAS,
history and target protection are unchanged.

### Remaining external authorization gate

**Still opt-in, not installed in the consumed November 8 runner.** A future
fresh, separately authorized acceptance harness must install collection before
model/Agent execution, use a new exclusive evidence root, require durable
receipt acknowledgments and interpret each extraction by its actual native
request ID. It must separately preserve raw native transport status/phase and
the independent frozen evaluator verdict. A journal receipt reports only
collection integrity; no callback proves model-token progress, and the JS
callback order is not a monotonic native clock. Real WebView/Tauri/host
installation and genuine local Muse behavior remain untested.

Historical case remains **`COMPACTION TIMEOUT FAILURE UNRESOLVED`**, HTTP
ordering **Case C**, **`ONE FURTHER FORGEBOARD RETRY JUSTIFIED: NO`**. The
objective **`FORGEBOARD_PASS, LOCAL MUSE AGENT PROVEN`** is **NOT ACHIEVED**.
Only a new, explicit authorization may permit another local
`muse-glimmer:30b` Agent-owned ForgeBoard implementation with original spec,
legitimate correction observer, and exactly one independent frozen evaluation
after genuine completion. Do not reuse an old run ID, adjust Ollama/timeout
policy, manually repair a frozen app or alter historical evidence.

## 2026-11-09 follow-on: raw-byte integrity and atomic receipt publication

Starting HEAD was verified as
`43a7f01c7b9735cb60df1d9697abf7c25514cbc0`; both previous diagnostic
commits and this report were present. The previous **176/176 affected-source
tests, TypeScript and completed production build** were reconciled, not rerun
simply to refresh their totals.

### Two demonstrated evidence-integrity issues

1. **Incorrect byte-level receipt verification.** The journal hash is computed
   over each actual JSONL line as written and synced. Previously the
   interpreter parsed rows and reconstructed JSON before hashing. An offline
   regression deliberately changed a recorded line's whitespace without
   changing its JSON values; the **unchanged** receipt was falsely accepted
   as `collector-flushed`. The new assertion failed against the prior code.
   `interpretPreparationPhaseRows(rows, receipt, rawJournalBuffer)` now
   requires exact raw bytes from disk, validates their canonical JSONL shape,
   and hashes the original buffer; without raw bytes, or on any byte/hash/
   manifest mismatch, coverage is **`partial-or-unsealed`** and all native/
   SDK ordering claims remain **`unknown`**. A caller-supplied reconstructed
   buffer is not independently authenticated evidence; future collection
   must use `await readFile(exclusiveJournalPath)` on the preserved disk file.
2. **Final receipt could be written before its sync succeeded.** The previous
   finalizer opened `*.receipt.json` directly and wrote content before
   `FileHandle.sync()`, so a failed write/sync could leave an apparently valid
   final receipt. A preexisting receipt path also failed before its log file
   handle's `finally` cleanup. The finalizer now synchronizes the primary
   JSONL journal, writes a **new exclusive**
   `*.receipt.json.pending`, syncs and closes that staging file, and uses an
   **exclusive same-filesystem hard link** to publish the final
   `*.receipt.json` name. It then best-effort removes its own staging link;
   inability to remove that duplicate does not erase a successful receipt.
   Errors close the original journal handle, and `abandon()` is idempotent.
   Existing receipts and unfinished staging files are **never overwritten or
   silently deleted**. An interrupted or unsupported hard-link publication
   fails closed, preserving partial evidence and preventing a false completed
   receipt. Filesystem directory-entry durability across an unexpected power
   loss is **not independently proved**; neither this local receipt nor its
   SHA-256 is an authenticated external attestation.

### Validation and exact scope

Code and focused regressions committed at
`ffca72e23996eef1d11ac5bfc9ad66d697662431`
(`fix(ai): verify raw phase evidence and atomically publish receipts`).
Changes are restricted to the Node-only collector journal and declaration,
the existing phase capture integration test and the existing production
Ollama/native-bridge-to-journal integration test. No inference model, provider,
extractor timer, native transport, native Rust, memory CAS, Agent history,
target-context identity, continuation or correction-observer source changed.

| Affected offline gate | Outcome |
| --- | --- |
| Existing production Ollama/SDK/native-IPC mock → phase collector → durable JSONL/receipt interpreter | **8/8 passed** |
| Phase collector/journal raw-byte mutation, exclusive publication, existing final/staging collision, operator delivery failure and conservative ordering | **12/12 passed** |
| Total current-source tests across those two affected files | **20/20 passed** |
| TypeScript `npm.cmd run check-types` | **Passed** |
| Production `npm.cmd run build` (`tsc && vite build`) | **Passed**; existing nonfatal dynamic-import notices |
| Native Rust | **Not rerun**; no Rust source changed |

The final test-only addition was validated with another focused 20/20 rerun
and TypeScript; the production build had already passed after the journal
implementation. One earlier ad hoc test command omitted the archived-target
exclusion and also ran a three-test ignored baseline copy; those passed but
are **not** counted as current-source evidence. The final focused command
explicitly used `--exclude='**/src-tauri/target/**'`.

### Operational contract for a separately authorized run

In a **new** run-owned directory, install `startPreparationPhaseCapture()`
before any real inference, create `createPreparationPhaseJournal()` using a
fresh exclusive path, and acknowledge each phase only after its validated
append and sync. After actual Agent terminal settlement and evidence-drain,
call `await capture.stop()` and only then `journal.seal(receipt)`; on error
call `journal.abandon()` and retain all incomplete JSONL/staging evidence.
For verified interpretation, read the exact JSONL bytes (`Buffer`) and the
authoritative **final** `*.receipt.json` file, parse the rows, then pass
all three values to `interpretPreparationPhaseRows(rows, receipt, rawBytes)`.
Do **not** treat a `*.pending` staging file as a final receipt, manually
normalize/reformat archived JSONL, or reuse any historical acceptance path.

Captured phase names remain separate for extractor creation/deadline,
native terminal receipt, SDK JSON settlement, validated claims, memory load/
commit, target preparation and Agent failure settlement. A missing phase is
**not recorded**, not proof of stall or progress. Native HTTP settlement is
not an HTTP-200 proof by itself; source native event logs remain necessary.
The collector's observer is still opt-in, the consumed November 8 run is
unchanged, and a real WebView/native bridge/Muse capture under an authorized
fresh harness remains **unverified**.

The historical classification stays **`COMPACTION TIMEOUT FAILURE
UNRESOLVED`**, HTTP ordering **Case C**, and **`ONE FURTHER FORGEBOARD RETRY
JUSTIFIED: NO`**. Final **`FORGEBOARD_PASS, LOCAL MUSE AGENT PROVEN`** is
**NOT ACHIEVED**. New explicit authorization is required for one local
`muse-glimmer:30b` mission with the original ForgeBoard specification, the
verified historical digest, genuine correction-observer eligibility,
Agent-owned implementation/repair, and exactly one independently frozen
acceptance evaluation after genuine completion.
