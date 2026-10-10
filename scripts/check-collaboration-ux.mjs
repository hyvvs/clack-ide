// U1 browser breadth fixture. Native acceptance is recorded separately.
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
  ["src/modules/ai/store/chatStore", `import{create}from"zustand";export const useChatStore=create(()=>({sessions:[],runtimeBySession:{},activeSessionId:"b",pendingSelections:[],live:{},switchSession:()=>{},patchAgentMeta:()=>{}}));window.chat=useChatStore;export const chats=new Map();export const getChat=()=>null;export const cancelRun=async id=>window.actions.push(["stop",id]);export const isModelSelectionLocked=(id,s)=>s.sessions.find(x=>x.id===id)?.run?.state==="running";`],
  ["src/modules/ai/store/chatRuntime", `export const sendMessageToSession=async(id,message)=>window.actions.push(["send",id,message]);`],
  ["src/modules/ai/hooks/useWhisperRecording", `export const useWhisperRecording=()=>({});`],
  ["src/modules/ai/hooks/useSelfHostedSnapshot", `export const useSelfHostedSnapshot=()=>({state:{},snapshot:null});`],
  ["src/modules/ai/lib/modelCapabilities", `export * from "/src/modules/ai/lib/modelCapabilities.ts?u1-original";export const resolveModelInputCapabilities=()=>({});export const attachmentCapabilityStatus=()=>({supported:true});export const firstBlockedAttachment=()=>null;`],
  ["src/modules/ai/lib/attachments", `export * from "/src/modules/ai/lib/attachments.ts?u1-original";export const ATTACHMENT_LIMITS={maxTextBytes:65536};export const ACCEPTED_ATTACHMENT_FILES=".txt";export const createPendingPickerAttachment=f=>({id:f.name,displayName:f.name,processingState:"processing"});export const normalizePickerAttachment=async(f,meta)=>({...meta,displayName:f.name,kind:"text",source:{kind:"picker",token:f.name},processingState:"ready",contentRef:{id:"content-"+f.name,contentHash:"a".repeat(64)},extractedText:await f.text()});export const mergeAttachmentRecords=(old,added)=>({records:[...old,...added],rejected:[]});export const isDeliverableAttachment=f=>f.processingState==="ready";export const releaseAttachmentPreview=()=>{};export const releaseAttachmentRecordContent=()=>{};export const createSelectionAttachment=()=>{};export const normalizeWorkspaceAttachment=()=>{};export const persistAttachmentRecord=()=>{};`],
  ["src/modules/ai/lib/attachmentMessages", `export * from "/src/modules/ai/lib/attachmentMessages.ts?u1-original";export const toAttachmentMessagePart=f=>({type:"data-clack-attachment",data:{attachmentId:f.id,displayName:f.displayName,contentRef:f.contentRef}});`],
  ["src/modules/ai/store/agentsStore", `import{create}from"zustand";export const useAgentsStore=create(()=>({customAgents:[],activeId:"builtin:coder",all:()=>[{id:"builtin:coder",name:"Coder"},{id:"builtin:reviewer",name:"Reviewer"}]}));`],
  ["src/modules/ai/store/peerTaskStore", `import{create}from"zustand";export const usePeerTaskStore=create(()=>({tasks:[]}));`],
  ["src/modules/settings/preferences", `import{create}from"zustand";export const usePreferencesStore=create(()=>({customEndpoints:[],savedProviderModels:[]}));`],
  ["src/modules/ai/lib/sessions", `export const awaitSessionWrites=async()=>{};export const createConversationProfile=input=>({...input,workspaceId:input.workspaceRoot?"local:"+input.workspaceRoot:null});export const loadAll=async()=>({sessions:window.chat.getState().sessions,activeId:"b"});export const workspaceEnvironmentFromId=()=>({kind:"local"});`],
  ["src/modules/ai/lib/peerTaskCoordinator", `export const applyPeerTaskChangeSet=async id=>window.actions.push(["apply",id]);export const cancelPeerTask=async id=>window.actions.push(["cancel",id]);export const discardPeerTaskWorktree=async()=>{};`],
  ["src/modules/ai/lib/permissions", `export const canPersistPermission=()=>true;export const isStrictPermissionRequest=()=>false;export const permissionCategoryForTool=()=>"write-files";export const grantScopedPermission=async()=>true;export const resolveCurrentAgentPermission=()=>({outcome:"allow"});`],
  ["src/modules/ai/store/reasoningEffort", `export const sessionEffort=s=>({version:1,key:s.id,provider:"openai",adapter:"openai",model:"gpt-5.4",choice:"automatic",capability:{status:s.id==="a"?"supported":"unsupported",levels:["low","high"],mapping:"responses",evidence:"fixture",revision:"1"}});export const setSessionEffort=async(id,value)=>window.actions.push(["effort",id,value]);`],
  ["core", `export async function invoke(command,args){window.calls.push([command,args]);if(command==="conversation_memory_load"){if(window.hold===args.owner.sessionId){const value=window.memory(args.owner);return new Promise(r=>window.release=()=>r(value));}return window.memory(args.owner);}if(command==="conversation_memory_evidence")return{original:"Verified original evidence for "+args.owner.sessionId};if(command==="target_context_load"){if(window.targetFailure)throw Error("Prepared context missing");return window.memory(args.owner).revision;}if(command==="custom_tools_load")return{revision:2,entries:window.tools(args.sessionId)};if(command==="mcp_connections_load")return{revision:1,connections:[]};if(command==="custom_tool_history")return[{id:"call-"+args.sessionId,sessionId:args.sessionId,toolName:"Remote result "+args.sessionId,tool:{version:3},state:"interrupted",effect:"unknown",mcp:{endpoint:"https://evidence.example/mcp/"+"long/".repeat(50)},result:null,error:"Outcome uncertain; not replayed"}];throw Error("Unexpected IPC "+command);}`],
  ["event", `export const listen=async()=>()=>{};export const emit=async()=>{};export const emitTo=async()=>{};`],
  ["@tauri-apps/plugin-store", `export class LazyStore{async get(){return undefined;}async set(){}async save(){}async entries(){return [];}async onChange(){return()=>{};}}`],
]);
const entry = `
import React,{useState}from"react";import{createRoot}from"react-dom/client";
import{useChatStore}from"/src/modules/ai/store/chatStore.ts";
import{ContextSources}from"/src/modules/ai/components/ContextSources.tsx";
import{CustomToolsManager}from"/src/modules/ai/components/CustomToolsManager.tsx";
import{Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogTrigger}from"/src/components/ui/dialog.tsx";
import{PeerTaskCard}from"/src/modules/ai/components/PeerTaskFeed.tsx";
import{AiToolApproval}from"/src/modules/ai/components/AiToolApproval.tsx";
import{EffortControl}from"/src/modules/ai/components/EffortControl.tsx";
import{ActivityTimeline}from"/src/modules/ai/components/ActivityTimeline.tsx";
import{ModelSwitchNotice}from"/src/modules/ai/components/ModelSwitchNotice.tsx";
import{AiComposerProvider,useComposer}from"/src/modules/ai/lib/composer.tsx";
import{applyTheme}from"/src/modules/theme/applyTheme.ts";import{sage}from"/src/modules/theme/themes/sage.ts";import{teraxDefault}from"/src/modules/theme/themes/terax-default.ts";
import"/src/styles/globals.css";
window.calls=[];window.actions=[];
window.setTheme=mode=>{document.documentElement.className=mode;applyTheme(mode==="light"?sage:teraxDefault,mode);};
const sessions=["a","b"].map(id=>({id,title:"Long-conversation-".repeat(12)+id,createdAt:1,updatedAt:1,profile:{agentId:"builtin:coder",modelId:"model",workspaceId:"local:/"+id,workspaceRoot:"/workspace/"+"long/".repeat(25)+id}}));
useChatStore.setState({sessions});
window.memory=owner=>({preparation:{owner},revisionId:"hash-"+owner.sessionId,sourceChanged:owner.sessionId==="b",uncoveredMessages:1,revision:{revision:2,coverage:{start:0,end:1,digest:"f".repeat(64),latestMessageId:"original"},evidence:[{id:"source"}],claims:[{id:"claim",section:"constraints",status:owner.sessionId==="a"?"verified-observation":"stale",text:"Saved bounded context "+owner.sessionId,sources:["source"],contradicts:owner.sessionId==="b"?["other"]:[]}]}});
window.tools=id=>[{id:"tool",workspaceId:"local:/"+id,current:{version:3,hash:"a".repeat(64),status:"authorized",enabled:true,source:"native-user",sessionId:id,agentId:"builtin:coder",createdAt:1,definition:{name:"custom_read_"+id,description:"Scoped evidence",binding:{kind:"native",operation:"read_file"},scope:"conversation",agents:["builtin:coder"],conversations:[id],permissions:["read-files"]}},versions:[],eligible:true,executable:true,runtime:"Guarded native execution"},{id:"unsupported",workspaceId:"local:/"+id,current:{version:1,status:"draft",enabled:false,definition:{name:"unavailable_script",description:"Unsupported",scope:"conversation",agents:["builtin:reviewer"],binding:{kind:"script"}}},versions:[],eligible:false,executable:false,runtime:"Native process launch unavailable"}];
const message=id=>({id:"original",role:"assistant",parts:[{type:"text",text:"Original transcript "+id}],metadata:{clackActivity:{version:1,owner:{sessionId:id,workspaceId:"local:/"+id,runId:id+":1",agentId:"builtin:coder",modelId:"model"},receipts:[{id:"progress",kind:"progress",label:"Assistant progress",at:1}],omitted:0}}});
const canonical=v=>Array.isArray(v)?"["+v.map(canonical).join(",")+"]":v&&typeof v==="object"?"{"+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,c])=>JSON.stringify(k)+":"+canonical(c)).join(",")+"}":JSON.stringify(v);
useChatStore.setState({runtimeBySession:Object.fromEntries(["a","b"].map(id=>[id,{retrievalNotice:{status:"original evidence",omitted:0,sources:[{messageId:"original",evidenceId:"retrieved",digest:"d".repeat(64),reason:"explicit source",original:canonical(message(id))},{messageId:"missing",evidenceId:"missing",digest:"e".repeat(64),reason:"missing evidence",original:"{}"}]}}]))});
const task=id=>({schemaVersion:7,id:"task-"+id,sourceSessionId:id,targetSessionId:"recipient-"+id,sourceAgentId:"builtin:architect",sourceModelId:"cloud",targetAgentId:"builtin:reviewer",targetModelId:"Long-model-name-".repeat(15),workspaceId:"local:/"+id,workspaceRoot:sessions.find(s=>s.id===id).profile.workspaceRoot,workspaceEnvironment:{kind:"local"},kind:"review",executionMode:"isolated-worktree",prompt:"Review-title-".repeat(100),artifactRefs:[],parentTaskId:null,rootTaskId:"task-"+id,hopCount:0,dependsOn:[],status:"running",createdAt:1,updatedAt:2,communication:[{id:"question-"+id,kind:"clarification-request",state:"delivered",text:"Which bounds apply?",sender:{agentId:"builtin:reviewer",sessionId:"recipient-"+id},recipient:{agentId:"builtin:architect",sessionId:id},taskId:"task-"+id,sequence:1,evidence:[],digest:"a".repeat(64),workspaceId:"local:/"+id}],handoff:{sources:["artifact"],omitted:2,digest:"b".repeat(64)},review:{files:[{path:"path/".repeat(100)+"file.ts",hash:"c".repeat(64)}],patches:[],results:[]}});
const el=React.createElement;
function SettingsToolsFixture({sessionId}){return el(Dialog,null,el(DialogTrigger,{asChild:true},el("button",null,"Manage tools in Settings")),el(DialogContent,{className:"max-h-[85dvh] overflow-y-auto"},el(DialogHeader,null,el(DialogTitle,null,"Agent tools"),el(DialogDescription,null,"Canonical Settings manager fixture")),el(CustomToolsManager,{sessionId})));}
function Draft({id}){const c=useComposer();return el("div",{style:{minWidth:0}},el("textarea",{"aria-label":"Draft "+id,value:c.value,onChange:e=>c.setValue(e.target.value),ref:c.textareaRef,style:{width:"100%",minWidth:0}}),el("input",{type:"file","aria-label":"Attachments "+id,onChange:e=>c.addFiles(e.target.files),style:{width:"100%",minWidth:0}}),el("p",null,c.files.map(f=>f.displayName+" / "+f.processingState).join(",")),el("button",{onClick:c.submit},"Send "+id),el("button",{onClick:c.stop},"Stop "+id));}
function Pane({initial}){const[id,setId]=useState(initial);window["switch"+initial]=setId;const msgs=[message(id)];return el("section",{"aria-label":"Pane "+initial,"data-conversation-pane":id,style:{minWidth:0,borderBottom:"1px solid var(--border)",padding:12}},
el("div",{style:{display:"flex",flexWrap:"wrap",gap:4}},el(SettingsToolsFixture,{key:"tools-"+id,sessionId:id}),el(EffortControl,{sessionId:id})),
el(AiComposerProvider,{key:"composer-"+id,sessionId:id,consumeExternalEvents:false},el(Draft,{id})),
el(ContextSources,{key:"context-"+id,sessionId:id,messages:msgs}),
el("div",{"data-evidence-message":"original",tabIndex:-1},msgs[0].parts[0].text),
el(ActivityTimeline,{sessionId:id,workspaceId:"local:/"+id,messages:msgs,tasks:[task(id)]}),
el(AiToolApproval,{sessionId:id,toolName:"write_file",part:{input:{path:"path/".repeat(100)+"out.ts",content:"material"},approval:{id:"approval-"+id}},onRespond:approved=>window.actions.push(["approval",id,approved])}),
el(PeerTaskCard,{task:task(id),viewingSessionId:id}),
el(ModelSwitchNotice,{targetLabel:"Target-".repeat(100),assessment:{status:"blocked",reasons:["Required context cannot fit; attachment incompatible"],contextLimit:2048,estimatedTokens:5000,workingBudget:1024},onBack:()=>window.actions.push(["model-back",id]),onConfirm:()=>{}}));}
createRoot(document.getElementById("root")).render(el("main",{className:"zoom-content",style:{maxWidth:1000,margin:"auto",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(320px,100%),1fr))"}},el(Pane,{initial:"a"}),el(Pane,{initial:"b"})));
`;
const server = await createServer({ root, cacheDir:path.join(os.tmpdir(),`clack-u1-vite-${process.pid}`), configFile:false, logLevel:"warn",
  optimizeDeps:{entries:[],noDiscovery:true,include:["react","react-dom/client","react/jsx-runtime","zustand","zod","ai","@ai-sdk/react","@ai-sdk/provider-utils","@vercel/oidc","@hugeicons/react","@hugeicons/core-free-icons","class-variance-authority","radix-ui","clsx","tailwind-merge"]}, resolve:{alias:{"@":path.join(root,"src")}},
  plugins:[{name:"u1-fixture",enforce:"pre",resolveId(source,importer){if(source==="/u1-entry.jsx")return"\0u1-entry.jsx";if(source==="@tauri-apps/api/core")return"\0mock:core";if(source==="@tauri-apps/api/event")return"\0mock:event";if(mocks.has(source))return"\0mock:"+source;const absolute=source.startsWith("/src/")?path.join(root,source.slice(1)):source.startsWith(".")&&importer?path.resolve(path.dirname(importer),source):source;const relative=path.relative(root,absolute).replaceAll("\\","/").replace(/\.[jt]sx?$/,"");return mocks.has(relative)?"\0mock:"+relative:null;},load(id){if(id==="\0u1-entry.jsx")return entry;if(id.startsWith("\0mock:"))return mocks.get(id.slice(6));},configureServer(vite){vite.middlewares.use("/u1-fixture",async(_req,res)=>{res.setHeader("Content-Type","text/html");res.end(await vite.transformIndexHtml("/u1-fixture",'<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:var(--background);color:var(--foreground)"><div id="root"></div><script type="module" src="/u1-entry.jsx"></script></body></html>'));});}},react(),tailwindcss()],server:{host:"127.0.0.1",port:0,watch:null,hmr:false} });
