import type {
  SelfHostedEndpoint,
  SelfHostedProfile,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  probeEvidenceIsFresh,
  type ProbeSnapshot,
} from "@/modules/ai/lib/selfHostedProbe";
import type { InferenceSnapshot } from "@/modules/ai/lib/inferenceLifecycle";

export const HEALTH_RECENCY_MS = 30_000;
export function selfHostedHealth(
  options: {
    endpoint: SelfHostedEndpoint;
    profile?: SelfHostedProfile;
    snapshot?: ProbeSnapshot | null;
    checking?: boolean;
    calibrating?: boolean;
    inference?: InferenceSnapshot | null;
  },
  now = Date.now(),
): { label: string; detail: string } {
  const { endpoint, profile, inference } = options;
  const snapshot =
    options.snapshot?.endpointId === endpoint.id &&
    options.snapshot.configurationRevision === endpoint.configurationRevision
      ? options.snapshot
      : null;
  if (options.calibrating)
    return { label: "Calibrating", detail: "Explicit optimization is running" };
  if (options.checking || snapshot?.refreshing)
    return { label: "Checking", detail: "Checking configured server" };
  if (inference?.admission?.endpointId === endpoint.id) {
    if (["queued", "awaiting-admission"].includes(inference.phase))
      return {
        label: "Limited",
        detail: "Waiting for available server capacity",
      };
    if (inference.phase === "generating")
      return { label: "Ready", detail: "Generating on this server" };
    if (inference.phase === "stopping")
      return {
        label: "Stopping",
        detail: "Waiting for cancellation acknowledgement",
      };
    if (["connecting", "waiting-first-output"].includes(inference.phase))
      return { label: "Waiting", detail: "Waiting for server output" };
  }
  const error = snapshot?.errors[snapshot.errors.length - 1]?.error;
  if (error?.code === "authentication-failed")
    return {
      label: "Authentication required",
      detail: "Last check could not authenticate",
    };
  if (error?.statusCode === 429)
    return { label: "Rate limited", detail: "Last check was rate limited" };
  if (error && ["unreachable", "dns-failure"].includes(error.code))
    return { label: "Offline", detail: "Server unavailable at last check" };
  const sample = profile?.calibration?.samples
    .filter(
      (s) =>
        s.configurationRevision === endpoint.configurationRevision &&
        s.observedAt <= now &&
        now - s.observedAt < HEALTH_RECENCY_MS,
    )
    .slice(-1)[0];
  switch (sample?.outcome) {
    case "auth":
      return {
        label: "Authentication required",
        detail: "Recent inference could not authenticate",
      };
    case "rate-limit":
      return {
        label: "Rate limited",
        detail: "Recent inference was rate limited",
      };
    case "offline":
      return {
        label: "Offline",
        detail: "Recent inference could not reach the server",
      };
    case "loading":
      return { label: "Loading", detail: "Server reported model loading" };
    case "resource":
      return {
        label: "Limited",
        detail: "Recent inference reported a resource limit",
      };
  }
  const model = snapshot?.models.find(
    (m) => m.id === profile?.transportModelId,
  );
  if (profile && snapshot?.connected && !snapshot.stale && !model)
    return { label: "Unavailable", detail: "Model is absent from the current server inventory" };
  if (model?.chat === "unsupported")
    return { label: "Limited", detail: "Not a supported chat model" };
  const loaded = model?.evidence.find(
    (e) =>
      e.metric === "probe.loaded" &&
      (profile?.deploymentId == null ||
        e.scope.deploymentId === profile.deploymentId) &&
      probeEvidenceIsFresh(e, endpoint, snapshot, now),
  );
  if (loaded?.value === false)
    return { label: "Limited", detail: "Model reported as not loaded" };
  if (
    snapshot?.connected &&
    !snapshot.stale &&
    snapshot.observedAt <= now &&
    now - snapshot.observedAt < snapshot.inventoryTtlMs
  )
    return {
      label: "Ready",
      detail: "Recent connection check; model readiness may be unknown",
    };
  if (sample?.outcome === "success")
    return { label: "Ready", detail: "Recent successful inference" };
  return {
    label: "Unverified",
    detail: snapshot
      ? "Evidence expired or incomplete; refresh needed"
      : "No recent server evidence",
  };
}
