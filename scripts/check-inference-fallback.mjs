// Isolated browser consent UI. No native window or real provider is involved.
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mocks = new Map([
  ["src/modules/ai/store/chatStore", `import {create} from 'zustand';
    export const useChatStore=create(()=>({sessions:['a','b'].map(id=>({id,title:'Chat '+id,profile:{modelId:'gpt-5.5',agentId:'agent',workspaceId:'workspace'},run:{state:'completed'}}))}));
    export const hasKeyForModel=()=>true; window.chats=useChatStore;`],
  ["src/modules/settings/preferences", `import {create} from 'zustand';export const usePreferencesStore=create(()=>({savedProviderModels:[],selfHostedInference:{version:1,revision:0,endpoints:[],profiles:[]}}));`],
  ["src/modules/ai/store/inferenceFallback", `import {create} from 'zustand';
    export const useFallbackProposals=create(()=>({proposals:{}}));window.proposals=useFallbackProposals;
    export async function describeFallbackDestination(modelId){return {modelId,identity:{providerId:'openai',transportModelId:modelId},baseUrl:'https://private-destination.example/'+ 'long-path/'.repeat(80),configurationHash:'a'.repeat(64)};}
    export async function setFallbackPolicy(...args){window.actions.push(['policy',...args]);}
    export function resolveFallbackProposal(sessionId,approved,id){window.actions.push(['answer',sessionId,approved,id]);useFallbackProposals.setState(state=>({proposals:{...state.proposals,[sessionId]:undefined}}));}`],
  ["src/modules/ai/lib/inferenceFallback", `export const FALLBACK_CATEGORIES=['conversation','source files','attachments','memory','artifacts','tool results'];export const effectiveFallback=value=>value??null;export const sameDestination=(a,b)=>JSON.stringify(a)===JSON.stringify(b);`],
]);
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {ChatFallbackControl} from '/src/modules/ai/components/ChatFallbackControl.tsx';import '/src/styles/globals.css';
window.actions=[];createRoot(document.getElementById('root')).render(React.createElement('main',null,['a','b'].map(id=>React.createElement('section',{key:id,'data-chat':id},React.createElement(ChatFallbackControl,{sessionId:id})))));`;
const server=await createServer({root,configFile:false,logLevel:'warn',optimizeDeps:{entries:[],noDiscovery:true,include:['react','react-dom/client','react/jsx-runtime','zustand','zod','@hugeicons/react','@hugeicons/core-free-icons','class-variance-authority','radix-ui','clsx','tailwind-merge']},resolve:{alias:{'@':path.join(root,'src')}},plugins:[{
  name:'fallback-consent-fixture',enforce:'pre',resolveId(source,importer){
    if(source==='/fallback-entry.jsx')return '\0fallback-entry.jsx';
    const absolute=source.startsWith('.')&&importer?path.resolve(path.dirname(importer),source):source;
    const relative=path.relative(root,absolute).replaceAll('\\','/').replace(/\.[jt]sx?$/,'');
    return mocks.has(relative)?'\0mock:'+relative:null;
  },load(id){if(id==='\0fallback-entry.jsx')return entry;if(id.startsWith('\0mock:'))return mocks.get(id.slice(6));},
  configureServer(vite){vite.middlewares.use('/fallback-fixture',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/fallback-fixture',`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:var(--background);color:var(--foreground)"><div id="root"></div><script type="module" src="/fallback-entry.jsx"></script></body></html>`));});},
},react(),tailwindcss()],server:{host:'127.0.0.1',port:0,watch:null,hmr:false}});
let browser;
try {
  await server.listen();browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
  const page=await browser.newPage({viewport:{width:1280,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.resolvedUrls.local[0]+'fallback-fixture',{waitUntil:'networkidle',timeout:120000});
  await page.locator('[data-chat="a"]').getByRole('button',{name:'Fallback policy: Disabled'}).click();
  await page.getByLabel('Fallback mode').selectOption('trusted');await page.getByLabel('Fallback destination').selectOption('gpt-4.1-mini');
  await page.getByRole('checkbox').waitFor();assert.equal(await page.getByRole('button',{name:'Save policy'}).isDisabled(),true);
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Save policy'}).click();
  assert.equal(await page.evaluate(()=>window.actions[0][1]),'a');assert.equal(await page.evaluate(()=>window.actions[0][2]),'trusted');
  for(const dark of [false,true])for(const width of [1280,390,320,160]){
    await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),dark);
    await page.setViewportSize({width,height:700});
    const dialog=page.getByRole('dialog');
    assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,`dialog overflow ${width}/${dark}`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`page overflow ${width}/${dark}`);
  }
  await page.setViewportSize({width:390,height:800});await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
  await page.evaluate(async()=>{
    const destination={modelId:'gpt-4.1-mini',identity:{providerId:'openai',transportModelId:'gpt-4.1-mini'},baseUrl:'https://exact-approved.example/'+ 'long-path/'.repeat(80),configurationHash:'a'.repeat(64)};
    window.proposals.setState({proposals:{b:{id:'proposal-b',primary:destination,destination,reason:'network unavailable'}}});
  });
  await page.getByRole('dialog',{name:'Approve fallback once?'}).waitFor();
  assert.equal(await page.getByText('Chat b',{exact:true}).count(),1);
  for(const width of [390,320,160]){await page.setViewportSize({width,height:700});assert.equal(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,`Ask overflow ${width}`);}
  await page.getByRole('button',{name:'Approve once'}).focus();await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(()=>window.actions.filter(a=>a[0]==='answer')),[['answer','b',true,'proposal-b']]);
  assert.deepEqual(errors,[]);
  console.log('PASS: consent/Ask pane ownership, named controls, keyboard approve/Escape, long destination, light/dark at 1280/390/320/160 CSS px (160px scaling fixture). Native GUI not performed.');
} finally {await browser?.close();await server.close();}
