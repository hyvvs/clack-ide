import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFixtureHandler } from './server.mjs';
import { summarizeOracle } from './verify.mjs';

const nonce = 'tf4-owned-test-0123456789abcdef';
const token = 'a'.repeat(64);
const credential = 'test-synthetic-credential-value-very-long';
async function setup(run, fixtureOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), 'clack-tf4-owned-fixture-'));
  const handler = createFixtureHandler({ root, runNonce: nonce, oracleToken: token,
    syntheticCredential: credential, crossOrigin: 'https://owned-other.example/', ...fixtureOptions });
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const req = (path, options = {}) => fetch(url + path, { redirect: 'manual', ...options });
  try { await run(req); }
  finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
}
test('independent server oracle, original page fixture and denial boundaries', async () => {
  await setup(async req => {
    assert.equal((await req('/')).status, 200);
    const page = await (await req('/')).text();
    assert.match(page, /id="exact-submitter"/);
    assert.match(page, /id="exact-popup"[^>]*href="\/"[^>]*target="_blank"[^>]*rel="noopener"/,
      'popup fixture must request an original native blank-target link, not execute page JavaScript');
    assert.match(page, /id="exact-form"[^>]*method="post"[^>]*enctype="application\/x-www-form-urlencoded"[^>]*target="_self"/,
      'positive fixture must obey the fixed native original-FORM contract');
    assert.match(page, /id="replace-original"/);
    assert.equal((await req('/__oracle/receipts')).status, 403);
    assert.equal((await req('/__oracle/receipts', {
      headers: { authorization: 'Bearer ' + 'b'.repeat(64) } })).status, 403);
    assert.equal((await req(`/case/${nonce}/next`)).status, 200);
    assert.equal((await req(`/case/${nonce}/redirect`)).status, 302);
    assert.equal((await req(`/case/${nonce}/cross-redirect`)).headers.get('location'),
      'https://owned-other.example/');
    assert.equal((await req(`/case/${nonce}/credential`)).status, 403);
    assert.equal((await req(`/case/${nonce}/credential`, {
      headers: { authorization: `Bearer ${credential}` } })).status, 200);
    assert.equal((await req(`/case/${nonce}/download`)).headers.get('content-disposition'),
      'attachment; filename="tf4-acceptance.txt"');
    assert.equal((await req('/?secret=any')).status, 400);
    assert.equal((await req(`/case/${nonce}/delay/9001`)).status, 422);
    const oracle = await (await req('/__oracle/receipts', {
      headers: { authorization: `Bearer ${token}` } })).json();
    assert.equal(oracle.runNonce, nonce);
    assert.ok(oracle.events.some(e => e.path === `/case/${nonce}/next`));
    assert.ok(!JSON.stringify(oracle).includes(credential));
    assert.ok(!JSON.stringify(oracle).includes(token));
  });
});
test('one accepted form per nonce, durable replay rejection, wrong-body denial', async () => {
  await setup(async req => {
    const path = `/case/${nonce}/form`;
    const post = (body, contentType = 'application/x-www-form-urlencoded') =>
      req(path, { method: 'POST', body, headers: { 'content-type': contentType } });
    const body = `nonce=${nonce}&commit=once`;
    assert.equal((await post(body.replace('once', 'other'))).status, 422);
    assert.equal((await post(body, 'application/json')).status, 415);
    const responses = await Promise.all([post(body), post(body)]);
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
    assert.equal((await post(body)).status, 409);
    const oracle = await (await req('/__oracle/receipts', {
      headers: { authorization: `Bearer ${token}` } })).json();
    assert.equal(oracle.events.filter(e => e.disposition === 'one-write-accepted').length, 1);
    assert.equal(oracle.events.filter(e => e.disposition === 'replay-denied').length, 2);
    assert.equal(oracle.events.find(e => e.disposition === 'one-write-accepted').bodyBytes,
      Buffer.byteLength(body));
    const proof = summarizeOracle(oracle, nonce, 'https://fixture-owned.example');
    assert.equal(proof.formPostAttempts, 5);
    assert.equal(proof.formAccepted, 1);
    assert.equal(proof.replayDenied, 2);
    assert.equal(proof.legacyUnlinkedWriteOutcomes, 0);
  });
});
test('exact upload scope, bounded payload, no replay or unintended writes', async () => {
  await setup(async req => {
    const path = `/case/${nonce}/upload`;
    const submit = body => req(path, { method: 'POST',
      headers: { 'content-type': 'application/octet-stream' }, body });
    assert.equal((await submit(Buffer.alloc(65535, 65))).status, 201);
    assert.equal((await submit(Buffer.from('replay'))).status, 409);
    assert.equal((await submit(Buffer.alloc(65537, 66))).status, 415);
    assert.equal((await req(path)).status, 405);
    const oracle = await (await req('/__oracle/receipts', {
      headers: { authorization: `Bearer ${token}` } })).json();
    assert.equal(oracle.events.filter(e => e.path === path && e.status === 201).length, 1);
  });
});

