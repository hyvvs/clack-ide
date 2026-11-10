/** Offline only: fake SSH readers, importer and root STOP. NO SSH/BPF/sudo. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createOneMuseKernelBridge, kernelReaderCommand,
  kernelStopCommand, parseKernelArm, parseKernelImportReceipt,
} from './local-muse-one-kernel-bridge.mjs';
import { startDeliveryServer } from './local-muse-delivery-cli.mjs';

const RUN = 'muse-one-0123456789abcdef01234567';
const PID = 1139;
const HERE = path.dirname(fileURLToPath(import.meta.url));

class Child extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.exitCode = null;
    this.signalCode = null;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = new PassThrough();
  }
  finish(code = 0) {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.emit('exit', code, null);
    this.stdout.end();
    this.stderr.end();
    this.emit('close', code, null);
  }
  kill(signal = 'SIGTERM') {
    if (this.exitCode !== null || this.signalCode !== null) return false;
    this.signalCode = signal;
    this.emit('exit', null, signal);
    this.stdout.end();
    this.stderr.end();
    this.stdin.end();
    this.emit('close', null, signal);
    return true;
  }
}

function scenario({ arm = `TCPARMED ${PID} 11434 4 2 0\n`,
  importerReply = '{"imported":1,"claim":"collector-validated-only"}\n',
  importerExit = 0, importerStdout = '', sourceExit = 0, prematureExit = false,
  abortBeforeArm = false, missingCleanup = false, onOperatorStep = null,
  firstStopFails = false,
} = {}) {
  const calls = [];
  const children = [];
  let data, ready, importer, forwarded = '';
  let stopAttempts = 0;
  const start = (command, args) => {
    calls.push({kind:'start',command,args});
    const child = new Child(2000 + children.length);
    children.push(child);
    if (args.some(a => typeof a === 'string' && a.includes('metadata.fifo'))) data = child;
    else if (args.some(a => typeof a === 'string' && a.includes('ready.fifo'))) {
      ready = child;
      setTimeout(() => {
        if (abortBeforeArm) return;
        if (prematureExit) {
          ready.emit('exit',0,null); // stdout still unread: not a complete ACK
          setTimeout(() => { ready.stdout.end(arm); ready.finish(0); }, 15);
        } else { ready.stdout.end(arm); ready.finish(0); }
      }, 12);
    } else if (command === 'node.exe') {
      importer = child;
      importer.stdin.on('data', chunk => { forwarded += chunk.toString('utf8'); });
      importer.stdin.on('end', () => {
        if(importerStdout) importer.stdout.write(importerStdout);
        if (importerReply) importer.stderr.write(importerReply);
        importer.finish(importerExit);
      });
    }
    return child;
  };
  const remoteExec = async command => {
    calls.push({kind:'remote',command});
    if (command.includes('control.fifo')) {
      stopAttempts++;
      if (firstStopFails && stopAttempts === 1) throw Error('missing-ssh-stop-receipt');
      // Simulate the kernel writer closing metadata after STOP/END/EOF.
      if (data && data.exitCode === null) {
        setImmediate(() => {
          data.stdout.end('TCPSESSION complete 0 0 0 0 450\n');
          data.finish(sourceExit);
        });
      }
    }
    if (missingCleanup && command.includes('test ! -e'))
      throw Error('root-owned-stage-still-exists');
    return '';
  };
  const journal = {
    url:'http://127.0.0.1:12345',nonce:'opaque-nonce',
    status:async id => {
      assert.equal(id,RUN);
      return {kernelCompletions:1,loss:0,pending:0,durable:true};
    },
  };
  const receipts = new Map([
    ['mapping',{ollamaPid:PID}],
    ['clocks',{sampleCount:3,remoteAnchorMonoUs:100000,
      remoteAnchorUnixUs:1794196108268000,uncertaintyUs:10000}],
  ]);
  const bridge = createOneMuseKernelBridge({sshKey:'C:\\approved\\id',
    workdir:HERE,start,remoteExec,onOperatorStep,armTimeoutMs:300});
  return {bridge,journal,receipts,calls,children,stages:()=>({data,ready,importer,forwarded})};
}

test('exact arm and importer receipt parsers reject missing, extra or forged output', () => {
  assert.deepEqual(parseKernelArm(`TCPARMED ${PID} 11434 4 2 0\n`,PID),
    {pid:PID,port:11434,probeCount:4,newKprobeCount:2,loss:0});
  for (const raw of [
    'TCPARMED 1140 11434 4 2 0', 'TCPARMED 1139 11434 4 1 0',
    'TCPARMED 1139 11434 4 2 1', 'TCPABORT 1 2',
    `TCPARMED ${PID} 11434 4 2 0\nTCPARMED ${PID} 11434 4 2 0`,
    `TCPARMED ${PID} 11434 4 2 0\nSECRET\n`,
  ]) assert.throws(()=>parseKernelArm(raw,PID));
  assert.equal(parseKernelImportReceipt('{"imported":1,"claim":"collector-validated-only"}\n'),1);
  for (const raw of [
    '', '{"imported":0,"claim":"collector-validated-only"}',
    '{"imported":1,"claim":"model-complete"}',
    '{"imported":1,"claim":"collector-validated-only","secret":"x"}',
    '{"imported":1,"claim":"collector-validated-only"}\nextra',
    '{"imported":1,"claim":"collector-validated-only"}\n{"imported":1}',
  ]) assert.throws(()=>parseKernelImportReceipt(raw));
});

test('FIFO reader and STOP use independent remote deadlines and exact owned paths', () => {
  const stop = kernelStopCommand(RUN);
  assert.match(stop,/^\/usr\/bin\/timeout --signal=TERM --kill-after=1s 5s \/usr\/bin\/bash -lc '/);
  assert.match(stop,/test -p \/run\/local-muse-ebpf\/muse-one-0123456789abcdef01234567\/control\.fifo && printf "STOP\\n" >/);
  for (const name of ['ready.fifo','metadata.fifo']) {
    const reader=kernelReaderCommand(RUN,name);
    assert.match(reader,/exec \/usr\/bin\/timeout --signal=TERM --kill-after=2s/);
    assert.match(reader,new RegExp(`${name.replace('.','\\.')}`));
  }
  assert.match(kernelReaderCommand(RUN,'ready.fifo'),/130s \/usr\/bin\/cat/);
  assert.match(kernelReaderCommand(RUN,'metadata.fifo'),/1810s \/usr\/bin\/cat/);
  assert.match(kernelStopCommand(RUN,true),/if test -p .*; then printf/);
  for (const invalid of ['other-run','muse-one-not-a-valid-id',
    `${RUN};sudo`,RUN.replace('a','_')]) {
    assert.throws(()=>kernelStopCommand(invalid));
  }
  assert.throws(()=>kernelReaderCommand(RUN,'arbitrary.fifo'));
});

test('arm waits for SSH close and drains importer only after complete EOF', async () => {
  const s = scenario({prematureExit:true});
  const a = await s.bridge.arm({runId:RUN,receipts:s.receipts,journal:s.journal});
  assert.equal(a.ready,true);
  assert.equal(a.completedNativeAttach,true);
  assert.equal((await s.bridge.check({runId:RUN})).identity,a.identity);
  assert.equal(s.stages().ready.exitCode,0);
  await s.bridge.drain({runId:RUN});
  assert.equal(s.stages().forwarded,'TCPSESSION complete 0 0 0 0 450\n');
  assert.deepEqual(await s.bridge.terminal({runId:RUN}),
    {runId:RUN,source:'kernel',identity:a.identity,complete:true,loss:0,pending:0});
  const stop=await s.bridge.stop({runId:RUN});
  assert.equal(stop.clean,true);
  assert.equal(s.calls.filter(c=>c.kind==='start').length,3);
  assert.equal(s.calls.filter(c=>c.kind==='remote'&&c.command.includes('control.fifo')).length,1);
});

test('operator handoff is a single read-only callback after SSH readers and importer', async () => {
  const called=[];
  let s;
  const onOperatorStep = async value => {
    called.push(value);
    assert.deepEqual(value,{runId:RUN,pid:PID});
    assert.equal(s.calls.filter(c=>c.kind==='start').length,3,
      'both protected FIFO readers and importer must be started before operator prompt');
    assert.ok(s.stages().data);
    assert.ok(s.stages().ready);
    assert.ok(s.stages().importer);
  };
  s = scenario({onOperatorStep});
  await s.bridge.arm({runId:RUN,receipts:s.receipts,journal:s.journal});
  assert.equal(called.length,1);
  await s.bridge.check({runId:RUN});
  assert.equal(called.length,1);
  await s.bridge.drain({runId:RUN});
  await s.bridge.stop({runId:RUN});
});

test('operator prompt callback failure releases SSH readers and importer', async () => {
  const s=scenario({onOperatorStep:()=>{throw Error('cannot-show-operator-step');}});
  await assert.rejects(()=>s.bridge.arm({runId:RUN,receipts:s.receipts,journal:s.journal}),
    /cannot-show-operator-step/);
  assert.equal(s.stages().data.signalCode,'SIGTERM');
  assert.equal(s.stages().ready.signalCode,'SIGTERM');
  assert.equal(s.stages().importer.signalCode,'SIGTERM');
});

test('malformed readiness self-cleans all children on arm rejection', async () => {
  const s = scenario({arm:'TCPABORT 1 2\n'});
  await assert.rejects(()=>s.bridge.arm({runId:RUN,receipts:s.receipts,journal:s.journal}));
  assert.equal(s.stages().data.signalCode,'SIGTERM');
  assert.equal(s.stages().importer.signalCode,'SIGTERM');
  assert.ok(s.calls.some(c=>c.kind==='remote'&&c.command.includes('control.fifo')));
});

test('missing ready marker times out and self-cleans owned processes', async () => {
  const s = scenario({abortBeforeArm:true});
  await assert.rejects(()=>s.bridge.arm({runId:RUN,receipts:s.receipts,journal:s.journal}),
    /arm-channel-failed/);
  assert.equal(s.stages().data.signalCode,'SIGTERM');
  assert.equal(s.stages().ready.signalCode,'SIGTERM');
  assert.equal(s.stages().importer.signalCode,'SIGTERM');
});

test('source terminal fails closed on importer partial exit or extra stderr', async () => {
  for (const options of [
    {importerExit:1},{sourceExit:1},
    {importerReply:'{"imported":1,"claim":"collector-validated-only"}\nextra\n'},
    {importerReply:''},
    {importerStdout:'unexpected importer stdout\n'},
  ]) {
    const s=scenario(options);
    await s.bridge.arm({runId:RUN,receipts:s.receipts,journal:s.journal});
    await assert.rejects(()=>s.bridge.drain({runId:RUN}),/kernel-terminal-or-importer-failed/);
    assert.equal((await s.bridge.terminal({runId:RUN})).complete,false);
    await s.bridge.stop({runId:RUN});
  }
});

test('importer stdin EPIPE revokes readiness and leaves only partial evidence', async () => {
  const s=scenario();
  await s.bridge.arm({runId:RUN,receipts:s.receipts,journal:s.journal});
  s.stages().importer.stdin.emit('error',Error('EPIPE'));
  await assert.rejects(()=>s.bridge.check({runId:RUN}),/kernel-not-currently-armed/);
  assert.equal((await s.bridge.terminal({runId:RUN})).complete,false);
  await s.bridge.stop({runId:RUN});
});

test('actual Node import-kernel receives synthetic FIFO EOF and writes durable kernel terminal', async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),'one-muse-bridge-offline-'));
  let server;
  try {
    server=await startDeliveryServer(root,RUN,{requireKernelSession:true});
    const children=[];
    let metadata,arm;
    const start=(file,args,options)=>{
      if(file==='node.exe') {
        return spawn(process.execPath,args,{...options,windowsHide:true});
      }
      const child=new Child(4000+children.length);
      children.push(child);
      if(args.some(v=>typeof v==='string'&&v.includes('metadata.fifo'))) metadata=child;
      if(args.some(v=>typeof v==='string'&&v.includes('ready.fifo'))) {
        arm=child;
        setTimeout(()=>{arm.stdout.end(`TCPARMED ${PID} 11434 4 2 0\n`);arm.finish(0);},15);
      }
      return child;
    };
    const remoteExec=async command=>{
      if(command.includes('control.fifo')) {
        setImmediate(()=>{
          metadata.stdout.end([
            'TCPMETA attempt 100150000 1139 1140 987654 11434 43000 149 0 ollama',
            'TCPMETA send 100180000 1139 1140 987654 11434 43000 149 149 ollama',
            'TCPSESSION complete 1 1 0 0 450',
            '',
          ].join('\n'));
          metadata.finish(0);
        });
      }
      return '';
    };
    const journal={url:server.url,nonce:server.nonce,status:async requested=>{
      assert.equal(requested,RUN);
      const response=await fetch(`${server.url}/v1/status`,{method:'POST',
        headers:{'content-type':'application/json','x-clack-delivery-session':server.nonce},
        body:'{}'});
      assert.equal(response.status,200);
      const s=await response.json();
      return {kernelCompletions:s.kernelCompletions,loss:s.dropped+s.sourceLoss,
        pending:s.activeObservations,durable:s.ok && !s.failed && !s.sourceFailed};
    }};
    const bridge=createOneMuseKernelBridge({sshKey:'C:\\approved\\id',
      workdir:path.join(HERE,'..'),start,remoteExec,armTimeoutMs:2000});
    const receipts=new Map([
      ['mapping',{ollamaPid:PID}],
      ['clocks',{sampleCount:3,uncertaintyUs:5000,
        remoteAnchorUnixUs:1794196108268000,remoteAnchorMonoUs:100000}],
    ]);
    await bridge.arm({runId:RUN,receipts,journal});
    await bridge.drain({runId:RUN});
    assert.equal((await bridge.terminal({runId:RUN})).complete,true);
    assert.equal(server.snapshot().kernelCompletions,1);
    assert.equal(server.snapshot().count,3);
    assert.equal(server.snapshot().sourceFailed,false);
    assert.equal((await bridge.stop({runId:RUN})).clean,true);
  } finally {
    if(server) await server.stop();
    await rm(root,{recursive:true,force:true});
  }
});

test('cleanup cannot assert success when remote root stage still exists', async () => {
  const s=scenario({missingCleanup:true});
  await s.bridge.arm({runId:RUN,receipts:s.receipts,journal:s.journal});
  await s.bridge.drain({runId:RUN});
  assert.equal((await s.bridge.stop({runId:RUN})).clean,false);
});

test('uncertain first STOP causes bounded second STOP during cleanup', async () => {
  const s=scenario({firstStopFails:true});
  await s.bridge.arm({runId:RUN,receipts:s.receipts,journal:s.journal});
  await assert.rejects(()=>s.bridge.drain({runId:RUN}),/missing-ssh-stop-receipt/);
  const cleanup=await s.bridge.stop({runId:RUN});
  assert.equal(cleanup.clean,true);
  assert.equal(s.calls.filter(c=>c.kind==='remote'&&c.command.includes('control.fifo')).length,2);
  assert.match(s.calls.filter(c=>c.kind==='remote'&&c.command.includes('control.fifo'))[1].command,
    /timeout --signal=TERM --kill-after=1s 5s/);
});

test('operator scripts stage only reviewed files, guard FIFO open with timeout', async () => {
  const root=await readFile(path.join(HERE,'local-muse-one-root.sh'),'utf8');
  const ps=await readFile(path.join(HERE,'Run-OneMuseKernelOperator.ps1'),'utf8');
  assert.match(root,/seconds=\$\{3:-1800\}/);
  assert.match(root,/seconds_plus_six=\$\(\(seconds \+ 6\)\)/);
  assert.match(root,/\/usr\/bin\/timeout --signal=TERM --kill-after=2s "\$\{seconds_plus_six\}s"\s+\\\s+\/usr\/bin\/bash -c/);
  assert.match(root,/--seconds "\$6"/);
  assert.match(root,/seconds -gt 20/);
  assert.match(root,/0<>"\$3" 1>"\$4" 3>"\$5"/);
  assert.match(root,/chmod 0620 -- "\$control"/);
  assert.match(root,/chmod 0640 -- "\$ready" "\$metadata"/);
  assert.match(root,/OPERATOR_EBPF_CLEANUP/);
  assert.match(root,/KERNEL_AUDIT_OPERATOR_CHILD_EXIT/);
  assert.match(root,/KERNEL_AUDIT_\[A-Z0-9_\]/);
  assert.match(root,/\/usr\/bin\/rmdir -- "\$root" 2>\/dev\/null \|\| clean=FAIL/);
  const bridgeSource=await readFile(path.join(HERE,'local-muse-one-kernel-bridge.mjs'),'utf8');
  assert.match(bridgeSource,/test ! -e \/run\/local-muse-ebpf && test ! -L \/run\/local-muse-ebpf/);
  assert.match(ps,/test ! -L \/run\/local-muse-ebpf/);
  assert.match(ps,/test -d "\$stage" && test ! -L "\$stage"/);
  assert.match(ps,/USER_STAGE_CLEANUP=FAIL/);
  assert.match(ps,/KERNEL_OPERATOR_SSH_EXIT=/);
  assert.match(ps,/kernel-operator-audit\.numeric/);
  assert.match(ps,/operator-audit\.numeric/);
  assert.match(ps,/\/usr\/bin\/timeout --signal=TERM --kill-after=2s 8s \/usr\/bin\/bash -s/);
  assert.match(ps,/trap release EXIT/);
  assert.doesNotMatch(ps,/trap - EXIT/);
  assert.match(ps,/status=0\s+\/usr\/bin\/bash "\$dest\/local-muse-one-root\.sh" "\$run" "\$pid" "\$seconds" "\$stage" \|\| status=\$\?/);
  assert.doesNotMatch(ps,/Remove-Item.*-Recurse/);
});

test('root shell, bootstrap and user cleanup parse in Bash syntax-only mode', async t => {
  const bash = process.platform === 'win32'
    ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/usr/bin/bash';
  if(!existsSync(bash)) return t.skip('Local Bash parser unavailable');
  const root = spawnSync(bash,['-n',path.join(HERE,'local-muse-one-root.sh')],
    {windowsHide:true,encoding:'utf8'});
  assert.equal(root.status,0,root.stderr);
  const ps=await readFile(path.join(HERE,'Run-OneMuseKernelOperator.ps1'),'utf8');
  for(const field of ['bootstrap','cleanupScript']) {
    const source = new RegExp(`\\$${field} = @'\\r?\\n([\\s\\S]*?)\\r?\\n'@`).exec(ps);
    assert.ok(source,`Missing ${field} inline Bash source`);
    const syntax=spawnSync(bash,['-n'],{input:source[1],windowsHide:true,encoding:'utf8'});
    assert.equal(syntax.status,0,`${field}: ${syntax.stderr}`);
  }
});
