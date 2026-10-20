import { CONTEXT_CALIBRATION } from "@/modules/ai/lib/contextCalibrationSchema";
import type {
  SelfHostedEndpoint,
  SelfHostedProfile,
  SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import type { ProbeSnapshot } from "@/modules/ai/lib/selfHostedProbe";

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
  const inventory = state.inventories?.find(
    (i) =>
      i.endpointId === endpoint?.id &&
      i.configurationRevision === endpoint?.configurationRevision,
  );
  if (
    !endpoint ||
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
    contextMetadata(profile, endpoint, "loadedContext", now) !==
      record.highest ||
    contextMetadata(profile, endpoint, "runtimeAllocation", now) !==
      record.allocation
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
