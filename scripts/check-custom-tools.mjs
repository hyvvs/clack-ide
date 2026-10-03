import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"playwright");
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const mocks=new Map([
  ["src/modules/ai/lib/sessions",`export const loadAll=async()=>({activeId:"chat",sessions:[{id:"chat",title:"Project chat",profile:{agentId:"builtin:coder",workspaceId:"local:/work",workspaceRoot:"/work"}}]});`],
  ["src/modules/ai/lib/permissions",`export const resolveCurrentAgentPermission=()=>({outcome:"allow"});`],
  ["src/modules/ai/store/agentsStore",`import {create} from "zustand";export const useAgentsStore=create(()=>({customAgents:[],all:()=>[{id:"builtin:coder",name:"Coder"},{id:"builtin:reviewer",name:"Reviewer"}]}));`],
  ["core",`
    const registry={schemaVersion:1,revision:0,entries:[]};window.toolRegistry=registry;
    export async function invoke(command,args){
      if(command==="custom_tools_load")return structuredClone(registry);
      if(command==="custom_tools_validate"){
        if(!args.definition.description||args.definition.inputSchema.type!=="object"||args.definition.inputSchema.$ref)throw Error("tool_schema_invalid");
        return "a".repeat(64);
      }
      if(command!=="custom_tools_change")throw Error("Unexpected command "+command);
      if(args.expectedRevision!==registry.revision)throw Error("tool_stale_revision");
      window.nativeConsentRequests=(window.nativeConsentRequests||0)+1;
      const change=args.change;
      if(change.action==="create")registry.entries.push({id:"tool-"+registry.revision,workspaceId:"local:/work",current:{version:1,hash:"a".repeat(64),definition:change.definition,status:"draft",enabled:false,source:"native-user",sessionId:"chat",agentId:"builtin:coder",createdAt:1},versions:[],executable:false,eligible:false,runtime:"Execution pending"});
      else {const entry=registry.entries.find(e=>e.id===change.id);entry.versions.push(structuredClone(entry.current));entry.current={...entry.current,version:entry.current.version+1};if(change.action==="edit"){entry.current.definition=change.definition;entry.current.status="draft";entry.current.enabled=false;}if(change.action==="authorize")entry.current.status="authorized";if(change.action==="enable")entry.current.enabled=true;if(change.action==="disable")entry.current.enabled=false;if(change.action==="revoke"||change.action==="remove"){entry.current.status=change.action==="remove"?"removed":"revoked";entry.current.enabled=false;}}
      registry.revision++;return structuredClone(registry);
    }
  `],
  ["event",`window.toolListeners=new Set();export const listen=async(_name,callback)=>{window.toolListeners.add(callback);return ()=>window.toolListeners.delete(callback);};`],
]);
const entry=`import React from "react";import {createRoot} from "react-dom/client";import {CustomToolsManager} from "/src/modules/ai/components/CustomToolsManager.tsx";import "/src/styles/globals.css";createRoot(document.getElementById("root")).render(React.createElement("main",{style:{padding:12,maxWidth:700,margin:"auto",minWidth:0}},React.createElement(CustomToolsManager)));`;
const server=await createServer({root,cacheDir:path.join(os.tmpdir(),"clack-t1-vite-"+process.pid),configFile:false,logLevel:"warn",optimizeDeps:{noDiscovery:true,include:["react","react/jsx-runtime","react-dom/client","zustand","radix-ui","class-variance-authority","clsx","tailwind-merge","@hugeicons/react","@hugeicons/core-free-icons"]},resolve:{alias:{"@":path.join(root,"src")}},plugins:[{
  name:"custom-tools-fixture",enforce:"pre",
  resolveId(source,importer){if(source==="/tools-entry.jsx")return "\0tools-entry.jsx";if(source==="@tauri-apps/api/core")return "\0mock:core";if(source==="@tauri-apps/api/event")return "\0mock:event";const absolute=source.startsWith("/src/")?path.join(root,source.slice(1)):source.startsWith(".")&&importer?path.resolve(path.dirname(importer),source):source;const relative=path.relative(root,absolute).replaceAll("\\","/").replace(/\.[jt]sx?$/,"");return mocks.has(relative)?"\0mock:"+relative:null;},
  load(id){if(id==="\0tools-entry.jsx")return entry;if(id.startsWith("\0mock:"))return mocks.get(id.slice(6));},
  configureServer(vite){vite.middlewares.use("/tools-fixture",async(_req,res)=>{res.setHeader("Content-Type","text/html");res.end(await vite.transformIndexHtml("/tools-fixture",'<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:var(--background);color:var(--foreground)"><div id="root"></div><script type="module" src="/tools-entry.jsx"></script></body></html>'));});},
},react(),tailwindcss()],server:{host:"127.0.0.1",port:0}});
let browser;
try{
  await server.listen();browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
  for(const width of [1100,390,280]){
    const page=await browser.newPage({viewport:{width,height:850}});page.setDefaultTimeout(20000);const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0]+"tools-fixture",{waitUntil:"networkidle",timeout:120000});
    await page.getByRole("button",{name:"New tool",exact:true}).focus();await page.keyboard.press("Enter");
    const dialog=page.getByRole("dialog");await dialog.waitFor();
    await page.getByRole("textbox",{name:"Tool name",exact:true}).fill("custom_read");
    await page.getByRole("textbox",{name:"Tool description",exact:true}).fill("Source-linked output ".repeat(90));
    await page.getByRole("textbox",{name:"Input schema",exact:true}).fill("{");await page.getByRole("button",{name:"Validate",exact:true}).click();await page.getByText("Invalid JSON in schema or binding.").waitFor();
    await page.getByRole("textbox",{name:"Input schema",exact:true}).fill('{"type":"object","properties":{},"additionalProperties":false}');
    await page.getByRole("checkbox",{name:"Reviewer",exact:true}).check();
    await page.getByRole("button",{name:"Validate",exact:true}).click();await page.getByRole("status").filter({hasText:"Valid definition"}).waitFor();
    const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width&&box.y>=0&&box.y+box.height<=850);assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    if(process.env.TOOL_SCREENSHOTS){await mkdir(process.env.TOOL_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.TOOL_SCREENSHOTS,`t1-${width}.png`)});}
    await page.getByRole("button",{name:"Save draft",exact:true}).click();await dialog.waitFor({state:"detached"});
    assert.deepEqual(await page.evaluate(()=>window.toolRegistry.entries[0].current.definition.agents),["builtin:coder","builtin:reviewer"]);
    await page.getByRole("button",{name:"Review registration",exact:true}).click();await page.getByRole("button",{name:"Authorize registration",exact:true}).click();await dialog.waitFor({state:"detached"});
    await page.getByRole("checkbox",{name:"Enable custom_read",exact:true}).check();assert.equal(await page.evaluate(()=>window.toolRegistry.entries[0].current.enabled),true);
    await page.getByRole("checkbox",{name:"Enable custom_read",exact:true}).uncheck();
    await page.getByRole("button",{name:"Inspect custom_read",exact:true}).click();await page.getByRole("textbox",{name:"Tool name",exact:true}).fill("custom_renamed");await page.getByRole("button",{name:"Save new version",exact:true}).click();await dialog.waitFor({state:"detached"});
    assert.equal(await page.evaluate(()=>window.toolRegistry.entries.length),1);
    await page.getByRole("button",{name:"Revoke",exact:true}).click();await page.getByText(/revoked · Disabled definition/).waitFor();
    await page.getByRole("button",{name:"Remove custom_renamed",exact:true}).click();await page.getByText(/removed · Disabled definition/).waitFor();
    assert.equal(await page.getByRole("button",{name:/^(Run|Test)$/}).count(),0);
    await page.evaluate(()=>{
      const proposal=structuredClone(window.toolRegistry.entries[0]);proposal.id="proposal";proposal.versions=[];
      proposal.current={...proposal.current,version:1,status:"proposed",source:"agent-proposal",runId:10,definition:{...proposal.current.definition,name:"custom_proposed"}};
      window.toolRegistry.entries.push(proposal);window.toolRegistry.revision++;for(const listener of window.toolListeners)listener();
    });
    await page.getByRole("button",{name:"Review registration",exact:true}).click();
    await dialog.getByText(/agent-proposal/).waitFor();
    await page.evaluate(()=>{window.toolRegistry.revision++;for(const listener of window.toolListeners)listener();});
    await page.getByRole("button",{name:"Authorize registration",exact:true}).click();
    await dialog.getByRole("alert").filter({hasText:"tool_stale_revision"}).waitFor();
    assert.equal(await page.evaluate(()=>window.toolRegistry.entries[1].current.status),"proposed");
    await dialog.getByRole("button",{name:"Close",exact:true}).first().click();
    await page.getByRole("button",{name:"Review registration",exact:true}).click();
    await page.getByRole("button",{name:"Authorize registration",exact:true}).click();await dialog.waitFor({state:"detached"});
    assert.equal(await page.evaluate(()=>window.toolRegistry.entries[1].current.status),"authorized");
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log("T1 browser checks passed at 1100/390/280px: create, validation, assignment, agent proposal review, stale editor rejection, authorization request, enable/disable, versioned rename, revoke/remove, keyboard and bounded long-content layout. Native consent is mocked, not native GUI verification.");
}finally{await browser?.close();await server.close();}
