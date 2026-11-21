/**
 * Final LM11 infrastructure evidence reconciliation, synthetic-only.
 * Read only toward every previous case. Never reclassify missing physical
 * observations as PASS, and never copy credentials, URLs or model IDs.
 *
 * Run after the independently sealed T15 AFTER and all bounded Wry cases.
 */
import { randomBytes, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = fs.realpathSync.native(path.join(repo, 'src-tauri', 'target',
  'lm11-b01-b03-authenticated-webview-20261119', 'cases'));
const nativeB03 = path.join(repo, 'src-tauri', 'target',
  'lm11-b03-native-acceptance-20261119-real-host',
  'native-acceptance-85-invocations-20261119.json');
const base = 'fidelity-audit-20261119164558080-66e12c0fff93';
const later = 'fidelity-audit-20261119202821960-37b57bd5bf84';
const oldIndex = 'index-20261119080122842-cf1e7d43238c';
const prior = 'index-20261119173207362-4b68c506cad7';
const t01Case = 't01-selector-20261119170819667-52531f183484';
const regressionCase = 'regression-20261119224942240-b6d8645358eb';
const failedQualifierAttempts = [
  'wry-20261119204441359-4be52079853a',
  'wry-20261119204902235-058212982bc8',
  'wry-20261119220541951-e291069faa56',
  'wry-20261119224542525-d2276ba75474',
];
const cancelAckCases = {
  originalHandlerDelayedAck:'wry-20261119170527827-2e98067d7a13',
  originalHandlerFailedAck:'wry-20261119170540308-3f0f3ed2bd98',
};
const selected = {
  T09: 'wry-20261119170156278-32d89fb575de',
  T10: 'wry-20261119170451537-70b2643a53ec',
  T11: 'wry-20261119201837602-9138d7c16f56',
  T12: 'wry-20261119201852718-60fadf8f6083',
  T13CompletedTransport: 'wry-20261119171934497-0025bb1607d4',
  T13CancelledTransport: 'wry-20261119172347621-105672e5a0a8',
  B01Readiness: 'wry-20261119171207799-a8198941fc83',
  B01Admission: 'wry-20261119171515931-713908be4fe2',
  B01CasBegin: 'wry-20261119172022490-30fea7418e1f',
  B01RegistrationFailure: 'wry-20261119172425215-9cc9a449759d',
};
let observedQualifierCase = null;
for (let i = 2; i < process.argv.length; i += 2) {
  if (process.argv[i] !== '--qualifier-case' || !process.argv[i + 1] || observedQualifierCase)
    throw new Error('Optional: --qualifier-case wry-<exact-owned-case>; no other options');
  observedQualifierCase = process.argv[i + 1];
}
if (!/^wry-[0-9]{17}-[a-f0-9]{12}$/.test(observedQualifierCase ?? '')) {
  if (observedQualifierCase !== null) throw new Error('Malformed qualification callback case');
} else selected.T13QualificationOperation = observedQualifierCase;

function safeCaseDir(child) {
  if (!/^(?:wry|t01-selector|fidelity-audit|index|regression)-[0-9]{17}-[a-f0-9]{12}$/.test(child))
    throw new Error('Invalid isolated case directory name');
  const dirname = path.join(cases, child);
  const stat = fs.lstatSync(dirname);
  if (!stat.isDirectory() || stat.isSymbolicLink() ||
      fs.realpathSync.native(dirname).toLowerCase() !== dirname.toLowerCase())
    throw new Error('Evidence directory is redirected');
  return dirname;
}
function read(caseId, leaf) {
  const dir = safeCaseDir(caseId);
  if (!/^[a-z0-9-]+\.json$/.test(leaf)) throw new Error('Invalid evidence filename');
  const file = path.join(dir, leaf);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() ||
      fs.realpathSync.native(file).toLowerCase() !== file.toLowerCase())
    throw new Error('Unsafe evidence file');
  const bytes = fs.readFileSync(file);
  const value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  return { caseId, file: leaf, sha256: createHash('sha256').update(bytes).digest('hex'), value };
}
function evidence(row) { return { caseId:row.caseId, file:row.file, sha256:row.sha256 }; }
function insist(value, message) { if (!value) throw new Error(message); }
function logEvidence(caseId, leaf) {
  if (!/^[0-9]{2}-[a-z0-9-]+\.log$/i.test(leaf))
    throw new Error('Invalid regression log leaf');
  const filename=path.join(safeCaseDir(caseId),leaf);
  const st=fs.lstatSync(filename);
  if (!st.isFile() || st.isSymbolicLink() ||
      fs.realpathSync.native(filename).toLowerCase() !== filename.toLowerCase())
    throw new Error('Redirected regression log');
  const bytes=fs.readFileSync(filename);
  return {caseId,file:leaf,sha256:createHash('sha256').update(bytes).digest('hex'),
    bytes:bytes.length,text:bytes.toString('utf8')};
}
const t01 = read(t01Case,'t01-production-selector-exclusion.json');
const first = {
  before:read(base, 'production-before.json'),
  after:read(base, 'production-after.json'),
  comparison:read(base, 'production-comparison.json'),
  metadataBefore:read(base, 'credential-manager-before.json'),
  metadataAfter:read(base, 'credential-manager-after.json'),
  metadata:read(base, 'credential-manager-comparison.json'),
  blobBefore:read(base, 'credential-secret-v3-before.json'),
  blobAfter:read(base, 'credential-secret-v3-after.json'),
  blob:read(base, 'credential-secret-v3-comparison.json'),
};
const second = {
  before:read(later, 'production-before.json'),
  after:read(later, 'production-after.json'),
  metadataBefore:read(later, 'credential-manager-before.json'),
  metadataAfter:read(later, 'credential-manager-after.json'),
  blobBefore:read(later, 'credential-secret-v3-before.json'),
  blobAfter:read(later, 'credential-secret-v3-after.json'),
  comparison:read(later, 'production-comparison.json'),
  metadata:read(later, 'credential-manager-comparison.json'),
  blob:read(later, 'credential-secret-v3-comparison.json'),
  os:read(later, 'os-post-run-isolation.json'),
};
const preceding = read(prior,'authenticated-webview-evidence-index.json');
const history = read(oldIndex,'authenticated-webview-evidence-index.json');
const t01Pass = t01.value.passed === true && t01.value.featureEnabled === false &&
  t01.value.readOnlyProductionRegistrations?.syntheticIdentityPresent === false &&
  t01.value.readOnlyProductionRegistrations?.totalRegistrationFields === 86 &&
  t01.value.selectorSources?.readOnlyProductionSourcePaths?.length === 21 &&
  t01.value.normalNonFeatureNativeBuild?.pass === true;
