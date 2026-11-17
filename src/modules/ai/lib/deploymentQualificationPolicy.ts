import {
  capabilityStatus,
  deploymentQualificationEvidenceReceiptSchema,
  deploymentQualificationState,
  runtimeCapabilityAllows,
  type DeploymentQualificationContext,
  type DeploymentQualificationState,
  type DeploymentRuntimeObservation,
  type LocalComputeFabric,
  type RuntimeCapabilityName,
} from "@/modules/ai/lib/localComputeFabric";

/** An LM2F assessment is distinct from a runtime or model declaration.
 * Qualified is the only affirmative authorization result. */
export type CapabilityDecision =
  | { state: "Qualified"; available: true; reason: string; lastResultAt: number | null; lastResult?: string }
  | { state: "Unsupported" | "Unknown" | "Requires Qualification" |
      "Qualification Stale" | "Qualification Failed"; available: false;
      reason: string; lastResultAt: number | null; lastResult?: string };

function latestEvidence(fabric: LocalComputeFabric, deploymentId: string, capability: string) {
  const receipts = fabric.qualificationReceipts ?? [];
  const eligible = receipts.filter(record => !!record && typeof record === "object" &&
    "scope" in record && "capability" in record &&
    record.capability === capability &&
    (record as { scope?: { deploymentId?: unknown } }).scope?.deploymentId === deploymentId);
  if (!eligible.length) return { at: null, result: undefined };
  const row = eligible.map((record, index) => ({
    record, index, at: Number((record as { verifiedAt?: number }).verifiedAt ?? 0),
  })).sort((a, b) => b.at - a.at || b.index - a.index)[0];
  const parsed = deploymentQualificationEvidenceReceiptSchema.safeParse(row.record);
  return {
    at: Number.isSafeInteger(row.at) && row.at >= 0 ? row.at : null,
    result: parsed.success ? parsed.data.status : "unrecognized historical receipt",
  };
}

export function assessDeploymentCapability(
  fabric: LocalComputeFabric,
  deploymentId: string,
  capability: RuntimeCapabilityName,
  observation?: DeploymentRuntimeObservation,
  context: DeploymentQualificationContext = {},
  now = Date.now(),
): CapabilityDecision {
  const deployment = fabric.deployments.find(item => item.id === deploymentId);
  const runtime = fabric.runtimes.find(item => item.id === deployment?.runtimeId);
  const last = latestEvidence(fabric, deploymentId, capability);
  const lastResultAt = last.at;
  const deny = (state: Exclude<CapabilityDecision["state"], "Qualified">, reason: string): CapabilityDecision =>
    ({ state, available: false, reason, lastResultAt, lastResult: last.result });
  if (!deployment || !runtime || fabric.deployments.filter(item => item.id === deploymentId).length !== 1)
    return deny("Unknown", "Deployment identity unavailable or ambiguous.");
  const declared = capabilityStatus(runtime, capability);
  if (declared === "unsupported")
    return deny("Unsupported", "Deployment runtime does not support the required protocol.");
  if (declared === "unknown")
    return deny("Unknown", "Runtime capability is unknown; no capability is authorized.");
  const result = deploymentQualificationState(
    fabric, deploymentId, capability, observation, undefined, now, context,
  );
  if (result === "Verified" && runtimeCapabilityAllows(runtime, capability, true))
    return { state: "Qualified", available: true,
      reason: "Current verifier-owned evidence qualifies this exact deployment.",
      lastResultAt, lastResult: last.result };
  if (result === "Unsupported")
    return deny("Unsupported", "The deployment qualification observed unsupported behavior.");
  if (result === "Failed" || result === "Incomplete")
    return deny("Qualification Failed", "The last qualification failed or did not complete.");
  if (result === "Stale")
    return deny("Qualification Stale",
      "Qualification stale after runtime, deployment, configuration, context or epoch change.");
  return deny("Requires Qualification",
    "Runtime capability is declared, but this deployment still requires qualification.");
}

export type AgentEligibilityDecision = {
  eligible: boolean;
  reason: string;
  requirements: Record<string, CapabilityDecision>;
};

/** Native-tool syntax alone is not Agent reliability. Tool argument construction,
 * downstream tool results, sequential calls and absence of fake effects require
 * their OWN current evidence. No runtime metadata can bypass a missing proof. */
export const AGENT_QUALIFICATION_REQUIREMENTS = [
  "native-tools", "tool-arguments", "tool-results",
  "sequential-tools", "no-fabricated-effects",
] as const satisfies readonly RuntimeCapabilityName[];

export function assessDeploymentAgentEligibility(
  fabric: LocalComputeFabric,
  deploymentId: string,
  observation?: DeploymentRuntimeObservation,
  context: DeploymentQualificationContext = {},
  now = Date.now(),
): AgentEligibilityDecision {
  const requirements = Object.fromEntries(AGENT_QUALIFICATION_REQUIREMENTS.map(cap =>
    [cap, assessDeploymentCapability(fabric, deploymentId, cap, observation, context, now)])) as
    Record<string, CapabilityDecision>;
  const failed = AGENT_QUALIFICATION_REQUIREMENTS.find(name => !requirements[name].available);
  return failed
    ? { eligible: false, requirements,
        reason: `Agent unavailable: ${failed} — ${requirements[failed].reason}` }
    : { eligible: true, requirements,
        reason: "Agent-qualified for this deployment, protocol and tool schema." };
}

export type QualificationPanelStatus = {
  chat: CapabilityDecision;
  streaming: CapabilityDecision;
  completion: CapabilityDecision;
  cancellation: CapabilityDecision;
  jsonMode: CapabilityDecision;
  structured: CapabilityDecision;
  grammar: CapabilityDecision;
  toolProtocol: CapabilityDecision;
  nativeTools: CapabilityDecision;
  agent: AgentEligibilityDecision;
};

export function deploymentQualificationPanelStatus(
  fabric: LocalComputeFabric,
  deploymentId: string,
  observation?: DeploymentRuntimeObservation,
  now = Date.now(),
): QualificationPanelStatus {
  return {
    chat: assessDeploymentCapability(fabric, deploymentId, "chat", observation, {}, now),
    streaming: assessDeploymentCapability(fabric, deploymentId, "streaming", observation, {}, now),
    completion: assessDeploymentCapability(fabric, deploymentId, "terminal-completion", observation, {}, now),
    cancellation: assessDeploymentCapability(fabric, deploymentId, "cancellation", observation, {}, now),
    jsonMode: assessDeploymentCapability(fabric, deploymentId, "json-mode", observation, {}, now),
    structured: assessDeploymentCapability(fabric, deploymentId, "json-schema", observation, {}, now),
    grammar: assessDeploymentCapability(fabric, deploymentId, "grammar", observation, {}, now),
    toolProtocol: assessDeploymentCapability(fabric, deploymentId, "tool-protocol", observation, {}, now),
    nativeTools: assessDeploymentCapability(fabric, deploymentId, "native-tools", observation, {}, now),
    agent: assessDeploymentAgentEligibility(fabric, deploymentId, observation, {}, now),
  };
}

export function isCurrentVerifiedState(state: DeploymentQualificationState): boolean {
  return state === "Verified";
}
