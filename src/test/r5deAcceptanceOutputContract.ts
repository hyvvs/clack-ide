/** Acceptance-only projection. The resolver is the actual production Agent
 * output policy; this module cannot change the request or grant runtime trust.
 *
 * The first logical batch plans against its original verified upper context,
 * even when minimumSafeContext sends a smaller num_ctx. Subsequent logical
 * batches reselect the pinned exact-tier context before budgeting output.
 */
import { resolveAgentOutputBudget } from "@/modules/ai/lib/agentOutputBudget";
import type { EffortCapture } from "@/modules/ai/lib/reasoningEffort";

// Exact production logical-continuation system suffix from agent.ts. The
// offline parity test fails if production changes that suffix.
export const R5DE_LOGICAL_CONTINUATION_MARKER =
  "\n\nThis generation continues the same logical run after an internal step batch. Continue from the existing plan and tool results without recapping or restarting the task.";

const automatic = { choice: "automatic", capability: { status: "supported" } } as EffortCapture;

export function r5deAcceptanceOutputContract(candidates: readonly number[], originalContext: number) {
  if (!Number.isSafeInteger(originalContext) || originalContext < 1 ||
      !candidates.length || new Set(candidates).size !== candidates.length ||
      candidates.some(context => !Number.isSafeInteger(context) || context <= 0 || context > originalContext))
    throw new Error("Acceptance calibration candidates are invalid");
  const outputFor = (context: number) => resolveAgentOutputBudget(
    { deployed: context, runtimeTarget: context }, automatic);
  const originalOutput = outputFor(originalContext);
  return {
    originalOutput,
    // Never infer continuation authorization from a convenient smaller bound:
    // each context is tied to one exact production-computed output.
    continuationOutputs: candidates.map(context => ({ context, output: outputFor(context) })),
    continuationMarker: R5DE_LOGICAL_CONTINUATION_MARKER,
  };
}
