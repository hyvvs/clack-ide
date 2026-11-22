import { usePreferencesStore } from "@/modules/settings/preferences";
import { canonicalJson } from "@/modules/ai/lib/canonicalJson";
import { isTfOperationTool, tfOperationEffectful, validateTfOperationInput } from
  "@/modules/ai/tools/tfOperations";
import {
  setAgentWorkspacePermissions,
  type AgentWorkspacePermission,
} from "@/modules/settings/store";
import {
  currentWorkspaceEnv,
  workspaceScopeKey,
} from "@/modules/workspace";
import type { ToolContext } from "@/modules/ai/tools/context";
import {
  builtinToolSecurity, evaluateToolFabricPolicy, pathWithin, unknownToolSecurity,
  type ToolRegistrySecurity, type ToolSandboxPolicy, type ToolScope,
  type ToolPolicyResult, type ToolSideEffect,
} from "./toolFabricPolicy";
import {
  acquireWorkspaceWriteLease,
  currentWorkspaceWriteLease,
} from "./workspaceWriteLease";

export type PermissionContext = Pick<
  ToolContext,
  "getAgentId" | "getCwd" | "getWorkspaceRoot" | "getSessionId"
>;

export type PermissionCategory =
  | "write-files"
  | "create-files"
  | "run-commands"
  | "delegate-runs"
  | "research-network";

export type PermissionScope = "once" | "chat" | "workspace";

export type AgentPermissionMode =
  | "chat-only"
  | "ask"
  | "trusted-workspace"
  | "full-access"
  | "custom";

export type AgentPermissionProfile = {
  mode: AgentPermissionMode;
  categories: Partial<Record<PermissionCategory, boolean>>;
};

export type AgentPermissionProfiles = Record<string, AgentPermissionProfile>;

export type AgentPermissionDecision = {
  outcome: "allow" | "prompt" | "deny";
  source:
    | "chat-only"
    | "chat-grant"
    | "workspace-grant"
    | "agent-profile"
    | "tf-security-policy"
    | "strict-action"
    | "default-policy";
  category: PermissionCategory | null;
};

export const DEFAULT_AGENT_PERMISSION_PROFILE: AgentPermissionProfile = {
  mode: "ask",
  categories: {},
};

export const AGENT_PERMISSION_MODE_LABELS: Record<
  AgentPermissionMode,
  string
> = {
  "chat-only": "Chat Only",
  ask: "Ask",
  "trusted-workspace": "Trusted Workspace",
  "full-access": "Full Access",
  custom: "Custom",
};

export const AGENT_PERMISSION_MODES: readonly AgentPermissionMode[] = [
  "chat-only",
  "ask",
  "trusted-workspace",
  "full-access",
  "custom",
];

export const PERMISSION_CATEGORY_LABELS: Record<PermissionCategory, string> = {
  "write-files": "Write or edit files",
  "create-files": "Create directories",
  "run-commands": "Run terminal commands",
  "delegate-runs": "Start another agent run",
  "research-network": "Fetch public web pages",
};

export const PERMISSION_CATEGORIES = Object.keys(
  PERMISSION_CATEGORY_LABELS,
) as PermissionCategory[];

const TOOL_CATEGORIES: Readonly<Record<string, PermissionCategory>> = {
  fetch_web_page: "research-network",
  compare_web_sources: "research-network",
  write_file: "write-files",
  edit: "write-files",
  multi_edit: "write-files",
  create_directory: "create-files",
  bash_run: "run-commands",
  bounded_command: "run-commands",
  tf_fs_write: "write-files",
  tf_fs_delete: "write-files",
  tf_repo_write: "run-commands",
  tf_build_run: "run-commands",
  bash_background: "run-commands",
  request_peer_task: "delegate-runs",
  cancel_peer_task: "delegate-runs",
  communicate_peer_task: "delegate-runs",
  promote_peer_finding: "delegate-runs",
};

const chatGrants = new Map<string, Set<PermissionCategory>>();
/** Ephemeral SDK approval bridge for the first native TF execution vertical.
 * The existing approval UI writes this ONLY on the human Allow once action;
 * a model tool call cannot synthesize an approved SDK continuation. An
 * independently compromised same-origin renderer still cannot be used as a
 * cryptographic proof of human intent; native controls remain authoritative. */
type TfOnceApproval = {sessionId:string;agentId:string;workspaceRoot:string;
  cwd:string;toolName:string;inputIdentity:string;expiresAt:number};
const tfOnceApprovals=new Map<string,TfOnceApproval>();
const TF_ONCE_APPROVAL_LIMIT=256;
const TF_ONCE_APPROVAL_WINDOW_MS=60_000;
/** Synchronous SHA-256 so a physical Allow once handler can record a digest
 * without retaining content or awaiting an untrusted async continuation. */
