import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  setAgentWorkspacePermissions,
  type AgentWorkspacePermission,
} from "@/modules/settings/store";
import {
  currentWorkspaceEnv,
  workspaceScopeKey,
} from "@/modules/workspace";
import type { ToolContext } from "@/modules/ai/tools/context";

export type PermissionContext = Pick<
  ToolContext,
  "getAgentId" | "getCwd" | "getWorkspaceRoot" | "getSessionId"
>;

export type PermissionCategory =
  | "write-files"
  | "create-files"
  | "run-commands"
  | "delegate-runs";

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
};

export const PERMISSION_CATEGORIES = Object.keys(
  PERMISSION_CATEGORY_LABELS,
) as PermissionCategory[];

const TOOL_CATEGORIES: Readonly<Record<string, PermissionCategory>> = {
  write_file: "write-files",
  edit: "write-files",
  multi_edit: "write-files",
  create_directory: "create-files",
  bash_run: "run-commands",
  bash_background: "run-commands",
  request_peer_task: "delegate-runs",
};

const chatGrants = new Map<string, Set<PermissionCategory>>();

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
  if (isStrictPermissionRequest(toolName, input)) return false;
  const category = permissionCategoryForTool(toolName);
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
}

export function clearAllChatPermissionsForTests(): void {
  chatGrants.clear();
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
): AgentPermissionDecision {
  const agentId = ctx.getAgentId();
  const preferences = usePreferencesStore.getState();
  return resolveAgentPermission({
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
>(tools: TTools, ctx: ToolContext): TTools {
  const wrapped = {} as TTools;
  for (const [toolName, definition] of Object.entries(
    tools as Record<string, RuntimeTool>,
  )) {
    const originalExecute = definition.execute;
    const next: RuntimeTool = {
      ...definition,
      needsApproval: (input) =>
        resolveCurrentAgentPermission(
          toolName,
          (input ?? {}) as Record<string, unknown>,
          ctx,
        ).outcome === "prompt",
    };
    if (originalExecute) {
      next.execute = async (input, options) => {
        const decision = resolveCurrentAgentPermission(
          toolName,
          (input ?? {}) as Record<string, unknown>,
          ctx,
        );
        if (decision.outcome === "deny") {
          return {
            error: `Tool '${toolName}' is blocked by the active agent's Chat Only permission profile.`,
            code: "agent_permission_denied",
            permissionSource: decision.source,
          };
        }
        return originalExecute(input, options);
      };
    }
    (wrapped as Record<string, RuntimeTool>)[toolName] = next;
  }
  return wrapped;
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
