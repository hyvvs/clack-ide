import {
  type NativeTodoCheck,
  deleteTodos as persistDelete,
  loadTodos as persistLoad,
  saveTodos as persistSave,
  reconcileTodos,
  type Todo,
  type TodoTerminalState,
  terminalizeTodos,
} from "@/modules/ai/lib/todos";
import { create } from "zustand";

type TodosState = {
  bySession: Record<string, Todo[]>;
  hydrated: Set<string>;
  hydrate: (sessionId: string) => Promise<void>;
  setTodos: (sessionId: string, todos: Todo[]) => void;
  reconcilePlan: (sessionId: string, todos: Todo[]) => string | null;
  recordNativeCheck: (
    sessionId: string,
    todoId: string,
    receipt: NativeTodoCheck,
  ) => boolean;
  prepareRun: (sessionId: string) => void;
  finalizeRun: (sessionId: string, state: TodoTerminalState) => void;
  clearSession: (sessionId: string) => Promise<void>;
};

const persistQueues = new Map<string, Promise<void>>();

export async function flushTodoPersistence(): Promise<void> {
  await Promise.all([...persistQueues.values()]);
}

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
  reconcilePlan(sessionId, todos) {
    let next: Todo[];
    try {
      next = reconcileTodos(get().bySession[sessionId] ?? [], todos);
    } catch (e) {
      return String(e);
    }
    get().setTodos(sessionId, next);
    return null;
  },
  recordNativeCheck(sessionId, todoId, receipt) {
    const current = get().bySession[sessionId];
    if (
      !current ||
      receipt.sessionId !== sessionId ||
      !current.some((t) => t.id === todoId && !t.superseded)
    )
      return false;
    const next = current.map((t) =>
      t.id === todoId
        ? { ...t, nativeChecks: [...(t.nativeChecks ?? []).slice(-3), receipt] }
        : t,
    );
    if (JSON.stringify(next).length > 8192) return false;
    get().setTodos(sessionId, next);
    return true;
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
        bySession: { ...state.bySession, [sessionId]: finalized },
        hydrated: nextHydrated,
      };
    });
    void queuePersistence(sessionId, async () => {
      await persistSave(sessionId, finalized);
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
