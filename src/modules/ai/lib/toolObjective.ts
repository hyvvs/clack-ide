import type { UIMessage } from "ai";
import { validateTodos, type Todo } from "@/modules/ai/lib/todos";
import { handoffObjective } from "@/modules/ai/lib/peerHistory";

export type ToolCapability = "read" | "create" | "modify" | "command" | "peer";

// Callable operations, not descriptions, permissions or MCP annotations, establish equivalence.
const operations: Readonly<Record<string, readonly ToolCapability[]>> = {
  read_file: ["read"],
  write_file: ["create", "modify"],
  edit: ["modify"],
  multi_edit: ["modify"],
  bash_run: ["command"],
  tf_fs_read: ["read"],
  tf_fs_write: ["create","modify"],
  tf_fs_delete: ["modify"],
  tf_repo_read: ["read"],
  tf_repo_write: ["modify"],
  tf_build_run: ["command"],
  request_peer_task: ["peer"],
  communicate_peer_task: ["peer"],
};
export function operationCapabilities(
  operation: string,
): readonly ToolCapability[] {
  return operations[operation] ?? [];
}

export type ToolObjective = {
  query: string;
  kind: "implementation" | "delegated" | "read-only" | "unknown";
  required: ToolCapability[];
};

const unfinished = (todos: readonly Todo[]) =>
  todos.some((t) => t.status !== "completed" && t.status !== "cancelled");
const textOf = (message: UIMessage) =>
  message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n");
const continuation = (text: string) =>
  !handoffObjective(text) &&
  /\b(?:continue|resume|finish|keep going|same (?:project|task|objective)|original (?:implementation|objective))\b/i.test(
    text,
  );
export const continuationOnly = (text: string) =>
  /^(?:(?:continue|resume|finish|complete|proceed with)(?:\s+(?:the\s+)?(?:same|current|original|existing)\b[^\n]*|[.!?\s]*)|keep going[.!?\s]*)$/i.test(
    text.trim(),
  );
function acceptedTodos(value: unknown): value is Todo[] {
  return (
    Array.isArray(value) &&
    value.length <= 16 &&
    value.every(
      (t) =>
        t &&
        typeof t.id === "string" &&
        typeof t.title === "string" &&
        (t.description === undefined || typeof t.description === "string") &&
        [
          "pending",
          "in_progress",
          "blocked",
          "completed",
          "cancelled",
          "interrupted",
          "failed",
        ].includes(t.status),
    ) &&
    !validateTodos(value)
  );
}

export function resolveToolObjective(
  messages: readonly UIMessage[],
  currentTodos: readonly Todo[] = [],
): ToolObjective {
  let user = "",
    anchor = "",
    plan: readonly Todo[] = [],
    plannedObjective = "",
    mutations = "";
  let evidence = new Set<ToolCapability>();
  for (const message of messages) {
    if (message.role === "user") {
      const handoff = handoffObjective(textOf(message));
      user = handoff ?? textOf(message);
      if (handoff !== null || (!unfinished(plan) && !continuation(user))) {
        anchor = user;
        evidence = new Set();
        plan = [];
        plannedObjective = "";
        mutations = "";
      }
      if (!anchor) anchor = user;
      if (user !== anchor && !continuationOnly(user))
        mutations = `${mutations}\n${user}`.slice(-2048);
    }
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (part.type !== "dynamic-tool" && !part.type.startsWith("tool-"))
        continue;
      const call = part as {
        type: string;
        toolName?: string;
        state?: string;
        input?: unknown;
        output?: unknown;
      };
      const name =
        call.type === "dynamic-tool"
          ? (call.toolName ?? "")
          : call.type.slice(5);
      if (call.state !== "output-available" && call.state !== "output-error")
        continue;
      for (const capability of operationCapabilities(name))
        evidence.add(capability);
      if (
        name !== "todo_write" ||
        call.state !== "output-available" ||
        !(call.output as { ok?: boolean } | undefined)?.ok
      )
        continue;
      const todos = (call.input as { todos?: Todo[] } | undefined)?.todos;
      if (!acceptedTodos(todos)) continue;
      plan = todos;
      plannedObjective = anchor;
    }
  }
  if (currentTodos.length && acceptedTodos(currentTodos)) plan = currentTodos;
  const pending = unfinished(plan);
  const objective =
    pending || continuation(user) ? plannedObjective || anchor : user || anchor;
  const obligations = pending
    ? plan
        .filter((t) => t.status !== "completed" && t.status !== "cancelled")
        .map((t) => `${t.title}: ${t.description ?? ""}`)
        .join("\n")
        .slice(0, 2048)
    : "";
  // Source UI messages are the durable transcript, not the compacted request or a new objective store.
  const query = [
    objective.slice(0, 3072),
    obligations,
    mutations.trim(),
    user === objective || mutations.endsWith(user) ? "" : user.slice(-512),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(-8192);
  const direct = evidence.has("create") || evidence.has("modify");
  const readOnly =
    !direct &&
    /\b(?:research|analysis|analyze|review|explain)\b[\s\S]*\bonly\b/i.test(
      objective,
    );
  const delegated =
    !direct &&
    evidence.has("peer") &&
    /\bdelegat\w*\b[\s\S]*\b(?:all|entire|whole)\b/i.test(objective);
  const task = `${objective}\n${obligations}`;
  const implementation =
    direct ||
    (!readOnly &&
      !delegated &&
      /\b(?:build|implement|fix|edit|create)\b/i.test(task) &&
      /\b(?:app|application|software|code|file|files|source|website|server)\b/i.test(
        task,
      ));
  return {
    query,
    kind: implementation
      ? "implementation"
      : delegated
        ? "delegated"
        : readOnly
          ? "read-only"
          : "unknown",
    required: implementation
      ? ["read", "create", "modify", "command"]
      : delegated
        ? ["peer"]
        : query && !/^(hello|hi|hey|thanks|thank you)[.!?\s]*$/i.test(query)
          ? ["read"]
          : [],
  };
}
