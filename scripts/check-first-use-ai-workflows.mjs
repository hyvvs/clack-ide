import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mocks = new Map([
  ["@tauri-apps/api/core", `export async function invoke(command,args){window.calls.push([command,args]);if(command==="fs_canonicalize")return args.path;if(command==="fs_stat")return{kind:"file",size:3,mtime:1};if(command==="git_resolve_repo")return{repoRoot:"/fixture"};if(command==="git_status")return{repoRoot:"/fixture",truncated:false,changedFiles:window.gitDirty?[{}]:[]};if(command==="attachment_store_get")return new TextEncoder().encode("abc").buffer;if(command==="custom_tool_history")return[];if(command==="peer_ledger_commit"){window.durable=structuredClone(args.tasks);return args.expected+1;}return null;}export class Channel{}export class Resource{}export async function addPluginListener(){return{unregister:async()=>{}};}export const isTauri=()=>false;`],
  ["@tauri-apps/api/event", `export const emit=async()=>{};export const listen=async()=>()=>{};`],
  ["@tauri-apps/api/webviewWindow", `export const getCurrentWebviewWindow=()=>({listen:async()=>()=>{}});`],
  ["@tauri-apps/api/window", `export const getCurrentWindow=()=>({});`],
  ["@tauri-apps/plugin-os", `export const platform=()=>"windows";`],
  ["@tauri-apps/plugin-store", `export class LazyStore{async get(){return null;}async set(){}async save(){}async delete(){}async entries(){return [];}async onChange(){return()=>{};}}`],
  ["src/modules/ai/index", `export{AiInputBarConnect}from"/src/modules/ai/components/AiInputBar.tsx";`],
  ["src/modules/ai/lib/peerTaskCoordinator", `export const applyPeerTaskChangeSet=async id=>{window.calls.push(["fixture-apply",id]);window.tasks.setState(s=>({tasks:s.tasks.map(t=>t.id===id?{...t,changeSet:{...t.changeSet,appliedAt:5}}:t)}));return{ok:true};};export const cancelPeerTask=async()=>{};export const discardPeerTaskWorktree=async()=>{};export const requestPeerTask=async request=>{window.retryRequests.push(request);await new Promise(resolve=>window.finishRetry=resolve);const original=window.tasks.getState().tasks.find(t=>t.id===request.retryOfTaskId);const task={...original,id:"retry-attempt",parentTaskId:original.id,retryOfTaskId:original.id,status:"queued",error:undefined,updatedAt:100};window.tasks.setState(s=>({tasks:[task,...s.tasks]}));return{ok:true,task};};`],
]);
const entry = `
import React from"react";import{createRoot}from"react-dom/client";
import{DispatcherTarget}from"/src/app/components/WorkspaceInputBar.tsx";
import{PeerTaskFeed}from"/src/modules/ai/components/PeerTaskFeed.tsx";
import{chats,useChatStore}from"/src/modules/ai/store/chatStore.ts";
import{usePeerTaskStore}from"/src/modules/ai/store/peerTaskStore.ts";
import{createAiPaneLayout,useAiPaneStore}from"/src/modules/ai/store/aiPaneStore.ts";
import{ModelSwitchNotice}from"/src/modules/ai/components/ModelSwitchNotice.tsx";
import{applyTheme}from"/src/modules/theme/applyTheme.ts";
import{teraxDefault}from"/src/modules/theme/themes/terax-default.ts";
import{usePreferencesStore}from"/src/modules/settings/preferences.ts";
import{putBgImage}from"/src/modules/theme/bgImageStore.ts";
import{SurfaceLayer}from"/src/modules/theme/SurfaceLayer.tsx";
import"/src/styles/globals.css";
const sessions=["a","b","reviewer"].map(id=>({id,title:"Parent "+id,createdAt:1,updatedAt:1,profile:{agentId:"builtin:coder",modelId:"gpt-5.4-mini",workspaceId:"local:/fixture",workspaceRoot:"/fixture"}}));
const task={schemaVersion:7,id:"assigned",sourceSessionId:"a",targetSessionId:"reviewer",sourceAgentId:"builtin:coder",sourceModelId:"gpt-5.4-mini",targetAgentId:"builtin:reviewer",targetModelId:"gpt-5.4-mini",workspaceId:"local:/fixture",workspaceRoot:"/fixture",workspaceEnvironment:{kind:"local"},kind:"review",executionMode:"read-only",prompt:"Review the bounds",artifactRefs:[],parentTaskId:null,rootTaskId:"assigned",hopCount:0,dependsOn:[],status:"running",createdAt:1,updatedAt:2};
window.calls=[];window.files=[];window.sourceControl=0;
useChatStore.setState({sessions,activeSessionId:"b",live:{...useChatStore.getState().live,getWorkspaceRoot:()=>"/fixture",openWorkspaceFile:path=>{window.files.push(path);window.openFile(path);},openWorkspaceSourceControl:()=>window.sourceControl++}});window.chat=useChatStore;window.tasks=usePeerTaskStore;window.assigned=task;window.opened=[];
useAiPaneStore.setState({...createAiPaneLayout("b"),initialized:true});window.panes=useAiPaneStore;
const result=(summary,artifacts=[])=>({summary,artifacts,targetSessionId:"reviewer",targetAgentId:task.targetAgentId,targetModelId:task.targetModelId,completedAt:4});
const hash="ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
window.assign=()=>usePeerTaskStore.setState({tasks:[task,{...task,id:"other",sourceSessionId:"b",prompt:"Different chat's work",updatedAt:3},
{...task,id:"changes",status:"completed",prompt:"Create project README",executionMode:"isolated-worktree",changeSet:{baseSha:"base",patch:"diff --git a/README.md b/README.md\\n+Project README",changedPaths:["README.md"]}},
{...task,id:"returned",status:"completed",prompt:"Return the report",result:result("Report ready",[{id:"artifact",attachmentId:"attachment",contentRef:{id:hash,contentHash:hash,byteSize:3},displayName:"report.md",mediaType:"text/plain",contentKind:"text",byteSize:3,sourceSessionId:"reviewer",sourceTaskId:"returned",sourceAgentId:task.targetAgentId,sourceModelId:task.targetModelId,workspaceId:task.workspaceId,workspaceRoot:task.workspaceRoot,createdAt:4,originType:"workspace-file",sourcePath:"report.md",accessPolicy:"model-input"}])},
{...task,id:"text",status:"completed",prompt:"Explain the bounds",result:result("Only textual evidence; no claimed file opening.")},
{...task,id:"empty",status:"completed",prompt:"Return nothing"},
{...task,id:"dirty",status:"failed",prompt:"Isolated task failed",error:{code:"peer_run_failed",message:"workspace has uncommitted changes: commit or stash"}},
{...task,id:"rate",status:"failed",prompt:"Provider task failed",error:{code:"peer_run_failed",message:"OpenRouter rate limit reached 429 "+"long_error_".repeat(100)}},
{...task,id:"blocked",status:"blocked",prompt:"Dependent task blocked",blockedByTaskId:"dirty",blockedByStatus:"failed"}]});
window.finish=()=>usePeerTaskStore.setState(s=>({tasks:s.tasks.map(t=>t.id===task.id?{...t,status:"completed",result:{summary:"Verified result",targetSessionId:"reviewer",targetAgentId:t.targetAgentId,targetModelId:t.targetModelId,completedAt:4,artifacts:[]}}:t)}));
window.setTheme=mode=>{document.documentElement.className=mode;applyTheme(teraxDefault,mode);};
window.backgroundFixture=async(active,opacity,blur)=>{if(active)await putBgImage("fixture-background",await(await fetch("/logo.png")).blob());usePreferencesStore.setState({hydrated:true,backgroundKind:active?"image":"none",backgroundImageId:active?"fixture-background":null,backgroundOpacity:opacity,backgroundBlur:blur});};
window.retryFixture=()=>{window.retryRequests=[];usePeerTaskStore.setState({tasks:[{...task,id:"safe-failure",status:"failed",prompt:"Inspect workspace before rate limit",error:{code:"peer_run_failed",message:"Provider rate limit 429"}}],recoveryReady:true});useChatStore.setState(s=>({sessions:s.sessions.map(session=>session.id!=="reviewer"?session:{...session,profile:{...session.profile,agentId:task.targetAgentId},run:{state:"failed",peerTaskId:"safe-failure",agentId:task.targetAgentId,modelId:task.targetModelId,startedAt:10,error:{kind:"rate_limit",message:"429"}}})}));chats.set("reviewer",{messages:[{id:"request",role:"user",parts:[{type:"text",text:"Inspect workspace before rate limit"}]},{id:"reads",role:"assistant",parts:["read_file","list_directory","grep","glob"].map(name=>({type:"tool-"+name,toolCallId:name,state:"output-available",input:{},output:{}}))}]});};
window.dirtyFixture=()=>{window.retryFixture();window.gitDirty=true;usePeerTaskStore.setState(s=>({tasks:s.tasks.map(t=>({...t,executionMode:"isolated-worktree",preRunFailure:true,error:{code:"peer_run_failed",message:"workspace has uncommitted changes"}}))}));useChatStore.setState(s=>({sessions:s.sessions.map(t=>t.id==="reviewer"?{...t,run:undefined}:t)}));};
const el=React.createElement;
function App(){const [file,setFile]=React.useState(null);window.openFile=path=>{setFile(path);requestAnimationFrame(()=>document.querySelector("[data-file-result]")?.focus());};const sessions=useChatStore(s=>s.sessions);const active=useChatStore(s=>s.activeSessionId);return el("main",{className:"clack-workspace",style:{padding:8,minWidth:0}},
el(SurfaceLayer),
file&&el("button",{"data-file-result":true},"Opened "+file),
el("button",{onClick:window.assign},"Assign fixture task"),
el("section",{"aria-label":"Chat A"},el(PeerTaskFeed,{sessionId:"a"})),
el("section",{"aria-label":"Chat B"},el(PeerTaskFeed,{sessionId:"b"})),
el("footer",{style:{position:"fixed",bottom:8,left:8}},el(DispatcherTarget,{sessions,activeSessionId:active,onCreate:()=>{},onSelect:async id=>{await new Promise(resolve=>setTimeout(resolve,20));window.opened.push(id);useChatStore.getState().switchSession(id);}})),
el(ModelSwitchNotice,{targetLabel:"Unknown target",assessment:{status:"blocked",contextBlocked:true,contextCapacity:"unknown",contextLimit:4096,estimatedTokens:3337,reasons:[],details:["Unverified capacity"]},onBack:()=>{},onConfirm:()=>{}}));}
createRoot(document.getElementById("root")).render(el(App));
`;
const server = await createServer({ root, configFile: false, logLevel: "warn", cacheDir: path.join(os.tmpdir(), `clack-first-use-${process.pid}`),
  optimizeDeps: { entries: [], noDiscovery: true, include: ["react", "react-dom/client", "react/jsx-runtime", "zustand", "zod", "@hugeicons/react", "@hugeicons/core-free-icons", "radix-ui", "class-variance-authority", "clsx", "tailwind-merge"] },
  resolve: { alias: { "@": path.join(root, "src") } },
  plugins: [{ name: "first-use-fixture", enforce: "pre", resolveId(source, importer) { if (source === "/workflow-entry.jsx") return "\0workflow-entry"; if (mocks.has(source)) return "\0mock:" + source; const absolute=source.startsWith("/src/")?path.join(root,source.slice(1)):source.startsWith(".")&&importer?path.resolve(path.dirname(importer),source):source;const relative=path.relative(root,absolute).replaceAll("\\","/").replace(/\.[jt]sx?$/,"");return mocks.has(relative)?"\0mock:"+relative:null; },
    load(id) { if (id === "\0workflow-entry") return entry; if (id.startsWith("\0mock:")) return mocks.get(id.slice(6)); },
    configureServer(vite) { vite.middlewares.use("/workflow-fixture", async (_req, res) => { res.setHeader("Content-Type", "text/html"); res.end(await vite.transformIndexHtml("/workflow-fixture", '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:var(--background);color:var(--foreground)"><div id="root"></div><script type="module" src="/workflow-entry.jsx"></script></body></html>')); }); },
  }, react(), tailwindcss()], server: { host: "127.0.0.1", port: 0, watch: null, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE });
  if (process.env.TASK_OUTCOME_EVIDENCE) await mkdir(process.env.TASK_OUTCOME_EVIDENCE,{recursive:true});
  for (const [width,zoom] of [[1280,1],[390,1],[320,1],[280,1],[640,2]]) for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width:width/zoom, height:1000/zoom },deviceScaleFactor:zoom });
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on("pageerror", error => { errors.push(error.message); console.error("Task fixture error:",error.message); });
    page.on("console",message=>{if(message.type()==="error")console.error("Browser:",message.text());});
    await page.goto(server.resolvedUrls.local[0] + "workflow-fixture", { waitUntil: "load", timeout: 120000 });
    await page.getByRole("button", { name: "Assign fixture task" }).click();
    await page.evaluate(theme => window.setTheme(theme), theme);
    const a = page.getByRole("region", { name: "Chat A", exact: true });
    const b = page.getByRole("region", { name: "Chat B", exact: true });
    const assigned=a.locator('[data-peer-task-id="assigned"]');
    assert.equal(await a.getByText("Review the bounds", { exact: true }).count(), 1);
    assert.equal(await b.getByText("Review the bounds", { exact: true }).count(), 0);
    const isolated=a.locator('[data-peer-task-id="changes"]');
    assert.equal(await isolated.getByRole("button",{name:"Open README.md",exact:true}).count(),0);
    await isolated.getByText("Review changes",{exact:true}).focus();await page.keyboard.press("Enter");await isolated.getByLabel("Captured patch").waitFor();
    await assigned.getByRole("button", { name: "View task in Dispatcher" }).click();
    const dispatcher=page.getByRole("dialog",{name:"Dispatcher",exact:true});
    const selected = page.locator('[data-dispatcher-task-id="assigned"]');
    await selected.waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-dispatcher-task-id") === "assigned");
    assert.match(await selected.innerText(), /Code Reviewer.*Preparing/s);
    assert.match(await selected.innerText(), /Parent a/);
    assert.equal(await selected.getAttribute("aria-pressed"),"true");
    const order = await dispatcher.locator('[data-dispatcher-task-id]').evaluateAll(rows => rows.map(row => row.dataset.dispatcherTaskId));
    const assignedIndex = order.indexOf("assigned");
    await dispatcher.getByRole("button", { name: "Previous task", exact: true }).click();
    await page.waitForFunction(id => document.activeElement?.getAttribute("data-dispatcher-task-id") === id, order[assignedIndex-1]);
    assert.equal(await dispatcher.locator(`[data-dispatcher-task-id="${order[assignedIndex-1]}"]`).getAttribute("aria-pressed"), "true");
    const nextButton = dispatcher.getByRole("button", { name: "Next task", exact: true });
    await nextButton.focus(); await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-dispatcher-task-id") === "assigned");
    await dispatcher.getByText(`Task ${assignedIndex+1} of ${order.length}`, {exact:true}).waitFor();
    await dispatcher.getByRole("heading",{name:"Needs attention (4)",exact:true}).waitFor();await dispatcher.getByRole("heading",{name:"Active (2)",exact:true}).waitFor();await dispatcher.getByRole("heading",{name:"Completed (3)",exact:true}).waitFor();
    await page.keyboard.press("ArrowDown");assert.notEqual(await page.evaluate(()=>document.activeElement?.getAttribute("data-dispatcher-task-id")),"assigned");await selected.focus();
    await page.keyboard.press("Enter");
    await dispatcher.getByRole("region",{name:"Selected task",exact:true}).getByText("Access and context",{exact:true}).click();
    await dispatcher.getByRole("region",{name:"Selected task",exact:true}).getByText("Read-only workspace access; subject to Agent permissions",{exact:true}).waitFor();
    for (const [custom,opacity,blur] of [[false,0.5,0],[true,0.15,0],[true,0.15,12],[true,0.9,0],[true,0.9,12]]) {
      await page.evaluate(([custom,opacity,blur])=>window.backgroundFixture(custom,opacity,blur),[custom,opacity,blur]);
      if(custom) {
        await page.waitForFunction(([opacity,blur])=>{const layer=document.querySelector('[data-dispatcher-surface] .clack-contained-bg-surface');const shell=document.querySelector('.clack-bg-surface');return layer&&shell&&Number(layer.style.opacity)===opacity/2&&layer.style.opacity===shell.style.opacity&&layer.style.filter===shell.style.filter&&layer.style.filter===(blur?"blur("+blur+"px)":"");},[opacity,blur]);
        assert.match(await dispatcher.locator('.clack-contained-bg-surface').evaluate(el=>el.style.backgroundImage),/blob:/);
      } else assert.equal(await dispatcher.locator('.clack-contained-bg-surface').count(),0);
      assert.equal(await dispatcher.evaluate(el=>el.style.background),"var(--clack-bg-workspace)");
      assert.equal(await dispatcher.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
    }
    await dispatcher.locator("summary").filter({hasText:/^Chats \(/}).click();await dispatcher.getByRole("button",{name:/^Parent a/}).click();
    await page.waitForFunction(() => window.panes.getState().bindings[window.panes.getState().activePaneId] === "a");
    assert.deepEqual(await page.evaluate(() => window.opened), ["a"]);
    await a.locator('[data-peer-task-id="text"]').getByText("View result",{exact:true}).click();await a.getByLabel("Task textual result").filter({hasText:"Only textual evidence"}).waitFor();
    await a.locator('[data-peer-task-id="empty"]').getByText("No files or artifacts returned",{exact:true}).waitFor();
    const returned=a.locator('[data-peer-task-id="returned"]');await returned.getByRole("button",{name:"View artifact: report.md",exact:true}).click();await returned.getByLabel("Immutable artifact preview").waitFor();assert.equal(await returned.getByLabel("Immutable artifact preview").inputValue(),"abc");
    await returned.getByRole("button",{name:"Open report.md",exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.files),["/fixture/report.md"]);await page.waitForFunction(()=>document.activeElement?.hasAttribute("data-file-result"));
    await a.locator('[data-peer-task-id="dirty"]').getByRole("button",{name:"Open Source Control",exact:true}).click();assert.equal(await page.evaluate(()=>window.sourceControl),1);
    const rate=a.locator('[data-peer-task-id="rate"]');await rate.getByText("This model is temporarily rate-limited.",{exact:true}).waitFor();assert.equal(await rate.getByRole("button",{name:"Retry task",exact:true}).count(),0);assert.equal(await rate.getByText(/OpenRouter rate limit reached/).isVisible(),false);
    await isolated.getByRole("button",{name:"View task in Dispatcher"}).click();const changedRow=dispatcher.locator('[data-dispatcher-task-id="changes"]');await page.waitForFunction(()=>document.activeElement?.getAttribute("data-dispatcher-task-id")==="changes");
    const detail=dispatcher.getByRole("region",{name:"Selected task",exact:true});await detail.getByText("Review changes",{exact:true}).click();assert.equal(await detail.getByRole("button",{name:"Open README.md",exact:true}).count(),0);
    await dispatcher.locator('[data-dispatcher-task-id="text"]').click();await page.evaluate(()=>window.tasks.setState(s=>({tasks:s.tasks.map(t=>t.id==="changes"?{...t,updatedAt:99}:t)})));assert.equal(await dispatcher.locator('[data-dispatcher-task-id="text"]').getAttribute("aria-pressed"),"true");await changedRow.click();
    if (process.env.TASK_OUTCOME_EVIDENCE) await page.screenshot({path:path.join(process.env.TASK_OUTCOME_EVIDENCE,`dispatcher-${width}-${zoom}-${theme}.png`),fullPage:true});
    const panelOverflow=await dispatcher.evaluate(el=>el.scrollWidth>el.clientWidth+1);assert.equal(panelOverflow,false);
    await detail.getByRole("button",{name:"Apply to workspace",exact:true}).click();await detail.getByText("Applied to workspace",{exact:true}).waitFor();
    await detail.getByRole("button",{name:"Open README.md",exact:true}).click();await dispatcher.waitFor({state:"detached"});await page.waitForFunction(()=>document.activeElement?.hasAttribute("data-file-result"));assert.deepEqual(await page.evaluate(()=>window.files),["/fixture/report.md","/fixture/README.md"]);
    await page.evaluate(() => window.finish());
    await assigned.getByText("View result", { exact: true }).click();await assigned.getByText("Verified result", { exact: true }).waitFor();
    await assigned.getByRole("button", { name: "View task in Dispatcher" }).click();
    await selected.waitFor();
    assert.match(await selected.innerText(), /Done/);
    await page.keyboard.press("Escape");
    await dispatcher.waitFor({state:"detached"});
    await page.waitForFunction(()=>document.activeElement?.hasAttribute("data-ai-dispatch-target"));
    await page.evaluate(() => window.retryFixture());
    const retryOwnership = await page.evaluate(()=>({active:window.chat.getState().activeSessionId,bindings:window.panes.getState().bindings}));
    const safe = a.locator('[data-peer-task-id="safe-failure"]');
    await page.waitForFunction(() => !document.querySelector('[data-peer-task-id="safe-failure"] button')?.disabled && [...document.querySelectorAll('[data-peer-task-id="safe-failure"] button')].some(button => button.textContent === "Retry task" && !button.disabled));
    await safe.getByRole("button", { name: "View task in Dispatcher" }).click();
    await dispatcher.getByRole("button",{name:"Retry task",exact:true}).waitFor();
    assert.equal(await dispatcher.getByRole("button",{name:"Archive task",exact:true}).isVisible(),true);
    assert.equal(await detail.getByText("Task details and provenance",{exact:true}).evaluate(el=>el.parentElement.open),false);
    await dispatcher.getByRole("button",{name:"Archive task",exact:true}).click();
    await dispatcher.getByRole("button",{name:"Show archived",exact:true}).click();
    await dispatcher.locator('[data-dispatcher-task-id="safe-failure"]').click();
    await page.waitForFunction(()=>[...document.querySelectorAll('[aria-label="Selected task"] button')].some(b=>b.textContent==="Retry task"&&!b.disabled));
    assert.equal(await dispatcher.getByRole("button",{name:"Restore task",exact:true}).isVisible(),true);
    assert.equal(await page.evaluate(()=>window.durable.some(t=>t.id==="safe-failure"&&t.archivedAt)),true);
    await dispatcher.getByRole("button",{name:"Restore task",exact:true}).click();
    await dispatcher.getByRole("button",{name:"Show current",exact:true}).click();
    await dispatcher.locator('[data-dispatcher-task-id="safe-failure"]').click();
    assert.equal(await dispatcher.getByRole("button",{name:"Previous task",exact:true}).isDisabled(),true);
    assert.equal(await dispatcher.getByRole("button",{name:"Next task",exact:true}).isDisabled(),true);
    await dispatcher.getByRole("button",{name:"Retry task",exact:true}).click();
    await dispatcher.getByRole("button",{name:"Retrying...",exact:true}).waitFor();
    assert.equal(await dispatcher.getByRole("button",{name:"Retrying...",exact:true}).isDisabled(),true);
    assert.equal(await safe.getByRole("button",{name:"Retrying...",exact:true}).isDisabled(),true);
    await page.waitForFunction(() => window.retryRequests.length === 1);
    await page.evaluate(() => window.finishRetry());
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-dispatcher-task-id") === "retry-attempt");
    assert.equal(await safe.getByRole("button",{name:"Retried as - queued",exact:true}).count(),1);
    await dispatcher.getByRole("button",{name:"Previous attempt - failed",exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>({active:window.chat.getState().activeSessionId,bindings:window.panes.getState().bindings})),retryOwnership);
    await dispatcher.getByRole("button",{name:"Previous task",exact:true}).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-dispatcher-task-id") === "safe-failure");
    assert.equal(await dispatcher.getByRole("button",{name:"Previous task",exact:true}).isDisabled(),true);
    await dispatcher.getByRole("button",{name:"Next task",exact:true}).click();
    assert.equal(await dispatcher.getByRole("button",{name:"Next task",exact:true}).isDisabled(),true);
    await page.evaluate(()=>window.tasks.setState(s=>({tasks:s.tasks.filter(t=>t.id!=="retry-attempt")})));
    await dispatcher.getByText("No task selected",{exact:true}).waitFor();
    assert.equal(await dispatcher.getByRole("button",{name:"Previous task",exact:true}).isDisabled(),true);
    assert.equal(await dispatcher.getByRole("button",{name:"Next task",exact:true}).isDisabled(),true);
    await page.keyboard.press("Escape");
    await dispatcher.waitFor({state:"detached"});
    await page.waitForFunction(()=>document.activeElement?.hasAttribute("data-ai-dispatch-target"));
    await page.evaluate(()=>window.retryFixture());
    await page.waitForFunction(()=>[...document.querySelectorAll('[data-peer-task-id="safe-failure"] button')].some(button=>button.textContent==="Retry task"&&!button.disabled));
    await safe.getByRole("button",{name:"View task in Dispatcher"}).click();
    await dispatcher.getByRole("button",{name:"Retry task",exact:true}).click();
    await page.waitForFunction(()=>window.retryRequests.length===1);
    await page.keyboard.press("Escape");
    await dispatcher.waitFor({state:"detached"});
    await page.evaluate(()=>window.finishRetry());
    await page.waitForFunction(()=>window.tasks.getState().tasks.some(task=>task.id==="retry-attempt") && window.tasks.getState().retryingTaskIds.length===0);
    assert.equal(await dispatcher.count(),0,"A stale retry callback must not reopen Dispatcher after dismissal");
    await page.evaluate(()=>window.dirtyFixture());
    await safe.getByRole("button",{name:"Retry after workspace is clean",exact:true}).waitFor();
    assert.equal(await safe.getByRole("button",{name:"Retry after workspace is clean",exact:true}).isDisabled(),true);
    await safe.getByRole("button",{name:"Open Source Control",exact:true}).click();
    await page.evaluate(()=>{window.gitDirty=false;window.dispatchEvent(new Event("focus"));});
    await page.waitForFunction(()=>[...document.querySelectorAll('[data-peer-task-id="safe-failure"] button')].some(b=>b.textContent==="Retry task"&&!b.disabled));
    await page.evaluate(()=>{window.assign();window.tasks.setState({recoveryReady:true});});
    await a.locator('[data-peer-task-id="text"]').getByRole("button",{name:"View task in Dispatcher"}).click();
    await dispatcher.locator('[data-dispatcher-task-id="text"]').waitFor();
    await page.waitForFunction(()=>document.activeElement?.getAttribute("data-dispatcher-task-id")==="text");
    const cleanupOrder = await dispatcher.locator('[data-dispatcher-task-id]').evaluateAll(rows=>rows.map(row=>row.dataset.dispatcherTaskId));
    const cleanupIndex = cleanupOrder.indexOf("text");
    const cleanupNeighbor = cleanupOrder[cleanupIndex+1] ?? cleanupOrder[cleanupIndex-1];
    await dispatcher.getByRole("button",{name:"Archive task",exact:true}).click();
    await page.waitForFunction(id=>document.activeElement?.getAttribute("data-dispatcher-task-id")===id,cleanupNeighbor);
    await dispatcher.getByRole("heading",{name:"Completed (2)",exact:true}).waitFor();
    await dispatcher.getByRole("button",{name:"Show archived",exact:true}).click();
    await dispatcher.locator('[data-dispatcher-task-id="text"]').click();
    await dispatcher.getByRole("button",{name:"Restore task",exact:true}).click();
    await dispatcher.getByRole("button",{name:"Show current",exact:true}).click();
    await dispatcher.getByRole("button",{name:"Clear finished",exact:true}).click();
    await dispatcher.getByText("Removes finished tasks from the active Dispatcher view. Their history and results are retained in Archived.",{exact:true}).waitFor();
    await page.waitForFunction(()=>document.activeElement?.textContent==="Cancel");
    await dispatcher.getByRole("button",{name:"Archive 3 completed tasks",exact:true}).click();
    await dispatcher.getByRole("heading",{name:"Completed (0)",exact:true}).waitFor();
    assert.equal(await dispatcher.locator('[data-dispatcher-task-id="rate"]').count(),1);
    assert.equal(await dispatcher.locator('[data-dispatcher-task-id="changes"]').count(),1,"Unapplied patches must not be cleared");
    await dispatcher.getByRole("button",{name:"Show archived",exact:true}).click();
    await dispatcher.getByRole("heading",{name:"Completed (3)",exact:true}).waitFor();
    await dispatcher.locator('[data-dispatcher-task-id="text"]').click();
    assert.equal(await dispatcher.getByRole("button",{name:"Restore task",exact:true}).isVisible(),true);
    await dispatcher.getByRole("button",{name:"Close Dispatcher",exact:true}).click();
    await dispatcher.waitFor({state:"detached"});
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(overflow, false, `Overflow at ${width}px ${theme}`);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px ${zoom*100}% ${theme}: read-only rate-limit retry in chat/Dispatcher/Archived, archive/restore/persistence, bulk clear, Previous/Next/focus, 5 appearance configurations, artifacts, Review/Apply/Open, failures, isolation, no overflow`);
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
