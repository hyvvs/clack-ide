# ForgeBoard inference-15 — offline Clack context-capacity investigation

**Scope:** offline forensic reproduction and a minimal model-neutral Clack fix. No ForgeBoard retry; no Muse, other-model, hosted or synthetic inference; no Ollama or timeout change. Starting HEAD: **42966afce7285d223514bbdda86697db01036bf0**.

## Final classification

**GENERIC CLACK CONTEXT-CAPACITY FALLBACK DEFECT PROVEN**

The second ForgeBoard mission remains **FORGEBOARD INVALIDATED BY CLACK DEFECT**, not a valid Muse model verdict. Its frozen evaluation and original task were not rerun or modified.

## Exact root cause: measured request receipt expired between consecutive Agent steps

The saved, genuinely **measured** context-request receipt at **1793832999823 ms** established that Clack asked for 32,768 context. At inference-14 (1793833021086), the receipt was **21,263 ms old**, within the 30,000 ms runtime-evidence TTL. At inference-15 (1793833029834), it was **30,011 ms old**, **11 ms beyond TTL**. Meanwhile, last measured loaded context and allocation (observed 1793833000503) were **29,331 ms old** and still fresh, but could not independently establish Clack's intent to request 32,768 rather than an arbitrary lower allocation.

Source **contextCalibrationTrust.ts**: trustedContext / observedRequestedContext requires a fresh measured, same-identity requested-context receipt whenever the currently loaded tier (32,768) is below the genuinely calibrated highest tier (73,728). At 30,011 ms the predicate fails and snapshotContext returns undefined. **contextBudgetProfile.ts** then correctly refuses to promote a previous loaded context above 4,096 if the trusted working context is absent. **contextBudget.ts** resolveContextBudget falls through to the conservative UNKNOWN_CONTEXT_POLICY=4096 with provenance unknown-policy. Its assertRequestBudget throws context-overflow **before** the lower-tier selection and exact native-proof check are reached. This is the observed downgrade; 4,096 is *not* the model's measured capacity.

The **defect** is the missing refresh in production **requestPreflight.ts**, createRequestPreflight().observeOllamaRuntime: upon a real successful Ollama completion, it returned early whenever a cache snapshot was younger than 30 seconds and contained matching requested/loaded **values**, without checking the measured requested receipt's *own age*. Inference-14 completed at **1793833029752**; the receipt was then **29,929 ms old**, leaving only **71 ms**. It was skipped instead of refreshing genuine metadata. The next Agent inference started **82 ms** later. Inference-14→15 native-inspection events were exclusively self_hosted_probe_cache; no native self_hosted_probe refresh was issued, and the persisted receipt timestamp remained unchanged.

The original **30-second strict TTL is correct**; the bug was failing to renew an expiring genuine receipt through the existing read-only native metadata observation at the safe post-completion boundary, then misleadingly representing missing Agent trust as an ordinary context-overflow.

## Exact preserved identity, calibration and proofs

| Original evidence field | Original value |
| --- | --- |
| Provider / model / version | ollama / muse-glimmer:30b / 0.40.11 |
| Full digest | de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1 |
| Endpoint ID / URL | real-qwen / http://127.0.0.1:11438/ |
| Profile ID | ["real-qwen","muse-glimmer:30b",null] |
| Configuration revision / deployment | 1 / null |
| Runtime epoch | 40776:1793832712338782000 |
| Calibration ID | 9bc2ae35-e3ac-46b2-92fc-c5ea55bef30d |
| Calibration started, updated, expires (epoch ms) | 1793832713081 / 1793832781648 / 1793833681648 |
| Calibrated tiers (all seven successful loaded=requested) | 4096, 8192, 16384, 32768, 49152, 65536, 73728 |
| Primary 73728 native proof ID | 7a4774db-370c-42f5-803a-9316b57eb8a8 |
| Primary proof at / expires | 1793832823514 / 1793919223514 |
| Exact 32768 native proof ID | cb19394f-4fa7-4af8-ac6d-1a28486d16a0 |
| Lower proof at / expires | 1793832880781 / 1793919280781 |
| Final loaded context / at | 32768 / 1793833000503 |
| Final allocation observation / at | ["de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1",17500974609,13347743333] / 1793833000503 |
| Measured requested context / at | 32768 / 1793832999823 |
| Runtime-context control | per-request; observed 1793833000498 |
| Advertised max / observation | 131072 / 1793833000498; bound only, never measured context |
| Last persisted state revision | 388 |

All preserved proof scopes match the endpoint, full digest, model, deployment, configuration, provider version, runtime epoch and captured reasoning identity. Both real native tool proofs were **verified**, scoped to their **own** tiers and unexpired. The context calibration remained **verified**, with **651,814 ms** until expiry at inference-15. The recorded loaded context was 32,768; no evidence authorizes treating its 32,768 proof as a 73,728 proof. The live in-memory runtime observation timestamp at inference-15 **was not separately persisted**; it is **unknown**. The test fixture deliberately supplies a matching/fresh *mock* runtime to isolate the actual expired receipt; it does **not** claim this was the real runtime timestamp.

