#!/usr/bin/env node
/** ONE authorized, no-Ollama-HTTP, diagnostic-only crash-location session.
 *
 * This deliberately does NOT import or launch the nine-gate coordinator,
 * app, WebView, model provider, inference, or broker. It reuses the *real*
 * kernel bridge and its real import-kernel CLI, with host metadata-only
 * identity/tunnel/mapping/clock observations (NO /api/tags). Root remains an
 * entirely separate interactive operator step, never executed here.
 * This standalone diagnostic can NEVER mark TCPARMED or readiness PASS.
 */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdir,open,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {startDeliveryServer} from './local-muse-delivery-cli.mjs';
import {createCrashOnlyHostSources} from './local-muse-crash-only-host-sources.mjs';
import {createOneMuseKernelBridge} from './local-muse-one-kernel-bridge.mjs';

const repo = fileURLToPath(new URL('../',import.meta.url));
const base = path.join(repo,'src-tauri','target','local-muse-one-evidence');
const key = path.join(os.homedir(),'.ssh','clack_hylab_ed25519');
const manifest = path.join(repo,'src-tauri','target','real-qwen-product',
  'forgeboardmuse-20261109-01','mission-evidence-manifest.json');
const KERNEL_SECONDS = 20;
const SOURCES=['identity','tunnel','mapping','clocks'];
const safe = s => /^[a-z0-9_-]{1,90}$/.test(s);
const bounded = n => Number.isSafeInteger(n)&&n>=0;

