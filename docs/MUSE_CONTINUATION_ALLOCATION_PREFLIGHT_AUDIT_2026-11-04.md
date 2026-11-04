# Offline audit: Muse continuation allocation preflight (2026-11-04)

## Decision

**Final classification: `CONTINUATION ALLOCATION PROTECTION OPERATED CORRECTLY`.**

The concrete expired object was the **original seven-tier context-calibration record**, **not** the recently persisted Ollama loaded-context/allocation metadata. The error name `ollama-continuation-allocation-stale` is a broad continuation-eligibility diagnostic: the final gate checks both the pinned context equality **and** `freshVerifiedContextTiers`, whose calibration-validity requirement failed. The exact persisted state was reproduced with actual production eligibility/preflight functions, mocked native IPC, and no inference. Because final native cache response contents were not preserved, this reproduction uses a favorable, matching cache snapshot; the expired calibration still blocks it.

**Generic Clack defect proven: NO.** A matching fresh allocation observation was available and was used in the saved model snapshot; it cannot legally extend a calibration lease or regenerate native-tool proof. No supported non-inference allocation metadata refresh can renew the expired seven-tier calibration. The terminal rejection was fail-closed under the existing production trust contract. **No production fix, model-specific exception, TTL change or guard weakening.**

**Final Muse status remains `UNINTERRUPTED MODEL ACCEPTANCE NOT PROVEN`.** The Agent ended `failed`, and the independent frozen notes application still failed `npm test` and lacked a README. No replay, rerun, model use, Ollama alteration or ForgeBoard occurred in this audit.

## Evidence sources and limits

Frozen source HEAD on entry: `3b4975f712b7fa7f82686cfaf318a228ed7cae0e`. Consult the prior correlated report `docs/MUSE_PARALLEL_TRACE_FINAL_NOTES_2026-11-03.md`, its 37-row CSV, and these ignored, **unchanged** mission receipts:

- `src-tauri/target/real-qwen-product/museparallelnotes-20261103-01/data/terax-settings.json` — persisted `selfHostedInference` profile, evidence, calibration and exact-tier proof.
- `.../data/terax-ai-sessions.json` — Agent terminal state/error and continuation count.
- `.../mission-a-1.requests.jsonl` and `mission-a-1.receive.jsonl` — request IDs, native dispatch stages, timing and wire allocations.
- `.../mission-a-1.native-inspection.jsonl` — **command names and invocation times**, **not runtime response bodies**. Therefore the **actual last returned runtime epoch, runtime observation's own `at` and snapshot's exact `observedAt` at inference-37 are not independently recoverable** from that file.

The offline control below deliberately assumes the last runtime inspection's returned epoch was identical to the calibration/proof scope. This **most-favorable** assumption reproduces the refusal; it does not assert that the omitted IPC response contained that value. No provider/shared generation ID beyond `inference-37` can be recovered.

## Preserved inference-37 state

Event anchors are local CET, 2026-11-03. Epoch milliseconds are recorded explicitly so this does not rely on rounding:

