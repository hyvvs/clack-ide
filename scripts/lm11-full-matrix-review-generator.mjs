/**
 * Form an independent conservative row-to-PHYSICAL-case crosswalk for the
 * authorized Windows synthetic real-production-path matrix. Review output is
 * write-once; --preview writes nothing and never starts a runtime.
 *
 * This never labels a source-level seam or native-only scenario as an original
 * qualification PASS. The separate summary compiler additionally verifies
 * each nominated PASS against its strict source-dependent physical invariant.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MATRIX_REQUIREMENTS } from './lm11-full-matrix-requirements.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const owner = fs.realpathSync.native(path.join(root,'src-tauri','target',
  'lm11-b01-b03-authenticated-webview-20261119','cases'));
const audit = fs.realpathSync.native(process.argv[2] ?? '');
if (path.dirname(audit).toLowerCase()!==owner.toLowerCase() ||
    !/^matrix-audit-\d{17}-[a-f0-9]{12}$/.test(path.basename(audit)) ||
    !['--preview','--seal'].includes(process.argv[3]) ||
    process.argv.length!==4) throw Error('Expected canonical matrix audit and --preview|--seal');
const auditName=path.basename(audit);
const t15Name='fidelity-audit-20261120035223588-b4cc899a7019';
const data=(file)=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const ids=data(path.join(audit,'case-ids.json'));
if (!Array.isArray(ids)||!ids.length||ids.some(x=>!/^wry-\d{17}-[a-f0-9]{12}$/.test(x)))
  throw Error('Need complete canonical immutable case ID inventory');
const cases=ids.map(id=>{
  const dirname=path.join(owner,id);
  const meta=data(path.join(dirname,'run-metadata.json'));
  const inv=fs.existsSync(path.join(dirname,'acceptance-invariants.json'))?
    data(path.join(dirname,'acceptance-invariants.json')):null;
  const report=fs.existsSync(path.join(dirname,'renderer-report.json'))?
    data(path.join(dirname,'renderer-report.json')):null;
  return {id,meta,inv,report,pass:inv?.allPassed===true};
});
const find=(scenario,stage=null,onlyPass=true)=>cases.filter(c=>
  c.meta.scenario===scenario && (stage===null||c.meta.barrierStage===stage||
    c.meta.runtimeScenario===stage||c.meta.deadlineStage===stage) &&
  (!onlyPass||c.pass)).at(-1)?.id;
const one=(scenario,stage=null)=>find(scenario,stage)?[find(scenario,stage)]:[];
const two=(first,second)=>[...first,...second].filter(Boolean);
const rows=[];
function add(group,ordinal,ids,status,reason) {
  if (!Array.isArray(ids)) throw Error('Case IDs must be an array');
  rows.push({group,ordinal,status:ids.length ? status : 'BLOCKED',
    caseIds:[...new Set(ids)],reason:ids.length ? reason :
      'No strict original-production-path physical case was found for this exact matrix boundary; no PASS claimed.'});
}
const b01=[
  one('deadline-bounded','native-status'),
  one('stage-expiry','preparation-complete'),one('stage-expiry','predispatch'),
  one('stage-expiry','after-ai-http-open'),one('stage-expiry','first-output'),
  one('stage-expiry','terminal-delivery'),one('stage-expiry','quiescence-complete'),
  one('stage-expiry','before-evidence-acceptance'),two(
    one('stage-expiry','b03-before-prepare'),one('stage-expiry','b03-native-prepare')),
  two(one('stage-expiry','b03-before-acknowledge'),
    one('stage-expiry','b03-before-readback')),
];
for(let i=0;i<b01.length;i++)add('B01',i+1,b01[i],'PASS',
  'Real 120000 ms original qualification deadline rejected while the exact production stage was held and released; no caller resurrection.');
const b02Stages=[
  'before-preparation','during-preparation','predispatch','before-ai-http-open',
  'after-ai-http-open','first-output','during-streaming','terminal-delivery',
  'during-quiescence','before-evidence-acceptance','b03-before-prepare',
  'b03-before-acknowledge','b03-before-readback',
];
for(let i=0;i<15;i++){
  const ids=i<13 ? one('stage-cancel',b02Stages[i]) :
    one('stage-close',i===13?'before-ai-http-open':'during-streaming');
  add('B02',i+1,ids,'PASS',
    i<13 ? 'Actual original qualification Stop was requested at this distinct held production boundary; original caller rejected and native stage released without duplicate dispatch.' :
      'Genuine Tauri WebView renderer was destroyed at the original qualification boundary; native owned registry drained and no qualifying receipt was accepted.');
}
const b03=[
  one('normal'),one('stage-expiry','b03-before-prepare'),
  one('stage-cancel','b03-before-prepare'),one('stage-expiry','b03-native-prepare'),
  one('stage-cancel','b03-before-acknowledge'),
  one('stage-expiry','b03-before-acknowledge'),
  one('stage-cancel','b03-before-acknowledge'),
  one('lost-native-ack'),one('stage-expiry','b03-native-ack-response'),
  one('stage-cancel','b03-before-readback'),one('lost-native-ack'),
  one('restart-pending'),one('restart-acknowledged'),
  one('duplicate-ticket'),one('duplicate-ticket'),
  one('stale-cross-child-restart'),one('stage-conflict','b03-before-prepare'),
  one('corrupt-settings'),one('stage-concurrent','preparation-complete'),
  one('stage-conflict','b03-before-prepare'),
];
const b03Partial=new Set([16,18,19]);
for(let i=0;i<b03.length;i++)add('B03',i+1,b03[i],
  b03Partial.has(i+1)?'PARTIAL':'PASS',b03Partial.has(i+1) ?
    'The strict physical case proves a narrower native/renderer effect, but two independent original qualification owners or full recovery variants remain untested.' :
    'Original renderer/native qualification traversed this exact real CAS phase; durable pending versus acknowledged truth and original terminal were independently checked.');
// Race evidence must be tied to real responsible owner: Channel callbacks
// are not automatically equivalent to provider SSE parsing or separate ACK.
const late=[
  one('post-cancel-original-lm2f-channel'),one('post-cancel-original-lm2f-channel'),
  one('runtime-transport','delayed-cancellation-ack'),
  one('stage-expiry','first-output'),one('stage-expiry','terminal-delivery'),
  one('stale-original-qualification-child-restart'),
  one('stale-cross-child-restart'),one('stale-cross-child-restart'),
  one('stale-original-qualification-child-restart'),
  one('post-terminal-channel-callback'),
  two(one('stage-cancel','terminal-delivery'),one('runtime-transport','cancellation-terminal-race')),
  one('stage-close','terminal-delivery'),
];
for(let i=0;i<late.length;i++)add('lateRaces',i+1,late[i],'PARTIAL',
  'Real channel/epoch/deadline/close boundary was observed where available, but independent original provider-event or cancellation-ACK race equivalence is not inferred from adjacent auxiliary cases.');
const concurrent=[
  one('stage-concurrent','preparation-complete'),one('concurrent-owner-cancel'),
  one('stale-original-qualification-child-restart'),one('stale-cross-child-restart'),
  two(one('stage-conflict','b03-before-prepare'),one('stage-concurrent','preparation-complete')),
];
for(let i=0;i<concurrent.length;i++)add('concurrent',i+1,concurrent[i],
  i===0?'PASS':'PARTIAL',i===0 ?
    'Two real original qualification calls for the exact deployment contended at the existing renderer single-flight guard; only the first qualified.' :
    'Real native owner fencing/epoch/ordinary settings was observed, but independent two-WebView original qualifier competition or cross-run authority isolation remains unproven.');
const failures=[
  one('original-runtime-fault','authenticated-health-failure'),
  one('wrong-model-alias'),one('runtime-transport','request-admission-failure'),
  one('original-runtime-fault','transport-failure'),
  one('original-runtime-fault','malformed-stream-frame'),
  one('original-runtime-fault','connection-close-without-terminal'),
  one('original-runtime-fault','terminal-error'),
  one('runtime-transport','cancellation-ack-failure'),
  one('stage-expiry','quiescence-complete'),
  one('original-runtime-fault','evidence-rejection'),
  one('stage-conflict','b03-before-prepare'),
  one('corrupt-settings'),
  one('stage-close','during-streaming'),
];
const originalFaults=new Set([1,4,5,6,7,10,11,13]);
for(let i=0;i<failures.length;i++)add('failures',i+1,failures[i],
  originalFaults.has(i+1)?'PASS':'PARTIAL',
  originalFaults.has(i+1)?
    'Genuine original renderer qualification or native CAS failed deterministically without an unauthorized durable PASS; scenario-specific production cause is required by the strict independent summary checker.' :
    'Available direct-native or recovery evidence is narrower than an independently completed original qualification failure-mode injection; no unsupported PASS claimed.');
const uniqueKeys=new Set(rows.map(x=>x.group+':'+x.ordinal));
if(rows.length!==75||uniqueKeys.size!==75||
  Object.entries(MATRIX_REQUIREMENTS).some(([g,x])=>
    rows.filter(r=>r.group===g).length!==x.length))throw Error('75 exact requirement rows expected');
const regressionPath=path.join(audit,'regression-results.json');
const regressions=fs.existsSync(regressionPath)?
  data(regressionPath).regressions:[];
if(process.argv[3]==='--seal'){
  if(!Array.isArray(regressions)||regressions.length!==15)throw Error('Exactly 15 ordered regression results required before review seal');
  for(const item of regressions)if(typeof item.evidenceFile!=='string' ||
      !fs.existsSync(path.join(owner,...item.evidenceFile.split('/'))))
    throw Error('Regression evidence path missing '+item.name);
  if(!fs.existsSync(path.join(audit,'final-preservation-audit.json')))
    throw Error('Final independent preservation evidence not yet completed');
}
const attempts=Object.fromEntries(cases.filter(c=>!c.pass).map(c=>
  [c.id,'Initial, interrupted or failed physical attempt retained verbatim; no later passing retry retroactively upgrades it.']));
const review={
  schema:1,rows,positiveCaseIds:one('normal'),
  freshT15CaseId:t15Name,
  preservationEvidenceFile:auditName+'/final-preservation-audit.json',
  regressions,attemptReasons:attempts,
};
const counts=Object.fromEntries(Object.keys(MATRIX_REQUIREMENTS).map(group=>
  [group,rows.filter(r=>r.group===group).reduce((memo,r)=>
    ({...memo,[r.status]:(memo[r.status]??0)+1}),{})]));
if(process.argv[3]==='--preview'){
  console.log(JSON.stringify({mode:'read-only-preview',cases:ids.length,
    rows:rows.length,physicalPassCandidates:counts,regressions:regressions?.length??0,
    t15MatchedAfterPresent:fs.existsSync(path.join(owner,t15Name,'scoped-t15-final-comparison.json'))},null,2));
}else{
  const target=path.join(audit,'full-matrix-review.json');
  const handle=fs.openSync(target,'wx',0o600);
  try{fs.writeFileSync(handle,JSON.stringify(review,null,2)+'\n');fs.fsyncSync(handle);}
  finally{fs.closeSync(handle);}
  console.log(JSON.stringify({file:target,rows:rows.length,cases:ids.length,counts},null,2));
}
