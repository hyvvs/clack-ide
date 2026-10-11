import { convertToModelMessages } from "ai";
import { prepareToolExposure, toolRevisionIdentity } from "@/modules/ai/lib/toolExposure";
import { captureEffort } from "@/modules/ai/lib/reasoningEffort";
import { findSavedProviderModel, resolveModelTransportIdentity } from "@/modules/ai/lib/savedProviderModels";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useAgentsStore } from "@/modules/ai/store/agentsStore";
import {
  getChat,
  hasKeyForModel,
  useChatStore,
  seedMessages,
} from "@/modules/ai/store/chatStore";
import { usePeerTaskStore } from "@/modules/ai/store/peerTaskStore";
import { peerEndpoint } from "@/modules/ai/lib/peerCommunicationCoordinator";
import { communicationDigest } from "@/modules/ai/lib/peerCommunication";
import {
  prepareHandoff,
  type HandoffEvidence,
  type HandoffInput,
} from "@/modules/ai/lib/peerHandoff";
import type { PeerTask } from "@/modules/ai/lib/peerTasks";
import { peerTaskArtifactToMessagePart } from "@/modules/ai/lib/peerTaskArtifacts";
import { materializeAttachmentMessages } from "@/modules/ai/lib/attachmentMessages";
import { inspectAttachmentContent } from "@/modules/ai/lib/attachmentStore";
import { resolveModelInputCapabilities } from "@/modules/ai/lib/modelCapabilities";
import { readSelfHostedSnapshot } from "@/modules/ai/lib/selfHostedCapabilities";
import { modelBudgetLimits } from "@/modules/ai/lib/requestPreflight";
import { budgetIdentity } from "@/modules/ai/lib/contextBudgetProfile";
import { resolveSelfHostedSelection } from "@/modules/ai/lib/selfHostedProfiles";
import { PeerHandoffPreparationError } from "@/modules/ai/lib/peerHandoffFailure";
import type { Preferences } from "@/modules/settings/store";
import { resolveCurrentAgentPermission } from "@/modules/ai/lib/permissions";
import { checkReadable } from "@/modules/ai/lib/security";
import {
  applyFreshness,
  projectMemoryClient,
} from "@/modules/ai/lib/projectMemory";
import { loadMessages } from "@/modules/ai/lib/sessions";
import { validatePeerReview } from "@/modules/ai/lib/peerReview";
import {
  measureRequest,
  resolveContextBudget,
  ContextBudgetError,
} from "@/modules/ai/lib/contextBudget";
import {
  formatPeerCommunication,
  type PeerCommunicationEvent,
} from "@/modules/ai/lib/peerCommunication";

const cache = new Map<string, Awaited<ReturnType<typeof prepareHandoff>>>();
const MAX_CACHED_CHARS = 512 * 1024;

function taskSnapshot(task: PeerTask | undefined) {
  return task && { ...task, createdAt: 0, updatedAt: 0, archivedAt: undefined, handoff: undefined };
}

function routeSnapshot(modelId: string, preferences: Preferences) {
  const route = resolveModelTransportIdentity(modelId, preferences);
  const hosted = resolveSelfHostedSelection(preferences.selfHostedInference, modelId);
  const saved = findSavedProviderModel(modelId, preferences.savedProviderModels);
  const endpoint = preferences.customEndpoints.find(e => e.id === route.customEndpointId);
  return {
    route,
    hosted: hosted.status === "available"
      ? budgetIdentity(preferences.selfHostedInference, hosted.profile.id) : hosted.status,
    endpoint: endpoint && { ...endpoint, name: undefined },
    savedModel: saved && { id: saved.id, providerId: saved.providerId, transportModelId: saved.transportModelId, enabled: saved.enabled, providerEvidence: saved.providerEvidence },
    legacy: route.providerId === "lmstudio" ? preferences.lmstudioBaseURL
      : route.providerId === "mlx" ? preferences.mlxBaseURL
      : route.providerId === "ollama" ? preferences.ollamaBaseURL
      : modelId === "openai-compatible-custom" ? [preferences.openaiCompatibleBaseURL, preferences.openaiCompatibleContextLimit] : undefined,
  };
}

function requestPolicy(task: PeerTask, preferences: Preferences) {
  const owner = useChatStore.getState().sessions.find(s => s.id === task.targetSessionId);
  return {
    instructions: preferences.customInstructions,
    target: routeSnapshot(task.targetModelId, preferences),
    source: routeSnapshot(task.sourceModelId, preferences),
    reasoning: recipientEffort(task.targetSessionId, task.targetModelId),
    fallback: owner?.fallback,
  };
}

