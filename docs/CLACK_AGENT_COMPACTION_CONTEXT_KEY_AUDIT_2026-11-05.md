# Agent-compaction target-context-key mismatch: offline root cause, correction and validation

**Starting HEAD:** 295aa70284acbbe2ba8cf42bbd04970d632d58a9.

**Final classification: GENERIC CLACK AGENT-COMPACTION CONTEXT-KEY DEFECT PROVEN.**

Scope limited to Clack's generic model-switch target-compaction preparation versus subsequent Agent execution. All validation is offline; no ForgeBoard attempt, Muse, other model, hosted inference, Ollama process/configuration change, or model request was launched. The previous ForgeBoard classification and frozen evaluation remain unchanged.

## 1. Exact isolated reproduction

Command before correction:

    npx vitest run src/modules/ai/lib/agentCompaction.integration.test.ts -t 'switches a large cloud conversation to a smaller endpoint and actually sends the staged target context'

**Both failed**, once in the current test and once in the untracked/ignored historical copy automatically discovered under src-tauri/target/clack-r5da-head-baseline-20261026/src/modules/ai/lib/agentCompaction.integration.test.ts. These were **one identical logical test**, not two independent root causes.

| Captured diagnostic | Value |
| --- | --- |
| Test suite | automatic compaction in the real agent request path |
| Test name | switches a large cloud conversation to a smaller endpoint and actually sends the staged target context |
| Staged/expected key | eed094ae13f327059ef80b3f29f4f05bfbfcaa40409b72971fcc5df0a8f82717 |
| Live Agent/actual key | 4071548a9ddb9b57dbefd89079a0d0e7758446605838caf910620947b3f4825e |
| Assertion | src/modules/ai/lib/agentCompaction.integration.test.ts:279 |
| Stack | targetContext.ts:72 loadTargetContext → agent.ts:1257 runAgentStream → integration test run():553 → test:744 |
| Native mock | target_context_load compares argument key to the key saved by earlier target_context_commit |

The test uses mocked provider replies and a mocked native Tauri IPC; it does **not** contact a model. An isolated rerun established both failures with the same exact hashes.

## 2. Complete production target-context key derivation

The target-context key is a **compatibility/authorization fingerprint for a staged, extracted conversation-memory revision**, not a model capability measurement, provider route, KV-allocation handle, or an Agent continuation token. Native target-context storage must reuse prepared evidence only if its key matches the new request's exact preparation contract.

Both paths call the **same** production targetContext.ts targetContextKey(): SHA-256 of canonicalJson of:

- Versioned policy **c2-target-v1** and extraction **c1b-extraction-v1**.
- Model selection ID; resolveModelTransportIdentity(modelId, config) (provider ID, transport model, self-hosted endpoint/profile/configuration revision or compatible endpoint URL, where applicable).
- Captured effort control or provider-default.
- Exact system messages; selected tool exposure identity and schemas; **entire BudgetLimits**, including outputReserve; model input capabilities; permissions; workspace + agent; credential/authorization revision material.
- Entire config.selfHostedInference, customEndpoints, savedProviderModels and configured local provider URLs. The full self-hosted calibration/proof records include **model digest, runtime epoch, provider version, selected-context proof tier, calibration TTL, latest allocation and measured context-receipt evidence**. They are *indirect* parts of the hash, not independently named top-level key fields.

**Not directly hashed:** Agent session ID, inference run ID, logical continuation batch index, and the final chosen Ollama num_ctx as a separate field. The selected tier is bound instead through the captured profile/native proof and its budget limits; the actual native request still performs independent exact-tier/pre-dispatch verification. Changing an actual trust record conservatively invalidates an old staged key; **a new key does not grant context capacity**.

Producer path:

    prepareModelSwitch
      → modelSwitch.ts builds the target model and exact system/tool context
      → targetPreparation.ts prepareTarget: captureEffort + modelBudgetLimits
      → prepareToolExposure + targetContextKey
      → native target_context_commit atomically publishes staged revision with key

Consumer path:

    runAgentStream
      → buildConfiguredLanguageModel
      → agentLimits() computes prospective Agent output allowance
      → prepareToolExposure, stabilized Agent system messages
      → targetContextKey
      → native target_context_load(owner, key)
      → createConversationCompactor(targetSeed, ...) if matching

The compactor can only reuse saved extracted context when the key is equal; a different key means the old revision must not be blindly admitted, regardless of whether the model and endpoint appear identical.

## 3. Exact source of the mismatch (all other operands held constant)

