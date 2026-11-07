/** Read-only, post-termination, all-request ForgeBoard four-layer forensics.
 * Reads only numeric/timestamp event evidence; never replays model calls or
 * records prompts, tool arguments, or response content in its outputs.
 */
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const root = path.join(repo, 'src-tauri/target/real-qwen-product/forgeboardmuse-20261107-01');
const remote = path.join(root, 'remote-evidence');
const phase = 'mission-a-1';
const digest = 'de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1';
const file = (name, isRemote = false) => path.join(isRemote ? remote : root, name);
const exists = async name => !!(await stat(name).catch(() => null));
const read = async name => (await exists(name)) ? await readFile(name, 'utf8') : null;
const json = async name => { const x = await read(name); return x ? JSON.parse(x) : null; };
async function* rows(name) {
  if (!(await exists(name))) return;
  const input = createReadStream(name, { encoding: 'utf8' });
  try {
    for await (const line of createInterface({ input, crlfDelay: Infinity })) {
      if (line.trim()) yield JSON.parse(line);
    }
  } finally { input.destroy(); }
}
const max = values => values.length ? Math.max(...values) : null;
const min = values => values.length ? Math.min(...values) : null;
const gap = times => times.length < 2 ? null : max(times.slice(1).map((t, i) => t - times[i]));
const round = v => Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
const hash = async p => (await exists(p)) ? createHash('sha256').update(await readFile(p)).digest('hex') : null;
const ms = ns => Number(ns) / 1e6;
const counts = list => Object.fromEntries([...new Set(list)].sort().map(key => [key, list.filter(x => x === key).length]));

const requests = [];
for await (const r of rows(file(phase + '.requests.jsonl'))) {
  requests.push({ requestId: r.requestId, at: r.at, agentBatch: r.agentBatch, modelMatches: r.modelMatches,
    numCtx: r.numCtx, numPredict: r.numPredict, toolSchemas: r.toolSchemas,
    toolNames: r.toolNames, stream: r.stream, thinkKind: r.thinkKind });
}
assert(requests.length > 0 && requests.every(r => r.modelMatches && r.stream && r.thinkKind === 'absent'));
const receives = new Map();
for await (const r of rows(file(phase + '.receive.jsonl'))) {
  receives.set(r.requestId, { status: r.httpStatus, failureCode: r.failureCode, lastStage: r.lastRequestStage,
    bodyChunks: r.bodyChunks, bodyBytes: r.bodyBytes, droppedEvents: r.droppedEvents,
    destinationPort: r.destinationPort, scope: r.resolvedIpScope });
}
const getNative = id => {
  if (!natives.has(id)) natives.set(id, { requestId: id, byKind: {}, bodies: [], progressSeq: new Set(),
    firstEventAt: null, lastEventAt: null, firstEventUs: null, lastEventUs: null, headersAt: null,
    dispatchAt: null, sendAt: null, terminal: null, deadlineObservations: [] });
  return natives.get(id);
};
const natives = new Map();
for await (const row of rows(file(phase + '.native-events.jsonl'))) {
  if (!row.requestId || !row.event) continue;
  const e = row.event, n = getNative(row.requestId);
  n.byKind[e.kind] = (n.byKind[e.kind] ?? 0) + 1;
  n.firstEventAt ??= e.at;
  n.firstEventUs ??= e.elapsedUs;
  n.lastEventAt = e.at;
  n.lastEventUs = e.elapsedUs;
  if (e.kind === 'dispatch') n.dispatchAt = e.at;
  if (e.kind === 'send-await-start') n.sendAt = e.at;
  if (e.kind === 'headers') n.headersAt = e.at;
  if (e.kind === 'body') n.bodies.push({ sequence: e.sequence, at: e.at, elapsedUs: e.elapsedUs, bytes: e.bytes });
  if (e.kind === 'meaningful-progress') n.progressSeq.add(e.sequence);
  if (e.kind === 'deadline-observed') n.deadlineObservations.push({ at: e.at, elapsedUs: e.elapsedUs });
  if (['completed', 'failed', 'cancelled'].includes(e.kind)) n.terminal = { kind: e.kind, at: e.at, elapsedUs: e.elapsedUs };
}

