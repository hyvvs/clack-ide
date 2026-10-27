/** Offline-only R5de native/Agent chronology and provenance cross-check.
 * No model, provider connection, Agent, evaluator or application execution. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.join(fileURLToPath(new URL("../",import.meta.url)),
  "src-tauri/target/real-qwen-product/museglimmer-r5de-notes-20261027-01");
const names=["mission-a-1.requests.jsonl","mission-a-1.receive.jsonl",
  "mission-a-1.jsonl","mission-a-1.native-inspection.jsonl",
  "mission-a-1.native-cancels.jsonl","mission-a-1.json",
  "mission-a-1.native-report.json","data/terax-settings.json",
  "data/terax-ai-sessions.json","independent-evaluation.json"];
const buffers=await Promise.all(names.map(n=>readFile(path.join(root,n))));
const sourceHashes=Object.fromEntries(names.map((n,i)=>[n,createHash("sha256").update(buffers[i]).digest("hex")]));
const lines=i=>buffers[i].toString("utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const json=i=>JSON.parse(buffers[i].toString("utf8"));
const requests=lines(0),receives=lines(1),events=lines(2),inspections=lines(3),cancels=lines(4),
  runner=json(5),report=json(6),settings=json(7),sessions=json(8),evaluation=json(9);
const digest="de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1";
assert.equal(requests.length,35);
assert.equal(receives.length,34);
assert.equal(runner.totalNativeDispatches,35);
assert.equal(runner.nativeExit.code,0);
assert.equal(report.missionStarted,true);
assert.equal(report.calibrationGate.status,"verified");
assert.equal(report.calibrationGate.budgetRuntimeTarget,73728);
assert.equal(evaluation.verdict,"NOTES_APP_PASS");
assert.deepEqual(requests.slice(0,7).map(r=>[r.numCtx,r.numPredict,r.toolSchemas]),
  [4096,8192,16384,32768,49152,65536,73728].map(n=>[n,32,0]));
assert.deepEqual(requests.filter(r=>r.toolSchemas===1).map(r=>[r.requestId,r.numCtx,r.numPredict]),
  [["inference-8",73728,512],["inference-9",32768,512],["inference-25",49152,512]]);
assert(requests.every(r=>r.modelMatches && r.stream && r.thinkKind==="absent"));
const agentRequests=requests.filter(r=>r.toolSchemas>1);
assert.equal(agentRequests.length,25);
const byId=new Map(requests.map(r=>[r.requestId,r]));
const durations=[];
let forwardedGapMax=0,totalChunks=0,dropped=0;
for(const trace of receives){
  const request=byId.get(trace.requestId);
  assert(request,"Unaccounted native trace");
  assert.equal(trace.events.at(-1).kind,"completed",trace.requestId);
  assert(trace.events.some(e=>e.kind==="provider-done"),trace.requestId);
  assert(trace.events.some(e=>e.kind==="eof"),trace.requestId);
  assert(!trace.events.some(e=>e.kind.includes("cancel") || e.kind==="ipc-rejected"));
  assert.equal(trace.droppedEvents,0);
  const begin=trace.events.find(e=>e.kind==="dispatch")?.at;
  const end=trace.events.at(-1).at;
  assert(begin>0 && end>=begin);
  const fw=trace.events.filter(e=>e.kind==="ipc-forwarded");
  assert.equal(fw.length,trace.bodyChunks);
  const gap=Math.max(0,...fw.slice(1).map((e,i)=>e.at-fw[i].at));
  forwardedGapMax=Math.max(forwardedGapMax,gap);
  totalChunks+=trace.bodyChunks;
  dropped+=trace.droppedEvents;
  if(request.toolSchemas>1)durations.push({requestId:trace.requestId,
    context:request.numCtx,output:request.numPredict,durationMs:end-begin,
    maxForwardedGapMs:gap,chunks:trace.bodyChunks,
    providerDone:true,eof:true,status:"completed"});
}
assert.equal(durations.length,24);
assert.deepEqual(requests.at(-1).toolNames.length,14);
assert.equal(requests.at(-1).numPredict,6144);
assert.equal(requests.at(-1).numCtx,49152);
assert(!receives.some(x=>x.requestId==="inference-35"),"Host-rejected request should not have a native HTTP trace");
assert.deepEqual(cancels.map(x=>[x.requestId,x.origin]),[["inference-35","native-command-failure"]]);
assert.equal(cancels[0].at-requests.at(-1).at,4);
const profile=settings.selfHostedInference.profiles.find(p=>p.transportModelId==="muse-glimmer:30b" && p.modelRevision===digest);
assert(profile);
assert.equal(profile.contextCalibration.highest,73728);
assert.equal(profile.contextCalibration.status,"verified");
const epoch=profile.contextCalibration.scope.runtimeEpoch;
const proofs=[profile.toolVerification,...(profile.agentToolTierProofs??[])].filter(x=>x?.status==="verified");
assert.deepEqual(proofs.map(p=>p.context).sort((a,b)=>a-b),[32768,49152,73728]);
assert(proofs.every(p=>p.scope.runtimeEpoch===epoch && p.scope.digest===digest &&
  p.scope.providerVersion==="0.40.11" && p.outcome==="native-call" && p.calls===1 &&
  p.validArguments && p.proof?.expiresAt>runner.endedAt));
assert(profile.contextCalibration.expiresAt>runner.endedAt);
const session=sessions.sessions.find(s=>s.id==="real-mission-a");
assert.equal(session?.run?.state,"failed");
assert.equal(session.run.error?.requestId,"inference-35");
assert.equal(session.run.error?.errorCode,"native-transport");
const summaryEvent=events.find(e=>e.kind==="agent-native-tool-summary");
assert(summaryEvent && summaryEvent.toolSummary?.calls===24);
const long=durations.filter(d=>d.durationMs>30000),over60=durations.filter(d=>d.durationMs>60000);
const max=durations.reduce((a,b)=>!a || b.durationMs>a.durationMs?b:a,null);
const byCommand=Object.fromEntries([...new Set(inspections.map(x=>x.command))].map(c=>[c,inspections.filter(x=>x.command===c).length]));
const staleCorrelations=long.map(r=>{
  const recv=receives.find(x=>x.requestId===r.requestId);
  const end=recv.events.at(-1).at;
  const next=requests.find(x=>x.at>end);
  const probes=next?inspections.filter(x=>x.at>=end && x.at<=next.at):[];
  return {requestId:r.requestId,durationMs:r.durationMs,nextRequestId:next?.requestId??null,
    runtimeInspections:probes.filter(x=>x.command==="self_hosted_context_runtime").length,
    liveProviderProbes:probes.filter(x=>x.command==="self_hosted_probe").length};
});
const completedGeneration=durations.every(d=>d.status==="completed");
assert(completedGeneration);
const output={
  classification:"INCONCLUSIVE_ACCEPTANCE_HOST_WIRE_GUARD",
  appEvaluation:"NOTES_APP_PASS",finalAgentState:"failed",
  model:"muse-glimmer:30b",digest,providerVersion:"0.40.11",runtimeEpoch:epoch,
  calibratedTiers:report.calibrationGate.attempts.map(a=>({context:a.context,loaded:a.loaded,status:a.outcome})),
  proofs:proofs.map(p=>({id:p.id,context:p.context,status:p.status,outcome:p.outcome,
    calls:p.calls,validArguments:p.validArguments,proofExpiresAt:p.proof.expiresAt,
    runtimeEpoch:p.scope.runtimeEpoch})),
  requestTotal:requests.length,receivedCompleted:receives.length,
  agentGenerationCompleted:durations.length,hostRejectedRequest:requests.at(-1),
  agentContextProgression:[32768,49152],agentOutput:8192,
  agentToolCalls:summaryEvent.toolSummary,
  longestAgentRequest:max,requestsOver30Seconds:long.length,requestsOver60Seconds:over60.length,
  over60RequestIds:over60.map(x=>x.requestId),allLongRequestsCompleted:true,
  maxObservedNativeForwardedGapMs:forwardedGapMax,
  maxExactClientVisibleGapMs:null, // No WebView per-chunk clock samples persisted.
  nativeBodyChunks:totalChunks,nativeTraceDroppedEvents:dropped,
  nativeMetadataInspections:byCommand,staleRuntimeNextBoundaryCorrelations:staleCorrelations,
  cancellations:{nativeSettledCancelled:0,preDispatchCancelIpc:cancels[0],
    registeredFirstCauseOnSettled:null,
    derivedFromCode:{source:"webview-cancel-ipc",reason:"native-command-rejected",
      initiatingLayer:"native-command-invocation",category:"error-cleanup",
      providerRequestInFlight:false},
    classification:"acceptance-host-ipc-rejection-followed-by-frontend-cleanup"},
  compactionProtectedBudgetError:false,
  finalRunError:{errorCode:session.run.error.errorCode,requestId:session.run.error.requestId,
    disposition:session.run.error.disposition,retryable:session.run.error.retryable},
  sourceHashes,
};
await writeFile(path.join(root,"mission-a-1.offline-audit.json"),JSON.stringify(output,null,2),{flag:"wx"});
console.log(JSON.stringify({...output,sourceHashes:"[10 SHA256 hashes saved]",staleRuntimeNextBoundaryCorrelations:"[saved]"},null,2));