const compare = obj => obj.comparison.value.noninterferenceProven === true &&
  obj.comparison.value.changedCount === 0 &&
  obj.comparison.value.beforeErrors === 0 && obj.comparison.value.afterErrors === 0 &&
  obj.blob.value.scopedCredentialBlobsUnchanged === true &&
  obj.blob.value.beforeCount === 5 && obj.blob.value.afterCount === 5;
function sameScopedMetadata(a,b) {
  if (a.scopedTargetCount !== b.scopedTargetCount || a.scopedTargetCount !== 5 ||
      !Array.isArray(a.entries) || !Array.isArray(b.entries)) return false;
  const normalize = x=>x.entries.map(y=>`${y.targetHash}:${y.metadataHash}`).sort().join('|');
  return normalize(a) === normalize(b);
}
const scopedMetadataSame = sameScopedMetadata(second.metadataBefore.value,second.metadataAfter.value);
const firstMetadataSame = first.metadata.value.metadataUnchanged === true;
const foreignBefore = second.metadataBefore.value.allTargetCount - second.metadataBefore.value.scopedTargetCount;
const foreignAfter = second.metadataAfter.value.allTargetCount - second.metadataAfter.value.scopedTargetCount;
const appScopedT15Proven = compare(first) && compare(second) && firstMetadataSame && scopedMetadataSame &&
  first.comparison.value.beforeEntries === 9541 &&
  second.comparison.value.beforeEntries === 9541 &&
  second.os.value.noOwnedRuntimeOrListenerOrRegistration === true;
// The broad Windows keyring count drifted 46 -> 44 while all FIVE scoped
// Clack/Terax metadata and secret blob hashes remained unchanged. Preserve
// the historical comparison's FALSE, not a fabricated global PASS.
const allWindowsMetadataUnchanged = second.metadata.value.metadataUnchanged === true;
const t15Pass = appScopedT15Proven && allWindowsMetadataUnchanged;
insist(t01Pass && appScopedT15Proven,
  'Refuse final index without T01 and TWO verified app-scoped T15 comparisons');
