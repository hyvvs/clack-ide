/**
 * TF Slice 1: pure, content-free security decisions for the EXISTING Tool
 * Fabric catalog and SDK executor. Clack (not the model) owns registration,
 * grants and resources. This is not a command runner or another trust store.
 * Native executors must independently reauthorize exact paths, executable,
 * runtime credentials and process lifetime at the OS boundary.
 */
export const TOOL_FABRIC_POLICY_VERSION = "tf-security-v1" as const;

export type ToolSideEffect =
  | "read-only" | "local-reversible-write" | "local-destructive-write"
  | "process-execution" | "network-read" | "network-write"
  | "external-side-effect" | "credential-use" | "privileged-system-effect"
  | "unknown";
export type ToolDecision = "ALLOW" | "DENY" | "REQUIRE_APPROVAL" | "UNSUPPORTED" | "UNKNOWN";
/** Network resources are identity-bearing policy scopes, not string-only URLs.
 * DNS evidence is resolved again by the native executor for every hop. */
export type ToolNetworkMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
export type ToolNetworkScope = {
  kind: "network";
  protocol: "http" | "https" | "tcp";
  host: string;
  port: number;
  operation: "read" | "write";
  path?: string;
  method?: ToolNetworkMethod;
  queryPresent?: boolean;
  resolvedAddresses?: readonly string[];
  resolution?: "native-pending" | "resolved" | "unknown";
  tls?: "required" | "not-applicable" | "unknown";
  credentialReference?: string | null;
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
};
export type ToolScope =
  | {kind:"filesystem"; workspaceRoot:string; path:string; operations:readonly ("read"|"write"|"create"|"delete")[]}
  | {kind:"command"; executable:string; args:readonly string[]; cwd:string; envNames:readonly string[]; timeoutMs:number}
  | ToolNetworkScope
  | {kind:"credential"; reference:string; provider:string; toolId:string; destination:string; operation:string; state:"valid"|"expired"|"revoked"|"unknown"|"native-verified-at-dispatch"};

export type ToolSandboxControl = "process-tree"|"timeout"|"environment-filter"|
  "filesystem-isolation"|"network-isolation"|"readonly-mounts"|
  "resource-limits"|"child-process-limits"|"credential-injection";
/** Portable desired sandbox settings. These are requirements, not statements
 * that an OS actually implements them. Each executor must report enforced vs
 * UNSUPPORTED controls separately in the observed ToolSandboxPolicy. */
