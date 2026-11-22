import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  canPersistPermission,
  grantScopedPermission,
  isStrictPermissionRequest,
  recordTfApprovedToolCall,
  permissionCategoryForTool,
  type PermissionContext,
} from "@/modules/ai/lib/permissions";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { useAgentsStore } from "@/modules/ai/store/agentsStore";
import { BUILTIN_AGENTS } from "@/modules/ai/lib/agents";
import { workspacePathsEqual } from "@/modules/workspace";
import {
  ArrowDown01Icon,
  Cancel01Icon,
  Edit02Icon,
  FileEditIcon,
  FilePlusIcon,
  FolderAddIcon,
  TerminalIcon,
  Tick02Icon,
  ToolsIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ToolUIPart } from "ai";
import { memo } from "react";

type Props = {
  part: Extract<ToolUIPart, { state: "approval-requested" }>;
  toolName: string;
  sessionId: string;
  onRespond: (approved: boolean) => void;
};

export function respondToApprovalChoice(
  choice: "deny" | "once",
  onRespond: (approved: boolean) => void,
): void {
  onRespond(choice === "once");
}

const TOOL_META: Record<string, { label: string; icon: typeof FilePlusIcon }> =
  {
    write_file: { label: "Write file", icon: FilePlusIcon },
    edit: { label: "Edit file", icon: FileEditIcon },
    multi_edit: { label: "Edit file (batch)", icon: Edit02Icon },
    create_directory: { label: "Create directory", icon: FolderAddIcon },
    bash_run: { label: "Run shell command", icon: TerminalIcon },
    bounded_command: { label: "Run bounded workspace command", icon: TerminalIcon },
    tf_fs_read: { label: "Read workspace resource", icon: ToolsIcon },
    tf_fs_write: { label: "Modify workspace file", icon: FileEditIcon },
    tf_fs_delete: { label: "Delete workspace file", icon: FileEditIcon },
    tf_repo_read: { label: "Inspect repository", icon: ToolsIcon },
    tf_repo_write: { label: "Change repository state", icon: FileEditIcon },
    tf_build_run: { label: "Run structured build or test", icon: TerminalIcon },
    tf_http_fetch: { label: "Fetch public web content", icon: ToolsIcon },
    tf_http_head: { label: "Inspect HTTP resource", icon: ToolsIcon },
    tf_web_search: { label: "Search public web", icon: ToolsIcon },
    bash_background: { label: "Spawn background process", icon: TerminalIcon },
    request_peer_task: { label: "Start peer agent task", icon: ToolsIcon },
    cancel_peer_task: { label: "Cancel peer agent task", icon: ToolsIcon },
  };

const NATIVE_TF_EFFECTFUL_TOOLS = new Set([
  "tf_fs_write",
  "tf_fs_delete",
  "tf_repo_write",
  "tf_build_run",
]);
const NATIVE_TF_WEB_TOOLS = new Set(["tf_http_fetch","tf_http_head","tf_web_search"]);
/** Query strings can contain secret tokens, even when rejected at native
 * admission. Show only the normalized origin and pathname in approvals. */
function previewNetworkDestination(raw:unknown):string {
  if(typeof raw!=="string" || raw.length>2048)return "Native-validated destination only";
  try {
    const url=new URL(raw);
    if(!["http:","https:"].includes(url.protocol) || url.username || url.password)
      return "Unsupported or credential-bearing URL · deny";
    return `${url.origin}${url.pathname.slice(0,240)}${url.search?"?… (query withheld)":""}`;
  }catch{return "Invalid URL · deny";}
}

