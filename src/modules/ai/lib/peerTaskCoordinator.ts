import type { UIMessage } from "@ai-sdk/react";
import type { AttachmentRecord } from "./attachments";
import type { AttachmentMessageReference } from "./attachmentMessages";
import { workspaceEnvironmentFromId, type SessionMeta } from "./sessions";
import { workspacePathsEqual } from "@/modules/workspace";
import { normalizeAiError } from "./errors";
import {
  PEER_TASK_MAX_ACTIVE,
  PEER_TASK_MAX_HOPS,
  PEER_TASK_MAX_PER_ROOT,
  PEER_TASK_SCHEMA_VERSION,
  newPeerTaskId,
  peerTaskFingerprint,
  type PeerArtifactRef,
  type PeerTask,
  type PeerTaskArtifact,
  type PeerTaskExecutionMode,
  type PeerTaskKind,
} from "./peerTasks";
import {
  selectDispatchablePeerTaskIds,
  validatePeerTaskDependencies,
} from "./peerTaskDependencies";
import {
  buildPeerTaskDependencyAggregate,
  formatPeerTaskAggregateForModel,
} from "./peerTaskAggregation";
import {
  planPeerTaskCancellation,
  type PeerTaskCancellationRequest,
} from "./peerTaskCancellation";
import {
  PeerArtifactPackageError,
  packagePeerTaskArtifacts,
  packageReturnedPeerTaskArtifacts,
  peerTaskArtifactToMessagePart,
  retainPeerTaskArtifactContent,
} from "./peerTaskArtifacts";
import { native } from "./native";
import {
  acquireWorkspaceWriteLease,
  releaseWorkspaceWriteLeasesForSession,
} from "./workspaceWriteLease";
import { cancelRun, getChat, useChatStore } from "../store/chatStore";
import {
  sendMessageToSession,
  sendPeerCommunicationToSession,
} from "../store/chatRuntime";
import { flushPeerTasks, usePeerTaskStore } from "../store/peerTaskStore";
import {
  awaitPeerClarification,
  receiveQueuedPeerNotes,
} from "@/modules/ai/lib/peerCommunicationCoordinator";
import { peerWaitingSessions } from "@/modules/ai/lib/peerCommunicationRuntime";

export type PeerTaskRequest = {
  sourceSessionId: string;
  targetSessionId: string;
  kind: PeerTaskKind;
  prompt: string;
  artifactRefs?: PeerArtifactRef[];
  attachmentRecords?: AttachmentRecord[];
  attachmentReferences?: AttachmentMessageReference[];
  executionMode?: PeerTaskExecutionMode;
  dependsOn?: string[];
  awaitCompletion?: boolean;
};

export type PeerTaskRequestResult =
  | { ok: true; task: PeerTask }
  | { ok: false; code: string; message: string };

