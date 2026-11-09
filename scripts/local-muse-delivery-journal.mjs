/** Exclusive, content-free, cross-host stream delivery evidence.
 * No model is started. The caller owns installation, authorization and raw
 * upstream observability. This journal rejects any unapproved payload field. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { open, link, unlink } from 'node:fs/promises';

export const LAYERS = Object.freeze({
  'ollama-runner': ['generation-counter'],
  'ollama-http-write': ['socket-write-attempt', 'socket-write-return'],
  'remote-ssh-forward': ['tcp-send', 'tcp-recv', 'tcp-retransmit', 'tcp-snapshot', 'connect', 'close'],
  'ssh-encrypted-transport': ['tcp-send', 'tcp-recv', 'tcp-retransmit', 'tcp-snapshot', 'connect', 'close'],
  'local-forwarded-tcp': ['tcp-send', 'tcp-recv', 'tcp-retransmit', 'tcp-snapshot', 'connect', 'close'],
  'clack-reqwest': ['native-dispatch', 'native-headers', 'native-body-read', 'native-ipc-forwarded',
    'native-ipc-rejected', 'native-provider-done', 'native-eof', 'native-terminal'],
  'clack-semantic': ['native-semantic-progress'],
  'clack-webview': ['webview-headers-received', 'webview-ipc-received', 'webview-stream-enqueued',
    'webview-settled-received'],
  'collector': ['capability', 'clock-anchor', 'event-loss', 'shutdown'],
});
const FIELDS = new Set(['schemaVersion', 'sequence', 'host', 'layer', 'kind', 'atUnixMs',
  'monoUs', 'requestId', 'requestSequence', 'socketId', 'connectionId', 'endpoint', 'bytes',
  'requestedBytes', 'returnedBytes', 'generatedTokens', 'ackedBytes', 'receivedBytes',
  'retransmittedBytes', 'dropped', 'result', 'capability', 'confidence',
  'clockUncertaintyUs', 'localPort', 'remotePort', 'kernelAttempts',
  'kernelReturns', 'pendingWrites', 'durationMs', 'kernelReturn']);
const HOSTS = new Set(['ollama', 'remote-ssh', 'local-ssh', 'clack-native', 'clack-webview', 'collector']);
const ENDPOINTS = new Set(['ollama-loopback', 'remote-forward', 'encrypted-ssh',
  'local-forward', 'clack-http', 'unknown']);
const CAPABILITIES = new Set(['available', 'unavailable', 'unverified', 'permission-denied',
  'disabled', 'partial']);
const RESULTS = new Set(['ok', 'partial', 'failed', 'would-block', 'unverified']);
const CONFIDENCE = new Set(['direct', 'candidate', 'unavailable']);
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const bounded = n => Number.isSafeInteger(n) && n >= 0;
const positive = n => Number.isSafeInteger(n) && n > 0;
const optional = (v, check, field) => { if (v !== undefined) assert(check(v), `Invalid ${field}`); };

export function validateDeliveryRecord(value, expectedSequence) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Invalid delivery record');
  assert(Object.keys(value).every(k => FIELDS.has(k)), 'Unexpected delivery field');
  assert(value.schemaVersion === 1 && value.sequence === expectedSequence, 'Delivery version/sequence mismatch');
  assert(HOSTS.has(value.host), 'Invalid delivery host');
  assert(Object.hasOwn(LAYERS, value.layer) && LAYERS[value.layer].includes(value.kind), 'Invalid boundary/kind');
  assert(bounded(value.atUnixMs) && bounded(value.monoUs), 'Invalid observation clock');
  for (const field of ['requestSequence', 'bytes', 'requestedBytes', 'returnedBytes', 'generatedTokens',
    'ackedBytes', 'receivedBytes', 'retransmittedBytes', 'dropped', 'clockUncertaintyUs',
    'localPort', 'remotePort', 'kernelAttempts', 'kernelReturns',
    'pendingWrites', 'durationMs']) optional(value[field], bounded, field);
  for (const field of ['requestId', 'socketId', 'connectionId']) optional(value[field], v =>
    typeof v === 'string' && ID.test(v), field);
  optional(value.kernelReturn, Number.isSafeInteger, 'kernelReturn');
  if (value.kernelReturn !== undefined) assert(value.layer === 'ollama-http-write' &&
    value.kind === 'socket-write-return', 'Signed kernel return is valid only for Ollama writes');
  if (['kernelAttempts', 'kernelReturns', 'pendingWrites', 'durationMs'].some(
    field => value[field] !== undefined)) assert(value.layer === 'collector' &&
      value.kind === 'shutdown' && value.endpoint === 'ollama-loopback',
    'Kernel session counters cannot be attached to another boundary');
  optional(value.endpoint, v => ENDPOINTS.has(v), 'endpoint');
  optional(value.capability, v => CAPABILITIES.has(v), 'capability');
  optional(value.confidence, v => CONFIDENCE.has(v), 'confidence');
  optional(value.result, v => RESULTS.has(v), 'result');
  if (value.localPort !== undefined) assert(value.localPort <= 65535, 'Invalid local port');
  if (value.remotePort !== undefined) assert(value.remotePort <= 65535, 'Invalid remote port');
  if (value.layer === 'ollama-runner') {
    assert(value.host === 'ollama' && bounded(value.generatedTokens), 'Runner counter required');
    assert(value.bytes === undefined && value.returnedBytes === undefined,
      'Generated tokens are not transmitted bytes');
  }
  if (value.layer === 'ollama-http-write') {
    assert(value.host === 'ollama' && value.socketId && bounded(value.requestedBytes),
      'Socket write attempt needs direct socket and length');
    if (value.kind === 'socket-write-return') {
      assert(RESULTS.has(value.result) && bounded(value.returnedBytes) &&
        value.returnedBytes <= value.requestedBytes, 'Invalid successful socket write accounting');
      if (value.result === 'ok') assert(value.returnedBytes === value.requestedBytes, 'Partial write is not complete');
      if (value.kernelReturn !== undefined) {
        assert(value.returnedBytes === Math.max(0, value.kernelReturn),
          'Kernel signed return must match observed nonnegative bytes');
        const expectedResult = value.kernelReturn === -11 ? 'would-block' :
          value.kernelReturn < 0 ? 'failed' :
            value.kernelReturn === value.requestedBytes ? 'ok' : 'partial';
        assert(value.result === expectedResult, 'Kernel return/result classification mismatch');
      }
    } else assert(value.returnedBytes === undefined && value.kernelReturn === undefined,
      'Write attempt cannot claim result bytes');
    assert(value.requestId === undefined || value.confidence === 'candidate',
      'Kernel socket capture cannot directly identify a Clack HTTP request');
  }
  if (value.layer.includes('ssh') || value.layer === 'local-forwarded-tcp') {
    assert(value.socketId && value.requestId === undefined,
      'SSH/multiplexed TCP capture cannot directly claim a request identity');
  }
  if (value.layer === 'clack-reqwest' || value.layer === 'clack-semantic' || value.layer === 'clack-webview') {
    assert(typeof value.requestId === 'string' && ID.test(value.requestId), 'Direct Clack request ID required');
    assert(value.confidence === undefined || value.confidence === 'direct', 'Native identity must be direct');
    if (value.layer === 'clack-webview') assert(value.host === 'clack-webview', 'WebView host mismatch');
    else assert(value.host === 'clack-native', 'Native host mismatch');
    if (value.layer === 'clack-semantic') assert(value.bytes === undefined || value.bytes === 0,
      'Semantic progress is not byte delivery');
  }
  if (value.layer === 'collector' && value.kind === 'capability')
    assert(CAPABILITIES.has(value.capability), 'Missing capability result');
  if (value.layer === 'collector' && value.kind === 'event-loss')
    assert(positive(value.dropped), 'Loss receipt requires nonzero count');
  if (value.layer === 'collector' && value.kind === 'shutdown' &&
      value.endpoint === 'ollama-loopback' && value.result === 'ok') {
    assert(bounded(value.kernelAttempts) && bounded(value.kernelReturns) &&
      value.kernelReturns === value.kernelAttempts && value.pendingWrites === 0 &&
      value.dropped === 0 && bounded(value.durationMs) && value.durationMs <= 1_800_000,
    'Complete kernel source needs bounded, balanced loss-free counters');
  }
  if (value.layer === 'collector') {
    assert(value.host === 'collector' && value.requestId === undefined,
      'Collector metadata cannot claim an inference request');
  }
  const clean = Object.fromEntries(Object.keys(value).map(k => [k, value[k]]));
  assert(Buffer.byteLength(JSON.stringify(clean)) <= 768, 'Oversized delivery record');
  return Object.freeze(clean);
}

/** Error interval is not a point estimate. Remote observation is bounded by
 * client send/receive; uncertainty is at least RTT/2 + remote clock tick. */
