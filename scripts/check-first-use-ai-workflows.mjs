import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mocks = new Map([
  ["@tauri-apps/api/core", `export async function invoke(){return null;}export class Channel{}export class Resource{}export async function addPluginListener(){return{unregister:async()=>{}};}export const isTauri=()=>false;`],
  ["@tauri-apps/api/event", `export const emit=async()=>{};export const listen=async()=>()=>{};`],
  ["@tauri-apps/api/webviewWindow", `export const getCurrentWebviewWindow=()=>({listen:async()=>()=>{}});`],
  ["@tauri-apps/api/window", `export const getCurrentWindow=()=>({});`],
  ["@tauri-apps/plugin-os", `export const platform=()=>"windows";`],
  ["@tauri-apps/plugin-store", `export class LazyStore{async get(){return null;}async set(){}async save(){}async delete(){}async entries(){return [];}async onChange(){return()=>{};}}`],
  ["src/modules/ai/index", `export{AiInputBarConnect}from"/src/modules/ai/components/AiInputBar.tsx";`],
  ["src/modules/ai/lib/peerTaskCoordinator", `export const applyPeerTaskChangeSet=async()=>{};export const cancelPeerTask=async()=>{};export const discardPeerTaskWorktree=async()=>{};`],
]);
const entry = `
import React from"react";import{createRoot}from"react-dom/client";
import{DispatcherTarget}from"/src/app/components/WorkspaceInputBar.tsx";
import{PeerTaskFeed}from"/src/modules/ai/components/PeerTaskFeed.tsx";
import{useChatStore}from"/src/modules/ai/store/chatStore.ts";
import{usePeerTaskStore}from"/src/modules/ai/store/peerTaskStore.ts";
import{createAiPaneLayout,useAiPaneStore}from"/src/modules/ai/store/aiPaneStore.ts";
import{ModelSwitchNotice}from"/src/modules/ai/components/ModelSwitchNotice.tsx";
import{applyTheme}from"/src/modules/theme/applyTheme.ts";
import{teraxDefault}from"/src/modules/theme/themes/terax-default.ts";
import"/src/styles/globals.css";
const sessions=["a","b","reviewer"].map(id=>({id,title:"Parent "+id,createdAt:1,updatedAt:1,profile:{agentId:"builtin:coder",modelId:"gpt-5.4-mini",workspaceId:"local:/fixture",workspaceRoot:"/fixture"}}));
const task={schemaVersion:7,id:"assigned",sourceSessionId:"a",targetSessionId:"reviewer",sourceAgentId:"builtin:coder",sourceModelId:"gpt-5.4-mini",targetAgentId:"builtin:reviewer",targetModelId:"gpt-5.4-mini",workspaceId:"local:/fixture",workspaceRoot:"/fixture",workspaceEnvironment:{kind:"local"},kind:"review",executionMode:"read-only",prompt:"Review the bounds",artifactRefs:[],parentTaskId:null,rootTaskId:"assigned",hopCount:0,dependsOn:[],status:"running",createdAt:1,updatedAt:2};
useChatStore.setState({sessions,activeSessionId:"b"});window.chat=useChatStore;window.tasks=usePeerTaskStore;window.assigned=task;window.opened=[];
useAiPaneStore.setState({...createAiPaneLayout("b"),initialized:true});window.panes=useAiPaneStore;
window.assign=()=>usePeerTaskStore.setState({tasks:[task,{...task,id:"other",sourceSessionId:"b",prompt:"Different chat's work",updatedAt:3}]});
window.finish=()=>usePeerTaskStore.setState(s=>({tasks:s.tasks.map(t=>t.id===task.id?{...t,status:"completed",result:{summary:"Verified result",targetSessionId:"reviewer",targetAgentId:t.targetAgentId,targetModelId:t.targetModelId,completedAt:4,artifacts:[]}}:t)}));
window.setTheme=mode=>{document.documentElement.className=mode;applyTheme(teraxDefault,mode);};
const el=React.createElement;
function App(){const sessions=useChatStore(s=>s.sessions);const active=useChatStore(s=>s.activeSessionId);return el("main",{style:{padding:8,minWidth:0}},
el("button",{onClick:window.assign},"Assign fixture task"),
el("section",{"aria-label":"Chat A"},el(PeerTaskFeed,{sessionId:"a"})),
el("section",{"aria-label":"Chat B"},el(PeerTaskFeed,{sessionId:"b"})),
el(DispatcherTarget,{sessions,activeSessionId:active,onCreate:()=>{},onSelect:async id=>{await new Promise(resolve=>setTimeout(resolve,20));window.opened.push(id);useChatStore.getState().switchSession(id);}}),
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
  for (const width of [320, 1280]) for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0] + "workflow-fixture", { waitUntil: "load", timeout: 120000 });
    await page.getByRole("button", { name: "Assign fixture task" }).click();
    await page.evaluate(theme => window.setTheme(theme), theme);
    const a = page.getByRole("region", { name: "Chat A", exact: true });
    const b = page.getByRole("region", { name: "Chat B", exact: true });
    assert.equal(await a.getByText("Review the bounds", { exact: true }).count(), 1);
    assert.equal(await b.getByText("Review the bounds", { exact: true }).count(), 0);
    await a.getByRole("button", { name: "View task in Dispatcher" }).click();
    const selected = page.locator('[data-dispatcher-task-id="assigned"]');
    await selected.waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-dispatcher-task-id") === "assigned");
    assert.match(await selected.innerText(), /Code Reviewer.*Running/s);
    assert.match(await selected.innerText(), /Parent a/);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.panes.getState().bindings[window.panes.getState().activePaneId] === "a");
    assert.deepEqual(await page.evaluate(() => window.opened), ["a"]);
    await page.evaluate(() => window.finish());
    await a.getByText("Verified result", { exact: true }).waitFor();
    await a.getByRole("button", { name: "View task in Dispatcher" }).click();
    await selected.waitFor();
    assert.match(await selected.innerText(), /Done/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(overflow, false, `Overflow at ${width}px ${theme}`);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px ${theme}: assignment, isolation, Dispatcher focus, parent navigation, retained result, no overflow`);
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
