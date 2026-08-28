import { create } from "zustand";
import {
  loadPeerTasks,
  recoverInterruptedPeerTasks,
  savePeerTasks,
  type PeerTask,
  type PeerTaskError,
  type PeerTaskResult,
} from "../lib/peerTasks";

type PeerTaskStore = {
  hydrated: boolean;
  tasks: PeerTask[];
  hydrate: () => Promise<void>;
  add: (task: PeerTask) => void;
  claim: (id: string) => PeerTask | null;
  complete: (id: string, result: PeerTaskResult) => void;
  fail: (id: string, error: PeerTaskError) => void;
  cancel: (id: string) => void;
};

function persist(tasks: PeerTask[]): void {
  void savePeerTasks(tasks);
}

export const usePeerTaskStore = create<PeerTaskStore>((set, get) => ({
  hydrated: false,
  tasks: [],
  hydrate: async () => {
    const recovered = recoverInterruptedPeerTasks(await loadPeerTasks());
    set({ tasks: recovered, hydrated: true });
    persist(recovered);
  },
  add: (task) => {
    const tasks = [task, ...get().tasks];
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
  complete: (id, result) => {
    const now = Date.now();
    const tasks = get().tasks.map((item) =>
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
    );
    set({ tasks });
    persist(tasks);
  },
  fail: (id, error) => {
    const now = Date.now();
    const tasks = get().tasks.map((item) =>
      item.id === id && (item.status === "queued" || item.status === "running")
        ? {
            ...item,
            status: "failed" as const,
            error,
            endedAt: now,
            updatedAt: now,
          }
        : item,
    );
    set({ tasks });
    persist(tasks);
  },
  cancel: (id) => {
    const now = Date.now();
    const tasks = get().tasks.map((item) =>
      item.id === id && (item.status === "queued" || item.status === "running")
        ? {
            ...item,
            status: "cancelled" as const,
            endedAt: now,
            updatedAt: now,
          }
        : item,
    );
    set({ tasks });
    persist(tasks);
  },
}));
