import { resolveContextBudget, type BudgetLimits } from "@/modules/ai/lib/contextBudget";
import type { EffortCapture } from "@/modules/ai/lib/reasoningEffort";
import { freshProviderModelEvidence } from "@/modules/ai/lib/providerModelEvidence";

// Generating reasoning is not the same capability as controlling its effort.
// For hosted automatic reasoning, require exact, fresh provider metadata for
// *both* the default-on reasoning behavior and the model's output maximum.
// An effort-level mapping is neither implied nor sent by this evidence.
function verifiedHostedReasoningOutput(
  limits: BudgetLimits,
  reasoning?: EffortCapture,
): boolean {
  if (!reasoning || reasoning.choice !== "automatic" ||
      !limits.reported || !limits.outputCap || !limits.reportedEvidence)
    return false;
  const evidence = freshProviderModelEvidence(
    limits.reportedEvidence, reasoning.provider, reasoning.model,
  );
  if (!evidence || evidence.context !== limits.reported ||
      !evidence.output || limits.outputCap > evidence.output)
    return false;
  const metadata = evidence.capabilities?.reasoning;
  // A supported reasoning parameter or list of effort levels alone does not
  // mean the model will reason without an explicit (possibly unsupported)
  // control. Contradictory enabled/mandatory declarations fail closed.
  return metadata?.defaultEnabled === true ||
    (metadata?.mandatory === true && metadata.defaultEnabled !== false);
}

// Agent output is shared between native reasoning and usable text/tool calls.
// The ordinary 2K conversational fallback can end a thinking Agent's first
// generation before it reaches a tool. This is only a bounded *default*:
// explicit profile settings, verified API caps and captured fallback requirements
// still take precedence. A hosted model without an effort control can qualify
// through fresh, identity-bound default-on reasoning and output-cap evidence.
// Do not infer deployable context or reasoning from model-name advertising.
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
    (!reasoning || (reasoning.capability.status !== "supported" &&
      !verifiedHostedReasoningOutput(limits, reasoning))) ||
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

/** Shared Agent context contract: preparation must reserve exactly the same
 * output as the eventual request before committing a target-context key.
 * This is a budget projection, not proof of runtime context or model trust. */
export function agentBudgetLimits(
  limits: BudgetLimits,
  reasoning?: EffortCapture,
  options: { hasExposedAgentTools?: boolean; requiredOutput?: number } = {},
): BudgetLimits {
  const output = options.hasExposedAgentTools === false &&
    reasoning?.capability.status !== "supported"
    ? resolveContextBudget(limits, undefined, options.requiredOutput).output
    : resolveAgentOutputBudget(limits, reasoning, options.requiredOutput);
  return { ...limits, outputReserve: Math.max(limits.outputReserve ?? 0, output) };
}