insist(foreignBefore === 41 && foreignAfter === 39 && !allWindowsMetadataUnchanged,
  'Unexpected global keyring drift; do not silently reclassify scoped evidence');
insist(preceding.value.acceptedRuntimeCount === 26 && preceding.value.acceptedSmokeCount === 30 &&
  preceding.value.realModelInferenceCount === 0 &&
  preceding.value.qualificationLabRunEnabled === false,
  'Previous synthetic fidelity index not accepted');

const physical = {};
for (const [label,caseId] of Object.entries(selected)) {
  if (label === 'B01RegistrationFailure') {
    // The blocked synchronous registration attempt never reached the
    // renderer-report/invariants writer. Preserve its actual stage markers.
    const armed=read(caseId,'deadline-stage-armed.json');
    const hit=read(caseId,'deadline-stage-hit.json');
    physical[label]={caseId,passed:false,acceptanceInvariants:null,
      rendererReport:null,deadlineStageArmed:evidence(armed),
      deadlineStageHit:evidence(hit),
      reason:'No completed renderer/qualification invariants after blocking ai_http_open'};
    continue;
  }
  const inv=read(caseId,'acceptance-invariants.json');
  const rendererFile=path.join(safeCaseDir(caseId),'renderer-report.json');
  const rendererEvidence=fs.existsSync(rendererFile)
    ? evidence(read(caseId,'renderer-report.json')) : null;
  physical[label] = {caseId,passed:inv.value.allPassed === true,
    acceptanceInvariants:evidence(inv),rendererReport:rendererEvidence};
}
insist(physical.T09.passed && physical.T10.passed && physical.T11.passed &&
  physical.T12.passed && physical.T13CompletedTransport.passed &&
  physical.T13CancelledTransport.passed && physical.B01Readiness.passed &&
  physical.B01Admission.passed && physical.B01CasBegin.passed,
  'Required previously observed native/transport cases missing');
insist(physical.B01RegistrationFailure.passed === false,
  'Known registration no-terminal counterexample must remain unverified');
const operation = observedQualifierCase ? read(observedQualifierCase,'renderer-report.json') : null;
const nativeLate = observedQualifierCase
  ? read(observedQualifierCase,'post-terminal-channel-send.json') : null;
const nativeLateRelease = observedQualifierCase
  ? read(observedQualifierCase,'post-cancel-lm2f-release.json') : null;
// Strong positive classification must be impossible without exact new
// production-runner post-terminal callback proof fields. The ordinary direct
// Channel scenarios do not carry these operation fields.
const qualifierObservation = operation?.value?.renderer?.native?.originalLm2fLate;
const qualifierPass = observedQualifierCase !== null &&
  physical.T13QualificationOperation.passed === true &&
  qualifierObservation?.originalProductionRunner === true &&
  qualifierObservation?.originalLm2fRejected === true &&
  qualifierObservation?.originalNativeCancelled === true &&
  qualifierObservation?.originalCancelSessionInference === true &&
  qualifierObservation?.chatAndTaskUnchangedAfterLate === true &&
  qualifierObservation?.zeroB03AckOrReceipts === true &&
  qualifierObservation?.noRetroactiveSuccess === true &&
  qualifierObservation?.observedBoundary ===
    'renderer-original-channel-callback-after-proxyfetch-noop' &&
  qualifierObservation?.actualChannelCallbackCount === 2 &&
  qualifierObservation?.originalNativeCancelledAt < qualifierObservation?.releaseAfterRejectionAt &&
  nativeLate?.value?.requestId === qualifierObservation?.requestId &&
  nativeLate?.value?.originalLm2fReleaseConfirmed === true &&
  nativeLate?.value?.oldNativeRegistryAbsentAtInjection === true &&
  nativeLate?.value?.lateChunkNativeSendSucceeded === true &&
  nativeLate?.value?.lateTerminalNativeSendSucceeded === true &&
  nativeLateRelease?.value?.originalLm2fRejected === true &&
  nativeLateRelease?.value?.noB03AckOrReceipts === true;
const t10Native = read(selected.T10,'renderer-report.json');
const t10Restart = t10Native.value?.renderer?.native?.restart;
insist(t10Restart?.realOldLateCallbackCount === 0 &&
  t10Restart?.oldPid !== t10Restart?.newPid &&
  t10Restart?.oldEpoch !== t10Restart?.newEpoch &&
  t10Restart?.oldStreamIdRejectedAfterRestart === true &&
  t10Restart?.staleCancelIsolated === true &&
  t10Restart?.oldCasAckRejected === true &&
  t10Restart?.newStreamCompleted === true,
  'T10 physically fenced native epoch, but old operation callback was not observed');