function AiToolApprovalImpl({ part, toolName, sessionId, onRespond }: Props) {
  const meta = TOOL_META[toolName];
  const label = meta?.label ?? toolName;
  const Icon = meta?.icon ?? ToolsIcon;
  const input = part.input as Record<string, unknown>;
  const owner = useChatStore((s) => s.sessions.find((item) => item.id === sessionId));
  const customAgents = useAgentsStore((s) => s.customAgents);
  const ownerAgentId = owner?.run?.agentId ?? owner?.profile?.agentId;
  const ownerAgent = [...BUILTIN_AGENTS, ...customAgents].find((agent) => agent.id === ownerAgentId)?.name ?? "Agent unavailable";
  const permissionContext: PermissionContext = {
    getCwd: () => {
      const current = useChatStore.getState();
      const session = current.sessions.find((item) => item.id === sessionId);
      const run = session?.run?.state === "running" ? session.run : undefined;
      const workspaceRoot = run?.checkoutRoot ?? run?.workspaceRoot ??
        session?.profile?.workspaceRoot ?? null;
      return workspacePathsEqual(current.live.getWorkspaceRoot(), workspaceRoot)
        ? current.live.getCwd() : workspaceRoot;
    },
    getWorkspaceRoot: () => {
      const session = useChatStore
        .getState()
        .sessions.find((item) => item.id === sessionId);
      const run = session?.run?.state === "running" ? session.run : undefined;
      return run?.checkoutRoot ?? run?.workspaceRoot ??
        session?.profile?.workspaceRoot ?? null;
    },
    getSessionId: () => sessionId,
    getAgentId: () => {
      const state = useChatStore.getState();
      return (
        state.sessions.find((session) => session.id === sessionId)?.run
          ?.agentId ??
        state.sessions.find((session) => session.id === sessionId)?.profile
          ?.agentId ??
        useAgentsStore.getState().activeId
      );
    },
  };
  const category = permissionCategoryForTool(toolName);
  const strict = isStrictPermissionRequest(toolName, input);
  const canPersist =
    toolName !== "bounded_command" &&
    !NATIVE_TF_EFFECTFUL_TOOLS.has(toolName) &&
    !NATIVE_TF_WEB_TOOLS.has(toolName) &&
    category !== null &&
    canPersistPermission(toolName, input, permissionContext);

  const allowScoped = async (scope: "chat" | "workspace") => {
    const granted = await grantScopedPermission(
      scope,
      toolName,
      input,
      permissionContext,
    );
    if (granted) onRespond(true);
  };

  return (
    <div className="clack-ai-block min-w-0 overflow-hidden shadow-sm [overflow-wrap:anywhere]" data-approval-session={sessionId}>
      <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-[color:var(--clack-border-subtle)] px-3 py-2">
        <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-[var(--clack-warning)]" />
        <HugeiconsIcon
          icon={Icon}
          size={13}
          strokeWidth={1.75}
          className="shrink-0 text-[var(--clack-accent)]"
        />
        <span className="min-w-0 text-[12px] font-semibold text-[var(--clack-text-1)]">
          {label}
        </span>
        <span className="ml-auto text-[10px] font-medium text-[var(--clack-warning)]">
          {strict ? "always asks" : "needs approval"}
        </span>
      </div>

      <div className="px-3 py-2.5">
        <p className="mb-1 text-[11px] text-[var(--clack-text-2)]">Requested by {ownerAgent} in {owner?.title || "this chat"}</p>
        {typeof input.path === "string" && <p className="mb-1 font-medium text-[var(--clack-text-1)] [overflow-wrap:anywhere]">Target: {input.path.split(/[\\/]/).filter(Boolean).pop() || input.path}</p>}
        <details className="mb-2 text-[10.5px] text-[var(--clack-text-2)] [overflow-wrap:anywhere]">
          <summary className="cursor-pointer">Workspace and full target</summary>
          <p>{owner?.run?.workspaceRoot ?? owner?.profile?.workspaceRoot ?? "Workspace unavailable"}</p>
          {typeof input.path === "string" && <p>{input.path}</p>}
        </details>
        <PreviewBlock toolName={toolName} input={input} />
        {toolName === "bounded_command" ? (
          <details className="mt-2 rounded-md border border-[color:var(--clack-border-subtle)] px-2 py-1.5 text-[10.5px] text-[var(--clack-text-2)]">
            <summary className="cursor-pointer font-medium">Native policy, effects and sandbox details</summary>
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 [overflow-wrap:anywhere]">
              <dt>Effect</dt><dd>{input.action === "read_status" ? "Read-only process execution" : "Local workspace write · approval required"}</dd>
              <dt>Target</dt><dd>{typeof input.cwd === "string" ? input.cwd : "Unspecified · deny"}</dd>
              <dt>Credentials</dt><dd>No plaintext credentials accepted from the model</dd>
              <dt>Sandbox</dt><dd>Native executable/argument admission, filtered environment, bounded owned Windows process tree; filesystem and network OS isolation are not implemented</dd>
              <dt>Reversibility</dt><dd>{input.action === "read_status" ? "No requested workspace modification" : "Controlled local marker; manual undo available"}</dd>
              <dt>Approval</dt><dd>Once, for this exact request only; no session/workspace broadening</dd>
            </dl>
          </details>
        ) : null}
        {NATIVE_TF_EFFECTFUL_TOOLS.has(toolName) ? (
          <details className="mt-2 rounded-md border border-[color:var(--clack-border-subtle)] px-2 py-1.5 text-[10.5px] text-[var(--clack-text-2)]">
            <summary className="cursor-pointer font-medium">Native operation, scope and effect details</summary>
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 [overflow-wrap:anywhere]">
              <dt>Operation</dt><dd>{typeof input.operation === "string" ? input.operation : "Unclassified · deny"}</dd>
              <dt>Requested path</dt><dd>{typeof input.path === "string" ? input.path : "Operation-specific repository or workspace target"}</dd>
              {typeof input.destination === "string" ? <><dt>Destination</dt><dd>{input.destination}</dd></> : null}
              <dt>Effect</dt><dd>{toolName === "tf_fs_delete" ? "Destructive workspace deletion" : toolName === "tf_repo_write" ? "Repository state mutation" : toolName === "tf_build_run" ? "Process execution; generated file effects may occur" : "Workspace file creation or modification"}</dd>
              <dt>Reversibility</dt><dd>{toolName === "tf_fs_delete" ? "Destructive · recovery not guaranteed" : "Operation dependent; no automatic replay after uncertain effects"}</dd>
              <dt>Credentials</dt><dd>No credential plaintext accepted from the model</dd>
              <dt>Sandbox</dt><dd>Native path/command scope and execution limits; filesystem and network OS isolation remain unsupported</dd>
              <dt>Approval</dt><dd>Exact request once; native user confirmation is also required, with no chat/workspace-wide grant</dd>
            </dl>
          </details>
        ) : null}
        {NATIVE_TF_WEB_TOOLS.has(toolName) ? (
          <details className="mt-2 rounded-md border border-[color:var(--clack-border-subtle)] px-2 py-1.5 text-[10.5px] text-[var(--clack-text-2)]">
            <summary className="cursor-pointer font-medium">Network scope, budgets and provider evidence</summary>
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 [overflow-wrap:anywhere]">
              <dt>Operation</dt><dd>{toolName === "tf_web_search" ? "Brave Web Search (discovery metadata, not page verification)" : toolName === "tf_http_head" ? "HTTP HEAD — metadata only" : "HTTP GET — bounded textual content"}</dd>
              <dt>Requested destination</dt><dd>{toolName === "tf_web_search" ? "https://api.search.brave.com (native-fixed)" : typeof input.searchResultId === "string" ? "Selected prior search result · origin verified in native" : previewNetworkDestination(input.url)}</dd>
              {toolName==="tf_web_search" && typeof input.query==="string" ? <><dt>Query</dt><dd>{input.query.slice(0,256)}</dd></> : null}
              <dt>Network effect</dt><dd>Public network read; remote logging, quotas and billing may occur</dd>
              <dt>Budget</dt><dd>{typeof input.timeoutMs==="number"?input.timeoutMs:15000}ms timeout · {typeof input.maxBytes==="number"?input.maxBytes:65536} maximum retained bytes · {typeof input.maxRedirects==="number"?input.maxRedirects:5} redirect limit</dd>
              <dt>DNS/redirect</dt><dd>Native per-hop IP checks and pinned DNS resolution; private/metadata destinations denied by default</dd>
              <dt>Credential</dt><dd>{toolName==="tf_web_search" ? "Existing store reference credential:brave-web-search; only fixed Brave origin, never exposed to model" : "No model-provided authentication headers"}</dd>
              <dt>Approval</dt><dd>Exact request Allow once. Credentialed search also requires OS-native confirmation</dd>
              <dt>Isolation</dt><dd>No OS-level network or filesystem sandbox; peer socket IP not independently attested</dd>
              <dt>Evidence</dt><dd>Native URL, DNS, redirect, status, hash and truncation receipts; fetched content remains untrusted</dd>
            </dl>
          </details>
        ) : null}
        <p className="mt-2 text-[11px] text-[var(--clack-text-2)]">Allow once approves only this action. Broader permissions are separate.</p>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-[color:var(--clack-border-subtle)] px-3 py-2">
        <Button
          size="sm"
          variant="destructive"
          onClick={() => respondToApprovalChoice("deny", onRespond)}
          className="h-7 gap-1.5 text-[11px]"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
          Deny
        </Button>
        <Button
          size="sm"
          variant="default"
          onClick={() => {
            if((toolName==="bounded_command" || NATIVE_TF_EFFECTFUL_TOOLS.has(toolName) || NATIVE_TF_WEB_TOOLS.has(toolName)) &&
              !recordTfApprovedToolCall({
                toolCallId:part.toolCallId,sessionId,
                agentId:permissionContext.getAgentId(),
                workspaceRoot:permissionContext.getWorkspaceRoot(),
                cwd:permissionContext.getCwd(),
                toolName,parameters:input,
              })){
              onRespond(false);
              return;
            }
            respondToApprovalChoice("once", onRespond);
          }}
          className="h-7 gap-1.5 text-[11px]"
        >
          <HugeiconsIcon icon={Tick02Icon} size={12} strokeWidth={2} />
          Allow once
        </Button>
        {canPersist ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 px-2 text-[11px]"
                aria-label="Choose permission scope"
              >
                More permissions
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  size={10}
                  strokeWidth={2}
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void allowScoped("chat")}>
                Allow for this chat
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void allowScoped("workspace")}>
                Allow for this workspace
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  );
}

