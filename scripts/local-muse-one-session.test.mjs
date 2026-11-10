import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OneMuseDiagnosticSession, ONE_SESSION_GATES, MUSE_MODEL,
  MUSE_DIGEST, MUSE_ENDPOINT } from './local-muse-one-session.mjs';
import { makeOneMuseJournal } from './local-muse-one-journal.mjs';

const noopRequest = () => ({url:MUSE_ENDPOINT,method:'POST',
  requestClass:'diagnostic',body:{model:MUSE_MODEL,stream:true,
    options:{num_ctx:32768,num_predict:8192},
    messages:[{role:'user',content:'offline-fake-only'}]}});

function fakeSources(faults = {}, calls = []) {
  const sources = {};
  for (const gate of ONE_SESSION_GATES.filter(g => g !== 'journal')) {
    const identity = `${gate}-source-1`;
    const ack = runId => ({
      runId: faults[gate] === 'stale' ? 'muse-one-stale-000000000000' : runId,
      source:gate, identity, ready:faults[gate] !== 'missing',
      pending:0, loss:faults[gate] === 'initial-loss' ? 1 : 0,
      ...(gate === 'identity' ? {model:MUSE_MODEL,digest:MUSE_DIGEST,metadataOnly:true} : {}),
      ...(gate === 'tunnel' ? {local:'127.0.0.1:11435',
        remote:'127.0.0.1:11434',ownerPid:101,strictHostKey:true} : {}),
      ...(gate === 'mapping' ? {localListener:'127.0.0.1:11435',
        remoteListener:'127.0.0.1:11434',tunnelOwnerPid:101,ollamaPid:1139,
        requestSocketCorrelation:'not-established'} : {}),
      ...(gate === 'clocks' ? {sampleCount:3,uncertaintyUs:2000,
        localAnchorUnixUs:Date.now()*1000,remoteAnchorUnixUs:Date.now()*1000,
        remoteAnchorMonoUs:1000000} : {}),
      ...(gate === 'kernel' ? {pid:1139,port:11434,completedNativeAttach:true,
        loadedProgram:true,identityVerified:true} : {}),
      ...(['native','semantic','webview'].includes(gate) ?
        {activeRegistration:faults[gate] !== 'not-registered',
          receiptAck:faults[gate] !== 'no-ack'} : {}),
    });
    sources[gate] = {
      async arm({runId}) {
        calls.push(`arm:${gate}`);
        if (faults[gate] === 'throws-after-start')
          throw Error('source-armed-before-error');
        if(faults.prePosted && ['native','semantic','webview'].includes(gate))
          await faults.journal.observe({kind:'readiness',runId,gate,
            sourceIdentity:identity});
        return ack(runId);
      },
      async check({runId}) { calls.push(`check:${gate}`);
        if (faults[gate] === 'lost-after-arm')
          return {...ack(runId),loss:1};
        return ack(runId);
      },
      async drain({runId}) {
        calls.push(`drain:${gate}`);
        if (gate === 'native' && faults.journal) {
          for (const boundary of ['native-dispatch','native-terminal']) {
            const response = await fetch(faults.journal.url + '/v1/observe', {
              method:'POST',headers:{'content-type':'application/json',
                'x-clack-delivery-session':faults.journal.nonce},
              body:JSON.stringify({schemaVersion:1,runId,host:'clack-native',
                requestId:'inference-1',boundary,atUnixMs:Date.now(),
                monoUs:1000000,sequence:0,bytes:0}),
            });
            assert.equal(response.status,200);
          }
        }
        if (gate === 'kernel') {
          const result = faults.kernel === 'end-failed' ? 'failed':'ok';
          const journal = faults.journal;
          if (journal) {
            const response = await fetch(journal.url + '/v1/observe', {
              method:'POST',headers:{'content-type':'application/json',
                'x-clack-delivery-session':journal.nonce},
              body:JSON.stringify({schemaVersion:1,runId,host:'collector',
                layer:'collector',kind:'shutdown',endpoint:'ollama-loopback',
                result,atUnixMs:Date.now(),monoUs:1000000,kernelAttempts:0,
                kernelReturns:0,pendingWrites:0,durationMs:100,dropped:0}),
            });
            assert.equal(response.status,200);
          }
        }
        if (gate === 'webview' && faults.journal) {
          const response = await fetch(faults.journal.url + '/v1/observe', {
            method:'POST',headers:{'content-type':'application/json',
              'x-clack-delivery-session':faults.journal.nonce},
            body:JSON.stringify({schemaVersion:1,runId,host:'clack-webview',
              requestId:'inference-1',boundary:'webview-settled-received',
              atUnixMs:Date.now(),monoUs:1000000,sequence:0,bytes:0}),
          });
          assert.equal(response.status,200);
        }
      },
      async terminal({runId}) {
        calls.push(`terminal:${gate}`);
        if(faults.prePosted && ['native','semantic','webview'].includes(gate))
          await faults.journal.observe({kind:'terminal',runId,gate,
            sourceIdentity:identity});
        return {
        runId,source:gate,identity,complete:faults[gate] !== 'end-failed',
        loss:faults[gate] === 'late-loss' ? 1 : 0,pending:0};
      },
      async stop({runId}) { calls.push(`stop:${gate}`);return {
        runId,source:gate,clean:faults[gate] !== 'cleanup-failed'}; },
    };
  }
  return sources;
}