const exploratory = failedQualifierAttempts.map(caseId=>{
  const inv=read(caseId,'acceptance-invariants.json');
  const renderer=read(caseId,'renderer-report.json');
  insist(inv.value.allPassed === false,'Do not erase original exploratory T13 failure');
  return {caseId,passed:false,acceptanceInvariants:evidence(inv),
    rendererReport:evidence(renderer),
    failureBoundary:renderer.value?.renderer?.error ?? 'Native host invariants not met'};
});
const acknowledgment = Object.fromEntries(Object.entries(cancelAckCases).map(([name,caseId])=>{
  const inv=read(caseId,'acceptance-invariants.json');
  const renderer=read(caseId,'renderer-report.json');
  const marker=read(caseId,'cancel-ack-fault.json');
  insist(inv.value.allPassed === true,'Original cancellation ACK case unverified');
  return [name,{caseId,pass:true,acceptanceInvariants:evidence(inv),
    rendererReport:evidence(renderer),strictFeatureMarker:evidence(marker)}];
}));

const objectives = [
  ['T01','Ordinary non-feature production selector exclusion'],
  ['T02','Acceptance-scoped credentials'],
  ['T03','Wrong credential denied'],
  ['T04','Wrong deployment denied'],
  ['T05','Wrong epoch denied'],
  ['T06','Wrong PID denied'],
  ['T07','Unavailable never Ready'],
  ['T08','Process death invalidates route'],
  ['T09','Genuine fresh OS PID plus native epoch'],
  ['T10','Stale requests/callbacks/qualification across genuine restart'],
  ['T11','Exact real inference-N request identity'],
  ['T12','Exact-ID native cancellation'],
  ['T13','Late callback after renderer qualification operation terminal'],
  ['T14','Canonical isolated AppData/settings'],
  ['T15','Production state noninterference independently compared'],
];
const passedByIndex = new Set(preceding.value.selfTests
  .filter(x=>x.status === 'executed-and-observed').map(x=>x.id));
const selfTests = objectives.map(([id,objective]) => {
  const fullyProven = ['T01','T09','T11','T12','T14'].includes(id) ||
    (id === 'T15' && t15Pass) ||
    (id === 'T13' && qualifierPass) ||
    (id !== 'T10' && id !== 'T13' && passedByIndex.has(id));
  const caveat = id === 'T10'
    ? 'Actual child A/B native request, stale native SSE identity, exact-ID cancellation and CAS prepare/ACK fenced, but an old runManagedChatQualification callback across B Ready was not independently exercised.'
    : id === 'T13' && !qualifierPass
      ? 'Actual late native Channel callbacks reached renderer only after transport terminal; unchanged renderer qualification runner had not terminated, so SDK/qualification callback proof remains incomplete.'
      : id === 'T13' && qualifierPass
        ? 'Observed after real unchanged qualification cancellation-terminal at the exact original Tauri Channel/proxyFetch boundary using strictly feature-only injected native events, not an external provider SSE parser or all timing races.'
      : id === 'T15'
        ? 'Both app-scoped 9541-entry AppData/HKCU sets, five Clack/Terax target metadata hashes and five V3 secret blobs match; BUT two foreign Windows Credential Manager targets disappeared (46 to 44), global target-metadata comparator FALSE and cause unattributed. Strict whole-keyring T15 stays PARTIAL; no whole-system filesystem claim.'
        : null;
  return {id,objective,status:fullyProven?'PASS':'PARTIAL',
    independentlyObserved:fullyProven, limitation:caveat};
});
const b03bytes=fs.readFileSync(nativeB03);
const nativeB03sha=createHash('sha256').update(b03bytes).digest('hex');
insist(nativeB03sha === 'c329ae36ad8255150ff0a46f71a03a64d0a6dec8283db392c6861668ddeef1a7',
  'Original B03 native index unexpectedly changed');
insist(history.sha256 === 'f8f7f1effc0681530941e3f2926248d65b642ef4db81618bf8a1d948adbcd74e' &&
  preceding.sha256 === '5eb803ebcbcd369eb50ca112282a57ffc35d7d8b3c8e7870e8415f5a7dc578a6',
  'Original real WebView evidence index digests must remain fixed');

