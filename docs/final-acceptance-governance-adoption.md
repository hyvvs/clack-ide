# CLACK final-acceptance governance — separate Draft candidate, NOT ACTIVE

**Status (2026-11-28):** source-only development candidate. No privileged
verifier was installed, no branch protection/ruleset changed, no existing PR
retargeted, and no release authorization was inferred. The previously qualified
maintenance head `7c9434fab86d08d9e1f3ee96e0f00612b4a4557b` and its
genuine eight-job run `46114988736` are historical inputs, NOT governance
qualification of this candidate. Original private evidence remains 19 pass,
LM11 historical T01 blocked. All tests in this branch are synthetic controls.

## What is implemented and what is not

The proposed CI retains the eight true PR job names (`frontend`, `rust`,
`rust-test (windows-latest)`, `rust-test (macos-latest)`, `T3a WASI adversarial
(ubuntu-22.04)`, `T3a WASI adversarial (windows-latest)`, `T3a WASI adversarial
(macos-latest)`, `coverage`). `workflow_dispatch` gets **different** `diagnostic /`
names. Real `pull_request` events cover `main`, the exact Zod stack base
`security/zod-4.6.6-ghsa-20261127`, and this candidate's maintenance base;
`edited` catches retargeting. Every job checks its exact checkout SHA; frontend
Draft portable and Ready full-original test execution have distinct raw steps.

The separate **default-branch-only** verifier proposes an independently
created `protected-main-final-acceptance` PR-HEAD check. It never checks out PR
source, imports untrusted source, downloads/executes artifacts or uses untrusted
caches. All eight actual jobs, exact attempt, named essential executed-success
steps, workflow identity, source SHA, current base, check-run IDs/check suite,
unmodified trusted CI/test contract and an independently signed redacted receipt
must agree. Skipped/neutral results do not pass. A unique source-bound receipt
must cover all 20 original assertions; 19+blocked T01 fails. The hypothetical
contemporary equivalence mode is **disabled in the executable policy** until a
separately authorized, independently reviewed default-branch code change.

**Fail-safe implementation switch:** `FINAL_CHECK_ACTIVATION_APPROVED = false`
in source, not an environment-variable override. Even a hypothetical valid
positive evaluation is published as **failure**, not success, until a separate
trusted code review proves issuer isolation, check terminal-state lifecycle,
and synchronous merge-time revalidation. The prototype must not be mistaken
for a deployable release gate.

## Owner-authorized bootstrap — strictly ordered, none performed here

1. An independent security reviewer and repository owner verify the full diff,
   workflow permissions, all possible status/check writers, default branch SHA,
   repository ID `1272186478`, CI workflow ID `297568453`, and intended eight
   immutable context names. Review GitHub branch/ruleset/merge-queue semantics
   and disallow any PR-authored workflow from obtaining write tokens. Record
   reviewer identity, decision, date, reviewed commit and security findings.
2. Resolve **issuer provenance before activation**. App ID `15368` means only
   "GitHub Actions", not this verifier: `external_id`, check name, GitHub
   Actions app ID and details URL can be spoofed by another workflow with
   `checks:write`. Where an independently enforced org ruleset/required-workflow
   mechanism can demonstrably provide unique authority, commission and verify
   it first. Otherwise provision a dedicated, minimally scoped GitHub App with
   `checks:write` solely to this repository and a NEW, recorded numerical App
   ID. Limit App private-key access to an owner-managed trusted environment on
   the default branch. Never expose the key to untrusted PR workflow jobs.
   **Do not adopt the placeholder App ID in the unapplied JSON.** An unmodified
   GitHub Actions job posting its own check is a *prototype*, not an isolated
   issuer. Deploying an App or ruleset requires separate owner approval.
3. Independently demonstrate the immutable `run-name` provenance assumption
   using a disposable genuine PR against the future protected default-branch
   CI: inspect `GET /actions/runs/{id}` before and after head advance, base
   retarget and rerun, confirming `display_title` retains the event-time
   `CLACK CI PR N head SHA base SHA`. The embedded `pull_requests[].head/base`
   may change and is intentionally NOT used as the historic base. If the
   title is mutable/absent or differs on GitHub, **stop** and implement a
   different GitHub-generated immutable event-time binding before bootstrap.
4. Require independent approvals for `.github/workflows/**`,
   `scripts/final-acceptance-*`, `scripts/test-execution-contract.mjs`,
   branch/ruleset policy, and any signer trust configuration. Use an actual
   owner-approved CODEOWNERS team (not an invented team), at least two
   independent qualified reviewers for privileged workflows, stale approval
   dismissal on new commits and base changes, last-push approval by another
   reviewer, and no author self-approval. Re-review changed blobs; preserve
   immutable review/audit records. Existing zero-approval `main` protection is
   INSUFFICIENT; owner must authorize the necessary future policy changes.
