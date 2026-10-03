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
  ["src/modules/settings/preferences", `export const usePreferencesStore = () => {};`],
  ["src/modules/ai/store/chatStore", `
    import { create } from "zustand";
    export const useChatStore = create(() => ({activeSessionId:"a",sessions:[{id:"a"},{id:"b"}],locked:false}));
    window.chatStore = useChatStore;
  `],
  ["src/modules/ai/hooks/useModelSelectionLock", `
    import {useChatStore} from "/src/modules/ai/store/chatStore";
    export const useModelSelectionLock = () => useChatStore(s=>s.locked);
  `],
  ["src/modules/ai/store/reasoningEffort", `
    import {useChatStore} from "/src/modules/ai/store/chatStore";
    import {captureEffort} from "/src/modules/ai/lib/reasoningEffort";
    export function sessionEffort(session) {
      const id = session.model || "gpt-5.4-mini";
      return captureEffort(id,{providerId:"openai",transportModelId:id},session.effortPreferences);
    }
    export async function setSessionEffort(id,choice) {
      const current = useChatStore.getState().sessions.find(s=>s.id===id);
      const effort = sessionEffort(current);
      useChatStore.setState({sessions:useChatStore.getState().sessions.map(s=>s.id===id?{...s,effortPreferences:{version:1,choices:[{key:effort.key,revision:effort.capability.revision,choice}]}}:s)});
    }
  `],
]);
const entry = `
  import React from "react";
  import {createRoot} from "react-dom/client";
  import {EffortControl} from "/src/modules/ai/components/EffortControl.tsx";
  import "/src/styles/globals.css";
  createRoot(document.getElementById("root")).render(React.createElement("main",{style:{display:"flex",justifyContent:"end",padding:12}},React.createElement(EffortControl)));
`;
const server = await createServer({root,cacheDir:path.join(os.tmpdir(),`clack-r2-vite-${process.pid}`),configFile:false,logLevel:"warn",optimizeDeps:{noDiscovery:true,include:["react","react/jsx-runtime","react-dom/client","zustand","radix-ui","class-variance-authority","clsx","tailwind-merge","zod","@hugeicons/react","@hugeicons/core-free-icons"]},resolve:{alias:{"@":path.join(root,"src")}},plugins:[{
  name:"reasoning-effort-fixture",enforce:"pre",
  resolveId(source,importer) {
    if(source==="/effort-entry.jsx") return "\0effort-entry.jsx";
    const absolute=source.startsWith("/src/")?path.join(root,source.slice(1)):source.startsWith(".")&&importer?path.resolve(path.dirname(importer),source):source;
    const relative=path.relative(root,absolute).replaceAll("\\","/").replace(/\.[jt]sx?$/,"");
    return mocks.has(relative)?`\0mock:${relative}`:null;
  },
  load(id) {if(id==="\0effort-entry.jsx")return entry;if(id.startsWith("\0mock:"))return mocks.get(id.slice(6));},
  configureServer(vite) {vite.middlewares.use("/effort-fixture",async(_req,res)=>{
    res.setHeader("Content-Type","text/html");
    res.end(await vite.transformIndexHtml("/effort-fixture",'<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:var(--background);color:var(--foreground)"><div id="root"></div><script type="module" src="/effort-entry.jsx"></script></body></html>'));
  });},
},react(),tailwindcss()],server:{host:"127.0.0.1",port:0}});
let browser;
try {
  await server.listen();
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
  for(const width of [1100,390,280]) {
    const page=await browser.newPage({viewport:{width,height:700}});
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto(`${server.resolvedUrls.local[0]}effort-fixture`,{waitUntil:"networkidle",timeout:120000});
    await page.getByRole("button",{name:"Effort: Automatic"}).focus();
    await page.keyboard.press("Enter");
    const select=page.getByRole("combobox",{name:"Reasoning effort"});
    assert.deepEqual(await select.locator("option").allTextContents(),["Automatic","None","Low","Medium","High","Extra high"]);
    await select.selectOption("high");
    await page.getByRole("button",{name:"Effort: High",exact:true}).waitFor();
    await page.getByText("Advanced",{exact:true}).click();
    await page.getByText('{"openai":{"reasoningEffort":"high"}}',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const box=await page.getByRole("dialog").boundingBox();
    assert.ok(box.x>=0 && box.x+box.width<=width && box.y+box.height<=700);
    if(process.env.EFFORT_SCREENSHOTS){await mkdir(process.env.EFFORT_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.EFFORT_SCREENSHOTS,`r2-${width}.png`)});}
    await page.evaluate(()=>window.chatStore.setState({locked:true}));
    assert.equal(await select.isDisabled(),true);
    await page.getByText("Locked until the current run stops completely.").waitFor();
    await page.keyboard.press("Escape");
    await page.evaluate(()=>window.chatStore.setState({locked:false,activeSessionId:"b"}));
    await page.getByRole("button",{name:"Effort: Automatic"}).waitFor();
    await page.evaluate(()=>window.chatStore.setState({activeSessionId:"a"}));
    await page.getByRole("button",{name:"Effort: High",exact:true}).waitFor();
    await page.evaluate(()=>window.chatStore.setState({sessions:[{id:"a",model:"unknown"}]}));
    await page.getByRole("button",{name:"Effort: Automatic"}).click();
    await page.getByText("Effort support is unverified for this model and API.").waitFor();
    assert.equal(await select.isDisabled(),true);
    await page.keyboard.press("Escape");
    await page.evaluate(()=>window.chatStore.setState({sessions:[{id:"a",model:"gpt-4.1-mini"}]}));
    assert.equal(await page.getByRole("button",{name:/Effort:/}).count(),0);
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log("R2 browser checks passed at 1100/390/280px: exact options, selection, advanced wire values, locked runs, chat isolation, unknown/unsupported, keyboard, bounded popover, no overflow/errors. Persistence IPC is mocked; native and wire tests are separate.");
} finally {await browser?.close();await server.close();}
