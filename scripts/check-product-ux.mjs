// Production Settings and selectors; OS, storage and generation use isolated fixtures.
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
const output = process.env.UX_SCREENSHOTS;
const baseline = process.env.UX_BASELINE === "true";
const mocks = new Map([
  ["@tauri-apps/api/core", `export async function invoke(command,args){window.calls.push([command,args]);if(command==="open_settings_window"){window.openSettings(args.tab);return;}if(command==="self_hosted_profiles_snapshot")return window.hosted?[["selfHostedInference",window.hosted]]:[];if(command==="self_hosted_profiles_compare_and_swap"){if(JSON.stringify(args.expected)!==JSON.stringify(window.hosted??null))return false;window.hosted=args.value;window.prefs.setState({selfHostedInference:args.value});return true;}if(command.startsWith("secrets_"))return null;if(command==="custom_tools_load")return{revision:0,entries:[]};if(command==="custom_tool_history")return[];if(command==="mcp_connections_load")return{revision:0,connections:[]};throw Error("Unexpected IPC "+command);}`],
  ["@tauri-apps/api/event", `export const emit=async()=>{};export const listen=async()=>()=>{};`],
  ["@tauri-apps/api/webviewWindow", `export const getCurrentWebviewWindow=()=>({listen:async()=>()=>{},close:async()=>window.openSettings(null)});`],
  ["@tauri-apps/api/window", `export const getCurrentWindow=()=>({close:async()=>window.openSettings(null)});`],
  ["@tauri-apps/plugin-os", `export const platform=()=>"windows";`],
  ["@tauri-apps/plugin-opener", `export const openUrl=async()=>{throw Error("No external navigation in fixture");};`],
  ["@tauri-apps/plugin-store", `const stores=new Map();export class LazyStore{constructor(name){if(!stores.has(name))stores.set(name,{data:new Map(),listeners:[]});this.s=stores.get(name);}async get(k){return this.s.data.get(k);}async set(k,v){this.s.data.set(k,v);this.s.listeners.forEach(f=>f(k,v));}async delete(k){this.s.data.delete(k);}async save(){}async entries(){return [...this.s.data];}async onChange(f){this.s.listeners.push(f);return()=>{this.s.listeners=this.s.listeners.filter(x=>x!==f);};}}`],
  ["src/settings/sections/GeneralSection", `import React from"react";export const GeneralSection=()=>React.createElement("h1",null,"General settings");`],
  ["src/settings/sections/ThemesSection", `import React from"react";export const ThemesSection=()=>React.createElement("h1",null,"Appearance");`],
  ["src/settings/sections/ShortcutsSection", `import React from"react";export const ShortcutsSection=()=>React.createElement("h1",null,"Keyboard shortcuts");`],
  ["src/settings/sections/AboutSection", `import React from"react";export const AboutSection=()=>React.createElement("h1",null,"About Clack");`],
  ["src/modules/ai/components/CustomToolsManager", `import React from"react";export const CustomToolsManager=()=>React.createElement("h2",null,"Custom tools");`],
  ["src/modules/ai/store/reasoningEffort", `export const sessionEffort=()=>({capability:{status:"unsupported"}});export const setSessionEffort=async()=>{};`],
  ["src/modules/ai/store/peerTaskStore", `export const usePeerTaskStore=selector=>selector({tasks:[]});`],
  ["src/modules/ai/lib/peerTaskCoordinator", `export async function requestPeerTask(request){window.taskRequests.push(request);return{ok:true};}`],
  ["src/modules/ai/lib/composer", `export const ACCEPTED_FILES="";export const useComposer=()=>({});`],
  ["src/modules/ai/store/chatStore", `import{create}from"zustand";const sessions=["a","b"].map(id=>({id,title:"Chat "+id,profile:{agentId:"builtin:coder",modelId:"gpt-5.4-mini",workspaceId:"local:/fixture",workspaceRoot:"/fixture"}}));export const useChatStore=create(()=>({activeSessionId:"a",selectedModelId:"gpt-5.4-mini",sessions,apiKeys:{openai:"synthetic",anthropic:"synthetic"},customEndpointKeys:{},live:{getWorkspaceRoot:()=>"/fixture",getCwd:()=>"/fixture"},setSessionAgentId:(id,agentId)=>{useChatStore.setState(s=>({sessions:s.sessions.map(x=>x.id===id?{...x,profile:{...x.profile,agentId}}:x)}));return true;}}));window.chat=useChatStore;export const capturedAgentPersonas=new Map();export const hasKeyForModel=()=>true;export const getChat=()=>({messages:[]});`],
  ["src/modules/ai/hooks/useModelSelectionLock", `export const useModelSelectionLock=()=>false;`],
  ["src/modules/ai/hooks/useModelSwitch", `import{useChatStore}from"/src/modules/ai/store/chatStore.ts";export const useModelSwitch=id=>({reset:()=>{},checking:false,review:null,failure:null,request:async modelId=>{useChatStore.setState(s=>({sessions:s.sessions.map(x=>x.id===id?{...x,profile:{...x.profile,modelId}}:x)}));return true;}});`],
  ["src/modules/ai/lib/selfHostedProbe", `export const createSelfHostedProbeClient=()=>({read:async()=>null,refresh:async options=>({endpointId:options.endpointId,configurationRevision:1,connected:true,reachable:true,stale:false,refreshing:false,observedAt:Date.now(),models:[{id:"fixture-model",name:"Fixture model",chat:"supported",evidence:[]}],errors:[]}),cancel:async()=>{}});export const probeEvidenceIsFresh=()=>false;export const normalizeProbeError=()=>({message:"Fixture unavailable"});`],
]);
const entry = `
import React,{useState}from"react";import{createRoot}from"react-dom/client";
import{SettingsApp}from"/src/settings/SettingsApp.tsx";
import{ModelDropdown}from"/src/modules/ai/components/AiStatusBarControls.tsx";
import{AgentSwitcher}from"/src/modules/ai/components/AgentSwitcher.tsx";
import{PeerTaskDialog}from"/src/modules/ai/components/PeerTaskDialog.tsx";
import{useChatStore}from"/src/modules/ai/store/chatStore.ts";
import{usePreferencesStore}from"/src/modules/settings/preferences.ts";
import{useAgentsStore}from"/src/modules/ai/store/agentsStore.ts";
import{applyTheme}from"/src/modules/theme/applyTheme.ts";
import{teraxDefault}from"/src/modules/theme/themes/terax-default.ts";
import{sage}from"/src/modules/theme/themes/sage.ts";
import"/src/styles/globals.css";
window.calls=[];window.taskRequests=[];window.prefs=usePreferencesStore;window.agents=useAgentsStore;
window.setTheme=mode=>{document.documentElement.className=mode;applyTheme(mode==="light"?sage:teraxDefault,mode);};
const el=React.createElement;
function Pane({id}){const s=useChatStore(x=>x.sessions.find(s=>s.id===id));return el("section",{"aria-label":"Chat "+id,style:{minWidth:0,padding:12,border:"1px solid var(--border)"}},el("h2",null,s.title),el("div",{style:{display:"flex",flexWrap:"wrap",gap:8}},el(AgentSwitcher,{sessionId:id}),el(ModelDropdown,{sessionId:id})),el("textarea",{"aria-label":"Draft "+id,defaultValue:"PRIVATE_DRAFT_"+id,style:{maxWidth:"100%"}}),el("button",{onClick:()=>window.openTask(id)},"Ask another agent"));}
function App(){const[tab,setTab]=useState(undefined);const[taskFrom,setTaskFrom]=useState(null);window.openTask=setTaskFrom;window.openSettings=value=>{window.history.replaceState({},"",value?"?tab="+value:"/ux-fixture");setTab(value||undefined);};return el(React.Fragment,null,el("div",{hidden:!!tab,style:{padding:12,display:tab?"none":"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(320px,100%),1fr))",gap:8}},el("button",{onClick:()=>window.openSettings("models")},"Settings"),el(Pane,{id:"a"}),el(Pane,{id:"b"})),tab?el("div",{key:tab,style:{position:"absolute",inset:0}},el(SettingsApp)):null,el(PeerTaskDialog,{sourceSessionId:taskFrom||"a",open:!!taskFrom,onOpenChange:open=>{if(!open)setTaskFrom(null);}}));}
createRoot(document.getElementById("root")).render(el(App));
`;
const server = await createServer({root,configFile:false,logLevel:"warn",cacheDir:path.join(os.tmpdir(),`clack-product-ux-${process.pid}`),
  optimizeDeps:{entries:[],noDiscovery:true,include:["react","react-dom/client","react/jsx-runtime","zustand","zod","@hugeicons/react","@hugeicons/core-free-icons","class-variance-authority","radix-ui","clsx","tailwind-merge"]},resolve:{alias:{"@":path.join(root,"src")}},
  plugins:[{name:"product-ux-fixture",enforce:"pre",resolveId(source,importer){if(source==="/ux-entry.jsx")return"\0ux-entry";if(mocks.has(source))return"\0mock:"+source;const absolute=source.startsWith("/src/")?path.join(root,source.slice(1)):source.startsWith(".")&&importer?path.resolve(path.dirname(importer),source):source;const relative=path.relative(root,absolute).replaceAll("\\","/").replace(/\.[jt]sx?$/,"");return mocks.has(relative)?"\0mock:"+relative:null;},load(id){if(id==="\0ux-entry")return entry;if(id.startsWith("\0mock:"))return mocks.get(id.slice(6));},configureServer(vite){vite.middlewares.use("/ux-fixture",async(_req,res)=>{res.setHeader("Content-Type","text/html");res.end(await vite.transformIndexHtml("/ux-fixture",'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:var(--background);color:var(--foreground)"><div id="root"></div><script type="module" src="/ux-entry.jsx"></script></body></html>'));});}},react(),tailwindcss()],server:{host:"127.0.0.1",port:0,watch:null,hmr:false}});
