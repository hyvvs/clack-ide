import {
  PEER_TASK_MAX_DEPENDENCIES,
  PEER_TASK_MAX_DEPENDENCY_DEPTH,
  PEER_TASK_MAX_RUNNING,
  recoverInterruptedPeerTasks,
  type PeerTask,
  type PeerTaskDependencyBlockStatus,
} from "./peerTasks";

export type PeerTaskDependencyValidation =
  | { ok: true; dependsOn: string[]; depth: number }
  | { ok: false; code: string; message: string };

export type PeerTaskDependencyState =
  | { state: "ready" }
  | { state: "waiting"; taskIds: string[] }
  | {
      state: "blocked";
      taskId: string;
      status: PeerTaskDependencyBlockStatus;
    };

export function validatePeerTaskDependencies(
  input: {
    taskId: string;
    rootTaskId: string;
    dependsOn?: readonly string[];
  },
  tasks: readonly PeerTask[],
): PeerTaskDependencyValidation {
  const dependsOn = [...(input.dependsOn ?? [])];
  if (dependsOn.length > PEER_TASK_MAX_DEPENDENCIES) {
    return {
      ok: false,
      code: "peer_dependency_limit",
      message: `A peer task can wait on up to ${PEER_TASK_MAX_DEPENDENCIES} other tasks.`,
    };
  }
  if (new Set(dependsOn).size !== dependsOn.length) {
    return {
      ok: false,
      code: "peer_dependency_duplicate",
      message: "A peer task cannot list the same dependency twice.",
    };
  }
  if (dependsOn.includes(input.taskId)) {
    return {
      ok: false,
      code: "peer_dependency_self",
      message: "A peer task cannot wait on itself.",
    };
  }

  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const dependencyId of dependsOn) {
    const dependency = byId.get(dependencyId);
    if (!dependency) {
      return {
        ok: false,
        code: "peer_dependency_missing",
        message: `Dependency ${dependencyId} does not exist.`,
      };
    }
    if (dependency.rootTaskId !== input.rootTaskId) {
      return {
        ok: false,
        code: "peer_dependency_scope",
        message: "Dependencies must belong to the same collaboration task.",
      };
    }
  }

  const graph = new Map(
    tasks.map((task) => [task.id, task.dependsOn] as const),
  );
  graph.set(input.taskId, dependsOn);
  if (hasDependencyCycle(input.taskId, graph)) {
    return {
      ok: false,
      code: "peer_dependency_cycle",
      message: "This dependency would create a collaboration loop.",
    };
  }
  const depth = dependencyDepth(input.taskId, graph, new Map());
  if (depth > PEER_TASK_MAX_DEPENDENCY_DEPTH) {
    return {
      ok: false,
      code: "peer_dependency_depth",
      message: `Peer-task dependencies are limited to ${PEER_TASK_MAX_DEPENDENCY_DEPTH} levels.`,
    };
  }
  return { ok: true, dependsOn, depth };
}

export function evaluatePeerTaskDependencies(
  task: Pick<PeerTask, "dependsOn">,
  tasks: readonly PeerTask[],
): PeerTaskDependencyState {
  if (task.dependsOn.length === 0) return { state: "ready" };
  const byId = new Map(tasks.map((candidate) => [candidate.id, candidate]));
  const waiting: string[] = [];
  for (const dependencyId of task.dependsOn) {
    const dependency = byId.get(dependencyId);
    if (!dependency) {
      return { state: "blocked", taskId: dependencyId, status: "missing" };
    }
    if (
      dependency.status === "failed" ||
      dependency.status === "cancelled" ||
      dependency.status === "blocked"
    ) {
      return {
        state: "blocked",
        taskId: dependency.id,
        status: dependency.status,
      };
    }
    if (dependency.status !== "completed") waiting.push(dependency.id);
  }
  return waiting.length > 0
    ? { state: "waiting", taskIds: waiting }
    : { state: "ready" };
}