export async function requestPeerTask(
  request: PeerTaskRequest,
): Promise<PeerTaskRequestResult> {
  const peerStore = usePeerTaskStore.getState();
  if (!peerStore.recoveryReady) {
    return {
      ok: false,
      code: "peer_recovery_pending",
      message:
        peerStore.recoveryError ??
        "Agent task recovery is still validating saved work.",
    };
  }
  const id = newPeerTaskId();
  const validation = validateRequest(request, id);
  if (!validation.ok) return validation;
  const { source, target, parent, rootTaskId, hopCount, dependsOn } =
    validation;
  let artifacts: PeerTaskArtifact[];
  try {
    artifacts = await packagePeerTaskArtifacts(
      {
        pathRefs: request.artifactRefs,
        attachmentRecords: request.attachmentRecords,
        attachmentReferences: request.attachmentReferences,
      },
      {
        sourceSessionId: source.id,
        sourceTaskId: parent?.id ?? null,
        sourceAgentId: source.run?.agentId ?? source.profile?.agentId ?? "",
        sourceModelId: source.run?.modelId ?? source.profile?.modelId ?? "",
        workspaceId: source.profile?.workspaceId ?? "",
        workspaceRoot: source.profile?.workspaceRoot ?? "",
      },
    );
  } catch (error) {
    if (error instanceof PeerArtifactPackageError) {
      return { ok: false, code: error.code, message: error.message };
    }
    return {
      ok: false,
      code: "peer_artifact_packaging_failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const fingerprint = peerTaskFingerprint({
    ...request,
    prompt: request.prompt.trim(),
    artifactRefs: artifacts,
    dependsOn,
  });
  if (hasRepeatedTask(fingerprint, parent ? rootTaskId : null)) {
    return {
      ok: false,
      code: "peer_task_repeated",
      message:
        "An equivalent peer request already exists in this collaboration chain.",
    };
  }
  const now = Date.now();
  const task: PeerTask = {
    schemaVersion: PEER_TASK_SCHEMA_VERSION,
    id,
    sourceSessionId: source.id,
    targetSessionId: target.id,
    sourceAgentId: source.run?.agentId ?? source.profile?.agentId ?? "",
    sourceModelId: source.run?.modelId ?? source.profile?.modelId ?? "",
    targetAgentId: target.profile?.agentId ?? "",
    targetModelId: target.profile?.modelId ?? "",
    workspaceId: source.profile?.workspaceId ?? "",
    workspaceRoot: source.profile?.workspaceRoot ?? "",
    workspaceEnvironment: workspaceEnvironmentFromId(
      source.profile?.workspaceId,
    ) ?? {
      kind: "local",
    },
    kind: request.kind,
    executionMode: request.executionMode ?? "read-only",
    prompt: request.prompt.trim(),
    artifactRefs: artifacts,
    parentTaskId: parent?.id ?? null,
    rootTaskId,
    hopCount,
    dependsOn,
    status: dependsOn.length > 0 ? "waiting" : "queued",
    createdAt: now,
    updatedAt: now,
  };
  retainPeerTaskArtifactContent(artifacts);
  usePeerTaskStore.getState().add(task);
  useChatStore.getState().recordPeerTaskStart(source.id);

  const current = usePeerTaskStore
    .getState()
    .tasks.find((item) => item.id === task.id);
  const sessionRunStates = new Map(
    useChatStore
      .getState()
      .sessions.map((session) => [session.id, session.run?.state]),
  );
  const canDispatch = selectDispatchablePeerTaskIds(
    usePeerTaskStore.getState().tasks,
    sessionRunStates,
  ).includes(task.id);
  if (current?.status === "queued" && canDispatch) {
    const dispatch = dispatchPeerTask(current.id);
    if (request.awaitCompletion !== false) await dispatch;
    else void dispatch;
  }
  const resultTask = usePeerTaskStore
    .getState()
    .tasks.find((item) => item.id === task.id);
  return { ok: true, task: resultTask ?? task };
}

