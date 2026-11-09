import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createDeliveryJournal, validateDeliveryRecord,
  interpretDeliveryRecords, clockOffsetBounds, canOrderAcrossHosts } from './local-muse-delivery-journal.mjs';
import { opaqueSocket, parseKernelLine, parseKernelSession, parseRunnerLine, parseSsLine,
  anchoredHostClock, detectCapability,
  parseWindowsTcpLine, correlateCandidate, tcpCounterDelta } from './local-muse-delivery-sidecar.mjs';
import { sanitizeHttpRecord, startDeliveryServer } from './local-muse-delivery-cli.mjs';

const key = Buffer.alloc(32, 7);
const common = { schemaVersion: 1, atUnixMs: 1794196108268, monoUs: 100200,
  sequence: 1 };
const native = (kind, requestSequence, bytes = 0) => ({ ...common,
  host: 'clack-native', layer: kind === 'native-semantic-progress' ? 'clack-semantic' : 'clack-reqwest',
  kind, requestId: 'inference-27', requestSequence, bytes, confidence: 'direct' });
const webview = (kind, requestSequence, bytes = 0) => ({ ...common,
  host: 'clack-webview', layer: 'clack-webview', kind,
  requestId: 'inference-27', requestSequence, bytes, confidence: 'direct' });

test('real metadata envelope: two native 149/153 reads join per-sequence WebView IPC only', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'muse-delivery-'));
  const filename = path.join(folder, 'fresh.jsonl');
  const journal = await createDeliveryJournal(filename);
  const rows = [
    native('native-dispatch', 0),
    native('native-body-read', 1, 149), native('native-semantic-progress', 1),
    native('native-ipc-forwarded', 1, 149), webview('webview-ipc-received', 1, 149),
    webview('webview-stream-enqueued', 1, 149),
    native('native-body-read', 2, 153), native('native-semantic-progress', 2),
    native('native-ipc-forwarded', 2, 153), webview('webview-ipc-received', 2, 153),
    webview('webview-stream-enqueued', 2, 153),
    { ...native('native-terminal', 2), monoUs: 180100200 },
  ];
  for (const row of rows) assert.equal((await journal.append(row)).accepted, true);
  const receipt = await journal.seal({ expected: rows.length });
  const raw = await readFile(filename);
  const original = raw.toString().trim().split('\n').map(JSON.parse);
  const verdict = interpretDeliveryRecords(original, receipt, raw);
  assert.equal(verdict.collectorCoverage, 'collector-flushed');
  assert.deepEqual(verdict.requests.map(r => [r.nativeBodyBytes, r.nativeIpcForwardedBytes,
    r.webviewIpcReceivedBytes, r.webviewEnqueuedBytes]), [[302, 302, 302, 302]]);
  assert.equal(verdict.requests[0].semanticEvents, 2);
  assert.equal(verdict.requests[0].maxNativeInterReadGapUs, 0);
  assert.equal(verdict.requests[0].lastNativeReadToTerminalUs, 180000000,
    'Native observed silence must never be mislabeled as an Ollama stall');
  assert.equal(verdict.requests[0].verifiedNativeIpcEquality, true);
  assert.equal(verdict.requests[0].verifiedWebviewEquality, true);
  assert.equal(verdict.requestSocketCorrelation, 'not-established');
  assert.equal(verdict.perRequestSSHDelivery, 'not-established');
  assert.equal(verdict.providerCompletion, 'not-established');
  assert.equal(verdict.historicalInference27Cause, 'unresolved');
  assert.equal(interpretDeliveryRecords(original, receipt, Buffer.concat([raw, Buffer.from(' ')])).collectorCoverage,
    'partial-or-unsealed');
  await assert.rejects(() => createDeliveryJournal(filename), { code: 'EEXIST' });
  await assert.rejects(() => journal.seal({ expected: rows.length }));
});

