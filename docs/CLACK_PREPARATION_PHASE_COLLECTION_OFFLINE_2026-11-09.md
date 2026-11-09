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
  `*.receipt.json` containing collection-only count and SHA-256. A failed,
  dropped, overflowing, unsealed or interrupted capture has **no successful
  collector receipt**; partial JSONL is left visible, not erased or silently
  normalized. A receipt is a local capture-integrity marker, not an
  independent authenticated signature or proof of inference completion.
- `interpretPreparationPhaseRows()` validates the entire record sequence and
  optional collector receipt. With a fully acknowledged trace, one known
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
   use the existing separate, unchanged correction observer.
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
