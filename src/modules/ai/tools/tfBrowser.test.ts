import { afterEach,describe,expect,it,vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { ToolContext } from "./context";
import { buildTools } from "./tools";
import {
  clearAllChatPermissionsForTests,recordTfApprovedToolCall,
} from "@/modules/ai/lib/permissions";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  buildTfBrowserTools,TF_BROWSER_SCHEMAS,
  isTfBrowserTool,validateTfBrowserInput,
} from "./tfBrowser";

vi.mock("@tauri-apps/api/core",()=>({invoke:vi.fn(),Channel:class{}}));
const invokeMock=vi.mocked(invoke);
const browserSessionId="a".repeat(48);
const snapshotId="b".repeat(48);
const elementId="c".repeat(48);
const validUrl="https://docs.example.org/topic";
const expectedHash="7509e5bda0c762d2bac7f90d758b5b2263fa01ccbc542ab5e3df163be08e6ca9";
let agent="builtin:coder";
let session="chat-1";
let workspace="/workspace";
function context():ToolContext {
  return {
    getAgentId:()=>agent,getSessionId:()=>session,
    getWorkspaceRoot:()=>workspace,getCwd:()=>"/workspace/src",
    readCache:new Map(),getTerminalContext:()=>null,
    isActiveTerminalPrivate:()=>false,injectIntoActivePty:()=>false,
    openPreview:()=>false,spawnAgent:()=>null,readAgentOutput:()=>null,
  };
}
const prepared=(operation:string,requiresApproval:boolean,
  browserId:string|null=browserSessionId)=>({
  token:"once-token",requestId:"native-browser-request",operation,
  requiresApproval,workspaceRoot:"/workspace",
  browserSessionId:browserId,
  engine:"inert_native_text",isolation:"native-no-os-browser-network-sandbox",
});
const receipt=(operation:string)=>({
  toolId:"tf.browser_operation.v1",requestId:"native-browser-request",
  actor:"builtin:coder",sessionId:"chat-1",operation,
  browserSessionId,terminal:"completed",effectState:"Unknown",
  reasonCode:"ok",policyDecision:"allowed",retry:"none",autoRetry:false,
  engine:"inert_native_text",isolation:"native-no-os-browser-network-sandbox",
  requestedUrl:validUrl,finalUrl:validUrl,redirectChain:[],
  statusCode:200,contentType:"text/plain",bytesReceived:12,bytesRetained:12,
  truncated:false,contentSha256:expectedHash,body:"hello world!",
  snapshotId,elements:[
    {id:elementId,text:"Documentation",url:"https://docs.example.org/next",
      unverified:true},
  ],
  startedAt:1795310000000,endedAt:1795310000500,
  uncertainty:"remote-action-attribution-unverified",dnsEvidence:[],
  unsupported:["arbitrary_javascript","screenshot"],
});
const run=async(
  name:keyof ReturnType<typeof buildTfBrowserTools>,input:unknown,
  options:Record<string,unknown>={},
)=>{
  const definitions=buildTfBrowserTools(context());
  return definitions[name].execute!(input as never,
    {toolCallId:"ui-exact-once",...options} as never);
};

