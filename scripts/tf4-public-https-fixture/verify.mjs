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
  return {
    runNonce: nonce, oracleOrigin: origin, events: events.length,
    independentNavigationRequests: events.filter(e =>
      e.method === 'GET' && e.path === `/case/${nonce}/next`).length,
    formAccepted: accepted.filter(e => e.path === `/case/${nonce}/form`).length,
    uploadAccepted: accepted.filter(e => e.path === `/case/${nonce}/upload`).length,
    replayDenied: denied.length,
    acceptedWriteEvidence: accepted.map(({ eventId, method, path, bodySha256, bodyBytes, at }) =>
      ({ eventId, method, path, bodySha256, bodyBytes, at })),
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
