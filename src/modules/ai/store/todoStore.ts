import { create } from "zustand";
import {
  deleteTodos as persistDelete,
  loadTodos as persistLoad,
  saveTodos as persistSave,
  terminalizeTodos,
  type Todo,
  type TodoTerminalState,
} from "@/modules/ai/lib/todos";

type TodosState = {
  bySession: Record<string, Todo[]>;
  hydrated: Set<string>;
  hydrate: (sessionId: string) => Promise<void>;
  setTodos: (sessionId: string, todos: Todo[]) => void;
  prepareRun: (sessionId: string) => void;
  finalizeRun: (sessionId: string, state: TodoTerminalState) => void;
  clearSession: (sessionId: string) => Promise<void>;
};

const persistQueues = new Map<string, Promise<void>>();

function queuePersistence(
  sessionId: string,
  operation: () => Promise<void>,
): Promise<void> {
  const prior = persistQueues.get(sessionId) ?? Promise.resolve();
  const next = prior.then(operation, operation).catch(() => undefined);
  persistQueues.set(sessionId, next);
  void next.finally(() => {
    if (persistQueues.get(sessionId) === next) persistQueues.delete(sessionId);
  });
  return next;
}

export const useTodosStore = create<TodosState>((set, get) => ({
  bySession: {},
  hydrated: new Set(),

  async hydrate(sessionId) {
    if (get().hydrated.has(sessionId)) return;
    await persistQueues.get(sessionId);
    const todos = await persistLoad(sessionId);
    set((state) => {
      if (state.hydrated.has(sessionId)) return state;
      const nextHydrated = new Set(state.hydrated);
      nextHydrated.add(sessionId);
      return {
        bySession: { ...state.bySession, [sessionId]: todos },
        hydrated: nextHydrated,
      };
    });
  },

  setTodos(sessionId, todos) {
    set((state) => {
      const nextHydrated = new Set(state.hydrated);
      nextHydrated.add(sessionId);
      return {
        bySession: { ...state.bySession, [sessionId]: todos },
        hydrated: nextHydrated,
      };
    });
    void queuePersistence(sessionId, () => persistSave(sessionId, todos));
  },

  prepareRun(sessionId) {
    set((state) => {
      const nextHydrated = new Set(state.hydrated);
      nextHydrated.add(sessionId);
      return {
        bySession: { ...state.bySession, [sessionId]: [] },
        hydrated: nextHydrated,
      };
    });
    void queuePersistence(sessionId, () => persistDelete(sessionId));
  },

  finalizeRun(sessionId, terminalState) {
    const current = get().bySession[sessionId] ?? [];
    const finalized = terminalizeTodos(current, terminalState);
    set((state) => {
      const nextHydrated = new Set(state.hydrated);
      nextHydrated.add(sessionId);
      return {
        bySession: { ...state.bySession, [sessionId]: [] },
        hydrated: nextHydrated,
      };
    });
    void queuePersistence(sessionId, async () => {
      await persistSave(sessionId, finalized);
      await persistDelete(sessionId);
    });
  },

  async clearSession(sessionId) {
    set((state) => {
      const next = { ...state.bySession };
      delete next[sessionId];
      const nextHydrated = new Set(state.hydrated);
      nextHydrated.delete(sessionId);
      return { bySession: next, hydrated: nextHydrated };
    });
    await queuePersistence(sessionId, () => persistDelete(sessionId));
  },
}));

export function getTodos(sessionId: string | null): Todo[] {
  if (!sessionId) return [];
  return useTodosStore.getState().bySession[sessionId] ?? [];
}
