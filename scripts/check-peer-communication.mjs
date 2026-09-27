// Real activity disclosure; no native window or provider inference is exercised.
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
const entry = `
import React from "react";
import { createRoot } from "react-dom/client";
import { PeerCommunicationFeed } from "/src/modules/ai/components/PeerCommunicationFeed.tsx";
import "/src/styles/globals.css";
const events = ["answered", "acknowledged", "blocked"].map((state, i) => ({ id:"event-"+i, taskId:"task-"+"long-id-".repeat(30), sequence:i+1, state, kind:i===1?"clarification-response":"clarification-request", text:i===0?"Which API version is required?":i===1?"Use API v2.":"unbroken-evidence-".repeat(180), sender:{agentId:"Coder"}, recipient:{agentId:"Reviewer"}, digest:"a".repeat(64), evidence:[{taskId:"task",artifactId:"proof",contentHash:"b".repeat(64)}] }));
createRoot(document.getElementById("root")).render(React.createElement("main", {style:{maxWidth:640,margin:"24px auto",padding:16,fontSize:13}}, React.createElement(PeerCommunicationFeed,{events})));
`;
const server = await createServer({root, configFile:false, logLevel:"warn", optimizeDeps:{entries:[]}, resolve:{alias:{"@":path.join(root,"src")}}, plugins:[{
  name:"peer-communication-fixture", enforce:"pre",
  resolveId(source) { if(source==="/peer-entry.jsx") return "\0peer-entry.jsx"; },
  load(id) { if(id==="\0peer-entry.jsx") return entry; },
  configureServer(vite) { vite.middlewares.use("/peer-fixture", async (_req,res) => {
    res.setHeader("Content-Type","text/html");
    res.end(await vite.transformIndexHtml("/peer-fixture",`<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:var(--background);color:var(--foreground)"><div id="root"></div><script type="module" src="/peer-entry.jsx"></script></body></html>`));
  }); },
},react(),tailwindcss()], server:{host:"127.0.0.1",port:0}});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
  for(const width of [1100,390]) {
    const page=await browser.newPage({viewport:{width,height:900}});
    const errors=[];
    page.on("pageerror",error=>errors.push(error.message));
    await page.goto(`${server.resolvedUrls.local[0]}peer-fixture`,{waitUntil:"networkidle",timeout:120000});
    const disclosure=page.getByText("Task communication (3)",{exact:true});
    await disclosure.focus();
    await page.keyboard.press("Enter");
    await page.getByText("Which API version is required?",{exact:true}).waitFor();
    await page.getByText("Provenance",{exact:true}).first().click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await page.locator("ol").evaluate(element=>element.clientHeight<=256 && element.scrollWidth<=element.clientWidth),true);
    if(process.env.PEER_COMMUNICATION_SCREENSHOTS) {
      await mkdir(process.env.PEER_COMMUNICATION_SCREENSHOTS,{recursive:true});
      await page.screenshot({path:path.join(process.env.PEER_COMMUNICATION_SCREENSHOTS,`h1-${width}.png`)});
    }
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log("H1 activity checks passed: keyboard disclosure, provenance, long unbroken payloads, bounded scrolling at 1100px and 390px.");
} finally { await browser?.close(); await server.close(); }