test('same total bytes without matching per-request sequences is not a proven join', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'muse-delivery-'));
  const filename = path.join(folder, 'partial.jsonl');
  const journal = await createDeliveryJournal(filename);
  for (const row of [native('native-body-read', 1, 149), native('native-ipc-forwarded', 2, 149),
    webview('webview-ipc-received', 3, 149)]) await journal.append(row);
  const receipt = await journal.seal({ expected: 3 });
  const raw = await readFile(filename);
  const verdict = interpretDeliveryRecords(raw.toString().trim().split('\n').map(JSON.parse), receipt, raw);
  assert.equal(verdict.requests[0].verifiedNativeIpcEquality, false);
  assert.equal(verdict.requests[0].verifiedWebviewEquality, false);
});

test('duplicate source sequences cannot falsely validate aggregate byte equality', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'muse-delivery-'));
  const filename = path.join(folder, 'duplicate.jsonl');
  const journal = await createDeliveryJournal(filename);
  for (const row of [native('native-body-read', 1, 149),
    native('native-body-read', 1, 153),
    native('native-ipc-forwarded', 1, 149),
    native('native-ipc-forwarded', 2, 153)]) await journal.append(row);
  const receipt = await journal.seal({ expected: 4 });
  const raw = await readFile(filename);
  const result = interpretDeliveryRecords(raw.toString().trim().split('\n').map(JSON.parse), receipt, raw);
  assert.equal(result.collectorCoverage, 'collector-flushed');
  assert.equal(result.requests[0].nativeBodyBytes, 302);
  assert.equal(result.requests[0].nativeIpcForwardedBytes, 302);
  assert.equal(result.requests[0].verifiedNativeIpcEquality, false);
});

test('partial/failed kernel sends and buffered downstream reads are NOT equal', () => {
  const socket = opaqueSocket(key, 'ollama:1139:12345');
  const params = { key, host: 'ollama', endpoint: 'ollama-loopback',
    atUnixMs: 1794196108268, clockUncertaintyUs: 5000, sequence: 1 };
  const attempt = parseKernelLine('TCPMETA send 100200000 1139 1139 12345 11434 44000 1000 400 ollama', params);
  assert.equal(attempt.layer, 'ollama-http-write');
  assert.equal(attempt.kind, 'socket-write-return');
  assert.equal(attempt.requestedBytes, 1000);
  assert.equal(attempt.returnedBytes, 400);
  assert.equal(attempt.result, 'partial');
  assert.equal(attempt.socketId, socket);
  assert.equal(attempt.requestId, undefined);
  assert.equal(attempt.bytes, undefined);
  const pending = parseKernelLine('TCPMETA attempt 100150000 1139 1139 12345 11434 44000 1000 0 ollama', params);
  assert.equal(pending.kind, 'socket-write-attempt');
  assert.equal(pending.returnedBytes, undefined,
    'an unreturned kernel call must not become a successful write');
  const blocked = parseKernelLine('TCPMETA send 100300000 1139 1139 12345 11434 44000 1000 -11 ollama', params);
  assert.equal(blocked.result, 'would-block');
  assert.equal(blocked.returnedBytes, 0);
  assert.equal(blocked.kernelReturn, -11, 'Persist signed kernel error, not only zero bytes');
  const remote = parseKernelLine('TCPMETA send 100400000 900 900 5432 23456 22 1850 1850 sshd', params);
  assert.equal(remote.layer, 'ssh-encrypted-transport');
  assert.equal(remote.host, 'remote-ssh');
  assert.equal(remote.bytes, 1850);
  assert.equal(correlateCandidate({ request: { requestId: 'inference-27' }, socket: remote,
    simultaneousConnections: 3 }), 'candidate');
  assert.throws(() => validateDeliveryRecord({ ...attempt, requestId: 'inference-27', confidence: 'direct' }, 1));
  assert.throws(() => validateDeliveryRecord({ ...native('native-semantic-progress', 1), bytes: 400 }, 1));
});

