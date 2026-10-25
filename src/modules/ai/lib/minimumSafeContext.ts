import { resolveContextBudget, type BudgetLimits, type RequestCost } from "@/modules/ai/lib/contextBudget";
import { snapshotContext } from "@/modules/ai/lib/contextCalibrationTrust";
import type { ProbeSnapshot } from "@/modules/ai/lib/selfHostedProbe";
import type { SelfHostedProfile, SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";

/** Only actual successful loaded tiers from the current, fully trusted calibration. */
export function freshVerifiedContextTiers(
  state: SelfHostedState,
  profile: SelfHostedProfile,
  snapshot: ProbeSnapshot | null,
  now = Date.now(),
): number[] {
  const highest = snapshotContext(state, profile, snapshot, now);
  const record = profile.contextCalibration;
  if (highest === undefined || record?.status !== "verified" || record.highest !== highest)
    return [];
  return [...new Set(record.attempts
    .filter(a => a.outcome === "success" && a.requested === a.context &&
      a.loaded === a.context && a.context <= highest && a.at <= now)
    .map(a => a.context))].sort((a, b) => a - b);
}

/** Fit the *complete serialized request*, its full output reserve and margin.
 * This never authorizes truncating or discarding messages or tool results. */
export function minimumSafeContext(
  limits: BudgetLimits,
  cost: RequestCost,
  output: number,
  verifiedTiers: readonly number[],
  allowed: (tier: number) => boolean = () => true,
): number | undefined {
  const ceiling = limits.runtimeTarget;
  if (!ceiling || !Number.isSafeInteger(ceiling)) return undefined;
  for (const tier of [...new Set(verifiedTiers)].sort((a, b) => a - b)) {
    if (!Number.isSafeInteger(tier) || tier <= 0 || tier > ceiling || !allowed(tier)) continue;
    // The shared budget resolver intentionally throws for an output pin that
    // already occupies a candidate tier. That tier simply cannot fit.
    if (tier <= Math.max(output, limits.maxOutput ?? 0, limits.outputReserve ?? 0)) continue;
    const budget = resolveContextBudget({ ...limits, runtimeTarget: tier, deployed: undefined }, cost, output);
    if (budget.fits && budget.output === output) return tier;
  }
  return undefined;
}
