/** OFFLINE, one-shot, content-free forensic reconciliation of R5di.
 * Does not start an Agent, evaluator, API, provider request or webview. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(fileURLToPath(new URL("../", import.meta.url)),
  "src-tauri/target/real-qwen-product/museglimmer-r5di-final-notes-20261028-01");
const names = ["mission-a-1.requests.jsonl","mission-a-1.receive.jsonl",
  "mission-a-1.client-stream.jsonl","mission-a-1.native-inspection.jsonl",
  "mission-a-1.cancellation-provenance.jsonl","mission-a-1.native-cancels.jsonl",
  "mission-a-1.jsonl","mission-a-1.parser-final.json","mission-a-1.json",
  "mission-a-1.native-report.json","data/terax-settings.json",
  "data/terax-ai-sessions.json","independent-evaluation.started",
  "independent-evaluation.json"];
const bytes = await Promise.all(names.map(n=>readFile(path.join(root,n))));
const hash = Object.fromEntries(names.map((n,i)=>[n,createHash("sha256").update(bytes[i]).digest("hex")]));
const json=i=>JSON.parse(bytes[i].toString("utf8"));
const jsonl=i=>bytes[i].toString("utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const requests=jsonl(0),receives=jsonl(1),client=jsonl(2),inspections=jsonl(3),
  cancellations=jsonl(4),cancelIpc=jsonl(5),events=jsonl(6),parser=json(7),
  runner=json(8),report=json(9),settings=json(10),sessions=json(11),evaluation=json(13);
const digest="de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1";
const ladder=[4096,8192,16384,32768,49152,65536,73728];
assert.equal(requests.length,30);assert.equal(receives.length,30);
assert.equal(runner.totalNativeDispatches,30);assert.equal(runner.nativeExit.code,0);
assert.equal(report.missionStarted,true);assert.equal(report.calibrationGate.status,"verified");
assert.deepEqual(report.calibrationGate.attempts.map(x=>[x.context,x.loaded,x.outcome]),
  ladder.map(x=>[x,x,"success"]));
assert.deepEqual(requests.slice(0,7).map(x=>[x.numCtx,x.numPredict,x.toolSchemas]),
  ladder.map(x=>[x,32,0]));
for(const [i,context] of [[7,73728],[8,32768],[26,49152]]) {
  const r=requests[i];assert.deepEqual([r.numCtx,r.numPredict,r.toolSchemas,r.agentBatch],
    [context,512,1,"not-agent"]);assert.deepEqual(r.toolNames,["get_probe_value"]);
}
assert(requests.every(x=>x.modelMatches&&x.stream&&x.thinkKind==="absent"));
assert.deepEqual(receives.map(x=>x.requestId),requests.map(x=>x.requestId));
const agent=requests.filter(x=>x.agentBatch!=="not-agent");
assert.equal(agent.length,20);assert.equal(agent.filter(x=>x.agentBatch==="logical-continuation").length,0);
assert(agent.every(x=>x.agentBatch==="initial-batch"&&x.numPredict===8192&&x.toolSchemas===18));
assert.deepEqual(agent.map(x=>x.numCtx),Array(17).fill(32768).concat(Array(3).fill(49152)));
const completed=receives.slice(0,-1);
assert(completed.every(r=>r.events.at(-1).kind==="completed" &&
  r.events.some(e=>e.kind==="provider-done") && r.events.some(e=>e.kind==="eof") &&
  r.droppedEvents===0));
const last=receives.at(-1);assert.equal(last.requestId,"inference-30");
assert.equal(last.bodyChunks,0);assert.equal(last.bodyBytes,0);
assert.equal(last.droppedEvents,0);assert.equal(last.events.at(-1).kind,"cancellation-observed");
assert(!last.events.some(e=>e.kind==="headers"||e.kind==="provider-done"||e.kind==="eof"));
assert.equal(cancellations.length,1);assert.equal(cancelIpc.length,1);
assert.deepEqual([cancelIpc[0].requestId,cancelIpc[0].origin],["inference-30","parent-signal"]);
assert.deepEqual([cancellations[0].requestId,cancellations[0].source,cancellations[0].reason,
  cancellations[0].initiatingLayer,cancellations[0].category,
  cancellations[0].providerRequestInFlight],
  ["inference-30","webview-cancel-ipc","parent-abort-signal","request-abort-signal","unknown",true]);
assert.equal(parser.installed,true);assert.equal(parser.failureCount,0);
assert.deepEqual(parser.stages,[]);
assert.equal(client.length,29);assert(!client.some(x=>x.requestId==="inference-30"));
assert(client.every(x=>x.phase==="completed"));
const maxClient=client.reduce((a,b)=>b.maxGapMs>a.maxGapMs?b:a,client[0]);
const model=settings.selfHostedInference.profiles.find(p=>p.transportModelId==="muse-glimmer:30b"&&p.modelRevision===digest);
assert(model);assert.equal(model.contextCalibration.status,"verified");
assert.equal(model.contextCalibration.highest,73728);
const epoch=model.contextCalibration.scope.runtimeEpoch;
assert.equal(model.contextCalibration.scope.providerVersion,"0.40.11");
const proofs=[model.toolVerification,...model.agentToolTierProofs].filter(p=>p&&[32768,49152,73728].includes(p.context));
for(const tier of [32768,49152,73728]){
  const tierProof=proofs.find(x=>x.context===tier&&x.status==="verified"&&x.outcome==="native-call");
  assert(tierProof,`Missing independent exact-tier native proof ${tier}`);
  assert.equal(tierProof.calls,1);assert.equal(tierProof.validArguments,true);
  assert.equal(tierProof.scope.runtimeEpoch,epoch);
  assert.equal(tierProof.scope.providerVersion,"0.40.11");
  assert.equal(tierProof.scope.digest,digest);
}
const session=sessions.sessions.find(x=>x.id==="real-mission-a")?.run;
assert.equal(session?.state,"failed");
assert.equal(session.error.errorCode,"overall-deadline");
assert.equal(session.stop.reason,"provider-retry-deadline");
assert.equal(session.stop.policy,"provider-recovery-120s");
assert.equal(session.budget.totalSteps,19);
assert.equal(session.budget.continuationCount,0);
const toolSummary=events.find(x=>x.kind==="agent-native-tool-summary")?.toolSummary;
assert.equal(toolSummary?.calls,19);
assert(toolSummary.byName.every(x=>x.states.every(state=>state==="output-available")));
const durations=receives.filter(r=>agent.some(a=>a.requestId===r.requestId)).map(r=>({
  requestId:r.requestId,durationMs:r.events.at(-1).at-r.events[0].at,
  completed:r.events.at(-1).kind==="completed",context:requests.find(x=>x.requestId===r.requestId).numCtx,
}));
const over30=durations.filter(x=>x.durationMs>30000),over60=durations.filter(x=>x.durationMs>60000);
assert.equal(over30.length,7);assert.equal(over60.length,2);
const refresh=over30.filter(x=>x.completed).map(x=>{
  const currentIndex=requests.findIndex(r=>r.requestId===x.requestId);
  const next=requests[currentIndex+1];
  const finish=receives[currentIndex].events.at(-1).at;
  const seen=inspections.filter(i=>i.at>=finish && next && i.at<=next.at);
  return {preceding:x.requestId,next:next?.requestId??null,
    providerInspections:seen.filter(i=>i.command==="self_hosted_probe").length,
    runtimeInspections:seen.filter(i=>i.command==="self_hosted_context_runtime").length,
    cacheInspections:seen.filter(i=>i.command==="self_hosted_probe_cache").length};
});
assert(refresh.every(x=>x.providerInspections>=1&&x.runtimeInspections>=1&&x.cacheInspections>=1));
assert.equal(evaluation.verdict,"NOTES_APP_FAIL");
assert.equal(evaluation.frozenSourceFiles.length,8);
assert.equal(evaluation.suite.testFiles.length,0);
assert.equal(evaluation.suite.npmTest.code,1);
assert.equal(evaluation.suite.typescript.code,0);
assert.equal(evaluation.suite.build.code,0);
const appChecks=Object.entries(evaluation.checks);
assert.equal(appChecks.length,17);
assert.equal(appChecks.filter(([,pass])=>pass).length,13);
const result={
  classification:"LOCAL_ACCEPTANCE_BLOCKED_BY_RUNTIME_RELIABILITY",genericClackDefectProven:false,
  qualification:"PASS",model:"muse-glimmer:30b",digest,providerVersion:"0.40.11",
  runtimeEpoch:epoch,calibratedTiers:ladder,requestedLoadedAgreement:true,
  exactTierProofs:proofs.map(p=>({context:p.context,status:p.status,outcome:p.outcome,
    calls:p.calls,validArguments:p.validArguments,scope:p.scope,expiresAt:p.proof?.expiresAt})),
  requests:{total:30,calibration:7,verifier:3,agent:20,agentCompleted:19,
    agentCancelled:1,initialBatch:20,logicalContinuation:0,
    contextProgression:[32768,49152],outputProgression:[8192],toolSchemas:18},
  agentTools:toolSummary,
  durations:{longest:durations.reduce((a,b)=>b.durationMs>a.durationMs?b:a,durations[0]),
    over30,over60,maxClientVisibleGap:{requestId:maxClient.requestId,ms:maxClient.maxGapMs},
    failedRequestNoResponseHeaders:true},
  refresh:{post30SecondCompletedBoundaries:refresh,
    nativeInspectionCounts:Object.fromEntries([...new Set(inspections.map(i=>i.command))].map(command=>
      [command,inspections.filter(i=>i.command===command).length])),
    individualProductionGuardBooleansLogged:false},
  cancellation:cancellations[0],nativeCancelOrigin:cancelIpc[0].origin,
  parser:{observerEnabled:true,failures:0},
  compactionProtectedBudgetError:false,agentState:session.state,
  stop:session.stop,error:session.error,
  app:{verdict:evaluation.verdict,checks:evaluation.checks,authoredFiles:evaluation.frozenSourceFiles.map(x=>x.file),
    authoredTests:0,npmTestExit:1,typescriptExit:0,buildExit:0},
  evidenceSha256:hash,
};
await writeFile(path.join(root,"mission-a-1.offline-audit.json"),JSON.stringify(result,null,2),{flag:"wx"});
console.log(JSON.stringify({classification:result.classification,qualification:result.qualification,
  agent:result.requests,tools:toolSummary.calls,longest:result.durations.longest,
  over30:over30.length,over60:over60.length,maxClientVisibleGap:result.durations.maxClientVisibleGap,
  cancel:result.cancellation,app:result.app.verdict,passedAppChecks:13},null,2));
