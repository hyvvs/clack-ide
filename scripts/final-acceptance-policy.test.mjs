import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ACTIONS_APP_ID, BASE, CHECK_NAME, CI_PATH, RECEIPT_DOMAIN, RECEIPT_MARKER,
  REPO, REPOSITORY_ID, REQUIRED_JOBS, immutablePrRunTitle, canonicalReceiptJSON, decideAcceptance,
} from './final-acceptance-policy.mjs';
import { externalId, loadCandidateSnapshot, makeApi, upsertTrustedCheck,
  verifyOnePR, FINAL_CHECK_ACTIVATION_APPROVED } from './final-acceptance-verifier.mjs';

// Synthetic identities and ephemeral in-memory signing keys ONLY. These
// receipts CANNOT be accepted as CLACK real-world evidence or production data.
const cryptoKeys = generateKeyPairSync('ed25519');
const ownerKeys = generateKeyPairSync('ed25519');
const evidencePub = cryptoKeys.publicKey.export({ type: 'spki', format: 'pem' });
const ownerPub = ownerKeys.publicKey.export({ type: 'spki', format: 'pem' });
const HEAD = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);
const WORKFLOW_SHA = 'c'.repeat(40);
const CONTRACT_SHA = 'd'.repeat(40);
const POLICY_SHA = 'e'.repeat(40);
const KEY_ID = 'synthetic-fixture-key';
const NOW = Date.parse('2026-11-28T09:00:00Z');
const RUN_ID = 92640002;
const PR = 77;
const NAMES = Object.keys(REQUIRED_JOBS);
const GROUPS = {
  'muse-nov03': 8,
  'hosted-egress-historical-reports': 2,
  'lm11-t01-original': 1,
  't15-attributable': 3,
  'muse-host-sources': 3,
  'muse-crash-only': 3,
};
const clone = (obj) => structuredClone(obj);

