import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOneMuseReadyBroker } from './local-muse-one-ready-broker.mjs';
import { createHash } from 'node:crypto';

const RUN = 'muse-one-1234567890abcdef12345678';
async function send(broker,route,data,{nonce=broker.nonce}={}) {
  const response = await fetch(broker.url + route,{method:'POST',
    headers:{'content-type':'application/json',
      'x-clack-one-muse-session':nonce},
    body:JSON.stringify(data)});
  return response.status;
}
const ready = (source,identity=`source-${source}`) =>
  ({runId:RUN,source,identity,activeRegistration:true,
    receiptAck:true,loss:0,pending:0});

test('exact run, real authenticated registration and heartbeat are required',async()=>{
  const broker = await createOneMuseReadyBroker(RUN);
  try {
    assert.equal(await send(broker,'/v1/ready',ready('native'),{nonce:'wrong'}),403);
    assert.equal(await send(broker,'/v1/ready',{...ready('native'),runId:'old-run'}),422);
    assert.equal(await send(broker,'/v1/ready',{...ready('native'),activeRegistration:false}),422);
    assert.equal(await send(broker,'/v1/ready',ready('native')),200);
    assert.equal(await send(broker,'/v1/ready',ready('native')),422);
    assert.equal((await broker.source('native').arm({runId:RUN})).ready,true);
    assert.equal(await send(broker,'/v1/heartbeat',
      {runId:RUN,source:'native',identity:'source-native'}),200);
    await assert.rejects(broker.source('native').check({runId:'stale'}),/stale-run-id/);
  } finally { await broker.close(); }
});

test('only active registration with a fresh heartbeat counts, terminal is distinct',async()=>{
  let current = 100000;
  const broker = await createOneMuseReadyBroker(RUN,{now:()=>current});
  try {
    assert.equal(await send(broker,'/v1/ready',ready('webview')),200);
    current+=5001;
    await assert.rejects(broker.source('webview').check({runId:RUN}),
      /not-actively-registered/);
    assert.equal(await send(broker,'/v1/heartbeat',
      {runId:RUN,source:'webview',identity:'source-webview'}),200);
    assert.equal((await broker.source('webview').check({runId:RUN})).ready,true);
    assert.equal(await send(broker,'/v1/terminal',{
      runId:RUN,source:'webview',identity:'source-webview',
      complete:true,loss:0,pending:0,webviewSettled:1}),200);
    assert.equal((await broker.source('webview').terminal({runId:RUN})).complete,true);
    assert.equal((await broker.source('webview').stop({runId:RUN})).clean,true);
  } finally { await broker.close(); }
});

test('terminal false readiness fails if native request was not truly dispatched',async()=>{
  const broker = await createOneMuseReadyBroker(RUN);
  try {
    assert.equal(await send(broker,'/v1/ready',ready('native')),200);
    assert.equal(await send(broker,'/v1/terminal',{
      runId:RUN,source:'native',identity:'source-native',
      complete:true,loss:0,pending:0,nativeDispatches:0,nativeTerminals:1}),200);
    assert.equal((await broker.source('native').terminal({runId:RUN})).complete,false);
    assert.equal((await broker.source('native').stop({runId:RUN})).clean,false);
  } finally { await broker.close(); }
});

test('no unbounded private metadata or stale terminal can obtain an ack',async()=>{
  const broker = await createOneMuseReadyBroker(RUN);
  try {
    assert.equal(await send(broker,'/v1/ready',{...ready('semantic'),prompt:'private'}),422);
    assert.equal(await send(broker,'/v1/terminal',{...ready('semantic'),complete:true}),422);
    assert.equal(await send(broker,'/v1/ready',ready('semantic')),200);
    assert.equal(await send(broker,'/v1/terminal',{
      runId:RUN,source:'semantic',identity:'source-semantic',
      complete:true,loss:1,pending:0}),200);
    assert.equal((await broker.source('semantic').terminal({runId:RUN})).loss,1);
  } finally { await broker.close(); }
});

test('coordinator permit exists only after one owner-approved claim and cannot be reissued',async()=>{
  let claims=0,settlements=0;
  const broker = await createOneMuseReadyBroker(RUN,{
    onClaim:async ({runId,intent})=>{
      assert.equal(runId,RUN);assert.equal(intent.model,'muse-glimmer:30b');claims++;
    },
    onSettled:async ({runId,outcome})=>{
      assert.equal(runId,RUN);assert.equal(outcome,'failed');settlements++;
    },
  });
  try {
    const payload={runId:RUN,intent:{model:'muse-glimmer:30b',stream:true,
      context:32768,output:8192,tools:0,think:'omitted',
      requestClass:'diagnostic',retry:false,continuation:false,fallback:false}};
    const first=await fetch(broker.url+'/v1/claim',{method:'POST',
      headers:{'content-type':'application/json',
        'x-clack-one-muse-session':broker.nonce},
      body:JSON.stringify(payload)});
    assert.equal(first.status,200);
    const answer=await first.json();
    assert.equal(answer.permit.length,64);
    assert.equal(createHash('sha256').update(answer.permit).digest('hex'),
      broker.permitSha256);
    assert.equal(await send(broker,'/v1/claim',payload),422);
    assert.equal(claims,1);
    assert.equal(await send(broker,'/v1/request-settled',{
      runId:RUN,requestId:'inference-1',outcome:'failed'}),200);
    assert.equal(await send(broker,'/v1/request-settled',{
      runId:RUN,requestId:'inference-1',outcome:'completed'}),422);
    assert.equal(settlements,1);
    assert.equal(broker.snapshot().requestSettled,true);
  } finally { await broker.close(); }
});
