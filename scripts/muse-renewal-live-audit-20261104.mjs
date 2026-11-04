/** Offline, read-only correlation of ONE finished Muse notes acceptance.
 * No inference, network requests, workspace writes or evaluator invocations.
 * Writes only newly named receipts in the exclusive ignored evidence root.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const root = path.join(repo, "src-tauri/target/real-qwen-product/muserenewalnotes-20261104-01");
const telemetry = path.join(repo, "src-tauri/target/real-qwen-product/muserenewalnotes-telemetry-20261104-01");
const read = (file) => readFile(path.join(root, file));
const lines = (text) => text.split(/\r?\n/).filter(Boolean);
const jsonl = async (file) => lines((await read(file)).toString("utf8")).map(JSON.parse);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const allowed = "de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1";
const readJson = async (file) => JSON.parse((await read(file)).toString("utf8"));
const [requests, receives, streams, trust, events, native, host, evaluation] = await Promise.all([
  jsonl("mission-a-1.requests.jsonl"), jsonl("mission-a-1.receive.jsonl"),
  jsonl("mission-a-1.client-stream.jsonl"), jsonl("mission-a-1.trust-timeline.jsonl"),
  jsonl("mission-a-1.jsonl"), readJson("mission-a-1.native-report.json"),
  readJson("mission-a-1.json"), readJson("independent-evaluation.json"),
]);
assert.equal(requests.length, 46);
assert.equal(receives.length, 46);
assert.equal(new Set(requests.map(r => r.requestId)).size, 46);
assert(requests.every(r => r.modelMatches && r.thinkKind === "absent"));
assert.equal(host.totalNativeDispatches, 46);
assert.equal(host.cloudInference, 0);
assert.equal(host.nativeExit.code, 0);
assert.equal(host.missionStarted, true);
assert.equal(evaluation.verdict, "NOTES_APP_PASS");
assert(Object.values(evaluation.checks).every(Boolean));
const failures = (events.filter(e => e.kind === "settled" && e.phase !== "completed"));
const toolSummary = events.filter(e => e.kind === "agent-native-tool-summary").at(-1)?.toolSummary ?? null;
const byReceive = new Map(receives.map(r => [r.requestId, r]));
const byStream = new Map(streams.map(s => [s.requestId, s]));
const sortedTrust = trust.toSorted((a,b) => a.at - b.at);
const traceBytes = await readFile(path.join(telemetry, "ollama-trace.raw.log"));
const resourceBytes = await readFile(path.join(telemetry, "resources-foreground.txt"));
const trace = lines(traceBytes.toString("utf8"));
const rawSamples = lines(resourceBytes.toString("utf8"));
const traceStats = {
  accessHttpChat200: trace.filter(line => /\[GIN\].*\|\s*200\s*\|.*POST\s+"\/api\/chat"/.test(line)).length,
  accessHttpChatOther: trace.filter(line => /\[GIN\].*POST\s+"\/api\/chat"/.test(line) &&
    !/\|\s*200\s*\|/.test(line)).length,
  schedulerIngress: trace.filter(line => line.includes("processing incoming request")).length,
  runnerCompletions: trace.filter(line => line.includes('msg="llama-server completion request"')).length,
  contextFinished: trace.filter(line => line.includes('msg="context for request finished"')).length,
  httpError: trace.filter(line => /level=(WARN|ERROR)(\s|$)/.test(line)).length,
  runnerStartLogLines: trace.filter(line => line.includes('msg="llama-server started in ')).length,
  llmStart: trace.filter(line => line.includes("launch_slot_")).length,
};
assert.equal(traceStats.accessHttpChat200, 46);
assert.equal(traceStats.runnerCompletions, 46);
assert.equal(traceStats.contextFinished, 46);

// Samples are complete only if both delimiters are present; never treat
// unfinished post-stop observations as quantitative evidence.
let pending = null;
const samples = [];
for (const line of rawSamples) {
  const start = line.match(/^SAMPLE_START sample=(\d+) unix_ms=(\d+)$/);
  if (start) { pending = { index:+start[1], at:+start[2] }; continue; }
  if (!pending) continue;
  const gpu = line.match(/^\d{4}\/\d{2}\/\d{2} .*?,\s*(\d+),\s*(\d+),\s*(\d+)$/);
  if (gpu) Object.assign(pending, { gpuPercent:+gpu[1], vramUsedMiB:+gpu[2], vramFreeMiB:+gpu[3] });
  const memory = line.match(/MemAvailable:=(\d+) kB.*SwapTotal:=(\d+) kB SwapFree:=(\d+) kB/);
  if (memory) Object.assign(pending, { memAvailableKiB:+memory[1],
    swapUsedKiB:+memory[2]-(+memory[3]) });
  const inPages = line.match(/^pswpin\s+(\d+)$/);
  if (inPages) pending.pswpin = +inPages[1];
  const outPages = line.match(/^pswpout\s+(\d+)$/);
  if (outPages) pending.pswpout = +outPages[1];
  const runner = line.match(/^RUNNER_PROCESS pid=(\d+) ppid=(\d+) user=(\S+) comm=(\S+) rss_kb=(\d+)$/);
  if (runner && runner[4] === "llama-server") {
    pending.runners ??= [];
    pending.runners.push({pid:+runner[1], parent:+runner[2], rssKiB:+runner[5]});
  }
  const end = line.match(/^SAMPLE_END unix_ms=(\d+)$/);
  if (end) {
    pending.endAt = +end[1];
    if (["gpuPercent","vramUsedMiB","vramFreeMiB","memAvailableKiB","swapUsedKiB","pswpin","pswpout"]
      .every(name => Number.isFinite(pending[name]))) samples.push(pending);
    pending = null;
  }
}
assert(samples.length > 100, "Insufficient complete resource observations");
const first = samples[0], last = samples.at(-1);
const peak = (key) => Math.max(...samples.map(s => s[key]));
const minimum = (key) => Math.min(...samples.map(s => s[key]));
const stats = {
  completeSamples: samples.length, firstAt:first.at, lastAt:last.endAt,
  maxGpuPercent: peak("gpuPercent"),
  maxVramUsedMiB: peak("vramUsedMiB"),
  minVramFreeMiB: minimum("vramFreeMiB"),
  minMemAvailableKiB: minimum("memAvailableKiB"),
  maxSwapUsedKiB: peak("swapUsedKiB"),
  swapUsedInitialKiB:first.swapUsedKiB, swapUsedFinalKiB:last.swapUsedKiB,
  pswpinInitial:first.pswpin,pswpinFinal:last.pswpin,
  pswpoutInitial:first.pswpout,pswpoutFinal:last.pswpout,
  runnerPids:[...new Set(samples.flatMap(s => (s.runners ?? []).map(p => p.pid)))].sort((a,b)=>a-b),
};
stats.swapNetUsedKiB = stats.swapUsedFinalKiB - stats.swapUsedInitialKiB;
stats.pswpinDelta = last.pswpin - first.pswpin;
stats.pswpoutDelta = last.pswpout - first.pswpout;

const calibrationIds = [...new Set(trust.map(s=>s.calibration?.id).filter(Boolean))];
assert.equal(calibrationIds.length, 2);
const calibration = calibrationIds.map(id => {
  const latest = trust.filter(t => t.calibration?.id === id).at(-1);
  return latest.calibration;
});
assert.equal(calibration[0].status, "verified");
assert.equal(calibration[0].highest, 73728);
assert.equal(calibration[1].status, "verified");
assert.equal(calibration[1].highest, 49152);
assert.equal(calibration[1].attempts.length, 1);
const agentRows = [];
const rows = requests.map((r) => {
  const recv = byReceive.get(r.requestId);
  assert(recv, "Missing native receive: " + r.requestId);
  const e = recv.events ?? [];
  const eventAt = (name) => e.find(x => x.kind === name)?.at ?? null;
  const send = eventAt("send-await-start");
  const headers = eventAt("headers");
  const firstBody = eventAt("first-body-chunk");
  const done = eventAt("provider-done");
  const eof = eventAt("eof");
  assert(send !== null && headers !== null && firstBody !== null &&
    done !== null && eof !== null && recv.httpStatus === 200 &&
    recv.lastRequestStage === "eof", "Uncompleted request: "+r.requestId);
  const stream = byStream.get(r.requestId);
  const active = samples.filter(s => s.at >= send - 2_500 && s.at <= eof + 2_500);
  // Approximate passive trust snapshot as seen at event time. NOT a saved
  // preflight IPC body or a claim of the returned runtime epoch.
  const checkpoint = sortedTrust.filter(t => t.at <= r.at).at(-1);
  const exactProof = checkpoint?.proofs?.find(p => p.context === r.numCtx && p.status === "verified");
  const allocation = checkpoint?.values?.["probe.runtimeAllocation"];
  const nativeTimes = e.filter(x => x.kind === "ipc-forwarded").map(x => x.at);
  const nativeGaps = [headers,...nativeTimes,eof].filter(Number.isFinite)
    .slice(1).map((t,i,a) => t-([headers,...nativeTimes,eof].filter(Number.isFinite)[i]));
  const row = {
    requestId:r.requestId, batch:r.agentBatch, at:r.at, context:r.numCtx,
    output:r.numPredict, schemas:r.toolSchemas, thinkKind:r.thinkKind,
    calibrationIdSampled:checkpoint?.calibration?.id ?? null,
    calibrationExpirySampled:checkpoint?.calibration?.expiresAt ?? null,
    proofIdSampled:exactProof?.id ?? null,
    proofExpirySampled:exactProof?.expiry ?? null,
    runtimeEpochSampled:checkpoint?.calibration?.runtimeEpoch ?? null,
    allocationAtSampled:allocation?.observedAt ?? null,
    loadedAllocationSampled:allocation?.value ?? null,
    trustSampleAgeMs:checkpoint ? r.at - checkpoint.at : null,
    dispatchAt:eventAt("dispatch"), sendAt:send, headersAt:headers,
    firstBodyAt:firstBody, providerDoneAt:done, eofAt:eof,
    sendToHeadersMs:headers-send, sendToEofMs:eof-send,
    headersToFirstBodyMs:firstBody-headers, chunks:recv.bodyChunks,
    droppedEvents:recv.droppedEvents,
    nativeMaxForwardedGapMs:Math.max(0,...nativeGaps),
    clientStreamGapMs:stream?.maxGapMs ?? null,
    clientStreamPhase:stream?.phase ?? null, httpStatus:recv.httpStatus,
    resourceSamples:active.length,
    windowGpuPeakPercent:active.length ? Math.max(...active.map(s=>s.gpuPercent)):null,
    windowVramPeakMiB:active.length ? Math.max(...active.map(s=>s.vramUsedMiB)):null,
    windowVramFreeMinMiB:active.length ? Math.min(...active.map(s=>s.vramFreeMiB)):null,
    windowMemAvailableMinKiB:active.length ? Math.min(...active.map(s=>s.memAvailableKiB)):null,
    windowSwapUsedDeltaKiB:active.length ? active.at(-1).swapUsedKiB-active[0].swapUsedKiB:null,
    windowPsWpoutDelta:active.length ? active.at(-1).pswpout-active[0].pswpout:null,
    windowRunners:[...new Set(active.flatMap(s => (s.runners ?? []).map(x => x.pid)))].join(";"),
  };
  if (r.agentBatch !== "not-agent") agentRows.push(row);
  return row;
});
assert.equal(agentRows.length, 35);
const long30 = agentRows.filter(r => r.sendToEofMs > 30_000);
const long60 = agentRows.filter(r => r.sendToEofMs > 60_000);
const longest = [...agentRows].sort((a,b)=>b.sendToEofMs-a.sendToEofMs)[0];
const largestGap = [...agentRows].sort((a,b)=>(b.clientStreamGapMs??0)-(a.clientStreamGapMs??0))[0];
const control = {
  head:"fe918e8569415e0b77f2c5e873d0e19554db3079",
  model:"muse-glimmer:30b",digest:allowed,
  actualRequests:requests.length,
  agentGenerations:agentRows.length,
  initialCalibrations:requests.filter(r => r.numPredict === 32).length-1,
  liveRenewalCalibrations:1,
  nativeToolVerifierRequests:requests.filter(r=>r.toolNames?.length === 1 && r.toolNames[0] === "get_probe_value").length,
  agentCountByBatch:Object.fromEntries([...new Set(agentRows.map(r=>r.batch))]
    .map(b=>[b,agentRows.filter(r=>r.batch===b).length])),
  calibration,
  expiryCrossed:agentRows.some(r => r.sendAt > calibration[0].expiresAt),
  renewalRequestId:requests.findLast(r=>r.numPredict===32 && r.numCtx===49152)?.requestId,
  toolProofBeforeAfter:trust.filter(t=>t.calibration?.id === calibrationIds[0]).at(-1)?.proofs?.find(p=>p.context===49152)?.id ===
    trust.filter(t=>t.calibration?.id === calibrationIds[1]).at(-1)?.proofs?.find(p=>p.context===49152)?.id,
  toolSummary,
  failures:failures.length,
  settledEventCounts:Object.fromEntries([...new Set(events.filter(e=>e.kind==="settled").map(e=>e.phase))]
    .map(phase=>[phase,events.filter(e=>e.kind==="settled" && e.phase===phase).length])),
  nativeCancelled:receives.filter(r => r.events?.some(e => e.kind === "cancellation-observed")).length,
  retryEvents:events.filter(e=>/retry|recover/i.test(e.kind)).map(e=>({kind:e.kind,at:e.at,requestId:e.requestId})),
  parserFinal:await readJson("mission-a-1.parser-final.json"),
  traceStats, resourceStats:stats,
  agentOver30s:long30.map(r=>r.requestId),agentOver60s:long60.map(r=>r.requestId),
  longestGeneration:{ requestId:longest.requestId,sendToEofMs:longest.sendToEofMs },
  largestClientGap:{ requestId:largestGap.requestId,maxGapMs:largestGap.clientStreamGapMs },
  terminalSessionState:host.sessions,
  evaluatorVerdict:evaluation.verdict,evaluatorChecks:evaluation.checks,
  immutableInputSHA256:Object.fromEntries(await Promise.all(
    ["mission-a-1.requests.jsonl","mission-a-1.receive.jsonl","mission-a-1.client-stream.jsonl",
      "mission-a-1.trust-timeline.jsonl","mission-a-1.jsonl","mission-a-1.native-report.json",
      "mission-a-1.json","independent-evaluation.json"].map(async f=>[f,digest(await read(f))]))),
  telemetrySHA256:{ "ollama-trace.raw.log":digest(traceBytes),
    "resources-foreground.txt":digest(resourceBytes) },
};
assert.equal(control.nativeToolVerifierRequests,3);
assert.equal(control.renewalRequestId,"inference-33");
assert.equal(control.expiryCrossed,true);
assert.equal(control.toolProofBeforeAfter,true);
assert.equal(control.traceStats.httpError,0);
assert.equal(control.nativeCancelled,0);
assert.equal(control.failures,0);
const out = path.join(root,"mission-a-1.correlated-audit.json");
const csvOut=path.join(repo,"docs/MUSE_LIVE_CALIBRATION_RENEWAL_NOTES_2026-11-04.requests.csv");
const csvFields = Object.keys(rows[0]).filter(k=>k!=="loadedAllocationSampled")
  .concat(["allocationHashSampled"]);
const csvValue = (v) => {
  if (v === undefined || v === null) return "";
  const s=String(v);
  return /[",\r\n]/.test(s) ? '"'+s.replaceAll('"','""')+'"' : s;
};
const csv = [
  csvFields.join(","),
  ...rows.map(r => csvFields.map(k =>
    csvValue(k==="allocationHashSampled" ?
      (r.loadedAllocationSampled ? digest(Buffer.from(String(r.loadedAllocationSampled))).slice(0,16):null) : r[k])
  ).join(",")),
].join("\n")+"\n";
await writeFile(out,JSON.stringify(control,null,2),{flag:"wx"});
await writeFile(csvOut,csv,{flag:"wx"});
console.log(JSON.stringify({
  result:"PASS",native:requests.length,agent:agentRows.length,
  contextCalibrations:control.initialCalibrations,
  nativeToolVerifiers:control.nativeToolVerifierRequests,
  renewal:control.renewalRequestId,
  long30:long30.map(r=>({id:r.requestId,ms:r.sendToEofMs,headersMs:r.sendToHeadersMs,
    clientGapMs:r.clientStreamGapMs})),
  long60:long60.map(r=>r.requestId),
  longest:control.longestGeneration,largestGap:control.largestClientGap,
  trace:traceStats,resource:stats,toolCount:toolSummary?.calls,
},null,2));
