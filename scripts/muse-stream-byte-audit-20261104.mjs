/** Read-only correlator: one terminated, pre-target-gated local Muse diagnostic.
 * No model calls, retries, process control or source edits; bounded metadata.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const owned = path.join(repo, "src-tauri/target/real-qwen-product/musestreambyte-20261104-01");
const remote = path.join(owned, "remote-evidence");
const output = path.join(owned, "byte-boundary-audit.json");
const raw = path => readFile(path);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const json = async p => JSON.parse((await raw(p)).toString("utf8"));
const lines = async p => (await raw(p)).toString("utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);
const ms = v => Number(v) / 1e6;
const gap = values => values.length < 2 ? null : values.slice(1).reduce((max, value, index) => Math.max(max, value - values[index]), 0);
const [summary, report, requests, receipts, relay, resources, settings] = await Promise.all([
  json(path.join(owned,"stream-diagnostic-1.summary.json")),
  json(path.join(owned,"stream-diagnostic-1.native-report.json")),
  lines(path.join(owned,"stream-diagnostic-1.requests.jsonl")),
  lines(path.join(owned,"stream-diagnostic-1.receive.jsonl")),
  lines(path.join(remote,"relay-bytes.jsonl")),
  lines(path.join(remote,"resources.jsonl")),
  json(path.join(owned,"data/terax-settings.json")),
]);
assert.equal(report.targetStarted, false);
assert.equal(report.outcome, "pre-target-blocked");
assert.equal(report.calibrationRequests, 5);
assert.equal(summary.targetRequests, 0);
assert.equal(summary.targetRequestId, null);
assert.equal(requests.length, 5);
assert.equal(receipts.length, 5);
assert.deepEqual(requests.map(r => r.numCtx),[4096,8192,16384,32768,49152]);
assert(requests.every(r => r.modelMatches && r.toolSchemas === 0 && r.numPredict === 32 && r.thinkKind === "absent"));
assert(receipts.every(r => r.httpStatus === 200 && !r.failureCode && r.lastRequestStage === "eof" &&
  r.events.some(e => e.kind === "provider-done") && r.events.some(e => e.kind === "eof")));
const profile = settings.selfHostedInference.profiles.find(x => x.transportModelId === "muse-glimmer:30b");
assert(profile?.contextCalibration?.attempts.length === 5);
const attempts = profile.contextCalibration.attempts.map(({context, loaded, outcome, finish, latencyMs}) =>
  ({context,loaded,outcome,finish,latencyMs}));
assert.deepEqual(attempts.map(x => x.outcome),["success","success","success","success","transient"]);

const connections = new Map();
for (const row of relay) {
  assert(Number.isSafeInteger(row.connection) && row.connection >= 0 && row.bytes >= 0);
  const id = row.connection;
  const data = connections.get(id) ?? {id, startUtcMs:ms(row.utc_ns), endUtcMs:ms(row.utc_ns),
    directions:{ "client-to-ollama": {reads:[], forwards:[], readBytes:0,forwardBytes:0},
      "ollama-to-client": {reads:[], forwards:[], readBytes:0,forwardBytes:0} },events:[],errors:[]};
  data.endUtcMs = ms(row.utc_ns);
  const direction = data.directions[row.direction];
  if (direction && row.event === "read") {direction.reads.push({at:ms(row.utc_ns),size:row.bytes});direction.readBytes += row.bytes;}
  if (direction && row.event === "forward") {direction.forwards.push({at:ms(row.utc_ns),size:row.bytes});direction.forwardBytes += row.bytes;}
  if (row.event === "socket-error") data.errors.push({direction:row.direction,kind:row.errorType,errno:row.errno});
  if (row.event === "read-eof" || row.event === "forward-half-close" || row.event === "closed")
    data.events.push({at:ms(row.utc_ns),direction:row.direction,event:row.event});
  connections.set(id,data);
}
const evaluated = [...connections.values()].filter(c=>c.id!==0).map(c => {
  const result = {id:c.id,startUtcMs:c.startUtcMs,endUtcMs:c.endUtcMs,directions:{},errors:c.errors,
    closed:c.events.some(e=>e.event==='closed')};
  for(const name of ["client-to-ollama","ollama-to-client"]){
    const d = c.directions[name];
    const reads = d.reads.map(e=>e.at),forwards=d.forwards.map(e=>e.at);
    result.directions[name]={readEvents:reads.length,forwardEvents:forwards.length,
      readBytes:d.readBytes,forwardedBytes:d.forwardBytes,forwardMatchesReads:d.readBytes===d.forwardBytes,
      firstReadUtcMs:reads[0]??null,lastReadUtcMs:reads.at(-1)??null,
      firstForwardUtcMs:forwards[0]??null,lastForwardUtcMs:forwards.at(-1)??null,
      maxReadGapMs:gap(reads),maxForwardGapMs:gap(forwards)};
  }
  return result;
});
assert(evaluated.every(c => c.directions["client-to-ollama"].forwardMatchesReads &&
  c.directions["ollama-to-client"].forwardMatchesReads), "Relay did not forward all bytes it read");

const native = receipts.map(receipt => {
  const req = requests.find(r=>r.requestId===receipt.requestId);
  const ev=receipt.events;
  const key=kind=>ev.find(e=>e.kind===kind)?.elapsedUs;
  const body=ev.filter(e=>e.kind==="body");
  const done=key("provider-done"),eof=key("eof");
  return {requestId:receipt.requestId,context:req.numCtx,output:req.numPredict,
    dispatchedUtcMs:req.at,sendAwaitMs:Math.round((key("send-await-start")??0)/1000),
    headerMs:Math.round((key("headers")??0)/1000),firstBodyMs:Math.round((body[0]?.elapsedUs??0)/1000),
    lastBodyMs:Math.round((body.at(-1)?.elapsedUs??0)/1000),doneMs:done===undefined?null:Math.round(done/1000),
    eofMs:eof===undefined?null:Math.round(eof/1000),
    bodyChunks:receipt.bodyChunks,bodyBytes:receipt.bodyBytes,bodyMaxInterReadGapMs:gap(body.map(e=>e.elapsedUs/1000)),
    httpStatus:receipt.httpStatus,droppedEvents:receipt.droppedEvents};
});
// Correlate via independently captured wall-clock time only. Never claim a
// direct request-ID join across SSH, remote relay and Ollama logs.
const mappings=native.map(n => {
  const candidates=evaluated.map(c=>({id:c.id,deltaMs:c.directions["client-to-ollama"].firstReadUtcMs-n.dispatchedUtcMs,
    cBytes:c.directions["client-to-ollama"].readBytes,oBytes:c.directions["ollama-to-client"].readBytes})).
    filter(c=>Number.isFinite(c.deltaMs)&&Math.abs(c.deltaMs)<3000).sort((a,b)=>Math.abs(a.deltaMs)-Math.abs(b.deltaMs));
  const nearest=candidates[0]??null;
  return {requestId:n.requestId,nearest,alternatives:candidates.slice(1,4),
    unambiguous:!!nearest && (candidates.length===1 || Math.abs(candidates[1].deltaMs)-Math.abs(nearest.deltaMs)>50)};
});

const validSamples=resources.filter(r=>r && r.ram && r.swap);
const gpu=validSamples.map(r=>r.gpu).filter(v=>typeof v==="string" && /^\s*\d+\s*,\s*\d+\s*,\s*\d+/.test(v))
  .map(v=>v.split(",").map(s=>Number(s.trim())));
const min=(items)=>items.length?Math.min(...items):null,max=items=>items.length?Math.max(...items):null;
const rr=(key)=>validSamples.map(s=>s.ram[key]).filter(Number.isFinite);
const sw=(key)=>validSamples.map(s=>s.swap[key]).filter(Number.isFinite);
const swapIn=sw("pswpin"),swapOut=sw("pswpout");
const traceBuffer=await raw(path.join(remote,"ollama-trace.log"));
const traceText=traceBuffer.toString("utf8");
const traceRows=traceText.split(/\r?\n/);
const schedule=traceRows.filter(s=>s.includes("after processing request finished event"));
const http=traceRows.filter(s=>s.includes('POST     "/api/chat"') || s.includes('POST "/api/chat"'));
const runner=traceRows.filter(s=>/\bn_gen\s*=\s*\d+/.test(s));
const providerErrors=traceRows.filter(s=>/level=(?:WARN|ERROR)|\bpanic\b|\bfatal\b/i.test(s));
const out={
  runId:"musestreambyte-20261104-01",startingHead:"425e0d9e58160d32a1bb8a3a009a30dcf02c27bc",
  classification:"LOCAL STREAM DELIVERY FAILURE UNRESOLVED",targetSent:false,targetId:null,
  model:"muse-glimmer:30b",digest:"de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1",
  nativeContextAttempts:native,calibration:{status:profile.contextCalibration.status,highest:profile.contextCalibration.highest,
    recordedFailure:profile.contextCalibration.failure,attempts,trustGate:report.gate},
  relay:{connections:evaluated.length,records:relay.length,allReadBytesForwarded:true,
    errors:evaluated.flatMap(c=>c.errors.map(e=>({connection:c.id,...e}))),
    totalClientToOllama:evaluated.reduce((n,c)=>n+c.directions["client-to-ollama"].readBytes,0),
    totalOllamaToClient:evaluated.reduce((n,c)=>n+c.directions["ollama-to-client"].readBytes,0),
    largestReadGapMs:max(evaluated.map(c=>c.directions["ollama-to-client"].maxReadGapMs).filter(Number.isFinite)),
    largestForwardGapMs:max(evaluated.map(c=>c.directions["ollama-to-client"].maxForwardGapMs).filter(Number.isFinite)),
    connectionSummaries:evaluated,mappings},
  largestNativeBodyGapMs:max(native.map(n=>n.bodyMaxInterReadGapMs).filter(Number.isFinite)),
  remoteTelemetry:{samples:resources.length,validSamples:validSamples.length,
    gpuSamples:gpu.length,maxGpuUtilizationPercent:max(gpu.map(a=>a[0])),maxVramMiB:max(gpu.map(a=>a[1])),
    minVramFreeMiB:min(gpu.map(a=>a[2])),minMemAvailableKiB:min(rr("MemAvailable")),
    minSwapFreeKiB:min(rr("SwapFree")),maxSwapUsedKiB:rr("SwapTotal").length&&rr("SwapFree").length?
      max(validSamples.map(r=>(r.ram.SwapTotal??0)-(r.ram.SwapFree??0))):null,
    swapInDelta:swapIn.length?swapIn.at(-1)-swapIn[0]:null,
    swapOutDelta:swapOut.length?swapOut.at(-1)-swapOut[0]:null},
  ollama:{ traceLines:traceRows.length,schedulerFinishedEvents:schedule.length,httpChatPosts:http.length,
    runnerGenerationTimingLines:runner.length,errorsWarnings:providerErrors.length },
  filesSha256:Object.fromEntries(await Promise.all(["relay-bytes.jsonl","resources.jsonl","ollama-trace.log"].map(async f=>
    [f,digest(await raw(path.join(remote,f)))]))),
  limitations:[
    "No long-stream target was emitted because production calibration failed at 49152 after native 200/done/EOF; no retry was authorized.",
    "Relay read and forward events are at user-space socket recv/send boundaries; not direct Ollama HTTP-writer syscall instrumentation.",
    "Relay-to-Clack and native-body timestamps from different clocks are only approximately correlated; HTTP transfer framing makes byte totals incomparable without parsing.",
    "The persisted ForgeBoard request-25 was not routed through this relay and its stopped boundary cannot be retroactively localized.",
  ],
};
await writeFile(output,JSON.stringify(out,null,2),{flag:"wx"});
console.log(JSON.stringify({classification:out.classification,calibration:out.calibration,
  native:native,relay:{connections:out.relay.connections,totalClientToOllama:out.relay.totalClientToOllama,
    totalOllamaToClient:out.relay.totalOllamaToClient,largestReadGapMs:out.relay.largestReadGapMs,
    largestForwardGapMs:out.relay.largestForwardGapMs,mappings:out.relay.mappings},
  largestNativeBodyGapMs:out.largestNativeBodyGapMs,remoteTelemetry:out.remoteTelemetry,
  ollama:out.ollama,sha256:digest(await raw(output))},null,2));
