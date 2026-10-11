import { native } from "@/modules/ai/lib/native";
import { checkReadable } from "@/modules/ai/lib/security";
import { loadAttachmentContent } from "@/modules/ai/lib/attachmentStore";
import {
  artifactFilePath,
  taskRetryEligibility,
} from "@/modules/ai/lib/taskPresentation";
import { createConversationProfile } from "@/modules/ai/lib/sessions";
import {
  currentWorkspaceScopeKey,
  workspaceScopeKey,
} from "@/modules/workspace/env";
import { getChat, useChatStore } from "@/modules/ai/store/chatStore";
import { usePeerTaskStore } from "@/modules/ai/store/peerTaskStore";
import type { PeerTask } from "@/modules/ai/lib/peerTasks";
import { executionHistory } from "@/modules/ai/lib/customToolExecution";
import { replaySafeExecution } from "@/modules/ai/lib/taskRetryEffects";
import { finishedTasksToArchive } from "@/modules/ai/lib/taskArchive";

export function canAccessTaskResult(
  task: PeerTask,
  sessionId: string,
): boolean {
  const chat = useChatStore.getState();
  const owner = chat.sessions.find((s) => s.id === sessionId)?.profile;
  return (
    !!owner &&
    workspaceScopeKey(task.workspaceEnvironment) ===
      currentWorkspaceScopeKey() &&
    (task.sourceSessionId === sessionId ||
      task.targetSessionId === sessionId) &&
    owner.workspaceId === task.workspaceId &&
    createConversationProfile({
      agentId: owner.agentId,
      modelId: owner.modelId,
      workspaceRoot: task.workspaceRoot,
      workspaceEnvironment: workspaceScopeKey(task.workspaceEnvironment),
    }).workspaceId === task.workspaceId &&
    createConversationProfile({
      agentId: owner.agentId,
      modelId: owner.modelId,
      workspaceRoot: chat.live.getWorkspaceRoot?.() ?? null,
      workspaceEnvironment: currentWorkspaceScopeKey(),
    }).workspaceId === task.workspaceId
  );
}

function ownedTask(taskId: string, sessionId: string) {
  const task = usePeerTaskStore.getState().tasks.find((t) => t.id === taskId);
  if (!task || !canAccessTaskResult(task, sessionId))
    throw new Error(
      "Open this task's workspace and owning conversation to access its result.",
    );
  return task;
}

export async function setTaskArchived(taskId: string, sessionId: string, archived: boolean) {
  ownedTask(taskId, sessionId);
  await usePeerTaskStore.getState().setArchived([taskId], archived);
}

export async function archiveFinishedTasks(ids: readonly string[]) {
  const state = usePeerTaskStore.getState();
  const eligible = finishedTasksToArchive(state.tasks, [...state.managingTaskIds, ...state.retryingTaskIds]);
  for (const id of ids) {
    const task = eligible.find(t => t.id === id);
    if (!task || ![task.sourceSessionId, task.targetSessionId].some(owner => canAccessTaskResult(task, owner)))
      throw new Error("Only eligible finished tasks in the current workspace can be cleared.");
  }
  await usePeerTaskStore.getState().setArchived(ids, true);
}

function inside(path: string, root: string) {
  const normalize = (value: string) =>
    value.replace(/\\/g, "/").replace(/\/$/, "");
  const fold = (value: string) =>
    /^[a-z]:/i.test(root) ? normalize(value).toLowerCase() : normalize(value);
  return fold(path).startsWith(`${fold(root)}/`);
}

export async function openTaskFile(
  taskId: string,
  sessionId: string,
  input: { artifactId: string } | { changedPath: string },
): Promise<void> {
  const task = ownedTask(taskId, sessionId);
  const opener = useChatStore.getState().live.openWorkspaceFile;
  if (!opener) throw new Error("File navigation unavailable.");
  let path: string;
  if ("artifactId" in input) {
    const artifact = task.result?.artifacts.find(
      (a) => a.id === input.artifactId,
    );
    if (
      task.recovery?.contentIssues?.some(
        (issue) =>
          issue.role === "returned" && issue.artifactId === input.artifactId,
      )
    )
      throw new Error("Returned artifact unavailable.");
    const source = artifact && artifactFilePath(task, artifact);
    if (!source)
      throw new Error(
        "This artifact is not an applied workspace file. View its immutable content instead.",
      );
    path = source;
  } else {
    if (
      !task.changeSet?.appliedAt ||
      !task.changeSet.changedPaths.includes(input.changedPath)
    )
      throw new Error(
        "Review and apply isolated changes before opening a workspace file.",
      );
    if (/^[a-z]:|^[\\/]/i.test(input.changedPath))
      throw new Error("Task result path must be repository-relative.");
    const repo = await native.gitResolveRepo(
      task.workspaceRoot,
      task.workspaceEnvironment,
    );
    if (!repo) throw new Error("Task repository unavailable.");
    path = `${repo.repoRoot}/${input.changedPath}`;
  }
  if (
    /[\x00-\x1f]/.test(path) ||
    path.startsWith("\\\\") ||
    path.split(/[\\/]/).some((segment) => segment === "..")
  )
    throw new Error("Task result path denied.");
  const root = await native.canonicalize(
    task.workspaceRoot,
    task.workspaceEnvironment,
  );
  const absolute = /^[a-z]:[\\/]|^\//i.test(path) ? path : `${root}/${path}`;
  if (!inside(absolute, root) || !checkReadable(absolute).ok)
    throw new Error(
      "Task result is outside the permitted workspace or is a protected path.",
    );
  const canonical = await native.canonicalize(
    absolute,
    task.workspaceEnvironment,
  );
  if (!inside(canonical, root) || !checkReadable(canonical).ok)
    throw new Error("Task result path denied.");
  if ((await native.stat(canonical, task.workspaceEnvironment)).kind !== "file")
    throw new Error("The returned file is missing or is not a regular file.");
  if (ownedTask(taskId, sessionId) !== task)
    throw new Error("Task changed while opening its result.");
  opener(canonical);
}

