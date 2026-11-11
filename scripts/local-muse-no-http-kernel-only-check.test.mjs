/** Offline-only wiring checks: no socket, Ollama HTTP, BPF or privileged run. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const here=path.dirname(fileURLToPath(import.meta.url));

test('no-http readiness-capable listener uses the real kernel bridge/importer',async()=>{
  const src=await readFile(path.join(here,'local-muse-no-http-kernel-only-check.mjs'),'utf8');
  assert.match(src,/createCrashOnlyHostSources/);
  assert.doesNotMatch(src,/createOneMuseHostSources/);
  assert.match(src,/--operator-authorized-no-http-kernel-only/);
  assert.doesNotMatch(src,/\/api\/tags|\/api\/chat|fetch\('http:\/\/127\.0\.0\.1:11435/);
  assert.match(src,/KERNEL_SECONDS = 20/);
  assert.match(src,/createOneMuseKernelBridge/);
  assert.match(src,/requireKernelSession:true,requireOneSession:false/);
  assert.match(src,/bridge\.drain\(\{runId\}\)/);
  assert.match(src,/terminal=\(await bridge\.terminal\(\{runId\}\)\)\.complete===true/);
  assert.match(src,/receipt\.loadedProgram===true/);
  assert.match(src,/s\.kernelCompletions===1/);
  assert.match(src,/s\.loss===0&&s\.pending===0/);
  assert.match(src,/line\('tcparmed','pass'\)/);
  assert.match(src,/ready&&terminal&&clean\?'true':'false'/);
  assert.doesNotMatch(src,/throw Error\('crash-observer-must-never-arm-readiness'\)/);
  assert.doesNotMatch(src,/createOneMuseReadyBroker|createOllamaModel|startForgeBoard|ai_http_stream/);
});

test('specialized host source prevents any Ollama HTTP and verifies fresh service PID and socket',async()=>{
  const host=await readFile(path.join(here,'local-muse-crash-only-host-sources.mjs'),'utf8');
  assert.match(host,/metadataFetch:async\(\)=>\{throw Error\('ollama-http-forbidden'\);\}/);
  assert.match(host,/\/usr\/bin\/systemctl show/);
  assert.match(host,/\/proc\/\$p\/comm/);
  assert.match(host,/\/usr\/bin\/ss -H -ltn/);
  assert.match(host,/await ownedForwardPid\(\) === owner/);
  assert.match(host,/ollamaHttpRequests:0/);
  const source=await readFile(path.join(here,'local-muse-no-http-kernel-only-check.mjs'),'utf8');
  assert.match(source,/host=createCrashOnlyHostSources\(\{manifestPath:manifest,sshKey:key\}\)/);
});

test('operator command has one 20 second session and no crash preemption',async()=>{
  const source=await readFile(path.join(here,'local-muse-no-http-kernel-only-check.mjs'),'utf8');
  assert.match(source,/Run-OneMuseKernelOperator\.ps1/);
  assert.match(source,/ExpectedPid \$\{pid\} -Seconds \$\{KERNEL_SECONDS\}/);
  assert.doesNotMatch(source,/-CrashCapture/);
  assert.match(source,/task_owned_cleanup/);
  assert.match(source,/kernel_gate_ready_for_coordinated_diagnostic/);
});
