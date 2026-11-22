import { usePreferencesStore } from "@/modules/settings/preferences";
import type { AgentWorkspacePermission } from "@/modules/settings/store";
import type { ToolContext } from "@/modules/ai/tools/context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyAgentPermissionPolicy,
  canPersistPermission,
  recordTfApprovedToolCall,
  consumeTfApprovedToolCall,
  clearChatPermissions,
  resolveCurrentToolFabricDecision,
  clearAllChatPermissionsForTests,
  grantChatPermission,
  isStrictPermissionRequest,
  requiresWorkspaceWriteLease,
  requiresToolApproval,
  resolveAgentPermission,
  workspacePermissionKey,
  type AgentPermissionProfile,
  type AgentPermissionProfiles,
} from "@/modules/ai/lib/permissions";
import {builtinToolSecurity} from "@/modules/ai/lib/toolFabricPolicy";
import {
  acquireWorkspaceWriteLease,
  clearWorkspaceWriteLeasesForTests,
  releaseWorkspaceWriteLeasesForSession,
} from "@/modules/ai/lib/workspaceWriteLease";

function context(
  sessionId = "chat-a",
  root = "/work/a",
  agentId = "builtin:coder",
): ToolContext {
  return {
    getCwd: () => root,
    getWorkspaceRoot: () => root,
    getWorkspaceId: () => `local:${root}`,
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
    getSessionId: () => sessionId,
    getAgentId: () => agentId,
  };
}

function profile(mode: AgentPermissionProfile["mode"]): AgentPermissionProfile {
  return { mode, categories: {} };
}

function decision(
  mode: AgentPermissionProfile["mode"],
  toolName: string,
  toolInput: Record<string, unknown>,
  ctx = context(),
  rules: AgentWorkspacePermission[] = [],
) {
  return resolveAgentPermission({
    agentId: ctx.getAgentId(),
    sessionId: ctx.getSessionId(),
    toolName,
    toolInput,
    context: ctx,
    profile: profile(mode),
    workspaceRules: rules,
  });
}

