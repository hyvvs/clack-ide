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
// Root intentionally emits validated TCPMETA rows only after STOP and the
// END/inventory checks. The accepted one-request run produced 7,122 socket
// rows in that terminal burst; a 15s importer deadline cut off TCPSESSION.
// This is bounded post-request draining, not a kernel/HTTP timeout change.
export const KERNEL_TERMINAL_IMPORT_DRAIN_MS = 75_000;

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
  armTimeoutMs = 120000, onDiagnostic = null} = {}) {
  assert(path.isAbsolute(sshKey) && path.isAbsolute(workdir),
    'absolute-owned-ssh-arguments-required');
  assert(onOperatorStep === null || typeof onOperatorStep === 'function',
    'operator-prompt-callback-must-be-a-function');
  assert(onDiagnostic === null || typeof onDiagnostic === 'function',
    'closed-vocabulary-diagnostic-callback-required');
  assert(Number.isSafeInteger(armTimeoutMs) && armTimeoutMs > 0 &&
    armTimeoutMs <= 180000, 'bounded-operator-arming-required');
  let runId = null, ready = null;
  let expectedPid = null, dataReader = null, armReader = null, importer = null;
  let importedOk = false, drained = false, readError = false;
  let operatorAnnounced = false;
  let armClosed = false, dataClosed = false, importerClosed = false;
  let importerMessage = '', deliveryJournal = null;
  let notice = '', readinessNoticeBytes=0, metadataBytes=0, armStart=0;
  const observe = (name,fields={}) => { if(onDiagnostic) onDiagnostic(name,fields); };
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
      armStart=now();
      observe('collector_arm_start',{expected_pid:expectedPid,
        arm_timeout_ms:armTimeoutMs});
      try {
        dataReader = start('ssh.exe',sshArgs(kernelReaderCommand(runId,'metadata.fifo')),
          {stdio:['ignore','pipe','pipe'],windowsHide:true});
        armReader = start('ssh.exe',sshArgs(kernelReaderCommand(runId,'ready.fifo')),
          {stdio:['ignore','pipe','pipe'],windowsHide:true});
        assert(dataReader?.pid > 0 && armReader?.pid > 0,'ssh-fifo-readers-not-started');
        observe('collector_readers_started',{metadata_reader_pid:dataReader.pid,
          ready_reader_pid:armReader.pid});
        for(const child of [dataReader,armReader]) {
          child.on('error',()=>{readError=true;
            observe('collector_reader_error',{error:'process_error'});});
          child.stdout?.on('error',()=>{readError=true;
            observe('collector_reader_error',{error:'stdout_error'});});
          child.stderr?.on('error',()=>{readError=true;
            observe('collector_reader_error',{error:'stderr_error'});});
          child.stderr?.on('data',chunk=>{
            if(chunk.length){readError=true;
              observe('collector_reader_error',{error:'ssh_stderr',
                bytes:Math.min(chunk.length,1048576)});}
          });
        }
        dataReader.once('close',(code,signal)=>{dataClosed=true;
          observe('collector_reader_exit',{role:'metadata',
            exit_code:Number.isInteger(code)?code:-1,signal:signal??'none',
            metadata_bytes:metadataBytes});});
        armReader.once('close',(code,signal)=>{armClosed=true;
          observe('collector_reader_exit',{role:'ready',
            exit_code:Number.isInteger(code)?code:-1,signal:signal??'none',
            readiness_bytes:readinessNoticeBytes});});
        dataReader.stdout?.on('data',chunk=>{metadataBytes+=chunk.length;});
        importer = start('node.exe',[
          'scripts/local-muse-delivery-cli.mjs','import-kernel',
          journal.url,journal.nonce,'ollama','ollama-loopback',
          String(clocks.uncertaintyUs),String(clocks.remoteAnchorUnixUs),
          String(clocks.remoteAnchorMonoUs)],
        {cwd:workdir,stdio:['pipe','pipe','pipe'],windowsHide:true,
          env:{...process.env,CLACK_ONE_MUSE_DIAGNOSTIC_RUN_ID:runId}});
        assert(importer?.pid>0 && importer.stdin && dataReader.stdout,
          'kernel-importer-not-started');
        observe('collector_importer_started',{importer_pid:importer.pid});
        importer.on('error',()=>{readError=true;
          observe('collector_importer_error',{error:'process_error'});});
        importer.once('close',(code,signal)=>{importerClosed=true;
          observe('collector_importer_exit',{
            exit_code:Number.isInteger(code)?code:-1,signal:signal??'none'});});
        importer.stdin.on('error',()=>{readError=true;
          observe('collector_importer_error',{error:'stdin_error'});}); // EPIPE fail closed
        importer.stdout?.on('error',()=>{readError=true;
          observe('collector_importer_error',{error:'stdout_error'});});
        importer.stdout?.on('data',chunk=>{
          // import-kernel emits its sole terminal receipt on stderr; unexpected
          // stdout must never be hidden as if it were valid metadata.
          if(chunk.length){readError=true;
            observe('collector_importer_error',{error:'unexpected_stdout',
              bytes:Math.min(chunk.length,1048576)});}
        });
        importer.stderr?.on('error',()=>{readError=true;
          observe('collector_importer_error',{error:'stderr_error'});});
        dataReader.stdout.pipe(importer.stdin);
        importer.stdout?.resume();
        importer.stderr?.on('data',chunk=>{
          // The importer emits exactly one small numeric completion record.
          if(Buffer.byteLength(importerMessage)+chunk.length>1024){
            readError=true;
            observe('collector_importer_error',{error:'stderr_overflow'});
          }
          else importerMessage += chunk.toString('utf8');
        });
        armReader.stdout?.on('data',chunk=>{
          readinessNoticeBytes+=chunk.length;
          if(Buffer.byteLength(notice)+chunk.length>128){
            readError=true;
            observe('collector_ready_error',{error:'ready_overflow'});
          }
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
        observe('collector_waiting_ready',{reader_pid:armReader.pid,
          importer_pid:importer.pid,control_stop_armed:false});
        const deadline=now()+armTimeoutMs;
        while(now()<deadline && !armClosed && !readError) {
          await new Promise(resolve=>setTimeout(resolve,80));
        }
        observe('collector_ready_wait_end',{elapsed_ms:Math.max(0,now()-armStart),
          read_error:readError,reader_closed:armClosed,
          reader_exit:Number.isInteger(armReader.exitCode)?armReader.exitCode:-1,
          ready_notice:notice.startsWith('TCPARMED ')?'armed':
            notice.startsWith('TCPABORT ')?'abort':
            notice.length===0?'missing':'invalid',
          importer_alive:owned(importer),metadata_reader_alive:owned(dataReader)});
        assert(!readError && armClosed && armReader.exitCode===0,
          'root-collector-arm-channel-failed');
        const proof = parseKernelArm(notice,expectedPid);
        assert(owned(dataReader) && owned(importer),'kernel-source-exited-before-admission');
        ready = Object.freeze({runId,source:'kernel',
          identity:`kernel-${expectedPid}-${proof.newKprobeCount}`,
          ready:true,loss:0,pending:0,pid:expectedPid,
          port:11434,completedNativeAttach:true,loadedProgram:true,
          identityVerified:true});
        observe('collector_ready_accepted',{pid:expectedPid,
          ready_fifo_writer_opened:true,control_stop_armed:true});
        return ready;
      } catch(error) {
        const kind=String(error?.message??'unknown');
        const safe=/^[a-z0-9-]{1,96}$/.test(kind)?kind:'unexpected_exception';
        observe('collector_arm_failure',{reason:safe,
          readiness_bytes:readinessNoticeBytes,metadata_bytes:metadataBytes,
          ready_reader_exited:armClosed,importer_exited:importerClosed,
          read_error:readError,elapsed_ms:Math.max(0,now()-armStart)});
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
      const deadline=now()+KERNEL_TERMINAL_IMPORT_DRAIN_MS;
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
      observe('collector_stop_sources',{stop_attempted:true,
        ready_reader_closed:armClosed,metadata_reader_closed:dataClosed,
        importer_closed:importerClosed});
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
