/** Future-only Windows/SSH bridge for the approved administrator-operated
 * Linux root collector. This module NEVER runs sudo or starts inference.
 * The administrator starts the separately reviewed root helper interactively.
 */
import assert from 'node:assert/strict';
import { spawn, execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFile = promisify(execFileCb);
const HOST = 'hylab@192.168.1.44';
const REPORTED = /^TCPARMED (\d{1,10}) 11434 4 (\d{1,6}) 0$/;
const RUN = /^muse-one-[a-f0-9]{24}$/;
const STOP_TIMEOUT_SECONDS = 5;

const ownedStage = id => {
  assert(RUN.test(id), 'invalid-exclusive-kernel-run-id');
  return `/run/local-muse-ebpf/${id}`;
};

export function kernelReaderCommand(id, name) {
  assert(name === 'metadata.fifo' || name === 'ready.fifo', 'unknown-kernel-fifo');
  const fifo = `${ownedStage(id)}/${name}`;
  // FIFO open happens inside timeout's child. If no writer ever arrives, the
  // SSH reader still terminates. Never leave a remote cat blocked indefinitely.
  const seconds = name === 'ready.fifo' ? 130 : 1810;
  return `/usr/bin/bash -lc 'for i in $(/usr/bin/seq 1 120); do if test -p ${fifo}; then exec /usr/bin/timeout --signal=TERM --kill-after=2s ${seconds}s /usr/bin/cat ${fifo}; fi; /usr/bin/sleep 1; done; exit 32'`;
}

export function kernelStopCommand(id, optional = false) {
  const fifo = `${ownedStage(id)}/control.fifo`;
  // The *remote* timeout owns the FIFO's blocking O_WRONLY open. Client-side
  // ssh.exe timeouts alone cannot guarantee the remote writer exited.
  const body = optional ? `if test -p ${fifo}; then printf "STOP\\n" > ${fifo}; fi`
    : `test -p ${fifo} && printf "STOP\\n" > ${fifo}`;
  return `/usr/bin/timeout --signal=TERM --kill-after=1s ${STOP_TIMEOUT_SECONDS}s /usr/bin/bash -lc '${body}'`;
}

export function parseKernelImportReceipt(raw) {
  assert(typeof raw === 'string' && Buffer.byteLength(raw) <= 1024,
    'kernel-importer-terminal-overflow');
  const lines = raw.trim().split(/\r?\n/);
  assert(lines.length === 1, 'kernel-importer-reported-extra-output');
  const record = JSON.parse(lines[0]);
  assert(record && typeof record === 'object' && !Array.isArray(record) &&
    Object.keys(record).length === 2 &&
    Number.isSafeInteger(record.imported) && record.imported >= 1 &&
    record.claim === 'collector-validated-only',
  'kernel-importer-not-complete');
  return record.imported;
}

export function parseKernelArm(text, expectedPid) {
  assert(typeof text === 'string' && Buffer.byteLength(text) <= 128,
    'kernel-arm-diagnostic-overflow');
  const lines = text.trim().split(/\r?\n/);
  assert(lines.length === 1,'kernel-arm-exactly-one-ready-required');
  const m = REPORTED.exec(lines[0]);
  // Count is the exact number of independently corroborated new
  // tcp_sendmsg SESSION programs, not one ID per entry/return clause.
  // Trusted root collector independently verifies the new program's
  // kprobe_multi link, target symbol and live tracer ownership.
  assert(m && Number(m[1]) === expectedPid && Number(m[2]) === 1,
    'kernel-pid-probe-load-or-loss-unverified');
  return Object.freeze({pid:expectedPid,port:11434,
    probeCount:4,newKprobeCount:Number(m[2]),loss:0});
}

export function createOneMuseKernelBridge({sshKey, workdir, start = spawn,
  remoteExec = null, onOperatorStep = null, now = () => Date.now(),
  armTimeoutMs = 120000} = {}) {
  assert(path.isAbsolute(sshKey) && path.isAbsolute(workdir),
    'absolute-owned-ssh-arguments-required');
  assert(onOperatorStep === null || typeof onOperatorStep === 'function',
    'operator-prompt-callback-must-be-a-function');
  assert(Number.isSafeInteger(armTimeoutMs) && armTimeoutMs > 0 &&
    armTimeoutMs <= 180000, 'bounded-operator-arming-required');
  let runId = null, ready = null;
  let expectedPid = null, dataReader = null, armReader = null, importer = null;
  let importedOk = false, drained = false, readError = false;
  let operatorAnnounced = false;
  let armClosed = false, dataClosed = false, importerClosed = false;
  let importerMessage = '', deliveryJournal = null;
  const sshArgs = command => ['-T','-o','BatchMode=yes','-o',
    'StrictHostKeyChecking=yes','-o','ConnectTimeout=4',
    '-i',sshKey,HOST,command];
  const runRemote = remoteExec ?? (async command => {
    const {stdout} = await execFile('ssh.exe',sshArgs(command),{
      timeout:12000,maxBuffer:1024,windowsHide:true});
    return stdout;
  });
  const owned = child => child && child.exitCode === null && child.signalCode === null;
  const killOwned = async child => {
    if(!owned(child)) return;
    try { child.kill(); } catch { return; }
    await Promise.race([new Promise(resolve=>child.once('exit',resolve)),
      new Promise(resolve=>setTimeout(resolve,2000))]);
    if(owned(child)) { try { child.kill('SIGKILL'); } catch { /* incomplete */ } }
  };
  const source = {
    async arm({runId:identity,receipts,journal}) {
      assert(runId === null && RUN.test(identity),'one-kernel-session-only');
      assert(receipts.get('mapping')?.ollamaPid > 1,
        'remote-ollama-mapping-not-verified');
      const clocks = receipts.get('clocks');
      assert(clocks?.sampleCount >= 3 && clocks.remoteAnchorMonoUs > 0 &&
        clocks.remoteAnchorUnixUs > 0 && clocks.uncertaintyUs > 0,
      'missing-fresh-cross-host-clock');
      assert(journal && journal.url && journal.nonce,'missing-run-owned-journal');
      runId = identity; expectedPid = receipts.get('mapping').ollamaPid;
      deliveryJournal = journal;
      try {
        dataReader = start('ssh.exe',sshArgs(kernelReaderCommand(runId,'metadata.fifo')),
          {stdio:['ignore','pipe','pipe'],windowsHide:true});
        armReader = start('ssh.exe',sshArgs(kernelReaderCommand(runId,'ready.fifo')),
          {stdio:['ignore','pipe','pipe'],windowsHide:true});
        assert(dataReader?.pid > 0 && armReader?.pid > 0,'ssh-fifo-readers-not-started');
        for(const child of [dataReader,armReader]) {
          child.on('error',()=>{readError=true;});
          child.stdout?.on('error',()=>{readError=true;});
          child.stderr?.on('error',()=>{readError=true;});
          child.stderr?.on('data',chunk=>{
            if(chunk.length) readError = true; // never echo SSH diagnostics
          });
        }
        dataReader.once('close',()=>{dataClosed=true;});
        armReader.once('close',()=>{armClosed=true;});
        importer = start('node.exe',[
          'scripts/local-muse-delivery-cli.mjs','import-kernel',
          journal.url,journal.nonce,'ollama','ollama-loopback',
          String(clocks.uncertaintyUs),String(clocks.remoteAnchorUnixUs),
          String(clocks.remoteAnchorMonoUs)],
        {cwd:workdir,stdio:['pipe','pipe','pipe'],windowsHide:true,
          env:{...process.env,CLACK_ONE_MUSE_DIAGNOSTIC_RUN_ID:runId}});
        assert(importer?.pid>0 && importer.stdin && dataReader.stdout,
          'kernel-importer-not-started');
        importer.on('error',()=>{readError=true;});
        importer.once('close',()=>{importerClosed=true;});
        importer.stdin.on('error',()=>{readError=true;}); // EPIPE must fail closed
        importer.stdout?.on('error',()=>{readError=true;});
        importer.stdout?.on('data',chunk=>{
          // import-kernel emits its sole terminal receipt on stderr; unexpected
          // stdout must never be hidden as if it were valid metadata.
          if(chunk.length) readError=true;
        });
        importer.stderr?.on('error',()=>{readError=true;});
        dataReader.stdout.pipe(importer.stdin);
        importer.stdout?.resume();
        importer.stderr?.on('data',chunk=>{
          // The importer emits exactly one small numeric completion record.
          if(Buffer.byteLength(importerMessage)+chunk.length>1024) readError=true;
          else importerMessage += chunk.toString('utf8');
        });
        let notice = '';
        armReader.stdout?.on('data',chunk=>{
          if(Buffer.byteLength(notice)+chunk.length>128) readError=true;
          else notice += chunk.toString('utf8');
        });
        // The operator prompt is a UI-only handoff after both SSH FIFO readers
        // and the importer are connected. Never execute sudo or this PowerShell
        // command from the bridge itself.
        if(onOperatorStep && !operatorAnnounced) {
          operatorAnnounced=true;
          let timer;
          try {
            await Promise.race([
              Promise.resolve().then(()=>onOperatorStep(Object.freeze({runId,pid:expectedPid}))),
              new Promise((_,reject)=>{timer=setTimeout(()=>reject(
                Error('operator-prompt-not-acknowledged')),5000);}),
            ]);
          } finally { clearTimeout(timer); }
        }
        const deadline=now()+armTimeoutMs;
        while(now()<deadline && !armClosed && !readError) {
          await new Promise(resolve=>setTimeout(resolve,80));
        }
        assert(!readError && armClosed && armReader.exitCode===0,
          'root-collector-arm-channel-failed');
        const proof = parseKernelArm(notice,expectedPid);
        assert(owned(dataReader) && owned(importer),'kernel-source-exited-before-admission');
        ready = Object.freeze({runId,source:'kernel',
          identity:`kernel-${expectedPid}-${proof.newKprobeCount}`,
          ready:true,loss:0,pending:0,pid:expectedPid,
          port:11434,completedNativeAttach:true,loadedProgram:true,
          identityVerified:true});
        return ready;
      } catch(error) {
        // The coordinator only records sources whose arm() resolved. Self-
        // clean partial startup or its orphaned SSH/importer children persist.
        await source.stop({runId}).catch(()=>undefined);
        throw error;
      }
    },
    async check({runId:request}) {
      assert(request===runId && ready && !drained && !readError && !dataClosed && !importerClosed &&
        owned(dataReader) && owned(importer),'kernel-not-currently-armed');
      return ready;
    },
    async drain({runId:request}) {
      assert(request===runId && ready && !drained,'wrong-kernel-stop-ownership');
      drained=true;
      await runRemote(kernelStopCommand(runId));
      const deadline=now()+15000;
      while(now()<deadline && (!importerClosed || !dataClosed)) {
        await new Promise(resolve=>setTimeout(resolve,80));
      }
      importedOk = importerClosed && dataClosed && importer?.exitCode===0 &&
        dataReader?.exitCode===0 && !readError;
      if(importedOk) {
        try { parseKernelImportReceipt(importerMessage); }
        catch { importedOk = false; }
      }
      if(importedOk) {
        const status = await deliveryJournal.status(runId);
        importedOk = status.kernelCompletions===1 &&
          status.loss===0 && status.pending===0 && status.durable===true;
      }
      if(!importedOk) throw Error('kernel-terminal-or-importer-failed');
    },
    async terminal({runId:request}) {
      assert(request===runId,'stale-kernel-terminal');
      return {runId,source:'kernel',identity:ready?.identity??'kernel-unarmed',
        complete:importedOk,loss:readError?1:0,pending:owned(importer)?1:0};
    },
    async stop({runId:request}) {
      assert(request===runId,'stale-kernel-cleanup');
      if(!importedOk) {
        // Retry a bounded STOP after failed/uncertain drain as well as partial
        // startup. A lost SSH acknowledgement must not leave the root tracer
        // solely dependent on its 1800-second outer watchdog.
        await runRemote(kernelStopCommand(runId,true)).catch(()=>undefined);
      }
      await Promise.all([killOwned(armReader),killOwned(dataReader),killOwned(importer)]);
      let remoteClean=false;
      const remoteStage = ownedStage(runId);
      for(let attempt=0;attempt<8 && !remoteClean;attempt++) {
        try {
          // Exit status 0 requires the root operator's owned stage to be
          // completely absent, including dangling symlinks. The root parent
          // was exclusively created for this session and must be gone too.
          await runRemote(`/usr/bin/bash -lc 'test ! -e ${remoteStage} && test ! -L ${remoteStage} && test ! -e /run/local-muse-ebpf && test ! -L /run/local-muse-ebpf'`);
          remoteClean=true;
        } catch { if(attempt<7) await new Promise(resolve=>setTimeout(resolve,300)); }
      }
      return {runId,source:'kernel',clean:remoteClean &&
        !owned(importer) && !owned(dataReader) && !owned(armReader)};
    },
  };
  return Object.freeze(source);
}
