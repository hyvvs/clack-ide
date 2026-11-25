// Independent, read-only operator oracle. Never run this inside Clack, the
// AppContainer, model tool context, or a browser page.
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function summarizeOracle(record, nonce, origin) {
  if (!/^[a-z0-9][a-z0-9-]{14,62}[a-z0-9]$/.test(nonce)
      || record?.runNonce !== nonce || !Array.isArray(record.events)
      || record.events.length > 100_000)
    throw new Error('oracle-run-scope-invalid');
  const events = record.events.filter(e => e.runNonce === nonce);
  const ids = new Set();
  for (const event of events) {
    if (!/^[a-f0-9-]{36}$/.test(event.eventId ?? '') || ids.has(event.eventId)
        || !Number.isFinite(Date.parse(event.at)) || !['GET', 'POST'].includes(event.method)
        || typeof event.path !== 'string' || !event.path.startsWith('/')) {
      throw new Error('oracle-event-invalid-or-duplicate');
    }
    ids.add(event.eventId);
    if (event.disposition === 'one-write-accepted'
        && (event.method !== 'POST' || event.status !== 201
            || !/^[a-f0-9]{64}$/.test(event.bodySha256 ?? '')
            || !Number.isSafeInteger(event.bodyBytes) || event.bodyBytes < 1
            || event.bodyBytes > 64 * 1024
            || ![`/case/${nonce}/form`, `/case/${nonce}/upload`].includes(event.path))) {
      throw new Error('oracle-write-evidence-invalid');
    }
  }
  const accepted = events.filter(e => e.disposition === 'one-write-accepted');
  const denied = events.filter(e => e.disposition === 'replay-denied');
  const attempts = events.filter(e => e.disposition === 'post-ingress');
  const byAttempt = new Map();
  const positions = new Map(events.map((event, index) => [event, index]));
  const uuid = /^[a-f0-9-]{36}$/;
  for (const event of attempts) {
    if (event.method !== 'POST' || !uuid.test(event.attemptId ?? '')
        || byAttempt.has(event.attemptId)
        || ![`/case/${nonce}/form`, `/case/${nonce}/upload`, '/__other-post'].includes(event.path))
      throw new Error('oracle-ingress-invalid');
    byAttempt.set(event.attemptId, event);
  }
  const outcomes = new Map();
  for (const event of [...accepted, ...denied]) {
    // Historical ledgers lack ingress IDs. Do not infer zero historical attempts.
    if (event.attemptId === undefined) continue;
    const ingress = byAttempt.get(event.attemptId);
    if (!ingress || ingress.path !== event.path || outcomes.has(event.attemptId)
        || positions.get(ingress) >= positions.get(event))
      throw new Error('oracle-write-ingress-mismatch');
    outcomes.set(event.attemptId, event);
  }
  const holdEnds = events.filter(e => ['held-response-disconnected', 'held-response-release'].includes(e.disposition));
  const ended = new Set();
  for (const event of holdEnds) {
    const write = outcomes.get(event.attemptId);
    if (!write || write.disposition !== 'one-write-accepted'
        || event.method !== 'POST' || event.path !== `/case/${nonce}/form`
        || write.path !== event.path || !Number.isSafeInteger(write.responseHoldMs)
        || write.responseHoldMs < 1 || write.responseHoldMs > 30000
        || ended.has(event.attemptId) || positions.get(write) >= positions.get(event))
      throw new Error('oracle-response-hold-mismatch');
    ended.add(event.attemptId);
  }
  return {
    runNonce: nonce, oracleOrigin: origin, events: events.length,
    independentNavigationRequests: events.filter(e =>
      e.method === 'GET' && e.path === `/case/${nonce}/next`).length,
    formAccepted: accepted.filter(e => e.path === `/case/${nonce}/form`).length,
    uploadAccepted: accepted.filter(e => e.path === `/case/${nonce}/upload`).length,
    replayDenied: denied.length,
    // Counts cover parsed POST requests recorded by this implementation only.
    // A fresh, isolated nonce/ledger is required for a no-replay conclusion.
    recordedPostAttempts: attempts.length,
    formPostAttempts: attempts.filter(e => e.path === `/case/${nonce}/form`).length,
    uploadPostAttempts: attempts.filter(e => e.path === `/case/${nonce}/upload`).length,
    otherPostAttempts: attempts.filter(e => e.path === '/__other-post').length,
    legacyUnlinkedWriteOutcomes: [...accepted, ...denied].filter(e => e.attemptId === undefined).length,
    heldResponseEvidence: holdEnds.map(({ eventId, attemptId, disposition, at }) =>
      ({ eventId, attemptId, disposition, at })),
    acceptedWriteEvidence: accepted.map(({ eventId, method, path, bodySha256, bodyBytes, at, attemptId, responseHoldMs }) =>
      ({ eventId, method, path, bodySha256, bodyBytes, at, attemptId, responseHoldMs })),
    eventSetSha256: createHash('sha256').update(JSON.stringify(events)).digest('hex'),
    // Server-side truth alone does NOT prove native action causality/consent.
    nativeApprovalOrOriginalNodeCausalityProven: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const origin = process.env.TF4_FIXTURE_PUBLIC_ORIGIN;
  const token = process.env.TF4_FIXTURE_ORACLE_TOKEN;
  const nonce = process.env.TF4_FIXTURE_RUN_NONCE;
  if (!origin || !/^https:\/\/[^/?#:@]+$/.test(origin) || !/^[a-f0-9]{64}$/.test(token ?? '')
      || !nonce || new URL(origin).port)
    throw new Error('operator-public-origin-oracle-token-and-run-nonce-required');
  const response = await fetch(`${origin}/__oracle/receipts`, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
    redirect: 'manual',
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok || response.redirected || response.url !== `${origin}/__oracle/receipts`)
    throw new Error('oracle-authenticated-read-failed');
  const report = summarizeOracle(await response.json(), nonce, origin);
  console.log(JSON.stringify(report, null, 2));
}