export async function dispatchPeerTask(taskId: string): Promise<void> {
  const peerStore = usePeerTaskStore.getState();
  if (!peerStore.recoveryReady || !useChatStore.getState().sessionsHydrated) {
    return;
  }
  const task = peerStore.tasks.find((item) => item.id === taskId);
  if (task?.status !== "queued") return;
  const chatStore = useChatStore.getState();
  const sessionRunStates = new Map(
    chatStore.sessions.map((session) => [session.id, session.run?.state]),
  );
  if (
    !selectDispatchablePeerTaskIds(peerStore.tasks, sessionRunStates).includes(
      taskId,
    )
  ) {
    return;
  }
  const source = chatStore.sessions.find(
    (session) => session.id === task.sourceSessionId,
  );
  const target = chatStore.sessions.find(
    (session) => session.id === task.targetSessionId,
  );
  if (!source) {
    peerStore.fail(taskId, {
      code: "peer_source_missing",
      message: "The requesting conversation no longer exists.",
    });
    return;
  }
  if (!target) {
    peerStore.fail(taskId, {
      code: "peer_target_missing",
      message: "The target conversation no longer exists.",
    });
    return;
  }
  if (target.run?.state === "running") return;
  if (
    !target.profile?.workspaceId ||
    target.profile.workspaceId !== task.workspaceId
  ) {
    peerStore.fail(taskId, {
      code: "peer_workspace_mismatch",
      message:
        "The target conversation is no longer bound to the same workspace.",
    });
    return;
  }
  const claimed = usePeerTaskStore.getState().claim(taskId);
  if (!claimed) return;
  let worktreeCreated = false;
  let captureStarted = false;
  try {
    await flushPeerTasks();
    let checkout: { checkoutId: string; checkoutRoot: string } | undefined;
    if (claimed.executionMode === "isolated-worktree") {
      if (!claimed.workspaceId.startsWith("local:")) {
        throw new Error(
          "Isolated agent worktrees are available only for local workspaces. Use serialized shared-workspace edits for WSL.",
        );
      }
      const repo = await native.gitResolveRepo(
        claimed.workspaceRoot,
        claimed.workspaceEnvironment,
      );
      if (!repo) {
        throw new Error(
          "This workspace is not a Git repository. Use serialized shared-workspace edits instead.",
        );
      }
      if (!workspacePathsEqual(repo.repoRoot, claimed.workspaceRoot)) {
        throw new Error(
          "Isolated agent worktrees currently require the workspace root to match the Git repository root.",
        );
      }
      const setupLeaseId = `worktree-setup:${claimed.id}`;
      const setupLease = await acquireWorkspaceWriteLease({
        workspaceId: claimed.workspaceId,
        sessionId: setupLeaseId,
        agentId: claimed.targetAgentId,
      });
      if (!setupLease.ok) throw new Error(setupLease.message);
      const worktree = await (async () => {
        try {
          return await native.gitAgentWorktreeCreate(repo.repoRoot, claimed.id);
        } finally {
          releaseWorkspaceWriteLeasesForSession(setupLeaseId);
        }
      })();
      worktreeCreated = true;
      usePeerTaskStore.getState().setWorktree(claimed.id, worktree);
      checkout = {
        checkoutId: `${claimed.workspaceId}:worktree:${claimed.id}`,
        checkoutRoot: worktree.checkoutRoot,
      };
    }
    const beforeRun = usePeerTaskStore
      .getState()
      .tasks.find((item) => item.id === claimed.id);
    if (beforeRun?.status === "cancelled") return;
    const dependencyAggregate = buildPeerTaskDependencyAggregate(
      claimed,
      usePeerTaskStore.getState().tasks,
    );
    const dependencyContext =
      dependencyAggregate.entries.length > 0
        ? formatPeerTaskAggregateForModel(dependencyAggregate).text
        : undefined;
    const communicationContext = await receiveQueuedPeerNotes(claimed.id);
    await sendMessageToSession(
      claimed.targetSessionId,
      {
        role: "user",
        parts: [
          {
            type: "text",
            text:
              peerTaskPrompt(claimed, dependencyContext) +
              (communicationContext ? `\n${communicationContext}` : ""),
          },
          ...claimed.artifactRefs.map(peerTaskArtifactToMessagePart),
        ],
      },
      {
        peerTaskId: claimed.id,
        mutationMode: claimed.executionMode,
        workspaceEnvironment: claimed.workspaceEnvironment,
        ...checkout,
      },
    );
    for (;;) {
      if (!usePeerTaskStore.getState().recoveryReady)
        throw new Error("Peer task persistence requires recovery.");
      const generation = useChatStore
        .getState()
        .sessions.find((session) => session.id === claimed.targetSessionId)
        ?.run?.startedAt;
      const clarification = await awaitPeerClarification(claimed.id);
      if (!clarification) break;
      if (
        usePeerTaskStore.getState().tasks.find((item) => item.id === claimed.id)
          ?.status !== "running"
      )
        return;
      await sendPeerCommunicationToSession(
        claimed.targetSessionId,
        clarification,
        false,
        {
          agentId: claimed.targetAgentId,
          modelId: claimed.targetModelId,
          workspaceId: claimed.workspaceId,
          startedAt: generation,
        },
      );
    }
    const afterRun = usePeerTaskStore
      .getState()
      .tasks.find((item) => item.id === claimed.id);
    if (afterRun?.status !== "running") return;
    const currentTarget = useChatStore
      .getState()
      .sessions.find((session) => session.id === claimed.targetSessionId);
    const summary = latestVisibleAssistantText(
      getChat(claimed.targetSessionId)?.messages ?? [],
    );
    let returnedArtifacts: PeerTaskArtifact[] = [];
    if (claimed.executionMode === "isolated-worktree") {
      const worktree = usePeerTaskStore
        .getState()
        .tasks.find((item) => item.id === claimed.id)?.worktree;
      if (!worktree)
        throw new Error("The isolated worktree metadata is missing.");
      captureStarted = true;
      const changeSet = await native.gitAgentWorktreeCapture(
        claimed.workspaceRoot,
        claimed.id,
        worktree.baseSha,
      );
      worktreeCreated = false;
      usePeerTaskStore.getState().setChangeSet(claimed.id, {
        baseSha: worktree.baseSha,
        patch: changeSet.patch,
        changedPaths: changeSet.changedPaths,
      });
      if (changeSet.patch.length > 0) {
        returnedArtifacts = await packageReturnedPeerTaskArtifacts(
          [
            {
              displayName: "Peer changes.patch",
              mediaType: "text/x-diff",
              contentKind: "text",
              bytes: new TextEncoder().encode(changeSet.patch),
              originType: "diff",
              worktreeProvenance: {
                taskId: claimed.id,
                baseSha: worktree.baseSha,
                changedPaths: changeSet.changedPaths,
              },
            },
          ],
          {
            sourceSessionId: claimed.targetSessionId,
            sourceTaskId: claimed.id,
            sourceAgentId: currentTarget?.run?.agentId ?? claimed.targetAgentId,
            sourceModelId: currentTarget?.run?.modelId ?? claimed.targetModelId,
            workspaceId: claimed.workspaceId,
            workspaceRoot: claimed.workspaceRoot,
          },
        );
        retainPeerTaskArtifactContent(returnedArtifacts);
      }
    }
    usePeerTaskStore.getState().complete(claimed.id, {
      summary: summary || "The peer run completed without a text response.",
      targetSessionId: claimed.targetSessionId,
      targetAgentId: currentTarget?.run?.agentId ?? claimed.targetAgentId,
      targetModelId: currentTarget?.run?.modelId ?? claimed.targetModelId,
      completedAt: Date.now(),
      artifacts: returnedArtifacts,
    });
  } catch (error) {
    const cancelled =
      usePeerTaskStore.getState().tasks.find((item) => item.id === claimed.id)
        ?.status === "cancelled";
    const communicationNeedsRecovery = usePeerTaskStore
      .getState()
      .tasks.find((item) => item.id === claimed.id)
      ?.communication?.some((event) => event.kind === "clarification-request");
    if (
      worktreeCreated &&
      !captureStarted &&
      !cancelled &&
      !communicationNeedsRecovery
    ) {
      try {
        await native.gitAgentWorktreeRemove(claimed.workspaceRoot, claimed.id);
      } catch {
        // Preserve the original peer failure. The task retains worktree
        // metadata when cleanup itself fails.
      }
    }
    if (cancelled) return;
    const normalized = normalizeAiError(error, { disposition: "terminal" });
    usePeerTaskStore.getState().fail(claimed.id, {
      code: peerArtifactFailureCode(error),
      message: normalized.message,
    });
  } finally {
    if (peerWaitingSessions.delete(claimed.targetSessionId)) {
      useChatStore.getState().finishRun(claimed.targetSessionId, "failed");
    }
  }
}