function exposureSnapshot(exposure: Awaited<ReturnType<typeof prepareToolExposure>>) {
  return exposure.schemas.map(schema => ({
    ...schema,
    function: {
      ...schema.function,
      // These builtin descriptions list chat titles and live graph status, not execution policy.
      description: ["request_peer_task", "cancel_peer_task"].includes(schema.function.name)
        ? undefined : schema.function.description,
    },
    revision: toolRevisionIdentity(exposure.tools[schema.function.name]),
  }));
}

function recipientEffort(sessionId: string, modelId: string) {
  const session = useChatStore
    .getState()
    .sessions.find((s) => s.id === sessionId);
  if (session?.run?.state === "running" && session.run.reasoning)
    return session.run.reasoning;
  const preferences = usePreferencesStore.getState();
  return captureEffort(
    modelId,
    resolveModelTransportIdentity(modelId, preferences),
    session?.effortPreferences,
    preferences.selfHostedInference,
  );
}

export async function preparePeerReply(
  event: PeerCommunicationEvent,
): Promise<string> {
  const task = usePeerTaskStore
    .getState()
    .tasks.find((item) => item.id === event.taskId);
  if (task?.status !== "running") throw new Error("peer_handoff_stale_reply");
  const endpoint = await peerEndpoint(
    event.recipient.sessionId,
    event.workspaceId,
  );
  if (JSON.stringify(endpoint) !== JSON.stringify(event.recipient))
    throw new Error("peer_handoff_reply_policy_changed");
  const delivered = new Set(
    (task.communication ?? [])
      .filter(
        (item) =>
          item.id !== event.id &&
          item.recipient.sessionId === event.recipient.sessionId &&
          ["acknowledged", "answered"].includes(item.state),
      )
      .flatMap((item) =>
        item.evidence.map(
          (source) =>
            `${source.taskId}:${source.artifactId}:${source.contentHash}`,
        ),
      ),
  );
  const evidence = event.evidence.filter(
    (source) =>
      !delivered.has(
        `${source.taskId}:${source.artifactId}:${source.contentHash}`,
      ),
  );
  const text =
    formatPeerCommunication({ ...event, evidence }) +
    (evidence.length !== event.evidence.length
      ? "\nUnchanged evidence references already delivered in this run were not repeated. The original event digest identifies the complete durable payload."
      : "");
  const preferences = usePreferencesStore.getState();
  const state = useChatStore.getState();
  const { buildConfiguredLanguageModel, buildStableSystem } = await import(
    "@/modules/ai/lib/agent"
  );
  const { buildRuntimeTools: buildTools } = await import(
    "@/modules/ai/tools/customExecution"
  );
  const { sessionToolContext } = await import("@/modules/ai/store/chatRuntime");
  const { readProjectMemory } = await import("@/modules/ai/lib/transport");
  const context = sessionToolContext(event.recipient.sessionId).toolContext;
  const reasoning = recipientEffort(
    event.recipient.sessionId,
    endpoint.modelId,
  );
  const model = await buildConfiguredLanguageModel(
    endpoint.modelId,
    state.apiKeys,
    { ...preferences, customEndpointKeys: state.customEndpointKeys, reasoning },
  );
  const system = buildStableSystem(
    endpoint.modelId,
    useAgentsStore
      .getState()
      .all()
      .find((a) => a.id === endpoint.agentId) ?? null,
    preferences.customInstructions,
    await readProjectMemory(task.workspaceRoot, task.workspaceEnvironment),
  );
  const capabilities = resolveModelInputCapabilities(
    endpoint.modelId,
    preferences.selfHostedInference,
    await readSelfHostedSnapshot(
      preferences.selfHostedInference,
      endpoint.modelId,
    ),
  );
  const recipientHistory =
    getChat(event.recipient.sessionId)?.messages ??
    seedMessages.get(event.recipient.sessionId) ??
    (await loadMessages(event.recipient.sessionId)) ??
    [];
  const recipientMessages = await convertToModelMessages(
    await materializeAttachmentMessages(recipientHistory, capabilities),
  );
  const exposure = await prepareToolExposure(await buildTools(context), {
    context,
    messages: [...recipientMessages, { role: "user", content: text }],
    uiMessages: recipientHistory,
    target: endpoint,
    system,
    limits: await modelBudgetLimits(model),
  });
  const cost = measureRequest({
    system,
    tools: exposure.schemas,
    messages: [recipientMessages, text],
  });
  if (!resolveContextBudget(await modelBudgetLimits(model), cost).fits)
    throw new ContextBudgetError(
      "peer-handoff-reply-overflow",
      "The clarification and existing recipient context do not fit. No reply was truncated or delivered.",
    );
  if (
    JSON.stringify(
      await peerEndpoint(event.recipient.sessionId, event.workspaceId),
    ) !== JSON.stringify(endpoint) ||
    JSON.stringify(
      recipientEffort(event.recipient.sessionId, endpoint.modelId),
    ) !== JSON.stringify(reasoning)
  )
    throw new Error("peer_handoff_reply_policy_changed");
  return text;
}

