// Browser fixture exercises the real selector and hook without native or provider calls.
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
const mocks = new Map([
  ["src/modules/settings/preferences", `
    import { create } from "zustand";
    export const usePreferencesStore = create(() => ({ selfHostedInference: { version:1, revision:0, endpoints:[], profiles:[] }, customEndpoints:[], savedProviderModels:[], favoriteModelIds:[], recentModelIds:[] }));
  `],
  ["src/modules/settings/store", `export function setFavoriteModelIds() {} export function setRecentModelIds() {}`],
  ["src/modules/ai/lib/composer", `export const ACCEPTED_FILES = ""; export const useComposer = () => ({});`],
  ["src/modules/ai/store/chatStore", `
    import { create } from "zustand";
    export const useChatStore = create(() => ({ activeSessionId:"chat", selectedModelId:"gpt-5.4-mini", apiKeys:{ openai:"test", anthropic:"test" }, sessions:[], locked:false }));
    export function hasKeyForModel() { return true; }
    window.chatStore = useChatStore;
  `],
  ["src/modules/ai/hooks/useModelSelectionLock", `
    import { useChatStore } from "/src/modules/ai/store/chatStore";
    export function useModelSelectionLock() { return useChatStore(s => s.locked); }
  `],
  ["src/modules/ai/store/modelSwitch", `
    export async function prepareModelSwitch(sessionId, modelId, follow, signal) {
      window.chatStore.setState({ locked:true });
      await new Promise(resolve => {
        window.finish = resolve;
        signal.addEventListener("abort", () => { window.cancelled++; resolve(); }, {once:true});
      });
      window.chatStore.setState({ locked:false });
      return {
        targetLabel:"Claude Sonnet 4.6", assessment:{status:window.blocked ? "blocked" : "warning", reasons:[window.blocked ? "Required context does not fit." : "Unconfirmed endpoint tool support."], estimatedTokens:7000, contextLimit:20000, workingBudget:15000,
          details:["2 original user messages retained verbatim.", "Memory coverage: messages 1-8.", "Retrieved sources: " + "source-".repeat(150), "Output reserve: 4,096 tokens. Cost unavailable. Provider caches do not transfer."]},
        dispose:() => {},
        commit:async () => { window.chatStore.setState({ selectedModelId:modelId }); window.committed++; return {ok:true}; }
      };
    }
  `],
]);
const entry = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import { ModelDropdown } from "/src/modules/ai/components/AiStatusBarControls.tsx";
  import "/src/styles/globals.css";
  window.cancelled = 0; window.committed = 0; window.blocked = false;
  createRoot(document.getElementById("root")).render(React.createElement("main", {style:{display:"flex",justifyContent:"end",padding:16}}, React.createElement(ModelDropdown)));
`;
const server = await createServer({ root, configFile:false, logLevel:"warn", optimizeDeps:{entries:[]},
  resolve:{alias:{"@":path.join(root,"src")}},
  plugins:[{name:"isolated-model-switch",enforce:"pre",
    resolveId(source, importer) {
      if (source === "/model-switch-entry.jsx") return "\0model-switch-entry.jsx";
      const absolute = source.startsWith("/src/") ? path.join(root, source.slice(1)) : source.startsWith(".") && importer ? path.resolve(path.dirname(importer),source) : source;
      const relative = path.relative(root,absolute).replaceAll("\\","/").replace(/\.[jt]sx?$/,"");
      return mocks.has(relative) ? `\0mock:${relative}` : null;
    },
    load(id) { if(id === "\0model-switch-entry.jsx") return entry; if(id.startsWith("\0mock:")) return mocks.get(id.slice(6)); },
    configureServer(vite) { vite.middlewares.use("/model-switch-fixture", async (_req,res) => {
      res.setHeader("Content-Type","text/html");
      res.end(await vite.transformIndexHtml("/model-switch-fixture", `<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:var(--background);color:var(--foreground)"><div id="root"></div><script type="module" src="/model-switch-entry.jsx"></script></body></html>`));
    }); },
  },react(),tailwindcss()],server:{host:"127.0.0.1",port:0},
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
  for (const width of [1100,390]) {
    const page = await browser.newPage({viewport:{width,height:900}});
    page.setDefaultTimeout(15000);
    const errors=[];
    page.on("pageerror",e=>errors.push(e.message));
    await page.goto(`${server.resolvedUrls.local[0]}model-switch-fixture`,{waitUntil:"networkidle",timeout:120000});
    const choose = async () => {
      await page.getByRole("button",{name:/Change model:/}).click();
      await page.getByPlaceholder(/Search models/).fill("Claude Sonnet 4.6");
      await page.getByRole("menuitem").filter({hasText:"Claude Sonnet 4.6"}).click();
      await page.getByRole("status").filter({hasText:/Preparing this conversation/}).waitFor();
      assert.equal(await page.evaluate(()=>window.chatStore.getState().locked),true);
    };
    await choose();
    await page.getByRole("button",{name:"Cancel",exact:true}).click();
    await page.waitForFunction(()=>window.cancelled===1 && !window.chatStore.getState().locked);
    assert.equal(await page.evaluate(()=>window.committed),0);
    await choose();
    await page.evaluate(()=>window.finish());
    await page.getByText("Preparation details",{exact:true}).click();
    await page.getByRole("button",{name:"Choose another model"}).focus();
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.evaluate(()=>document.activeElement?.tagName),"SUMMARY");
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
    const overflow = await page.getByRole("alert").evaluate(element=>element.scrollWidth > element.clientWidth);
    assert.equal(overflow,false);
    if(process.env.MODEL_SWITCH_SCREENSHOTS) {
      await mkdir(process.env.MODEL_SWITCH_SCREENSHOTS,{recursive:true});
      await page.screenshot({path:path.join(process.env.MODEL_SWITCH_SCREENSHOTS,`c2-${width}.png`)});
    }
    await page.getByRole("button",{name:"Optimize and switch",exact:true}).click();
    await page.waitForFunction(()=>window.committed===1);
    await page.getByRole("menu").waitFor({state:"hidden"});
    await page.reload({waitUntil:"networkidle"});
    await page.evaluate(()=>{window.blocked=true;});
    await choose();
    await page.evaluate(()=>window.finish());
    await page.getByText("Cannot switch model",{exact:true}).waitFor();
    assert.equal(await page.getByRole("button",{name:"Optimize and switch",exact:true}).count(),0);
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log("C2 browser checks passed: preparation lock, cancel, review, details keyboard access, commit, blocked state and overflow at 1100px/390px.");
} finally {
  await browser?.close();
  await server.close();
}