## Inference-14 versus inference-15

| Field | inference-14 | inference-15 |
| --- | --- | --- |
| Native request timestamp | 1793833021086 | 1793833029834 |
| Logical batch | initial-batch | initial-batch (no logical continuation) |
| Intended context/output | 32768 / 8192 | 32768 / 8192 |
| Tools/reasoning | 14 schemas, Automatic (think omitted) | Identical |
| Measured requested receipt age | 21,263 ms, valid | 30,011 ms, expired |
| Loaded/allocation observation age | 20,583 ms, valid | 29,331 ms, valid |
| Calibration / native proofs | Valid same records | Still unexpired, same identities |
| Trusted highest calibration (with matching runtime) | 73728 | undefined because lower-tier receipt expired |
| Trusted runtimeTarget from profile budget | 73728 | undefined |
| Selected eligible tier before HTTP | 32768 with its own proof | 32768 intended on serialized request; B1 throws before tier selection |
| Effective capacity | 32768 selected | 4096 unknown-policy fallback |
| Input estimate | **Not preserved** (do not infer) | 15,592 (system 4,729 + tools 6,499 + conversation 4,364) |
| Required capacity | Not independently recorded | 15,592 input + 8,192 output + 1,560 safety margin = **25,344** |
| Result | HTTP 200, provider done, EOF | Native future-dropped ~10.379ms, no HTTP dispatch |

The old terminal diagnostic said "Verify or configure this model's context capacity" and attached unverified capacity. In reality, it was a **trust freshness** failure rather than evidence that Muse could not fit 25,344 tokens.

## End-to-end Clack capacity path and fallback branches

1. **Agent step:** agent.ts runAgentStream uses captured selfHosted model identity and genuine Automatic selected native tools, prepared target context and 8192 output. The existing selected-tiers helper prefers the smallest tier that fits the entire request and has its **own** current proof. No change in context/allowance/schema/model across steps 14 and 15; no logical continuation.
2. **Model wrapper:** agent.ts buildConfiguredLanguageModel → buildLanguageModel → createRequestPreflight creates a private copy of the persisted state, looks up exact profile ID or captured endpoint plus transport-model ID; no evidence of normalized/raw-model mismatch or different provider record.
3. **Runtime and snapshot:** requestPreflight.ts refresh and contextRuntimeClient.ts validate identity/epoch/configuration and the 30-second runtime observation; selfHostedProbe.ts supplies cache and native metadata refresh. Exact runtime observation time at the failed step is absent, so not asserted.
4. **Calibration:** contextCalibrationTrust.ts trustedContext checks all identity keys, provider version, runtime identity, calibration TTL, reasoning metadata, measured requested lower-tier context, and subsequently observed allocation. Its lower-tier receipt predicate fails at **30,011 ms**.
5. **Profile resolution:** contextBudgetProfile.ts profileBudgetLimits sees missing snapshotContext, and for Ollama clears an unproved previously loaded tier greater than UNKNOWN_CONTEXT_POLICY, preserving fail-closed semantics. It does not take advertised model maxima as deployed proof.
6. **Generic budget resolver:** contextBudget.ts resolveContextBudget selects a verified runtimeTarget, deployed bound, validated manual assertion or supported reported capacity if available; if **all absent**, UNKNOWN_CONTEXT_POLICY **4096** and source unknown-policy. Additional theoretical/advertised/reported metadata constrain upper bounds but **never grant loaded capacity**. An endpoint/profile missing, stale/unconnected/identity-mismatched native snapshot, expired calibration, wrong epoch/digest/reasoning, stale allocation or expired measured request receipt can all make the Ollama working target unavailable. This particular failure is reproduced by **the expired measured receipt alone**.
7. **Serialized preflight:** requestPreflight.ts originally calls assertRequestBudget(limits(), body) before minimumSafeContext and final assertOllamaContextRoute. The false 4096 unknown-policy result caused a terminal context-overflow and future-dropped even though a fresh, matching tier would have supported the **25,344** required context.
8. **Missed post-completion renewal:** ollamaModel.ts calls config.onFinish on completed EOF, wired by agent.ts to requestPreflight.observeOllamaRuntime. It previously accepted a 29.929-second-old measured receipt by value alone; it never called native self_hosted_probe to renew the observation.

**Expiry relationship to recent calibration-renewal fix:** agentCalibrationRenewal.ts only renews calibration when expiry is within **30 seconds**. At inference-15 **651.814 seconds** remained. It did not run (zero renewal and zero logical continuation events). This defect is separate from the renewal code and does not indicate lost proof during continuation.

## Minimal model-neutral correction

Only production file modified: **src/modules/ai/lib/requestPreflight.ts**.

- Post-successful-inference observation requires a matching **measured** requested-context receipt whose age is younger than **25 seconds** before using the cached shortcut. A 5-second lead window triggers the **existing real native metadata refresh** for the genuinely selected tier after an actual completed inference. This refresh observes genuine loaded context/allocation; it does not generate inference, fabricate proof or change a TTL.
- If an Agent with previously verified calibration actually lacks trusted runtime context at a subsequent preflight, return explicit fail-closed **ollama-context-unverified** requalification guidance **before** a misleading generic 4096 context-overflow. Never bypass digest/epoch/configuration/native-proof/final routing checks.
- The generic 4096 conservative policy remains untouched for genuinely unverified requests. No ForgeBoard/Muse special case, no proof promotion, no native Rust, no timeout or model-parameter change.

