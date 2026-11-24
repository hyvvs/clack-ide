import { beforeEach, describe, expect, it, vi } from "vitest";

const {invoke}=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({invoke}));

import { invalidateTfBrowserRuntimeStatus,
  isTfBrowserRuntimeAvailable, refreshTfBrowserRuntimeStatus } from
  "./browserRuntimeStatus";

const owner=["builtin:coder","chat-a","/work/a"] as const;
beforeEach(()=>{invoke.mockReset();invalidateTfBrowserRuntimeStatus();});

describe("TF4 native browser capability status and actor isolation",()=>{
  it("fails closed when the native command is missing or actor scope absent",async()=>{
    expect(await refreshTfBrowserRuntimeStatus(null,"chat-a","/work/a"))
      .toMatchObject({available:false,reason:"no-actor-scope"});
    expect(invoke).not.toHaveBeenCalled();
    invoke.mockRejectedValueOnce(new Error("native command unavailable"));
    const result=await refreshTfBrowserRuntimeStatus(...owner);
    expect(result).toMatchObject({available:false,reason:"native-unavailable",sessions:[]});
    expect(isTfBrowserRuntimeAvailable(...owner)).toBe(false);
  });
  it("retains only bounded, structurally verified, exact-owner native session metadata",async()=>{
    invoke.mockResolvedValueOnce({available:true,engine:"inert_native_text",
      isolation:"native-pinned",sessions:[
        {browserSessionId:"a".repeat(48),currentUrl:"https://example.org/",
          snapshotId:"b".repeat(48),historyLength:1,expiresInSecs:600,
          engine:"inert_native_text",isolation:"native-pinned"},
        {browserSessionId:"oops",currentUrl:"https://private.example.org/",
          snapshotId:"s",historyLength:-1,expiresInSecs:2,
          engine:"remote_webview",isolation:"unbounded"},
      ]});
    const result=await refreshTfBrowserRuntimeStatus(...owner);
    expect(result).toMatchObject({available:true,engine:"inert_native_text",
      reason:"native-checked"});
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].browserSessionId).toBe("a".repeat(48));
    expect(invoke).toHaveBeenCalledWith("tf_browser_status",{
      actor:"builtin:coder",sessionId:"chat-a",workspaceRoot:"/work/a",
      browserSessionId:null,
    });
    expect(isTfBrowserRuntimeAvailable(...owner)).toBe(true);
    expect(isTfBrowserRuntimeAvailable("other","chat-a","/work/a")).toBe(false);
    expect(isTfBrowserRuntimeAvailable("builtin:coder","another-chat","/work/a"))
      .toBe(false);
  });
  it("does not trust arbitrary renderer-advertised browser engines",async()=>{
    invoke.mockResolvedValueOnce({available:true,engine:"unrestricted_webview",
      isolation:"none",sessions:[]});
    expect(await refreshTfBrowserRuntimeStatus(...owner)).toMatchObject({
      available:false,reason:"native-unavailable"});
  });
  it("shows only exact confined native sessions with withheld URL and snapshot; rejects fake engines",async()=>{
    invoke.mockResolvedValueOnce({available:true,engine:"inert_native_text",
      isolation:"native-pinned",sessions:[
        {browserSessionId:"c".repeat(48),currentUrl:"",snapshotId:"",
          historyLength:0,expiresInSecs:500,
          engine:"confined_webview2_read_only_unaccepted",isolation:"owned-job"},
        {browserSessionId:"d".repeat(48),currentUrl:"",snapshotId:"",
          historyLength:0,expiresInSecs:500,
          engine:"inert_native_text",isolation:"not-native"},
        {browserSessionId:"e".repeat(48),currentUrl:"https://secret.example/path",
          snapshotId:"",historyLength:0,expiresInSecs:500,
          engine:"unrestricted_webview",isolation:"none"},
      ]});
    const state=await refreshTfBrowserRuntimeStatus(...owner);
    expect(state.sessions).toEqual([{
      browserSessionId:"c".repeat(48),currentUrl:null,snapshotId:null,
      historyLength:0,expiresInSecs:500,
      engine:"confined_webview2_read_only_unaccepted",isolation:"owned-job",
    }]);
    expect(JSON.stringify(state)).not.toContain("secret.example");
  });
});