| Field | Recovered value | Basis |
| --- | --- | --- |
| Native request / Agent batch | `inference-37` / logical continuation; last attempt of 27 Agent attempts | `mission-a-1.requests.jsonl` |
| Model | `muse-glimmer:30b` | Native wire and persisted Agent |
| Full digest | `de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1` | Profile/snapshot evidence |
| Provider/version | local Ollama `0.40.11` | Calibration and tool proof scope; system remained local |
| Recorded runtime epoch | `38192:1793691420993904400` | **Calibration and 49K proof scope**; final runtime IPC response body absent |
| Endpoint/configuration | `real-qwen`; configuration revision `1`; deployment `null` | Persisted profile |
| Context/output | `num_ctx=49,152`; `num_predict=6,144` | Exact native serialization |
| Schema / reasoning | `17` genuine native tool schemas; `think` absent, captured Automatic choice | Wire and persisted run |
| Required input tokens | **Not recorded** as a complete measured request-cost/budget operand. Cannot calculate from context, output allowance or tool count; do not invent a prompt-token number. | Sanitized wire receipt only |
| Pinned continuation context | `49,152`, via the retained 49K exact-tier proof and `requiredRuntimeContext` | Production continuation call chain; wire and proof |
| Calibration record | `f04bdb54-f8ca-4d82-a64a-0d8b99199c82`; `status=verified`, `highest=73,728` | Persisted calibration |
| Calibrated successful tiers | `4,096; 8,192; 16,384; 32,768; 49,152; 65,536; 73,728` | Seven saved successful attempts |
| Tiers eligible at final gate | **Empty `[]`**, because calibrated trust expired; not because the successful attempts vanished | `freshVerifiedContextTiers` offline reproduction |
| Calibration updated | `1793691495881` = 08:38:15.881 | Persisted calibration |
| Calibration expires | `1793692395881` = **08:53:15.881** | Persisted calibration |
| Native final request registered | `1793692399198` = 08:53:19.198 | Native request record |
| Native preflight event | `1793692399200` = 08:53:19.200 | `native-ipc-ready` |
| Calibration age at preflight | **903,319 ms** (15m 03.319s); 15-minute limit exceeded by **3,319 ms** | 2399200 minus 1495881 / 2395881 |
| Exact-tier native-tool proof | `8c4d3d97-4abe-415c-9602-5bacba6e8dea` at 49,152; `status=verified`, `native-call` | `agentToolTierProofs` |
| Native proof timestamp / deadline | `1793692191619` / `1793778591619` | Persisted proof; 24-hour proof lease |
| Proof age at preflight | **207,581 ms** (~3m 27.581s), substantially below 24 hours | Saved proof |
| Fresh Clack-issued requested-context receipt | `49,152` at `1793692398478`, age **722 ms** | `probe.requestedContext`, `measured/observed` |
| Fresh loaded-context and allocation | `probe.loaded=true`, `loadedContext=49,152` and nonempty allocation string, observed `1793692399075` = 08:53:19.075 | `backend-reported/reported` |
| Allocation observation age at preflight | **125 ms**, versus strict **30,000 ms** maximum | `CONTEXT_CALIBRATION.runtimeMs` |
| Allocation identifier | `["de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1",17551306257,13656234392]` | Fresh persisted `runtimeAllocation` |
| Runtime inspection invocation | `1793692399103` = 08:53:19.103, **97 ms** before native IPC ready | Native inspection command log; **not** the response's own observation time |
| Runtime observation age | **Not recoverable exactly**: command invocation and fresh calibration-scope identity are available, but response's `at`/epoch were not persisted | Do not substitute invocation age |
| Continuation eligibility | One automatic continuation, `continuationCount=1`, required exact retained 49K proof; Agent ultimately `failed` | Persisted Agent session |

The calibration status field remaining `verified` is not enough: `trustedContext` independently requires `expiresAt > now`. Fresh snapshot/runtime and a valid tool proof do **not** make the calibration fresh.

## Exact source predicate and ordering

1. `src/modules/ai/lib/contextCalibrationSchema.ts:3-15` sets `evidenceMs=15*60_000` and `runtimeMs=30_000`. The separate tool proof lease is 24 hours in the persisted record and `toolVerification` contract.
2. `src/modules/ai/lib/contextCalibrationTrust.ts:97-155` computes `trustedContext`. Its explicit disqualifier is **`record.expiresAt <= now` (line 131)**, among separately evaluated runtime-epoch/version, model/digest, reasoning and live allocation checks. This occurs **before** the smaller-per-request allocation compatibility branch (lines 136-150). The matching fresh measured `requestedContext=49,152`, subsequent reported loaded context/allocation and a previously calibrated 49K tier would otherwise meet that branch, provided independent runtime identity remained valid.
3. `src/modules/ai/lib/contextCalibrationTrust.ts:156-188` combines model snapshot and `trustedContext`. `src/modules/ai/lib/minimumSafeContext.ts:7-20` returns **`[]`** when `snapshotContext` is undefined or the complete current calibration is not verified.
4. `src/modules/ai/lib/agent.ts:841-894` chooses the retained exact tier and proof for the logical continuation. `agent.ts:936-944` and `agentConfiguration.ts:360-371` require the pinned context to equal the live budget context. The failure is **not** this earlier JavaScript guard; the persisted error code identifies the later native request preflight.
5. `src/modules/ai/lib/requestPreflight.ts:214-268` performs ordinary initial runtime inspection and cached-probe read, conditionally forcing a **metadata** probe if its 30-second snapshot is stale. `requestPreflight.ts:398-471` then calculates the request and preserves `requiredRuntimeContext`. On the final pre-dispatch closure, `requestPreflight.ts:509-559` re-reads the provider cache and checks **`currentTarget !== requiredRuntimeContext || !freshVerifiedContextTiers(state,profile,snapshot).includes(requiredRuntimeContext)`**. This throws **`ollama-continuation-allocation-stale`** (lines 553-558). A later `requestPreflight.ts:563-588` separately checks that the retained native-tool proof is still current.
6. `requestPreflight.ts:610-626` provides a post-request optional probe/metadata refresh. `agentConfiguration.ts:30-141` provides bounded runtime-identity reinspection **only when runtime evidence has aged 30 seconds**, but explicitly requires already-unexpired calibration/proof (lines 59-96). Neither path re-runs seven calibration requests or implicitly extends `contextCalibration.expiresAt`. This is **intentional fail-closed separation** of metadata versus inference-based calibration.

