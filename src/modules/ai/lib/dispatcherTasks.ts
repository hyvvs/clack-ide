import type { PeerTask } from "@/modules/ai/lib/peerTasks";
import type { SessionMeta } from "@/modules/ai/lib/sessions";
import { pendingPeerQuestion } from "@/modules/ai/lib/peerCommunication";

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
