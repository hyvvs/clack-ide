import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {setImmediate as immediate} from 'node:timers/promises';
import {parseOperatorCommand,runOneKernelQualification}
  from './Run-OneMuseKernelQualificationOnce.mjs';

const ID='muse-one-1234567890abcdef12345678';
const PID='1658';
const command='KERNEL_ONLY_OPERATOR_COMMAND=powershell.exe -NoProfile '+
  '-ExecutionPolicy Bypass -File .\\scripts\\Run-OneMuseKernelOperator.ps1 '+
  '-RunId '+ID+' -ExpectedPid '+PID+' -Seconds 20';
const opening='KERNEL_ONLY_RUN_ID='+ID+'\nIDENTITY=pass\nTUNNEL=pass\n'+
  'MAPPING=pass\nCLOCKS=pass\nOPERATOR_KERNEL_PID='+PID+'\n';
const closed='TCPARMED=pass\nKERNEL_TERMINAL=pass\n'+
  'TASK_OWNED_CLEANUP=pass\n'+
  'KERNEL_GATE_READY_FOR_COORDINATED_DIAGNOSTIC=true\n';

test('parses only the reviewed exact one-time command',()=>{
  assert.deepEqual(parseOperatorCommand(command,ID,PID).slice(-6),
    ['-RunId',ID,'-ExpectedPid',PID,'-Seconds','20']);
  for(const invalid of [
    command.replace(PID,'1659'),
    command.replace(ID,'muse-one-111111111111111111111111'),
    command.replace('-Seconds 20','-Seconds 1800'),
    command.replace('Run-OneMuseKernelOperator.ps1','other.ps1'),
    command.replace('powershell.exe','cmd.exe'),
  ]){
    assert.throws(()=>parseOperatorCommand(invalid,ID,PID));
  }
});

function harness(){
  const children=[];
  const start=(name,args,opts)=>{
    const proc=new EventEmitter();
    proc.pid=200+children.length;
    proc.exitCode=null;
    proc.killed=false;
    proc.stdout=new PassThrough();
    proc.stderr=new PassThrough();
    proc.kill=()=>{proc.killed=true; proc.exitCode=1;proc.emit('close',1);};
    children.push({name,args,opts,proc});
    return proc;
  };
  return {children,start};
}

test('one existing kernel bridge, one interactive operator, no inference', async()=>{
  const {children,start}=harness();
  const promise=runOneKernelQualification({start});
  const source=children[0];
  assert.match(source.args[0],/local-muse-no-http-kernel-only-check\.mjs$/);
  assert.equal(source.args[1],'--operator-authorized-no-http-kernel-only');
  source.proc.stdout.write(opening+command+'\n');
  await immediate();
  assert.equal(children.length,2);
  const operator=children[1];
  assert.equal(operator.name,'powershell.exe');
  assert.equal(operator.opts.stdio,'inherit');
  assert.equal(operator.args.at(-1),'20');
  operator.proc.exitCode=0;
  operator.proc.emit('close',0);
  source.proc.stdout.write(closed);
  source.proc.exitCode=0;
  source.proc.emit('close',0);
  assert.equal(await promise,true);
  assert.equal(children.length,2);
});

test('spoofed or repeated privileged operator requests fail closed',async()=>{
  for(const lines of [
    opening+command+'\n'+command+'\n',
    opening+command.replace('-Seconds 20','-Seconds 1800')+'\n',
    'KERNEL_ONLY_RUN_ID='+ID+'\n'+command+'\n',
  ]){
    const {children,start}=harness();
    const promise=runOneKernelQualification({start});
    children[0].proc.stdout.write(lines);
    await immediate();
    if(children.length===2) {
      children[1].proc.exitCode=0;
      children[1].proc.emit('close',0);
    }
    if(children[0].proc.exitCode===null){
      children[0].proc.exitCode=1;
      children[0].proc.emit('close',1);
    }
    assert.equal(await promise,false);
    assert.ok(children.length<=2);
  }
});

test('no READY claim if kernel child exits or reports an error',async()=>{
  const {children,start}=harness();
  const promise=runOneKernelQualification({start});
  children[0].proc.stdout.write(opening+command+'\n');
  await immediate();
  children[1].proc.exitCode=1;
  children[1].proc.emit('close',1);
  children[0].proc.stdout.write(closed);
  children[0].proc.exitCode=0;
  children[0].proc.emit('close',0);
  assert.equal(await promise,false);
});