### Was refresh skipped or ordered incorrectly?

**No ordering defect established.** Native receipts show a `self_hosted_probe` command at **08:53:18.477**, a `self_hosted_context_runtime` inspection at **08:53:19.103** and several `self_hosted_probe_cache` reads up to **08:53:19.206**. The saved 49,152 loaded context and allocation were observed at **08:53:19.075**. Thus fresh provider allocation metadata was persisted and a subsequent cache read was invoked; the **contents** of the final cache reply are not preserved. Even granting that most favorable matching reply, the calibration was expired and the production guard correctly rejects it. There is no evidence that a newer valid **calibration** receipt existed and was overlooked; the persisted original calibration expired. A calibration refresh would require separate permitted calibration inferences, **not** a safe transparent metadata refresh inside a single already-authorized logical continuation.

The native transport shows only `native-ipc-ready` followed by `future-dropped` after ~10 ms, without `request-built`, `dispatch`, `reqwest.send`, headers or an Ollama HTTP request. That aligns with the deliberate final pre-dispatch protection, rather than network/scheduler failure.

## Immediately preceding successful request and long-generation effect

| Field | `inference-36` (successful) | `inference-37` (blocked) |
| --- | --- | --- |
| Native request at | **08:53:08.997** (`1793692388997`) | **08:53:19.198** (`1793692399198`) |
| Wire context/output | **49,152 / 6,144** | **49,152 / 6,144** |
| Tools | **17** | **17** |
| Model/digest | Same selected Muse profile | Same selected Muse profile |
| Recorded calibration/proof scope | Same epoch/version/digest from persisted profile | Same persisted scope; actual final runtime response body unavailable |
| 49K proof | Same verified tier record, valid for 24 hours | Same record, age 207,581 ms |
| Calibration age at request | **893,116 ms**, with **6,884 ms remaining** | **903,317 ms**, **3,317 ms past expiry** |
| Snapshot/allocation | Successful request and follow-up native observation; exact earlier snapshot age not preserved | Fresh 49K loaded/allocation age ~125 ms at native IPC |
| Transport | HTTP 200, provider done and EOF at **08:53:18.468** | Never dispatched; future dropped |

The one automatic logical-continuation **batch** began at approximately **08:52:39**, while the original calibration was still eligible. It retained the exact 49K proof/context and produced `inference-35`, `inference-36` and `inference-37`; it did **not** select a new proof for every generation. The immediately previous generation **began before** the calibration expired but **finished about 2,587 ms after expiry**. A running, already-admitted HTTP stream is not cancelled merely because the original calibration's validity lease expires mid-generation. The *new* inference request is revalidated, correctly refusing a now-expired calibration. This batch-versus-per-request boundary explains why successful `inference-36` and rejected `inference-37` can share context, output, tool inventory and retained proof.

