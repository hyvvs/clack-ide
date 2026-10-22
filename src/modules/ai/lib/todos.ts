import { LazyStore } from "@tauri-apps/plugin-store";

export type TodoStatus =
  | "pending"
  | "in_progress"
  | "blocked"
  | "completed"
  | "cancelled"
  | "interrupted"
  | "failed";

export type Todo = {
  id: string;
  title: string;
  description?: string;
  status: TodoStatus;
};

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
    if (!t.id || t.id.length > 128 || ids.has(t.id)) return "todo identities must be bounded and unique";
    ids.add(t.id);
    if (!t.title.trim() || t.title.length > 160 || (t.description?.length ?? 0) > 512)
      return "todo titles and descriptions must be non-empty and bounded";
    if (t.status === "in_progress") inProgress++;
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
  return todos.map(todo => ({ ...todo }));
}
