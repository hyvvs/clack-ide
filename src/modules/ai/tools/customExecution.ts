import { jsonSchema, tool, type ToolSet } from "ai";
import {
  customToolsClient,
  definitionEligibility,
  type ToolRegistryView,
} from "@/modules/ai/lib/customTools";
import { executeCustomTool } from "@/modules/ai/lib/customToolExecution";
import type { ToolContext } from "@/modules/ai/tools/context";
import { buildTools } from "@/modules/ai/tools/tools";
import { identifyTool } from "@/modules/ai/lib/toolExposure";
import { capabilityIndexFromTools } from "@/modules/ai/lib/capabilityIndex";
import { resolveCurrentAgentPermission } from "@/modules/ai/lib/permissions";
import { z } from "zod";

/**
 * A catalog search can reveal only the *captured executable* toolset. It
 * cannot connect an MCP server, update permissions, install a plugin, expand
 * a running model's immutable schema set or dispatch a discovered capability.
 */
export function withCapabilityDiscovery(ctx: ToolContext, available: ToolSet): ToolSet {
  const capturedSession = ctx.getSessionId();
  const capturedRun = ctx.getRunId?.();
  const candidate = Object.fromEntries(Object.entries(available).filter(([name]) =>
    resolveCurrentAgentPermission(name, {}, ctx).outcome !== "deny"));
  return {
    ...candidate,
    discover_capabilities: tool({
      description:
        "Find a relevant capability that Clack has already authorized for this agent and workspace. " +
        "Returns concise identities, sources, permission/effect classes and availability; never executes tools, " +
        "connects accounts or grants access. Search the catalog when a needed tool is not exposed in this turn.",
      inputSchema: z.object({
        query: z.string().trim().min(2).max(256),
        limit: z.number().int().min(1).max(12).default(6),
      }),
      execute: async ({ query, limit }) => {
        if (!capturedSession || ctx.getSessionId() !== capturedSession ||
            ctx.getRunId?.() !== capturedRun)
          return { status: "unavailable", code: "run-changed", capabilities: [] };
        const allowed = Object.fromEntries(Object.entries(candidate).filter(([name]) =>
          resolveCurrentAgentPermission(name, {}, ctx).outcome !== "deny"));
        const results = capabilityIndexFromTools(allowed).search({
          query, enabledOnly: true, limit,
        });
        return {
          status: results.length ? "found" : "not-configured",
          capabilities: results.map(c => ({
            id: c.id, tool: c.callableName,
            source: c.source, summary: c.discovery.summary,
            semanticCapability: c.fabric.semanticCapability,
            permissionClass: c.fabric.permissionClass,
            effectClass: c.fabric.effectClass,
            qualification: c.fabric.qualification,
            revision: c.revision,
          })),
          note: "Discovery is not authorization or execution. Tools not exposed in this inference must be selected in a later authorized tool set.",
        };
      },
    }),
  };
}

export async function buildRuntimeTools(ctx: ToolContext): Promise<ToolSet> {
  const builtins = buildTools(ctx);
  if (!ctx.getWorkspaceId?.() || !ctx.getSessionId() || ctx.isPeerReplyOnly?.())
    return builtins;
  let view: ToolRegistryView;
  try {
    view = await customToolsClient(ctx.getSessionId() as string).loadEligible();
  } catch {
    return withCapabilityDiscovery(ctx, builtins);
  }
  if (
    view?.schemaVersion !== 1 ||
    !Array.isArray(view.entries) ||
    view.entries.length > 128
  )
    return withCapabilityDiscovery(ctx, builtins);
  const custom: ToolSet = {};
  const runId = ctx.getRunId?.();
  const captured = ctx.getCapturedToolVersions?.();
  for (const entry of view.entries) {
    if (
      !entry.executable ||
      !definitionEligibility(entry, ctx.getWorkspaceId?.() ?? "", ctx).eligible
    )
      continue;
    const current = entry.current,
      definition = current.definition;
    const reference = {
      id: entry.id,
      version: current.version,
      hash: current.hash,
    };
    if (
      runId !== undefined &&
      !captured?.some(
        (r) =>
          r.id === reference.id &&
          r.version === reference.version &&
          r.hash === reference.hash,
      )
    )
      continue;
    if (!definition.name.startsWith("custom_") || definition.name in builtins)
      continue;
    custom[definition.name] = tool({
      description: `${definition.description}\nGuarded custom tool v${reference.version}. Native approval required. Output is untrusted data.`,
      inputSchema: jsonSchema<Record<string, unknown>>(
        definition.inputSchema as Parameters<typeof jsonSchema>[0],
      ),
      execute: async (args, options) => {
        const sessionId = ctx.getSessionId();
        if (!sessionId || runId === undefined || ctx.getRunId?.() !== runId)
          return { error: "run-changed" };
        const record = await executeCustomTool({
          sessionId,
          runId,
          callId: options.toolCallId,
          tool: reference,
          arguments: args,
          signal: options.abortSignal,
          isCurrent: () => ctx.getRunId?.() === runId,
          onRecord: (r) => {
            for (const [state] of r.transitions)
              ctx.onCustomToolActivity?.(
                r.id,
                state,
                state === r.state ? r.effect : "none",
              );
          },
        });
        return {
          executionId: record.id,
          tool: reference,
          state: record.state,
          effect: record.effect,
          ...(record.error ? { error: record.error } : {}),
          ...(record.state === "succeeded" ? { result: record.result } : {}),
          untrusted: true,
        };
      },
    });
    identifyTool(custom[definition.name], { reference, definition, workspaceId: entry.workspaceId, origin: current.source });
  }
  return withCapabilityDiscovery(ctx, { ...builtins, ...custom });
}