let browser;
try {
  await server.listen();browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
  const results=[];
  for(const [width,zoom] of [[1280,1],[390,1],[320,1],[280,1],[640,2]]) for(const theme of ["dark","light"]) {
    const effectiveWidth=width/zoom;
    const page=await browser.newPage({viewport:{width:effectiveWidth,height:1000/zoom},deviceScaleFactor:zoom});page.setDefaultTimeout(20000);
    const errors=[];page.on("pageerror",error=>{errors.push(error.message);console.error(error.message);});
    await page.goto(server.resolvedUrls.local[0]+"ux-fixture",{waitUntil:"load",timeout:120000});
    await page.getByRole("button",{name:"Settings",exact:true}).waitFor();
    await page.evaluate(theme=>window.setTheme(theme),theme);
    await page.getByRole("button",{name:"Settings",exact:true}).click();
    await page.getByRole("tab",{name:/Models|Connections/}).click();
    await page.getByRole("button",{name:"Add self-hosted server"}).waitFor();
    const section=page.locator("main section").first();
    const bounds=await section.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
    if(bounds.scroll>bounds.width+1)console.log(await section.evaluate(el=>[...el.querySelectorAll("*")].filter(x=>x.getBoundingClientRect().right>el.getBoundingClientRect().right+1).slice(0,8).map(x=>({tag:x.tagName,text:x.textContent.slice(0,120),class:x.className}))));
    if(output){await mkdir(output,{recursive:true});await page.screenshot({animations:"disabled",path:path.join(output,`settings-${width}-${zoom}-${theme}.png`)});}
    if(baseline){results.push({width,zoom,theme,section:bounds,errors});await page.close();continue;}
    assert.ok(bounds.width>=240,"Settings content must remain usable at narrow widths");
    assert.ok(bounds.scroll<=bounds.width+1,"Settings section overflow");
    await page.getByRole("tab",{name:/Keyboard shortcuts/}).focus();await page.keyboard.press("Enter");
    await page.getByRole("heading",{name:"Keyboard shortcuts",exact:true}).waitFor();
    await page.getByRole("tab",{name:/Agents & tools/}).click();await page.getByRole("button",{name:"New agent",exact:true}).click();
    const dialog=page.getByRole("dialog");await dialog.waitFor();
    await page.getByLabel("Name",{exact:true}).fill("UX Reviewer");
    await page.getByLabel("Instructions",{exact:true}).fill("Review code without changing files.");
    assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),"Agent editor overflow");
    await dialog.getByRole("button",{name:/Save/}).click();await dialog.waitFor({state:"detached"});
    assert.equal(await page.getByRole("button",{name:"New agent",exact:true}).evaluate(el=>document.activeElement===el),true,"Agent dialog focus returns to its trigger");
    await page.getByText("UX Reviewer",{exact:true}).first().waitFor();
    const editAgent=page.getByRole("button",{name:"Edit agent UX Reviewer",exact:true});
    await editAgent.click();await dialog.waitFor();await page.keyboard.press("Escape");await dialog.waitFor({state:"detached"});
    assert.equal(await editAgent.evaluate(el=>document.activeElement===el),true,"Escape returns focus to the specific edit control");
    await page.getByRole("button",{name:"Close",exact:true}).click();
    assert.equal(await page.getByLabel("Draft a").inputValue(),"PRIVATE_DRAFT_a");
    const a=page.getByRole("region",{name:"Chat a",exact:true}),b=page.getByRole("region",{name:"Chat b",exact:true});
    await a.getByRole("button",{name:/Change agent/}).click();await page.getByRole("menuitem").filter({hasText:"UX Reviewer"}).click();
    assert.equal(await page.evaluate(()=>window.chat.getState().sessions.find(s=>s.id==="a").profile.agentId),await page.evaluate(()=>window.agents.getState().customAgents[0].id));
    assert.equal(await page.evaluate(()=>window.chat.getState().sessions.find(s=>s.id==="b").profile.agentId),"builtin:coder");
    await a.getByRole("button",{name:/Change model/}).click();await page.getByLabel("Search models").fill("Claude Sonnet 4.6");
    const model=page.getByRole("menuitem",{name:"Claude Sonnet 4.6. Cloud connection",exact:true});
    await model.waitFor();
    assert.ok(await page.getByRole("menu").evaluate(el=>el.scrollWidth<=el.clientWidth+1 && el.getBoundingClientRect().right<=innerWidth && el.getBoundingClientRect().left>=0),"Model menu fits the viewport");
    if(output)await page.screenshot({animations:"disabled",path:path.join(output,`model-${width}-${zoom}-${theme}.png`)});
    await model.click();
    await a.getByRole("button",{name:/Claude Sonnet/}).waitFor();
    assert.equal(await page.evaluate(()=>window.chat.getState().sessions.find(s=>s.id==="a").id),"a");
    assert.equal(await page.evaluate(()=>window.chat.getState().sessions.find(s=>s.id==="b").profile.modelId),"gpt-5.4-mini");
    assert.equal(await b.getByLabel("Draft b").inputValue(),"PRIVATE_DRAFT_b");
    await b.getByRole("button",{name:"Ask another agent",exact:true}).click();await dialog.waitFor();
    const task=dialog.getByRole("textbox",{name:"Task",exact:true});
    await task.fill("Review code without changing files.");
    assert.equal(await task.evaluate(el=>document.activeElement===el),true,"Task prompt receives keyboard focus");
    await dialog.getByRole("button",{name:"Review",exact:true}).click();
    assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1 && el.getBoundingClientRect().bottom<=innerHeight+1),"Task dialog fits the viewport");
    if(output)await page.screenshot({animations:"disabled",path:path.join(output,`task-${width}-${zoom}-${theme}.png`)});
    await dialog.getByRole("button",{name:"Send task",exact:true}).click();await dialog.waitFor({state:"detached"});
    assert.deepEqual(await page.evaluate(()=>window.taskRequests.map(({sourceSessionId,targetSessionId,kind,executionMode,attachmentReferences})=>({sourceSessionId,targetSessionId,kind,executionMode,attachmentReferences}))),[{sourceSessionId:"b",targetSessionId:"a",kind:"review",executionMode:"read-only",attachmentReferences:[]}]);
    assert.equal(await b.getByLabel("Draft b").inputValue(),"PRIVATE_DRAFT_b");
    assert.deepEqual(errors,[]);results.push({width,zoom,effectiveWidth,theme,status:"passed"});await page.close();
  }
  console.log(JSON.stringify({fixture:"production-settings-and-selectors",baseline,results},null,2));
} finally {await browser?.close();await server.close();}
