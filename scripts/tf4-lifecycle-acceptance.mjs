// Separate operator observer for TF4 lifecycle cases 10/11.
// This is not an app driver, approval source, process killer or release gate.
// No network occurs on import. CLI requires explicit operator-owned HTTPS
// configuration; the oracle bearer never enters Clack or its browser host.
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { summarizeOracle } from './tf4-public-https-fixture/verify.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const MAX_ORACLE_BYTES = 25 * 1024 * 1024;
const MAX_WAIT_MS = 20_000;
const modes = new Set(['baseline', 'zero-post', 'await-held', 'after-disconnect']);

function requireEvidence(condition, reason) {
  if (!condition) throw new Error(reason);
}

export function inspectOracle(record, nonce, origin, mode) {
  requireEvidence(modes.has(mode), 'lifecycle-observer-mode-invalid');
  const report = summarizeOracle(record, nonce, origin);
  requireEvidence(record.events.every(event => event.runNonce === nonce),
    'lifecycle-oracle-not-fresh-run-scope');
  requireEvidence(report.legacyUnlinkedWriteOutcomes === 0, 'lifecycle-oracle-legacy-outcome');
  requireEvidence(report.uploadPostAttempts === 0 && report.otherPostAttempts === 0 &&
    report.uploadAccepted === 0 && report.replayDenied === 0, 'lifecycle-unexpected-post-or-replay');
  const empty = report.recordedPostAttempts === 0 && report.formPostAttempts === 0 &&
    report.formAccepted === 0 && report.heldResponseEvidence.length === 0;
  if (mode === 'baseline' || mode === 'zero-post') {
    requireEvidence(empty, 'lifecycle-zero-post-violated');
    // Baseline may include prior read-only document observation. This proves
    // zero parsed POSTs only, not zero GETs, raw TCP or all native egress.
    return { ...report, observerCondition: 'ZERO_RECORDED_POSTS', physicalAcceptance: 'NOT_PROVEN' };
  }
  if (empty || (report.recordedPostAttempts === 1 && report.formPostAttempts === 1 &&
      report.formAccepted === 0 && report.heldResponseEvidence.length === 0)) return null;
  requireEvidence(report.recordedPostAttempts === 1 && report.formPostAttempts === 1 &&
    report.formAccepted === 1 && report.acceptedWriteEvidence.length === 1,
  'lifecycle-not-exactly-one-form-attempt-and-write');
  const write = report.acceptedWriteEvidence[0];
  const body = `nonce=${nonce}&commit=once`;
  requireEvidence(write.path === `/case/${nonce}/form` && write.bodySha256 === sha256(body) &&
    write.bodyBytes === Buffer.byteLength(body) &&
    Number.isSafeInteger(write.responseHoldMs) && write.responseHoldMs > 0 &&
    write.responseHoldMs <= 30_000, 'lifecycle-form-body-or-hold-mismatch');
  const ends = report.heldResponseEvidence;
  if (mode === 'await-held') {
    requireEvidence(ends.length === 0, 'lifecycle-response-hold-already-ended');
    return { ...report, observerCondition: 'ONE_WRITE_HOLD_END_NOT_YET_RECORDED', physicalAcceptance: 'NOT_PROVEN' };
  }
  if (ends.length === 0) return null;
  requireEvidence(ends.length === 1 && ends[0].attemptId === write.attemptId &&
    ends[0].disposition === 'held-response-disconnected', 'lifecycle-held-response-not-disconnected');
  return { ...report, observerCondition: 'ONE_WRITE_ONE_ATTEMPT_DISCONNECT', physicalAcceptance: 'NOT_PROVEN' };
}

