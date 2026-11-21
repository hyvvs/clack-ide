import assert from 'node:assert/strict';
import test from 'node:test';
import { b02AsyncGate, classification, compileRows, verifyKnownFixtureLog } from './lm11-full-matrix-summary-builder.mjs';

const id = 'wry-20261120035542065-3d424ce2a2d0';
const reason = 'An original physically timed stage was independently reviewed.';

function witness(stage, mode='expiry') {
  const sessionId = 'synthetic-original-session';
  const epoch = 'synthetic-epoch';
  const pid = 1234;
  return {
    caseId: id,
    strict: true,
    original: true,
    manifest: { caseEvidenceFiles: [], aggregateDeadlineBudgetMs:120000 },
    physicalStage: {
      mode, stage, originalProductionRunner:true,
      stageReachedFromOriginalIpc:true, releasedExactlyOnce:true,
      originalCallerDidNotRetroactivelyPass:true,
      originalRunnerTerminal:'rejected',originalAggregateBudgetMs:120000,
      nativePid:pid,nativeEpoch:epoch,originalSessionId:sessionId,
      originalElapsedMs:120100,
    },
    observation: {oneShotReachedAndReleased:true,stage,
      originalRunnerTerminal:'rejected'},
    hit: {actualOriginalStageIpc:true,stage,sessionId,pid,epoch},
    release:{oneShotOriginalAsyncIpcResumed:true,stage,sessionId},
  };
}
const one = (group, ordinal, w, status='PASS') =>
  compileRows({rows:[{group,ordinal,status,caseIds:[id],reason}]},
    new Map([[id,w]]))[group][ordinal - 1];

test('always includes the full 75 ordinal requirements even when unreviewed', () => {
  const rows = compileRows({rows:[]}, new Map());
  assert.deepEqual(Object.fromEntries(Object.entries(rows).map(([key, value]) =>
    [key, value.length])),
  {B01:10,B02:15,lateRaces:12,B03:20,concurrent:5,failures:13});
  assert.equal(Object.values(rows).flat().filter(row => row.status==='PASS').length,0);
  assert.equal(rows.B01[9].acceptanceSeam,'b03-before-acknowledge / b03-before-readback');
});

test('a reported PASS without the exact original stage hit is downgraded', () => {
  const w = witness('preparation-complete');
  w.hit = null;
  const row = one('B01',2,w);
  assert.equal(row.status,'PARTIAL');
  assert.match(row.reason,/PASS was rejected/);
  assert.deepEqual(row.caseIds,[id]);
});

test('a genuine held 120s original stage matches only its exact ordinal', () => {
  const w = witness('preparation-complete');
  assert.equal(one('B01',2,w).status,'PASS');
  assert.equal(one('B01',3,w).status,'PARTIAL');
  assert.equal(one('lateRaces',1,w).status,'PARTIAL');
});

test('B01 final conceptual boundary needs separate ACK and readback stages', () => {
  const ack = witness('b03-before-acknowledge');
  assert.equal(one('B01',10,ack).status,'PARTIAL');
});

test('a passing native-only case cannot establish a production-runner PASS', () => {
  const w = witness('b03-before-prepare');
  w.original = false;
  w.strict = false;
  assert.equal(one('B03',17,w).status,'BLOCKED');
});

test('rejection-only malformed stream evidence is partial for resolved-negative F05', () => {
  const proof = {
    mode:'malformed-stream-frame',originalProductionRunner:true,
    originalCallerRejected:true,originalCallerSucceeded:false,
    nativeSessionDrained:true,noAdditionalNativeRequest:true,
    noB03CallsOrReceipts:true,noFlightViolations:true,noModel:true,
    originalSessionId:'synthetic-original-session',exactOriginalRequestId:'inference-2',
    originalNativeOpenCount:1,originalRejectionPhase:'bounded-request',
    actualOriginalChannelEvents:[{kind:'headers'}],
  };
  const w = {
    caseId:id,strict:true,original:true,
    meta:{scenario:'original-runtime-fault',runtimeScenario:'malformed-stream-frame'},
    report:{scenarioObservedByHost:true,
      renderer:{outcome:'original-qualification-runtime-fault-rejected',
        native:{originalRuntimeFault:proof}},
      nativeRequestChecks:{streamIds:['inference-2'],
        counts:{lm11_acceptance_runtime_activate:1}}},
    manifest:{caseEvidenceFiles:[],durableReceiptCount:0,
      casCounts:{begin:0,prepare:0,acknowledge:0},
      dispatch:{nativeOpens:2,nativeStreams:1,acceptedSyntheticPosts:1}},
  };
  assert.equal(one('failures',5,w).status,'PARTIAL');
  assert.equal(one('failures',4,w).status,'PARTIAL');
  proof.noB03CallsOrReceipts = false;
  assert.equal(one('failures',5,w).status,'PARTIAL');
});