export type ToolSandboxConfiguration = {
  workspaceRoot:string|null;
  mounts:readonly {path:string;mode:"read-only"|"read-write"}[];
  tempDirectory:string|null;
  environment:{forwardedNames:readonly string[];inheritParent:false};
  network:{mode:"disabled"|"allowlist"|"unrestricted"|"unsupported";
    destinations:readonly {host:string;port:number;protocol:string}[]};
  credentials:{mode:"none"|"references-only"|"unsupported";
    references:readonly string[]};
  process:{maxChildren:number|null;killTreeOnCancel:boolean;
    maxRuntimeMs:number;maxMemoryBytes:number|null;maxCpuMs:number|null};
};
export type ToolSandboxPolicy = {
  identity:string;
  configuration?:ToolSandboxConfiguration;
  required:readonly ToolSandboxControl[];
  enforced:readonly ToolSandboxControl[];
  unsupported:readonly ToolSandboxControl[];
  /** A process Job Object is not an AppContainer or filesystem sandbox. */
  status:"enforced"|"partially-enforced"|"unsupported"|"unknown";
};
export type ToolRegistrySecurity = {
  id:string;
  revision:string;
  name:string;
  provider:string;
  category:string;
  effects:readonly ToolSideEffect[];
  resources:readonly ToolScope["kind"][];
  requiresApproval:boolean;
  requiresCredentials:boolean;
  requiresSandbox:readonly ToolSandboxControl[];
  available:boolean;
  provenance:"clack-builtin"|"native-verified"|"unknown";
};
export type ToolActor = {agentId:string;sessionId:string|null;workspaceId:string|null;workspaceRoot:string|null};
export type ToolApprovalGrant = {
  id:string;
  scope:"once"|"chat"|"workspace"|"persistent";
  actorId:string;
  toolId:string;
  revision:string;
  effect:ToolSideEffect;
  resourceIdentity:string;
  sessionId?:string;
  workspaceId?:string;
  requestId?:string;
  approvedAt:number;
  expiresAt:number;
  revoked?:boolean;
  denied?:boolean;
};
export type ToolApprovalRequest = {
  requestId:string;
  actorId:string;
  toolId:string;
  toolRevision:string;
  action:string;
  target:string;
  effects:readonly ToolSideEffect[];
  credentialReferences:readonly string[];
  sandboxIdentity:string;
  sandboxStatus:ToolSandboxPolicy["status"];
  reversible:boolean|null;
  requestedScope:"once"|"chat"|"workspace"|"persistent";
  /** Never serialize a key, password, token or credential value. */
};
export type ToolSecurityRequest = {
  phase:"exposure"|"execution";
  requestId:string;
  actor:ToolActor;
  tool:ToolRegistrySecurity|null;
  operation:string;
  requestedEffects:readonly ToolSideEffect[];
  resourceIdentity:string;
  scopes:readonly ToolScope[];
  sandbox:ToolSandboxPolicy;
  permissionMode:"chat-only"|"ask"|"trusted-workspace"|"full-access"|"custom";
  grants?:readonly ToolApprovalGrant[];
  denials?:readonly ToolApprovalGrant[];
  allowedWorkspaceRoot?:string|null;
  maxDurationMs?:number;
  now?:number;
};
export type ToolPolicyResult = {
  decision:ToolDecision;
  reasonCode:string;
  policyVersion:typeof TOOL_FABRIC_POLICY_VERSION;
  approval:ToolApprovalRequest|null;
  retry:"safe"|"unsafe"|"unknown";
};

type BuiltinDeclaration = Pick<ToolRegistrySecurity,"category"|"effects"|"resources"|"requiresApproval"|"requiresCredentials"|"requiresSandbox">;
const builtin = (
  category:string, effects:ToolSideEffect[], resources:ToolScope["kind"][],
  requiresApproval=false, requiresSandbox:ToolSandboxControl[]=[],
):BuiltinDeclaration => ({category,effects,resources,requiresApproval,
  requiresCredentials:false,requiresSandbox});

