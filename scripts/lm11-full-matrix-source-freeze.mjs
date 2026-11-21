/**
 * Read-only source bytes, two write-once snapshots in the existing canonical
 * matrix case root. A source freeze is not a Git commit and never stages,
 * resets, cleans, modifies or infers an existing dirty-file baseline.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cases=fs.realpathSync.native(path.join(repo,'src-tauri','target',
  'lm11-b01-b03-authenticated-webview-20261119','cases'));
if(process.argv.length!==4 || !['--before','--after'].includes(process.argv[3]))
  throw Error('Need canonical matrix case root and --before or --after');
const dir=fs.realpathSync.native(process.argv[2]);
if(path.dirname(dir).toLowerCase()!==cases.toLowerCase()||
  !/^matrix-audit-\d{17}-[a-f0-9]{12}$/.test(path.basename(dir))||
  fs.lstatSync(dir).isSymbolicLink())throw Error('Noncanonical matrix case root');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourcePaths=[
  'src-tauri/examples/lm11_authenticated_webview_acceptance.rs',
  'src-tauri/src/modules/managed_local_runtime.rs',
  'src-tauri/src/modules/net/inference/mod.rs',
  'src/modules/ai/lib/deploymentQualificationRuntime.ts',
  'src/modules/ai/lib/deploymentQualificationFlight.ts',
  'src/modules/ai/lib/proxyFetch.ts',
  'src/modules/ai/lib/lm11AcceptanceBarrier.ts',
  'src/modules/settings/selfHostedPersistence.ts',
  'src/modules/ai/lib/qualificationLabPlan.ts',
  'scripts/lm11-authenticated-webview-acceptance.mjs',
  'scripts/lm11-full-matrix-requirements.mjs',
  'scripts/lm11-full-matrix-cancel-contract.mjs',
  'scripts/lm11-full-matrix-persistence-contract.mjs',
  'scripts/lm11-full-matrix-index.mjs',
  'scripts/lm11-full-matrix-case-evidence.mjs',
  'scripts/lm11-full-matrix-summary-builder.mjs',
  'scripts/lm11-full-matrix-review-generator.mjs',
  'scripts/lm11-full-matrix-preservation-audit.ps1',
  'scripts/lm11-full-matrix-ordered-regressions.ps1',
  'scripts/lm11-full-matrix-source-freeze.mjs',
  'scripts/lm11-full-matrix-summary-builder.test.mjs',
  'scripts/lm11-full-matrix-cancel-contract.test.mjs',
  'src/modules/ai/lib/deploymentQualificationRuntime.test.ts',
  'src/modules/ai/lib/deploymentQualificationFlightSafety.test.ts',
  'src/modules/ai/lib/lm11AcceptanceBarrier.test.ts',
  'src/modules/ai/lib/proxyFetch.test.ts',
  'src/modules/settings/selfHostedQualificationCas.test.ts',
];
const rows=sourcePaths.map(name=>{
  const filename=path.join(repo,...name.split('/'));
  const meta=fs.lstatSync(filename);
  if(!meta.isFile()||meta.isSymbolicLink()||
    fs.realpathSync.native(filename).toLowerCase()!==filename.toLowerCase())
    throw Error('Source redirected: '+name);
  const bytes=fs.readFileSync(filename);
  return {file:name,sha256:hash(bytes),bytes:bytes.length};
});
let matched=null;
if(process.argv[3]==='--after') {
  const prior=path.join(dir,'source-freeze-before.json');
  const old=JSON.parse(fs.readFileSync(prior,'utf8'));
  matched=JSON.stringify(old.files)===JSON.stringify(rows);
  if(!matched)throw Error('Acceptance source changed after frozen regression baseline');
}
const data={
  schema:1,source:'read-only-raw-source-byte-hasher',
  phase:process.argv[3].slice(2),observedAtUtc:new Date().toISOString(),
  auditedCase: path.basename(dir),sourceCount:rows.length,
  sameFrozenSources:matched,files:rows,
  noStageCommitResetStashOrClean:true,
};
const leaf=process.argv[3]==='--before'?'source-freeze-before.json':'source-freeze-after.json';
const output=path.join(dir,leaf),bytes=Buffer.from(JSON.stringify(data,null,2)+'\n');
const fd=fs.openSync(output,'wx',0o600);
try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
console.log(JSON.stringify({file:output,sha256:hash(bytes),sourceFiles:rows.length,
  sameFrozenSources:matched},null,2));
