import { describe,expect,it } from "vitest";
import {
  builtinToolSecurity, evaluateToolFabricPolicy, toolRetryDecision,
  unknownToolSecurity, type ToolActor, type ToolApprovalGrant,
  type ToolRegistrySecurity, type ToolScope, type ToolSecurityRequest,
} from "./toolFabricPolicy";

const NOW=1800000000000;
const actor:ToolActor={agentId:"builtin:coder",sessionId:"session-a",
  workspaceId:"local:C:/work/a",workspaceRoot:"C:/work/a"};
const sandbox={identity:"windows-native-1",required:[] as const,
  enforced:["process-tree","timeout","environment-filter"] as const,
  unsupported:["filesystem-isolation","network-isolation",
    "readonly-mounts","resource-limits"] as const,
  status:"partially-enforced" as const};
const file:ToolScope={kind:"filesystem",workspaceRoot:"C:/work/a",
  path:"C:/work/a/src/hello.ts",operations:["write"]};
const read:ToolScope={...file,kind:"filesystem",operations:["read"]};
const command:ToolScope={kind:"command",executable:"C:/Program Files/Git/cmd/git.exe",
  args:["status","--short","--untracked-files=no"],cwd:"C:/work/a",
  envNames:[],timeoutMs:5_000};
function request(name:string, changes:Partial<ToolSecurityRequest>={}):ToolSecurityRequest{
  const tool=builtinToolSecurity(name);
  if(!tool)throw Error(`Missing builtin ${name}`);
  return {phase:"execution",requestId:"req-a",actor,tool,operation:name,
    requestedEffects:tool.effects,resourceIdentity:"exact-target-a",scopes:[],
    sandbox,permissionMode:"ask",now:NOW,...changes};
}
function grant(tool:ToolRegistrySecurity,changes:Partial<ToolApprovalGrant>={}):ToolApprovalGrant {
  return {id:"approval-a",scope:"once",actorId:actor.agentId,
    toolId:tool.id,revision:tool.revision,effect:tool.effects[0],
    resourceIdentity:"exact-target-a",requestId:"req-a",approvedAt:NOW-100,
    expiresAt:NOW+60_000,...changes};
}