5. Separately approve a reviewed **default-main bootstrap commit** containing
   the verifier and trusted CI policy. This Draft PR intentionally cannot
   bootstrap `workflow_run`; CI/policy edits in an untrusted PR are refused by
   the future gate until identical approved blobs are on `main`. Do not merge
   this PR simply to activate privileged code or bypass its initial checks.
   Pin/approve all actions and script sources before executing. The validator
   must execute from that default-branch tree exclusively.
6. Owner/independent custodian provisions the private-evidence **Ed25519
   signing key outside GitHub**; protect it offline, rotate/revoke via a reviewed
   policy change. Only the PEM public key, explicitly approved signer key ID,
   and separately authorized owner public key belong to the verifier trust
   configuration. GitHub comments contain only a canonical JSON payload plus
   domain-separated Ed25519 signature, NOT original private files, Store
   contents, secrets or raw logs. Every receipt binds repository/name/ID,
   PR, head and base SHA, CI workflow ID/blob, test-contract blob, trusted
   policy blob, run ID and attempt, signer key ID, 128-bit nonce,
   issued/expiry timestamps and exact grouped 20 original assertion outcomes.
   The signer must observe genuinely completed authenticated private evidence
   and unchanged original Store/source, never invent `20/20`. Synthetic keys
   used by Node tests can **never** qualify private CLACK evidence.
7. Address the original full-test runtime problem: for non-Draft PRs the
   genuine hosted `Full original acceptance (npm test)` step must actually
   succeed. A hosted runner without private data may fail closed. Do **not**
   replace it with Draft `test:portable`, manual `workflow_dispatch`, a
   skipped step or an unauthenticated private receipt. Any future split
   deterministic/private workflow is a distinct policy change requiring
   independent owner approval, fresh tests, and actual essential-step proof.
8. Perform a negative-control deployment rehearsal on an isolated test PR:
   tampered/absent receipt, T01 blocked, duplicate checks, superseded runs,
   stale base, reruns, changed CI YAML, draft transitions, unsigned comments,
   wrong App, wrong attempt, skipped/neutral essential steps. Confirm failure
   remains blocking. Verify the dedicated issuer and exact successful source
   only after all originals genuinely pass; never give public fixtures secrets.
9. **Resolve the static-success race before making the ninth check required.**
   `workflow_run requested` does not fire for reruns; `in_progress` and
   `completed`, PR/base events and 15-minute scheduled invalidations reduce
   but cannot eliminate a gap between a rerun/start/expiry/revocation and the
   next verifier run. Same-SHA old `success` can persist and protection may
   treat `neutral`/`skipped` as acceptable. Require an independently enforced
   *synchronous integration-time* policy (e.g. rigorously proven required
   ruleset/merge-queue validation or issuer-isolated App server with final
   check revocation) that consults live PR/base/head/latest run+attempt and
   current signed receipt at the merge decision. If unavailable, leave the
   ninth check **UNREQUIRED**, Draft PR unmerged and release blocked. Neither
   cron nor `strict: true` alone solves the race.
   A further problem is that a GitHub completed check run may not reliably
   transition back to `in_progress` by PATCH. This prototype explicitly
   rejects attempted reuse of a terminal same-SHA check; a verified check
   lifecycle/revocation mechanism is required before success activation.
10. Only after above verified and separately owner-authorized, stage the exact
    nine-status payload `.github/required-checks.UNAPPLIED.json` with the
    real trusted issuer App ID and independent reviewer approval. It is **not
    applied** by this branch. Set `strict: true`, check the final issuer and
    non-Draft real-PR check execution, test revoke/retest on base changes,
    and retain existing admin/conversation-resolution enforcement.

## Stacked security PR #48 — genuine CI only

After separately approved workflow bootstrap, a real `pull_request` event on
security PR #48 must have head SHA `13cd9053b65ce239dfe2a0d21e704007c0873c77`
**if still current**, base branch `security/zod-4.6.6-ghsa-20261127`, and its
then-current exact base SHA. Inspect GitHub API live head/base before verifying;
use the true event-time base bound by CI run metadata. If head/base moved,
qualify anew. All eight job check runs and essential stages must have raw
`success` on the same authentic run attempt. Do not spoof checks using
`workflow_dispatch`, and do not retarget/edit PRs #46/#47/#48 to induce CI.
The final `main` acceptance gate only applies when the PR's actual base is
`main`; stacked qualification is a separate pre-integration prerequisite.

## Remaining hard boundaries

Preserve sequence **#49 maintenance → #47 Zod → #48 security hardening →
selective TF4 integration**. PRs #46–#49 remain Draft; no merging, PR rewrite,
permission/protection change, signing/distribution or release is authorized.
Outstanding release acceptance includes independent Microsoft executable
adjudication, signing/distribution trust, thirteen canonical TF4 gates,
physical lifecycle 10–11, installed 17-step E2E and full UI/UX acceptance.
No SSH/kernel/BPF, Muse physical operations, Defender weakening, flagged EXE,
TF5/MCP or new model capability enablement is within this governance scope.
