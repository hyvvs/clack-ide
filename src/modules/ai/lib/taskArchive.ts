import type { PeerTask } from "@/modules/ai/lib/peerTasks";
import { pendingPeerQuestion } from "@/modules/ai/lib/peerCommunication";
import { isPeerTaskActive } from "@/modules/ai/lib/peerTaskCancellation";

export function taskArchiveEligible(
  task: PeerTask,
  tasks: readonly PeerTask[],
  busyIds: readonly string[] = [],
): boolean {
  if (
    isPeerTaskActive(task) ||
    pendingPeerQuestion(task) ||
    busyIds.includes(task.id)
  )
    return false;
  const requires = (candidate: PeerTask, seen = new Set<string>()): boolean => {
    if (seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return [
      ...candidate.dependsOn,
      ...(candidate.parentTaskId ? [candidate.parentTaskId] : []),
    ].some(
      (id) =>
        id === task.id || tasks.some((t) => t.id === id && requires(t, seen)),
    );
  };
  return !tasks.some(
    (t) =>
      t.id !== task.id &&
      (isPeerTaskActive(t) || pendingPeerQuestion(t)) &&
      requires(t),
  );
}

export function finishedTasksToArchive(
  tasks: readonly PeerTask[],
  busyIds: readonly string[] = [],
): PeerTask[] {
  return tasks.filter(
    (t) =>
      !t.archivedAt &&
      t.status === "completed" &&
      !t.recovery &&
      !t.worktree &&
      !(t.changeSet?.patch && !t.changeSet.appliedAt) &&
      taskArchiveEligible(t, tasks, busyIds),
  );
}