function receiptPayload(mode = 'historical-original') {
  const contemporary = mode === 'separately-authorized-contemporary';
  return {
    schema: 'clack-private-evidence-v1', repository: REPO,
    repository_id: REPOSITORY_ID, pr: PR,
    head_sha: HEAD, base_sha: BASE_SHA, ci_run_id: RUN_ID, ci_run_attempt: 1,
    ci_workflow_id: 297568453,
    ci_workflow_blob: WORKFLOW_SHA, test_contract_blob: CONTRACT_SHA,
    policy_blob: POLICY_SHA, signer_key_id: KEY_ID, nonce: 'f'.repeat(32),
    signed_at: '2026-11-28T08:30:00Z', expires_at: '2026-11-29T08:30:00Z',
    mode,
    groups: Object.entries(GROUPS).map(([id, count]) => ({
      id, passed: count - Number(contemporary && id === 'lm11-t01-original'),
      failed: Number(contemporary && id === 'lm11-t01-original'), skipped: 0,
    })),
    inputs_unchanged: true, real_store_identity_verified: true,
    private_runner_source_verified: true,
    owner_decision_id: contemporary ? 'LM11-CURRENT-20261128-reviewedowner' : null,
    contemporary_selector_pass: contemporary ? true : null,
    contemporary_observer_sha256: contemporary ? 'e'.repeat(64) : null,
  };
}
function signedComment(payload = receiptPayload(), {
  privateKey = cryptoKeys.privateKey,
  ownerKey = null,
} = {}) {
  const encoded = Buffer.from(canonicalReceiptJSON(payload)).toString('base64url');
  const message = Buffer.from(RECEIPT_DOMAIN + encoded);
  const env = {
    payload: encoded,
    signature: sign(null, message, privateKey).toString('base64url'),
    owner_signature: ownerKey ? sign(null, message, ownerKey).toString('base64url') : null,
  };
  return { body: RECEIPT_MARKER + Buffer.from(JSON.stringify(env)).toString('base64url') };
}
function fixture() {
  const pr = {
    number: PR, state: 'open', draft: false,
    head: { sha: HEAD, ref: 'governance-fixture', repo: { id: REPOSITORY_ID, full_name: REPO } },
    base: { sha: BASE_SHA, ref: BASE, repo: { id: REPOSITORY_ID, full_name: REPO } },
  };
  const run = {
    id: RUN_ID, run_attempt: 1, workflow_id: 297568453, name: 'CI', path: CI_PATH,
    event: 'pull_request', status: 'completed', conclusion: 'success',
    head_sha: HEAD, head_branch: pr.head.ref, check_suite_id: 53001,
    head_repository: { id: pr.head.repo.id },
    pull_requests: [{
      number: PR, head: { sha: HEAD }, base: { sha: BASE_SHA, ref: BASE },
    }],
    created_at: '2026-11-28T08:00:00Z',
    display_title: immutablePrRunTitle(pr),
  };
  const jobs = NAMES.map((name, index) => ({
    id: 5000 + index, name, run_id: RUN_ID, run_attempt: 1,
    head_sha: HEAD, status: 'completed', conclusion: 'success',
    check_run_url: 'https://api.github.com/repos/' + REPO +
      '/check-runs/' + (5000 + index),
    steps: [
      { name: 'Draft portable acceptance', status: 'completed', conclusion: 'skipped' },
      ...REQUIRED_JOBS[name].map((step) => ({
        name: step, status: 'completed', conclusion: 'success',
      })),
    ],
  }));
  const checks = jobs.map((j) => ({
    id: j.id, name: j.name, app: { id: ACTIONS_APP_ID },
    head_sha: HEAD, status: 'completed', conclusion: 'success',
    check_suite: { id: run.check_suite_id },
  }));
  return {
    pr, run, workflow: { id: 297568453, name: 'CI', path: CI_PATH, state: 'active' },
    branch: { object: { sha: BASE_SHA } }, trustedCi: { sha: WORKFLOW_SHA },
    headCi: { sha: WORKFLOW_SHA }, trustedContract: { sha: CONTRACT_SHA },
    trustedPolicy: { sha: POLICY_SHA }, evidenceKeyId: KEY_ID,
    headContract: { sha: CONTRACT_SHA }, jobs, checks,
    candidateRuns: [clone(run)], timeline: [
      { event: 'ready_for_review', created_at: '2026-11-28T07:55:00Z' },
    ],
    receipts: [signedComment()], evidencePublicKey: evidencePub,
    ownerPublicKey: ownerPub, now: NOW,
  };
}
function rejects(label, mutate) {
  test(label, () => {
    const data = fixture();
    mutate(data);
    const result = decideAcceptance(data);
    assert.equal(result.ok, false, label + ' incorrectly accepted: ' + result.reason);
    assert.ok(result.reason.length > 3);
  });
}

