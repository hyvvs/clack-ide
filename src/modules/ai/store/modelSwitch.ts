import type { UIMessage } from "ai";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { workspacePathsEqual } from "@/modules/workspace";
import { currentWorkspaceEnv } from "@/modules/workspace/env";
import { BUILTIN_AGENTS } from "../lib/agents";
import {
  assessModelSwitch,
  knownModelContextLimit,
  type ModelSwitchAssessment,
} from "../lib/modelSwitchEligibility";
import {
  resolveModelSelectionInfo,
  resolveSavedProviderModelTarget,
} from "../lib/savedProviderModels";
import { loadMessages, workspaceEnvironmentFromId } from "../lib/sessions";
import { useAgentsStore } from "./agentsStore";
import {
  chats,
  hasKeyForModel,
  isModelSelectionLocked,
  seedMessages,
  useChatStore,
} from "./chatStore";
import { usePlanStore } from "./planStore";
import { readSelfHostedSnapshot } from "@/modules/ai/lib/selfHostedCapabilities";
import { resolveModelInputCapabilities } from "@/modules/ai/lib/modelCapabilities";
import { resolveSelfHostedSelection } from "@/modules/ai/lib/selfHostedProfiles";
import { profileBudgetLimits } from "@/modules/ai/lib/contextBudgetProfile";
import { measureRequest } from "@/modules/ai/lib/contextBudget";

type CommitResult = { ok: true } | { ok: false; reason: string };
export type PreparedModelSwitch = {
  targetLabel: string;
  assessment: ModelSwitchAssessment;
  commit: (confirmed?: boolean) => CommitResult;
};

function unavailable(reason: string): PreparedModelSwitch {
  return {
    targetLabel: "Model change",
    assessment: {
      status: "blocked",
      reasons: [reason],
      estimatedTokens: 0,
      contextLimit: null,
    },
    commit: () => ({ ok: false, reason }),
  };
}

function contextPreferences() {
  const p = usePreferencesStore.getState();
  const a = useAgentsStore.getState();
  return [
    p.customInstructions,
    p.savedProviderModels,
    p.customEndpoints,
    p.selfHostedInference,
    p.openaiCompatibleContextLimit,
    p.openaiCompatibleBaseURL,
    p.openaiCompatibleModelId,
    p.openrouterModelId,
    p.ollamaModelId,
    p.ollamaBaseURL,
    p.lmstudioModelId,
    p.lmstudioBaseURL,
    p.mlxModelId,
    p.mlxBaseURL,
    a.activeId,
    a.customAgents,
    usePlanStore.getState().active,
  ];
}