// Conceptual B01 deadlines are NOT aliases for similarly named implementation
// stages. PASS requires actual production boundary control and a physical run.
const conceptualBoundaries = [
  {ordinal:1,conceptual:'readiness',productionStages:['native-status'],classification:'PASS',
    controllable:true,mechanism:'Exact original native status IPC barrier; 123500ms delayed reply, unchanged LM2F 120000ms timer rejected',
    cases:[selected.B01Readiness]},
  {ordinal:2,conceptual:'preparation',productionStages:['session-writes','session-prepare'],classification:'PARTIAL',
    controllable:false,mechanism:'Native conversation_source_set/session_get delay can overlap session preparation; cannot isolate all JS preparation boundaries',cases:[]},
  {ordinal:3,conceptual:'pre-dispatch',productionStages:['native-admission','bounded-request'],classification:'PARTIAL',
    controllable:false,mechanism:'Native route/admission 120s expiry proven, but final JS current-flight/selection digest dispatch guard not independently injectable',
    cases:[selected.B01Admission]},
  {ordinal:4,conceptual:'request registration',productionStages:['bounded-request','ai_http_open'],classification:'BLOCKED',
    controllable:false,mechanism:'Synchronous 123500ms ai_http_open delay blocked Wry UI loop; no final renderer report or settled qualification. Requires nonblocking original IPC reply seam',
    cases:[selected.B01RegistrationFailure]},
  {ordinal:5,conceptual:'first output',productionStages:['bounded-request','delayed-first-stream-event'],classification:'PARTIAL',
    controllable:false,mechanism:'Genuine synthetic SSE short first-frame hold only; competing 120s native first-output timer prevents attribution of a full aggregate expiry',cases:[]},
  {ordinal:6,conceptual:'terminal',productionStages:['bounded-request','delayed-terminal-event'],classification:'PARTIAL',
    controllable:false,mechanism:'Finite delayed synthetic SSE terminal and original native terminal observed; no exact standalone original 120s terminal hold',cases:[]},
  {ordinal:7,conceptual:'quiescence',productionStages:['native-quiescence'],classification:'BLOCKED',
    controllable:false,mechanism:'Production JS settled/drain poll and 1500ms grace, not an independently stalled native 120s IPC boundary',cases:[]},
  {ordinal:8,conceptual:'evidence evaluation',productionStages:['persisted-chat-evidence','receipt-scoring'],classification:'BLOCKED',
    controllable:false,mechanism:'Production evaluator/receipt scoring is synchronous JS; no isolated native authority seam for exact 120s evaluation stall',cases:[]},
  {ordinal:9,conceptual:'B03 preparation',productionStages:['cas-commit','self_hosted_profiles_qualification_begin','self_hosted_profiles_qualification_prepare'],classification:'PARTIAL',
    controllable:false,mechanism:'123500ms exact native BEGIN IPC produced original aggregate expiry; later native PREPARE persistence boundary was not isolated',
    cases:[selected.B01CasBegin]},
  {ordinal:10,conceptual:'B03 acknowledgement/readback',productionStages:['cas-commit','self_hosted_profiles_qualification_acknowledge','self_hosted_profiles_snapshot'],classification:'PARTIAL',
    controllable:false,mechanism:'Real native ACK/restart/readback and lost ACK physically proven historically, but no independent aggregate expiry at ACK and physical readback',cases:[]},
];
insist(conceptualBoundaries.length === 10 &&
  conceptualBoundaries.filter(x=>x.classification === 'PASS').length === 1 &&
  conceptualBoundaries.filter(x=>x.classification === 'PARTIAL').length === 6 &&
  conceptualBoundaries.filter(x=>x.classification === 'BLOCKED').length === 3,
  'Refuse invented ten-boundary deadline coverage');
const regressionResult1to5=read(regressionCase,'first-five-direct-node-results.json');
const regressionResult8to9=read(regressionCase,'08-09-results.json');
insist(regressionResult1to5.value.length === 5 &&
  regressionResult1to5.value.every(x=>x.exitCode === 0) &&
  regressionResult8to9.value.length === 2 &&
  regressionResult8to9.value.every(x=>x.exitCode === 0),
  'Focused frozen-source Vitest regressions not all passing');
