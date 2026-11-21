/** Byte-exact source freeze for the new, separately owned 21-group audit. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cases=fs.realpathSync.native(path.join(repo,
  'src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases'));
const [input,phase]=process.argv.slice(2);
if(process.argv.length!==4||!['--before','--after'].includes(phase))
  throw Error('Need exact new async authority audit and --before/--after');
const dir=fs.realpathSync.native(input);
if(path.dirname(dir).toLowerCase()!==cases.toLowerCase()||
  !/^async-authority-audit-\d{17}-[a-f0-9]{12}$/.test(path.basename(dir))||
  fs.lstatSync(dir).isSymbolicLink())throw Error('Noncanonical audit');
const names=[
  'scripts/lm11-authenticated-webview-acceptance.mjs',
  'scripts/lm11-async-authority-21-regressions.ps1',
  'scripts/lm11-async-authority-source-freeze.mjs',
  'scripts/lm11-async-authority-index.mjs',
  'src-tauri/examples/lm11_authenticated_webview_acceptance.rs',
  'src-tauri/Cargo.toml',
  'src-tauri/src/modules/net/inference/mod.rs',
  'src-tauri/src/modules/managed_local_runtime.rs',
  'src-tauri/src/modules/self_hosted_profiles.rs',
  'src/modules/ai/lib/agent.ts',
  'src/modules/ai/lib/deploymentQualificationRuntime.ts',
  'src/modules/ai/lib/deploymentQualificationFlight.ts',
  'src/modules/ai/lib/proxyFetch.ts',
  'src/modules/ai/lib/lm11AcceptanceBarrier.ts',
  'src/modules/ai/lib/inferenceLifecycle.ts',
  'src/modules/ai/store/chatRuntime.ts',
  'src/modules/settings/selfHostedPersistence.ts',
  'src/modules/ai/lib/qualificationLabPlan.ts',
  'scripts/lm11-full-matrix-cancel-contract.mjs',
  'scripts/lm11-full-matrix-cancel-contract.test.mjs',
  'scripts/lm11-production-state-inventory.ps1',
  'scripts/lm11-production-state-compare.mjs',
  'scripts/lm11-production-credential-metadata.ps1',
  'scripts/lm11-production-secret-fingerprint.ps1',
  'scripts/lm11-post-run-os-isolation.ps1',
  'scripts/lm11-t15-scoped-final-compare.mjs',
  'docs/AGENT_ENGINEERING_STATE.md',
  'docs/LM11_LM15_LOCAL_MODEL_QUALIFICATION.md',
];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sources=names.map(file=>{
  const full=path.join(repo,...file.split('/'));
  if(!fs.lstatSync(full).isFile()||fs.lstatSync(full).isSymbolicLink()||
    fs.realpathSync.native(full).toLowerCase()!==full.toLowerCase())
    throw Error('Redirected source '+file);
  const bytes=fs.readFileSync(full);
  return {file,bytes:bytes.length,sha256:sha(bytes)};
});
const previous=phase==='--after'
  ?JSON.parse(fs.readFileSync(path.join(dir,'source-freeze-before.json'),'utf8')):null;
const identical=previous?JSON.stringify(previous.sources)===JSON.stringify(sources):null;
const record={schema:1,kind:'LM11 B02/B03 Async + Persistence Authority source freeze',
  audit:path.basename(dir),phase:phase.slice(2),observedAtUtc:new Date().toISOString(),
  unchangedSinceBefore:identical,sources};
const file=path.join(dir,phase==='--before'?'source-freeze-before.json':'source-freeze-after.json');
const bytes=Buffer.from(JSON.stringify(record,null,2)+'\n');
const fd=fs.openSync(file,'wx',0o600);
try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
console.log(JSON.stringify({file,sha256:sha(bytes),sourceCount:sources.length,unchangedSinceBefore:identical}));
if(identical===false)process.exitCode=3;
