import assert from "node:assert/strict";
import path from "node:path";
import {mkdir,readFile,writeFile,readdir} from "node:fs/promises";
import {spawn,spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {createServer as httpServer} from "node:http";
import {createServer} from "vite";
assert.equal(process.env.CLACK_QWEN_MISMATCH_LIVE,"1","Explicit diagnostic authorization required");
const phase=process.argv[2];assert(["a","b","a-repeat","b-repeat","d-system"].includes(phase));
const root=process.cwd(),base=path.join(root,"src-tauri/target/qwen-tool-mismatch"),endpoint="http://127.0.0.1:11435",model="qwen3-coder:30b";
let existing=0;for(const dir of await readdir(base,{withFileTypes:true}))if(dir.isDirectory()&&dir.name.startsWith("qwen-tool-mismatch-")){
 try{existing+=(await readFile(path.join(base,dir.name,"requests.jsonl"),"utf8")).trim().split("\n").filter(Boolean).length;}catch(e){if(e.code!=="ENOENT")throw e;}
}assert(existing<4,"Four-request campaign bound reached");
const priorRequests=(await readFile(path.join(root,"src-tauri/target/tool-verification/tool-verification-2026-10-20T23-05-47-057Z/requests.jsonl"),"utf8")).trim().split("\n").map(JSON.parse);
const expected=structuredClone(priorRequests.find(r=>r.body.model===model).body);
if(phase.startsWith("b"))expected.think=false;
if(phase==="d-system")expected.messages.unshift({role:"system",content:"You are a tool-using assistant. Follow the user's tool request."});
const runId=`qwen-tool-mismatch-${phase}-${new Date().toISOString().replaceAll(/[:.]/g,"-")}`,output=path.join(base,runId);
await mkdir(output);await writeFile(path.join(output,"expected.json"),JSON.stringify(expected));
async function metadata(route,body){const response=await fetch(endpoint+route,{method:body?"POST":"GET",headers:body?{"Content-Type":"application/json"}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});assert(response.ok);return response.json();}
const before={at:Date.now(),version:await metadata("/api/version"),tags:await metadata("/api/tags"),show:await metadata("/api/show",{model}),ps:await metadata("/api/ps")};
const historical=JSON.parse(await readFile(path.join(root,"src-tauri/target/real-qwen-product/tool-protocol-20261018/coder-metadata.json"),"utf8"));
const digest=before.tags.models.find(m=>m.name===model)?.digest;assert.equal(digest,historical.installed.digest,"Historical and current revisions differ; no inference authorized by this fixture");
await writeFile(path.join(output,"metadata-before.json"),JSON.stringify(before,null,2));
let finish;const report=new Promise(resolve=>{finish=resolve;});
const server=httpServer(async(req,res)=>{
 if(req.method!=="POST"||req.url!=="/report"){res.writeHead(404).end();return;}
 let body="";for await(const b of req){body+=b;if(body.length>1024*1024){res.writeHead(413).end();return;}}
 const result=JSON.parse(body);await writeFile(path.join(output,"report.json"),JSON.stringify(result,null,2));
 for(const [id,events]of Object.entries(result.events??{})){const bytes=events.filter(e=>e.kind==="chunk").flatMap(e=>e.bytes);await writeFile(path.join(output,`${id}.response.ndjson`),Buffer.from(bytes));}
 res.setHeader("Access-Control-Allow-Origin","*");res.end("ok");finish(result);
});await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const reportURL=`http://127.0.0.1:${server.address().port}/report`;
const entry=`
import {Channel,invoke} from "@tauri-apps/api/core";
import {streamText} from "ai";
import {createSelfHostedEndpoint,addSelfHostedEndpoint} from "/src/modules/ai/lib/selfHostedProfiles.ts";
import {createSelfHostedProbeClient} from "/src/modules/ai/lib/selfHostedProbe.ts";
import {verifyModelTools,readToolProfiles,canonicalProbeTools} from "/src/modules/ai/lib/toolVerificationRuntime.ts";
import {TOOL_PROBE_PROMPT} from "/src/modules/ai/lib/toolVerificationSchema.ts";
import {buildLanguageModel} from "/src/modules/ai/lib/agent.ts";
import {EMPTY_PROVIDER_KEYS} from "/src/modules/ai/lib/keyring.ts";
import {selfHostedSelectionId,selfHostedTransportIdentity} from "/src/modules/ai/lib/selfHostedModels.ts";
import {captureEffort,effortProviderOptions} from "/src/modules/ai/lib/reasoningEffort.ts";
import {endpointInferenceAdmission} from "/src/modules/ai/lib/inferenceAdmission.ts";
import {modelOnboarding} from "/src/modules/ai/lib/modelOnboarding.ts";
import {cancelSessionInference} from "/src/modules/ai/lib/inferenceLifecycle.ts";
import {updateSelfHostedProfiles} from "/src/modules/settings/store.ts";
const result={phase:${JSON.stringify(phase)},runId:${JSON.stringify(runId)},events:{},cloudInference:0,toolExecutions:0,startedAt:Date.now()};
const descriptor=Object.getOwnPropertyDescriptor(Channel.prototype,"onmessage");let captured=0;
Object.defineProperty(Channel.prototype,"onmessage",{...descriptor,set(previous){descriptor.set.call(this,event=>{
 if(typeof event?.requestId==='string'&&event.requestId.startsWith('inference-')){
  captured+=event.bytes?.length??0;if(captured>131072)throw new Error('Diagnostic response bound');
  (result.events[event.requestId]??=[]).push({...event,at:Date.now()});
 }previous.call(this,event);
});}});
try{
 const endpoint=createSelfHostedEndpoint({alias:'Qwen bounded diagnostic',baseURL:${JSON.stringify(endpoint)},backendHint:'ollama',allowPrivateNetwork:true},'qwen-mismatch');
 await updateSelfHostedProfiles(s=>addSelfHostedEndpoint(s,endpoint));
 await createSelfHostedProbeClient().refresh({endpointId:endpoint.id,selectedModelId:${JSON.stringify(model)},allowPrivateNetwork:true});
 let state=await readToolProfiles(),p=state.profiles.find(p=>p.transportModelId===${JSON.stringify(model)});
 if(p.modelRevision!==${JSON.stringify(digest)})throw new Error('Digest changed before probe');
 result.before=modelOnboarding(state,p);result.digest=p.modelRevision;
 if(Object.values(canonicalProbeTools()).some(t=>t.execute))throw new Error('Executable probe');
 if(${JSON.stringify(phase)}==='a'||${JSON.stringify(phase)}==='a-repeat')result.verdict=await verifyModelTools({state,profileId:p.id,force:true,signal:new AbortController().signal});
 else{
  const selection=selfHostedSelectionId(p),identity=selfHostedTransportIdentity(selection,state);
  const automatic=captureEffort(selection,identity,undefined,state);
  const reasoning=${JSON.stringify(phase)}.startsWith('b')?captureEffort(selection,identity,{version:1,choices:[{key:automatic.key,choice:'none',revision:automatic.capability.revision}]},state):automatic;
  if(${JSON.stringify(phase)}.startsWith('b')&&reasoning.choice!=='none')throw new Error('None unavailable');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000),sessionId='diagnostic-'+crypto.randomUUID();
  try{
   const model=await buildLanguageModel('ollama',EMPTY_PROVIDER_KEYS,p.transportModelId,{selfHosted:true,selfHostedInference:state,toolVerification:true,reasoning,
    ollamaBaseURL:endpoint.baseURL,allowPrivateNetwork:true,admission:endpointInferenceAdmission(endpoint.id,p.id,state),
    inferenceScope:{sessionId,runId:sessionId,isCurrent:()=>!controller.signal.aborted},calibration:{requestClass:'optimization',record:()=>{}}});
   const response=streamText({model,prompt:TOOL_PROBE_PROMPT,system:${JSON.stringify(phase==='d-system'?expected.messages[0].content:null)}??undefined,tools:canonicalProbeTools(),maxOutputTokens:512,maxRetries:0,abortSignal:controller.signal,providerOptions:effortProviderOptions(reasoning)});
   await response.consumeStream({onError:error=>{throw error;}});
   result.sdk={text:await response.text,calls:await response.toolCalls,results:await response.toolResults,finish:await response.finishReason,usage:await response.usage,reasoning};
  }finally{clearTimeout(timer);await cancelSessionInference(sessionId);}
 }
 state=await readToolProfiles();p=state.profiles.find(p=>p.transportModelId===${JSON.stringify(model)});
 if(p.modelRevision!==result.digest)throw new Error('Digest changed after probe');
 result.after=modelOnboarding(state,p);result.ok=true;
}catch(error){result.ok=false;result.error=String(error);result.stack=error?.stack;}
finally{result.endedAt=Date.now();await fetch(${JSON.stringify(reportURL)},{method:'POST',body:JSON.stringify(result)});await invoke('diagnostic_exit');}
`;
let vite,child,log="",timer;
try{
 const build=spawnSync("cargo",["build","--locked","--example","qwen_tool_mismatch","--target-dir","target/codex-test"],{cwd:path.join(root,"src-tauri"),windowsHide:true,encoding:"utf8",timeout:300000});
 await writeFile(path.join(output,"build.log"),`${build.stdout??""}${build.stderr??""}`);assert.equal(build.status,0,build.stderr);
 vite=await createServer({root,configFile:false,logLevel:"warn",resolve:{alias:{"@":path.join(root,"src")}},server:{host:"127.0.0.1",port:0,watch:null,hmr:false},plugins:[{name:"qwen-mismatch-diagnostic",
  resolveId(source){if(source==="/qwen-mismatch-entry.js")return "\0qwen-mismatch-entry.js";},load(id){if(id==="\0qwen-mismatch-entry.js")return entry;},
  configureServer(vite){vite.middlewares.use('/qwen-tool-mismatch.html',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/qwen-tool-mismatch.html',`<!doctype html><html><body><script type="module" src="/qwen-mismatch-entry.js"></script></body></html>`));});}
 }]});await vite.listen();
 child=spawn(path.join(root,'src-tauri/target/codex-test/debug/examples',`qwen_tool_mismatch${process.platform==='win32'?'.exe':''}`),[],{cwd:root,windowsHide:true,env:{...process.env,CLACK_MISMATCH_ROOT:output,CLACK_MISMATCH_URL:`${vite.resolvedUrls.local[0]}qwen-tool-mismatch.html`}});
 child.stdout.on('data',b=>{log=(log+b).slice(-262144);});child.stderr.on('data',b=>{log=(log+b).slice(-262144);});
 await writeFile(path.join(output,'run.json'),JSON.stringify({runId,phase,output,pid:child.pid,head:spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim()},null,2));console.log(JSON.stringify({runId,phase,output,pid:child.pid}));
 const result=await Promise.race([report,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('4-minute diagnostic harness bound')),240000);}),new Promise((_,reject)=>child.once('exit',(code,signal)=>reject(new Error(`Host exit before report ${code}/${signal}`))))]);assert(result.ok,result.error);
 const requests=(await readFile(path.join(output,'requests.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(requests.length,1);assert.deepEqual(requests[0].body,expected);
 const bytes=await readFile(path.join(output,requests[0].requestId+'.response.ndjson'));const frames=bytes.toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
 const summary={runId,phase,digest,bodiesEqual:true,sha256:createHash('sha256').update(bytes).digest('hex'),text:frames.map(f=>f.message?.content??'').join(''),calls:frames.flatMap(f=>f.message?.tool_calls??[]),final:frames.findLast(f=>f.done),verdict:result.verdict,sdk:result.sdk};
 await writeFile(path.join(output,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
 await writeFile(path.join(output,'metadata-after.json'),JSON.stringify({version:await metadata('/api/version'),tags:await metadata('/api/tags'),ps:await metadata('/api/ps')},null,2));
}catch(error){await writeFile(path.join(output,'failure.json'),JSON.stringify({error:String(error),at:Date.now()},null,2));throw error;}
finally{
 clearTimeout(timer);await writeFile(path.join(output,'native.log'),log);
 if(child?.exitCode===null){await new Promise(resolve=>setTimeout(resolve,1000));if(child.exitCode===null){if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true});else child.kill();}}
 await vite?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
