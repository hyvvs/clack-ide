import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { ToolContext } from "./context";
import { buildTfOperationTools, TF_OPERATION_SCHEMAS,
  validateTfOperationInput } from "./tfOperations";

vi.mock("@tauri-apps/api/core",()=>({invoke:vi.fn()}));
const call=vi.mocked(invoke);
const context=(cwd="C:/repo/src"):ToolContext=>({
  getCwd:()=>cwd,getWorkspaceRoot:()=>"C:/repo",
  getSessionId:()=>"chat-a",getAgentId:()=>"builtin:coder",
  readCache:new Map(),getTerminalContext:()=>null,
  isActiveTerminalPrivate:()=>false,injectIntoActivePty:()=>false,
  openPreview:()=>false,spawnAgent:()=>null,readAgentOutput:()=>null,
});
const prepared=(operation:string,requiresApproval=false)=>({
  token:"native-ticket",requestId:"native-request",operation,
  requiresApproval,workspaceRoot:"\\\\?\\c:\\REPO",cwd:"\\\\?\\C:\\repo\\src",
  isolation:"native-strict-admission",expiresInSecs:15,
});
const receipt=(operation:string)=>({
  toolId:"tf.operation.v1",requestId:"native-request",actor:"builtin:coder",
  operation,terminal:"completed",effectState:"NoEffect",retry:"safe",
  canonicalPaths:["C:\\repo\\src\\a.ts"],requestedResources:[],
  affectedResources:[],stdout:"",stderr:"",exitCode:0,
});

