import {
  customToolsClient,
  definitionEligibility,
} from "@/modules/ai/lib/customTools";
import { mcpClient } from "@/modules/ai/lib/mcpConnections";
import { resolveCurrentAgentPermission } from "@/modules/ai/lib/permissions";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { awaitSessionWrites } from "@/modules/ai/lib/sessions";

export async function loadChatToolSummary(sessionId: string) {
  const session = useChatStore
    .getState()
    .sessions.find((item) => item.id === sessionId);
  if (!session?.profile?.workspaceId || !session.profile.agentId)
    throw new Error("Conversation tool owner unavailable.");
  await awaitSessionWrites(sessionId);
  const [{ sessionToolContext }, { buildTools }] = await Promise.all([
    import("@/modules/ai/store/chatRuntime"),
    import("@/modules/ai/tools/tools"),
  ]);
  const { toolContext } = sessionToolContext(sessionId);
  const agentId = toolContext.getAgentId();
  const workspaceId = toolContext.getWorkspaceId?.() ?? "";
  const builtin = Object.keys(buildTools(toolContext)).map((name) => ({
    name,
    decision: resolveCurrentAgentPermission(name, {}, toolContext).outcome,
  }));
  const [registry, connections] = await Promise.allSettled([
    customToolsClient(sessionId).loadEligible(),
    mcpClient(sessionId).load(),
  ]);
  const custom =
    registry.status === "fulfilled"
      ? registry.value.entries.map((entry) => {
          const policy = definitionEligibility(entry, workspaceId, toolContext);
          return {
            id: entry.id,
            name: entry.current.definition.name,
            available: entry.eligible && entry.executable && policy.eligible,
            approval: policy.approval,
            status: !policy.eligible
              ? policy.reason
              : !entry.eligible
                ? "Not assigned / unavailable"
                : !entry.executable
                  ? entry.runtime
                  : "Available",
            binding: entry.current.definition.binding.kind,
          };
        })
      : null;
  return {
    agentId,
    builtin,
    custom,
    connections:
      connections.status === "fulfilled" ? connections.value.connections : null,
  };
}
