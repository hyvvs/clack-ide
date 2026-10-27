/** One-shot OFFLINE R5df audit: consumes saved redacted evidence only.
 * Never invokes Ollama, an Agent, the frozen app or the evaluator. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository=fileURLToPath(new URL("../",import.meta.url));
const root=path.join(repository,"src-tauri/target/real-qwen-product/museglimmer-r5df-notes-20261027-01");
const names=["mission-a-1.requests.jsonl","mission-a-1.receive.jsonl",
  "mission-a-1.client-stream.jsonl","mission-a-1.native-cancels.jsonl",
  "mission-a-1.cancellation-provenance.jsonl","mission-a-1.native-inspection.jsonl",
  "mission-a-1.jsonl","mission-a-1.native-report.json","mission-a-1.json",
  "data/terax-settings.json","data/terax-ai-sessions.json",
  "independent-evaluation.started","independent-evaluation.json"];
const bytes=await Promise.all(names.map(n=>readFile(path.join(root,n))));
const hashes=Object.fromEntries(names.map((n,i)=>[n,createHash("sha256").update(bytes[i]).digest("hex")]));
const json=i=>JSON.parse(bytes[i].toString("utf8"));
const jsonl=i=>bytes[i].toString("utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const requests=jsonl(0), receives=jsonl(1), client=jsonl(2), cancelIpc=jsonl(3), cancels=jsonl(4),
  inspections=jsonl(5), events=jsonl(6), report=json(7), runner=json(8),settings=json(9),sessions=json(10),evaluation=json(12);
const digest="de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1";
assert.equal(requests.length,8);assert.equal(runner.totalNativeDispatches,8);
assert.equal(receives.length,8);assert.equal(client.length,8);
assert.equal(runner.nativeExit.code,0);assert.equal(report.missionStarted,true);
assert.equal(report.calibrationGate.status,"verified");
assert.equal(report.calibrationGate.budgetRuntimeTarget,73728);
assert(report.calibrationGate.calibrationFresh && report.calibrationGate.runtimeEpochMatches &&
  report.calibrationGate.numericalRouteQualified && report.calibrationGate.loadedContextMatches);
const ladder=[4096,8192,16384,32768,49152,65536,73728];
assert.deepEqual(requests.slice(0,7).map(r=>[r.numCtx,r.numPredict,r.toolSchemas]),ladder.map(n=>[n,32,0]));
assert.deepEqual(requests[7].toolNames,["get_probe_value"]);
assert.deepEqual([requests[7].numCtx,requests[7].numPredict,requests[7].toolSchemas],[73728,512,1]);
assert(requests.every(r=>r.modelMatches===true && r.stream===true && r.thinkKind==="absent"));
assert.deepEqual(receives.map(r=>r.requestId),requests.map(r=>r.requestId));
for(const record of receives.slice(0,7)) {
  assert(record.events.some(e=>e.kind==="provider-done"));
  assert(record.events.some(e=>e.kind==="eof"));
  assert.equal(record.events.at(-1).kind,"completed");
  assert.equal(record.droppedEvents,0);
}
const verifier=receives[7];
assert.equal(verifier.requestId,"inference-8");
assert.equal(verifier.bodyChunks,451);assert.equal(verifier.bodyBytes,67871);
assert.equal(verifier.droppedEvents,0);
assert(!verifier.events.some(e=>e.kind==="provider-done" || e.kind==="eof"));
assert.equal(verifier.events.at(-1).kind,"cancellation-observed");
assert.deepEqual(cancelIpc.map(c=>[c.requestId,c.origin]),[["inference-8","sdk-stream-error"]]);
assert.equal(cancels.length,1);
assert.deepEqual(cancels[0],{
  requestId:"inference-8",at:1793140109997,source:"webview-cancel-ipc",
  reason:"sdk-stream-parser-failed",initiatingLayer:"ollama-sdk-stream-parser",
  category:"error-cleanup",providerRequestInFlight:true,hasStructuredFirstCause:true,
});
assert.deepEqual(client.map(c=>c.requestId),requests.map(r=>r.requestId));
assert(client.slice(0,7).every(c=>c.phase==="completed"));
assert.equal(client[7].phase,"cancelled");
const maxClient=client.reduce((best,c)=>c.maxGapMs>best.maxGapMs?c:best,client[0]);
const profile=settings.selfHostedInference.profiles.find(p=>p.transportModelId==="muse-glimmer:30b" && p.modelRevision===digest);
assert(profile);assert.equal(profile.contextCalibration.status,"verified");
assert.equal(profile.contextCalibration.highest,73728);
assert.deepEqual(profile.contextCalibration.attempts.map(a=>[a.requested,a.loaded,a.outcome]),ladder.map(n=>[n,n,"success"]));
const epoch=profile.contextCalibration.scope.runtimeEpoch;
assert.equal(profile.contextCalibration.scope.providerVersion,"0.40.11");
assert.equal(profile.toolVerification?.context,73728);
assert.equal(profile.toolVerification?.status,"incomplete");
assert.equal(profile.toolVerification?.outcome,"transport");
assert.equal(profile.toolVerification?.calls,0);
assert.equal(profile.toolVerification?.proof,null);
assert.equal(profile.toolVerification?.scope.runtimeEpoch,epoch);
const agent=sessions.sessions.find(s=>s.id==="real-mission-a");
assert.equal(agent?.run?.state,"failed");
assert.equal(agent.run.budget.totalSteps,0);
assert.match(agent.run.error?.details??"",/Agent tool verification: Incomplete/);
const tools=events.find(e=>e.kind==="agent-native-tool-summary")?.toolSummary;
assert.equal(tools?.calls,0);assert.deepEqual(tools?.byName,[]);
assert.equal(evaluation.verdict,"NOTES_APP_FAIL");assert.equal(evaluation.frozenSourceFiles.length,0);
assert.equal(evaluation.suite.testFiles.length,0);
assert.equal((await readdir(path.join(root,"workspace"))).filter(n=>n!==".git").length,0);
const result={
  classification:"INCONCLUSIVE_VERIFIER_CANCELLED_BEFORE_AGENT",
  qualification:"FAIL_INCOMPLETE_EXACT_TIER_TOOL_PROOF",
  model:"muse-glimmer:30b",digest,providerVersion:"0.40.11",runtimeEpoch:epoch,
  calibratedTiers:ladder,calibrationRequestedLoadedMatches:true,
  verifier:{requestId:"inference-8",context:73728,output:512,tool:"get_probe_value",
    status:"cancelled",nativeChunks:verifier.bodyChunks,nativeBytes:verifier.bodyBytes,
    droppedEvents:verifier.droppedEvents,providerDone:false,eof:false,
    durationMs:verifier.events.at(-1).at-verifier.events[0].at,
    firstCause:cancels[0]},
  clientVisibleStream:{receipts:client.length,maxGapMs:maxClient.maxGapMs,requestId:maxClient.requestId,
    measuredBoundaries:"WebView Channel headers/chunks/settled"},
  requestCount:requests.length,completedCalibrationStreams:7,agentGenerationCount:0,
  agentTools:{calls:0,names:[]},agentState:agent.run.state,
  staleRuntimeRefresh:"not-exercised-no-agent-generations",
  compactionBudget:"not-exercised-no-agent-generations",
  app:{verdict:evaluation.verdict,authoredSourceFiles:0,testFilesDiscovered:0,checks:evaluation.checks},
  nativeInspectionCounts:Object.fromEntries([...new Set(inspections.map(i=>i.command))].map(command=>
    [command,inspections.filter(i=>i.command===command).length])),
  protectedEvidenceSha256:hashes,
};
await writeFile(path.join(root,"mission-a-1.offline-audit.json"),JSON.stringify(result,null,2),{flag:"wx"});
console.log(JSON.stringify({classification:result.classification,qualification:result.qualification,
  calibratedTiers:ladder,agentGenerations:0,verifier:result.verifier,
  clientVisible:result.clientVisibleStream,appVerdict:evaluation.verdict},null,2));