// Exact reviewed builtins only. Unknown or caller-supplied MCP descriptions
// never acquire a harmless default. Existing native custom tools have their
// own separately versioned registry and are reauthorized by Rust at dispatch.
const BUILTIN_SECURITY:Readonly<Record<string,BuiltinDeclaration>> = {
  read_file:builtin("filesystem",["read-only"],["filesystem"]),
  list_directory:builtin("filesystem",["read-only"],["filesystem"]),
  grep:builtin("filesystem",["read-only"],["filesystem"]),
  glob:builtin("filesystem",["read-only"],["filesystem"]),
  write_file:builtin("filesystem",["local-destructive-write"],["filesystem"],true),
  edit:builtin("filesystem",["local-destructive-write"],["filesystem"],true),
  multi_edit:builtin("filesystem",["local-destructive-write"],["filesystem"],true),
  create_directory:builtin("filesystem",["local-reversible-write"],["filesystem"],true),
  bash_run:builtin("legacy-command",["process-execution"],["command"],true),
  bash_background:builtin("legacy-command",["process-execution"],["command"],true),
  bash_kill:builtin("process",["process-execution"],[],true),
  bash_list:builtin("process",["read-only"],[]),
  bash_logs:builtin("process",["read-only"],[]),
  bounded_command:builtin("native-command",["read-only","process-execution","local-reversible-write"],["command"],true,["process-tree","timeout","environment-filter"]),
  tf_fs_read:builtin("native-filesystem",["read-only"],["filesystem"]),
  tf_fs_write:builtin("native-filesystem",["local-reversible-write","local-destructive-write"],["filesystem"],true),
  tf_fs_delete:builtin("native-filesystem",["local-destructive-write"],["filesystem"],true),
  tf_repo_read:builtin("native-repository",["read-only"],["command"]),
  tf_repo_write:builtin("native-repository",["local-reversible-write","local-destructive-write"],["command","filesystem"],true),
  tf_build_run:builtin("native-build",["process-execution","local-reversible-write"],["command","filesystem"],true),
  tf_http_fetch:builtin("native-network",["network-read"],["network"],true),
  tf_http_head:builtin("native-network",["network-read"],["network"],true),
  tf_web_search:{...builtin("native-search",["network-read","credential-use"],["network","credential"],true),requiresCredentials:true},
  fetch_web_page:builtin("network",["network-read"],["network"],true),
  compare_web_sources:builtin("network",["network-read"],["network"],true),
  run_subagent:builtin("agent",["external-side-effect"],[],true),
  spawn_coding_agent:builtin("agent",["process-execution"],[],true),
  send_to_agent:builtin("agent",["external-side-effect"],[],true),
  read_agent_output:builtin("process",["read-only"],[]),
  request_peer_task:builtin("agent",["external-side-effect"],[],true),
  cancel_peer_task:builtin("agent",["external-side-effect"],[],true),
  communicate_peer_task:builtin("agent",["external-side-effect"],[],true),
  promote_peer_finding:builtin("agent",["external-side-effect"],[],true),
  propose_custom_tool:builtin("tool-registration",["local-reversible-write"],[],true),
  discover_capabilities:builtin("tool-discovery",["read-only"],[]),
  request_conversation_evidence:builtin("history",["read-only"],[]),
  todo_write:builtin("planning",["local-reversible-write"],[],false),
  suggest_command:builtin("proposal",["read-only"],[]),
  get_terminal_output:builtin("process",["read-only"],[]),
  open_preview:builtin("browser",["network-read"],["network"],true),
};

export function builtinToolSecurity(name:string):ToolRegistrySecurity|null {
  const row=BUILTIN_SECURITY[name];
  if(!row)return null;
  return {id:JSON.stringify(["builtin","clack",name]),revision:"builtin",
    provider:"clack",name,available:true,provenance:"clack-builtin",...row};
}

export function unknownToolSecurity(name:string,id:string,revision:string):ToolRegistrySecurity {
  return {id,revision,name,provider:"unknown",category:"unknown",effects:["unknown"],
    resources:[],requiresApproval:true,requiresCredentials:true,
    requiresSandbox:[],available:false,provenance:"unknown"};
}

const result=(decision:ToolDecision,reasonCode:string,
  approval:ToolApprovalRequest|null=null):ToolPolicyResult => ({
    decision,reasonCode,policyVersion:TOOL_FABRIC_POLICY_VERSION,approval,
    retry:decision==="ALLOW"?"unknown":decision==="DENY"||decision==="UNSUPPORTED"?"safe":"unsafe",
  });

export function pathWithin(root:string,path:string):boolean {
  // This is only a preflight lexical scope check, never a substitute for
  // native canonicalization and reparse-point/symlink enforcement.
  if(!root || !path || /[\u0000-\u001f]/.test(root+path))return false;
  const parse=(value:string)=>{
    const text=value.replace(/\\/g,"/");
    // Keep drive-relative and UNC/device paths out of this portable preflight.
    if(text.startsWith("//"))return null;
    const drive=/^[a-zA-Z]:\//.test(text)?text.slice(0,2).toLowerCase():"";
    if(!drive && !text.startsWith("/"))return null;
    const tail=text.slice(drive?3:1);
    if(drive && tail.startsWith("/"))return null;
    return {drive,components:tail.split("/").filter(part=>part&&part!==".")
      .map(part=>part.toLowerCase())};
  };
  const base=parse(root);
  const target=parse(path);
  if(!base || !target || base.drive!==target.drive ||
     base.components.includes(".."))return false;
  const walked:string[]=[];
  for(const part of target.components){
    if(part===".."){
      // A safe parent step must stay below the *initial* authorized root;
      // leaving and later re-entering that root never restores authority.
      if(walked.length<=base.components.length)return false;
      walked.pop();
    }else{
      walked.push(part);
      if(walked.length<=base.components.length &&
         walked[walked.length-1]!==base.components[walked.length-1])return false;
    }
  }
  return walked.length>=base.components.length;
}

