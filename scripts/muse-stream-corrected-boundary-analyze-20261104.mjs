/** OFFLINE four-layer byte/progress correlator for the ONE corrected Muse target.
 * Reads stored native debug stamps, remote raw socket lengths (no content),
 * per-process resource samples and Ollama TRACE. Does not launch any model.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(fileURLToPath(new URL('../', import.meta.url)),
  'src-tauri/target/real-qwen-product/musestreambyte-20261104-02');
const data = path.join(root, 'remote-evidence');
const sha = buffer => createHash('sha256').update(buffer).digest('hex');
const json = async p => JSON.parse(await readFile(p,'utf8'));
const rows = async p => (await readFile(p,'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);
const maxGap = values => values.length < 2 ? null : values.slice(1).reduce((n,v,i)=>Math.max(n,v-values[i]),0);
const max = values => values.length ? Math.max(...values) : null;
const min = values => values.length ? Math.min(...values) : null;
const tag = x => x && typeof x === 'object' && !Array.isArray(x);
const ms = n => Number(n)/1000000;

const [report, requests, receives, events, relay, resources, traceBytes, tunnel] = await Promise.all([
  json(path.join(root,'stream-diagnostic-1.native-report.json')),
  rows(path.join(root,'stream-diagnostic-1.requests.jsonl')),
  rows(path.join(root,'stream-diagnostic-1.receive.jsonl')),
  rows(path.join(root,'stream-diagnostic-1.native-events.jsonl')),
  rows(path.join(data,'relay-bytes.jsonl')),
  rows(path.join(data,'resources.jsonl')),
  readFile(path.join(data,'ollama-trace.log')),
  json(path.join(root,'diagnostic-tunnel.json')),
]);
assert.equal(report.cloudInference,0);
assert(requests.every(r=>r.modelMatches===true && r.thinkKind==='absent'));
const long = requests.filter(r=>r.numPredict===8192 && r.toolSchemas===0);
assert(long.length <= 1,'Only one long target permitted');
const target = long[0] ?? null;
const targetId = target?.requestId ?? null;
const targetNative = targetId ? receives.find(r=>r.requestId===targetId) ?? null : null;
const filtered = targetId ? events.filter(e=>e.requestId===targetId && tag(e.event)).map(e=>e.event) : [];
const kinds = key => filtered.filter(e=>e.kind===key);
const bodies=kinds('body');
const meaningful=kinds('meaningful-progress');
const progressSequence=new Set(meaningful.map(e=>e.sequence));
assert(progressSequence.size===meaningful.length,'One semantic-progress record per body seq');
assert(bodies.every((e,i)=>e.sequence===i+1),'Live native Body sequence is incomplete');
const progressStamps=new Map(meaningful.map(e=>[e.sequence,e]));
const fullTimeline = bodies.map(b=>({
  seq:b.sequence,atEpochMs:b.at,elapsedUs:b.elapsedUs,bytes:b.bytes,
  feedTrue:progressSequence.has(b.sequence),
  idleDeadlineReset:progressSequence.has(b.sequence),
  idleDeadlineNewAtElapsedUs:progressSequence.has(b.sequence)?
    progressStamps.get(b.sequence).elapsedUs+180000000:null,
}));
const trueCount=fullTimeline.filter(e=>e.feedTrue).length;
const falseCount=fullTimeline.length-trueCount;
assert.equal(trueCount,meaningful.length);
if(targetNative){
  assert.equal(targetNative.bodyChunks,bodies.length,'Live event/body summary conflict');
  assert.equal(targetNative.bodyBytes,bodies.reduce((n,e)=>n+e.bytes,0));
  // Snapshot carries a fixed MAX_EVENTS=8192 ring; a ten-minute run normally
  // evicts older snapshot events. The separate event-by-event live JSONL is
  // complete (asserted sequential above) and must be the timeline source.
  assert(targetNative.droppedEvents>=0);
}

// Extract persistent connection-specific monotonic timing. HTTP contents are
// intentionally absent from remote relay logs and from this report.
const sockets = new Map();
const counter = () => ({reads:[],forwards:[],readBytes:0,forwardBytes:0});
for (const e of relay){
  const id=e.connection;
  const c=sockets.get(id)??{id,startUtcMs:ms(e.utc_ns),endUtcMs:ms(e.utc_ns),
    accepted:false,rejected:false,closed:false,errors:[],
    c2o:counter(),o2c:counter()};
  c.endUtcMs=ms(e.utc_ns);
  if(e.event==='accepted')c.accepted=true;
  if(e.event==='rejected')c.rejected=true;
  if(e.event==='closed')c.closed=true;
  if(['socket-error','upstream-error'].includes(e.event))c.errors.push({direction:e.direction,code:e.errno??null,type:e.errorType??null});
  const targetDirection=e.direction==='client-to-ollama'?c.c2o:e.direction==='ollama-to-client'?c.o2c:null;
  if(targetDirection && e.event==='read'){
    targetDirection.readBytes+=e.bytes;
    targetDirection.reads.push({monoMs:ms(e.mono_ns),epochMs:ms(e.utc_ns),bytes:e.bytes});
  }
  if(targetDirection && e.event==='forward'){
    targetDirection.forwardBytes+=e.bytes;
    targetDirection.forwards.push({monoMs:ms(e.mono_ns),epochMs:ms(e.utc_ns),bytes:e.bytes});
  }
  sockets.set(id,c);
}
const served=[...sockets.values()].filter(c=>c.accepted);
const rejected=[...sockets.values()].filter(c=>c.rejected);
const responseCandidate=target? served.filter(c=>c.c2o.reads.length &&
  Math.abs(c.c2o.reads[0].epochMs-target.at)<5000)
  .sort((a,b)=>b.o2c.readBytes-a.o2c.readBytes)[0]??null:null;
const timeline= dir=>dir?{
  readEvents:dir.reads.length,readBytes:dir.readBytes,
  forwardEvents:dir.forwards.length,forwardBytes:dir.forwardBytes,
  maxReadGapMs:maxGap(dir.reads.map(e=>e.monoMs)),
  maxForwardGapMs:maxGap(dir.forwards.map(e=>e.monoMs)),
  firstReadUtcMs:dir.reads[0]?.epochMs??null,lastReadUtcMs:dir.reads.at(-1)?.epochMs??null,
  firstForwardUtcMs:dir.forwards[0]?.epochMs??null,lastForwardUtcMs:dir.forwards.at(-1)?.epochMs??null,
  allReadsForwarded:dir.readBytes===dir.forwardBytes,
}:null;
const relayTarget=responseCandidate?{
  connectionId:responseCandidate.id,accepted:responseCandidate.accepted,
  closed:responseCandidate.closed,errors:responseCandidate.errors,
  clientToOllama:timeline(responseCandidate.c2o),ollamaToClient:timeline(responseCandidate.o2c),
  allOllamaReads:responseCandidate.o2c.reads,
  allOllamaForwards:responseCandidate.o2c.forwards,
}:null;
const relayHeaders=relay.filter(e=>e.event==='started').map(e=>({at:ms(e.utc_ns),limit:e.maxConnections,lifetime:e.lifetimeSeconds}));
const beforeStart = target?.at ?? report.endedAt;
const acceptedBeforeTarget = served.filter(c=>c.startUtcMs <= beforeStart).length;
const relayErrors=served.flatMap(c=>c.errors.map(e=>({id:c.id,...e})));
const resourceGpu=resources.map(r=>r.gpu).filter(s=>typeof s==='string' && /^\s*\d+\s*,/.test(s))
  .map(s=>s.split(',').slice(0,3).map(v=>Number(v.trim())));
const validRam=resources.filter(r=>tag(r.ram)&&tag(r.swap));
const take=(field)=>validRam.map(r=>r.ram[field]).filter(Number.isFinite);
const swapField=(field)=>validRam.map(r=>r.swap[field]).filter(Number.isFinite);
const pswpin=swapField('pswpin'),pswpout=swapField('pswpout');
const traceText=traceBytes.toString('utf8');
const traceLines=traceText.split(/\r?\n/);
const http=traceLines.filter(v=>/POST\s+"\/api\/chat"/.test(v));
const scheduler=traceLines.filter(v=>v.includes('after processing request finished event'));
const generation=traceLines.filter(v=>/\bn_gen\s*=\s*\d+/.test(v));
const warnings=traceLines.filter(v=>/level=(?:WARN|ERROR)|\bpanic\b|\bfatal\b/i.test(v));
const runnerState = resources.filter(r=>typeof r.processes==='string' && /ollama.*runner/i.test(r.processes));
const nativeTrace = {
  targetId,dispatchedUtcMs:target?.at??null,
  context:target?.numCtx??null,outputAllowance:target?.numPredict??null,
  httpStatus:targetNative?.httpStatus??null,failureCode:targetNative?.failureCode??null,
  lastStage:targetNative?.lastRequestStage??null,
  bodyChunks:bodies.length,bodyBytes:bodies.reduce((n,b)=>n+b.bytes,0),
  boundedTerminalSnapshotEvictions:targetNative?.droppedEvents??null,
  liveBodySequenceContiguous:true,
  progressEvents:trueCount,nonProgressBodyEvents:falseCount,
  maxRawInterReadGapMs:maxGap(bodies.map(b=>b.elapsedUs/1000)),
  maxSemanticInterResetGapMs:maxGap(meaningful.map(b=>b.elapsedUs/1000)),
  sendAwaitElapsedMs:kinds('send-await-start')[0]?.elapsedUs/1000??null,
  headerElapsedMs:kinds('headers')[0]?.elapsedUs/1000??null,
  firstBodyElapsedMs:kinds('first-body-chunk')[0]?.elapsedUs/1000??null,
  lastBodyElapsedMs:bodies.at(-1)?.elapsedUs/1000??null,
  providerDoneElapsedMs:kinds('provider-done')[0]?.elapsedUs/1000??null,
  eofElapsedMs:kinds('eof')[0]?.elapsedUs/1000??null,
  deadlineObserved:kinds('deadline-observed').map(e=>({elapsedMs:e.elapsedUs/1000,epochMs:e.at})),
  lastKind:filtered.at(-1)?.kind??null,
};
nativeTrace.sendToHeadersMs=nativeTrace.headerElapsedMs===null||nativeTrace.sendAwaitElapsedMs===null?
  null:nativeTrace.headerElapsedMs-nativeTrace.sendAwaitElapsedMs;
nativeTrace.sendToFirstBodyMs=nativeTrace.firstBodyElapsedMs===null||nativeTrace.sendAwaitElapsedMs===null?
  null:nativeTrace.firstBodyElapsedMs-nativeTrace.sendAwaitElapsedMs;

const reportSummary = {
  startingHead:'ab2cba76d4c9dd8dd9e4256dbe8f030022508558',
  runId:'musestreambyte-20261104-02',
  identity:{model:'muse-glimmer:30b',digest:'de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1',ollamaVersion:'0.40.11',
    originalForwardPid:41860,diagnosticForwardPid:tunnel.pid},
  qualification:{calibration:report.gate,proof:report.proofGate??null,
    calibrationRequestCount:requests.filter(e=>e.numPredict===32).length,
    probeRequestCount:requests.filter(e=>e.toolSchemas===1).length,
    acceptedConnectionsBeforeTarget:acceptedBeforeTarget},
  native:nativeTrace,targetOutcome:report.outcome,sdk:report.target??null,
  relay:{headers:relayHeaders,allConnections:sockets.size-Number(sockets.has(0)),accepted:served.length,rejected:rejected.length,
    errors:relayErrors,readForwardMatchedAll:served.every(c=>c.c2o.readBytes===c.c2o.forwardBytes&&c.o2c.readBytes===c.o2c.forwardBytes),
    acceptedBeforeTarget,connectionForTarget:relayTarget ? {
      id:relayTarget.connectionId,accepted:relayTarget.accepted,closed:relayTarget.closed,
      errors:relayTarget.errors,clientToOllama:relayTarget.clientToOllama,ollamaToClient:relayTarget.ollamaToClient,
    }:null,
    rawByteRecordCount:relay.length},
  resources:{samples:resources.length,gpuSamples:resourceGpu.length,
    peakGpuUtilizationPercent:max(resourceGpu.map(g=>g[0])),
    peakVramUsedMiB:max(resourceGpu.map(g=>g[1])),
    minVramFreeMiB:min(resourceGpu.map(g=>g[2])),
    minMemAvailableKiB:min(take('MemAvailable')),
    maxSwapUsedKiB:validRam.length?max(validRam.map(r=>r.ram.SwapTotal-r.ram.SwapFree).filter(Number.isFinite)):null,
    swapInPagesDelta:pswpin.length?pswpin.at(-1)-pswpin[0]:null,
    swapOutPagesDelta:pswpout.length?pswpout.at(-1)-pswpout[0]:null,
    runnerProcessSamples:runnerState.length},
  provider:{traceLines:traceLines.length,chatHttpCompletions:http.length,
    schedulerFinishedEvents:scheduler.length,runnerNGenLines:generation.length,
    warningErrorLines:warnings.length,
    httpCompletionSamples:http.slice(-4).map(e=>e.slice(0,220)),
    runnerGenerationSamples:generation.length?generation.filter((_,i)=>i%Math.max(1,Math.floor(generation.length/30))===0).slice(-30).map(e=>e.slice(0,220)):[],
    warningSamples:warnings.slice(-12).map(e=>e.slice(0,220))},
  filesSha256:Object.fromEntries(await Promise.all(['relay-bytes.jsonl','resources.jsonl','ollama-trace.log'].map(async f=>
    [f,sha(await readFile(path.join(data,f)))]))),
  limitations:[
    'Remote relay timestamps and Windows native timestamps have separate clocks; UTC cross-correlation approximate. Each host monotonic gaps authoritative.',
    'Relay read means bytes arrived at its user-space upstream socket, not necessarily Ollama HTTP write syscall time.',
    'HTTP response TCP bytes include headers/framing; reqwest Body bytes exclude HTTP transport framing.',
    'Native meaningful-progress marks exactly when Progress::feed(bytes) returned true, and source resets 180-second deadline in that same branch.',
  ],
};

if (target){
  assert.equal(targetId,'inference-9');
  assert.equal(requests.filter(r=>r.numPredict===32).length,7);
  assert.equal(requests.filter(r=>r.toolSchemas===1).length,1);
  assert.equal(report.gate?.status,'verified');
  assert.equal(report.proofGate?.status,'verified');
  assert.equal(report.proofGate?.outcome,'native-call');
  assert.equal(report.targetStarted,true);
  assert.equal(report.targetEnded,true);
  assert.equal(report.outcome,'completed');
  assert.equal(targetNative.httpStatus,200);
  assert.equal(nativeTrace.deadlineObserved.length,0);
  assert.equal(nativeTrace.lastKind,'completed');
  assert(kinds('provider-done').length===1 && kinds('eof').length===1);
  assert(relayHeaders.some(e=>e.limit===1024));
  assert.equal(rejected.length,0);
  assert.equal(relayErrors.length,0);
  assert(reportSummary.relay.readForwardMatchedAll);
  assert(relayTarget && relayTarget.ollamaToClient.readBytes>0 &&
    relayTarget.ollamaToClient.allReadsForwarded && relayTarget.closed);
  reportSummary.classification='LOCAL STREAM DELIVERY STALL NOT REPRODUCED';
  reportSummary.oneInstrumentedForgeBoardRetryJustified=true;
} else {
  reportSummary.classification='LOCAL STREAM DELIVERY DIAGNOSTIC INVALIDATED';
  reportSummary.oneInstrumentedForgeBoardRetryJustified=false;
}

const timelinePath=path.join(root,'target-native-four-layer-timeline.jsonl');
const relayPath=path.join(root,'target-relay-two-direction-timeline.jsonl');
await writeFile(timelinePath,fullTimeline.map(x=>JSON.stringify(x)).join('\n')+'\n',{flag:'wx'});
if(relayTarget){
  await writeFile(relayPath,relay.filter(e=>e.connection===relayTarget.connectionId).map(e=>JSON.stringify({
    monoNs:e.mono_ns,utcNs:e.utc_ns,event:e.event,direction:e.direction,bytes:e.bytes,
    ...(e.errno?{errno:e.errno}:{})})).join('\n')+'\n',{flag:'wx'});
}
await writeFile(path.join(root,'corrected-byte-boundary-summary.json'),JSON.stringify(reportSummary,null,2),{flag:'wx'});
console.log(JSON.stringify({native:reportSummary.native,qual:reportSummary.qualification,
  relay:reportSummary.relay,provider:reportSummary.provider,resources:reportSummary.resources,
  fileSHA:reportSummary.filesSha256,targetOutcome:reportSummary.targetOutcome},null,2));
