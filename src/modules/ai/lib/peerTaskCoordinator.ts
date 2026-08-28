import type { UIMessage } from "@ai-sdk/react";
import {
  workspaceEnvironmentFromId,
  type SessionMeta,
} from "./sessions";
import { workspacePathsEqual } from "@/modules/workspace";
import { normalizeAiError } from "./errors";
import {
  PEER_TASK_MAX_HOPS,
  PEER_TASK_MAX_ACTIVE,
  PEER_TASK_MAX_PER_ROOT,
  PEER_TASK_SCHEMA_VERSION,
  newPeerTaskId,
  peerTaskFingerprint,
  type PeerArtifactRef,
  type PeerTask,
  type PeerTaskExecutionMode,
  type PeerTaskKind,
} from "./peerTasks";
import { native } from "./native";
import {
  acquireWorkspaceWriteLease,
  releaseWorkspaceWriteLeasesForSession,
} from "./workspaceWriteLease";
import { cancelRun, getChat, useChatStore } from "../store/chatStore";
import { sendMessageToSession } from "../store/chatRuntime";
import { usePeerTaskStore } from "../store/peerTaskStore";

export type PeerTaskRequest = {
  sourceSessionId: string;
  targetSessionId: string;
  kind: PeerTaskKind;
  prompt: string;
  artifactRefs?: PeerArtifactRef[];
  executionMode?: PeerTaskExecutionMode;
  awaitCompletion?: boolean;
};

export type PeerTaskRequestResult =
  | { ok: true; task: PeerTask }
  | { ok: false; code: string; message: string };

export async function requestPeerTask(
  request: PeerTaskRequest,
): Promise<PeerTaskRequestResult> {
  const validation = validateRequest(request);
  if (!validation.ok) return validation;
  const { source, target, parent, rootTaskId, hopCount } = validation;
  const now = Date.now();
  const id = newPeerTaskId();
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
    workspaceEnvironment:
      workspaceEnvironmentFromId(source.profile?.workspaceId) ?? {
        kind: "local",
      },
    kind: request.kind,
    executionMode: request.executionMode ?? "read-only",
    prompt: request.prompt.trim(),
    artifactRefs: normalizeArtifactRefs(request.artifactRefs),
    parentTaskId: parent?.id ?? null,
    rootTaskId: rootTaskId ?? id,
    hopCount,
    status: "queued",
    createdAt: now,
    updatedAt: now,
  };
  usePeerTaskStore.getState().add(task);
  useChatStore.getState().recordPeerTaskStart(source.id);

  if (target.run?.state !== "running") {
    const dispatch = dispatchPeerTask(task.id);
    if (request.awaitCompletion !== false) await dispatch;
    else void dispatch;
  }
  const current = usePeerTaskStore
    .getState()
    .tasks.find((item) => item.id === task.id);
  return { ok: true, task: current ?? task };
}

export async function dispatchPeerTask(taskId: string): Promise<void> {
  const peerStore = usePeerTaskStore.getState();
  const task = peerStore.tasks.find((item) => item.id === taskId);
  if (task?.status !== "queued") return;
  const chatStore = useChatStore.getState();
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
      message: "The target conversation is no longer bound to the same workspace.",
    });
    return;
  }
  const claimed = usePeerTaskStore.getState().claim(taskId);
  if (!claimed) return;
  let worktreeCreated = false;
  let captureStarted = false;
  try {
    let checkout:
      | { checkoutId: string; checkoutRoot: string }
      | undefined;
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
          return await native.gitAgentWorktreeCreate(
            repo.repoRoot,
            claimed.id,
          );
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
    await sendMessageToSession(
      claimed.targetSessionId,
      {
        role: "user",
        parts: [{ type: "text", text: peerTaskPrompt(claimed) }],
      },
      {
        peerTaskId: claimed.id,
        mutationMode: claimed.executionMode,
        workspaceEnvironment: claimed.workspaceEnvironment,
        ...checkout,
      },
    );
    const currentTarget = useChatStore
      .getState()
      .sessions.find((session) => session.id === claimed.targetSessionId);
    const summary = latestVisibleAssistantText(
      getChat(claimed.targetSessionId)?.messages ?? [],
    );
    if (claimed.executionMode === "isolated-worktree") {
      const worktree = usePeerTaskStore
        .getState()
        .tasks.find((item) => item.id === claimed.id)?.worktree;
      if (!worktree) throw new Error("The isolated worktree metadata is missing.");
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
    }
    usePeerTaskStore.getState().complete(claimed.id, {
      summary: summary || "The peer run completed without a text response.",
      targetSessionId: claimed.targetSessionId,
      targetAgentId:
        currentTarget?.run?.agentId ?? claimed.targetAgentId,
      targetModelId:
        currentTarget?.run?.modelId ?? claimed.targetModelId,
      completedAt: Date.now(),
    });
  } catch (error) {
    if (worktreeCreated && !captureStarted) {
      try {
        await native.gitAgentWorktreeRemove(claimed.workspaceRoot, claimed.id);
      } catch {
        // Preserve the original peer failure. The task retains worktree
        // metadata when cleanup itself fails.
      }
    }
    const normalized = normalizeAiError(error, { disposition: "terminal" });
    usePeerTaskStore.getState().fail(claimed.id, {
      code: "peer_run_failed",
      message: normalized.message,
    });
  }
}