describe("TF2 native operation SDK bridge",()=>{
  afterEach(()=>vi.resetAllMocks());
  it("accepts only each operation's strict structured model fields",()=>{
    expect(Object.keys(TF_OPERATION_SCHEMAS)).toEqual([
      "tf_fs_read","tf_fs_write","tf_fs_delete","tf_repo_read",
      "tf_repo_write","tf_build_run",
    ]);
    for(const [name,input] of [
      ["tf_fs_read",{operation:"file_read",path:"../README.md",offset:0}],
      ["tf_fs_write",{operation:"file_patch",path:"a.ts",oldText:"a",
        newText:"b",expectedSha256:"a".repeat(64)}],
      ["tf_fs_delete",{operation:"file_delete",path:"a.ts",
        expectedSha256:"a".repeat(64)}],
      ["tf_repo_read",{operation:"repo_log"}],
      ["tf_repo_write",{operation:"repo_stage",paths:["a.ts"]}],
      ["tf_build_run",{operation:"build_typecheck",timeoutMs:1000}],
    ] as const)expect(validateTfOperationInput(name,input)).toBe(true);
    for(const [name,input] of [
      ["tf_fs_read",{operation:"file_read",path:"a",content:"secret"}],
      ["tf_fs_write",{operation:"file_replace",path:"a",content:"b"}],
      ["tf_fs_write",{operation:"file_move",path:"a"}],
      ["tf_fs_write",{operation:"file_move",path:"a",destination:"b"}],
      ["tf_fs_delete",{operation:"file_delete",path:"a"}],
      ["tf_fs_delete",{operation:"file_delete",path:"a",command:"rm"}],
      ["tf_repo_read",{operation:"repo_stage",paths:["a"]}],
      ["tf_repo_read",{operation:"repo_diff"}],
      ["tf_repo_write",{operation:"repo_stage",paths:[]}],
      ["tf_build_run",{operation:"build_frontend",args:["--unsafe"]}],
      ["tf_build_run",{operation:"no_such_build"}],
    ] as const)expect(validateTfOperationInput(name,input)).toBe(false);
  });
  it("sends native-only actor/root/cwd and validates a case/slash-normalized native receipt",async()=>{
    call.mockImplementation(async(command)=>{
      if(command==="tf_operation_prepare")return prepared("file_read") as never;
      if(command==="tf_operation_execute")return receipt("file_read") as never;
      throw Error("unexpected IPC");
    });
    const tools=buildTfOperationTools(context());
    const result=await tools.tf_fs_read.execute!({operation:"file_read",
      path:"../README.md"},{toolCallId:"call-1"} as never);
    expect(result).toMatchObject({ok:true,effectReceipt:{
      toolId:"tf.operation.v1",autoRetry:false,effectState:"NoEffect"}});
    expect(call).toHaveBeenCalledWith("tf_operation_prepare",{request:{
      operation:"file_read",path:"C:/repo/README.md",actor:"builtin:coder",
      workspaceRoot:"C:/repo",cwd:"C:/repo/src",
    }});
    expect(call.mock.calls.map(([name])=>name)).toEqual([
      "tf_operation_prepare","tf_operation_execute",
    ]);
  });
  it("effectful writes invoke native OS approval before execute, never from model input",async()=>{
    call.mockImplementation(async(command)=>{
      if(command==="tf_operation_prepare")return prepared("file_create",true) as never;
      if(command==="tf_operation_approve")return true as never;
      if(command==="tf_operation_execute")return {
        ...receipt("file_create"),effectState:"Observed",
      } as never;
      throw Error("unexpected");
    });
    const result=await buildTfOperationTools(context()).tf_fs_write.execute!({
      operation:"file_create",path:"new.ts",content:"secret body",
    },{toolCallId:"allow-once"} as never);
    expect(result).toMatchObject({ok:true,effectReceipt:{effectState:"Observed"}});
    expect(call.mock.calls.map(([name])=>name)).toEqual([
      "tf_operation_prepare","tf_operation_approve","tf_operation_execute",
    ]);
  });
  it("reports a passed build process separately from UNKNOWN observed side effects, never auto-retrying",async()=>{
    call.mockImplementation(async(command)=>{
      if(command==="tf_operation_prepare")return {
        ...prepared("build_typecheck",true),
        cwd:"\\\\?\\C:\\repo",
      } as never;
      if(command==="tf_operation_approve")return true as never;
      if(command==="tf_operation_execute")return {
        ...receipt("build_typecheck"),effectState:"Unknown",
        retry:"no_auto_retry",exitCode:0,
      } as never;
      throw Error("unexpected");
    });
    const result=await buildTfOperationTools(context()).tf_build_run.execute!({
      operation:"build_typecheck",timeoutMs:60_000,
    },{toolCallId:"build-approved"} as never);
    expect(result).toMatchObject({ok:true,commandStatus:"pass",
      effectReceipt:{effectState:"Unknown",autoRetry:false,
        retry:"no_auto_retry"}});
  });
  it("repo reads pin native cwd to the repository root even when the terminal is nested",async()=>{
    call.mockImplementation(async(command)=>{
      if(command==="tf_operation_prepare")return {
        ...prepared("repo_diff"),cwd:"\\\\?\\C:\\REPO",
      } as never;
      if(command==="tf_operation_execute")return {
        ...receipt("repo_diff"),canonicalPaths:["C:\\repo\\src\\a.ts"],
      } as never;
      throw Error("unexpected IPC");
    });
    const result=await buildTfOperationTools(context()).tf_repo_read.execute!({
      operation:"repo_diff",paths:["src/a.ts"],
    },{toolCallId:"repo-read"} as never);
    expect(result).toMatchObject({ok:true});
    expect(call).toHaveBeenCalledWith("tf_operation_prepare",{request:{
      operation:"repo_diff",paths:["C:/repo/src/a.ts"],
      actor:"builtin:coder",workspaceRoot:"C:/repo",cwd:"C:/repo",
    }});
  });
  it("rejects UNC or a different verbatim drive root instead of treating them as selected workspace",async()=>{
    call.mockImplementation(async(command)=>{
      if(command==="tf_operation_prepare")return {
        ...prepared("file_stat"),workspaceRoot:"\\\\?\\UNC\\server\\share",
      } as never;
      return true as never;
    });
    const result=await buildTfOperationTools(context()).tf_fs_read.execute!({
      operation:"file_stat",path:"a.ts",
    },{toolCallId:"unc-rejected"} as never);
    expect(result).toMatchObject({ok:false,
      code:"tf_operation_prepare_mismatch",effectState:"Unknown"});
    expect(call.mock.calls.map(([name])=>name)).not.toContain("tf_operation_execute");
  });
  it("fails closed on native operation/workspace mismatch or uncertain execute",async()=>{
    call.mockImplementation(async(command)=>{
      if(command==="tf_operation_prepare")return {
        ...prepared("file_read"),workspaceRoot:"C:/elsewhere",
      } as never;
      return true as never;
    });
    const tool=buildTfOperationTools(context()).tf_fs_read;
    const result=await tool.execute!({operation:"file_read",path:"a"},
      {toolCallId:"call-a"} as never);
    expect(result).toMatchObject({ok:false,effectState:"Unknown",
      retry:"no_auto_retry"});
    expect(call.mock.calls.some(([name])=>name==="tf_operation_execute")).toBe(false);
    call.mockReset();
    call.mockImplementation(async(command)=>{
      if(command==="tf_operation_prepare")return prepared("file_read") as never;
      throw Error("IPC disconnect");
    });
    expect(await tool.execute!({operation:"file_read",path:"a"},
      {toolCallId:"call-b"} as never)).toMatchObject({ok:false,
        effectState:"Unknown",retry:"no_auto_retry"});
    expect(call.mock.calls.some(([name])=>name==="tf_operation_cancel")).toBe(true);
  });
  it("aborted-before-prepare cannot invoke native IPC",async()=>{
    const signal=new AbortController();signal.abort();
    expect(await buildTfOperationTools(context()).tf_fs_read.execute!({
      operation:"file_stat",path:"a"},{toolCallId:"aborted",
      abortSignal:signal.signal} as never)).toMatchObject({
        code:"tf_operation_cancelled_before_prepare",effectState:"NoEffect"});
    expect(call).not.toHaveBeenCalled();
  });
});