export type CancelPeerTaskOptions = Omit<PeerTaskCancellationRequest, "taskId">;

export type CancelPeerTaskResult =
  | {
      ok: true;
      cancelledTaskIds: string[];
      cancelledDescendantCount: number;
      alreadyTerminal: boolean;
    }
  | {
      ok: false;
      code: string;
      message: string;
      cancelledTaskIds?: string[];
    };

export async function cancelPeerTask(
  taskId: string,
  options: Partial<CancelPeerTaskOptions> = {},
): Promise<CancelPeerTaskResult> {
  const peerStore = usePeerTaskStore.getState();
  const plan = planPeerTaskCancellation(
    {
      taskId,
      cascade: options.cascade ?? false,
      actor: options.actor ?? "user",
      reason: options.reason,
      authorizedRootTaskId: options.authorizedRootTaskId,
    },
    peerStore.tasks,
  );
  if (!plan.ok) return plan;
  if (plan.alreadyTerminal) {
    return {
      ok: true,
      cancelledTaskIds: [],
      cancelledDescendantCount: 0,
      alreadyTerminal: true,
    };
  }

  const transitions = usePeerTaskStore.getState().cancel(plan.targets);
  const tasksById = new Map(
    usePeerTaskStore.getState().tasks.map((task) => [task.id, task]),
  );
  for (const transition of transitions) {
    if (transition.previousStatus !== "running") continue;
    const task = tasksById.get(transition.taskId);
    if (!task) continue;
    const targetRun = useChatStore
      .getState()
      .sessions.find((session) => session.id === task.targetSessionId)?.run;
    if (
      targetRun?.state !== "running" ||
      targetRun.peerTaskId !== transition.taskId
    ) {
      continue;
    }
    try {
      await cancelRun(task.targetSessionId);
    } catch (error) {
      return {
        ok: false,
        code: "peer_cancellation_stop_failed",
        message: normalizeAiError(error, { disposition: "terminal" }).message,
        cancelledTaskIds: transitions.map((item) => item.taskId),
      };
    }
  }
  return {
    ok: true,
    cancelledTaskIds: transitions.map((item) => item.taskId),
    cancelledDescendantCount: Math.max(0, transitions.length - 1),
    alreadyTerminal: transitions.length === 0,
  };
}

