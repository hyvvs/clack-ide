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
const mocks = new Map([
  ["src/modules/ai/lib/sessions", `export const loadAll=async()=>({activeId:"chat",sessions:[{id:"chat",title:"Project chat",profile:{agentId:"builtin:coder",workspaceId:"local:/work",workspaceRoot:"/work"}}]});`],
  ["src/modules/ai/lib/permissions", `export const resolveCurrentAgentPermission=()=>({outcome:"allow"});`],
  ["src/modules/ai/store/agentsStore", `import {create} from "zustand";export const useAgentsStore=create(()=>({customAgents:[],all:()=>[{id:"builtin:coder",name:"Coder"}]}));`],
  ["event", `window.toolListeners=new Set();export const listen=async(name,callback)=>{const pair={name,callback};window.toolListeners.add(pair);return ()=>window.toolListeners.delete(pair);};`],
  ["core", `
    const definition={name:"custom_"+"long_name_".repeat(5),description:"Reviewed evidence ".repeat(200),inputSchema:{type:"object",properties:{path:{type:"string",maxLength:1024}},required:["path"],additionalProperties:false},outputSchema:{type:"string",maxLength:8192},outputDescription:"Untrusted text",binding:{kind:"native",operation:"read_file"},scope:"conversation",agents:["builtin:coder"],conversations:["chat"],permissions:["read-files"],credentialRef:null,timeoutMs:30000,outputBytes:8192};
    const current={version:3,hash:"a".repeat(64),definition,status:"authorized",enabled:true,source:"native-user",sessionId:"chat",agentId:"builtin:coder",createdAt:1};
    const registry={schemaVersion:1,revision:3,entries:[{id:"tool",workspaceId:"local:/work",current,versions:[],eligible:true,executable:true,runtime:"Guarded execution; invocation approval required"}]};
    const records=[];window.testRecords=records;window.executions=0;
    const emit=()=>{for(const {name,callback} of window.toolListeners||[])if(name==="clack:custom-tool-execution")callback({payload:{id:records.at(-1).id,sessionId:"chat",state:"FAKE_SUCCESS"}});};
    window.transition=(state,effect="none")=>{const r=records.at(-1);r.state=state;r.effect=effect;r.transitions.push([state,Date.now()]);r.updatedAt=Date.now();emit();};
    window.finish=(state,effect="none")=>{const r=records.at(-1);r.result=state==="succeeded"?(window.nullResult?null:"Actual bounded fixture result"):null;r.error=state==="failed"?"error_".repeat(900):null;window.transition(state,effect);window.resolveExecution?.(structuredClone(r));};
    export async function invoke(command,args){
      if(command==="custom_tools_load")return structuredClone(registry);
      if(command==="custom_tool_history")return structuredClone(records);
      if(command==="custom_tool_prepare"){
        if(!args.request.test||args.request.tool.hash!==current.hash)throw Error("invalid-capture");
        const r={id:"call-"+records.length,sessionId:"chat",agentId:"builtin:coder",workspaceId:"local:/work",runId:null,tool:args.request.tool,toolName:definition.name,kind:"native",argumentsHash:"b".repeat(64),state:"awaiting-approval",effect:"none",createdAt:Date.now(),updatedAt:Date.now(),approval:null,result:null,error:null,transitions:[["awaiting-approval",Date.now()]]};records.push(r);emit();return structuredClone(r);
      }
      if(command==="custom_tool_execute"){window.executions++;return new Promise(resolve=>window.resolveExecution=resolve);}
      if(command==="custom_tool_cancel"){window.finish("cancelled",records.at(-1).state==="running"?"unknown":"none");return;}
      throw Error("Unexpected command "+command);
    }
  `],
]);
const entry = `import React from "react";import {createRoot} from "react-dom/client";import {CustomToolsManager} from "/src/modules/ai/components/CustomToolsManager.tsx";import "/src/styles/globals.css";createRoot(document.getElementById("root")).render(React.createElement(React.StrictMode,null,React.createElement("main",{style:{padding:12,maxWidth:700,margin:"auto",minWidth:0}},React.createElement(CustomToolsManager))));`;
const server = await createServer({root,cacheDir:path.join(os.tmpdir(),"clack-t2-vite-"+process.pid),configFile:false,logLevel:"warn",optimizeDeps:{noDiscovery:true,include:["react","react/jsx-runtime","react-dom/client","zustand","radix-ui","class-variance-authority","clsx","tailwind-merge","@hugeicons/react","@hugeicons/core-free-icons"]},resolve:{alias:{"@":path.join(root,"src")}},plugins:[{
  name:"custom-execution-fixture",enforce:"pre",
  resolveId(source,importer){if(source==="/tools-entry.jsx")return "\0tools-entry.jsx";if(source==="@tauri-apps/api/core")return "\0mock:core";if(source==="@tauri-apps/api/event")return "\0mock:event";const absolute=source.startsWith("/src/")?path.join(root,source.slice(1)):source.startsWith(".")&&importer?path.resolve(path.dirname(importer),source):source;const relative=path.relative(root,absolute).replaceAll("\\","/").replace(/\.[jt]sx?$/,"");return mocks.has(relative)?"\0mock:"+relative:null;},
  load(id){if(id==="\0tools-entry.jsx")return entry;if(id.startsWith("\0mock:"))return mocks.get(id.slice(6));},
  configureServer(vite){vite.middlewares.use("/tools-fixture",async(_req,res)=>{res.setHeader("Content-Type","text/html");res.end(await vite.transformIndexHtml("/tools-fixture",'<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:var(--background);color:var(--foreground)"><div id="root"></div><script type="module" src="/tools-entry.jsx"></script></body></html>'));});},
},react(),tailwindcss()],server:{host:"127.0.0.1",port:0,watch:null,hmr:false}});
let browser;
try {
  await server.listen();
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
  for(const width of [1100,390,280]) {
    console.log(`T2 browser fixture: ${width}px`);
    const page=await browser.newPage({viewport:{width,height:850}});
    page.setDefaultTimeout(20000);
    const errors=[];page.on("pageerror",e=>{errors.push(e.message);console.error(e.message);});
    await page.goto(server.resolvedUrls.local[0]+"tools-fixture",{waitUntil:"networkidle",timeout:120000});
    console.log("T2 fixture loaded");
    const test=page.getByRole("button",{name:/^Test custom_/});
    await test.waitFor().catch(async error => { console.error((await page.locator("body").innerText()).slice(0, 5000)); throw error; });
    await test.focus();await page.keyboard.press("Enter");
    const dialog=page.getByRole("dialog");await dialog.waitFor();
    await dialog.getByRole("textbox",{name:"Test arguments"}).fill('{');
    await dialog.getByRole("button",{name:"Request test",exact:true}).click();
    await dialog.getByRole("alert").filter({hasText:"Invalid argument JSON"}).waitFor();
    await dialog.getByRole("textbox",{name:"Test arguments"}).fill('{"path":"README.md"}');
    for(const state of ["denied","succeeded","failed","cancelled","timed-out","interrupted"]) {
      await dialog.getByRole("button",{name:"Request test",exact:true}).click();
      await dialog.getByRole("status").filter({hasText:"awaiting-approval"}).waitFor();
      await page.waitForFunction(()=>typeof window.resolveExecution==="function");
      if(state!=="denied"){
        await page.evaluate(()=>{window.transition("approved");window.transition("running","possible");});
        await dialog.getByRole("status").filter({hasText:"running"}).waitFor();
      }
      if(state==="cancelled")await dialog.getByRole("button",{name:"Cancel test",exact:true}).click();
      else await page.evaluate(state=>window.finish(state,["interrupted","timed-out"].includes(state)?"unknown":"none"),state);
      await dialog.getByRole("status").filter({hasText:state}).waitFor();
      if(state==="succeeded")await dialog.getByText('"Actual bounded fixture result"',{exact:true}).waitFor();
      await dialog.getByRole("button",{name:"Request test",exact:true}).waitFor();
      const box=await dialog.boundingBox();
      assert.ok(box.x>=0&&box.x+box.width<=width&&box.y>=0&&box.y+box.height<=850);
      assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    }
    await dialog.getByRole("status").filter({hasText:"effect unknown"}).waitFor();
    if(process.env.TOOL_SCREENSHOTS){await mkdir(process.env.TOOL_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.TOOL_SCREENSHOTS,`t2-${width}.png`)});}
    await page.evaluate(()=>window.nullResult=true);
    await dialog.getByRole("button",{name:"Request test",exact:true}).click();
    await dialog.getByRole("status").filter({hasText:"awaiting-approval"}).waitFor();
    await page.waitForFunction(()=>window.executions===7);
    await page.evaluate(()=>window.finish("succeeded"));
    await dialog.getByRole("status").filter({hasText:"succeeded"}).waitFor();
    await dialog.getByText("null",{exact:true}).waitFor();
    await dialog.getByRole("button",{name:"Close",exact:true}).first().click();
    await dialog.waitFor({state:"detached"});
    await page.getByText(/v3: interrupted \/ effect unknown/).waitFor();
    assert.equal(await page.evaluate(()=>window.executions),7);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log("T2 browser checks passed at 1100/390/280px: keyboard, StrictMode, argument error, pending approval, running, denied/success/error/cancel/timeout/interrupted, unknown effect, durable history and long-content bounds. Native IPC/consent are mocked, not native GUI or live HTTP verification.");
} finally { await browser?.close();server.httpServer?.closeAllConnections();await server.close(); }