## Offline reproduction and regression evidence

The new extractor **scripts/forgeboard-context-fixture-from-evidence-20261105.mjs** copies the original calibration, identities, exact proof IDs and timestamps from the private ignored run, omitting unrelated models, preferences, credentials, prompt contents and response bodies. The redacted fixture **src/modules/ai/lib/fixtures/forgeboardContextCapacityEvidence20261105.json** has original source settings SHA-256 **ee9c9e403c51912dd25ed94876e96f60a0c5b07700205759f7f2759be02f9ecd**. No trust record is invented; tests simulate read-only native metadata only, using mocked invoke, **never Ollama or model inference**.

**Nine new tests pass** in **forgeboardContextCapacityRegression.test.ts** using actual production trustedContext, snapshotContext, profileBudgetLimits, resolveContextBudget, minimumSafeContext, automaticAgentRecommendation, agentCalibrationRenewalDue, createRequestPreflight and native identity controls:

- Original saved state works at inference-14 and fails with original 4096 source unknown-policy at precisely inference-15, with a *matching fresh mock runtime* to isolate the old receipt.
- Real preserved 32768 proof and valid 32768 allocation make the full 15,592 + 8,192 + 1,560 budget fit, whereas 16,384 does not.
- Simulated *genuine metadata observation after a completed request* prevents collapse between consecutive initial Agent generations while preserving original proof/identity.
- Digest/epoch mismatch, expired calibration, absent lower-tier native proof, stale loaded context and absence of renewed receipt all block; 73728 proof is never lent to 32768. Real unverified models retain the 4096 conservative fallback.
- Logical Agent continuation remains pinned to its exact context. Existing calibration-renewal tests separately retain exact-tier identity and proof restrictions.

**Offline validation results:**

| Coverage | Result |
| --- | --- |
| New preserved-state regression | **9/9 PASS** |
| Targeted context budget, context preflight, calibration, native-proof, Agent configuration, continuation, output budget, tool verification suites | **738/738 PASS across 26 test files** (including Vitest-discovered ignored baseline duplicate test files) |
| Agent compaction integration cases other than unrelated key mismatch | **20/20 PASS**, **2 skipped** (two copies) |
| Full broader selection including that one failing case | **758/760 PASS**; 2 failures are the same target-context-key test in source and ignored baseline copy |
| Isolated rerun of that one test | Same two key mismatches reproduced independently |
| TypeScript, npm run check-types | **PASS** |
| Production npm run build (tsc + Vite) | **PASS**, Vite built in 10.90 s; only unrelated bundling warnings |
| Rust | Not run, because **no Rust code was modified** |

**Known broader-suite exception, not concealed:** the unrelated agentCompaction.integration.test.ts test "switches a large cloud conversation to a smaller endpoint and actually sends the staged target context" expects target-context key **eed094ae13f327059ef80b3f29f4f05bfbfcaa40409b72971fcc5df0a8f82717** but sees **4071548a9ddb9b57dbefd89079a0d0e7758446605838caf910620947b3f4825e**, at target_context_load in agent.ts **before either changed Ollama preflight/finish callback**. The same failure occurs in both test copies and the isolated rerun. A separate pre-fix baseline run was **not** performed, so its historical pass/fail state is **not proven**. The unrelated key-generation code was not altered.

## Recommendation and preservation

**ONE FURTHER FORGEBOARD RETRY JUSTIFIED: YES — RECOMMENDATION ONLY.** The observed generic failure is reproduced from preserved genuine trust data and the matching model-neutral repair passes all specifically relevant context/Agent/preflight tests plus TypeScript and production build. The independent broad-suite target-context-key failure remains a known caveat to resolve before claiming an entirely green monorepo. **No retry was launched, authorized or performed** in this task.

Starting HEAD and previous evidence commit were preserved. Only the production Clack fix, new redacted fixture/extractor, new offline test and this report are commit-eligible. All historical Muse notes, both ForgeBoard run roots, six protected dirty files, stashes, tracker, operator settings, and system Ollama remain intact. No reset, clean, push, hosted inference or native timeout changes.

During the final preservation audit, the previously approved original SSH PID 41860 was no longer present and original local port 11435 was not listening. The *same previously approved* strictly host-key-pinned, BatchMode SSH forward was therefore restored **only** for local 127.0.0.1:11435 → lab 127.0.0.1:11434, new Windows PID **34740**, with the existing key and known-hosts file. Its command-line identity and local port ownership were independently verified, and restoration was recorded in a **new ignored task-owned** diagnostic root: src-tauri/target/real-qwen-product/forgeboard-capacity-postmortem-20261105-01/original-forward-restoration.json. No Ollama requests or inference were sent to verify or restore the forward; no system service settings changed. The original historical SSH restoration receipt remained unmodified.
