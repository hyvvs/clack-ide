// Isolated F2 browser fixture; settings, probes and optimization are mocked.
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = process.env.WATCHDOG_SCREENSHOTS;
if (output) await mkdir(output, { recursive: true });
const mocks = new Map([
  ["src/modules/settings/preferences", `import{create}from"zustand";export const usePreferencesStore=create(()=>({selfHostedInference:window.initial}));window.prefs=usePreferencesStore;`],
  ["src/modules/settings/store", `export async function updateSelfHostedProfiles(change){const next=change(window.prefs.getState().selfHostedInference);window.prefs.setState({selfHostedInference:next});return next;}export async function emitKeysChanged(){}`],
  ["src/modules/ai/lib/keyring", `export async function setCustomEndpointKey(){}`],
  ["src/modules/ai/lib/errors", `export const sanitizeAiErrorText=value=>String(value).slice(0,1200);`],
  ["src/modules/ai/lib/calibrationOptimization", `export async function optimizeInferenceProfile({signal,onProgress}){window.optimizations++;return new Promise((resolve,reject)=>{signal.addEventListener("abort",()=>reject(new DOMException("Cancelled","AbortError")),{once:true});onProgress(1);window.finish=()=>resolve({completed:3});});}`],
  ["@tauri-apps/api/core", `export async function invoke(command,args){if(command==="self_hosted_probe_cache")return window.snapshot;if(command==="self_hosted_probe"){await new Promise(r=>setTimeout(r,10));window.snapshot={...window.snapshot,observedAt:Date.now(),connected:!window.fail,stale:!!window.fail,errors:window.fail&&window.fail!=="stale"?[{route:null,error:{code:window.fail,statusCode:window.fail==="invalid-server-response"?429:null,reachable:false}}]:[]};return window.snapshot;}return null;}`],
]);
const entry = `
import React from"react";import{createRoot}from"react-dom/client";
import{calibrationFixture,calibrationSample}from"/src/modules/ai/lib/calibration.fixtures.ts";
import{appendCalibrationSamples}from"/src/modules/ai/lib/inferenceCalibration.ts";
import"/src/styles/globals.css";import"/src/settings/components/SelfHostedServers.css";
window.optimizations=0;window.initial=calibrationFixture();window.initial.endpoints[0].alias="Long-endpoint-name-".repeat(6);window.alias=window.initial.endpoints[0].alias;
window.initial.profiles[0].saved={label:"Long-model-name-".repeat(50)};window.initial.profiles[1].saved={label:"Other model"};
const now=Date.now();window.initial=appendCalibrationSamples(window.initial,Array.from({length:5},(_,i)=>({profileId:window.initial.profiles[0].id,sample:calibrationSample(i,{observedAt:now-i})})),now);
window.snapshot={endpointId:"a",configurationRevision:1,selectedModelId:null,observedAt:now,connected:true,reachable:true,credentialUsed:false,stale:false,refreshing:false,inventoryTtlMs:300000,instanceTtlMs:30000,models:[{id:"coder",name:"Long-model-name-".repeat(50),chat:"supported",evidence:[]},{id:"other",name:"Other model",chat:"supported",evidence:[]}],errors:[]};
window.health=outcome=>{const s=structuredClone(window.prefs.getState().selfHostedInference);s.profiles[0].calibration.samples.push(calibrationSample(98,{id:crypto.randomUUID(),observedAt:Date.now(),outcome}));window.prefs.setState({selfHostedInference:s});};
const{SelfHostedServers}=await import("/src/settings/components/SelfHostedServers.tsx");createRoot(document.getElementById("root")).render(React.createElement(React.StrictMode,null,React.createElement("main",{style:{maxWidth:700,margin:"20px auto",padding:16}},React.createElement(SelfHostedServers))));
`;
const server = await createServer({root,configFile:false,logLevel:"warn",optimizeDeps:{entries:[],noDiscovery:true,include:["react","react-dom/client","react/jsx-runtime","zustand","zod","@hugeicons/react","@hugeicons/core-free-icons","class-variance-authority","radix-ui","clsx","tailwind-merge"]},resolve:{alias:{"@":path.join(root,"src")}},plugins:[{
  name:"watchdog-fixture",enforce:"pre",
  resolveId(source,importer){if(source==="/watchdog-entry.jsx")return"\0watchdog-entry.jsx";if(mocks.has(source))return"\0"+source;const absolute=source.startsWith(".")&&importer?path.resolve(path.dirname(importer),source):source;const relative=path.relative(root,absolute).replaceAll("\\","/").replace(/\.[jt]sx?$/,"");return mocks.has(relative)?"\0"+relative:null;},
  load(id){if(id==="\0watchdog-entry.jsx")return entry;if(id.startsWith("\0"))return mocks.get(id.slice(1));},
  configureServer(vite){vite.middlewares.use("/watchdog-fixture",async(_req,res)=>{res.setHeader("Content-Type","text/html");res.end(await vite.transformIndexHtml("/watchdog-fixture",'<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:var(--background);color:var(--foreground)"><div id="root"></div><script type="module" src="/watchdog-entry.jsx"></script></body></html>'));});},
},react(),tailwindcss()],server:{host:"127.0.0.1",port:0,watch:null,hmr:false}});
let browser;
try {
  await server.listen();browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
  for(const width of [1280,390,280]) {
    console.log(`Checking F2 controls at ${width}px`);
    const page=await browser.newPage({viewport:{width,height:950}});page.setDefaultTimeout(20000);
    const errors=[];page.on("pageerror",e=>{errors.push(e.message);console.error(e.message);});
    page.on("console",m=>{if(m.type()==="error")console.error(m.text());});
    page.on("requestfailed",r=>console.error(r.url(),r.failure()));
    await page.goto(`${server.resolvedUrls.local[0]}watchdog-fixture`,{waitUntil:"load",timeout:120000});
    try{await page.locator(".server-identity").first().waitFor({timeout:30000});}catch(error){console.error(await page.locator("body").innerText());throw error;}
    assert.equal(await page.locator(".server-identity").first().getAttribute("aria-label"),`Manage ${await page.evaluate(()=>window.alias)}`);
    console.log("Opening configured endpoint");
    await page.locator(".server-identity").first().click();
    const search=page.getByLabel("Search server models");await search.waitFor();
    await page.locator(".server-status").getByText("Ready",{exact:true}).waitFor();
    await search.fill("absent");assert.equal(await page.locator(".server-model").count(),0);
    await search.press("Escape");assert.equal(await search.inputValue(),"");assert.equal(await page.locator(".server-model").count(),2);
    console.log("Checking Advanced pins and keyboard");
    const advanced=page.getByText("Advanced model settings",{exact:true});await advanced.focus();await page.keyboard.press("Enter");
    const before=await page.evaluate(()=>({other:JSON.stringify(window.prefs.getState().selfHostedInference.profiles.slice(1)),samples:JSON.stringify(window.prefs.getState().selfHostedInference.profiles[0].calibration)}));
    await page.getByLabel("Working context",{exact:true}).fill("2048");await page.getByRole("button",{name:"Save Working context",exact:true}).click();
    await page.getByText("Manual: 2048",{exact:true}).waitFor();
    await page.getByLabel("Output reserve",{exact:true}).fill("256");await page.getByRole("button",{name:"Save Output reserve",exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('input[aria-label="Output reserve"]')?.getAttribute("placeholder")==="256");
    const reset=page.getByRole("button",{name:"Reset Working context to Automatic",exact:true});await reset.focus();await page.keyboard.press("Space");
    assert.equal(await reset.isDisabled(),true);
    assert.equal(await page.evaluate(()=>window.prefs.getState().selfHostedInference.profiles[0].overrides.outputReserve.evidence.value),256);
    assert.equal(await page.evaluate(()=>JSON.stringify(window.prefs.getState().selfHostedInference.profiles.slice(1))),before.other);
    assert.equal(await page.evaluate(()=>JSON.stringify(window.prefs.getState().selfHostedInference.profiles[0].calibration)),before.samples);
    await page.getByLabel("Maximum output",{exact:true}).fill("999999999");await page.getByRole("button",{name:"Save Maximum output",exact:true}).click();
    await page.getByText("Invalid manual settings",{exact:true}).waitFor();
    await page.getByRole("button",{name:"Reset Maximum output to Automatic",exact:true}).click();
    await page.getByText("Invalid manual settings",{exact:true}).waitFor({state:"hidden"});
    await page.getByLabel("Working context",{exact:true}).press("Escape");assert.equal(await advanced.evaluate(el=>el.parentElement.open),false);
    assert.equal(await advanced.evaluate(el=>document.activeElement===el),true);
    await page.keyboard.press("Enter");
    console.log("Checking health and optimization states");
    const health=label=>page.waitForFunction(expected=>document.querySelector(".server-health")?.firstChild?.textContent===expected,label);
    for(const [outcome,label] of [["loading","Loading"],["offline","Offline"],["auth","Authentication required"],["rate-limit","Rate limited"],["resource","Limited"],["success","Ready"]]) {
      await page.evaluate(value=>window.health(value),outcome);await health(label);
    }
    page.once("dialog",d=>d.dismiss());await page.getByRole("button",{name:"Optimize",exact:true}).click();assert.equal(await page.evaluate(()=>window.optimizations),0);
    page.once("dialog",d=>d.accept());await page.getByRole("button",{name:"Optimize",exact:true}).click();
    await health("Calibrating");await page.waitForFunction(()=>window.optimizations===1);await page.getByRole("button",{name:"Cancel optimization",exact:true}).click();await page.getByText("Optimization cancelled",{exact:true}).waitFor();
    await page.evaluate(()=>{window.fail="unreachable";});await page.getByRole("button",{name:"Refresh",exact:true}).click();await page.locator(".server-status").getByText("Offline",{exact:true}).waitFor();assert.equal(await page.locator(".server-model").count(),2);
    await page.evaluate(()=>{window.fail="authentication-failed";});await page.getByRole("button",{name:"Refresh",exact:true}).click();await page.locator(".server-status").getByText("Authentication required",{exact:true}).waitFor();
    await page.evaluate(()=>{window.fail="stale";const s=structuredClone(window.prefs.getState().selfHostedInference);delete s.profiles[0].calibration;window.prefs.setState({selfHostedInference:s});});await page.getByRole("button",{name:"Refresh",exact:true}).click();await page.locator(".server-status").getByText("Unverified",{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`Overflow at ${width}px`);assert.deepEqual(errors,[]);
    if(output)await page.screenshot({path:path.join(output,`f2-${width}.png`),fullPage:true});
    await page.close();
  }
  console.log("F2 passed at 1280/390/280px: truthful health, scoped pins/reset, invalid settings recovery, keyboard/Escape/search, explicit consent/Stop, retained offline inventory and long identities. Mocked browser, not native GUI or live-provider verification.");
} catch(error) { console.error(error); throw error; }
finally {await browser?.close();await server.close();}
