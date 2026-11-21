import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORIGINAL_BARRIER_STAGES,
  B01_DEADLINE_BOUNDARIES,
  B02_CANCELLATION_CASES,
  C12_LATE_RACE_CASES,
  assessB02Cancellation,
} from './lm11-full-matrix-cancel-contract.mjs';

const b02 = Object.fromEntries(B02_CANCELLATION_CASES.map(item => [item.id, item]));
const c12 = Object.fromEntries(C12_LATE_RACE_CASES.map(item => [item.id, item]));

test('B01 maps ten conceptual deadlines to eleven distinct actual held stages', () => {
  assert.equal(B01_DEADLINE_BOUNDARIES.length, 10);
  const physical = B01_DEADLINE_BOUNDARIES.flatMap(item => item.stages);
  assert.equal(physical.length, 11);
  assert.equal(new Set(physical).size, 11);
  assert.deepEqual(physical.filter(stage => stage !== 'native-status').sort(),
    [...ORIGINAL_BARRIER_STAGES].sort());
  assert.deepEqual(B01_DEADLINE_BOUNDARIES.at(-1).stages,
    ['b03-before-acknowledge', 'b03-before-readback']);
});

test('B02 contains fifteen independent targets and identifies actual runner capability gaps', () => {
  assert.equal(B02_CANCELLATION_CASES.length, 15);
  assert.deepEqual(B02_CANCELLATION_CASES.map(item => item.id),
    Array.from({ length: 15 }, (_, index) => `B02-${String(index + 1).padStart(2, '0')}`));
  assert.equal(new Set(B02_CANCELLATION_CASES.map(item =>
    `${item.trigger.kind}:${item.trigger.stage ?? item.trigger.phase}`)).size, 15);
  assert.equal(B02_CANCELLATION_CASES.filter(item =>
    item.harnessCoverage === 'stage-hook-ready-host-cancel-missing').length, 6);
  assert.equal(B02_CANCELLATION_CASES.filter(item =>
    item.authority === 'flight-already-disarmed').length, 4);
  assert.equal(b02['B02-06'].harnessCoverage, 'direct-proxy-only-original-hold-blocked');
});

test('Stop before native dispatch cannot create a stream or synthetic POST', () => {
  for (const id of ['B02-01', 'B02-02', 'B02-03', 'B02-04', 'B02-05',
    'B02-06', 'B02-07', 'B02-08']) {
    assert.equal(b02[id].expectedAfterRelease.nativeStreamDelta, 0, id);
    assert.equal(b02[id].expectedAfterRelease.successfulChatPostDelta, 0, id);
    assert.equal(b02[id].expectedAtHold.nativeCas.begin, 0, id);
  }
  for (const id of ['B02-06', 'B02-07', 'B02-08']) {
    assert.equal(b02[id].expectedAfterRelease.nativeOpenDelta, 1, id);
    assert.equal(b02[id].expectedAfterRelease.originalCancel, 'exact-original-id-required', id);
  }
  for (const id of ['B02-09', 'B02-10', 'B02-11']) {
    assert.equal(b02[id].expectedAfterRelease.nativeStreamDelta, 1, id);
    assert.equal(b02[id].expectedAfterRelease.originalRunner, 'rejected', id);
    assert.equal(b02[id].expectedAfterRelease.qualificationReceipt, 'zero-acknowledged', id);
  }
});

