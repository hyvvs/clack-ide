/**
 * One new immutable LM11 blocker-closure index, never the prior fidelity index.
 *
 * This is a read-only verifier toward previous evidence; the ONLY write is one
 * new direct-child index JSON created exclusively with wx. The operator creates
 * one bounded blocker-audit summary after physical cases and regressions finish.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = fs.realpathSync.native(path.join(repo, 'src-tauri','target',
  'lm11-b01-b03-authenticated-webview-20261119','cases'));
const prior = 'index-20261120000845246-05cea9a2820e/lm11-fidelity-closure-evidence-index.json';
const priorSha = 'cd5e2529b39acc542bc49b324decccf931b791dc31f4ed727bd29ea82c7507d1';
const t10 = 'wry-20261120015056527-608afa07eb13';
const t15Policy = 't15-policy-20261120014220207-206462d74cab/t15-attributable-policy.json';
const sha = data => createHash('sha256').update(data).digest('hex');
const assert = (ok, why) => { if (!ok) throw new Error(why); };
function safe(relative) {
  assert(typeof relative === 'string' && !relative.includes('\\') &&
    !relative.includes('..') && !path.isAbsolute(relative) &&
    /^[a-zA-Z0-9_./-]{1,320}$/.test(relative), 'Unsafe relative case artifact path');
  const target = path.join(cases, ...relative.split('/'));
  const stat = fs.lstatSync(target);
  assert(stat.isFile() && !stat.isSymbolicLink() &&
    fs.realpathSync.native(target).toLowerCase() === target.toLowerCase(),
    'Redirected or nonregular evidence artifact');
  return target;
}
function evidence(relative) {
  const bytes=fs.readFileSync(safe(relative));
  return { path:relative, sha256:sha(bytes), bytes:bytes.length };
}
function json(relative) { return JSON.parse(fs.readFileSync(safe(relative),'utf8').replace(/^\uFEFF/,'')); }
assert(sha(fs.readFileSync(safe(prior))) === priorSha,
  'Existing immutable fidelity closure unexpectedly changed');
const t10inv=json(`${t10}/acceptance-invariants.json`);
const t10render=json(`${t10}/renderer-report.json`);
const t10proof=t10render.renderer?.native?.originalCrossChild;
assert(t10inv.allPassed === true &&
  t10proof?.originalProductionRunner === true &&
  t10proof?.heldActualOriginalEvent === true &&
  t10proof?.originalOperationRejected === true &&
  t10proof?.releaseAfterBReady === true &&
  t10proof?.originalChannelDisposed === true &&
  t10proof?.originalCallbackInvoked === false &&
  t10proof?.observedBoundary === 'original-tauri-channel-structurally-disposed' &&
  t10proof?.noB03CallsOrReceipts === true &&
  t10proof?.originalChatAndTaskUnchanged === true,
  'T10 actual original qualifier callback ownership has not passed');
const policy=json(t15Policy);
assert(policy.scopedT15PolicySatisfied === true &&
  policy.globalWincredMetadataIdentical === false &&
  policy.acceptanceHarnessAttributionOfForeignCountChange === 'unknown',
  'Do not rewrite the foreign credential provenance caveat');
const freshT15Case='fidelity-audit-20261120014350183-8a0f728bf980';
const freshT15=json(`${freshT15Case}/scoped-t15-final-comparison.json`);
const finalOs=json(`${freshT15Case}/os-post-run-isolation.json`);
assert(freshT15.authoritativeT15Pass === true &&
  freshT15.beforeObjects === 9541 && freshT15.afterObjects === 9541 &&
  freshT15.changedScopedObjects === 0 && freshT15.scopeReadErrors === 0 &&
  freshT15.scopedCredentialMetadataUnchanged === true &&
  freshT15.scopedV3SecretsUnchanged === true &&
  freshT15.scopedCredentialsBefore === 5 && freshT15.scopedCredentialsAfter === 5 &&
  freshT15.scopedV3CountBefore === 5 && freshT15.scopedV3CountAfter === 5 &&
  finalOs.noOwnedRuntimeOrListenerOrRegistration === true,
  'Fresh T15 attributable-state BEFORE/AFTER proof is not complete');
assert(process.argv.length === 3, 'Expected exactly one owned blocker-audit summary filename');
const summaryFile=path.resolve(process.argv[2]);
const parent=path.dirname(summaryFile);
assert(path.dirname(parent).toLowerCase() === cases.toLowerCase() &&
  /^blocker-audit-\d{17}-[a-f0-9]{12}$/.test(path.basename(parent)) &&
  path.basename(summaryFile) === 'blocker-closure-summary.json' &&
  fs.realpathSync.native(parent).toLowerCase() === parent.toLowerCase(),
  'Summary must be direct canonical owned blocker audit');
const summaryBytes=fs.readFileSync(summaryFile);
const input=JSON.parse(summaryBytes.toString('utf8').replace(/^\uFEFF/,''));
assert(input.version === 1 &&
  input.realModelInference === false && input.qualificationLabRun === false &&
  input.fullB01B02B03MatrixExecuted === false &&
  input.aggregateDeadlineFlagChanged === false,
  'Summary does not preserve safety restrictions');
const ids=Array.from({length:15},(_,i)=>`T${String(i+1).padStart(2,'0')}`);
assert(Array.isArray(input.selfTests) && input.selfTests.length === 15 &&
  input.selfTests.every((x,i)=>x.id === ids[i] &&
    ['PASS','PARTIAL','BLOCKED','FAIL'].includes(x.status)),
  'Noncanonical 15-test classification');
assert(input.selfTests[9].status === 'PASS' &&
  input.selfTests[12].status === 'PASS' &&
  input.selfTests[14].status === 'PASS',
  'Do not contradict passing actual T10 and retained T13');
assert(Array.isArray(input.boundaries) && input.boundaries.length === 10 &&
  input.boundaries.every((x,i)=>x.ordinal === i+1 &&
    x.productionOwner && x.seam &&
    ['CONTROLLABLE_EXPIRY_PROVEN','CONTROLLABLE_NOT_EXPIRED','BLOCKED'].includes(x.classification)),
  'Deadline owner/control map must cover all ten exact conceptual boundaries');
for (const boundary of input.boundaries) {
  if (boundary.classification === 'BLOCKED') continue;
  const reachability = boundary.reachabilityCases ??
    (boundary.reachabilityCase ? [boundary.reachabilityCase] : []);
  assert(Array.isArray(reachability) && reachability.length > 0,
    `No physical reachability cases linked for ${boundary.ordinal}`);
  for (const id of reachability) {
    assert(/^wry-\d{17}-[a-f0-9]{12}$/.test(id),
      'Invalid original qualification reachability case id');
    assert(json(`${id}/acceptance-invariants.json`).allPassed === true,
      `Claimed reachability did not pass physical invariants: ${id}`);
  }
  if (boundary.classification === 'CONTROLLABLE_EXPIRY_PROVEN') {
    const id=boundary.expiryCase;
    assert(typeof id === 'string' && /^wry-\d{17}-[a-f0-9]{12}$/.test(id) &&
      json(`${id}/acceptance-invariants.json`).allPassed === true,
      'Original expiry claim requires a passing physical case');
    if (!boundary.expiryRetainedFromPrior) {
      const v=json(`${id}/renderer-report.json`).renderer?.native?.stageBarrier;
      // The renderer records the stage-expiry scenario as mode="expiry";
      // the native observation records the full scenario separately.
      assert(v?.mode === 'expiry' &&
        v.originalProductionRunner === true &&
        v.originalRunnerTerminal === 'rejected' &&
        v.originalCallerDidNotRetroactivelyPass === true &&
        v.originalElapsedMs >= 119_000,
        'New aggregate deadline case must report original production rejection');
    }
  }
}
assert(Array.isArray(input.references) && input.references.length >= 12 &&
  input.references.every(x => typeof x === 'string'),
  'Need evidence references for physical cases, T15 and regressions');
const unique=[...new Set([prior,
  `${t10}/acceptance-invariants.json`,`${t10}/renderer-report.json`,
  t15Policy,`${freshT15Case}/scoped-t15-final-comparison.json`,
  `${freshT15Case}/os-post-run-isolation.json`,...input.references])];
const artifacts=unique.map(evidence);
const claimsAllControllable=input.boundaries.every(x=>x.classification !== 'BLOCKED');
const onlyActualPass=input.selfTests.every(x=>x.status==='PASS');
const namedExpiries=['after-ai-http-open','quiescence-complete',
  'before-evidence-acceptance','b03-before-prepare'];
const original120sProof=namedExpiries.every(stage=>{
  const x=input.boundaries.find(row=>row.seam === stage);
  return x?.classification === 'CONTROLLABLE_EXPIRY_PROVEN' &&
    x.expiryCase && x.expiryRetainedFromPrior !== true;
});
assert(original120sProof &&
  input.representativePreviouslyBlockedReal120sExpiriesProven === true &&
  input.b03SideReal120sExpiryProven === true,
  'Four exact original 120s registration/JS/B03 boundary proofs required');
const preservation=json('blocker-audit-20261120022628625-2e5d662062fc/final-preservation-audit.json');
assert(preservation.preserved === true &&
  preservation.protectedFileCount === 81 &&
  preservation.protectedFileHashMismatches.length === 0 &&
  preservation.stagedPaths === 0 &&
  preservation.historicalFidelityIndexSha256 === priorSha &&
  preservation.acceptanceProcessCount === 0 &&
  preservation.gitDiffCheckExitCode === 0,
  'Final preservation invariants not proven');
assert(input.infrastructureSufficient ===
  (onlyActualPass && claimsAllControllable && freshT15.authoritativeT15Pass &&
    preservation.preserved && original120sProof &&
    input.representativePreviouslyBlockedReal120sExpiriesProven === true &&
    input.b03SideReal120sExpiryProven === true),
  'Refuse ungrounded infrastructure YES/NO');
const output={
  schema:1, evidenceKind:'LM11 final acceptance-harness blocker-closure',
  generatedAtUtc:new Date().toISOString(), immutableWriteOnce:true,
  previousFidelityIndexSha256:priorSha,
  t10PhysicalCase:t10, t10ActualOriginalChannelDispositionProven:true,
  t15HistoricalPolicyClarification:t15Policy,
  t15GlobalWinCredProvenIdentical:false,
  t15ForeignCredentialProcessAttribution:'unknown',
  sourceSummarySha256:sha(summaryBytes),
  ...input,
  evidenceSha256:artifacts,
};
const name='index-'+new Date().toISOString().replace(/[^0-9]/g,'')+
  '-'+randomBytes(6).toString('hex');
const dir=path.join(cases,name);
fs.mkdirSync(dir,{recursive:false});
const outputFile=path.join(dir,'lm11-final-blocker-closure-evidence-index.json');
const bytes=Buffer.from(JSON.stringify(output,null,2)+'\n');
const fd=fs.openSync(outputFile,'wx',0o600);
try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
console.log(JSON.stringify({indexFile:outputFile,sha256:sha(bytes),
  t10Status:input.selfTests[9].status,t15Status:input.selfTests[14].status,
  controllableCount:input.boundaries.filter(x=>x.classification!=='BLOCKED').length,
  infrastructureSufficient:input.infrastructureSufficient},null,2));