The earlier **145,308 ms** completed `inference-25` and **143,997 ms** post-header stream gap also consumed elapsed wall-clock time, but **neither** caused its own separate error. The expiry is strictly based on the saved calibration `updatedAt/expiresAt`, not on stream inactivity, output gaps or special long-generation handling. A sufficiently long uninterrupted Agent can therefore outlive a fixed 15-minute calibration lease by design. Unlike a stale 30-second allocation observation, this trust cannot be silently renewed by metadata. The current contract prefers a terminal stop to new unverified inference; it does not provide safe implicit multi-tier recalibration within the same continuing run.

## Offline reproduction and negative controls

The audit fixture `scripts/muse-continuation-allocation-offline-20261104.test.ts` reads the **actual** preserved `terax-settings.json`, uses production `freshVerifiedContextTiers`, `automaticAgentRecommendation` and `createRequestPreflight`, and **mocks all Tauri native IPC**. There are **no** model requests, HTTP calls, Ollama changes, or calibration/verifier runs. It assumes the saved epoch/version matched the most recent runtime inspection to isolate the known expiry.

| Controlled case | Result |
| --- | --- |
| Exact preserved calibration, current loaded allocation and favorable matching epoch | **`ollama-continuation-allocation-stale`** reproduced |
| New allocation evidence, unchanged expired calibration | Still blocked; allocation is independent |
| Same complete identity/loaded allocation/proof, **hypothetically unexpired calibration** | Eligible, final preflight closure passes |
| Changed runtime epoch | Blocked |
| Changed model digest | Blocked |
| Different actual loaded context | Blocked |
| Expired 49K tool proof despite otherwise valid calibration/allocation | **`agent-tool-proof-stale`** |
| Proof replaced between `prepare` and final dispatch revalidation | **`agent-tool-proof-stale`** |

The unexpired calibration variant is an **isolating counterfactual** that changes a private fixture copy of `expiresAt`. **It does not show that production can or should extend a calibration without the required real calibration operations.** The exact-state reproduction is affirmative evidence that the expiration alone suffices even when the returned runtime epoch is assumed favorable. There is no observed malformed state selection or missing allocation refresh that warrants a fix.

Testing also verifies that a fresh cache does **not** trigger extra probing loops in the success counterfactual and that the final closure revalidates proof immediately before any simulated dispatch. No Rust code changed; no Rust tests were needed. See the actual test/build command outcomes below and the commit for the preserved offline-only fixture.

## Validation, preservation and final decision

- Task-only offline regression fixture: **8/8 PASS**.
- Offline Vitest command: `node_modules/.bin/vitest.cmd run src/modules/ai/lib/requestPreflight.test.ts src/modules/ai/lib/minimumSafeContext.test.ts src/modules/ai/lib/agentConfiguration.test.ts src/modules/ai/lib/contextCalibration.test.ts src/modules/ai/lib/toolVerification.test.ts scripts/muse-continuation-allocation-offline-20261104.test.ts --reporter=dot`. **11 discovered test files / 404 tests PASS** (Vitest also discovered matching historical target-tree copies). Existing suites mock native/model behavior and did **not** contact Ollama or perform inference. The fixture itself mocks all Tauri IPC.
- `npm run check-types`: **PASS (exit 0)**. `npm run build` (TypeScript and Vite production bundle): **PASS (exit 0)**; Vite printed non-fatal import/chunk warnings. These are Clack build checks, **not** a rerun of the frozen notes application evaluator.
- Production fix: **none**. The unchanged production safety gate correctly rejected an expired calibration. The error's “allocation stale” wording can refer broadly to the whole context/lease eligibility check; a future diagnostic refinement could distinguish calibration expiry from loaded-allocation freshness without weakening the gate, but is **not** needed or authorized as a behavior change here.
- Do not rerun Muse, another model, ForgeBoard, frozen evaluation or any inference; no Ollama service changes, no reset/clean/push. Preserve historical receipts, protected dirty tracked SHA-256s, original stashes, tracker and operator settings.

**Classification: `CONTINUATION ALLOCATION PROTECTION OPERATED CORRECTLY`.**

**Muse acceptance: `UNINTERRUPTED MODEL ACCEPTANCE NOT PROVEN`; frozen application verdict `NOTES_APP_FAIL`.**
