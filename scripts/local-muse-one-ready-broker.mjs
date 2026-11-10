/** Ephemeral, authenticated readiness rendezvous for ONE isolated diagnostic
 * WebView. It does not start a model, Tauri, SSH or the kernel tracer.
 *
 * Native + semantic ACKs must originate from the actual Tauri readiness IPC,
 * WebView ACK only after installed listener, successful journal POST and
 * registration. The future owned host must enforce these producer contracts.
 */
import assert from 'node:assert/strict';
import { randomBytes,createHash } from 'node:crypto';
import { createServer } from 'node:http';

const ACTIVE = new Set(['native','semantic','webview']);
const ID = /^[A-Za-z0-9_:-]{1,96}$/;
const BOUNDED = n => Number.isSafeInteger(n) && n >= 0;
const HEARTBEAT_MS = 5000;

export async function createOneMuseReadyBroker(runId, { now = () => Date.now(),
  onClaim = null, onSettled = null } = {}) {
  assert(/^[a-z0-9][a-z0-9-]{7,79}$/.test(runId), 'bad-run-id');
  const nonce = randomBytes(24).toString('hex');
  const permit = randomBytes(32).toString('hex');
  const permitSha256 = createHash('sha256').update(permit).digest('hex');
  const registrations = new Map();
  const terminals = new Map();
  let closing = false;
  let claimUsed = false, claimed = false, requestSettled = false;
  const server = createServer(async (req, res) => {
    res.setHeader('content-type','application/json');
    const answer = (code, body) => {
      res.writeHead(code);res.end(JSON.stringify(body));
    };
    if (closing || req.method !== 'POST' ||
      !['/v1/ready','/v1/heartbeat','/v1/terminal','/v1/claim',
        '/v1/request-settled'].includes(req.url) ||
      req.headers['x-clack-one-muse-session'] !== nonce ||
      req.headers.origin && !/^(tauri:\/\/localhost|http:\/\/tauri\.localhost|http:\/\/127\.0\.0\.1:\d{1,5})$/.test(req.headers.origin)) {
      answer(403,{ok:false});return;
    }
    let size = 0;
    const parts = [];
    try {
      for await (const chunk of req) {
        size += chunk.length;
        assert(size <= 1024,'bounded-ready-metadata-only');
        parts.push(chunk);
      }
      const value = JSON.parse(Buffer.concat(parts).toString('utf8'));
      if(req.url === '/v1/claim') {
        assert(value && value.runId===runId && !claimUsed &&
          typeof onClaim === 'function' &&
          Object.keys(value).every(k=>k==='runId'||k==='intent') &&
          value.intent && typeof value.intent === 'object' &&
          Object.keys(value.intent).every(k=>['model','stream','context','output',
            'tools','think','requestClass','retry','continuation','fallback'].includes(k)),
        'unapproved-or-duplicate-admission');
        claimUsed = true; // never reset even after failed admission or lost reply
        await onClaim({runId,intent:value.intent});
        claimed = true;
        answer(200,{ok:true,runId,permit});
        return;
      }
      if(req.url === '/v1/request-settled') {
        assert(claimed && !requestSettled && typeof onSettled==='function' &&
          value && value.runId===runId &&
          ['completed','failed','cancelled'].includes(value.outcome) &&
          typeof value.requestId==='string' && ID.test(value.requestId) &&
          Object.keys(value).every(k=>['runId','outcome','requestId'].includes(k)),
        'unapproved-request-settlement');
        requestSettled = true;
        await onSettled({runId,outcome:value.outcome});
        answer(200,{ok:true,runId});
        return;
      }
      assert(value && typeof value === 'object' && !Array.isArray(value) &&
        Object.keys(value).every(k => ['runId','source','identity',
          'activeRegistration','receiptAck','complete','loss','pending',
          'nativeDispatches','nativeTerminals','webviewSettled'].includes(k)),
      'unapproved-ready-field');
      const { source, identity } = value;
      assert(value.runId === runId && ACTIVE.has(source) && ID.test(identity),
        'stale-ready-observer');
      if (req.url === '/v1/ready') {
        assert(value.activeRegistration === true && value.receiptAck === true &&
          value.loss === 0 && value.pending === 0 && !registrations.has(source),
        'not-active-or-duplicate-observer');
        registrations.set(source,{identity,at:now()});
      } else {
        const registered = registrations.get(source);
        assert(registered?.identity === identity && !terminals.has(source),
          'unknown-or-finished-observer');
        if (req.url === '/v1/heartbeat') registered.at = now();
        else {
          assert(typeof value.complete === 'boolean' && BOUNDED(value.loss) &&
            BOUNDED(value.pending), 'invalid-terminal-ack');
          const validCounts = source === 'native'
            ? value.nativeDispatches === 1 && value.nativeTerminals === 1
            : source === 'webview' ? value.webviewSettled === 1 : true;
          terminals.set(source,{runId,source,identity,
            complete:value.complete === true && validCounts,
            loss:value.loss,pending:value.pending});
        }
      }
      answer(200,{ok:true,runId,source});
    } catch {
      answer(422,{ok:false}); // never echo payload, command, or secret
    }
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  const address = server.address();
  const ack = source => {
    const registered = registrations.get(source);
    assert(ACTIVE.has(source) && registered && !terminals.has(source) &&
      now()-registered.at >= 0 && now()-registered.at <= HEARTBEAT_MS,
      `gate-${source}-not-actively-registered`);
    return Object.freeze({runId,source,identity:registered.identity,
      ready:true,loss:0,pending:0,activeRegistration:true,receiptAck:true});
  };
  const terminal = source => terminals.get(source) ?? null;
  const waitFor = async (predicate, message, timeoutMs = 15000) => {
    const deadline = now() + timeoutMs;
    while (now() < deadline) {
      try { const value = predicate(); if (value) return value; } catch { /* not ready yet */ }
      await new Promise(resolve=>setTimeout(resolve,75));
    }
    throw Error(message);
  };
  const source = gate => {
    assert(ACTIVE.has(gate),'not-a-clack-observer');
    return Object.freeze({
      async arm({runId:requested}) { assert(requested === runId,'stale-run-id');
        return waitFor(()=>ack(gate),`gate-${gate}-ready-timeout`); },
      async check({runId:requested}) { assert(requested === runId,'stale-run-id');
        return ack(gate); },
      async drain({runId:requested}) { assert(requested === runId,'stale-run-id');
        await waitFor(()=>terminal(gate),`gate-${gate}-terminal-not-acknowledged`); },
      async terminal({runId:requested}) { assert(requested === runId,'stale-run-id');
        return terminal(gate); },
      async stop({runId:requested}) { assert(requested === runId,'stale-run-id');
        return {runId,source:gate,clean:terminal(gate)?.complete === true}; },
    });
  };
  const close = async () => {
    if (closing) return;
    closing = true;
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  };
  return Object.freeze({runId, url:`http://127.0.0.1:${address.port}`,
    nonce,permitSha256,source,close, terminal,
    snapshot:()=>({runId,registered:[...registrations.keys()],
      terminal:[...terminals.keys()],claimed,requestSettled})});
}
