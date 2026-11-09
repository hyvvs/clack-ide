/** Passive collection for a separately authorized, fresh acceptance harness.
 * Does NOT install itself, launch the model or write into a historical run.
 * The future runner owns an exclusive-new path and a localhost receipt route.
 */
import assert from 'node:assert/strict';
import { open, link, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const PHASES = new Set(`extractor-created extractor-deadline-fired extractor-cancelled extractor-disposed
  extraction-limits-start extraction-limits-settled extraction-charge-start extraction-charge-settled
  extraction-model-start extraction-model-returned extraction-validate-start extraction-validate-completed
  extraction-validate-failed extraction-completed native-request-linked native-response-headers
  native-http-settled sdk-response-headers sdk-json-settled sdk-frame-validated sdk-generate-settled
  memory-load-start memory-load-settled memory-commit-start memory-commit-settled memory-commit-failed
  target-begin-start target-begin-settled target-load-start target-load-settled target-preview-start
  target-preview-settled target-commit-start target-commit-settled target-validate-start
  target-validate-completed agent-trust-start agent-trust-completed agent-prepare-start
  agent-prepare-completed agent-prepare-failed agent-stream-error agent-run-failed
  agent-run-completed agent-run-cancelled agent-run-interrupted`.trim().split(/\s+/));
const ID = /^[A-Za-z0-9:_-]{1,160}$/;
const NATIVE_ID = /^[A-Za-z0-9:_-]{1,80}$/;
const own = (value, field) => Object.prototype.hasOwnProperty.call(value, field);

export function validatePreparationPhaseRow(record, expectedSequence) {
  assert(record && typeof record === 'object' && !Array.isArray(record), 'Invalid phase row');
  const allowed = ['schemaVersion', 'sequence', 'at', 'sessionId', 'runId', 'phase', 'nativeRequestId'];
  assert(Object.keys(record).every(k => allowed.includes(k)), 'Unexpected phase evidence field');
  assert(record.schemaVersion === 1 && record.sequence === expectedSequence, 'Phase sequence/version mismatch');
  assert(Number.isSafeInteger(record.at) && record.at >= 0, 'Invalid phase timestamp');
  assert(typeof record.sessionId === 'string' && ID.test(record.sessionId) &&
    typeof record.runId === 'string' && ID.test(record.runId), 'Invalid phase identity');
  assert(PHASES.has(record.phase), 'Unrecognized phase');
  assert(!own(record, 'nativeRequestId') ||
    (typeof record.nativeRequestId === 'string' && NATIVE_ID.test(record.nativeRequestId)), 'Invalid native request ID');
  const clean = { schemaVersion: 1, sequence: record.sequence, at: record.at,
    sessionId: record.sessionId, runId: record.runId, phase: record.phase,
    ...(own(record, 'nativeRequestId') ? { nativeRequestId: record.nativeRequestId } : {}) };
  assert(Buffer.byteLength(JSON.stringify(clean), 'utf8') <= 512, 'Oversized phase evidence');
  return Object.freeze(clean);
}

/** `wx` refuses existing records. Each ACK follows sync of the appended row.
 * The only receipt claim is collection/flush, never model correctness. */
export async function createPreparationPhaseJournal(filename, maxRecords = 2048) {
  assert(Number.isSafeInteger(maxRecords) && maxRecords >= 1 && maxRecords <= 4096,
    'Invalid journal bound');
  const file = await open(filename, 'wx');
  const digest = createHash('sha256');
  let count = 0;
  let sealed = false;
  let writeFailed = false;
  let closed = false;
  let queue = Promise.resolve();
  const closeJournal = async () => {
    if (closed) return;
    closed = true;
    await file.close();
  };
  return {
    append(record) {
      const next = queue.then(async () => {
        assert(!sealed && !writeFailed && count < maxRecords, 'Phase journal sealed, failed or full');
        const clean = validatePreparationPhaseRow(record, count + 1);
        const line = JSON.stringify(clean) + '\n';
        try { await file.writeFile(line, { encoding: 'utf8' }); await file.sync(); }
        catch (error) { writeFailed = true; throw error; }
        digest.update(line);
        count++;
        return count;
      });
      queue = next.then(() => undefined, () => undefined);
      return next;
    },
    async seal(receipt) {
      await queue;
      assert(!sealed && !writeFailed, 'Phase journal sealed or write failed');
      assert(receipt && receipt.emitted === count && receipt.acknowledged === count &&
        receipt.overflow === 0 && receipt.deliveryFailed === false,
      'Phase capture was incomplete; cannot issue a complete collector receipt');
      sealed = true;
      const finalPath = `${filename}.receipt.json`;
      const pendingPath = `${finalPath}.pending`;
      let staged;
      try {
        await file.sync();
        const summary = Object.freeze({ schemaVersion: 1,
          claim: 'collector-flush-only', count, sha256: digest.digest('hex') });
        // A crash or write/fsync failure cannot leave a syntactically valid
        // *final* receipt. Only a fully synced staging file may be published.
        // Both paths are exclusive: never replace historical evidence.
        staged = await open(pendingPath, 'wx');
        await staged.writeFile(JSON.stringify(summary) + '\n');
        await staged.sync();
        await staged.close();
        staged = undefined;
        await link(pendingPath, finalPath);
        // The final hard link is the authoritative name; a failure to remove
        // our synced staging link must not turn a valid receipt into failure.
        await unlink(pendingPath).catch(() => undefined);
        return summary;
      } finally {
        try { await staged?.close(); }
        finally { await closeJournal(); }
      }
    },
    async abandon() {
      await queue;
      sealed = true;
      await closeJournal();
      // Leave unsealed evidence intact; absence of a receipt means partial.
    },
  };
}

/** Event ordering is local callback sequence, not an independently verified
 * clock, a successful HTTP status, or proof of native model generation.
 * Each SDK phase must carry the signal-linked native request ID; time proximity
 * and an otherwise matching logical run are NOT enough for a join.
 * Verified collector coverage also requires the EXACT raw bytes read from the
 * append-only journal: reserializing JSON erases evidence of byte mutation. */
export function interpretPreparationPhaseRows(rows, receipt = null, rawJournal = undefined) {
  const validated = rows.map((row, i) => validatePreparationPhaseRow(row, i + 1));
  const expected = Buffer.from(validated.map(row => JSON.stringify(row) + '\n').join(''), 'utf8');
  // An omitted raw journal is not proof of an unchanged on-disk archive.
  // Reject non-canonical JSONL and mismatched receipts, even when parsed JSON
  // retains equivalent properties after a whitespace/key-order modification.
  const byteExact = rawJournal instanceof Uint8Array &&
    Buffer.from(rawJournal).equals(expected);
  const digest = byteExact ? createHash('sha256').update(rawJournal).digest('hex') : undefined;
  const completeCollection = byteExact && receipt?.schemaVersion === 1 && receipt.claim === 'collector-flush-only' &&
    receipt.count === validated.length && receipt.sha256 === digest;
  const link = validated.filter(row => row.phase === 'native-request-linked');
  const ids = new Set(validated.filter(row => row.phase === 'native-request-linked' && row.nativeRequestId)
    .map(row => row.nativeRequestId));
  const uniqueLinks = [...new Map(link.filter(row => row.nativeRequestId)
    .map(row => [JSON.stringify([row.sessionId, row.runId, row.nativeRequestId]), row])).values()];
  const requestOrderings = uniqueLinks.map(start => {
    const relevant = row => row.sessionId === start.sessionId && row.runId === start.runId &&
      row.nativeRequestId === start.nativeRequestId;
    const opened = link.filter(relevant);
    const terminal = validated.filter(row => row.phase === 'native-http-settled' && relevant(row));
    const json = validated.filter(row => row.phase === 'sdk-json-settled' && relevant(row));
    let ordering = 'unknown';
    if (completeCollection && start.sessionId !== 'unavailable' && start.runId !== 'unavailable' &&
      opened.length === 1 && terminal.length === 1 && json.length === 1 &&
      start.sequence < terminal[0].sequence && start.sequence < json[0].sequence)
      ordering = terminal[0].sequence < json[0].sequence
        ? 'native-terminal-before-sdk-json' : 'sdk-json-before-native-terminal';
    return Object.freeze({ nativeRequestId: start.nativeRequestId, ordering });
  });
  const nativeSdkOrdering = requestOrderings.length === 1 ? requestOrderings[0].ordering : 'unknown';
  return Object.freeze({
    collectorCoverage: completeCollection ? 'collector-flushed' : 'partial-or-unsealed',
    nativeSdkOrdering,
    requestOrderings: Object.freeze(requestOrderings),
    nativeRequestsLinked: ids.size,
    extractorDeadlineObserved: validated.some(row => row.phase === 'extractor-deadline-fired'),
    agentTerminalObserved: validated.some(row =>
      ['agent-run-failed', 'agent-run-completed', 'agent-run-cancelled', 'agent-run-interrupted'].includes(row.phase)),
    inferenceProgress: 'not-established',
    forgeBoardAcceptance: 'not-evaluated',
  });
}
