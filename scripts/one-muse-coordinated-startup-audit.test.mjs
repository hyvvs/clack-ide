import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,stat,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createOneMuseStartupAudit,parseOneMuseOperatorStderr}
  from './one-muse-coordinated-startup-audit.mjs';
import {coordinatedProcessSamplerCommand,parseCoordinatedProcessSamplerLine}
  from './one-muse-coordinated-process-sampler.mjs';
const RUN='muse-one-1234567890abcdef12345678';

test('fsynced content-free journal rejects arbitrary data, paths and forged extras',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'clack-root-audit-offline-'));
  try{
    await mkdir(path.join(root,RUN));
    const journal=createOneMuseStartupAudit({baseRoot:root,runId:RUN});
    journal.record('operator_started',{pid:1658,status:'started'});
    assert.throws(()=>journal.record('bad/path',{payload:'value'}));
    assert.throws(()=>journal.record('event',{raw:'fatal /home/hylab socket 127.0.0.1'}));
    assert.throws(()=>journal.record('event',{text:'generated answer with spaces'}));
    journal.record('collector_waiting_ready',{reader_exit:-1,ready_seen:false});
    journal.close();
    assert.throws(()=>journal.record('after_close'));
    const filename=path.join(root,RUN,'coordinated-startup-audit.jsonl');
    const content=await readFile(filename,'utf8');
    const entries=content.trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(entries.length,2);
    assert.equal(entries[0].pid,1658);
    assert.equal(entries[1].ready_seen,false);
    assert.ok(entries.every(entry=>entry.runId===RUN&&entry.atUnixMs>0));
    assert.equal(content.includes('127.0.0.1'),false);
    assert.equal((await stat(filename)).isFile(),true);
    assert.throws(()=>createOneMuseStartupAudit({baseRoot:root,runId:RUN}));
  }finally{await rm(root,{recursive:true,force:true});}
});

test('root stderr is classified by exact allowlist, never exported raw',()=>{
  const buffer=Buffer.from([
    'KERNEL_AUDIT_SETUP_ERROR=ValueError',
    'KERNEL_AUDIT_READY_FIFO_WRITTEN=0',
    'KERNEL_AUDIT_MATCHING_BEGIN_COUNT=0',
    'KERNEL_AUDIT_TRACER_EXIT=unknown',
    'OPERATOR_EBPF_EXIT=1',
    'OPERATOR_EBPF_CLEANUP=PASS',
    'CLACK_NARROW_OPERATOR_SSH_EXIT=1',
    'secret arbitrary error with IP 127.0.0.1',
    '',
  ].join('\n'));
  const got=parseOneMuseOperatorStderr(buffer);
  assert.equal(got.kernel_audit_setup_error,'ValueError');
  assert.equal(got.kernel_audit_ready_fifo_written,'0');
  assert.equal(got.operator_ebpf_exit,'1');
  assert.equal(got.other,1);
  assert.ok(got.auditFields.some(f=>f.field==='matching_begin_count'&&f.value==='0'));
  assert.equal(got.auditFields.some(f=>f.field.includes('secret')),false);
  const failedPrivate=parseOneMuseOperatorStderr(
    Buffer.from('KERNEL_AUDIT_PRIVATE_BPFTOOL_QUALIFICATION_FAILED=1\n'));
  assert.deepEqual(failedPrivate.auditFields,[{
    field:'private_bpftool_qualification_failed',value:'1',
  }]);
  assert.ok(!JSON.stringify(got).includes('127.0.0.1'));
  assert.throws(()=>parseOneMuseOperatorStderr(Buffer.alloc(65537)));
  assert.equal(parseOneMuseOperatorStderr(Buffer.from('junk\n')).narrow_root_error,'none');
});

test('sampler is fixed unprivileged argv and emits only bounded PID/PPID roles',()=>{
  const command=coordinatedProcessSamplerCommand(RUN);
  assert.match(command,/\/usr\/bin\/timeout .* 14s \/usr\/bin\/bash -s/);
  const match=/printf %s ([A-Za-z0-9+/=]+) \| \/usr\/bin\/base64 -d/.exec(command);
  assert.ok(match);
  const script=Buffer.from(match[1],'base64').toString('utf8');
  assert.match(script,/ps -eo pid=,ppid=,comm=,args=/);
  assert.match(script,/awk -v run='muse-one-1234567890abcdef12345678'/);
  assert.doesNotMatch(script,/sudo|bpftool|tracefs|curl|api\/chat/);
  assert.deepEqual(parseCoordinatedProcessSamplerLine('root 1658 120'),
    {role:'root',pid:1658,parent:120});
  assert.deepEqual(parseCoordinatedProcessSamplerLine('tracer 34567 1658'),
    {role:'tracer',pid:34567,parent:1658});
  for(const bad of ['root 0 12','root 1658 -1',
    'root 1658 12 injected','root 2147483648 12',
    'ssh 1658 120','tracer 123 12 /private/path']){
    assert.equal(parseCoordinatedProcessSamplerLine(bad),null);
  }
  assert.throws(()=>coordinatedProcessSamplerCommand(RUN+';rm'));
});