async function fixture(faults = {}) {
  const base = await mkdtemp(path.join(tmpdir(),'clack-one-test-'));
  const calls = [];
  const sources = fakeSources(faults,calls);
  const session = new OneMuseDiagnosticSession({
    baseRoot:base,sources,makeJournal:async args => {
      const journal = await makeOneMuseJournal(args);
      faults.journal = journal;
      return journal;
    },
  });
  await session.open();
  const cleanup = async () => {
    if (session.status !== 'sealed' && session.status !== 'partial')
      await session.finish('test-end',{allowSeal:false});
    // Only the unique mkdtemp-created fixture base is ever removed.
    await rm(base,{recursive:true,force:true});
  };
  return {session,calls,cleanup};
}

test('all nine fresh registered sources ACK durably; READY permits exactly one production callback', async () => {
  const f = await fixture();
  try {
    assert.equal(await f.session.arm(),'READY_FOR_ONE_INFERENCE');
    assert.equal(f.session.status,'ready');
    assert.equal(f.session.receipts.size,ONE_SESSION_GATES.length);
    let dispatchCount = 0;
    const outcome = await f.session.dispatchOnce({runId:f.session.runId,
      request:noopRequest(),execute:async () => {dispatchCount++; return 'test-result';}});
    assert.equal(outcome,'test-result');
    assert.equal(dispatchCount,1);
    assert.equal(f.session.allowance,0);
    await assert.rejects(f.session.dispatchOnce({runId:f.session.runId,
      request:noopRequest(),execute:async () => {dispatchCount++;}}),/inference-not-ready/);
    assert.equal(dispatchCount,1);
    const before = await readdir(path.join(f.session.root,'delivery'));
    assert(!before.some(s => s.endsWith('receipt.json')));
    const result = await f.session.finish('completed');
    assert.equal(result.status,'sealed');
    assert.equal(result.claim,'collector-flush-only');
    const after = await readdir(path.join(f.session.root,'delivery'));
    assert(after.some(s => s.endsWith('receipt.json')));
    const log = await readFile(path.join(f.session.root,'session-lifecycle.jsonl'),'utf8');
    assert.equal((log.match(/"result":"ready"/g) ?? []).length,10); // nine gates + admission
    assert(!log.includes('offline-fake-only'));
  } finally { await f.cleanup(); }
});

for (const [gate,mode] of [
  ['kernel','missing'],['native','missing'],['webview','not-registered'],
  ['tunnel','missing'],['clocks','missing'],['native','no-ack'],
  ['kernel','initial-loss'],['semantic','initial-loss'],['webview','stale'],
]) {
  test(`${gate} ${mode} fails closed, leaves partial evidence and cleans owned sources`,async()=>{
    const f = await fixture({[gate]:mode});
    try {
      assert.equal(await f.session.arm(),'INFERENCE_BLOCKED');
      assert.equal(f.session.failedGate,gate);
      assert.equal(f.session.status,'partial');
      assert.equal(f.session.allowance,1);
      await assert.rejects(f.session.dispatchOnce({runId:f.session.runId,
        request:noopRequest(),execute:async()=>assert.fail('would infer')}),
      /inference-not-ready/);
      assert(f.calls.includes(`stop:${gate}`));
      assert(f.calls.includes('stop:identity'));
      const files = await readdir(path.join(f.session.root,'delivery'));
      assert(!files.some(s=>s.endsWith('.receipt.json')));
    } finally { await f.cleanup(); }
  });
}

test('stale run-scoped request cannot consume allowance or dispatch', async()=>{
  const f = await fixture();
  try {
    await f.session.arm();
    await assert.rejects(f.session.dispatchOnce({runId:'muse-one-other-000000000000',
      request:noopRequest(),execute:async()=>assert.fail('unexpected')}),
    /stale-run-id/);
    assert.equal(f.session.allowance,1);
  } finally { await f.cleanup(); }
});

test('failed dispatched request permanently consumes allowance (no retry)',async()=>{
  const f = await fixture();
  try {
    await f.session.arm();
    let calls = 0;
    await assert.rejects(f.session.dispatchOnce({runId:f.session.runId,
      request:noopRequest(),execute:async()=>{calls++;throw Error('test-failed');}}),
    /test-failed/);
    await assert.rejects(f.session.dispatchOnce({runId:f.session.runId,
      request:noopRequest(),execute:async()=>{calls++;}}),/inference-not-ready/);
    assert.equal(calls,1);
    assert.equal(f.session.allowance,0);
  } finally { await f.cleanup(); }
});

