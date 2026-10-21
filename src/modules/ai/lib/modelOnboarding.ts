import {
  endpointBackend,
  type ProfileEvidence,
  type SelfHostedProfile,
  type SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  effortCapability,
  effortLabel,
} from "@/modules/ai/lib/reasoningEffort";
import { profileBudgetLimits } from "@/modules/ai/lib/contextBudgetProfile";
import { resolveContextBudget, UNKNOWN_CONTEXT_POLICY } from "@/modules/ai/lib/contextBudget";
import { trustedContext } from "@/modules/ai/lib/contextCalibrationTrust";
import { toolVerificationState } from "@/modules/ai/lib/toolVerification";
import {automaticAgentRecommendation} from "@/modules/ai/lib/agentConfiguration";
import {
  PROBE_INVENTORY_TTL_MS,
  PROBE_INSTANCE_TTL_MS,
  type ProbeSnapshot,
} from "@/modules/ai/lib/selfHostedProbe";

export const ONBOARDING_COMPATIBILITY_VERSION = 1;
export type ModelReadiness =
  | "Ready"
  | "Chat only"
  | "Unverified"
  | "Offline"
  | "Incompatible"
  | "Needs attention"
  | "Unavailable";

export function profileSnapshot(
  state: SelfHostedState,
  profile: SelfHostedProfile,
): ProbeSnapshot | null {
  const endpoint = state.endpoints.find(
    (e) => e.id === profile.endpointId && e.deletedAt == null,
  );
  const inventory = state.inventories?.find(
    (i) =>
      i.endpointId === endpoint?.id &&
      i.configurationRevision === endpoint?.configurationRevision,
  );
  if (!endpoint || !inventory) return null;
  return {
    endpointId: endpoint.id,
    configurationRevision: endpoint.configurationRevision,
    selectedModelId: profile.transportModelId,
    observedAt: inventory.observedAt,
    connected: inventory.connected,
    reachable: inventory.connected,
    credentialUsed: !!endpoint.credentialRef,
    stale: false,
    refreshing: false,
    inventoryTtlMs: PROBE_INVENTORY_TTL_MS,
    instanceTtlMs: PROBE_INSTANCE_TTL_MS,
    backend: endpointBackend(endpoint),
    errors: [],
    models: inventory.models
      .filter((m) => m.id === profile.transportModelId)
      .map((m) => ({ ...m, evidence: profile.evidence })),
  };
}

