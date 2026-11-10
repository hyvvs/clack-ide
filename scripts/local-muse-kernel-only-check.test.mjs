/** Offline kernel-only operator boundary checks. NO SSH, root, BPF or model. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const here=path.dirname(fileURLToPath(import.meta.url));

test('short validation requires explicit operator action and uses real kernel importer',async()=>{
  const source=await readFile(path.join(here,'local-muse-kernel-only-check.mjs'),'utf8');
  assert.match(source,/KERNEL_SECONDS = 20/);
  assert.match(source,/--operator-authorized-no-traffic/);
  assert.match(source,/createOneMuseKernelBridge/);
  assert.match(source,/createOneMuseHostSources/);
  assert.match(source,/requireKernelSession:true,requireOneSession:false/);
  assert.match(source,/bridge\.drain\(\{runId\}\)/);
  assert.match(source,/terminal=\(await bridge\.terminal\(\{runId\}\)\)\.complete===true/);
  assert.match(source,/s\.kernelCompletions===1/);
  assert.doesNotMatch(source,/createOneMuseReadyBroker|OneMuseDiagnosticSession|createOllamaModel|ai_http_stream/);
  assert.doesNotMatch(source,/\/api\/chat|startForgeBoard|automaticInference/);
});

test('real root path is reused with 20s ceiling and captures only numeric audit',async()=>{
  const ps=await readFile(path.join(here,'Run-OneMuseKernelOperator.ps1'),'utf8');
  const root=await readFile(path.join(here,'local-muse-one-root.sh'),'utf8');
  const python=await readFile(path.join(here,'local-muse-one-ebpf.py'),'utf8');
  assert.match(ps,/\[ValidateRange\(1,1800\)\]\[int\]\$Seconds=1800/);
  assert.match(ps,/if \(\$Seconds -gt 20\)/);
  assert.match(ps,/kernel-operator-audit\.numeric/);
  assert.match(ps,/USER_STAGE_CLEANUP=/);
  assert.match(root,/seconds=\$\{3:-1800\}/);
  assert.match(root,/seconds_plus_six=\$\(\(seconds \+ 6\)\)/);
  assert.match(root,/--seconds "\$6"/);
  assert.match(root,/--ready-fd 3 --control-fd 0/);
  assert.match(root,/operator-audit\.numeric/);
  assert.match(root,/KERNEL_AUDIT_OPERATOR_CHILD_EXIT/);
  assert.match(python,/emit_content_free_audit/);
  assert.match(python,/stop_complete and identity_ok/);
  assert.match(python,/nonblocking_write\(ready_fd, numeric_arm_line/);
});