test('restart preserves one-use claims and observer distinguishes remote HTTP from native causality', async () => {
  const root = mkdtempSync(join(tmpdir(), 'clack-tf4-persistent-fixture-'));
  const create = async () => {
    const server = createServer(createFixtureHandler({
      root, runNonce: nonce, oracleToken: token, syntheticCredential: credential,
    }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    return { server, req: (path, options) => fetch(base + path, { redirect: 'manual', ...options }) };
  };
  const form = `/case/${nonce}/form`;
  const body = `nonce=${nonce}&commit=once`;
  const options = { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body };
  try {
    let site = await create();
    assert.equal((await site.req(form, options)).status, 201);
    await new Promise(resolve => site.server.close(resolve));
    site = await create();
    try {
      assert.equal((await site.req(form, options)).status, 409);
      const record = await (await site.req('/__oracle/receipts', {
        headers: { authorization: `Bearer ${token}` },
      })).json();
      const proof = summarizeOracle(record, nonce, 'https://fixture-owned.example');
      assert.equal(proof.formAccepted, 1);
      assert.equal(proof.replayDenied, 1);
      assert.equal(proof.recordedPostAttempts, 2);
      assert.equal(proof.acceptedWriteEvidence[0].bodySha256.length, 64);
      assert.equal(proof.nativeApprovalOrOriginalNodeCausalityProven, false);
      assert.ok(!JSON.stringify(proof).includes(credential));
      assert.ok(!JSON.stringify(proof).includes(token));
    } finally { await new Promise(resolve => site.server.close(resolve)); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('client abort during delayed request does not erase independent remote observation', async () => {
  await setup(async req => {
    const path = `/case/${nonce}/delay/220`;
    const abort = new AbortController();
    const fetching = req(path, { signal: abort.signal });
    setTimeout(() => abort.abort(), 65);
    await assert.rejects(fetching);
    await new Promise(resolve => setTimeout(resolve, 300));
    const oracle = await (await req('/__oracle/receipts', {
      headers: { authorization: `Bearer ${token}` },
    })).json();
    assert.equal(oracle.events.filter(e => e.path === path && e.status === 200).length, 1,
      'an aborted client does not prove the server did not process the request');
  });
});

test('held FORM is independently committed before any reply, then survives client disconnect', async () => {
  await setup(async req => {
    const controller = new AbortController();
    const path = `/case/${nonce}/form`;
    const options = { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `nonce=${nonce}&commit=once` };
    const observe = async () => summarizeOracle(await (await req('/__oracle/receipts', {
      headers: { authorization: `Bearer ${token}` },
    })).json(), nonce, 'https://fixture-owned.example');
    let replied = false;
    const pending = req(path, { ...options, signal: controller.signal }).then(
      () => { replied = true; return 'reply'; }, () => 'disconnected');
    try {
      const deadline = Date.now() + 3000;
      let proof;
      do {
        proof = await observe();
        if (proof.formAccepted === 1) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      } while (Date.now() < deadline);
      assert.equal(proof.formAccepted, 1);
      assert.equal(proof.recordedPostAttempts, 1);
      assert.equal(proof.acceptedWriteEvidence[0].responseHoldMs, 30000);
      assert.equal(replied, false);
      controller.abort();
      assert.equal(await pending, 'disconnected');
      const disconnectDeadline = Date.now() + 3000;
      do {
        proof = await observe();
        if (proof.heldResponseEvidence.length) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      } while (Date.now() < disconnectDeadline);
      assert.equal(proof.heldResponseEvidence.length, 1);
      assert.equal(proof.heldResponseEvidence[0].disposition, 'held-response-disconnected');
      assert.equal(proof.heldResponseEvidence[0].attemptId, proof.acceptedWriteEvidence[0].attemptId);
      assert.equal(proof.formAccepted, 1);
      assert.equal(proof.recordedPostAttempts, 1);
      assert.equal(proof.replayDenied, 0);
      assert.equal((await req(path, options)).status, 409);
      proof = await observe();
      assert.equal(proof.formAccepted, 1);
      assert.equal(proof.recordedPostAttempts, 2);
      assert.equal(proof.replayDenied, 1);
    } finally { controller.abort(); await pending; }
  }, { formResponseHoldMs: 30000 });
});

test('bounded hold releases normally; malformed and unrelated POSTs count without leaking inputs', async () => {
  await setup(async req => {
    const path = `/case/${nonce}/form`;
    const options = { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `nonce=${nonce}&commit=once` };
    assert.equal((await req(path + '?secret=PRIVATE_QUERY', options)).status, 400);
    assert.equal((await req('/PRIVATE_PATH', options)).status, 404);
    const started = performance.now();
    assert.equal((await req(path, options)).status, 201);
    assert.ok(performance.now() - started >= 80);
    const record = await (await req('/__oracle/receipts', {
      headers: { authorization: `Bearer ${token}` },
    })).json();
    const proof = summarizeOracle(record, nonce, 'https://fixture-owned.example');
    assert.equal(proof.recordedPostAttempts, 3);
    assert.equal(proof.formPostAttempts, 2);
    assert.equal(proof.otherPostAttempts, 1);
    assert.equal(proof.formAccepted, 1);
    assert.equal(proof.replayDenied, 0);
    assert.equal(proof.heldResponseEvidence.length, 1);
    assert.equal(proof.heldResponseEvidence[0].disposition, 'held-response-release');
    assert.ok(!JSON.stringify(record).includes('PRIVATE_QUERY'));
    assert.ok(!JSON.stringify(record).includes('PRIVATE_PATH'));
    assert.ok(!JSON.stringify(record).includes(options.body));
    const accepted = record.events.find(e => e.disposition === 'one-write-accepted');
    assert.throws(() => summarizeOracle({ ...record, events: record.events.filter(
      e => !(e.disposition === 'post-ingress' && e.attemptId === accepted.attemptId)) },
      nonce, 'https://fixture-owned.example'), /oracle-write-ingress-mismatch/);
  }, { formResponseHoldMs: 100 });
});

test('invalid cross-origin and nonce configuration fails before listener creation', () => {
  const root = mkdtempSync(join(tmpdir(), 'clack-tf4-invalid-fixture-'));
  try {
    for (const bad of [
      'https://user@owned-other.example/', 'http://owned-other.example/',
      'https://owned-other.example/?token=bad', 'https://owned-other.example:444/',
      'not-an-origin',
    ]) {
      assert.throws(() => createFixtureHandler({ root, runNonce: nonce, oracleToken: token,
        syntheticCredential: credential, crossOrigin: bad }), /fixture-configuration-invalid/);
    }
    assert.throws(() => createFixtureHandler({ root, runNonce: '../other', oracleToken: token,
      syntheticCredential: credential }), /fixture-configuration-invalid/);
    for (const bad of [-1, 30001, 1.5, NaN, '100']) {
      assert.throws(() => createFixtureHandler({ root, runNonce: nonce, oracleToken: token,
        syntheticCredential: credential, formResponseHoldMs: bad }), /fixture-configuration-invalid/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
