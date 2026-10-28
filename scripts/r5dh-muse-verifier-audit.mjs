/** One-shot OFFLINE audit. Reads saved redacted verifier evidence only.
 * No Ollama HTTP, model inference, WebView, backend or Agent launch. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.join(fileURLToPath(new URL("../",import.meta.url)),
  "src-tauri/target/real-qwen-product/museglimmer-r5dh-verifier-20261028-01");
const names=["qualification-1.requests.jsonl","qualification-1.receive.jsonl",
  "qualification-1.native-report.json","qualification-1.verifier.json",
  "qualification-1.parser-failures.json","qualification-1.json",
  "data/terax-settings.json"];
const bytes=await Promise.all(names.map(n=>readFile(path.join(root,n))));
const hashes=Object.fromEntries(names.map((n,i)=>[n,createHash("sha256").update(bytes[i]).digest("hex")]));
const json=i=>JSON.parse(bytes[i].toString("utf8"));
const jsonl=i=>bytes[i].toString("utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const requests=jsonl(0),receives=jsonl(1),report=json(2),observer=json(3),parsers=json(4),runner=json(5);
const settings=json(6).selfHostedInference;
const model="muse-glimmer:30b",digest="de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1";
const ladder=[4096,8192,16384,32768,49152,65536,73728];
assert.equal(requests.length,8);assert.equal(receives.length,8);
assert.equal(runner.totalNativeDispatches,8);assert.equal(runner.resultOk,true);
assert.equal(runner.nativeExit.code,0);assert.equal(report.missionStarted,false);
assert.equal(report.missionRequests,0);assert.equal(report.calibrationRequests,7);
assert.deepEqual(requests.map(x=>x.requestId),ladder.map((_,i)=>`inference-${i+1}`).concat("inference-8"));
assert.deepEqual(requests.slice(0,7).map(x=>[x.numCtx,x.numPredict,x.toolSchemas]),
  ladder.map(ctx=>[ctx,32,0]));
assert.deepEqual([requests[7].numCtx,requests[7].numPredict,requests[7].toolSchemas],
  [73728,512,1]);
assert.deepEqual(requests[7].toolNames,["get_probe_value"]);
assert(requests.every(x=>x.modelMatches&&x.stream&&x.thinkKind==="absent"));
assert.deepEqual(receives.map(x=>x.requestId),requests.map(x=>x.requestId));
for(const trace of receives){
  assert.equal(trace.droppedEvents,0);
  assert.equal(trace.events.filter(e=>e.kind==="provider-done").length,1);
  assert.equal(trace.events.filter(e=>e.kind==="eof").length,1);
  assert.equal(trace.events[trace.events.length-1].kind,"completed");
  assert(!trace.events.some(e=>e.kind==="cancellation-observed"||e.kind==="ipc-rejected"));
}
assert.equal(observer.success,true);assert.equal(observer.errorKind,"none");
assert.equal(observer.streams.length,8);
assert(observer.streams.every(s=>s.phase==="completed"&&s.cancellation===null));
assert.equal(parsers.installed,true);
assert.deepEqual(parsers.failures,[]);
assert.deepEqual(report.calibrationGate.attempts.map(a=>[a.context,a.loaded,a.outcome]),
  ladder.map(n=>[n,n,"success"]));
for(const key of ["calibrationFresh","runtimeEpochMatches","loadedContextMatches","numericalRouteQualified"])
  assert.equal(report.calibrationGate[key],true);
for(const key of ["snapshotTrustedTarget","directTrustedTarget","budgetRuntimeTarget"])
  assert.equal(report.calibrationGate[key],73728);
const profile=settings.profiles.find(p=>p.transportModelId===model&&p.modelRevision===digest);
assert(profile);assert.equal(profile.contextCalibration?.status,"verified");
assert.equal(profile.contextCalibration?.highest,73728);
const epoch=profile.contextCalibration.scope.runtimeEpoch;
assert.equal(observer.runtimeEpoch,epoch);
const proofs=profile.agentToolTierProofs.filter(p=>p.context===73728&&p.configuration===undefined);
assert.equal(proofs.length,1);
const proof=proofs[0];
assert.equal(proof.status,"verified");assert.equal(proof.outcome,"native-call");
assert.equal(proof.calls,1);assert.equal(proof.validArguments,true);
assert.equal(proof.finish,"tool-calls");assert.equal(proof.scope.digest,digest);
assert.equal(proof.scope.providerVersion,"0.40.11");assert.equal(proof.scope.runtimeEpoch,epoch);
assert(proof.proof?.expiresAt>proof.proof?.at);
assert.equal(report.exactTierProof?.proofExpiresAt,proof.proof.expiresAt);
assert.deepEqual(await readdir(path.join(root,"workspace")),[".git"]);
let cancelExists=false;
try{cancelExists=(await readFile(path.join(root,"qualification-1.native-cancels.jsonl"))).length>0}
catch(e){if(e.code!=="ENOENT")throw e}
assert.equal(cancelExists,false);
const native=receives[7],events=native.events,one=kind=>{
  const v=events.filter(e=>e.kind===kind);assert.equal(v.length,1);return v[0].at;
};
const forwarded=events.filter(e=>e.kind==="ipc-forwarded");
assert.equal(forwarded.length,native.bodyChunks);
const gap=Math.max(...forwarded.slice(1).map((e,i)=>e.at-forwarded[i].at));
const result={classification:"73K_VERIFIER_PASS_PRIOR_PARSER_FAILURE_UNREPRODUCED",
  model,digest,providerVersion:"0.40.11",runtimeEpoch:epoch,
  calibratedTiers:ladder,calibrationRequestedLoadedMatches:true,
  verifier:{requestId:"inference-8",context:73728,output:512,
    tool:"get_probe_value",proofId:proof.id,toolCalls:1,validArguments:true,
    finish:proof.finish,proofExpiresAt:proof.proof.expiresAt,
    dispatchAt:one("dispatch"),firstBodyAt:events.find(e=>e.kind==="body").at,
    providerDoneAt:one("provider-done"),eofAt:one("eof"),completedAt:one("completed"),
    durationMs:one("completed")-one("dispatch"),
    chunks:native.bodyChunks,bytes:native.bodyBytes,maxNativeGapMs:gap,droppedEvents:0},
  browser:{maxObservedAdjacentChunkGapMs:Math.max(...observer.streams.map(s=>s.maxGapMs)),
    verifierGapMs:observer.streams[7].maxGapMs},
  parser:{observerEnabled:true,completionScannerExceptions:0,nativeAdapterExceptions:0,
    completionInferredFromValidSDKProof:true,perStageSuccessCountersRecorded:false},
  cancellation:null,agentRequests:0,appFilesCreated:0,
  receiptsSha256:hashes};
await writeFile(path.join(root,"qualification-1.offline-audit.json"),JSON.stringify(result,null,2),{flag:"wx"});
console.log(JSON.stringify({...result,receiptsSha256:"[seven SHA-256 hashes persisted]"},null,2));
