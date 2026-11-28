// Trusted GitHub Actions only: executed from the default branch by the
// workflow_run / pull_request_target / issue_comment verifier. This script
// NEVER checks out, imports, runs, downloads or caches untrusted PR code or
// artifacts. It reads only GitHub metadata and signed, redacted text receipts.
import {
  BASE, CHECK_EXTERNAL_PREFIX, CHECK_NAME, CI_PATH, POLICY_PATH, REPO,
  TEST_CONTRACT_PATH, decideAcceptance, immutablePrRunTitle,
} from './final-acceptance-policy.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const API = 'https://api.github.com';
const SHA = /^[0-9a-f]{40}$/;
const CHECK_SUMMARY = 'Original private evidence is required separately. No real Store, historical evidence or secrets were uploaded. This check is not a release approval.';
// This Draft implementation is a fail-closed prototype. The GitHub Actions
// issuer is not isolated, and a static completed check cannot be presumed
// safely reopenable or synchronously revoked. Only separately approved trusted
// source changes after rigorous bootstrap may enable successes.
export const FINAL_CHECK_ACTIVATION_APPROVED = false;

export function makeApi({ token, fetcher = fetch, ownerRepo = REPO } = {}) {
  if (!token) throw new Error('Trusted GITHUB_TOKEN absent');
  if (ownerRepo !== REPO) throw new Error('GitHub API route escaped trusted repository');
  return async (route, { method = 'GET', body } = {}) => {
    // The one bare repository metadata endpoint is necessary for main() to
    // validate default_branch. Everything else must be a real child of the
    // exact authorized repository, never a textual prefix or normalized URL.
    const root = '/repos/' + ownerRepo;
    const path = typeof route === 'string' ? route.split('?')[0] : '';
    const isMetadata = route === root;
    const isChild = path.startsWith(root + '/') &&
      path.slice(1).split('/').every((segment) =>
        segment.length > 0 && segment !== '.' && segment !== '..');
    if (!(isMetadata || isChild) ||
      /[\u0000-\u001f\u007f\\#]/.test(route) ||
      path.includes('%') || route.includes('://') ||
      (route.match(/\?/g) || []).length > 1) {
      throw new Error('GitHub API route escaped trusted repository');
    }
    const response = await fetcher(API + route, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'clack-default-branch-final-acceptance-verifier',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error('GitHub REST ' + method + ' ' +
      route.split('?')[0] + ' returned HTTP ' + response.status);
    return response.status === 204 ? null : response.json();
  };
}

export function externalId(pr, sha) {
  if (!Number.isSafeInteger(pr) || pr < 1 || !SHA.test(sha)) throw new Error('Bad check identity');
  return CHECK_EXTERNAL_PREFIX + ':' + pr + ':' + sha;
}

// Non-idempotent POST is used ONLY on the first sight of a head. Subsequent
// triggers update its previously created check-run ID. A duplicate external
// ID or another same-name issuer triggers a FAILURE, not an accepted check.
export async function upsertTrustedCheck(api, repo, pr, sha, verdict, detailsUrl) {
  const id = externalId(pr, sha);
  const result = await api('/repos/' + repo + '/commits/' + sha +
    '/check-runs?check_name=' + encodeURIComponent(CHECK_NAME) + '&per_page=100');
  if (result.total_count > 100 || !Array.isArray(result.check_runs)) {
    throw new Error('Cannot inspect every same-name final check');
  }
  const existing = result.check_runs.filter((check) => check.name === CHECK_NAME);
  const tagged = existing.filter((check) => check.external_id === id);
  // Details URL and external_id are bookkeeping, NOT identity/security proofs.
  // A strong issuer separation still requires an org required-workflow rule or
  // an independently authorized dedicated GitHub App if a PR author can mint
  // checks:write under the same GitHub Actions App.
  if (existing.length > 1 || tagged.length !== existing.length ||
    tagged.some((check) => check.app?.slug !== 'github-actions') ||
    tagged.length > 1) {
    throw new Error('Ambiguous or spoofed protected-main-final-acceptance check');
  }
  if (tagged.length && tagged[0].status === 'completed' && verdict.pending) {
    throw new Error('Terminal same-SHA check cannot be assumed reopenable; integration-time policy required');
  }
  const summary = CHECK_SUMMARY + '\n' + (verdict.reason || 'Unverifiable').slice(0, 500);
  const update = {
    name: CHECK_NAME, head_sha: sha, external_id: id, details_url: detailsUrl,
    status: verdict.pending ? 'in_progress' : 'completed',
    ...(verdict.pending ? {} : { conclusion: verdict.ok ? 'success' : 'failure' }),
    output: { title: verdict.ok ? 'Verified independent final acceptance' : 'Final acceptance not established',
      summary },
  };
  if (tagged.length) {
    const { head_sha: ignored, name: ignoredName, ...patch } = update;
    return api('/repos/' + repo + '/check-runs/' + tagged[0].id, { method: 'PATCH', body: patch });
  }
  return api('/repos/' + repo + '/check-runs', { method: 'POST', body: update });
}

const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
async function fetchOnePage(api, path, key) {
  const out = await api(path + (path.includes('?') ? '&' : '?') + 'per_page=100');
  const list = key ? out?.[key] : out;
  if (!Array.isArray(list) || list.length >= 100 || (key && out.total_count > 100)) {
    throw new Error('Unbounded/incomplete GitHub API pagination for ' + path.split('?')[0]);
  }
  return list;
}

export async function loadCandidateSnapshot(api, prNumber, {
  key, keyId, ownerKey, now = Date.now(), ciWorkflowId,
} = {}) {
  const repo = REPO;
  const pr = await api('/repos/' + repo + '/pulls/' + prNumber);
  assert(pr.number === prNumber && SHA.test(pr.head?.sha), 'live PR/head missing');
  const currentBranch = await api('/repos/' + repo + '/git/ref/heads/' + BASE);
  const workflow = await api('/repos/' + repo + '/actions/workflows/ci.yml');
  if (ciWorkflowId) assert(workflow.id === ciWorkflowId, 'CI workflow ID changed');
  const [trustedCi, headCi, trustedContract, headContract, trustedPolicy, timeline, comments] = await Promise.all([
    api('/repos/' + repo + '/contents/' + CI_PATH + '?ref=' + currentBranch.object.sha),
    api('/repos/' + repo + '/contents/' + CI_PATH + '?ref=' + pr.head.sha),
    api('/repos/' + repo + '/contents/' + TEST_CONTRACT_PATH + '?ref=' + currentBranch.object.sha),
    api('/repos/' + repo + '/contents/' + TEST_CONTRACT_PATH + '?ref=' + pr.head.sha),
    api('/repos/' + repo + '/contents/' + POLICY_PATH + '?ref=' + currentBranch.object.sha),
    fetchOnePage(api, '/repos/' + repo + '/issues/' + prNumber + '/timeline', null),
    fetchOnePage(api, '/repos/' + repo + '/issues/' + prNumber + '/comments', null),
  ]);
  // Check run and jobs are derived from one FULL immutable run attempt, never
  // the latest aggregate job list which can mix retries from multiple attempts.
  const listed = await api('/repos/' + repo + '/actions/workflows/ci.yml/runs?' +
    'event=pull_request&head_sha=' + pr.head.sha + '&per_page=100');
  assert(Array.isArray(listed.workflow_runs) && listed.total_count <= 100 &&
    listed.workflow_runs.length < 100, 'Cannot enumerate all matching CI runs');
  const candidates = listed.workflow_runs.filter((run) =>
    run.workflow_id === workflow.id && run.event === 'pull_request' &&
    run.head_sha === pr.head.sha);
  candidates.sort((a, b) => b.id - a.id);
  const latest = candidates[0];
  assert(latest, 'No genuine current-head CI run for this PR');
  const run = await api('/repos/' + repo + '/actions/runs/' + latest.id);
  assert(run.id === latest.id && run.run_attempt === latest.run_attempt &&
    run.head_sha === pr.head.sha, 'CI attempt changed mid-verification');
  // Source event-time base/head binding may NOT come from the mutable
  // run.pull_requests[].base/head references. Always require signed-off CI
  // run-name provenance from GitHub's event context.
  assert(run.display_title === immutablePrRunTitle(pr),
    'Latest CI run was created against a different event-time PR/base/head');
  const attempt = await api('/repos/' + repo + '/actions/runs/' + run.id +
    '/attempts/' + run.run_attempt);
  assert(attempt.id === run.id && attempt.run_attempt === run.run_attempt &&
    attempt.status === 'completed' && attempt.conclusion === 'success' &&
    attempt.head_sha === run.head_sha, 'CI attempt not independently successful');
  const jobResult = await api('/repos/' + repo + '/actions/runs/' + run.id +
    '/attempts/' + run.run_attempt + '/jobs?per_page=100');
  assert(Array.isArray(jobResult.jobs) && jobResult.total_count <= 100 &&
    jobResult.jobs.length < 100, 'Incomplete attempt-specific job set');
  const checkResult = await api('/repos/' + repo + '/commits/' + pr.head.sha + '/check-runs?per_page=100');
  assert(Array.isArray(checkResult.check_runs) && checkResult.total_count <= 100 &&
    checkResult.check_runs.length < 100, 'Incomplete attached check-run set');
  return {
    run, pr, branch: currentBranch, workflow, trustedCi, headCi, trustedPolicy,
    trustedContract, headContract, jobs: jobResult.jobs,
    checks: checkResult.check_runs, candidateRuns: candidates,
    timeline, receipts: comments, evidencePublicKey: key,
    evidenceKeyId: keyId,
    ownerPublicKey: ownerKey, now,
  };
}

export async function verifyOnePR(api, prNumber, env = {}) {
  assert(Number.isSafeInteger(prNumber) && prNumber > 0, 'Invalid target PR number');
  const pr = await api('/repos/' + REPO + '/pulls/' + prNumber);
  assert(pr.head && SHA.test(pr.head.sha), 'Cannot bind final check to PR head');
  const sha = pr.head.sha;
  const url = env.detailsUrl || 'https://github.com/' + REPO + '/actions/workflows/final-acceptance-verifier.yml';
  // Attempt to mark pending BEFORE validation. A terminal same-SHA check might
  // be immutable and is then a hard failure; do NOT claim its prior conclusion
  // was revoked. The executable success gate below is intentionally disabled.
  await upsertTrustedCheck(api, REPO, prNumber, sha, { pending: true,
    reason: 'Revalidating live source, CI attempt, base and signed evidence' }, url);
  let result;
  try {
    const snapshot = await loadCandidateSnapshot(api, prNumber, env);
    // Detect source/head/base/attempt races during a potentially slow API pass.
    const current = await api('/repos/' + REPO + '/pulls/' + prNumber);
    const latestBase = await api('/repos/' + REPO + '/git/ref/heads/' + BASE);
    const latestRun = await api('/repos/' + REPO + '/actions/runs/' + snapshot.run.id);
    const freshRuns = await api('/repos/' + REPO + '/actions/workflows/ci.yml/runs?' +
      'event=pull_request&head_sha=' + sha + '&per_page=100');
    const sameSource = freshRuns.workflow_runs?.filter((r) =>
      r.workflow_id === snapshot.workflow.id && r.event === 'pull_request' && r.head_sha === sha);
    if (current.head?.sha !== sha || current.base?.sha !== snapshot.pr.base.sha ||
      latestBase.object?.sha !== snapshot.branch.object.sha ||
      latestRun.run_attempt !== snapshot.run.run_attempt ||
      !Array.isArray(sameSource) || freshRuns.total_count > 100 ||
      sameSource.some((r) => r.id > snapshot.run.id ||
        (r.id === snapshot.run.id && r.run_attempt !== snapshot.run.run_attempt))) {
      result = { ok: false, reason: 'PR/base/attempt changed during verification' };
    } else result = decideAcceptance(snapshot);
  } catch (error) {
    result = { ok: false, reason: String(error?.message || error).slice(0, 300) };
  }
  if (result.ok && !FINAL_CHECK_ACTIVATION_APPROVED) {
    result = { ok: false, reason: 'Draft candidate: issuer isolation and synchronous merge-time revocation not owner-approved' };
  }
  // A race after this final fetch is still possible; the push/PR event and
  // strict base rule prevent adoption until reevaluation. Do not declare this
  // run a cryptographically authoritative check issuer without trust isolation.
  await upsertTrustedCheck(api, REPO, prNumber, sha, result, url);
  return result;
}

export async function main(env = process.env, { fetcher = fetch } = {}) {
  const eventName = env.GITHUB_EVENT_NAME;
  const payload = JSON.parse((await import('node:fs')).readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const repo = env.GITHUB_REPOSITORY;
  assert(repo === REPO, 'Verifier unexpectedly targeted another repository');
  assert(['workflow_run','pull_request_target','issue_comment','push','schedule'].includes(eventName),
    'Untrusted event mode for verifier');
  assert(env.GITHUB_REF === 'refs/heads/' + BASE, 'Privileged verifier must execute on default branch');
  const api = makeApi({ token: env.GITHUB_TOKEN, fetcher });
  const repoInfo = await api('/repos/' + repo);
  assert(repoInfo.default_branch === BASE, 'Trusted repository default branch differs');
  const tip = await api('/repos/' + repo + '/git/ref/heads/' + BASE);
  assert(env.GITHUB_SHA === tip.object.sha,
    'Default-branch verifier source has been superseded, refuse stale evaluation');
  let prs;
  if (eventName === 'workflow_run') {
    assert(payload.workflow_run?.name === 'CI' && payload.workflow_run?.path === CI_PATH &&
      ['requested', 'in_progress', 'completed'].includes(payload.action), 'Unexpected upstream event');
    prs = payload.workflow_run.pull_requests?.map((p) => p.number) || [];
    // Upstream pull_requests[] can be empty on real runs, and its head/base
    // references are mutable. Use it as a hint only, augmented by a live,
    // bounded exact-head query. Policy still validates the full immutable run.
    const open = await api('/repos/' + repo + '/pulls?state=open&base=' + BASE + '&per_page=100');
    assert(Array.isArray(open) && open.length < 100, 'Cannot enumerate live main PR heads');
    prs.push(...open.filter((p) => p.head?.sha === payload.workflow_run.head_sha)
      .map((p) => p.number));
  } else if (eventName === 'pull_request_target') {
    prs = [payload.pull_request?.number];
  } else if (eventName === 'issue_comment') {
    prs = payload.issue?.pull_request ? [payload.issue.number] : [];
  } else {
    if (eventName === 'push') assert(payload.ref === 'refs/heads/' + BASE,
      'Untrusted default branch push event');
    const candidates = await api('/repos/' + repo + '/pulls?state=open&base=' + BASE + '&per_page=100');
    assert(Array.isArray(candidates) && candidates.length < 100, 'Too many open PRs to reevaluate');
    prs = candidates.map((p) => p.number);
  }
  prs = [...new Set(prs)];
  assert(prs.every((p) => Number.isSafeInteger(p) && p > 0) && prs.length <= 50,
    'Unbounded or invalid PR-trigger list');
  for (const num of prs) {
    // Stacked PRs have their own genuine eight-job qualification. Do not
    // publish a main-only final acceptance check against the Zod stack base.
    const live = await api('/repos/' + repo + '/pulls/' + num);
    if (live.base?.ref !== BASE) continue;
    const result = await verifyOnePR(api, num, {
      key: env.CLACK_EVIDENCE_RECEIPT_PUBLIC_KEY_PEM,
      keyId: env.CLACK_EVIDENCE_SIGNER_KEY_ID,
      ownerKey: env.CLACK_ACCEPTANCE_OWNER_PUBLIC_KEY_PEM,
      ciWorkflowId: Number(env.CLACK_CI_WORKFLOW_ID || 0),
      detailsUrl: (env.GITHUB_SERVER_URL || 'https://github.com') + '/' + repo +
        '/actions/workflows/final-acceptance-verifier.yml',
    });
    // Failing the verifier job is desirable whenever the required check fails.
    if (!result.ok) process.exitCode = 1;
    process.stdout.write('PR #' + num + ': ' + (result.ok ? 'VERIFIED' : 'FAIL CLOSED') +
      ' — ' + result.reason + '\n');
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write('Final acceptance verifier unavailable: ' + error.message + '\n');
    process.exitCode = 1;
  });
}
