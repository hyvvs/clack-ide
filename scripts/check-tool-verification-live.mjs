import assert from "node:assert/strict";
import path from "node:path";
import {mkdir,writeFile,readFile} from "node:fs/promises";
import {spawn,spawnSync} from "node:child_process";
import {createServer as createHttpServer} from "node:http";
import {createServer} from "vite";
assert.equal(process.env.CLACK_TOOL_VERIFICATION_LIVE,"1","Explicit live verification authorization required");
const root=process.cwd(),runId=`tool-verification-${new Date().toISOString().replaceAll(/[:.]/g,"-")}`,output=path.join(root,"src-tauri/target/tool-verification",runId);
await mkdir(output,{recursive:false});
const models=["qwen3-coder:30b","muse-glimmer:30b","north-mini-code-1.0:q4_K_M","nemotron-3.5-lightning:30b-a3b-q4_K_M"];
await writeFile(path.join(output,"models.json"),JSON.stringify(models));
const prior=JSON.parse(await readFile(path.join(root,"src-tauri/target/context-calibration/context-calibration-2026-10-20T22-30-10-746Z/report.json"),"utf8"));
assert(prior.state);await writeFile(path.join(output,"source-state.json"),JSON.stringify(prior.state));
let finish;const report=new Promise(resolve=>{finish=resolve;});
const server=createHttpServer(async(req,res)=>{
  if(req.method!=="POST"||req.url!=="/report"){res.writeHead(404).end();return;}
  let body="";for await(const b of req){body+=b;if(body.length>512*1024){res.writeHead(413).end();return;}}
  const result=JSON.parse(body);await writeFile(path.join(output,"report.json"),JSON.stringify(result,null,2));res.setHeader("Access-Control-Allow-Origin","*");res.end("ok");finish(result);
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const reportURL=`http://127.0.0.1:${server.address().port}/report`;
const entry=`
import {invoke} from "@tauri-apps/api/core";
import {readSelfHostedState} from "/src/modules/ai/lib/selfHostedProfiles.ts";
import {createSelfHostedProbeClient} from "/src/modules/ai/lib/selfHostedProbe.ts";
import {verifyModelTools,readToolProfiles,canonicalProbeTools} from "/src/modules/ai/lib/toolVerificationRuntime.ts";
import {modelOnboarding} from "/src/modules/ai/lib/modelOnboarding.ts";
import {updateSelfHostedProfiles} from "/src/modules/settings/store.ts";
const result={runId:${JSON.stringify(runId)},startedAt:Date.now(),models:[],cloudInference:0,toolExecutions:0};
try{
 if(Object.values(canonicalProbeTools()).some(t=>t.execute))throw new Error("Probe must have no execute handler");
 await updateSelfHostedProfiles(()=>readSelfHostedState(${JSON.stringify(prior.state)}));
 for(const model of ${JSON.stringify(models)}){
  let state=await readToolProfiles(),p=state.profiles.find(p=>p.transportModelId===model);if(!p)throw new Error("Installed model missing");
  await createSelfHostedProbeClient().refresh({endpointId:p.endpointId,selectedModelId:model,allowPrivateNetwork:true});
  state=await readToolProfiles();p=state.profiles.find(p=>p.transportModelId===model);
  const before=modelOnboarding(state,p),startedAt=Date.now();
  const outcome=await verifyModelTools({state,profileId:p.id,signal:new AbortController().signal});
  state=await readToolProfiles();p=state.profiles.find(p=>p.transportModelId===model);
  result.models.push({model,digest:p.modelRevision,startedAt,endedAt:Date.now(),before,outcome,record:p.toolVerification,after:modelOnboarding(state,p),contextCalibration:p.contextCalibration});
 }
 result.state=await readToolProfiles();result.ok=true;
}catch(error){result.ok=false;result.error=String(error);result.stack=error?.stack;}
finally{result.endedAt=Date.now();await fetch(${JSON.stringify(reportURL)},{method:"POST",body:JSON.stringify(result)});await invoke("verification_exit");}
`;
let vite,child,log="",timer;
try{
 const build=spawnSync("cargo",["build","--locked","--example","tool_verification_acceptance","--target-dir","target/codex-test"],{cwd:path.join(root,"src-tauri"),windowsHide:true,encoding:"utf8",timeout:300000});
 await writeFile(path.join(output,"build.log"),`${build.stdout??""}${build.stderr??""}`);assert.equal(build.status,0,build.stderr);
 vite=await createServer({root,configFile:false,logLevel:"warn",resolve:{alias:{"@":path.join(root,"src")}},server:{host:"127.0.0.1",port:0,watch:null,hmr:false},plugins:[{
  name:"tool-verification-fixture",resolveId(source){if(source==="/tool-verification-entry.js")return "\0tool-verification-entry.js";},load(id){if(id==="\0tool-verification-entry.js")return entry;},
  configureServer(vite){vite.middlewares.use("/tool-verification-acceptance.html",async(_req,res)=>{res.setHeader("Content-Type","text/html");res.end(await vite.transformIndexHtml("/tool-verification-acceptance.html",`<!doctype html><html><body><script type="module" src="/tool-verification-entry.js"></script></body></html>`));});}
 }]});await vite.listen();
 const url=`${vite.resolvedUrls.local[0]}tool-verification-acceptance.html`;
 child=spawn(path.join(root,"src-tauri/target/codex-test/debug/examples",`tool_verification_acceptance${process.platform==="win32"?".exe":""}`),[],{cwd:root,windowsHide:true,env:{...process.env,CLACK_TOOL_ACCEPTANCE_ROOT:output,CLACK_TOOL_ACCEPTANCE_URL:url}});
 child.stdout.on("data",b=>{log=(log+b).slice(-262144);});child.stderr.on("data",b=>{log=(log+b).slice(-262144);});
 await writeFile(path.join(output,"run.json"),JSON.stringify({runId,output,pid:child.pid,startedAt:Date.now()},null,2));console.log(JSON.stringify({runId,output,pid:child.pid}));
 const result=await Promise.race([report,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("9-minute native harness bound")),540000);}),new Promise((_,reject)=>child.once("exit",(code,signal)=>reject(new Error(`Host exit before report: ${code}/${signal}`))))]);
 assert(result.ok,result.error);
 const requests=(await readFile(path.join(output,"requests.jsonl"),"utf8")).trim().split("\n").map(JSON.parse);
 assert.equal(requests.length,4);assert.equal(new Set(requests.map(r=>r.body.model)).size,4);assert.equal(result.toolExecutions,0);
 console.log(JSON.stringify({runId,requests:requests.length,models:result.models.map(m=>({model:m.model,status:m.record?.status,outcome:m.record?.outcome,tools:m.after?.tools,readiness:m.after?.status}))}));
}catch(error){await writeFile(path.join(output,"failure.json"),JSON.stringify({error:String(error),at:Date.now()},null,2));throw error;}
finally{
 clearTimeout(timer);await writeFile(path.join(output,"native.log"),log);
 if(child?.exitCode===null){await new Promise(resolve=>setTimeout(resolve,1000));if(child.exitCode===null){if(process.platform==="win32")spawnSync("taskkill",["/PID",String(child.pid),"/T","/F"],{windowsHide:true});else child.kill();}}
 await vite?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