export async function discardPeerTaskWorktree(
  taskId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const task = usePeerTaskStore
    .getState()
    .tasks.find((item) => item.id === taskId);
  if (!task?.worktree) {
    return { ok: false, message: "No preserved worktree is available." };
  }
  try {
    await native.gitAgentWorktreeRemove(task.workspaceRoot, task.id);
    usePeerTaskStore.getState().clearWorktree(task.id);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: String(error) };
  }
}

export async function applyPeerTaskChangeSet(
  taskId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const task = usePeerTaskStore
    .getState()
    .tasks.find((item) => item.id === taskId);
  if (!task?.changeSet || task.changeSet.appliedAt) {
    return {
      ok: false,
      message: "No unapplied agent change set is available.",
    };
  }
  const applyLeaseId = `patch-apply:${task.id}`;
  const lease = await acquireWorkspaceWriteLease({
    workspaceId: task.workspaceId,
    sessionId: applyLeaseId,
    agentId: task.sourceAgentId,
  });
  if (!lease.ok) return { ok: false, message: lease.message };
  try {
    await native.gitAgentPatchApply(
      task.workspaceRoot,
      task.changeSet.baseSha,
      task.changeSet.patch,
    );
    usePeerTaskStore.getState().markChangeSetApplied(task.id);
    return { ok: true };
  } catch (error) {
    const message = String(error);
    usePeerTaskStore.getState().setChangeSetApplyError(task.id, message);
    return { ok: false, message };
  } finally {
    releaseWorkspaceWriteLeasesForSession(applyLeaseId);
  }
}

function validateRequest(
  request: PeerTaskRequest,
  taskId: string,
):
  | {
      ok: true;
      source: SessionMeta;
      target: SessionMeta;
      parent: PeerTask | null;
      rootTaskId: string;
      hopCount: number;
      dependsOn: string[];
    }
  | { ok: false; code: string; message: string } {
  const prompt = request.prompt.trim();
  if (!prompt) {
    return {
      ok: false,
      code: "peer_prompt_empty",
      message: "Peer task prompt cannot be empty.",
    };
  }
  if (request.sourceSessionId === request.targetSessionId) {
    return {
      ok: false,
      code: "peer_target_same",
      message: "Choose a different conversation for peer work.",
    };
  }
  const source = sessionById(request.sourceSessionId);
  const target = sessionById(request.targetSessionId);
  if (!source || !target) {
    return {
      ok: false,
      code: "peer_session_missing",
      message: "The source or target conversation no longer exists.",
    };
  }
  const sourceProfile = source.profile;
  const targetProfile = target.profile;
  if (
    !sourceProfile?.workspaceId ||
    !sourceProfile.workspaceRoot ||
    sourceProfile.workspaceId !== targetProfile?.workspaceId
  ) {
    return {
      ok: false,
      code: "peer_workspace_mismatch",
      message: "Peer conversations must be bound to the same workspace.",
    };
  }
  if (
    !sourceProfile.agentId ||
    !sourceProfile.modelId ||
    !targetProfile?.agentId ||
    !targetProfile.modelId
  ) {
    return {
      ok: false,
      code: "peer_identity_missing",
      message: "Both conversations need a valid agent and model.",
    };
  }
  if (
    request.executionMode === "isolated-worktree" &&
    !sourceProfile.workspaceId.startsWith("local:")
  ) {
    return {
      ok: false,
      code: "peer_worktree_environment_unsupported",
      message:
        "Isolated agent worktrees are available only for local workspaces. Use serialized shared-workspace edits for WSL.",
    };
  }
  const tasks = usePeerTaskStore.getState().tasks;
  const activeTaskCount = tasks.filter(
    (task) =>
      task.status === "waiting" ||
      task.status === "queued" ||
      task.status === "running",
  ).length;
  if (activeTaskCount >= PEER_TASK_MAX_ACTIVE) {
    return {
      ok: false,
      code: "peer_active_task_limit",
      message: `Clack supports up to ${PEER_TASK_MAX_ACTIVE} active peer tasks at once.`,
    };
  }
  const parentId = source.run?.peerTaskId ?? null;
  const parent = parentId
    ? (tasks.find((task) => task.id === parentId) ?? null)
    : null;
  const rootTaskId = parent?.rootTaskId ?? parent?.id ?? taskId;
  const hopCount = parent ? parent.hopCount + 1 : 0;
  if (hopCount > PEER_TASK_MAX_HOPS) {
    return {
      ok: false,
      code: "peer_hop_limit",
      message: `Peer delegation is limited to ${PEER_TASK_MAX_HOPS} hops.`,
    };
  }
  const rootCount = tasks.filter(
    (task) => task.rootTaskId === rootTaskId,
  ).length;
  if (rootCount >= PEER_TASK_MAX_PER_ROOT) {
    return {
      ok: false,
      code: "peer_task_limit",
      message: `This collaboration chain reached its ${PEER_TASK_MAX_PER_ROOT}-task limit.`,
    };
  }
  const dependencyValidation = validatePeerTaskDependencies(
    { taskId, rootTaskId, dependsOn: request.dependsOn },
    tasks,
  );
  if (!dependencyValidation.ok) return dependencyValidation;
  return {
    ok: true,
    source,
    target,
    parent,
    rootTaskId,
    hopCount,
    dependsOn: dependencyValidation.dependsOn,
  };
}