const counter = () => ({ reads: [], forwards: [], readBytes: 0, forwardBytes: 0 });
const connections = new Map();
for await (const e of rows(file('relay-bytes.jsonl', true))) {
  const id = e.connection;
  let c = connections.get(id);
  if (!c) {
    c = { id, accepted: false, rejected: false, closed: false, startAt: ms(e.utc_ns),
      endAt: ms(e.utc_ns), errors: [], c2o: counter(), o2c: counter() };
    connections.set(id, c);
  }
  c.endAt = ms(e.utc_ns);
  if (e.event === 'accepted') c.accepted = true;
  if (e.event === 'rejected') c.rejected = true;
  if (e.event === 'closed') c.closed = true;
  if (['socket-error', 'upstream-error'].includes(e.event))
    c.errors.push({ direction: e.direction, type: e.errorType ?? null, errno: e.errno ?? null });
  const d = e.direction === 'client-to-ollama' ? c.c2o : e.direction === 'ollama-to-client' ? c.o2c : null;
  if (d && (e.event === 'read' || e.event === 'forward')) {
    const r = e.event === 'read';
    const total = r ? 'readBytes' : 'forwardBytes';
    d[total] += e.bytes;
    d[r ? 'reads' : 'forwards'].push({ mono: ms(e.mono_ns), at: ms(e.utc_ns), bytes: e.bytes, cumulative: d[total] });
  }
}
const direction = d => {
  let maxWriteDelay = null;
  let j = 0;
  for (const r of d.reads) {
    while (j < d.forwards.length && d.forwards[j].cumulative < r.cumulative) j++;
    if (j < d.forwards.length) maxWriteDelay = Math.max(maxWriteDelay ?? 0, d.forwards[j].mono - r.mono);
  }
  return { readEvents: d.reads.length, forwardEvents: d.forwards.length,
    readBytes: d.readBytes, forwardBytes: d.forwardBytes,
    allReadsForwarded: d.readBytes === d.forwardBytes,
    maxInterReadMs: round(gap(d.reads.map(e => e.mono))),
    maxInterForwardMs: round(gap(d.forwards.map(e => e.mono))),
    maxReadToCompleteForwardMs: round(maxWriteDelay),
    firstReadAt: d.reads[0]?.at ?? null, lastReadAt: d.reads.at(-1)?.at ?? null,
    firstForwardAt: d.forwards[0]?.at ?? null, lastForwardAt: d.forwards.at(-1)?.at ?? null };
};
const usable = [...connections.values()].filter(c => c.accepted);
const assigned = new Set();
const perBody = [];
const byRequest = [];
for (const request of requests) {
  const n = natives.get(request.requestId);
  const bodies = n?.bodies ?? [];
  const seqOK = bodies.every((b, i) => b.sequence === i + 1);
  const progresses = bodies.filter(b => n.progressSeq.has(b.sequence));
  const resetCount = progresses.length;
  const unmatched = [...(n?.progressSeq ?? [])].filter(s => !bodies.some(b => b.sequence === s));
  for (const b of bodies) perBody.push(JSON.stringify({ requestId: request.requestId, sequence: b.sequence,
    at: b.at, elapsedUs: b.elapsedUs, rawBodyBytes: b.bytes,
    feedReturnedTrue: n.progressSeq.has(b.sequence),
    streamIdleDeadlineReset: n.progressSeq.has(b.sequence) }));
  const receive = receives.get(request.requestId) ?? null;
  // Match each native dispatch to its unique raw socket using UTC first-write
  // and response-header timing. This is an inference, not packet-level proof:
  // concurrent metadata sockets and separate host clocks can be ambiguous.
  const candidates = (!n?.dispatchAt || !n?.sendAt ? [] : usable.filter(c => !assigned.has(c.id) && c.c2o.reads.length &&
    Math.abs(c.c2o.reads[0].at - n.sendAt) < 20000))
    .map(c => {
      const requestDelta = Math.abs(c.c2o.reads[0].at - (n?.sendAt ?? request.at));
      const headerDelta = n?.headersAt && c.o2c.reads.length ?
        Math.abs(c.o2c.reads[0].at - n.headersAt) : null;
      return { c, requestDelta, headerDelta,
        score: requestDelta + (headerDelta ?? 5000) * 2 };
    }).sort((a, b) => a.score - b.score);
  const match = candidates[0] && candidates[0].requestDelta < 10000 &&
    (candidates[0].headerDelta === null || candidates[0].headerDelta < 10000)
    ? candidates[0] : null;
  if (match) assigned.add(match.c.id);
  const c = match?.c;
  const native = { bodyChunks: bodies.length, bodyBytes: bodies.reduce((n, b) => n + b.bytes, 0),
    progressResets: resetCount, feedFalseWithoutReset: bodies.length - resetCount,
    bodySequenceContiguous: seqOK, unmatchedProgressSequences: unmatched.length,
    firstBodyAt: bodies[0]?.at ?? null, lastBodyAt: bodies.at(-1)?.at ?? null,
    maxRawBodyGapMs: round(gap(bodies.map(b => b.elapsedUs / 1000))),
    maxMeaningfulProgressGapMs: round(gap(progresses.map(b => b.elapsedUs / 1000))),
    lastProgressToTerminalMs: n?.terminal && progresses.length ?
      round((n.terminal.elapsedUs - progresses.at(-1).elapsedUs) / 1000) : null,
    httpHeadersAt: n?.headersAt ?? null, dispatchAt: n?.dispatchAt ?? null,
    nativeTerminal: n?.terminal ?? null, deadlineObserved: n?.deadlineObservations ?? [],
    eventKinds: n?.byKind ?? {}, liveEventWindowMs: n?.lastEventUs === null ? null :
      round((n.lastEventUs - n.firstEventUs) / 1000),
    nativeReceiveSummary: receive,
    snapshotEvictionsDoNotImplyLostLiveEvents: receive?.droppedEvents ?? null,
    receiveBodyCountAgrees: receive?.bodyChunks == null ? null : receive.bodyChunks === bodies.length,
    receiveBodyBytesAgree: receive?.bodyBytes == null ? null : receive.bodyBytes === bodies.reduce((s, b) => s + b.bytes, 0) };
  const millis = native.liveEventWindowMs ?? null;
  byRequest.push({ requestId: request.requestId, agentBatch: request.agentBatch,
    context: request.numCtx, outputAllowance: request.numPredict, toolSchemas: request.toolSchemas,
    modelMatches: request.modelMatches, thinkKind: request.thinkKind,
    durationMs: millis, over30s: millis !== null && millis > 30000,
    over60s: millis !== null && millis > 60000, native,
    correlation: { connectionId: c?.id ?? null, matchingIsInferred: !!c,
      alternatives: candidates.length, requestStartDeltaMs: round(match?.requestDelta),
      headerDeltaMs: round(match?.headerDelta),
      candidateAmbiguity: !!(match && candidates[1] && candidates[1].score - match.score < 250) },
    relay: c ? { accepted: c.accepted, closed: c.closed, errors: c.errors,
      clientToOllama: direction(c.c2o), ollamaToClack: direction(c.o2c) } : null });
}

