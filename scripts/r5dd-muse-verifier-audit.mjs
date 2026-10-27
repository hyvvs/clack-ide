/** Offline, one-shot R5dd verifier trace cross-check. Never contacts Ollama,
 * starts Tauri, dispatches inference, or reads any operator profile. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(fileURLToPath(new URL("../", import.meta.url)),
  "src-tauri/target/real-qwen-product/museglimmer-r5dd-verifier-20261027-01");
const files = ["qualification-1.requests.jsonl", "qualification-1.receive.jsonl",
  "qualification-1.native-report.json", "qualification-1.verifier.json",
  "qualification-1.json", "data/terax-settings.json"];
const bytes = await Promise.all(files.map(file=>readFile(path.join(root,file))));
const hash = Object.fromEntries(files.map((name,i)=>[name,createHash("sha256").update(bytes[i]).digest("hex")]));
const json = i=>JSON.parse(bytes[i].toString("utf8"));
const lines = i=>bytes[i].toString("utf8").trim().split("\n").filter(Boolean).map(s=>JSON.parse(s));
const requests = lines(0), receives=lines(1), report=json(2), observer=json(3), runner=json(4);
const settings=json(5).selfHostedInference;
const model="muse-glimmer:30b";
const digest="de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1";
assert.equal(requests.length,5,"Four calibrations and one verifier; no alternate requests");
assert.equal(receives.length,5,"Exactly five native receive traces");
for(let i=0;i<requests.length;i++) {
  const item=requests[i], trace=receives[i];
  assert.equal(item.requestId,`inference-${i+1}`);
  assert.equal(trace.requestId,item.requestId);
  assert.equal(item.modelMatches,true);
  assert.equal(item.thinkKind,"absent");
  assert.equal(item.stream,true);
  assert.equal(trace.droppedEvents,0);
  assert.equal(trace.events.at(-1)?.kind,"completed");
  assert(trace.events.some(e=>e.kind==="provider-done"));
  assert(trace.events.some(e=>e.kind==="eof"));
  assert(!trace.events.some(e=>e.kind==="cancellation-observed" || e.kind==="ipc-rejected"));
  if(i<4) {
    assert.equal(item.numCtx,[4096,8192,16384,32768][i]);
    assert.equal(item.numPredict,32);
    assert.equal(item.toolSchemas,0);
  } else {
    assert.equal(item.numCtx,32768);
    assert.equal(item.numPredict,512);
    assert.equal(item.toolSchemas,1);
    assert.deepEqual(item.toolNames,["get_probe_value"]);
  }
}
assert.equal(report.ok,true);
assert.equal(report.missionStarted,false);
assert.equal(report.missionRequests,0);
assert.equal(runner.totalNativeDispatches,5);
assert.equal(runner.nativeExit.code,0);
assert.equal(observer.streams.length,5);
assert.equal(observer.success,true);
assert(observer.streams.every(s=>s.phase==="completed" && s.cancellation===null));
assert.deepEqual(report.calibrationGate.attempts.map(a=>[a.context,a.loaded,a.outcome]),
  [[4096,4096,"success"],[8192,8192,"success"],[16384,16384,"success"],[32768,32768,"success"]]);
for(const field of ["calibrationFresh","runtimeEpochMatches","loadedContextMatches","numericalRouteQualified"])
  assert.equal(report.calibrationGate[field],true);
for(const field of ["snapshotTrustedTarget","directTrustedTarget","budgetRuntimeTarget"])
  assert.equal(report.calibrationGate[field],32768);
const profile=settings.profiles.find(p=>p.transportModelId===model && p.modelRevision===digest);
assert(profile,"Persisted live Muse profile missing");
assert.equal(profile.contextCalibration.status,"verified");
assert.equal(profile.contextCalibration.highest,32768);
assert.equal(profile.contextCalibration.scope.runtimeEpoch,observer.runtimeEpoch);
const proofs=profile.agentToolTierProofs.filter(p=>p.context===32768 && !p.configuration);
assert.equal(proofs.length,1);
const proof=proofs[0];
assert.equal(proof.status,"verified");
assert.equal(proof.outcome,"native-call");
assert.equal(proof.calls,1);
assert.equal(proof.validArguments,true);
assert.equal(proof.finish,"tool-calls");
assert.equal(proof.scope.digest,digest);
assert.equal(proof.scope.providerVersion,"0.40.11");
assert.equal(proof.scope.runtimeEpoch,observer.runtimeEpoch);
assert(proof.proof.expiresAt>proof.proof.at);
assert.equal(report.exactTierProof.proofExpiresAt,proof.proof.expiresAt);
assert.equal(report.exactTierProof.runtimeEpoch,observer.runtimeEpoch);
const workspaceEntries=await readdir(path.join(root,"workspace"));
assert.deepEqual(workspaceEntries,[".git"],"No app source files must be generated");
let cancelIpc=false;
try { cancelIpc=(await readFile(path.join(root,"qualification-1.native-cancels.jsonl"))).length>0; }
catch(e){if(e.code!=="ENOENT")throw e;}
assert.equal(cancelIpc,false,"Unexpected explicit native cancel IPC");
const native=receives[4];
const events=native.events;
const one=kind=>{const matches=events.filter(e=>e.kind===kind);assert.equal(matches.length,1,kind);return matches[0].at;};
const forwarded=events.filter(e=>e.kind==="ipc-forwarded");
assert.equal(forwarded.length,native.bodyChunks);
const maxGap=Math.max(...forwarded.slice(1).map((e,i)=>e.at-forwarded[i].at));
const dispatch=one("dispatch"), first=events.find(e=>e.kind==="body").at,
  last=native.lastForwarded.at, providerDone=one("provider-done"), eof=one("eof"), completed=one("completed");
assert(dispatch<first && first<=last && last<=completed && providerDone<=eof && eof<=completed);
const summary={
  status:"PASS", model, digest, providerVersion:"0.40.11", runtimeEpoch:observer.runtimeEpoch,
  calibratedTiers:[4096,8192,16384,32768], trustedContext:32768,
  calibrationRequests:4, verifierRequests:1, agentRequests:0,
  verifierRequestId:requests[4].requestId, requestAt:requests[4].at,
  dispatchAt:dispatch, firstBodyAt:first, lastForwardedAt:last,
  providerDoneAt:providerDone, eofAt:eof, completedAt:completed,
  durationMs:completed-dispatch, bodyChunks:native.bodyChunks, bodyBytes:native.bodyBytes,
  maxForwardedGapMs:maxGap, droppedEvents:native.droppedEvents,
  sdkFinish:proof.finish, sdkCallAt:proof.callAt, verifiedAt:proof.completedAt,
  persistedProofId:proof.id, proofExpiresAt:proof.proof.expiresAt,
  cancellationOccurred:false, nativeCancelIpc:false, firstCause:null, providerRequestInFlightAtCancel:null,
  hostPid:runner.nativeExit.pid, hostExitCode:runner.nativeExit.code,
  appFilesCreated:0, sourceReceiptSha256:hash,
};
await writeFile(path.join(root,"qualification-1.offline-audit.json"),JSON.stringify(summary,null,2),{flag:"wx"});
console.log(JSON.stringify({...summary,sourceReceiptSha256:"[6 SHA-256 receipt hashes saved]"},null,2));
