// Pure, offline-verifiable policy. Never imports source from the PR being checked.
// Deployed verifier MUST use this file from the trusted DEFAULT branch only.
import { createPublicKey, verify as verifySignature } from 'node:crypto';

export const CHECK_NAME = 'protected-main-final-acceptance';
export const CHECK_EXTERNAL_PREFIX = 'clack-final-v1';
export const CI_PATH = '.github/workflows/ci.yml';
export const TEST_CONTRACT_PATH = 'scripts/test-execution-contract.mjs';
export const POLICY_PATH = 'scripts/final-acceptance-policy.mjs';
export const REPO = 'hyvvs/clack-ide';
export const BASE = 'main';
export const ACTIONS_APP_ID = 15368;
export const REPOSITORY_ID = 1272186478;
// No contemporary equivalent has been authorized. Enabling a case requires
// separately reviewed trusted-default-branch policy code, not a PR comment.
export const APPROVED_EQUIVALENT_CASE_ID = null;
export const RECEIPT_MARKER = 'CLACK_PRIVATE_EVIDENCE_RECEIPT_V1:';
export const RECEIPT_DOMAIN = 'CLACK-PRIVATE-EVIDENCE-RECEIPT-V1\u0000';
const SHA = /^[0-9a-f]{40}$/;
const B64 = /^[A-Za-z0-9_-]+$/;
export const immutablePrRunTitle = (pr) =>
  'CLACK CI PR ' + pr.number + ' head ' + pr.head.sha + ' base ' + pr.base.sha;

// These names are the eight observed native GitHub Actions contexts. They are
// NOT satisfied by a successful diagnostic dispatch, skipped/neutral conclusion
// or manually created status. The selected CI workflow must match trusted main.
export const REQUIRED_JOBS = Object.freeze({
  frontend: [
    'Verify exact CI source checkout', 'Lint', 'Type-check',
    'Full original acceptance (npm test)', 'Build frontend', 'Size budget',
    'Record exact emitted JS and actual eager modulepreload graph',
    'Compare emitted gzip9 growth to exact PR base',
  ],
  rust: [
    'Verify exact CI source checkout', 'Install Linux build dependencies',
    'cargo check', 'cargo clippy', 'cargo nextest',
    'Remote SSH parent-death and ownership acceptance',
  ],
  'rust-test (windows-latest)': [
    'Verify exact CI source checkout', 'cargo check', 'cargo nextest',
    'Remote SSH native lifecycle regression',
    'Remote SSH parent-death and ownership acceptance',
  ],
  'rust-test (macos-latest)': [
    'Verify exact CI source checkout', 'cargo check', 'cargo nextest',
    'Remote SSH native lifecycle regression',
    'Remote SSH parent-death and ownership acceptance',
  ],
  'T3a WASI adversarial (ubuntu-22.04)': [
    'Verify exact CI source checkout', 'Install Linux build dependencies',
    'Shared staging, WASI adversarial and no-replay tests',
    'T3b registration, authorization and confined JSON functions',
  ],
  'T3a WASI adversarial (windows-latest)': [
    'Verify exact CI source checkout',
    'Shared staging, WASI adversarial and no-replay tests',
    'T3b registration, authorization and confined JSON functions',
  ],
  'T3a WASI adversarial (macos-latest)': [
    'Verify exact CI source checkout',
    'Shared staging, WASI adversarial and no-replay tests',
    'T3b registration, authorization and confined JSON functions',
  ],
  coverage: [
    'Verify exact CI source checkout', 'Install Linux build dependencies',
    'Generate coverage', 'Upload coverage artifact',
  ],
});

const GROUPS = Object.freeze({
  'muse-nov03': 8,
  'hosted-egress-historical-reports': 2,
  'lm11-t01-original': 1,
  't15-attributable': 3,
  'muse-host-sources': 3,
  'muse-crash-only': 3,
});

function assert(ok, message) {
  if (!ok) throw new Error(message);
}
function onlyKeys(obj, keys, field) {
  assert(obj && typeof obj === 'object' && !Array.isArray(obj), field + ' must be an object');
  assert(Object.keys(obj).length === keys.length && keys.every((key) => Object.hasOwn(obj, key)), field + ' keys invalid');
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) =>
      JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  assert(value === null || ['string', 'boolean'].includes(typeof value) ||
    (typeof value === 'number' && Number.isSafeInteger(value)), 'noncanonical payload value');
  return JSON.stringify(value);
}
export const canonicalReceiptJSON = canonical;

