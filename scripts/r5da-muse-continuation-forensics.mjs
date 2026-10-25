// Read-only, exact-evidence reconstruction of Muse's terminal 30-second
// in-memory runtime freshness guard. No provider call, no tool invocation,
// no application modifications, and no production runtime changes.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import path from "node:path";
import assert from "node:assert/strict";

const repo=fileURLToPath(new URL("../",import.meta.url));
const root=path.join(repo,"src-tauri/target/real-qwen-product/museglimmer-r5da-notes-20261025-01");
const requestRows=(await readFile(path.join(root,"mission-a-1.requests.jsonl"),"utf8")).trim().split(/\r?\n/).map(x=>JSON.parse(x));
const finalRequest=requestRows.at(-1);
const finalState=JSON.parse(await readFile(path.join(root,"data/terax-ai-sessions.json"),"utf8"));
const run=finalState.sessions.find(s=>s.id==="real-mission-a").run;
assert.equal(run.state,"failed");
assert.match(run.error.message,/Automatic Agent configuration is not verified/);
assert.equal(finalRequest.requestId,"inference-34");
assert.equal(finalRequest.numCtx,49152);
const saved=JSON.parse(await readFile(path.join(root,"data/terax-settings.json"),"utf8"));
const vite=await createServer({root:repo,server:{middlewareMode:true},appType:"custom",logLevel:"error"});
try {
  const [{readSelfHostedState},{rememberContextRuntime,forgetContextRuntime},{toolEligibilityPredicates},{automaticAgentRecommendation}]=await Promise.all([
    "/src/modules/ai/lib/selfHostedProfiles.ts",
    "/src/modules/ai/lib/contextCalibrationTrust.ts",
    "/src/modules/ai/lib/toolVerification.ts",
    "/src/modules/ai/lib/agentConfiguration.ts",
  ].map(m=>vite.ssrLoadModule(m)));
  const state=readSelfHostedState(saved.selfHostedInference);
  const profile=state.profiles.find(p=>p.transportModelId==="muse-glimmer:30b");
  const endpoint=state.endpoints.find(e=>e.id===profile.endpointId);
  const record=profile.agentToolTierProofs?.find(p=>p.context===49152);
  assert(profile && endpoint && record);
  const epoch=profile.contextCalibration.scope.runtimeEpoch;
  assert.equal(epoch,record.scope.runtimeEpoch);
  const currentVersion=record.scope.providerVersion;
  const previousTime=Date.now;
  Date.now=()=>run.endedAt;
  const inspectAt=(at)=>{
    rememberContextRuntime(endpoint.id,{epoch,version:currentVersion,configurationRevision:endpoint.configurationRevision,at});
    const predicates=toolEligibilityPredicates(state,profile,record.configuration,run.endedAt,49152);
    return {runtimeAt:at,runtimeAgeMs:run.endedAt-at,predicates,selected:automaticAgentRecommendation(state,profile,49152,run.endedAt)?.record?.id??null};
  };
  try{
    // Most favorable possible last runtime observation: exactly at HTTP
    // dispatch. Production inspects it strictly before dispatch.
    const atDispatch=inspectAt(finalRequest.at);
    const afterRefresh=inspectAt(run.endedAt-100);
    assert.equal(atDispatch.predicates.runtimeFresh,false);
    assert.equal(atDispatch.predicates.scopeMatches,false);
    assert.equal(atDispatch.selected,null);
    assert.equal(afterRefresh.predicates.runtimeFresh,true);
    assert.equal(afterRefresh.predicates.scopeMatches,true);
    assert.equal(afterRefresh.predicates.verdict,"Verified");
    assert.equal(afterRefresh.selected,record.id);
    const evidence={
      diagnostic:"offline production eligibility functions + preserved finished Muse profile",
      runtimeEpoch:epoch,
      providerVersion:currentVersion,
      lastRequestId:finalRequest.requestId,
      lastRequestContext:finalRequest.numCtx,
      lastRequestAt:finalRequest.at,
      agentStopAt:run.endedAt,
      requestDurationToStopMs:run.endedAt-finalRequest.at,
      tierRecordId:record.id,
      tierProofExpiry:record.proof.expiresAt,
      contextCalibrationExpiry:profile.contextCalibration.expiresAt,
      atDispatch,afterRefresh,
      inferenceCount:requestRows.length,
      providerCallsMade:0,
      changesToApplication:0,
    };
    await writeFile(path.join(root,"continuation-eligibility-forensics.json"),JSON.stringify(evidence,null,2),{flag:"wx"});
    console.log(JSON.stringify(evidence,null,2));
  }finally{Date.now=previousTime;forgetContextRuntime(endpoint.id)}
}finally{await vite.close()}