export async function prepareModelSwitch(
  sessionId: string | null,
  targetModelId: string,
  followActiveSession = false,
): Promise<PreparedModelSwitch> {
  if (isModelSelectionLocked(sessionId))
    return unavailable(
      "Model locked until this run finishes or stops completely.",
    );
  const state = useChatStore.getState();
  const session = state.sessions.find((item) => item.id === sessionId);
  const sourceModelId = session?.profile?.modelId ?? state.selectedModelId;
  const preferences = usePreferencesStore.getState();
  const capturedPreferences = contextPreferences();
  const memoryMessages = () =>
    sessionId
      ? (chats.get(sessionId)?.messages ?? seedMessages.get(sessionId))
      : undefined;
  const originalMessages = memoryMessages();
  const environment = currentWorkspaceEnv();
  const workspaceRoot = session?.profile?.workspaceRoot ?? null;
  const liveSnapshot = () => {
    const current = useChatStore.getState().live;
    const matches = workspacePathsEqual(
      workspaceRoot,
      current.getWorkspaceRoot(),
    );
    return {
      workspaceRoot,
      cwd: matches ? current.getCwd() : workspaceRoot,
      activeFile: matches ? current.getActiveFile() : null,
      terminalPrivate: matches ? current.isActiveTerminalPrivate() : true,
    };
  };
  const snapshot = liveSnapshot();
  const stillCurrent = () => {
    const now = useChatStore.getState();
    const nextPreferences = contextPreferences();
    return (
      !isModelSelectionLocked(sessionId, now) &&
      (!followActiveSession || now.activeSessionId === sessionId) &&
      (sessionId
        ? now.sessions.find((item) => item.id === sessionId) === session
        : now.activeSessionId === null &&
          now.selectedModelId === sourceModelId) &&
      memoryMessages() === originalMessages &&
      JSON.stringify(liveSnapshot()) === JSON.stringify(snapshot) &&
      capturedPreferences.every(
        (value, index) => value === nextPreferences[index],
      )
    );
  };
  try {
    const target = resolveModelSelectionInfo(
      targetModelId,
      preferences.customEndpoints,
      preferences.savedProviderModels,
      preferences.selfHostedInference,
    );
    if (!hasKeyForModel(targetModelId))
      return unavailable("Configure this model's provider before switching.");
    const messages: UIMessage[] =
      originalMessages ??
      (sessionId ? await loadMessages(sessionId) : null) ??
      [];
    const probe = await readSelfHostedSnapshot(
      preferences.selfHostedInference,
      targetModelId,
    );
    const { readProjectMemory, formatEnvBlock } = await import(
      "../lib/transport"
    );
    const { buildStableSystem, planModeSystemText } = await import(
      "../lib/agent"
    );
    const memory = await readProjectMemory(
      workspaceRoot,
      workspaceEnvironmentFromId(session?.profile?.workspaceId) ?? environment,
    );
    if (!stillCurrent())
      return unavailable(
        "The chat or model settings changed during the check. Choose the model again.",
      );
    const agents = useAgentsStore.getState();
    const persona =
      [...BUILTIN_AGENTS, ...agents.customAgents].find(
        (agent) => agent.id === (session?.profile?.agentId ?? agents.activeId),
      ) ?? BUILTIN_AGENTS[0];
    let providerChanged = true;
    try {
      providerChanged =
        resolveModelSelectionInfo(
          sourceModelId,
          preferences.customEndpoints,
          preferences.savedProviderModels,
          preferences.selfHostedInference,
        ).provider !== target.provider;
    } catch {
      /* A deleted source model must not prevent selecting a valid target. */
    }
    const hostedTarget = resolveSelfHostedSelection(
      preferences.selfHostedInference,
      targetModelId,
    );
    const { sessionToolContext } = await import(
      "@/modules/ai/store/chatRuntime"
    );
    const { serializedToolSchemas, knownTransportContextLimit } = await import(
      "@/modules/ai/lib/requestPreflight"
    );
    const { buildTools } = await import("@/modules/ai/tools/tools");
    const savedTarget = resolveSavedProviderModelTarget(
      targetModelId,
      preferences.savedProviderModels,
    );
    const savedContext = savedTarget
      ? knownTransportContextLimit(savedTarget.transportModelId)
      : undefined;
    const toolTokens = measureRequest({
      tools: await serializedToolSchemas(
        buildTools({
          ...sessionToolContext(sessionId ?? "").toolContext,
          requestConversationEvidence: () => ({
            status: "preflight",
            message: "Schema sizing only.",
          }),
        }),
      ),
    }).tools;
    if (!stillCurrent())
      return unavailable(
        "The chat or model settings changed during the check. Choose the model again.",
      );
    const assessment = assessModelSwitch({
      toolTokens,
      budgetLimits:
        hostedTarget.status === "available"
          ? profileBudgetLimits(
              preferences.selfHostedInference,
              hostedTarget.profile.id,
              probe,
            )
          : savedContext
            ? { reported: savedContext }
            : undefined,
      messages,
      targetModelId,
      contextLimit: knownModelContextLimit(
        targetModelId,
        preferences.customEndpoints,
        preferences.openaiCompatibleContextLimit,
      ),
      systemText:
        buildStableSystem(
          targetModelId,
          persona,
          preferences.customInstructions,
          memory,
        ) +
        planModeSystemText(usePlanStore.getState().active) +
        (formatEnvBlock(snapshot) ?? ""),
      providerChanged,
      capabilities: resolveModelInputCapabilities(
        targetModelId,
        preferences.selfHostedInference,
        probe,
      ),
    });
    const checkedAt = Date.now();
    return {
      targetLabel: target.label,
      assessment,
      commit: (confirmed = false) => {
        if (Date.now() - checkedAt >= 30_000)
          return {
            ok: false,
            reason:
              "This compatibility check expired. Choose the model again to recheck current context.",
          };
        if (!stillCurrent() || !hasKeyForModel(targetModelId))
          return {
            ok: false,
            reason:
              "The chat or model settings changed. Choose the model again.",
          };
        if (
          assessment.status === "blocked" ||
          (assessment.status === "warning" && !confirmed)
        )
          return { ok: false, reason: assessment.reasons[0] };
        if (sessionId) {
          if (
            !useChatStore.getState().setSessionModelId(sessionId, targetModelId)
          )
            return {
              ok: false,
              reason: "The chat is no longer available for a model change.",
            };
        } else useChatStore.getState().setSelectedModelId(targetModelId);
        return { ok: true };
      },
    };
  } catch {
    return unavailable(
      "Could not inspect the chat or target model. Nothing was changed; try again.",
    );
  }
}
