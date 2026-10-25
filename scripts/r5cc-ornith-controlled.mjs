/** One prospective, bounded Ollama decision-only experiment.
 * Captures the literal body at the production Ollama adapter's fetch boundary
 * BEFORE a single provider invocation. The diagnostic never executes tools.
 * This is not a Clack Agent mission or accepted application test.
 */
import { createServer as viteServer } from "vite";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { streamText, convertToModelMessages, pruneMessages } from "ai";

const repo=fileURLToPath(new URL("../",import.meta.url));
const root=path.join(repo,"src-tauri/target/real-qwen-product/ornith15-r5cc-diagnostic-20261025-01");
const old=path.join(repo,"src-tauri/target/real-qwen-product/ornith15-r5ca-notes-20261025-01");
const endpoint="http://127.0.0.1:11435";
const model="ornith-1.5:35b";
const expectedDigest="9f3b89b2521908dd2e6f7a11fa368e62c8f89e1075f22604e4d1a76dd1240fcc";
const originalNames=["read_file","list_directory","write_file","create_directory","grep","glob","bash_run","bash_background","bash_logs","bash_list","bash_kill","run_subagent","get_terminal_output","open_preview","todo_write","promote_peer_finding","request_peer_task","propose_custom_tool"];
const reducedNames=["list_directory","read_file","write_file","create_directory","bash_run"];
const sha=x=>createHash("sha256").update(x).digest("hex");
const encode=x=>JSON.stringify(x);
const captureFile=path.join(root,"baseline.exact.json");
const metaFile=path.join(root,"capture.meta.json");
const maxBytes=256*1024;
const mode=process.argv[2];
assert(["capture","finalize","audit","A","B","C","D"].includes(mode),"Expected capture/finalize/audit or variant A/B/C/D");
const discover=async()=>{
  const [version,tags]=await Promise.all(["/api/version","/api/tags"].map(async p=>{const r=await fetch(endpoint+p,{signal:AbortSignal.timeout(8000)});assert(r.ok);return r.json()}));
  assert.equal(version.version,"0.40.11");
  assert.equal(tags.models.find(m=>m.name===model)?.digest,expectedDigest);
  return {version:version.version,digest:expectedDigest,modelCount:tags.models.length};
};
const identity=await discover();

