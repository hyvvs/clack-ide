// Read-only final per-request transport and genuine-tool summary from the
// exact, frozen one-shot Muse evidence. Does not invoke any model or Agent.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const repo=fileURLToPath(new URL("../",import.meta.url));
const root=path.join(repo,"src-tauri/target/real-qwen-product/museglimmer-r5da-notes-20261025-01");
const rows=async name=>(await readFile(path.join(root,name),"utf8")).trim().split(/\r?\n/).map(line=>JSON.parse(line));
const requests=await rows("mission-a-1.requests.jsonl");
const receives=await rows("mission-a-1.receive.jsonl");
const events=await rows("mission-a-1.jsonl");
assert.equal(receives.length,requests.length);
const summaries=[];
for(const item of receives){
  const ips=item.events.filter(e=>e.kind==="ipc-forwarded");
  let longest={gapMs:0,from:null,to:null};
  for(let i=1;i<ips.length;i++){
    const gapMs=ips[i].at-ips[i-1].at;
    if(gapMs>longest.gapMs)longest={gapMs,from:ips[i-1].at,to:ips[i].at};
  }
  summaries.push({requestId:item.requestId,ipcEventsRecorded:ips.length,droppedEvents:item.droppedEvents,
    bodyChunks:item.bodyChunks,bodyBytes:item.bodyBytes,lastBodyAt:item.lastBody?.at,
    lastForwardedAt:item.lastForwarded?.at,success:item.events.some(e=>e.kind==="provider-done")&&
    item.events.some(e=>e.kind==="completed"),timeouts:item.events.filter(e=>e.kind.includes("deadline")||e.kind==="cancelled").map(e=>e.kind),longest});
}
const longest=summaries.filter(x=>x.ipcEventsRecorded>1).sort((a,b)=>b.longest.gapMs-a.longest.gapMs);
const authentic=events.findLast(x=>x.kind==="agent-native-tool-summary")?.toolSummary;
const agent=requests.filter(x=>x.toolSchemas===18&&x.numPredict===8192);
const verifications=requests.filter(x=>x.toolSchemas===1);
const contexts=agent.reduce((acc,r)=>{const last=acc.at(-1);if(last?.numCtx===r.numCtx){last.count++}else{acc.push({numCtx:r.numCtx,count:1})}return acc},[]);
const source=JSON.parse(await readFile(path.join(root,"frozen-source-manifest.json"),"utf8"));
const evalReport=JSON.parse(await readFile(path.join(root,"independent-notes-check.json"),"utf8"));
const native=JSON.parse(await readFile(path.join(root,"mission-a-1.json"),"utf8"));
const out={requestCount:requests.length,agentRequestCount:agent.length,contexts,agentNumPredict:[...new Set(agent.map(x=>x.numPredict))],
  verifierContexts:verifications.map(x=>x.numCtx),timeoutOrCancellation:summaries.filter(x=>x.timeouts.length),
  nativeComplete:summaries.filter(x=>x.success).length,traceEventsDropped:summaries.reduce((sum,x)=>sum+x.droppedEvents,0),
  longestObservedIpcGaps:longest.slice(0,8),gapsOver60Seconds:longest.filter(x=>x.longest.gapMs>60000),
  authenticAgentTools:authentic??null,frozenFiles:Object.keys(source),frozenEvaluationPass:evalReport.passed,
  sourceUntouched:evalReport.sourceUntouched,nativeEndAt:native.endedAt};
await writeFile(path.join(root,"native-request-trace-summary.json"),JSON.stringify(out,null,2),{flag:"wx"});
console.log(JSON.stringify(out,null,2));
