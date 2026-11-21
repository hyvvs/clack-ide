#!/usr/bin/env node
/**
 * One bounded, no-HTTP, no-inference kernel-only qualification.
 *
 * This single local command starts the EXISTING authenticated kernel bridge,
 * then invokes its EXISTING exact-root-stage operator wrapper when the two
 * SSH FIFO readers and importer are live. The sole manual interaction is the
 * real interactive remote sudo password prompt; the password is never passed
 * through Node, command arguments, env, shell history, files, or a log.
 *
 * Does not retry. Does not run Ollama HTTP, Muse, ForgeBoard or the evaluator.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const RUN_RE = /^muse-one-[a-f0-9]{24}$/;
const CMD_RE = /^KERNEL_ONLY_OPERATOR_COMMAND=powershell\.exe -NoProfile -ExecutionPolicy Bypass -File \.\\scripts\\Run-OneMuseKernelOperator\.ps1 -RunId (muse-one-[a-f0-9]{24}) -ExpectedPid ([1-9][0-9]{1,9}) -Seconds 20$/;
const ALLOWED = /^(?:KERNEL_ONLY_RUN_ID|OPERATOR_KERNEL_PID|TCPARMED|KERNEL_TERMINAL|KERNEL_ONLY_RESULT|FAILED_STAGE|KERNEL_ONLY_EVIDENCE|TASK_OWNED_CLEANUP|KERNEL_GATE_READY_FOR_COORDINATED_DIAGNOSTIC|IDENTITY|TUNNEL|MAPPING|CLOCKS|KERNEL_ONLY_RUN_ID)=[A-Za-z0-9_-]{1,96}$/;
const WINDOW_MS = 180_000;

export function parseOperatorCommand(line, runId, pid) {
  const match = CMD_RE.exec(line);
  assert(match && RUN_RE.test(match[1]) &&
         match[1] === runId && match[2] === pid,
         'exact-live-operator-command-required');
  return Object.freeze([
    '-NoProfile','-ExecutionPolicy','Bypass',
    '-File',path.join(ROOT,'scripts','Run-OneMuseKernelOperator.ps1'),
    '-RunId',runId,'-ExpectedPid',pid,'-Seconds','20',
  ]);
}

export async function runOneKernelQualification({start=spawn}={}) {
  const source=start(process.execPath,
    [path.join(ROOT,'scripts','local-muse-no-http-kernel-only-check.mjs'),
     '--operator-authorized-no-http-kernel-only'],
    {cwd:ROOT,stdio:['ignore','pipe','pipe'],windowsHide:true});
  assert(source?.pid>0 && source.stdout && source.stderr,
    'kernel-only-check-not-started');
  let runId=null, pid=null, invoked=0, status='unverified';
  let buffer='', stderrBytes=0, failed=false, operator=null;
  let expired=false;
  const expires=setTimeout(()=>{
    expired=true;
    // The remote collector has its own strict timeout and cleanup trap.
    // Kill only this launcher's own children. Never leave an unattended
    // privileged SSH password prompt alive after the bounded bridge expires.
    if(source.exitCode===null) source.kill();
    if(operator && operator.exitCode===null) operator.kill();
  }, WINDOW_MS);
  const runnerComplete=new Promise(resolve=>{
    source.stdout.on('data',chunk=>{
      if(failed) return;
      buffer+=chunk.toString('utf8');
      if(Buffer.byteLength(buffer)>8192){failed=true; source.kill();return;}
      let index;
      while((index=buffer.indexOf('\n'))!==-1){
        const line=buffer.slice(0,index).replace(/\r$/, '');
        buffer=buffer.slice(index+1);
        if(line.startsWith('KERNEL_ONLY_RUN_ID=')){
          const incoming=line.slice('KERNEL_ONLY_RUN_ID='.length);
          if(runId || !RUN_RE.test(incoming)){failed=true;source.kill();break;}
          runId=incoming;
          process.stdout.write('KERNEL_ONLY_RUN_ID='+runId+'\n');
        }else if(line.startsWith('OPERATOR_KERNEL_PID=')){
          const incoming=line.slice('OPERATOR_KERNEL_PID='.length);
          if(pid || !/^[1-9][0-9]{1,9}$/.test(incoming)){
            failed=true;source.kill();break;
          }
          pid=incoming;
          process.stdout.write('OPERATOR_KERNEL_PID='+pid+'\n');
        }else if(line.startsWith('KERNEL_ONLY_OPERATOR_COMMAND=')){
          if(invoked!==0 || !runId || !pid){failed=true;source.kill();break;}
          let args;
          try{args=parseOperatorCommand(line,runId,pid);}
          catch{failed=true;source.kill();break;}
          invoked++;
          // This is the ONLY privileged step. It inherits the real terminal
          // for one interactive sudo challenge. No password is handled here.
          try {
            operator=start('powershell.exe',args,
              {cwd:ROOT,stdio:'inherit',windowsHide:false});
            assert(operator?.pid>0,'single-operator-not-started');
          } catch {
            failed=true;source.kill();break;
          }
          operator.once('error',()=>{failed=true;source.kill();});
          operator.once('close',code=>{
            if(code!==0) failed=true;
            operator=null;
          });
        }else if(ALLOWED.test(line)){
          process.stdout.write(line+'\n');
          if(line==='KERNEL_GATE_READY_FOR_COORDINATED_DIAGNOSTIC=true')
            status='pass';
        }else if(line.trim()){
          failed=true;source.kill();break;
        }
      }
    });
    source.stderr.on('data',bytes=>{
      stderrBytes+=bytes.length;
      if(stderrBytes>4096){failed=true;source.kill();}
    });
    source.once('error',()=>{failed=true;resolve(-1);});
    source.once('close',code=>resolve(code));
  });
  try{
    const exit=await runnerComplete;
    if(operator){
      // The source may have stopped before the child completed (e.g. expired
      // reader). The bounded remote collector is independent; wait for the
      // one already-started local operator without spawning another.
      await new Promise(resolve=>operator.once('close',resolve));
    }
    const passed=!expired && !failed && exit===0 && invoked===1 &&
      status==='pass' && stderrBytes===0 && buffer==='';
    process.stdout.write('KERNEL_QUALIFICATION='+
      (passed?'PASS':'NOT_QUALIFIED')+'\n');
    return passed;
  }finally{
    clearTimeout(expires);
  }
}

if(process.argv[1] && path.resolve(process.argv[1])===
    path.resolve(fileURLToPath(import.meta.url))){
  if(process.argv.length!==3 || process.argv[2]!=='--one-interactive-root-qualification'){
    process.stderr.write('Single authorized interactive root qualification required. No model request.\n');
    process.exitCode=2;
  }else runOneKernelQualification().then(ok=>{process.exitCode=ok?0:1;})
    .catch(()=>{process.stderr.write('KERNEL_QUALIFICATION=NOT_QUALIFIED\n');process.exitCode=1;});
}
