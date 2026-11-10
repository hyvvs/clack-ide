/** Concrete, exclusive, fsynced delivery-journal adapter for the future
 * one-Muse coordinator. Local loopback only; never sends inference or SSH. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { startDeliveryServer } from './local-muse-delivery-cli.mjs';

const ID = /^[A-Za-z0-9_-]{1,80}$/;

export async function makeOneMuseJournal({runId, root}) {
  assert(ID.test(runId) && path.isAbsolute(root), 'Invalid journal ownership');
  const folder = path.join(root, 'delivery');
  await mkdir(folder, {recursive:false,mode:0o700});
  const service = await startDeliveryServer(folder, runId, {
    requireKernelSession:true, requireOneSession:true,
  });
  let stopped = false;
  const post = async (route, body) => {
    assert(!stopped, 'Delivery journal stopped');
    const response = await fetch(service.url + route, {
      method:'POST', signal:AbortSignal.timeout(5000),
      headers:{'content-type':'application/json',
        'x-clack-delivery-session':service.nonce},
      body:JSON.stringify(body),
    });
    assert(response.ok, `Journal ${route} not durably acknowledged`);
    return response.json();
  };
  const status = async (requestedId) => {
    assert(requestedId === runId, 'stale-journal-run-id');
    const data = await post('/v1/status', {});
    return Object.freeze({runId:data.runId, count:data.count,
      loss:(data.dropped ?? 0)+(data.sourceLoss ?? 0),
      pending:data.activeObservations, durable:data.ok === true &&
        data.failed === false && data.sourceFailed === false &&
        data.sealed === false,
      kernelCompletions:data.kernelCompletions,
      ready:data.sourceReady, terminal:data.sourceTerminal});
  };
  const observe = async ({kind, runId:received, gate, sourceIdentity}) => {
    assert(received === runId &&
      /^[A-Za-z0-9_:-]{1,96}$/.test(sourceIdentity), 'stale-source-receipt');
    assert(kind === 'readiness' || kind === 'terminal', 'Invalid source handshake');
    const atUnixMs = Date.now(), monoUs = Number(process.hrtime.bigint()/1000n);
    const row = {schemaVersion:1,runId,host:'collector',layer:'collector',
      kind:kind === 'readiness' ? 'source-ready':'source-terminal',
      source:gate,sourceIdentity,result:'ok',atUnixMs,monoUs};
    const accepted = await post('/v1/observe', row);
    assert(accepted.ok === true, 'Source handshake not fsynced');
    return accepted.sequence;
  };
  const recordMetadata = async (row) => {
    assert(row && row.runId === runId &&
      row.host === 'collector' && row.layer === 'collector' &&
      ['capability','clock-anchor'].includes(row.kind),
    'Unapproved source metadata');
    const accepted = await post('/v1/observe',row);
    assert(accepted.ok === true,'Source metadata not durably acknowledged');
    return accepted.sequence;
  };
  try {
    // Independent, positive fsync test for the journal before the first
    // external collector can be admitted. This row is content-free.
    await post('/v1/observe', {schemaVersion:1,runId,host:'collector',
      layer:'collector',kind:'capability',capability:'available',
      atUnixMs:Date.now(),monoUs:Number(process.hrtime.bigint()/1000n)});
    assert((await status(runId)).count === 1, 'journal-first-ack-missing');
  } catch(error) { await service.stop().catch(()=>{}); throw error; }
  return Object.freeze({
    url:service.url, nonce:service.nonce,
    observe, recordMetadata, status,
    async ack(received) {
      const s = await status(received);
      return {runId,source:'journal',identity:runId,ready:s.durable &&
        s.count >= 1,loss:s.loss,pending:s.pending,
        exclusive:true,fsyncAck:true};
    },
    async finish({runId:received,expected,allowSeal}) {
      assert(received === runId && allowSeal === true, 'Cannot seal incomplete session');
      const answer = await post('/v1/finish', {expected,deliveryFailed:false});
      assert(answer.receipt?.claim === 'collector-flush-only' &&
        answer.interpretation?.collectorCoverage === 'collector-flushed',
      'Delivery receipt is not complete');
      stopped = true;
      await service.stop();
      return {runId,sealed:true,receipt:answer.receipt,
        interpretation:answer.interpretation};
    },
    async abandon(received) {
      assert(received === runId, 'stale-abandon');
      if (!stopped) { stopped = true; await service.stop(); }
    },
  });
}