export async function cancelPeerTask(taskId: string): Promise<void> {
  const task = usePeerTaskStore
    .getState()
    .tasks.find((item) => item.id === taskId);
  if (!task || (task.status !== "queued" && task.status !== "running")) return;
  usePeerTaskStore.getState().cancel(taskId);
  const targetRun = useChatStore
    .getState()
    .sessions.find((session) => session.id === task.targetSessionId)?.run;
  if (targetRun?.state === "running" && targetRun.peerTaskId === task.id) {
    await cancelRun(task.targetSessionId);
  }
  if (task.executionMode === "isolated-worktree" && task.worktree) {
    try {
      await native.gitAgentWorktreeRemove(task.workspaceRoot, task.id);
      usePeerTaskStore.getState().clearWorktree(task.id);
    } catch {
      // Cancellation is durable even when native cleanup needs recovery.
    }
  }
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
    return { ok: false, message: "No unapplied agent change set is available." };
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

function validateRequest(request: PeerTaskRequest):
  | {
      ok: true;
      source: SessionMeta;
      target: SessionMeta;
      parent: PeerTask | null;
      rootTaskId: string | null;
      hopCount: number;
    }
  | { ok: false; code: string; message: string } {
  const prompt = request.prompt.trim();
  if (!prompt) {
    return { ok: false, code: "peer_prompt_empty", message: "Peer task prompt cannot be empty." };
  }
  if (request.sourceSessionId === request.targetSessionId) {
    return { ok: false, code: "peer_target_same", message: "Choose a different conversation for peer work." };
  }
  const source = sessionById(request.sourceSessionId);
  const target = sessionById(request.targetSessionId);
  if (!source || !target) {
    return { ok: false, code: "peer_session_missing", message: "The source or target conversation no longer exists." };
  }
  const sourceProfile = source.profile;
  const targetProfile = target.profile;
  if (
    !sourceProfile?.workspaceId ||
    !sourceProfile.workspaceRoot ||
    sourceProfile.workspaceId !== targetProfile?.workspaceId
  ) {
    return { ok: false, code: "peer_workspace_mismatch", message: "Peer conversations must be bound to the same workspace." };
  }
  if (
    !sourceProfile.agentId ||
    !sourceProfile.modelId ||
    !targetProfile?.agentId ||
    !targetProfile.modelId
  ) {
    return { ok: false, code: "peer_identity_missing", message: "Both conversations need a valid agent and model." };
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
    (task) => task.status === "queued" || task.status === "running",
  ).length;
  if (activeTaskCount >= PEER_TASK_MAX_ACTIVE) {
    return {
      ok: false,
      code: "peer_active_task_limit",
      message: `Clack supports up to ${PEER_TASK_MAX_ACTIVE} queued or running peer tasks at once.`,
    };
  }
  const parentId = source.run?.peerTaskId ?? null;
  const parent = parentId
    ? (tasks.find((task) => task.id === parentId) ?? null)
    : null;
  const rootTaskId = parent?.rootTaskId ?? parent?.id ?? null;
  const hopCount = parent ? parent.hopCount + 1 : 0;
  if (hopCount > PEER_TASK_MAX_HOPS) {
    return { ok: false, code: "peer_hop_limit", message: `Peer delegation is limited to ${PEER_TASK_MAX_HOPS} hops.` };
  }
  const rootCount = rootTaskId
    ? tasks.filter((task) => task.rootTaskId === rootTaskId).length
    : 0;
  if (rootCount >= PEER_TASK_MAX_PER_ROOT) {
    return { ok: false, code: "peer_task_limit", message: `This collaboration chain reached its ${PEER_TASK_MAX_PER_ROOT}-task limit.` };
  }
  const fingerprint = peerTaskFingerprint({ ...request, prompt });
  const repeated = tasks.some(
    (task) =>
      (rootTaskId
        ? task.rootTaskId === rootTaskId
        : task.parentTaskId === null &&
          (task.status === "queued" || task.status === "running")) &&
      task.status !== "cancelled" &&
      peerTaskFingerprint(task) === fingerprint,
  );
  if (repeated) {
    return { ok: false, code: "peer_task_repeated", message: "An equivalent peer request already exists in this collaboration chain." };
  }
  return { ok: true, source, target, parent, rootTaskId, hopCount };
}

function sessionById(id: string) {
  return useChatStore.getState().sessions.find((session) => session.id === id) ?? null;
}

function normalizeArtifactRefs(
  refs: readonly PeerArtifactRef[] | undefined,
): PeerArtifactRef[] {
  const seen = new Set<string>();
  const result: PeerArtifactRef[] = [];
  for (const ref of refs ?? []) {
    const path = ref.path.trim();
    const key = `${ref.kind}:${path}`;
    if (!path || seen.has(key)) continue;
    seen.add(key);
    result.push({ kind: ref.kind, path });
    if (result.length >= 20) break;
  }
  return result;
}

function peerTaskPrompt(task: PeerTask): string {
  return `<peer-task id="${task.id}">\n${JSON.stringify({
    kind: task.kind,
    executionMode: task.executionMode,
    prompt: task.prompt,
    artifactRefs: task.artifactRefs,
    source: {
      sessionId: task.sourceSessionId,
      agentId: task.sourceAgentId,
      modelId: task.sourceModelId,
    },
  })}\n\nComplete this bounded peer task in the current workspace. Return a concise, evidence-based result for the requesting conversation. Do not delegate again unless it is necessary and within the collaboration limits.\n</peer-task>`;
}

function latestVisibleAssistantText(messages: readonly UIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const text = message.parts
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (text) return text.slice(0, 40_000);
  }
  return "";
}