A **temporary, removed** test-only wrapper around the real targetContextKey hashed each input group at the staging and Agent call sites. It produced three key captures (two identical staging calls plus one Agent load). Their hashes for model ID, system, tools, capabilities, permissions, workspace, credentials, effort, profiles, endpoints, saved model identities and provider URLs were **all identical**.

**Only the budget object differed:**

| Input | Staged model-switch preparation | Executing Agent |
| --- | --- | --- |
| limits | {"asserted":20000} | {"asserted":20000,"outputReserve":2048} |
| limits SHA-256 | 32b7a53e49ab6523d606f7106fce8d7e06e817687ef44b7251f4fc07776af10c | 1ca9d35628afc8335e55ee3716fe7ef6e7b562d3c9a47f2c780d18e61ba10484 |
| Resulting key | eed094ae...82717 | 4071548a...4825e |

Specifically, **targetPreparation.ts:134** originally passed the raw modelBudgetLimits(model) to targetContextKey, the compactor and final staging budget. **agent.ts:932–939** used a separate Agent-specific output-reserve calculation: resolveAgentOutputBudget() / an ordinary-output fallback, then outputReserve=max(model outputReserve, Agent allowance). In this fixture Agent execution required **2,048** output tokens, while the staged key omitted that reserve.

**Correct semantics:** the keys *should differ if the output contract really differs*. The key was correctly rejecting an incompatible staging contract; the **production defect** was that pre-switch preparation did not account for the actual Agent output reserve. Simply changing the test expectation, dropping outputReserve from the key, borrowing the staged context anyway, or hardcoding the expected hash would be unsafe.

**Real effect:** staged, potentially expensive conversation-memory extraction was keyed for an incomplete budget. The subsequent Agent could not reuse that exact committed snapshot, causing a redundant re-preparation or loss of staged-seed reuse, and the earlier fit calculation had not reserved the output actually needed. There is no evidence the mismatch selected a different provider/model/digest/runtime epoch or directly forced the 4,096 unverified capacity fallback: that was a separate, now-corrected context-evidence TTL defect. The target key is not a capacity resolver.

## 4. Historical causality versus recent context fixes

Git blame/history established this path without reverting, checking out or resetting:

| Date / commit | Relevant change |
| --- | --- |
| 2026-09-27 / 2816065681a92434b4d2674360948abaf260500c | targetPreparation.ts stage uses raw modelBudgetLimits, including key and budget |
| 2026-10-07 / 3deb12c9 | tool-exposure contract used by Agent-compaction integration test |
| 2026-10-25 / 3f5b333a9e25234b6f87c61e1efeb5931a59b475 | Agent introduced a bounded special output reserve for thinking/native tool turns |
| 2026-10-29 / 72b6ffdc68b2b4462976f0faada371c6fa8530b6 | Agent refined hosted reasoning output promotion and tool exposure gating |
| 2026-11-04 / fe918e8569415e0b77f2c5e873d0e19554db3079 | Separate long-running calibration-renewal lifecycle |
| 2026-11-05 / 295aa70284acbbe2ba8cf42bbd04970d632d58a9 | Separate measured-context-receipt freshness correction |

The staged/Agent output-budget divergence **predates** the November renewal and requested-context receipt fix. Neither alters the generic targetContextKey algorithm or explains the only differing operand, outputReserve. Logical continuation uses its own retained native proof and final context allocation validation, likewise unchanged by the repair.

## 5. Smallest generic production correction

Added one **pure** agentBudgetLimits() helper to existing agentOutputBudget.ts, reusing the original resolveAgentOutputBudget and fallback behavior. The existing Agent now calls it, with the same exposed-tool flag and required output. **No Agent allowance policy was relaxed.**

targetPreparation.ts now uses **the identical Agent budget projection**:

1. When preparing tool exposure (unknown final tool count, as in the Agent).
2. After the actual selected tools are known, for the targetContextKey and compaction/budget calculation.
3. At final staged target commit, to revalidate the same allowance and protect against drift.

No changes to targetContextKey's hash format, canonicalization, credentials, identity, calibration trust, context provenance, native proof, pre-dispatch guard, timeout, Rust/Ollama or model-specific behavior. The old integration-test assertion is unchanged; both isolated instances **now pass** with equivalent contracts.

## 6. Ten requested offline controls and results

New source test: src/modules/ai/lib/agentCompactionContextKey.test.ts. Uses actual production targetContextKey, agentBudgetLimits, profileBudgetLimits, freshVerifiedContextTiers, minimumSafeContext, automaticAgentRecommendation, agentCalibrationRenewalDue and requireAgentContinuationAllocation. It reuses the **previously preserved, real, credential-free diagnostic calibration/proof fixture**, with a *matching test runtime observation* only to isolate trust predicates; no trust records or model outputs are fabricated as production observations.

