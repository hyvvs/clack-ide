/**
 * WRITE-ONCE LM11 full-matrix summary compiler. Never starts Wry, inference,
 * Qualification Lab Run, or the immutable index sealer.
 *
 * After the final audit has case-ids.json, per-case-evidence.json, a fresh
 * attributable T15, an independent preservation result and regression logs:
 *
 * node scripts/lm11-full-matrix-summary-builder.mjs
 *   <canonical-existing-matrix-audit-directory>
 *   <that-directory>/full-matrix-review.json
 *
 * The reviewer input (schema 1) is an existing, independently prepared JSON:
 * {
 *   "schema": 1,
 *   "rows": [
 *     { "group": "B01", "ordinal": 1, "status": "PASS",
 *       "caseIds": ["wry-..."], "reason": "Observed original 120s rejection" }
 *   ],
 *   "positiveCaseIds": ["wry-..."],
 *   "freshT15CaseId": "fidelity-audit-...",
 *   "preservationEvidenceFile": "matrix-audit-.../preservation-result.json",
 *   "regressions": [
 *     { "name": "focused safety", "status": "PASS",
 *       "reason": "The frozen-source suite passed",
 *       "evidenceFile": "matrix-audit-.../focused-safety.log" }
 *   ]
 * }
 * For a retained unrelated Vitest baseline, use status "KNOWN-FAIL" and
 * knownFailureKind "AI_SETTINGS_MEMORY_3" or "WIDER_TYPESCRIPT_5". Only the
 * exact test-file/count signature in the original log qualifies as a known
 * unrelated failure; other failures block acceptance.
 * B02 verdict also needs b02AsyncProofs with three case-ID arrays named
 * delayedAdmissionAfterCancellation, delayedPreparationAfterCancellation and
 * lateRegistrationAfterCancellation. Unknown/incomplete supplemental proofs
 * leave B02 Partial even if all fifteen primary cancellation rows pass.
 * Missing row nominations become BLOCKED. PASS nominations require an exact
 * physically proven original-runner scenario; unsupported claims are reduced
 * to PARTIAL or BLOCKED, never elevated by a passing auxiliary smoke test.
 * Evidence locations are stored relative to the canonical case owner only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MATRIX_REQUIREMENTS } from './lm11-full-matrix-requirements.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const owner = path.join(repository, 'src-tauri', 'target',
  'lm11-b01-b03-authenticated-webview-20261119', 'cases');
const accepted = 'Accepted for tested Windows synthetic-production-path boundary';
const priorT15CaseId = 'fidelity-audit-20261120014350183-8a0f728bf980';
const groups = Object.keys(MATRIX_REQUIREMENTS);
const casePattern = /^wry-\d{17}-[a-f0-9]{12}$/;
const auditPattern = /^matrix-audit-\d{17}-[a-f0-9]{12}$/;
const t15Pattern = /^fidelity-audit-\d{17}-[a-f0-9]{12}$/;
const sha = value => createHash('sha256').update(value).digest('hex');
const check = (condition, reason) => {
  if (!condition) throw new Error('LM11 summary refused: ' + reason);
};
const cleanText = (value, label) => {
  check(typeof value === 'string' && value.trim().length >= 12 &&
    value.trim().length <= 1000 && !/[\u0000-\u001f]/.test(value) &&
    !/(?:authorization\s*:|bearer\s+|password\s*[=:]|api[_-]?key\s*[=:]|-----BEGIN|\b[a-f0-9]{32,}\b)/i.test(value),
  label + ' needs a substantive non-secret reason');
  return value.trim();
};
const isRegular = filename => {
  try {
    const stat = fs.lstatSync(filename);
    return stat.isFile() && !stat.isSymbolicLink() &&
      fs.realpathSync.native(filename).toLowerCase() === filename.toLowerCase();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
};
const ownerReal = () => fs.realpathSync.native(owner);
function ownedFile(relative, required = true) {
  check(typeof relative === 'string' && relative.length <= 350 &&
    /^(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(relative) &&
    !relative.split('/').includes('..'), 'invalid owned reference');
  const filename = path.join(ownerReal(), ...relative.split('/'));
  if (!isRegular(filename)) {
    if (!required) return null;
    check(false, 'missing, redirected or nonregular artifact: ' + relative);
  }
  return filename;
}
const readOwned = relative => JSON.parse(fs.readFileSync(ownedFile(relative), 'utf8').replace(/^\uFEFF/, ''));
const optionalOwned = relative => {
  const file = ownedFile(relative, false);
  return file ? JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) : null;
};
const artifact = relative => {
  const bytes = fs.readFileSync(ownedFile(relative));
  return { file: relative, sha256: sha(bytes), bytes: bytes.length };
};
const timestamp = name => name.match(/\d{17}/)?.[0] ?? '';
const all = (rows, predicate) => Array.isArray(rows) && rows.length > 0 && rows.every(predicate);
const knownFixtures = Object.freeze({
  AI_SETTINGS_MEMORY_3: { total:3, memory:3, preparation:0 },
  WIDER_TYPESCRIPT_5: { total:5, memory:3, preparation:2 },
});
export function verifyKnownFixtureLog(log, kind) {
  const expected = knownFixtures[kind];
  if (!expected || typeof log !== 'string') return false;
  const plain = log.replace(/\x1b\[[0-9;]*m/g,'');
  const summary = plain.match(/(?:^|\n)\s*Tests\s+(\d+)\s+failed\b/i);
  if (!summary || Number(summary[1]) !== expected.total) return false;
  const counts = { memory:0, preparation:0, other:0 };
  const failingTests = plain.split(/\r?\n/).filter(line => /^\s*FAIL\s+/i.test(line) &&
    /\.(?:integration\.)?test\.ts\b/.test(line));
  if (failingTests.length > 0) {
    for (const line of failingTests) {
      if (/memory\.quality\.test\.ts\b/.test(line)) counts.memory++;
      else if (/preparationPhaseCapture\.integration\.test\.ts\b/.test(line)) counts.preparation++;
      else counts.other++;
    }
  } else {
    // Some bounded Vitest logs retain suite summaries rather than each FAIL
    // line. Require exact per-file failure counts, never a bare prose waiver.
    for (const line of plain.split(/\r?\n/).filter(x => /\(.*\bfailed\)/.test(x))) {
      const match = line.match(/(?:\(|\|)\s*(\d+)\s+failed\b/);
      if (!match) continue;
      if (/memory\.quality\.test\.ts\b/.test(line)) counts.memory += Number(match[1]);
      else if (/preparationPhaseCapture\.integration\.test\.ts\b/.test(line))
        counts.preparation += Number(match[1]);
      else if (/\.(?:integration\.)?test\.ts\b/.test(line)) counts.other += Number(match[1]);
    }
  }
  return counts.memory === expected.memory &&
    counts.preparation === expected.preparation && counts.other === 0 &&
    counts.memory + counts.preparation === expected.total;
}
const fourAcknowledged = evidence => evidence.durableReceiptCount === 4 &&
  evidence.duplicateReceiptKeyCount === 0 &&
  new Set((evidence.durableReceiptMetadata ?? []).map(r => r.capability)).size === 4 &&
  all(evidence.durableReceiptMetadata, r =>
    r.status === 'verified' && r.version === 2 && r.casPhase === 'acknowledged');
// A resolved malformed-stream qualification can write four durable NEGATIVE
// v2 receipts without throwing. This proves the unsafe capability was not
// promoted; it is not a qualifying positive result or a parser rejection.
const fourNegativeAcknowledged = evidence => {
  const rows = evidence.durableReceiptMetadata;
  const required = ['chat','instruction-adherence','streaming','terminal-completion'];
  return evidence.durableReceiptCount === 4 &&
    evidence.duplicateReceiptKeyCount === 0 &&
    Array.isArray(rows) && rows.length === 4 &&
    required.every(capability => rows.filter(row => row.capability === capability).length === 1) &&
    rows.every(row => row.version === 2 && row.casPhase === 'acknowledged' &&
      (row.status === 'failed' || row.status === 'incomplete')) &&
    rows.filter(row => row.status === 'failed').length === 3 &&
    rows.filter(row => row.status === 'incomplete').length === 1;
};
const pendingOnly = evidence => evidence.durableReceiptCount === 4 &&
  all(evidence.durableReceiptMetadata, r =>
    r.version === 0 && r.casPhase === 'pending');

function loadCase(caseId, manifest) {
  const prefix = caseId + '/';
  const meta = optionalOwned(prefix + 'run-metadata.json');
  const invariants = optionalOwned(prefix + 'acceptance-invariants.json');
  const report = optionalOwned(prefix + 'renderer-report.json');
  const observation = optionalOwned(prefix + 'barrier-stage-observation.json');
  const hit = optionalOwned(prefix + 'barrier-stage-hit.json');
  const release = optionalOwned(prefix + 'barrier-stage-release.json');
  const windowClose = optionalOwned(prefix + 'native-window-close-report.json');
  const restart = optionalOwned(prefix + 'native-restart-report.json');
  if (meta) check(meta.caseId === caseId && meta.syntheticOnly === true &&
    meta.modelsLaunched === 0 && meta.inferenceEvaluated === false,
  'unexpected model/runtime owner for ' + caseId);
  check(manifest.caseId === caseId &&
    manifest.noRawCredentialsOrUserMessagesIncluded === true &&
    manifest.scenario === (meta?.scenario ?? null) &&
    manifest.strictHostAllPassed === (invariants?.allPassed === true),
  'per-case manifest and physical verdict disagree for ' + caseId);
  check(Array.isArray(manifest.caseEvidenceFiles), 'missing artifact hashes for ' + caseId);
  for (const file of manifest.caseEvidenceFiles) {
    check(typeof file.file === 'string' && !file.file.includes('/') &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:json|log)$/.test(file.file),
    'unsafe per-case evidence filename for ' + caseId);
    const actual = artifact(prefix + file.file);
    check(actual.sha256 === file.sha256 && actual.bytes === file.size,
    'per-case physical artifact drift for ' + caseId + '/' + file.file);
  }
  const physicalStage = report?.renderer?.native?.stageBarrier;
  const crashOriginal = ['restart-pending', 'lost-native-ack'].includes(meta?.scenario) &&
    invariants?.allPassed === true && invariants?.checks?.some(x =>
      x.name === 'real-renderer-native-ack-boundary-intercept' && x.pass === true) &&
    restart?.result?.Ok?.realTauriRestart === true &&
    restart?.result?.Ok?.rendererIpcNotReplayed === true;
  const closeOriginal = windowClose?.originalProductionRunnerAtClose === true &&
    windowClose?.actualRendererWindowDestroyed === true;
  const resolvedNegativeOriginal = meta?.scenario === 'original-runtime-fault' &&
    meta.runtimeScenario === 'malformed-stream-frame' &&
    report?.renderer?.outcome === 'original-qualification-negative-receipts' &&
    invariants?.checks?.some(x =>
      x.name === 'full-matrix-failures-05-original-runner-negative' && x.pass === true);
  const original = manifest.originalProductionRunner === true ||
    physicalStage?.originalProductionRunner === true ||
    report?.renderer?.native?.deadline?.originalProductionRunner === true ||
    report?.renderer?.native?.originalRuntimeFault?.originalProductionRunner === true ||
    crashOriginal || closeOriginal || resolvedNegativeOriginal;
  const witness = { caseId, manifest, meta, invariants, report, observation,
    hit, release, windowClose, restart, physicalStage, original };
  witness.strict = invariants?.allPassed === true &&
    manifest.failedInvariants?.length === 0 && original &&
    meta?.syntheticOnly === true && meta.modelsLaunched === 0 &&
    (report ? report.nativeTauriIpc === true && report.realModelInference === false &&
      report.qualificationLabRan === false && report.appDataContained === true :
      crashOriginal || (closeOriginal && windowClose.nativeTauriIpc === true));
  return witness;
}

function stage(w, mode, name) {
  const b = w.physicalStage;
  const o = w.observation;
  return w.strict && b?.mode === mode && b?.stage === name &&
    b.originalProductionRunner === true && b.stageReachedFromOriginalIpc === true &&
    b.releasedExactlyOnce === true && b.originalCallerDidNotRetroactivelyPass === true &&
    b.originalRunnerTerminal === 'rejected' &&
    b.originalAggregateBudgetMs === 120000 &&
    Number.isInteger(b.nativePid) && typeof b.nativeEpoch === 'string' &&
    typeof b.originalSessionId === 'string' &&
    w.hit?.actualOriginalStageIpc === true && w.hit.stage === name &&
    w.hit.sessionId === b.originalSessionId && w.hit.pid === b.nativePid &&
    w.hit.epoch === b.nativeEpoch &&
    w.release?.oneShotOriginalAsyncIpcResumed === true &&
    w.release.stage === name && w.release.sessionId === b.originalSessionId &&
    o?.oneShotReachedAndReleased === true && o.stage === name &&
    o.originalRunnerTerminal === 'rejected' &&
    w.manifest.aggregateDeadlineBudgetMs === 120000;
}
const expired = (w, name) => stage(w, 'expiry', name) &&
  w.physicalStage.originalElapsedMs >= 120000;
const cancelled = (w, name) => stage(w, 'cancel', name) &&
  w.physicalStage.actualSessionStop === true &&
  w.physicalStage.originalCancellationReason === 'explicit-user:cancel-requested' &&
  Number.isFinite(w.physicalStage.cancelledAtOperationElapsedMs) &&
  w.physicalStage.cancelledAtOperationElapsedMs < 120000;
function positive(w) {
  if (!w.strict || !fourAcknowledged(w.manifest) ||
    w.manifest.dispatch?.acceptedSyntheticPosts !== 1 ||
    w.manifest.casCounts?.begin !== 1 ||
    w.manifest.casCounts?.prepare !== 1 ||
    w.manifest.casCounts?.acknowledge !== 1 ||
    w.manifest.casCounts?.readbackSnapshot < 1) return false;
  return w.report?.renderer?.outcome === 'synthetic-chat-transport-only' ||
    (w.physicalStage?.originalFirstQualificationCompleted === true &&
      w.physicalStage?.originalRunnerTerminal === 'completed');
}
function duplicateTicket(w) {
  return w.strict && w.meta?.scenario === 'duplicate-ticket' &&
    fourAcknowledged(w.manifest) &&
    w.manifest.dispatch?.acceptedSyntheticPosts === 1 &&
    w.manifest.casCounts?.begin === 1 && w.manifest.casCounts?.prepare === 1 &&
    w.manifest.casCounts?.acknowledge === 2 &&
    w.report?.renderer?.outcome === 'synthetic-chat-transport-only' &&
    w.report.renderer.negative?.some(x =>
      x.name === 'duplicate-native-ticket' && x.rejected === true);
}
function originalRestart(w, expected) {
  return w.strict && w.restart?.result?.Ok?.pass === true &&
    w.restart.result.Ok.realTauriRestart === true &&
    w.restart.result.Ok.rendererIpcNotReplayed === true &&
    w.restart.result.Ok.sameAuthoritativeBytes === true &&
    w.restart.result.Ok.reconcile === expected;
}
function b01(ordinal, witnesses) {
  const stages = ['native-status','preparation-complete','predispatch',
    'after-ai-http-open','first-output','terminal-delivery',
    'quiescence-complete','before-evidence-acceptance','b03-before-prepare'];
  if (ordinal === 1) return witnesses.some(w => w.strict &&
    w.report?.renderer?.native?.deadline?.originalProductionRunner === true &&
    w.report.renderer.native.deadline.selectedStage === 'native-status' &&
    w.report.renderer.native.deadline.realElapsedMs >= 120000 &&
    w.report.renderer.native.deadline.nativeDispatchCount === 0 &&
    w.manifest.durableReceiptCount === 0);
  if (ordinal === 10) return ['b03-before-acknowledge','b03-before-readback']
    .every(name => witnesses.some(w => expired(w, name)));
  return witnesses.some(w => expired(w, stages[ordinal - 1]));
}
const cancellationStages = [
  'before-preparation','during-preparation','predispatch','before-ai-http-open',
  'after-ai-http-open','first-output','during-streaming','terminal-delivery',
  'during-quiescence','before-evidence-acceptance','b03-before-prepare',
  'b03-before-acknowledge','b03-before-readback',
];
function b02(ordinal, witnesses) {
  if (ordinal >= 14) return witnesses.some(w => w.strict && w.windowClose?.passed === true &&
    w.windowClose.originalQualificationStage ===
      (ordinal === 14 ? 'before-ai-http-open' : 'during-streaming') &&
    w.windowClose.originalWebviewCallerSucceeded === false &&
    w.windowClose.nativeRegistryDrainedAfterWindowDestroyed === true &&
    w.windowClose.persistedQualificationReceiptCount === 0 &&
    w.windowClose.syntheticHttpPostCount === (ordinal === 14 ? 0 : 1));
  return witnesses.some(w => cancelled(w, cancellationStages[ordinal - 1]) &&
    w.manifest.dispatch?.acceptedSyntheticPosts === (ordinal <= 5 ? 0 : 1) &&
    (ordinal === 13 ? fourAcknowledged(w.manifest) &&
        w.manifest.casCounts?.acknowledge === 1 :
      ordinal === 12 ? pendingOnly(w.manifest) &&
        w.manifest.casCounts?.begin === 1 &&
        w.manifest.casCounts?.prepare === 1 &&
        w.manifest.casCounts?.acknowledge === 0 :
      w.manifest.durableReceiptCount === 0 &&
        w.manifest.casCounts?.acknowledge === 0));
}
function b03(ordinal, witnesses) {
  switch (ordinal) {
    case 1: return witnesses.some(positive);
    case 2: return witnesses.some(w => expired(w,'b03-before-prepare') && w.manifest.durableReceiptCount === 0);
    case 3: return witnesses.some(w => cancelled(w,'b03-before-prepare') && w.manifest.durableReceiptCount === 0);
    case 4: return witnesses.some(w => expired(w,'b03-native-prepare') && w.manifest.durableReceiptCount === 0);
    case 5: case 7: return witnesses.some(w => cancelled(w,'b03-before-acknowledge') && pendingOnly(w.manifest));
    case 6: return witnesses.some(w => expired(w,'b03-before-acknowledge') && pendingOnly(w.manifest));
    case 8: case 11: return witnesses.some(w => w.meta?.scenario === 'lost-native-ack' &&
      originalRestart(w, 'committed') && fourAcknowledged(w.manifest) &&
      w.invariants.originalRendererReceipt === false);
    case 9: return witnesses.some(w => expired(w,'b03-native-ack-response') && fourAcknowledged(w.manifest));
    case 10: return witnesses.some(w => cancelled(w,'b03-before-readback') && fourAcknowledged(w.manifest));
    case 12: return witnesses.some(w => w.meta?.scenario === 'restart-pending' &&
      originalRestart(w, 'not-committed') && pendingOnly(w.manifest));
    case 13: return witnesses.some(w => w.meta?.scenario === 'restart-acknowledged' &&
      originalRestart(w,'committed') && positive(w));
    case 14: case 15: return witnesses.some(duplicateTicket);
    case 17: return witnesses.some(w => stage(w,'conflict','b03-before-prepare') &&
      w.physicalStage.originalCasConflictInjected === true &&
      w.physicalStage.unrelatedOrdinarySettingsRevisionPreserved === true &&
      w.manifest.casCounts?.begin === 1 && w.manifest.casCounts?.prepare === 1 &&
      w.manifest.casCounts?.acknowledge === 0 && w.manifest.durableReceiptCount === 0);
    case 20: return witnesses.some(w => stage(w,'conflict','b03-before-prepare') &&
      w.physicalStage.unrelatedOrdinarySettingsRevisionPreserved === true);
    default: return false; // Old native-only prerequisites never establish remaining B03 acceptance.
  }
}
function fallbackInvariant(group, ordinal, witnesses) {
  // Future cases may state a requirement-specific independently checked host
  // invariant. Neither generic allPassed nor user-supplied prose is sufficient.
  const checkName = `full-matrix-${group}-${String(ordinal).padStart(2, '0')}-original-runner`;
  return witnesses.some(w => w.strict && w.invariants?.checks?.some(check =>
    check.name === checkName && check.pass === true));
}
const failureModeByOrdinal = Object.freeze({
  1:'authenticated-health-failure',
  4:'transport-failure',
  6:'connection-close-without-terminal',
  7:'terminal-error',
  10:'evidence-rejection',
});
function originalFault(w, mode) {
  const proof = w.report?.renderer?.native?.originalRuntimeFault;
  const request = w.report?.nativeRequestChecks;
  const phases = mode === 'authenticated-health-failure' ? ['native-status'] :
    mode === 'evidence-rejection' ? ['persisted-chat-evidence'] :
    ['malformed-stream-frame','connection-close-without-terminal'].includes(mode) ?
      ['bounded-request','native-quiescence','persisted-chat-evidence'] :
      ['bounded-request','native-quiescence'];
  const beforeRegistration = mode === 'authenticated-health-failure';
  const acceptedPosts = ['authenticated-health-failure','transport-failure','terminal-error']
    .includes(mode) ? 0 : 1;
  const exactId = proof?.exactOriginalRequestId;
  return w.strict && w.meta?.scenario === 'original-runtime-fault' &&
    w.meta.runtimeScenario === mode &&
    w.report?.renderer?.outcome === 'original-qualification-runtime-fault-rejected' &&
    w.report.scenarioObservedByHost === true &&
    proof?.mode === mode && proof.originalProductionRunner === true &&
    proof.originalCallerRejected === true && proof.originalCallerSucceeded === false &&
    proof.nativeSessionDrained === true && proof.noAdditionalNativeRequest === true &&
    proof.noB03CallsOrReceipts === true && proof.noFlightViolations === true &&
    proof.noModel === true && typeof proof.originalSessionId === 'string' &&
    proof.originalSessionId.length > 0 &&
    phases.includes(proof.originalRejectionPhase) &&
    (beforeRegistration ?
      exactId == null && proof.originalNativeOpenCount === 0 &&
        proof.actualOriginalChannelEvents?.length === 0 :
      typeof exactId === 'string' && /^inference-\d+$/.test(exactId) &&
        proof.originalNativeOpenCount === 1 &&
        Array.isArray(proof.actualOriginalChannelEvents) &&
        proof.actualOriginalChannelEvents.length > 0 &&
        request?.streamIds?.includes(exactId)) &&
    w.manifest.dispatch?.nativeOpens === (beforeRegistration ? 1 : 2) &&
    w.manifest.dispatch?.nativeStreams === (beforeRegistration ? 0 : 1) &&
    w.manifest.dispatch?.acceptedSyntheticPosts === acceptedPosts &&
    w.manifest.casCounts?.begin === 0 &&
    w.manifest.casCounts?.prepare === 0 &&
    w.manifest.casCounts?.acknowledge === 0 &&
    w.manifest.durableReceiptCount === 0 &&
    request?.counts?.lm11_acceptance_runtime_activate === 1;
}
function malformedResolvedNegative(w) {
  // The host must independently confirm this exact original qualification
  // lifecycle. A generic allPassed or older rejection-only check is never
  // enough to classify the malformed-stream negative tuple as F05 PASS.
  const outcome = 'original-qualification-negative-receipts';
  return w.strict && w.original &&
    w.meta?.scenario === 'original-runtime-fault' &&
    w.meta.runtimeScenario === 'malformed-stream-frame' &&
    w.invariants?.checks?.some(row =>
      row.name === 'full-matrix-failures-05-original-runner-negative' &&
      row.pass === true) &&
    w.report?.scenarioObservedByHost === true &&
    w.report?.renderer?.outcome === outcome &&
    w.manifest.rendererCallerOutcome === outcome &&
    w.manifest.evidenceResult === outcome &&
    w.report?.nativeDurableReceiptCheck?.count === 4 &&
    w.report.nativeDurableReceiptCheck.modelQualityQualification === false &&
    w.report.nativeDurableReceiptCheck.passed === true &&
    w.report?.nativeRequestChecks?.pass === true &&
    fourNegativeAcknowledged(w.manifest) &&
    w.manifest.casCounts?.begin === 1 &&
    w.manifest.casCounts?.prepare === 1 &&
    w.manifest.casCounts?.acknowledge === 1 &&
    w.manifest.dispatch?.nativeOpens === 2 &&
    w.manifest.dispatch?.nativeStreams === 1 &&
    w.manifest.dispatch?.acceptedSyntheticPosts === 1;
}
function physicalMatch(group, ordinal, witnesses) {
  if (group === 'B01') return b01(ordinal, witnesses);
  if (group === 'B02') return b02(ordinal, witnesses);
  if (group === 'B03') return b03(ordinal, witnesses) ||
    fallbackInvariant(group, ordinal, witnesses);
  if (group === 'concurrent' && ordinal === 1) return witnesses.some(w =>
    w.strict && w.meta?.scenario === 'stage-concurrent' &&
    w.physicalStage?.secondOriginalSameDeploymentQualificationRejected === true &&
    w.physicalStage?.originalFirstQualificationCompleted === true && fourAcknowledged(w.manifest));
  if (group === 'failures' && ordinal === 5)
    return witnesses.some(malformedResolvedNegative);
  if (group === 'failures' && Object.hasOwn(failureModeByOrdinal,ordinal))
    return witnesses.some(w => originalFault(w,failureModeByOrdinal[ordinal])) ||
      (ordinal === 1 && b01(1, witnesses));
  if (group === 'failures' && ordinal === 11) return b03(17, witnesses);
  if (group === 'failures' && ordinal === 13) return b02(14, witnesses) ||
    b02(15, witnesses) || b03(8, witnesses);
  return fallbackInvariant(group, ordinal, witnesses);
}

export function compileRows(review, cases) {
  const nominations = new Map();
  check(Array.isArray(review.rows), 'review.rows must be an array (possibly empty)');
  for (const r of review.rows) {
    check(groups.includes(r.group) && Number.isInteger(r.ordinal) &&
      r.ordinal >= 1 && r.ordinal <= MATRIX_REQUIREMENTS[r.group].length,
    'invalid review group/ordinal');
    const key = `${r.group}/${r.ordinal}`;
    check(!nominations.has(key), 'duplicate review ordinal ' + key);
    check(['PASS','PARTIAL','BLOCKED','FAIL'].includes(r.status), 'invalid status ' + key);
    check(Array.isArray(r.caseIds) && new Set(r.caseIds).size === r.caseIds.length &&
      r.caseIds.every(id => cases.has(id)), 'unknown or duplicate case ID for ' + key);
    cleanText(r.reason, key);
    nominations.set(key, r);
  }
  return Object.fromEntries(groups.map(group => [group,
    MATRIX_REQUIREMENTS[group].map((required, index) => {
      const ordinal = index + 1;
      const declaration = nominations.get(`${group}/${ordinal}`);
      const caseIds = declaration?.caseIds ?? [];
      const witnesses = caseIds.map(id => cases.get(id));
      let status = declaration?.status ?? 'BLOCKED';
      let reason = declaration?.reason ?? 'No separately reviewed physical original-runner case was nominated for this required boundary.';
      if (status === 'PASS' && !physicalMatch(group, ordinal, witnesses)) {
        status = witnesses.some(w => w.strict) ? 'PARTIAL' : 'BLOCKED';
        reason += ' PASS was rejected by the independent physical scenario and original-runner checks.';
      }
      if (status === 'FAIL' && !witnesses.some(w =>
        w.invariants?.allPassed === false || w.manifest.failedInvariants?.length > 0)) {
        status = witnesses.some(w => w.original) ? 'PARTIAL' : 'BLOCKED';
        reason += ' A FAIL verdict requires a physically failed invariant or recorded failed original attempt.';
      }
      if (group === 'failures' && ordinal === 5 && status === 'PASS') {
        reason = 'Original production caller resolved BoundedQualificationResult with three FAILED and one incomplete ' +
          'durable v2 acknowledged negative receipts, zero verified capabilities, and one native CAS attempt. ' +
          'F05 PASS proves no silent capability promotion; it does not prove a parser throw or caller rejection.';
      }
      const original = witnesses.some(w => w.original);
      return {
        ordinal,
        productionBoundary: Array.isArray(required) ? required[0] : required,
        ...(Array.isArray(required) ? { acceptanceSeam: required[1] } : {}),
        status,
        originalProductionRunner: status === 'PASS' ? true : original,
        caseIds,
        reason,
        attemptReferences: caseIds.flatMap(id => cases.get(id).manifest.caseEvidenceFiles
          .map(e => ({ file: id + '/' + e.file, sha256: e.sha256 }))),
      };
    }),
  ]));
}

export function classification(rows, gates) {
  if (rows.some(row => row.status === 'FAIL')) return 'Failed';
  if (rows.every(row => row.status === 'PASS') && gates) return accepted;
  if (rows.every(row => row.status === 'BLOCKED')) return 'Blocked';
  return 'Partial';
}

function hostCheckedOriginal(w, name) {
  return w.strict && w.invariants?.checks?.some(item =>
    item.name === name && item.pass === true);
}

export function b02AsyncGate(review, cases) {
  const definitions = {
    delayedAdmissionAfterCancellation:w => hostCheckedOriginal(w,
      'full-matrix-B02-delayed-admission-after-cancel-original-runner'),
    delayedPreparationAfterCancellation:w => cancelled(w,'during-preparation') &&
      w.release?.budgetElapsedMs >= w.physicalStage.cancelledAtOperationElapsedMs &&
      w.manifest.durableReceiptCount === 0,
    lateRegistrationAfterCancellation:w => hostCheckedOriginal(w,
      'full-matrix-B02-late-registration-after-cancel-original-runner'),
  };
  const chosen = review.b02AsyncProofs ?? {};
  check(chosen && typeof chosen === 'object' && !Array.isArray(chosen) &&
    Object.keys(chosen).every(key => Object.hasOwn(definitions,key)),
  'b02AsyncProofs contains unrecognized supplemental criteria');
  const outcomes = {};
  for(const [name,predicate] of Object.entries(definitions)) {
    const ids = chosen[name] ?? [];
    check(Array.isArray(ids) && new Set(ids).size === ids.length &&
      ids.every(id => cases.has(id)),
    'B02 supplemental proof needs distinct inventoried Wry case IDs: '+name);
    outcomes[name] = {
      caseIds:ids,
      passed:ids.some(id => predicate(cases.get(id))),
      reason:ids.length === 0 ? 'Independent physical original-runner case not supplied.' :
        'Only strict original-session physical proof may satisfy this asynchronous late boundary.',
    };
  }
  return outcomes;
}

const safeCaseLeaves = new Set([
  'run-metadata.json','renderer-report.json','renderer-origin.json',
  'acceptance-invariants.json','acceptance-restart-invariants.json',
  'barrier-stage-armed.json','barrier-stage-hit.json',
  'barrier-stage-release.json','barrier-stage-observation.json',
  'native-window-close-report.json','native-restart-report.json',
  'native-host.stderr.log','native-host.stdout.log',
  'native-restart.stderr.log','native-restart.stdout.log',
]);

function compileSummary(auditDir, reviewFile) {
  const canonicalAudit = fs.realpathSync.native(auditDir);
  check(path.dirname(canonicalAudit).toLowerCase() === ownerReal().toLowerCase() &&
    auditPattern.test(path.basename(canonicalAudit)),
  'audit must be the exact existing canonical direct matrix case');
  check(path.dirname(path.resolve(reviewFile)).toLowerCase() === canonicalAudit.toLowerCase() &&
    path.basename(reviewFile) === 'full-matrix-review.json',
  'review input must be an existing full-matrix-review.json in the audit');
  const auditName = path.basename(canonicalAudit);
  const reviewRelative = auditName + '/full-matrix-review.json';
  check(path.resolve(ownedFile(reviewRelative)).toLowerCase() === path.resolve(reviewFile).toLowerCase(),
  'review must be an existing nonredirected case-owned file');
  const review = readOwned(reviewRelative);
  check(review.schema === 1, 'review schema 1 required');
  const ids = readOwned(auditName + '/case-ids.json');
  check(Array.isArray(ids) && ids.length > 0 && ids.length <= 500 &&
    ids.every(id => casePattern.test(id) && timestamp(id) >= timestamp(auditName)) &&
    new Set(ids).size === ids.length,
  'case-ids.json must contain unique new-audit Wry IDs (never historical prerequisite cases)');
  const perCase = readOwned(auditName + '/per-case-evidence.json');
  check(perCase.schema === 1 && perCase.exactCases === ids.length &&
    Array.isArray(perCase.caseRows) && perCase.caseRows.length === ids.length &&
    perCase.caseRows.every((row,index) => row.caseId === ids[index]),
  'per-case evidence must exactly preserve the ordered final case IDs');
  // The final case list must also retain attempts mentioned in audit journals
  // and failing logs. Otherwise a failed run could silently vanish from the
  // normalized manifest and still leave an attractive PASS replacement.
  const listed = new Set(ids);
  const unlisted = new Set();
  const allAuditFiles = fs.readdirSync(canonicalAudit,{withFileTypes:true});
  for (const entry of allAuditFiles) {
    if (!entry.isFile() || !/\.(?:json|log)$/.test(entry.name) ||
      ['case-ids.json','per-case-evidence.json','full-matrix-review.json'].includes(entry.name)) continue;
    const filename = ownedFile(auditName + '/' + entry.name);
    check(fs.statSync(filename).size <= 10_000_000,
      'audit journal/log exceeds safe scan limit: ' + entry.name);
    const contents = fs.readFileSync(filename,'utf8');
    for (const match of contents.matchAll(/wry-\d{17}-[a-f0-9]{12}/g))
      if (!listed.has(match[0])) unlisted.add(match[0]);
  }
  check(unlisted.size === 0,
    'case-ids.json omitted Wry attempts referenced by logs/journals: ' +
    [...unlisted].sort().join(', '));
  const cases = new Map(ids.map((id,index) => [id,loadCase(id,perCase.caseRows[index])]));
  const matrix = compileRows(review, cases);
  const t15CaseId = review.freshT15CaseId;
  // A matched T15 audit directory is created for its BEFORE snapshot. Its ID
  // normally predates physical cases; only its AFTER evidence must postdate
  // those cases and the regression logs. Do not mistake directory creation
  // time for the end of the independent comparison.
  check(t15Pattern.test(t15CaseId) &&
    timestamp(t15CaseId) > timestamp(priorT15CaseId),
  'T15 must be a newly scoped matched BEFORE/AFTER audit, not the old checkpoint');
  const t15 = readOwned(t15CaseId + '/scoped-t15-final-comparison.json');
  check(t15.schema === 1 && t15.auditCaseId === t15CaseId &&
    typeof t15.authoritativeT15Pass === 'boolean' &&
    t15.noRawSecretOrUnscopedTargetSerialized === true,
  'fresh attributable T15 comparison missing or malformed');
  const t15Os = readOwned(t15CaseId + '/os-post-run-isolation.json');
  const t15Passed = t15.authoritativeT15Pass === true &&
    t15.productionObjectsUnchanged === true &&
    t15.changedScopedObjects === 0 && t15.scopeReadErrors === 0 &&
    t15.beforeObjects > 0 && t15.beforeObjects === t15.afterObjects &&
    t15.scopedCredentialMetadataUnchanged === true &&
    t15.scopedV3SecretsUnchanged === true &&
    t15Os.acceptanceProcessCount === 0 &&
    t15Os.noOwnedRuntimeOrListenerOrRegistration === true;
  check(t15Passed === t15.authoritativeT15Pass,
    'fresh T15 authoritative PASS flag contradicts physical scoped or OS proof');
  const preservationFile = review.preservationEvidenceFile;
  check(typeof preservationFile === 'string' && preservationFile.startsWith(auditName + '/') &&
    preservationFile !== auditName + '/full-matrix-summary.json',
  'final preservation must be an existing audit-owned artifact');
  const preservation = readOwned(preservationFile);
  const preserved = preservation.preserved === true && preservation.protectedFileCount === 81 &&
    Array.isArray(preservation.protectedFileHashMismatches) &&
    preservation.protectedFileHashMismatches.length === 0 &&
    preservation.acceptanceProcessCount === 0 && preservation.stagedPaths === 0;
  check(preserved, 'preservation proof must pass with 81 protected hashes and no residue');
  check(Array.isArray(review.regressions) && review.regressions.length > 0,
  'at least one actual regression result and log is required');
  const regressionNames = new Set();
  const regressions = review.regressions.map(item => {
    check(typeof item.name === 'string' && /^[a-zA-Z0-9 _./-]{4,100}$/.test(item.name) &&
      !regressionNames.has(item.name), 'invalid or repeated regression name');
    regressionNames.add(item.name);
    check(['PASS','FAIL','KNOWN-FAIL','BLOCKED','SKIPPED'].includes(item.status),
    'invalid regression status');
    check(typeof item.evidenceFile === 'string' &&
      item.evidenceFile.startsWith(auditName + '/') &&
      /\.(?:json|log)$/.test(item.evidenceFile),
    'regression must cite a real audit result/log');
    const file = artifact(item.evidenceFile);
    const knownFixtureVerified = item.status === 'KNOWN-FAIL' &&
      verifyKnownFixtureLog(fs.readFileSync(ownedFile(item.evidenceFile),'utf8'),
        item.knownFailureKind);
    return { name:item.name,status:item.status,
      reason:cleanText(item.reason,'regression '+item.name), evidenceFile:file.file,
      evidenceSha256:file.sha256,
      ...(item.status === 'KNOWN-FAIL' ?
        {knownFailureKind:item.knownFailureKind ?? null,knownFixtureVerified} : {}) };
  });
  const caseEvidenceTimes = ids.flatMap(id => {
    const row = cases.get(id).manifest;
    const files = new Set(['run-metadata.json',...row.caseEvidenceFiles.map(x=>x.file)]);
    return [...files].flatMap(file => {
      const absolute = ownedFile(id + '/' + file,false);
      return absolute ? [fs.statSync(absolute).mtimeMs] : [];
    });
  });
  check(caseEvidenceTimes.length > 0, 'no physical case times in final immutable inventory');
  const earliestPhysical = Math.min(...caseEvidenceTimes);
  const latestPhysicalOrRegression = Math.max(...caseEvidenceTimes,
    ...regressions.map(r => fs.statSync(ownedFile(r.evidenceFile)).mtimeMs));
  const beforeTimes = ['production-before.json','credential-manager-before.json',
    'credential-secret-v3-before.json'].map(file =>
    fs.statSync(ownedFile(t15CaseId + '/' + file)).mtimeMs);
  const afterTimes = ['production-after.json','credential-manager-after.json',
    'credential-secret-v3-after.json'].map(file =>
    fs.statSync(ownedFile(t15CaseId + '/' + file)).mtimeMs);
  const t15Before = Math.max(...beforeTimes);
  const t15After = Math.min(...afterTimes);
  const t15Comparison = fs.statSync(ownedFile(
    t15CaseId + '/scoped-t15-final-comparison.json')).mtimeMs;
  const observedAtMs = Date.parse(t15Os.observedAtUtc);
  check(Number.isFinite(observedAtMs) && t15Before <= earliestPhysical &&
    t15After >= latestPhysicalOrRegression &&
    t15Comparison >= Math.max(...afterTimes) &&
    observedAtMs >= latestPhysicalOrRegression,
  'matched T15 BEFORE must precede cases and AFTER/OS evidence must follow all case and regression effects');
  check(Array.isArray(review.positiveCaseIds) && review.positiveCaseIds.length > 0 &&
    new Set(review.positiveCaseIds).size === review.positiveCaseIds.length &&
    review.positiveCaseIds.every(id => cases.has(id)),
  'original positive production-runner cases must be explicitly named');
  const positiveCases = review.positiveCaseIds.map(caseId => {
    const w = cases.get(caseId);
    const pass = positive(w);
    return {caseId,pass,originalProductionRunner:w.original,
      nativeAcknowledgedReadback:pass,
      capabilities:pass ? w.manifest.durableReceiptMetadata.map(r => r.capability) : [],
      reason:pass ? 'Original authenticated synthetic Chat qualified once through native ACK and exact readback.' :
        'Positive result not established by strict original runner, native CAS counters and four receipts.'};
  });
  const gates = t15Passed && preserved && positiveCases.some(item => item.pass) &&
    regressions.every(r => r.status === 'PASS' ||
      (r.status === 'KNOWN-FAIL' && r.knownFixtureVerified === true));
  const asyncB02 = b02AsyncGate(review,cases);
  const originalPostcommitExpiryIds = ids.filter(id =>
    b03(9,[cases.get(id)]));
  const b01PostcommitCovered = matrix.B03[8].status === 'PASS' &&
    matrix.B03[8].caseIds.some(id => originalPostcommitExpiryIds.includes(id));
  const lateRacesCovered = matrix.lateRaces.every(row => row.status === 'PASS');
  const b02AsyncCovered = Object.values(asyncB02).every(item => item.passed === true);
  const concurrentCovered = matrix.concurrent.every(row => row.status === 'PASS');
  const b03RelatedFaultsCovered = [11,12,13].every(ordinal =>
    matrix.failures[ordinal - 1].status === 'PASS');
  const safetyGates = {
    sharedAttributableT15AndPreservationAndRegressions:gates,
    B01:{physicalPostcommitAckResponseExpiry:b01PostcommitCovered,
      caseIds:originalPostcommitExpiryIds,
      reason:'Ten B01 timing boundaries do not cover an irreversible post-ACK result without this separately verified original expiry.'},
    B02:{allTwelveOriginalLateRaces:lateRacesCovered,
      independentlyCompletedAsyncCancellation:b02AsyncCovered,
      supplemental:asyncB02,
      reason:'Stage-Stop results do not independently demonstrate delayed admission, post-Stop registration or all twelve late callbacks.'},
    B03:{allSameDeploymentConcurrency:concurrentCovered,
      casRecoveryAndIpcFaults:b03RelatedFaultsCovered,
      requiredFaultOrdinals:[11,12,13],
      reason:'B03 requires genuine competing original operations and original persistence/recovery failure coverage.'},
  };
  const verdicts = {
    B01:classification(matrix.B01,gates && b01PostcommitCovered),
    B02:classification(matrix.B02,gates && lateRacesCovered && b02AsyncCovered),
    B03:classification(matrix.B03,gates && concurrentCovered && b03RelatedFaultsCovered),
  };
  const combinedRows = groups.flatMap(group => matrix[group]);
  verdicts.combined = classification(combinedRows,gates &&
    ['B01','B02','B03'].every(name => verdicts[name] === accepted));
  const references = new Set([
    auditName + '/case-ids.json', auditName + '/per-case-evidence.json',reviewRelative,
    preservationFile,t15CaseId + '/scoped-t15-final-comparison.json',
    t15CaseId + '/os-post-run-isolation.json',...regressions.map(r => r.evidenceFile),
  ]);
  for(const entry of allAuditFiles) {
    if(entry.isFile() && !entry.isSymbolicLink() &&
      /^[a-zA-Z0-9_.-]+\.(?:json|log)$/.test(entry.name) &&
      entry.name !== 'full-matrix-summary.json' &&
      !/(?:secret|credential|password|token|raw|prompt)/i.test(entry.name))
      references.add(auditName + '/' + entry.name);
  }
  for(const id of ids) for(const leaf of safeCaseLeaves) {
    if(ownedFile(id + '/' + leaf,false)) references.add(id + '/' + leaf);
  }
  const referenceHashes = [...references].sort().map(artifact);
  check(review.attemptReasons === undefined ||
    (review.attemptReasons && typeof review.attemptReasons === 'object' &&
      !Array.isArray(review.attemptReasons) &&
      Object.keys(review.attemptReasons).every(id => cases.has(id))),
  'attemptReasons may contain only explicitly inventoried Wry IDs');
  const attempts = ids.map(id => {
    const w = cases.get(id);
    return {caseId:id,scenario:w.meta?.scenario ?? null,
      originalProductionRunner:w.original,
      strictHostAllPassed:w.invariants?.allPassed === true,
      failedInvariants:w.manifest.failedInvariants,
      originalCallerSucceeded:w.manifest.originalCallerSucceeded === true,
      evidenceRefs:referenceHashes.filter(x => x.file.startsWith(id + '/')),
      reason:review.attemptReasons?.[id] ? cleanText(review.attemptReasons[id],id) :
        w.invariants?.allPassed === true ?
          'Physical case invariants passed; its narrower effect is stated by linked matrix rows.' :
          'Unpassed, incomplete or interrupted attempt is retained as negative/unverified evidence.'};
  });
  const summary = {
    version:1,syntheticOnly:true,realModelInference:false,qualificationLabRun:false,
    fullMatrixAttempted:true,aggregateDeadlineBudgetMs:120000,
    aggregateDeadlineMechanismReplaced:false,
    sourceAuditCaseId:auditName,
    sources:{caseIds:artifact(auditName+'/case-ids.json'),
      perCaseEvidence:artifact(auditName+'/per-case-evidence.json'),
      independentReview:artifact(reviewRelative)},
    ...matrix,positiveCases,
    freshT15:{caseId:t15CaseId,pass:t15Passed},
    preservation:{passed:preserved,evidenceFile:preservationFile},
    regressions,safetyGates,attempts,referenceHashes,
    references:[...references].sort(),verdicts,
    coverage:Object.fromEntries(groups.map(group => [group,
      Object.fromEntries(['PASS','PARTIAL','BLOCKED','FAIL'].map(status =>
        [status,matrix[group].filter(row => row.status === status).length]))])),
    acceptanceLimits:'Windows model-free isolated synthetic original-production-path evidence only; no real model, GGUF, Lab Run or Agent eligibility acceptance.',
  };
  check(combinedRows.length === 75 && summary.references.length >= 30,
  '75 exact ordinals and at least 30 immutable evidence references required');
  const target = path.join(canonicalAudit,'full-matrix-summary.json');
  const bytes = Buffer.from(JSON.stringify(summary,null,2)+'\n');
  const descriptor = fs.openSync(target,'wx',0o600);
  try {fs.writeFileSync(descriptor,bytes);fs.fsyncSync(descriptor);}
  finally {fs.closeSync(descriptor);}
  return {file:target,sha256:sha(bytes),rows:combinedRows.length,
    physicalCases:ids.length,referenceCount:references.size,verdicts,coverage:summary.coverage};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  check(process.argv.length === 4,
    'usage: node scripts/lm11-full-matrix-summary-builder.mjs <existing-audit-dir> <existing-audit-dir>/full-matrix-review.json');
  const result = compileSummary(process.argv[2],process.argv[3]);
  console.log(JSON.stringify(result,null,2));
}