test('bounded kernel session requires exact terminal counts, no loss, no pending sends', () => {
  const args = { attempts: 1, returns: 1, pending: 0, sequence: 1,
    atUnixMs: 1_000_000, monoUs: 2_000_000 };
  const ok = parseKernelSession('TCPSESSION complete 1 1 0 0 1800000', args);
  assert.equal(ok.complete, true);
  assert.equal(ok.shutdown.result, 'ok');
  assert.equal(ok.shutdown.endpoint, 'ollama-loopback');
  assert.throws(() => validateDeliveryRecord({ ...common, host: 'collector',
    layer: 'collector', kind: 'shutdown', result: 'ok', endpoint: 'ollama-loopback' }, 1),
  /needs bounded/);
  for (const sample of [
    'TCPSESSION complete 2 1 0 0 1800000', // missing emitted attempt
    'TCPSESSION complete 1 1 0 3 1800000', // explicit trace loss
    'TCPSESSION complete 1 1 1 0 1800000', // non-returning write
    'TCPSESSION partial 1 1 0 0 1800000', // forced shutdown
    'TCPSESSION complete 1 1 0 0 1800001', // beyond cap
  ]) {
    const row = parseKernelSession(sample, args);
    assert.equal(row.complete, false, sample);
    assert.equal(row.shutdown.result, 'failed');
  }
  assert.throws(() => parseKernelSession('TCPSESSION complete 1 1 0 0 0 PRIVATE_BODY', args));
});

test('required Ollama kernel terminal is fail-closed at durable journal seal', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'muse-kernel-seal-'));
  const absent = await createDeliveryJournal(path.join(folder, 'absent.jsonl'));
  await assert.rejects(() => absent.seal({ expected: 0, requireKernelSession: true }), /Kernel session/);
  await absent.abandon();
  const failed = await createDeliveryJournal(path.join(folder, 'failed.jsonl'));
  const bad = parseKernelSession('TCPSESSION partial 0 0 0 0 0',
    { attempts: 0, returns: 0, pending: 0, sequence: 1, atUnixMs: 1, monoUs: 1 });
  await failed.append(bad.shutdown);
  await assert.rejects(() => failed.seal({ expected: 1 }), /Kernel session/);
  await failed.abandon();
  const good = await createDeliveryJournal(path.join(folder, 'complete.jsonl'));
  const valid = parseKernelSession('TCPSESSION complete 0 0 0 0 1800000',
    { attempts: 0, returns: 0, pending: 0, sequence: 1, atUnixMs: 1, monoUs: 1 });
  await good.append(valid.shutdown);
  const receipt = await good.seal({ expected: 1, requireKernelSession: true });
  assert.equal(receipt.claim, 'collector-flush-only', 'not proof that any Ollama bytes were emitted');
});

test('missing BPF terminal leaves collector unsealable even if importer exits', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'muse-kernel-import-'));
  const server = await startDeliveryServer(folder, 'offline-bpf-incomplete',
    { requireKernelSession: true });
  const headers = { 'content-type': 'application/json',
    'x-clack-delivery-session': server.nonce };
  const child = spawn(process.execPath, ['scripts/local-muse-delivery-cli.mjs',
    'import-kernel', server.url, server.nonce, 'ollama', 'ollama-loopback',
    '5000', '1794196108268000', '100000'], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    child.stdin.end('TCPMETA attempt 100200000 1139 1140 12345 11434 43000 149 0 ollama\n');
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const [code] = await once(child, 'close');
    assert.equal(code, 1);
    assert.match(stderr, /Missing kernel session/);
    const status = await fetch(`${server.url}/v1/status`, { method: 'POST', headers,
      body: '{}' }).then(r => r.json());
    assert.equal(status.sourceFailed, true);
    const finish = await fetch(`${server.url}/v1/finish`, { method: 'POST', headers,
      body: JSON.stringify({ expected: status.count, deliveryFailed: false }) });
    assert.equal(finish.status, 422);
    await assert.rejects(() => stat(`${server.filename}.receipt.json`), { code: 'ENOENT' });
  } finally {
    child.kill();
    await server.stop();
  }
});