function sameGrant(grant:ToolApprovalGrant,input:ToolSecurityRequest,effect:ToolSideEffect,now:number):boolean {
  const tool=input.tool;
  if(!tool || grant.revoked || grant.expiresAt<=now || grant.approvedAt>now ||
     grant.actorId!==input.actor.agentId || grant.toolId!==tool.id ||
     grant.revision!==tool.revision || grant.effect!==effect ||
     grant.resourceIdentity!==input.resourceIdentity)return false;
  switch(grant.scope){
    case "once":return !!input.requestId && grant.requestId===input.requestId;
    case "chat":return !!input.actor.sessionId && grant.sessionId===input.actor.sessionId;
    case "workspace":return !!input.actor.workspaceId && grant.workspaceId===input.actor.workspaceId;
    case "persistent":return !!input.actor.workspaceId && grant.workspaceId===input.actor.workspaceId;
  }
}

export function evaluateToolFabricPolicy(input:ToolSecurityRequest):ToolPolicyResult {
  const tool=input.tool;
  const now=input.now??Date.now();
  if(!tool || !tool.id || !tool.revision || !tool.name)
    return result("UNKNOWN","tool-unregistered");
  if(tool.provenance==="unknown")return result("UNKNOWN","tool-provenance-unknown");
  if(!tool.available)return result("UNSUPPORTED","tool-unavailable");
  if(!input.actor.agentId || !input.requestId || !input.operation)
    return result("UNKNOWN","missing-request-identity");
  if(input.permissionMode==="chat-only")return result("DENY","agent-chat-only");
  const effects=input.requestedEffects.length?input.requestedEffects:tool.effects;
  if(!effects.length || effects.includes("unknown") || tool.effects.includes("unknown") ||
     effects.some(effect=>!tool.effects.includes(effect)))
    return result("UNKNOWN","effect-unclassified");
  if(!input.sandbox.identity || input.sandbox.status==="unknown")
    return result("UNKNOWN","sandbox-unverified");
  const config=input.sandbox.configuration;
  if(config){
    if(config.environment.inheritParent!==false ||
       !Number.isSafeInteger(config.process.maxRuntimeMs) ||
       config.process.maxRuntimeMs<1 || config.process.maxRuntimeMs>300_000)
      return result("DENY","sandbox-configuration-invalid");
    if(config.credentials.mode==="references-only" && config.credentials.references.some(
      reference=>!/^credential:[A-Za-z0-9._-]{1,128}$/.test(reference)))
      return result("DENY","sandbox-credential-reference-invalid");
    if(tool.requiresCredentials && config.credentials.mode==="none")
      return result("UNSUPPORTED","credential-injection-unavailable");
    if(config.credentials.mode==="references-only" &&
       config.credentials.references.some(reference=>!input.scopes.some(scope=>
         scope.kind==="credential"&&scope.reference===reference)))
      return result("DENY","sandbox-credential-out-of-scope");
    if(config.network.mode!=="unsupported" &&
       input.sandbox.unsupported.includes("network-isolation"))
      return result("UNSUPPORTED","network-isolation-unavailable");
    if(config.mounts.length>0 && input.sandbox.unsupported.includes("readonly-mounts"))
      return result("UNSUPPORTED","mount-isolation-unavailable");
    if((config.process.maxMemoryBytes!==null || config.process.maxCpuMs!==null ||
        config.process.maxChildren!==null) &&
        input.sandbox.unsupported.includes("resource-limits"))
      return result("UNSUPPORTED","sandbox-resource-limit-unavailable");
  }
  const required=[...new Set([...tool.requiresSandbox,...input.sandbox.required])];
  if(required.some(control=>input.sandbox.unsupported.includes(control) ||
     !input.sandbox.enforced.includes(control)))
    return result("UNSUPPORTED","sandbox-control-unsupported");
  if(input.sandbox.status==="unsupported" && required.length)
    return result("UNSUPPORTED","sandbox-control-unsupported");
  if(input.maxDurationMs!==undefined &&
     (!Number.isSafeInteger(input.maxDurationMs)||input.maxDurationMs<1 || input.maxDurationMs>300_000))
    return result("DENY","execution-budget-out-of-range");
  if(input.phase==="execution"){
    for(const needed of tool.resources){
      if(!input.scopes.some(scope=>scope.kind===needed))return result("DENY","resource-scope-missing");
    }
    for(const scope of input.scopes){
      if(scope.kind==="filesystem"){
        const root=input.allowedWorkspaceRoot??input.actor.workspaceRoot;
        if(!root || !pathWithin(root,scope.workspaceRoot) ||
           !pathWithin(scope.workspaceRoot,scope.path))return result("DENY","filesystem-outside-workspace");
        if(!scope.operations.length)return result("UNKNOWN","filesystem-operation-unknown");
        if(effects.some(effect=>effect==="local-destructive-write"||effect==="local-reversible-write") &&
          !scope.operations.some(operation=>operation==="write"||operation==="create"||operation==="delete"))
          return result("DENY","filesystem-write-not-scoped");
      }else if(scope.kind==="command"){
        const root=input.allowedWorkspaceRoot??input.actor.workspaceRoot;
        if(!root || !pathWithin(root,scope.cwd) || !scope.executable ||
          scope.args.length>128 || scope.args.some(arg=>arg.length>4096) ||
          scope.envNames.length>64 || !Number.isSafeInteger(scope.timeoutMs) ||
          scope.timeoutMs<1 || scope.timeoutMs>300_000)
          return result("DENY","command-scope-invalid");
      }else if(scope.kind==="network"){
        if(!scope.host || /[\s/@?#]/.test(scope.host) ||
           !Number.isSafeInteger(scope.port) || scope.port<1 || scope.port>65535 ||
           (scope.operation==="write" && !effects.includes("network-write")))
          return result("DENY","network-destination-not-scoped");
        if(scope.protocol!=="http" && scope.protocol!=="https" && scope.protocol!=="tcp")
          return result("DENY","network-scheme-unsupported");
        if(scope.resolution==="unknown")return result("UNKNOWN","network-resolution-unknown");
        if(scope.resolution==="native-pending" &&
           !["tf_http_fetch","tf_http_head","tf_web_search"].includes(tool.name))
          return result("UNKNOWN","network-native-resolver-not-bound");
        if(scope.resolution==="resolved" &&
           (!scope.resolvedAddresses?.length ||
            scope.resolvedAddresses.some(address=>!address || /[^0-9a-fA-F:.]/.test(address))))
          return result("UNKNOWN","network-address-evidence-invalid");
        if(scope.path!==undefined && (!scope.path.startsWith("/") || scope.path.length>2048 ||
           /[\u0000-\u001f]/.test(scope.path)))
          return result("DENY","network-path-invalid");
        if(scope.maxBytes!==undefined &&
           (!Number.isSafeInteger(scope.maxBytes)||scope.maxBytes<1||scope.maxBytes>65536))
          return result("DENY","network-byte-budget-invalid");
        if(scope.maxRedirects!==undefined &&
           (!Number.isSafeInteger(scope.maxRedirects)||scope.maxRedirects<0||scope.maxRedirects>5))
          return result("DENY","network-redirect-budget-invalid");
        if(scope.timeoutMs!==undefined &&
           (!Number.isSafeInteger(scope.timeoutMs)||scope.timeoutMs<1||scope.timeoutMs>15000))
          return result("DENY","network-time-budget-invalid");
        if(scope.method && !["GET","HEAD"].includes(scope.method))
          return result("UNSUPPORTED","network-write-method-not-enabled");
        if(scope.operation==="write")
          return result("UNSUPPORTED","network-write-not-enabled");
      }else if(scope.kind==="credential"){
        if(scope.state==="unknown")return result("UNKNOWN","credential-state-unknown");
        if(scope.state==="expired"||scope.state==="revoked")return result("DENY","credential-not-active");
        if(scope.state==="native-verified-at-dispatch" &&
          (tool.name!=="tf_web_search" || scope.provider!=="brave_web" ||
           scope.reference!=="credential:brave-web-search"))
          return result("UNKNOWN","credential-native-verification-unavailable");
        if(!/^credential:[A-Za-z0-9._-]{1,128}$/.test(scope.reference) || scope.toolId!==tool.id || !scope.provider ||
           !scope.destination || !scope.operation)
          return result("DENY","credential-scope-mismatch");
      }
    }
    if(tool.requiresCredentials && !input.scopes.some(scope=>scope.kind==="credential"))
      return result("DENY","credential-reference-required");
  }
  const explicitlyDenied=effects.some(effect=>(input.denials??[]).some(row=>
    sameGrant(row,input,effect,now)));
  if(explicitlyDenied)return result("DENY","explicit-grant-denial");
  const approvalRequired=tool.requiresApproval || effects.some(effect=>
    effect!=="read-only" && effect!=="local-reversible-write");
  const approved=effects.every(effect=>(input.grants??[]).some(row=>
    !row.denied && sameGrant(row,input,effect,now)));
  if(approvalRequired && !approved){
    const target=input.resourceIdentity.slice(0,2048);
    return result("REQUIRE_APPROVAL","explicit-approval-required",{
      requestId:input.requestId,actorId:input.actor.agentId,
      toolId:tool.id,toolRevision:tool.revision,action:input.operation,
      target,effects,credentialReferences:input.scopes.filter(s=>s.kind==="credential")
        .map(s=>s.reference),sandboxIdentity:input.sandbox.identity,
      sandboxStatus:input.sandbox.status,
      reversible:effects.includes("local-destructive-write")?false:
        effects.includes("local-reversible-write")?true:null,
      requestedScope:"once",
    });
  }
  return result("ALLOW",approved?"exact-approval-grant":"within-scoped-policy");
}

export function toolRetryDecision(terminal:"completed"|"nonzero"|"denied"|"spawn-failure"|
    "timeout"|"cancelled"|"unknown",effect:"none"|"observed"|"unknown"):
    "safe"|"unsafe"|"unknown" {
  if(terminal==="denied" && effect==="none")return "safe";
  if(terminal==="unknown" || effect==="unknown")return "unknown";
  return terminal==="completed" && effect==="none"?"safe":"unsafe";
}

/** HTTP metadata reads are conditionally replayable; quota-consuming searches
 * are not automatically replayed, and future network writes never replay on
 * an uncertain terminal. The actual native receipt remains authoritative. */
export function networkRetryClass(method:ToolNetworkMethod | "SEARCH",
  terminal:"completed"|"denied"|"timeout"|"cancelled"|"unknown",
  effect:"NoEffect"|"Unknown"): "SAFE_RETRY"|"CONDITIONAL_RETRY"|"UNSAFE_RETRY"|"UNKNOWN" {
  if(terminal==="unknown" || effect==="Unknown")return "UNKNOWN";
  if(method==="SEARCH")return "CONDITIONAL_RETRY";
  if(method!=="GET" && method!=="HEAD")return "UNSAFE_RETRY";
  return terminal==="completed"||terminal==="denied"?"SAFE_RETRY":"CONDITIONAL_RETRY";
}
