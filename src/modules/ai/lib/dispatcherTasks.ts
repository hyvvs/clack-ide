import type { PeerTask } from "@/modules/ai/lib/peerTasks";
import type { SessionMeta } from "@/modules/ai/lib/sessions";
import { pendingPeerQuestion } from "@/modules/ai/lib/peerCommunication";
import { taskWorkGroup, type WorkGroup } from "@/modules/ai/lib/taskPresentation";
import { isPeerTaskActive } from "@/modules/ai/lib/peerTaskCancellation";
import { inferenceLabel, type InferenceSnapshot } from "@/modules/ai/lib/inferenceLifecycle";

export const dispatcherTaskGroups: [WorkGroup, string][] = [
  ["attention", "Needs attention"], ["active", "Active"], ["completed", "Completed"],
];

export function visibleDispatcherTasks(tasks: readonly PeerTask[], sessions: readonly SessionMeta[], group?: WorkGroup, archived = false): PeerTask[] {
  const available = availableDispatcherTasks(tasks, sessions).filter(t => Boolean(t.archivedAt) === archived);
  return dispatcherTaskGroups.flatMap(([key]) => group && group !== key ? [] : available.filter((task) => taskWorkGroup(task) === key));
}

export function dispatcherTaskNeighbors(visible: readonly PeerTask[], selectedId: string | null) {
  const index = visible.findIndex((task) => task.id === selectedId);
  return {
    index, count: visible.length,
    previous: index > 0 ? visible[index - 1] : undefined,
    next: index >= 0 ? visible[index + 1] : undefined,
  };
}

export function workspaceDispatcherTasks(
  tasks: readonly PeerTask[],
  workspaceId: string | null | undefined,
): PeerTask[] {
  if (!workspaceId) return [];
  return tasks
    .filter((task) => task.workspaceId === workspaceId)
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

export function availableDispatcherTasks(tasks: readonly PeerTask[], sessions: readonly SessionMeta[]): PeerTask[] {
  return tasks.filter(task => dispatcherTaskConversation(task, sessions) !== null).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

export function dispatcherActiveCount(tasks: readonly PeerTask[], managing: readonly string[] = []): number {
  return tasks.filter(task => isPeerTaskActive(task) || (managing.includes(task.id) && task.changeSet?.patch && !task.changeSet.appliedAt)).length;
}

export function taskLifecycleTimes(task: PeerTask, locale?: string, timeZone?: string) {
  const format = new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone,
  });
  return ([["Created", task.createdAt], ["Started", task.startedAt], ["Ended", task.endedAt], ["Archived", task.archivedAt]] as const)
    .flatMap(([label, at]) => at !== undefined && Number.isFinite(at) && at >= 0 && at <= 8.64e15 ? [{ label, at, text: format.format(at) }] : []);
}

export function dispatcherTaskStatus(task: PeerTask, inference?: InferenceSnapshot | null, live: { preparing?: boolean; approval?: boolean; applying?: boolean; finalizing?: boolean } = {}): string {
  if (live.applying) return "Applying";
  if (pendingPeerQuestion(task)) return "Waiting for clarification";
  switch (task.status) {
    case "queued":
      return "Queued";
    case "running":
      if (live.finalizing) return "Finalizing result";
      if (live.approval) return "Waiting for approval";
      if (inference?.phase === "queued" || inference?.phase === "awaiting-admission") return "Waiting for model capacity";
      if (inference?.phase === "generating") return "In progress";
      if (inference) return inferenceLabel(inference);
      return live.preparing ? "Preparing" : "In progress";
    case "waiting":
      return "Waiting for required tasks";
    case "blocked":
      return "Blocked";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

export function dispatcherTaskConversation(
  task: PeerTask,
  sessions: readonly SessionMeta[],
): string | null {
  return (
    [task.sourceSessionId, task.targetSessionId].find((id) =>
      sessions.some(
        (session) =>
          session.id === id &&
          session.profile?.workspaceId === task.workspaceId,
      ),
    ) ?? null
  );
}