export async function readTaskArtifact(
  taskId: string,
  sessionId: string,
  artifactId: string,
) {
  const task = ownedTask(taskId, sessionId);
  const artifact = task.result?.artifacts.find((a) => a.id === artifactId);
  if (
    !artifact ||
    artifact.workspaceId !== task.workspaceId ||
    !Number.isSafeInteger(artifact.contentRef.byteSize) ||
    artifact.byteSize !== artifact.contentRef.byteSize ||
    artifact.contentRef.byteSize > 20 * 1024 * 1024 ||
    artifact.contentRef.byteSize < 0 ||
    task.recovery?.contentIssues?.some(
      (issue) => issue.role === "returned" && issue.artifactId === artifactId,
    )
  )
    throw new Error(
      "Returned artifact unavailable. No filesystem substitute was read.",
    );
  const bytes = await loadAttachmentContent(artifact.contentRef.id);
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  if (
    bytes.length !== artifact.contentRef.byteSize ||
    hash !== artifact.contentRef.contentHash ||
    artifact.contentRef.id !== hash
  )
    throw new Error("Returned artifact integrity check failed.");
  if (ownedTask(taskId, sessionId) !== task)
    throw new Error("Task changed while reading its artifact.");
  if (!["text", "selection"].includes(artifact.contentKind))
    return {
      name: artifact.displayName,
      text: "Binary artifact retained. Inline text preview is unavailable for this format.",
      truncated: false,
    };
  const limit = 128 * 1024;
  return {
    name: artifact.displayName,
    text: new TextDecoder().decode(bytes.slice(0, limit)),
    truncated: bytes.length > limit,
  };
}

export async function checkTaskRetry(taskId: string, sessionId: string) {
  const task = ownedTask(taskId, sessionId);
  const target = useChatStore.getState().sessions.find(
    (s) => s.id === task.targetSessionId,
  );
  const liveChat = getChat(task.targetSessionId);
  const messages = liveChat?.messages ?? [];
  const validate = () => {
    if (
      ownedTask(taskId, sessionId) !== task ||
      useChatStore.getState().sessions.find((s) => s.id === target?.id) !== target ||
      getChat(task.targetSessionId) !== liveChat ||
      (liveChat && liveChat.messages !== messages) ||
      !taskRetryEligibility(task, target, messages)
    )
      throw new Error("This task cannot be retried without reviewing its effects or changed identity.");
    if (usePeerTaskStore.getState().tasks.some((t) =>
      t.retryOfTaskId === task.id ||
      (t.targetSessionId === task.targetSessionId &&
        ["running", "queued", "waiting"].includes(t.status)),
    ))
      throw new Error("Another attempt is already assigned to this conversation.");
    if (!usePeerTaskStore.getState().recoveryReady)
      throw new Error("Task recovery must finish before retrying.");
  };
  validate();
  const records = await executionHistory(task.targetSessionId);
  if (records.some((r) =>
    (r.runId == null || (task.preRunFailure
      ? !Number.isFinite(r.createdAt) || r.createdAt >= (task.startedAt ?? task.createdAt)
      : r.runId === target?.run?.startedAt)) &&
    !replaySafeExecution(r, task, target?.run?.startedAt ?? -1),
  ))
    throw new Error("Previous tool executions require review; no request was replayed.");
  if (!taskRetryEligibility(task, target, messages, records))
    throw new Error("Previous tool executions require review; no request was replayed.");
  if (task.executionMode === "isolated-worktree") {
    const status = await native.gitStatus(task.workspaceRoot);
    if (status.truncated || status.changedFiles.length)
      throw new Error("Commit or stash changes in Source Control, then check retry availability.");
  }
  validate();
  return task;
}

export async function retryTaskWithoutEffects(
  taskId: string,
  sessionId: string,
) {
  if (usePeerTaskStore.getState().retryingTaskIds.includes(taskId))
    throw new Error("Task retry already being checked.");
  usePeerTaskStore.setState((s) => ({
    retryingTaskIds: [...s.retryingTaskIds, taskId],
  }));
  try {
    const task = await checkTaskRetry(taskId, sessionId);
    const { requestPeerTask } = await import(
      "@/modules/ai/lib/peerTaskCoordinator"
    );
    if (ownedTask(taskId, sessionId) !== task)
      throw new Error("Task changed during retry checks.");
    const result = await requestPeerTask({
      sourceSessionId: task.sourceSessionId,
      targetSessionId: task.targetSessionId,
      kind: task.kind,
      prompt: task.prompt,
      executionMode: task.executionMode,
      dependsOn: task.dependsOn,
      retryOfTaskId: task.id,
      awaitCompletion: false,
    });
    if (!result.ok) throw new Error(result.message);
    return result.task;
  } finally {
    usePeerTaskStore.setState((s) => ({
      retryingTaskIds: s.retryingTaskIds.filter((id) => id !== taskId),
    }));
  }
}