if(mode==="audit"){
  const raw=await readFile(captureFile,"utf8");
  const baseline=JSON.parse(raw);
  const meta=JSON.parse(await readFile(metaFile,"utf8"));
  assert.equal(sha(raw),meta.sha256);
  const fields=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const checks={};
  for(const v of ["A","B","C"]){
    const wire=await readFile(path.join(root,`variant-${v}.wire.json`),"utf8");
    const obj=JSON.parse(wire);
    const other=Object.fromEntries(Object.entries(obj).filter(([key])=>!["options","tools"].includes(key)));
    const baseOther=Object.fromEntries(Object.entries(baseline).filter(([key])=>!["options","tools"].includes(key)));
    assert(fields(other,baseOther),`Variant ${v} changed protected request material`);
    assert(fields(Object.fromEntries(Object.entries(obj.options).filter(([k])=>k!=="num_predict")),Object.fromEntries(Object.entries(baseline.options).filter(([k])=>k!=="num_predict"))),`Variant ${v} changed non-output options`);
    assert.equal(obj.options.num_predict,v==="B"?12288:8192);
    assert(fields(obj.tools,v==="C"?baseline.tools.filter(t=>reducedNames.includes(t.function.name)):baseline.tools));
    if(v==="A")assert.equal(wire,raw,"A was not byte-identical");
    checks[v]={sha256:sha(wire),bytes:Buffer.byteLength(wire),sameMessages:fields(obj.messages,baseline.messages),sameThink:fields(obj.think,baseline.think),sameContext:obj.options.num_ctx===baseline.options.num_ctx,sameOtherOptions:true,schemaCount:obj.tools.length,output:obj.options.num_predict};
  }
  const result={baselineSha256:sha(raw),baseBytes:Buffer.byteLength(raw),checks,model:baseline.model,thinkPresent:"think" in baseline,options:baseline.options,context:baseline.options.num_ctx,immutableInputs:"All messages/role/history/system/tool result content identical across A B C",knownUncontrolledFactor:"seed and temperature both omitted, Ollama default sampling can vary between single shots",allToolEffectsIntercepted:true};
  await writeFile(path.join(root,"parity.json"),encode(result),{flag:"wx"});
  console.log(encode(result));
  process.exit(0);
}
if(mode==="finalize"){
  // Recovery ONLY of metadata after adapter fetch intentionally threw
  // AFTER the exact baseline was durably saved. Never call the adapter again.
  const raw=await readFile(captureFile,"utf8");
  const b=JSON.parse(raw);
  assert.equal(b.model,model);
  assert.equal(b.options.num_ctx,32768);
  assert.equal(b.options.num_predict,8192);
  assert.equal(b.tools.length,18);
  assert.deepEqual(b.tools.map(t=>t.function.name),originalNames);
  assert(!("think" in b));
  const vite=await viteServer({root:repo,server:{middlewareMode:true},appType:"custom",logLevel:"error"});
  let cost,budget,larger;
  try{
    const {measureRequest,resolveContextBudget}=await vite.ssrLoadModule("/src/modules/ai/lib/contextBudget.ts");
    cost=measureRequest(b);
    const limits={runtimeTarget:32768,reported:73728,outputReserve:8192};
    budget=resolveContextBudget(limits,cost,8192);
    larger=resolveContextBudget({...limits,outputReserve:12288},cost,12288);
    assert(budget.fits&&larger.fits,"Captured complete request cannot fit at original 32768 under output reserves");
  }finally{await vite.close()}
  const meta={identity,source:"production stable system + real production tool factories and permission decisions + SDK streamText + production Ollama model adapter intercepted at fetch BEFORE inference",qualification:"Standalone diagnostic coding continuation; NOT a Clack runAgentStream acceptance/mission.",captureByteCount:Buffer.byteLength(raw),sha256:sha(raw),context:32768,output:8192,reasoning:"Automatic: think omitted",inputEstimate:cost,baselineSafeBudget:budget,largerSafeBudget:larger,sourceUserBytes:Buffer.byteLength(b.messages[1].content),retainedToolResults:b.messages.filter(m=>m.role==="tool").map(m=>m.tool_name),toolNames:originalNames,unsafeEffectsExecuted:0,captureError:"Deliberate fetch sentinel caused SDK error followed by local assertion failure after payload was already written; zero HTTP provider inference"};
  await writeFile(metaFile,encode(meta),{flag:"wx"});
  console.log(encode({stage:"finalized-original-capture",...meta}));
  process.exit(0);
}
if(mode==="capture"){
  await mkdir(root,{recursive:false});
  const vite=await viteServer({root:repo,ssr:{noExternal:["@xterm/xterm"]},server:{middlewareMode:true},appType:"custom",logLevel:"error"});
  try {
    const [{createOllamaModel},{buildStableSystem},{BUILTIN_AGENTS},{serializedToolSchemas},{resolveCurrentAgentPermission},{usePreferencesStore},{measureRequest,resolveContextBudget},{minimumSafeContext}]=await Promise.all([
      "/src/modules/ai/lib/ollamaModel.ts","/src/modules/ai/lib/agent.ts","/src/modules/ai/lib/agents.ts","/src/modules/ai/lib/requestPreflight.ts","/src/modules/ai/lib/permissions.ts","/src/modules/settings/preferences.ts","/src/modules/ai/lib/contextBudget.ts","/src/modules/ai/lib/minimumSafeContext.ts"
    ].map(s=>vite.ssrLoadModule(s)));
    // Do not hydrate or change the actual user's preferences or provider profiles.
    usePreferencesStore.setState({agentPermissionProfiles:{"builtin:coder":{mode:"trusted-workspace",categories:{}}}});
    const ctx={getCwd:()=>root,getWorkspaceRoot:()=>root,getWorkspaceId:()=> "local:"+root,getSessionId:()=> "r5cc-prospective",getAgentId:()=> "builtin:coder",getTerminalContext:()=>null,isActiveTerminalPrivate:()=>false,injectIntoActivePty:()=>false,openPreview:()=>false,spawnAgent:()=>null,readAgentOutput:()=>null,readCache:new Map()};
    const factories=[["fs","buildFsTools"],["edit","buildEditTools"],["search","buildSearchTools"],["shell","buildShellTools"],["subagent","buildSubagentTools"],["terminal","buildTerminalTools"],["todo","buildTodoTools"],["evidence","buildEvidenceTools"],["agent","buildManagedAgentTools"],["peer","buildPeerTaskTools"],["custom","buildCustomToolProposals"]];
    const possible={};
    for(const [mod,fun] of factories){const m=await vite.ssrLoadModule("/src/modules/ai/tools/"+mod+".ts");Object.assign(possible,m[fun](ctx))}
    const authorized={};
    for(const name of originalNames){
      assert(possible[name],`Missing real production ${name}`);
      const decision=resolveCurrentAgentPermission(name,{},ctx);
      assert.notEqual(decision.outcome,"deny",`Tool permission denied ${name}`);
      authorized[name]=possible[name];
    }
    const serial=await serializedToolSchemas(authorized);
    assert.deepEqual(serial.map(s=>s.function.name),originalNames);
    const sessions=JSON.parse(await readFile(path.join(old,"data/terax-ai-sessions.json"),"utf8"));
    const source=sessions["messages:real-mission-a"];
    assert(source?.length===2 && source[0].role==="user" && source[1].role==="assistant");
    // Synthetic early-stage continuation: original task and its two completed
    // initial native-tool outputs. Never reproduce later failed reasoning.
    const past=source[1].parts;
    const second= past.findIndex((p,i)=>i>0&&p.type==="step-start");
    assert(second>0);
    const ui=[{id:"r5cc-request",role:"user",parts:source[0].parts.filter(p=>p.type==="text")},{id:"r5cc-prior",role:"assistant",parts:past.slice(0,second)}];
    const history=pruneMessages({messages:await convertToModelMessages(ui),reasoning:"before-last-message",emptyMessages:"remove"});
    const persona=BUILTIN_AGENTS.find(x=>x.id==="builtin:coder");
    const system=buildStableSystem(model,persona,undefined,null);
    const messages=[{role:"system",content:system},...history];
    const cost=measureRequest({messages,tools:serial});
    const trustedTiers=[4096,8192,16384,32768,49152,65536,73728];
    // Use Clack's actual minimum-safe selection algorithm on a complete request,
    // with the same trusted ladder previously qualified for this digest.
    const limits={runtimeTarget:73728,deployed:73728,reported:73728,outputReserve:8192};
    const context=minimumSafeContext(limits,cost,8192,trustedTiers);
    assert(context && context>=32768 && context<=73728,"Complete budget did not fit a qualified tier");
    const future=resolveContextBudget({...limits,runtimeTarget:context,deployed:undefined,outputReserve:12288},cost,12288);
    assert(future.fits && future.output===12288,"Larger reserve does not fit unchanged context");
    let captured;
    const captureFetch=async(url,opts)=>{
      assert.equal(url,endpoint+"/api/chat");
      assert.equal(opts.method,"POST");
      const raw=opts.body;
      assert.equal(typeof raw,"string");
      assert(Buffer.byteLength(raw)<maxBytes);
      const body=JSON.parse(raw);
      assert.equal(body.options.num_ctx,context);
      assert.equal(body.options.num_predict,8192);
      assert.equal(body.think,undefined);
      assert.equal(body.tools.length,18);
      captured=raw;
      await writeFile(captureFile,raw,{flag:"wx"});
      // Stop before HTTP inference: the adapter handed the exact provider
      // payload to its fetch boundary, but no request was made.
      throw new Error("R5CC_CAPTURE_BEFORE_INFERENCE");
    };
    const adapter=createOllamaModel({modelId:model,baseURL:endpoint,fetch:captureFetch});
    const request=streamText({model:adapter,messages,tools:authorized,maxOutputTokens:8192,maxRetries:0,providerOptions:{ollama:{numCtx:context}}});
    let error;
    try{await request.finishReason}catch(e){error=String(e)}
    // SDK versions may deliver fetch errors through stream callbacks rather
    // than the finishReason promise; the decisive invariant is that captureFetch
    // wrote the body and always threw before making a network request.
    assert(captured && Buffer.byteLength(captured)>0,"Adapter was not intercepted");
    const baseline=JSON.parse(captured);
    assert.equal(baseline.messages[0].role,"system");
    assert.equal(baseline.tools.length,18);
    const meta={identity,source:"production stable system + production tool factories and permission decision + AI SDK streamText + production Ollama model adapter fetch boundary",qualification:"This captures actual adapter bytes; a new standalone diagnostic request, not a real persisted Agent mission.",captureByteCount:Buffer.byteLength(captured),sha256:sha(captured),context,output:8192,reasoning:"Automatic: think field omitted",inputEstimate:cost,baselineSafeBudget:resolveContextBudget({...limits,runtimeTarget:context,deployed:undefined},cost,8192),largerSafeBudget:future,sourceUserBytes:Buffer.byteLength(source[0].parts[0].text),retainedToolResults:ui[1].parts.filter(p=>p.type.startsWith("tool-")).map(p=>p.type),toolNames:originalNames,unsafeEffectsExecuted:0};
    await writeFile(metaFile,encode(meta),{flag:"wx"});
    console.log(encode({stage:"captured",...meta}));
  }finally{await vite.close()}
  process.exit(0);
}
// Variants are created from this exact captured string, never regenerated from
// later source or transformed via a model/SDK round trip.
const baseline=await readFile(captureFile,"utf8");
const meta=JSON.parse(await readFile(metaFile,"utf8"));
assert.equal(sha(baseline),meta.sha256,"Captured baseline changed");
const original=JSON.parse(baseline);
assert.deepEqual(original.tools.map(x=>x.function.name),originalNames);
assert.equal(original.model,model);
assert.equal(original.options.num_predict,8192);
assert.equal(original.options.num_ctx,meta.context);
assert(!("think" in original));
const output=(mode==="B"||mode==="D")?12288:8192;
const names=(mode==="C"||mode==="D")?reducedNames:originalNames;
if(mode==="D"){
  const prior=JSON.parse(await readFile(path.join(root,"comparisons.json"),"utf8"));
  assert(prior.A?.completed && prior.A?.transportError===null && prior.B?.completed && prior.C?.completed,"D requires complete observable baseline A");
  const improvement=(x)=>x.firstToolElapsedMs!==null && (prior.A.firstToolElapsedMs===null || x.firstToolElapsedMs<prior.A.firstToolElapsedMs*0.75);
  assert(improvement(prior.B)||improvement(prior.C),"D prohibited: neither B nor C meaningfully improved time to native tool");
}
const copy=JSON.parse(baseline);
copy.options.num_predict=output;
copy.tools=original.tools.filter(x=>names.includes(x.function.name));
assert.deepEqual(copy.tools.map(x=>x.function.name),names.filter(n=>original.tools.some(x=>x.function.name===n)).length===names.length ? original.tools.filter(x=>names.includes(x.function.name)).map(x=>x.function.name):[]);
assert.deepEqual(copy.messages,original.messages,"Variant message changed");
assert.equal(copy.model,original.model);
assert.equal(copy.options.num_ctx,original.options.num_ctx);
assert(Object.keys(copy.options).every(k=>k==="num_predict"||copy.options[k]===original.options[k]));
assert.equal(copy.think,original.think);
const {measureRequest,resolveContextBudget}=await (async()=>{
  const vite=await viteServer({root:repo,server:{middlewareMode:true},appType:"custom",logLevel:"error"});
  try{return await vite.ssrLoadModule("/src/modules/ai/lib/contextBudget.ts")}finally{await vite.close()}
})();
const budget=resolveContextBudget({runtimeTarget:meta.context,reported:73728,outputReserve:output},measureRequest(copy),output);
assert(budget.fits && budget.output===output,`Variant ${mode} complete request fails context admission`);
const payload=mode==="A"?baseline:encode(copy);
const payloadHash=sha(payload);
await writeFile(path.join(root,`variant-${mode}.wire.json`),payload,{flag:"wx"});
const started=Date.now();
const outputCounters={input:null,generated:null,reasoningChars:0,textChars:0,firstTool:null,firstToolElapsedMs:null,toolCalls:[],firstOutputMs:null,largestGapMs:0,lastBytesAt:null,finishReason:null,completed:false,transportError:null};
const controller=new AbortController();
const watchdog=setTimeout(()=>controller.abort(),580000);
try{
  const response=await fetch(endpoint+"/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:payload,signal:controller.signal});
  if(!response.ok)throw Error(`Ollama HTTP ${response.status}: ${(await response.text()).slice(0,2000)}`);
  const reader=response.body.getReader();
  const decoder=new TextDecoder();let pending="";
  const onFrame=(frame)=>{
    if(frame.error)throw Error(frame.error);
    const t=Date.now();
    if(outputCounters.firstOutputMs===null)outputCounters.firstOutputMs=t-started;
    if(frame.message?.thinking)outputCounters.reasoningChars+=frame.message.thinking.length;
    if(frame.message?.content)outputCounters.textChars+=frame.message.content.length;
    for(const call of frame.message?.tool_calls??[]){
      const record={name:call.function?.name??"",argumentsAreObject:call.function?.arguments!==null&&typeof call.function?.arguments==="object"&&!Array.isArray(call.function?.arguments)};
      outputCounters.toolCalls.push(record);
      if(outputCounters.firstTool===null){outputCounters.firstTool=record.name;outputCounters.firstToolElapsedMs=t-started}
    }
    if(frame.done){
      outputCounters.completed=true; outputCounters.input=frame.prompt_eval_count??null;outputCounters.generated=frame.eval_count??null;outputCounters.finishReason=frame.done_reason??null;
    }
  };
  while(true){
    const {value,done}=await reader.read();
    if(done)break;
    const t=Date.now();
    if(outputCounters.lastBytesAt!==null)outputCounters.largestGapMs=Math.max(outputCounters.largestGapMs,t-outputCounters.lastBytesAt);
    outputCounters.lastBytesAt=t;
    pending+=decoder.decode(value,{stream:true});
    if(pending.length>2e6)throw Error("Oversized provider frame");
    let line;
    while((line=pending.indexOf("\n"))>=0){const part=pending.slice(0,line);pending=pending.slice(line+1);if(part.trim())onFrame(JSON.parse(part))}
  }
  if(pending.trim())onFrame(JSON.parse(pending));
}catch(e){outputCounters.transportError=String(e)}finally{clearTimeout(watchdog)}
const result={variant:mode,capturedBaselineSha256:meta.sha256,payloadSha256:payloadHash,diff:{outputFrom:8192,outputTo:output,toolsFrom:18,toolsTo:copy.tools.length},context:copy.options.num_ctx,budget,elapsedMs:Date.now()-started,...outputCounters,reasoningTokenUsageAvailable:false,reasoningTokenAccounting:"Ollama provides eval_count but no separate reasoning token count; reasoningChars approximate",allowanceExhausted:outputCounters.generated===output,allToolEffectsIntercepted:true,identity};
// Each result written once. There is no backdoor to execute returned tools.
await writeFile(path.join(root,`result-${mode}.json`),encode(result),{flag:"wx"});
let comparisons={};try{comparisons=JSON.parse(await readFile(path.join(root,"comparisons.json"),"utf8"))}catch{}
assert(!comparisons[mode],"Variant may not be replayed");
comparisons[mode]=result;
await writeFile(path.join(root,"comparisons.json"),encode(comparisons));
console.log(encode(result));
if(outputCounters.transportError||!outputCounters.completed)process.exitCode=1;