test('kernel terminal must be final EOF record, never a premature success marker', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'muse-kernel-extra-'));
  const server = await startDeliveryServer(folder, 'offline-bpf-extra',
    { requireKernelSession: true });
  const child = spawn(process.execPath, ['scripts/local-muse-delivery-cli.mjs',
    'import-kernel', server.url, server.nonce, 'ollama', 'ollama-loopback',
    '5000', '1794196108268000', '100000'], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    child.stdin.end('TCPSESSION complete 0 0 0 0 1000\nTCPMETA attempt 100200000 1139 1140 12345 11434 43000 1 0 ollama\n');
    const [code] = await once(child, 'close');
    assert.equal(code, 1);
    assert.equal(server.snapshot().kernelCompletions, 0);
    assert.equal(server.snapshot().sourceFailed, true);
    await assert.rejects(() => stat(`${server.filename}.receipt.json`), { code: 'ENOENT' });
  } finally { child.kill(); await server.stop(); }
});

test('synthetic kernel source completion seals only collector coverage; loss never does', async () => {
  const make = async (runId, terminal) => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'muse-kernel-source-'));
    const server = await startDeliveryServer(folder, runId, { requireKernelSession: true });
    const post = (route, payload) => fetch(`${server.url}/v1/${route}`, {
      method: 'POST', headers: { 'content-type': 'application/json',
        'x-clack-delivery-session': server.nonce }, body: JSON.stringify(payload) });
    const child = spawn(process.execPath, ['scripts/local-muse-delivery-cli.mjs',
      'import-kernel', server.url, server.nonce, 'ollama', 'ollama-loopback',
      '5000', '1794196108268000', '100000'], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
    try {
      child.stdin.end(terminal);
      const [exitCode] = await once(child, 'close');
      const status = await (await post('status', {})).json();
      const done = await post('finish', { expected: status.count, deliveryFailed: false });
      return { exitCode, status, doneStatus: done.status,
        body: done.status === 200 ? await done.json() : null };
    } finally { child.kill(); await server.stop(); }
  };
  const complete = await make('synthetic-zero-writes', 'TCPSESSION complete 0 0 0 0 250\n');
  assert.equal(complete.exitCode, 0);
  assert.equal(complete.status.kernelCompletions, 1);
  assert.equal(complete.doneStatus, 200);
  assert.equal(complete.body.interpretation.ollamaSocketWriteObserved, false);
  assert.equal(complete.body.interpretation.requestSocketCorrelation, 'not-established');
  const loss = await make('synthetic-kernel-loss', 'TCPSESSION partial 0 0 0 7 250\n');
  assert.equal(loss.exitCode, 1);
  assert.equal(loss.status.sourceFailed, true);
  assert.equal(loss.status.sourceLoss, 7);
  assert.equal(loss.doneStatus, 422);
});

test('runner counts establish no HTTP or TCP bytes; sensitive original line is discarded', () => {
  const sample = 'private text that MUST NOT be logged slot print_timing: id 0 | task 4752 | n_gen = 1640, tg = 9.2';
  const event = parseRunnerLine(sample, { key, atUnixMs: 1794196287000, monoUs: 181000000, sequence: 1 });
  assert.equal(event.generatedTokens, 1640);
  assert.equal(event.layer, 'ollama-runner');
  assert.equal(event.requestId, undefined);
  const raw = JSON.stringify(event);
  assert.equal(raw.includes('private text'), false);
  assert.equal(raw.includes('4752'), false);
  assert.equal(event.bytes, undefined);
  assert.equal(event.returnedBytes, undefined);
  assert.equal(parseRunnerLine('HTTP 200 /api/chat', { key, atUnixMs: 1, monoUs: 1, sequence: 1 }), null);
});

