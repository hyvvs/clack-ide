# R5de acceptance-only continuation-output guard repair (offline)

**Prior mission:** `museglimmer-r5de-notes-20261027-01`. **Starting HEAD:** `556ae5cccf1abde7fc39980b8d694ea98dee5348`. **Scope:** acceptance-harness sources and offline tests only. No Muse/model inference, Agent retry, frozen evaluation rerun, ForgeBoard, production policy change, or push.

## Decisive old assertion and corrected behavior

The previous acceptance-only Rust guard in `src-tauri/examples/r5de_acceptance.rs` required **`output == contract.agent.output`** for every guarded Agent request. `contract.agent.output` was a single initial-batch **8192**, even though production's following logical batch pinned an independently verified **49152** runtime tier and its `resolveAgentOutputBudget` returned **6144**. Consequently the old host rejected `inference-35` before `handler(invoke)`; no Ollama inference started for it.

The corrected harness receives **two different, production-derived policy scopes**:

1. The original Agent batch's allowance is computed by importing the actual TypeScript `resolveAgentOutputBudget` for its original trusted upper-tier planning context (73728, yielding 8192). Production `minimumSafeContext` can send this 8192 allowance with a *smaller* verified serialized tier, as observed in the prior 32768/8192 and 49152/8192 steps. It would be incorrect to recompute these first-batch requests solely from serialized `num_ctx`.
2. A logical-continuation batch pins a verified target tier and recomputes its own output allowance. The acceptance runner imports `resolveAgentOutputBudget` for every bounded calibration candidate, supplies the exact `context → output` contract, and supplies the production continuation system suffix (locked to `agent.ts` by an offline parity test). The Rust host selects the corresponding output **only when that continuation suffix is observed in the serialized system message**; a possible subsequently joined compaction system message is accounted for. It never accepts a generic `<=8192` allowance. The same wire guard runs in the original/continuation and verified Boolean-variant paths.

For the current supported Automatic policy, continuation output at **32768 → 4096**, **49152 → 6144**, **65536 → 8192**, **73728 → 8192** (capped). The first batch still admits a legitimate **32768/8192** from the original 73728 output policy; this is an important distinct production route. Arbitrary smaller/larger allowances and **49152/8192 with the actual continuation marker** are rejected.

Direct Rust→TypeScript imports are not available: the host is an isolated native example, and the production helper is a TypeScript/Vite module. Instead the existing runner already uses `vite.ssrLoadModule` and now imports the *actual* helper once at startup; Rust only checks the values supplied in its strict contract. A TypeScript parity test pins the production continuation marker, checks each output against the helper, and requires the four documented tier outputs. No independent Rust 1/8 or 8192 arithmetic is added.

The host also requires the expected native request's only allowed options to be `num_ctx` and `num_predict`, rejects unexpected root/sampling fields and malformed/missing message structure, and retains original calibrated-tier membership, nonempty authorized tool subset, schema format, uniqueness, reasoning and verifier controls. The model must still match the approved identity, and the native URL is still pinned. **Digest/provider-version/runtime-epoch, calibrated loading, and native proof freshness remain checked by unchanged production context-trust/preflight.** They are *not encoded in the Ollama `/api/chat` JSON body*, so the host cannot independently authenticate them from the serialized request alone. These checks must not be replaced by the test-host policy projection.

## Frozen historical request and regression verification

The original immutable `.requests.jsonl` recorded `inference-35` as `49152/6144`, omitted `think`, 14 named native tools. The offline Rust test reconstructs its exact **redacted controls and tool names**, with synthetic non-sensitive tool schemas and a synthetic system prompt containing the production logical-continuation marker; it does **not** replay an Ollama body or claim access to the previous full prompt. It passes the same `acceptance_host_wire_match` used before `handler(invoke)`. Mutating output to 8192, reasoning, context, unknown/duplicated tools, model identity, and unexpected sampling/provider/digest body fields is rejected. Missing or ambiguous tier policies and a misplaced/duplicated marker fail closed. The precise output under valid marker, unchanged tool exposure and context is proven offline; the full unseen original request body cannot be retroactively replayed.

Offline results:

- Acceptance-only Rust host: **13 tests passed**, including the captured 14-tool shape, tier/output matrix, initial-batch distinction, malformed controls and post-marker compaction system-message case.
- Relevant TypeScript output-budget, continuation, budget, minimum-safe-context, request preflight, native Ollama routing and current-proof suites: **298/298 tests passed in nine files** in a targeted scoped run. Three new parity tests passed.
- `npm.cmd run check-types`: **PASS**.
- `npm.cmd run build`: **PASS** (known Vite dynamic-import advisories).
- `cargo build --locked --example r5de_acceptance --target-dir target/codex-test`: **PASS** (pre-existing `dead_code` warnings).
- `cargo test --locked --lib --target-dir target/codex-test modules::net::inference -- --test-threads=2`: **60/60 PASS**, including the 61-second idle-resumption fixture, with no model inference.
- One **broader** Vitest run over 23 files, including duplicate ignored historical baseline tests, returned **681 passed, eight failed** (four failed files). Two failures were duplicate `agentCompaction.integration.test.ts` timing cases; six were duplicate copies of three `r5yProductionSafety.test.ts` assertions. A separate single-file `r5yProductionSafety` rerun reproduced **3 failures, 32 passes** in unchanged production tests. Those failures are not treated as a harness-fix PASS and no unrelated production changes were made.

## Classification and authorization

The previous Muse run remains **INCONCLUSIVE — INVALIDATED BY ACCEPTANCE-HARNESS DEFECT**. The separately frozen notes app still passed **17/17** checks and its authored tests **5/5**, but the interrupted Agent never truthfully completed. The offline correction is evidence that a *newly authorized* one-shot Muse mission is justified after its own fresh model/context/tool qualification; it is **not** a substitute for such a run, and no reuse of the terminated original proof/host runtime is allowed. It does not authorize Muse reruns, alternate models or ForgeBoard.

All original protected hashes, six pre-existing dirty files, stashes, tracker, settings and historical evidence remain outside this repair. No production files were edited.