const host = [];
for await (const r of rows(file(phase + '.jsonl'))) host.push(r);
const trust = [];
for await (const r of rows(file(phase + '.trust-timeline.jsonl'))) trust.push(r);
const correction = await json(file('correction-state.json'));
const runner = await json(file(phase + '.json'));
const report = await json(file(phase + '.native-report.json'));
const failure = await json(file(phase + '.failure.json'));
const savedSessions = await json(file('data/terax-ai-sessions.json'));
const agentSession = savedSessions?.sessions?.find(s => s.id === 'real-mission-a');
const agentError = agentSession?.run?.error ?? null;
const detailNumber = (label) => {
  const match = typeof agentError?.details === 'string'
    ? agentError.details.match(new RegExp('^' + label + ':\\s*(\\d+)', 'm')) : null;
  return match ? Number(match[1]) : null;
};
const resources = [];
for (const name of ['resources.jsonl', 'resources-full.jsonl']) {
  for await (const r of rows(file(name, true))) resources.push(r);
}
resources.sort((a, b) => Number(a.utc_ns) - Number(b.utc_ns));
const gpu = resources.map(r => r.gpu).filter(v => typeof v === 'string' && /^\s*\d+\s*,/.test(v))
  .map(v => v.split(',').slice(0, 3).map(Number));