function sha256Identity(value:string):string {
  const bytes=new TextEncoder().encode(value);
  const primes:number[]=[];
  for(let n=2;primes.length<64;n++)
    if(primes.every(p=>n%p!==0))primes.push(n);
  const k=primes.map(n=>Math.floor((Math.cbrt(n)%1)*0x100000000)>>>0);
  const h=primes.slice(0,8).map(n=>Math.floor((Math.sqrt(n)%1)*0x100000000)>>>0);
  const bitLength=bytes.length*8;
  const count=Math.ceil((bytes.length+9)/64)*64;
  const data=new Uint8Array(count);
  data.set(bytes);data[bytes.length]=0x80;
  const view=new DataView(data.buffer);
  view.setUint32(count-8,Math.floor(bitLength/0x100000000));
  view.setUint32(count-4,bitLength>>>0);
  const w=new Uint32Array(64);
  const r=(v:number,b:number)=>(v>>>b)|(v<<(32-b));
  for(let start=0;start<count;start+=64){
    for(let i=0;i<16;i++)w[i]=view.getUint32(start+i*4);
    for(let i=16;i<64;i++){
      const a=w[i-15],b=w[i-2];
      w[i]=(w[i-16]+(r(a,7)^r(a,18)^(a>>>3))+w[i-7]+
        (r(b,17)^r(b,19)^(b>>>10)))>>>0;
    }
    let [a,b,c,d,e,f,g,j]=h;
    for(let i=0;i<64;i++){
      const t1=(j+(r(e,6)^r(e,11)^r(e,25))+((e&f)^(~e&g))+k[i]+w[i])>>>0;
      const t2=((r(a,2)^r(a,13)^r(a,22))+((a&b)^(a&c)^(b&c)))>>>0;
      j=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
    }
    for(const [i,n] of [a,b,c,d,e,f,g,j].entries())h[i]=(h[i]+n)>>>0;
  }
  return h.map(n=>n.toString(16).padStart(8,"0")).join("");
}
function exactTfInputIdentity(toolName:string,input:Record<string,unknown>):string|null {
  if(isTfOperationTool(toolName)){
    if(!validateTfOperationInput(toolName,input))return null;
    return sha256Identity(canonicalJson([toolName,input]));
  }
  if(toolName!=="bounded_command" ||
     (input.action!=="read_status"&&input.action!=="write_marker") ||
     typeof input.cwd!=="string" || typeof input.executable!=="string" ||
     !Array.isArray(input.args) || input.args.length>12 ||
     !input.args.every(arg=>typeof arg==="string"&&arg.length<=512))return null;
  return sha256Identity(canonicalJson([toolName,input.action,input.executable,
    input.args,input.cwd]));
}
export function recordTfApprovedToolCall(input:{toolCallId:string;sessionId:string;
  agentId:string;workspaceRoot:string|null;toolName:string;
  parameters:Record<string,unknown>;cwd?:string|null},now=Date.now()):boolean {
  if((input.toolName!=="bounded_command" &&
      !tfOperationEffectful(input.toolName)) || !input.toolCallId ||
      input.toolCallId.length>256 || !input.sessionId || !input.agentId ||
      !input.workspaceRoot || !Number.isSafeInteger(now))return false;
  const identity=exactTfInputIdentity(input.toolName,input.parameters);
  if(!identity)return false;
  for(const [key,proof] of tfOnceApprovals)
    if(proof.expiresAt<=now)tfOnceApprovals.delete(key);
  if(tfOnceApprovals.size>=TF_ONCE_APPROVAL_LIMIT ||
      tfOnceApprovals.has(input.toolCallId))return false;
  tfOnceApprovals.set(input.toolCallId,{sessionId:input.sessionId,
    agentId:input.agentId,workspaceRoot:input.workspaceRoot,
    cwd:input.cwd??input.workspaceRoot,toolName:input.toolName,
    inputIdentity:identity,expiresAt:now+TF_ONCE_APPROVAL_WINDOW_MS});
  return true;
}
export function consumeTfApprovedToolCall(input:{toolCallId:string;sessionId:string;
  agentId:string;workspaceRoot:string|null;parameters:Record<string,unknown>;
  toolName?:string;cwd?:string|null},
  now=Date.now()):boolean {
  if(!input.toolCallId)return false;
  const approval=tfOnceApprovals.get(input.toolCallId);
  // Consume even on mismatch so the same approval cannot be adjusted and
  // replayed against a different process/actor/target.
  tfOnceApprovals.delete(input.toolCallId);
  return !!approval && approval.expiresAt>now &&
    approval.sessionId===input.sessionId && approval.agentId===input.agentId &&
    approval.workspaceRoot===input.workspaceRoot &&
    approval.toolName===(input.toolName??"bounded_command") &&
    approval.cwd===(input.cwd??input.workspaceRoot) &&
    approval.inputIdentity===exactTfInputIdentity(
      input.toolName??"bounded_command",input.parameters);
}

