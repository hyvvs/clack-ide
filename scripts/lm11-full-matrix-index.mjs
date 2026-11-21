/**
 * Write one immutable evidence index for the separately authorized complete
 * LM11 model-free real-production-path B01/B02/B03 matrix.
 *
 * The source summary must list ALL required rows. Missing physical evidence
 * is BLOCKED/PARTIAL, never converted to a passing case by this tool.
 * Earlier B03, WebView, fidelity and blocker indexes are read-only inputs.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MATRIX_REQUIREMENTS } from './lm11-full-matrix-requirements.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases=fs.realpathSync.native(path.join(root,'src-tauri','target',
  'lm11-b01-b03-authenticated-webview-20261119','cases'));
const sha=data=>createHash('sha256').update(data).digest('hex');
const fail=message=>{throw new Error('LM11 full matrix seal refused: '+message);};
const assert=(predicate,message)=>{if(!predicate)fail(message);};
const oldIndexes=[
  ['index-20261120030346856-e7fecf53ae5b/lm11-final-blocker-closure-evidence-index.json',
    '8aa9c994fbea5355cf50e4bedf420e60cf60c2f2b477d8d3e5c85f28ea5cd8ee'],
  ['index-20261120000845246-05cea9a2820e/lm11-fidelity-closure-evidence-index.json',
    'cd5e2529b39acc542bc49b324decccf931b791dc31f4ed727bd29ea82c7507d1'],
  ['index-20261119080122842-cf1e7d43238c/authenticated-webview-evidence-index.json',
    'f8f7f1effc0681530941e3f2926248d65b642ef4db81618bf8a1d948adbcd74e'],
];
function safe(relative){
  assert(typeof relative==='string' &&
    /^(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(relative) &&
    !relative.includes('..') && relative.length<=350,
    'invalid owned relative artifact path');
  const absolute=path.join(cases,...relative.split('/'));
  const stat=fs.lstatSync(absolute);
  assert(stat.isFile() && !stat.isSymbolicLink() &&
    fs.realpathSync.native(absolute).toLowerCase()===absolute.toLowerCase(),
    'redirected, missing or nonregular artifact '+relative);
  return absolute;
}
const hashFile=relative=>{
  const bytes=fs.readFileSync(safe(relative));
  return {file:relative,sha256:sha(bytes),bytes:bytes.length};
};
const readJson=relative=>JSON.parse(fs.readFileSync(safe(relative),'utf8').replace(/^\uFEFF/,''));
for(const [file,digest] of oldIndexes)
  assert(hashFile(file).sha256===digest,'old immutable index changed: '+file);
const nativeB03Index=path.join(root,'src-tauri','target',
  'lm11-b03-native-acceptance-20261119-real-host',
  'native-acceptance-85-invocations-20261119.json');
const nativeB03IndexSha256='c329ae36ad8255150ff0a46f71a03a64d0a6dec8283db392c6861668ddeef1a7';
assert(fs.lstatSync(nativeB03Index).isFile() &&
  !fs.lstatSync(nativeB03Index).isSymbolicLink() &&
  sha(fs.readFileSync(nativeB03Index))===nativeB03IndexSha256,
  'old immutable native B03 index changed');
assert(process.argv.length===3,'expected one existing full-matrix case summary path');
const summaryPath=path.resolve(process.argv[2]);
const parent=path.dirname(summaryPath);
assert(path.dirname(parent).toLowerCase()===cases.toLowerCase() &&
  /^matrix-audit-\d{17}-[a-f0-9]{12}$/.test(path.basename(parent)) &&
  path.basename(summaryPath)==='full-matrix-summary.json' &&
  fs.realpathSync.native(parent).toLowerCase()===parent.toLowerCase(),
  'summary must live in canonical unique matrix audit case');
const summaryRel=path.basename(parent)+'/full-matrix-summary.json';
const summary=readJson(summaryRel);
assert(summary.version===1 && summary.syntheticOnly===true &&
  summary.realModelInference===false && summary.qualificationLabRun===false &&
  summary.fullMatrixAttempted===true && summary.aggregateDeadlineBudgetMs===120000 &&
  summary.aggregateDeadlineMechanismReplaced===false,
  'matrix safety/authority declarations missing');
const required=[
  ['B01',10],['B02',15],['lateRaces',12],['B03',20],
  ['concurrent',5],['failures',13],
];
const statuses=new Set(['PASS','PARTIAL','BLOCKED','FAIL']);
const classifications=new Set([
  'Accepted for tested Windows synthetic-production-path boundary',
  'Partial','Blocked','Failed'
]);
let allRows=[];
for(const [group,length] of required){
  const rows=summary[group];
  assert(Array.isArray(rows)&&rows.length===length,
    group+' must itemize exactly '+length+' required cases, including misses');
  for(let i=0;i<length;i++){
    const r=rows[i];
    assert(r.ordinal===i+1 && statuses.has(r.status) &&
      typeof r.productionBoundary==='string' && r.productionBoundary.length>0 &&
      typeof r.reason==='string' && r.reason.length>0 &&
      Array.isArray(r.caseIds),'invalid '+group+' row '+(i+1));
    const expected=MATRIX_REQUIREMENTS[group][i];
    assert(r.productionBoundary===(Array.isArray(expected)?expected[0]:expected),
      'wrong production requirement label for '+group+'/'+(i+1));
    const unique=[...new Set(r.caseIds)];
    assert(unique.length===r.caseIds.length &&
      unique.every(id=>/^wry-\d{17}-[a-f0-9]{12}$/.test(id)),
      'duplicate/invalid physical case ID');
    if(r.status==='PASS'){
      assert(r.caseIds.length>0,'PASS without a physical source '+group+'/'+i);
      for(const id of unique){
        const inv=readJson(id+'/acceptance-invariants.json');
        assert(inv.allPassed===true,
          'PASS row contains a failed native or renderer case '+id);
      }
      assert(r.originalProductionRunner===true,
        'PASS cannot come solely from direct native/synthetic transport '+group+'/'+i);
    }
    allRows.push({group,...r});
  }
}
assert(Array.isArray(summary.positiveCases)&&summary.positiveCases.length>0,
  'positive original qualification path must be independently inventoried');
for(const row of summary.positiveCases){
  assert(/^wry-\d{17}-[a-f0-9]{12}$/.test(row.caseId),'positive case ID invalid');
  if(row.pass===true){
    assert(readJson(row.caseId+'/acceptance-invariants.json').allPassed===true &&
      row.originalProductionRunner===true &&
      row.nativeAcknowledgedReadback===true &&
      row.capabilities?.length===4,'positive real production path unproven');
  }
}
assert(summary.freshT15?.caseId &&
  /^fidelity-audit-\d{17}-[a-f0-9]{12}$/.test(summary.freshT15.caseId),
  'exact fresh T15 BEFORE/AFTER case not named');
const t15=readJson(summary.freshT15.caseId+'/scoped-t15-final-comparison.json');
assert(t15.auditCaseId===summary.freshT15.caseId &&
  t15.authoritativeT15Pass===summary.freshT15.pass,
  'T15 PASS cannot be asserted by a detached policy narrative');
assert(classifications.has(summary.verdicts?.B01) &&
  classifications.has(summary.verdicts?.B02) &&
  classifications.has(summary.verdicts?.B03) &&
  classifications.has(summary.verdicts?.combined),
  'four exact acceptance classifications required');
const groups={B01:'B01',B02:'B02',B03:'B03'};
for(const [name,group] of Object.entries(groups)){
  if(summary.verdicts[name]==='Accepted for tested Windows synthetic-production-path boundary')
    assert(summary[group].every(r=>r.status==='PASS') &&
      summary.positiveCases.some(r=>r.pass===true) && t15.authoritativeT15Pass,
      'Acceptance claim contradicts unpassed required '+name+' rows');
}
if(summary.verdicts.combined==='Accepted for tested Windows synthetic-production-path boundary')
  assert(['B01','B02','B03'].every(group=>
    summary.verdicts[group]==='Accepted for tested Windows synthetic-production-path boundary') &&
    summary.lateRaces.every(row=>row.status==='PASS') &&
    summary.concurrent.every(row=>row.status==='PASS') &&
    summary.failures.every(row=>row.status==='PASS') &&
    summary.preservation?.passed===true,
    'combined acceptance contradicts unpassed safety requirement');
assert(summary.preservation?.passed===true &&
  typeof summary.preservation?.evidenceFile==='string',
  'final preservation required');
const preservation=readJson(summary.preservation.evidenceFile);
assert(preservation.preserved===true &&
  preservation.protectedFileCount===81 &&
  preservation.protectedFileHashMismatches?.length===0 &&
  preservation.acceptanceProcessCount===0 &&
  preservation.stagedPaths===0,'actual preservation audit failed');
assert(Array.isArray(summary.references)&&summary.references.length>=30,
  'full physical case evidence and negative attempts must be listed');
const t15Leaves=[
  'production-before.json','production-after.json','production-comparison.json',
  'credential-manager-before.json','credential-manager-after.json',
  'credential-manager-comparison.json',
  'credential-secret-v3-before.json','credential-secret-v3-after.json',
  'credential-secret-v3-comparison.json','scoped-t15-final-comparison.json',
  'os-post-run-isolation.json',
];
const refs=[...new Set([...oldIndexes.map(([f])=>f),summaryRel,
  ...t15Leaves.map(leaf=>summary.freshT15.caseId+'/'+leaf),
  summary.preservation.evidenceFile,
  ...summary.references])];
const hashes=refs.map(hashFile);
const result={
  schema:1,evidenceKind:'LM11 B01-B03 full synthetic real-production-path acceptance matrix',
  createdAtUtc:new Date().toISOString(),
  immutableWriteOnce:true,previousBlockerIndexSha256:oldIndexes[0][1],
  previousFidelityIndexSha256:oldIndexes[1][1],
  previousWebViewIndexSha256:oldIndexes[2][1],
  previousNativeB03IndexSha256:nativeB03IndexSha256,
  allRequiredCaseRows:allRows.length,
  actualWryCases:[...new Set(allRows.flatMap(r=>r.caseIds))].length,
  ...summary,
  perArtifactSha256:hashes
};
const directory=path.join(cases,'index-'+new Date().toISOString().replace(/[^0-9]/g,'')+
  '-'+randomBytes(6).toString('hex'));
fs.mkdirSync(directory,{recursive:false});
const destination=path.join(directory,'lm11-b01-b03-full-matrix-evidence-index.json');
const bytes=Buffer.from(JSON.stringify(result,null,2)+'\n');
const fd=fs.openSync(destination,'wx',0o600);
try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
console.log(JSON.stringify({file:destination,sha256:sha(bytes),artifactHashes:hashes.length,
  requiredRows:allRows.length,verdicts:summary.verdicts},null,2));
