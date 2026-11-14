# Agent compaction extraction: attempt deadlines and retry ownership

## Preserved ForgeBoard-03 boundary

The unmodified campaign `forgeboard-prod-muse-20261114-03` failed after its
one-time page-size correction. The native records show extraction
`inference-19` completed with HTTP 200 and 5,237 response-body bytes about
115.9 seconds after dispatch. Extraction `inference-20` began about 0.3
seconds later and was cancelled by a parent abort roughly 3.6 seconds later.
No compacted memory revision was published, and no subsequent Agent coding
request occurred. Campaign workspaces and evidence are not modified by this
repair. The precise validation failure inside `inference-19` was not captured;
the existing completed-response retry predicate is `compaction-invalid-output`.

## Before

`createBoundedExtractor()` started one 120,000 ms AbortController watchdog
when the extractor was created. Initial extraction, its allowed invalid-output
retry, later source chunks, SDK work and memory publication used the same
elapsed wall-clock window. An invalid response at ~116 seconds left a second
native extraction with only ~4 seconds. The coordinator's existing one-shot
smaller-prefix timeout recovery created a new extractor, but that fallback
cannot handle a completed *invalid* first response before its batch timer
expires.

## After (offline-validated policy)

- A model-backed extraction attempt gets a fresh **120,000 ms**, unchanged,
  when its SDK request is dispatched, including the existing invalid-output
  retry or the strictly smaller-prefix timeout fallback.
- Pre-dispatch source reads and completed model validation/native memory CAS
  remain guarded by a separately rearmed 120-second bounded work window.
  The extractor also has an absolute 20-minute safety ceiling, which is not
  an extension of any individual model request deadline.
- **At most five model-backed calls per logical `prepare()`**, across at most
  four intact source chunks and extractor replacements. **At most one extra
  attempt in total**, chosen between validation retry and smaller-prefix
  timeout retry; neither can multiply into a Cartesian retry tree.
- Before a validation retry, the preceding SDK/native call must settle;
  settlement uncertainty fails closed after the existing 5,000 ms join. The
  durable memory revision and preparation generation are reloaded and
  compared, and any active native write checkpoint is revalidated. The
  smaller-prefix timeout fallback retains those same checks.
- Explicit cancellation and stale owner/scope abort further requests. Tool
  effects are never replayed, protected/recent messages remain authoritative,
  and invalid/partial output is not committed. The charged Agent request/step
  budget and continuation count are not reset.

## Bounded observation, not inference content

`preparationLifecycle` emits an in-memory, opt-in `ExtractionAttemptObservation`
with preparation ID, ordinal, initial/validation-retry/smaller-prefix reason,
model-source and protected counts, estimated input tokens, configured 120,000
ms deadline, start/end time, SDK/native settlement, categorical validation
result and reason, and confirmation of an actual memory CAS commit. The
existing optional preparation-phase journal validates and captures these
scalars without prompt text, tool-result data, claims or quoted evidence.
There is **no automatic durable journal** unless a separate authorized
acceptance collector subscribes; do not infer missing events from a live
campaign that did not enable this capture.

## Deterministic qualification only

`agentCompactionRetryDeadline.test.ts` replays ForgeBoard-shaped protected
history and a completed but invalid extraction at a simulated 116-second
boundary. The second, same-source extraction remains alive at +4 seconds,
has its own full 120-second budget, validates and commits. Additional tests
cover a fresh smaller-prefix timeout fallback, exhausted retry budgets,
unsettled native work, operator cancellation, stale memory, changed write
checkpoint, and retained tool/history/Agent budgets. The production-shaped
native adapter and preparation journal are also exercised offline. None of
these offline checks is a live Muse or ForgeBoard acceptance pass.
