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
        "Update the accepted Todo plan. Preserve stable IDs. Omitted prior obligations remain outstanding, not silently deleted. To record an explicit user correction, a new item may list existing old ids in supersedesIds; these remain historical and cannot reactivate. Do not infer supersession from cancellation or vague prose. Mark actual progress only; a completed Todo is not independent verification.",
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
                  "Stable id; generated if omitted. Reuse ids across calls to keep UI stable.",
                ),
              title: z.string().trim().min(1).max(160),
              description: z.string().max(512).optional(),
              status: TodoStatus.describe(
                "Use blocked, with a reason in description, when work needs clarification or unavailable access. Completed is reported progress, not proof of successful effects.",
              ),
              supersedesIds: z
                .array(z.string().min(1).max(128))
                .max(8)
                .optional()
                .describe(
                  "Explicit historical Todo ids replaced by this item after an authoritative user correction; never use for unrelated omitted Todos.",
                ),
            }),
          )
          .max(16)
          .describe("The complete list of todos for this task."),
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
