import { workspacePathsEqual } from "@/modules/workspace";
import type { AttachmentContentIssue } from "./attachmentStore";
import { reconcilePeerTaskDependencies } from "./peerTaskDependencies";
import {
  collectPeerTaskContentReferences,
  recoverInterruptedPeerTasks,
  type PeerTask,
  type PeerTaskRecovery,
  type PeerTaskRecoveryContentIssue,
} from "./peerTasks";
import type { SessionMeta } from "./sessions";

export type WorktreeRecoveryInspection = {
  taskId: string;
  state: "available" | "missing" | "invalid";
  message?: string;
};

export type PeerTaskRecoveryContext = {
  sessions: readonly SessionMeta[];
  contentIssues: readonly AttachmentContentIssue[];
  worktrees: readonly WorktreeRecoveryInspection[];
  isAgentConfigured?: (agentId: string) => boolean;
  isModelConfigured?: (modelId: string) => boolean;
  now?: number;
};

export function recoverPeerTasks(
  tasks: readonly PeerTask[],
  context: PeerTaskRecoveryContext,
): PeerTask[] {
  const now = context.now ?? Date.now();
  let recovered = recoverInterruptedPeerTasks(tasks, now).map((task) =>
    validateActiveTask(task, context, now),
  );
  recovered = reconcilePeerTaskDependencies(recovered, now);
  recovered = applyContentRecovery(recovered, context.contentIssues, now);
  recovered = reconcilePeerTaskDependencies(recovered, now);
  return applyWorktreeRecovery(recovered, context.worktrees);
}

function validateActiveTask(
  task: PeerTask,
  context: PeerTaskRecoveryContext,
  now: number,
): PeerTask {
  if (task.status !== "queued" && task.status !== "waiting") return task;
  const source = context.sessions.find(
    (session) => session.id === task.sourceSessionId,
  );
  const target = context.sessions.find(
    (session) => session.id === task.targetSessionId,
  );
  if (!source) {
    return failRecoveredTask(
      task,
      "peer_source_missing",
      "The requesting conversation no longer exists.",
      now,
    );
  }
  if (!target) {
    return failRecoveredTask(
      task,
      "peer_target_missing",
      "The target conversation no longer exists.",
      now,
    );
  }
  const sourceMatches =
    source.profile?.workspaceId === task.workspaceId &&
    Boolean(
      source.profile.workspaceRoot &&
        workspacePathsEqual(source.profile.workspaceRoot, task.workspaceRoot),
    );
  const targetMatches =
    target.profile?.workspaceId === task.workspaceId &&
    Boolean(
      target.profile.workspaceRoot &&
        workspacePathsEqual(target.profile.workspaceRoot, task.workspaceRoot),
    );
  if (!sourceMatches || !targetMatches) {
    return failRecoveredTask(
      task,
      "peer_workspace_mismatch",
      "This queued task no longer belongs to the same workspace as its conversations.",
      now,
    );
  }
  if (
    target.profile?.agentId !== task.targetAgentId ||
    target.profile?.modelId !== task.targetModelId
  ) {
    return failRecoveredTask(
      task,
      "peer_target_configuration_changed",
      "The target conversation's agent or model changed while this task was queued. Create the task again to use the new configuration.",
      now,
    );
  }
  if (
    !target.profile.agentId ||
    (context.isAgentConfigured &&
      !context.isAgentConfigured(target.profile.agentId))
  ) {
    return failRecoveredTask(
      task,
      "peer_target_agent_unavailable",
      "The target conversation's agent is no longer available.",
      now,
    );
  }
  if (
    !target.profile.modelId ||
    (context.isModelConfigured &&
      !context.isModelConfigured(target.profile.modelId))
  ) {
    return failRecoveredTask(
      task,
      "peer_target_model_unavailable",
      "The target conversation's model is no longer configured.",
      now,
    );
  }
  return task;
}

function applyContentRecovery(
  tasks: readonly PeerTask[],
  contentIssues: readonly AttachmentContentIssue[],
  now: number,
): PeerTask[] {
  const issueById = new Map(contentIssues.map((issue) => [issue.id, issue]));
  const referencesByTask = new Map<
    string,
    ReturnType<typeof collectPeerTaskContentReferences>
  >();
  for (const reference of collectPeerTaskContentReferences(tasks)) {
    const references = referencesByTask.get(reference.taskId) ?? [];
    references.push(reference);
    referencesByTask.set(reference.taskId, references);
  }
  return tasks.map((task) => {
    const issues = (referencesByTask.get(task.id) ?? []).flatMap((reference) => {
      const issue = issueById.get(reference.contentId);
      return issue
        ? [
            {
              artifactId: reference.artifactId,
              contentId: reference.contentId,
              role: reference.role,
              representation: reference.representation,
              code: issue.code,
              message: issue.message,
            } satisfies PeerTaskRecoveryContentIssue,
          ]
        : [];
    });
    const withIssues = setRecovery(task, {
      ...task.recovery,
      contentIssues: issues.length > 0 ? issues : undefined,
    });
    const inputIssue = issues.find((issue) => issue.role === "input");
    if (
      !inputIssue ||
      (withIssues.status !== "queued" && withIssues.status !== "waiting")
    ) {
      return withIssues;
    }
    const integrity =
      inputIssue.code === "attachment_content_integrity_failed";
    return failRecoveredTask(
      withIssues,
      integrity
        ? "peer_artifact_integrity_failed"
        : "peer_artifact_unavailable",
      integrity
        ? "A queued attachment failed integrity validation and was not sent. Create the task again with a trusted attachment."
        : "A queued attachment is unavailable and the task cannot continue. Create the task again with the attachment.",
      now,
    );
  });
}

function applyWorktreeRecovery(
  tasks: readonly PeerTask[],
  inspections: readonly WorktreeRecoveryInspection[],
): PeerTask[] {
  const byTask = new Map(inspections.map((inspection) => [inspection.taskId, inspection]));
  return tasks.map((task) => {
    if (!task.worktree) return task;
    const inspection = byTask.get(task.id);
    if (!inspection) return task;
    return setRecovery(task, {
      ...task.recovery,
      worktree:
        inspection.state === "available"
          ? undefined
          : {
              state: inspection.state,
              message:
                inspection.message ??
                "The preserved worktree is no longer available.",
            },
    });
  });
}

function failRecoveredTask(
  task: PeerTask,
  code: string,
  message: string,
  now: number,
): PeerTask {
  return {
    ...task,
    status: "failed",
    error: { code, message },
    endedAt: now,
    updatedAt: now,
  };
}

function setRecovery(task: PeerTask, recovery: PeerTaskRecovery): PeerTask {
  const normalized: PeerTaskRecovery = {
    ...(recovery.interruption
      ? { interruption: recovery.interruption }
      : {}),
    ...(recovery.contentIssues?.length
      ? { contentIssues: recovery.contentIssues }
      : {}),
    ...(recovery.worktree ? { worktree: recovery.worktree } : {}),
  };
  return {
    ...task,
    recovery:
      normalized.interruption ||
      normalized.contentIssues?.length ||
      normalized.worktree
        ? normalized
        : undefined,
  };
}