// A projection of the native-owned profile, never another persistence or routing owner.
export function modelOnboarding(
  state: SelfHostedState,
  profile: SelfHostedProfile,
  now = Date.now(),
) {
  const endpoint = state.endpoints.find(
    (e) => e.id === profile.endpointId && e.deletedAt == null,
  );
  if (!endpoint) return null;
  const inventory = state.inventories?.find(
    (i) =>
      i.endpointId === endpoint.id &&
      i.configurationRevision === endpoint.configurationRevision,
  );
  const listed = inventory?.models.find(
    (m) => m.id === profile.transportModelId,
  );
  const scoped = (e: ProfileEvidence, age: number) =>
    e.scope.endpointId === endpoint.id &&
    e.scope.transportModelId === profile.transportModelId &&
    e.scope.deploymentId === profile.deploymentId &&
    e.scope.configurationRevision === endpoint.configurationRevision &&
    e.scope.modelRevision === profile.modelRevision &&
    e.observedAt !== null &&
    e.observedAt <= now &&
    now - e.observedAt < age &&
    (e.expiresAt === undefined || e.expiresAt > now);
  const metadata = profile.evidence.filter(
    (e) =>
      scoped(e, PROBE_INVENTORY_TTL_MS) &&
      e.confidence === "reported" &&
      ["backend-reported", "advertised"].includes(e.source),
  );
  const value = (metric: string) => {
    const matches = metadata.filter((e) => e.metric === `probe.${metric}`);
    return matches.length === 1 ? matches[0].value : undefined;
  };
  const verified = (name: string) => {
    const matches = profile.evidence.filter(
      (e) =>
        e.metric ===
          `verification.${name}.v${ONBOARDING_COMPATIBILITY_VERSION}` &&
        e.source === "measured" &&
        e.confidence === "observed" &&
        scoped(e, 7 * 86400_000),
    );
    return matches.length === 1 && typeof matches[0].value === "boolean"
      ? matches[0].value
      : undefined;
  };
  const capability = effortCapability(
    {
      providerId:
        endpointBackend(endpoint) === "ollama" ? "ollama" : "openai-compatible",
      transportModelId: profile.transportModelId,
      selfHosted: {
        endpointId: endpoint.id,
        profileId: profile.id,
        configurationRevision: endpoint.configurationRevision,
        allowPrivateNetwork: !!endpoint.allowPrivateNetwork,
        credentialRef: endpoint.credentialRef,
        credentialRequired: !!endpoint.credentialRef,
      },
    },
    state,
    now,
  );
  const providerDefault = value("thinkingDefault");
  const defaultChoice =
    providerDefault === false
      ? "none"
      : providerDefault === true
        ? "on"
        : typeof providerDefault === "string"
          ? providerDefault
          : undefined;
  const recommendedReasoning =
    defaultChoice &&
    capability.status === "supported" &&
    capability.levels.includes(defaultChoice) &&
    verified("reasoning") !== false
      ? effortLabel(defaultChoice)
      : capability.status === "unsupported"
        ? "Not supported"
        : "Provider default";
  const statusFor = (advertised: unknown, verification: boolean | undefined) =>
    verification === false
      ? "Incompatible"
      : verification === true
        ? "Verified"
        : advertised === false
          ? "Unsupported"
          : advertised === true
            ? "Advertised / unverified"
            : "Unverified";
  const automaticState = {
    ...state,
    profiles: [{ ...profile, overrides: {} }],
  };
  let context: number | undefined,
    output: number | undefined,
    problem: string | undefined;
  try {
    const budget = resolveContextBudget(
      profileBudgetLimits(
        automaticState,
        profile.id,
        profileSnapshot(state, profile),
        now,
      ),
    );
    context = budget.ceiling;
    output = budget.output;
    const effectiveBudget = resolveContextBudget(
      profileBudgetLimits(
        state,
        profile.id,
        profileSnapshot(state, profile),
        now,
      ),
    );
    if (!profile.overrides.maxOutput) output = effectiveBudget.output;
  } catch (error) {
    problem = error instanceof Error ? error.message : "Review model settings";
  }
  const practical = profile.recommendations.workingContext;
  const verifiedContext = profile.contextCalibration ? trustedContext(state, profile, now) :
    practical &&
    practical.source === "measured" &&
    practical.confidence === "observed" &&
    scoped(practical, 7 * 86400_000) &&
    typeof practical.value === "number" &&
    practical.value === context
      ? practical.value
      : undefined;
  let status: ModelReadiness = "Unverified";
  const testedContext = typeof profile.overrides.workingContext?.evidence.value === "number" ? profile.overrides.workingContext.evidence.value : context;
  const providerDefaultTools = profile.toolVerification ? toolVerificationState(state, profile, now, testedContext) : statusFor(value("trainedForTools"), verified("tools"));
  const agentRecommendation = automaticAgentRecommendation(state, profile, testedContext, now);
  const tools = agentRecommendation ? "Verified" : providerDefaultTools;
  const safeConservativeContext = !profile.overrides.workingContext && context !== undefined && context <= UNKNOWN_CONTEXT_POLICY &&
    agentRecommendation?.record.context === context;
  if (
    !inventory?.connected &&
    inventory?.error !== "unsupported-probe-route" &&
    inventory
  )
    status =
      inventory.error === "authentication-failed"
        ? "Needs attention"
        : "Offline";
  else if (inventory?.connected && !listed) status = "Unavailable";
  else if (
    listed?.chat === "unsupported" ||
    (!profile.toolVerification && verified("tools") === false) ||
    verified("reasoning") === false
  )
    status = "Incompatible";
  else if (profile.toolVerification && ["Incompatible", "Unsupported"].includes(tools)) status = "Chat only";
  else if (tools === "Needs attention") status = "Needs attention";
  else if (problem) status = "Needs attention";
  else if (
    inventory?.connected &&
    listed &&
    inventory.observedAt <= now &&
    now - inventory.observedAt < PROBE_INVENTORY_TTL_MS &&
    (verifiedContext || safeConservativeContext) &&
    (tools === "Verified") &&
    (profile.toolVerification || capability.status === "unsupported" || verified("reasoning") === true)
  )
    status = "Ready";
  return {
    version: ONBOARDING_COMPATIBILITY_VERSION,
    identity: [
      endpointBackend(endpoint),
      endpoint.id,
      endpoint.configurationRevision,
      profile.transportModelId,
      profile.deploymentId,
      profile.modelRevision,
    ],
    status,
    problem,
    tools,
    providerDefaultTools,
    vision: statusFor(value("vision"), verified("vision")),
    structuredOutput: statusFor(
      value("structuredOutput"),
      verified("structuredOutput"),
    ),
    reasoning: {
      capability,
      providerDefault,
      recommended: agentRecommendation?.configuration ? effortLabel(agentRecommendation.choice) : recommendedReasoning,
      agentRecommendation,
      verified: verified("reasoning"),
      provenance: defaultChoice
        ? "provider-metadata"
        : "provider-default-omission",
      wire: "omit" as const,
    },
    context: {
      recommended: context,
      verified: verifiedContext,
      advertised: value("advertisedContext"),
      loaded: profile.evidence.find(
        (e) =>
          e.metric === "probe.loadedContext" &&
          scoped(e, PROBE_INSTANCE_TTL_MS),
      )?.value,
      provenance: verifiedContext ? "measured" : "conservative-policy",
      override: profile.overrides.workingContext?.evidence.value,
    },
    output: {
      recommended: output,
      provenance: "existing-budget-policy",
      override: profile.overrides.maxOutput?.evidence.value,
    },
    fallback: "Explicit policy only",
    evidence: metadata,
  };
}
