import { newTodoId, type Todo, validateTodos } from "@/modules/ai/lib/todos";
import { useTodosStore } from "@/modules/ai/store/todoStore";
import type { ToolContext } from "@/modules/ai/tools/context";
import { tool } from "ai";
import { z } from "zod";

const TodoStatus = z.enum(["pending", "in_progress", "completed", "blocked"]);

export function buildTodoTools(ctx: ToolContext) {
  return {
    todo_write: tool({
      description:
        "Update the accepted Todo plan; preserve stable IDs. Omitted obligations remain outstanding, never silently deleted. Only an explicit user correction permits new items to list old IDs in supersedesIds; superseded items remain historical and cannot reactivate. Never infer supersession from cancellation or vague prose. Mark actual progress; completed is not independent verification.",
      inputSchema: z.object({
        todos: z
          .array(
            z.object({
              id: z
                .string()
                .min(1)
                .max(128)
                .optional()
                .describe(
                  "Stable ID; generated if omitted. Reuse.",
                ),
              title: z.string().trim().min(1).max(160),
              description: z.string().max(512).optional(),
              status: TodoStatus.describe(
                "Use blocked with reason in description for missing access/clarification. Completed is progress, not proof.",
              ),
              supersedesIds: z
                .array(z.string().min(1).max(128))
                .max(8)
                .optional()
                .describe(
                  "Historical IDs superseded only by explicit user correction; never unrelated omitted Todos.",
                ),
            }),
          )
          .max(16)
          .describe("Complete Todo list."),
      }),
      execute: async ({ todos }) => {
        const sessionId = ctx.getSessionId();
        if (!sessionId)
          return { error: "no active session; cannot persist todos" };

        const normalized: Todo[] = todos.map((t) => ({
          id: t.id ?? newTodoId(),
          title: t.title,
          description: t.description,
          status: t.status,
          ...(t.supersedesIds?.length
            ? { supersedesIds: t.supersedesIds }
            : {}),
        }));

        const err = validateTodos(normalized);
        if (err) return { error: err };

        const planError = useTodosStore
          .getState()
          .reconcilePlan(sessionId, normalized);
        if (planError) return { error: planError };

        return {
          ok: true,
          count: normalized.length,
          inProgress:
            normalized.find((t) => t.status === "in_progress")?.title ?? null,
        };
      },
    }),
  } as const;
}
