/**
 * Normalize genuine isolated Wry case records into a narrow, non-secret
 * per-case manifest. Does not run acceptance, modify old cases, or infer PASS
 * from an adjacent native-only smoke test.
 *
 * Usage: node scripts/lm11-full-matrix-case-evidence.mjs
 *   <existing matrix-audit-* directory> <existing case-ids.json>
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const owner=fs.realpathSync.native(path.join(repo,'src-tauri','target',
  'lm11-b01-b03-authenticated-webview-20261119','cases'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function reject(message){ throw new Error('LM11 matrix normalization refused: '+message); }
if(process.argv.length!==4) reject('Need exact matrix audit and ID-list filenames');
const audit=fs.realpathSync.native(process.argv[2]);
if(path.dirname(audit).toLowerCase()!==owner.toLowerCase() ||
  !/^matrix-audit-\d{17}-[a-f0-9]{12}$/.test(path.basename(audit)))
  reject('Output must be under direct canonical matrix owner');
const caseFile=fs.realpathSync.native(process.argv[3]);
if(path.dirname(caseFile).toLowerCase()!==audit.toLowerCase() ||
  path.basename(caseFile)!=='case-ids.json') reject('Case ID list must belong to same audit');
const loadFile=(dir,name)=>{
  if(!/^[a-z0-9-]+\.(?:json|jsonl|log)$/.test(name))reject('Invalid leaf name');
  const filename=path.join(dir,name);
  try{
    if(fs.lstatSync(filename).isSymbolicLink() ||
      !fs.lstatSync(filename).isFile() ||
      fs.realpathSync.native(filename).toLowerCase()!==filename.toLowerCase())
      reject('Nonregular or redirected case artifact');
    return fs.readFileSync(filename);
  }catch(error){
    if(error?.code==='ENOENT')return null;
    throw error;
  }
};
const loadJson=(dir,name)=>{
  const bytes=loadFile(dir,name);
  return bytes?JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')):null;
};
const ids=JSON.parse(fs.readFileSync(caseFile,'utf8').replace(/^\uFEFF/,''));
if(!Array.isArray(ids)||!ids.length||ids.length>500||
  ids.some(x=>typeof x!=='string'||!/^wry-\d{17}-[a-f0-9]{12}$/.test(x))||
  new Set(ids).size!==ids.length)
  reject('Invalid, duplicate or excessive Wry case IDs');
const rows=ids.map(caseId=>{
  const dir=path.join(owner,caseId);
  if(fs.realpathSync.native(dir).toLowerCase()!==dir.toLowerCase()||
    fs.lstatSync(dir).isSymbolicLink())reject('Redirected Wry case');
  const meta=loadJson(dir,'run-metadata.json');
  const renderer=loadJson(dir,'renderer-report.json');
  const invariants=loadJson(dir,'acceptance-invariants.json');
  const observation=loadJson(dir,'barrier-stage-observation.json');
  const restart=loadJson(dir,'native-restart-report.json');
  const source=renderer?.renderer??null;
  const request=renderer?.nativeRequestChecks??null;
  const storage=loadJson(path.join(dir,'data'),'terax-settings.json');
  const receipts=storage?.selfHostedInference?.fabric?.qualificationReceipts??[];
  const ticketHashes=[...new Set(receipts
    .map(r=>r.qualificationCas?.operationId)
    .filter(x=>typeof x==='string'&&x.length>0).map(x=>sha(x)))];
  const uniqueReceiptKeys=new Set(receipts.map(r=>{
    const c=r.qualificationCas;
    return [r.capability,c?.nativeEpoch,c?.operationId,c?.phase].join('|');
  }));
  const counts=request?.counts??{};
  const service=loadFile(dir,'service-events.jsonl');
  let transportEvents=[];
  if(service){
    transportEvents=service.toString('utf8').trim().split('\n')
      .filter(Boolean).map(line=>JSON.parse(line));
  }
  const successfulPosts=transportEvents.filter(x=>
    x.route==='/v1/chat/completions'&&x.status===200).length;
  const idsSeen=[...new Set([
    ...(request?.streamIds??[]),
    ...(request?.cancelledIds??[]).map(x=>x.requestId),
    source?.native?.requestId,source?.native?.originalLm2fLate?.requestId,
    source?.native?.originalCrossChild?.exactOriginalRequestId,
    source?.native?.originalRuntimeFault?.exactOriginalRequestId,
  ].filter(x=>typeof x==='string'&&/^inference-\d+$/.test(x)))];
  const values=receipts.map(r=>({
    capability:r.capability??null,
    status:r.status??null,
    version:r.version??null,
    casPhase:r.qualificationCas?.phase??null,
  }));
  const caseEvidenceFiles=[
    'run-metadata.json','renderer-report.json','acceptance-invariants.json',
    'barrier-stage-armed.json','barrier-stage-hit.json','barrier-stage-release.json',
    'barrier-stage-observation.json','native-host.stderr.log',
    'native-restart-report.json','acceptance-restart-invariants.json'
  ].flatMap(file=>{
    const bytes=loadFile(dir,file);
    return bytes?[{file,sha256:sha(bytes),size:bytes.length}]:[];
  });
  const productionRunner=source?.native?.stageBarrier?.originalProductionRunner===true ||
    source?.native?.originalLm2fLate?.originalProductionRunner===true ||
    source?.native?.originalRuntimeFault?.originalProductionRunner===true ||
    (source?.outcome==='synthetic-chat-transport-only' &&
      source?.native?.receiptCount===4 && receipts.length===4 &&
      receipts.every(r=>r.version===2 && r.status==='verified' &&
        r.qualificationCas?.phase==='acknowledged'));
  const originalSession=observation?.sessionId??
    source?.native?.stageBarrier?.originalSessionId??
    source?.native?.originalRuntimeFault?.originalSessionId??source?.native?.sessionId;
  return {
    caseId,scenario:meta?.scenario??null,
    originalProductionRunner:productionRunner,
    directNativeOrAuxiliaryCase:meta?.scenario==='runtime-transport',
    nativePid:source?.native?.stageBarrier?.nativePid??
      source?.native?.bind?.pid??null,
    nativeEpoch:source?.native?.stageBarrier?.nativeEpoch??
      source?.native?.bind?.epoch??null,
    operationIdHashes:ticketHashes,
    originalQualificationSessionHash:typeof originalSession==='string'?
      sha(originalSession):null,
    deploymentIdentityHash:typeof meta?.digest==='string'?
      sha(meta.digest+':matrix-synthetic-deployment'):null,
    nativeRequestIds:idsSeen,
    aggregateDeadlineBudgetMs:observation?.originalAggregateBudgetMs??
      source?.native?.deadline?.originalAggregateBudgetMs??null,
    aggregateDeadlineStartUtc:null,
    aggregateDeadlineStartLimitation:'Original deadline start timestamp is not emitted by this physical host; elapsed is from original runner when available',
    aggregateDeadlineElapsedMs:observation?.originalElapsedMs??
      source?.native?.deadline?.realElapsedMs??null,
    exactBoundary:observation?.stage??meta?.deadlineStage??meta?.runtimeScenario??meta?.scenario??null,
    cancellationOrigins:[...new Set((request?.cancelledIds??[])
      .map(x=>x.origin).filter(x=>typeof x==='string'))],
    cancellationTimeMs:source?.native?.stageBarrier?.cancelledAtOperationElapsedMs??null,
    originalCancellationOrigin:source?.native?.stageBarrier?.originalCancellationReason??null,
    dispatch:{nativeOpens:request?.opens??null,nativeStreams:request?.streams??null,
      acceptedSyntheticPosts:successfulPosts},
    nativeStreamTerminal:{streamCount:request?.streams??null,
      originalTerminal:observation?.originalRunnerTerminal??null},
    quiescence:source?.native?.stageBarrier?.originalRunnerTerminal??null,
    evidenceResult:source?.outcome??null,
    casCounts:{
      begin:counts.self_hosted_profiles_qualification_begin??0,
      prepare:counts.self_hosted_profiles_qualification_prepare??0,
      acknowledge:counts.self_hosted_profiles_qualification_acknowledge??0,
      reconcile:counts.self_hosted_profiles_qualification_reconcile??0,
      readbackSnapshot:counts.self_hosted_profiles_snapshot??0
    },
    durableReceiptCount:receipts.length,
    durableReceiptMetadata:values,
    duplicateReceiptKeyCount:receipts.length-uniqueReceiptKeys.size,
    restartReconciliation:restart?.result?.Ok?.reconcile??null,
    rendererCallerOutcome:source?.outcome??null,
    originalCallerSucceeded:source?.outcome==='synthetic-chat-transport-only'||
      source?.outcome==='original-qualification-stage-reached-and-resumed',
    strictHostAllPassed:invariants?.allPassed===true,
    failedInvariants:(invariants?.checks??[])
      .filter(x=>x.pass!==true).map(x=>x.name),
    appDataContained:renderer?.appDataContained??null,
    caseEvidenceFiles,
    noRawCredentialsOrUserMessagesIncluded:true,
  };
});
const output=path.join(audit,'per-case-evidence.json');
const bytes=Buffer.from(JSON.stringify({schema:1,generatedUtc:new Date().toISOString(),
  scope:'isolated original Windows Wry cases and explicitly labelled auxiliary cases',
  exactCases:rows.length,caseRows:rows},null,2)+'\n');
const fd=fs.openSync(output,'wx',0o600);
try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
console.log(JSON.stringify({file:output,sha256:sha(bytes),cases:rows.length,
  passing:rows.filter(x=>x.strictHostAllPassed).length,
  failedOrUnverified:rows.filter(x=>!x.strictHostAllPassed).length},null,2));
