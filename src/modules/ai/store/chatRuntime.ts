import { Chat, type UIMessage } from "@ai-sdk/react";
import {
  type ChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import {
  endpointIdFromCompatModel,
  getProvider,
  isCompatModelId,
  resolveModel,
} from "../config";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { workspacePathsEqual } from "@/modules/workspace";
import { currentWorkspaceEnv } from "@/modules/workspace/env";
import { BUILTIN_AGENTS } from "../lib/agents";
import { TERAX_CMD_RE } from "../lib/slashCommands";
import { useAgentsStore } from "./agentsStore";
import { usePlanStore } from "./planStore";
import { createContextAwareTransport } from "../lib/transport";
import {
  describeAiErrorShape,
  normalizeAiError,
  normalizeAiStreamPartError,
  safeAiErrorLog,
  type AiErrorContext,
  type NormalizedAiError,
} from "../lib/errors";
import type { ProviderRetryEvent } from "../lib/providerRetry";
import { findSavedProviderModel } from "../lib/savedProviderModels";
import {
  loadMessages,
  workspaceEnvironmentFromId,
  awaitSessionWrites,
} from "../lib/sessions";
import type { ToolContext } from "../tools/tools";
import {
  chats,
  getAgentMeta,
  hasKeyForModel,
  capturedSelfHostedRuns,
  inferenceScopeForSession,
  recordSelectedModelUse,
  seedMessages,
  touchChat,
  useChatStore,
  persistCompactionSource,
  chargeCompactionCall,
} from "./chatStore";

export function sessionToolContext(sessionId: string) {
  const readCache = new Map<string, { size: number; hash: number }>();
  const owner = () =>
    useChatStore
      .getState()
      .sessions.find((session) => session.id === sessionId);
  const ownerWorkspaceRoot = () =>
    owner()?.run?.checkoutRoot ??
    owner()?.run?.workspaceRoot ??
    owner()?.profile?.workspaceRoot ??
    null;
  const foregroundMatchesOwner = () =>
    workspacePathsEqual(
      useChatStore.getState().live.getWorkspaceRoot(),
      ownerWorkspaceRoot(),
    );
  const toolContext: ToolContext = {
    getCwd: () =>
      foregroundMatchesOwner()
        ? useChatStore.getState().live.getCwd()
        : ownerWorkspaceRoot(),
    getWorkspaceRoot: ownerWorkspaceRoot,
    getWorkspaceId: () =>
      owner()?.run?.checkoutId ??
      owner()?.run?.workspaceId ??
      owner()?.profile?.workspaceId ??
      null,
    getMutationMode: () => owner()?.run?.mutationMode ?? "shared-write",
    getWorkspaceEnv: () =>
      owner()?.run?.workspaceEnvironment ??
      workspaceEnvironmentFromId(owner()?.profile?.workspaceId) ??
      currentWorkspaceEnv(),
    onWorkspaceWriteWait: ({ agentId }) => {
      const name =
        [...BUILTIN_AGENTS, ...useAgentsStore.getState().customAgents].find(
          (agent) => agent.id === agentId,
        )?.name ?? "another agent";
      useChatStore.getState().patchAgentMeta(sessionId, {
        step: `Waiting for ${name} to finish writing in this workspace...`,
      });
    },
    onWorkspaceWriteAcquired: (waited) => {
      if (!waited) return;
      useChatStore.getState().patchAgentMeta(sessionId, {
        step: "Workspace write access acquired.",
      });
    },
    getTerminalContext: () =>
      foregroundMatchesOwner()
        ? useChatStore.getState().live.getTerminalContext()
        : null,
    isActiveTerminalPrivate: () =>
      foregroundMatchesOwner()
        ? useChatStore.getState().live.isActiveTerminalPrivate()
        : true,
    injectIntoActivePty: (text) =>
      foregroundMatchesOwner() &&
      useChatStore.getState().live.injectIntoActivePty(text),
    openPreview: (url) => useChatStore.getState().live.openPreview(url),
    spawnAgent: (prompt) =>
      foregroundMatchesOwner()
        ? useChatStore.getState().live.spawnManagedAgent(prompt, sessionId)
        : null,
    readAgentOutput: (leafId) =>
      useChatStore.getState().live.readLeafBuffer(leafId),
    readCache,
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

  return { toolContext, owner, ownerWorkspaceRoot, foregroundMatchesOwner };
}

function makeChat(sessionId: string): Chat<UIMessage> {
  let pendingTerminalStreamError: unknown;
  const { toolContext, owner, ownerWorkspaceRoot, foregroundMatchesOwner } =
    sessionToolContext(sessionId);

  const transport = createContextAwareTransport({
    prepareCompactionContext: async (messages) => {
      const session = owner();
      const run = session?.run;
      if (!session || !run || run.state !== "running")
        throw new Error("No active conversation run for context preparation.");
      const originals = JSON.parse(JSON.stringify(messages)) as UIMessage[];
      await persistCompactionSource(sessionId, originals);
      return {
        owner: { sessionId, workspaceId: session.profile?.workspaceId ?? null },
        originals,
        ready: () => awaitSessionWrites(sessionId),
        remainingCalls: () => {
          const current = owner()?.run;
          return current?.state === "running" &&
            current.startedAt === run.startedAt &&
            current.budget
            ? Math.max(
                0,
                current.budget.hardStepLimit - current.budget.totalSteps,
              )
            : 0;
        },
        chargeCall: () => chargeCompactionCall(sessionId, run.startedAt),
      };
    },
    onOptimized: (optimized) => {
      useChatStore
        .getState()
        .patchAgentMeta(sessionId, {
          compactionNotice: { droppedCount: 0, optimized, at: Date.now() },
        });
    },
    getInferenceScope: () => inferenceScopeForSession(sessionId),
    getKeys: () =>
      capturedSelfHostedRuns.get(sessionId)?.keys ??
      useChatStore.getState().apiKeys,
    toolContext,
    getModelId: () => {
      const state = useChatStore.getState();
      return (
        state.sessions.find((session) => session.id === sessionId)?.run
          ?.modelId ?? state.selectedModelId
      );
    },
    getCustomInstructions: () =>
      usePreferencesStore.getState().customInstructions,
    getAgentPersona: () => {
      const { activeId, customAgents } = useAgentsStore.getState();
      const session = owner();
      const conversationAgentId =
        session?.run?.agentId ?? session?.profile?.agentId;
      const all = [...BUILTIN_AGENTS, ...customAgents];
      const a =
        all.find((agent) => agent.id === (conversationAgentId ?? activeId)) ??
        BUILTIN_AGENTS[0];
      return { name: a.name, instructions: a.instructions };
    },
    getLive: () => {
      const live = useChatStore.getState().live;
      const workspaceRoot = ownerWorkspaceRoot();
      const matches = foregroundMatchesOwner();
      return {
        cwd: matches ? live.getCwd() : workspaceRoot,
        terminalPrivate: matches ? live.isActiveTerminalPrivate() : true,
        workspaceRoot,
        activeFile: matches ? live.getActiveFile() : null,
      };
    },
    getPlanMode: () => usePlanStore.getState().active,
    getLmstudioBaseURL: () => usePreferencesStore.getState().lmstudioBaseURL,
    getLmstudioModelId: () => usePreferencesStore.getState().lmstudioModelId,
    getMlxBaseURL: () => usePreferencesStore.getState().mlxBaseURL,
    getMlxModelId: () => usePreferencesStore.getState().mlxModelId,
    getOllamaBaseURL: () => usePreferencesStore.getState().ollamaBaseURL,
    getOllamaModelId: () => usePreferencesStore.getState().ollamaModelId,
    getOpenaiCompatibleBaseURL: () =>
      usePreferencesStore.getState().openaiCompatibleBaseURL,
    getOpenaiCompatibleModelId: () =>
      usePreferencesStore.getState().openaiCompatibleModelId,
    getOpenaiCompatibleContextLimit: () =>
      usePreferencesStore.getState().openaiCompatibleContextLimit,
    getOpenrouterModelId: () =>
      usePreferencesStore.getState().openrouterModelId,
    getSavedProviderModels: () =>
      usePreferencesStore.getState().savedProviderModels,
    getCapturedModelIdentity: () => {
      const run = owner()?.run;
      if (!run?.providerId || !run.transportModelId) return undefined;
      return {
        providerId: run.providerId,
        transportModelId: run.transportModelId,
        ...(run.selfHosted ? { selfHosted: run.selfHosted } : {}),
        ...(run.endpointBaseURL
          ? { endpointBaseURL: run.endpointBaseURL }
          : {}),
        ...(run.customEndpointId
          ? { customEndpointId: run.customEndpointId }
          : {}),
      };
    },
    getCustomEndpoints: () => usePreferencesStore.getState().customEndpoints,
    getSelfHostedInference: () =>
      capturedSelfHostedRuns.get(sessionId)?.profiles ??
      usePreferencesStore.getState().selfHostedInference,
    getCustomEndpointKeys: () =>
      capturedSelfHostedRuns.get(sessionId)?.endpointKeys ??
      useChatStore.getState().customEndpointKeys,
    onBatchStart: () => {
      pendingTerminalStreamError = undefined;
      return useChatStore.getState().startRunBatch(sessionId);
    },
    onStep: (step) => {
      useChatStore.getState().patchAgentMeta(sessionId, { step });
    },
    onRunStep: (observation) => {
      useChatStore.getState().recordRunStep(sessionId, observation);
    },
    onCompact: (info) => {
      useChatStore.getState().patchAgentMeta(sessionId, {
        compactionNotice: { droppedCount: info.droppedCount, at: Date.now() },
      });
    },
    onFinishMeta: (info) => {
      useChatStore.getState().recordRunBatch(sessionId, {
        steps: info.steps,
        hitSoftLimit: info.hitStepCap,
        finishReason: info.finishReason,
      });
    },
    onUsage: (delta) => {
      const cur = getAgentMeta(sessionId).tokens;
      useChatStore.getState().patchAgentMeta(sessionId, {
        tokens: {
          inputTokens: cur.inputTokens + delta.inputTokens,
          outputTokens: cur.outputTokens + delta.outputTokens,
          cachedInputTokens: cur.cachedInputTokens + delta.cachedInputTokens,
        },
        lastInputTokens: delta.lastInputTokens,
        lastCachedTokens: delta.lastCachedTokens,
      });
    },
    onProviderRetry: (event) => recordProviderRetry(sessionId, event),
    onProviderRecovered: () =>
      useChatStore.getState().clearProviderRetry(sessionId),
    onError: (error) => {
      const streamError = normalizeAiStreamPartError(
        error,
        currentAiErrorContext(sessionId),
      );
      if (streamError.error.disposition === "terminal") {
        pendingTerminalStreamError = error;
      }
      return streamError.text;
    },
  }) as unknown as ChatTransport<UIMessage>;

  const initialMessages = seedMessages.get(sessionId);
  seedMessages.delete(sessionId);

  return new Chat<UIMessage>({
    id: sessionId,
    transport,
    messages: initialMessages,
    sendAutomaticallyWhen: ({ messages }) =>
      shouldAutomaticallySendSession(sessionId, messages),
    onError: (e) => {
      recordTerminalAiFailure(sessionId, pendingTerminalStreamError ?? e);
      pendingTerminalStreamError = undefined;
    },
  });
}

export async function prepareSessionChat(sessionId: string): Promise<void> {
  if (!chats.has(sessionId) && !seedMessages.has(sessionId)) {
    const messages = await loadMessages(sessionId);
    if (messages && messages.length > 0 && !chats.has(sessionId)) {
      seedMessages.set(sessionId, messages);
    }
  }
  getOrCreateChat(sessionId);
}

function recordTerminalAiFailure(
  sessionId: string,
  error: unknown,
): NormalizedAiError {
  const upstreamShape = import.meta.env.DEV
    ? describeAiErrorShape(error)
    : undefined;
  const normalized = normalizeAiError(error, {
    ...currentAiErrorContext(sessionId),
    disposition: "terminal",
  });
  const state = useChatStore.getState();
  const runState = state.sessions.find((session) => session.id === sessionId)
    ?.run?.state;
  const canTerminalize =
    runState === "running" &&
    normalized.kind !== "cancelled" &&
    normalized.kind !== "interrupted";
  if (canTerminalize) {
    state.finishRun(sessionId, "failed", normalized);
  }
  if (import.meta.env.DEV && canTerminalize) {
    console.error("[clack] AI run failed", {
      ...safeAiErrorLog(normalized),
      upstreamShape,
    });
  }
  return normalized;
}

function recordProviderRetry(
  sessionId: string,
  event: ProviderRetryEvent,
): void {
  const normalized = normalizeAiError(event.error, {
    ...currentAiErrorContext(sessionId),
    disposition: "retrying",
  });
  useChatStore.getState().setProviderRetry(sessionId, {
    error: normalized,
    retryNumber: event.retryNumber,
    maxRetries: event.maxRetries,
  });
}

function currentAiErrorContext(sessionId: string): AiErrorContext {
  const state = useChatStore.getState();
  const session = state.sessions.find((item) => item.id === sessionId);
  const selectedModelId = session?.run?.modelId ?? state.selectedModelId;
  const preferences = usePreferencesStore.getState();
  const customEndpoints = preferences.customEndpoints;
  let provider: string | undefined;
  let model: string | undefined;
  let endpoint: string | undefined;

  if (session?.run?.providerId && session.run.transportModelId) {
    provider = getProvider(session.run.providerId).label;
    model = session.run.transportModelId;
    endpoint =
      session.run.endpointBaseURL ??
      (session.run.providerId === "openrouter"
        ? "https://openrouter.ai/api/v1"
        : undefined);
    return { provider, model, endpoint };
  }

  const saved = findSavedProviderModel(
    selectedModelId,
    preferences.savedProviderModels,
  );
  if (saved) {
    provider = getProvider(saved.providerId).label;
    model = saved.transportModelId;
    if (saved.providerId === "openrouter") {
      endpoint = "https://openrouter.ai/api/v1";
    }
    return { provider, model, endpoint };
  }

  if (isCompatModelId(selectedModelId)) {
    const endpointId = endpointIdFromCompatModel(selectedModelId);
    const custom = customEndpoints.find((entry) => entry.id === endpointId);
    provider = custom?.name || "Custom endpoint";
    model = custom?.modelId || selectedModelId;
    endpoint = custom?.baseURL;
    return { provider, model, endpoint };
  }

  try {
    const info = resolveModel(selectedModelId, customEndpoints);
    provider = getProvider(info.provider).label;
    model = info.id;
    if (info.id === "lmstudio-local") {
      model = preferences.lmstudioModelId || info.id;
      endpoint = preferences.lmstudioBaseURL;
    } else if (info.id === "mlx-local") {
      model = preferences.mlxModelId || info.id;
      endpoint = preferences.mlxBaseURL;
    } else if (info.id === "ollama-local") {
      model = preferences.ollamaModelId || info.id;
      endpoint = preferences.ollamaBaseURL;
    } else if (info.id === "openai-compatible-custom") {
      model = preferences.openaiCompatibleModelId || info.id;
      endpoint = preferences.openaiCompatibleBaseURL;
    } else if (info.id === "openrouter-custom") {
      model = preferences.openrouterModelId || info.id;
      endpoint = "https://openrouter.ai/api/v1";
    }
  } catch {
    model = selectedModelId;
  }
  return { provider, model, endpoint };
}

export function getOrCreateChat(sessionId: string): Chat<UIMessage> {
  const existing = chats.get(sessionId);
  if (existing) {
    touchChat(sessionId, existing);
    return existing;
  }
  const c = makeChat(sessionId);
  touchChat(sessionId, c);
  return c;
}

export type SessionChatMessage = Parameters<Chat<UIMessage>["sendMessage"]>[0];

export function shouldAutomaticallySendSession(
  sessionId: string,
  messages: UIMessage[],
): boolean {
  const state = useChatStore.getState().sessions.find((s) => s.id === sessionId)
    ?.run?.state;
  if (state === "cancelled" || state === "interrupted" || state === "failed")
    return false;
  return (
    lastAssistantMessageIsCompleteWithApprovalResponses({ messages }) ||
    useChatStore.getState().consumeAutoContinuation(sessionId)
  );
}

function commandNameFromMessage(
  message: SessionChatMessage,
): string | undefined {
  const candidate = message as {
    text?: string;
    parts?: Array<{ type?: string; text?: string }>;
  };
  const text =
    candidate.text ??
    candidate.parts?.find((part) => part.type === "text")?.text ??
    "";
  return TERAX_CMD_RE.exec(text)?.[1];
}

export async function sendMessageToSession(
  sessionId: string,
  message: SessionChatMessage,
  options?: {
    peerTaskId?: string;
    checkoutId?: string;
    checkoutRoot?: string;
    mutationMode?: "read-only" | "shared-write" | "isolated-worktree";
    workspaceEnvironment?: import("@/modules/workspace/env").WorkspaceEnv;
  },
): Promise<void> {
  const store = useChatStore.getState();
  const profileModel = store.sessions.find(
    (session) => session.id === sessionId,
  )?.profile?.modelId;
  if (!profileModel || !hasKeyForModel(profileModel)) {
    throw new Error("This chat's model is unavailable or not configured.");
  }
  const started = store.beginRun(
    sessionId,
    commandNameFromMessage(message),
    options,
  );
  if (!started.ok) throw new Error(started.reason);
  const runModel = useChatStore
    .getState()
    .sessions.find((session) => session.id === sessionId)?.run?.modelId;
  if (runModel) recordSelectedModelUse(runModel);
  try {
    const chat = getOrCreateChat(sessionId);
    await chat.sendMessage(message);
    // SDK sendMessage settles after onError; a peer refusal must not become a completed task.
    if (options?.peerTaskId && chat.error) throw chat.error;
  } catch (error) {
    recordTerminalAiFailure(sessionId, error);
    throw error;
  }
}

export async function sendMessage(text: string): Promise<boolean> {
  const state = useChatStore.getState();
  const sessionId = state.activeSessionId;
  if (!sessionId) return false;
  const profileModel = state.sessions.find(
    (session) => session.id === sessionId,
  )?.profile?.modelId;
  if (!profileModel || !hasKeyForModel(profileModel)) return false;
  const c = getOrCreateChat(sessionId);
  const started = state.beginRun(sessionId, commandNameFromMessage({ text }));
  if (!started.ok) return false;
  const runModel = useChatStore
    .getState()
    .sessions.find((session) => session.id === sessionId)?.run?.modelId;
  if (runModel) recordSelectedModelUse(runModel);
  try {
    await c.sendMessage({ text });
  } catch (error) {
    recordTerminalAiFailure(sessionId, error);
    throw error;
  }
  return true;
}

export async function continueActiveRun(
  allowHardLimit = false,
): Promise<boolean> {
  const sessionId = useChatStore.getState().activeSessionId;
  if (!sessionId) return false;
  return continueRun(sessionId, allowHardLimit);
}

export async function continueRun(
  sessionId: string,
  allowHardLimit = false,
): Promise<boolean> {
  const state = useChatStore.getState();
  if (!state.resumeRun(sessionId, allowHardLimit)) return false;
  try {
    await getOrCreateChat(sessionId).sendMessage();
  } catch (error) {
    recordTerminalAiFailure(sessionId, error);
    throw error;
  }
  return true;
}
