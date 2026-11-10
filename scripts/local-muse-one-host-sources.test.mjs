import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import { createOneMuseHostSources } from './local-muse-one-host-sources.mjs';
import { MUSE_MODEL, MUSE_DIGEST } from './local-muse-one-session.mjs';

const RUN = 'muse-one-1234567890abcdef12345678';
class FakeOwnedSSH extends EventEmitter {
  constructor() {
    super();this.pid=40123;this.exitCode=null;this.signalCode=null;
    this.stderr=new PassThrough();
  }
  kill() {this.exitCode=0;this.emit('exit',0);return true;}
}
const manifestPath = path.resolve(
  'src-tauri/target/real-qwen-product/forgeboardmuse-20261109-01/mission-evidence-manifest.json');
const noopJournal = {recordMetadata:async row=>{
  assert(row.runId===RUN && row.host==='collector');
  assert(['capability','clock-anchor'].includes(row.kind));
  return 1;
}};
const ackSources = () => {
  let owned = false, pid = 1139;
  const processes = [], commands = [], remoteCommands = [];
  const instance = createOneMuseHostSources({
    manifestPath,sshKey:path.resolve('not-accessed-fake-ssh-key'),
    start:(command,args)=> {
      commands.push({command,args});
      const child=new FakeOwnedSSH();processes.push(child);owned=true;return child;
    },
    ownedForwardPid:async()=>{
      if(!owned) return null;
      return 40123;
    },
    remoteRead:async script=>{
      remoteCommands.push(script);
      if(script.includes('systemctl show'))return String(pid);
      if(script.includes('time.time_ns'))
        return `${Date.now()*1000} ${Number(process.hrtime.bigint()/1000n)}`;
      throw Error('Unexpected remote command');
    },
    metadataFetch:async (url,opts)=>{
      assert.equal(url,'http://127.0.0.1:11435/api/tags');
      assert.equal(opts.method,'GET');
      return {ok:true,json:async()=>({models:[{name:MUSE_MODEL,digest:MUSE_DIGEST}]})};
    },
  });
  return {sources:instance.sources,processes,commands,remoteCommands,
    setPid:value=>{pid=value;}};
};

test('frozen identity, owned SSH tunnel, numeric mappings and measured host anchors',async()=>{
  const f=ackSources(), receipts=new Map();
  const {sources}=f;
  for(const gate of ['identity','tunnel','mapping','clocks']){
    const a=await sources[gate].arm({runId:RUN,journal:noopJournal});
    assert.equal(a.runId,RUN);assert.equal(a.loss,0);
    receipts.set(gate,a);
  }
  assert.equal(receipts.get('identity').digest,MUSE_DIGEST);
  assert.equal(receipts.get('mapping').ollamaPid,1139);
  assert.equal(receipts.get('mapping').requestSocketCorrelation,'not-established');
  assert.equal(receipts.get('clocks').sampleCount,3);
  assert(receipts.get('clocks').uncertaintyUs>0);
  assert.equal(f.commands.length,1);
  assert(f.commands[0].args.includes('ExitOnForwardFailure=yes'));
  assert(f.commands[0].args.includes('StrictHostKeyChecking=yes'));
  assert(f.commands[0].args.includes('127.0.0.1:11435:127.0.0.1:11434'));
  assert.equal(f.remoteCommands.filter(x=>x.includes('time.time_ns')).length,3);
  for(const gate of ['identity','tunnel','mapping','clocks']){
    const a=await sources[gate].check({runId:RUN});
    assert.equal(a.identity,receipts.get(gate).identity);
  }
  assert.equal((await sources.tunnel.stop({runId:RUN})).clean,true);
  assert.equal(f.processes[0].exitCode,0);
});

test('remote identity changed after arming fails closed without substitute request',async()=>{
  const f=ackSources();
  for(const gate of ['identity','tunnel','mapping']){
    await f.sources[gate].arm({runId:RUN,journal:noopJournal});
  }
  f.setPid(1140);
  await assert.rejects(f.sources.mapping.check({runId:RUN}),
    /remote-ollama-identity-changed/);
  await f.sources.tunnel.stop({runId:RUN});
});

test('a stale run ID cannot reuse the owned transport',async()=>{
  const f=ackSources();
  await f.sources.identity.arm({runId:RUN,journal:noopJournal});
  await assert.rejects(f.sources.tunnel.arm({
    runId:'muse-one-000000000000000000000000',journal:noopJournal}),
  /stale-or-stopped-run/);
  assert.equal(f.commands.length,0);
});
