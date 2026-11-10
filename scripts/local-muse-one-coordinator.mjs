#!/usr/bin/env node
/** FUTURE-ONLY orchestration for one explicitly authorized Muse diagnostic.
 *
 * No inference is launched by this program. It opens an exclusive metadata
 * journal, approved owned tunnel, cross-host clocks, awaits a human-operated
 * root eBPF collector, and arms the isolated Clack Tauri/WebView observers.
 * Only then does a visible, human-clicked WebView button become eligible to
 * obtain the coordinator's one-time permit for real production doStream().
 *
 * Do NOT run this entry point as part of offline validation. No privileged
 * command or model is started by importing this module.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { ONE_SESSION_GATES, OneMuseDiagnosticSession } from './local-muse-one-session.mjs';
import { makeOneMuseJournal } from './local-muse-one-journal.mjs';
import { createOneMuseHostSources } from './local-muse-one-host-sources.mjs';
import { createOneMuseKernelBridge } from './local-muse-one-kernel-bridge.mjs';
import { createOneMuseReadyBroker } from './local-muse-one-ready-broker.mjs';
import { createOneMuseAppHost } from './local-muse-one-app-host.mjs';

const REPOSITORY = fileURLToPath(new URL('../', import.meta.url));
const RUN_ID = /^muse-one-[a-f0-9]{24}$/;
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const report = (name,value) => {
  assert(/^[A-Z_]{3,48}$/.test(name) &&
    /^[a-zA-Z0-9_-]{1,120}$/.test(value),
  'Bounded numeric/status report only');
  process.stdout.write(`${name}=${value}\n`);
};

/** A run must be explicitly operator-created. There is no implicit host,
 * profiler, model or sudo workflow and no reuse of a historical acceptance
 * root. The operator PowerShell command is merely displayed, never executed.
 */