| Control | Result |
| --- | --- |
| 1. Stable provider/model/digest/runtime and same actual Agent output contract produce same stage/run key | **PASS** |
| 2. Real 32K native proof/loaded allocation supports the entire ~25.3K budget and keeps selection at 32K | **PASS** |
| 3. Verified 73,728 tier never replaces eligible lower 32K; missing lower proof blocks borrowing | **PASS** |
| 4. Digest change rejects captured selection and invalidates key, context and proof | **PASS** |
| 5. Runtime epoch mismatch invalidates context/proof; changed recorded epoch changes key | **PASS** |
| 6. Provider, model and endpoint identity changes invalidate respective keys | **PASS** |
| 7. Safe calibration renewal does not gratuitously mutate key at original timestamp; genuinely different persisted calibration snapshot conservatively invalidates cached key | **PASS** |
| 8. Fresh matching requested-context metadata does not promote 32K to 73K; changed persisted observations conservatively invalidate old snapshot reuse, **while 32K proof remains valid** | **PASS** |
| 9. Logical continuation retains exact native 32K proof and refuses an unexpectedly different live allocation | **PASS** |
| 10. A changed output-budget key does not itself change trusted runtime capacity into the unrelated 4K unverified fallback | **PASS** |

An eleventh test checks required-output allowances, explicit caps and absence of promotion with the same Agent policy.

**Important distinction:** hashing the full self-hosted profile means *actual calibration renewal or metadata refresh can legitimately invalidate the old staged key*. This is conservative cache invalidation, not an error and not a new capacity measurement. The test does **not** grant a new calibration or pretend a hypothetical metadata timestamp was observed by Ollama. Preflight must still independently prove the current selected tier.

## 7. Offline validation

| Execution | Result |
| --- | --- |
| Isolated original integration case, before correction | **2 failed** (same source and archived baseline duplicate) |
| Isolated original integration case, after correction | **2 passed**; original assertion unchanged |
| New standalone safety controls | **11/11 passed** |
| All requested relevant current-source Agent-compaction, target-context, model-switch, context/trust, preflight, calibration, native-proof, output-budget and continuation test files | **522/522 passed across 22 files** |
| TypeScript check: npm run check-types | **PASS** |
| Production build: npm run build | **PASS**; Vite built in 10.70 seconds; existing nonfatal dynamic-import/plugin warnings |
| Rust | Not run: no Rust source touched |

Scope and historical test discovery: an initial unfiltered multi-suite invocation also auto-discovered **ignored** old baseline files under src-tauri/target/clack-r5da-head-baseline-20261026. It reported **955/965 passed**, with **10 failures exclusively in old archived model-switch tests** asserting historical behavior against today's imported production code. Corresponding **current source tests all passed**. The archived snapshot was not altered, and these unrelated archival expectations were excluded from the authoritative relevant-source rerun using --exclude '**/src-tauri/target/**'. Exact offline test/build logs reside solely in the ignored task-owned diagnostic root src-tauri/target/real-qwen-product/compaction-context-key-audit-20261105-01/.

## 8. ForgeBoard status, recommendation and preservation

**ONE FURTHER FORGEBOARD RETRY JUSTIFIED: YES — RECOMMENDATION ONLY.**

The mismatch was a genuine generic Clack staging/Agent budget-contract defect, now corrected and offline-verified. The previously frozen ForgeBoard execution remains **FORGEBOARD INVALIDATED BY CLACK DEFECT**; no new inference was sent and this report does not assess Muse capability. Future live work requires a separate explicit authorization.

Only the shared generic Agent-budget helper, two call sites (Agent and target preparation), an offline test file and this report were changed in tracked files. No user settings, Ollama, original mission/observer, frozen evaluation, historical acceptance evidence, Git stash, tracker or six protected dirty files were changed. No reset, clean, push or unrelated test modifications. Starting HEAD is the exact required parent of this task's correction/evidence commit, whose final hash is reported after the last verification.

**Original SSH forward preservation:** The previously approved original local 127.0.0.1:11435 → lab 127.0.0.1:11434 forward (historical restored PID 34740) had exited before the final audit. The *same* original identity, key, pinned known-hosts, strict host-key checking and BatchMode settings were used to restore **only** that original forward as Windows PID **33052**. Its command-line identity and 127.0.0.1:11435 ownership were verified; two unrelated live SSH connections were not touched. This restoration and zero Ollama/model requests are recorded under the **ignored, new, task-owned** diagnostic root as original-forward-restoration.json. Port 11438 remains closed; no Ollama/system service settings changed.
