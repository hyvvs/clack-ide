import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createOneMuseReadyBroker } from './local-muse-one-ready-broker.mjs';
import { createOneMuseAppHost } from './local-muse-one-app-host.mjs';

const RUN = 'muse-one-1234567890abcdef12345678';
const token = async (broker,route,body) => {
  const res=await fetch(broker.url+route,{method:'POST',
    headers:{'content-type':'application/json',
      'x-clack-one-muse-session':broker.nonce},
    body:JSON.stringify(body)});
  assert.equal(res.status,200);
};
class FakeNativeHost extends EventEmitter {
  constructor() {super();this.pid=12345;this.exitCode=null;
    this.signalCode=null;this.stderr=new PassThrough();}
  kill() {this.exitCode=0;this.emit('exit',0);return true;}
}
test('isolated native host starts only after kernel prerequisites and broker readiness',async()=>{
  const root = await mkdtemp(path.join(tmpdir(),'clack-app-source-'));
  const binary = path.join(root,'one-muse-fake.exe');
  await writeFile(binary,'fake-binary-no-execution');
  const broker=await createOneMuseReadyBroker(RUN);
  let launches=0,lastEnv=null,process=null;
  const adapter=createOneMuseAppHost({broker,binary,
    webviewUrl:'http://127.0.0.1:5173/local-muse-one.html',
    start:(_cmd,_args,options)=>{
      launches++;lastEnv=options.env;
      process=new FakeNativeHost();return process;
    }});
  const journal={url:'http://127.0.0.1:35791',nonce:'a'.repeat(48)};
  try {
    for(const source of ['native','semantic','webview']) {
      await token(broker,'/v1/ready',{runId:RUN,source,
        identity:`identity-${source}`,activeRegistration:true,
        receiptAck:true,loss:0,pending:0});
    }
    assert.equal(launches,0);
    const ownedRoot=path.join(root,RUN);
    const {mkdir}=await import('node:fs/promises');
    await mkdir(ownedRoot);
    const a=await adapter.sources.native.arm({runId:RUN,
      root:ownedRoot,journal});
    assert.equal(a.ready,true);
    assert.equal(lastEnv.CLACK_ONE_MUSE_DIAGNOSTIC_ROOT,ownedRoot);
    assert.equal(lastEnv.CLACK_ONE_MUSE_DIAGNOSTIC_PERMIT_SHA256,
      broker.permitSha256);
    assert.equal(lastEnv.CLACK_ONE_MUSE_READY_NONCE,broker.nonce);
    assert.equal(launches,1);
    await assert.rejects(adapter.sources.native.arm({runId:RUN,root:ownedRoot,
      journal}),/started-twice/);
    await adapter.sources.webview.arm({runId:RUN});
    await adapter.sources.semantic.arm({runId:RUN});
    for(const source of ['native','semantic','webview']) {
      await token(broker,'/v1/terminal',{runId:RUN,source,
        identity:`identity-${source}`,complete:true,loss:0,pending:0,
        ...(source==='native'?{nativeDispatches:1,nativeTerminals:1}:{}),
        ...(source==='webview'?{webviewSettled:1}:{})});
    }
    const stopped=await adapter.sources.native.stop({runId:RUN});
    assert.equal(stopped.clean,true);
    assert.equal(process.exitCode,0);
    assert.equal(adapter.snapshot().nativeHostAlive,false);
  } finally {
    await adapter.terminate();
    await broker.close();
    await rm(root,{force:true,recursive:true});
  }
});
