/** Actual production phase emission -> optional WebView-style serializer ->
 * native-host-style exclusive durable journal -> conservative interpretation.
 * Only mocked extraction calls; no model, Tauri host or acceptance launch. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { LanguageModel } from 'ai';
import { createBoundedExtractor, type ExtractionSource } from '@/modules/ai/lib/compactionExtraction';
import { emitPreparationPhase } from '@/modules/ai/lib/preparationLifecycle';
import { startPreparationPhaseCapture } from '@/test/preparationPhaseCapture';
import {
  createPreparationPhaseJournal, validatePreparationPhaseRow,
  interpretPreparationPhaseRows,
} from '../../scripts/preparation-phase-journal.mjs';

const paths: string[] = [];
const tempFile = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clack-offline-phases-'));
  paths.push(dir);
  return join(dir, 'phases.jsonl');
};
const scope = { sessionId: 'offline-session', runId: 'offline-session:123', isCurrent: () => true };
const source: ExtractionSource = {
  role: 'assistant', passages: ['A documented unresolved issue.'], evidence: {
    id: 'a'.repeat(64), digest: 'd'.repeat(64), sourceRevision: 1,
    locator: { kind: 'message', messageId: 'original' },
    contentIds: [], relatedSessions: ['offline-session'],
  },
};
afterEach(async () => {
  for (const dir of paths.splice(0)) await rm(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe('opt-in, offline phase evidence durability', () => {
  it('uses real loopback HTTP receipts and fsync before acknowledging each phase; rejects untrusted bodies', async () => {
    const filename = await tempFile();
    const journal = await createPreparationPhaseJournal(filename);
    const server = createServer(async (request, response) => {
      if (request.method !== 'POST' || request.url !== '/phase') {
        response.writeHead(404).end(); return;
      }
      try {
        let body = '';
        for await (const bytes of request) {
          body += String(bytes);
          if (Buffer.byteLength(body, 'utf8') > 768) throw new Error('Too large');
        }
        const payload = JSON.parse(body);
        if (!payload || Object.keys(payload).join() !== 'record') throw new Error('Unexpected payload');
        await journal.append(payload.record);
        response.writeHead(204).end();
      } catch { response.writeHead(400).end(); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Loopback listener missing');
      const endpoint = `http://127.0.0.1:${address.port}/phase`;
      const capture = startPreparationPhaseCapture(async record => {
        const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ record }), signal: AbortSignal.timeout(2000) });
        if (!response.ok) throw new Error('No durable phase ACK');
      });
      emitPreparationPhase(scope, 'extractor-created');
      emitPreparationPhase(scope, 'native-request-linked', 'inference-13');
      emitPreparationPhase(scope, 'extractor-deadline-fired');
      emitPreparationPhase(scope, 'agent-run-failed');
      const receipt = await capture.stop();
      expect(receipt).toMatchObject({ emitted: 4, acknowledged: 4, overflow: 0, deliveryFailed: false });
      const malicious = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ record: { schemaVersion: 1, sequence: 5, at: Date.now(),
          sessionId: 'offline-session', runId: 'offline-session:123', phase: 'sdk-json-settled',
          prompt: 'PROTECTED_CONVERSATION' } }) });
      expect(malicious.status).toBe(400);
      const manifest = await journal.seal(receipt);
      const rows = (await readFile(filename, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      expect(rows).toHaveLength(4);
      expect(JSON.stringify(rows)).not.toContain('PROTECTED_CONVERSATION');
      expect(interpretPreparationPhaseRows(rows, manifest)).toMatchObject({
        collectorCoverage: 'collector-flushed', extractorDeadlineObserved: true,
        nativeSdkOrdering: 'unknown', forgeBoardAcceptance: 'not-evaluated',
      });
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
  it('persists production extractor phase boundaries through an acknowledged journal without capturing prompt contents', async () => {
    const filename = await tempFile();
    const journal = await createPreparationPhaseJournal(filename);
    const capture = startPreparationPhaseCapture(async row => { await journal.append(row); });
    const run = createBoundedExtractor({
      model: {} as LanguageModel, scope,
      limits: async () => ({ deployed: 32768 }), remainingCalls: 3,
      call: async () => ({
        text: JSON.stringify({ claims: [{ source: source.evidence.id,
          section: 'unresolved-issues', text: 'An unresolved issue was reported.',
          quote: source.passages[0], status: 'unresolved', contradicts: [] }] }),
        usage: { inputTokens: 90, outputTokens: 40, cachedInputTokens: 0 },
      }),
    });
    try { expect(await run.extract([source], [])).toHaveLength(1); }
    finally { run.dispose(); }
    const receipt = await capture.stop();
    expect(receipt).toMatchObject({ deliveryFailed: false, overflow: 0 });
    expect(receipt.acknowledged).toBeGreaterThan(5);
    const manifest = await journal.seal(receipt);
    const rows = (await readFile(filename, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(rows).toHaveLength(receipt.acknowledged);
    expect(rows.map(r => r.phase)).toContain('extraction-completed');
    expect(rows.map(r => r.phase)).not.toContain('sdk-json-settled'); // custom mock is not SDK
    expect(JSON.stringify(rows)).not.toContain(source.passages[0]);
    expect(rows.every(r => Object.keys(r).every(k =>
      ['schemaVersion', 'sequence', 'at', 'sessionId', 'runId', 'phase', 'nativeRequestId'].includes(k)))).toBe(true);
    expect(interpretPreparationPhaseRows(rows, manifest)).toMatchObject({
      collectorCoverage: 'collector-flushed', nativeSdkOrdering: 'unknown',
      inferenceProgress: 'not-established', forgeBoardAcceptance: 'not-evaluated',
    });
  });

  it('preserves actual callback order only for an unambiguous single request, not a claim of inference progress', async () => {
    const filename = await tempFile();
    const journal = await createPreparationPhaseJournal(filename);
    const capture = startPreparationPhaseCapture(async row => { await journal.append(row); });
    for (const [phase, id] of [
      ['extractor-created'], ['native-request-linked', 'inference-1'],
      ['native-response-headers', 'inference-1'],
      ['native-http-settled', 'inference-1'], ['sdk-json-settled'],
      ['extraction-validate-completed'], ['agent-run-failed'],
    ] as const) emitPreparationPhase(scope, phase, id);
    const receipt = await capture.stop();
    const manifest = await journal.seal(receipt);
    const rows = (await readFile(filename, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(interpretPreparationPhaseRows(rows, manifest)).toMatchObject({
      nativeSdkOrdering: 'native-terminal-before-sdk-json',
      agentTerminalObserved: true, inferenceProgress: 'not-established',
      forgeBoardAcceptance: 'not-evaluated',
    });
    expect(interpretPreparationPhaseRows(rows, null).nativeSdkOrdering).toBe('unknown');
    expect(interpretPreparationPhaseRows(rows, { ...manifest, count: 0 }).collectorCoverage).toBe('partial-or-unsealed');
    expect(interpretPreparationPhaseRows([...rows, { ...rows[0], sequence: rows.length + 1,
      phase: 'native-request-linked', nativeRequestId: 'inference-2' }], null).nativeSdkOrdering).toBe('unknown');
  });

  it('rejects extra content fields and duplicate or invalid phases without writing them', async () => {
    const filename = await tempFile();
    const journal = await createPreparationPhaseJournal(filename);
    const row = { schemaVersion: 1, sequence: 1, at: 123, sessionId: 'session',
      runId: 'session:1', phase: 'extractor-created' } as const;
    expect(() => validatePreparationPhaseRow({ ...row, prompt: 'SECRET' }, 1)).toThrow();
    expect(() => validatePreparationPhaseRow({ ...row, phase: 'generating-tokens' }, 1)).toThrow();
    expect(() => validatePreparationPhaseRow({ ...row, nativeRequestId: 'my/path' }, 1)).toThrow();
    await expect(journal.append({ ...row, prompt: 'SECRET' } as never)).rejects.toThrow();
    await journal.append(row);
    await expect(journal.append(row)).rejects.toThrow();
    await journal.abandon();
    expect((await readFile(filename, 'utf8')).trim().split('\n')).toHaveLength(1);
    await expect(createPreparationPhaseJournal(filename)).rejects.toThrow(); // never overwrite
  });

  it('does not block Agent work if receipt delivery stalls or fails; an incomplete run cannot be sealed', async () => {
    const filename = await tempFile();
    const journal = await createPreparationPhaseJournal(filename);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const capture = startPreparationPhaseCapture(async row => {
      await held;
      await journal.append(row);
    }, 2);
    emitPreparationPhase(scope, 'extractor-created');
    emitPreparationPhase(scope, 'extractor-deadline-fired');
    emitPreparationPhase(scope, 'agent-run-failed');
    expect(capture.snapshot()).toMatchObject({ emitted: 2, acknowledged: 0, overflow: 1 });
    const done = capture.stop();
    expect(await Promise.race([done.then(() => 'settled'), Promise.resolve('pending')])).toBe('pending');
    release();
    const receipt = await done;
    expect(receipt).toMatchObject({ emitted: 2, acknowledged: 2, overflow: 1 });
    await expect(journal.seal(receipt)).rejects.toThrow(/incomplete/);
    await journal.abandon();
    const failed = startPreparationPhaseCapture(async () => { throw new Error('receipt unavailable'); });
    emitPreparationPhase(scope, 'extractor-created');
    emitPreparationPhase(scope, 'agent-run-failed');
    expect(await failed.stop()).toMatchObject({ emitted: 2, acknowledged: 0, deliveryFailed: true });
  });

  it('cannot infer a successful SDK response or authorize a retry from a sealed deadline-only trace', async () => {
    const filename = await tempFile();
    const journal = await createPreparationPhaseJournal(filename);
    const capture = startPreparationPhaseCapture(async row => { await journal.append(row); });
    emitPreparationPhase(scope, 'extractor-created');
    emitPreparationPhase(scope, 'native-request-linked', 'inference-42');
    emitPreparationPhase(scope, 'extractor-deadline-fired');
    emitPreparationPhase(scope, 'agent-run-failed');
    const manifest = await journal.seal(await capture.stop());
    const rows = (await readFile(filename, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(interpretPreparationPhaseRows(rows, manifest)).toMatchObject({
      collectorCoverage: 'collector-flushed', nativeRequestsLinked: 1,
      extractorDeadlineObserved: true, agentTerminalObserved: true,
      nativeSdkOrdering: 'unknown', inferenceProgress: 'not-established',
      forgeBoardAcceptance: 'not-evaluated',
    });
  });
});
