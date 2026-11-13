import type { ToolSet } from "ai";
import {
  waitForInferenceSettlement,
  type InferenceScope,
} from "@/modules/ai/lib/inferenceLifecycle";
import { InferenceTransportError } from "@/modules/ai/lib/inferenceErrors";
import { canonicalJson } from "@/modules/ai/lib/canonicalJson";

export type CompletedToolGuard = {
  ids: ReadonlySet<string>;
  /** Immutable completed inputs from the durable transcript. */
  operations: ReadonlySet<string>;
};

export function gateInferenceTools(
  tools: ToolSet,
  scope: InferenceScope,
  signal?: AbortSignal,
  completed?: CompletedToolGuard,
): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [
      name,
      {
        ...tool,
        ...(tool.execute ? {
          execute: async (...args: Parameters<NonNullable<typeof tool.execute>>) => {
            const [input, context] = args;
            if (completed?.ids.has(context.toolCallId) ||
                completed?.operations.has(`${name}:${canonicalJson(input)}`))
              throw new Error("Completed tool operation is immutable in this recovered Agent run; inspect its recorded result instead of repeating the effect.");
            return tool.execute?.(...args);
          },
        } : {}),
        needsApproval: async (
          ...args: Parameters<
            Exclude<typeof tool.needsApproval, boolean | undefined>
          >
        ) => {
          const completed = await waitForInferenceSettlement(scope);
          if (signal?.aborted || !scope.isCurrent())
            throw new InferenceTransportError("cancelled");
          if (!completed) throw new InferenceTransportError("native-transport");
          return typeof tool.needsApproval === "function"
            ? tool.needsApproval(...args)
            : (tool.needsApproval ?? false);
        },
      },
    ]),
  );
}