const regressionLeaves = [
  '01-synthetic-runtime-contract.log','02-managed-route-auth.log',
  '03-restart-epoch-contract.log','04-stale-event-fencing.log',
  '05-late-channel-callback.log',
  '01-synthetic-runtime-contract-direct-node.log','02-managed-route-auth-direct-node.log',
  '03-restart-epoch-contract-direct-node.log','04-stale-event-fencing-direct-node.log',
  '05-late-channel-callback-direct-node.log',
  '08-focused-B01-B02-B03-safety.log','09-B03-persistence-regressions.log',
  '11-affected-ai-settings-vitest.log','12-feature-native-rust.log',
  '13-normal-native-rust.log','14-wider-typescript-vitest.log',
  '15-typescript-typecheck.log','16-script-syntax.log','17-git-diff-check.log',
];
const regressionLogs=regressionLeaves.map(leaf=>logEvidence(regressionCase,leaf));
const log = leaf=>regressionLogs.find(x=>x.file===leaf)?.text ?? '';
insist(log('11-affected-ai-settings-vitest.log').includes('3629 passed | 2 skipped') &&
  log('12-feature-native-rust.log').includes('765 passed; 0 failed; 2 ignored') &&
  log('13-normal-native-rust.log').includes('761 passed; 0 failed; 2 ignored') &&
  log('14-wider-typescript-vitest.log').includes('5 failed | 4520 passed | 12 skipped') &&
  log('16-script-syntax.log').includes('SYNTAX_TOTAL_FAILURES=0'),
  'Unexpected broad native/TS regression result: no retroactive green');
