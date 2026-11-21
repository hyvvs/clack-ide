/** One exclusive, independently verifiable LM11 asynchronous closure index.
 * Never rewrites old evidence. Physical gaps and runner FAILs remain visible.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cases=fs.realpathSync.native(path.join(repo,
  'src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases'));
const [auditInput,t15Input]=process.argv.slice(2);
if(process.argv.length!==4)throw Error('Require new async audit and fresh T15 before/after directory');
function owned(input,prefix){
  const dir=fs.realpathSync.native(input);
  if(path.dirname(dir).toLowerCase()!==cases.toLowerCase()||
     !new RegExp(`^${prefix}-\\d{17}-[a-f0-9]{12}$`).test(path.basename(dir))||
     fs.lstatSync(dir).isSymbolicLink())throw Error('Unowned or redirected directory '+prefix);
  return dir;
}
const audit=owned(auditInput,'async-authority-audit');
const t15=owned(t15Input,'fidelity-audit');
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const rel=full=>{
  const value=path.relative(repo,full).replaceAll('\\','/');
  if(value.startsWith('../')||path.isAbsolute(value))throw Error('Path escaped repository');
  return value;
};
function artifact(full){
  const stat=fs.lstatSync(full);
  if(!stat.isFile()||stat.isSymbolicLink()||
     fs.realpathSync.native(full).toLowerCase()!==full.toLowerCase())
    throw Error('Evidence not an owned physical file '+rel(full));
  const bytes=fs.readFileSync(full);
  return {file:rel(full),size:bytes.length,sha256:sha(bytes)};
}
const read=full=>JSON.parse(fs.readFileSync(full,'utf8').replace(/^\uFEFF/,''));
const historical=[
  ['src-tauri/target/lm11-b03-native-acceptance-20261119-real-host/native-acceptance-85-invocations-20261119.json','c329ae36ad8255150ff0a46f71a03a64d0a6dec8283db392c6861668ddeef1a7'],
  ['src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases/index-20261119080122842-cf1e7d43238c/authenticated-webview-evidence-index.json','f8f7f1effc0681530941e3f2926248d65b642ef4db81618bf8a1d948adbcd74e'],
  ['src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases/index-20261120000845246-05cea9a2820e/lm11-fidelity-closure-evidence-index.json','cd5e2529b39acc542bc49b324decccf931b791dc31f4ed727bd29ea82c7507d1'],
  ['src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases/index-20261120030346856-e7fecf53ae5b/lm11-final-blocker-closure-evidence-index.json','8aa9c994fbea5355cf50e4bedf420e60cf60c2f2b477d8d3e5c85f28ea5cd8ee'],
  ['src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases/index-20261120061805173-887efb038e68/lm11-b01-b03-full-matrix-evidence-index.json','1de726b770192ba4b5f761a02a04283207b05e349e0a4efe8f3c51d5ecc304d4'],
  ['src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases/index-20261120075123305-aee54834a57c/lm11-b02-b03-final-acceptance-closure-evidence-index.json','7cb28af7338ea0d7cc6aeaccfb4cfe8d0105f6fcb515cadc46f6431f7c64be0b'],
].map(([file,expectedSha256])=>{
  const observed=artifact(path.join(repo,...file.split('/')));
  return {...observed,expectedSha256,preserved:observed.sha256===expectedSha256};
});
if(historical.some(row=>!row.preserved))throw Error('Sealed historical evidence mismatch');

const before=read(path.join(audit,'source-freeze-before.json'));
const after=read(path.join(audit,'source-freeze-after.json'));
if(after.unchangedSinceBefore!==true||
   JSON.stringify(before.sources)!==JSON.stringify(after.sources))
  throw Error('Post-freeze source bytes changed');
const results=read(path.join(audit,'regression-results.json'));
if(results.exactlyTwentyOneOrderedGroups!==true||results.groups?.length!==21||
   results.groups.some((v,i)=>v.ordinal!==i+1))
  throw Error('The exact twenty-one ordered regressions did not finish');
const regressions=results.groups.map(group=>({
  ...group,artifact:artifact(path.join(audit,group.log)),
}));
const failed=regressions.filter(group=>group.status!=='PASS');

const cutoff='wry-20261120092807385';
const physical=fs.readdirSync(cases,{withFileTypes:true})
  .filter(entry=>entry.isDirectory()&&/^wry-\d{17}-[a-f0-9]{12}$/.test(entry.name)&&
    entry.name>=cutoff)
  .sort((a,b)=>a.name.localeCompare(b.name))
  .map(entry=>{
    const dir=owned(path.join(cases,entry.name),'wry');
    const files=fs.readdirSync(dir,{withFileTypes:true})
      .filter(file=>file.isFile()).sort((a,b)=>a.name.localeCompare(b.name))
      .map(file=>artifact(path.join(dir,file.name)));
    const meta=read(path.join(dir,'run-metadata.json'));
    const check=path.join(dir,'acceptance-invariants.json');
    const inv=fs.existsSync(check)?read(check):null;
    const report=path.join(dir,'renderer-report.json');
    const observation=fs.existsSync(report)?read(report):null;
    const accepted=inv?.allPassed===true&&observation?.scenarioObservedByHost===true&&
      observation?.nativeRequestChecks?.pass!==false&&
      observation?.renderer?.outcome!=='blocked';
    return {caseId:entry.name,scenario:meta.scenario,
      runtimeScenario:meta.runtimeScenario,stage:meta.barrierStage,
      corruptionMode:observation?.renderer?.native?.stageBarrier?.corruptionMode??null,
      accepted,observedOutcome:observation?.renderer?.outcome??null,
      failedInvariants:inv?.checks?.filter(check=>!check.pass).map(check=>check.name)??['invariants-unavailable'],
      nativeRequestIds:observation?.nativeRequestChecks?.streamIds??[],
      actualNativeEpoch:observation?.renderer?.native?.stageBarrier?.nativeEpoch??null,
      artifactCount:files.length,artifacts:files};
  });
if(!physical.length)throw Error('No new physical case evidence in bounded audit');
const byId=new Map(physical.map(row=>[row.caseId,row]));
const strict=id=>byId.get(id)?.accepted===true;
const caseIds={
  t13:'wry-20261120102717805-50d081c432eb',
  admission:'wry-20261120102822427-8c326f04358f',
  preparation:'wry-20261120102852635-bf56c481d09e',
  registration:'wry-20261120102908625-3de8bc243632',
  stalePrepare:'wry-20261120103002397-d8fc446db7cc',
  staleAck:'wry-20261120103023483-427821d665df',
  corruptMalformed:'wry-20261120103046526-6d63e14f58cb',
  corruptInconsistent:'wry-20261120100724892-888a85fb4823',
  corruptMissing:'wry-20261120100739386-13521824c7e6',
  corruptRecovery:'wry-20261120100754076-ae2c0db283ce',
  corruptRestart:'wry-20261120103037820-cfc4bb1c92ee',
  requestAdmission:'wry-20261120105905164-d3d14b9aa6ef',
  nativeQuiescence:'wry-20261120105148181-5c877d482f5f',
  priorRendererClose:'wry-20261120073234976-38613e16f205',
};
for(const [name,id] of Object.entries(caseIds)){
  if(name==='priorRendererClose')continue;
  if(!byId.has(id))throw Error('Required new physical witness absent '+name);
}
const types=['DELIVERED AND SAFELY IGNORED','STRUCTURALLY DISPOSED',
  'REJECTED BY EPOCH/REQUEST FENCE','BLOCKED / UNOBSERVABLE'];
const raceNames=[
  'Late stream after cancellation','Late terminal after cancellation',
  'Late native cancellation ACK after caller settled',
  'Late stream after aggregate deadline','Late terminal after aggregate deadline',
  'Stale callback after genuine epoch change','Stale native ID after epoch change',
  'Stale cancellation after epoch change','Stale qualification completion after epoch change',
  'Duplicate completion callback','Cancellation versus terminal completion'];
const races=raceNames.map((name,i)=>({number:i+1,name,
  classification:i===0||i===1?types[0]:i===5?types[1]:types[3],
  owner:i===0||i===1?'Original Tauri Channel / proxyFetch cancellation fence':
    i===5?'Native child A Channel destroyed before B epoch':'Owner callback not independently verified',
  caseIds:i===0||i===1?[caseIds.t13]:[],
  accepted:i===0||i===1?strict(caseIds.t13):false,
  limits:i===0||i===1?'Exact post-cancel native Channel; not an external SSE parser or independent ACK':
    'Do not infer acceptance from adjacent tests or fabricated callbacks'}));

const freshT15Files=['production-before.json','production-after.json',
  'credential-manager-before.json','credential-manager-after.json',
  'credential-manager-comparison.json','credential-secret-v3-before.json',
  'credential-secret-v3-after.json','credential-secret-v3-comparison.json',
  'production-comparison.json','scoped-t15-final-comparison.json','os-post-run-isolation.json'];
const t15Artifacts=freshT15Files.map(leaf=>artifact(path.join(t15,leaf)));
const t15Comparison=read(path.join(t15,'scoped-t15-final-comparison.json'));
const os=read(path.join(t15,'os-post-run-isolation.json'));
const run=(cmd,args)=>execFileSync(cmd,args,{cwd:repo,encoding:'utf8'}).trim();
const stashes=run('git',['stash','list','--format=%H']).split(/\r?\n/);
const head=run('git',['rev-parse','HEAD']);
const branch=run('git',['branch','--show-current']);
const staged=run('git',['diff','--cached','--name-only']);
const indexSha=sha(fs.readFileSync(path.join(repo,'.git/index')));
const manifest=fs.readFileSync(path.join(repo,
  'src-tauri/target/lm2f-validation-20261117/reconstructed-protected-81.tsv'),'utf8').trim().split(/\r?\n/);
let protectedMismatches=0;
for(const line of manifest){
  const match=/^([^\t]+)\t([a-f0-9]{64})$/.exec(line);
  if(!match||match[1].includes('..')||path.isAbsolute(match[1]))
    throw Error('Malformed protected manifest');
  if(!fs.existsSync(path.join(repo,match[1]))||
    sha(fs.readFileSync(path.join(repo,match[1])))!==match[2])protectedMismatches++;
}
const preservation={branch,head,indexSha,stashes,stagedPaths:staged?staged.split(/\r?\n/):[],
  protectedLiteralCount:manifest.length,protectedLiteralMismatches:protectedMismatches,
  oldSixIndexHashesPreserved:historical.every(x=>x.preserved),
  autonomousTrackerUnchanged:run('git',['status','--short','--','autonomous_tracker'])==='',
  noForbiddenDebugOrTestTarget:['src-tauri/target/debug','src-tauri/target/codex-test']
    .every(leaf=>!fs.existsSync(path.join(repo,leaf))),
  gitDiffCheck: (()=>{try{run('git',['diff','--check']);return true;}catch{return false;}})(),
};
const preservationPassed=branch==='main'&&
  head==='50fca4689692bc1e85f9ffd4ae644ff528cc056e'&&
  indexSha==='5cd3574caaa8fc3ec4d01e79cbd8f6edb90573600df927e068a3d1b1c144f211'&&
  preservation.stagedPaths.length===0&&
  JSON.stringify(stashes)===JSON.stringify([
    '6a7bc6beef913a323052b277f766ae32be11bae1',
    'b96fc46d783f1635acec2278deed7b43479f5f9a'])&&
  manifest.length===81&&protectedMismatches===0&&
  preservation.oldSixIndexHashesPreserved&&
  preservation.autonomousTrackerUnchanged&&
  preservation.noForbiddenDebugOrTestTarget&&preservation.gitDiffCheck;
const result={
  schema:1,title:'LM11 B02/B03 Asynchronous + Persistence Authority Closure',
  createdAtUtc:new Date().toISOString(),isolatedAcceptanceRoot:rel(cases),
  earlierImmutableIndexes:historical,
  baselineT15Audit:rel(t15),t15Artifacts,
  t15:{authoritativePass:t15Comparison.authoritativeT15Pass,
    scopedObjectsBefore:t15Comparison.beforeObjects,scopedObjectsAfter:t15Comparison.afterObjects,
    changedObjects:t15Comparison.changedScopedObjects,
    fiveCredentialMetadataUnchanged:t15Comparison.scopedCredentialMetadataUnchanged,
    fiveV3SecretHashesUnchanged:t15Comparison.scopedV3SecretsUnchanged,
    osNoResidue:os.noResidue??os.noLiveOwnedResources??null},
  sourceFreeze:{before:artifact(path.join(audit,'source-freeze-before.json')),
    after:artifact(path.join(audit,'source-freeze-after.json')),
    frozen:after.unchangedSinceBefore,files:before.sources},
  regression:{exactOrder:true,groupCount:21,failedCount:failed.length,groups:regressions,
    failuresPreserved:failed.map(x=>x.ordinal)},
  physicalCaseCount:physical.length,physicalPassCount:physical.filter(x=>x.accepted).length,
  physicalFailedOrIncompleteCount:physical.filter(x=>!x.accepted).length,
  physical,
  t13:{historicalFailurePreserved:'wry-20261120074359484-d6332eeb7303',
    rootCause:'950 ms acceptance watchdog fired before authenticated POST/first genuine stream; no original late callback existed in failing run',
    freshPassCaseId:caseIds.t13,accepted:strict(caseIds.t13)},
  actualDelayedAdmission:{caseId:caseIds.admission,accepted:strict(caseIds.admission)},
  actualDelayedPreparation:{caseId:caseIds.preparation,accepted:strict(caseIds.preparation)},
  actualNativeRegistrationAfterCancel:{caseId:caseIds.registration,accepted:strict(caseIds.registration)},
  races,retainedRendererCloseTerminal:{caseId:caseIds.priorRendererClose,
    classification:'STRUCTURALLY DISPOSED',historicalAccepted:true},
  b03StaleEpoch:{caseIds:[caseIds.stalePrepare,caseIds.staleAck],
    bothOriginalPathAccepted:strict(caseIds.stalePrepare)&&strict(caseIds.staleAck),
    readbackIndependentLateAttemptNotYetProven:true},
  b03Corruption:{caseIds:[caseIds.corruptMalformed,caseIds.corruptInconsistent,
    caseIds.corruptMissing,caseIds.corruptRecovery,caseIds.corruptRestart],
    allOriginalPreparePathsAccepted:[caseIds.corruptMalformed,caseIds.corruptInconsistent,
      caseIds.corruptMissing,caseIds.corruptRecovery,caseIds.corruptRestart].every(strict),
    preservedForensicBeforeBytes:true,
    corruptAuthoritativeBytesSurviveHostExit:false,
    fullRecoveryPersistenceAuthorityAccepted:false},
  contention:{sameDeploymentSecondOriginalDenied:true,
    twoAdmittedSameDeploymentFlightsPreventedBySingleFlight:true,
    genuineTwoAdmittedCASNotManufactured:true},
  crossDeploymentCancellationAndCorruptionIsolation:'BLOCKED / UNOBSERVABLE',
  failureSemantics:{requestAdmissionCaseId:caseIds.requestAdmission,
    requestAdmissionAccepted:strict(caseIds.requestAdmission),
    quiescenceCaseId:caseIds.nativeQuiescence,
    quiescenceAccepted:strict(caseIds.nativeQuiescence),
    lateOriginalCancellationAck:'BLOCKED / UNOBSERVABLE'},
  knownUnrelatedTypeScript:'Three structured-memory, two preparation fixture and two Agent recovery failures need exact raw signature assessment; do not automatically relabel.',
  classifications:{B01:'Accepted for tested Windows synthetic-production-path boundary',
    B02:'Partial',B03:'Partial',combined:'Partial',qualificationLabRun:'disabled',
    eligibilityForSeparateLabDecision:'not established'},
  preservation:{...preservation,passed:preservationPassed},
  limitations:['No full B01 120-second matrix rerun','No GGUF weights loaded or real model inference',
    'Eleven independent late/race owners not all physically established',
    'Cross-deployment A/B/C cancellation/corruption isolation not physically established',
    'No Qualification Lab Run enablement or cross-platform claim',
    'Raw failed physical attempts and FAIL regressions retained without relabeling'],
};
const output=path.join(audit,'lm11-b02-b03-asynchronous-persistence-authority-closure-evidence-index.json');
const bytes=Buffer.from(JSON.stringify(result,null,2)+'\n');
const fd=fs.openSync(output,'wx',0o600);
try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
console.log(JSON.stringify({file:output,sha256:sha(bytes),physicalCases:physical.length,
  physicalFailed:result.physicalFailedOrIncompleteCount,regressionFailures:failed.length,
  t15Pass:t15Comparison.authoritativeT15Pass,preservationPassed}));
if(!t15Comparison.authoritativeT15Pass||!preservationPassed||failed.length)process.exitCode=1;
