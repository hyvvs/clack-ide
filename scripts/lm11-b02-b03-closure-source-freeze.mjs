/** Raw-byte, write-once source snapshots for this separate closure cohort. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=fs.realpathSync.native(path.join(repo,
  'src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases'));
const [input,phase]=process.argv.slice(2);
if(process.argv.length!==4||!['--before','--after'].includes(phase))throw Error('Need closure audit directory and --before or --after');
const dir=fs.realpathSync.native(input);
if(path.dirname(dir).toLowerCase()!==root.toLowerCase()||
  !/^closure-audit-\d{17}-[a-f0-9]{12}$/.test(path.basename(dir))||
  fs.lstatSync(dir).isSymbolicLink())throw Error('Refusing noncanonical closure audit');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const files=[
  'scripts/lm11-authenticated-webview-acceptance.mjs',
  'src-tauri/examples/lm11_authenticated_webview_acceptance.rs',
  'scripts/lm11-b02-b03-closure-regressions.ps1',
  'scripts/lm11-b02-b03-closure-index.mjs',
  'scripts/lm11-b02-b03-closure-source-freeze.mjs',
  'src/modules/ai/lib/deploymentQualificationRuntime.ts',
  'src/modules/ai/lib/deploymentQualificationFlight.ts',
  'src/modules/ai/lib/proxyFetch.ts',
  'src/modules/ai/lib/lm11AcceptanceBarrier.ts',
  'src/modules/ai/lib/qualificationLabPlan.ts',
  'src/modules/ai/lib/inferenceLifecycle.ts',
  'src/modules/settings/selfHostedPersistence.ts',
  'src-tauri/src/modules/managed_local_runtime.rs',
  'src-tauri/src/modules/net/inference/mod.rs',
  'src-tauri/src/modules/self_hosted_profiles.rs',
  'src-tauri/Cargo.toml',
  'scripts/lm11-full-matrix-cancel-contract.mjs',
  'scripts/lm11-full-matrix-cancel-contract.test.mjs',
  'scripts/lm11-production-state-inventory.ps1',
  'scripts/lm11-production-state-compare.mjs',
  'scripts/lm11-production-secret-fingerprint.ps1',
  'scripts/lm11-t15-scoped-final-compare.mjs',
  'docs/AGENT_ENGINEERING_STATE.md',
  'docs/LM11_LM15_LOCAL_MODEL_QUALIFICATION.md',
];
const manifest=files.map(file=>{
  const full=path.join(repo,...file.split('/'));
  if(!fs.lstatSync(full).isFile()||fs.lstatSync(full).isSymbolicLink()||
     fs.realpathSync.native(full).toLowerCase()!==full.toLowerCase())throw Error('Source redirect '+file);
  const bytes=fs.readFileSync(full);
  return {file,bytes:bytes.length,sha256:sha(bytes)};
});
const previous=phase==='--after'
  ?JSON.parse(fs.readFileSync(path.join(dir,'source-freeze-before.json'),'utf8')):null;
const same=previous?JSON.stringify(previous.files)===JSON.stringify(manifest):null;
const value={schema:1,cohort:path.basename(dir),phase:phase.slice(2),
  observedAtUtc:new Date().toISOString(),sourceCount:manifest.length,
  sameFrozenSources:same,files:manifest};
const output=path.join(dir,phase==='--before'?'source-freeze-before.json':'source-freeze-after.json');
const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
const fd=fs.openSync(output,'wx',0o600);
try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
console.log(JSON.stringify({file:output,sha256:sha(bytes),sourceCount:manifest.length,sameFrozenSources:same}));
if(same===false)process.exitCode=3;