const preservation=read(regressionCase,'preservation-audit.json');
insist(preservation.value?.preserved === true,'Final Git/81-path/current OS preservation not proven');
const sourcePaths = [
  'src-tauri/examples/lm11_authenticated_webview_acceptance.rs',
  'src-tauri/src/modules/net/inference/mod.rs',
  'scripts/lm11-authenticated-webview-acceptance.mjs',
  'scripts/lm11-production-state-inventory.ps1',
  'scripts/lm11-production-credential-metadata.ps1',
  'scripts/lm11-production-secret-fingerprint.ps1',
  'scripts/lm11-production-state-compare.mjs',
  'scripts/lm11-post-run-os-isolation.ps1',
  'scripts/lm11-fidelity-closure-index.mjs',
  'scripts/lm11-production-selector-exclusion.mjs',
  'src/modules/ai/lib/lm11ProductionSelectorExclusion.offline.test.tsx',
  'docs/AGENT_ENGINEERING_STATE.md',
  'docs/LM11_LM15_LOCAL_MODEL_QUALIFICATION.md',
];
const sourceSha256=sourcePaths.map(relativePath=>{
  const filename=path.join(repo,relativePath);
  const st=fs.lstatSync(filename);
  if(!st.isFile() || st.isSymbolicLink()) throw new Error('Nonregular source in manifest');
  return {file:relativePath,sha256:createHash('sha256').update(fs.readFileSync(filename)).digest('hex')};
});
const report = {
  version:2, purpose:'LM11 synthetic real WebView2 fidelity closure and noninterference, NOT full real B01-B03 matrix',
  generatedAtUtc:new Date().toISOString(), syntheticOnly:true,
  realModelInferenceCount:0, qualificationLabRunEnabled:false,
  fullRealB01B02B03MatrixExecuted:false,aggregateWallDeadlineEnforcedFlagAltered:false,
  inheritedHistory:[evidence(history),evidence(preceding)],
  priorAcceptedB03NativeIndexSha256:nativeB03sha,
  codeAndCurrentDocumentSha256:sourceSha256,
  t01:{passed:t01Pass, selectorSourcePathsChecked:t01.value.selectorSources.readOnlyProductionSourcePaths,
    productionSettingsFields:t01.value.readOnlyProductionRegistrations.totalRegistrationFields,
    ordinaryCargoFeatureEnabled:false,evidence:evidence(t01)},
  t09:{status:'PASS',genuineTwoChildPidAndEpoch:true,evidence:physical.T09},
  t10:{status:'PARTIAL',genuineTwoChildNativeAuthorityFenced:true,
    realOldCallbackCount:t10Restart.realOldCallbackCount,
    realOldLateCallbackCount:t10Restart.realOldLateCallbackCount,
    actualOldQualificationOperationCallbackAfterRestartObserved:false,
    oldPid:t10Restart.oldPid,newPid:t10Restart.newPid,
    oldEpoch:t10Restart.oldEpoch,newEpoch:t10Restart.newEpoch,
    oldRouteRejected:t10Restart.oldRouteRejected,oldBearerRejected:t10Restart.oldBearerRejected,
    oldStreamIdRejected:t10Restart.oldStreamIdRejectedAfterRestart,
    staleCancelIsolated:t10Restart.staleCancelIsolated,
    oldCasPrepareRejected:t10Restart.oldCasTicketRejected,
    oldCasAcknowledgeRejected:t10Restart.oldCasAckRejected,
    newRequestUnaffected:t10Restart.newStreamCompleted,
    dropBoundary:'original native A lease/callback stream terminal; after epoch change current_binding and native request/route/CAS checks reject stale A authority; no separately delayed production qualifier callback injected after child B Ready',
    evidence:physical.T10},
  t13:{status:qualifierPass?'PASS':'PARTIAL',
    actualOriginalQualificationOperationTerminalBeforeLateCallback:qualifierPass,
    observedBoundary:qualifierObservation?.observedBoundary ?? null,
    originalNativeRequestId:qualifierObservation?.requestId ?? null,
    actualLateRendererChannelCallbacks:qualifierObservation?.actualChannelCallbackCount ?? null,
    nativeOriginalCancelledAtMs:qualifierObservation?.originalNativeCancelledAt ?? null,
    nativeReleaseAfterRunnerRejectionAtMs:qualifierObservation?.releaseAfterRejectionAt ?? null,
    productionChatTasksReceiptsUnchangedAfterLate:qualifierObservation?.chatAndTaskUnchangedAfterLate === true &&
      qualifierObservation?.zeroB03AckOrReceipts === true,
    distinctLateCancellationAcknowledgmentAfterRunnerTerminalNotIndependentlyProven:true,
    originalChannelNotExternalSseParser:true,
    physicalQualificationCase:physical.T13QualificationOperation ?? null,
    originalRendererReport:operation?evidence(operation):null,
    nativeReleaseMarker:nativeLateRelease?evidence(nativeLateRelease):null,
    originalNativeChannelSend:nativeLate?evidence(nativeLate):null,
    independentTransportTerminalCases:[physical.T13CompletedTransport,physical.T13CancelledTransport]},
  t15:{passed:t15Pass,status:t15Pass?'PASS':'PARTIAL',
    independentlyProvenAppScopedNoninterference:appScopedT15Proven,
    firstBefore:evidence(first.before),firstAfter:evidence(first.after),
    firstBeforeAfter:evidence(first.comparison),
    firstMetadataBefore:evidence(first.metadataBefore),firstMetadataAfter:evidence(first.metadataAfter),
    firstMetadata:evidence(first.metadata),firstScopedSecretsBefore:evidence(first.blobBefore),
    firstScopedSecretsAfter:evidence(first.blobAfter),firstScopedSecrets:evidence(first.blob),
    secondBefore:evidence(second.before),secondBeforeCredentialMetadata:evidence(second.metadataBefore),
    secondAfter:evidence(second.after),secondCredentialMetadataAfter:evidence(second.metadataAfter),
    secondBeforeScopedSecrets:evidence(second.blobBefore),secondScopedSecretsAfter:evidence(second.blobAfter),
    secondBeforeAfter:evidence(second.comparison),secondMetadata:evidence(second.metadata),
    secondScopedSecrets:evidence(second.blob),osPostRun:evidence(second.os),
    scopedFilesAndRegistryObjects:9541,changedProductionFileOrRegistryObjects:0,
    changedProductionRegistrationObjects:0,scopedSecretBlobCount:5,
    changedClackTargetMetadataHashes:0,changedClackSecretFingerprintHashes:0,
    globalWindowsCredentialManagerTargetMetadataUnchanged:allWindowsMetadataUnchanged,
    totalWindowsCredentialTargetCountBefore:second.metadataBefore.value.allTargetCount,
    totalWindowsCredentialTargetCountAfter:second.metadataAfter.value.allTargetCount,
    foreignWindowsCredentialTargetCountBefore:foreignBefore,
    foreignWindowsCredentialTargetCountAfter:foreignAfter,
    foreignCredentialCountDelta:foreignAfter-foreignBefore,
    foreignCredentialChangesAttributedToAcceptanceHarness:false,
    foreignCredentialChangesCauseKnown:false,
    foreignTargetIdentitiesNotCollectedForPrivacy:true,
    earlierV1V2CredMetadataNotAuthoritative:true,correctedV3ScopedBlobComparisonAuthoritative:true,
    systemWideAbsoluteAbsenceCertified:false},
  testedPhysicalCases:physical,
  originalHandlerCancellationAckProof:acknowledgment,
  newerFailedExploratoryAttempts:exploratory,
  retainedPriorFailureCaseIds:preceding.value.retainedFailureCases ?? [],
  knownUnsettledNativeRegistrationCase:physical.B01RegistrationFailure,
  selfTests,passCount:selfTests.filter(x=>x.status==='PASS').length,
  partialCount:selfTests.filter(x=>x.status==='PARTIAL').length,
  canonicalBoundaryStatus:preceding.value.canonicalAggregateBoundaries,
  conceptualDeadlineBoundaries:conceptualBoundaries.map(x=>({...x,
    evidence:x.cases.map(id=>Object.values(physical).find(p=>p.caseId===id)?.acceptanceInvariants ?? null)})),
  genuineAggregateExpiryCount:3,
  aggregateDeadlineRealUnchangedBudgetMs:120000,
  actualAggregateDeadlineCases:[physical.B01Readiness,physical.B01Admission,physical.B01CasBegin],
  aggregateDeadlineAll10BoundariesInjectable:false,
  cancellationAckFidelity:'Original handler state.cancel_with_origin executes before strictly feature-only delay/error ACK return',
  regressions:{regressionCase,originalNpxShimFailuresRetained:true,
    initialNpxShimResolutionFailedWithoutRunningVitest:true,
    successfulLocalInstalledVitestEntryUsed:true,
    firstFive:evidence(regressionResult1to5),focusedB0102B03:evidence(regressionResult8to9),
    phase07ExactIdCancellationRetainedFromWry:physical.T12,
    phase10MinimalRealWryTauriRetainedFromPhysicalT13:physical.T13QualificationOperation,
    affectedAiSettings:{passed:3629,skipped:2,exitCode:0},
    featureNativeRust:{passed:765,ignored:2,exitCode:0},
    normalNativeRust:{passed:761,ignored:2,exitCode:0},
    widerTypescript:{passed:4520,failed:5,skipped:12,exitCode:1,
      knownFailures:['src/test/preparationPhaseCapture.integration.test.ts (2)',
        'src/modules/ai/quality/memory.quality.test.ts (3)'],
      status:'KNOWN STRUCTURED MEMORY SCHEMA FIXTURE FAILURES - NOT GREEN'},
    typescriptNoEmit:{exitCode:0},nodePowerShellSyntax:{failed:0},gitDiffCheck:{exitCode:0},
    logs:regressionLogs.map(({text:unused,...meta})=>meta)},
  preservation:{passed:true,evidence:evidence(preservation),summary:preservation.value},
  realB01B02B03InfrastructureReady:false,
  reasonForNo:'T10 actual stale production qualification-operation callback across fresh child B is not observed; 120s exact conceptual registration/quiescence/evaluation and B03 prepare/ACK/readback seams remain blocked or only nearby controls; strict global Windows credential metadata declined 46 to 44 for two foreign targets, attribution unknown; no complete real B01-B03 matrix authorized or executed',
  preservationCaveat:'Preservation proof read-only after current docs; earlier accepted evidence not overwritten; no global whole-system side-effect theorem',
};
const name='index-'+new Date().toISOString().replace(/[^0-9]/g,'')+'-'+randomBytes(6).toString('hex');
const dir=path.join(cases,name);
fs.mkdirSync(dir,{recursive:false});
insist(safeCaseDir(name).toLowerCase() === dir.toLowerCase(), 'New index escaped owner');
const output=path.join(dir,'lm11-fidelity-closure-evidence-index.json');
const data=Buffer.from(JSON.stringify(report,null,2)+'\n');
const fd=fs.openSync(output,'wx',0o600);
try {fs.writeFileSync(fd,data);fs.fsyncSync(fd);} finally{fs.closeSync(fd);}
console.log(JSON.stringify({indexFile:output,sha256:createHash('sha256').update(data).digest('hex'),
  pass:report.passCount,partial:report.partialCount, aggregateDeadlineAll10BoundariesInjectable:false,
  realB01B02B03InfrastructureReady:false},null,2));
