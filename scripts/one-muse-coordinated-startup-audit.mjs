/** Synchronous, run-owned and content-free admission diagnostic journal.
 *
 * Keeps no raw root stderr/SSH stderr, model text, network metadata or BPF
 * rows.  Only exact enum/counter/exit-code values cross the journal boundary.
 * Synchronous fsync is intentional: an aborted admission must be legible.
 */
import assert from 'node:assert/strict';
import {openSync,writeSync,fsyncSync,closeSync} from 'node:fs';
import path from 'node:path';

const ID=/^muse-one-[a-f0-9]{24}$/;
const KEY=/^[a-z][a-z0-9_]{0,55}$/;
const ENUM=/^[a-zA-Z0-9_-]{1,96}$/;
const MAX_ROWS=160;

export function createOneMuseStartupAudit({baseRoot,runId}) {
  assert(ID.test(runId)&&path.isAbsolute(baseRoot),'run-owned-startup-audit-required');
  const filename=path.join(baseRoot,runId,'coordinated-startup-audit.jsonl');
  const fd=openSync(filename,'wx',0o600);
  let written=0,closed=false;
  const record=(name,values={})=>{
    assert(!closed&&KEY.test(name)&&values&&typeof values==='object'&&
      !Array.isArray(values)&&written<MAX_ROWS,'bounded-startup-audit-record');
    const fields={};
    for(const [key,value] of Object.entries(values)) {
      assert(KEY.test(key),'unapproved-startup-audit-key');
      assert((Number.isSafeInteger(value)&&Math.abs(value)<=1e15) ||
        (typeof value==='string'&&ENUM.test(value))||
        typeof value==='boolean','unapproved-startup-audit-value');
      fields[key]=value;
    }
    const row={schemaVersion:1,runId,kind:name,atUnixMs:Date.now(),
      monoUs:Number(process.hrtime.bigint()/1000n),...fields};
    const wire=JSON.stringify(row)+'\n';
    assert(Buffer.byteLength(wire)<=2048,'startup-audit-row-overflow');
    writeSync(fd,wire);
    fsyncSync(fd);
    written++;
  };
  return {record,close:()=>{if(!closed){closed=true;fsyncSync(fd);closeSync(fd);}}};
}

export function parseOneMuseOperatorStderr(raw) {
  assert(Buffer.isBuffer(raw)&&raw.length<=65536,'bounded-root-diagnostic-required');
  const status={lines:0,known:0,other:0,overflow:false,
    auditFields:[],
    kernel_audit_setup_error:'none',
    kernel_audit_ready_fifo_written:'unobserved',
    kernel_audit_matching_begin_count:'unobserved',
    kernel_audit_tracer_exit:'unobserved',
    operator_ebpf_exit:'unobserved',
    operator_ebpf_cleanup:'unobserved',
    narrow_root_error:'none',
    narrow_operator_ssh_exit:'unobserved',
  };
  const text=raw.toString('utf8');
  const allowedAuditFields=new Set([
    'BPFT_DIAGNOSTIC_SELECTED','BPFT_BINARY_SHA256',
    'BPFT_DIAGNOSTIC','BPF_STDOUT_BYTES','BPF_STDOUT_SHA256',
    'BPF_STDERR_BYTES','BPF_STDERR_SHA256',
    'BPF_UNRECOGNIZED_STDERR_BYTES','NATIVE_ATTACHED_FOUR_COUNT',
    'MATCHING_BEGIN_COUNT','WRONG_BEGIN_COUNT','END_COUNT',
    'OTHER_STDOUT_ROWS','NEW_TARGET_PROGRAM_COUNT',
    'NEW_SEPARATE_RETURN_PROGRAM_COUNT','NEW_VALID_SESSION_LINK_COUNT',
    'SESSION_LINK_INVENTORY_ERROR','INVENTORY_RECORD_COUNT',
    'TRACER_EXIT','READY_FIFO_WRITTEN','READY_FIFO_WRITE_ATTEMPTED',
    'READY_FIFO_WRITE_ERROR','TARGET_IDENTITY_STABLE',
    'CONTROL_STOP_RECEIVED','SOURCE_INVALID','TRACER_FORCE_STOP',
    'KERNEL_INVENTORY_ERROR','OPERATOR_CHILD_EXIT',
    'INVENTORY_FILE_BYTES','INVENTORY_FILE_SHA256','SETUP_ERROR',
    'INVENTORY_EXPORT','STREAM_OVERFLOW',
    'PRIVATE_BPFTOOL_QUALIFICATION_FAILED',
  ]);
  for(const line of text.split(/\r?\n/).filter(Boolean)) {
    status.lines++;
    const row=/^(KERNEL_AUDIT_[A-Z0-9_]{1,56}|OPERATOR_EBPF_(?:EXIT|CLEANUP)|CLACK_NARROW_ROOT_ERROR|CLACK_NARROW_OPERATOR_SSH_EXIT)=([A-Za-z0-9_-]{1,96})$/.exec(line);
    if(!row) { status.other++; continue; }
    status.known++;
    const key=row[1].toLowerCase();
    if(Object.hasOwn(status,key)) status[key]=row[2];
    if(row[1].startsWith('KERNEL_AUDIT_')) {
      const label=row[1].slice('KERNEL_AUDIT_'.length);
      if(allowedAuditFields.has(label) && status.auditFields.length<64)
        status.auditFields.push({field:label.toLowerCase(),value:row[2]});
    }
  }
  return status;
}
