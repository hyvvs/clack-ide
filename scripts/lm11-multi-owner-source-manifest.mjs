/** LM11 keyed-managed-owner final acceptance: contemporaneous write-once
 * source/Git/protection manifest. This tool never launches a native runtime. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = path.join(repo,
  'src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases');
const [mode, supplied] = process.argv.slice(2);
if (!['create', 'pre', 'verify'].includes(mode) || !supplied)
  throw Error('Usage: node scripts/lm11-multi-owner-source-manifest.mjs create|pre|verify <canonical-audit-dir>');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonicalCases = fs.realpathSync.native(cases);
const absolute = path.resolve(supplied);
if (path.dirname(absolute).toLowerCase() !== canonicalCases.toLowerCase() ||
    !/^multi-owner-audit-\d{17}-[a-f0-9]{12}$/.test(path.basename(absolute)))
  throw Error('Only direct named canonical multi-owner evidence cases permitted');
if (mode === 'create') fs.mkdirSync(absolute);
const audit = fs.realpathSync.native(absolute);
if (audit.toLowerCase() !== absolute.toLowerCase() ||
    fs.lstatSync(audit).isSymbolicLink()) throw Error('Redirected multi-owner evidence directory');
const rel = absolute => path.relative(repo,absolute).replaceAll('\\','/');
function fileProof(relative) {
  const full = path.resolve(repo,relative);
  if (!full.startsWith(repo + path.sep) || !fs.existsSync(full) ||
      !fs.lstatSync(full).isFile() || fs.lstatSync(full).isSymbolicLink())
    throw Error('Missing/redirected evidence or source: '+relative);
  const bytes = fs.readFileSync(full);
  return { path: rel(full), sha256:sha256(bytes), bytes:bytes.length };
}
const files = new Set();
function scan(root,pattern) {
  for (const e of fs.readdirSync(path.join(repo,root),{withFileTypes:true})) {
    if (e.isSymbolicLink()) throw Error('Symlink in participating source tree '+root+'/'+e.name);
    const name = root+'/'+e.name;
    if (e.isDirectory()) scan(name,pattern);
    else if (e.isFile() && pattern.test(e.name)) files.add(name);
  }
}
scan('src-tauri/src',/\.rs$/);
scan('src-tauri/examples',/^lm11.*\.rs$/);
// Include the WHOLE renderer/settings TypeScript input graph, not just the
// directly edited AI folder: the final wider TypeScript suite, model Settings
// control and original native bridge all share these production imports.
scan('src',/\.(?:ts|tsx)$/);
scan('src/modules/ai',/\.(?:ts|tsx)$/);
scan('src/modules/settings',/\.(?:ts|tsx)$/);
scan('src/test',/\.(?:ts|tsx)$/);
for (const name of fs.readdirSync(path.join(repo,'scripts'))) {
  if (/^lm11-(?:.*)\.(?:mjs|ps1)$/.test(name)) files.add('scripts/'+name);
}
for (const name of ['src-tauri/Cargo.toml','src-tauri/Cargo.lock','src-tauri/build.rs',
  'package.json','tsconfig.json','vite.config.ts']) {
  if (fs.existsSync(path.join(repo,name))) files.add(name);
}
const participating = [...files].sort().map(fileProof);
const git = args => execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();
const protectedList='src-tauri/target/lm2f-validation-20261117/reconstructed-protected-81.tsv';
const protectedRows=fs.readFileSync(path.join(repo,protectedList),'utf8').trim().split(/\r?\n/)
  .map(line=>line.split('\t'));
if(protectedRows.length!==81||protectedRows.some(([name,expected])=>
  !name||!/^([a-f0-9]{64})$/.test(expected)||fileProof(name).sha256!==expected))
  throw Error('81 protected hashes changed');
// The previous write-once final preservation audit has all ten previous
// lineages PLUS the most recent immutable defect-and-race index. Add its own
// final two-gap index as the 12th current protected historical index.
const oldAudit='src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases/' +
  'two-gap-audit-20261121022206415-c4021ff68228/final-preservation-audit.json';
const prior=JSON.parse(fs.readFileSync(path.join(repo,oldAudit),'utf8'));
const indexes=[...prior.oldImmutableIndexes.map(x=>({path:x.path,expected:x.expectedSha256})),{
  path:'src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases/'+
  'two-gap-audit-20261121022206415-c4021ff68228/'+
  'lm11-final-two-gap-acceptance-closure-evidence-index.json',
  expected:'e904f942c25897e8da690d078f912b7496e3e8d45d314a8322aa8e54f4a9e121',
}];
if(indexes.length!==12||indexes.some(row=>fileProof(row.path).sha256!==row.expected))
  throw Error('Prior immutable evidence index SHA mismatch');
const before={
  schema:1,title:'LM11 Multi-Deployment Runtime Ownership + Final B03 Acceptance',
  phase:'contemporaneous-pre-physical-acceptance',createdAtUtc:new Date().toISOString(),
  sourceCount:participating.length,sourceFiles:participating,
  git:{branch:git(['branch','--show-current']),head:git(['rev-parse','HEAD']),
    rawIndexSha256:fileProof('.git/index').sha256,
    stagedPaths:git(['diff','--cached','--name-only']).split(/\r?\n/).filter(Boolean),
    stashOids:git(['stash','list','--format=%H']).split(/\r?\n/).filter(Boolean)},
  protectedFiles:{count:81,mismatches:[],manifest:fileProof(protectedList)},
  priorImmutableIndexes:indexes.map(row=>fileProof(row.path)),
  targetDebugAbsent:!fs.existsSync(path.join(repo,'src-tauri/target/debug')),
  targetCodexTestAbsent:!fs.existsSync(path.join(repo,'src-tauri/target/codex-test')),
  qualificationLabRunEnabled:false,actualModelInferenceLaunched:false,
};
if(before.git.branch!=='main'||
  before.git.head!=='50fca4689692bc1e85f9ffd4ae644ff528cc056e'||
  before.git.rawIndexSha256!=='5cd3574caaa8fc3ec4d01e79cbd8f6edb90573600df927e068a3d1b1c144f211'||
  before.git.stagedPaths.length||before.git.stashOids.join(',')!==
  '6a7bc6beef913a323052b277f766ae32be11bae1,b96fc46d783f1635acec2278deed7b43479f5f9a'||
  !before.targetDebugAbsent||!before.targetCodexTestAbsent)
  throw Error('Protected Git/stash or forbidden build baseline changed');
function writeOnce(full,obj) {
  const bytes=Buffer.from(JSON.stringify(obj,null,2)+'\n');
  const fd=fs.openSync(full,'wx',0o600);
  try {fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  return {file:full,sha256:sha256(bytes),bytes:bytes.length};
}
const pre=path.join(audit,'source-pre-authoritative.json');
if(mode==='create'||mode==='pre') {
  console.log(JSON.stringify({phase:'PRE',...writeOnce(pre,before),sourceCount:participating.length,
    protected:81,priorIndexes:12,gitHead:before.git.head}));
} else {
  const frozen=JSON.parse(fs.readFileSync(pre,'utf8'));
  const old=new Map(frozen.sourceFiles.map(f=>[f.path,f]));
  const changed=participating.filter(f=>old.get(f.path)?.sha256!==f.sha256||
     old.get(f.path)?.bytes!==f.bytes).map(f=>f.path);
  const removed=frozen.sourceFiles.filter(f=>!files.has(f.path)).map(f=>f.path);
  const newFiles=participating.filter(f=>!old.has(f.path)).map(f=>f.path);
  const match=changed.length===0&&removed.length===0&&newFiles.length===0&&
    frozen.sourceCount===participating.length;
  const gitUnchanged=JSON.stringify(frozen.git)===JSON.stringify(before.git);
  const post={schema:1,title:before.title,phase:'after-all-acceptance-and-regression',
    observedAtUtc:new Date().toISOString(),preManifest:fileProof(rel(pre)),
    sourceCount:participating.length,sourceHashesIdentical:match,changed,removed,newFiles,
    gitUnchanged,protected81Unchanged:true,priorImmutableIndexesUnchanged:true,
    targetDebugAbsent:before.targetDebugAbsent,
    targetCodexTestAbsent:before.targetCodexTestAbsent};
  console.log(JSON.stringify({phase:'POST',...writeOnce(path.join(audit,
    'source-post-authoritative.json'),post),sourceCount:participating.length,
    hashesIdentical:match,gitUnchanged,changed,removed,newFiles}));
  if(!match||!gitUnchanged)process.exitCode=2;
}
