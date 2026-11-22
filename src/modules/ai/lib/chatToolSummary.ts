import {
  customToolsClient,
  definitionEligibility,
} from "@/modules/ai/lib/customTools";
import { mcpClient } from "@/modules/ai/lib/mcpConnections";
import { resolveCurrentAgentPermission, resolveCurrentToolFabricDecision } from "@/modules/ai/lib/permissions";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { awaitSessionWrites } from "@/modules/ai/lib/sessions";
import { capabilityIndexFromTools } from "@/modules/ai/lib/capabilityIndex";

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
  const currentTools = buildTools(toolContext);
  const indexed = capabilityIndexFromTools(currentTools);
  const builtin = Object.keys(currentTools).map((name) => {
    const record=indexed.callable(name);
    const policy=resolveCurrentToolFabricDecision(name,{},toolContext,
      record?.security,"exposure");
    return {
      name,
      decision: resolveCurrentAgentPermission(name, {}, toolContext,
        record?.security,"exposure").outcome,
      semanticCapability: record?.fabric.semanticCapability ?? name,
      effectClass: record?.fabric.effectClass ?? "unknown",
      permissionClass: record?.fabric.permissionClass ?? "sensitive",
      policyDecision:policy.decision,
      policyReason:policy.reasonCode,
      effects:record?.security.effects ?? ["unknown"],
      provenance:record?.security.provenance ?? "unknown",
    };
  });
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
    readOnly: toolContext.getMutationMode?.() === "read-only",
    builtin,
    custom,
    connections:
      connections.status === "fulfilled" ? connections.value.connections : null,
  };
}
