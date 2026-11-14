import { Chat, type UIMessage } from "@ai-sdk/react";
import { confirmWriteSources } from "@/modules/ai/lib/verifiedWriteHistory";
import { prepareWriteCheckpoint, validateWriteCheckpoint } from "@/modules/ai/lib/writeCheckpoint";
import { inspectMemorySources, loadConversationMemory } from "@/modules/ai/lib/conversationMemory";
import { prepareSessionFallback } from "@/modules/ai/store/inferenceFallback";
import { captureSessionTools } from "@/modules/ai/store/customToolCapture";
import {
  recoveryAvailability,
  unresolvedExecution,
} from "@/modules/ai/lib/streamRecovery";
import { executionHistory } from "@/modules/ai/lib/customToolExecution";
import {
  captureAgentRequestCheckpoint,
  eligibleAgentRequestFailure,
  sameAgentRequestOwner,
} from "@/modules/ai/lib/agentRequestRecovery";
import { contextDigest } from "@/modules/ai/lib/targetContext";
import { agentPermissionAuthoritySnapshot } from "@/modules/ai/lib/permissions";
import { saveSessionsList } from "@/modules/ai/lib/sessions";
import { waitForRecovery } from "@/modules/ai/lib/providerRetry";
import { beginInference } from "@/modules/ai/lib/inferenceLifecycle";
import { InferenceTransportError } from "@/modules/ai/lib/inferenceErrors";
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
import { flushTodoPersistence, getTodos } from "@/modules/ai/store/todoStore";
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
import { native } from "@/modules/ai/lib/native";
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
  capturedProviderModelEvidence,
  capturedAgentPersonas,
  inferenceScopeForSession,
  recordSelectedModelUse,
  seedMessages,
  touchChat,
  useChatStore,
  persistCompactionSource,
  chargeCompactionCall,
} from "./chatStore";

import {
  peerReplySessions,
  peerWaitingSessions,
} from "@/modules/ai/lib/peerCommunicationRuntime";

const recoveryOwners = new WeakMap<
  Chat<UIMessage>,
  (runId: string) => boolean
>();

export async function sendPeerCommunicationToSession(
  sessionId: string,
  text: string,
  replyOnly = false,
  expected?: {
    agentId: string;
    modelId: string;
    workspaceId: string;
    startedAt?: number;
  },
): Promise<void> {
  const state = useChatStore.getState();
  const session = state.sessions.find((item) => item.id === sessionId);
  const previous = session?.run;
  const budget = previous?.budget;
  if (
    expected &&
    (session?.profile?.agentId !== expected.agentId ||
      session.profile.modelId !== expected.modelId ||
      session.profile.workspaceId !== expected.workspaceId ||
      (expected.startedAt !== undefined &&
        previous?.startedAt !== expected.startedAt))
  )
    throw new Error("The communication recipient changed.");
  if (
    !previous ||
    !budget ||
    budget.totalSteps >= budget.hardStepLimit ||
    budget.continuationCount >= budget.maxAutoContinuations ||
    previous.state === "cancelled" ||
    previous.state === "failed" ||
    previous.state === "interrupted"
  ) {
    throw new Error("The existing run has no authorized continuation budget.");
  }
  const chat = getOrCreateChat(sessionId);
  if (chat.status === "submitted" || chat.status === "streaming")
    throw new Error("The receiving chat is busy.");
  if (state.pendingApprovalsBySession[sessionId]?.length)
    throw new Error(
      "Resolve pending tool approvals before continuing this task.",
    );
  if (previous.state !== "running") {
    if (!replyOnly) throw new Error("The child run is no longer active.");
    const started = state.beginRun(sessionId, undefined, {
      mutationMode: "read-only",
    });
    if (!started.ok) throw new Error(started.reason);
  }
  useChatStore.setState((current) => ({
    sessions: current.sessions.map((item) =>
      item.id === sessionId && item.run
        ? {
            ...item,
            run: {
              ...item.run,
              budget: {
                ...budget,
                phase: "running",
                continuationCount: budget.continuationCount + 1,
                continuationPromptPending: false,
              },
            },
          }
        : item,
    ),
  }));
  if (replyOnly) peerReplySessions.add(sessionId);
  peerWaitingSessions.delete(sessionId);
  try {
    await chat.sendMessage({ role: "user", parts: [{ type: "text", text }] });
    if (chat.error) throw chat.error;
  } finally {
    if (replyOnly) peerReplySessions.delete(sessionId);
  }
}