test('SSH multiplexing/ACK/retransmission are transport-only and counter resets invalidate deltas', () => {
  const args = { key, host: 'remote-ssh', endpoint: 'encrypted-ssh',
    atUnixMs: 100, monoUs: 500, sequence: 1 };
  const before = parseSsLine('ino:44 local_port:22 remote_port:44300 bytes_sent:100 bytes_acked:70 bytes_received:20 bytes_retrans:8', args);
  const after = parseSsLine('ino:44 local_port:22 remote_port:44300 bytes_sent:310 bytes_acked:210 bytes_received:190 bytes_retrans:28', args);
  assert.equal(before.layer, 'ssh-encrypted-transport');
  const forward = parseSsLine('ino:55 local_port:11434 remote_port:45100 bytes_sent:302 bytes_received:130',
    { ...args, sequence: 2, endpoint: 'remote-forward' });
  assert.equal(forward.layer, 'remote-ssh-forward');
  assert.equal(forward.bytes, 302);
  assert.equal(parseSsLine('ino:56 bytes_sent:302', args), null,
    'Unknown remote TCP port must not be given a guessed boundary');
  assert.equal(tcpCounterDelta(before, after, 'bytes'), 210);
  assert.equal(tcpCounterDelta(before, after, 'ackedBytes'), 140);
  assert.equal(tcpCounterDelta(before, after, 'retransmittedBytes'), 20);
  assert.equal(tcpCounterDelta(after, before, 'ackedBytes'), null);
  assert.equal(tcpCounterDelta(before, { ...after, socketId: 'sk_another' }, 'bytes'), null);
  assert.equal(correlateCandidate({ request: { requestId: 'inference-27' }, socket: after,
    simultaneousConnections: 1, hasKernelSocketId: true, hasSshChannelId: true }), 'candidate');
  assert.equal(parseWindowsTcpLine('WINMETA 7756 11435 49001 Established',
    { key, atUnixMs: 100, monoUs: 100, sequence: 1 }).layer, 'local-forwarded-tcp');
  const local = parseWindowsTcpLine('WINMETA 7756 11435 49001 Established',
    { key, atUnixMs: 100, monoUs: 100, sequence: 1 });
  assert.equal(local.bytes, undefined, 'Get-NetTCPConnection does not expose byte counters');
});

test('clock ordering respects uncertainty: no fake global monotonic or per-request SSH attribution', () => {
  const correction = clockOffsetBounds({ clientSendUnixUs: 1000000,
    clientReceiveUnixUs: 1020000, remoteUnixUs: 1005000,
    clientSendMonoUs: 1, clientReceiveMonoUs: 20001, tickUs: 1000 });
  assert.equal(correction.estimateUs, 5000);
  assert.equal(correction.uncertaintyUs, 11000);
  assert.equal(correction.comparableMono, false);
  const a = { host: 'ollama', monoUs: 1000, atUnixMs: 1000 };
  const b = { host: 'clack-native', monoUs: 1, atUnixMs: 1000 };
  assert.equal(canOrderAcrossHosts(a, b), 'unknown');
  assert.equal(canOrderAcrossHosts(a, b, correction, correction), 'unknown');
  assert.equal(canOrderAcrossHosts({ ...a, host: b.host, monoUs: 0 }, b), 'unknown',
    'Same host alone does not prove same monotonic origin');
  assert.equal(canOrderAcrossHosts({ ...a, host: b.host, monoUs: 0, clockDomain: 'run-native' },
    { ...b, clockDomain: 'run-native' }), 'shared-domain-monotonic');
  assert.throws(() => clockOffsetBounds({ clientSendUnixUs: 2,
    clientReceiveUnixUs: 1, remoteUnixUs: 1, clientSendMonoUs: 1, clientReceiveMonoUs: 2 }));
  const anchored = anchoredHostClock(12_000_000,
    { hostMonoUs: 11_000_000, hostUnixUs: 1794196108268000, uncertaintyUs: 22000 });
  assert.equal(anchored.atUnixMs, 1794196109268);
  assert.equal(anchored.clockUncertaintyUs, 22000);
  assert.throws(() => anchoredHostClock(12_000_000, null));
  assert.equal(detectCapability({ host: 'ollama', bpftraceInstalled: true,
    privileged: true, btfAvailable: true, ssAvailable: true }).httpSocketWrite,
  'unverified', 'dependencies are not a live probe result');
});