export function clockOffsetBounds({ clientSendUnixUs, clientReceiveUnixUs,
  remoteUnixUs, clientSendMonoUs, clientReceiveMonoUs, tickUs = 1000 }) {
  for (const n of [clientSendUnixUs, clientReceiveUnixUs, remoteUnixUs,
    clientSendMonoUs, clientReceiveMonoUs, tickUs]) assert(bounded(n), 'Invalid clock sample');
  assert(clientReceiveUnixUs >= clientSendUnixUs &&
    clientReceiveMonoUs >= clientSendMonoUs && tickUs > 0, 'Clock order invalid');
  const rttUs = clientReceiveMonoUs - clientSendMonoUs;
  const midpoint = (clientSendUnixUs + clientReceiveUnixUs) / 2;
  const estimateUs = midpoint - remoteUnixUs;
  return Object.freeze({ estimateUs, uncertaintyUs: Math.ceil(rttUs / 2 + tickUs),
    minUs: estimateUs - Math.ceil(rttUs / 2 + tickUs),
    maxUs: estimateUs + Math.ceil(rttUs / 2 + tickUs),
    rttUs, comparableMono: false });
}

/** Monotonic time orders events ONLY in an explicitly shared clock domain;
 * equal host labels alone cannot prove the same origin (native Instant,
 * performance.now and imported kernel CLOCK_MONOTONIC may differ). */