/** Read-only snapshot for same-run recovery authority comparison. */
export function chatPermissionGrantSnapshot(sessionId: string, agentId: string): PermissionCategory[] {
  return [...(chatGrants.get(chatGrantKey(sessionId, agentId)) ?? [])].sort();
}

/** Serializes the permission authority in effect at provider-batch admission.
 * This is *not* a stored grant; later broadenings cannot authorize recovery.
 */
export function agentPermissionAuthoritySnapshot(sessionId: string, agentId: string): string {
  const prefs = usePreferencesStore.getState();
  return canonicalJson([
    prefs.agentPermissionProfiles,
    prefs.agentWorkspacePermissions,
    chatPermissionGrantSnapshot(sessionId, agentId),
  ]);
}

export function isAgentPermissionMode(
  value: unknown,
): value is AgentPermissionMode {
  return (
    typeof value === "string" &&
    (AGENT_PERMISSION_MODES as readonly string[]).includes(value)
  );
}

export function normalizeAgentPermissionProfile(
  value: unknown,
): AgentPermissionProfile {
  if (!value || typeof value !== "object") {
    return DEFAULT_AGENT_PERMISSION_PROFILE;
  }
  const candidate = value as {
    mode?: unknown;
    categories?: unknown;
  };
  if (!isAgentPermissionMode(candidate.mode)) {
    return DEFAULT_AGENT_PERMISSION_PROFILE;
  }
  const rawCategories =
    candidate.categories && typeof candidate.categories === "object"
      ? (candidate.categories as Record<string, unknown>)
      : {};
  const categories: Partial<Record<PermissionCategory, boolean>> = {};
  for (const category of PERMISSION_CATEGORIES) {
    if (typeof rawCategories[category] === "boolean") {
      categories[category] = rawCategories[category] as boolean;
    }
  }
  return { mode: candidate.mode, categories };
}

export function permissionCategoryForTool(
  toolName: string,
): PermissionCategory | null {
  return TOOL_CATEGORIES[toolName] ?? null;
}

export function workspacePermissionKey(
  workspaceRoot: string,
  environment = workspaceScopeKey(currentWorkspaceEnv()),
): string {
  return `${environment}:${normalizePath(workspaceRoot)}`;
}