export const AiToolApproval = memo(AiToolApprovalImpl, (a, b) => {
  // The approval card never changes content for a given approvalId. Once
  // the model has emitted the approval-requested part with its input, we
  // don't want to re-render on every downstream token.
  return (
    a.toolName === b.toolName &&
    a.sessionId === b.sessionId &&
    a.part.approval.id === b.part.approval.id &&
    a.onRespond === b.onRespond
  );
});

function PreviewBlock({
  toolName,
  input,
}: {
  toolName: string;
  input: Record<string, unknown>;
}) {
  if(NATIVE_TF_WEB_TOOLS.has(toolName)){
    return (
      <div className="space-y-1 rounded-[var(--clack-radius-button)] bg-[var(--clack-surface-2)] p-2 font-mono text-[10.5px] [overflow-wrap:anywhere]">
        <p>Network operation: {toolName==="tf_web_search"?"web_search":toolName==="tf_http_head"?"http_head":"http_get"}</p>
        {toolName==="tf_web_search"
          ? <p>Configured provider: Brave Web Search (native credential reference)</p>
          : <p>Destination: {typeof input.searchResultId==="string"?"Prior search result ID (native-scoped)":previewNetworkDestination(input.url)}</p>}
        <p>All targets are reauthorized by native DNS and redirect policy; this preview grants no network access.</p>
      </div>
    );
  }
  if (toolName.startsWith("tf_")) {
    const operation = typeof input.operation === "string" ? input.operation : "Unknown · deny";
    const path = typeof input.path === "string" ? input.path : null;
    const destination = typeof input.destination === "string" ? input.destination : null;
    const directory = typeof input.cwd === "string" ? input.cwd : null;
    const paths = Array.isArray(input.paths) ? input.paths.filter((value) => typeof value === "string") : [];
    const contentLength = typeof input.content === "string" ? new TextEncoder().encode(input.content).length : null;
    return (
      <div className="space-y-1 rounded-[var(--clack-radius-button)] bg-[var(--clack-surface-2)] p-2 font-mono text-[10.5px] [overflow-wrap:anywhere]">
        <p>Native operation: {operation}</p>
        {path ? <p>Source/target: {path}</p> : null}
        {destination ? <p>Destination: {destination}</p> : null}
        {paths.length ? <p>Explicit paths: {paths.length} (details in the operation receipt)</p> : null}
        {directory ? <p>Working directory: {directory}</p> : null}
        {contentLength !== null ? <p>Proposed content: {contentLength} UTF-8 bytes (content withheld here)</p> : null}
        <p>Native execution independently checks this request; preview is not authorization.</p>
      </div>
    );
  }
  if (toolName === "bounded_command") {
    return (
      <div className="space-y-1 rounded-[var(--clack-radius-button)] bg-[var(--clack-surface-2)] p-2 font-mono text-[10.5px] [overflow-wrap:anywhere]">
        <p>Action: {typeof input.action === "string" ? input.action : "Unknown"}</p>
        <p>Executable: {typeof input.executable === "string" ? input.executable.split(/[\\/]/).pop() : "Unknown"}</p>
        <p>Arguments: {Array.isArray(input.args) ? `${input.args.length} (verified by exact native allowlist)` : "Unknown · deny"}</p>
        <p>Directory: {typeof input.cwd === "string" ? input.cwd : "Unknown · deny"}</p>
      </div>
    );
  }
  if (toolName === "bash_run" || toolName === "bash_background") {
    const cwd = typeof input.cwd === "string" ? input.cwd : null;
    return (
      <div className="space-y-1.5">
        {cwd && (
          <div className="font-mono text-[10.5px] text-muted-foreground">
            {cwd}
          </div>
        )}
        <pre
          className={cn(
            "max-h-40 overflow-auto rounded-[var(--clack-radius-button)] bg-[var(--clack-surface-2)] p-2 font-mono text-[11px] leading-relaxed text-[var(--clack-text-2)]",
          )}
        >
          {String(input.command ?? "")}
        </pre>
      </div>
    );
  }
  // For file mutations we deliberately do NOT preview content here.
  // streamed write/edit content thrashes the UI and the AI diff tab is the
  // authoritative place to review the change. The target is shown above.
  if (toolName === "write_file") {
    const content = typeof input.content === "string" ? input.content : "";
    const lines = content ? content.split("\n").length : 0;
    return (
      <div className="space-y-0.5 font-mono text-[11px]">
        <div className="text-[10.5px] text-[var(--clack-text-3)]">
          {lines} line{lines === 1 ? "" : "s"} | review in the diff tab
        </div>
      </div>
    );
  }
  if (toolName === "edit") {
    const oldStr = typeof input.old_string === "string" ? input.old_string : "";
    const newStr = typeof input.new_string === "string" ? input.new_string : "";
    const removed = oldStr ? oldStr.split("\n").length : 0;
    const added = newStr ? newStr.split("\n").length : 0;
    return (
      <div className="space-y-0.5 font-mono text-[11px]">
        {input.replace_all ? <div className="text-[var(--clack-text-2)]">Replace all matches</div> : null}
        <div className="text-[10.5px] text-[var(--clack-text-3)]">
          -{removed} / +{added} line{added === 1 && removed === 1 ? "" : "s"} |
          review in the diff tab
        </div>
      </div>
    );
  }
  if (toolName === "multi_edit") {
    const edits = Array.isArray(input.edits)
      ? (input.edits as Array<{ old_string?: string; new_string?: string }>)
      : [];
    return (
      <div className="space-y-0.5 font-mono text-[11px]">
        <div className="text-[10.5px] text-[var(--clack-text-3)]">
          {edits.length} edit{edits.length === 1 ? "" : "s"} | review in the
          diff tab
        </div>
      </div>
    );
  }
  if (toolName === "create_directory") {
    return (
      <div className="font-mono text-[11px] text-[var(--clack-text-3)]">
        {String(input.path ?? "")}
      </div>
    );
  }
  return (
    <pre className="overflow-auto rounded-[var(--clack-radius-button)] bg-[var(--clack-surface-2)] p-2 font-mono text-[11px] leading-relaxed text-[var(--clack-text-2)]">
      {JSON.stringify(input, null, 2)}
    </pre>
  );
}