export function canOrderAcrossHosts(a, b, offsetA, offsetB) {
  if (a.host === b.host && typeof a.clockDomain === 'string' &&
    a.clockDomain.length > 0 && a.clockDomain === b.clockDomain &&
    a.monoUs <= b.monoUs) return 'shared-domain-monotonic';
  if (!offsetA || !offsetB) return 'unknown';
  const aHi = a.atUnixMs * 1000 + offsetA.maxUs;
  const bLo = b.atUnixMs * 1000 + offsetB.minUs;
  return aHi < bLo ? 'bounded-clock-order' : 'unknown';
}

export function interpretDeliveryRecords(rows, receipt, raw) {
  const validated = rows.map((r, i) => validateDeliveryRecord(r, i + 1));
  const exact = Buffer.from(validated.map(r => JSON.stringify(r) + '\n').join(''));
  const bytesMatch = raw instanceof Uint8Array && Buffer.from(raw).equals(exact);
  const complete = bytesMatch && receipt?.schemaVersion === 1 &&
    receipt?.claim === 'collector-flush-only' && receipt.count === rows.length &&
    receipt.sha256 === createHash('sha256').update(raw).digest('hex') &&
    receipt.dropped === 0 && !receipt.deliveryFailed &&
    !validated.some(r => r.kind === 'event-loss' ||
      (r.kind === 'shutdown' && r.endpoint === 'ollama-loopback' && r.result !== 'ok'));
  const byRequest = new Map();
  for (const row of validated) {
    if (!row.requestId || !row.kind.startsWith('native-') && !row.kind.startsWith('webview-')) continue;
    const list = byRequest.get(row.requestId) ?? [];
    list.push(row); byRequest.set(row.requestId, list);
  }
  const requests = [...byRequest].map(([requestId, list]) => {
    const total = kind => list.filter(r => r.kind === kind).reduce((s, r) => s + (r.bytes ?? 0), 0);
    const count = kind => list.filter(r => r.kind === kind).length;
    // reqwest read/progress/terminal observations use one native collector
    // Instant origin. This is an observed *client* silence, not a provider stall.
    const nativeReads = list.filter(r => r.kind === 'native-body-read');
    const nativeTerminals = list.filter(r => r.kind === 'native-terminal');
    const monotonic = events => events.every((r, i) => i === 0 ||
      r.monoUs >= events[i - 1].monoUs);
    const monotonicReads = monotonic(nativeReads);
    const maxNativeInterReadGapUs = monotonicReads && nativeReads.length >= 2
      ? Math.max(...nativeReads.slice(1).map((r, i) =>
        r.monoUs - nativeReads[i].monoUs)) : null;
    const lastNativeReadToTerminalUs = monotonicReads && nativeReads.length &&
      nativeTerminals.length === 1 &&
      nativeTerminals[0].monoUs >= nativeReads.at(-1).monoUs
      ? nativeTerminals[0].monoUs - nativeReads.at(-1).monoUs : null;
    // Enforce a one-to-one join on (request, body-sequence, exact byte length).
    // Equal aggregate counts are insufficient if a record was duplicated,
    // replaced or lost, even when the collector itself sealed successfully.
    const oneToOne = (sourceKind, destinationKind) => {
      const from = list.filter(r => r.kind === sourceKind);
      const to = list.filter(r => r.kind === destinationKind);
      if (!from.length || from.length !== to.length) return false;
      const sequenceBytes = records => {
        const indexed = new Map();
        for (const r of records) {
          if (!Number.isSafeInteger(r.requestSequence) || r.requestSequence < 1 ||
              indexed.has(r.requestSequence)) return null;
          indexed.set(r.requestSequence, r.bytes);
        }
        return indexed;
      };
      const a = sequenceBytes(from), b = sequenceBytes(to);
      return a !== null && b !== null && a.size === b.size &&
        [...a].every(([seq, bytes]) => b.get(seq) === bytes);
    };
    return Object.freeze({ requestId, nativeBodyBytes: total('native-body-read'),
      nativeIpcForwardedBytes: total('native-ipc-forwarded'),
      webviewIpcReceivedBytes: total('webview-ipc-received'),
      webviewEnqueuedBytes: total('webview-stream-enqueued'),
      maxNativeInterReadGapUs, lastNativeReadToTerminalUs,
      nativeBodies: count('native-body-read'), semanticEvents: count('native-semantic-progress'),
      webviewReceipts: count('webview-ipc-received'),
      verifiedNativeIpcEquality: complete && oneToOne('native-body-read', 'native-ipc-forwarded'),
      verifiedWebviewEquality: complete && oneToOne('native-ipc-forwarded', 'webview-ipc-received'),
    });
  });
  return Object.freeze({ collectorCoverage: complete ? 'collector-flushed' : 'partial-or-unsealed',
    requests: Object.freeze(requests),
    ollamaGenerationObserved: validated.some(r => r.kind === 'generation-counter'),
    ollamaSocketWriteObserved: validated.some(r => r.kind === 'socket-write-return'),
    sshObserved: validated.some(r => r.layer === 'ssh-encrypted-transport'),
    perRequestSSHDelivery: 'not-established',
    requestSocketCorrelation: 'not-established',
    providerCompletion: 'not-established',
    historicalInference27Cause: 'unresolved',
    forgeBoardAcceptance: 'not-evaluated' });
}

