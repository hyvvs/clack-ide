# Protected-main strict-check and CI repair workstream (separate from security hardening)

## Scope and evidence

This is a proposed **separate engineering workstream**, not a remediation incorporated in the response-budget security patch. Do not rewrite protected `main` or bypass mandatory checks to make the security PR appear green.

- Protected-main baseline: `dddab1b9c4f035362c754c5111a39e3c209178a4`; clean detached baseline at `outputs/security-main-baseline-20261127`.
- Zod-only Draft PR #47: `00769bf19fd7096a928cc246d8f8c9f474dbbddb`, based on that protected main; preserve its scope.
- Existing baseline frontend suite: `outputs/security-main-baseline-20261127/test.log` reports **26 failed, 4,697 passed, 13 skipped** tests. The response-budget candidate's retained suite reports 23 failed; its fresh suite reports 24, with the additional large-context compaction timeout also present on main. A failing test file is not necessarily a single failing test. No evidence licenses treating this suite as green.
- Both protected-main and security candidate `cargo fmt --all -- --check` fail. The completed hunk-level comparison found **1,356 actual rustfmt hunks on each**, 1,353 byte-identical and only three context-only differences at `inference/mod.rs` around new imports/terminal helper; **zero candidate-only formatting transformations**. Independent inherited formatting drift needs separate correction, not security-patch-wide reformatting.
- Exact clean-main `cargo clippy --all-targets --locked --message-format=json -- -D warnings` was executed with a separate `CARGO_TARGET_DIR` and **exit 101**. Its 22 library and 23 test-library primary diagnostics match candidate actual compiler JSONL **45/45 by source path, line, lint code and full message**. The inherited identities are in `conversation_memory`, `hardware_profile`, `managed_local_runtime`, `self_hosted_profiles`, `shell`, `tf_command`, and `tf_operations`; **0 candidate-only diagnostics**. The full per-line mapping and logs are in `SECURITY-RESPONSE-BUDGET-QUALIFICATION.md`. CI remediation must not use blanket lint allowances.
- Existing baseline `npm run check-types` and production frontend build pass in the retained evidence. Strict launcher and platform-specific checks need separate actual execution and a failure inventory.

## Smallest reviewable repair sequence

1. **Freeze and reproduce baseline evidence.** Use the exact protected-main SHA, locked dependencies, documented Node/Rust toolchains and CI environment. Capture individual failing test identities, complete Rust/TypeScript diagnostics and environment prerequisites; distinguish deterministic defects from absent lab authorization, unavailable native fixtures and concurrency-sensitive timeouts. Keep log/artifact sources retained.
2. **Make deterministic test harnesses self-contained without faking physical gates.** Repair missing preserved Muse/native-report fixture setup, test-only eager `tfOperations` import initialization and pinned fresh-context hash expectations. Isolate tests that genuinely require live hardware, external state or operator authorization behind explicit, truthful opt-in gates; do not silently pass or weaken production assertions.
3. **Repair actual behavioral baseline failures.** Triage structured-memory extraction/schema failures and the real-world isolated-worktree acceptance cases individually; fix underlying code or deterministic setup at the smallest ownership boundary. Reproduce the `agentCompaction.integration` 15-second timeout (and request-recovery timeouts) under both CI concurrency and isolated execution, then fix the race/timing cause rather than increasing timeouts without evidence.
4. **Repair inherited formatting as a formatting-only change.** Land scoped, reviewable Rust formatting commits for baseline files, ensuring semantic diffs remain empty; do not format unrelated TF4/security candidate sources as part of security hardening.
5. **Repair strict Clippy without suppression.** In separate small ownership-area changes, resolve the exact individually matched diagnostics; verify `cargo clippy --all-targets --locked -- -D warnings`, the Linux launcher strict Clippy where applicable, and native tests. No blanket `allow` or removal of security checks.
6. **Prove protected CI parity.** Run required CI platform matrix/format/lint/typecheck/build/tests, capture exact success/failure identities and resolve newly revealed platform-specific failures. Maintain authentic physical acceptance as a separate gate.

These steps may be split into independent baseline-maintenance PRs, each based on protected main with ordinary review and CI. They are not permitted to land implicitly through PR #47 or the security PR.

## Eventual integration and protected invariants

1. Merge reviewed **baseline quality repair PR(s)** to protected main only with required approvals and genuine CI clearance.
2. Rebase/revalidate **PR #47, Zod 4.6.6 only**, against the repaired main; keep it Draft until its own checks and approvals pass.
3. Rebase/revalidate the **separate response-budget/Markdown/STT security Draft PR** on the exact resulting Zod correction. Reconfirm locked dependencies, narrowed audit, focused source/integration tests, and mandatory CI. No source transplant or assumption that a locally green focused suite waives inherited CI.
4. Integrate into **current TF4** only by reviewing/selectively applying the minimal transport, continuation, error, STT, dependency and Markdown hunks against the then-current TF4 implementation. Preserve TF4 admission, runtime identity, browser instrumentation, callback ownership, cancellation and installer/operator boundaries; never replace TF4 files wholesale from an older candidate.

Microsoft executable adjudication remains subject to independent authentication; neither these repairs nor any Draft PR authorizes flagged candidate execution, quarantine restoration, antivirus exceptions, reinstall, merge/release, TF5/MCP advancement, or model-native capability enablement. PR #46, PR #47 and the new security PR remain Draft. The thirteen canonical TF4 gates, physical lifecycle cases 10–11, seventeen-step installed E2E and Product-wide UI/UX Polish & Acceptance remain outstanding.
