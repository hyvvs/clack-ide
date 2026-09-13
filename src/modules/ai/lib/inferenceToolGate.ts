import type { ToolSet } from "ai";
import {
  waitForInferenceSettlement,
  type InferenceScope,
} from "@/modules/ai/lib/inferenceLifecycle";
import { InferenceTransportError } from "@/modules/ai/lib/inferenceErrors";

export function gateInferenceTools(
  tools: ToolSet,
  scope: InferenceScope,
  signal?: AbortSignal,
): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [
      name,
      {
        ...tool,
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
