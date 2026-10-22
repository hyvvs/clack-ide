import { LazyStore } from "@tauri-apps/plugin-store";

export type TodoStatus =
  | "pending"
  | "in_progress"
  | "blocked"
  | "completed"
  | "cancelled"
  | "interrupted"
  | "failed";

/** Native shell receipts live with their owning accepted Todo, not a second goal store. */
export type NativeTodoCheck = {
  id: string;
  purpose: string;
  command: string;
  sessionId: string;
  workspaceId: string;
  runStartedAt: number;
  userTurnCount: number;
  startedAt: number;
  finishedAt: number;
  exitCode: number | null;
  status:
    | "passed"
    | "failed"
    | "timed-out"
    | "blocked"
    | "not-started"
    | "permission-denied"
    | "cancelled";
  beforeRevision: string | null;
  afterRevision: string | null;
  qualification: string;
  reason?: string;
};

export type Todo = {
  id: string;
  title: string;
  description?: string;
  status: TodoStatus;
  /** Explicit plan identity, NOT inferred from matching text. */
  supersedesIds?: string[];
  /** Recorded only by the native shell tool after its execution returns. */
  nativeChecks?: NativeTodoCheck[];
  /** Historical status, not an allowed `todo_write` input. */
  superseded?: boolean;
};

/** Preserve unrelated obligations; only explicit replacement identities can retire one. */
export function reconcileTodos(
  previous: readonly Todo[],
  incoming: readonly Todo[],
): Todo[] {
  const replaced = new Set(incoming.flatMap((t) => t.supersedesIds ?? []));
  for (const id of replaced) {
    if (!previous.some((t) => t.id === id) || incoming.some((t) => t.id === id))
      throw new Error(
        "supersession must reference an existing, omitted Todo identity",
      );
  }
  const oldById = new Map(previous.map((t) => [t.id, t]));
  const next: Todo[] = incoming.map((t) => {
    const old = oldById.get(t.id);
    if (old?.superseded)
      throw new Error("historical superseded Todo cannot be reactivated");
    if (old && (old.title !== t.title || old.description !== t.description))
      throw new Error(
        "a changed obligation needs a new id and explicit supersedesIds; stable ids cannot silently change requirements",
      );
    return {
      ...t,
      ...(old?.title === t.title &&
      old.description === t.description &&
      old.nativeChecks
        ? { nativeChecks: old.nativeChecks }
        : {}),
    };
  });
  for (const old of previous) {
    if (incoming.some((t) => t.id === old.id)) continue;
    next.push(replaced.has(old.id) ? { ...old, superseded: true } : { ...old });
  }
  const validation = validateTodos(next);
  if (validation) throw new Error(validation);
  return next;
}

export type TodoTerminalState =
  | "completed"
  | "cancelled"
  | "interrupted"
  | "failed";

const STORE_PATH = "terax-ai-todos.json";
const todosKey = (sessionId: string) => `todos:${sessionId}`;

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

export async function loadTodos(sessionId: string): Promise<Todo[]> {
  return (await store.get<Todo[]>(todosKey(sessionId))) ?? [];
}

export async function saveTodos(
  sessionId: string,
  todos: Todo[],
): Promise<void> {
  await store.set(todosKey(sessionId), todos);
  await store.save();
}

export async function deleteTodos(sessionId: string): Promise<void> {
  await store.delete(todosKey(sessionId));
}

export function newTodoId(): string {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Validate a candidate todo list:
 *  - At most one item with status `in_progress` (anti-drift invariant).
 *  - Titles must be non-empty.
 * Returns null on valid, otherwise an error string.
 */
export function validateTodos(todos: Todo[]): string | null {
  if (todos.length > 16 || JSON.stringify(todos).length > 8192)
    return "keep the plan within 16 items and 8192 serialized characters";
  const ids = new Set<string>();
  let inProgress = 0;
  for (const t of todos) {
    if (!t.id || t.id.length > 128 || ids.has(t.id))
      return "todo identities must be bounded and unique";
    ids.add(t.id);
    if (
      !t.title.trim() ||
      t.title.length > 160 ||
      (t.description?.length ?? 0) > 512
    )
      return "todo titles and descriptions must be non-empty and bounded";
    if (t.status === "in_progress" && !t.superseded) inProgress++;
    if ((t.supersedesIds?.length ?? 0) > 8 || (t.nativeChecks?.length ?? 0) > 4)
      return "Todo provenance exceeds bounded retention";
  }
  if (inProgress > 1)
    return `only one todo may be in_progress at a time (got ${inProgress})`;
  return null;
}

export function terminalizeTodos(
  todos: readonly Todo[],
  _status: TodoTerminalState,
): Todo[] {
  // A run failure, cancellation or restart is not an obligation failure. Keep the
  // last accepted plan intact; the run's own durable state carries the stop cause.
  return todos.map((todo) => ({ ...todo }));
}