test('calibration, tool qualification, continuation, fallback and model substitution block before dispatch',async()=>{
  for (const variant of [
    {...noopRequest(),requestClass:'calibration'},
    {...noopRequest(),requestClass:'qualification'},
    {...noopRequest(),continuation:true},
    {...noopRequest(),retry:true},
    {...noopRequest(),fallback:true},
    {...noopRequest(),body:{...noopRequest().body,tools:[{type:'function'}]}},
    {...noopRequest(),body:{...noopRequest().body,model:'other-model'}},
  ]) {
    const f = await fixture();
    try {
      assert.equal(await f.session.arm(),'READY_FOR_ONE_INFERENCE');
      await assert.rejects(f.session.dispatchOnce({runId:f.session.runId,
        request:variant,execute:async()=>assert.fail('would infer')}));
      assert.equal(f.session.allowance,0);
    } finally { await f.cleanup(); }
  }
});

test('native or WebView observer terminal failure/loss leaves unsealed evidence',async()=>{
  for(const [gate,mode] of [
    ['native','end-failed'],['webview','end-failed'],['native','late-loss'],
  ]){
    const f = await fixture({[gate]:mode});
    try {
      await f.session.arm();
      await f.session.dispatchOnce({runId:f.session.runId,request:noopRequest(),
        execute:async()=> 'synthetic'});
      assert.equal((await f.session.finish('completed')).status,'partial');
      const files = await readdir(path.join(f.session.root,'delivery'));
      assert(!files.some(s=>s.endsWith('.receipt.json')));
    } finally { await f.cleanup(); }
  }
});

test('failed eBPF END and failed owned resource cleanup prevent sealing',async()=>{
  for (const [gate,mode] of [
    ['kernel','end-failed'],['kernel','cleanup-failed'],['tunnel','cleanup-failed'],
  ]) {
    const f = await fixture({[gate]:mode});
    try {
      await f.session.arm();
      await f.session.dispatchOnce({runId:f.session.runId,request:noopRequest(),
        execute:async()=> 'synthetic'});
      assert.equal((await f.session.finish('completed')).claim,'incomplete-unsealed');
    } finally { await f.cleanup(); }
  }
});

test('late WebView settled event is drained before durable final receipt',async()=>{
  const f = await fixture();
  try {
    await f.session.arm();
    await f.session.dispatchOnce({runId:f.session.runId,request:noopRequest(),
      execute:async()=> 'synthetic'});
    const result = await f.session.finish('completed');
    assert.equal(result.status,'sealed');
    const filenames = await readdir(path.join(f.session.root,'delivery'));
    const raw = await readFile(path.join(f.session.root,'delivery',
      filenames.find(s=>s.endsWith('.jsonl'))),'utf8');
    assert(raw.includes('"kind":"webview-settled-received"'));
    assert(raw.includes('"kind":"source-terminal"'));
  } finally { await f.cleanup(); }
});

test('durable manual UI-ready claim only after all nine ACKs; broker claims one and no retry',async()=>{
  const f=await fixture();
  try {
    assert.equal(await f.session.arm(),'READY_FOR_ONE_INFERENCE');
    assert.equal(await readFile(path.join(f.session.root,'one-muse-ready.claim'),'utf8'),
      f.session.runId+'\n');
    const intent={model:MUSE_MODEL,stream:true,context:32768,output:8192,
      tools:0,think:'omitted',requestClass:'diagnostic',
      retry:false,continuation:false,fallback:false};
    const claim=await f.session.claimOne({runId:f.session.runId,intent});
    assert.equal(claim.allowanceRemaining,0);
    assert.equal(f.session.status,'claimed');
    await assert.rejects(f.session.claimOne({runId:f.session.runId,intent}),
      /inference-not-ready/);
    await f.session.settleOne({runId:f.session.runId,outcome:'failed'});
    assert.equal((await f.session.finish('completed')).status,'sealed');
  } finally { await f.cleanup(); }
});

test('partially started source is still stopped and cannot create UI-ready claim',async()=>{
  const f=await fixture({kernel:'throws-after-start'});
  try {
    assert.equal(await f.session.arm(),'INFERENCE_BLOCKED');
    assert.equal(f.session.status,'partial');
    assert.equal(f.session.failedGate,'kernel');
    assert(f.calls.includes('stop:kernel'));
    await assert.rejects(readFile(path.join(f.session.root,'one-muse-ready.claim')),
      {code:'ENOENT'});
  } finally { await f.cleanup(); }
});

test('real native/WebView source pre-ACKs are not duplicated by coordinator',async()=>{
  const f=await fixture({prePosted:true});
  try {
    assert.equal(await f.session.arm(),'READY_FOR_ONE_INFERENCE');
    await f.session.dispatchOnce({runId:f.session.runId,request:noopRequest(),
      execute:async()=> 'synthetic'});
    assert.equal((await f.session.finish('completed')).status,'sealed');
    const snapshot=await readFile(path.join(f.session.root,'delivery',
      (await readdir(path.join(f.session.root,'delivery')))
        .find(name=>name.endsWith('.jsonl'))),'utf8');
    for(const gate of ['native','semantic','webview']) {
      const occurrences=snapshot.split('\n').filter(line=>
        line.includes(`"source":"${gate}"`)).length;
      assert.equal(occurrences,2,`exactly one ready and terminal for ${gate}`);
    }
  } finally {await f.cleanup();}
});
