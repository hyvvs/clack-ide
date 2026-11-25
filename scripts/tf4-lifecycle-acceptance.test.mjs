// Synthetic inputs exercise only the observer's rejection rules. These tests
// are NOT installed application approval, native crash or physical acceptance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { inspectOracle, inspectRecoveredLedger } from './tf4-lifecycle-acceptance.mjs';

const nonce = 'tf4-lifecycle-test-0123456789abcdef';
const origin = 'https://fixture-owned.example';
const path = `/case/${nonce}/form`;
const body = `nonce=${nonce}&commit=once`;
const hash = value => createHash('sha256').update(value).digest('hex');
const attemptId = randomUUID();
const event = (disposition, extra = {}) => ({
  eventId: randomUUID(), at: new Date().toISOString(), runNonce: nonce,
  method: 'POST', path, attemptId, disposition, ...extra,
});
const ingress = event('post-ingress');
const write = event('one-write-accepted', { status: 201, bodySha256: hash(body),
  bodyBytes: Buffer.byteLength(body), responseHoldMs: 30000 });
const disconnect = event('held-response-disconnected');
const inspect = (mode, events) => inspectOracle({ runNonce: nonce, events }, nonce, origin, mode);

test('observer distinguishes zero POST, pending ingress and one held write without claiming physical acceptance', () => {
  assert.equal(inspect('baseline', []).observerCondition, 'ZERO_RECORDED_POSTS');
  assert.equal(inspect('await-held', [ingress]), null);
  const held = inspect('await-held', [ingress, write]);
  assert.equal(held.observerCondition, 'ONE_WRITE_HOLD_END_NOT_YET_RECORDED');
  assert.equal(held.physicalAcceptance, 'NOT_PROVEN');
  const after = inspect('after-disconnect', [ingress, write, disconnect]);
  assert.equal(after.observerCondition, 'ONE_WRITE_ONE_ATTEMPT_DISCONNECT');
  assert.equal(after.physicalAcceptance, 'NOT_PROVEN');
  assert.equal(after.nativeApprovalOrOriginalNodeCausalityProven, false);
});

test('observer rejects replay, unrelated ingress, wrong body, completed hold and mixed nonce', () => {
  assert.throws(() => inspect('zero-post', [ingress]), /zero-post/);
  assert.throws(() => inspect('after-disconnect', [ingress, write, disconnect,
    event('post-ingress', { attemptId: randomUUID() })]), /exactly-one/);
  assert.throws(() => inspect('baseline', [event('post-ingress', { path: '/__other-post' })]),
    /unexpected-post/);
  assert.throws(() => inspect('await-held', [ingress, { ...write, bodySha256: hash('wrong') }]),
    /body-or-hold/);
  assert.throws(() => inspect('await-held', [ingress, write, disconnect]), /already-ended/);
  assert.throws(() => inspect('after-disconnect', [ingress, write,
    event('held-response-release')]), /not-disconnected/);
  assert.throws(() => inspect('baseline', [{ ...ingress, runNonce: 'different-run' }]), /fresh-run/);
});

test('existing ledger record must recover once as interrupted/unknown without promotion', () => {
  const digest = hash('test-only-consumed-action');
  const record = {
    id: `tf4-${digest}`, epoch: 'old-epoch', window: 'native-browser',
    sessionId: 'session', workspaceId: 'workspace', agentId: 'agent', runId: null,
    taskId: null, tool: { id: 'tf.browser_operation.v1', version: 1, hash: hash('tf.browser_operation.v1') },
    toolName: 'Native browser action', kind: 'native', argumentsHash: digest,
    permissions: ['network'], test: false, state: 'running', effect: 'possible',
    createdAt: 1000, updatedAt: 1000, approval: digest, nativeId: null, result: null,
    error: null, transitions: [['running', 1000]],
  };
  const recovered = { ...record, state: 'interrupted', effect: 'unknown',
    error: 'interrupted-no-replay', updatedAt: 1100, transitions: [['running', 1000], ['interrupted', 1100]] };
  const before = { version: 1, records: [record] };
  const after = { version: 1, records: [recovered] };
  assert.equal(inspectRecoveredLedger(before, after, [recovered], digest).physicalAcceptance, 'NOT_PROVEN');
  assert.throws(() => inspectRecoveredLedger(before, { ...after, records: [recovered, recovered] },
    [recovered], digest), /not-unique/);
  assert.throws(() => inspectRecoveredLedger(before, after, [{ ...recovered, state: 'succeeded' }], digest),
    /recovery-mismatch/);
  assert.throws(() => inspectRecoveredLedger(before, { ...after, records: [
    { ...recovered, transitions: [...recovered.transitions, ['succeeded', 1200]] }] },
    [recovered], digest), /recovery-mismatch/);
});
