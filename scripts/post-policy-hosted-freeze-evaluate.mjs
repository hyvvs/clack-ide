/** Independent ONE-TIME evaluator for the isolated R5de frozen Muse notes app.
 * Never invokes Clack, Ollama or an Agent; never repairs source. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository=fileURLToPath(new URL("../",import.meta.url));
const owned=path.join(repository,"src-tauri/target/remote-controls/post-policy-laguna-notes-20261029-01");
const root=path.join(owned,"post-policy-hosted-notes-20261029-01"), dest=path.join(owned,"evaluation-snapshot");
const outcome=path.join(owned,"independent-evaluation.json");
const receipt=JSON.parse(await readFile(path.join(owned,"mission-a-1.native-report.json"),"utf8"));
assert.equal(receipt.missionStarted,true,"Only one terminated replacement mission may be evaluated");
const runner=JSON.parse(await readFile(path.join(owned,"mission-a-1.json"),"utf8"));
assert.equal(runner.nativeExit?.code,0,"Do not freeze until the Agent host exits normally");
const state={startedAt:Date.now(),frozenSourceFiles:[],suite:{},api:{},errors:[],verdict:"INCOMPLETE"};
// One-shot marker BEFORE any evaluation side effects; never overwrite or repeat.
await writeFile(path.join(owned,"independent-evaluation.started"),JSON.stringify({startedAt:state.startedAt}),{flag:"wx"});
const save=async()=>writeFile(outcome,JSON.stringify({...state,updatedAt:Date.now()},null,2));
const codeFiles=[];
async function discover(directory,relative="") {
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    if([".git","node_modules","dist","build","coverage",".next","data"].includes(entry.name)) continue;
    const rel=path.join(relative,entry.name), abs=path.join(directory,entry.name);
    if(entry.isDirectory()) await discover(abs,rel);
    else if(entry.isFile() && !/\.(db|sqlite|log|lock)$/i.test(entry.name)) {
      const buffer=await readFile(abs);
      codeFiles.push({file:rel.replaceAll("\\","/"),sha256:createHash("sha256").update(buffer).digest("hex"),bytes:buffer.length});
    }
  }
}
await discover(root);
state.frozenSourceFiles=codeFiles;
await save();
await cp(root,dest,{recursive:true,errorOnExist:true,force:false,filter:(s)=>path.basename(s)!==".git"});
const exists=async p=>{try{await stat(path.join(dest,p));return true}catch{return false}};
const packageFile=await readFile(path.join(dest,"package.json"),"utf8").catch(()=>null);
const pkg=packageFile?JSON.parse(packageFile):null;
state.suite.packagePresent=!!pkg;
state.suite.scripts=pkg?.scripts??{};
state.suite.tsconfigPresent=await exists("tsconfig.json");
state.suite.readmePresent=!!codeFiles.find(f=>/^(readme)(\.md|\.txt)$/i.test(f.file));
state.suite.gitignorePresent=await exists(".gitignore");
state.suite.testFiles=codeFiles.filter(f=>/(^|\/)(?:[^/]*\.)?(?:test|spec)\.[cm]?[jt]sx?$/i.test(f.file)).map(f=>f.file);
state.suite.testSourceCount=state.suite.testFiles.length;
const tsFiles=codeFiles.filter(f=>/\.(ts|tsx|mts|cts)$/.test(f.file));
state.suite.typescriptFiles=tsFiles.length;
state.suite.gitignoreText=state.suite.gitignorePresent? (await readFile(path.join(dest,".gitignore"),"utf8")).slice(0,2000):null;
state.suite.readmeText=state.suite.readmePresent? (await readFile(path.join(dest,codeFiles.find(f=>/^(readme)(\.md|\.txt)$/i.test(f.file)).file),"utf8")).slice(0,5000):null;
const run=async (command,args,limit=150000) => {
  const child=spawn(command,args,{cwd:dest,env:{...process.env,CI:"1"},windowsHide:true,shell:process.platform==="win32"});
  let stdout="",stderr="",timeout=false;
  child.stdout?.on("data",c=>{stdout=(stdout+c).slice(-32000)});
  child.stderr?.on("data",c=>{stderr=(stderr+c).slice(-16000)});
  const timer=setTimeout(()=>{timeout=true;child.kill();},limit);
  return await new Promise(resolve=>{
    child.once("error",e=>{clearTimeout(timer);resolve({code:null,error:e.code??"spawn-error",timeout,stdout,stderr})});
    child.once("exit",code=>{clearTimeout(timer);resolve({code,timeout,stdout,stderr})});
  });
};
const cmd=process.platform==="win32"?"npm.cmd":"npm";
if(pkg && state.suite.tsconfigPresent && state.suite.typescriptFiles) {
  state.suite.typescript=await run(cmd,["exec","--no","--","tsc","--noEmit"]);
  await save();
}
if(pkg?.scripts?.build) {state.suite.build=await run(cmd,["run","build"]);await save();}
if(pkg?.scripts?.test) {state.suite.npmTest=await run(cmd,["test"]);await save();}
const out=state.suite.npmTest?.stdout??"";
const textCount=[...out.matchAll(/(?:# tests|Tests\s+|tests?\s+|[0-9]+\s+tests?\s+passed)/gi)].length;
const explicitZero=/(?:# tests\s+0\b|no tests found|0 tests? passed|no test files found|0 passing)/i.test(out);
state.suite.testsDiscovered=state.suite.testSourceCount>0 && textCount>0 && !explicitZero;
state.suite.testsPassed=state.suite.npmTest?.code===0 && state.suite.testsDiscovered;
await save();

// Evaluate the actual runtime on 4321, twice, without source edits. The
// snapshot avoids changing the frozen original even for disk persistence.
async function probe(url,method="GET",body=undefined) {
  try {
    const response=await fetch(url,{method,headers:{"content-type":"application/json"},body:body===undefined?undefined:typeof body==="string"?body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
    const text=await response.text();let json;try{json=JSON.parse(text)}catch{}
    return {status:response.status,json,error:null};
  } catch(error) {return {status:null,json:null,error:error.name??"network-failure"}}
}
const base="http://127.0.0.1:4321";
if((await probe(`${base}/health`)).status!==null){state.errors.push("port-4321-occupied-before-evaluation");await save()}
else if(pkg?.scripts?.start) {
  let child;
  const stop=async()=>{
    if(!child)return;
    if(process.platform==="win32")spawnSync("taskkill",["/PID",String(child.pid),"/T","/F"],{windowsHide:true,timeout:5000});
    else child.kill("SIGTERM");
    await new Promise(resolve=>setTimeout(resolve,600));child=undefined;
  };
  const start=async()=>{
    child=spawn(cmd,["start"],{cwd:dest,env:{...process.env,PORT:"4321",NODE_ENV:"test"},windowsHide:true,shell:process.platform==="win32",stdio:"ignore"});
    for(let i=0;i<40;i++){
      const health=await probe(`${base}/health`);
      if(health.status===200)return health;
      if(child.exitCode!==null)break;
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    return {status:null,error:"start-timeout"};
  };
  try {
    state.api.startup=await start();
    await save();
    if(state.api.startup.status===200) {
      state.api.initialList=await probe(`${base}/notes`);
      state.api.create=await probe(`${base}/notes`,"POST",{title:"Acceptance persisted note",body:"Written before restart"});
      const data=state.api.create.json;
      const note=data?.note??data;
      const id=note?.id;
      state.api.createdId=id??null;
      if(typeof id==="string" || typeof id==="number") {
        const u=encodeURIComponent(id);
        state.api.get=await probe(`${base}/notes/${u}`);
        state.api.listAfterCreate=await probe(`${base}/notes`);
        state.api.update=await probe(`${base}/notes/${u}`,"PATCH",{title:"Updated acceptance title"});
        state.api.getAfterUpdate=await probe(`${base}/notes/${u}`);
        state.api.malformed=await probe(`${base}/notes`,"POST",'{bad-json');
        state.api.blankTitle=await probe(`${base}/notes`,"POST",{title:"  "});
        state.api.longTitle=await probe(`${base}/notes`,"POST",{title:"x".repeat(121)});
        state.api.missingTitle=await probe(`${base}/notes`,"POST",{body:"no title"});
        state.api.missingGet=await probe(`${base}/notes/__does_not_exist__`);
        state.api.missingPatch=await probe(`${base}/notes/__does_not_exist__`,"PATCH",{title:"x"});
        state.api.missingDelete=await probe(`${base}/notes/__does_not_exist__`,"DELETE");
        await stop();
        state.api.stoppedBeforeRestart=await probe(`${base}/health`);
        state.api.restartHealth=await start();
        if(state.api.restartHealth.status===200) {
          state.api.persistedAfterRestart=await probe(`${base}/notes/${u}`);
          state.api.delete=await probe(`${base}/notes/${u}`,"DELETE");
          state.api.getAfterDelete=await probe(`${base}/notes/${u}`);
        }
      }
    }
  } finally {await stop();}
}
const notesResponse=r=>r?.json?.note??r?.json;
const check= {
  typescript:state.suite.typescript?.code===0,
  build:state.suite.build?.code===0,
  testDiscovery:state.suite.testsDiscovered,
  npmTest:state.suite.testsPassed,
  readme:state.suite.readmePresent && /npm (install|ci)/i.test(state.suite.readmeText??"") && /npm (start|run build|test)/i.test(state.suite.readmeText??""),
  gitignore:state.suite.gitignorePresent && /node_modules/i.test(state.suite.gitignoreText??"") && /(data|\.json|\.db|\.sqlite)/i.test(state.suite.gitignoreText??""),
  start:state.api.startup?.status===200,
  create:state.api.create?.status===201 || state.api.create?.status===200,
  list:state.api.initialList?.status===200 && state.api.listAfterCreate?.status===200,
  get:state.api.get?.status===200,
  update:[200,204].includes(state.api.update?.status),
  delete:[200,204].includes(state.api.delete?.status) && state.api.getAfterDelete?.status===404,
  badInput:[400,422].includes(state.api.malformed?.status) && [400,422].includes(state.api.blankTitle?.status) &&
    [400,422].includes(state.api.longTitle?.status) && [400,422].includes(state.api.missingTitle?.status),
  missingIds:state.api.missingGet?.status===404 && state.api.missingPatch?.status===404 && state.api.missingDelete?.status===404,
  restart:state.api.stoppedBeforeRestart?.status===null && state.api.restartHealth?.status===200 && state.api.persistedAfterRestart?.status===200 &&
    notesResponse(state.api.persistedAfterRestart)?.title==="Updated acceptance title",
  authoredTestFiles:state.suite.testSourceCount>0,
  remoteProductionPath:runner.productionModelPath===true && runner.genuineToolCalls>=1 && receipt.toolCalls>=1,
  truthfulAgentCompletion:receipt.state==="completed",
};
state.checks=check;
state.verdict=Object.values(check).every(Boolean)?"NOTES_APP_PASS":"NOTES_APP_FAIL";
await save();
console.log(JSON.stringify({verdict:state.verdict,checks:state.checks,sourceFiles:codeFiles.map(f=>f.file),
  npmTestsExit:state.suite.npmTest?.code,buildExit:state.suite.build?.code,typescriptExit:state.suite.typescript?.code},null,2));
