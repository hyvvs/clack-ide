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
import { ActivityTimeline } from "/src/modules/ai/components/ActivityTimeline.tsx";
import { MessageResponse } from "/src/components/ai-elements/message.tsx";
import { ProviderOutput } from "/src/modules/ai/components/ProviderOutput.tsx";
import "/src/styles/globals.css";
const messages=Array.from({length:121},(_,i)=>({id:"message-"+i,role:"assistant",parts:[{type:"reasoning",state:"done",text:i===120?"long-evidence-".repeat(600)+" api_key=private":"Inspect the actual provider output."},{type:"text",text:"Final answer: the change is verified."}],metadata:{clackActivity:{version:1,owner:{sessionId:"chat",workspaceId:"workspace",runId:"chat:1",agentId:"Coder",modelId:"fixture-model",providerId:"openai"},receipts:[{id:"reason-"+i,kind:"part",label:"reasoning-start",part:0,format:"summary",at:1000+i}],omitted:0}}}));
createRoot(document.getElementById("root")).render(React.createElement("main",{style:{maxWidth:640,margin:"24px auto",padding:16,minWidth:0}},
  React.createElement(ActivityTimeline,{sessionId:"chat",workspaceId:"workspace",messages,tasks:[],run:{state:"completed",startedAt:1,endedAt:9999,workspaceId:"workspace"}}),
  React.createElement("section",{"aria-label":"Final answer",id:"evidence-chat-message-120",style:{fontSize:14,marginTop:16}},
    React.createElement(ProviderOutput,{label:"Provider reasoning summary",text:messages[120].parts[0].text}),
    React.createElement(MessageResponse,{streaming:false},"Final answer: the change is verified."))));
`;
const server = await createServer({root,configFile:false,logLevel:"warn",optimizeDeps:{entries:[]},resolve:{alias:{"@":path.join(root,"src")}},plugins:[{
  name:"agent-activity-fixture",enforce:"pre",
  resolveId(source) {if(source==="/activity-entry.jsx")return "\0activity-entry.jsx";},
  load(id) {if(id==="\0activity-entry.jsx")return entry;},
  configureServer(vite) {vite.middlewares.use("/activity-fixture",async(_req,res)=>{
    res.setHeader("Content-Type","text/html");
    res.end(await vite.transformIndexHtml("/activity-fixture",'<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:var(--background);color:var(--foreground)"><div id="root"></div><script type="module" src="/activity-entry.jsx"></script></body></html>'));
  });},
},react(),tailwindcss()],server:{host:"127.0.0.1",port:0}});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
  for(const width of [1100,390,280]) {
    const page = await browser.newPage({viewport:{width,height:900}});
    const errors=[];
    page.setDefaultTimeout(15000);
    page.on("pageerror",error=>errors.push(error.message));
    await page.goto(`${server.resolvedUrls.local[0]}activity-fixture`,{waitUntil:"networkidle",timeout:120000});
    const summary=page.getByText("Agent activity",{exact:true});
    await summary.waitFor();
    assert.equal(await page.locator("ol[aria-label='Chronological agent activity']").count(),0);
    await summary.focus();
    await page.keyboard.press("Enter");
    const timeline=page.getByRole("list",{name:"Chronological agent activity"});
    await timeline.waitFor();
    assert.equal(await page.getByRole("region",{name:"Final answer"}).isVisible(),true);
    await page.getByText("Provider reasoning summary",{exact:true}).first().click();
    await page.getByText("Workspace",{exact:true}).first().waitFor();
    assert.equal(await timeline.locator(":scope > li").count()<=40,true);
    assert.equal(await timeline.evaluate(el=>el.clientHeight<=320 && el.scrollWidth<=el.clientWidth),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await page.getByRole("link",{name:"Original message: message-120",exact:true}).getAttribute("href"),"#evidence-chat-message-120");
    if(process.env.ACTIVITY_SCREENSHOTS){await mkdir(process.env.ACTIVITY_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.ACTIVITY_SCREENSHOTS,`r1-${width}.png`)});}
    await page.getByRole("link",{name:"Original message: message-120",exact:true}).click();
    const original=page.getByRole("region",{name:"Final answer"});
    await original.getByText("Provider reasoning summary",{exact:true}).click();
    assert.equal(await original.locator("details p").evaluate(el=>el.clientHeight<=256 && el.scrollWidth<=el.clientWidth),true);
    assert.equal((await original.innerText()).includes("api_key=private"),false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await original.getByText("Provider reasoning summary",{exact:true}).click();
    const previous=page.getByRole("button",{name:"Previous activity page"});
    await previous.click();
    assert.equal(await timeline.locator(":scope > li").count(),40);
    await page.getByRole("button",{name:"Next activity page"}).click();
    assert.equal(await page.getByRole("region",{name:"Final answer"}).isVisible(),true);
    await summary.focus();
    await page.keyboard.press("Space");
    await timeline.waitFor({state:"detached"});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log("R1 browser checks passed at 1100px, 390px, 280px: keyboard expand/collapse, provenance, source link, 122-event pagination, bounded long content, final-answer visibility, no overflow or page errors.");
} finally {await browser?.close();await server.close();}
