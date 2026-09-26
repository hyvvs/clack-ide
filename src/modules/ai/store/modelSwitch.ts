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
  recordSelectedModelUse,
} from "./chatStore";
import { usePlanStore } from "./planStore";
import { readSelfHostedSnapshot } from "@/modules/ai/lib/selfHostedCapabilities";
import { resolveModelInputCapabilities } from "@/modules/ai/lib/modelCapabilities";
import { resolveSelfHostedSelection } from "@/modules/ai/lib/selfHostedProfiles";
import { profileBudgetLimits } from "@/modules/ai/lib/contextBudgetProfile";
import {
  ContextBudgetError,
  measureRequest,
} from "@/modules/ai/lib/contextBudget";
import {
  beginInference,
  hasOtherSessionInference,
  type InferenceScope,
} from "@/modules/ai/lib/inferenceLifecycle";
import type { prepareTarget } from "@/modules/ai/store/targetPreparation";
import { SwitchConsentRequired } from "@/modules/ai/lib/targetContext";
import { applyCommittedModelSwitch } from "@/modules/ai/store/modelSwitchSync";

type CommitResult = { ok: true } | { ok: false; reason: string };
export type PreparedModelSwitch = {
  targetLabel: string;
  assessment: ModelSwitchAssessment;
  commit: (confirmed?: boolean) => Promise<CommitResult>;
  dispose?: () => void;
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
    commit: async () => ({ ok: false, reason }),
  };
}

function switchFailure(error: unknown): string {
  if (
    error instanceof ContextBudgetError ||
    error instanceof SwitchConsentRequired
  )
    return error.message;
  if (error instanceof Error && error.name === "AbortError")
    return "Model preparation cancelled. Nothing was changed.";
  const code = String(error).match(
    /\b(?:target_context|memory|scoped_evidence)_[a-z_]+\b/,
  )?.[0];
  return `Could not prepare the conversation or target model${code ? ` (${code})` : ""}. Nothing was changed; recheck the model settings and source evidence.`;
}