test('F05 PASS requires named strict host invariant and four acknowledged nonverified receipts', () => {
  const outcome = 'original-qualification-negative-receipts';
  const rows = ['chat','streaming','terminal-completion','instruction-adherence']
    .map((capability,index) => ({capability,version:2,casPhase:'acknowledged',
      status:index === 3 ? 'incomplete' : 'failed'}));
  const w = {
    caseId:id,original:true,strict:true,
    meta:{scenario:'original-runtime-fault',runtimeScenario:'malformed-stream-frame'},
    invariants:{allPassed:true,checks:[
      {name:'full-matrix-failures-05-original-runner-negative',pass:true}]},
    report:{scenarioObservedByHost:true,
      renderer:{outcome},
      nativeDurableReceiptCheck:{count:4,modelQualityQualification:false,passed:true},
      nativeRequestChecks:{pass:true}},
    manifest:{caseEvidenceFiles:[],rendererCallerOutcome:outcome,evidenceResult:outcome,
      durableReceiptCount:4,duplicateReceiptKeyCount:0,durableReceiptMetadata:rows,
      casCounts:{begin:1,prepare:1,acknowledge:1},
      dispatch:{nativeOpens:2,nativeStreams:1,acceptedSyntheticPosts:1}},
  };
  const accepted = one('failures',5,w);
  assert.equal(accepted.status,'PASS');
  assert.match(accepted.reason,/caller resolved BoundedQualificationResult/);
  assert.match(accepted.reason,/does not prove a parser throw or caller rejection/);
  assert.equal(one('failures',4,w).status,'PARTIAL');

  w.invariants.checks[0].name = 'full-matrix-failures-05-original-runner';
  assert.equal(one('failures',5,w).status,'PARTIAL');
  w.invariants.checks[0].name = 'full-matrix-failures-05-original-runner-negative';
  rows[0].status = 'verified';
  assert.equal(one('failures',5,w).status,'PARTIAL');
  rows[0].status = 'failed';
  w.report.renderer.outcome = 'original-qualification-runtime-fault-rejected';
  assert.equal(one('failures',5,w).status,'PARTIAL');
  w.report.renderer.outcome = outcome;
  w.manifest.casCounts.acknowledge = 2;
  assert.equal(one('failures',5,w).status,'PARTIAL');
});

test('classification gates PASS on all rows plus independent checks', () => {
  const rows = [{status:'PASS'},{status:'PASS'}];
  assert.equal(classification(rows,false),'Partial');
  assert.equal(classification(rows,true),'Accepted for tested Windows synthetic-production-path boundary');
  assert.equal(classification([{status:'FAIL'},...rows],true),'Failed');
  assert.equal(classification([{status:'BLOCKED'}],true),'Blocked');
});

test('only the two exact retained Vitest fixture signatures qualify as known unrelated', () => {
  const memory = [
    ' FAIL  src/ai/memory.quality.test.ts > quality one',
    ' FAIL  src/ai/memory.quality.test.ts > quality two',
    ' FAIL  src/ai/memory.quality.test.ts > quality three',
  ];
  const preparation = [
    ' FAIL  src/ai/preparationPhaseCapture.integration.test.ts > capture one',
    ' FAIL  src/ai/preparationPhaseCapture.integration.test.ts > capture two',
  ];
  assert.equal(verifyKnownFixtureLog(['Tests  3 failed | 3864 passed',...memory]
    .join('\n'),'AI_SETTINGS_MEMORY_3'),true);
  assert.equal(verifyKnownFixtureLog(['Tests  5 failed | 4284 passed',
    ...memory,...preparation].join('\n'),'WIDER_TYPESCRIPT_5'),true);
  assert.equal(verifyKnownFixtureLog(['Tests  5 failed | 4284 passed',
    ...memory,...preparation.slice(0,1),
    ' FAIL src/ai/newSafety.test.ts > newly broken'].join('\n'),
  'WIDER_TYPESCRIPT_5'),false);
  assert.equal(verifyKnownFixtureLog('Tests  6 failed | 4284 passed\n'+
    [...memory,...preparation].join('\n'),'WIDER_TYPESCRIPT_5'),false);
});

test('B02 asynchronous acceptance cannot be inferred from its fifteen stage labels', () => {
  const first = b02AsyncGate({},new Map());
  assert.deepEqual(Object.values(first).map(row=>row.passed),[false,false,false]);
  const w = witness('during-preparation','cancel');
  w.physicalStage.actualSessionStop = true;
  w.physicalStage.originalCancellationReason = 'explicit-user:cancel-requested';
  w.physicalStage.cancelledAtOperationElapsedMs = 100;
  w.release.budgetElapsedMs = 120;
  w.manifest.durableReceiptCount = 0;
  const extra = b02AsyncGate({b02AsyncProofs:{
    delayedPreparationAfterCancellation:[id],
  }},new Map([[id,w]]));
  assert.equal(extra.delayedPreparationAfterCancellation.passed,true);
  assert.equal(extra.delayedAdmissionAfterCancellation.passed,false);
  assert.equal(extra.lateRegistrationAfterCancellation.passed,false);
});
