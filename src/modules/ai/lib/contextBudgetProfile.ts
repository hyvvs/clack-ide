import type { BudgetLimits } from "@/modules/ai/lib/contextBudget";
import {
  effectiveProfileValue,
  type SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  probeEvidenceIsFresh,
  type ProbeSnapshot,
} from "@/modules/ai/lib/selfHostedProbe";

export function profileBudgetLimits(
  state: SelfHostedState,
  profileId: string,
  snapshot: ProbeSnapshot | null,
  now = Date.now(),
): BudgetLimits {
  const profile = state.profiles.find((p) => p.id === profileId);
  const endpoint = state.endpoints.find(
    (e) => e.id === profile?.endpointId && e.deletedAt == null,
  );
  if (!profile || !endpoint) return {};
  const evidence =
    snapshot?.models
      .find((m) => m.id === profile.transportModelId)
      ?.evidence.filter(
        (e) =>
          (profile.deploymentId === null ||
            e.scope.deploymentId === profile.deploymentId) &&
          e.confidence !== "unverified" &&
          probeEvidenceIsFresh(e, endpoint, snapshot, now),
      ) ?? [];
  const bound = (metric: string) => {
    const values = evidence
      .filter(
        (e) =>
          e.metric === metric && typeof e.value === "number" && e.value > 0,
      )
      .map((e) => e.value as number);
    return values.length ? Math.min(...values) : undefined;
  };
  const field = (
    name:
      | "configuredContext"
      | "workingContext"
      | "outputReserve"
      | "maxOutput",
  ) => effectiveProfileValue(state, profileId, name);
  const number = (name: Parameters<typeof field>[0]) => {
    const value = field(name).value;
    return typeof value === "number" ? value : undefined;
  };
  return {
    deployed: bound("probe.loadedContext") ?? bound("probe.configuredContext"),
    advertised: bound("probe.advertisedContext"),
    asserted:
      field("configuredContext").mode === "manual"
        ? number("configuredContext")
        : undefined,
    workingTarget: number("workingContext"),
    manualWorking: field("workingContext").mode === "manual",
    outputReserve: number("outputReserve"),
    maxOutput: number("maxOutput"),
  };
}

export function budgetIdentity(
  state: SelfHostedState,
  profileId: string,
): string {
  const profile = state.profiles.find((p) => p.id === profileId);
  const endpoint = state.endpoints.find(
    (e) => e.id === profile?.endpointId && e.deletedAt == null,
  );
  // Alias and observational evidence changes do not change transport identity.
  return JSON.stringify([
    endpoint?.id,
    endpoint?.configurationRevision,
    profile?.id,
    profile?.transportModelId,
    profile?.deploymentId,
    profile?.overrides,
    profile?.recommendations,
  ]);
}