export async function runFutureOneMuseCoordinator({
  repo = REPOSITORY,
  baseRoot = path.join(REPOSITORY,'src-tauri','target','local-muse-one-evidence'),
  binary = path.join(REPOSITORY,'src-tauri','target','debug','examples',
    'local_muse_one_diagnostic.exe'),
  sshKey = path.join(os.homedir(),'.ssh','clack_hylab_ed25519'),
  manifestPath = path.join(REPOSITORY,'src-tauri','target','real-qwen-product',
    'forgeboardmuse-20261109-01','mission-evidence-manifest.json'),
  viteFactory = null,
  logger = report,
  maxIdleMs = 300_000,
  maxTotalMs = 1_800_000,
} = {}) {
  assert(path.resolve(repo) === path.resolve(REPOSITORY),
    'selected-repository-root-required');
  assert(Number.isSafeInteger(maxIdleMs)&&maxIdleMs>=1000&&maxIdleMs<=1_800_000 &&
    Number.isSafeInteger(maxTotalMs)&&maxTotalMs>=maxIdleMs&&maxTotalMs<=1_800_000,
  'bounded-future-run-required');
  // A missing binary aborts before opening a tunnel, staging BPF or starting
  // an evidence server. Building the binary is an OFFLINE prerequisite.
  assert((await stat(binary)).isFile(), 'reviewed-diagnostic-host-not-built');
  assert((await stat(sshKey)).isFile(), 'approved-ssh-key-not-available');
  await mkdir(baseRoot,{recursive:true,mode:0o700});
  const runId = `muse-one-${randomBytes(12).toString('hex')}`;
  assert(RUN_ID.test(runId),'fresh-opaque-run-id-required');
  let vite=null, broker=null, session=null, app=null, aborted=false, ready=false;
  let finished=null;
  const interrupt = () => { aborted=true; };
  process.once('SIGINT',interrupt);
  process.once('SIGTERM',interrupt);
  try {
    // The custom HTML has no Agent, ForgeBoard, Notes, evaluator or background
    // model task. It explicitly exposes only the guarded manual button.
    const factory = viteFactory ?? (async () => {
      const { createServer } = await import('vite');
      return createServer({root:repo,logLevel:'silent',server:{
        host:'127.0.0.1',port:0,strictPort:true},clearScreen:false});
    });
    vite = await factory();
    await vite.listen();
    const address = vite.httpServer?.address();
    assert(address && typeof address === 'object' && Number.isSafeInteger(address.port),
      'diagnostic-webview-server-unavailable');
    const url = `http://127.0.0.1:${address.port}/local-muse-one.html`;

    // The broker's nonce and one-shot permit never appear on the console or
    // disk. Only a hash enters the native host process environment.
    broker=await createOneMuseReadyBroker(runId,{
      onClaim:async payload => session.claimOne(payload),
      onSettled:async payload => session.settleOne(payload),
    });
    const host = createOneMuseHostSources({manifestPath,sshKey});
    const kernel = createOneMuseKernelBridge({sshKey,workdir:repo,
      armTimeoutMs:180_000,
      onOperatorStep:({runId:operatorRun,pid})=>{
        assert(operatorRun===runId && Number.isSafeInteger(pid)&&pid>1,
          'operator-step-identity-failed');
        logger('OPERATOR_KERNEL_PID',String(pid));
        // Literal stable script path, no credentials and no sudo password.
        process.stdout.write(
          'FUTURE_OPERATOR_COMMAND=powershell.exe -NoProfile -ExecutionPolicy Bypass '+
          `-File .\\scripts\\Run-OneMuseKernelOperator.ps1 -RunId ${runId} -ExpectedPid ${pid}\n`);
      }});
    app = createOneMuseAppHost({broker,binary,webviewUrl:url});
    const sources={...host.sources,kernel,...app.sources};
    assert(ONE_SESSION_GATES.filter(g=>g!=='journal').every(
      g=>typeof sources[g]?.arm==='function'),'missing-real-source-adapter');
    session=new OneMuseDiagnosticSession({baseRoot,runId,sources,
      makeJournal:makeOneMuseJournal});
    await session.open();
    logger('EXCLUSIVE_RUN_ID',runId);
    logger('INITIAL_REQUEST_ALLOWANCE','1');
    // All nine ACKs are journaled and fsynced. The operator supplies sudo
    // interactively in their own terminal; this process never calls sudo.
    const admission = await session.arm();
    if(admission!=='READY_FOR_ONE_INFERENCE'){
      logger('INFERENCE_ADMISSION','BLOCKED');
      logger('FAILED_GATE',session.failedGate ?? 'unknown');
      finished=await session.finish('preflight-blocked',{allowSeal:false});
      return finished;
    }
    ready=true;
    logger('INFERENCE_ADMISSION','READY_FOR_ONE_INFERENCE');
    logger('AUTOMATIC_INFERENCE','DISABLED');
    // Only an explicit future button click can call the broker claim route.
    // A timeout or signal consumes no request and never seals evidence.
    const deadline = Date.now()+maxTotalMs;
    const idleDeadline=Date.now()+maxIdleMs;
    while(!aborted && Date.now()<deadline &&
      (!broker.snapshot().requestSettled)) {
      if(!broker.snapshot().claimed && Date.now()>idleDeadline) break;
      await sleep(250);
    }
    const settled=broker.snapshot().requestSettled;
    finished=await session.finish(settled ? 'request-settled' : 'no-complete-request',
      {allowSeal:settled && !aborted});
    logger('EVIDENCE_STATUS',finished.status);
    logger('REQUEST_ALLOWANCE_REMAINING',String(finished.requestAllowance));
    return finished;
  } finally {
    // Every path, including partial startup and an interrupted operator
    // session, is best-effort bounded teardown. Failure NEVER seals.
    if(session && !['partial','sealed'].includes(session.status))
      finished=await session.finish('future-coordinator-finally',
        {allowSeal:false}).catch(()=>finished);
    await app?.terminate().catch(()=>undefined);
    await broker?.close().catch(()=>undefined);
    await vite?.close().catch(()=>undefined);
    process.removeListener('SIGINT',interrupt);
    process.removeListener('SIGTERM',interrupt);
    if(!ready) logger('INFERENCE_ADMISSION','BLOCKED');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url))) {
  if (process.argv.length !== 3 || process.argv[2] !== '--future-operator-authorized') {
    process.stderr.write(
      'Future authorized operator usage only: node scripts/local-muse-one-coordinator.mjs --future-operator-authorized\n'+
      'This does not send model requests; the isolated WebView requires an additional explicit manual click.\n');
    process.exitCode=2;
  }else{
    runFutureOneMuseCoordinator().catch(()=>{
      // Do not emit raw exception text, commands, secrets or task-owned paths.
      report('INFERENCE_ADMISSION','BLOCKED');
      report('COORDINATOR_RESULT','PARTIAL');
      process.exitCode=1;
    });
  }
}
