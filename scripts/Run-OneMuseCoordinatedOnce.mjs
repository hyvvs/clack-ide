#!/usr/bin/env node
/** Exact one-use Clack diagnostic via the reviewed nine-source coordinator.
 *
 * Requires the separate, root-owned narrow sudo rule to have passed its
 * no-traffic self-check. Never runs a standalone kernel qualification,
 * calibration, native-tool probe, ForgeBoard mission or frozen evaluator.
 */
import assert from 'node:assert/strict';
import {spawn, execFile as execFileCb} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createOneMuseStartupAudit,parseOneMuseOperatorStderr}
  from './one-muse-coordinated-startup-audit.mjs';
import {coordinatedProcessSamplerCommand,parseCoordinatedProcessSamplerLine}
  from './one-muse-coordinated-process-sampler.mjs';
import {runFutureOneMuseCoordinator}
  from './local-muse-one-coordinator.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const execFile=promisify(execFileCb);
const RUN=/^muse-one-[a-f0-9]{24}$/;
const requirePid=pid=>Number.isSafeInteger(pid)&&pid>1&&pid<=2147483647;
const ps=script=>path.join(ROOT,'scripts',script);
const BASE=path.join(ROOT,'src-tauri','target','local-muse-one-evidence');

export async function runOneMuseCoordinated({
  start=spawn, runCoordinator=runFutureOneMuseCoordinator,
  invokeButton=execFile, makeAudit=createOneMuseStartupAudit,
  startSampler=spawn,
}={}) {
  let operator=null, operatorStarted=false, clicked=false;
  let sampler=null,samplerBytes=0,samplerStderrBytes=0,samplerBuffer='';
  const observedPids=new Set();
  let audit=null, captured=[], stderrHash=createHash('sha256');
  let stderrBytes=0, stderrOverflow=false, childExitPromise=Promise.resolve();
  let resolveChildExit=null;
  const buffered=[];
  const record=(name,fields={})=>{
    if(audit) audit.record(name,fields);
    else if(buffered.length<16) buffered.push([name,fields]);
  };
  const operatorStep=({runId,pid})=>{
    assert(RUN.test(runId)&&requirePid(pid)&&!operatorStarted,
      'exclusive-root-operator-launch-required');
    operatorStarted=true;
    audit=makeAudit({baseRoot:BASE,runId});
    assert(audit&&typeof audit.record==='function'&&typeof audit.close==='function',
      'durable-root-admission-evidence-required');
    for(const [name,fields] of buffered) audit.record(name,fields);
    buffered.length=0;
    record('operator_requested',{expected_pid:pid,root_duration_seconds:1800,
      root_wrapper:'clack-one-muse-root',sudo_mode:'noninteractive',
      root_workdir:'root',root_stderr:'classified'});
    childExitPromise=new Promise(resolve=>{resolveChildExit=resolve;});
    // This observer is an independent, bounded UNPRIVILEGED SSH ps/awk loop.
    // Only the four exact task-run process role+PID+PPID records escape Linux.
    // Never export arbitrary command lines or inspect kernel tracer state.
    if(startSampler){
      const command=coordinatedProcessSamplerCommand(runId);
      const sshKey=path.join(os.homedir(),'.ssh','clack_hylab_ed25519');
      try{
        sampler=startSampler('ssh.exe',[
          '-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',
          '-o','ConnectTimeout=5','-i',sshKey,'hylab@192.168.1.44',command],
        {cwd:ROOT,stdio:['ignore','pipe','pipe'],windowsHide:true});
        if(sampler?.pid>0){
          record('process_sampler_started',{pid:sampler.pid,max_seconds:14});
          sampler.stdout?.on('data',chunk=>{
            samplerBytes+=chunk.length;
            if(samplerBytes>65536)return;
            samplerBuffer+=chunk.toString('utf8');
            let index;
            while((index=samplerBuffer.indexOf('\n'))!==-1){
              const line=samplerBuffer.slice(0,index).replace(/\r$/,'');
              samplerBuffer=samplerBuffer.slice(index+1);
              const row=parseCoordinatedProcessSamplerLine(line);
              if(!row)continue;
              if(!observedPids.has(row.role)){
                observedPids.add(row.role);
                record('remote_root_process_observed',{role:row.role,
                  pid:row.pid,parent_pid:row.parent});
              }
            }
            if(samplerBuffer.length>512) {
              record('process_sampler_error',{reason:'line_overflow'});
              samplerBuffer='';
            }
          });
          sampler.stderr?.on('data',chunk=>{
            samplerStderrBytes+=chunk.length;
          });
          sampler.on('error',()=>record('process_sampler_error',
            {reason:'spawn_error'}));
          sampler.on('close',(code,signal)=>record('process_sampler_exit',{
            exit_code:Number.isInteger(code)?code:-1,signal:signal??'none',
            stderr_bytes:Math.min(samplerStderrBytes,1048576)}));
        }
      }catch{
        record('process_sampler_error',{reason:'spawn_failed'});
      }
    }
    const started=Date.now();
    operator=start('powershell.exe',[
      '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
      '-File',ps('Run-OneMuseNarrowOperator.ps1'),
      '-RunId',runId,'-ExpectedPid',String(pid)],
      {cwd:ROOT,stdio:['ignore','ignore','pipe'],windowsHide:true});
    assert(operator?.pid>0,'narrow-root-operator-not-started');
    record('operator_process_started',{pid:operator.pid,unix_ms:started});
    operator.stderr?.on('data',chunk=>{
      stderrBytes+=chunk.length;
      stderrHash.update(chunk);
      if(stderrBytes<=65536) captured.push(chunk);
      else stderrOverflow=true;
    });
    operator.on('error',error=>{
      record('operator_process_error',{error_class:
        /^[A-Za-z]+Error$/.test(error?.name??'')?error.name:'unknown'});
    });
    operator.once('close',(code,signal)=>{
      record('operator_process_exit',{exit_code:Number.isInteger(code)?code:-1,
        exit_signal:signal??'none',duration_ms:Date.now()-started,
        stderr_bytes:stderrBytes,stderr_overflow:stderrOverflow,
        stderr_sha256:stderrHash.digest('hex')});
      if(!stderrOverflow) {
        const report=parseOneMuseOperatorStderr(Buffer.concat(captured));
        record('operator_stderr_shape',{known_lines:report.known,
          unknown_lines:report.other,line_count:report.lines});
        for(const key of ['kernel_audit_setup_error',
          'kernel_audit_ready_fifo_written','kernel_audit_matching_begin_count',
          'kernel_audit_tracer_exit','operator_ebpf_exit','operator_ebpf_cleanup',
          'narrow_root_error','narrow_operator_ssh_exit']) {
          record('operator_stderr_value',{field:key,value:report[key]});
        }
        for(const value of report.auditFields)
          record('root_collector_audit_field',value);
      }
      resolveChildExit?.();
    });
    process.stdout.write('COORDINATED_ROOT_LAUNCH=NONINTERACTIVE_NARROW_SUDO\n');
  };
  const requestTrigger=async ({runId,appPid})=>{
    assert(RUN.test(runId)&&requirePid(appPid)&&operatorStarted&&!clicked,
      'exclusive-verified-native-host-and-trigger-required');
    clicked=true; // irrevocably consumed BEFORE invoking the UI.
    const {stdout,stderr}=await invokeButton('powershell.exe',[
      '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
      '-File',ps('Invoke-OneMuseReadyButton.ps1'),
      '-HostPid',String(appPid),'-RunId',runId],
      {cwd:ROOT,timeout:35000,maxBuffer:1024,windowsHide:true});
    assert(stdout.trim()==='ONE_MUSE_AUTHORIZED_BUTTON_INVOKED=1' &&
      !stderr?.trim(),'one-webview-click-not-confirmed');
    return true;
  };
  try {
    const result=await runCoordinator({
      operatorStep,requestTrigger,
      kernelDiagnostic:(kind,fields={})=>record(kind,fields),
      maxIdleMs:60000,maxTotalMs:1800000});
    assert(result && RUN.test(result.runId),'unrecognized-coordinated-evidence');
    process.stdout.write('COORDINATED_RUN_ID='+result.runId+'\n');
    process.stdout.write('COORDINATED_RESULT='+(
      result.status==='sealed'?'SEALED':'PARTIAL_UNSEALED')+'\n');
    return result;
  }finally{
    // Wait for the exact task-owned operator's bounded exit after the
    // coordinator performed STOP/cleanup, then seal the content-free report.
    if(operator && operator.exitCode===null && operator.signalCode===null){
      await Promise.race([childExitPromise,
        new Promise(resolve=>setTimeout(resolve,7000))]);
      if(operator.exitCode===null&&operator.signalCode===null) {
        record('operator_wrapper_timeout',{seconds:7});
        try{operator.kill();}catch{/* already closed */}
        await Promise.race([childExitPromise,
          new Promise(resolve=>setTimeout(resolve,2000))]);
      }
    }
    if(sampler && sampler.exitCode===null && sampler.signalCode===null) {
      const ended=new Promise(resolve=>sampler.once('close',resolve));
      try{sampler.kill();}catch{/* process already exited */}
      await Promise.race([ended,
        new Promise(resolve=>setTimeout(resolve,2000))]);
      if(sampler.exitCode===null&&sampler.signalCode===null) {
        try{sampler.kill('SIGKILL');}catch{/* process already exited */}
      }
    }
    if(audit)record('process_lineage_summary',{
      root_wrapper_seen:observedPids.has('root'),
      root_shell_seen:observedPids.has('root_shell'),
      collector_seen:observedPids.has('collector'),
      tracer_seen:observedPids.has('tracer')});
    sampler?.stdout?.removeAllListeners('data');
    sampler?.stderr?.removeAllListeners('data');
    sampler?.removeAllListeners('close');
    if(audit) audit.close();
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===
    path.resolve(fileURLToPath(import.meta.url))){
  if(process.argv.length!==3 || process.argv[2]!=='--one-authorized-narrow-sudo'){
    process.stderr.write('One authorized run with installed narrow sudo required.\n');
    process.exitCode=2;
  }else runOneMuseCoordinated().then(result=>{
    process.exitCode=result.status==='sealed'?0:1;
  }).catch(()=>{
    process.stderr.write('COORDINATED_RESULT=PARTIAL_UNSEALED\n');
    process.exitCode=1;
  });
}
