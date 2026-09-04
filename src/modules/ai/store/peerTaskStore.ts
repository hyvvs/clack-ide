import { create } from "zustand";
import {
  compactPeerTasks,
  loadPeerTasks,
  savePeerTasks,
  type PeerTask,
  type PeerTaskChangeSet,
  type PeerTaskError,
  type PeerTaskResult,
} from "../lib/peerTasks";
import {
  applyPeerTaskCancellationTargets,
  type PeerTaskCancellationTarget,
} from "../lib/peerTaskCancellation";
import {
  reconcilePeerTaskDependencies,
  recoverPeerTaskLedger,
} from "../lib/peerTaskDependencies";

type PeerTaskStore = {
  hydrated: boolean;
  tasks: PeerTask[];
  hydrate: () => Promise<void>;
  add: (task: PeerTask) => void;
  claim: (id: string) => PeerTask | null;
  setWorktree: (
    id: string,
    worktree: { checkoutRoot: string; baseSha: string },
  ) => void;
  clearWorktree: (id: string) => void;
  setChangeSet: (id: string, changeSet: PeerTaskChangeSet) => void;
  markChangeSetApplied: (id: string) => void;
  setChangeSetApplyError: (id: string, message: string) => void;
  complete: (id: string, result: PeerTaskResult) => void;
  fail: (id: string, error: PeerTaskError) => void;
  cancel: (
    targets: readonly PeerTaskCancellationTarget[],
  ) => PeerTaskCancellationTarget[];
};

function persist(tasks: PeerTask[]): void {
  void savePeerTasks(tasks);
}

function bounded(tasks: PeerTask[]): PeerTask[] {
  return compactPeerTasks(tasks);
}

function reconciled(tasks: PeerTask[]): PeerTask[] {
  return bounded(reconcilePeerTaskDependencies(tasks));
}

export const usePeerTaskStore = create<PeerTaskStore>((set, get) => ({
  hydrated: false,
  tasks: [],
  hydrate: async () => {
    const loaded = await loadPeerTasks();
    const recovered = bounded(recoverPeerTaskLedger(loaded));
    set({ tasks: recovered, hydrated: true });
    persist(recovered);
  },
  add: (task) => {
    const tasks = reconciled([task, ...get().tasks]);
    set({ tasks });
    persist(tasks);
  },
  claim: (id) => {
    const task = get().tasks.find((item) => item.id === id);
    if (task?.status !== "queued") return null;
    const now = Date.now();
    const claimed = {
      ...task,
      status: "running" as const,
      startedAt: now,
      updatedAt: now,
    };
    const tasks = get().tasks.map((item) => (item.id === id ? claimed : item));
    set({ tasks });
    persist(tasks);
    return claimed;
  },
  setWorktree: (id, worktree) => {
    const tasks = get().tasks.map((task) =>
      task.id === id ? { ...task, worktree, updatedAt: Date.now() } : task,
    );
    set({ tasks });
    persist(tasks);
  },
  clearWorktree: (id) => {
    const tasks = get().tasks.map((task) =>
      task.id === id
        ? { ...task, worktree: undefined, updatedAt: Date.now() }
        : task,
    );
    set({ tasks });
    persist(tasks);
  },
  setChangeSet: (id, changeSet) => {
    const tasks = get().tasks.map((task) =>
      task.id === id
        ? { ...task, changeSet, worktree: undefined, updatedAt: Date.now() }
        : task,
    );
    set({ tasks });
    persist(tasks);
  },
  markChangeSetApplied: (id) => {
    const tasks = get().tasks.map((task) =>
      task.id === id && task.changeSet
        ? {
            ...task,
            changeSet: {
              ...task.changeSet,
              appliedAt: Date.now(),
              applyError: undefined,
            },
            updatedAt: Date.now(),
          }
        : task,
    );
    set({ tasks });
    persist(tasks);
  },
  setChangeSetApplyError: (id, message) => {
    const tasks = get().tasks.map((task) =>
      task.id === id && task.changeSet
        ? {
            ...task,
            changeSet: { ...task.changeSet, applyError: message },
            updatedAt: Date.now(),
          }
        : task,
    );
    set({ tasks });
    persist(tasks);
  },
  complete: (id, result) => {
    const now = Date.now();
    const tasks = reconciled(
      get().tasks.map((item) =>
        item.id === id && item.status === "running"
          ? {
              ...item,
              status: "completed" as const,
              result,
              error: undefined,
              endedAt: now,
              updatedAt: now,
            }
          : item,
      ),
    );
    set({ tasks });
    persist(tasks);
  },
  fail: (id, error) => {
    const now = Date.now();
    const tasks = reconciled(
      get().tasks.map((item) =>
        item.id === id &&
        (item.status === "waiting" ||
          item.status === "queued" ||
          item.status === "running")
          ? {
              ...item,
              status: "failed" as const,
              error,
              endedAt: now,
              updatedAt: now,
            }
          : item,
      ),
    );
    set({ tasks });
    persist(tasks);
  },
  cancel: (targetsToCancel) => {
    const cancelled = applyPeerTaskCancellationTargets(
      get().tasks,
      targetsToCancel,
    );
    const tasks = reconciled(cancelled.tasks);
    set({ tasks });
    persist(tasks);
    return cancelled.transitions;
  },
}));
