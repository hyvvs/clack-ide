import { CONTEXT_CALIBRATION } from "@/modules/ai/lib/contextCalibrationSchema";
import type {
  SelfHostedEndpoint,
  SelfHostedProfile,
  SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import type { ProbeSnapshot } from "@/modules/ai/lib/selfHostedProbe";
import {
  acceptsLegacyDeploymentQualification,
  capabilityStatus,
  resolveModelDeployment,
} from "@/modules/ai/lib/localComputeFabric";

type Runtime = {
  epoch: string;
  version: string;
  configurationRevision: number;
  at: number;
};
const runtimes = new Map<string, Runtime>();
export function rememberContextRuntime(endpointId: string, runtime: Runtime) {
  runtimes.set(endpointId, runtime);
  if (runtimes.size > 256)
    runtimes.delete(runtimes.keys().next().value as string);
}
export function contextRuntime(endpointId: string) {
  return runtimes.get(endpointId);
}
export function forgetContextRuntime(endpointId: string) {
  runtimes.delete(endpointId);
}
export function contextMetadata(
  profile: SelfHostedProfile,
  endpoint: SelfHostedEndpoint,
  metric: string,
  now = Date.now(),
  age: number = CONTEXT_CALIBRATION.runtimeMs,
) {
  const matches = profile.evidence.filter(
    (e) =>
      e.metric === `probe.${metric}` &&
      e.scope.endpointId === endpoint.id &&
      e.scope.configurationRevision === endpoint.configurationRevision &&
      e.scope.transportModelId === profile.transportModelId &&
      e.scope.deploymentId === profile.deploymentId &&
      e.scope.modelRevision === profile.modelRevision &&
      e.observedAt !== null &&
      e.observedAt <= now &&
      now - e.observedAt < age &&
      e.confidence === "reported" &&
      ["backend-reported", "advertised"].includes(e.source),
  );
  return matches.length === 1 ? matches[0].value : undefined;
}
// Clack's native Ollama probe writes the *requested* context as measured,
// observed evidence (not backend-reported metadata). Keep that distinction:
// the provider can report the loaded allocation, but cannot attest what Clack
// actually asked for on the preceding native request.
function observedRequestedContext(
  profile: SelfHostedProfile,
  endpoint: SelfHostedEndpoint,
  calibratedAt: number,
  loaded: number,
  now: number,
) {
  const receipts = profile.evidence.filter(e =>
    e.metric === "probe.requestedContext" &&
    e.source === "measured" && e.confidence === "observed" &&
    e.scope.endpointId === endpoint.id &&
    e.scope.configurationRevision === endpoint.configurationRevision &&
    e.scope.transportModelId === profile.transportModelId &&
    e.scope.deploymentId === profile.deploymentId &&
    e.scope.modelRevision === profile.modelRevision &&
    e.observedAt !== null && e.observedAt >= calibratedAt &&
    e.observedAt <= now && now - e.observedAt < CONTEXT_CALIBRATION.runtimeMs &&
    (e.expiresAt === undefined || e.expiresAt > now));
  if (receipts.length !== 1 || receipts[0].value !== loaded) return false;
  // The reported *loaded* context and allocation must come from the same or
  // a later live probe than the Clack-issued request, never older metadata.
  return ["probe.loadedContext", "probe.runtimeAllocation"].every(metric =>
    profile.evidence.some(e => e.metric === metric &&
      e.source === "backend-reported" && e.confidence === "reported" &&
      e.scope.endpointId === endpoint.id &&
      e.scope.configurationRevision === endpoint.configurationRevision &&
      e.scope.transportModelId === profile.transportModelId &&
      e.scope.deploymentId === profile.deploymentId &&
      e.scope.modelRevision === profile.modelRevision &&
      e.observedAt !== null && e.observedAt >= receipts[0].observedAt! &&
      e.observedAt <= now && now - e.observedAt < CONTEXT_CALIBRATION.runtimeMs));
}
export function contextReasoningIdentity(
  profile: SelfHostedProfile,
  endpoint: SelfHostedEndpoint,
  now = Date.now(),
) {
  return JSON.stringify([
    contextMetadata(profile, endpoint, "thinking", now, 300_000),
    contextMetadata(profile, endpoint, "thinkingControls", now, 300_000),
    contextMetadata(profile, endpoint, "thinkingDefault", now, 300_000),
  ]);
}
export function trustedContext(
  state: SelfHostedState,
  profile: SelfHostedProfile,
  now = Date.now(),
): number | undefined {
  const endpoint = state.endpoints.find(
    (e) => e.id === profile.endpointId && e.deletedAt == null,
  );
  const record = profile.contextCalibration,
    runtime = endpoint && contextRuntime(endpoint.id);
  const deployment = resolveModelDeployment(state, profile);
  const inventory = state.inventories?.find(
    (i) =>
      i.endpointId === endpoint?.id &&
      i.configurationRevision === endpoint?.configurationRevision,
  );
  if (
    !endpoint ||
    !acceptsLegacyDeploymentQualification(state, profile, deployment) ||
    !deployment ||
    capabilityStatus(deployment.runtime, "context-configuration") === "unsupported" ||
    !record?.highest ||
    !runtime ||
    record.status === "verifying" ||
    record.status === "unsupported" ||
    record.scope.endpointId !== endpoint.id ||
    record.scope.configurationRevision !== endpoint.configurationRevision ||
    record.scope.model !== profile.transportModelId ||
    record.scope.deployment !== profile.deploymentId ||
    record.scope.digest !== profile.modelRevision ||
    (endpoint.backendHint ?? endpoint.detectedBackend) !==
      record.scope.backend ||
    record.scope.runtimeEpoch !== runtime.epoch ||
    record.scope.providerVersion !== runtime.version ||
    runtime.configurationRevision !== endpoint.configurationRevision ||
    runtime.at > now ||
    now - runtime.at >= CONTEXT_CALIBRATION.runtimeMs ||
    record.updatedAt > now ||
    record.expiresAt <= now ||
    !inventory?.connected ||
    record.scope.reasoning !==
      contextReasoningIdentity(profile, endpoint, now) ||
    contextMetadata(profile, endpoint, "loaded", now) !== true ||
    !(() => {
      const loaded = contextMetadata(profile, endpoint, "loadedContext", now);
      const allocation = contextMetadata(profile, endpoint, "runtimeAllocation", now);
      if (loaded === record.highest && allocation === record.allocation) return true;
      // A *known successful* per-request tier changes the live KV allocation.
      // Retain the upper verified ceiling only if the current process reports
      // exactly that lower requested/loaded tier and a fresh real allocation.
      // Silent or arbitrary capacity changes remain untrusted.
      return record.status === "verified" &&
        typeof loaded === "number" && loaded < record.highest &&
        observedRequestedContext(profile, endpoint, record.updatedAt, loaded, now) &&
        typeof allocation === "string" && allocation.length > 0 &&
        record.attempts.some(a =>
          a.context === loaded && a.requested === loaded &&
          a.loaded === loaded && a.outcome === "success");
    })()
  )
    return undefined;
  return record.highest;
}
export function snapshotContext(
  state: SelfHostedState,
  profile: SelfHostedProfile,
  snapshot: ProbeSnapshot | null,
  now = Date.now(),
) {
  if (
    !snapshot ||
    snapshot.endpointId !== profile.endpointId ||
    !snapshot.connected ||
    snapshot.stale
  )
    return undefined;
  const model = snapshot.models.find((m) => m.id === profile.transportModelId);
  if (!model || model.digest !== profile.modelRevision) return undefined;
  return trustedContext(
    {
      ...state,
      inventories: [
        {
          endpointId: snapshot.endpointId,
          configurationRevision: snapshot.configurationRevision,
          observedAt: snapshot.observedAt,
          connected: snapshot.connected,
          backend: snapshot.backend,
          models: [model],
        },
      ],
    },
    { ...profile, evidence: model.evidence },
    now,
  );
}
