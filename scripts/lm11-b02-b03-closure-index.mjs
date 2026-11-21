/**
 * Read-only compilation followed by ONE exclusive write-once LM11 B02/B03
 * closure index. Never alters a historical case or immutable earlier index.
 * Statuses are explicit: no nearby test can silently promote a Partial.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = fs.realpathSync.native(path.join(repo, 'src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases'));
const [auditInput, primaryInput, finalInput] = process.argv.slice(2);
if (!auditInput || !primaryInput || !finalInput || process.argv.length !== 5)
  throw Error('Require closure audit, original fresh T15 and supplementary final T15 directories');
function owned(input, name) {
  const value = fs.realpathSync.native(input);
  if (path.dirname(value).toLowerCase() !== cases.toLowerCase() ||
      !name.test(path.basename(value)) || fs.lstatSync(value).isSymbolicLink())
    throw Error('Noncanonical, redirected or foreign acceptance directory');
  return value;
}
const audit = owned(auditInput, /^closure-audit-\d{17}-[a-f0-9]{12}$/);
const primary = owned(primaryInput, /^fidelity-audit-\d{17}-[a-f0-9]{12}$/);
const finalT15 = owned(finalInput, /^fidelity-audit-\d{17}-[a-f0-9]{12}$/);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function evidence(file) {
  const absolute = path.join(repo, file.replaceAll('/', path.sep));
  if (!fs.lstatSync(absolute).isFile() || fs.lstatSync(absolute).isSymbolicLink())
    throw Error('Not a real immutable evidence file: ' + file);
  const bytes = fs.readFileSync(absolute);
  return { file, bytes: bytes.length, sha256: sha(bytes) };
}
function relative(absolute) {
  const value = path.relative(repo, absolute).replaceAll('\\', '/');
  if (value.startsWith('../') || path.isAbsolute(value)) throw Error('Evidence escaped repository');
  return value;
}
function json(absolute) { return JSON.parse(fs.readFileSync(absolute, 'utf8')); }
const sourceBefore = json(path.join(audit, 'source-freeze-before.json'));
const sourceAfter = json(path.join(audit, 'source-freeze-after.json'));
const frozen = JSON.stringify(sourceBefore.files) === JSON.stringify(sourceAfter.files);
const regression = json(path.join(audit, 'regression-results.json'));
if (regression.regressions?.length !== 19 || !regression.allNineteenExecuted)
  throw Error('Exactly 19 ordered regression groups are required before index sealing');
const oldIndexes = [
  ['src-tauri/target/lm11-b03-native-acceptance-20261119-real-host/native-acceptance-85-invocations-20261119.json','c329ae36ad8255150ff0a46f71a03a64d0a6dec8283db392c6861668ddeef1a7'],
  ['src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases/index-20261119080122842-cf1e7d43238c/authenticated-webview-evidence-index.json','f8f7f1effc0681530941e3f2926248d65b642ef4db81618bf8a1d948adbcd74e'],
  ['src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases/index-20261120000845246-05cea9a2820e/lm11-fidelity-closure-evidence-index.json','cd5e2529b39acc542bc49b324decccf931b791dc31f4ed727bd29ea82c7507d1'],
  ['src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases/index-20261120030346856-e7fecf53ae5b/lm11-final-blocker-closure-evidence-index.json','8aa9c994fbea5355cf50e4bedf420e60cf60c2f2b477d8d3e5c85f28ea5cd8ee'],
  ['src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases/index-20261120061805173-887efb038e68/lm11-b01-b03-full-matrix-evidence-index.json','1de726b770192ba4b5f761a02a04283207b05e349e0a4efe8f3c51d5ecc304d4'],
].map(([file, expectedSha256]) => ({ ...evidence(file), expectedSha256, preserved: evidence(file).sha256 === expectedSha256 }));
const oldIndex = oldIndexes[4].file;
const physicalIds = [
  'wry-20261120065106554-8f9cc774839a',
  'wry-20261120065201599-fac8328f1bb9',
  'wry-20261120065422129-d68e0a25903e',
  'wry-20261120071151632-c6551e61f34e',
  'wry-20261120071211876-ad39f21a23f3',
  'wry-20261120071304484-452343b7c5cf',
  'wry-20261120071328215-fe150074affa',
  'wry-20261120071346130-1d16add2ab41',
  'wry-20261120071450229-83edfd4b9b0b',
  'wry-20261120071635060-e681719cf400',
  'wry-20261120072038200-b3b79829c8f3',
  'wry-20261120072145040-c8273177ed36',
  'wry-20261120072250322-6ce6e6c1f6fa',
  'wry-20261120072313356-333858f5d3c2',
  'wry-20261120073234976-38613e16f205',
];
const regressions = regression.regressions.map(row => {
  const artifact = evidence(relative(path.join(audit, 'regression-' + String(row.ordinal).padStart(2, '0') + '.log')));
  return { ...row, artifact };
});
for (const row of regressions) {
  if (![9,10,11,12].includes(row.ordinal)) continue;
  const match = fs.readFileSync(path.join(repo, row.artifact.file), 'utf8')
    .match(/wry-\d{17}-[a-f0-9]{12}/);
  if (match && !physicalIds.includes(match[0])) physicalIds.push(match[0]);
}
const physical = physicalIds.map(id => {
  const dir = owned(path.join(cases, id), /^wry-\d{17}-[a-f0-9]{12}$/);
  const files = fs.readdirSync(dir, { withFileTypes: true })
    .filter(ent => ent.isFile() && !ent.isSymbolicLink())
    .sort((a,b) => a.name.localeCompare(b.name))
    .map(ent => evidence(relative(path.join(dir, ent.name))));
  const meta = json(path.join(dir, 'run-metadata.json'));
  const invariantFile = path.join(dir, 'acceptance-invariants.json');
  const inv = fs.existsSync(invariantFile) ? json(invariantFile) : null;
  const rendererFile = path.join(dir, 'renderer-report.json');
  const renderer = fs.existsSync(rendererFile) ? json(rendererFile) : null;
  const native = renderer?.renderer?.native ?? {};
  return {
    caseId:id, scenario:meta.scenario, runtimeScenario:meta.runtimeScenario,
    stage:meta.barrierStage, accepted:inv?.allPassed === true &&
      renderer?.renderer?.outcome !== 'blocked' &&
      (renderer?.nativeRequestChecks?.pass !== false),
    hostInvariantPassed:inv?.allPassed ?? false,
    failedInvariants:inv?.checks?.filter(row => !row.pass).map(row => row.name) ?? ['invariants-unavailable'],
    originalCallerOutcome:renderer?.renderer?.outcome ?? 'no-renderer-terminal-report',
    nativeRequestIds:[native.originalRuntimeFault?.exactOriginalRequestId,
      native.stageBarrier?.originalRequestId, native.originalLm2fLate?.requestId,
      renderer?.nativeRequestChecks?.streamIds?.[0]].filter(Boolean),
    nativePid:native.bind?.pid ?? native.stageBarrier?.nativePid ?? null,
    nativeEpoch:native.bind?.epoch ?? native.stageBarrier?.nativeEpoch ?? null,
    nativeReceiptCount:renderer?.nativeDurableReceiptCheck?.count ?? null,
    artifacts:files,
  };
});
const byId = id => physical.find(row => row.caseId === id)?.accepted === true;
const caseRef = id => [id];
const row = (id,area,requirement,prior,finalStatus,caseIds=[],finding='') =>
  ({id,area,requirement,priorClassification:prior,priorSourceIndex:oldIndex,
    finalClassification:finalStatus,newCaseIds:caseIds,physicalEvidenceAccepted:caseIds.every(byId),
    finding});
const crosswalk = [
  row('B02-A1','B02','Admission promise resolves only after terminal cancellation','Partial','Partial',caseRef('wry-20261120071151632-c6551e61f34e'),'Before-preparation hold is AFTER original admission; unresolved admission completion still unproven'),
  row('B02-A2','B02','Real preparation promise resolves only after terminal cancellation','Partial','Partial',caseRef('wry-20261120071211876-ad39f21a23f3'),'Held continuation is disarmed after Stop; exact unresolved promise completion ordering is not separately observed'),
  row('B02-A3','B02','Native ai_http_open registration resolves after cancellation','Partial','Partial',caseRef('wry-20261120071304484-452343b7c5cf'),'Existing registered ID post-open cancellation fenced; late registration response itself not observed'),
  ...[
    'Late stream after cancellation','Late terminal after cancellation',
    'Cancellation ACK after caller settlement','Late stream after aggregate deadline',
    'Late terminal after aggregate deadline','Stale callback across real child epoch',
    'Stale native request ID after epoch','Stale cancellation after epoch',
    'Stale qualification completion after epoch','Duplicate completion callback',
    'Cancellation versus terminal completion','Renderer close versus real terminal delivery',
  ].map((name,i) => row('B02-race-'+String(i+1).padStart(2,'0'),'B02',name,
      i===11?'Blocked':'Partial',i===11?'PASS':'Partial',
      i===11?caseRef('wry-20261120073234976-38613e16f205'):[],
      i===11?'Real terminal-delivery barrier, destroyed WebView, exact registered ID and native drain observed':'Existing T10/T13 shared fences do not independently prove this exact timing and callback owner')),
  row('B03-16','B03','Full original-path stale old-epoch persistence ticket','Partial','Partial',[],'Historical direct CAS and T10 runtime restart do not prove full original persistence progression'),
  row('B03-18','B03','Recovery-required corrupt authoritative state','Partial','Partial',[],'Five required corrupt and restart variants not physically closed in original qualification'),
  row('B03-19','B03','Two admitted concurrent same deployment B03 CAS contenders','Partial','Partial',caseRef('wry-20261120072313356-333858f5d3c2'),'Second flight rejected at original single-flight admission; no simultaneous CAS contenders'),
  ...['Malformed authoritative settings','Inconsistent qualification marker','Unusable recovery artifact',
    'Missing authoritative state with insufficient recovery','Corrupt state discovered after restart']
    .map((name,i)=>row('B03-corrupt-'+(i+1),'B03',name,'Partial','Partial',[],'Not executed through full original production qualification')),
  row('CON-1','Concurrent','Two admitted same-deployment epoch contention','Partial','Partial',caseRef('wry-20261120072313356-333858f5d3c2'),'One original flight preserved, second rejected before persistence'),
  row('CON-2','Concurrent','Cancel operation A while B proceeds','Partial','Partial',[],'No new original-path two-live-session isolation proof'),
  row('CON-3','Concurrent','Stale A versus current B persistence','Partial','Partial',[],'No new original-path stale CAS reconciliation proof'),
  row('CON-4','Concurrent','Unrelated deployment or session isolation','Partial','Partial',[],'No two-live-deployment original-path proof'),
  row('FAIL-02','Failure','Authenticated wrong model identity','Partial','Partial',[],'Original-path wrong-model authenticated admission untested'),
  row('FAIL-03','Failure','Native request admission failure after Ready','Partial','Partial',[],'Original-path native request admission negative untested'),
  row('FAIL-08','Failure','Late/corrupt native cancellation ACK in original lifecycle','Partial','Partial',[],'Native-only ACK failure history cannot establish original caller ordering'),
  row('FAIL-09','Failure','Registered request fails native quiescence','Partial','Partial',[],'Original-path quiescence fault untested'),
  row('FAIL-10','Failure','Protocol-valid transport followed by genuine evaluator rejection','Blocked','PASS',
    caseRef('wry-20261120072145040-c8273177ed36'),
    'Genuine terminal and quiescence; evaluator marked instruction adherence failed; truthful 3 verified transport + 1 failed adherence receipts, no complete qualifying set'),
  row('FAIL-12','Failure','Recovery-required native persistence','Partial','Partial',[],'Original-path unresolved corrupted authority untested'),
  row('FAIL-01','Failure','Authenticated Ready failure','PASS','PASS',
    caseRef('wry-20261120071450229-83edfd4b9b0b'),'Original qualification fail-closed at native-status'),
  row('B03-CAS-17','B03','Intervening ordinary settings CAS conflict','PASS','PASS',
    caseRef('wry-20261120072250322-6ce6e6c1f6fa'),'Actual original B03 prepare boundary rejected stale revision and preserved ordinary edit'),
];
const primaryCompare = json(path.join(primary, 'scoped-t15-final-comparison.json'));
const finalCompare = json(path.join(finalT15, 'scoped-t15-final-comparison.json'));
const continuity = JSON.stringify(json(path.join(primary, 'production-after.json')).fileOrRegistryEntries) ===
  JSON.stringify(json(path.join(finalT15, 'production-before.json')).fileOrRegistryEntries);
const t15 = [primary,finalT15].map(dir => ({
  caseId:path.basename(dir), authoritativePass:json(path.join(dir,'scoped-t15-final-comparison.json')).authoritativeT15Pass,
  artifacts:fs.readdirSync(dir).filter(name=>name.endsWith('.json')).sort()
    .map(name=>evidence(relative(path.join(dir,name)))),
}));
const tracked=fs.readFileSync(path.join(repo,'src-tauri/target/lm2f-validation-20261117/reconstructed-protected-81.tsv'),'utf8')
  .trim().split(/\r?\n/).map(line=>line.split('\t'));
const protectedRows=tracked.map(([file,expectedSha256])=>({
  ...evidence(file),expectedSha256,unchanged:evidence(file).sha256===expectedSha256}));
const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();
const rawIndexHash=sha(fs.readFileSync(path.join(repo,'.git/index')));
const preservation={
  branch:git('branch','--show-current'),head:git('rev-parse','HEAD'),
  rawGitIndexSha256:rawIndexHash,stagedPaths:git('diff','--cached','--name-only').split(/\r?\n/).filter(Boolean),
  originalStashes:git('stash','list','--format=%H').split(/\r?\n/).filter(Boolean),
  protectedLiteralFiles:protectedRows,
  all81ProtectedHashesUnchanged:protectedRows.length===81&&protectedRows.every(row=>row.unchanged),
  historicalIndexes:oldIndexes,
  allHistoricalIndexesUnchanged:oldIndexes.every(row=>row.preserved),
  autonomousTrackerDirty:git('status','--porcelain','--','autonomous_tracker').length>0,
  forbiddenTargetDebugExists:fs.existsSync(path.join(repo,'src-tauri/target/debug')),
  forbiddenTargetCodexTestExists:fs.existsSync(path.join(repo,'src-tauri/target/codex-test')),
};
const out = {
  schema:1,title:'LM11 B02/B03 Final Acceptance Closure',
  createdAtUtc:new Date().toISOString(),
  priorImmutableFullMatrixIndex:oldIndexes[4],
  priorFullMatrixPhysicalAttempts:87,
  priorFullMatrixStrictPass:75,priorFullMatrixFailedOrIncomplete:12,
  scope:'Actual Windows Wry/Tauri original qualification with acceptance-only authenticated synthetic no-model child; partial closure is not permission to enable Qualification Lab Run',
  sourceFreeze:{before:evidence(relative(path.join(audit,'source-freeze-before.json'))),
    after:evidence(relative(path.join(audit,'source-freeze-after.json'))),
    exactSourceManifest:sourceAfter.files,unchangedAcrossRegressions:frozen},
  sourceChangesDuringThisClosure:[
    'scripts/lm11-authenticated-webview-acceptance.mjs',
    'src-tauri/examples/lm11_authenticated_webview_acceptance.rs',
    'scripts/lm11-b02-b03-closure-regressions.ps1',
    'scripts/lm11-b02-b03-closure-index.mjs',
    'scripts/lm11-b02-b03-closure-source-freeze.mjs',
    'docs/AGENT_ENGINEERING_STATE.md',
    'docs/LM11_LM15_LOCAL_MODEL_QUALIFICATION.md',
  ],
  originalResumedVerificationCorrection:'No production/source implementation files were modified during resumed verification; four acceptance-evidence/audit scripts were created or edited.',
  physicalAttempts:physical,failedOrIncompletePhysicalAttempts:physical.filter(row=>!row.accepted).map(row=>row.caseId),
  crosswalk,
  regressionResults:evidence(relative(path.join(audit,'regression-results.json'))),
  orderedRegressions:regressions,
  t15:{continuousPrimaryAndSupplementalPairs:continuity,cohorts:t15,
    allPass:primaryCompare.authoritativeT15Pass&&finalCompare.authoritativeT15Pass&&continuity},
  preservation,
  classifications:{
    B01:'Accepted for tested Windows synthetic-production-path boundary',
    B02:'Partial',B03:'Partial',combined:'Partial',
    qualificationLabRun:'Disabled',
    separateLabEnablementDecisionEligible:false,
  },
  limitations:[
    'Completion of partial boundary cases does not discharge all twelve independent race requirements',
    'No full-path stale epoch persistence, five corrupt recovery cases, two admitted B03 CAS contenders or cross-deployment cancellation isolation',
    'Delayed admission and actual unresolved preparation-promise ordering not independently held to completion',
    'Late cancellation ACK independently after caller settlement not observed',
    'Five historical unrelated structured-memory fixture failures are not reclassified',
    'Physical post-terminal closure evidence is native/session cleanup where renderer cannot observe terminal',
  ],
};
const id='index-'+new Date().toISOString().replace(/\D/g,'')+'-'+crypto.randomBytes(6).toString('hex');
const dir=path.join(cases,id);
fs.mkdirSync(dir,{recursive:false});
const output=path.join(dir,'lm11-b02-b03-final-acceptance-closure-evidence-index.json');
const bytes=Buffer.from(JSON.stringify(out,null,2)+'\n');
const fd=fs.openSync(output,'wx',0o600);
try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
console.log(JSON.stringify({index:output,sha256:sha(bytes),physicalAttempts:physical.length,
  physicalPass:physical.filter(row=>row.accepted).length,failed:physical.filter(row=>!row.accepted).length,
  requirements:crosswalk.length,t15Pass:out.t15.allPass,
  priorPreserved:preservation.allHistoricalIndexesUnchanged,
  sourceFrozen:frozen,regressionGroups:regressions.length,
  classifications:out.classifications},null,2));