test('loss/overflow/failed seal preserve partial raw records and prohibit a complete receipt', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'muse-loss-'));
  const f = path.join(dir, 'bounded.jsonl');
  const journal = await createDeliveryJournal(f, 1);
  await journal.append(native('native-body-read', 1, 149));
  assert.equal((await journal.append(native('native-body-read', 2, 153))).accepted, false);
  assert.deepEqual(journal.snapshot().dropped, 1);
  await assert.rejects(() => journal.seal({ expected: 1 }));
  await journal.abandon();
  assert.equal((await stat(f)).size > 0, true);
  await assert.rejects(() => stat(`${f}.receipt.json`), { code: 'ENOENT' });
  const source = await createDeliveryJournal(path.join(dir, 'source.jsonl'));
  await source.append({ ...common, host: 'collector', layer: 'collector', kind: 'event-loss', dropped: 3 });
  await assert.rejects(() => source.seal({ expected: 1 }));
  await source.abandon();
});

test('collector capabilities and clock anchors are recorded only as closed-vocabulary metadata', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'muse-capability-'));
  const filename = path.join(folder, 'capabilities.jsonl');
  const journal = await createDeliveryJournal(filename);
  const capability = { ...common, host: 'collector', layer: 'collector',
    kind: 'capability', capability: 'unavailable', clockUncertaintyUs: 1000 };
  const anchor = { ...common, host: 'collector', layer: 'collector',
    kind: 'clock-anchor', clockUncertaintyUs: 2500 };
  await journal.append(capability);
  await journal.append(anchor);
  const receipt = await journal.seal({ expected: 2 });
  const raw = await readFile(filename);
  assert.equal(interpretDeliveryRecords(raw.toString().trim().split('\n').map(JSON.parse),
    receipt, raw).collectorCoverage, 'collector-flushed');
  assert.throws(() => validateDeliveryRecord({ ...capability,
    requestId: 'inference-27' }, 1), /cannot claim/);
  assert.throws(() => validateDeliveryRecord({ ...capability, capability: 'private-credentials' }, 1));
});

test('privacy strictness rejects bodies, credentials, URLs, invalid IDs, and fabricated byte claims', () => {
  assert.throws(() => validateDeliveryRecord({ ...native('native-body-read', 1, 149),
    responseBody: 'PRIVATE_PROMPT' }, 1), /Unexpected/);
  assert.throws(() => validateDeliveryRecord({ ...native('native-body-read', 1, 149),
    authorization: 'Bearer PRIVATE' }, 1));
  assert.throws(() => validateDeliveryRecord({ ...native('native-body-read', 1, 149),
    requestId: 'model/request?prompt=private' }, 1));
  assert.throws(() => validateDeliveryRecord({ ...common, host: 'ollama', layer: 'ollama-runner',
    kind: 'generation-counter', generatedTokens: 1640, bytes: 1600 }, 1));
  assert.throws(() => sanitizeHttpRecord({ boundary: 'native-body-read', requestId: 'inference-27',
    bytes: 149, prompt: 'private' }, 1));
});

