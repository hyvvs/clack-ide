import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { ToolContext } from "./context";
import { buildTfWebTools, TF_WEB_SCHEMAS, validateTfWebInput } from "./tfWeb";
import {
  invalidateTfWebSearchProviderStatus, isTfWebSearchProviderAvailable,
  refreshTfWebSearchProviderStatus,
} from "@/modules/ai/lib/webSearchAdapters";

vi.mock("@tauri-apps/api/core",()=>({invoke:vi.fn()}));
const call=vi.mocked(invoke);
const context=():ToolContext=>({
  getCwd:()=>"/workspace/src",getWorkspaceRoot:()=>"/workspace",
  getSessionId:()=>"chat-1",getAgentId:()=>"builtin:coder",
  readCache:new Map(),getTerminalContext:()=>null,
  isActiveTerminalPrivate:()=>false,injectIntoActivePty:()=>false,
  openPreview:()=>false,spawnAgent:()=>null,readAgentOutput:()=>null,
});
const prepared=(operation:string,requiresApproval=false)=>({
  token:"native-once-token",requestId:"native-web-request-1",operation,
  requiresApproval,workspaceRoot:"/workspace",isolation:"native-web-isolation",
});
const provider=()=>({
  provider:"brave_web",configured:true,available:true,reasonCode:"ready",
  credentialReference:"credential:brave-web-search",
  isolation:"native-web-isolation",
});
const searchResult={
  id:"b".repeat(48),title:"Official docs",
  url:"https://docs.example.org/topic",snippet:"Search result snippet",
  provider:"brave_web",rank:1,observedAt:1795310000000,
};
const receipt=(operation:string)=>({
  toolId:"tf.web_operation.v1",requestId:"native-web-request-1",
  actor:"builtin:coder",operation,terminal:"completed",
  effectState:"Observed",requestedUrl:"https://docs.example.org/topic",
  finalUrl:"https://docs.example.org/topic",redirectChain:[],
  normalizedTarget:"docs.example.org:443",statusCode:200,
  contentType:"text/plain",bytesReceived:12,bytesRetained:12,truncated:false,
  tlsState:"https_transport_observed",
  contentSha256:"7509e5bda0c762d2bac7f90d758b5b2263fa01ccbc542ab5e3df163be08e6ca9",
  body:"hello world!",
  startedAt:1795310000000,endedAt:1795310001000,
  credentialReference:null,credentialUsed:false,
  retry:"none",autoRetry:false,policyDecision:"allowed",
  reasonCode:"ok",searchResults:undefined,searchSource:null,
  uncertainty:"http-response-observed-peer-ip-not-attested",
  isolation:"native-web-isolation",dnsEvidence:[],
});
const execute=(name:"tf_http_fetch"|"tf_http_head"|"tf_web_search",input:unknown,
  options:Record<string,unknown>={})=>{
  const tools=buildTfWebTools(context());
  return tools[name].execute!(input as never,{toolCallId:"approved-once",...options} as never);
};

