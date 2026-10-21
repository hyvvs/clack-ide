import assert from "node:assert/strict";
import path from "node:path";
import {mkdir,readFile,writeFile,readdir} from "node:fs/promises";
import {spawn,spawnSync} from "node:child_process";
import {createServer as httpServer} from "node:http";
import {createServer} from "vite";
import {createHash} from "node:crypto";

assert.equal(process.env.CLACK_AGENT_CONFIGURATION_LIVE,"1","Live acceptance must be explicitly authorized");
const root=process.cwd(),base=path.join(root,"src-tauri/target/automatic-agent-configuration"),endpoint="http://127.0.0.1:11435";
const models=["qwen3-coder:30b","nemotron-3.5-lightning:30b-a3b-q4_K_M"];
for(const dir of await readdir(base,{withFileTypes:true}))if(dir.isDirectory()&&dir.name.startsWith("automatic-agent-configuration-")){
  let requests="";try{requests=await readFile(path.join(base,dir.name,"requests.jsonl"),"utf8");}catch(e){if(e.code!=="ENOENT")throw e;}
  assert(!requests.trim(),"Live acceptance already sent inference; do not replay");
}
const fixture=JSON.parse(await readFile("src/test/fixtures/qwen-tool-mismatch-20261021.json","utf8"));
const canonical=fixture.runs[0].request.body;
const expected={bodies:[canonical,{...canonical,think:false},{...canonical,model:models[1]}],limits:{[models[0]]:3,[models[1]]:1}};
const runId=`automatic-agent-configuration-${new Date().toISOString().replaceAll(/[:.]/g,"-")}`,output=path.join(base,runId);
await mkdir(output);await writeFile(path.join(output,"expected.json"),JSON.stringify(expected));
async function metadata(route,body){const r=await fetch(endpoint+route,{method:body?"POST":"GET",headers:body?{"Content-Type":"application/json"}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});assert(r.ok);return r.json();}
const before={version:await metadata("/api/version"),tags:await metadata("/api/tags"),ps:await metadata("/api/ps"),show:{}};
for(const model of models)before.show[model]=await metadata("/api/show",{model});
assert.equal(before.tags.models.find(m=>m.name===models[0])?.digest,fixture.historical.digest);
await writeFile(path.join(output,"metadata-before.json"),JSON.stringify(before,null,2));
let complete;const received=new Promise(resolve=>{complete=resolve;});
const server=httpServer(async(req,res)=>{
  if(req.method!=="POST"||req.url!=="/report"){res.writeHead(404).end();return;}
  let data="";for await(const b of req){data+=b;if(data.length>1024*1024){res.writeHead(413).end();return;}}
  const result=JSON.parse(data);await writeFile(path.join(output,"report.json"),JSON.stringify(result,null,2));
  for(const [id,events] of Object.entries(result.events??{}))await writeFile(path.join(output,id+".response.ndjson"),Buffer.from(events.filter(e=>e.kind==="chunk").flatMap(e=>e.bytes)));
  res.setHeader("Access-Control-Allow-Origin","*");res.end("ok");complete(result);
});await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const reportURL=`http://127.0.0.1:${server.address().port}/report`;
const entry=`
import {Channel,invoke} from '@tauri-apps/api/core';
import {createSelfHostedEndpoint,addSelfHostedEndpoint} from '/src/modules/ai/lib/selfHostedProfiles.ts';
import {createSelfHostedProbeClient} from '/src/modules/ai/lib/selfHostedProbe.ts';
import {verifyModelTools,readToolProfiles,ensureSelectedTools,canonicalProbeTools} from '/src/modules/ai/lib/toolVerificationRuntime.ts';
import {selfHostedSelectionId} from '/src/modules/ai/lib/selfHostedModels.ts';
import {applyAgentRecommendation} from '/src/modules/ai/lib/agentConfiguration.ts';
import {effortProviderOptions} from '/src/modules/ai/lib/reasoningEffort.ts';
import {modelOnboarding} from '/src/modules/ai/lib/modelOnboarding.ts';
import {updateSelfHostedProfiles} from '/src/modules/settings/store.ts';
const result={runId:${JSON.stringify(runId)},models:[],events:{},cloudInference:0,toolExecutions:0,startedAt:Date.now()};
const descriptor=Object.getOwnPropertyDescriptor(Channel.prototype,'onmessage');let bytes=0;
Object.defineProperty(Channel.prototype,'onmessage',{...descriptor,set(previous){descriptor.set.call(this,event=>{
 if(typeof event?.requestId==='string'&&event.requestId.startsWith('inference-')){bytes+=event.bytes?.length??0;if(bytes>524288)throw Error('Response bound');(result.events[event.requestId]??=[]).push({...event,at:Date.now()});}
 previous.call(this,event);
});}});
try{
 const endpoint=createSelfHostedEndpoint({alias:'Automatic Agent acceptance',baseURL:${JSON.stringify(endpoint)},backendHint:'ollama',allowPrivateNetwork:true},'agent-configuration');
 await updateSelfHostedProfiles(s=>addSelfHostedEndpoint(s,endpoint));
 if(Object.values(canonicalProbeTools()).some(t=>t.execute))throw Error('Executable probe');
 for(const model of ${JSON.stringify(models)}){
   await createSelfHostedProbeClient().refresh({endpointId:endpoint.id,selectedModelId:model,allowPrivateNetwork:true});
   let state=await readToolProfiles(),p=state.profiles.find(p=>p.transportModelId===model);
   const item={model,digest:p.modelRevision,before:modelOnboarding(state,p),startedAt:Date.now()};result.models.push(item);
   await verifyModelTools({state,profileId:p.id,signal:new AbortController().signal,resolveAutomatic:true});
   state=await readToolProfiles();p=state.profiles.find(p=>p.transportModelId===model);
   item.after=modelOnboarding(state,p);item.profile=p;
   if(item.after?.tools!=='Verified'||item.after.status!=='Ready')throw Error('Automatic Agent not ready: '+model);
   item.effective=effortProviderOptions(applyAgentRecommendation(state,p,item.after.context.recommended));
   const eventsBefore=Object.keys(result.events).length;
   await ensureSelectedTools(state,selfHostedSelectionId(p),new AbortController().signal);
   item.cachedNoInference=Object.keys(result.events).length===eventsBefore;
   if(!item.cachedNoInference)throw Error('Repeated verification');
   item.endedAt=Date.now();
 }
 result.ok=true;
}catch(error){result.ok=false;result.error=String(error);result.stack=error?.stack;}
finally{result.endedAt=Date.now();await fetch(${JSON.stringify(reportURL)},{method:'POST',body:JSON.stringify(result)});await invoke('diagnostic_exit');}
`;
let vite,child,timer,log="";
try{
 const build=spawnSync("cargo",["build","--locked","--example","qwen_tool_mismatch","--target-dir","target/codex-test"],{cwd:path.join(root,"src-tauri"),encoding:"utf8",windowsHide:true,timeout:300000});
 await writeFile(path.join(output,"build.log"),(build.stdout??"")+(build.stderr??""));assert.equal(build.status,0,build.stderr);
 vite=await createServer({root,configFile:false,logLevel:"warn",resolve:{alias:{"@":path.join(root,"src")}},server:{host:"127.0.0.1",port:0,watch:null,hmr:false},plugins:[{
  name:'automatic-agent-configuration-fixture',resolveId(id){if(id==='/agent-configuration.js')return '\0agent-configuration.js';},load(id){if(id==='\0agent-configuration.js')return entry;},
  configureServer(vite){vite.middlewares.use('/qwen-tool-mismatch.html',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/qwen-tool-mismatch.html','<!doctype html><html><body><script type="module" src="/agent-configuration.js"></script></body></html>'));});},
 }]});await vite.listen();
 child=spawn(path.join(root,'src-tauri/target/codex-test/debug/examples',`qwen_tool_mismatch${process.platform==='win32'?'.exe':''}`),[],{cwd:root,windowsHide:true,env:{...process.env,CLACK_MISMATCH_ROOT:output,CLACK_MISMATCH_URL:vite.resolvedUrls.local[0]+'qwen-tool-mismatch.html'}});
 child.stdout.on('data',b=>{log=(log+b).slice(-262144);});child.stderr.on('data',b=>{log=(log+b).slice(-262144);});
 await writeFile(path.join(output,'run.json'),JSON.stringify({runId,output,pid:child.pid,head:spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim()},null,2));console.log(JSON.stringify({runId,pid:child.pid,output}));
 const result=await Promise.race([received,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Bounded acceptance deadline')),600000);}),new Promise((_,reject)=>child.once('exit',(c,s)=>reject(Error('Native host exited before report: '+c+'/'+s))))]);
 const requests=(await readFile(path.join(output,'requests.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
 assert(requests.filter(r=>r.body.model===models[0]).length<=3);assert(requests.filter(r=>r.body.model===models[1]).length<=1);
 const responses=[];for(const r of requests){const raw=await readFile(path.join(output,r.requestId+'.response.ndjson'),'utf8');const frames=raw.trim().split('\n').filter(Boolean).map(JSON.parse);responses.push({request:r,rawResponse:raw,sha256:createHash('sha256').update(raw).digest('hex'),calls:frames.flatMap(f=>f.message?.tool_calls??[]),text:frames.map(f=>f.message?.content??'').join(''),final:frames.findLast(f=>f.done)});}
 await writeFile(path.join(output,'responses.json'),JSON.stringify(responses,null,2));
 await writeFile(path.join(output,'metadata-after.json'),JSON.stringify({version:await metadata('/api/version'),tags:await metadata('/api/tags'),ps:await metadata('/api/ps')},null,2));
 console.log(JSON.stringify({ok:result.ok,error:result.error,models:result.models.map(m=>({model:m.model,tools:m.after?.tools,ready:m.after?.status,providerDefault:m.after?.reasoning.providerDefault,configuration:m.after?.reasoning.agentRecommendation?.configuration,effective:m.effective,cachedNoInference:m.cachedNoInference})),requests:responses.map(r=>({model:r.request.body.model,think:r.request.body.think,calls:r.calls.length,finish:r.final?.done_reason,output:r.final?.eval_count}))}));
 assert(result.ok,result.error);
}catch(error){await writeFile(path.join(output,'failure.json'),JSON.stringify({at:Date.now(),error:String(error)},null,2));throw error;}
finally{
 clearTimeout(timer);await writeFile(path.join(output,'native.log'),log);
 if(child?.exitCode===null){await new Promise(resolve=>setTimeout(resolve,1000));if(child.exitCode===null){if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true});else child.kill();}}
 await vite?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