test('loopback collector handles actual native/WebView receipt schema without opening any model', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'muse-http-'));
  const server = await startDeliveryServer(dir, 'synthetic-delivery-test');
  const post = async (route, payload) => fetch(`${server.url}/v1/${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json',
      'x-clack-delivery-session': server.nonce }, body: JSON.stringify(payload),
  });
  try {
    for (const row of [
      { schemaVersion: 1, host: 'clack-native', requestId: 'inference-1',
        boundary: 'native-body-read', sequence: 1, bytes: 149, atUnixMs: 1000, monoUs: 50 },
      { schemaVersion: 1, host: 'clack-native', requestId: 'inference-1',
        boundary: 'native-ipc-forwarded', sequence: 1, bytes: 149, atUnixMs: 1000, monoUs: 51 },
      { schemaVersion: 1, host: 'clack-webview', requestId: 'inference-1',
        boundary: 'webview-ipc-received', sequence: 1, bytes: 149, atUnixMs: 1000, monoUs: 52 },
    ]) {
      const response = await post('observe', row);
      assert.equal(response.status, 200);
    }
    const done = await post('finish', { expected: 3, deliveryFailed: false });
    assert.equal(done.status, 200);
    const result = await done.json();
    assert.equal(result.interpretation.requests[0].verifiedNativeIpcEquality, true);
    assert.equal(result.interpretation.requests[0].verifiedWebviewEquality, true);
    assert.equal(result.interpretation.providerCompletion, 'not-established');
    assert.equal(result.receipt.count, 3);
  } finally { await server.stop(); }
});

test('malformed collector input fails closed with no successful receipt', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'muse-http-loss-'));
  const server = await startDeliveryServer(dir, 'synthetic-partial-test');
  const post = (route, payload) => fetch(`${server.url}/v1/${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json',
      'x-clack-delivery-session': server.nonce }, body: JSON.stringify(payload),
  });
  try {
    assert.equal((await post('observe', { ...native('native-body-read', 1, 149),
      content: 'DONOTPERSIST' })).status, 422);
    assert.equal((await post('finish', { expected: 0, deliveryFailed: false })).status, 422);
  } finally { await server.stop(); }
  const names = await import('node:fs/promises').then(fs => fs.readdir(dir));
  assert.equal(names.some(name => name.endsWith('.receipt.json')), false);
  assert.equal((await readFile(path.join(dir, names[0]), 'utf8')).includes('DONOTPERSIST'), false);
});

test('finish cannot seal while an authenticated observation body is still uploading', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'muse-inflight-'));
  const server = await startDeliveryServer(dir, 'synthetic-inflight-test');
  const payload = JSON.stringify({ schemaVersion: 1, host: 'clack-native',
    requestId: 'inference-27', boundary: 'native-body-read',
    sequence: 1, bytes: 149, atUnixMs: 1794196108268, monoUs: 100200 });
  const headers = { 'content-type': 'application/json',
    'x-clack-delivery-session': server.nonce };
  const request = httpRequest(`${server.url}/v1/observe`, { method: 'POST',
    headers: { ...headers, 'content-length': Buffer.byteLength(payload) } });
  const observationResponse = new Promise((resolve, reject) => {
    request.on('response', res => {
      const status = res.statusCode;
      res.resume();
      res.once('end', () => resolve(status));
      res.once('error', reject);
    });
    request.once('error', reject);
  });
  try {
    // Force an accepted request to remain incomplete while the operator
    // attempts to seal. The status route proves that headers were admitted.
    request.write(payload.slice(0, 24));
    let active = 0;
    for (let i = 0; i < 40; i++) {
      const response = await fetch(`${server.url}/v1/status`, { method: 'POST',
        headers, body: '{}' });
      assert.equal(response.status, 200);
      active = (await response.json()).activeObservations;
      if (active === 1) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(active, 1, 'A partial observation must be admitted before finish');
    const prematureFinish = await fetch(`${server.url}/v1/finish`, { method: 'POST',
      headers, body: JSON.stringify({ expected: 0, deliveryFailed: false }) });
    assert.equal(prematureFinish.status, 422, 'Concurrent seal must fail closed');
    request.end(payload.slice(24));
    assert.equal(await observationResponse, 200, 'Raw admitted evidence remains preserved');
    assert.equal(server.snapshot().count, 1);
    await assert.rejects(() => stat(`${server.filename}.receipt.json`),
      { code: 'ENOENT' });
    assert.equal((await readFile(server.filename, 'utf8')).includes('native-body-read'), true);
  } finally {
    request.destroy();
    await server.stop();
  }
});

