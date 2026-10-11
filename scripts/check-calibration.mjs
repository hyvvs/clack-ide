import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = process.env.CALIBRATION_SCREENSHOTS;
if (output) await mkdir(output, { recursive: true });
const mocks = new Map([
  ["src/modules/settings/preferences", `import {create} from "zustand"; export const usePreferencesStore=create(()=>({selfHostedInference:window.initial})); window.prefs=usePreferencesStore;`],
  ["src/modules/settings/store", `export async function updateSelfHostedProfiles(change){const next=change(window.prefs.getState().selfHostedInference);window.prefs.setState({selfHostedInference:next});return next;}`],
  ["src/modules/ai/lib/calibrationOptimization", `export async function optimizeInferenceProfile({signal,onProgress}){window.optimizations++;return new Promise((resolve,reject)=>{signal.addEventListener("abort",()=>reject(new DOMException("Cancelled","AbortError")),{once:true});onProgress(1);window.finish=()=>resolve({completed:3});});}`],
  ["src/modules/ai/lib/errors", `export const sanitizeAiErrorText=value=>String(value).slice(0,1200);`],
]);
const entry = `
import React from "react";import{createRoot}from"react-dom/client";
import{calibrationFixture,calibrationSample}from"/src/modules/ai/lib/calibration.fixtures.ts";
import{appendCalibrationSamples}from"/src/modules/ai/lib/inferenceCalibration.ts";
import"/src/styles/globals.css";import"/src/settings/components/SelfHostedServers.css";
window.optimizations=0;window.initial=calibrationFixture();window.initial.profiles[0].saved={label:"Very-long-model-name-".repeat(50)};
const now=Date.now();window.initial=appendCalibrationSamples(window.initial,Array.from({length:5},(_,i)=>({profileId:window.initial.profiles[0].id,sample:calibrationSample(i,{observedAt:now-i})})),now);
const{CalibrationControls}=await import("/src/settings/components/CalibrationControls.tsx");
createRoot(document.getElementById("root")).render(React.createElement(React.StrictMode,null,React.createElement("main",{className:"self-hosted-servers",style:{maxWidth:650,margin:"20px auto",padding:16}},React.createElement(CalibrationControls,{endpointId:"a"}))));
`;
const server = await createServer({root,cacheDir:path.join(os.tmpdir(),"clack-calibration-vite-"+process.pid),configFile:false,logLevel:"warn",optimizeDeps:{entries:[],noDiscovery:true,include:["react","react-dom/client","react/jsx-runtime","zustand","zod","@hugeicons/react","@hugeicons/core-free-icons","class-variance-authority","radix-ui","clsx","tailwind-merge"]},resolve:{alias:{"@":path.join(root,"src")}},plugins:[{
  name:"calibration-fixture",enforce:"pre",
  resolveId(source,importer){if(source==="/calibration-entry.jsx")return"\0calibration-entry.jsx";const absolute=source.startsWith(".")&&importer?path.resolve(path.dirname(importer),source):source;const relative=path.relative(root,absolute).replaceAll("\\","/").replace(/\.[jt]sx?$/,"");return mocks.has(relative)?"\0"+relative:null;},
  load(id){if(id==="\0calibration-entry.jsx")return entry;if(id.startsWith("\0"))return mocks.get(id.slice(1));},
  configureServer(vite){vite.middlewares.use("/calibration-fixture",async(_req,res)=>{res.setHeader("Content-Type","text/html");res.end(await vite.transformIndexHtml("/calibration-fixture",'<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:var(--background);color:var(--foreground)"><div id="root"></div><script type="module" src="/calibration-entry.jsx"></script></body></html>'));});},
},react(),tailwindcss()],server:{host:"127.0.0.1",port:0,watch:null,hmr:false}});
let browser;
try {
  await server.listen();browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
  for(const width of [1280,390,280]) {
    console.log(`Checking calibration UI at ${width}px`);
    const page=await browser.newPage({viewport:{width,height:850}});page.setDefaultTimeout(20000);
    const errors=[];page.on("pageerror",e=>{errors.push(e.message);console.error(e.message);});
    page.on("console",m=>{if(m.type()==="error")console.error(m.text());});
    page.on("requestfailed",r=>console.error(r.url(),r.failure()));
    await page.goto(`${server.resolvedUrls.local[0]}calibration-fixture`,{waitUntil:"domcontentloaded",timeout:60000});
    try{await page.getByRole("button",{name:"Optimize",exact:true}).waitFor({timeout:90000});}catch(error){console.error(await page.locator("body").innerText());throw error;}
    const summary=page.getByText("Calibration details",{exact:true});await summary.focus();await page.keyboard.press("Enter");
    await page.getByLabel("Manual inference capacity").fill("4");await page.getByRole("button",{name:"Save manual capacity"}).click();
    await page.getByText("Concurrent generations: 4 (manual)").waitFor();
    await page.getByRole("button",{name:"Reset capacity to Automatic"}).click();
    await page.getByText("Concurrent generations: 1 (automatic)").waitFor();
    page.once("dialog",d=>d.dismiss());await page.getByRole("button",{name:"Optimize",exact:true}).click();
    assert.equal(await page.evaluate(()=>window.optimizations),0);
    page.once("dialog",d=>d.accept());await page.getByRole("button",{name:"Optimize",exact:true}).click();
    await page.getByRole("progressbar",{name:"Optimization progress"}).waitFor();
    await page.waitForFunction(()=>window.optimizations===1);
    assert.equal(await page.getByRole("button",{name:"Optimize",exact:true}).isDisabled(),true);
    await page.getByRole("button",{name:"Cancel optimization"}).click();await page.getByText("Optimization cancelled",{exact:true}).waitFor();
    page.once("dialog",d=>d.accept());await page.getByRole("button",{name:"Optimize",exact:true}).click();
    await page.waitForFunction(()=>window.optimizations===2);
    await page.evaluate(()=>window.finish());await page.getByText(/Measurements saved/).waitFor();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
    assert.equal(overflow,false,`Overflow at ${width}px`);assert.deepEqual(errors,[]);
    if(output)await page.screenshot({path:path.join(output,`calibration-${width}.png`),fullPage:true});
    await page.close();
  }
  console.log("E2 browser checks passed at 1280/390/280px: keyboard details, pin/reset, explicit consent, cancellation, progress, success and long-model bounds. Mocked IPC/optimization, not native GUI or live-provider verification.");
} finally {await browser?.close();await server.close();}