let browser;
try {
  await server.listen(); browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
  for(const [width,zoom,theme] of [[1280,1,"dark"],[640,1,"light"],[320,1,"dark"],[640,2,"light"]]) {
    console.log(`U1 ${width}px / ${zoom*100}% / ${theme}`);
    const page=await browser.newPage({viewport:{width,height:1000}});page.setDefaultTimeout(20000);
    const errors=[];page.on("pageerror",e=>{errors.push(e.message);console.error(e.message);});
    await page.goto(server.resolvedUrls.local[0]+"u1-fixture",{waitUntil:"load",timeout:120000});
    const a=page.getByRole("region",{name:"Pane a"}),b=page.getByRole("region",{name:"Pane b"});await a.waitFor();
    await page.evaluate(({zoom,theme})=>{document.documentElement.style.setProperty("--app-zoom",String(zoom));window.setTheme(theme);}, {zoom,theme});
    assert.equal(await page.evaluate(()=>window.calls.length),0,"Collapsed inspection must not read native state");
    await a.getByText("Sources & context",{exact:true}).focus();await page.keyboard.press("Enter");
    await a.getByText(/1 original messages summarized/).waitFor();
    await b.getByText("Sources & context",{exact:true}).click();await b.getByText(/summary sources changed/).waitFor();
    await a.getByText("Saved summary (1)",{exact:true}).click();await b.getByText("Saved summary (1)",{exact:true}).click();
    await b.getByText(/stale.*conflicting statements/).waitFor();
    await a.getByRole("button",{name:"Inspect source 1 for constraints"}).click();await a.getByLabel("Retained original evidence").filter({hasText:"for a"}).waitFor();
    assert.equal(await b.getByLabel("Retained original evidence").count(),0);
    await a.getByText("Retrieved original evidence (2)",{exact:true}).click();
    await a.getByRole("button",{name:/View original assistant message/}).click();
    assert.equal(await a.locator("[data-evidence-message]").evaluate(el=>document.activeElement===el),true,"Source focus belongs to its pane");
    assert.equal(await a.getByRole("button",{name:/Source changed or unavailable/}).isDisabled(),true);
    await a.getByLabel("Draft a").fill("PRIVATE_DRAFT_A");await b.getByLabel("Draft b").fill("PRIVATE_DRAFT_B");
    await a.getByLabel("Attachments a").setInputFiles({name:"private-a.txt",mimeType:"text/plain",buffer:Buffer.from("A only")});await a.getByText("private-a.txt / ready",{exact:true}).waitFor();
    await b.getByLabel("Attachments b").setInputFiles({name:"private-b.txt",mimeType:"text/plain",buffer:Buffer.from("B only")});await b.getByText("private-b.txt / ready",{exact:true}).waitFor();
    await page.evaluate(()=>window.chat.setState(s=>({activeSessionId:"a",sessions:s.sessions.map(x=>({...x,profile:{...x.profile,modelId:"changed",agentId:"builtin:reviewer"}}))})));
    assert.equal(await a.getByLabel("Draft a").inputValue(),"PRIVATE_DRAFT_A");assert.equal(await b.getByLabel("Draft b").inputValue(),"PRIVATE_DRAFT_B");
    await a.getByRole("button",{name:"Send a",exact:true}).click();
    await page.waitForFunction(()=>window.actions.some(x=>x[0]==="send"));
    const sent=await page.evaluate(()=>window.actions.find(x=>x[0]==="send"));assert.equal(sent[1],"a");assert.equal(sent[2].parts[0].text,"PRIVATE_DRAFT_A");assert.equal(sent[2].parts[1].data.attachmentId,"private-a.txt");assert.equal(JSON.stringify(sent).includes("PRIVATE_DRAFT_B"),false);
    assert.equal(await b.getByLabel("Draft b").inputValue(),"PRIVATE_DRAFT_B");assert.equal(await b.getByText("private-b.txt / ready",{exact:true}).count(),1);
    await a.getByRole("button",{name:"Stop a",exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.actions.at(-1)),["stop","a"]);
    await a.getByRole("button",{name:"Allow once",exact:true}).focus();await page.keyboard.press("Space");await b.getByRole("button",{name:"Deny",exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.actions.slice(-2)),[["approval","a",true],["approval","b",false]]);
    await a.getByText("Task details and provenance",{exact:true}).click();await a.getByText(/Recipient-sized handoff: 1 evidence sources; 2 omitted/).waitFor();
    await a.getByText(/Review target: 1 captured files/).waitFor();await a.getByText("Code Reviewer asks Architect",{exact:true}).waitFor();
    await a.getByRole("button",{name:"Cancel task",exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.actions.at(-1)),["cancel","task-a"]);
    await a.getByRole("button",{name:"Reasoning effort: Automatic"}).click();await page.getByText("Effort does not control reasoning visibility.",{exact:true}).waitFor();
    assert.deepEqual(await page.getByLabel("Reasoning effort",{exact:true}).locator("option").allTextContents(),["Automatic","Low","High"]);await page.keyboard.press("Escape");
    assert.equal(await b.getByRole("button",{name:"Reasoning effort: Automatic"}).count(),0);
    const tools=a.getByRole("button",{name:"Manage tools in Settings"});await tools.focus();await page.keyboard.press("Enter");
    const dialog=page.getByRole("dialog").first();await dialog.waitFor();await dialog.getByText("custom_read_a",{exact:false}).first().waitFor();
    assert.equal(await dialog.getByLabel("Workspace conversation").inputValue(),"a");assert.equal(await dialog.getByLabel("Workspace conversation").isDisabled(),true);
    await dialog.getByText("Native process launch unavailable",{exact:true}).waitFor();await dialog.getByText("Remote result a v3: interrupted / effect unknown",{exact:true}).click();
    await dialog.getByText(/https:\/\/evidence.example\/mcp/).waitFor();
    assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,"Tool dialog overflow");
    await page.keyboard.press("Escape");await dialog.waitFor({state:"detached"});assert.equal(await tools.evaluate(el=>document.activeElement===el),true,"Dialog focus return");
    await page.evaluate(()=>window.chat.setState(s=>({sessions:s.sessions.map(x=>x.id==="a"?{...x,run:{state:"running",startedAt:1}}:x)})));
    await a.getByRole("button",{name:"Reasoning effort: Automatic"}).click();assert.equal(await page.getByLabel("Reasoning effort",{exact:true}).isDisabled(),true);await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,"Page overflow");
    assert.equal(await a.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,"Pane overflow");
    if(process.env.U1_SCREENSHOTS){await mkdir(process.env.U1_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.U1_SCREENSHOTS,`u1-${width}-${zoom}-${theme}.png`),fullPage:true});await page.screenshot({path:path.join(process.env.U1_SCREENSHOTS,`u1-${width}-${zoom}-${theme}-viewport.png`)});}
    await page.evaluate(()=>{window.targetFailure=true;window.chat.setState(s=>({sessions:s.sessions.map(x=>x.id==="a"?{...x,targetContext:{key:"prepared"}}:x)}));});
    await a.getByText("Prepared model-switch context needs revalidation.",{exact:true}).waitFor();
    await a.getByRole("alert").filter({hasText:"Prepared context unavailable"}).waitFor();
    await a.getByText(/1 original messages summarized/).waitFor();
    await page.evaluate(()=>{window.hold="a";window.chat.setState(s=>({sessions:s.sessions.map(x=>x.id==="a"?{...x,targetContext:null,run:{state:"completed"}}:x)}));});
    await page.waitForFunction(()=>Boolean(window.release));await page.evaluate(()=>window.switcha("b"));
    await a.getByText("Sources & context",{exact:true}).click();
    await a.getByText(/summary sources changed/).waitFor();await page.evaluate(()=>window.release());
    assert.equal(await a.getByText(/1 original messages summarized/).count(),0,"Late read cannot overwrite a rebound pane");
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log("U1 browser breadth passed: pane-bound drafts/attachments/approvals/tools/Stop, lazy verified/stale/conflicting context, retained-source focus and stale-read isolation, preparation-failure isolation, provenance/handoff/review/clarification, bounded long content, effort support/locks, unknown effects, keyboard/dialog focus, 320px and 200% zoom, light/dark. Mocked browser evidence, not native acceptance.");
} finally {await browser?.close();await server.close();}
