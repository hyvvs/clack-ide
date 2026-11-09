/** Content-free adapters for separately authorized OS collection. Never
 * persist raw journalctl, ss or kernel-tracer lines: parse into allowlists. */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { validateDeliveryRecord } from './local-muse-delivery-journal.mjs';

const finite = n => Number.isSafeInteger(n) && n >= 0;
/** Map a kernel CLOCK_MONOTONIC value to its *own* host wall time only after
 * an explicit same-host anchor and conservative uncertainty. Never use the
 * collector's receive time as if it were the remote kernel event time. */
export function anchoredHostClock(eventMonoUs, anchor) {
  assert(finite(eventMonoUs) && anchor && finite(anchor.hostMonoUs) &&
    finite(anchor.hostUnixUs) && finite(anchor.uncertaintyUs) &&
    anchor.uncertaintyUs > 0, 'Remote host clock anchor required');
  const diff = eventMonoUs - anchor.hostMonoUs;
  assert(Math.abs(diff) <= 24 * 3600 * 1_000_000, 'Clock anchor too far from event');
  const atUs = anchor.hostUnixUs + diff;
  assert(finite(atUs), 'Invalid anchored wall clock');
  return Object.freeze({ atUnixMs: Math.floor(atUs / 1000),
    clockUncertaintyUs: anchor.uncertaintyUs });
}

export function detectCapability({ host, bpftraceInstalled, privileged,
  btfAvailable, ssAvailable, tcpEtwAvailable = false }) {
  assert(['ollama', 'remote-ssh', 'local-ssh'].includes(host), 'Unknown host');
  return Object.freeze({ host,
    httpSocketWrite: host === 'ollama' && bpftraceInstalled && privileged && btfAvailable
      ? 'unverified' : 'unavailable',
    tcpCounters: ssAvailable ? 'unverified' : 'unavailable',
    windowsEtw: tcpEtwAvailable ? 'unverified' : 'unavailable',
    privilege: privileged ? 'available' : 'permission-denied',
    liveVerified: false });
}
export function opaqueSocket(key, raw) {
  assert(Buffer.isBuffer(key) && key.length >= 16, 'Ephemeral socket pseudonym key required');
  assert(typeof raw === 'string' && /^[A-Za-z0-9:._-]{1,120}$/.test(raw),
    'Invalid kernel socket identity');
  return `sk_${createHmac('sha256', key).update(raw).digest('hex').slice(0, 24)}`;
}

/** Linux bpftrace output: event, nsecs, pid, tid, skaddr, local port,
 * remote port, attempted len, syscall/kernel-return. Ports are normalized by
 * the BPF source; kernel socket pointers are *only* HMAC inputs, never output.
 * A successful tcp_sendmsg is bytes queued by TCP, not SSH forwarding/ACK. */
