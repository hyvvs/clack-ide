import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import type { BrowserRuntimeStatus } from "../lib/browserRuntimeStatus";
import {
  browserActionStatus, browserEngineStatus, projectBrowserActionHistory,
} from "./ChatToolsControl";

function message(id:string,parts:unknown[]):UIMessage {
  return {id,role:"assistant",parts} as UIMessage;
}
function tool(id:string,name:string,state:string,output?:unknown) {
  return {type:`tool-${name}`,toolCallId:id,state,...(output?{output}:{})};
}
const receipt=(sessionId:string,operation:string,extra:Record<string,unknown>={})=>({
  toolId:"tf.browser_operation.v1",sessionId,operation,engine:"inert_native_text",
  terminal:"completed",effectState:"Observed",reasonCode:"inert-snapshot-observed",
  finalUrl:"https://example.org/page?private=withheld",...extra,
});

describe("Browser status panel action projection",()=>{
  it("uses actual native terminal/effect evidence, hides URL queries and orders recent tool calls",()=>{
    const history=projectBrowserActionHistory([
      message("a",[tool("open-1","tf_browser_open","output-available",{
        effectReceipt:receipt("chat-a","open"),
      })]),
      message("b",[tool("inspect-1","tf_browser_inspect","output-available",{
        effectReceipt:receipt("chat-a","snapshot",{
          terminal:"failed",effectState:"Unknown",reasonCode:"source-fetch-failed",
          finalUrl:null,
        }),
      })]),
    ],"chat-a");
    expect(history.map(action=>action.operation)).toEqual(["snapshot","open"]);
    expect(history[0]).toMatchObject({terminal:"failed",effectState:"Unknown",reason:"source-fetch-failed"});
    expect(history[1]).toMatchObject({terminal:"completed",effectState:"Observed",
      page:"https://example.org/…?…"});
    expect(JSON.stringify(history)).not.toContain("private=withheld");
    expect(JSON.stringify(history)).not.toContain("/page");
  });

  it("does not claim native completion for another chat, missing receipts or unsupported tools",()=>{
    const history=projectBrowserActionHistory([
      message("a",[
        tool("wrong","tf_browser_navigate","output-available",{
          effectReceipt:receipt("other-chat","navigate"),
        }),
        tool("missing","tf_browser_back","output-error",{
          error:"private diagnostics",ok:false,code:"tf_browser_terminal_unknown",
        }),
        tool("unsupported","tf_browser_upload","output-available",{
          effectReceipt:receipt("chat-a","upload"),
        }),
      ]),
    ],"chat-a");
    expect(history.map(action=>action.id)).toEqual(["missing","wrong"]);
    expect(history.every(action=>action.terminal===null && action.effectState===null)).toBe(true);
    expect(history[0].reason).toBe("tf_browser_terminal_unknown");
    expect(JSON.stringify(history)).not.toContain("private diagnostics");
  });

  it("bounds history to six owning-chat actions and retains real pending action state",()=>{
    const history=projectBrowserActionHistory([
      message("a",Array.from({length:9},(_,index)=>
        tool(`call-${index}`,"tf_browser_click","approval-requested"))),
    ],"chat-a");
    expect(history).toHaveLength(6);
    expect(history[0]).toMatchObject({id:"call-8",operation:"click_link",pending:true,
      terminal:null});
    expect(history[5].id).toBe("call-3");
  });

  it("shows loading, ready and native errors without claiming an interactive browser",()=>{
    const ready:BrowserRuntimeStatus={
      available:true,engine:"inert_native_text",reason:"native-checked",sessions:[],
    };
    expect(browserEngineStatus(null)).toContain("Loading");
    expect(browserEngineStatus(ready)).toContain("Ready · inert native text");
    expect(browserEngineStatus(ready)).toContain("approval still required");
    expect(browserEngineStatus({...ready,available:false,engine:"unavailable",
      reason:"native-unavailable"})).toContain("Error · native browser status unavailable");
    expect(browserEngineStatus({...ready,available:false,engine:"unavailable",
      reason:"no-actor-scope"})).toContain("scope missing");
  });

  it("distinguishes an SDK denial, a denied chat approval and unknown native completion",()=>{
    const history=projectBrowserActionHistory([message("a",[
      tool("deny","tf_browser_open","output-available",{
        ok:false,code:"tf_browser_actor_or_workspace_missing",
        terminal:"denied",effectState:"NoEffect",
      }),
      {type:"tool-tf_browser_click",toolCallId:"approval-deny",
        state:"approval-responded",approval:{approved:false}},
      tool("unknown","tf_browser_back","output-available",{
        ok:false,code:"tf_browser_terminal_unknown",terminal:"unknown",effectState:"Unknown",
      }),
    ])],"chat-a");
    expect(browserActionStatus(history[0])).toBe("Tool result unknown · native completion unverified");
    expect(history[0].reason).toBe("tf_browser_terminal_unknown");
    expect(browserActionStatus(history[1])).toBe("Chat approval denied · no native receipt");
    expect(history[1].pending).toBe(false);
    expect(browserActionStatus(history[2])).toBe("Tool request denied · NoEffect (no native receipt)");
    expect(history[2].reason).toBe("tf_browser_actor_or_workspace_missing");
  });

  it("does not treat old unfinished tool states as verified native activity",()=>{
    const history=projectBrowserActionHistory([message("a",[
      tool("old","tf_browser_navigate","approval-requested",{
        effectReceipt:receipt("chat-a","navigate"),
      }),
    ])],"chat-a");
    expect(browserActionStatus(history[0])).toContain("current approval unverified");
    expect(history[0]).toMatchObject({pending:true,terminal:null,toolResult:null});
  });
});