export function sessionToolContext(sessionId: string) {
  const readCache = new Map<string, { size: number; hash: number }>();
  const owner = () =>
    useChatStore
      .getState()
      .sessions.find((session) => session.id === sessionId);
  const activeRun = () => owner()?.run?.state === "running" ? owner()?.run : undefined;
  const ownerWorkspaceRoot = () =>
    activeRun()?.checkoutRoot ??
    activeRun()?.workspaceRoot ??
    owner()?.profile?.workspaceRoot ??
    null;
  const foregroundMatchesOwner = () =>
    workspacePathsEqual(
      useChatStore.getState().live.getWorkspaceRoot(),
      ownerWorkspaceRoot(),
    );
  const toolContext: ToolContext = {
    validatePeerReview: async () => {
      const taskId = owner()?.run?.peerTaskId;
      if (!taskId) return;
      const { usePeerTaskStore } = await import("@/modules/ai/store/peerTaskStore");
      const task = usePeerTaskStore.getState().tasks.find((item) => item.id === taskId && item.status === "running");
      if (task?.review) await (await import("@/modules/ai/lib/peerReview")).validatePeerReview(task);
    },
    peerRemainingSteps: () => {
      const run = activeRun();
      return run &&
        (run.peerTaskId || peerReplySessions.has(sessionId)) &&
        run.budget
        ? Math.max(0, run.budget.hardStepLimit - run.budget.totalSteps)
        : undefined;
    },
    shouldYieldPeerRun: () => peerWaitingSessions.has(sessionId),
    isPeerReplyOnly: () => peerReplySessions.has(sessionId),
    getCwd: () =>
      foregroundMatchesOwner()
        ? useChatStore.getState().live.getCwd()
        : ownerWorkspaceRoot(),
    getWorkspaceRoot: ownerWorkspaceRoot,
    getWorkspaceId: () =>
      activeRun()?.checkoutId ??
      activeRun()?.workspaceId ??
      owner()?.profile?.workspaceId ??
      null,
    getMutationMode: () => activeRun()?.mutationMode ?? "shared-write",
    getWorkspaceEnv: () =>
      activeRun()?.workspaceEnvironment ??
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
    getRunId: () =>
      owner()?.run?.state === "running" ? owner()?.run?.startedAt : undefined,
    getUserTurnCount: () => chats.get(sessionId)?.messages.filter(m => m.role === "user").length,
    getCapturedToolVersions: () =>
      owner()?.run?.state === "running"
        ? owner()?.run?.customTools?.versions
        : undefined,
    getAgentId: () => {
      const state = useChatStore.getState();
      return (
        activeRun()?.agentId ??
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
    prepareFallback: prepareSessionFallback(sessionId),
    getReasoning: () => owner()?.run?.reasoning,
    onRetrieved: (retrievalNotice) =>
      useChatStore.getState().patchAgentMeta(sessionId, { retrievalNotice }),
    prepareCompactionContext: async (messages) => {
      const session = owner();
      const run = session?.run;
      if (!session || !run || run.state !== "running")
        throw new Error("No active conversation run for context preparation.");
      const originals = JSON.parse(JSON.stringify(messages)) as UIMessage[];
      await captureSessionTools(sessionId, toolContext);
      await persistCompactionSource(sessionId, originals);
      return {
        hasTargetContext: !!session.targetContext,
        owner: { sessionId, workspaceId: session.profile?.workspaceId ?? null },
        originals,
        ready: () => awaitSessionWrites(sessionId),
        prepareCheckpoint: async () => {
          const matches = () => {
            const current = owner()?.run;
            return current?.state === "running" && current.startedAt === run.startedAt && current.workspaceId === run.workspaceId && current.modelId === run.modelId && current.agentId === run.agentId;
          };
          if (!matches()) return null;
          await persistCompactionSource(sessionId, chats.get(sessionId)?.messages ?? originals);
          await awaitSessionWrites(sessionId);
          if (!matches()) return null;
          const snapshot = await prepareWriteCheckpoint({ sessionId, workspaceId: run.workspaceId ?? null });
          return matches() ? snapshot : null;
        },
        validateCheckpoint: validateWriteCheckpoint,
        confirmWriteSources: async (candidates) => {
          const check = () => {
            const current = owner()?.run;
            if (current?.state !== "running" || current.startedAt !== run.startedAt || current.workspaceId !== run.workspaceId || current.modelId !== run.modelId || current.agentId !== run.agentId)
              throw new Error("The captured conversation changed during write-source confirmation.");
          };
          return confirmWriteSources({
            candidates,
            messages: chats.get(sessionId)?.messages ?? [],
            workspaceRoot: run.workspaceRoot ?? "",
            sessionId,
            check,
            persist: async (snapshot) => {
              await persistCompactionSource(sessionId, snapshot);
              await awaitSessionWrites(sessionId);
            },
            inspect: async (locators) => {
              const view = await loadConversationMemory({ sessionId, workspaceId: run.workspaceId ?? null });
              if (view.sourceChanged) throw new Error("Original write-source evidence changed.");
              return inspectMemorySources(view.preparation, locators);
            },
          });
        },
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
      useChatStore.getState().patchAgentMeta(sessionId, {
        compactionNotice: { droppedCount: 0, optimized, at: Date.now() },
      });
    },
    getInferenceScope: () => inferenceScopeForSession(sessionId),
    getActivityOwner: () => {
      const run = owner()?.run;
      return run
        ? {
            sessionId,
            runId: `${sessionId}:${run.startedAt}`,
            workspaceId: run.workspaceId ?? null,
            agentId: run.agentId,
            modelId: run.modelId,
            providerId: run.providerId,
            taskId: run.peerTaskId,
          }
        : undefined;
    },
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
      const captured = capturedAgentPersonas.get(sessionId);
      if (captured && session?.run?.state === "running" &&
          session.run.startedAt === captured.startedAt && session.run.agentId === captured.agentId)
        return { name: captured.name, instructions: captured.instructions };
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
    getShellIdentity: () => native.shellIdentity(toolContext.getWorkspaceEnv?.()),
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
      const providerEvidence = capturedProviderModelEvidence.get(sessionId);
      return {
        providerId: run.providerId,
        transportModelId: run.transportModelId,
        ...(providerEvidence ? { providerEvidence } : {}),
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
    onStepFinished: () => useChatStore.getState().recordRunStepCompletion(sessionId),
    getAgentRequestRecoveryCount: () => owner()?.run?.agentRequestRecovery?.attempts ?? 0,
    canDispatchAgentRequestRecovery: () => {
      const run = owner()?.run;
      return run?.state === "running" &&
        run.agentRequestRecovery?.attempts === 1 &&
        run.agentRequestRecovery.phase === "dispatched" &&
        run.agentRequestRecovery.checkpoint?.runId === `${sessionId}:${run.startedAt}`;
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
        nativeToolImitationBlocked: info.nativeToolImitationBlocked,
        unfinishedWork: !peerWaitingSessions.has(sessionId) && !peerReplySessions.has(sessionId) &&
          getTodos(sessionId).some(todo => todo.status === "pending" || todo.status === "in_progress"),
        blockedWork: !peerWaitingSessions.has(sessionId) && !peerReplySessions.has(sessionId) &&
          getTodos(sessionId).some(todo => todo.status === "blocked"),
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
  });

  const initialMessages = seedMessages.get(sessionId);
  seedMessages.delete(sessionId);

  const chat = new Chat<UIMessage>({
    id: sessionId,
    transport: transport as unknown as ChatTransport<UIMessage>,
    messages: initialMessages,
    sendAutomaticallyWhen: ({ messages }) =>
      shouldAutomaticallySendSession(sessionId, messages),
    onError: (e) => {
      const original = pendingTerminalStreamError ?? e;
      pendingTerminalStreamError = undefined;
      if (!beginAgentRequestFailureRecovery(sessionId, chat, original))
        recordTerminalAiFailure(sessionId, original);
    },
  });
  recoveryOwners.set(chat, transport.canRecover);
  return chat;
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

/** The first stream timeout settles its native request, not the Agent mission. */
function beginAgentRequestFailureRecovery(
  sessionId: string,
  chat: Chat<UIMessage>,
  error: unknown,
): boolean {
  const state = useChatStore.getState();
  const session = state.sessions.find(item => item.id === sessionId);
  const run = session?.run;
  const normalized = normalizeAiError(error, { ...currentAiErrorContext(sessionId), disposition: "terminal" });
  if (!eligibleAgentRequestFailure(run, normalized) || !session?.profile ||
      session.profile.agentId !== run?.agentId || session.profile.modelId !== run.modelId ||
      (session.profile.workspaceId ?? undefined) !== run.workspaceId ||
      !run.agentPermissionAuthority ||
      run.agentPermissionAuthority !== agentPermissionAuthoritySnapshot(sessionId, run.agentId ?? "") ||
      !recoveryOwners.get(chat)?.(`${sessionId}:${run.startedAt}`) ||
      state.pendingApprovalsBySession[sessionId]?.length) return false;
  const startedAt = run.startedAt;
  const next = state.sessions.map(item => item.id === sessionId && item.run
    ? { ...item, run: {
        ...item.run,
        // Archive the first timeout in the recovery record. Stop remains free to
        // record a *new* explicit user cancellation during preparation.
        stop: undefined,
        agentRequestRecovery: {
          attempts: 1, phase: "preparing" as const,
          consumedBy: normalized.errorCode as "first-output-timeout" | "stream-idle-timeout",
          failures: [normalized],
        },
      } }
    : item);
  useChatStore.setState({ sessions: next });
  void saveSessionsList(next);
  state.patchAgentMeta(sessionId, {
    status: "retrying",
    step: "Checking the existing Agent mission before one fresh provider segment...",
    providerRetry: null,
  });
  // The SDK invokes onError before it transitions the Chat to error. A new
  // send is only admissible after the old request has settled and its partial
  // assistant message has been committed.
  setTimeout(() => {
    void resumeAgentAfterProviderFailure(sessionId, startedAt, chat).catch((cause) => {
      const latest = useChatStore.getState().sessions.find(s => s.id === sessionId)?.run;
      if (latest?.state === "running" && latest.startedAt === startedAt &&
          latest.agentRequestRecovery?.phase !== "dispatched")
        recordTerminalAiFailure(sessionId, cause);
    });
  }, 0);
  return true;
}

async function resumeAgentAfterProviderFailure(
  sessionId: string,
  startedAt: number,
  chat: Chat<UIMessage>,
): Promise<void> {
  const original = JSON.stringify(chat.messages);
  const current = () => useChatStore.getState().sessions.find(s => s.id === sessionId);
  const check = (phase: "preparing" | "checkpointed") => {
    const session = current(), run = session?.run;
    if (!session || run?.state !== "running" || run.startedAt !== startedAt ||
        run.agentRequestRecovery?.attempts !== 1 ||
        run.agentRequestRecovery.phase !== phase ||
        run.stop || session?.profile?.agentId !== run.agentId ||
        session.profile?.modelId !== run.modelId ||
        (session.profile?.workspaceId ?? undefined) !== run.workspaceId ||
        useChatStore.getState().pendingApprovalsBySession[sessionId]?.length ||
        !recoveryOwners.get(chat)?.(`${sessionId}:${startedAt}`) ||
        JSON.stringify(chat.messages) !== original)
      throw new Error("Agent recovery owner, approval state or durable transcript changed; no effect was replayed.");
    return session;
  };
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new InferenceTransportError("preflight-timeout")), 10_000);
  const wait = <T>(promise: PromiseLike<T>): Promise<T> => waitForRecovery(promise, controller.signal);
  const environment = () => {
    const prefs = usePreferencesStore.getState();
    const plan = usePlanStore.getState();
    if (plan.queue.length) throw new Error("Unapplied plan edits require reconciliation before recovery.");
    return {
      permissions: [prefs.agentPermissionProfiles, prefs.agentWorkspacePermissions,
        agentPermissionAuthoritySnapshot(sessionId, current()?.run?.agentId ?? "")],
      todos: getTodos(sessionId),
      plan: { active: plan.active, queue: plan.queue },
    };
  };
  try {
    if (chat.status !== "error") throw new Error("The previous provider request did not settle before recovery.");
    const session = check("preparing"), run = session.run;
    if (!run) throw new Error("The captured logical Agent run disappeared.");
    const preflight = environment();
    const sourceRoot = run.checkoutRoot ?? run.workspaceRoot;
    if (!sourceRoot) throw new Error("Agent workspace root unavailable for recovery revision proof.");
    const workspaceWitness = await wait(native.agentWorkspaceFingerprint(sourceRoot, run.workspaceEnvironment));
    if (!workspaceWitness.revision || workspaceWitness.qualification === "unavailable")
      throw new Error("A complete workspace revision witness is unavailable; recovery blocked.");
    await wait(flushTodoPersistence());
    await wait(persistCompactionSource(sessionId, chat.messages));
    await wait(awaitSessionWrites(sessionId));
    check("preparing");
    const records = await wait(executionHistory(sessionId));
    check("preparing");
    const hasWrites = chat.messages.some(message => message.parts.some(part =>
      part.type === "tool-write_file" || part.type === "tool-create_directory"));
    // Existing native checkpoint is a *supplemental* revision guarantee for
    // superseded writes. A null snapshot does NOT prove absence of an effect.
    const nativeCheckpoint = hasWrites
      ? await wait(prepareWriteCheckpoint({ sessionId, workspaceId: run.workspaceId ?? null }))
      : null;
    const evidence = {
      ...preflight,
      records,
      writeCheckpoint: nativeCheckpoint,
      workspaceRevision: workspaceWitness.revision,
      readFile: async (path: string) => {
        const result = await native.readFile(path, run.workspaceEnvironment);
        if (result.kind !== "text") throw new Error("Completed write no longer has readable text content.");
        return result.content;
      },
      isDirectory: async (path: string) =>
        (await native.stat(path, run.workspaceEnvironment)).kind === "dir",
    };
    const checkpoint = await wait(captureAgentRequestCheckpoint(session, chat.messages, evidence));
    check("preparing");
    const stored = await wait(loadMessages(sessionId));
    if (!stored || await wait(contextDigest(stored)) !== checkpoint.transcriptDigest)
      throw new Error("Persisted mission transcript or immutable tool receipts changed.");
    const updated = useChatStore.getState().sessions.map(item => item.id === sessionId && item.run?.agentRequestRecovery?.phase === "preparing"
      ? { ...item, run: { ...item.run, agentRequestRecovery: {
          ...item.run.agentRequestRecovery, phase: "checkpointed" as const,
          checkpoint,
        } } }
      : item);
    useChatStore.setState({ sessions: updated });
    await wait(saveSessionsList(updated));
    check("checkpointed");
    // Revalidate both durable owners and workspace effects immediately before
    // dispatch. Never mistake a stale file or a changed permission for consent.
    const fresh = environment();
    if (await wait(contextDigest(fresh.permissions)) !== checkpoint.permissionsDigest ||
        await wait(contextDigest(fresh.todos)) !== checkpoint.todoDigest ||
        await wait(contextDigest(fresh.plan)) !== checkpoint.planDigest ||
        await wait(contextDigest(current()?.run?.budget)) !== checkpoint.budgetDigest ||
        !sameAgentRequestOwner(checkpoint, current()) ||
        await wait(contextDigest(chat.messages)) !== checkpoint.transcriptDigest)
      throw new Error("Agent recovery revision, budget, permissions, todos or transcript became stale.");
    for (const receipt of checkpoint.workspaceReceipts) {
      if (receipt.kind === "dir") {
        if (!await wait(evidence.isDirectory(receipt.path))) throw new Error("Workspace directory revision became stale.");
      } else if (await wait(contextDigest(await wait(evidence.readFile(receipt.path)))) !== receipt.digest)
        throw new Error("Workspace file revision became stale.");
    }
    if (nativeCheckpoint) await wait(validateWriteCheckpoint(nativeCheckpoint));
    const freshWorkspaceWitness = await wait(native.agentWorkspaceFingerprint(sourceRoot, run.workspaceEnvironment));
    if (!freshWorkspaceWitness.revision || freshWorkspaceWitness.revision !== checkpoint.workspaceRevision)
      throw new Error("Workspace tree revision changed before recovery dispatch.");
    check("checkpointed");
    const dispatched = useChatStore.getState().sessions.map(item => item.id === sessionId && item.run?.agentRequestRecovery?.phase === "checkpointed"
      ? { ...item, run: { ...item.run, agentRequestRecovery: {
          ...item.run.agentRequestRecovery, phase: "dispatched" as const,
        } } }
      : item);
    useChatStore.setState({ sessions: dispatched });
    await wait(saveSessionsList(dispatched));
    const finalEnvironment = environment();
    if (await wait(contextDigest(finalEnvironment.permissions)) !== checkpoint.permissionsDigest ||
        await wait(contextDigest(finalEnvironment.todos)) !== checkpoint.todoDigest ||
        await wait(contextDigest(finalEnvironment.plan)) !== checkpoint.planDigest ||
        await wait(contextDigest(current()?.run?.budget)) !== checkpoint.budgetDigest ||
        useChatStore.getState().pendingApprovalsBySession[sessionId]?.length ||
        current()?.run?.state !== "running" ||
        !sameAgentRequestOwner(checkpoint, current()) || chat.status !== "error")
      throw new Error("Recovery authorization was superseded before dispatch.");
    chat.clearError();
    clearTimeout(deadline);
    // A new provider segment, *not* an SDK regenerate() of old tool calls.
    // The Chat's existing assistant parts remain durable and distinct.
    await chat.sendMessage(undefined, { body: { clackAgentRequestRecovery: true } });
    // The React bridge may be unmounted while a background session is active.
    // Persist the recovered segment and its immutable new tool results here too.
    await persistCompactionSource(sessionId, chat.messages);
    await awaitSessionWrites(sessionId);
    const afterSegment = current()?.run;
    const recovered = afterSegment?.agentRequestRecovery;
    if (String(chat.status) === "ready" && afterSegment?.state === "running" &&
        afterSegment.startedAt === startedAt && recovered?.phase === "dispatched") {
      const settled = useChatStore.getState().sessions.map(item => item.id === sessionId && item.run
        ? { ...item, run: { ...item.run, agentRequestRecovery: {
            ...recovered, phase: "finished" as const,
          } } }
        : item);
      useChatStore.setState({ sessions: settled });
      await saveSessionsList(settled);
    }
  } catch (error) {
    const latest = current()?.run;
    if (latest?.state === "running" && latest.startedAt === startedAt)
      recordTerminalAiFailure(sessionId, error);
  } finally {
    clearTimeout(deadline);
  }
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
  const failureRun = state.sessions.find((session) => session.id === sessionId)?.run;
  const failureRecovery = failureRun?.agentRequestRecovery;
  if (failureRun?.state === "running" && failureRecovery?.phase === "dispatched") {
    const next = state.sessions.map((session) => session.id === sessionId && session.run
      ? { ...session, run: { ...session.run, agentRequestRecovery: {
          ...failureRecovery, failures: [...failureRecovery.failures, normalized],
        } } }
      : session);
    useChatStore.setState({ sessions: next });
    void saveSessionsList(next);
  }
  const runState = state.sessions.find((session) => session.id === sessionId)
    ?.run?.state;
  const canTerminalize = runState === "running";
  if (canTerminalize) {
    if (normalized.kind === "timeout" &&
        (["connect-timeout", "first-output-timeout", "stream-idle-timeout", "overall-deadline"] as const)
          .some(code => code === normalized.errorCode)) {
      state.recordRunStop(sessionId, {
        source: "provider-timeout",
        reason: normalized.errorCode as "connect-timeout" | "first-output-timeout" | "stream-idle-timeout" | "overall-deadline",
      });
    }
    state.finishRun(
      sessionId,
      normalized.kind === "interrupted"
        ? "interrupted"
        : normalized.kind === "cancelled"
          ? "cancelled"
          : "failed",
      normalized,
    );
    const messages = chats.get(sessionId)?.messages;
    if (messages)
      void persistCompactionSource(sessionId, messages).catch(() => {});
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
  if (peerWaitingSessions.has(sessionId) || peerReplySessions.has(sessionId))
    return false;
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

export async function retryInterruptedRun(sessionId: string): Promise<boolean> {
  const state = useChatStore.getState();
  const session = state.sessions.find((item) => item.id === sessionId);
  const run = session?.run;
  const chat = chats.get(sessionId);
  if (
    !session ||
    !run?.budget ||
    !chat ||
    chat.status === "submitted" ||
    chat.status === "streaming"
  )
    return false;
  if (
    !recoveryAvailability(run, chat.messages, sessionId).allowed ||
    !recoveryOwners.get(chat)?.(`${sessionId}:${run.startedAt}`) ||
    session.profile?.agentId !== run.agentId ||
    session.profile?.modelId !== run.modelId ||
    (session.profile?.workspaceId ?? undefined) !== run.workspaceId ||
    state.pendingApprovalsBySession[sessionId]?.length
  )
    return false;
  const resumed = {
    ...run,
    state: "running" as const,
    endedAt: undefined,
    error: undefined,
    recoveryAttempts: (run.recoveryAttempts ?? 0) + 1,
    budget: {
      ...run.budget,
      phase: "running" as const,
      continuationPromptPending: false,
      totalSteps: run.budget.totalSteps + 1,
    },
  };
  const originalMessages = JSON.stringify(chat.messages);
  chat.clearError();
  useChatStore.setState((current) => ({
    sessions: current.sessions.map((item) =>
      item.id === sessionId ? { ...item, run: resumed } : item,
    ),
  }));
  state.patchAgentMeta(sessionId, {
    status: "thinking",
    step: "Checking interrupted run...",
    error: null,
    providerRetry: null,
  });
  const current = () =>
    useChatStore.getState().sessions.find((item) => item.id === sessionId)
      ?.run === resumed;
  const preparation = new AbortController();
  const deadline = setTimeout(
    () => preparation.abort(new InferenceTransportError("preflight-timeout")),
    10_000,
  );
  const lifecycle = beginInference(
    {
      sessionId,
      runId: `${sessionId}:${run.startedAt}`,
      label: "recovery checks",
      isCurrent: current,
    },
    () => preparation.abort(new DOMException("Cancelled", "AbortError")),
    "awaiting-admission",
  );
  const checkTranscript = () => {
    if (JSON.stringify(chat.messages) !== originalMessages)
      throw new Error(
        "Conversation changed during recovery preparation; no request was replayed.",
      );
  };
  try {
    const records = await waitForRecovery(
      executionHistory(sessionId),
      preparation.signal,
    );
    if (!current()) return false;
    checkTranscript();
    if (unresolvedExecution(records, run.startedAt))
      throw new Error(
        "Tool effects require reconciliation. No inference or tool was replayed.",
      );
    await waitForRecovery(
      persistCompactionSource(sessionId, chat.messages),
      preparation.signal,
    );
    if (!current()) return false;
    await waitForRecovery(
      saveSessionsList(useChatStore.getState().sessions),
      preparation.signal,
    );
    if (!current()) return false;
    checkTranscript();
    lifecycle.update("completed");
    lifecycle.settle();
    clearTimeout(deadline);
    await chat.sendMessage(undefined, { body: { clackRecovery: true } });
    return !chat.error;
  } catch (error) {
    if (current()) recordTerminalAiFailure(sessionId, error);
    return false;
  } finally {
    clearTimeout(deadline);
    lifecycle.settle();
  }
}

export function hasCapturedRecovery(
  sessionId: string,
  startedAt: number,
): boolean {
  const chat = chats.get(sessionId);
  return (
    !!chat && recoveryOwners.get(chat)?.(`${sessionId}:${startedAt}`) === true
  );
}