test('actual synthetic TCP loopback: queued writes precede delayed downstream reads', async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const client = net.connect(server.address().port, '127.0.0.1');
  client.pause();
  const [peer] = await once(server, 'connection');
  let writesQueued = 0, bytesReadByClient = 0;
  const bodyRead = [];
  const bytes149 = Buffer.alloc(149, 5), bytes153 = Buffer.alloc(153, 6);
  client.on('data', bytes => { bytesReadByClient += bytes.length; bodyRead.push(bytes); });
  try {
    await new Promise((resolve, reject) => peer.write(bytes149, error => {
      if (error) return reject(error);
      writesQueued += 149; resolve();
    }));
    assert.equal(writesQueued, 149);
    assert.equal(bytesReadByClient, 0,
      'Successful local socket enqueue is not proof the receiver read bytes');
    await new Promise(resolve => setTimeout(resolve, 20));
    client.resume();
    await new Promise((resolve, reject) => peer.write(bytes153, error => {
      if (error) return reject(error);
      writesQueued += 153; resolve();
    }));
    peer.end();
    await once(client, 'end');
    assert.equal(writesQueued, 302);
    assert.equal(bytesReadByClient, 302);
    assert.equal(Buffer.concat(bodyRead).length, 302);
    assert.equal(bodyRead.length >= 1, true, 'TCP coalescing is allowed');
  } finally {
    client.destroy(); peer.destroy();
    await new Promise(resolve => server.close(resolve));
  }
});

test('abrupt synthetic TCP close cannot assert an unavailable 153-byte continuation', async () => {
  const server = net.createServer(socket => {
    socket.write(Buffer.alloc(149, 9), () => socket.destroy());
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const peer = net.connect(server.address().port, '127.0.0.1');
  let received = 0;
  peer.on('data', bytes => { received += bytes.length; });
  peer.on('error', () => { /* connection interruption is the synthetic input */ });
  try {
    await once(peer, 'close');
    assert(received <= 149, 'An interrupted TCP socket cannot deliver absent bytes');
    assert(received !== 302);
  } finally {
    peer.destroy();
    await new Promise(resolve => server.close(resolve));
  }
});

test('synthetic multiplexed SSH-compatible framed transport cannot prove per-request delivery', () => {
  // Synthetic framing overhead and two logical channels; deliberately NOT a
  // true SSH implementation, packet capture, or historic failure replay.
  const frame = (channel, payloadBytes) => Buffer.concat([
    Buffer.from([0, channel, 0, 0, payloadBytes]), Buffer.alloc(payloadBytes, channel),
  ]);
  const packets = [frame(1, 149), frame(2, 77), frame(1, 153)];
  const encryptedTransportBytes = packets.reduce((n, p) => n + p.length, 0);
  const applicationBytesForOneChannel = 149 + 153;
  assert.equal(encryptedTransportBytes, applicationBytesForOneChannel + 77 + 15);
  assert.notEqual(encryptedTransportBytes, applicationBytesForOneChannel);
  const candidate = correlateCandidate({ request: { requestId: 'inference-27' },
    socket: { socketId: opaqueSocket(key, 'ssh:tcp-transport') },
    simultaneousConnections: 2, hasKernelSocketId: true, hasSshChannelId: false });
  assert.equal(candidate, 'candidate');
});