describe("TF3 native web SDK",()=>{
  afterEach(()=>{vi.resetAllMocks();invalidateTfWebSearchProviderStatus();});
  it("requires strictly typed, bounded URL, search ID and search query fields",async()=>{
    expect(Object.keys(TF_WEB_SCHEMAS)).toEqual([
      "tf_http_fetch","tf_http_head","tf_web_search",
    ]);
    for (const [name,input] of [
      ["tf_http_fetch",{url:"https://docs.example.org/topic"}],
      ["tf_http_fetch",{searchResultId:"b".repeat(48),maxBytes:4096}],
      ["tf_http_head",{url:"https://example.com/",timeoutMs:1500}],
      ["tf_http_head",{url:"http://www.example.com/",timeoutMs:1500}],
      ["tf_web_search",{query:"release notes"}],
    ] as const) expect(validateTfWebInput(name,input)).toBe(true);
    for (const [name,input] of [
      ["tf_http_fetch",{url:"http://127.0.0.1"}],
      ["tf_http_fetch",{url:"https://user:pass@example.com"}],
      ["tf_http_fetch",{url:"https://example.com/?api_key=secret"}],
      ["tf_http_fetch",{url:"https://example.com",method:"POST"}],
      ["tf_http_fetch",{url:"https://example.com",headers:{Authorization:"token"}}],
      ["tf_http_fetch",{url:"https://example.com",body:"unsafe"}],
      ["tf_http_fetch",{url:"https://example.com",searchResultId:"id-opaque"}],
      ["tf_http_fetch",{}],
      ["tf_http_fetch",{url:"https://example.com",maxBytes:1000000}],
      ["tf_http_fetch",{searchResultId:"fake-id"}],
      ["tf_http_fetch",{url:"https://example.com",timeoutMs:16_000}],
      ["tf_http_head",{url:"https://example.com",maxBytes:512}],
      ["tf_http_head",{url:"https://example.com",maxRedirects:20}],
      ["tf_web_search",{query:"",provider:"invented"}],
      ["tf_web_search",{query:"docs",credentialReference:"secret"}],
      ["tf_web_search",{query:"x".repeat(257)}],
    ] as const) expect(validateTfWebInput(name,input)).toBe(false);
    expect(await execute("tf_http_fetch",{url:"http://127.0.0.1"}))
      .toMatchObject({ok:false,code:"tf_web_input_invalid",effectState:"NoEffect"});
    expect(call).not.toHaveBeenCalled();
  });
  it("fetches by opaque native search ID, preserving authenticated provenance",async()=>{
    call.mockImplementation(async command=>{
      if(command==="tf_web_prepare")return prepared("http_get") as never;
      if(command==="tf_web_execute")return {
        ...receipt("http_get"),
        searchSource:"brave_web_search_result_id_actor_session_scoped",
      } as never;
      throw Error("Unexpected native command");
    });
    const result=await execute("tf_http_fetch",{
      searchResultId:"b".repeat(48),timeoutMs:4000,maxBytes:8192,
    });
    expect(result).toMatchObject({
      ok:true,sourceKind:"fetched-web-evidence",untrusted:true,
      content:{title:"docs.example.org",excerpt:"hello world!",untrusted:true},
      provenance:{searchResultId:"b".repeat(48),
        finalUrl:"https://docs.example.org/topic",statusCode:200,
        contentSha256:"7509e5bda0c762d2bac7f90d758b5b2263fa01ccbc542ab5e3df163be08e6ca9",
        nativeRequestId:"native-web-request-1",
        actor:"builtin:coder",sessionId:"chat-1"},
      effectReceipt:{toolId:"tf.web_operation.v1",autoRetry:false},
    });
    expect((result as {effectReceipt?:unknown}).effectReceipt).not.toHaveProperty("body");
    expect(call).toHaveBeenCalledWith("tf_web_prepare",{request:{
      operation:"http_get",actor:"builtin:coder",sessionId:"chat-1",
      workspaceRoot:"/workspace",searchResultId:"b".repeat(48),
      timeoutMs:4000,maxBytes:8192,
    }});
    expect(call.mock.calls.map(([command])=>command)).toEqual([
      "tf_web_prepare","tf_web_execute",
    ]);
  });
  it("does native HEAD without a body or extra native OS modal",async()=>{
    call.mockImplementation(async command=>{
      if(command==="tf_web_prepare")return prepared("http_head") as never;
      if(command==="tf_web_execute")return {
        ...receipt("http_head"),body:"",bytesReceived:0,bytesRetained:0,
        contentSha256:"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      } as never;
      throw Error("Unexpected native command");
    });
    expect(await execute("tf_http_head",{url:"https://docs.example.org/topic"}))
      .toMatchObject({ok:true,sourceKind:"http-response-metadata"});
    expect(call.mock.calls.map(([command])=>command)).toEqual([
      "tf_web_prepare","tf_web_execute",
    ]);
  });
  it("extracts safe bounded readable HTML and removes raw markup from the receipt",async()=>{
    const html="<html><head><title>Docs &amp; API</title></head><body>"+
      "<script>alert('unsafe')</script><p>Readable docs</p></body></html>";
    call.mockImplementation(async command=>{
      if(command==="tf_web_prepare")return prepared("http_get") as never;
      if(command==="tf_web_execute")return {
        ...receipt("http_get"),contentType:"text/html",
        body:html,bytesReceived:html.length,bytesRetained:html.length,
        contentSha256:"0a278096649c42d1f81d33dd7411ad56e99be9ac27d3061b7d1f3c66324e1242",
      } as never;
      throw Error("Unexpected command");
    });
    const output=await execute("tf_http_fetch",{url:"https://docs.example.org/topic"});
    expect(output).toMatchObject({ok:true,content:{
      title:"Docs & API",untrusted:true,
      excerptTruncated:false,
    }});
    expect(JSON.stringify(output)).toContain("Readable docs");
    expect((output as {effectReceipt?:unknown}).effectReceipt).not.toHaveProperty("body");
    expect(JSON.stringify(output)).not.toContain("alert(");
  });
  it("uses configured Brave status and native approval before listing results",async()=>{
    call.mockImplementation(async command=>{
      if(command==="tf_web_provider_status")return provider() as never;
      if(command==="tf_web_prepare")return prepared("web_search",true) as never;
      if(command==="tf_web_approve")return true as never;
      if(command==="tf_web_execute")return {
        ...receipt("web_search"),body:null,bytesReceived:1000,bytesRetained:900,
        effectState:"Unknown",retry:"CONDITIONAL_RETRY",
        contentSha256:"a".repeat(64),statusCode:200,searchResults:[searchResult],
        searchSource:"brave_web_api_unverified_metadata",credentialUsed:true,
        credentialReference:"credential:brave-web-search",
      } as never;
      throw Error("Unexpected native command");
    });
    const result=await execute("tf_web_search",{query:"official docs"});
    expect(result).toMatchObject({ok:true,sourceKind:"search-listings",
      provider:{provider:"brave_web",available:true,results:[searchResult]},
      effectReceipt:{effectState:"Unknown",retry:"CONDITIONAL_RETRY",
        autoRetry:false,searchResultCount:1}});
    expect(call.mock.calls.map(([command])=>command)).toEqual([
      "tf_web_provider_status","tf_web_prepare","tf_web_approve","tf_web_execute",
    ]);
  });
  it("reports absent Brave credentials without preparing a fictional search",async()=>{
    call.mockResolvedValueOnce({...provider(),configured:false,
      available:false,
      reasonCode:"credential_not_configured"} as never);
    const result=await execute("tf_web_search",{query:"safe query"});
    expect(result).toMatchObject({ok:false,code:"tf_web_provider_unavailable",
      effectState:"NoEffect",provider:{available:false,results:[],
        reason:"credential_not_configured"}});
    expect(call.mock.calls.map(([command])=>command)).toEqual([
      "tf_web_provider_status",
    ]);
  });
  it("retains native reason for a denied Brave request without inventing results",async()=>{
    call.mockImplementation(async command=>{
      if(command==="tf_web_provider_status")return provider() as never;
      if(command==="tf_web_prepare")return prepared("web_search",true) as never;
      if(command==="tf_web_approve")return true as never;
      if(command==="tf_web_execute")return {
        ...receipt("web_search"),terminal:"denied",effectState:"Unknown",
        body:null,bytesReceived:null,bytesRetained:0,statusCode:429,
        contentSha256:null,searchSource:"brave_web_api_unverified_metadata",
        searchResults:null,reasonCode:"provider-http-status-429",
        policyDecision:"denied",
      } as never;
      throw Error("Unexpected native command");
    });
    expect(await execute("tf_web_search",{query:"rate limited query"}))
      .toMatchObject({ok:false,code:"provider-http-status-429",
        sourceKind:"search-listings",provider:{available:true,results:[]},
        effectReceipt:{effectState:"Unknown",statusCode:429,autoRetry:false}});
  });
  it("caps fetched document excerpts to 12,000 characters without leaking the native body",async()=>{
    const source="x".repeat(15_000);
    const bytes=new TextEncoder().encode(source);
    const hash=Array.from(new Uint8Array(
      await globalThis.crypto.subtle.digest("SHA-256",bytes)),
      byte=>byte.toString(16).padStart(2,"0")).join("");
    call.mockImplementation(async command=>{
      if(command==="tf_web_prepare")return prepared("http_get") as never;
      if(command==="tf_web_execute")return {
        ...receipt("http_get"),body:source,
        bytesReceived:bytes.length,bytesRetained:bytes.length,
        contentSha256:hash,
      } as never;
      throw Error("Unexpected native command");
    });
    const output=await execute("tf_http_fetch",{url:"https://docs.example.org/topic"});
    expect(output).toMatchObject({ok:true,content:{untrusted:true,excerptTruncated:true}});
    const content=(output as {content?:{excerpt:string}}).content;
    expect(content?.excerpt).toHaveLength(12_000);
    expect(JSON.stringify(output)).not.toContain(source);
  });
  it("fails closed on mismatched native actor, receipt hash, isolation and URLs",async()=>{
    const altered=[
      {actor:"other-agent"},
      {requestId:"other-request"},
      {contentSha256:"fake-hash"},
      {contentSha256:"f".repeat(64)},
      {isolation:"wrong-native-isolation"},
      {body:"a".repeat(65_537),bytesRetained:65_536},
      {finalUrl:"",statusCode:200},
    ];
    for (const change of altered) {
      call.mockReset();
      call.mockImplementation(async command=>{
        if(command==="tf_web_prepare")return prepared("http_get") as never;
        if(command==="tf_web_execute")
          return {...receipt("http_get"),...change} as never;
        throw Error("Unexpected command");
      });
      const result=await execute("tf_http_fetch",{url:"https://docs.example.org/topic"});
      expect(result).toMatchObject({ok:false,effectState:"Unknown",autoRetry:false});
      expect(["tf_web_receipt_mismatch","tf_web_body_hash_mismatch"])
        .toContain((result as {code:string}).code);
    }
  });
  it("rejects conflicting native prepared authority before execute",async()=>{
    call.mockImplementation(async command=>{
      if(command==="tf_web_prepare")return {
        ...prepared("http_get"),workspaceRoot:"/another-workspace",
      } as never;
      if(command==="tf_web_cancel")return true as never;
      throw Error("Unexpected command");
    });
    expect(await execute("tf_http_fetch",{url:"https://docs.example.org/topic"}))
      .toMatchObject({ok:false,code:"tf_web_prepare_mismatch"});
    expect(call.mock.calls.map(([command])=>command)).not.toContain("tf_web_execute");
    expect(call.mock.calls.map(([command])=>command)).toContain("tf_web_cancel");
  });
  it("rejects malformed search listings even with an apparently successful native receipt",async()=>{
    call.mockImplementation(async command=>{
      if(command==="tf_web_provider_status")return provider() as never;
      if(command==="tf_web_prepare")return prepared("web_search",true) as never;
      if(command==="tf_web_approve")return true as never;
      if(command==="tf_web_execute")return {
        ...receipt("web_search"),body:null,bytesRetained:900,bytesReceived:1000,
        credentialUsed:true,searchSource:"brave_web_api_unverified_metadata",
        searchResults:[
          {...searchResult,id:"../../injected",url:"http://127.0.0.1"},
        ],
      } as never;
      throw Error("Unexpected command");
    });
    expect(await execute("tf_web_search",{query:"safe search"}))
      .toMatchObject({ok:false,code:"tf_web_search_results_invalid"});
  });
  it("aborts without native prepare, or cancels an in-flight execute without asserting success",async()=>{
    const already=new AbortController();already.abort();
    expect(await execute("tf_http_fetch",{url:"https://docs.example.org/topic"},
      {abortSignal:already.signal})).toMatchObject({
        ok:false,code:"tf_web_cancelled_before_prepare",effectState:"NoEffect",
    });
    expect(call).not.toHaveBeenCalled();
    const controller=new AbortController();
    call.mockImplementation(async command=>{
      if(command==="tf_web_prepare")return prepared("http_get") as never;
      if(command==="tf_web_cancel")return true as never;
      if(command==="tf_web_execute") {
        controller.abort();
        return receipt("http_get") as never;
      }
      throw Error("Unexpected command");
    });
    expect(await execute("tf_http_fetch",{url:"https://docs.example.org/topic"},
      {abortSignal:controller.signal})).toMatchObject({
        ok:false,code:"tf_web_cancelled_during_execute",effectState:"Unknown",
    });
    expect(call.mock.calls.map(([command])=>command)).toContain("tf_web_cancel");
  });
  it("fails closed provider cache on unavailable or unreadable native status",async()=>{
    expect(isTfWebSearchProviderAvailable()).toBe(false);
    call.mockResolvedValueOnce(provider() as never);
    expect((await refreshTfWebSearchProviderStatus()).available).toBe(true);
    expect(isTfWebSearchProviderAvailable()).toBe(true);
    call.mockRejectedValueOnce(new Error("native IPC unavailable"));
    expect((await refreshTfWebSearchProviderStatus()).available).toBe(false);
    expect(isTfWebSearchProviderAvailable()).toBe(false);
  });
});