export function parseKernelLine(line, { key, host, endpoint, atUnixMs,
  clockUncertaintyUs = 0, sequence }) {
  const fields = line.trim().split(/\s+/);
  assert(fields.length === 11 && fields[0] === 'TCPMETA', 'Unrecognized kernel event');
  const [, op, nsec, pid, tid, rawSk, localPort, remotePort, attempted, returned, comm] = fields;
  assert(['ollama', 'ssh', 'sshd', 'sshd-session'].includes(comm), 'Unknown process class');
  assert(['send', 'recv', 'retransmit', 'attempt'].includes(op), 'Unsupported kernel operation');
  for (const field of [pid, tid, localPort, remotePort, attempted])
    assert(/^\d+$/.test(field) && finite(Number(field)), 'Invalid kernel counter');
  assert(/^\d{1,20}$/.test(nsec) && /^\d{1,20}$/.test(rawSk), 'Invalid monotonic/socket identity');
  const monoUs = BigInt(nsec) / 1000n;
  assert(monoUs <= BigInt(Number.MAX_SAFE_INTEGER), 'Monotonic overflow');
  assert(/^-?\d+$/.test(returned) && Number.isSafeInteger(Number(returned)), 'Invalid kernel return');
  assert(Number(localPort) <= 65535 && Number(remotePort) <= 65535, 'Invalid port');
  assert(finite(atUnixMs) && finite(sequence) && finite(clockUncertaintyUs), 'Invalid clock/sequence');
  assert(['ollama', 'remote-ssh', 'local-ssh'].includes(host), 'Invalid kernel host');
  const realHost = comm === 'ollama' ? 'ollama' : host === 'local-ssh' ? host : 'remote-ssh';
  const portPair = [Number(localPort), Number(remotePort)];
  const isOllama = realHost === 'ollama' && portPair.includes(11434);
  const isEncrypted = portPair.includes(22);
  if (op === 'attempt' && !isOllama) return null;
  const layer = isOllama && (op === 'send' || op === 'attempt') ? 'ollama-http-write'
    : isEncrypted ? 'ssh-encrypted-transport'
      : host === 'local-ssh' ? 'local-forwarded-tcp' : 'remote-ssh-forward';
  const result = Number(returned);
  const base = { schemaVersion: 1, sequence, host: realHost, layer,
    atUnixMs, monoUs: Number(monoUs),
    socketId: opaqueSocket(key, `${realHost}:${pid}:${rawSk}`),
    localPort: Number(localPort), remotePort: Number(remotePort),
    endpoint: isEncrypted ? 'encrypted-ssh' :
      isOllama ? 'ollama-loopback' : endpoint,
    clockUncertaintyUs };
  let row;
  if (layer === 'ollama-http-write') {
    row = { ...base, kind: op === 'attempt' ? 'socket-write-attempt' : 'socket-write-return',
      requestedBytes: Number(attempted),
      ...(op === 'attempt' ? {} : { returnedBytes: Math.max(0, result),
        kernelReturn: result,
        result: result === -11 ? 'would-block' : result < 0 ? 'failed'
          : result === Number(attempted) ? 'ok' : 'partial' }),
      confidence: 'unavailable' };
  } else {
    row = { ...base, kind: op === 'retransmit' ? 'tcp-retransmit' : `tcp-${op}`,
      bytes: Math.max(0, result), confidence: 'unavailable',
      ...(op === 'retransmit' ? { retransmittedBytes: Number(attempted) } : {}) };
  }
  return validateDeliveryRecord(row, sequence);
}

/** Mandatory terminal attestation from the bounded Linux BPF supervisor.
 * A success claim is source-collector coverage, not Ollama HTTP delivery.
 * The importer independently checks counts and unfinished thread/socket pairs. */
export function parseKernelSession(line, { attempts, returns, pending, sequence,
  atUnixMs, monoUs }) {
  const match = /^TCPSESSION (complete|partial) (\d+) (\d+) (\d+) (\d+) (\d+)$/.exec(line);
  assert(match, 'Missing or invalid bounded kernel session status');
  const [, state, attemptText, returnText, pendingText, lostText, durationText] = match;
  const counters = [attemptText, returnText, pendingText, lostText, durationText].map(Number);
  assert(counters.every(finite), 'Invalid kernel session counters');
  const [sourceAttempts, sourceReturns, sourcePending, lost, durationMs] = counters;
  const complete = state === 'complete' && sourceAttempts === attempts &&
    sourceReturns === returns && sourcePending === pending && pending === 0 &&
    lost === 0 && durationMs <= 1_800_000;
  const shutdown = validateDeliveryRecord({ schemaVersion: 1, host: 'collector',
    layer: 'collector', kind: 'shutdown', sequence, atUnixMs, monoUs,
    endpoint: 'ollama-loopback', result: complete ? 'ok' : 'failed',
    kernelAttempts: sourceAttempts, kernelReturns: sourceReturns,
    pendingWrites: sourcePending, durationMs, dropped: lost,
    confidence: 'unavailable' }, sequence);
  return Object.freeze({ shutdown, lost, complete });
}

/** Ollama journal generation counters prove runner progress, not HTTP output.
 * Request ID is intentionally absent: a runner task ID is not a Clack ID. */
export function parseRunnerLine(line, { key, atUnixMs, monoUs, sequence }) {
  const match = /\btask\s+(\d+)\s*\|\s*n_gen\s*=\s*(\d+)\b/.exec(line);
  if (!match) return null;
  const generated = Number(match[2]);
  assert(finite(generated) && finite(atUnixMs) && finite(monoUs), 'Invalid runner counter');
  return validateDeliveryRecord({ schemaVersion: 1, sequence, host: 'ollama',
    layer: 'ollama-runner', kind: 'generation-counter', atUnixMs, monoUs,
    connectionId: opaqueSocket(key, `ollama-runner-task:${match[1]}`),
    generatedTokens: generated, confidence: 'unavailable' }, sequence);
}

/** `ss -tine` counters are cumulative snapshots of a TCP socket. TCP ACKs
 * confirm peer TCP acknowledgment of transport bytes, not process reads. */
