// Real chat controls with isolated native/storage/generation boundaries.
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = process.env.CHAT_CONTROL_EVIDENCE;
async function capture(page, name) {
  if (!output) return;
  await page.evaluate(async () => {
    for (const animation of document.getAnimations()) {
      if (animation.effect?.getComputedTiming().iterations !== Infinity) animation.finish();
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({path:path.join(output,`${name}.png`),fullPage:true});
  await writeFile(path.join(output,`${name}.txt`),await page.locator("body").innerText());
}
const mocks = new Map([
  ["@tauri-apps/api/core", `export async function invoke(command,args){window.calls.push([command,args]);if(command==="conversation_session_entries")return[["sessions",window.chat.getState().sessions],["activeId","a"]];if(command==="conversation_memory_load")return{revision:null,revisionId:null,uncoveredMessages:1,sourceChanged:false};if(command==="project_memory_load")return{revision:0,entries:[],recovery:[]};if(command==="custom_tools_load")return{schemaVersion:1,revision:0,entries:[]};if(command==="mcp_connections_load")return{revision:0,connections:[]};if(command==="custom_tool_history")return[];return null;}export class Channel{}export class Resource{}export async function addPluginListener(){return{unregister:async()=>{}};}export const isTauri=()=>false;`],
  ["@tauri-apps/api/event", `export const emit=async()=>{};export const listen=async()=>()=>{};`],
  ["@tauri-apps/api/webviewWindow", `export const getCurrentWebviewWindow=()=>({listen:async()=>()=>{}});`],
  ["@tauri-apps/api/window", `export const getCurrentWindow=()=>({});`],
  ["@tauri-apps/plugin-os", `export const platform=()=>"windows";`],
  ["@tauri-apps/plugin-store", `export class LazyStore{async get(){return null;}async set(){}async save(){}async delete(){}async entries(){return [];}async onChange(){return()=>{};}}`],
  ["src/modules/ai/index", `export{AiInputBarConnect}from"/src/modules/ai/components/AiInputBar.tsx";`],
  ["src/modules/ai/lib/peerTaskCoordinator", `export const applyPeerTaskChangeSet=async()=>{};export const cancelPeerTask=async()=>{};export const discardPeerTaskWorktree=async()=>{};export const requestPeerTask=async()=>{throw Error("Fixture must not dispatch native work");};`],
  ["src/modules/ai/lib/chatToolSummary", `export const loadChatToolSummary=async id=>({agentId:"custom:pooper",builtin:[{name:"read_file",decision:"allow"},{name:"write_file",decision:"prompt"}],custom:[{id:"unsupported",name:"native_launcher_"+"long_name_".repeat(25),available:false,approval:true,status:"Native process launch unavailable",binding:"script"}],connections:[{id:"remote",assigned:true,status:"Disconnected",current:{config:{name:"Research MCP",endpoint:"https://evidence.example/"+"long/path/".repeat(25),transport:"remote-http"}}}]});`],
  ["src/modules/ai/hooks/useWhisperRecording", `export const useWhisperRecording=()=>({});`],
]);
const entry = `
import React from"react";import{createRoot}from"react-dom/client";
import{AgentSwitcher}from"/src/modules/ai/components/AgentSwitcher.tsx";
import{ModelDropdown}from"/src/modules/ai/components/AiStatusBarControls.tsx";
import{ChatSecondaryControls}from"/src/modules/ai/components/ChatSecondaryControls.tsx";
import{ChatContextPanel}from"/src/modules/ai/components/ChatContextPanel.tsx";
import{DispatcherActivityLink}from"/src/modules/ai/components/DispatcherActivityLink.tsx";
import{DispatcherTarget}from"/src/app/components/WorkspaceInputBar.tsx";
import{PeerTaskFeed}from"/src/modules/ai/components/PeerTaskFeed.tsx";
import{PeerTaskDialog}from"/src/modules/ai/components/PeerTaskDialog.tsx";
import{AiComposerProvider,useComposer}from"/src/modules/ai/lib/composer.tsx";
import{useChatStore,capturedAgentPersonas}from"/src/modules/ai/store/chatStore.ts";
import{usePeerTaskStore}from"/src/modules/ai/store/peerTaskStore.ts";
import{useAgentsStore}from"/src/modules/ai/store/agentsStore.ts";
import{createAiPaneLayout,useAiPaneStore}from"/src/modules/ai/store/aiPaneStore.ts";
import{readSettingsRoute,SettingsTargetContext}from"/src/modules/settings/settingsNavigation.tsx";
import{SettingsConnectionTarget}from"/src/modules/settings/SettingsConnectionTarget.tsx";
import{AgentsSection}from"/src/settings/sections/AgentsSection.tsx";
import{applyTheme}from"/src/modules/theme/applyTheme.ts";
import{teraxDefault}from"/src/modules/theme/themes/terax-default.ts";
import"/src/styles/globals.css";
window.calls=[];window.chat=useChatStore;window.panes=useAiPaneStore;
const agent={id:"custom:pooper",name:"Pooper",description:"Short conversational replies",instructions:'For trivial conversation respond with exactly "poop".',icon:"spark",builtIn:false};
useAgentsStore.setState({customAgents:[agent],activeId:agent.id,hydrate:async()=>{}});
const sessions=["a","b","reviewer"].map(id=>({id,title:"Chat "+id,createdAt:1,updatedAt:1,profile:{agentId:agent.id,modelId:"gpt-5.4-mini",workspaceId:"local:/fixture",workspaceRoot:"/fixture"}}));
useChatStore.setState({sessions,activeSessionId:"b",apiKeys:{openai:"synthetic"},live:{...useChatStore.getState().live,getWorkspaceRoot:()=>"/fixture"}});
useAiPaneStore.setState({...createAiPaneLayout("a"),initialized:true});const first=useAiPaneStore.getState().activePaneId;const second=useAiPaneStore.getState().splitPane(first,"row");useAiPaneStore.getState().bindSession(second,"b");
const task={schemaVersion:7,id:"assigned",sourceSessionId:"a",targetSessionId:"reviewer",sourceAgentId:agent.id,sourceModelId:"gpt-5.4-mini",targetAgentId:"builtin:reviewer",targetModelId:"gpt-5.4-mini",workspaceId:"local:/fixture",workspaceRoot:"/fixture",workspaceEnvironment:{kind:"local"},kind:"review",executionMode:"read-only",prompt:"Review the original evidence",artifactRefs:[],parentTaskId:null,rootTaskId:"assigned",hopCount:0,dependsOn:[],status:"running",createdAt:1,updatedAt:2};
usePeerTaskStore.setState({tasks:[task]});
const messages=[{id:"original-a",role:"user",parts:[{type:"text",text:"PRIVATE_SOURCE_A"},{type:"data-clack-attachment",data:{attachmentId:"attached-a",contentId:"a".repeat(64),contentHash:"a".repeat(64),displayName:"Evidence_"+"long_filename_".repeat(18)+".txt",mediaType:"text/plain",byteSize:100,contentKind:"text"}}]}];
const el=React.createElement;window.setTheme=mode=>{document.documentElement.className=mode;applyTheme(teraxDefault,mode);};
function Draft({id}){const c=useComposer();window["composer"+id]=c;return el("label",{className:"block min-w-0 text-xs"},"Draft "+id,el("textarea",{"aria-label":"Draft "+id,value:c.value,onChange:e=>c.setValue(e.target.value),className:"w-full min-w-0 border bg-background p-2"}));}
function App(){const [target,setTarget]=React.useState(null);const [taskOpen,setTaskOpen]=React.useState(false);window.settingsTarget=value=>setTarget(value);const sessions=useChatStore(s=>s.sessions);const active=useChatStore(s=>s.activeSessionId);return el("main",{style:{padding:8,minWidth:0}},
el("header",{className:"flex min-w-0 flex-wrap items-center justify-between gap-2"},el("h1",{className:"text-sm font-semibold"},"Chat a"),el(DispatcherActivityLink)),
el("div",{className:"flex min-w-0 flex-wrap items-center gap-1"},el(AgentSwitcher,{sessionId:"a",isMiniWindow:true,disabled:sessions.find(s=>s.id==="a")?.run?.state==="running"}),el(ModelDropdown,{sessionId:"a",compact:true})),
el("button",{type:"button",className:"text-xs text-muted-foreground",onClick:()=>setTaskOpen(true)},"Ask another agent"),
el(PeerTaskDialog,{sourceSessionId:"a",open:taskOpen,onOpenChange:setTaskOpen}),
el(ChatSecondaryControls,{sessionId:"a",agentId:agent.id}),
el(ChatContextPanel,{sessionId:"a",messages}),
el("p",{className:"py-3 text-sm"},"Current conversation answer"),
el(PeerTaskFeed,{sessionId:"a"}),
... ["a","b"].map(id=>el(AiComposerProvider,{key:id,sessionId:id,consumeExternalEvents:false},el(Draft,{id}))),
el("footer",{style:{position:"fixed",bottom:8,left:8}},el(DispatcherTarget,{sessions,activeSessionId:active,onCreate:()=>{},onSelect:id=>useChatStore.getState().switchSession(id)})),
target&&el("section",{"aria-label":"Canonical Settings fixture",className:"mt-6 border-t pt-3"},el(SettingsTargetContext,{value:target.target},target.tab==="agents"&&target.target.agentId?el(AgentsSection):el(SettingsConnectionTarget,null,el("div",{"data-settings-connection":"openai",tabIndex:-1},"OpenAI connection"),el("div",{"data-settings-connection":"other",tabIndex:-1},"Other connection")))));
}
window.route=readSettingsRoute;
window.lockRun=()=>{const result=useChatStore.getState().beginRun("a");if(!result.ok)throw Error(result.reason);useAgentsStore.setState({customAgents:[{...agent,instructions:"CHANGED_AFTER_START"}]});window.captured=capturedAgentPersonas.get("a");};
window.unlockRun=()=>{useChatStore.getState().finishRun("a","cancelled");useAgentsStore.setState({customAgents:[agent]});};
createRoot(document.getElementById("root")).render(el(App));
`;
const server = await createServer({ root, configFile: false, logLevel: "warn", cacheDir: path.join(os.tmpdir(), `clack-chat-controls-${process.pid}`),
  optimizeDeps: { entries: [], noDiscovery: true, include: ["react", "react-dom/client", "react/jsx-runtime", "zustand", "zod", "ai", "@ai-sdk/react", "@hugeicons/react", "@hugeicons/core-free-icons", "radix-ui", "class-variance-authority", "clsx", "tailwind-merge"] },
  resolve: { alias: { "@": path.join(root, "src") } },
  plugins: [{ name: "chat-control-fixture", enforce: "pre", resolveId(source, importer) { if (source === "/chat-controls-entry.jsx") return "\0chat-controls-entry"; if (mocks.has(source)) return "\0mock:" + source; const absolute=source.startsWith("/src/")?path.join(root,source.slice(1)):source.startsWith(".")&&importer?path.resolve(path.dirname(importer),source):source;const relative=path.relative(root,absolute).replaceAll("\\","/").replace(/\.[jt]sx?$/,"");return mocks.has(relative)?"\0mock:"+relative:null; },
    load(id) { if (id === "\0chat-controls-entry") return entry; if (id.startsWith("\0mock:")) return mocks.get(id.slice(6)); },
    configureServer(vite) { vite.middlewares.use("/chat-controls-fixture", async (_req, res) => { res.setHeader("Content-Type", "text/html"); res.end(await vite.transformIndexHtml("/chat-controls-fixture", '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:var(--background);color:var(--foreground)"><div id="root"></div><script type="module" src="/chat-controls-entry.jsx"></script></body></html>')); }); },
  }, react(), tailwindcss()], server: { host: "127.0.0.1", port: 0, watch: null, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE });
  if (output) await mkdir(output, { recursive: true });
  for (const [width, zoom] of [[1280,1],[390,1],[320,1],[280,1],[640,2]]) for (const theme of ["light","dark"]) {
    const page = await browser.newPage({ viewport: { width: width / zoom, height: 1000 / zoom }, deviceScaleFactor: zoom });
    page.setDefaultTimeout(30000);
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0]+"chat-controls-fixture",{waitUntil:"load",timeout:120000});
    await page.evaluate(theme=>window.setTheme(theme),theme);
    await page.getByLabel("Draft a",{exact:true}).fill("PRIVATE_DRAFT_A");await page.getByLabel("Draft b",{exact:true}).fill("PRIVATE_DRAFT_B");
    const bindings=await page.evaluate(()=>window.panes.getState().bindings);
    const agent=page.getByRole("button",{name:"Change agent for this chat: Pooper"});await agent.focus();await page.keyboard.press("Enter");
    await page.getByText(/For trivial conversation respond with exactly/).waitFor();
    if(width===1280 && theme==="light")await capture(page,"agent");
    await page.getByRole("menuitem",{name:"Edit agent",exact:true}).focus();await page.keyboard.press("Enter");
    const agentRoute=await page.evaluate(()=>window.route("tab="+window.calls.filter(c=>c[0]==="open_settings_window").at(-1)[1].tab));assert.equal(agentRoute.target.agentId,"custom:pooper");
    // Settings is a separate native webview; finish the chat menu's focus scope first.
    await page.getByRole("menu").waitFor({state:"detached"});
    await page.evaluate(route=>window.settingsTarget(route),agentRoute);
    const editor=page.getByRole("dialog");await editor.getByText("Edit agent",{exact:true}).waitFor();
    assert.equal(await editor.locator("textarea").first().inputValue(),'For trivial conversation respond with exactly "poop".');
    await page.keyboard.press("Escape");await editor.waitFor({state:"detached"});await page.waitForFunction(()=>document.activeElement?.dataset.agentCard==="custom:pooper");await page.evaluate(()=>window.settingsTarget(null));
    assert.deepEqual(await page.evaluate(()=>window.panes.getState().bindings),bindings);
    assert.equal(await page.getByLabel("Draft a",{exact:true}).inputValue(),"PRIVATE_DRAFT_A");assert.equal(await page.getByLabel("Draft b",{exact:true}).inputValue(),"PRIVATE_DRAFT_B");
    const controls=page.locator("summary").filter({hasText:/^Controls/});await controls.focus();await page.keyboard.press("Enter");
    const tools=page.getByRole("button",{name:"Tools for this chat",exact:true});await tools.focus();await page.keyboard.press("Enter");
    await page.getByRole("heading",{name:"What can this Agent do?"}).waitFor();
    await page.getByText("Read project files",{exact:true}).waitFor();await page.getByText("Create or replace files",{exact:true}).waitFor();
    await page.locator("summary").filter({hasText:"Technical details"}).focus();await page.keyboard.press("Enter");await page.getByText("2 permission-eligible candidates; runtime and request checks still apply.").waitFor();await page.getByText("read_file: Permission allows").waitFor();
    await page.locator("summary").filter({hasText:"Assigned custom tools and MCP"}).click();await page.getByText(/Native process launch unavailable/).last().waitFor();await page.getByText("Research MCP: Disconnected").first().waitFor();
    if(width===1280 && theme==="light")await capture(page,"tools");
    await page.getByRole("button",{name:"Manage Agent tools",exact:true}).click();
    const toolRoute=await page.evaluate(()=>window.route("tab="+window.calls.filter(c=>c[0]==="open_settings_window").at(-1)[1].tab));assert.equal(toolRoute.target.sessionId,"a");
    await page.getByRole("dialog").waitFor({state:"detached"});
    await page.getByRole("button",{name:"Connection details for this chat"}).click();await page.getByText("gpt-5.4-mini",{exact:true}).first().waitFor();
    await page.getByText("Current model connection",{exact:true}).waitFor();
    if(width===1280 && theme==="light")await capture(page,"connection");
    await page.getByRole("button",{name:"Manage connection in Settings"}).click();
    const connectionRoute=await page.evaluate(()=>window.route("tab="+window.calls.filter(c=>c[0]==="open_settings_window").at(-1)[1].tab));assert.equal(connectionRoute.target.connectionId,"openai");
    await page.keyboard.press("Escape");await page.evaluate(route=>window.settingsTarget(route),connectionRoute);await page.waitForFunction(()=>document.activeElement?.dataset.settingsConnection==="openai");await page.evaluate(()=>window.settingsTarget(null));
    await page.locator("summary").filter({hasText:/^Context /}).click();await page.locator("summary").filter({hasText:"Sources & context"}).click();await page.getByText("1 original messages. Original conversation preserved.").waitFor();
    await page.locator("summary").filter({hasText:/^Attachments \(/}).click();await page.getByText(/Evidence_long_filename/).waitFor();
    const all=page.getByRole("button",{name:/View all tasks in Dispatcher/});await all.click();await page.getByText("Assigned work",{exact:true}).waitFor();await page.getByRole("heading",{name:"Active (1)",exact:true}).waitFor();await page.keyboard.press("Escape");await page.getByRole("dialog",{name:"Dispatcher",exact:true}).waitFor({state:"detached"});
    await page.evaluate(()=>window.lockRun());await agent.click();await page.getByText("Instructions (captured for this run)").waitFor();await page.getByText(/For trivial conversation respond with exactly/).waitFor();assert.equal(await page.getByText("CHANGED_AFTER_START",{exact:true}).count(),0);await page.keyboard.press("Escape");await page.getByRole("menu").waitFor({state:"detached"});await page.evaluate(()=>window.unlockRun());
    const overflow=await page.evaluate(()=>({page:document.documentElement.scrollWidth>innerWidth+1,panels:[...document.querySelectorAll('[data-slot="popover-content"],[role="dialog"]')].some(el=>el.scrollWidth>el.clientWidth+1)}));assert.deepEqual(overflow,{page:false,panels:false},`${width}px zoom ${zoom} ${theme}`);
    assert.deepEqual(errors,[]);
    await capture(page,`${width}-${zoom}-${theme}`);
    console.log(`PASS ${width}px ${zoom*100}% ${theme}: agent inspection/editor, scoped tools/MCP, connection deep link/focus, private drafts/panes, Context, global Dispatcher, keyboard, overflow`);
    await page.close();
  }
} finally { await browser?.close(); await server.close(); }