function parseSignedEnvelope(body, key, ownerKey, now) {
  assert(typeof body === 'string' && body.length <= 11_000 && body.startsWith(RECEIPT_MARKER),
    'receipt comment marker/size invalid');
  const encoded = body.slice(RECEIPT_MARKER.length).trim();
  assert(B64.test(encoded) && encoded.length <= 10_000, 'receipt encoding invalid');
  const envelopeText = Buffer.from(encoded, 'base64url').toString('utf8');
  const env = JSON.parse(envelopeText);
  onlyKeys(env, ['payload', 'signature', 'owner_signature'], 'envelope');
  assert(typeof env.payload === 'string' && B64.test(env.payload) && env.payload.length <= 6500, 'payload encoding invalid');
  assert(typeof env.signature === 'string' && B64.test(env.signature), 'signature encoding invalid');
  const payloadText = Buffer.from(env.payload, 'base64url').toString('utf8');
  const payload = JSON.parse(payloadText);
  assert(canonical(payload) === payloadText, 'noncanonical/duplicate-key receipt payload');
  const message = Buffer.from(RECEIPT_DOMAIN + env.payload, 'utf8');
  assert(typeof key === 'string' && key.includes('BEGIN PUBLIC KEY'), 'private evidence verification key absent');
  assert(verifySignature(null, message, createPublicKey(key), Buffer.from(env.signature, 'base64url')),
    'untrusted private evidence receipt signature');
  const needed = [
    'schema','repository','repository_id','pr','head_sha','base_sha','ci_run_id','ci_run_attempt',
    'ci_workflow_id','ci_workflow_blob','test_contract_blob','policy_blob','signer_key_id','nonce',
    'signed_at','expires_at','mode','groups',
    'inputs_unchanged','real_store_identity_verified','private_runner_source_verified',
    'owner_decision_id','contemporary_selector_pass','contemporary_observer_sha256',
  ];
  onlyKeys(payload, needed, 'receipt');
  assert(payload.schema === 'clack-private-evidence-v1' && payload.repository === REPO &&
    payload.repository_id === REPOSITORY_ID && payload.ci_workflow_id === 297568453,
  'receipt schema/repository/workflow identity invalid');
  assert(SHA.test(payload.head_sha) && SHA.test(payload.base_sha) &&
    SHA.test(payload.ci_workflow_blob) && SHA.test(payload.test_contract_blob) &&
    SHA.test(payload.policy_blob), 'receipt source hashes invalid');
  assert(/^[A-Za-z0-9_-]{8,80}$/.test(payload.signer_key_id) &&
    /^[0-9a-f]{32}$/.test(payload.nonce), 'receipt signer key ID / nonce invalid');
  assert(Number.isSafeInteger(payload.pr) && payload.pr > 0 &&
    Number.isSafeInteger(payload.ci_run_id) && payload.ci_run_id > 0 &&
    Number.isSafeInteger(payload.ci_run_attempt) && payload.ci_run_attempt >= 1, 'receipt IDs invalid');
  assert(payload.inputs_unchanged === true && payload.real_store_identity_verified === true &&
    payload.private_runner_source_verified === true, 'original private input/source integrity incomplete');
  const signed = Date.parse(payload.signed_at);
  const expires = Date.parse(payload.expires_at);
  assert(Number.isFinite(signed) && Number.isFinite(expires) &&
    expires > signed && expires - signed <= 7 * 86400_000 &&
    now >= signed - 300_000 && now < expires, 'receipt expired/not yet valid');
  assert(Array.isArray(payload.groups) && payload.groups.length === 6, 'private group coverage incomplete');
  const groups = new Map();
  for (const group of payload.groups) {
    onlyKeys(group, ['id', 'passed', 'failed', 'skipped'], 'test group');
    assert(Object.hasOwn(GROUPS, group.id) && !groups.has(group.id), 'private test group invalid/duplicated');
    assert(Number.isSafeInteger(group.passed) && group.passed >= 0 &&
      Number.isSafeInteger(group.failed) && group.failed >= 0 &&
      Number.isSafeInteger(group.skipped) && group.skipped >= 0 &&
      group.passed + group.failed + group.skipped === GROUPS[group.id], 'private test group count mismatch');
    groups.set(group.id, group);
  }
  if (payload.mode === 'historical-original') {
    assert(payload.owner_decision_id === null, 'unnecessary owner-decision override');
    assert(payload.contemporary_selector_pass === null &&
      payload.contemporary_observer_sha256 === null, 'historical acceptance mixed with contemporary evidence');
    for (const group of groups.values()) assert(group.passed === GROUPS[group.id] &&
      group.failed === 0 && group.skipped === 0, 'original complete evidence was not 20/20');
    assert(env.owner_signature === null, 'unexpected owner signature on historical mode');
  } else if (payload.mode === 'separately-authorized-contemporary') {
    assert(typeof payload.owner_decision_id === 'string' &&
      /^LM11-CURRENT-[0-9]{8}-[A-Za-z0-9_-]{8,64}$/.test(payload.owner_decision_id),
      'no specific independent acceptance-owner decision');
    assert(payload.contemporary_selector_pass === true &&
      typeof payload.contemporary_observer_sha256 === 'string' &&
      /^[0-9a-f]{64}$/.test(payload.contemporary_observer_sha256),
      'independently authenticated contemporary read-only selector test not established');
    for (const group of groups.values()) {
      const originalT01 = group.id === 'lm11-t01-original';
      assert(group.passed === GROUPS[group.id] - Number(originalT01) &&
        group.failed === Number(originalT01) && group.skipped === 0,
        'historical T01 must remain separately blocked, other 19 must pass');
    }
    assert(typeof ownerKey === 'string' && ownerKey.includes('BEGIN PUBLIC KEY') &&
      typeof env.owner_signature === 'string' && B64.test(env.owner_signature) &&
      verifySignature(null, message, createPublicKey(ownerKey), Buffer.from(env.owner_signature, 'base64url')),
      'missing independently signed owner equivalence decision');
  } else {
    throw new Error('unrecognized acceptance mode');
  }
  return payload;
}