describe("agent permission resolver", () => {
  beforeEach(() => {
    clearAllChatPermissionsForTests();
    usePreferencesStore.setState({
      agentPermissionProfiles: {},
      agentWorkspacePermissions: [],
    });
  });

  it("blocks all tool invocation in Chat Only", () => {
    expect(decision("chat-only", "read_file", { path: "README.md" })).toMatchObject({
      outcome: "deny",
      source: "chat-only",
    });
    expect(decision("chat-only", "todo_write", { todos: [] }).outcome).toBe(
      "deny",
    );
  });

  it("production TF registry gate keeps Full Access scoped and unknown effects blocked",()=>{
    usePreferencesStore.setState({agentPermissionProfiles:{
      "builtin:coder":profile("full-access")}});
    const ctx=context();
    expect(resolveCurrentToolFabricDecision("read_file",{path:"/work/a/safe.ts"},ctx,
      builtinToolSecurity("read_file")!).decision).toBe("ALLOW");
    expect(resolveCurrentToolFabricDecision("read_file",{path:"/work/elsewhere/key"},ctx,
      builtinToolSecurity("read_file")!)).toMatchObject({decision:"DENY",
        reasonCode:"filesystem-outside-workspace"});
    expect(resolveCurrentToolFabricDecision("unregistered_thing",{path:"/work/a"},ctx))
      .toMatchObject({decision:"UNKNOWN",reasonCode:"tool-provenance-unknown"});
    expect(resolveCurrentToolFabricDecision("bounded_command",{action:"write_marker",
      cwd:"/work/a",executable:"git.exe",args:["config","--local"]},ctx,
      builtinToolSecurity("bounded_command")!).decision).toBe("REQUIRE_APPROVAL");
  });

  it("requires one physical-UI-recorded, exact-scoped, consumed native TF write approval",async()=>{
    usePreferencesStore.setState({agentPermissionProfiles:{
      "builtin:coder":profile("full-access")}});
    const ctx=context();
    const input={action:"write_marker",cwd:"/work/a",executable:"C:/Git/git.exe",
      args:["config","--local","tf.command.marker","approved"]};
    const execute=vi.fn(async(_input:unknown,_options:unknown)=>({ok:true}));
    const tools=applyAgentPermissionPolicy({bounded_command:{execute,
      needsApproval:(_input:unknown,_options:unknown)=>true}},ctx,
      name=>builtinToolSecurity(name)??undefined);
    const opts={toolCallId:"call-approved-1",messages:[]};
    expect(await tools.bounded_command.needsApproval(input,opts)).toBe(true);
    await expect(tools.bounded_command.execute(input,opts)).resolves.toMatchObject({
      code:"tf_exact_approval_required",effectState:"NoEffect"});
    expect(execute).not.toHaveBeenCalled();
    expect(recordTfApprovedToolCall({toolName:"bounded_command",
      toolCallId:opts.toolCallId,sessionId:"chat-a",agentId:"builtin:coder",
      workspaceRoot:"/work/a",parameters:input})).toBe(true);
    await expect(tools.bounded_command.execute(input,opts)).resolves.toEqual({ok:true});
    expect(execute).toHaveBeenCalledOnce();
    await expect(tools.bounded_command.execute(input,opts)).resolves.toMatchObject({
      code:"tf_exact_approval_required"});
    expect(execute).toHaveBeenCalledOnce();
    const second="call-approved-2";
    expect(recordTfApprovedToolCall({toolName:"bounded_command",
      toolCallId:second,sessionId:"chat-a",agentId:"builtin:coder",
      workspaceRoot:"/work/a",parameters:input})).toBe(true);
    expect(consumeTfApprovedToolCall({toolCallId:second,sessionId:"chat-a",
      agentId:"builtin:reviewer",workspaceRoot:"/work/a",parameters:input})).toBe(false);
    expect(consumeTfApprovedToolCall({toolCallId:second,sessionId:"chat-a",
      agentId:"builtin:coder",workspaceRoot:"/work/a",parameters:input})).toBe(false);
    const third="call-approved-3";
    expect(recordTfApprovedToolCall({toolName:"bounded_command",
      toolCallId:third,sessionId:"chat-a",agentId:"builtin:coder",
      workspaceRoot:"/work/a",parameters:input})).toBe(true);
    clearChatPermissions("chat-a");
    expect(consumeTfApprovedToolCall({toolCallId:third,sessionId:"chat-a",
      agentId:"builtin:coder",workspaceRoot:"/work/a",parameters:input})).toBe(false);
  });
  it("TF operation scopes every source and destination and fails closed on escaped paths",()=>{
    usePreferencesStore.setState({agentPermissionProfiles:{
      "builtin:coder":profile("full-access")}});
    const ctx=context();
    const check=(name:string,input:Record<string,unknown>)=>
      resolveCurrentToolFabricDecision(name,input,ctx,
        builtinToolSecurity(name)!);
    expect(check("tf_fs_read",{operation:"file_read",path:"src/../a.ts"}))
      .toMatchObject({decision:"ALLOW",reasonCode:"within-scoped-policy"});
    expect(check("tf_fs_write",{operation:"file_create",path:"src/new.ts",
      content:"test"})).toMatchObject({decision:"REQUIRE_APPROVAL",
        reasonCode:"explicit-approval-required"});
    expect(check("tf_fs_write",{operation:"file_move",path:"src/a.ts",
      destination:"src/b.ts",expectedSha256:"a".repeat(64)})
      .decision).toBe("REQUIRE_APPROVAL");
    for(const input of [
      {operation:"file_move",path:"src/a.ts",destination:"../outside",
        expectedSha256:"a".repeat(64)},
      {operation:"file_move",path:"../outside",destination:"src/b.ts",
        expectedSha256:"a".repeat(64)},
      {operation:"file_move",path:"src/a.ts",destination:"src/../../a/b.ts",
        expectedSha256:"a".repeat(64)},
      {operation:"file_move",path:"src/a.ts",destination:"/work/a/../a/b.ts",
        expectedSha256:"a".repeat(64)},
    ])expect(check("tf_fs_write",input).reasonCode)
      .toBe("filesystem-outside-workspace");
    expect(check("tf_repo_write",{operation:"repo_stage",
      paths:["src/a.ts","../outside"]}).reasonCode)
      .toBe("filesystem-outside-workspace");
    expect(check("tf_repo_read",{operation:"repo_diff",
      paths:["src/a.ts","/work/b/file"]}).reasonCode)
      .toBe("filesystem-outside-workspace");
    expect(check("tf_repo_write",{operation:"repo_stage",paths:["src/a.ts"]})
      .decision).toBe("REQUIRE_APPROVAL");
    expect(check("tf_build_run",{operation:"build_typecheck",timeoutMs:5000})
      .decision).toBe("REQUIRE_APPROVAL");
    expect(check("tf_build_run",{operation:"unknown_build"})
      .reasonCode).toBe("tf-operation-invalid-input");
    expect(check("tf_fs_write",{operation:"file_move",path:"a.ts",
      destination:"b.ts",expectedSha256:"a".repeat(64),
      content:"injected"}).reasonCode)
      .toBe("tf-operation-invalid-input");
  });
  it("every new native effect consumes exact hashed SDK UI proof once, even Full Access",async()=>{
    usePreferencesStore.setState({agentPermissionProfiles:{
      "builtin:coder":profile("full-access")}});
    const ctx=context();
    const execute=vi.fn(async(_input:unknown,_options:unknown)=>({ok:true}));
    const inputs={
      tf_fs_write:{operation:"file_patch",path:"src/a.ts",oldText:"before",
        newText:"after",expectedSha256:"a".repeat(64)},
      tf_fs_delete:{operation:"file_delete",path:"src/a.ts",
        expectedSha256:"a".repeat(64)},
      tf_repo_write:{operation:"repo_stage",paths:["src/a.ts"]},
      tf_build_run:{operation:"build_typecheck",timeoutMs:5000},
    };
    const tools=applyAgentPermissionPolicy(Object.fromEntries(
      Object.keys(inputs).map(name=>[name,{execute}])),ctx,
      name=>builtinToolSecurity(name)??undefined) as unknown as Record<string,{
        execute:(input:unknown,options:unknown)=>Promise<unknown>;
        needsApproval:(input:unknown,options:unknown)=>Promise<boolean>;
      }>;
    for(const [name,input] of Object.entries(inputs)){
      const opts={toolCallId:`native-call-${name}`};
      expect(canPersistPermission(name,input,ctx)).toBe(false);
      expect(await tools[name].needsApproval(input,opts)).toBe(true);
      expect(await tools[name].execute(input,opts)).toMatchObject({
        code:"tf_exact_approval_required",effectState:"NoEffect"});
      expect(recordTfApprovedToolCall({toolName:name,
        toolCallId:opts.toolCallId,sessionId:"chat-a",
        agentId:"builtin:coder",workspaceRoot:"/work/a",
        cwd:"/work/a",parameters:input})).toBe(true);
      expect(await tools[name].execute(input,opts)).toEqual({ok:true});
      expect(await tools[name].execute(input,opts)).toMatchObject({
        code:"tf_exact_approval_required"});
    }
    expect(execute).toHaveBeenCalledTimes(4);
    const changed={operation:"file_patch",path:"src/a.ts",
      oldText:"before",newText:"changed-secret",expectedSha256:"a".repeat(64)};
    expect(recordTfApprovedToolCall({toolName:"tf_fs_write",toolCallId:"mutation",
      sessionId:"chat-a",agentId:"builtin:coder",
      workspaceRoot:"/work/a",parameters:inputs.tf_fs_write})).toBe(true);
    expect(consumeTfApprovedToolCall({toolName:"tf_fs_write",
      toolCallId:"mutation",sessionId:"chat-a",agentId:"builtin:coder",
      workspaceRoot:"/work/a",parameters:changed})).toBe(false);
    expect(consumeTfApprovedToolCall({toolName:"tf_fs_write",
      toolCallId:"mutation",sessionId:"chat-a",agentId:"builtin:coder",
      workspaceRoot:"/work/a",parameters:inputs.tf_fs_write})).toBe(false);
    expect(recordTfApprovedToolCall({toolName:"tf_build_run",
      toolCallId:"cwd-drift",sessionId:"chat-a",agentId:"builtin:coder",
      workspaceRoot:"/work/a",cwd:"/work/a/src",
      parameters:inputs.tf_build_run})).toBe(true);
    expect(consumeTfApprovedToolCall({toolName:"tf_build_run",
      toolCallId:"cwd-drift",sessionId:"chat-a",agentId:"builtin:coder",
      workspaceRoot:"/work/a",cwd:"/work/a",
      parameters:inputs.tf_build_run})).toBe(false);
    expect(recordTfApprovedToolCall({toolName:"tf_fs_write",
      toolCallId:"wrong-extra",sessionId:"chat-a",agentId:"builtin:coder",
      workspaceRoot:"/work/a",parameters:{...inputs.tf_fs_write,
        arbitrary:"cannot-grant"}})).toBe(false);
  });
  it("TF3 native network operations require exact one-use proof and never accept broadened grants",async()=>{
    usePreferencesStore.setState({agentPermissionProfiles:{
      "builtin:coder":profile("full-access")}});
    const ctx=context();
    const operations:Record<string,Record<string,unknown>>={
      tf_http_fetch:{url:"https://docs.example.org/guide",maxBytes:4096},
      tf_http_head:{url:"https://docs.example.org/guide"},
      tf_web_search:{query:"tool fabric documentation"},
    };
    const execute=vi.fn(async()=>({ok:true}));
    const guarded=applyAgentPermissionPolicy(Object.fromEntries(
      Object.keys(operations).map(name=>[name,{execute,needsApproval:true}])),
      ctx,name=>builtinToolSecurity(name)??undefined) as unknown as Record<string,{
        execute:(input:unknown,options:unknown)=>Promise<unknown>;
        needsApproval:(input:unknown,options:unknown)=>Promise<boolean>;
      }>;
    for(const [name,input] of Object.entries(operations)){
      const options={toolCallId:`network-once-${name}`};
      const policy=resolveCurrentToolFabricDecision(name,input,ctx,
        builtinToolSecurity(name)!);
      expect(policy).toMatchObject({decision:"REQUIRE_APPROVAL",
        reasonCode:"explicit-approval-required"});
      expect(canPersistPermission(name,input,ctx)).toBe(false);
      expect(await guarded[name].needsApproval(input,options)).toBe(true);
      expect(await guarded[name].execute(input,options)).toMatchObject({
        code:"tf_exact_approval_required",effectState:"NoEffect"});
      expect(execute).not.toHaveBeenCalledWith(input,options);
      expect(recordTfApprovedToolCall({toolName:name,toolCallId:options.toolCallId,
        sessionId:"chat-a",agentId:"builtin:coder",
        workspaceRoot:"/work/a",cwd:"/work/a",parameters:input})).toBe(true);
      expect(await guarded[name].execute(input,options)).toEqual({ok:true});
      expect(await guarded[name].execute(input,options)).toMatchObject({
        code:"tf_exact_approval_required"});
    }
    expect(execute).toHaveBeenCalledTimes(3);
    const target=operations.tf_http_fetch;
    expect(recordTfApprovedToolCall({toolName:"tf_http_fetch",
      toolCallId:"cross-origin",sessionId:"chat-a",agentId:"builtin:coder",
      workspaceRoot:"/work/a",parameters:target})).toBe(true);
    expect(consumeTfApprovedToolCall({toolName:"tf_http_fetch",
      toolCallId:"cross-origin",sessionId:"chat-a",agentId:"builtin:coder",
      workspaceRoot:"/work/a",parameters:{
        url:"https://elsewhere.example.org/guide",maxBytes:4096}})).toBe(false);
    expect(recordTfApprovedToolCall({toolName:"tf_web_search",
      toolCallId:"fake-header",sessionId:"chat-a",agentId:"builtin:coder",
      workspaceRoot:"/work/a",parameters:{query:"safe research",
        authorization:"Bearer should-not-reach-native"}})).toBe(false);
    for(const name of Object.keys(operations)){
      expect(resolveCurrentToolFabricDecision(name,operations[name],ctx,
        builtinToolSecurity(name)!,"execution").decision).toBe("REQUIRE_APPROVAL");
      usePreferencesStore.setState({agentPermissionProfiles:{
        "builtin:coder":profile("chat-only")}});
      expect(resolveCurrentToolFabricDecision(name,operations[name],ctx,
        builtinToolSecurity(name)!,"execution").reasonCode).toBe("agent-chat-only");
      usePreferencesStore.setState({agentPermissionProfiles:{
        "builtin:coder":profile("full-access")}});
    }
    expect(resolveCurrentToolFabricDecision("tf_http_fetch",
      {url:"https://docs.example.org/guide",arbitraryHeader:"x"},ctx,
      builtinToolSecurity("tf_http_fetch")!).reasonCode).toBe("tf-web-invalid-input");
  });
  it("does not allow a read-only delegated task to execute network/quota operations",async()=>{
    const ctx={...context(),getMutationMode:()=> "read-only" as const};
    const execute=vi.fn(async(_input:unknown,_options:unknown)=>({ok:true}));
    const tools=applyAgentPermissionPolicy({
      tf_http_fetch:{execute},tf_web_search:{execute},
    },ctx,name=>builtinToolSecurity(name)??undefined);
    expect(await tools.tf_http_fetch.execute({
      url:"https://docs.example.org/guide",
    },{toolCallId:"read-only-network"})).toMatchObject({
      code:"tf_web_read_only_run_denied",effectState:"NoEffect"});
    expect(await tools.tf_web_search.execute({
      query:"latest news",
    },{toolCallId:"read-only-search"})).toMatchObject({
      code:"tf_web_read_only_run_denied",effectState:"NoEffect"});
    expect(execute).not.toHaveBeenCalled();
  });
  it("TF4 native browser navigation and snapshot targets require exact once proof even in Full Access",async()=>{
    usePreferencesStore.setState({agentPermissionProfiles:{
      "builtin:coder":profile("full-access")}});
    const ctx=context();
    const sid="a".repeat(48),snapshotId="b".repeat(48),elementId="c".repeat(48);
    const operations:Record<string,Record<string,unknown>>={
      tf_browser_open:{url:"https://docs.example.org/guide"},
      tf_browser_navigate:{browserSessionId:sid,url:"https://docs.example.org/next"},
      tf_browser_inspect:{browserSessionId:sid},
      tf_browser_click:{browserSessionId:sid,snapshotId,elementId},
      tf_browser_back:{browserSessionId:sid},
      tf_browser_close:{browserSessionId:sid},
    };
    const execute=vi.fn(async()=>({ok:true}));
    const guarded=applyAgentPermissionPolicy(Object.fromEntries(
      Object.keys(operations).map(name=>[name,{execute,needsApproval:true}])),
      ctx,name=>builtinToolSecurity(name)??undefined) as unknown as Record<string,{
        execute:(input:unknown,options:unknown)=>Promise<unknown>;
        needsApproval:(input:unknown,options:unknown)=>Promise<boolean>;
      }>;
    for(const [name,input] of Object.entries(operations)){
      const options={toolCallId:`browser-once-${name}`};
      expect(resolveCurrentToolFabricDecision(name,input,ctx,
        builtinToolSecurity(name)!)).toMatchObject({
          decision:"REQUIRE_APPROVAL",reasonCode:"explicit-approval-required"});
      expect(canPersistPermission(name,input,ctx)).toBe(false);
      expect(await guarded[name].needsApproval(input,options)).toBe(true);
      expect(await guarded[name].execute(input,options)).toMatchObject({
        code:"tf_exact_approval_required",effectState:"NoEffect"});
      expect(recordTfApprovedToolCall({toolName:name,
        toolCallId:options.toolCallId,sessionId:"chat-a",agentId:"builtin:coder",
        workspaceRoot:"/work/a",cwd:"/work/a",parameters:input})).toBe(true);
      expect(await guarded[name].execute(input,options)).toEqual({ok:true});
      expect(await guarded[name].execute(input,options)).toMatchObject({
        code:"tf_exact_approval_required",effectState:"NoEffect"});
    }
    expect(execute).toHaveBeenCalledTimes(6);
    const open=operations.tf_browser_open;
    expect(recordTfApprovedToolCall({toolName:"tf_browser_open",
      toolCallId:"browser-cross-origin",sessionId:"chat-a",agentId:"builtin:coder",
      workspaceRoot:"/work/a",cwd:"/work/a",parameters:open})).toBe(true);
    expect(consumeTfApprovedToolCall({toolName:"tf_browser_open",
      toolCallId:"browser-cross-origin",sessionId:"chat-a",agentId:"builtin:coder",
      workspaceRoot:"/work/a",cwd:"/work/a",parameters:{url:"https://other.example.org/"}})).toBe(false);
    expect(recordTfApprovedToolCall({toolName:"tf_browser_open",
      toolCallId:"browser-fake-secret",sessionId:"chat-a",agentId:"builtin:coder",
      workspaceRoot:"/work/a",parameters:{...open,authorization:"Bearer injected"}})).toBe(false);
    expect(resolveCurrentToolFabricDecision("tf_browser_open",{
      url:"http://127.0.0.1/"},ctx,builtinToolSecurity("tf_browser_open")!)
      .decision).toBe("DENY");
    expect(resolveCurrentToolFabricDecision("tf_browser_open",{
      url:"file:///etc/passwd"},ctx,builtinToolSecurity("tf_browser_open")!)
      .decision).toBe("DENY");
    for(const [name,input] of Object.entries(operations)){
      usePreferencesStore.setState({agentPermissionProfiles:{
        "builtin:coder":profile("chat-only")}});
      expect(resolveCurrentToolFabricDecision(name,input,ctx,
        builtinToolSecurity(name)!).reasonCode).toBe("agent-chat-only");
      usePreferencesStore.setState({agentPermissionProfiles:{
        "builtin:coder":profile("full-access")}});
    }
  });
  it("disallows browser network in delegated read-only runs even when only inspecting",async()=>{
    const ctx={...context(),getMutationMode:()=>"read-only" as const};
    const execute=vi.fn(async(_input:unknown,_options:unknown)=>({ok:true}));
    const guarded=applyAgentPermissionPolicy({tf_browser_inspect:{execute}},ctx,
      name=>builtinToolSecurity(name)??undefined);
    expect(await guarded.tf_browser_inspect.execute({browserSessionId:"a".repeat(48)},
      {toolCallId:"readonly-inspect"})).toMatchObject({
        code:"tf_web_read_only_run_denied",effectState:"NoEffect"});
    expect(execute).not.toHaveBeenCalled();
  });

  it("uses the existing approval policy in Ask mode", () => {
    expect(decision("ask", "read_file", { path: "README.md" }).outcome).toBe(
      "allow",
    );
    expect(decision("ask", "write_file", { path: "src/a.ts" }).outcome).toBe(
      "prompt",
    );
  });

  afterEach(() => {
    clearWorkspaceWriteLeasesForTests();
  });

  it("treats another billed agent run as an explicit permission category", () => {
    const input = { targetSessionId: "chat-b", kind: "review" };
    expect(decision("chat-only", "request_peer_task", input).outcome).toBe(
      "deny",
    );
    expect(decision("ask", "request_peer_task", input).outcome).toBe(
      "prompt",
    );
    expect(
      decision("trusted-workspace", "request_peer_task", input).outcome,
    ).toBe("allow");
    expect(decision("full-access", "request_peer_task", input).outcome).toBe(
      "allow",
    );
    expect(decision("chat-only", "cancel_peer_task", input).outcome).toBe(
      "deny",
    );
    expect(decision("ask", "cancel_peer_task", input).outcome).toBe("prompt");
    expect(decision("full-access", "cancel_peer_task", input).outcome).toBe(
      "allow",
    );
  });

  it("treats Allow once as one response without creating a grant", () => {
    expect(
      requiresToolApproval(
        "write_file",
        { path: "/work/a/file.ts" },
        context(),
        [],
      ),
    ).toBe(true);
    expect(
      requiresToolApproval(
        "write_file",
        { path: "/work/a/file.ts" },
        context(),
        [],
      ),
    ).toBe(true);
  });

  it("keeps chat grants in one chat and one agent", () => {
    grantChatPermission("chat-a", "builtin:coder", "write-files");
    const profiles: AgentPermissionProfiles = {
      "builtin:coder": profile("ask"),
      "builtin:reviewer": profile("ask"),
    };
    const input = { path: "/work/a/file.ts" };
    expect(
      requiresToolApproval("write_file", input, context(), [], profiles),
    ).toBe(false);
    expect(
      requiresToolApproval(
        "write_file",
        input,
        context("chat-b"),
        [],
        profiles,
      ),
    ).toBe(true);
    expect(
      requiresToolApproval(
        "write_file",
        input,
        context("chat-a", "/work/a", "builtin:reviewer"),
        [],
        profiles,
      ),
    ).toBe(true);
  });

  it("keeps workspace grants in one workspace and one agent", () => {
    const rules: AgentWorkspacePermission[] = [
      {
        agentId: "builtin:coder",
        workspaceKey: workspacePermissionKey("/work/a"),
        category: "write-files",
        createdAt: 1,
      },
    ];
    expect(
      decision("ask", "write_file", { path: "/work/a/file.ts" }, context(), rules)
        .outcome,
    ).toBe("allow");
    expect(
      decision(
        "ask",
        "write_file",
        { path: "/work/b/file.ts" },
        context("chat-a", "/work/b"),
        rules,
      ).outcome,
    ).toBe("prompt");
    expect(
      decision(
        "ask",
        "write_file",
        { path: "/work/a/file.ts" },
        context("chat-a", "/work/a", "builtin:reviewer"),
        rules,
      ).outcome,
    ).toBe("prompt");
  });

  it("allows grantable workspace actions in Trusted Workspace", () => {
    expect(
      decision("trusted-workspace", "write_file", { path: "src/a.ts" }).outcome,
    ).toBe("allow");
    expect(
      decision("trusted-workspace", "write_file", { path: "/other/a.ts" })
        .outcome,
    ).toBe("prompt");
  });

  it("keeps strict actions on the approval path outside Full Access", () => {
    const input = { command: "git reset --hard HEAD~1" };
    expect(isStrictPermissionRequest("bash_run", input)).toBe(true);
    expect(decision("trusted-workspace", "bash_run", input).outcome).toBe(
      "prompt",
    );
    expect(decision("full-access", "bash_run", input).outcome).toBe("allow");
  });

  it("respects the existing category matrix in Custom mode", () => {
    const ctx = context();
    const custom: AgentPermissionProfile = {
      mode: "custom",
      categories: { "write-files": true, "run-commands": false },
    };
    const resolve = (toolName: string, toolInput: Record<string, unknown>) =>
      resolveAgentPermission({
        agentId: ctx.getAgentId(),
        sessionId: ctx.getSessionId(),
        toolName,
        toolInput,
        context: ctx,
        profile: custom,
        workspaceRules: [],
      }).outcome;
    expect(resolve("write_file", { path: "src/a.ts" })).toBe("allow");
    expect(resolve("bash_run", { command: "npm test" })).toBe("prompt");
  });

  it("uses stable agent identity independently of model selection", () => {
    const profiles: AgentPermissionProfiles = {
      "builtin:coder": profile("full-access"),
      "builtin:reviewer": profile("chat-only"),
    };
    expect(profiles["builtin:coder"].mode).toBe("full-access");
    expect(profiles["builtin:reviewer"].mode).toBe("chat-only");
    expect(Object.keys(profiles)).not.toContain("openrouter-custom");
  });

  it("blocks before execution in Chat Only", async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    usePreferencesStore.setState({
      agentPermissionProfiles: {
        "builtin:coder": profile("chat-only"),
      },
    });
    const tools = applyAgentPermissionPolicy(
      { read_file: { execute } },
      context(),
    );
    await expect(tools.read_file.execute()).resolves.toMatchObject({
      code: "agent_permission_denied",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not hide application capability failures in Full Access", async () => {
    const execute = vi.fn(async () => ({ error: "os permission denied" }));
    usePreferencesStore.setState({
      agentPermissionProfiles: {
        "builtin:coder": profile("full-access"),
      },
    });
    const tools = applyAgentPermissionPolicy(
      { write_file: { execute } },
      context(),
    );
    await expect(tools.write_file.execute()).resolves.toEqual({
      error: "os permission denied",
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("classifies filesystem and shell mutations for shared-checkout leases", () => {
    expect(requiresWorkspaceWriteLease("write_file")).toBe(true);
    expect(requiresWorkspaceWriteLease("edit")).toBe(true);
    expect(requiresWorkspaceWriteLease("multi_edit")).toBe(true);
    expect(requiresWorkspaceWriteLease("create_directory")).toBe(true);
    expect(requiresWorkspaceWriteLease("bash_run")).toBe(true);
    expect(requiresWorkspaceWriteLease("bash_background")).toBe(true);
    expect(requiresWorkspaceWriteLease("read_file")).toBe(false);
    expect(requiresWorkspaceWriteLease("grep_search")).toBe(false);
    expect(requiresWorkspaceWriteLease("request_peer_task")).toBe(false);
    expect(requiresWorkspaceWriteLease("cancel_peer_task")).toBe(false);
  });

  it("serializes mutating tools from different sessions in one workspace", async () => {
    usePreferencesStore.setState({
      agentPermissionProfiles: {
        "builtin:coder": profile("full-access"),
      },
    });
    let finishFirst: (() => void) | undefined;
    const executeFirst = vi.fn(
      (_input: unknown, _options: unknown) =>
        new Promise<{ ok: true }>((resolve) => {
          finishFirst = () => resolve({ ok: true });
        }),
    );
    const executeSecond = vi.fn(async (_input: unknown, _options: unknown) => ({
      ok: true,
    }));
    const firstContext = context("chat-a");
    const secondContext = context("chat-b");
    const onWait = vi.fn();
    const onAcquired = vi.fn();
    secondContext.onWorkspaceWriteWait = onWait;
    secondContext.onWorkspaceWriteAcquired = onAcquired;
    const firstTools = applyAgentPermissionPolicy(
      { write_file: { execute: executeFirst } },
      firstContext,
    );
    const secondTools = applyAgentPermissionPolicy(
      { write_file: { execute: executeSecond } },
      secondContext,
    );

    const first = firstTools.write_file.execute({}, {});
    await vi.waitFor(() => expect(executeFirst).toHaveBeenCalledOnce());
    const second = secondTools.write_file.execute({}, {});
    await Promise.resolve();
    expect(executeSecond).not.toHaveBeenCalled();
    expect(onWait).toHaveBeenCalledWith({
      sessionId: "chat-a",
      agentId: "builtin:coder",
    });

    finishFirst?.();
    await first;
    releaseWorkspaceWriteLeasesForSession("chat-a");
    await expect(second).resolves.toEqual({ ok: true });
    expect(executeSecond).toHaveBeenCalledOnce();
    expect(onAcquired).toHaveBeenCalledWith(true);
  });

  it("allows read-only tools while another session owns the write lease", async () => {
    usePreferencesStore.setState({
      agentPermissionProfiles: {
        "builtin:coder": profile("full-access"),
      },
    });
    await acquireWorkspaceWriteLease({
      workspaceId: "local:/work/a",
      sessionId: "chat-a",
      agentId: "builtin:coder",
    });
    const execute = vi.fn(async (_input: unknown, _options: unknown) => ({
      content: "visible",
    }));
    const tools = applyAgentPermissionPolicy(
      { read_file: { execute } },
      context("chat-b"),
    );

    await expect(tools.read_file.execute({}, {})).resolves.toEqual({
      content: "visible",
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("blocks mutation tools in an explicitly read-only peer run", async () => {
    usePreferencesStore.setState({
      agentPermissionProfiles: {
        "builtin:coder": profile("full-access"),
      },
    });
    const ctx = context("chat-b");
    ctx.getMutationMode = () => "read-only";
    const execute = vi.fn(async (_input: unknown, _options: unknown) => ({
      ok: true,
    }));
    const tools = applyAgentPermissionPolicy(
      { write_file: { execute } },
      ctx,
    );

    await expect(tools.write_file.execute({}, {})).resolves.toMatchObject({
      code: "peer_task_read_only",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("blocks isolated file mutations outside the captured worktree", async () => {
    usePreferencesStore.setState({
      agentPermissionProfiles: {
        "builtin:coder": profile("full-access"),
      },
    });
    const ctx = context("chat-b", "/cache/worktree-a");
    ctx.getMutationMode = () => "isolated-worktree";
    const execute = vi.fn(async (_input: unknown, _options: unknown) => ({
      ok: true,
    }));
    const tools = applyAgentPermissionPolicy(
      { write_file: { execute } },
      ctx,
    );

    await expect(
      tools.write_file.execute({ path: "/work/main/file.ts" }, {}),
    ).resolves.toMatchObject({ code: "isolated_worktree_escape_blocked" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("cancels a mutating tool that is waiting for another session", async () => {
    usePreferencesStore.setState({
      agentPermissionProfiles: {
        "builtin:coder": profile("full-access"),
      },
    });
    await acquireWorkspaceWriteLease({
      workspaceId: "local:/work/a",
      sessionId: "chat-a",
      agentId: "builtin:coder",
    });
    const execute = vi.fn(async (_input: unknown, _options: unknown) => ({
      ok: true,
    }));
    const tools = applyAgentPermissionPolicy(
      { write_file: { execute } },
      context("chat-b"),
    );
    const controller = new AbortController();

    const waiting = tools.write_file.execute(
      {},
      { abortSignal: controller.signal },
    );
    controller.abort();

    await expect(waiting).resolves.toMatchObject({
      code: "workspace_write_wait_cancelled",
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
