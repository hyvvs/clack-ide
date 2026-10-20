// Isolated production-component fixture. All IPC/persistence is synthetic.
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = process.cwd(), output = path.join(root, "src-tauri/target/onboarding/browser");
await mkdir(output, { recursive: true });
const mocks = new Map([
  ["src/modules/settings/preferences", `
    import {create} from "zustand";
    export const usePreferencesStore = create(() => ({hydrated:false,selfHostedInference:{version:1,revision:0,endpoints:[],profiles:[]},customEndpoints:[],savedProviderModels:[]}));
    window.prefs=usePreferencesStore;
  `],
  ["src/modules/settings/store", `
    export async function updateSelfHostedProfiles(change) {const next=change(window.prefs.getState().selfHostedInference);next.revision++;window.prefs.setState({selfHostedInference:next});return next;}
    export async function emitKeysChanged() {}
  `],
  ["src/modules/ai/lib/keyring", `export async function setCustomEndpointKey(){}`],
  ["src/modules/ai/lib/toolVerificationRuntime", `export async function verifyModelTools(){window.verifyTools();}`],
  ["src/modules/ai/lib/contextRuntimeClient", `
    import {rememberContextRuntime} from "/src/modules/ai/lib/contextCalibrationTrust.ts";
    export async function inspectContextRuntime(endpoint){
      rememberContextRuntime(endpoint.id,{epoch:"browser-fixture",version:"fixture",configurationRevision:endpoint.configurationRevision,at:Date.now()});
    }
  `],
  ["src/modules/ai/lib/selfHostedProbe", `
    import {ensureSelfHostedProfile,profileEvidence} from "/src/modules/ai/lib/selfHostedProfiles.ts";
    export const PROBE_INVENTORY_TTL_MS=300000,PROBE_INSTANCE_TTL_MS=30000;
    export function normalizeProbeError(e){return {message:e.code};}
    export function probeEvidenceIsFresh(e,endpoint,snapshot){return !!snapshot?.connected && e.scope.configurationRevision===endpoint.configurationRevision;}
    export function createSelfHostedProbeClient(){return {
      read:async()=>window.snapshot??null,
      inspect:async()=>({cached:window.snapshot??null,refresh:null}),cancel:async()=>{},
      refresh:async(options)=>{
        window.probes.push(options);
        let state=window.prefs.getState().selfHostedInference;
        const endpoint=state.endpoints.find(e=>e.id===options.endpointId);
        endpoint.detectedBackend="ollama";
        const models=Array.from({length:2},(_,i)=>({id:"generic-model-"+i,name:null,chat:"supported",digest:window.digest,evidence:[]}));
        if(!window.offline)for(const model of models){
          state=ensureSelfHostedProfile(state,endpoint.id,model.id).state;
          const p=state.profiles.find(p=>p.transportModelId===model.id);
          if(p.modelRevision!==window.digest){p.evidence=[];p.recommendations={};}
          p.modelRevision=window.digest;p.backend="ollama";
          if(options.selectedModelId===model.id){
            const data={"probe.runtimeContext":"per-request","probe.advertisedContext":65536,"probe.trainedForTools":true,"probe.vision":false,"probe.thinking":true,"probe.thinkingControls":'[false,true,"medium"]',"probe.thinkingDefault":true};
            p.evidence=Object.entries(data).map(([metric,value])=>profileEvidence(state,p.id,metric,value,"backend-reported",Date.now(),"reported"));
          }
          model.evidence=p.evidence;
        }
        state={...state,inventories:[{endpointId:endpoint.id,configurationRevision:endpoint.configurationRevision,observedAt:Date.now(),connected:!window.offline,backend:"ollama",error:window.offline?"unreachable":null,models:models.map(({evidence,...m})=>m)}]};
        window.prefs.setState({selfHostedInference:state});
        return window.snapshot={endpointId:endpoint.id,configurationRevision:endpoint.configurationRevision,selectedModelId:options.selectedModelId??null,observedAt:Date.now(),connected:!window.offline,reachable:!window.offline,stale:!!window.offline,refreshing:false,credentialUsed:false,inventoryTtlMs:300000,instanceTtlMs:30000,backend:"ollama",models,errors:window.offline?[{route:null,error:{code:"unreachable"}}]:[]};
      }
    };}
  `],
]);
const entry = `
 import React from "react";import {createRoot} from "react-dom/client";
 import {SelfHostedServers} from "/src/settings/components/SelfHostedServers.tsx";
 import {contextReasoningIdentity,rememberContextRuntime} from "/src/modules/ai/lib/contextCalibrationTrust.ts";
 import {profileEvidence} from "/src/modules/ai/lib/selfHostedProfiles.ts";
 import {useContextCalibrationJobs} from "/src/modules/ai/store/contextCalibrationJobs.ts";
 import {useToolVerificationJobs} from "/src/modules/ai/store/toolVerificationJobs.ts";
 import {commitToolVerification,toolScope} from "/src/modules/ai/lib/toolVerification.ts";
 import "/src/styles/globals.css";
 window.probes=[];window.digest="revision-a";window.offline=false;
 window.calibrationJobs=useContextCalibrationJobs;
 window.toolJobs=useToolVerificationJobs;
 window.verifyTools=(status='verified')=>{
   const state=window.prefs.getState().selfHostedInference,p=state.profiles[0],e=state.endpoints[0],now=Date.now();
   const record={version:1,id:'browser-tool-proof',scope:toolScope(p,e),status,outcome:status==='verified'?'native-call':'text-only',
     context:49152,output:512,startedAt:now,completedAt:now,firstBodyAt:now,callAt:status==='verified'?now:null,
     calls:status==='verified'?1:0,validArguments:status==='verified',textualIntent:status!=='verified',textChars:status==='verified'?0:32,
     finish:status==='verified'?'tool-calls':'stop',proof:status==='verified'?{at:now,expiresAt:now+86400000}:null,retryAfter:now+86400000};
   window.prefs.setState({selfHostedInference:commitToolVerification(state,p.id,record,p.toolVerification?.id)});
 };
 window.verifyContext=()=>{
   let state=window.prefs.getState().selfHostedInference;
   const profile=state.profiles[0],endpoint=state.endpoints[0],now=Date.now();
   profile.evidence=profile.evidence.filter(e=>!['probe.loaded','probe.loadedContext','probe.runtimeAllocation'].includes(e.metric));
   for(const [metric,value] of Object.entries({loaded:true,loadedContext:49152,runtimeAllocation:"fixture-allocation"}))
     profile.evidence.push(profileEvidence(state,profile.id,'probe.'+metric,value,'backend-reported',now,'reported'));
   rememberContextRuntime(endpoint.id,{epoch:"browser-fixture",version:"fixture",configurationRevision:endpoint.configurationRevision,at:now});
   const record={version:1,id:'browser-proof',scope:{endpointId:endpoint.id,configurationRevision:endpoint.configurationRevision,
     model:profile.transportModelId,deployment:null,digest:profile.modelRevision,backend:'ollama',runtimeEpoch:'browser-fixture',providerVersion:'fixture',
     reasoning:contextReasoningIdentity(profile,endpoint)},status:'verified',highest:49152,failedNext:null,failure:null,allocation:'fixture-allocation',
     startedAt:now,updatedAt:now,expiresAt:now+900000,retryAfter:now+900000,
     attempts:[{context:49152,requested:49152,loaded:49152,outcome:'success',at:now,latencyMs:1,thermal:'warm',finish:'stop',think:'omitted'}]};
   state={...state,profiles:state.profiles.map(p=>p.id!==profile.id?p:{...p,contextCalibration:record,recommendations:{...p.recommendations,
     workingContext:{...profileEvidence(state,p.id,'workingContext',49152,'measured',now,'observed'),expiresAt:now+900000}}})};
   window.prefs.setState({selfHostedInference:state});
 };
 createRoot(document.getElementById("root")).render(React.createElement("main",{style:{maxWidth:760,padding:16,margin:"auto"}},React.createElement(SelfHostedServers)));
`;
const server = await createServer({root,configFile:false,logLevel:"warn",optimizeDeps:{entries:[],noDiscovery:true,include:["react","react-dom/client","react/jsx-runtime","zustand","zod","@hugeicons/react","@hugeicons/core-free-icons","radix-ui","class-variance-authority","clsx","tailwind-merge"]},
  resolve:{alias:{"@":path.join(root,"src")}},plugins:[{
    name:"isolated-onboarding",enforce:"pre",
    resolveId(source,importer){
      if(source==="/onboarding-entry.jsx")return "\0onboarding-entry.jsx";
      const absolute=source.startsWith(".")&&importer?path.resolve(path.dirname(importer),source):source;
      const relative=path.relative(root,absolute).replaceAll("\\","/").replace(/\.[jt]sx?$/,"");
      return mocks.has(relative)?`\0mock:${relative}`:null;
    },
    load(id){if(id==="\0onboarding-entry.jsx")return entry;if(id.startsWith("\0mock:"))return mocks.get(id.slice(6));},
    configureServer(vite){vite.middlewares.use("/onboarding",async(_req,res)=>{res.setHeader("Content-Type","text/html");res.end(await vite.transformIndexHtml("/onboarding",`<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:var(--background);color:var(--foreground)"><div id="root"></div><script type="module" src="/onboarding-entry.jsx"></script></body></html>`));});}
  },react(),tailwindcss()],server:{host:"127.0.0.1",port:0,watch:null,hmr:false}});