export function reconcilePeerTaskDependencies(
  tasks: readonly PeerTask[],
  now = Date.now(),
): PeerTask[] {
  let current = [...tasks];
  for (let pass = 0; pass < tasks.length; pass += 1) {
    let changed = false;
    const next = current.map((task) => {
      if (task.status !== "waiting" && task.status !== "queued") {
        return task;
      }
      if (task.dependsOn.length === 0) {
        if (task.status === "queued") return task;
        changed = true;
        return { ...task, status: "queued" as const, updatedAt: now };
      }
      const dependencyState = evaluatePeerTaskDependencies(task, current);
      if (dependencyState.state === "blocked") {
        changed = true;
        return {
          ...task,
          status: "blocked" as const,
          updatedAt: now,
          endedAt: now,
          dependenciesSatisfiedAt: undefined,
          blockedByTaskId: dependencyState.taskId,
          blockedByStatus: dependencyState.status,
          error: {
            code: "peer_dependency_blocked",
            message: dependencyBlockMessage(
              dependencyState.taskId,
              dependencyState.status,
            ),
          },
        };
      }
      if (dependencyState.state === "ready") {
        if (
          task.status === "queued" &&
          task.dependenciesSatisfiedAt !== undefined
        ) {
          return task;
        }
        changed = true;
        return {
          ...task,
          status: "queued" as const,
          updatedAt: now,
          dependenciesSatisfiedAt: task.dependenciesSatisfiedAt ?? now,
          blockedByTaskId: undefined,
          blockedByStatus: undefined,
          error: undefined,
        };
      }
      if (task.status === "waiting") return task;
      changed = true;
      return {
        ...task,
        status: "waiting" as const,
        updatedAt: now,
        dependenciesSatisfiedAt: undefined,
      };
    });
    current = next;
    if (!changed) break;
  }
  return current;
}

export function recoverPeerTaskLedger(
  tasks: readonly PeerTask[],
  now = Date.now(),
): PeerTask[] {
  return reconcilePeerTaskDependencies(
    recoverInterruptedPeerTasks(tasks, now),
    now,
  );
}

export function selectDispatchablePeerTaskIds(
  tasks: readonly PeerTask[],
  sessionRunStates: ReadonlyMap<string, string | undefined>,
): string[] {
  let slots =
    PEER_TASK_MAX_RUNNING -
    tasks.filter((task) => task.status === "running").length;
  if (slots <= 0) return [];

  const busyTargets = new Set(
    tasks
      .filter((task) => task.status === "running")
      .map((task) => task.targetSessionId),
  );
  for (const [sessionId, state] of sessionRunStates) {
    if (state === "running") busyTargets.add(sessionId);
  }

  const selected: string[] = [];
  const queued = tasks
    .filter(
      (task) =>
        task.status === "queued" &&
        evaluatePeerTaskDependencies(task, tasks).state === "ready",
    )
    .sort(
      (left, right) =>
        left.createdAt - right.createdAt || left.id.localeCompare(right.id),
    );
  for (const task of queued) {
    if (slots <= 0) break;
    if (busyTargets.has(task.targetSessionId)) continue;
    selected.push(task.id);
    busyTargets.add(task.targetSessionId);
    slots -= 1;
  }
  return selected;
}

function hasDependencyCycle(
  startId: string,
  graph: ReadonlyMap<string, readonly string[]>,
): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (taskId: string): boolean => {
    if (visiting.has(taskId)) return true;
    if (visited.has(taskId)) return false;
    visiting.add(taskId);
    for (const dependencyId of graph.get(taskId) ?? []) {
      if (visit(dependencyId)) return true;
    }
    visiting.delete(taskId);
    visited.add(taskId);
    return false;
  };
  return visit(startId);
}

function dependencyDepth(
  taskId: string,
  graph: ReadonlyMap<string, readonly string[]>,
  memo: Map<string, number>,
): number {
  const cached = memo.get(taskId);
  if (cached !== undefined) return cached;
  const dependencies = graph.get(taskId) ?? [];
  const depth =
    dependencies.length === 0
      ? 0
      : 1 +
        Math.max(
          ...dependencies.map((dependencyId) =>
            dependencyDepth(dependencyId, graph, memo),
          ),
        );
  memo.set(taskId, depth);
  return depth;
}

function dependencyBlockMessage(
  taskId: string,
  status: PeerTaskDependencyBlockStatus,
): string {
  if (status === "missing") return `Required task ${taskId} is unavailable.`;
  return `Required task ${taskId} ${status}.`;
}