function normalizePath(path: string): string {
  const raw = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const prefix = raw.match(/^[a-zA-Z]:/)?.[0] ?? (raw.startsWith("/") ? "/" : "");
  const tail = prefix === "/" ? raw.slice(1) : raw.slice(prefix.length);
  const parts: string[] = [];
  for (const part of tail.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const joined =
    prefix === "/" ? `/${parts.join("/")}` : `${prefix}/${parts.join("/")}`;
  return /^[a-zA-Z]:/.test(joined) ? joined.toLowerCase() : joined;
}

function isInsideWorkspace(path: string, root: string): boolean {
  const candidate = normalizePath(path);
  const workspace = normalizePath(root);
  return candidate === workspace || candidate.startsWith(`${workspace}/`);
}

function resolvedInputPath(
  input: Record<string, unknown>,
  ctx: PermissionContext,
): string | null {
  const raw = typeof input.path === "string" ? input.path : null;
  if (!raw) return null;
  if (raw.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(raw)) return raw;
  const cwd = ctx.getCwd();
  if (!cwd) return null;
  return `${cwd.replace(/[\\/]$/, "")}/${raw}`;
}

export function isStrictPermissionRequest(
  toolName: string,
  input: Record<string, unknown>,
): boolean {
  if (toolName !== "bash_run" && toolName !== "bash_background") return false;
  const command = typeof input.command === "string" ? input.command : "";
  return /(?:^|[;&|]\s*)(?:rm\b|rmdir\b|del\b|remove-item\b)|\bgit\s+(?:reset|clean|rebase|restore|checkout\s+--|push\b[^\r\n]*--force)\b/i.test(
    command,
  );
}

export function canPersistPermission(
  toolName: string,
  input: Record<string, unknown>,
  ctx: PermissionContext,
): boolean {
  // Exact native effects cannot be promoted into chat/workspace permission;
  // even Full Access must produce a fresh SDK Allow once proof.
  if(tfOperationEffectful(toolName) || toolName==="bounded_command")return false;
  if (isStrictPermissionRequest(toolName, input)) return false;
  const category = permissionCategoryForTool(toolName);
  // Network destinations are chosen per invocation. Neither chat nor a
  // workspace-wide grant can authorize every future model-generated URL.
  if (category === "research-network") return false;
  const workspaceRoot = ctx.getWorkspaceRoot();
  if (!category || !workspaceRoot) return false;
  if (category === "delegate-runs") return true;
  if (category === "run-commands") {
    const cwd = typeof input.cwd === "string" ? input.cwd : ctx.getCwd();
    return cwd ? isInsideWorkspace(cwd, workspaceRoot) : false;
  }
  const path = resolvedInputPath(input, ctx);
  return path ? isInsideWorkspace(path, workspaceRoot) : false;
}

function chatGrantKey(sessionId: string, agentId: string): string {
  return `${sessionId}:${agentId}`;
}

function hasChatGrant(
  sessionId: string,
  agentId: string,
  category: PermissionCategory,
): boolean {
  return chatGrants.get(chatGrantKey(sessionId, agentId))?.has(category) ?? false;
}

export function grantChatPermission(
  sessionId: string,
  agentId: string,
  category: PermissionCategory,
): void {
  const key = chatGrantKey(sessionId, agentId);
  const grants = chatGrants.get(key) ?? new Set<PermissionCategory>();
  grants.add(category);
  chatGrants.set(key, grants);
}

export function clearChatPermissions(sessionId: string): void {
  const prefix = `${sessionId}:`;
  for (const key of chatGrants.keys()) {
    if (key.startsWith(prefix)) chatGrants.delete(key);
  }
  for (const [call,approval] of tfOnceApprovals)
    if(approval.sessionId===sessionId)tfOnceApprovals.delete(call);
}

export function clearAllChatPermissionsForTests(): void {
  chatGrants.clear();
  tfOnceApprovals.clear();
}

export function resolveAgentPermission(input: {
  agentId: string;
  sessionId: string | null;
  toolName: string;
  toolInput: Record<string, unknown>;
  context: PermissionContext;
  profile: AgentPermissionProfile;
  workspaceRules: readonly AgentWorkspacePermission[];
}): AgentPermissionDecision {
  const {
    agentId,
    sessionId,
    toolName,
    toolInput,
    context,
    workspaceRules,
  } = input;
  const profile = normalizeAgentPermissionProfile(input.profile);
  const category = permissionCategoryForTool(toolName);

  if (profile.mode === "chat-only") {
    return { outcome: "deny", source: "chat-only", category };
  }

  if (profile.mode === "full-access") {
    return { outcome: "allow", source: "agent-profile", category };
  }

  if (isStrictPermissionRequest(toolName, toolInput)) {
    return { outcome: "prompt", source: "strict-action", category };
  }

  const grantable = canPersistPermission(toolName, toolInput, context);
  if (category && grantable) {
    if (sessionId && hasChatGrant(sessionId, agentId, category)) {
      return { outcome: "allow", source: "chat-grant", category };
    }
    const workspaceRoot = context.getWorkspaceRoot();
    if (workspaceRoot) {
      const key = workspacePermissionKey(workspaceRoot);
      if (
        workspaceRules.some(
          (rule) =>
            rule.agentId === agentId &&
            rule.workspaceKey === key &&
            rule.category === category,
        )
      ) {
        return { outcome: "allow", source: "workspace-grant", category };
      }
    }
  }

  if (profile.mode === "trusted-workspace" && category && grantable) {
    return { outcome: "allow", source: "agent-profile", category };
  }

  if (
    profile.mode === "custom" &&
    category &&
    profile.categories[category] === true &&
    grantable
  ) {
    return { outcome: "allow", source: "agent-profile", category };
  }

  if (category) {
    return { outcome: "prompt", source: "default-policy", category };
  }

  return { outcome: "allow", source: "default-policy", category: null };
}

export function resolveCurrentAgentPermission(
  toolName: string,
  input: Record<string, unknown>,
  ctx: PermissionContext,
  registrySecurity?: ToolRegistrySecurity,
  phase:"exposure"|"execution" = Object.keys(input).length ? "execution" : "exposure",
  requestId?:string,
): AgentPermissionDecision {
  const agentId = ctx.getAgentId();
  const preferences = usePreferencesStore.getState();
  const existing = resolveAgentPermission({
    agentId,
    sessionId: ctx.getSessionId(),
    toolName,
    toolInput: input,
    context: ctx,
    profile:
      preferences.agentPermissionProfiles[agentId] ??
      DEFAULT_AGENT_PERMISSION_PROFILE,
    workspaceRules: preferences.agentWorkspacePermissions,
  });
  if(existing.outcome==="deny")return existing;
  // Compatibility for existing pre-registry callers and bounded offline
  // catalog fixtures. The production buildTools path supplies its live
  // registry descriptor on every SDK approval/execution invocation; it never
  // enters this branch. Keep the old pure permission API for B01/B02 users.
  if(!registrySecurity)return existing;
  const security = resolveCurrentToolFabricDecision(toolName,input,ctx,
    registrySecurity,phase,requestId);
  if(security.decision==="DENY" || security.decision==="UNKNOWN" ||
     security.decision==="UNSUPPORTED")
    return {outcome:"deny",source:"tf-security-policy",category:existing.category};
  if(security.decision==="REQUIRE_APPROVAL" || existing.outcome==="prompt")
    return {outcome:"prompt",source:"tf-security-policy",category:existing.category};
  return existing;
}

const tfWindowSandbox:ToolSandboxPolicy={
  identity:"tf-windows-process-contract-v1",
  required:[],
  enforced:["process-tree","timeout","environment-filter"],
  unsupported:["filesystem-isolation","network-isolation","readonly-mounts",
    "resource-limits","credential-injection","child-process-limits"],
  status:"partially-enforced",
};
const legacySandbox:ToolSandboxPolicy={
  identity:"legacy-executor-platform-controls-not-verified",
  required:[],enforced:[],
  unsupported:["process-tree","timeout","environment-filter",
    "filesystem-isolation","network-isolation","readonly-mounts",
    "resource-limits","credential-injection","child-process-limits"],
  status:"unsupported",
};
/** Native tf_operation owns its real OS controls and reauthorizes each
 * resource. Do not assert full filesystem/network isolation in TS preflight. */
const tfOperationSandbox:ToolSandboxPolicy={
  identity:"tf-native-operation-v1",required:[],enforced:[],
  unsupported:["process-tree","timeout","environment-filter",
    "filesystem-isolation","network-isolation","readonly-mounts",
    "resource-limits","credential-injection","child-process-limits"],
  status:"unsupported",
};

function absoluteScopePath(value:unknown,base:string|null):string|null {
  if(typeof value!=="string" || !value.trim())return null;
  if(value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value))return value;
  return base ? `${base.replace(/[\\/]$/,"")}/${value}` : null;
}