// Verify the existing durable record, not a replacement ledger. The caller
// must independently authenticate the before/after disk observations and the
// restarted app's actual custom_tool_history response and process identities.
// No file is modified, and this helper cannot establish those prerequisites.
export function inspectRecoveredLedger(before, after, history, actionIdSha256) {
  requireEvidence(/^[a-f0-9]{64}$/.test(actionIdSha256), 'lifecycle-ledger-action-digest-invalid');
  const id = `tf4-${actionIdSha256}`;
  const select = records => {
    requireEvidence(Array.isArray(records), 'lifecycle-ledger-invalid');
    const matching = records.filter(record => record.id === id);
    requireEvidence(matching.length === 1, 'lifecycle-ledger-record-not-unique');
    return matching[0];
  };
  requireEvidence(before?.version === 1 && after?.version === 1, 'lifecycle-ledger-version-invalid');
  const original = select(before.records);
  const recovered = select(after.records);
  const reported = select(history);
  const stable = ['id', 'epoch', 'window', 'sessionId', 'workspaceId', 'agentId', 'runId',
    'taskId', 'tool', 'toolName', 'kind', 'argumentsHash', 'permissions', 'test', 'approval',
    'nativeId', 'createdAt'];
  requireEvidence(original.tool?.id === 'tf.browser_operation.v1' &&
    original.tool.version === 1 && original.tool.hash === sha256('tf.browser_operation.v1') &&
    original.window === 'native-browser' && original.kind === 'native' && original.test === false &&
    original.approval === actionIdSha256 && original.argumentsHash === actionIdSha256 &&
    original.state === 'running' && original.effect === 'possible' && original.result === null &&
    original.error === null && Array.isArray(original.transitions) &&
    original.transitions.length === 1 && original.transitions[0]?.[0] === 'running',
  'lifecycle-ledger-not-durable-running-possible');
  requireEvidence(stable.every(key => JSON.stringify(original[key]) === JSON.stringify(recovered[key])) &&
    recovered.state === 'interrupted' && recovered.effect === 'unknown' &&
    recovered.error === 'interrupted-no-replay' && recovered.result === null &&
    Array.isArray(recovered.transitions) && recovered.transitions.length === 2 &&
    JSON.stringify(recovered.transitions[0]) === JSON.stringify(original.transitions[0]) &&
    recovered.transitions[1]?.[0] === 'interrupted' &&
    recovered.transitions[1][1] === recovered.updatedAt &&
    recovered.updatedAt >= original.updatedAt &&
    JSON.stringify(recovered) === JSON.stringify(reported),
  'lifecycle-ledger-recovery-mismatch');
  return { recordId: id, state: recovered.state, effect: recovered.effect,
    terminalTransitions: 1, physicalAcceptance: 'NOT_PROVEN' };
}

async function readOracle(origin, token, remainingMs) {
  const response = await fetch(`${origin}/__oracle/receipts`, {
    method: 'GET', headers: { authorization: `Bearer ${token}` },
    redirect: 'manual', signal: AbortSignal.timeout(Math.min(7000, remainingMs)),
  });
  requireEvidence(response.ok && !response.redirected &&
    response.url === `${origin}/__oracle/receipts`, 'lifecycle-oracle-read-failed');
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      requireEvidence(size <= MAX_ORACLE_BYTES, 'lifecycle-oracle-response-too-large');
      parts.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } finally { await reader.cancel(); }
}

async function main() {
  const mode = process.argv[2];
  requireEvidence(process.argv.length === 3 && modes.has(mode),
    'usage: node scripts/tf4-lifecycle-acceptance.mjs baseline|zero-post|await-held|after-disconnect');
  const { TF4_FIXTURE_PUBLIC_ORIGIN: origin, TF4_FIXTURE_ORACLE_TOKEN: token,
    TF4_FIXTURE_RUN_NONCE: nonce, TF4_LIFECYCLE_OPERATOR_AUTHORIZED: authorized } = process.env;
  requireEvidence(authorized === '1' && /^https:\/\/[^/?#:@]+$/.test(origin ?? '') &&
    /^[a-f0-9]{64}$/.test(token ?? '') && /^[a-z0-9][a-z0-9-]{14,62}[a-z0-9]$/.test(nonce ?? '') &&
    !new URL(origin).port && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
  'lifecycle-operator-owned-TLS443-oracle-required');
  const deadline = performance.now() + MAX_WAIT_MS;
  do {
    const remaining = Math.floor(deadline - performance.now());
    if (remaining < 1) break;
    const report = inspectOracle(await readOracle(origin, token, remaining), nonce, origin, mode);
    if (report) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    await new Promise(done => setTimeout(done, Math.min(100, Math.max(0, deadline - performance.now()))));
  } while (performance.now() < deadline);
  throw new Error('lifecycle-oracle-bounded-wait-expired');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // Avoid logging fetch errors or configuration containing operator secrets.
  main().catch(() => {
    console.error('TF4 lifecycle observer blocked or failed; physical acceptance NOT_PROVEN');
    process.exitCode = 1;
  });
}
