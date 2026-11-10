#!/usr/bin/env node
/** Run-owned, loopback-only diagnostic journal. This does not start SSH,
 * Ollama, a model or an Agent. It accepts only allowlisted numeric records.
 * Usage: node scripts/local-muse-delivery-cli.mjs serve <EMPTY_OWNED_ROOT> <RUN_ID>
 * Sidecar: ... import-kernel <URL> <NONCE> <HOST> <ENDPOINT> <UNCERTAINTY_US>
 * DO NOT use a historical run/evidence path. Collectors never overwrite. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readdir, realpath, readFile } from 'node:fs/promises';
import { stdin, stdout, stderr, argv } from 'node:process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { createDeliveryJournal, validateDeliveryRecord,
  interpretDeliveryRecords } from './local-muse-delivery-journal.mjs';
import { parseKernelLine, parseKernelSession, parseRunnerLine, parseSsLine,
  parseWindowsTcpLine, anchoredHostClock, detectCapability } from './local-muse-delivery-sidecar.mjs';

const ID = /^[A-Za-z0-9_-]{1,80}$/;
function parseRootId(folder, runId) {
  assert(typeof runId === 'string' && ID.test(runId), 'Run ID must be opaque and bounded');
  assert(typeof folder === 'string' && path.isAbsolute(folder), 'Root must be absolute');
  return { folder: path.resolve(folder), runId };
}

export function sanitizeHttpRecord(payload, nextSequence, expectedRunId = null) {
  assert(payload && typeof payload === 'object' && !Array.isArray(payload), 'Invalid observation');
  if (expectedRunId !== null) assert(payload.runId === expectedRunId,
    'Observation belongs to a different diagnostic session');
  if (payload.boundary !== undefined) {
    // Actual Rust and WebView production hooks use the same strict receipt
    // shape. Translate to the cross-host envelope; never retain raw extras.
    const allowed = ['schemaVersion', 'host', 'requestId', 'boundary',
      'atUnixMs', 'monoUs', 'sequence', 'bytes', 'dropped', 'runId'];
    assert(Object.keys(payload).every(k => allowed.includes(k)), 'Unapproved native/WebView field');
    const loss = payload.boundary === 'native-collector-loss';
    const layer = loss ? 'collector' : payload.boundary === 'native-semantic-progress'
      ? 'clack-semantic' : payload.boundary.startsWith('webview-')
        ? 'clack-webview' : 'clack-reqwest';
    return validateDeliveryRecord({ schemaVersion: 1, sequence: nextSequence,
      host: loss ? 'collector' : payload.host,
      layer, kind: loss ? 'event-loss' : payload.boundary,
      ...(payload.runId === undefined ? {} : { runId:payload.runId }),
      atUnixMs: payload.atUnixMs, monoUs: payload.monoUs,
      ...(loss ? { dropped: payload.dropped } : {
        requestId: payload.requestId, requestSequence: payload.sequence,
        bytes: payload.bytes, confidence: 'direct' }) }, nextSequence);
  }
  // Producer sequence refers to per-request body chunks, not the journal's
  // global append sequence. Never discard it or invent matching request IDs.
  const { sequence, ...rest } = payload;
  return validateDeliveryRecord({ ...rest, schemaVersion: 1, sequence: nextSequence,
    ...(sequence === undefined ? {} : { requestSequence: sequence }) }, nextSequence);
}

export async function startDeliveryServer(root, runId, { maxRecords = 65536,
  requireKernelSession = false, requireOneSession = false } = {}) {
  const approved = parseRootId(root, runId);
  assert(await realpath(approved.folder) === approved.folder, 'Noncanonical run root');
  assert((await readdir(approved.folder)).length === 0, 'Journal requires an empty run-owned root');
  const filename = path.join(approved.folder, `local-muse-delivery-${runId}.jsonl`);
  const journal = await createDeliveryJournal(filename, maxRecords);
  const nonce = randomBytes(24).toString('hex');
  let closing = false, closeReceipt = null;
  let inputFailed = false;
  // Admission is counted when authenticated request headers arrive, not only
  // when the request body has finished uploading. A sealed receipt must never
  // overtake a partially uploaded observation or its append/fsync ACK.
  let activeObservations = 0;
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const allowed = !origin || /^(?:tauri:\/\/localhost|http:\/\/tauri\.localhost|http:\/\/127\.0\.0\.1:5173)$/.test(origin);
    if (allowed && origin) res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-headers', 'content-type,x-clack-delivery-session');
    res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
    res.setHeader('content-type', 'application/json');
    const answer = (status, object) => { res.writeHead(status); res.end(JSON.stringify(object)); };
    if (!allowed) { answer(403, { ok: false }); return; }
    if (req.method === 'OPTIONS') { answer(200, { ok: true }); return; }
    if (req.method !== 'POST' || !['/v1/observe', '/v1/status', '/v1/finish'].includes(req.url) ||
        req.headers['x-clack-delivery-session'] !== nonce || closing) {
      answer(403, { ok: false }); return;
    }
    const observationAdmitted = req.url === '/v1/observe';
    if (observationAdmitted) activeObservations++;
    const pieces = [];
    let size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024) throw new Error('Oversized diagnostic input');
        pieces.push(chunk);
      }
      const payload = JSON.parse(Buffer.concat(pieces).toString('utf8'));
      if (req.url === '/v1/status') {
        assert(payload && typeof payload === 'object' && !Array.isArray(payload) &&
          Object.keys(payload).length === 0, 'Status request must be empty');
        answer(200, { ok: true, runId, ...journal.snapshot(), activeObservations });
      } else if (req.url === '/v1/observe') {
        const observation = sanitizeHttpRecord(payload, journal.snapshot().count + 1,
          requireOneSession ? runId : null);
        const result = await journal.append(observation);
        answer(result.accepted ? 200 : 429, { ok: result.accepted,
          sequence: result.sequence ?? null });
      } else {
        // Freeze new admissions immediately. Reject an overlapping, already
        // admitted upload rather than sealing an apparently complete journal
        // which may be missing that observation. Preserve raw evidence.
        closing = true;
        assert(activeObservations === 0, 'Delivery observations still in flight');
        assert(payload && typeof payload === 'object' &&
          Object.keys(payload).length === 2 && Number.isSafeInteger(payload.expected) &&
          typeof payload.deliveryFailed === 'boolean', 'Invalid finish request');
        const receipt = await journal.seal({ ...payload,
          deliveryFailed: inputFailed || payload.deliveryFailed, requireKernelSession,
          requireOneSession, runId });
        closing = true; closeReceipt = receipt;
        const raw = await readFile(filename);
        const rows = raw.toString('utf8').split('\n').filter(Boolean).map(JSON.parse);
        const interpretation = interpretDeliveryRecords(rows, receipt, raw);
        answer(200, { ok: true, receipt, interpretation });
      }
    } catch {
      inputFailed = true;
      // The input is never echoed or persisted; a failed capture is not model failure.
      answer(422, { ok: false });
    } finally {
      if (observationAdmitted) activeObservations--;
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
  } catch (error) { await journal.abandon(); throw error; }
  const port = server.address().port;
  const stop = async () => {
    closing = true;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (!closeReceipt) await journal.abandon();
    return journal.snapshot();
  };
  return Object.freeze({ url: `http://127.0.0.1:${port}`, nonce, filename,
    stop, snapshot: () => journal.snapshot() });
}

// CLI is only an operator-facing adapter for an authorized *future* run.
// It cannot install BPF, start inference, alter remote services, or contact SSH.
async function main() {
  const [, , mode, ...args] = argv;
  if (mode === 'capabilities') {
    assert(args.length === 0, 'Capabilities command takes no arguments');
    // Status is descriptive, NOT permission to attach OS probes or run models.
    const isWin = process.platform === 'win32';
    const linux = !isWin && process.platform === 'linux';
    const check = (command, args) => {
      const result = spawnSync(command, args, { timeout: 1500, windowsHide: true,
        stdio: 'ignore' });
      return result.status === 0;
    };
    const bpf = linux && check('bpftrace', ['--version']);
    const ss = linux && check('ss', ['--version']);
    const btf = linux && existsSync('/sys/kernel/btf/vmlinux');
    const privileged = linux && typeof process.getuid === 'function' && process.getuid() === 0;
    stdout.write(JSON.stringify({ schemaVersion: 1, claim: 'read-only discovery; no probe attached',
      local: detectCapability({ host: 'local-ssh', bpftraceInstalled: bpf,
        privileged, btfAvailable: btf, ssAvailable: ss,
        tcpEtwAvailable: false }),
      note: isWin ? 'Windows Get-NetTCPConnection: endpoint states only, no byte counts' :
        'Linux socket tracing requires a separately privileged BPF installation' }) + '\n');
    return;
  }
  if (mode === 'serve') {
    assert(args.length === 2 || args.length === 3 &&
      ['--require-kernel', '--require-one-session'].includes(args[2]),
      'Usage: serve <empty absolute owned root> <run id> [--require-kernel|--require-one-session]');
    const server = await startDeliveryServer(args[0], args[1],
      { requireKernelSession: args[2] === '--require-kernel' ||
          args[2] === '--require-one-session',
        requireOneSession: args[2] === '--require-one-session' });
    stdout.write(JSON.stringify({ endpoint: server.url, ephemeralSessionNonce: server.nonce,
      capacity: 65536, claim: 'collector-only; no inference or model proof' }) + '\n');
    const stop = async () => { const state = await server.stop();
      stderr.write(JSON.stringify({ stopped: true, ...state }) + '\n'); };
    process.once('SIGINT', () => { void stop(); });
    process.once('SIGTERM', () => { void stop(); });
    return;
  }
  if (['import-kernel', 'import-runner', 'import-ss', 'import-windows'].includes(mode)) {
    assert(args.length === (mode === 'import-kernel' ? 7 : 5),
      'Usage: import-* <endpoint> <nonce> <host> <endpoint role> <uncertainty us> [remote anchor unix-us mono-us for kernel]');
    const [url, nonce, host, endpoint, uncertainty, anchorUnixUs, anchorMonoUs] = args;
    assert(/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(url), 'Only loopback collector endpoint');
    assert(/^[a-f0-9]{48}$/.test(nonce), 'Invalid ephemeral collector nonce');
    assert(Number.isSafeInteger(Number(uncertainty)) && Number(uncertainty) > 0,
      'Uncertainty must be measured or conservatively bounded');
    const anchor = mode === 'import-kernel' ? {
      hostUnixUs: Number(anchorUnixUs), hostMonoUs: Number(anchorMonoUs),
      uncertaintyUs: Number(uncertainty),
    } : undefined;
    // Sharing a key between separately started sidecars is explicit and
    // ephemeral. Never write it, print it, or embed it in a receipt. Without
    // it, per-sidecar pseudonyms cannot be matched across restarts.
    const keyText = process.env.CLACK_DELIVERY_SOCKET_PSEUDONYM_KEY;
    if (keyText !== undefined) assert(/^[a-f0-9]{64}$/.test(keyText),
      'Invalid ephemeral socket pseudonym key');
    const key = keyText ? Buffer.from(keyText, 'hex') : randomBytes(32);
    let sequence = 0, total = 0;
    let terminalSeen = false, terminalStored = false, terminalResult = null;
    let attempts = 0, returns = 0;
    let kernelPid = null;
    const pending = new Map();
    let ssHeader = null;
    const sendNormalized = async row => {
      if (!row) return;
      const { sequence: _sourceSeq, ...wire } = row;
      const runId = process.env.CLACK_ONE_MUSE_DIAGNOSTIC_RUN_ID;
      if (runId !== undefined) {
        assert(ID.test(runId), 'Invalid diagnostic run identity');
        wire.runId = runId;
      }
      const response = await fetch(`${url}/v1/observe`, { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-clack-delivery-session': nonce },
        body: JSON.stringify(wire), signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('Collector refused/failed an observation; archive is partial');
      total++;
    };
    const lines = createInterface({ input: stdin, crlfDelay: Infinity });
    const failedKernelStatus = async () => {
      if (terminalStored) return;
      const seq = ++sequence;
      await sendNormalized(validateDeliveryRecord({ schemaVersion: 1, sequence: seq,
        host: 'collector', layer: 'collector', kind: 'shutdown',
        endpoint: 'ollama-loopback', result: 'failed',
        atUnixMs: Date.now(), monoUs: Number(process.hrtime.bigint() / 1000n),
        confidence: 'unavailable' }, seq));
      terminalStored = true;
    };
    try {
    for await (const rawLine of lines) {
      let line = rawLine;
      if (!line.trim()) continue;
      if (mode === 'import-kernel') {
        assert(!terminalSeen, 'Unexpected data after kernel session terminal record');
        if (line.startsWith('TCPSESSION ')) {
          terminalSeen = true;
          const seq = ++sequence;
          terminalResult = parseKernelSession(line, { attempts, returns,
            pending: pending.size, sequence: seq, atUnixMs: Date.now(),
            monoUs: Number(process.hrtime.bigint() / 1000n) });
          // Do not publish successful shutdown until EOF is verified. Any
          // trailing data must invalidate the session rather than leaving a
          // previously accepted success marker in the durable journal.
          continue;
        }
        assert(line.endsWith(' ollama') && line.startsWith('TCPMETA '),
          'Kernel source must contain only Ollama TCP metadata');
        const parts = line.split(' ');
        assert(parts[6] === '11434' && Number(parts[7]) > 0,
          'Ollama kernel source must be a server-side 11434 TCP socket');
        if (kernelPid === null) kernelPid = parts[3];
        else assert(kernelPid === parts[3], 'Kernel session changed its Ollama PID');
        const op = parts[1], identity = `${parts[3]}:${parts[4]}:${parts[5]}`;
        if (op === 'attempt') {
          attempts++;
          assert(![...pending.keys()].some(k => k.startsWith(`${parts[4]}:`)),
            'Overlapping kernel thread sends');
          pending.set(identity, `${parts[6]}:${parts[7]}:${parts[8]}`);
        } else if (op === 'send') {
          returns++;
          assert(pending.get(identity) === `${parts[6]}:${parts[7]}:${parts[8]}`,
            'Unpaired or mismatched kernel send return');
          pending.delete(identity);
        } else throw new Error('Unexpected kernel operation');
      }
      let sourceSsClock;
      if (mode === 'import-ss') {
        const observed = /^SSMETA (\d+) (\d+) (.*)$/.exec(line);
        if (observed) {
          sourceSsClock = {
            atUnixMs: Number(BigInt(observed[1]) / 1000n),
            monoUs: Number(observed[2]),
          };
          assert(Number.isSafeInteger(sourceSsClock.atUnixMs) &&
            Number.isSafeInteger(sourceSsClock.monoUs), 'Invalid remote ss observation clock');
          line = observed[3];
        } else if (host !== 'local-ssh') {
          throw new Error('Remote ss requires on-host timestamped SSMETA rows');
        }
        if (!observed) {
          // Local `ss -tinep` has identity then an indented counter line.
          // SSMETA already contains sanitized, fully joined source fields.
          if (/^\s/.test(line)) {
            if (!ssHeader) continue;
            line = `${ssHeader} ${line.trim()}`;
            ssHeader = null;
          } else {
            ssHeader = line.slice(0, 1024);
            continue;
          }
        }
      }
      // stream input is per line, not provider body data; no raw line persisted.
      let atUnixMs = Date.now();
      let monotonicUs = Number(process.hrtime.bigint() / 1000n);
      if (sourceSsClock) {
        atUnixMs = sourceSsClock.atUnixMs;
        monotonicUs = sourceSsClock.monoUs;
      }
      if (mode === 'import-kernel') {
        const m = /^TCPMETA \w+ (\d{1,20})\b/.exec(line);
        if (!m) throw new Error('Invalid kernel timestamp');
        monotonicUs = Number(BigInt(m[1]) / 1000n);
        const stamp = anchoredHostClock(monotonicUs, anchor);
        atUnixMs = stamp.atUnixMs;
      } else if (mode === 'import-runner') {
        // journalctl -o json includes trustworthy per-host realtime/monotonic
        // stamps. Plain prose log lines MUST NOT be given fake receive clocks.
        const record = JSON.parse(line);
        assert(/^\d+$/.test(record.__REALTIME_TIMESTAMP) &&
          /^\d+$/.test(record.__MONOTONIC_TIMESTAMP), 'Journald event clocks missing');
        atUnixMs = Number(BigInt(record.__REALTIME_TIMESTAMP) / 1000n);
        monotonicUs = Number(record.__MONOTONIC_TIMESTAMP);
        line = record.MESSAGE; // consumed only by strict numeric runner regex
      }
      const props = { key, host, endpoint, atUnixMs, monoUs: monotonicUs,
        clockUncertaintyUs: Number(uncertainty), sequence: ++sequence };
      let row;
      if (mode === 'import-kernel') row = parseKernelLine(line, props);
      else if (mode === 'import-runner') row = parseRunnerLine(line, props);
      else if (mode === 'import-windows') row = parseWindowsTcpLine(line, props);
      else row = parseSsLine(line, props);
      await sendNormalized(row);
    }
    if (mode === 'import-kernel') {
      assert(terminalSeen, 'Missing kernel session terminal record');
      if (terminalResult.lost > 0) {
        const lossSeq = ++sequence;
        await sendNormalized(validateDeliveryRecord({ schemaVersion: 1,
          sequence: lossSeq, host: 'collector', layer: 'collector', kind: 'event-loss',
          atUnixMs: Date.now(), monoUs: Number(process.hrtime.bigint() / 1000n),
          dropped: terminalResult.lost }, lossSeq));
      }
      await sendNormalized(terminalResult.shutdown);
      terminalStored = true;
      assert(terminalResult.complete, 'Kernel session incomplete; collector must not seal');
    }
    } catch (error) {
      if (mode === 'import-kernel') await failedKernelStatus().catch(() => undefined);
      throw error;
    }
    stderr.write(JSON.stringify({ imported: total, claim: 'collector-validated-only' }) + '\n');
    return;
  }
  throw new Error('Unknown mode: serve | import-kernel | import-runner | import-ss | import-windows');
}

if (argv[1] && path.resolve(argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '')))
  main().catch(error => { stderr.write(`Diagnostic CLI error: ${error.message}\n`); process.exitCode = 1; });
