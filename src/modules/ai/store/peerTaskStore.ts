import { create } from "zustand";
import {
  collectPeerTaskContentIds,
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
} from "../lib/peerTaskDependencies";
import { reconcilePersistedAttachmentContent } from "../lib/sessions";
import type { SessionMeta } from "../lib/sessions";
import { native } from "../lib/native";
import { recoverPeerTasks } from "../lib/restartRecovery";

type PeerTaskStore = {
  hydrated: boolean;
  recoveryReady: boolean;
  recoveryError: string | null;
  tasks: PeerTask[];
  hydrate: (context: {
    sessions: readonly SessionMeta[];
    isAgentConfigured: (agentId: string) => boolean;
    isModelConfigured: (modelId: string) => boolean;
  }) => Promise<void>;
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
  recoveryReady: false,
  recoveryError: null,
  tasks: [],
  hydrate: async (context) => {
    if (get().hydrated) return;
    let recoveredWithoutStorage: PeerTask[] | null = null;
    try {
      const loaded = await loadPeerTasks();
      const now = Date.now();
      const baseContext = {
        sessions: context.sessions,
        contentIssues: [],
        worktrees: [],
        isAgentConfigured: context.isAgentConfigured,
        isModelConfigured: context.isModelConfigured,
        now,
      } as const;
      recoveredWithoutStorage = bounded(recoverPeerTasks(loaded, baseContext));
      const content = await reconcilePersistedAttachmentContent(
        collectPeerTaskContentIds(recoveredWithoutStorage),
      );
      const worktrees = await Promise.all(
        recoveredWithoutStorage.flatMap((task) => {
          if (!task.worktree) return [];
          return [
            native
              .gitAgentWorktreeInspect(
                task.id,
                task.worktree.checkoutRoot,
                task.worktree.baseSha,
              )
              .then((inspection) => ({ taskId: task.id, ...inspection }))
              .catch(() => ({
                taskId: task.id,
                state: "invalid" as const,
                message: "Clack could not validate the preserved worktree.",
              })),
          ];
        }),
      );
      const cleanup = await native
        .gitAgentWorktreeCleanup(
          recoveredWithoutStorage.map((task) => task.id),
        )
        .catch((error) => {
          console.warn(
            "[clack] Could not reconcile orphaned agent worktrees:",
            error,
          );
          return null;
        });
      if (cleanup && cleanup.preservedCount > 0) {
        console.warn(
          `[clack] Preserved ${cleanup.preservedCount} orphaned agent worktree(s) because they may contain recoverable changes.`,
        );
      }
      const recovered = bounded(
        recoverPeerTasks(recoveredWithoutStorage, {
          ...baseContext,
          contentIssues: content.issues,
          worktrees,
        }),
      );
      await savePeerTasks(recovered);
      set({
        tasks: recovered,
        hydrated: true,
        recoveryReady: true,
        recoveryError: null,
      });
    } catch {
      if (recoveredWithoutStorage) {
        await savePeerTasks(recoveredWithoutStorage).catch(() => undefined);
      }
      set({
        tasks: recoveredWithoutStorage ?? [],
        hydrated: true,
        recoveryReady: false,
        recoveryError:
          "Queued agent work is paused because Clack could not validate saved recovery state.",
      });
    }
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
