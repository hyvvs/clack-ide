import { budgetIdentity } from "@/modules/ai/lib/contextBudgetProfile";
import type { SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";

/** A legitimate calibration commit updates its derived working-context
 * recommendation. Treat ONLY that precisely scoped, freshly measured
 * recommendation as an allowed evidence change; all transport/settings
 * identity operands must remain identical. This does not waive any trust gate.
 */
export function sameAgentRenewalIdentity(
  before: SelfHostedState,
  after: SelfHostedState,
  profileId: string,
): boolean {
  const earlier = before.profiles.find(p => p.id === profileId);
  const later = after.profiles.find(p => p.id === profileId);
  if (!earlier || !later) return false;
  const evidence = later.recommendations.workingContext;
  const calibration = later.contextCalibration;
  if (evidence && (!calibration || calibration.status !== "verified" ||
      calibration.highest !== evidence.value ||
      calibration.updatedAt !== evidence.observedAt ||
      calibration.expiresAt !== evidence.expiresAt ||
      evidence.metric !== "workingContext" ||
      evidence.source !== "measured" ||
      evidence.confidence !== "observed" ||
      evidence.scope.endpointId !== later.endpointId ||
      evidence.scope.modelRevision !== later.modelRevision ||
      evidence.scope.transportModelId !== later.transportModelId))
    return false;
  // Preserve the entire original identity, including all user overrides and
  // every other recommendation. Only the output of the real calibrator differs.
  const restored: SelfHostedState = {
    ...after,
    profiles: after.profiles.map(p => p.id !== profileId ? p : {
      ...p,
      recommendations: {
        ...p.recommendations,
        workingContext: earlier.recommendations.workingContext,
      },
    }),
  };
  return budgetIdentity(before, profileId) === budgetIdentity(restored, profileId);
}
