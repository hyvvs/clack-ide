# CLACK final-acceptance governance — separate Draft candidate, NOT ACTIVE

**Status (2026-11-28):** source-only development candidate. No privileged
verifier was installed, no branch protection/ruleset changed, no existing PR
retargeted, and no release authorization was inferred. The previously qualified
maintenance head `7c9434fab86d08d9e1f3ee96e0f00612b4a4557b` and its
genuine eight-job run `46114988736` are historical inputs, NOT governance
qualification of this candidate. Original private evidence remains 19 pass,
LM11 historical T01 blocked. All tests in this branch are synthetic controls.
Genuine hosted governance CI run `46119175857` qualified all eight jobs and
successful **Draft portable** frontend acceptance; **full original acceptance
was not executed**. This is accepted source-level/portable qualification, not
full private-evidence approval.

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

## Independent 2026-11-28 defect review and smallest available adoption path

The original `makeApi()` rejected **its own** initial request `GET
/repos/hyvvs/clack-ide` while accepting only paths with a trailing `/`. The
corrected wrapper permits exactly that bare repository metadata endpoint and
its real descendant paths; it rejects repository prefix collisions, alternate
repository owners, `..`/`.`/empty path segments, percent-encoded path
ambiguity, backslashes, URL fragments, control characters, external URLs and
unapproved repo overrides. The actual `main()` initialization, real CLI
entrypoint, and mocked full `pull_request_target` → `main()` → REST → check
publisher execution are now regression-tested using **synthetic** data; no
actual GitHub write token is used. The full original `npm test` still remains
unexecuted on the Draft governance PR and original T01 remains blocked.

**Actual read-only repository checks:** `hyvvs/clack-ide` is a **public,
personal-user-owned** repository (`owner.type=User`, default branch `main`).
`GET /repos/hyvvs/clack-ide/rulesets` returned `[]`; no currently active
rulesets exist. The repository collaborators endpoint returned **one** account,
and PR #50 had **zero** review submissions. `GET /user` did not expose a plan
name (`plan=null`); do not infer the account's paid tier. Main currently
enforces admins and conversation resolution but has zero required approvals
and `required_status_checks=null`. No permission, rule or review changes were
made by this workstream.
The observed Actions configuration is `default_workflow_permissions=read`,
`can_approve_pull_request_reviews=true`. Because PR-authored workflows may
request elevated permissions where allowed, this setting alone does **not**
isolate the trusted final-check issuer behind GitHub Actions App `15368`.

**Constrained options (no new service, credentials or plan assumed):**

| Mechanism | Available on this exact repository? | Security conclusion |
| --- | --- | --- |
| Public-repo classic branch protection + required eight exact CI contexts, strict base, independent PR approvals, no admin bypass | **Supported but NOT configured**, owner authorization needed | Smallest enforceable *ordinary GitHub* CI/review baseline. Checks still do not prove every essential stage, original private receipt or full 20/20. |
| Repository branch ruleset requiring PR review/status checks | **API available; no ruleset currently installed** | Can strengthen baseline, not an independent required-workflow/check issuer or synchronous revalidation of a custom signed receipt. |
| Manual owner-controlled, single-writer serialized integration using the offline verifier just before each merge | **Operationally possible after owner + independent reviewer authorization**, not used here | Lowest operational cost with no new resident service. Review exact PR/source/base/latest run + attempt, all eight raw steps, receipt expiry/revocation, protected workflow blobs, approvals; abort on change. **Not a machine-enforced atomic final-acceptance check** and cannot alone establish the requested race-proof ninth status. |
| GitHub Actions default-branch `workflow_run` custom ninth check | **Source candidate only; not installed** | Current App ID `15368` is shared with other Actions; completed same-SHA check cannot be assumed revoked or reopened. Fail closed; success remains disabled. |
| Organization/enterprise ruleset `Require workflows to pass before merging` | **Not available in this personal repository** | Requires separately authorized org/enterprise governance; cannot be enabled merely by adding a repo ruleset. |
| Native GitHub merge queue | **Not available for personal-user-owned repositories** | Public organization repositories can use it; moving repository ownership is a separate significant authorization, not part of this maintenance task. |
| Dedicated check-writing GitHub App/always-running validation service | **Not deployed or approved** | Could isolate check issuer but creates credential/installation duties; a custom App alone does not solve stale success and merge-time races. Do not provision as default. |

**Minimum decision now:** retain the separate Draft PR and disabled ninth
acceptance switch. If the owner wants a minimal **manual** integration path
later, first appoint at least one genuinely independent reviewer with actual
write/review ability, review and adopt strict required **genuine eight** CI
contexts and fresh independent approvals on protected `main`, prohibit
unreviewed workflow changes and automated merges, and document an exclusive
owner-held integration window. Only after the full original hosted acceptance
and separately authenticated private 20/20 have truly passed may the owner
run the read-only verifier again immediately before a separately authorized
manual merge, re-reading the exact PR/head/base/workflow blobs, source hashes,
current run ID/attempt, essential stages, unique current receipt, signature
key/revocation, expiry and approval state. Abort if any value changes. The
GitHub merge must be checked for its exact PR head and current target base.
This is a **human-gated process**, not an independently enforced ninth check;
if the owner requires *provable automatic merge-time enforcement*, defer
activation and decide separately on a supported organization merge queue /
issuer-isolation implementation. No single-writer process can claim immunity
to all asynchronous stale-check races or privileged concurrent changes.

**Specific lifecycle review:**

| Requirement | Verified implementation/negative control | Blocker before privileged acceptance |
| --- | --- | --- |
| Trusted verifier source/workflow | Default-branch-only checkout, exact current `main` SHA guard, CI ID/path, same workflow and test-contract Git blobs | No independently protected main bootstrap or issuer exclusivity; event-time run-title immutability must be demonstrated on real GitHub |
| Latest CI + rerun attempt | Independent per-attempt job+step APIs, current-run selection, pre-publication recheck, synthetic supersession tests | A rerun can start after final recheck; `workflow_run requested` misses reruns |
| Same-SHA terminal-check revocation | Explicit refusal to silently reopen completed check; checked in synthetic regression | Cannot guarantee timely revocation on rerun, expiry, deletion, retarget, or policy/key change; old green status may outlive validation |
| Draft/Ready, stale approvals/base | Live PR draft/base/head check; timeline transition invalidation; `edited` CI events | No independent reviewer and no enforced dismiss-stale/last-push review policy yet; event-to-check race remains |
| Signed receipt and T01 | Domain-separated Ed25519, keyed receipt with exact test groups, source/base/run/attempt, expiry and uniqueness; synthetic tamper tests | Real original T01 blocked; no authorized 20/20 receipt; revocation cannot synchronously invalidate a completed status |
| Duplicate/impersonated status | Expected actual eight check IDs/suite/steps; duplicate name fails synthetic policy and publisher | Shared Actions App `15368` and historical same-SHA checks can still be accepted by GitHub independently of prototype reevaluation |
| Genuine stacked Zod CI | `pull_request` includes Zod branch and `edited`; `workflow_dispatch` contexts deliberately distinct | PR #48 has not been changed or manufactured; independently qualify actual current head/base after separately approved workflow bootstrap |

No cell above constitutes privileged acceptance, signed historical T01
equivalence, or permission to apply the nine-check JSON. The eighth-context
baseline also cannot substitute for the required full original acceptance or
private evidence.

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
