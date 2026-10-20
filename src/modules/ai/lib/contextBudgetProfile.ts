import type { BudgetLimits } from "@/modules/ai/lib/contextBudget";
import {
  effectiveProfileValue,
  endpointBackend,
  type SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  probeEvidenceIsFresh,
  type ProbeSnapshot,
} from "@/modules/ai/lib/selfHostedProbe";
import { CALIBRATED_FIELDS } from "@/modules/ai/lib/calibrationSchema";
import { canonicalJson } from "@/modules/ai/lib/canonicalJson";
import { ContextBudgetError, UNKNOWN_CONTEXT_POLICY } from "@/modules/ai/lib/contextBudget";
import { snapshotContext } from "@/modules/ai/lib/contextCalibrationTrust";

export const MAX_OLLAMA_CONTEXT = 2_000_000;

export function profileBudgetLimits(
  state: SelfHostedState,
  profileId: string,
  snapshot: ProbeSnapshot | null,
  now = Date.now(),
  calibrationTarget?: number,
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
  const limits: BudgetLimits = {
    deployed: bound("probe.loadedContext") ?? bound("probe.configuredContext"),
    advertised: bound("probe.advertisedContext"),
    asserted:
      field("configuredContext").mode === "manual"
        ? number("configuredContext")
        : undefined,
    workingTarget: calibrationTarget ?? (profile.contextCalibration && !profile.overrides.workingContext
      ? snapshotContext(state, profile, snapshot, now) : number("workingContext")),
    manualWorking: field("workingContext").mode === "manual",
    outputReserve: number("outputReserve"),
    maxOutput: number("maxOutput"),
  };
  if (endpointBackend(endpoint) === "ollama" && limits.workingTarget === undefined) {
    const loaded = bound("probe.loadedContext");
    // A previous allocation does not establish the next request's server default.
    limits.deployed = bound("probe.configuredContext") ??
      (loaded !== undefined && loaded <= UNKNOWN_CONTEXT_POLICY ? loaded : undefined);
  }
  if (endpointBackend(endpoint) === "ollama" && limits.workingTarget !== undefined) {
    const target = limits.workingTarget;
    if (!Number.isSafeInteger(target) || target <= 0 || target > MAX_OLLAMA_CONTEXT)
      throw new ContextBudgetError("invalid-context-settings", "Ollama working context must be a positive whole number within the application limit.");
    for (const ceiling of [limits.advertised, limits.asserted, bound("probe.configuredContext")])
      if (ceiling !== undefined && target > ceiling)
        throw new ContextBudgetError("invalid-context-settings", "Ollama working context exceeds the known model/configured ceiling. Lower it in model settings.");
    const controllable = evidence.some(e => e.metric === "probe.runtimeContext" && e.value === "per-request");
    if (!controllable)
      throw new ContextBudgetError("ollama-context-unverified", "Refresh this Ollama model's metadata before requesting a runtime context. No inference was sent.");
    const requested = bound("probe.requestedContext");
    if (requested === target && bound("probe.loadedContext") !== undefined && bound("probe.loadedContext") !== target)
      throw new ContextBudgetError("ollama-context-mismatch", `Ollama reported ${bound("probe.loadedContext")} loaded tokens after Clack requested ${target}. Lower the working context or verify the server/proxy supports runtime context control, then refresh metadata. The previous inference was not retried.`);
    // This is a per-request allocation contract, not an inference from model maximum.
    limits.runtimeTarget = target;
    limits.deployed = bound("probe.loadedContext") === target ? target : undefined;
    limits.workingTarget = undefined;
    // An asserted ceiling bounds the requested allocation; it is not the allocation itself.
    limits.asserted = undefined;
  }
  return limits;
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
  return canonicalJson([
    endpoint?.id,
    endpoint?.configurationRevision,
    profile?.id,
    profile?.transportModelId,
    profile?.deploymentId,
    profile?.modelRevision,
    profile?.backend,
    profile?.overrides,
    // Performance guidance does not change captured context or transport settings.
    profile ? Object.fromEntries(Object.entries(profile.recommendations).filter(([field]) =>
      !CALIBRATED_FIELDS.some(name => name === field),
    )) : undefined,
  ]);
}
