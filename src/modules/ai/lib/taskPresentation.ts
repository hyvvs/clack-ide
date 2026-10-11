import type { UIMessage } from "ai";
import type { PeerTask, PeerTaskArtifact } from "@/modules/ai/lib/peerTasks";
import type { SessionMeta } from "@/modules/ai/lib/sessions";
import { pendingPeerQuestion } from "@/modules/ai/lib/peerCommunication";
import { replaySafeMessages } from "@/modules/ai/lib/taskRetryEffects";
import type { ExecutionRecord } from "@/modules/ai/lib/customToolExecution";

export type WorkGroup = "attention" | "active" | "completed";
export function taskWorkGroup(task: PeerTask): WorkGroup {
  if (
    pendingPeerQuestion(task) ||
    task.status === "failed" ||
    task.status === "blocked" ||
    (task.changeSet?.patch && !task.changeSet.appliedAt)
  )
    return "attention";
  return ["running", "queued", "waiting"].includes(task.status)
    ? "active"
    : "completed";
}

export function taskOutcomeLabel(task: PeerTask): string {
  if (task.changeSet?.changedPaths.length) {
    const count = task.changeSet.changedPaths.length;
    return `${count} ${count === 1 ? "file" : "files"} changed${task.changeSet.appliedAt ? " - Applied" : " - Review required"}`;
  }
  if (task.result?.artifacts.length)
    return `Returned ${task.result.artifacts.map((a) => a.displayName).join(", ")}`;
  if (task.result?.summary.trim()) return "Result available";
  return "No files or artifacts returned";
}

export function taskFailure(task: PeerTask) {
  if (task.error?.code === "peer_handoff_preparation_stale" || task.error?.code === "peer_handoff_preparation_deadline")
    return {
      kind: "setup" as const,
      title: task.error.code === "peer_handoff_preparation_deadline"
        ? "Task setup timed out before the Agent started."
        : "Task setup changed before the Agent started.",
      detail: task.preRunFailure && !task.worktree && !task.changeSet && !task.recovery
        ? "Nothing was sent or changed. Retry the task using the latest configuration."
        : "Review the preserved task setup and any uncertain effects before assigning it again.",
    };
  if (
    /uncommitted changes|dirty (?:workspace|worktree)/i.test(
      task.error?.message ?? "",
    )
  )
    return {
      kind: "dirty" as const,
      title:
        "The isolated task couldn't start because your project has uncommitted changes.",
      detail:
        "Commit or stash your changes in Source Control, then check retry availability. Clack will not commit or stash them for you.",
    };
  if (
    /rate.?limit|too many requests|\b429\b/i.test(
      `${task.error?.code} ${task.error?.message}`,
    )
  )
    return {
      kind: "rate-limit" as const,
      title: "This model is temporarily rate-limited.",
      detail: "The previous task and any completed effects are preserved.",
    };
  if (/authentication|authorization|invalid.*(?:key|credential)|\b40[13]\b/i.test(`${task.error?.code} ${task.error?.message}`))
    return {
      kind: "auth" as const,
      title: "This task's connection needs attention.",
      detail: "Fix the connection before assigning new work. Invalid credentials are not retried.",
    };
  return {
    kind: "other" as const,
    title: "The Agent couldn't complete this task.",
    detail:
      "Review the task conversation before assigning more work. Completed or uncertain effects must not be replayed.",
  };
}

export function taskRetryEligibility(
  task: PeerTask,
  target: SessionMeta | undefined,
  messages: UIMessage[],
  records?: ExecutionRecord[],
): boolean {
  const run = target?.run;
  if (
    task.status !== "failed" ||
    task.result ||
    task.changeSet ||
    task.worktree ||
    task.recovery ||
    target?.profile?.workspaceId !== task.workspaceId ||
    target.profile.agentId !== task.targetAgentId ||
    target.profile.modelId !== task.targetModelId ||
    run?.state === "running" ||
    taskFailure(task).kind === "auth"
  )
    return false;
  if (task.preRunFailure) return run?.peerTaskId !== task.id;
  if (
    run?.peerTaskId !== task.id || run.state !== "failed" ||
    run.agentId !== task.targetAgentId || run.modelId !== task.targetModelId ||
    !run.error ||
    !(["rate_limit", "provider_unavailable", "model_loading", "backend_restart", "network", "timeout"].includes(run.error.kind) ||
      (run.error.kind === "bad_request" && run.error.title === "Context preflight"))
  ) return false;
  let lastUser = messages.length - 1;
  while (lastUser >= 0 && messages[lastUser].role !== "user") lastUser--;
  if (lastUser < 0) return false;
  return replaySafeMessages(task, messages, run.startedAt, records);
}

export function artifactFilePath(
  task: PeerTask,
  artifact: PeerTaskArtifact,
): string | null {
  if (
    artifact.workspaceId !== task.workspaceId ||
    !artifact.sourcePath ||
    !["workspace-file", "generated-file", "worktree-file"].includes(
      artifact.originType,
    )
  )
    return null;
  if (task.executionMode === "isolated-worktree" && !task.changeSet?.appliedAt)
    return null;
  if (artifact.originType === "worktree-file") return null;
  return artifact.sourcePath;
}

export function taskAccessLabel(task: PeerTask): string {
  return task.executionMode === "read-only"
    ? "Read-only workspace access"
    : task.executionMode === "isolated-worktree"
      ? "Can edit an isolated copy; changes need review and apply"
      : "Can edit this workspace, subject to permissions and approvals";
}
