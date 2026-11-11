/** Synthetic-only checks: NO SSH, root, BPF, HTTP, inference or bpftool. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCrashOnlyHostSources,crashOnlyPidQuery} from
  './local-muse-crash-only-host-sources.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const manifestPath=path.resolve(here,'../src-tauri/target/real-qwen-product',
  'forgeboardmuse-20261109-01/mission-evidence-manifest.json');
const RUN='muse-one-1234567890abcdef12345678';

class FakeSSH extends EventEmitter {
  constructor(){super();this.pid=40123;this.exitCode=null;this.signalCode=null;
    this.stderr=new PassThrough();}
  kill(){this.exitCode=0;this.emit('exit',0);return true;}
}

function fixture(){
  let connected=false, remotePid=1139, fetches=0, sshCount=0;
  const remoteCommands=[],journalRows=[];
  const host=createCrashOnlyHostSources({
    manifestPath,sshKey:path.resolve(here,'offline-fake-ssh-key'),
    start:(cmd,args)=>{
      assert.equal(cmd,'ssh.exe');
      assert(args.includes('127.0.0.1:11435:127.0.0.1:11434'));
      connected=true;sshCount++;
      return new FakeSSH();
    },
    ownedForwardPid:async()=>connected?40123:null,
    remoteRead:async command=>{
      remoteCommands.push(command);
      if(command.includes('systemctl show'))return String(remotePid);
      if(command.includes('time.time_ns')){
        return String(Date.now()*1000)+' '+
          String(Number(process.hrtime.bigint()/1000n));
      }
      throw Error('not-allowed-remote-command');
    },
    metadataFetch:async()=>{fetches++;throw Error('should-be-overridden');},
  });
  const journal={recordMetadata:async row=>{journalRows.push(row);return 1;}};
  return {host,journal,remoteCommands,journalRows,
    setPid:value=>{remotePid=value;},getFetches:()=>fetches,
    getSSHCount:()=>sshCount};
}

test('read-only process/comm/socket mapping never calls Ollama HTTP',async()=>{
  const f=fixture(),receipts=new Map();
  for(const name of ['identity','tunnel','mapping','clocks']){
    const receipt=await f.host.sources[name].arm({runId:RUN,journal:f.journal});
    assert.equal(receipt.runId,RUN);
    receipts.set(name,receipt);
  }
  assert.equal(receipts.get('mapping').ollamaPid,1139);
  assert.equal(receipts.get('mapping').ollamaHttpRequests,0);
  assert.equal(receipts.get('mapping').requestSocketCorrelation,'not-established');
  assert.equal(f.getFetches(),0);
  assert.equal(f.getSSHCount(),1);
  assert.equal(f.journalRows.filter(r=>r.kind==='capability').length,1);
  assert.equal(f.remoteCommands.filter(s=>s.includes('systemctl show')).length,1);
  assert.equal(f.remoteCommands.filter(s=>s.includes('time.time_ns')).length,3);
  assert.match(crashOnlyPidQuery,/systemctl show/);
  assert.match(crashOnlyPidQuery,/\/proc\/\$p\/comm/);
  assert.match(crashOnlyPidQuery,/ss -H -ltn/);
  assert.match(crashOnlyPidQuery,/127\.0\.0\.1:11434/);
  assert(!crashOnlyPidQuery.includes('/api/tags'));
  assert.equal((await f.host.sources.mapping.check({runId:RUN})).ollamaPid,1139);
  assert.equal((await f.host.sources.mapping.terminal({runId:RUN})).complete,true);
  assert.equal((await f.host.sources.tunnel.stop({runId:RUN})).clean,true);
  assert.equal(f.getFetches(),0);
});

test('mistaken model inventory check fails without sending HTTP',async()=>{
  const f=fixture();
  await f.host.sources.identity.arm({runId:RUN,journal:f.journal});
  await assert.rejects(f.host.sources.identity.check({runId:RUN}),
    /ollama-http-forbidden/);
  assert.equal(f.getFetches(),0);
});

test('stale run, bad PID or replaced process fails closed',async()=>{
  const f=fixture();
  await f.host.sources.identity.arm({runId:RUN,journal:f.journal});
  await f.host.sources.tunnel.arm({runId:RUN,journal:f.journal});
  await assert.rejects(f.host.sources.mapping.arm({
    runId:'muse-one-ffffffffffffffffffffffff',journal:f.journal}),
  /new-diagnostic-run-required|stale/);
  f.setPid(0);
  await assert.rejects(f.host.sources.mapping.arm({runId:RUN,journal:f.journal}),
    /investigative-process-identity-unverified/);
  f.setPid(1139);
  await f.host.sources.mapping.arm({runId:RUN,journal:f.journal});
  f.setPid(1140);
  await assert.rejects(f.host.sources.mapping.check({runId:RUN}),
    /remote-ollama-identity-changed/);
  assert.equal((await f.host.sources.tunnel.stop({runId:RUN})).clean,true);
  assert.equal(f.getFetches(),0);
});

test('standalone crash listener never reports readiness or starts inference',async()=>{
  const code=await readFile(path.join(here,'local-muse-crash-only-check.mjs'),'utf8');
  assert.match(code,/createCrashOnlyHostSources/);
  assert.match(code,/--operator-authorized-no-http-crash-only/);
  assert.match(code,/-CrashCapture/);
  assert.match(code,/createOneMuseKernelBridge/);
  assert.match(code,/requireKernelSession:true,requireOneSession:false/);
  assert.match(code,/await bridge\.arm\(\{runId,root,receipts,journal\}\)/);
  assert.match(code,/crash-observer-must-never-arm-readiness/);
  assert.match(code,/line\('tcparmed','fail'\)/);
  assert.match(code,/line\('kernel_gate_ready_for_coordinated_diagnostic','false'\)/);
  assert.doesNotMatch(code,/bridge\.drain\(/);
  assert.doesNotMatch(code,/ready=true|line\('tcparmed','pass'\)/);
  assert.doesNotMatch(code,/createOllamaModel|ai_http_stream|\/api\/chat|startForgeBoard/);
  const normal=await readFile(
    path.join(here,'local-muse-kernel-only-check.mjs'),'utf8');
  assert.match(normal,/createOneMuseHostSources/);
  assert.match(normal,/line\('tcparmed','pass'\)/);
  const integration=await readFile(
    path.join(here,'local-muse-one-ebpf.py'),'utf8');
  assert.match(integration,/CrashCaptureNeverQualifiesLinks/);
});
