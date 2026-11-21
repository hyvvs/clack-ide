/**
 * Write-once evidence seal: LM11 Final B02/B03 Defect and Race Closure.
 * Reads only already-owned isolated Windows synthetic acceptance artifacts,
 * test logs, and read-only preservation/T15 reports. Never mutates existing
 * indexes, cases, Git, credentials, registrations or production settings.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cases=fs.realpathSync.native(path.join(repo,'src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases'));
const inputs=process.argv.slice(2);
if(inputs.length!==2)throw Error('Provide exact final-defect-audit and fresh fidelity-audit paths');
function canonical(input,pattern){
  const p=fs.realpathSync.native(input);
  if(path.dirname(p).toLowerCase()!==cases.toLowerCase() ||
      !pattern.test(path.basename(p)) || !fs.lstatSync(p).isDirectory() ||
      fs.lstatSync(p).isSymbolicLink())throw Error('Invalid or redirected exact LM11 owned case');
  return p;
}
const audit=canonical(inputs[0],/^final-defect-audit-\d{17}-[a-f0-9]{12}$/);
const t15=canonical(inputs[1],/^fidelity-audit-\d{17}-[a-f0-9]{12}$/);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const rel=absolute=>path.relative(repo,absolute).replaceAll('\\','/');
const indexFile=path.join(audit,'lm11-final-b02-b03-defect-and-race-closure-evidence-index.json');
if(fs.existsSync(indexFile))throw Error('Immutable final index already exists; never overwrite');
function dataFile(file){
  if(!fs.existsSync(file) || !fs.lstatSync(file).isFile() ||
    fs.lstatSync(file).isSymbolicLink())throw Error('Required evidence missing/redirected: '+rel(file));
  const bytes=fs.readFileSync(file);
  return {path:rel(file),sha256:sha(bytes),bytes:bytes.length};
}
function readJson(file){
  const proof=dataFile(file);
  return {proof,value:JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''))};
}
const priorFile=path.join(cases,
  'async-authority-audit-20261120111631274-e0edf6a279b2',
  'lm11-b02-b03-asynchronous-persistence-authority-closure-evidence-index.json');
const prior=readJson(priorFile);
if(prior.proof.sha256!=='a35c7c552bb2e37da1af8df4e80fccb2e5f28fe9d11ea826f25c1094c4a7bb2d' ||
    prior.value.physicalCaseCount!==68 || prior.value.physical?.length!==68)
  throw Error('Authoritative 68-physical-case index mismatch; no new index may be sealed');
let oldArtifactCount=0;
const oldFailures=[];
for(const item of prior.value.physical){
  if(item.accepted!==true)oldFailures.push(item.caseId);
  for(const artifact of item.artifacts??[]){
    const target=path.join(repo,artifact.file);
    const actual=dataFile(target);
    if(actual.sha256!==artifact.sha256 || actual.bytes!==artifact.size)
      throw Error('Immutable physical evidence unexpectedly changed: '+artifact.file);
    oldArtifactCount++;
  }
}
const regression=readJson(path.join(audit,'regression-results.json'));
if(regression.value.totalOrderedGroups!==23 || regression.value.results?.length!==23)
  throw Error('All 23 ordered regression groups must be retained');
const sourceVerification=readJson(path.join(audit,'source-freeze-verification.json'));
if(sourceVerification.value.sourceCount!==18 ||
    sourceVerification.value.implementationFilesUnchangedSinceRegressionStart!==true ||
    sourceVerification.value.preRegressionHashManifestPhysicallyAvailable!==false)
  throw Error('Implementation source chronology evidence is missing or misclassified');
const regressionAttribution=readJson(path.join(audit,'regression-failure-attribution.json'));
const regressions=regression.value.results.map((row,i)=>({
  ...row,
  actualLog:dataFile(path.join(audit,`regression-${String(i+1).padStart(2,'0')}.log`)),
}));
const supplementaryRegressionLogs=fs.readdirSync(audit)
  .filter(leaf=>/\.log$/.test(leaf)&&!/^regression-\d{2}\.log$/.test(leaf))
  .sort().map(leaf=>dataFile(path.join(audit,leaf)));
const t15Required=[
  'production-before.json','production-after.json','production-comparison.json',
  'credential-manager-before.json','credential-manager-after.json','credential-manager-comparison.json',
  'credential-secret-v3-before.json','credential-secret-v3-after.json',
  'credential-secret-v3-comparison.json','scoped-t15-final-comparison.json',
  'os-post-run-isolation.json',
];
const t15Files=t15Required.map(leaf=>dataFile(path.join(t15,leaf)));
const scoped=readJson(path.join(t15,'scoped-t15-final-comparison.json')).value;
const os=readJson(path.join(t15,'os-post-run-isolation.json')).value;
const preservation=readJson(path.join(audit,'final-preservation-audit.json'));
const historicalIndexes=preservation.value.historicalIndexes??[];
const oldImmutablePass=historicalIndexes.every(v=>v.unchanged===true);
const currentCaseDirs=fs.readdirSync(cases,{withFileTypes:true})
  .filter(item=>item.isDirectory() && /^wry-20261121\d{9}-[a-f0-9]{12}$/.test(item.name))
  .filter(item=>item.name>='wry-20261121004900000-000000000000')
  .sort((a,b)=>a.name.localeCompare(b.name));
const physical=[];
const suspicious=[];
for(const item of currentCaseDirs){
  const dir=path.join(cases,item.name);
  if(fs.lstatSync(dir).isSymbolicLink())throw Error('Redirected physical case');
  const artifacts=[];
  for(const leaf of fs.readdirSync(dir)){ 
    const actual=path.join(dir,leaf),stat=fs.lstatSync(actual);
    if(stat.isSymbolicLink()){suspicious.push(item.name+'/'+leaf);continue;}
    if(stat.isFile())artifacts.push(dataFile(actual));
  }
  for(const leaf of ['data/terax-settings.json','data/.terax-settings.json.replaced-backup']){
    const actual=path.join(dir,leaf);
    if(fs.existsSync(actual))artifacts.push(dataFile(actual));
  }
  const report=path.join(dir,'renderer-report.json');
  const invariants=path.join(dir,'acceptance-invariants.json');
  const meta=path.join(dir,'run-metadata.json');
  const observed=fs.existsSync(report)?readJson(report).value:null;
  const inv=fs.existsSync(invariants)?readJson(invariants).value:null;
  const md=fs.existsSync(meta)?readJson(meta).value:null;
  physical.push({
    caseId:item.name,scenario:md?.scenario??observed?.scenario??null,
    runtimeScenario:md?.runtimeScenario??null,
    stage:md?.barrierStage??null,corruptionMode:md?.corruptionMode??null,
    accepted:inv?.allPassed===true && observed?.scenarioObservedByHost===true &&
      observed?.nativeRequestChecks?.pass===true,
    rawInvariantsPassed:inv?.allPassed??null,
    hostObserved:observed?.scenarioObservedByHost??null,
    rendererOutcome:observed?.renderer?.outcome??null,
    diagnostic:observed?.renderer?.error??null,
    failedInvariants:inv?.checks?.filter(x=>x.pass!==true).map(x=>x.name)??['invariants-unavailable'],
    artifactCount:artifacts.length,artifacts,
  });
}
if(suspicious.length)throw Error('Redirected case artifacts detected; do not seal');
// A failed case is evidence, not an opportunity to upgrade an earlier index.
const failures=physical.filter(item=>!item.accepted).map(item=>({
  caseId:item.caseId,scenario:item.scenario,diagnostic:item.diagnostic,
  failedInvariants:item.failedInvariants,
}));
const known={
  corruptionFiveNormalRestart:'PASS (five isolated original B03 cases, real Store Exit and separate Tauri restart)',
  corruptionAbnormalRestart:'PASS (separate original corruption case, process exit 188 and cold restart)',
  staleB03HistoricalReadback:'PASS (A ACK immutable history, genuine new B PID/epoch, A caller rejected)',
  staleNativeIdAndCancel:'REJECTED BY REQUEST/EPOCH FENCE',
  staleQualificationCompletion:'REJECTED BY REQUEST/EPOCH FENCE; historical committed does not grant B',
  independentLateCancellationAck:'DELIVERED AND SAFELY IGNORED after original caller terminal and registry drain',
  duplicateCompletion:'DELIVERED AND SAFELY IGNORED on original production Channel',
  cancellationVsTerminal:'PASS (both original terminal-delivery orderings)',
  nativeQuiescenceFailure:'PASS (original native lease held after actual Channel terminal; no B03, eventually drained)',
  ABCNativeRequestIsolation:'PASS (A/B/C unique simultaneous native requests, exact A cancel, B/C unaffected)',
  ABCCrossDeploymentAuthority:'NOT PROVEN: global native managed runtime owner is singleton; no concurrent deployment B and C',
  sameDeploymentContendingCAS:'STRUCTURAL EXCLUSION; one original qualification only; not two admitted CAS writers',
  sharedCorruptSettingsAuthority:'Global fail-closed gate, not per-deployment database; no parallel forensic persistence',
  postDeadlineUpstreamStream:'FAIL (three preserved attempts, no proven upstream late release after original aggregate timer)',
  postDeadlineUpstreamTerminal:'FAIL (same independent missing post-deadline release)',
};
const sourcePaths=[
  'src-tauri/src/modules/self_hosted_profiles.rs',
  'src-tauri/src/modules/managed_local_runtime.rs',
  'src-tauri/src/modules/net/inference/mod.rs',
  'src-tauri/src/modules/net/inference/tests.rs',
  'src-tauri/src/lib.rs',
  'src-tauri/src/modules/conversation_memory/fallback.rs',
  'src-tauri/src/modules/conversation_memory/target_context.rs',
  'src-tauri/src/modules/conversation_memory/custom_tools/execution.rs',
  'src-tauri/src/modules/conversation_memory/project/freshness/retrieval.rs',
  'src-tauri/src/modules/inference_probe/mod.rs',
  'src-tauri/src/modules/inference_probe/context.rs',
  'src-tauri/src/modules/remote_ssh/lifecycle.rs',
  'src-tauri/src/modules/remote_ssh/mod.rs',
  'src-tauri/examples/lm11_authenticated_webview_acceptance.rs',
  'src/modules/ai/lib/deploymentQualificationRuntime.ts',
  'src/modules/ai/lib/deploymentQualificationRuntime.test.ts',
  'scripts/lm11-authenticated-webview-acceptance.mjs',
  'scripts/lm11-final-defect-race-regressions.ps1',
  'scripts/lm11-final-defect-race-preservation.ps1',
  'scripts/lm11-final-defect-race-index.mjs',
  'docs/AGENT_ENGINEERING_STATE.md',
  'docs/LM11_LM15_LOCAL_MODEL_QUALIFICATION.md',
];
const index={
  schema:1,title:'LM11 Final B02/B03 Defect and Race Closure',
  sealedAtUtc:new Date().toISOString(),
  previousImmutableIndex:prior.proof,
  historical68PhysicalCases:prior.value.physical.length,
  historical68ArtifactHashesReverified:oldArtifactCount,
  historicalPhysicalFailedCasesPreserved:oldFailures,
  originalCasesNeverRewritten:true,
  rootCause:'tauri-plugin-store 2.4.3 cached terax-settings.json using native app.store readers then unconditionally saved cached JSON on RunEvent::Exit, overwriting intervening corrupt native qualification authority',
  fix:'Read existing locked native disk settings authority directly for every Rust reader; fail closed on malformed/inconsistent/missing unresolved authority before generic Store caching; preserve main-file priority over unusable backup; no parallel settings database or renderer ownership',
  additionalNativeQuiescenceFix:'One read-only exact request-ID quiescent IPC to existing InferenceState registry, checked twice before nativeQuiescent and before persistence; feature-only original Channel before delayed original Lease drop reproduced the false-pass defect then passed fail-closed',
  immutableSourceManifest:sourcePaths.map(file=>dataFile(path.join(repo,file))),
  acceptanceSemantics:known,
  sourceFreezeForOrderedRegressions:{
    all18ImplementationFilesModifiedBeforeFirstRegression:
      sourceVerification.value.implementationFilesUnchangedSinceRegressionStart,
    preRegressionHashManifestPhysicallyAvailable:false,
    chronologyLimitation:sourceVerification.value.limitation,
    documentationAndIndexCompletedAfterRegressions:true,
  },
  sourceVerification:sourceVerification.proof,
  originalAggregateBudgetMs:120000,
  aggregateWallDeadlineEnforcedFlagChanged:false,
  originalSpecificBoundaryCases:physical,
  freshPhysicalCount:physical.length,
  freshPhysicalPassedCount:physical.filter(x=>x.accepted).length,
  freshPhysicalFailureCount:failures.length,
  exploratoryFailuresNeverPromoted:failures,
  postdeadlineCaseDisposition:regression.value.postDeadlinePhysicalCase,
  regressionResults:regression.proof,
  regressionFailureAttribution:regressionAttribution.proof,
  regressionFailureInterpretation:regressionAttribution.value,
  regressions,
  separatelyExecutedCorrectlyParameterisedRegressionLogs:supplementaryRegressionLogs,
  t15Artifacts:t15Files,
  t15:{
    caseId:path.basename(t15),scoped9kObjectsUnchanged:scoped.productionObjectsUnchanged===true,
    beforeObjects:scoped.beforeObjects,afterObjects:scoped.afterObjects,
    credentialMetadata5Unchanged:scoped.scopedCredentialMetadataUnchanged===true,
    v3Secrets5Unchanged:scoped.scopedV3SecretsUnchanged===true,
    noOwnedResidue:os.noOwnedRuntimeOrListenerOrRegistration===true,
    authoritativeT15Pass:scoped.authoritativeT15Pass===true,
  },
  preservation:preservation.proof,
  preserved:preservation.value.preserved===true && oldImmutablePass,
  oldIndexSha256s:historicalIndexes,
  limitations:[
    'Three attempted original full 120s late upstream provider releases failed before late stream/terminal were emitted, so B02 late stream and terminal remain independently FAIL/unproven.',
    'A/B/C concurrently registered native requests passed, but independent managed deployment/runtime A/B/C could not be produced by singleton native RuntimeOwner. Shared corrupt authority intentionally fails all qualification closed.',
    'The implementation-source manifest was captured after the ordered regressions; NTFS last-write times of all 18 referenced implementation files predate group 1, but no independent pre-regression hash-seal artifact exists. Documentation/index-only updates came afterward.',
    'Accepted positive and negative original runtime cases use deterministic authenticated synthetic TCP/SSE; no GGUF inference or real model qualification.',
    'Original B01 ten-stage 120-second matrix deliberately NOT rerun. Previously accepted B01 synthetic-only boundary is inherited unchanged.',
    'Global credential enumeration beyond five attributable Clack/Terax targets is diagnostic, not an assertion about unrelated credential ownership.',
    'Wider TypeScript memory schema fixture failures are retained as unrelated failures, never converted to green.',
  ],
  classifications:{
    B01:'Accepted for tested Windows synthetic-production-path boundary',
    B02:'Partial',B03:'Partial',combined:'Partial',
    qualificationLabRunEnabled:false,
    eligibleForSeparateQualificationLabEnablementDecision:false,
  },
};
// An immutable evidence index must also seal *failed* T15/preservation outcomes
// if encountered, never silently decline to record them. The classifications
// are conservatively Partial and Lab Run remains disabled either way.
const bytes=Buffer.from(JSON.stringify(index,null,2)+'\n');
const fd=fs.openSync(indexFile,'wx',0o600);
try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
console.log(JSON.stringify({indexFile,sha256:sha(bytes),
  oldPhysicalCases:index.historical68PhysicalCases,oldArtifactHashes:oldArtifactCount,
  newPhysicalCases:index.freshPhysicalCount,newFails:failures.length,
  regressionGroups:regressions.length, classifications:index.classifications},null,2));