test('SYNTHETIC complete genuine 8-job + independently signed 20/20 is accepted offline', () => {
  const result = decideAcceptance(fixture());
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.run_attempt, 1);
});
rejects('draft PR cannot reuse green Draft portable run', (d) => { d.pr.draft = true; });
rejects('closed PR rejected', (d) => { d.pr.state = 'closed'; });
rejects('retargeted PR rejected', (d) => { d.pr.base.ref = 'other'; });
rejects('current base moved rejected', (d) => { d.branch.object.sha = 'e'.repeat(40); });
rejects('run anchored to old immutable event-time base rejected even with mutated PR references', (d) => {
  d.run.display_title = 'CLACK CI PR ' + PR + ' head ' + HEAD + ' base ' + 'e'.repeat(40);
});
test('mutable embedded workflow_run PR references cannot overwrite genuine immutable title', () => {
  const d = fixture();
  d.run.pull_requests[0].head.sha = 'e'.repeat(40);
  d.run.pull_requests[0].base.sha = 'f'.repeat(40);
  assert.equal(decideAcceptance(d).ok, true);
});
rejects('run after old head rejected', (d) => { d.pr.head.sha = 'e'.repeat(40); });
rejects('diagnostic source-pinned dispatch rejected', (d) => { d.run.event = 'workflow_dispatch'; });
rejects('push job not a PR run', (d) => { d.run.event = 'push'; });
rejects('non-success conclusion rejected', (d) => { d.run.conclusion = 'neutral'; });
rejects('pending workflow rejected', (d) => { d.run.status = 'in_progress'; });
rejects('wrong workflow ID rejected', (d) => { d.run.workflow_id = 400; });
rejects('wrong workflow path rejected', (d) => { d.run.path = 'other.yml'; });
rejects('PR-changed workflow body rejected', (d) => { d.headCi.sha = 'f'.repeat(40); });
rejects('PR-changed full test plan rejected', (d) => { d.headContract.sha = 'f'.repeat(40); });
rejects('old Draft run after Ready transition rejected', (d) => {
  d.timeline.push({ event: 'ready_for_review', created_at: '2026-11-28T08:01:00Z' });
});
rejects('old run after converted_to_draft transition rejected', (d) => {
  d.timeline.push({ event: 'converted_to_draft', created_at: '2026-11-28T08:01:00Z' });
});
rejects('old run after edited base event rejected', (d) => {
  d.timeline.push({ event: 'base_ref_changed', created_at: '2026-11-28T08:01:00Z' });
});
rejects('old attempt after rerun rejected', (d) => { d.candidateRuns[0].run_attempt = 2; });
rejects('newer event-time run with changed base but same SHA invalidates previous success', (d) => {
  d.candidateRuns.push({ ...clone(d.run), id: RUN_ID + 1,
    display_title: 'CLACK CI PR ' + PR + ' head ' + HEAD + ' base ' + 'e'.repeat(40) });
});
rejects('wrong evidence signer key identifier rejected', (d) => {
  d.evidenceKeyId = 'rotated-authorized-key';
});
rejects('modified trusted verifier policy cannot reuse previous receipt', (d) => {
  d.trustedPolicy.sha = 'a'.repeat(40);
});
rejects('untrusted CI workflow numeric identity rejects', (d) => {
  d.run.workflow_id = 99; d.workflow.id = 99;
});
rejects('superseded workflow_run webhook rejected', (d) => {
  d.candidateRuns.push({ ...clone(d.run), id: RUN_ID + 1 });
});
rejects('incomplete job coverage rejected', (d) => { d.jobs.pop(); });
rejects('duplicate attached job rejected', (d) => { d.jobs[1] = clone(d.jobs[0]); });
rejects('skipped required job rejected', (d) => { d.jobs[2].conclusion = 'skipped'; });
rejects('neutral required job rejected', (d) => { d.jobs[2].conclusion = 'neutral'; });
rejects('missing required essential step rejected', (d) => { d.jobs[0].steps.pop(); });
rejects('skipped required essential step rejected', (d) => {
  d.jobs[0].steps[2].conclusion = 'skipped';
});
rejects('neutral required essential step rejected', (d) => {
  d.jobs[0].steps[2].conclusion = 'neutral';
});
rejects('Draft portable step reused on Ready PR rejected', (d) => {
  d.jobs[0].steps[0].conclusion = 'success';
});
rejects('wrong GitHub Actions app check rejected', (d) => { d.checks[0].app.id = 222; });
rejects('wrong check suite rejected', (d) => { d.checks[0].check_suite.id = 999; });
rejects('manual same-name status collision rejected', (d) => {
  d.checks.push({ ...clone(d.checks[0]), id: 99999 });
});
rejects('missing attached real job check rejected', (d) => { d.checks.pop(); });
rejects('missing historical signed receipt rejects', (d) => { d.receipts = []; });
rejects('fake synthetic private-evidence receipt signature rejects', (d) => {
  d.receipts = [signedComment(receiptPayload(), { privateKey: ownerKeys.privateKey })];
});
rejects('incorrect public signing key rejects', (d) => {
  d.evidencePublicKey = ownerPub;
});
rejects('old source receipt rejected', (d) => {
  const p = receiptPayload(); p.head_sha = 'f'.repeat(40); d.receipts = [signedComment(p)];
});
rejects('replayed previous CI attempt receipt rejected', (d) => {
  const p = receiptPayload(); p.ci_run_attempt = 2; d.receipts = [signedComment(p)];
});
rejects('expired evidence receipt rejected', (d) => { d.now += 9 * 86400_000; });
rejects('nineteen genuine passes do NOT qualify twentieth historical T01', (d) => {
  const p = receiptPayload();
  p.groups.find((x) => x.id === 'lm11-t01-original').passed = 0;
  p.groups.find((x) => x.id === 'lm11-t01-original').failed = 1;
  d.receipts = [signedComment(p)];
});
rejects('missing original evidence Store identity does not qualify', (d) => {
  const p = receiptPayload(); p.real_store_identity_verified = false;
  d.receipts = [signedComment(p)];
});
rejects('duplicate real valid receipts fail closed', (d) => {
  d.receipts.push(clone(d.receipts[0]));
});
rejects('contemporary equivalence without independent owner countersign fails', (d) => {
  d.receipts = [signedComment(receiptPayload('separately-authorized-contemporary'))];
});
rejects('contemporary equivalence without independent read-only selector pass fails', (d) => {
  const p = receiptPayload('separately-authorized-contemporary');
  p.contemporary_selector_pass = false;
  d.receipts = [signedComment(p, { ownerKey: ownerKeys.privateKey })];
});
rejects('contemporary equivalence cannot retroactively mark historic T01 pass', (d) => {
  const p = receiptPayload('separately-authorized-contemporary');
  p.groups.find((x) => x.id === 'lm11-t01-original').passed = 1;
  p.groups.find((x) => x.id === 'lm11-t01-original').failed = 0;
  d.receipts = [signedComment(p, { ownerKey: ownerKeys.privateKey })];
});
test('even SYNTHETIC two-signature contemporary equivalence is disabled without owner-approved trusted policy update', () => {
  const d = fixture();
  d.receipts = [signedComment(receiptPayload('separately-authorized-contemporary'),
    { ownerKey: ownerKeys.privateKey })];
  const result = decideAcceptance(d);
  assert.equal(result.ok, false, result.reason);
  assert.match(result.reason, /no owner-approved equivalence policy/);
});
test('comment without trusted signature cannot mask a single authenticated statement', () => {
  const d = fixture();
  d.receipts.push({ body: RECEIPT_MARKER + 'invalid' });
  assert.equal(decideAcceptance(d).ok, true);
});
test('repo check issuer rejects fake identity and duplicate external check', async () => {
  const responses = [
    { total_count: 1, check_runs: [{ id: 41, name: CHECK_NAME, external_id: 'spoof',
      app: { slug: 'github-actions' } }] },
    { total_count: 2, check_runs: [
      { id: 41, name: CHECK_NAME, external_id: externalId(PR, HEAD),
        app: { slug: 'github-actions' } },
      { id: 42, name: CHECK_NAME, external_id: externalId(PR, HEAD),
        app: { slug: 'github-actions' } },
    ] },
  ];
  for (const response of responses) {
    const fake = async () => response;
    await assert.rejects(() => upsertTrustedCheck(fake, REPO, PR, HEAD, { ok: true }, 'https://example.com'),
      /Ambiguous or spoofed/);
  }
});
test('trusted check publisher creates pending then updates check, never re-POSTs duplicate', async () => {
  const requests = [];
  let existing = [];
  const fake = async (url, opts = {}) => {
    requests.push({ url, ...opts });
    if (url.includes('/commits/')) return { total_count: existing.length, check_runs: existing };
    if (opts.method === 'POST') {
      existing = [{ id: 67, name: CHECK_NAME, external_id: externalId(PR, HEAD),
        app: { slug: 'github-actions' } }];
      return { id: 67 };
    }
    if (opts.method === 'PATCH') return { id: 67 };
    throw new Error('Unexpected REST request');
  };
  await upsertTrustedCheck(fake, REPO, PR, HEAD, { pending: true }, 'https://example.com');
  await upsertTrustedCheck(fake, REPO, PR, HEAD, { ok: false, reason: 'no historical T01' }, 'https://example.com');
  assert.deepEqual(requests.filter((x) => x.method).map((x) => x.method), ['POST', 'PATCH']);
  assert.equal(requests[1].body.status, 'in_progress');
  assert.equal(requests[3].body.conclusion, 'failure');
});
test('cannot silently reopen a terminal same-SHA success as pending', async () => {
  const fake = async () => ({ total_count: 1, check_runs: [{
    id: 55, name: CHECK_NAME, external_id: externalId(PR, HEAD),
    app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success',
  }] });
  await assert.rejects(() => upsertTrustedCheck(fake, REPO, PR, HEAD,
    { pending: true }, 'https://example.test'), /cannot be assumed reopenable/);
});
test('API refuses cross-repo routes and does not allow arbitrary host URLs', async () => {
  const api = makeApi({ token: 'SYNTHETIC_DO_NOT_USE', fetcher: async () => {
    throw new Error('network should never be used');
  } });
  await assert.rejects(() => api('https://api.evil.test/'), /escaped trusted repository/);
  await assert.rejects(() => api('/repos/other/repo/pulls/1'), /escaped trusted repository/);
});
test('source workflow separates PR/check identities and retains all exact job names', () => {
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const verifier = readFileSync(new URL('../.github/workflows/final-acceptance-verifier.yml', import.meta.url), 'utf8');
  assert.match(ci, /branches:\s*\[main, security\/zod-4\.6\.6-ghsa-20261127, maintenance\/protected-main-quality-20261128\]/);
  assert.match(ci, /edited, ready_for_review, converted_to_draft/);
  assert.match(ci, /Full original acceptance \(npm test\)/);
  assert.match(ci, /Draft portable acceptance/);
  assert.match(ci, /diagnostic \/ rust-test/);
  assert.equal(ci.match(/- name: Verify exact CI source checkout/g)?.length, 5);
  assert.match(verifier, /workflow_run:/);
  assert.match(verifier, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(verifier, /checks: write/);
  assert.doesNotMatch(verifier, /ref: \$\{\{ github\.event\.pull_request\.head/);
  assert.doesNotMatch(verifier, /cache: npm/);
  assert.doesNotMatch(verifier, /protected-main-final-acceptance/);
});

// Read-only REST fixture: reproduces the exact GitHub endpoint graph, including
// immutable per-attempt jobs, rather than testing only the pure policy function.
function mockGitHubApi(d) {
  const calls = [];
  let finalCheck = null;
  let prReads = 0;
  const api = async (route, options = {}) => {
    calls.push({ route, options });
    if (route === '/repos/' + REPO + '/pulls/' + PR) {
      prReads++;
      return d.prReads?.(prReads, d.pr) || d.pr;
    }
    if (route.endsWith('/git/ref/heads/main')) return d.branch;
    if (route.endsWith('/actions/workflows/ci.yml')) return d.workflow;
    if (route.includes('/contents/')) {
      if (route.includes('final-acceptance-policy.mjs')) return d.trustedPolicy;
      if (route.includes('test-execution-contract.mjs')) return route.includes('?ref=' + HEAD) ? d.headContract : d.trustedContract;
      if (route.includes('/ci.yml')) return route.includes('?ref=' + HEAD) ? d.headCi : d.trustedCi;
    }
    if (route.includes('/issues/' + PR + '/timeline')) return d.timeline;
    if (route.includes('/issues/' + PR + '/comments')) return d.receipts;
    if (route.includes('/actions/workflows/ci.yml/runs?')) {
      return { total_count: d.candidateRuns.length, workflow_runs: d.candidateRuns };
    }
    if (route.endsWith('/actions/runs/' + RUN_ID + '/attempts/1')) return {
      ...d.run, status: 'completed', conclusion: 'success',
    };
    if (route.includes('/actions/runs/' + RUN_ID + '/attempts/1/jobs?')) return {
      total_count: d.jobs.length, jobs: d.jobs,
    };
    if (route.endsWith('/actions/runs/' + RUN_ID)) return d.run;
    if (route.includes('/commits/' + HEAD + '/check-runs?check_name=')) {
      return { total_count: Number(Boolean(finalCheck)), check_runs: finalCheck ? [finalCheck] : [] };
    }
    if (route.includes('/commits/' + HEAD + '/check-runs?')) return {
      total_count: d.checks.length + Number(Boolean(finalCheck)),
      check_runs: [...d.checks, ...(finalCheck ? [finalCheck] : [])],
    };
    if (route.endsWith('/check-runs') && options.method === 'POST') {
      finalCheck = { ...options.body, id: 1000001, app: { slug: 'github-actions' } };
      return finalCheck;
    }
    if (route.endsWith('/check-runs/1000001') && options.method === 'PATCH') {
      finalCheck = { ...finalCheck, ...options.body };
      return finalCheck;
    }
    throw new Error('Unexpected fake GitHub endpoint: ' + route);
  };
  return { api, calls, getFinal: () => finalCheck };
}

test('mock REST loads only one immutable run attempt and eight real jobs', async () => {
  const d = fixture();
  const { api, calls } = mockGitHubApi(d);
  const snapshot = await loadCandidateSnapshot(api, PR, {
    key: evidencePub, keyId: KEY_ID, ownerKey: ownerPub, ciWorkflowId: 297568453, now: NOW,
  });
  assert.equal(decideAcceptance(snapshot).ok, true);
  assert.ok(calls.some(({ route }) => route.endsWith('/attempts/1')));
  assert.ok(calls.some(({ route }) => route.includes('/attempts/1/jobs?')));
  assert.ok(calls.some(({ route }) => route.includes('/contents/scripts/final-acceptance-policy.mjs')));
});

test('mock REST rejects rerun that advances attempt between listing and detail', async () => {
  const d = fixture();
  d.candidateRuns[0].run_attempt = 2;
  const { api } = mockGitHubApi(d);
  await assert.rejects(() => loadCandidateSnapshot(api, PR, {
    key: evidencePub, keyId: KEY_ID, ownerKey: ownerPub, ciWorkflowId: 297568453, now: NOW,
  }), /attempt changed/);
});

test('mock REST rejects mutable-PR-reference forgery with old immutable run title', async () => {
  const d = fixture();
  d.run.display_title = 'CLACK CI PR ' + PR + ' head ' + HEAD + ' base ' + 'f'.repeat(40);
  const { api } = mockGitHubApi(d);
  await assert.rejects(() => loadCandidateSnapshot(api, PR, {
    key: evidencePub, keyId: KEY_ID, ownerKey: ownerPub, ciWorkflowId: 297568453, now: NOW,
  }), /different event-time/);
});

test('mock REST publisher invalidates previous check before discovering a retarget race', async () => {
  const d = fixture();
  d.prReads = (number, original) => number >= 3 ? {
    ...original, base: { ...original.base, sha: 'f'.repeat(40) },
  } : original;
  const { api, getFinal, calls } = mockGitHubApi(d);
  const result = await verifyOnePR(api, PR, {
    key: evidencePub, keyId: KEY_ID, ownerKey: ownerPub,
    ciWorkflowId: 297568453, now: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(getFinal().conclusion, 'failure');
  assert.deepEqual(calls.filter(({ options }) => options.method === 'POST' ||
    options.method === 'PATCH').map(({ options }) => options.method), ['POST', 'PATCH']);
});

test('even a fully positive synthetic REST verdict CANNOT mint acceptance before secure bootstrap', async () => {
  const d = fixture();
  const { api, getFinal } = mockGitHubApi(d);
  const result = await verifyOnePR(api, PR, {
    key: evidencePub, keyId: KEY_ID, ownerKey: ownerPub,
    ciWorkflowId: 297568453, now: NOW,
  });
  assert.equal(FINAL_CHECK_ACTIVATION_APPROVED, false);
  assert.equal(result.ok, false);
  assert.match(result.reason, /not owner-approved/);
  assert.equal(getFinal().conclusion, 'failure');
});
