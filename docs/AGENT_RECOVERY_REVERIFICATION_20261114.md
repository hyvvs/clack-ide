# Campaign 04: Automatic Agent provider-recovery re-verification

Offline source and evidence review, 2026-11-14. No new Ollama inference,
ForgeBoard mission, SSH forward, evaluator, or compaction experiment was run.
The original campaign remains sealed and immutable.

## Evidence and causal boundary

- Committed baseline: `e525f20ef70cb6ef3715d9dfdfb0548a7b16eea2`.
- Campaign: `forgeboard-prod-muse-20261114-04`.
- Terminal seal SHA-256:
  `82b9deb6785f80cc530418463ca19e6631f7b8ef85d30a0c9af13d0f4a853077`.
- Logical run/checkpoint ID: `real-mission-a:1794627981293`.
- Model: `muse-glimmer:30b`, digest
  `de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1`.
- Ollama `0.40.11`, 32768 context, runtime epoch
  `30700:1794627944617353700`.
- Verified calibration ID: `3bdfb3c7-d42e-4b0b-8a2b-537a94f02bdf`.
- Verified native-tool record ID: `768746f5-e2e2-4b95-b9ee-dfc448a15eb7`.
  It first appeared after the native tool verification request and remained
  verified through terminal failure, with the same epoch and version.
- Inference 6–18 exposed 14 Agent tool schemas; the original evidence records
  schema **count**, not a cryptographic schema fingerprint. Do not infer an
  identical full schema from its count alone.
  The native request list was: `read_file`, `list_directory`, `write_file`,
  `create_directory`, `edit`, `grep`, `glob`, `bash_run`, `bash_list`,
  `open_preview`, `todo_write`, `request_peer_task`, `cancel_peer_task`,
  `propose_custom_tool`.
- The checkpoint retained 12 completed native tool receipts (five writes),
  permissions digest and workspace identity; continuation count was zero.
- Inference 18 timed out at the unchanged 180-second stream-idle bound. One
  provider recovery was admitted, checkpointed, reconciled and moved to
  `dispatched`, but no new provider generation was emitted.
- The terminal message was `Automatic Agent configuration is not verified.
  Use Chat Only or verify tools in model settings.`. This is **not** a
  conversation-compaction failure. The 80-row preparation journal has no
  extraction attempt.

### Exact source-level predicate and state delta

`transport.ts` captured the self-hosted request configuration *before*
`agent.ts` performed native tool verification and returned an accepted
`onSelfHostedPrepared` record. The original Agent segment used that newly
verified record, whereas the special provider-recovery segment previously
rebuilt from `captured.configuration.selfHostedInference` without the
post-verification record. `startRunBatch()` also did not flag the exceptional
provider-recovery request as a logical continuation; no continuation counter
was incremented (correct for this same-run timeout). Thus recovery reached
`applyAgentRecommendation()` with a pre-verification configuration:
`automaticAgentRecommendation()` could not establish the exact-tier
`verificationRecord` /`configuredToolState === "Verified"` predicate,
and `applyAgentRecommendation()` emitted the observed terminal error.

The durable settings/timeline show the native record **still existed and was
verified** after the timeout; loss in the reconstructed in-memory request
state, not proven revocation, explains the divergent eligibility. The exact
internal source-level rejection subtype was not serialized separately in
campaign 04; the predicate is identified by the unique error-throwing call
chain and unchanged trusted record.

## Fail-closed repair

- Only managed **Ollama Automatic Agent** recovery may substitute the
  same-run accepted `preparedHosted.state`; all other provider routes keep
  their original recovery behavior.
- Require the exact original selected profile/endpoint, transport model,
  digest, deployment, overrides, endpoint revision/URL/credentials and
  previous native-tool record ID/variant. No missing or changed proof,
  permission, model or endpoint can gain an admission.
- Treat this exceptional recovery as a logical *verification* continuation
  without changing its provider-recovery instruction, allowance, budget or
  continuation count.
- Native runtime observation and provider metadata are independently
  short-lived. If required after a timed-out provider segment, inspect the
  real current native epoch/version and refresh model metadata under the
  existing bounded operations; compare the new context, reasoning and
  digest to the original calibration and native proof. Never extend a proof
  expiry, invent allocation evidence or repeat native verification.
- Include exact-tier tool proof records in the retained eligibility guard.
- Pin the SHA-256 signature of the callable Agent tool schemas and their
  implementation-revision identities for the same run. Compare at recovery
  preparation and again before native HTTP acknowledgement. Recheck
  permission and workspace authority at that final boundary. Changed
  schemas or authority fail before new inference.
- Keep original completed tool receipts and side-effect reconciliation,
  one-shot recovery allowance, original timeout values and monotonic budgets.

## Deterministic validation

`agentRequestFailureRecovery.integration.test.ts` exercises a calibrated
real `runContextCalibration` profile, actual `runToolVerification`, the
actual Automatic recommendation predicate and Chat/transport checkpoint
path: 12 prior completed tool operations, provider timeout, one recovery,
reconciled effects, same-run native proof, one new provider segment, new work
and terminal completion. Separate existing tests assert second timeout,
unsettled/unknown effects, replay denial and permission drift remain blocked.

`r5zCurrentProof.test.ts` exercises actual `runAgentStream` and native ACK
with fake (not live) bounded provider receipts: 180-second expired cached
provider observations with unchanged proof/epoch and an actual fresh
reinspection pass; changed digest, runtime epoch, reasoning, revoked or lost
proof fail closed; changed tool schema fails before provider dispatch; late
permission change denies the native acknowledgement.

The unchanged historical `r5yProductionSafety.test.ts` has **three
pre-existing assertion failures** in the original committed HEAD. They were
reproduced verbatim in an isolated `git archive HEAD` baseline checkout,
not caused by this patch; all three paths still deny inference. This task
does not rewrite that historical suite or broaden its error expectations.
No prior campaign workspace or evaluation contract was changed.