export async function preparePeerTaskHandoff(task: PeerTask, notes: string) {
  let expired = false;
  const deadline = Date.now() + 15_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      prepareTask(task, notes, () => expired || Date.now() >= deadline),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new PeerHandoffPreparationError("expired", "peer_handoff_preparation_deadline"));
        }, 15_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function prepareTask(
  task: PeerTask,
  notes: string,
  expired: () => boolean,
) {
  const sessionId = task.targetSessionId;
  const initialTasks = usePeerTaskStore.getState().tasks;
  const session = useChatStore
    .getState()
    .sessions.find((item) => item.id === sessionId);
  const preferences = usePreferencesStore.getState();
  const sourceRun = useChatStore
    .getState()
    .sessions.find((item) => item.id === task.sourceSessionId)?.run?.startedAt;
  const [policyKey, ownerKey, dependencyKey, endpoint, source, taskKey] = await Promise.all([
    communicationDigest(requestPolicy(task, preferences)),
    communicationDigest({ id: session?.id, profile: session?.profile, modelRevision: session?.modelRevision ?? 0 }),
    communicationDigest(task.dependsOn.map(id => taskSnapshot(initialTasks.find(t => t.id === id)))),
    peerEndpoint(sessionId, task.workspaceId),
    peerEndpoint(task.sourceSessionId, task.workspaceId),
    communicationDigest(taskSnapshot(task)),
  ]);
  if (!hasKeyForModel(task.targetModelId))
    throw new Error("peer_handoff_target_unavailable");
  if (
    source.agentId !== task.sourceAgentId ||
    source.modelId !== task.sourceModelId
  )
    throw new Error("peer_handoff_source_changed");
  const history =
    getChat(sessionId)?.messages ??
    seedMessages.get(sessionId) ??
    (await loadMessages(sessionId)) ??
    [];
  const historyKey = await communicationDigest(history);
  const check = async () => {
    const current = usePeerTaskStore.getState();
    const owner = useChatStore
      .getState()
      .sessions.find((item) => item.id === sessionId);
    const fail = (reason: ConstructorParameters<typeof PeerHandoffPreparationError>[0]): never => { throw new PeerHandoffPreparationError(reason); };
    if (expired()) fail("expired");
    if (!current.recoveryReady) fail("recovery_required");
    const latest = current.tasks.find(item => item.id === task.id);
    if (latest?.status !== "running" || await communicationDigest(taskSnapshot(latest)) !== taskKey) fail("task_changed");
    const run = useChatStore.getState().sessions.find(item => item.id === task.sourceSessionId)?.run;
    if (run?.startedAt !== sourceRun) fail("source_run_changed");
    if (["cancelled", "failed", "interrupted"].includes(run?.state ?? "")) fail("source_cancelled");
    if (await communicationDigest({ id: owner?.id, profile: owner?.profile, modelRevision: owner?.modelRevision ?? 0 }) !== ownerKey) fail("target_identity_changed");
    if (owner?.run?.state === "running") fail("target_identity_changed");
    if (await communicationDigest(requestPolicy(task, usePreferencesStore.getState())) !== policyKey) fail("policy_changed");
    try {
      if (JSON.stringify(await peerEndpoint(sessionId, task.workspaceId)) !== JSON.stringify(endpoint) ||
        JSON.stringify(await peerEndpoint(task.sourceSessionId, task.workspaceId)) !== JSON.stringify(source)) fail("endpoint_changed");
    } catch (error) {
      if (error instanceof PeerHandoffPreparationError) throw error;
      fail("endpoint_changed");
    }
    if (await communicationDigest(getChat(sessionId)?.messages ?? seedMessages.get(sessionId) ?? history) !== historyKey) fail("history_changed");
    if (await communicationDigest(task.dependsOn.map(id => taskSnapshot(current.tasks.find(item => item.id === id)))) !== dependencyKey) fail("dependency_changed");
  };
  const { sessionToolContext } = await import("@/modules/ai/store/chatRuntime");
  const base = sessionToolContext(sessionId).toolContext;
  const context = {
    ...base,
    getAgentId: () => endpoint.agentId,
    getWorkspaceId: () => task.workspaceId,
    getMutationMode: () => task.executionMode,
    getWorkspaceRoot: () => task.workspaceRoot,
    getCwd: () => task.workspaceRoot,
  };
  const { buildRuntimeTools: buildTools } = await import("@/modules/ai/tools/customExecution");
  const initialTools = await buildTools(context);
  const readable = (path?: string) =>
    resolveCurrentAgentPermission("read_file", path ? { path } : {}, context)
      .outcome === "allow";
  const artifacts = [
    ...new Map(
      task.artifactRefs.map((a) => [a.contentRef.contentHash, a]),
    ).values(),
  ];
  for (const artifact of artifacts) {
    if (
      !readable(artifact.sourcePath) ||
      !checkReadable(artifact.sourcePath ?? artifact.displayName).ok
    )
      throw new Error("peer_handoff_artifact_denied");
    const actual = await inspectAttachmentContent(artifact.contentRef.id);
    if (
      actual.contentHash !== artifact.contentRef.contentHash ||
      actual.byteSize !== artifact.byteSize
    )
      throw new Error("peer_handoff_artifact_corrupt");
  }
  const evidence: HandoffEvidence[] = [];
  for (const id of task.dependsOn) {
    const dependency = initialTasks.find((item) => item.id === id);
    if (
      !dependency?.result ||
      dependency.status !== "completed" ||
      dependency.workspaceId !== task.workspaceId ||
      dependency.rootTaskId !== task.rootTaskId
    )
      throw new Error("peer_handoff_dependency_unavailable");
    if (!readable()) throw new Error("peer_handoff_evidence_denied");
    await validatePeerReview(dependency, initialTasks);
    evidence.push({
      id: `task:${id}`,
      workspaceId: task.workspaceId,
      source: {
        taskId: id,
        sessionId: dependency.targetSessionId,
        agentId: dependency.targetAgentId,
        modelId: dependency.targetModelId,
        artifacts: dependency.result.artifacts.map((a) => ({
          artifactId: a.id,
          hash: a.contentRef.contentHash,
        })),
        review: dependency.review,
      },
      revision: dependency.result.completedAt,
      contentHash: await communicationDigest(dependency.result),
      text: dependency.result.summary,
      freshness: "historical",
      qualification: "agent-finding",
      required: task.kind === "review" || Boolean(dependency.review),
    });
  }
  let projectRevision: number | undefined;
  let projectEvidenceKey: string | undefined;
  let selectedProjectIds: string[] = [];
  const project = projectMemoryClient(sessionId);
  if (readable()) {
    const view = await project.load();
    if (view.workspace !== task.workspaceId)
      throw new Error("peer_handoff_project_workspace_mismatch");
    projectRevision = view.revision;
    const words = task.prompt.toLowerCase().match(/[a-z0-9_]{4,}/g) ?? [];
    const candidates = view.entries.filter(
      (entry) =>
        entry.status === "approved" &&
        (["requirements", "constraints"].includes(entry.section) ||
          words.some((word) => entry.text.toLowerCase().includes(word))),
    );
    if (
      candidates.filter((entry) =>
        ["requirements", "constraints"].includes(entry.section),
      ).length > 8
    )
      throw new Error("peer_handoff_required_project_limit");
    const selected = candidates
      .sort(
        (a, b) =>
          Number(["requirements", "constraints"].includes(b.section)) -
          Number(["requirements", "constraints"].includes(a.section)),
      )
      .slice(0, 8);
    selectedProjectIds = selected.map((entry) => entry.id);
    const freshness = selected.length
      ? await project.revalidate(view, selectedProjectIds)
      : null;
    projectEvidenceKey = await communicationDigest(freshness?.entries ?? []);
    const fresh = freshness ? applyFreshness(view, freshness) : view;
    for (const entry of fresh.entries.filter((entry) =>
      selectedProjectIds.includes(entry.id),
    ))
      evidence.push({
        id: `project:${entry.id}`,
        workspaceId: task.workspaceId,
        source: {
          workspace: view.workspace,
          checkout: view.checkout,
          baseSha: view.baseSha,
          recordId: entry.id,
          locator: entry.locator,
          sourceState: entry.sourceState,
          conflicts: entry.conflicts,
          currentEvidence: freshness?.entries.find(
            (item) => item.id === entry.id,
          )?.evidence,
        },
        revision: view.revision,
        contentHash: entry.sliceHash,
        text: entry.text,
        freshness: task.worktree
          ? "different-checkout-needs-revalidation"
          : (entry.freshness ?? "unverified"),
        qualification: entry.qualification,
        required: ["requirements", "constraints"].includes(entry.section),
      });
  }
  const { buildConfiguredLanguageModel, buildStableSystem } = await import(
    "@/modules/ai/lib/agent"
  );
  const { readProjectMemory } = await import("@/modules/ai/lib/transport");
  const capabilities = resolveModelInputCapabilities(
    task.targetModelId,
    preferences.selfHostedInference,
    await readSelfHostedSnapshot(
      preferences.selfHostedInference,
      task.targetModelId,
    ),
  );
  if (
    capabilities.text !== "supported" ||
    (task.executionMode !== "read-only" && capabilities.tools === "unsupported")
  )
    throw new Error("peer_handoff_target_capability");
  const configuration = {
    ...preferences,
    customEndpointKeys: useChatStore.getState().customEndpointKeys,
    reasoning: recipientEffort(sessionId, task.targetModelId),
  };
  const model = await buildConfiguredLanguageModel(
    task.targetModelId,
    useChatStore.getState().apiKeys,
    configuration,
  );
  const persona = useAgentsStore
    .getState()
    .all()
    .find((agent) => agent.id === endpoint.agentId);
  const system = buildStableSystem(
    task.targetModelId,
    persona ?? null,
    preferences.customInstructions,
    await readProjectMemory(task.workspaceRoot, task.workspaceEnvironment),
  );
  const materialized = await materializeAttachmentMessages(
    artifacts.length
      ? [
          ...history,
          {
            id: `handoff-artifacts:${task.id}`,
            role: "user",
            parts: artifacts.map(peerTaskArtifactToMessagePart),
          },
        ]
      : history,
    capabilities,
  );
  const recipientMessages = await convertToModelMessages(materialized);
  const exposure = await prepareToolExposure(initialTools, {
    context,
    messages: [...recipientMessages, { role: "user", content: task.prompt }],
    uiMessages: history,
    target: { endpoint, policyKey },
    system,
    limits: await modelBudgetLimits(model),
  });
  const input: HandoffInput = {
    task: taskSnapshot(task) as PeerTask,
    recipient: { ...endpoint, workspaceId: task.workspaceId },
    limits: await modelBudgetLimits(model),
    system,
    tools: exposure.schemas,
    history: recipientMessages,
    evidence,
    notes,
    artifacts: task.artifactRefs,
    configuration: {
      capabilities,
      exposure: exposure.identity,
      reasoning: configuration.reasoning,
      policy: endpoint.policyRevision,
      sourcePolicy: source.policyRevision,
      projectRevision,
      projectEvidenceKey,
      policyKey, ownerKey, dependencyKey, historyKey, sourceRun,
    },
  };
  await check();
  const key = await communicationDigest(input);
  let prepared = cache.get(key);
  if (!prepared) {
    prepared = await prepareHandoff(input);
    while (
      cache.size &&
      (cache.size >= 32 ||
        [...cache.values()].reduce((n, item) => n + item.text.length, 0) +
          prepared.text.length >
          MAX_CACHED_CHARS)
    )
      cache.delete(cache.keys().next().value ?? "");
    if (prepared.text.length <= MAX_CACHED_CHARS) cache.set(key, prepared);
  }
  const validate = async () => {
    await check();
    const currentCapabilities = resolveModelInputCapabilities(task.targetModelId,
      usePreferencesStore.getState().selfHostedInference,
      await readSelfHostedSnapshot(usePreferencesStore.getState().selfHostedInference, task.targetModelId));
    if (await communicationDigest(currentCapabilities) !== await communicationDigest(capabilities) ||
      await communicationDigest(await modelBudgetLimits(model)) !== await communicationDigest(input.limits))
      throw new PeerHandoffPreparationError("capability_changed");
    const currentExposure = await prepareToolExposure(await buildTools(context), {
      context, messages: [...recipientMessages, { role: "user", content: task.prompt }],
      uiMessages: history, target: endpoint, system, limits: input.limits,
    });
    if (await communicationDigest(exposureSnapshot(currentExposure)) !== await communicationDigest(exposureSnapshot(exposure)))
      throw new PeerHandoffPreparationError("tools_changed");
    if (projectRevision !== undefined) {
      const view = await project.load();
      if (
        view.revision !== projectRevision ||
        (selectedProjectIds.length &&
          (await communicationDigest(
            (
              await project.revalidate(view, selectedProjectIds)
            ).entries,
          )) !== projectEvidenceKey)
      )
        throw new PeerHandoffPreparationError("project_changed", "peer_handoff_project_changed");
    }
    await check();
  };
  await validate();
  return {
    ...prepared,
    artifacts,
    validate,
    previousMessageIds: history.map((message) => message.id),
  };
}
