import { invoke } from "@tauri-apps/api/core";
import { resolveCurrentAgentPermission } from "@/modules/ai/lib/permissions";
import type { PermissionContext } from "@/modules/ai/lib/permissions";
import type { ToolContext } from "@/modules/ai/tools/context";

export type ToolBinding =
  | { kind: "native"; operation: string }
  | { kind: "http"; url: string; method: string }
  | { kind: "script"; executable: string; argv: string[]; hash: string }
  | { kind: "function"; module: string; export: string; hash: string }
  | {
      kind: "wasi";
      schemaVersion: 1;
      hash: string;
      abi: "wasi-preview1-json-v1";
      export: "_start";
      runtime: "clack-wasi-1";
    }
  | {
      kind: "mcp";
      server: string;
      tool: string;
      connectionRevision?: number;
      discovery?: string;
      toolHash?: string;
    };
export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: unknown;
  outputSchema: unknown;
  outputDescription: string;
  binding: ToolBinding;
  scope: "agent" | "conversation" | "workspace" | "global";
  agents: string[];
  conversations: string[];
  permissions: string[];
  credentialRef: string | null;
  timeoutMs: number;
  outputBytes: number;
};
export type ToolVersion = {
  version: number;
  hash: string;
  definition: ToolDefinition;
  status: "draft" | "proposed" | "authorized" | "revoked" | "removed";
  enabled: boolean;
  source: "native-user" | "agent-proposal";
  sessionId: string;
  agentId: string;
  runId: number | null;
  createdAt: number;
};
export type ToolEntry = {
  id: string;
  workspaceId: string;
  current: ToolVersion;
  versions: ToolVersion[];
  eligible: boolean;
  executable: boolean;
  runtime: string;
};
export type ToolRegistryView = {
  schemaVersion: 1;
  revision: number;
  entries: ToolEntry[];
};
export type ToolChange =
  | { action: "create"; definition: ToolDefinition }
  | { action: "edit"; id: string; definition: ToolDefinition }
  | {
      action: "authorize" | "enable" | "disable" | "revoke" | "remove";
      id: string;
    };
export type CapturedToolVersion = { id: string; version: number; hash: string };

export const EMPTY_TOOL_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
};
export function newToolDefinition(
  agentId: string,
  sessionId: string,
): ToolDefinition {
  return {
    name: "custom_tool",
    description: "",
    inputSchema: {
      ...structuredClone(EMPTY_TOOL_SCHEMA),
      properties: { path: { type: "string", maxLength: 1024 } },
      required: ["path"],
    },
    outputSchema: { type: "string", maxLength: 8192 },
    outputDescription: "Tool result",
    binding: { kind: "native", operation: "read_file" },
    scope: "conversation",
    agents: [agentId],
    conversations: [sessionId],
    permissions: ["read-files"],
    credentialRef: null,
    timeoutMs: 30000,
    outputBytes: 65536,
  };
}
export function customToolsClient(sessionId: string) {
  return {
    load: () => invoke<ToolRegistryView>("custom_tools_load", { sessionId }),
    loadEligible: () =>
      invoke<ToolRegistryView>("custom_tools_load", {
        sessionId,
        eligibleOnly: true,
      }),
    validate: (definition: ToolDefinition) =>
      invoke<string>("custom_tools_validate", { definition }),
    importWasi: (
      expectedRevision: number,
      definition: ToolDefinition,
      toolId?: string,
    ) =>
      invoke<ToolRegistryView>("custom_tools_import_wasi", {
        sessionId,
        expectedRevision,
        definition,
        toolId: toolId ?? null,
      }),
    change: (expectedRevision: number, change: ToolChange) =>
      invoke<ToolRegistryView>("custom_tools_change", {
        sessionId,
        expectedRevision,
        change,
      }),
  };
}

// Registration eligibility never substitutes for a T2/T3 executor or its guards.
export function definitionEligibility(
  entry: ToolEntry,
  workspaceId: string,
  ctx: PermissionContext & Pick<ToolContext, "getMutationMode">,
) {
  const v = entry.current,
    d = v.definition;
  if (v.status !== "authorized" || !v.enabled)
    return {
      eligible: false,
      approval: false,
      reason: v.status === "authorized" ? "Disabled" : v.status,
    };
  if (entry.workspaceId !== workspaceId && d.scope !== "global")
    return { eligible: false, approval: false, reason: "Different workspace" };
  if (
    !d.agents.includes(ctx.getAgentId()) ||
    (d.scope === "conversation" &&
      !d.conversations.includes(ctx.getSessionId() ?? ""))
  )
    return { eligible: false, approval: false, reason: "Not assigned" };
  if (
    ctx.getMutationMode?.() === "read-only" &&
    d.permissions.some((p) => p !== "read-files")
  )
    return { eligible: false, approval: false, reason: "Read-only peer task" };
  let approval = false;
  const operations: Record<string, string> = {
    "read-files": "read_file",
    "write-files": "write_file",
    "create-files": "create_directory",
    "run-commands": "bash_run",
    network: "bash_run",
  };
  for (const permission of d.permissions) {
    const operation = operations[permission];
    if (!operation)
      return { eligible: false, approval: false, reason: "Unknown permission" };
    const decision = resolveCurrentAgentPermission(operation, {}, ctx);
    if (decision.outcome === "deny")
      return { eligible: false, approval: false, reason: "Permission denied" };
    approval ||= decision.outcome === "prompt" || permission === "network";
  }
  return {
    eligible: true,
    approval,
    reason: "Execution support pending T2/T3",
  };
}
export function captureToolVersions(
  view: ToolRegistryView,
  workspaceId: string,
  ctx: PermissionContext & Pick<ToolContext, "getMutationMode">,
): CapturedToolVersion[] {
  if (view.schemaVersion !== 1 || view.entries.length > 128)
    throw Error("Tool registry unavailable");
  return view.entries
    .filter((entry) => definitionEligibility(entry, workspaceId, ctx).eligible)
    .map((entry) => ({
      id: entry.id,
      version: entry.current.version,
      hash: entry.current.hash,
    }));
}
