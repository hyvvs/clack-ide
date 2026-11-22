import {beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("@tauri-apps/api/core",()=>({invoke:vi.fn()}));
import {invoke} from "@tauri-apps/api/core";
import {buildBoundedCommandTools,type BoundedCommandInput} from "./boundedCommand";
import type {ToolContext} from "./context";

const git="C:/Program Files/Git/cmd/git.exe";
const read:BoundedCommandInput={action:"read_status",executable:git,
  args:["status","--short","--untracked-files=no"],cwd:"C:/work/demo"};
const write:BoundedCommandInput={action:"write_marker",executable:git,
  args:["config","--local","tf.command.marker","approved"],cwd:"C:/work/demo"};
const context:ToolContext={
  getSessionId:()=>"chat-a",getAgentId:()=>"builtin:coder",
  getWorkspaceRoot:()=>"C:/work/demo",getCwd:()=>"C:/work/demo",
  getTerminalContext:()=>null,isActiveTerminalPrivate:()=>false,
  injectIntoActivePty:()=>false,openPreview:()=>false,spawnAgent:()=>null,
  readAgentOutput:()=>null,readCache:new Map(),
};
const prepared={token:"opaque-once",requestId:"req-1",action:"read_status",
  cwd:read.cwd,workspaceRoot:read.cwd,requiresApproval:false,expiresInSecs:60,
  isolation:"unsupported_filesystem_network_isolation"};
const receipt={requestId:"req-1",toolId:"tf.bounded_command.v1",actor:"builtin:coder",
  policyDecision:"native_allowlisted",approvalId:null,sandbox:"unsupported",
  requestedResources:[read.cwd],affectedResources:[],executable:git,args:read.args,
  startedAt:1790000000000,endedAt:1790000000100,retry:"no_auto_retry",
  action:"read_status",terminal:"completed",sideEffect:"read_only",
  uncertainty:"none",autoRetry:false,pid:8024,exitCode:0,stdout:"",stderr:"",
  stdoutSha256:"a".repeat(64),stderrSha256:"b".repeat(64),
  stdoutTruncated:false,stderrTruncated:false,
  isolation:"unsupported_filesystem_network_isolation"};

const options={toolCallId:"call-a",messages:[]};
function fixture(ctx:ToolContext=context){
  const declaration=buildBoundedCommandTools(ctx).bounded_command;
  const execute=declaration.execute as unknown as (
    input:BoundedCommandInput,opts:typeof options & {abortSignal?:AbortSignal},
  )=>Promise<Record<string,unknown>>;
  return {declaration,execute};
}
beforeEach(()=>{vi.mocked(invoke).mockReset();});

describe("TF secure bounded native command tool SDK bridge",()=>{
  it("registers structured argv and one-time write approval, never a shell string",async()=>{
    const {declaration}=fixture();
    const needs=declaration.needsApproval as (input:BoundedCommandInput)=>boolean;
    expect(needs(read)).toBe(false);
    expect(needs(write)).toBe(true);
    expect(declaration.description).toContain("filesystem and network OS isolation are UNSUPPORTED");
  });
  it("read-only native command passes exact actor/root/argv and retains real outcome",async()=>{
    vi.mocked(invoke).mockImplementation(async (command)=>{
      if(command==="tf_command_prepare")return prepared;
      if(command==="tf_command_execute")return receipt;
      throw Error(`unexpected native command ${command}`);
    });
    const result=await fixture().execute(read,options);
    expect(result).toMatchObject({ok:true,effectReceipt:{pid:8024,
      terminal:"completed",sideEffect:"read_only",sandbox:"unsupported",
      retry:"no_auto_retry",autoRetry:false}});
    expect(invoke).toHaveBeenNthCalledWith(1,"tf_command_prepare",{request:{
      ...read,actor:"builtin:coder",workspaceRoot:"C:/work/demo"}});
    expect(invoke).toHaveBeenNthCalledWith(2,"tf_command_execute",{token:"opaque-once"});
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it("does not execute a denied admission or invent an effect state",async()=>{
    vi.mocked(invoke).mockRejectedValue(new Error("secret:never-log"));
    const result=await fixture().execute(read,options);
    expect(result).toMatchObject({ok:false,code:"tf_native_admission_failed",
      effectState:"Unknown",retry:"no_auto_retry"});
    expect(JSON.stringify(result)).not.toContain("never-log");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("write route claims approval only at SDK-approved execution stage and preserves uncertainty",async()=>{
    vi.mocked(invoke).mockImplementation(async(command)=>{
      if(command==="tf_command_prepare")return {...prepared,action:"write_marker",
        requiresApproval:true};
      if(command==="tf_command_approve")return undefined;
      if(command==="tf_command_execute")return {...receipt,action:"write_marker",
        terminal:"completed",sideEffect:"write_reported_success",
        uncertainty:"not_independently_verified",approvalId:"approval:req-1"};
      throw Error(`unexpected ${command}`);
    });
    const result=await fixture().execute(write,options);
    expect(result).toMatchObject({ok:true,effectReceipt:{
      uncertainty:"not_independently_verified",autoRetry:false,
      approvalId:"approval:req-1"}});
    expect(vi.mocked(invoke).mock.calls.map(([command])=>command)).toEqual([
      "tf_command_prepare","tf_command_approve","tf_command_execute"]);
  });
  it("refuses mismatched native receipts and never claims success",async()=>{
    vi.mocked(invoke).mockImplementation(async(command)=>command==="tf_command_prepare"
      ? prepared : {...receipt,requestId:"different-native-owner"});
    expect(await fixture().execute(read,options)).toMatchObject({
      ok:false,code:"tf_native_receipt_mismatch",effectState:"Unknown",
      retry:"no_auto_retry"});
  });
  it("retains truthful nonzero native exit rather than treating process start as success",async()=>{
    vi.mocked(invoke).mockImplementation(async(command)=>command==="tf_command_prepare"
      ? prepared : {...receipt,exitCode:42,sideEffect:"unknown",
        uncertainty:"effect_unverified"});
    expect(await fixture().execute(read,options)).toMatchObject({ok:false,
      effectReceipt:{pid:8024,exitCode:42,sideEffect:"unknown",autoRetry:false}});
  });
  it("cancellation never triggers automatic replay or another command invocation",async()=>{
    const abort=new AbortController();
    abort.abort();
    expect(await fixture().execute(read,{...options,abortSignal:abort.signal}))
      .toMatchObject({ok:false,code:"tf_cancelled_before_prepare",retry:"no_auto_retry"});
    expect(invoke).not.toHaveBeenCalled();
  });
  it("cancel during bounded native execution signals token, preserves unknown terminal",async()=>{
    const abort=new AbortController();
    vi.mocked(invoke).mockImplementation(async(command)=>{
      if(command==="tf_command_prepare")return prepared;
      if(command==="tf_command_execute"){
        abort.abort();
        throw Error("lost-connection-after-spawn");
      }
      if(command==="tf_command_cancel")return true;
      throw Error("unexpected");
    });
    const result=await fixture().execute(read,{...options,abortSignal:abort.signal});
    expect(result).toMatchObject({ok:false,code:"tf_native_terminal_unknown",
      effectState:"Unknown",retry:"no_auto_retry"});
    expect(vi.mocked(invoke).mock.calls.some(([c])=>c==="tf_command_cancel")).toBe(true);
    expect(vi.mocked(invoke).mock.calls.filter(([c])=>c==="tf_command_execute"))
      .toHaveLength(1);
  });
});