function sessionById(id: string) {
  return (
    useChatStore.getState().sessions.find((session) => session.id === id) ??
    null
  );
}

function peerTaskPrompt(task: PeerTask, dependencyContext?: string): string {
  return `<peer-task id="${task.id}">\n${JSON.stringify({
    kind: task.kind,
    executionMode: task.executionMode,
    prompt: task.prompt,
    dependsOn: task.dependsOn,
    artifacts: task.artifactRefs.map((artifact) => ({
      id: artifact.id,
      name: artifact.displayName,
      mediaType: artifact.mediaType,
      contentHash: artifact.contentRef.contentHash,
      origin: artifact.originType,
    })),
    source: {
      sessionId: task.sourceSessionId,
      agentId: task.sourceAgentId,
      modelId: task.sourceModelId,
    },
  })}${
    dependencyContext
      ? `\n\nRelevant prerequisite results follow. These are bounded metadata and compact text derived from durable peer-task results. Returned files listed here are not attached unless they also appear in this task's explicit artifacts.\n${dependencyContext}`
      : ""
  }\n\nComplete this bounded peer task in the current workspace. Return a concise, evidence-based result for the requesting conversation. Do not delegate again unless it is necessary and within the collaboration limits.\n</peer-task>`;
}

function hasRepeatedTask(
  fingerprint: string,
  rootTaskId: string | null,
): boolean {
  return usePeerTaskStore
    .getState()
    .tasks.some(
      (task) =>
        (rootTaskId
          ? task.rootTaskId === rootTaskId
          : task.parentTaskId === null &&
            (task.status === "waiting" ||
              task.status === "queued" ||
              task.status === "running")) &&
        task.status !== "blocked" &&
        task.status !== "cancelled" &&
        peerTaskFingerprint(task) === fingerprint,
    );
}

function peerArtifactFailureCode(error: unknown): string {
  if (error instanceof PeerArtifactPackageError) return error.code;
  const message = error instanceof Error ? error.message : String(error);
  if (/unavailable|not found|cannot find/i.test(message)) {
    return "peer_artifact_content_missing";
  }
  if (/integrity|size changed|hash/i.test(message)) {
    return "peer_artifact_integrity_failed";
  }
  if (/capabilit|vision|image input/i.test(message)) {
    return "peer_artifact_capability_blocked";
  }
  return "peer_run_failed";
}

function latestVisibleAssistantText(messages: readonly UIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const text = message.parts
      .filter(
        (part): part is { type: "text"; text: string } => part.type === "text",
      )
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (text) return text.slice(0, 40_000);
  }
  return "";
}