function contextPreferences() {
  const p = usePreferencesStore.getState();
  const a = useAgentsStore.getState();
  return [
    p.customInstructions,
    p.agentPermissionProfiles,
    p.agentWorkspacePermissions,
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
  externalSignal?: AbortSignal,
): Promise<PreparedModelSwitch> {
  const controller = new AbortController();
  const signal = externalSignal
    ? AbortSignal.any([controller.signal, externalSignal])
    : controller.signal;
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
  const originalJson = JSON.stringify(originalMessages);
  const scope: InferenceScope = {
    sessionId: sessionId ?? "new-chat",
    runId: crypto.randomUUID(),
    isCurrent: () => stillCurrent(),
  };
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
      !signal.aborted &&
      (sessionId
        ? !hasOtherSessionInference(sessionId, scope.runId) &&
          now.sessions.find((item) => item.id === sessionId)?.run?.state !==
            "running" &&
          !["submitted", "streaming"].includes(
            chats.get(sessionId)?.status ?? "",
          )
        : true) &&
      (!followActiveSession || now.activeSessionId === sessionId) &&
      (sessionId
        ? now.sessions.find((item) => item.id === sessionId) === session
        : now.activeSessionId === null &&
          now.selectedModelId === sourceModelId) &&
      memoryMessages() === originalMessages &&
      JSON.stringify(memoryMessages()) === originalJson &&
      now.apiKeys === state.apiKeys &&
      now.customEndpointKeys === state.customEndpointKeys &&
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
    const toolSchemas = await serializedToolSchemas(
      buildTools({
        ...sessionToolContext(sessionId ?? "").toolContext,
        requestConversationEvidence: () => ({
          status: "preflight",
          message: "Schema sizing only.",
        }),
      }),
    );
    const toolTokens = measureRequest({ tools: toolSchemas }).tools;
    const requiresTools = toolSchemas.length > 0;
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
    const capabilities = resolveModelInputCapabilities(
      targetModelId,
      preferences.selfHostedInference,
      probe,
    );
    const system = [
      {
        role: "system" as const,
        content: buildStableSystem(
          targetModelId,
          persona,
          preferences.customInstructions,
          memory,
        ),
      },
      ...(usePlanStore.getState().active
        ? [{ role: "system" as const, content: planModeSystemText(true) }]
        : []),
    ];
    const check = () => {
      signal.throwIfAborted();
      if (!stillCurrent() || !hasKeyForModel(targetModelId))
        throw new Error(
          "The chat, credentials or model settings changed. Choose the model again.",
        );
    };
    let prepared: Awaited<ReturnType<typeof prepareTarget>> | undefined;
    let needsConsent = false;
    const optimize = async (allowInference: boolean) => {
      if (!session) return;
      check();
      const lease = beginInference(scope, () => controller.abort());
      try {
        const { prepareTarget } = await import(
          "@/modules/ai/store/targetPreparation"
        );
        check();
        prepared = await prepareTarget({
          session,
          modelId: targetModelId,
          originals: messages,
          system,
          environment: formatEnvBlock(snapshot) ?? "",
          capabilities,
          scope,
          signal,
          allowInference,
          check,
        });
        check();
        assessment.estimatedTokens =
          prepared.budget.cost.system +
          prepared.budget.cost.tools +
          prepared.budget.cost.conversation;
        assessment.contextLimit = prepared.budget.ceiling;
        assessment.workingBudget = prepared.budget.working;
        assessment.details = prepared.details;
      } finally {
        lease.settle();
      }
    };
    const sizeReason =
      "This conversation is too large for this model's context window.";
    assessment.reasons = assessment.reasons.filter(
      (reason) =>
        reason !== sizeReason &&
        !reason.startsWith("This conversation approaches"),
    );
    if (requiresTools && capabilities.tools === "unsupported")
      assessment.reasons.unshift(
        "The selected model cannot use this agent's required tools.",
      );
    if (
      messages.some((m) =>
        m.parts.some(
          (p) =>
            (p.type === "file" && p.mediaType.startsWith("image/")) ||
            (p.type === "data-clack-attachment" &&
              (p.data as { contentKind?: string })?.contentKind === "image"),
        ),
      )
    )
      return unavailable(
        "Image context accounting is not verified for model switching. The transcript and selected model are unchanged.",
      );
    const otherBlocked = assessment.blockingReasons?.some(
      (reason) => reason !== sizeReason,
    );
    if (session && requiresTools && capabilities.tools === "unknown")
      assessment.reasons.push(
        "Tool support is unconfirmed for this endpoint. Preparation cannot verify server-side tool execution.",
      );
    if (
      !otherBlocked &&
      !(requiresTools && capabilities.tools === "unsupported")
    ) {
      try {
        await optimize(false);
      } catch (error) {
        prepared?.dispose();
        if (!(error instanceof SwitchConsentRequired))
          return {
            targetLabel: target.label,
            assessment: {
              ...assessment,
              status: "blocked",
              reasons: [switchFailure(error)],
            },
            commit: async () => ({ ok: false, reason: switchFailure(error) }),
          };
        needsConsent = true;
        assessment.reasons.push(error.message);
        assessment.details = [
          "Original user requirements, recent turns and required tool pairs remain protected.",
          "Preparation is bounded to four source chunks, 256 KiB per source chunk, 4,096 generated tokens and 120 seconds, including validation retries.",
          "Cost is unknown until provider usage is reported. Provider caches and hidden reasoning do not transfer.",
        ];
      }
      assessment.status = assessment.reasons.length ? "warning" : "compatible";
    } else assessment.status = "blocked";
    const checkedAt = Date.now();
    return {
      targetLabel: target.label,
      assessment,
      dispose: () => {
        controller.abort();
        prepared?.dispose();
      },
      commit: async (confirmed = false) => {
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
        let lease: ReturnType<typeof beginInference> | undefined;
        try {
          if (needsConsent) await optimize(true);
          check();
          if (sessionId) {
            lease = beginInference(scope, () => controller.abort());
            if (!prepared)
              throw new Error("Target context preparation is unavailable.");
            const saved = await prepared.commit();
            applyCommittedModelSwitch(saved);
            recordSelectedModelUse(targetModelId);
          } else useChatStore.getState().setSelectedModelId(targetModelId);
          return { ok: true };
        } catch (error) {
          return { ok: false, reason: switchFailure(error) };
        } finally {
          lease?.settle();
          prepared?.dispose();
        }
      },
    };
  } catch (error) {
    return unavailable(switchFailure(error));
  }
}