describe("TF4 inert native browser SDK",()=>{
  afterEach(()=>{
    vi.resetAllMocks();
    clearAllChatPermissionsForTests();
    agent="builtin:coder";session="chat-1";workspace="/workspace";
  });

  it("registers only supported native operations and rejects broad model authority",async()=>{
    expect(Object.keys(TF_BROWSER_SCHEMAS)).toEqual([
      "tf_browser_open","tf_browser_navigate","tf_browser_inspect",
      "tf_browser_click","tf_browser_back","tf_browser_close",
    ]);
    expect(isTfBrowserTool("tf_browser_screenshot")).toBe(false);
    expect(isTfBrowserTool("tf_browser_type")).toBe(false);
    expect(isTfBrowserTool("tf_browser_scroll")).toBe(false);
    for(const [name,input] of [
      ["tf_browser_open",{url:validUrl}],
      ["tf_browser_navigate",{browserSessionId,url:validUrl,timeoutMs:3000}],
      ["tf_browser_inspect",{browserSessionId,snapshotId}],
      ["tf_browser_click",{browserSessionId,snapshotId,elementId}],
      ["tf_browser_back",{browserSessionId}],
      ["tf_browser_close",{browserSessionId}],
    ] as const)expect(validateTfBrowserInput(name,input)).toBe(true);
    for(const [name,input] of [
      ["tf_browser_open",{url:"file:///etc/passwd"}],
      ["tf_browser_open",{url:"http://localhost:9222"}],
      ["tf_browser_open",{url:"https://user:pass@docs.example.org"}],
      ["tf_browser_open",{url:validUrl,headers:{Authorization:"secret"}}],
      ["tf_browser_open",{url:validUrl,javascript:"document.cookie"}],
      ["tf_browser_navigate",{browserSessionId,url:validUrl,method:"POST"}],
      ["tf_browser_navigate",{browserSessionId,url:validUrl,timeoutMs:60_000}],
      ["tf_browser_inspect",{browserSessionId:"browser-invalid"}],
      ["tf_browser_inspect",{browserSessionId,maxBytes:4096}],
      ["tf_browser_inspect",{browserSessionId,selector:"body"}],
      ["tf_browser_click",{browserSessionId,snapshotId,
        selector:"#submit",text:"confirm"}],
      ["tf_browser_click",{browserSessionId,snapshotId,elementId,
        mouseButton:"right"}],
      ["tf_browser_click",{browserSessionId,snapshotId,elementId:"button-3"}],
      ["tf_browser_back",{browserSessionId,count:3}],
      ["tf_browser_close",{browserSessionId,cookies:true}],
    ] as const)expect(validateTfBrowserInput(name,input)).toBe(false);
    expect(await run("tf_browser_open",{url:validUrl,script:"1+1"}))
      .toMatchObject({ok:false,code:"tf_browser_input_invalid",
        effectState:"NoEffect"});
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("prepares and approves exact open with actor/session/root from run",async()=>{
    invokeMock.mockImplementation(async command=>{
      if(command==="tf_browser_prepare")return prepared("open",true,null) as never;
      if(command==="tf_browser_approve")return undefined as never;
      if(command==="tf_browser_execute")return receipt("open") as never;
      throw Error("Unexpected native command");
    });
    const result=await run("tf_browser_open",{url:validUrl,maxBytes:2048});
    expect(result).toMatchObject({
      ok:true,engine:"inert_native_text",sourceKind:"native-browser-text",
      untrusted:true,browserSessionId,
      snapshot:{id:snapshotId,title:"docs.example.org",
        excerpt:"hello world!",elements:[
          {id:elementId,unverified:true},
        ]},
      effectReceipt:{toolId:"tf.browser_operation.v1",
        effectState:"Unknown",autoRetry:false,elementCount:1},
    });
    expect((result as {effectReceipt?:unknown}).effectReceipt)
      .not.toHaveProperty("body");
    expect(invokeMock).toHaveBeenCalledWith("tf_browser_prepare",{request:{
      operation:"open",actor:"builtin:coder",sessionId:"chat-1",
      workspaceRoot:"/workspace",url:validUrl,maxBytes:2048,
    }});
    expect(invokeMock.mock.calls.map(([command])=>command)).toEqual([
      "tf_browser_prepare","tf_browser_approve","tf_browser_execute",
    ]);
  });

  it("snapshots an existing browser without a second native OS approval",async()=>{
    invokeMock.mockImplementation(async command=>{
      if(command==="tf_browser_prepare")return prepared("snapshot",false) as never;
      if(command==="tf_browser_execute")return receipt("snapshot") as never;
      throw Error("Unexpected native command");
    });
    const result=await run("tf_browser_inspect",{browserSessionId,snapshotId});
    expect(result).toMatchObject({ok:true,snapshot:{id:snapshotId}});
    expect(invokeMock.mock.calls.map(([command])=>command)).toEqual([
      "tf_browser_prepare","tf_browser_execute",
    ]);
  });

  it("clicks only a link ID tied to the prepared native browser and snapshot",async()=>{
    invokeMock.mockImplementation(async command=>{
      if(command==="tf_browser_prepare")return prepared("click_link",true) as never;
      if(command==="tf_browser_approve")return undefined as never;
      if(command==="tf_browser_execute")return {
        ...receipt("click_link"),requestedUrl:null,
        finalUrl:"https://docs.example.org/next",
      } as never;
      throw Error("Unexpected native command");
    });
    const result=await run("tf_browser_click",{
      browserSessionId,snapshotId,elementId,
    });
    expect(result).toMatchObject({ok:true,finalUrl:"https://docs.example.org/next"});
    expect(invokeMock).toHaveBeenCalledWith("tf_browser_prepare",{request:{
      operation:"click_link",actor:"builtin:coder",sessionId:"chat-1",
      workspaceRoot:"/workspace",browserSessionId,snapshotId,elementId,
    }});
  });

  it("closes the scoped session without native OS approval",async()=>{
    invokeMock.mockImplementation(async command=>{
      if(command==="tf_browser_prepare")return prepared("close",false) as never;
      if(command==="tf_browser_execute")return {
        ...receipt("close"),body:null,bytesReceived:null,bytesRetained:0,
        statusCode:null,contentType:null,contentSha256:null,
        snapshotId:null,finalUrl:null,requestedUrl:null,elements:[],
      } as never;
      throw Error("Unexpected native command");
    });
    expect(await run("tf_browser_close",{browserSessionId}))
      .toMatchObject({ok:true,browserSessionId,
        effectReceipt:{elementCount:0,autoRetry:false}});
    expect(invokeMock.mock.calls.map(([command])=>command)).toEqual([
      "tf_browser_prepare","tf_browser_execute",
    ]);
  });

  it("bounds native inert page excerpts and link lists without leaking raw bodies",async()=>{
    const body="x".repeat(32_000);
    const hash=Array.from(new Uint8Array(await globalThis.crypto.subtle.digest(
      "SHA-256",new TextEncoder().encode(body))),
      byte=>byte.toString(16).padStart(2,"0")).join("");
    const elements=Array.from({length:64},(_,index)=>({
      id:index.toString(16).padStart(48,"0"),
      text:"Link title ".repeat(30),
      url:"https://docs.example.org/link/"+index,unverified:true,
    }));
    invokeMock.mockImplementation(async command=>{
      if(command==="tf_browser_prepare")return prepared("snapshot",false) as never;
      if(command==="tf_browser_execute")return {
        ...receipt("snapshot"),body,bytesRetained:body.length,
        bytesReceived:body.length,contentSha256:hash,elements,
      } as never;
      throw Error("Unexpected native command");
    });
    const result=await run("tf_browser_inspect",{browserSessionId});
    expect(result).toMatchObject({ok:true,snapshot:{truncated:true},
      effectReceipt:{elementCount:64}});
    const details=(result as {snapshot?:{
      excerpt:string;elements:{text:string}[]},effectReceipt?:unknown});
    expect(details.snapshot?.excerpt.length).toBe(12_000);
    expect(details.snapshot?.elements).toHaveLength(16);
    expect(details.snapshot?.elements.every(item=>item.text.length<=200)).toBe(true);
    expect(details.effectReceipt).not.toHaveProperty("body");
    expect(details.effectReceipt).not.toHaveProperty("elements");
  });

  it("rejects mismatched prepared operation, root, browser session and engine",async()=>{
    const mismatches=[
      {operation:"click_link"},
      {workspaceRoot:"/other-project"},
      {browserSessionId:"someone-elses-browser"},
      {engine:"arbitrary_js"},
      {requiresApproval:true},
    ];
    for(const change of mismatches){
      invokeMock.mockReset();
      invokeMock.mockImplementation(async command=>{
        if(command==="tf_browser_prepare")
          return {...prepared("snapshot",false),...change} as never;
        if(command==="tf_browser_cancel")return true as never;
        throw Error("Unexpected native command");
      });
      expect(await run("tf_browser_inspect",{browserSessionId}))
        .toMatchObject({ok:false,
          effectState:"Unknown",autoRetry:false});
      expect(invokeMock.mock.calls.map(([command])=>command))
        .not.toContain("tf_browser_execute");
    }
  });

  it("fails closed for forged receipt request/session/engine, oversize text and invalid hash",async()=>{
    const changes=[
      {requestId:"wrong-request"},
      {actor:"builtin:architect"},
      {sessionId:"other-chat"},
      {browserSessionId:"other-browser"},
      {engine:"live_script_runner"},
      {isolation:"unknown-network"},
      {bytesRetained:70_000},
      {contentSha256:"0".repeat(64)},
      {statusCode:404},
      {snapshotId:null},
      {body:null},
      {finalUrl:"http://127.0.0.1/"},
      {elements:[{id:elementId,text:"x",url:validUrl,unverified:false}]},
    ];
    for(const change of changes){
      invokeMock.mockReset();
      invokeMock.mockImplementation(async command=>{
        if(command==="tf_browser_prepare")return prepared("snapshot",false) as never;
        if(command==="tf_browser_execute")
          return {...receipt("snapshot"),...change} as never;
        throw Error("Unexpected native command");
      });
      const result=await run("tf_browser_inspect",{browserSessionId});
      expect(result).toMatchObject({ok:false,effectState:"Unknown",
        retry:"no_auto_retry",autoRetry:false});
    }
  });

  it("abort before prepare avoids native effects; abort during execute cancels",async()=>{
    const aborted=new AbortController();aborted.abort();
    expect(await run("tf_browser_open",{url:validUrl},
      {abortSignal:aborted.signal})).toMatchObject({
        ok:false,code:"tf_browser_cancelled_before_prepare",effectState:"NoEffect",
    });
    expect(invokeMock).not.toHaveBeenCalled();
    const during=new AbortController();
    invokeMock.mockImplementation(async command=>{
      if(command==="tf_browser_prepare")return prepared("snapshot",false) as never;
      if(command==="tf_browser_cancel")return true as never;
      if(command==="tf_browser_execute"){
        during.abort();
        return receipt("snapshot") as never;
      }
      throw Error("Unexpected native command");
    });
    expect(await run("tf_browser_inspect",{browserSessionId},
      {abortSignal:during.signal})).toMatchObject({
        ok:false,code:"tf_browser_cancelled_during_execute",effectState:"Unknown",
    });
    expect(invokeMock.mock.calls.map(([command])=>command))
      .toContain("tf_browser_cancel");
  });

  it("owner changes during native approval cancel without executing",async()=>{
    invokeMock.mockImplementation(async command=>{
      if(command==="tf_browser_prepare")return prepared("navigate",true) as never;
      if(command==="tf_browser_approve"){session="other-chat";return undefined as never;}
      if(command==="tf_browser_cancel")return true as never;
      throw Error("Unexpected native command");
    });
    const result=await run("tf_browser_navigate",{browserSessionId,url:validUrl});
    expect(result).toMatchObject({ok:false,
      code:"tf_browser_owner_changed_before_execute",effectState:"Unknown"});
    expect(invokeMock.mock.calls.map(([command])=>command))
      .not.toContain("tf_browser_execute");
    expect(invokeMock.mock.calls.map(([command])=>command))
      .toContain("tf_browser_cancel");
  });

  it("buildTools requires and consumes the central exact one-use approval",async()=>{
    const previous=usePreferencesStore.getState().agentPermissionProfiles;
    usePreferencesStore.setState({agentPermissionProfiles:{
      ...previous,"builtin:coder":{mode:"full-access",categories:{}},
    }});
    try {
      const parameters={browserSessionId};
      const tools=buildTools(context());
      const unapproved=await tools.tf_browser_close.execute!(parameters,
        {toolCallId:"unapproved"} as never);
      expect(unapproved)
        .toMatchObject({code:"tf_exact_approval_required",effectState:"NoEffect"});
      expect(invokeMock).not.toHaveBeenCalled();
      expect(recordTfApprovedToolCall({
        toolCallId:"allow-browser-close-once",sessionId:"chat-1",
        agentId:"builtin:coder",workspaceRoot:"/workspace",
        cwd:"/workspace/src",toolName:"tf_browser_close",parameters,
      })).toBe(true);
      invokeMock.mockImplementation(async command=>{
        if(command==="tf_browser_prepare")return prepared("close",false) as never;
        if(command==="tf_browser_execute")return {
          ...receipt("close"),body:null,bytesReceived:null,bytesRetained:0,
          statusCode:null,contentType:null,contentSha256:null,
          snapshotId:null,finalUrl:null,requestedUrl:null,elements:[],
        } as never;
        throw Error("Unexpected native command");
      });
      expect(await tools.tf_browser_close.execute!(parameters,
        {toolCallId:"allow-browser-close-once"} as never))
        .toMatchObject({ok:true,engine:"inert_native_text"});
      invokeMock.mockClear();
      expect(await tools.tf_browser_close.execute!(parameters,
        {toolCallId:"allow-browser-close-once"} as never))
        .toMatchObject({code:"tf_exact_approval_required",effectState:"NoEffect"});
      expect(invokeMock).not.toHaveBeenCalled();
    } finally {
      usePreferencesStore.setState({agentPermissionProfiles:previous});
    }
  });
});