export async function createDeliveryJournal(filename, maxRecords = 65536) {
  assert(Number.isSafeInteger(maxRecords) && maxRecords >= 1 && maxRecords <= 65536,
    'Invalid delivery journal bound');
  const file = await open(filename, 'wx');
  const hash = createHash('sha256');
  let count = 0, dropped = 0, failed = false, sourceLoss = 0, closed = false, sealed = false;
  let sourceFailed = false, kernelCompletions = 0;
  let serial = Promise.resolve();
  const close = async () => { if (closed) return; closed = true; await file.close(); };
  return {
    append(value) {
      const operation = serial.then(async () => {
        assert(!sealed && !failed, 'Delivery journal is unavailable');
        if (count >= maxRecords) { dropped++; return { accepted: false, dropped }; }
        const row = validateDeliveryRecord({ ...value, sequence: count + 1 }, count + 1);
        const text = JSON.stringify(row) + '\n';
        try { await file.writeFile(text); await file.sync(); }
        catch (error) { failed = true; throw error; }
        hash.update(text); count++;
        if (row.kind === 'event-loss') sourceLoss += row.dropped;
        if (row.kind === 'shutdown' && row.endpoint === 'ollama-loopback') {
          if (row.result !== 'ok') sourceFailed = true;
          else kernelCompletions++;
        }
        return { accepted: true, sequence: count };
      });
      serial = operation.then(() => undefined, () => undefined);
      return operation;
    },
    async seal({ expected, deliveryFailed = false, requireKernelSession = false } = {}) {
      await serial;
      assert(!sealed && !failed && dropped === 0 && sourceLoss === 0 && deliveryFailed !== true &&
        expected === count, 'Incomplete delivery collection; do not seal');
      assert(!sourceFailed && (!requireKernelSession || kernelCompletions === 1),
        'Kernel session missing/incomplete; do not seal');
      sealed = true;
      const pending = `${filename}.receipt.json.pending`, final = `${filename}.receipt.json`;
      let handle;
      try {
        await file.sync();
        const receipt = Object.freeze({ schemaVersion: 1, claim: 'collector-flush-only',
          count, dropped, deliveryFailed: false, sha256: hash.digest('hex') });
        handle = await open(pending, 'wx');
        await handle.writeFile(JSON.stringify(receipt) + '\n');
        await handle.sync(); await handle.close(); handle = undefined;
        await link(pending, final);
        await unlink(pending).catch(() => undefined);
        return receipt;
      } finally { await handle?.close(); await close(); }
    },
    async abandon() { await serial; sealed = true; await close(); },
    snapshot() { return Object.freeze({ count, dropped, sourceLoss, failed,
      sourceFailed, kernelCompletions, sealed }); },
  };
}
