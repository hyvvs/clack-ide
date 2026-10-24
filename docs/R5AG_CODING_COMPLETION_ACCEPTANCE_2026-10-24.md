# R5ag — Coder completion guidance and one real notes API acceptance

Date: 2026-10-24. Baseline commit: 1df04743f1e96c0ce699cbf82f89ab048a38f491. This checkpoint is complete; do not repeat the one authorized live mission.

## Frozen R5af diagnosis

The real R5af Agent session is preserved under src-tauri/target/real-qwen-product/qwen-smoke-r5af-20261024-01/. The original notes API application remains under src-tauri/target/qwen-smoke-r5af-20261024-01/.

- The saved session for real-mission-a has state completed, lastFinishReason stop, totalSteps 10, softStepLimit 24, hardStepLimit 240, continuationCount 0, stopReason null. The final persisted Todo list is empty. No evidence of a budget cap, cancellation, output truncation or interrupted run.
- Persisted chat records four successful native bash_run calls (npm init, two npm installs and TypeScript init), directory listing/creation and one native write_file for src/index.ts. There is no attempted test execution, build, TypeScript checking, backend startup, or subsequent repair in the Agent transcript; there were no recorded shell failures to fix during the Agent.
- The last message describes creating a test file but includes a textual function-call imitation rather than a valid SDK native write_file call. No test file was written. Qwen did not explicitly claim that builds/tests passed; the final text was an incomplete tool-call imitation.
- Independent R5af evaluation, performed only after the run stopped, found npm test failed with the default no-test script, npm run build had no script, tsc failed TS5108, startup failed due CommonJS/ESM import incompatibility, and there were no tests or README. These failures were not available to Clack while the model was deciding to stop.
- The normal AgentRunBridge records completed when an idle inference with no active approvals or continuation has naturally stopped; completed is an execution lifecycle state, **not** proof of independent application acceptance. This case does not establish an incorrect state transition or a generic run-budget defect. It demonstrates premature/incomplete model work, including a non-native tool imitation. The model had no outstanding persisted Todos despite unmet user requirements.

## One focused change

Only the builtin:coder instructions in src/modules/ai/lib/agents.ts are strengthened. For requests to create/modify runnable software, the Coder is instructed to track unfinished requirements, discover or add required build/test scripts and automated tests, run available checks with authorized tools, inspect exit codes, repair problems within ordinary budgets and permissions, check startup when feasible, and report blocked or failing verification truthfully. Explicitly **do not invent** builds/tests for questions, reviews, designs and other non-executable tasks.

No execution state, native tool schema/proof, reasoning/default settings, permissions, continuation, context limits, retries, approval safeguards, or other personas were changed. Regression src/modules/ai/lib/coderCompletionGuidance.test.ts asserts system composition, applicability to simple tasks, genuine shell failures, and outstanding work; existing continuation/runtime tests cover cancellation, limits and correct short completion. This guidance is a practical workflow improvement, **not** an automatic post-build enforcement mechanism or guarantee of correct code.

## Offline results

- npm run check-types — PASS, including after creating the isolated R5ag acceptance harness.
- Focused Vitest: coderCompletionGuidance, localAgentContinuity, agentCompaction.integration, AgentRunBridge, chatRuntime — 92/92 tests PASS across five files.
- npm run lint — exit 0, 76 warnings and 2 informational diagnostics in the project, no fixes applied.
- npm run build — PASS (TypeScript and Vite); pre-existing dynamic import and plugin timing advisories.
- Isolated acceptance script syntax and original mission copy equality — PASS.

## Exactly one conditional fresh real Qwen mission

Run ID: qwen-smoke-r5ag-20261024-01. Exclusive empty Git workspace: src-tauri/target/qwen-smoke-r5ag-20261024-01/. Evidence: src-tauri/target/real-qwen-product/qwen-smoke-r5ag-20261024-01/. Saved Automatic Qwen profile copied byte-for-byte from the frozen R5af smoke (source SHA-256 2d39dcfdd946acc733ba77ac1c8e68a226aeb46f013e68902a71002bd54592bb); no manual verified status was injected. The original mission text in src/test/r5agSmokeAgentAcceptance.tsx is byte-identical to R5af; singleSpec disabled ForgeBoard correction. Exactly **one** launch, mission-a attempt 1, via Clack's real local Agent runtime. No subsequent launch, follow-on experiment or ForgeBoard.

- Fresh six context calibration requests succeeded through 65536 with production numeric trust; normal native tool verification and confirmation admitted the Agent. 10 total native inference dispatches: six calibration, three tool-verification requests, one genuine Agent request. No cloud inference.
- The one Agent request used 18 native tool schemas with 65536 context, output allowance 2048. The request failed without a completed native response: persisted Agent error is code native-transport, message "The native inference transport did not settle successfully.", disposition terminal, requestId inference-10, retryable false. Saved state failed, budget totalSteps 0, continuationCount 0, lastFinishReason empty; zero native application tool operations, zero source writes.
- The harness's resultOk true means the acceptance host successfully reported/ACKed its run; it **does not** mean the Agent or notes API passed.
- No source or package files were authored. The new guidance received no opportunity to govern a coding/repair cycle, so its live effect on completion quality is **not demonstrated**. This was a separate native inference transport failure, not R5af's premature normal stop; root cause of that transport failure was not established and no additional live experiment was authorized.

## Independent untouched-output evaluation

The evaluator scripts/r5ag-independent-notes.mjs froze a source SHA-256 manifest before checking and verified byte-for-byte agreement afterward. Both inventories are empty, apart from the fresh workspace's .git metadata (not application source). Output is frozen-source-manifest.json and independent-notes-check.json in the R5ag evidence root. A defensive evaluator guard prevents npm from walking up to the parent Clack repository when no package.json exists; an initial evaluator invocation was stopped when this unsafe inherited npm behavior was noticed, and the guard was added before its completed evaluation. No generated application was repaired or edited.

Results: authored tests FAIL (none); README FAIL (absent); runtime-file .gitignore FAIL (absent); npm tests BLOCKED, production build BLOCKED, local TypeScript compilation BLOCKED (no application/package/compiler); startup FAIL (no launch script/backend); health, CRUD, validation, missing resource, persistence/restart all BLOCKED. Final check sourceUntouched true. **Application acceptance FAIL / BLOCKED**, not PASS.

## Preservation, scope, and future gate

The six originally dirty user-owned files, two stashes, autonomous_tracker, saved settings and tunnel, inactive Codex worktree, R5af and older native/ForgeBoard evidence, original task and later full ForgeBoard specification are excluded from this checkpoint's commit and remain protected. No reset, clean, push, cloud fallback, remote configuration, alternate-model comparison, security relaxation or full ForgeBoard run.

Working software is still unproven with the changed Coder guidance: a future **separately authorized** real Agent acceptance must create and independently pass build, startup, API CRUD/validation, persistence, automated tests and reproducible README before advancing to the full original ForgeBoard mission. The mandatory P2–P19 capability-platform roadmap (security, integration, real Agent, E2E, Windows/Linux/macOS) remains open; R3d packaged desktop remains **OPEN**. Stop here.
