/** Read-only Ornith prompt/tool composition audit. Never invokes an exposed tool or the provider. */
import { createServer as createViteServer } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const repo=fileURLToPath(new URL('../',import.meta.url));
const root=path.join(repo,'src-tauri/target/real-qwen-product/ornith15-r5ca-notes-20261025-01');
const state=JSON.parse(await readFile(path.join(root,'data/terax-ai-sessions.json'),'utf8'));
const settings=JSON.parse(await readFile(path.join(root,'data/terax-settings.json'),'utf8'));
const original=state['messages:real-mission-a'];
const exactNames=JSON.parse((await readFile(path.join(root,'mission-a-1.requests.jsonl'),'utf8')).trim().split(/\r?\n/).at(-1)).toolNames;
const vite=await createViteServer({root:repo,ssr:{noExternal:['@xterm/xterm']},server:{middlewareMode:true},appType:'custom',logLevel:'error'});
try{
const [{buildTools},{serializedToolSchemas},{buildStableSystem},{BUILTIN_AGENTS},{measureRequest},{convertToModelMessages,pruneMessages},{CORE_SYSTEM_PROMPT,DEFAULT_CLACK_BEHAVIOR},{estimateTextTokens}]=await Promise.all([
'/src/modules/ai/tools/tools.ts','/src/modules/ai/lib/requestPreflight.ts','/src/modules/ai/lib/agent.ts','/src/modules/ai/lib/agents.ts','/src/modules/ai/lib/contextBudget.ts','ai','/src/modules/ai/config.ts','/src/modules/ai/lib/contextBudget.ts'].map(async s=>s==='ai'?import('ai'):vite.ssrLoadModule(s)));
const ctx={getCwd:()=>path.join(root,'workspace'),getWorkspaceRoot:()=>path.join(root,'workspace'),getWorkspaceId:()=> 'local:notes-acceptance',getSessionId:()=> 'real-mission-a',getAgentId:()=> 'builtin:coder',getTerminalContext:()=>null,isActiveTerminalPrivate:()=>false,injectIntoActivePty:()=>false,openPreview:()=>false,spawnAgent:()=>null,readAgentOutput:()=>null,readCache:new Map()};
const factories=[['fs','buildFsTools'],['edit','buildEditTools'],['search','buildSearchTools'],['shell','buildShellTools'],['subagent','buildSubagentTools'],['terminal','buildTerminalTools'],['todo','buildTodoTools'],['evidence','buildEvidenceTools'],['agent','buildManagedAgentTools'],['peer','buildPeerTaskTools'],['custom','buildCustomToolProposals']];
const candidates={};for(const [mod,name] of factories){const loaded=await vite.ssrLoadModule('/src/modules/ai/tools/'+mod+'.ts');Object.assign(candidates,loaded[name](ctx));}
const raw=Object.fromEntries(Object.entries(candidates).filter(([key])=>exactNames.includes(key)));
const schemas=await serializedToolSchemas(raw);
const sorted=exactNames.map(n=>schemas.find(s=>s.function.name===n));
if(sorted.some(x=>!x))throw new Error('Missing tools: '+exactNames.filter(n=>!schemas.find(s=>s.function.name===n)).join(','));
const persona=BUILTIN_AGENTS.find(x=>x.id==='builtin:coder');
const prefs=settings.preferences??{};
const stable=buildStableSystem('ornith-1.5:35b',persona,prefs.customInstructions??null,null);
const items=original.map(m=>({id:m.id,role:m.role,parts:m.parts}));
let hist;
try {hist=pruneMessages({messages:await convertToModelMessages(items),reasoning:'before-last-message',emptyMessages:'remove'});}
catch(err){hist={error:String(err)};}
// Do NOT count the 30 KB of second-step reasoning as input to inference-11.
// This slice is a post-run UI approximation, NOT the SDK's lost stepMessages.
const stepStarts=items[1].parts.flatMap((p,i)=>p.type==='step-start'?[i]:[]);
const beforeSecond=items.map((m,i)=>i===1?{...m,parts:m.parts.slice(0,stepStarts[1]??m.parts.length)}:m);
let beforeSecondModel;
try {beforeSecondModel=pruneMessages({messages:await convertToModelMessages(beforeSecond),reasoning:'before-last-message',emptyMessages:'remove'});}
catch(err){beforeSecondModel={error:String(err)};}
const userBody=items[0].parts.find(p=>p.type==='text')?.text??'';
const environmentEnd=userBody.indexOf('</env>');
const previousTools=beforeSecond[1].parts.filter(p=>p.type.startsWith('tool-'));
const token= x=>{try{return measureRequest({messages:[{role:'system',content:x}]}).system}catch{return null}};
const bytes=x=>Buffer.byteLength(JSON.stringify(x));
const tools=sorted.map(s=>({name:s.function.name,bytes:bytes(s),estimatedTokens:measureRequest({tools:[s]}).tools,descriptionBytes:Buffer.byteLength(s.function.description??''),schemaBytes:bytes(s.function.parameters)}));
const p={source:'Derived from retained UI state + current buildTools; NOT captured full inference-11 request',reportVersion:1,context:32768,num_predict:8192,think:'omitted',core:{bytes:Buffer.byteLength(CORE_SYSTEM_PROMPT),estimatedTokens:token(CORE_SYSTEM_PROMPT)},default:{bytes:Buffer.byteLength(DEFAULT_CLACK_BEHAVIOR),estimatedTokens:token(DEFAULT_CLACK_BEHAVIOR)},coder:{bytes:Buffer.byteLength(persona.instructions),estimatedTokens:token(persona.instructions)},system:{bytes:Buffer.byteLength(stable),estimatedTokens:token(stable)},toolSet:{bytes:bytes(sorted),estimatedTokens:measureRequest({tools:sorted}).tools,perTool:tools},preSecond:{userTextBytes:Buffer.byteLength(userBody),environmentPrefixBytes:environmentEnd>=0?Buffer.byteLength(userBody.slice(0,environmentEnd+6)):null,missionTextBytes:environmentEnd>=0?Buffer.byteLength(userBody.slice(environmentEnd+6)):Buffer.byteLength(userBody),priorToolCount:previousTools.length,toolResultJsonBytes:previousTools.reduce((sum,p)=>sum+bytes({type:p.type,input:p.input,output:p.output}),0),assistantPreviousTextBytes:beforeSecond[1].parts.filter(p=>p.type==='text').reduce((sum,p)=>sum+Buffer.byteLength(p.text??''),0),priorReasoningBytes:beforeSecond[1].parts.filter(p=>p.type==='reasoning').reduce((sum,p)=>sum+Buffer.byteLength(p.text??''),0),modelHistoryEstimatedTokens:Array.isArray(beforeSecondModel)?measureRequest({messages:beforeSecondModel}).conversation:null,modelHistorySerializedBytes:Array.isArray(beforeSecondModel)?bytes(beforeSecondModel):null,historyConversionError:beforeSecondModel.error??null},savedUI:{messageCount:items.length,partKinds:items.map(m=>({role:m.role,parts:m.parts.map(p=>({type:p.type,state:p.state??null,bytes:p.type==='text'||p.type==='reasoning'?Buffer.byteLength(p.text??''):bytes({type:p.type,input:p.input,output:p.output})}))})),messageApproxBytes:bytes(items)},historyConversion:{error:hist.error??null,estimatedTokens:Array.isArray(hist)?measureRequest({messages:hist}).conversation:null,serializedBytes:Array.isArray(hist)?bytes(hist):null,warning:'AFTER failure: contains second-step generated reasoning; DO NOT treat as request-11 input'},settingsKeys:Object.keys(settings),customInstructionsPresent:!!prefs.customInstructions,modelWireToolNames:exactNames,sourceToolNames:Object.keys(candidates)};
await writeFile(path.join(root,'ergonomics-readonly-metrics.json'),JSON.stringify(p,null,2),{flag:'wx'});
console.log(JSON.stringify(p,null,2));
}finally{await vite.close()}
