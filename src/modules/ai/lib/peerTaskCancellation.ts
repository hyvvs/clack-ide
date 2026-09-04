import {
  PEER_TASK_MAX_HOPS,
  PEER_TASK_MAX_PER_ROOT,
  type PeerTask,
  type PeerTaskCancellation,
} from "./peerTasks";

export type PeerTaskCancellationRequest = {
  taskId: string;
  cascade: boolean;
  actor: "user" | "programmatic";
  reason?: string;
  authorizedRootTaskId?: string;
};

export type PeerTaskCancellationTarget = {
  taskId: string;
  previousStatus: "waiting" | "queued" | "running";
  cancellation: PeerTaskCancellation;
};

export type PeerTaskCancellationPlan =
  | {
      ok: true;
      task: PeerTask;
      targets: PeerTaskCancellationTarget[];
      activeDescendantCount: number;
      alreadyTerminal: boolean;
    }
  | { ok: false; code: string; message: string };

export type ActivePeerTaskStatus = "waiting" | "queued" | "running";

export function isPeerTaskActive<T extends Pick<PeerTask, "status">>(
  task: T,
): task is T & { status: ActivePeerTaskStatus } {
  return (
    task.status === "waiting" ||
    task.status === "queued" ||
    task.status === "running"
  );
}

export function planPeerTaskCancellation(
  request: PeerTaskCancellationRequest,
  tasks: readonly PeerTask[],
  now = Date.now(),
): PeerTaskCancellationPlan {
  const task = tasks.find((candidate) => candidate.id === request.taskId);
  if (!task) {
    return {
      ok: false,
      code: "peer_cancellation_missing",
      message: "The peer task no longer exists.",
    };
  }
  if (
    request.authorizedRootTaskId &&
    task.rootTaskId !== request.authorizedRootTaskId
  ) {
    return {
      ok: false,
      code: "peer_cancellation_scope",
      message: "A peer task may cancel work only within its collaboration.",
    };
  }
  if (!isPeerTaskActive(task)) {
    return {
      ok: true,
      task,
      targets: [],
      activeDescendantCount: 0,
      alreadyTerminal: true,
    };
  }

  const descendants = request.cascade
    ? collectPeerTaskDescendants(task, tasks)
    : { ok: true as const, tasks: [] };
  if (!descendants.ok) return descendants;
  const activeDescendants = descendants.tasks.filter(isPeerTaskActive);
  const reason = normalizeCancellationReason(request.reason, request.actor);
  const rootCause = task.id === task.rootTaskId;
  const targets = [task, ...activeDescendants].map(
    (candidate): PeerTaskCancellationTarget => ({
      taskId: candidate.id,
      previousStatus: candidate.status as "waiting" | "queued" | "running",
      cancellation: {
        actor: request.actor,
        cause:
          candidate.id === task.id
            ? "direct"
            : rootCause
              ? "orchestration"
              : "parent",
        requestedTaskId: task.id,
        cancelledByTaskId: candidate.id === task.id ? undefined : task.id,
        reason,
        cancelledAt: now,
        cancelledDescendantCount:
          candidate.id === task.id ? activeDescendants.length : undefined,
      },
    }),
  );
  return {
    ok: true,
    task,
    targets,
    activeDescendantCount: activeDescendants.length,
    alreadyTerminal: false,
  };
}

export function activePeerTaskDescendants(
  taskId: string,
  tasks: readonly PeerTask[],
): PeerTask[] {
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task) return [];
  const descendants = collectPeerTaskDescendants(task, tasks);
  return descendants.ok ? descendants.tasks.filter(isPeerTaskActive) : [];
}

export function applyPeerTaskCancellationTargets(
  tasks: readonly PeerTask[],
  targets: readonly PeerTaskCancellationTarget[],
): { tasks: PeerTask[]; transitions: PeerTaskCancellationTarget[] } {
  const requested = new Map(targets.map((target) => [target.taskId, target]));
  const transitions: PeerTaskCancellationTarget[] = [];
  const next = tasks.map((task) => {
    const target = requested.get(task.id);
    if (!target || !isPeerTaskActive(task)) return task;
    transitions.push({ ...target, previousStatus: task.status });
    return {
      ...task,
      status: "cancelled" as const,
      cancellation: target.cancellation,
      endedAt: target.cancellation.cancelledAt,
      updatedAt: target.cancellation.cancelledAt,
    };
  });
  return { tasks: next, transitions };
}

function collectPeerTaskDescendants(
  root: PeerTask,
  tasks: readonly PeerTask[],
):
  | { ok: true; tasks: PeerTask[] }
  | { ok: false; code: string; message: string } {
  const childrenByParent = new Map<string, PeerTask[]>();
  for (const task of tasks) {
    if (
      task.id === root.id ||
      task.rootTaskId !== root.rootTaskId ||
      !task.parentTaskId
    ) {
      continue;
    }
    const children = childrenByParent.get(task.parentTaskId) ?? [];
    children.push(task);
    childrenByParent.set(task.parentTaskId, children);
  }
  for (const children of childrenByParent.values()) {
    children.sort(
      (left, right) =>
        left.createdAt - right.createdAt || left.id.localeCompare(right.id),
    );
  }

  const descendants: PeerTask[] = [];
  const visited = new Set([root.id]);
  const queue = [{ task: root, depth: 0 }];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const child of childrenByParent.get(current.task.id) ?? []) {
      if (visited.has(child.id)) continue;
      const depth = current.depth + 1;
      if (depth > PEER_TASK_MAX_HOPS) {
        return {
          ok: false,
          code: "peer_cancellation_depth",
          message: `Peer-task cancellation is limited to ${PEER_TASK_MAX_HOPS} descendant levels.`,
        };
      }
      visited.add(child.id);
      descendants.push(child);
      if (descendants.length + 1 > PEER_TASK_MAX_PER_ROOT) {
        return {
          ok: false,
          code: "peer_cancellation_limit",
          message: `Peer-task cancellation is limited to ${PEER_TASK_MAX_PER_ROOT} tasks in one collaboration.`,
        };
      }
      queue.push({ task: child, depth });
    }
  }
  return { ok: true, tasks: descendants };
}

function normalizeCancellationReason(
  reason: string | undefined,
  actor: PeerTaskCancellation["actor"],
): string {
  const normalized = reason?.trim().replace(/\s+/g, " ");
  if (normalized) return normalized.slice(0, 500);
  return actor === "user"
    ? "Cancelled by user."
    : "Cancelled programmatically.";
}