export async function runCrashOnlyCheck() {
  assert((await stat(key)).isFile(),'approved-ssh-key-missing');
  await mkdir(base,{recursive:true,mode:0o700});
  const runId='muse-one-'+randomBytes(12).toString('hex');
  const root=path.join(base,runId);
  await mkdir(root,{recursive:false,mode:0o700});
  const lifecycle=await open(path.join(root,'kernel-only-lifecycle.jsonl'),'wx',0o600);
  let journal=null, bridge=null, host=null, ready=false, terminal=false, clean=true;
  const armed=[], receipts=new Map();
  const line=async (kind,result) => {
    assert(safe(kind)&&safe(result),'bounded-kernel-only-status');
    const row={kind,result,runId,atUnixMs:Date.now()};
    await lifecycle.writeFile(JSON.stringify(row)+'\n');
    await lifecycle.sync();
    process.stdout.write(`${kind.toUpperCase()}=${result}\n`);
  };
  const observe = async (kind,source,identity) => {
    const now=Date.now(),monoUs=Number(process.hrtime.bigint()/1000n);
    const row={schemaVersion:1,runId,host:'collector',layer:'collector',
      kind,source,sourceIdentity:identity,result:'ok',
      atUnixMs:now,monoUs};
    return post('/v1/observe',row);
  };
  let server=null;
  const post = async (route,body) => {
    assert(server,'kernel-only-journal-not-open');
    const response=await fetch(server.url+route,{method:'POST',
      headers:{'content-type':'application/json',
        'x-clack-delivery-session':server.nonce},
      body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
    assert(response.ok,'kernel-only-journal-durable-ack-required');
    return response.json();
  };
  const status=async ()=> {
    const snapshot=await post('/v1/status',{});
    return {runId,kernelCompletions:snapshot.kernelCompletions,
      count:snapshot.count,loss:snapshot.dropped+snapshot.sourceLoss,
      pending:snapshot.activeObservations,
      durable:snapshot.ok===true&&!snapshot.failed&&!snapshot.sourceFailed&&
        snapshot.sealed===false};
  };
  try {
    await line('kernel_only_run_id',runId);
    const folder=path.join(root,'delivery');
    await mkdir(folder,{recursive:false,mode:0o700});
    // Kernel-only journal requirements are STRICTER than ordinary evidence:
    // one complete kernel terminal, zero loss, no other session requested.
    // The complete nine-source readiness journal is never opened or forged.
    server=await startDeliveryServer(folder,runId,
      {requireKernelSession:true,requireOneSession:false});
    journal={
      url:server.url,nonce:server.nonce,status:async id=>{
        assert(id===runId,'stale-kernel-only-run');return status();
      },
      recordMetadata:row=>post('/v1/observe',row),
    };
    host=createCrashOnlyHostSources({manifestPath:manifest,sshKey:key});
    bridge=createOneMuseKernelBridge({sshKey:key,workdir:repo,
      armTimeoutMs:120000,
      onOperatorStep:({runId:operatorId,pid})=>{
        assert(operatorId===runId&&bounded(pid)&&pid>1,'operator-id-mismatch');
        process.stdout.write(`OPERATOR_KERNEL_PID=${pid}\n`);
        process.stdout.write(
          'KERNEL_ONLY_OPERATOR_COMMAND=powershell.exe -NoProfile '+
          '-ExecutionPolicy Bypass -File .\\scripts\\Run-OneMuseKernelOperator.ps1 '+
          `-RunId ${runId} -ExpectedPid ${pid} -Seconds ${KERNEL_SECONDS} -CrashCapture\n`);
      }});
    for(const source of SOURCES) {
      const adapter=host.sources[source];
      armed.push(source);
      const receipt=await adapter.arm({runId,root,receipts,journal});
      assert(receipt?.runId===runId&&receipt.source===source&&
        receipt.ready===true&&receipt.loss===0&&receipt.pending===0,
      `kernel-only-${source}-not-ready`);
      receipts.set(source,receipt);
      await observe('source-ready',source,receipt.identity);
      await line(source,'pass');
    }
    armed.push('kernel');
    // The root GDB observer deliberately leaves FIFO READY unwritten. A
    // surprise success is also forbidden: no diagnostic frame or debugger
    // status can qualify a new session link. DO NOT call drain or arm Muse.
    await bridge.arm({runId,root,receipts,journal});
    throw Error('crash-observer-must-never-arm-readiness');
  } catch(error) {
    await line('kernel_only_result','blocked');
    await line('failed_stage',armed.at(-1)??'journal');
    // Only validated enum values enter the durable status. Failure detail is
    // never a reason to infer absent traffic or retry the privileged session.
  } finally {
    for(const source of armed.reverse()){
      const adapter=source==='kernel'?bridge:host?.sources[source];
      if(!adapter)continue;
      try{
        if(source!=='kernel' || ready) {
          const t=await adapter.terminal({runId});
          if(t?.complete===true&&t.loss===0&&t.pending===0&&
            t.identity===receipts.get(source)?.identity) {
            await observe('source-terminal',source,t.identity);
          }else clean=false;
        }
      }catch{clean=false;}
      try {
        const s=await adapter.stop({runId,reason:'kernel-only-check-ended'});
        if(s?.clean!==true)clean=false;
      }catch{clean=false;}
    }
    if(server) {
      try {
        const s=await status();
        if(ready&&terminal&&clean&&s.durable&&s.kernelCompletions===1&&
          s.loss===0&&s.pending===0){
          const sealed=await post('/v1/finish',
            {expected:s.count,deliveryFailed:false});
          assert(sealed.receipt?.claim==='collector-flush-only',
            'kernel-only-collector-receipt-missing');
          await line('kernel_only_evidence','collector-flush-only');
        }else await line('kernel_only_evidence','partial-unsealed');
      }catch{await line('kernel_only_evidence','partial-unsealed');clean=false;}
      await server.stop().catch(()=>{clean=false;});
    }
    await line('task_owned_cleanup',clean?'pass':'unverified');
    await line('tcparmed','fail');
    await line('kernel_gate_ready_for_coordinated_diagnostic','false');
    await lifecycle.close();
  }
  return {runId,ready:false,root};
}

if(process.argv[1]&&path.resolve(process.argv[1])===
  path.resolve(fileURLToPath(import.meta.url))){
  if(process.argv.length!==3||process.argv[2]!=='--operator-authorized-no-http-crash-only'){
    process.stderr.write(
      'Kernel-only operator validation required. No coordinator or model is started.\n');
    process.exitCode=2;
  }else runCrashOnlyCheck().then(result=>{
    process.exitCode=result.ready?0:1;
  }).catch(()=>{
    process.stderr.write('Kernel-only setup failed closed; no inference.\n');
    process.exitCode=1;
  });
}