test('Late Stop never asserts impossible B03 rollback or zero pending rows', () => {
  assert.equal(b02['B02-13'].expectedAtHold.nativeCas.begin, 1);
  assert.equal(b02['B02-13'].expectedAtHold.nativeCas.prepare, 0);
  assert.equal(b02['B02-14'].expectedAtHold.nativeCas.receipts, 'pending-v0-only');
  assert.equal(b02['B02-14'].expectedAtHold.nativeCas.acknowledge, 0);
  assert.equal(b02['B02-15'].expectedAtHold.nativeCas.acknowledge, 1);
  assert.equal(b02['B02-15'].expectedAtHold.nativeCas.receipts, 'acknowledged-v2');
  for (const id of ['B02-12', 'B02-13', 'B02-14', 'B02-15']) {
    assert.equal(b02[id].expectedAfterRelease.originalRunner, 'unknown-until-proven');
    assert.equal(assessB02Cancellation(id).verdict, 'BLOCKED');
    assert.equal(assessB02Cancellation(id, { originalProductionRunner: true }).verdict, 'BLOCKED');
  }
});

test('C12 distinguishes original Chat callback evidence from direct native transport and shared cases', () => {
  assert.deepEqual(C12_LATE_RACE_CASES.map(item => item.id),
    Array.from({ length: 12 }, (_, index) => `C${String(index + 1).padStart(2, '0')}`));
  assert.equal(C12_LATE_RACE_CASES.length, 12);
  assert.equal(C12_LATE_RACE_CASES.filter(item => item.coverage === 'original-runner-narrow').length, 3);
  assert.equal(C12_LATE_RACE_CASES.filter(item =>
    item.coverage === 'direct-native-only' || item.coverage === 'direct-proxy-only').length, 9);
  assert.equal(c12.C01.scenario.name, c12.C02.scenario.name);
  assert.equal(c12.C04.scenario.name, c12.C05.scenario.name);
  assert.equal(c12.C06.scenario.name, c12.C07.scenario.name);
  assert.equal(c12.C08.expected.nativeStreamDelta, 0);
  assert.equal(c12.C08.expected.exactNativeCancel, 'late-own-id');
  assert.ok(C12_LATE_RACE_CASES.every(item => item.expected.b03 === 'zero'));
  assert.ok(C12_LATE_RACE_CASES.every(item =>
    item.matrixVerdict === 'not-executed-as-independent-original-runner-case'));
});

test('B02 assessor refuses a synthetic-only report that lacks real owner/terminal/effect proof', () => {
  assert.equal(assessB02Cancellation('B02-07').verdict, 'UNVERIFIED');
  assert.throws(() => assessB02Cancellation('B02-99'), /Unknown B02/);
  const observed = {
    originalProductionRunner: true, originalAggregateBudgetMs: 120_000,
    ownerAuthenticated: true, originalSessionBound: true,
    originalIpcHeld: true, cancelBeforeRelease: true, releasedExactlyOnce: true,
    originalRunnerTerminal: 'rejected', noRetroactivePassAfterTerminal: true,
    noNewChatOrTaskEffects: true, nativeAttemptsDrained: true,
    nativeOpenDelta: 1, nativeStreamDelta: 0, successfulChatPostDelta: 0,
    extraNativeStreamDelta: 0, nativeCas: { begin: 0, prepare: 0, acknowledge: 0 },
    acknowledgedQualificationReceipts: 0,
    cancelledExactOriginalRequestId: true,
  };
  assert.equal(assessB02Cancellation('B02-07', observed).verdict, 'PASS');
  const wrongOwner = assessB02Cancellation('B02-07', {
    ...observed, cancelledExactOriginalRequestId: false,
  });
  assert.equal(wrongOwner.verdict, 'FAIL');
  assert.ok(wrongOwner.checks.some(check =>
    check.name === 'original-cancel-ownership' && !check.pass));
  const delayedEffect = assessB02Cancellation('B02-07', {
    ...observed, nativeCas: { begin: 1, prepare: 0, acknowledge: 0 },
  });
  assert.equal(delayedEffect.verdict, 'FAIL');
  assert.ok(delayedEffect.checks.some(check => check.name === 'no-B03-begin' && !check.pass));
  const wrongBudget = assessB02Cancellation('B02-07', {
    ...observed, originalAggregateBudgetMs: 5000,
  });
  assert.equal(wrongBudget.verdict, 'FAIL');
});