describe("TF1 security policy: registry, scopes, approval and no inferred trust",()=>{
  it("assigns stable reviewed identities and fail-closed unregistered effects",()=>{
    const a=builtinToolSecurity("read_file"),b=builtinToolSecurity("read_file");
    expect(a).toEqual(b);
    expect(a?.effects).toEqual(["read-only"]);
    expect(builtinToolSecurity("not_registered_here")).toBeNull();
    expect(evaluateToolFabricPolicy(request("read_file",{
      tool:unknownToolSecurity("remote","untrusted","v1"),
    })).decision).toBe("UNKNOWN");
    expect(evaluateToolFabricPolicy(request("read_file",{
      requestedEffects:["unknown"],scopes:[read],
    }))).toMatchObject({decision:"UNKNOWN",reasonCode:"effect-unclassified"});
  });
  it("registers six stable native-operation tool identities with truthful static effect ceilings",()=>{
    const names=["tf_fs_read","tf_fs_write","tf_fs_delete","tf_repo_read",
      "tf_repo_write","tf_build_run"];
    for(const name of names){
      const tool=builtinToolSecurity(name);
      expect(tool).toMatchObject({name,provenance:"clack-builtin",
        available:true,revision:"builtin"});
      expect(builtinToolSecurity(name)).toEqual(tool);
    }
    expect(builtinToolSecurity("tf_fs_read")?.effects).toEqual(["read-only"]);
    expect(builtinToolSecurity("tf_repo_read")?.effects).toEqual(["read-only"]);
    expect(builtinToolSecurity("tf_fs_write")?.requiresApproval).toBe(true);
    expect(builtinToolSecurity("tf_fs_delete")?.requiresApproval).toBe(true);
    expect(builtinToolSecurity("tf_repo_write")?.requiresApproval).toBe(true);
    expect(builtinToolSecurity("tf_build_run")?.requiresApproval).toBe(true);
    expect(evaluateToolFabricPolicy(request("tf_fs_read",{scopes:[read]}))
      .decision).toBe("ALLOW");
    expect(evaluateToolFabricPolicy(request("tf_repo_read",{
      scopes:[command]})).decision).toBe("ALLOW");
    expect(evaluateToolFabricPolicy(request("tf_fs_write",{
      requestedEffects:["local-destructive-write"],scopes:[file],
      permissionMode:"full-access"})).decision).toBe("REQUIRE_APPROVAL");
    expect(evaluateToolFabricPolicy(request("tf_fs_delete",{
      scopes:[{...file,operations:["delete"]}],
      permissionMode:"full-access"})).decision).toBe("REQUIRE_APPROVAL");
    expect(evaluateToolFabricPolicy(request("tf_repo_write",{
      requestedEffects:["local-reversible-write"],scopes:[command,file],
      permissionMode:"full-access"})).decision).toBe("REQUIRE_APPROVAL");
    expect(evaluateToolFabricPolicy(request("tf_build_run",{
      scopes:[command,file],permissionMode:"full-access"}))
      .decision).toBe("REQUIRE_APPROVAL");
  });

  it("allows scoped workspace read, not an escaping or missing read target",()=>{
    expect(evaluateToolFabricPolicy(request("read_file",{scopes:[read]})))
      .toMatchObject({decision:"ALLOW",reasonCode:"within-scoped-policy"});
    expect(evaluateToolFabricPolicy(request("read_file",{scopes:[]})))
      .toMatchObject({decision:"DENY",reasonCode:"resource-scope-missing"});
    for(const path of ["C:/work/a2/secret","C:/work/a/../outside",
        "D:/work/a/hello","C:/work/a/../a/hello"])
      expect(evaluateToolFabricPolicy(request("read_file",{scopes:[{...read,path}]}))
        .reasonCode).toBe("filesystem-outside-workspace");
  });
  it("accepts parent-relative paths only while every step stays inside the initial root",()=>{
    for(const path of ["C:/work/a/src/../hello.ts",
      "C:\\work\\a\\src\\..\\hello.ts",
      "C:/work/a/src/deep/../../hello.ts",
      "C:/work/a/src/./../hello.ts"])
      expect(evaluateToolFabricPolicy(request("read_file",{scopes:[{...read,path}]}))
        .decision).toBe("ALLOW");
    for(const path of ["C:/work/a/../secret", "C:/work/a/../a/hello.ts",
      "C:/work/a/src/../../a/hello.ts", "C:/work/a2/../a/hello.ts",
      "D:/work/a/src/../hello.ts", "//server/share/work/a/hello.ts"])
      expect(evaluateToolFabricPolicy(request("read_file",{scopes:[{...read,path}]}))
        .reasonCode).toBe("filesystem-outside-workspace");
    for(const workspaceRoot of ["C:/work/a/../a", "C:work/a",
      "//server/share/work/a"])
      expect(evaluateToolFabricPolicy(request("read_file",{scopes:[{
        ...read,workspaceRoot}]})).reasonCode).toBe("filesystem-outside-workspace");
    expect(evaluateToolFabricPolicy(request("read_file",{
      allowedWorkspaceRoot:"C:/work/../work/a",scopes:[read],
    })).reasonCode).toBe("filesystem-outside-workspace");
  });
  it("applies the same within-root parent-step boundary to command working directories",()=>{
    const tool={...builtinToolSecurity("bounded_command")!,requiresApproval:false};
    const scoped=(cwd:string)=>evaluateToolFabricPolicy(request("bounded_command",{
      tool,requestedEffects:["read-only"],scopes:[{...command,cwd}],
    }));
    expect(scoped("C:/work/a/src/../src").decision).toBe("ALLOW");
    expect(scoped("C:/work/a/../a").reasonCode).toBe("command-scope-invalid");
    expect(scoped("C:/work/a/src/../../a").reasonCode).toBe("command-scope-invalid");
  });

  it("requires approval for writes and respects once/request/agent/revision/target/expiry",()=>{
    const input=request("write_file",{scopes:[file]});
    expect(evaluateToolFabricPolicy(input)).toMatchObject({
      decision:"REQUIRE_APPROVAL",reasonCode:"explicit-approval-required",
      approval:{requestId:"req-a",actorId:actor.agentId,
        requestedScope:"once",reversible:false,credentialReferences:[]},
    });
    const exact=grant(input.tool!);
    expect(evaluateToolFabricPolicy({...input,grants:[exact]}).decision).toBe("ALLOW");
    for(const changed of [
      {requestId:"another"},{actorId:"builtin:reviewer"},{revision:"v2"},
      {resourceIdentity:"other-path"},{expiresAt:NOW},{revoked:true},
      {denied:true},
    ])expect(evaluateToolFabricPolicy({...input,grants:[{...exact,...changed}]}).decision)
      .toBe("REQUIRE_APPROVAL");
    expect(evaluateToolFabricPolicy({...input,denials:[{...exact,denied:true}]}))
      .toMatchObject({decision:"DENY",reasonCode:"explicit-grant-denial"});
  });

  it("does not let Chat Only execute even a reviewed read; Full Access still needs write approval",()=>{
    expect(evaluateToolFabricPolicy(request("read_file",{permissionMode:"chat-only",
      scopes:[read]})).decision).toBe("DENY");
    expect(evaluateToolFabricPolicy(request("write_file",{permissionMode:"full-access",
      scopes:[file]})).decision).toBe("REQUIRE_APPROVAL");
    expect(evaluateToolFabricPolicy(request("read_file",{permissionMode:"full-access",
      scopes:[read]})).decision).toBe("ALLOW");
  });

  it("preserves chat/workspace grants only for their exact agent and resource",()=>{
    const input=request("write_file",{scopes:[file]});
    const chat=grant(input.tool!,{scope:"chat",requestId:undefined,
      sessionId:"session-a"});
    expect(evaluateToolFabricPolicy({...input,grants:[chat]}).decision).toBe("ALLOW");
    expect(evaluateToolFabricPolicy({...input,grants:[chat],actor:{...actor,
      sessionId:"session-b"}}).decision).toBe("REQUIRE_APPROVAL");
    const workspace=grant(input.tool!,{scope:"workspace",requestId:undefined,
      workspaceId:actor.workspaceId!});
    expect(evaluateToolFabricPolicy({...input,grants:[workspace],actor:{...actor,
      sessionId:"session-b"}}).decision).toBe("ALLOW");
    expect(evaluateToolFabricPolicy({...input,grants:[workspace],actor:{...actor,
      workspaceId:"local:C:/other"}}).decision).toBe("REQUIRE_APPROVAL");
  });

  it("admits command scope only with exact executable, cwd, argv and budget",()=>{
    const tool=builtinToolSecurity("bounded_command")!;
    const input=request("bounded_command",{tool:{...tool,requiresApproval:false},
      requestedEffects:["read-only"],scopes:[command]});
    expect(evaluateToolFabricPolicy(input).decision).toBe("ALLOW");
    expect(evaluateToolFabricPolicy({...input,scopes:[{...command,
      cwd:"C:/outside"}]}).reasonCode).toBe("command-scope-invalid");
    expect(evaluateToolFabricPolicy({...input,scopes:[{...command,
      timeoutMs:300_001}]}).reasonCode).toBe("command-scope-invalid");
    expect(evaluateToolFabricPolicy({...input,maxDurationMs:300_001}).reasonCode)
      .toBe("execution-budget-out-of-range");
  });

  it("rejects unavailable sandbox controls, and never calls a Job Object a network sandbox",()=>{
    const input=request("bounded_command",{scopes:[command]});
    expect(evaluateToolFabricPolicy({...input,sandbox:{...sandbox,
      required:["network-isolation"]}})).toMatchObject({
        decision:"UNSUPPORTED",reasonCode:"sandbox-control-unsupported"});
    expect(evaluateToolFabricPolicy({...input,sandbox:{...sandbox,status:"unknown"}})
      .decision).toBe("UNKNOWN");
    const configuration={workspaceRoot:"C:/work/a",mounts:[],tempDirectory:null,
      environment:{forwardedNames:[],inheritParent:false as const},
      network:{mode:"unsupported" as const,destinations:[]},
      credentials:{mode:"none" as const,references:[]},
      process:{maxChildren:null,killTreeOnCancel:true,maxRuntimeMs:5000,
        maxMemoryBytes:null,maxCpuMs:null}};
    expect(evaluateToolFabricPolicy({...input,sandbox:{...sandbox,
      configuration:{...configuration,network:{mode:"disabled",destinations:[]}}}}))
      .toMatchObject({decision:"UNSUPPORTED",reasonCode:"network-isolation-unavailable"});
    expect(evaluateToolFabricPolicy({...input,sandbox:{...sandbox,
      configuration:{...configuration,mounts:[{path:"C:/work/a",mode:"read-only"}]}}}))
      .toMatchObject({decision:"UNSUPPORTED",reasonCode:"mount-isolation-unavailable"});
    expect(evaluateToolFabricPolicy({...input,sandbox:{...sandbox,
      configuration:{...configuration,process:{...configuration.process,
        maxChildren:2}}}}))
      .toMatchObject({decision:"UNSUPPORTED",reasonCode:"sandbox-resource-limit-unavailable"});
  });

  it("restricts network destination syntax and matching operation",()=>{
    const net:ToolScope={kind:"network",protocol:"https",host:"example.org",port:443,
      operation:"read"};
    const input=request("fetch_web_page",{scopes:[net]});
    expect(evaluateToolFabricPolicy(input).decision).toBe("REQUIRE_APPROVAL");
    expect(evaluateToolFabricPolicy({...input,scopes:[{...net,host:"user:pass@example.org"}]})
      .decision).toBe("DENY");
    expect(evaluateToolFabricPolicy({...input,scopes:[{...net,operation:"write"}]})
      .reasonCode).toBe("network-destination-not-scoped");
  });

  it("uses references only; no expired, revoked, cross-tool or unobserved credential grant",()=>{
    const cred:ToolScope={kind:"credential",reference:"credential:repo-token",
      provider:"host",toolId:"registered.native",destination:"https://example.org",
      operation:"write",state:"valid"};
    const tool={...builtinToolSecurity("propose_custom_tool")!,id:"registered.native",
      effects:["credential-use" as const],requiresCredentials:true,
      resources:["credential" as const]};
    const input=request("propose_custom_tool",{tool,requestedEffects:["credential-use"],
      scopes:[cred]});
    expect(evaluateToolFabricPolicy(input).decision).toBe("REQUIRE_APPROVAL");
    for(const state of ["expired","revoked"] as const)
      expect(evaluateToolFabricPolicy({...input,scopes:[{...cred,state}]}).decision)
        .toBe("DENY");
    expect(evaluateToolFabricPolicy({...input,scopes:[{...cred,state:"unknown"}]}).decision)
      .toBe("UNKNOWN");
    expect(evaluateToolFabricPolicy({...input,scopes:[{...cred,
      reference:"actual-secret-value"}]}).decision).toBe("DENY");
    expect(evaluateToolFabricPolicy({...input,scopes:[{...cred,
      toolId:"other"}]}).decision).toBe("DENY");
  });

  it("prevents missing resource details from becoming pre-exposure permission",()=>{
    const preliminary=request("write_file",{phase:"exposure",scopes:[]});
    expect(evaluateToolFabricPolicy(preliminary).decision).toBe("REQUIRE_APPROVAL");
    expect(evaluateToolFabricPolicy({...preliminary,phase:"execution"}).decision).toBe("DENY");
  });

  it("does not auto-retry uncertain, timed-out, cancelled or successful writes",()=>{
    expect(toolRetryDecision("denied","none")).toBe("safe");
    expect(toolRetryDecision("completed","none")).toBe("safe");
    expect(toolRetryDecision("completed","observed")).toBe("unsafe");
    expect(toolRetryDecision("timeout","unknown")).toBe("unknown");
    expect(toolRetryDecision("cancelled","unknown")).toBe("unknown");
    expect(toolRetryDecision("unknown","none")).toBe("unknown");
  });
});