export function parseSsLine(line, { key, host, endpoint, atUnixMs, monoUs, sequence }) {
  const inode = /\bino:(\d+)\b/.exec(line);
  if (!inode) return null; // No trustworthy socket identity, so no receipt.
  const counter = name => {
    const m = new RegExp(`\\b${name}:(\\d+)\\b`).exec(line);
    return m ? Number(m[1]) : undefined;
  };
  const transmitted = counter('bytes_sent'), acked = counter('bytes_acked'),
    received = counter('bytes_received'), retransmitted = counter('bytes_retrans');
  if (![transmitted, acked, received, retransmitted].some(finite)) return null;
  const localPort = counter('local_port'), remotePort = counter('remote_port');
  if (localPort !== undefined && localPort > 65535 ||
      remotePort !== undefined && remotePort > 65535) return null;
  // Remote on-host snapshots MUST include ports to distinguish the forwarding
  // loopback socket from encrypted SSH transport. Without them do not claim a
  // boundary; older local synthetic fixtures may use an explicit role.
  if (host !== 'local-ssh' && (!finite(localPort) || !finite(remotePort))) return null;
  const portPair = [localPort, remotePort];
  const resolvedEndpoint = portPair.includes(22) ? 'encrypted-ssh'
    : portPair.includes(11435) ? 'local-forward'
      : portPair.includes(11434) ? 'remote-forward' : endpoint;
  const layer = resolvedEndpoint === 'encrypted-ssh' ? 'ssh-encrypted-transport'
    : host === 'local-ssh' ? 'local-forwarded-tcp' : 'remote-ssh-forward';
  return validateDeliveryRecord({ schemaVersion: 1, sequence, host, layer,
    kind: 'tcp-snapshot', atUnixMs, monoUs,
    socketId: opaqueSocket(key, `${host}:${inode[1]}`), endpoint: resolvedEndpoint,
    confidence: 'unavailable',
    ...(finite(localPort) ? { localPort } : {}),
    ...(finite(remotePort) ? { remotePort } : {}),
    ...(finite(transmitted) ? { bytes: transmitted } : {}),
    ...(finite(acked) ? { ackedBytes: acked } : {}),
    ...(finite(received) ? { receivedBytes: received } : {}),
    ...(finite(retransmitted) ? { retransmittedBytes: retransmitted } : {}) }, sequence);
}

/** Read-only Windows Get-NetTCPConnection states. No packet or byte counters
 * are available. The tuple-derived ID is only a candidate and may be reused. */
export function parseWindowsTcpLine(line, { key, atUnixMs, monoUs, sequence }) {
  const m = /^WINMETA (\d+) (\d+) (\d+) (Established|Listen|TimeWait|CloseWait)\b/.exec(line);
  if (!m) return null;
  const [, pid, localPort, remotePort] = m;
  if (![pid, localPort, remotePort].every(n => finite(Number(n))) ||
      Number(localPort) > 65535 || Number(remotePort) > 65535) return null;
  const isForwarded = Number(localPort) === 11435 || Number(remotePort) === 11435;
  const layer = isForwarded ? 'local-forwarded-tcp' : 'ssh-encrypted-transport';
  return validateDeliveryRecord({ schemaVersion: 1, sequence, host: 'local-ssh', layer,
    kind: 'tcp-snapshot', atUnixMs, monoUs,
    socketId: opaqueSocket(key, `windows-candidate:${pid}:${localPort}:${remotePort}`),
    localPort: Number(localPort), remotePort: Number(remotePort),
    endpoint: isForwarded ? 'local-forward' : 'encrypted-ssh',
    confidence: 'unavailable' }, sequence);
}

/** A candidate can be described, but cannot be promoted to a direct join.
 * Reqwest does not expose its kernel socket ID, and SSH may multiplex flows. */
export function correlateCandidate({ request, socket, simultaneousConnections = 0,
  hasKernelSocketId = false, hasSshChannelId = false }) {
  if (!request?.requestId || !socket?.socketId) return 'unavailable';
  if (simultaneousConnections > 1 || !hasKernelSocketId || !hasSshChannelId)
    return 'candidate';
  // Even one socket and a channel identity do not prove delivery without the
  // corresponding byte counters or directly linked request/application scope.
  return 'candidate';
}

export function tcpCounterDelta(before, after, field) {
  assert(['bytes', 'ackedBytes', 'receivedBytes', 'retransmittedBytes'].includes(field),
    'Unapproved counter');
  if (!before || !after || before.socketId !== after.socketId ||
      !finite(before[field]) || !finite(after[field]) || after[field] < before[field])
    return null; // reset, churn, or ambiguous socket identity
  return after[field] - before[field];
}
