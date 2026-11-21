/** Bounded LM11 two-gap immutable, read-only source and Git provenance. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cases=path.join(repo,'src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases');
const [mode,requested,tag='final']=process.argv.slice(2);
if(!['create','pre','verify'].includes(mode)||!requested||!/^[a-z0-9-]{1,32}$/.test(tag))
  throw Error('Usage: node scripts/lm11-two-gap-source-manifest.mjs create|pre|verify <canonical-case> [tag]');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonicalRoot=fs.realpathSync.native(cases);
function canonical(candidate,create=false){
  const absolute=path.resolve(candidate);
  if(path.dirname(absolute).toLowerCase()!==canonicalRoot.toLowerCase()||
      !/^two-gap-audit-\d{17}-[a-f0-9]{12}$/.test(path.basename(absolute)))
    throw Error('Only new direct canonical LM11 cases allowed');
  if(create)fs.mkdirSync(absolute);
  const real=fs.realpathSync.native(absolute);
  if(real.toLowerCase()!==absolute.toLowerCase()||fs.lstatSync(real).isSymbolicLink())
    throw Error('Redirected case owner');
  return real;
}
const audit=canonical(requested,mode==='create');
function fileProof(rel){
  const full=path.resolve(repo,rel);
  if(!full.startsWith(repo+path.sep)||!fs.existsSync(full)||
     !fs.statSync(full).isFile()||fs.lstatSync(full).isSymbolicLink())
    throw Error('Missing/nonregular source '+rel);
  const bytes=fs.readFileSync(full);
  return {path:rel.replaceAll('\\','/'),sha256:sha(bytes),bytes:bytes.length};
}
const files=new Set();
function scan(root,pattern){
  const rootFull=path.join(repo,root);
  for(const dirent of fs.readdirSync(rootFull,{withFileTypes:true})){
    if(dirent.isSymbolicLink())throw Error('Untrusted symlink in source subtree: '+root+'/'+dirent.name);
    const rel=(root+'/'+dirent.name).replaceAll('\\','/');
    if(dirent.isDirectory())scan(rel,pattern);
    else if(dirent.isFile()&&pattern.test(dirent.name))files.add(rel);
  }
}
// Superset of *all* Rust and AI/settings TypeScript owners used by the final
// synthetic Wry path and the prescribed focused/wider regression suites.
scan('src-tauri/src',/\.rs$/);
scan('src/modules/ai',/\.(?:ts|tsx)$/);
scan('src/modules/settings',/\.(?:ts|tsx)$/);
scan('src/test',/\.(?:ts|tsx)$/);
files.add('src-tauri/examples/lm11_authenticated_webview_acceptance.rs');
for(const leaf of fs.readdirSync(path.join(repo,'scripts'))){
  if(/^lm11-.*\.(?:mjs|ps1)$/.test(leaf)||
      /^lm11-production-.*\.(?:mjs|ps1)$/.test(leaf))files.add('scripts/'+leaf);
}
for(const rel of ['src-tauri/Cargo.toml','src-tauri/Cargo.lock',
    'package.json','tsconfig.json','vite.config.ts']){
  if(fs.existsSync(path.join(repo,rel)))files.add(rel);
}
const sourceFiles=[...files].sort().map(fileProof);
const git=arg=>execFileSync('git',arg,{cwd:repo,encoding:'utf8'}).trim();
const index=fileProof('.git/index');
const manifestPath='src-tauri/target/lm2f-validation-20261117/reconstructed-protected-81.tsv';
const protectedRows=fs.readFileSync(path.join(repo,manifestPath),'utf8').trim().split(/\r?\n/)
  .map(line=>line.split('\t'));
if(protectedRows.length!==81||protectedRows.some(([p,h])=>
     !p||!/^[a-f0-9]{64}$/.test(h)||fileProof(p).sha256!==h))
  throw Error('Protected 81/81 hash baseline mismatch');
const latestIndex='src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases/final-defect-audit-20261121013631159-aeead0f6e6db/lm11-final-b02-b03-defect-and-race-closure-evidence-index.json';
const immutable=fileProof(latestIndex);
if(immutable.sha256!=='d271b046b9c3f17f03da42a7bdd7d0473f56920cb3b17ff4ece557122a76ca0e')
  throw Error('Most recent old immutable index changed');
const before={
  schema:1,title:'LM11 Final Two-Gap Acceptance Closure',
  phase:'contemporaneous-before-physical-case',observedAtUtc:new Date().toISOString(),
  git:{branch:git(['branch','--show-current']),head:git(['rev-parse','HEAD']),
    rawIndexSha256:index.sha256,stagedPaths:git(['diff','--cached','--name-only']).split(/\r?\n/).filter(Boolean),
    stashOids:git(['stash','list','--format=%H']).split(/\r?\n/).filter(Boolean)},
  protected81:true,protectedManifest:fileProof(manifestPath),
  priorImmutableIndex:immutable,sourceCount:sourceFiles.length,
  sourceFiles,qualificationLabRunEnabled:false,
  aggregateDeadlineMs:120000,modelsStarted:0,
};
if(before.git.branch!=='main'||before.git.head!=='50fca4689692bc1e85f9ffd4ae644ff528cc056e'||
    before.git.rawIndexSha256!=='5cd3574caaa8fc3ec4d01e79cbd8f6edb90573600df927e068a3d1b1c144f211'||
    before.git.stagedPaths.length||before.git.stashOids.join(',')!==
    '6a7bc6beef913a323052b277f766ae32be11bae1,b96fc46d783f1635acec2278deed7b43479f5f9a')
  throw Error('Protected live Git baseline mismatch');
const pre=path.join(audit,`source-pre-${tag}.json`);
function writeOnce(p,value){fs.writeFileSync(p,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
if(mode==='create'||mode==='pre'){
  writeOnce(pre,before);
  console.log(JSON.stringify({phase:'PRE',file:pre,sha256:fileProof(path.relative(repo,pre)).sha256,
    sources:sourceFiles.length,head:before.git.head,protected81:true}));
}else{
  const original=JSON.parse(fs.readFileSync(pre,'utf8'));
  const old=new Map(original.sourceFiles.map(v=>[v.path,v]));
  const mismatches=sourceFiles.filter(v=>old.get(v.path)?.sha256!==v.sha256||old.get(v.path)?.bytes!==v.bytes);
  const added=sourceFiles.filter(v=>!old.has(v.path));
  const removed=original.sourceFiles.filter(v=>!files.has(v.path));
  const result={schema:1,phase:'post-run-verified-against-contemporaneous-pre',
    observedAtUtc:new Date().toISOString(),preManifest:fileProof(path.relative(repo,pre)),
    sourceCount:sourceFiles.length,identical:mismatches.length===0&&added.length===0&&removed.length===0,
    mismatches:mismatches.map(v=>v.path),added:added.map(v=>v.path),removed:removed.map(v=>v.path),
    gitUnchanged:JSON.stringify(before.git)===JSON.stringify(original.git),protected81:true,
    priorImmutableIndex:immutable};
  const resultFile=path.join(audit,`source-post-${tag}.json`);
  writeOnce(resultFile,result);
  console.log(JSON.stringify({phase:'POST',file:resultFile,sha256:fileProof(path.relative(repo,resultFile)).sha256,
    identical:result.identical,sources:sourceFiles.length,mismatches:result.mismatches}));
  if(!result.identical||!result.gitUnchanged)process.exitCode=1;
}
