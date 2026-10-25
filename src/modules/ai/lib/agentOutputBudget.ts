import { resolveContextBudget, type BudgetLimits } from "@/modules/ai/lib/contextBudget";
import type { EffortCapture } from "@/modules/ai/lib/reasoningEffort";

// Agent output is shared between native reasoning and usable text/tool calls.
// The ordinary 2K conversational fallback can end a thinking Agent's first
// generation before it reaches a tool. This is only a bounded *default*:
// explicit profile settings, verified API caps and captured fallback requirements
// still take precedence. Do not infer deployable context from model advertising.
export function resolveAgentOutputBudget(
  limits: BudgetLimits,
  reasoning?: EffortCapture,
  requiredOutput?: number,
): number {
  const ordinary = resolveContextBudget(limits, undefined, requiredOutput);
  if (
    requiredOutput !== undefined ||
    limits.maxOutput !== undefined ||
    limits.outputReserve !== undefined ||
    reasoning?.capability.status !== "supported" ||
    reasoning.choice === "none" ||
    reasoning.choice === "0" ||
    // Unknown/theoretical/advertised context is not sufficient for promotion.
    (!limits.deployed && !limits.reported)
  ) return ordinary.output;

  // 1/8 of actual bounded context, at most 8K. At the verified 65K Agent
  // target this allows 8K total reasoning + native-tool output, while leaving
  // substantial input/context headroom. Never lower a larger existing policy.
  const requested = Math.max(
    ordinary.output,
    Math.min(8192, Math.floor(ordinary.ceiling / 8)),
  );
  return resolveContextBudget(limits, undefined, requested).output;
}
