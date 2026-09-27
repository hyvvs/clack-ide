import { convertToModelMessages } from "ai";
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
import {
  modelBudgetLimits,
  serializedToolSchemas,
} from "@/modules/ai/lib/requestPreflight";
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
  const { buildTools } = await import("@/modules/ai/tools/tools");
  const { sessionToolContext } = await import("@/modules/ai/store/chatRuntime");
  const { readProjectMemory } = await import("@/modules/ai/lib/transport");
  const context = sessionToolContext(event.recipient.sessionId).toolContext;
  const model = await buildConfiguredLanguageModel(
    endpoint.modelId,
    state.apiKeys,
    { ...preferences, customEndpointKeys: state.customEndpointKeys },
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
  const cost = measureRequest({
    system,
    tools: await serializedToolSchemas(buildTools(context)),
    messages: [
      await convertToModelMessages(
        await materializeAttachmentMessages(recipientHistory, capabilities),
      ),
      text,
    ],
  });
  if (!resolveContextBudget(await modelBudgetLimits(model), cost).fits)
    throw new ContextBudgetError(
      "peer-handoff-reply-overflow",
      "The clarification and existing recipient context do not fit. No reply was truncated or delivered.",
    );
  if (
    JSON.stringify(
      await peerEndpoint(event.recipient.sessionId, event.workspaceId),
    ) !== JSON.stringify(endpoint)
  )
    throw new Error("peer_handoff_reply_policy_changed");
  return text;
}

export async function preparePeerTaskHandoff(task: PeerTask, notes: string) {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      prepareTask(task, notes, () => expired),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new Error("peer_handoff_preparation_deadline"));
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
  const endpoint = await peerEndpoint(sessionId, task.workspaceId);
  const source = await peerEndpoint(task.sourceSessionId, task.workspaceId);
  const taskKey = await communicationDigest({ ...task, handoff: undefined });
  const sourceRun = useChatStore
    .getState()
    .sessions.find((item) => item.id === task.sourceSessionId)?.run?.startedAt;
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
    if (
      expired() ||
      !current.recoveryReady ||
      current.tasks.find((item) => item.id === task.id)?.status !== "running" ||
      (await communicationDigest({
        ...current.tasks.find((item) => item.id === task.id),
        handoff: undefined,
      })) !== taskKey ||
      useChatStore
        .getState()
        .sessions.find((item) => item.id === task.sourceSessionId)?.run
        ?.startedAt !== sourceRun ||
      ["cancelled", "failed", "interrupted"].includes(
        useChatStore
          .getState()
          .sessions.find((item) => item.id === task.sourceSessionId)?.run
          ?.state ?? "",
      ) ||
      owner !== session ||
      preferences !== usePreferencesStore.getState() ||
      JSON.stringify(await peerEndpoint(sessionId, task.workspaceId)) !==
        JSON.stringify(endpoint) ||
      JSON.stringify(
        await peerEndpoint(task.sourceSessionId, task.workspaceId),
      ) !== JSON.stringify(source) ||
      (await communicationDigest(
        getChat(sessionId)?.messages ?? seedMessages.get(sessionId) ?? history,
      )) !== historyKey ||
      task.dependsOn.some(
        (id) =>
          current.tasks.find((item) => item.id === id) !==
          initialTasks.find((item) => item.id === id),
      )
    )
      throw new Error("peer_handoff_preparation_stale");
  };
  const { sessionToolContext } = await import("@/modules/ai/store/chatRuntime");
  const base = sessionToolContext(sessionId).toolContext;
  const context = {
    ...base,
    getAgentId: () => endpoint.agentId,
    getWorkspaceRoot: () => task.workspaceRoot,
    getCwd: () => task.workspaceRoot,
  };
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
  const { buildTools } = await import("@/modules/ai/tools/tools");
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
  const tools = await serializedToolSchemas(buildTools(context));
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
  const input: HandoffInput = {
    task: { ...task, handoff: undefined },
    recipient: { ...endpoint, workspaceId: task.workspaceId },
    limits: await modelBudgetLimits(model),
    system,
    tools,
    history: await convertToModelMessages(materialized),
    evidence,
    notes,
    artifacts: task.artifactRefs,
    configuration: {
      capabilities,
      policy: endpoint.policyRevision,
      sourcePolicy: source.policyRevision,
      projectRevision,
      projectEvidenceKey,
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
        throw new Error("peer_handoff_project_changed");
    }
  };
  await validate();
  return {
    ...prepared,
    artifacts,
    validate,
    previousMessageIds: history.map((message) => message.id),
  };
}