let browser;
try {
  await server.listen();browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.goto(`${server.resolvedUrls.local[0]}onboarding`,{waitUntil:"networkidle",timeout:120000});
  await page.getByRole("button",{name:"Add self-hosted server",exact:true}).click();
  await page.getByLabel("Address",{exact:true}).fill("http://localhost:11435");
  assert.equal(await page.getByLabel("Server type").inputValue(),"");
  await page.getByLabel("Allow localhost and private-network access for this server",{exact:true}).check();
  await page.getByRole("button",{name:"Connect",exact:true}).click();
  await page.getByRole("button",{name:"Refresh",exact:true}).waitFor();
  assert.equal(await page.locator(".server-model").count(),2);
  assert.equal(await page.evaluate(()=>window.probes.filter(p=>p.selectedModelId).length),2);
  assert.ok(await page.evaluate(()=>window.prefs.getState().selfHostedInference.profiles.every(p=>!p.saved)));
  await page.locator(".server-model").first().getByRole("button",{name:"Settings",exact:true}).click();
  const settings=page.getByRole("region",{name:"Model settings for generic-model-0"});
  await settings.getByText("Automatic (On)",{exact:true}).waitFor();
  await settings.locator("summary").filter({hasText:"Advanced model settings"}).click();
  await settings.getByLabel("Context preset").selectOption("16384");
  await settings.getByText("Custom: 16,384 tokens / Unverified",{exact:true}).waitFor();
  await page.getByRole("button",{name:"Refresh",exact:true}).click();
  assert.equal(await page.evaluate(()=>window.prefs.getState().selfHostedInference.profiles[0].overrides.workingContext.evidence.value),16384);
  await settings.getByRole("button",{name:"Reset Working context to Automatic"}).click();
  await settings.getByText("Automatic (4,096 tokens) / Unverified",{exact:true}).waitFor();
  await page.getByRole("button",{name:"Refresh",exact:true}).click();
  assert.equal(await page.evaluate(()=>window.prefs.getState().selfHostedInference.profiles[0].overrides.workingContext),undefined);
  await page.getByLabel("Search server models").focus();await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(()=>document.activeElement?.textContent),"Settings");
  await page.evaluate(()=>{
    const state=window.prefs.getState().selfHostedInference;
    window.calibrationJobs.setState({jobs:{[state.endpoints[0].id]:{profileId:state.profiles[1].id,context:8192,controller:new AbortController()}}});
  });
  assert.equal(await settings.getByRole("button",{name:"Cancel context verification"}).count(),0);
  assert.equal(await settings.getByRole("button",{name:"Verify context"}).isDisabled(),true);
  await page.evaluate(()=>window.calibrationJobs.setState({jobs:{}}));
  await page.evaluate(()=>window.verifyContext());
  await settings.getByText("Automatic (49,152 tokens) / Verified",{exact:true}).waitFor();
  await settings.getByText("Context: Verified on this server / 49,152 recommended",{exact:true}).waitFor();
  await settings.getByText("Advertised / unverified",{exact:true}).waitFor();
  await page.evaluate(()=>{
    const state=window.prefs.getState().selfHostedInference;
    window.prefs.setState({selfHostedInference:{...state,profiles:state.profiles.map((p,i)=>i? p : {...p,contextCalibration:{...p.contextCalibration,expiresAt:0}})}});
  });
  await settings.getByText("Automatic (4,096 tokens) / Unverified",{exact:true}).waitFor();
  await settings.getByText("Context: Stale / conservative",{exact:true}).waitFor();
  await page.evaluate(()=>window.verifyContext());
  await settings.getByRole('button',{name:'Verify tools',exact:true}).click();
  await settings.getByText('Tools: Verified',{exact:true}).waitFor();
  await settings.getByText('Ready',{exact:true}).waitFor();
  await page.evaluate(()=>window.verifyTools('incompatible'));
  await settings.getByText('Tools: Needs attention',{exact:true}).waitFor();
  await settings.getByRole('status').getByText('Needs attention',{exact:true}).waitFor();
  await settings.getByText(/This does not prove tools are unsupported/).waitFor();
  await page.evaluate(()=>{
    const state=window.prefs.getState().selfHostedInference,p=state.profiles[0];
    window.toolJobs.setState({jobs:{[p.endpointId]:{profileId:p.id,controller:new AbortController()}}});
  });
  await settings.getByText('Tools: Verifying',{exact:true}).waitFor();
  await settings.getByRole('button',{name:'Cancel tool verification',exact:true}).click();
  assert.equal(await page.evaluate(()=>Object.values(window.toolJobs.getState().jobs)[0].controller.signal.aborted),true);
  await page.evaluate(()=>{window.toolJobs.setState({jobs:{}});window.verifyTools();});
  for(const theme of ["dark","light"]){
    await page.evaluate(theme=>document.documentElement.className=theme,theme);
    for(const width of [1280,390,320]){
      await page.setViewportSize({width,height:800});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${theme} overflow at ${width}`);
      await page.screenshot({path:path.join(output,`${theme}-${width}.png`),fullPage:true});
    }
  }
  await page.setViewportSize({width:640,height:600});
  await page.evaluate(()=>document.body.style.zoom="2");
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"200% CSS scaling overflow");
  await page.screenshot({path:path.join(output,"zoom-200.png"),fullPage:true});
  await page.evaluate(()=>{document.body.style.zoom="1";window.offline=true;});
  await page.getByRole("button",{name:"Refresh",exact:true}).click();
  await settings.getByText("Offline",{exact:true}).waitFor();
  await page.evaluate(()=>{window.offline=false;window.digest="revision-b";});
  await page.getByRole("button",{name:"Refresh",exact:true}).click();
  await settings.getByRole("status").getByText("Unverified",{exact:true}).waitFor();
  await settings.getByText('Tools: Stale',{exact:true}).waitFor();
  await page.evaluate(()=>{window.verifyContext();window.verifyTools();});
  await settings.getByText('Tools: Verified',{exact:true}).waitFor();
  await settings.getByText('Ready',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  await writeFile(path.join(output,"result.json"),JSON.stringify({passed:true,toolVerification:["advertised","verified","ready","needs-attention-chat-only-available","verifying","cancel"],contextVerification:["conservative","verified-49152","expired-stale","tool-evidence-independent"],widths:[1280,390,320],themes:["dark","light"],cssZoom:2,errors,inference:0,nativeGUI:false},null,2));
  console.log("Onboarding browser fixture passed: context preserved, tools verified/Ready, needs attention/Chat Only guidance, cancel, digest withdrawal/reverification, offline/return, keyboard, 320px, light/dark, 200% CSS scaling. No native GUI or inference.");
} finally {await browser?.close();await server.close();}