const ram = resources.map(r => r.ram).filter(v => v && Number.isFinite(v.MemAvailable));
const swap = resources.map(r => r.swap).filter(v => v && Number.isFinite(v.pswpin));
const trace = await read(file('ollama-trace.log', true));
const traceLines = trace?.split(/\r?\n/) ?? [];
const traceCounts = {
  lines: traceLines.length,
  chatHttpCompletions: traceLines.filter(x => /POST\s+"\/api\/chat"/.test(x)).length,
  schedulerFinished: traceLines.filter(x => x.includes('after processing request finished event')).length,
  runnerGenerationSamples: traceLines.filter(x => /\bn_gen\s*=\s*\d+/.test(x)).length,
  warningsErrors: traceLines.filter(x => /level=(?:WARN|ERROR)|\bpanic\b|\bfatal\b/i.test(x)).length,
};
const allReadForwarded = usable.every(c =>
  c.c2o.readBytes === c.c2o.forwardBytes && c.o2c.readBytes === c.o2c.forwardBytes);
const result = {
  runId: 'forgeboardmuse-20261107-01',
  startingHead: 'c3260aeafb96a11fe7d6eaf554938242f499f005',
  model: 'muse-glimmer:30b', requiredDigest: digest,
  nativeRequests: requests.length, allExpectedModel: requests.every(r => r.modelMatches),
  qualificationRequests: requests.filter(r => r.agentBatch === 'not-agent').length,
  agentRequests: requests.filter(r => r.agentBatch !== 'not-agent').length,
  agentBatches: counts(requests.filter(r => r.agentBatch !== 'not-agent').map(r => r.agentBatch)),
  requestsOver30s: byRequest.filter(r => r.over30s).map(r => ({ id: r.requestId, durationMs: r.durationMs })),
  requestsOver60s: byRequest.filter(r => r.over60s).map(r => ({ id: r.requestId, durationMs: r.durationMs })),
  longestRequest: [...byRequest].sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))[0]?.requestId ?? null,
  longestRequestMs: max(byRequest.map(r => r.durationMs).filter(Number.isFinite)),
  maxNativeBodyGapMs: max(byRequest.map(r => r.native.maxRawBodyGapMs).filter(Number.isFinite)),
  maxNativeSemanticGapMs: max(byRequest.map(r => r.native.maxMeaningfulProgressGapMs).filter(Number.isFinite)),
  maxRelayOllamaReadGapMs: max(byRequest.map(r => r.relay?.ollamaToClack.maxInterReadMs).filter(Number.isFinite)),
  maxRelayOllamaForwardGapMs: max(byRequest.map(r => r.relay?.ollamaToClack.maxInterForwardMs).filter(Number.isFinite)),
  maxRelayReadToForwardMs: max(byRequest.map(r => r.relay?.ollamaToClack.maxReadToCompleteForwardMs).filter(Number.isFinite)),
  rawBodyReads: byRequest.reduce((n, r) => n + r.native.bodyChunks, 0),
  rawBodyBytes: byRequest.reduce((n, r) => n + r.native.bodyBytes, 0),
  semanticResets: byRequest.reduce((n, r) => n + r.native.progressResets, 0),
  feedFalseWithoutReset: byRequest.reduce((n, r) => n + r.native.feedFalseWithoutReset, 0),
  rawBodyContinuityAll: byRequest.every(r => r.native.bodySequenceContiguous && r.native.unmatchedProgressSequences === 0),
  relay: { accepted: usable.length, rejected: [...connections.values()].filter(c => c.rejected).length,
    connectionLimit: 1024, lifetimeSeconds: 7200,
    connectionsWithErrors: usable.filter(c => c.errors.length).map(c => ({ id: c.id, errors: c.errors })),
    allRawReadsForwarded: allReadForwarded, matchedNativeConnections: byRequest.filter(r => r.correlation.connectionId !== null).length,
    ambiguousMatches: byRequest.filter(r => r.correlation.candidateAmbiguity).map(r => r.requestId),
    unassignedConnections: usable.length - assigned.size,
    totalOllamaBytesRead: usable.reduce((n, c) => n + c.o2c.readBytes, 0),
    totalOllamaBytesForwarded: usable.reduce((n, c) => n + c.o2c.forwardBytes, 0) },
  trust: { latestCalibration: trust.at(-1)?.calibration ?? null, latestProofs: trust.at(-1)?.proofs ?? [],
    latestLoad: trust.at(-1)?.values ?? null, samples: trust.length },
  correction: { status: correction?.status ?? 'missing', confirmedWrites: correction?.writes?.length ?? 0,
    boundary: correction?.boundary ?? null, messageId: correction?.messageId ?? null },
  agentSession: { state: agentSession?.run?.state ?? null,
    provider: agentSession?.run?.providerId ?? null,
    reasoningChoice: agentSession?.run?.reasoning?.choice ?? null,
    budget: agentSession?.run?.budget ?? null,
    error: agentError ? { code: agentError.errorCode ?? null, kind: agentError.kind ?? null,
      disposition: agentError.disposition ?? null, title: agentError.title ?? null,
      inputEstimate: detailNumber('Input estimate'),
      outputReserve: detailNumber('Output reserve'),
      effectiveCeiling: detailNumber('Effective ceiling') } : null },
  host: { kinds: counts(host.map(e => e.kind)), nativeToolSummaries: host.filter(e => e.kind === 'agent-native-tool-summary').map(e => e.toolSummary),
    correctionBoundaries: host.filter(e => e.kind === 'correction-boundary').length,
    terminalReport: report ? { ok: report.ok, missionStarted: report.missionStarted,
      cloudInference: report.cloudInference, correctionSent: report.correctionSent } : null,
    runner: runner ? { resultOk: runner.resultOk, missionStarted: runner.missionStarted,
      cloudInference: runner.cloudInference, nativeExit: runner.nativeExit,
      failureCode: runner.failureCode, failureClass: runner.failureClass } : null,
    failure: failure ? { errorKind: failure.errorKind, childExit: failure.childExit } : null },
  resources: { samples: resources.length, gpuSamples: gpu.length,
    peakGpuPercent: max(gpu.map(r => r[0])),
    peakVramUsedMiB: max(gpu.map(r => r[1])),
    minVramFreeMiB: min(gpu.map(r => r[2])),
    minMemAvailableKiB: min(ram.map(r => r.MemAvailable)),
    maxSwapUsedKiB: max(ram.map(r => r.SwapTotal - r.SwapFree)),
    swapInPageDelta: swap.length ? swap.at(-1).pswpin - swap[0].pswpin : null,
    swapOutPageDelta: swap.length ? swap.at(-1).pswpout - swap[0].pswpout : null },
  provider: traceCounts,
  limitations: [
    'Native reqwest HTTP body excludes raw TCP response headers/chunk framing included in relay byte counts.',
    'Remote Linux and Windows clocks can differ; per-host monotonic gaps are authoritative.',
    'Matching request IDs to unparsed relay sockets uses timing and can be ambiguous; IDs are never present in relay payload logs.',
    'Progress::feed true is represented by a meaningful-progress event; only that production branch resets the 180-second idle deadline.',
    'Native bounded diagnostic snapshot eviction does not imply loss when the separate live JSONL event sequence is complete.',
    'Read-only telemetry may contain overlap between 900-second original and 7200-second extended samplers.',
  ],
};
result.rawEvidenceSha256 = Object.fromEntries(await Promise.all([
  phase + '.requests.jsonl', phase + '.receive.jsonl', phase + '.native-events.jsonl',
  'relay-bytes.jsonl', 'resources.jsonl', 'resources-full.jsonl', 'ollama-trace.log'
].map(async name => [name, await hash(file(name,
  ['relay-bytes.jsonl','resources.jsonl','resources-full.jsonl','ollama-trace.log'].includes(name)))])));
// V2 supersedes the first preliminary socket correlator: a native
// future-dropped request with no dispatch must NEVER match any relay socket.
await writeFile(file('four-layer-native-per-body-v2.jsonl'), perBody.join('\n') + (perBody.length ? '\n' : ''), { flag: 'wx' });
await writeFile(file('four-layer-per-request-v2.json'), JSON.stringify(byRequest, null, 2), { flag: 'wx' });
await writeFile(file('four-layer-summary-v2.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ runId: result.runId, nativeRequests: result.nativeRequests,
  agentRequests: result.agentRequests, relay: result.relay, longestRequest: result.longestRequest,
  longestRequestMs: result.longestRequestMs, correction: result.correction,
  resources: result.resources, provider: result.provider }, null, 2));