/** One central tool authorization preview used by registry exposure and every
 * SDK execute wrapper. Native command/T1/T2 owners still reauthorize actual
 * resources and credentials; this UI evaluation cannot create OS authority. */
export function resolveCurrentToolFabricDecision(
  toolName:string,input:Record<string,unknown>,ctx:PermissionContext,
  registered?:ToolRegistrySecurity,phase:"exposure"|"execution"="execution",
  requestId?:string,
):ToolPolicyResult {
  const prefs=usePreferencesStore.getState();
  const agentId=ctx.getAgentId();
  const root=ctx.getWorkspaceRoot();
  const security=registered ?? builtinToolSecurity(toolName) ??
    unknownToolSecurity(toolName,`unregistered:${toolName}`,"unknown");
  const cwd=ctx.getCwd()??root;
  const scopes:ToolScope[]=[];
  let effects:readonly ToolSideEffect[]=security.effects;
  let effectiveTool=security;
  if(toolName==="bounded_command"){
    if(input.action==="read_status"){
      effects=["read-only"];
      effectiveTool={...security,requiresApproval:false};
    }else if(input.action==="write_marker"){
      effects=["process-execution","local-reversible-write"];
      effectiveTool={...security,requiresApproval:true};
    }else if(phase==="execution"){
      effects=["unknown"];
    }
  }
  const nativeOp=isTfOperationTool(toolName);
  if(nativeOp && phase==="execution"){
    if(!validateTfOperationInput(toolName,input))
      return {decision:"DENY",reasonCode:"tf-operation-invalid-input",
        policyVersion:"tf-security-v1",approval:null,retry:"safe"};
    const operation=input.operation;
    if(toolName==="tf_fs_write")
      effects=operation==="file_create"||operation==="directory_create"
        ? ["local-reversible-write"] : ["local-destructive-write"];
    if(toolName==="tf_repo_write")
      effects=operation==="repo_stage"||operation==="repo_unstage"
        ? ["local-reversible-write"] : ["local-destructive-write"];
  }
  if(phase==="execution"){
    if(nativeOp){
      const operation=input.operation as string;
      const addFile=(value:unknown,ops:("read"|"write"|"create"|"delete")[])=>{
        const absolute=absoluteScopePath(value,cwd);
        if(!absolute || !root)return false;
        scopes.push({kind:"filesystem",workspaceRoot:root,path:absolute,operations:ops});
        return true;
      };
      if(toolName==="tf_fs_read" && !addFile(input.path,["read"]))
        return {decision:"DENY",reasonCode:"tf-source-not-scoped",
          policyVersion:"tf-security-v1",approval:null,retry:"safe"};
      if(toolName==="tf_fs_write" || toolName==="tf_fs_delete"){
        const operations:("read"|"write"|"create"|"delete")[]=
          operation==="file_delete" ? ["delete"] :
          operation==="file_move" ? ["read","delete"] :
          operation==="directory_create"||operation==="file_create"
            ? ["create"] : ["read","write"];
        if(!addFile(input.path,operations) ||
          (operation==="file_move" && !addFile(input.destination,
            ["create","write"])))
          return {decision:"DENY",reasonCode:"tf-target-not-scoped",
            policyVersion:"tf-security-v1",approval:null,retry:"safe"};
      }
      if(toolName==="tf_repo_read" || toolName==="tf_repo_write"){
        if(Array.isArray(input.paths)){
          if(input.paths.length>128 || !input.paths.every(path=>
            addFile(path,toolName==="tf_repo_read"?["read"]:["read","write"])))
            return {decision:"DENY",reasonCode:"tf-repo-path-not-scoped",
              policyVersion:"tf-security-v1",approval:null,retry:"safe"};
        }
      }
      if(toolName==="tf_repo_read" || toolName==="tf_repo_write" ||
        toolName==="tf_build_run"){
        const nativeCwd=root;
        if(!nativeCwd)return {decision:"DENY",reasonCode:"tf-cwd-not-scoped",
          policyVersion:"tf-security-v1",approval:null,retry:"safe"};
        if(toolName==="tf_repo_write" || toolName==="tf_build_run"){
          // Branch switching and bounded builds may affect the whole worktree,
          // not only named pathspecs. This is the declared *intended* workspace
          // effect ceiling; native must reauthorize it and cannot assert
          // filesystem/network OS isolation for arbitrary build scripts.
          scopes.push({kind:"filesystem",workspaceRoot:root,path:root,
            operations:["read","write","create","delete"]});
        }
        scopes.push({kind:"command",executable:`native-tf-operation:${operation}`,
          args:[operation],cwd:nativeCwd,envNames:[],
          timeoutMs:toolName==="tf_build_run" &&
            typeof input.timeoutMs==="number" ? input.timeoutMs:30_000});
      }
    }
    if(!nativeOp && security.resources.includes("filesystem")){
      const candidate=absoluteScopePath(input.path??input.root??
        (toolName==="grep"||toolName==="glob"?root:null),cwd);
      if(candidate && root)
        scopes.push({kind:"filesystem",workspaceRoot:root,path:candidate,
          operations:effects.includes("read-only")?["read"]:
            toolName==="create_directory"?["create"]:["write","delete"]});
      // A multi-edit tool might affect many independent paths. Every target
      // must be checked, not merely the first file path.
      if(Array.isArray(input.edits))for(const edit of input.edits){
        if(!edit || typeof edit!=="object")continue;
        const path=absoluteScopePath((edit as {path?:unknown}).path,cwd);
        if(path && root)scopes.push({kind:"filesystem",workspaceRoot:root,
          path,operations:["write"]});
      }
    }
    if(!nativeOp && security.resources.includes("command")){
      const directory=typeof input.cwd==="string"?input.cwd:cwd;
      if(directory){
        const structured=toolName==="bounded_command";
        scopes.push({kind:"command",executable:structured &&
          typeof input.executable==="string"?input.executable:
            structured?"":"legacy-shell-command",
          args:structured && Array.isArray(input.args)?input.args.filter(
            (arg):arg is string=>typeof arg==="string"):
            typeof input.command==="string"?[input.command]:[],cwd:directory,
          envNames:[],timeoutMs:structured?5_000:
            typeof input.timeout_secs==="number"?input.timeout_secs*1000:30_000});
      }
    }
    if(security.resources.includes("network")){
      const urls=typeof input.url==="string"?[input.url]:
        Array.isArray(input.urls)?input.urls:[];
      const malformed=urls.length===0 || urls.some(url=>typeof url!=="string" ||
        !/^https?:\/\//i.test(url));
      if(!malformed)for(const address of urls){
        try{
          const uri=new URL(address as string);
          if((uri.protocol==="http:"||uri.protocol==="https:") &&
             !uri.username && !uri.password && !uri.hash)
            scopes.push({kind:"network",protocol:uri.protocol.slice(0,-1) as "http"|"https",
              host:uri.hostname,port:uri.port?Number(uri.port):uri.protocol==="https:"?443:80,
              operation:"read"});
        }catch{/* Malformed destination cannot acquire a native network route. */}
      }
      // Every requested network URL must acquire an independently scoped
      // destination. Never authorize all three from a single safe first URL.
      if(malformed || scopes.filter(scope=>scope.kind==="network").length!==urls.length)
        return {decision:"DENY",reasonCode:"network-destination-not-scoped",
          policyVersion:"tf-security-v1",approval:null,retry:"safe"};
    }
  }
  const profile=prefs.agentPermissionProfiles[agentId]??DEFAULT_AGENT_PERMISSION_PROFILE;
  // Existing chat/workspace grants still control ordinary permission modes.
  // Their broad category scope is intentionally NOT elevated into exact TF
  // effect/credential/target grants; native execution retains final authority.
  const decision=evaluateToolFabricPolicy({phase,
    // Only SDK's actual toolCallId is eligible to bind an effectful approval.
    // Preview IDs are intentionally non-authoritative and never inserted as
    // grants; a later call must present an exact once-scoped UI proof.
    requestId:requestId&&requestId.length<=256?requestId:
      `tf-preflight:${ctx.getSessionId()??"none"}:${toolName}`,
    actor:{agentId,sessionId:ctx.getSessionId(),workspaceId:root?workspacePermissionKey(root):null,
      workspaceRoot:root},tool:effectiveTool,operation:toolName,
    requestedEffects:effects,resourceIdentity:nativeOp
      ? `tf-operation:${exactTfInputIdentity(toolName,input)??"missing"}`
      : JSON.stringify([toolName,input.path??null,input.cwd??null,
        input.url??null,input.executable??null,input.args??null]).slice(0,2048),
    scopes,sandbox:nativeOp?tfOperationSandbox:
      toolName==="bounded_command" ? {...tfWindowSandbox,configuration:{
      workspaceRoot:root,mounts:[],tempDirectory:null,
      environment:{forwardedNames:[],inheritParent:false},
      network:{mode:"unsupported",destinations:[]},
      credentials:{mode:"none",references:[]},
      process:{maxChildren:null,killTreeOnCancel:true,
        maxRuntimeMs:5000,maxMemoryBytes:null,maxCpuMs:null},
    }} : legacySandbox,permissionMode:profile.mode,
    allowedWorkspaceRoot:root, maxDurationMs:300_000});
  return decision;
}

export function requiresToolApproval(
  toolName: string,
  input: Record<string, unknown>,
  ctx: PermissionContext,
  workspaceRules: readonly AgentWorkspacePermission[],
  profiles: AgentPermissionProfiles = {},
): boolean {
  const agentId = ctx.getAgentId();
  return (
    resolveAgentPermission({
      agentId,
      sessionId: ctx.getSessionId(),
      toolName,
      toolInput: input,
      context: ctx,
      profile: profiles[agentId] ?? DEFAULT_AGENT_PERMISSION_PROFILE,
      workspaceRules,
    }).outcome === "prompt"
  );
}

type RuntimeTool = {
  needsApproval?:
    | boolean
    | ((input: unknown, options: unknown) => boolean | Promise<boolean>);
  execute?: (input: unknown, options: unknown) => unknown;
};

export function applyAgentPermissionPolicy<
  TTools extends object,
>(tools: TTools, ctx: ToolContext,
  lookupRegistrySecurity?: (name:string)=>ToolRegistrySecurity|undefined): TTools {
  const wrapped = {} as TTools;
  for (const [toolName, definition] of Object.entries(
    tools as Record<string, RuntimeTool>,
  )) {
    const originalExecute = definition.execute;
    const next: RuntimeTool = {
      ...definition,
      needsApproval: async (input, options) =>
        resolveCurrentAgentPermission(
          toolName,
          (input ?? {}) as Record<string, unknown>,
          ctx,
          lookupRegistrySecurity?.(toolName),
          Object.keys((input??{}) as Record<string,unknown>).length?"execution":"exposure",
          options && typeof options==="object" && "toolCallId" in options &&
            typeof options.toolCallId==="string"?options.toolCallId:undefined,
        ).outcome === "prompt" ||
        (typeof definition.needsApproval === "function"
          ? await definition.needsApproval(input,options)
          : definition.needsApproval === true),
    };
    if (originalExecute) {
      next.execute = async (input, options) => {
        const registered=lookupRegistrySecurity?.(toolName);
        const decision = resolveCurrentAgentPermission(
          toolName,
          (input ?? {}) as Record<string, unknown>,
          ctx,
          registered,
          "execution",
          options && typeof options==="object" && "toolCallId" in options &&
            typeof options.toolCallId==="string"?options.toolCallId:undefined,
        );
        if (decision.outcome === "deny") {
          const security=registered ? resolveCurrentToolFabricDecision(toolName,
            (input??{}) as Record<string,unknown>,ctx,registered,"execution",
            options && typeof options==="object" && "toolCallId" in options &&
              typeof options.toolCallId==="string"?options.toolCallId:undefined) : null;
          return {
            error:decision.source==="chat-only"
              ? `Tool '${toolName}' is blocked by the active agent's Chat Only permission profile.`
              : `Tool '${toolName}' was denied by the effective permission, resource or security policy.`,
            code: "agent_permission_denied",
            permissionSource: decision.source,
            ...(security?{
              policyDecision:security.decision,
              policyReasonCode:security.reasonCode,
              policyVersion:security.policyVersion,
            }:{}),
          };
        }
        if(lookupRegistrySecurity &&
          ((toolName==="bounded_command" &&
            (input as {action?:unknown}|null)?.action==="write_marker") ||
           tfOperationEffectful(toolName))){
          const toolCallId=options && typeof options==="object" &&
            "toolCallId" in options && typeof options.toolCallId==="string"
            ? options.toolCallId : "";
          if(!consumeTfApprovedToolCall({toolCallId,
            sessionId:ctx.getSessionId()??"",agentId:ctx.getAgentId(),
            workspaceRoot:ctx.getWorkspaceRoot(),
            cwd:toolName==="bounded_command"?undefined:ctx.getCwd()??ctx.getWorkspaceRoot(),
            toolName,
            parameters:(input??{}) as Record<string,unknown>}))
            return {error:"This exact native command requires an unexpired Allow once approval from the current chat.",
              code:"tf_exact_approval_required",effectState:"NoEffect",retry:"no_auto_retry"};
        }
        if (
          ctx.getMutationMode?.() === "isolated-worktree" &&
          !isToolRequestInsideWorkspace(
            toolName,
            (input ?? {}) as Record<string, unknown>,
            ctx,
          )
        ) {
          return {
            error:
              "This isolated peer run cannot target a path or working directory outside its worktree.",
            code: "isolated_worktree_escape_blocked",
          };
        }
        if (requiresWorkspaceWriteLease(toolName)) {
          if (ctx.getMutationMode?.() === "read-only") {
            return {
              error:
                "This peer task is read-only. Start a shared-write or isolated-worktree task to modify files or run commands.",
              code: "peer_task_read_only",
            };
          }
          const sessionId = ctx.getSessionId();
          const workspaceRoot = ctx.getWorkspaceRoot();
          const workspaceId =
            ctx.getWorkspaceId?.() ??
            (workspaceRoot ? workspacePermissionKey(workspaceRoot) : null);
          if (sessionId && workspaceId) {
            const agentId = ctx.getAgentId();
            const currentLease = currentWorkspaceWriteLease(workspaceId);
            if (currentLease && currentLease.ownerSessionId !== sessionId) {
              ctx.onWorkspaceWriteWait?.({
                sessionId: currentLease.ownerSessionId,
                agentId: currentLease.ownerAgentId,
              });
            }
            const signal =
              options &&
              typeof options === "object" &&
              "abortSignal" in options &&
              typeof AbortSignal !== "undefined" &&
              (options as { abortSignal?: unknown }).abortSignal instanceof
                AbortSignal
                ? (options as { abortSignal: AbortSignal }).abortSignal
                : undefined;
            const acquired = await acquireWorkspaceWriteLease({
              workspaceId,
              sessionId,
              agentId,
              signal,
            });
            if (!acquired.ok) {
              return {
                error: acquired.message,
                code: acquired.code,
                workspaceId,
              };
            }
            ctx.onWorkspaceWriteAcquired?.(acquired.waited);
          }
        }
        return originalExecute(input, options);
      };
    }
    (wrapped as Record<string, RuntimeTool>)[toolName] = next;
  }
  return wrapped;
}

function isToolRequestInsideWorkspace(
  toolName: string,
  input: Record<string, unknown>,
  ctx: PermissionContext,
): boolean {
  const category = permissionCategoryForTool(toolName);
  if (
    category !== "write-files" &&
    category !== "create-files" &&
    category !== "run-commands"
  ) {
    return true;
  }
  const workspaceRoot = ctx.getWorkspaceRoot();
  if (!workspaceRoot) return false;
  if(isTfOperationTool(toolName)){
    if(!validateTfOperationInput(toolName,input))return false;
    const cwd=ctx.getCwd()??workspaceRoot;
    if(!pathWithin(workspaceRoot,cwd))return false;
    const targets:unknown[]=[];
    if(input.path!==undefined)targets.push(input.path);
    if(input.destination!==undefined)targets.push(input.destination);
    if(input.paths!==undefined){
      if(!Array.isArray(input.paths))return false;
      targets.push(...input.paths);
    }
    return targets.every(raw=>{
      const path=absoluteScopePath(raw,cwd);
      return !!path && pathWithin(workspaceRoot,path);
    });
  }
  if (category === "run-commands") {
    const cwd = typeof input.cwd === "string" ? input.cwd : ctx.getCwd();
    return !!cwd && isInsideWorkspace(cwd, workspaceRoot);
  }
  const path = resolvedInputPath(input, ctx);
  return !!path && isInsideWorkspace(path, workspaceRoot);
}

export function requiresWorkspaceWriteLease(toolName: string): boolean {
  const category = permissionCategoryForTool(toolName);
  return (
    category === "write-files" ||
    category === "create-files" ||
    category === "run-commands"
  );
}

export async function grantScopedPermission(
  scope: Exclude<PermissionScope, "once">,
  toolName: string,
  input: Record<string, unknown>,
  ctx: PermissionContext,
): Promise<boolean> {
  const category = permissionCategoryForTool(toolName);
  if (!category || !canPersistPermission(toolName, input, ctx)) return false;
  const agentId = ctx.getAgentId();
  if (scope === "chat") {
    const sessionId = ctx.getSessionId();
    if (!sessionId) return false;
    grantChatPermission(sessionId, agentId, category);
    return true;
  }
  const workspaceRoot = ctx.getWorkspaceRoot();
  if (!workspaceRoot) return false;
  const workspaceKey = workspacePermissionKey(workspaceRoot);
  const current = usePreferencesStore.getState().agentWorkspacePermissions;
  if (
    current.some(
      (rule) =>
        rule.agentId === agentId &&
        rule.workspaceKey === workspaceKey &&
        rule.category === category,
    )
  ) {
    return true;
  }
  await setAgentWorkspacePermissions([
    ...current,
    { agentId, workspaceKey, category, createdAt: Date.now() },
  ]);
  return true;
}