export function verifyReceiptComments(comments, key, ownerKey, now) {
  assert(Array.isArray(comments) && comments.length <= 100, 'unbounded comment input');
  const candidates = [];
  for (const comment of comments) {
    if (typeof comment.body !== 'string' || !comment.body.startsWith(RECEIPT_MARKER)) continue;
    try {
      const payload = parseSignedEnvelope(comment.body, key, ownerKey, now);
      candidates.push(payload);
    } catch {
      // Any user can leave an invalid comment; it is NEVER an acceptance.
    }
  }
  return candidates;
}

// Used exclusively with hydrated data fetched by trusted REST verifier. This
// procedure never trusts a check name or an Actions app ID alone.
export function decideAcceptance(snapshot) {
  const fail = (reason) => ({ ok: false, reason });
  try {
    const { run, pr, branch, workflow, trustedCi, headCi, trustedContract,
      headContract, trustedPolicy, jobs, checks, candidateRuns, timeline, receipts,
      evidencePublicKey, evidenceKeyId, ownerPublicKey, now = Date.now() } = snapshot;
    assert(run && pr && branch && workflow && trustedCi && headCi &&
      trustedContract && headContract && trustedPolicy, 'missing live provenance inputs');
    assert(run.name === 'CI' && run.path === CI_PATH &&
      run.workflow_id === 297568453 &&
      run.workflow_id === workflow.id && workflow.path === CI_PATH &&
      workflow.name === 'CI' && workflow.state === 'active', 'untrusted CI workflow identity');
    assert(run.event === 'pull_request' && run.status === 'completed' &&
      run.conclusion === 'success' && Number.isSafeInteger(run.id) &&
      Number.isSafeInteger(run.run_attempt) && run.run_attempt >= 1,
      'not a successful real pull_request CI run/attempt');
    assert(SHA.test(run.head_sha) && run.head_sha === pr.head.sha &&
      run.head_branch === pr.head.ref, 'stale/retargeted CI head or branch');
    // Unlike workflow_run.pull_requests[].base/head, display_title is formed
    // by trusted CI `run-name` from the event-time PR base/head. Its immutability
    // must be empirically confirmed as an explicit bootstrap prerequisite.
    assert(run.display_title === immutablePrRunTitle(pr),
      'immutable event-time PR/head/base run title is absent or stale');
    assert(pr.state === 'open' && pr.draft === false && pr.base.ref === BASE &&
      pr.base.sha === branch.object.sha && SHA.test(pr.base.sha),
      'PR is draft/closed/retargeted or base not current');
    assert(pr.head.repo.id === REPOSITORY_ID && pr.head.repo.id === pr.base.repo.id &&
      pr.head.repo.full_name === REPO &&
      run.head_repository.id === pr.head.repo.id,
      'untrusted fork or cross-repository source');
    // Embedded pull_requests[] references have been observed to mutate when a
    // PR advances. They are not the source of immutable base/head assertions.
    assert(Array.isArray(run.pull_requests) && run.pull_requests.some((x) =>
      x.number === pr.number), 'run not associated with exact PR');
    assert(trustedCi.sha === headCi.sha && trustedContract.sha === headContract.sha,
      'PR modified trusted CI workflow or test execution contract');
    assert(Array.isArray(timeline) && timeline.length <= 100, 'PR transition timeline missing/oversized');
    const created = Date.parse(run.created_at);
    assert(Number.isFinite(created), 'run creation time absent');
    for (const event of timeline) {
      if (['ready_for_review', 'converted_to_draft', 'renamed', 'base_ref_changed'].includes(event.event)) {
        const changed = Date.parse(event.created_at);
        assert(Number.isFinite(changed), 'unverifiable PR transition');
        // A previously completed Draft/Ready run cannot be reused after another
        // transition, even when exact source bytes happen to remain unchanged.
        assert(changed <= created, 'PR readiness/base event superseded original test run');
      }
    }
    assert(Array.isArray(candidateRuns) && candidateRuns.length > 0 &&
      candidateRuns.length <= 100, 'cannot exhaustively select latest CI run');
    const relevant = candidateRuns.filter((item) =>
      item.workflow_id === run.workflow_id && item.event === 'pull_request' &&
      item.head_sha === pr.head.sha);
    assert(relevant.length && relevant.every((item) =>
      item.id <= run.id), 'newer same-source CI run exists');
    assert(Math.max(...relevant.map((item) => item.id)) === run.id, 'superseded/duplicate CI run');
    assert(relevant.filter((item) => item.id === run.id).length === 1 &&
      relevant.every((item) => item.id !== run.id ||
        (item.run_attempt === run.run_attempt && item.display_title === run.display_title)),
      'superseded or ambiguous run attempt');
    assert(Array.isArray(jobs) && jobs.length === 8 && Array.isArray(checks),
      'incomplete required jobs/check runs');
    const required = Object.keys(REQUIRED_JOBS);
    const found = new Set();
    for (const job of jobs) {
      assert(required.includes(job.name) && !found.has(job.name), 'unexpected/missing/duplicate required job');
      found.add(job.name);
      assert(job.run_id === run.id && job.run_attempt === run.run_attempt &&
        job.head_sha === run.head_sha && job.status === 'completed' &&
        job.conclusion === 'success' && Number.isSafeInteger(job.id),
        'job source/attempt/status not genuinely successful');
      assert(Array.isArray(job.steps), 'essential step evidence missing');
      const steps = new Map();
      for (const step of job.steps) {
        assert(!steps.has(step.name), 'duplicate named CI step');
        steps.set(step.name, step);
      }
      for (const name of REQUIRED_JOBS[job.name]) {
        const step = steps.get(name);
        assert(step?.status === 'completed' && step.conclusion === 'success',
          'required CI stage missing/skipped/neutral/failing: ' + job.name + '/' + name);
      }
      if (job.name === 'frontend') {
        assert(steps.get('Draft portable acceptance')?.conclusion === 'skipped',
          'reused Draft-portable frontend run');
      }
      const rawCheck = checks.find((item) => item.id === job.id);
      assert(rawCheck && rawCheck.name === job.name &&
        rawCheck.app?.id === ACTIONS_APP_ID &&
        rawCheck.check_suite?.id === run.check_suite_id &&
        rawCheck.head_sha === run.head_sha &&
        rawCheck.status === 'completed' && rawCheck.conclusion === 'success',
        'named status not tied to actual job/check suite');
      assert(typeof job.check_run_url === 'string' &&
        job.check_run_url.endsWith('/check-runs/' + job.id),
        'inconsistent attached job/check-run identity');
    }
    assert(found.size === required.length, 'missing required CI job');
    // Any check with a protected context name that is NOT the selected run's
    // actual job is ambiguous. Fails closed, even if another check reports green.
    const ids = new Set(jobs.map((job) => job.id));
    assert(!checks.some((item) => required.includes(item.name) && !ids.has(item.id)),
      'check-name collision/duplicate run on current head');
    const validReceipts = verifyReceiptComments(receipts, evidencePublicKey, ownerPublicKey, now)
      .filter((receipt) => receipt.pr === pr.number &&
        receipt.head_sha === pr.head.sha && receipt.base_sha === pr.base.sha &&
        receipt.ci_run_id === run.id && receipt.ci_run_attempt === run.run_attempt &&
        receipt.ci_workflow_blob === trustedCi.sha &&
        receipt.test_contract_blob === trustedContract.sha &&
        receipt.policy_blob === trustedPolicy.sha &&
        receipt.signer_key_id === evidenceKeyId);
    assert(validReceipts.length === 1, 'missing, duplicated or stale independently signed 20/20 receipt');
    assert(validReceipts[0].mode === 'historical-original' ||
      (APPROVED_EQUIVALENT_CASE_ID &&
        validReceipts[0].owner_decision_id === APPROVED_EQUIVALENT_CASE_ID),
    'no owner-approved equivalence policy; original T01 remains BLOCKED');
    assert(Date.parse(validReceipts[0].signed_at) >= created,
      'private receipt predates selected full-test run');
    return { ok: true, reason: 'exact-head/base/run/attempt, all 8 actual successful jobs and steps, signed full evidence accepted',
      pr: pr.number, head: pr.head.sha, run_id: run.id, run_attempt: run.run_attempt };
  } catch (error) {
    return fail(String(error?.message || error).slice(0, 320));
  }
}
