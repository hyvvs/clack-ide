import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "vite";

assert.equal(process.env.CLACK_CONTEXT_CALIBRATION_LIVE,"1","Explicit live calibration authorization required");
const root=process.cwd(),runId=`context-calibration-${new Date().toISOString().replaceAll(/[:.]/g,"-")}`;
const output=path.join(root,"src-tauri/target/context-calibration",runId);
await mkdir(output,{recursive:false});
let finish;const report=new Promise(resolve=>{finish=resolve;});
const reportServer=createHttpServer(async(req,res)=>{
  if(req.method!=="POST"||req.url!=="/report"){res.writeHead(404).end();return;}
  let body="";for await(const chunk of req){body+=chunk;if(body.length>512*1024){res.writeHead(413).end();return;}}
  const result=JSON.parse(body);await writeFile(path.join(output,"report.json"),JSON.stringify(result,null,2));res.setHeader("Access-Control-Allow-Origin","*");res.end("ok");finish(result);
});
await new Promise(resolve=>reportServer.listen(0,"127.0.0.1",resolve));
const reportURL=`http://127.0.0.1:${reportServer.address().port}/report`;
const entry=`
import {invoke} from "@tauri-apps/api/core";
import {createSelfHostedEndpoint,addSelfHostedEndpoint,readSelfHostedState} from "/src/modules/ai/lib/selfHostedProfiles.ts";
import {selfHostedSelectionId} from "/src/modules/ai/lib/selfHostedModels.ts";
import {createSelfHostedProbeClient} from "/src/modules/ai/lib/selfHostedProbe.ts";
import {ensureSelectedContext} from "/src/modules/ai/lib/contextCalibrationRuntime.ts";
import {trustedContext} from "/src/modules/ai/lib/contextCalibrationTrust.ts";
import {modelOnboarding} from "/src/modules/ai/lib/modelOnboarding.ts";
import {updateSelfHostedProfiles} from "/src/modules/settings/store.ts";
const read=async()=>readSelfHostedState(new Map(await invoke("self_hosted_profiles_snapshot")).get("selfHostedInference"));
const endpoint=createSelfHostedEndpoint({alias:"Calibration acceptance server",baseURL:"http://127.0.0.1:11435/",allowPrivateNetwork:true},"context-acceptance");
const result={runId:${JSON.stringify(runId)},startedAt:Date.now(),ceiling:49152,models:[],cloudInference:0,downloads:0};
try{
 await updateSelfHostedProfiles(s=>addSelfHostedEndpoint(s,endpoint));
 await createSelfHostedProbeClient().refresh({endpointId:endpoint.id,allowPrivateNetwork:true});
 const initial=await read();result.inventory=initial.inventories;
 for(const model of ["qwen3-coder:30b","nemotron-3.5-lightning:30b-a3b-q4_K_M"]){
  const state=await read(),profile=state.profiles.find(p=>p.transportModelId===model);
  if(!profile)throw new Error("Installed acceptance model missing");
  const before=modelOnboarding(state,profile),startedAt=Date.now();
  const prepared=await ensureSelectedContext(state,selfHostedSelectionId(profile),new AbortController().signal,undefined,49152);
  const current=prepared.profiles.find(p=>p.id===profile.id),view=modelOnboarding(prepared,current);
  result.models.push({model,digest:current.modelRevision,startedAt,endedAt:Date.now(),before,record:current.contextCalibration,
    trusted:trustedContext(prepared,current),after:view});
 }
 result.state=await read();result.ok=true;
}catch(error){result.ok=false;result.error=String(error);result.stack=error?.stack;}
finally{result.endedAt=Date.now();await fetch(${JSON.stringify(reportURL)},{method:"POST",body:JSON.stringify(result)});await invoke("calibration_exit");}
`;
let vite,child,log="",timer;
try{
  const build=spawnSync("cargo",["build","--locked","--example","context_calibration_acceptance","--target-dir","target/codex-test"],{cwd:path.join(root,"src-tauri"),windowsHide:true,encoding:"utf8",timeout:300000});
  await writeFile(path.join(output,"build.log"),`${build.stdout??""}${build.stderr??""}`);assert.equal(build.status,0,build.stderr);
  vite=await createServer({root,configFile:false,logLevel:"warn",resolve:{alias:{"@":path.join(root,"src")}},server:{host:"127.0.0.1",port:0,watch:null,hmr:false},
   plugins:[{name:"native-context-calibration-fixture",resolveId(source){if(source==="/calibration-entry.js")return "\0calibration-entry.js";},load(id){if(id==="\0calibration-entry.js")return entry;},configureServer(server){server.middlewares.use("/context-calibration-acceptance.html",async(_req,res)=>{
    res.setHeader("Content-Type","text/html");res.end(await server.transformIndexHtml("/context-calibration-acceptance.html",`<!doctype html><html><body><script type="module" src="/calibration-entry.js"></script></body></html>`));
   });}}]});
  await vite.listen();
  const url=`${vite.resolvedUrls.local[0]}context-calibration-acceptance.html`;
  const env={...process.env,CLACK_CONTEXT_ACCEPTANCE_ROOT:output,CLACK_CONTEXT_ACCEPTANCE_URL:url};
  child=spawn(path.join(root,"src-tauri/target/codex-test/debug/examples",`context_calibration_acceptance${process.platform==="win32"?".exe":""}`),[],{cwd:root,env,windowsHide:true});
  child.stdout.on("data",b=>{log=(log+b).slice(-262144);});child.stderr.on("data",b=>{log=(log+b).slice(-262144);});
  await writeFile(path.join(output,"run.json"),JSON.stringify({runId,output,url,pid:child.pid,startedAt:Date.now(),ceiling:49152},null,2));
  console.log(JSON.stringify({runId,output,pid:child.pid}));
  const result=await Promise.race([report,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Native acceptance exceeded 11-minute harness bound")),660000);}),new Promise((_,reject)=>child.once("exit",(code,signal)=>reject(new Error(`Native host exited before report: ${code}/${signal}`))))]);
  assert(result.ok,result.error);
  const requests=(await readFile(path.join(output,"requests.jsonl"),"utf8")).trim().split("\n").map(JSON.parse);
  assert(requests.length<=14);assert(requests.every(r=>r.body.options.num_ctx<=49152));
  console.log(JSON.stringify({runId,requests:requests.length,models:result.models.map(m=>({model:m.model,highest:m.record?.highest,failure:m.record?.failure,status:m.record?.status,trusted:m.trusted}))}));
}catch(error){await writeFile(path.join(output,"failure.json"),JSON.stringify({error:String(error),at:Date.now()},null,2));throw error;}
finally{
 clearTimeout(timer);await writeFile(path.join(output,"native.log"),log);
 if(child?.exitCode===null){await new Promise(resolve=>setTimeout(resolve,1000));if(child.exitCode===null){if(process.platform==="win32")spawnSync("taskkill",["/PID",String(child.pid),"/T","/F"],{windowsHide:true});else child.kill();}}
 await vite?.close();reportServer.closeAllConnections();await new Promise(resolve=>reportServer.close(resolve));
}
