import type { PeerTask } from "@/modules/ai/lib/peerTasks";
import type { SessionMeta } from "@/modules/ai/lib/sessions";
import { pendingPeerQuestion } from "@/modules/ai/lib/peerCommunication";
import { taskWorkGroup, type WorkGroup } from "@/modules/ai/lib/taskPresentation";

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

export function dispatcherTaskStatus(task: PeerTask): string {
  if (pendingPeerQuestion(task)) return "Waiting for clarification";
  switch (task.status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
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
