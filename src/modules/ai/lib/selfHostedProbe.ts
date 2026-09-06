import { invoke } from "@tauri-apps/api/core";
import type { NormalizedAiError, AiErrorKind } from "@/modules/ai/lib/errors";
import type {
  ProfileEvidence,
  SelfHostedEndpoint,
} from "@/modules/ai/lib/selfHostedProfiles";

export const PROBE_INVENTORY_TTL_MS = 300_000;
export const PROBE_INSTANCE_TTL_MS = 30_000;
export type ProbeSupport = "supported" | "unsupported" | "unknown";
export type ProbeErrorCode =
  | "unreachable"
  | "dns-failure"
  | "timeout"
  | "tls-failure"
  | "authentication-failed"
  | "invalid-server-response"
  | "unsupported-probe-route"
  | "response-too-large"
  | "malformed-metadata"
  | "cancelled"
  | "unsafe-endpoint"
  | "invalid-configuration"
  | "request-limit"
  | "busy"
  | "persistence-failed";
export type ProbeError = {
  code: ProbeErrorCode;
  statusCode: number | null;
  reachable: boolean;
};
export type ProbeSnapshot = {
  endpointId: string;
  configurationRevision: number;
  selectedModelId: string | null;
  observedAt: number;
  connected: boolean;
  reachable: boolean;
  credentialUsed: boolean;
  stale: boolean;
  refreshing: boolean;
  inventoryTtlMs: number;
  instanceTtlMs: number;
  models: {
    id: string;
    name: string | null;
    chat: ProbeSupport;
    evidence: ProfileEvidence[];
  }[];
  errors: { route: string | null; error: ProbeError }[];
};
export type ProbeOptions = {
  endpointId: string;
  selectedModelId?: string;
  allowPrivateNetwork?: boolean;
};
type ProbeInvoker = <T>(
  command: string,
  args: Record<string, unknown>,
) => Promise<T>;

// Cache and single-flight ownership stay native, shared by every webview.
export function createSelfHostedProbeClient(call: ProbeInvoker = invoke) {
  const read = (options: ProbeOptions) =>
    call<ProbeSnapshot | null>("self_hosted_probe_cache", { options });
  const refresh = (options: ProbeOptions, restart = false) =>
    call<ProbeSnapshot>("self_hosted_probe", {
      options: { ...options, force: true, restart },
    });
  return {
    read,
    refresh,
    cancel: (endpointId: string) =>
      call<void>("self_hosted_probe_cancel", { endpointId }),
    async inspect(
      options: ProbeOptions,
    ): Promise<{
      cached: ProbeSnapshot | null;
      refresh: Promise<ProbeSnapshot> | null;
    }> {
      const cached = await read(options);
      const stale =
        !cached ||
        cached.stale ||
        Date.now() - cached.observedAt >= PROBE_INVENTORY_TTL_MS;
      return {
        cached,
        refresh: stale || cached?.refreshing ? refresh(options) : null,
      };
    },
  };
}

export function probeEvidenceIsFresh(
  evidence: ProfileEvidence,
  endpoint: SelfHostedEndpoint,
  snapshot: ProbeSnapshot | null,
  now = Date.now(),
): boolean {
  if (
    !snapshot ||
    snapshot.stale ||
    !snapshot.connected ||
    endpoint.deletedAt != null ||
    snapshot.endpointId !== endpoint.id ||
    snapshot.configurationRevision !== endpoint.configurationRevision ||
    evidence.scope.endpointId !== endpoint.id ||
    evidence.scope.configurationRevision !== endpoint.configurationRevision ||
    evidence.observedAt == null ||
    evidence.observedAt > now
  )
    return false;
  const current = snapshot.models
    .find((model) => model.id === evidence.scope.transportModelId)
    ?.evidence.some(
      (item) =>
        item.metric === evidence.metric &&
        item.observedAt === evidence.observedAt &&
        item.scope.deploymentId === evidence.scope.deploymentId &&
        item.value === evidence.value,
    );
  if (!current) return false;
  const runtime = [
    "probe.loaded",
    "probe.loadedContext",
    "probe.reportedParallel",
  ].includes(evidence.metric);
  return (
    now - evidence.observedAt <
    (runtime ? PROBE_INSTANCE_TTL_MS : PROBE_INVENTORY_TTL_MS)
  );
}

const ERRORS: Record<ProbeErrorCode, [AiErrorKind, string]> = {
  unreachable: ["network", "The configured server could not be reached."],
  "dns-failure": [
    "network",
    "The configured server name could not be resolved.",
  ],
  timeout: ["timeout", "The metadata probe exceeded its time limit."],
  "tls-failure": [
    "network",
    "The server's TLS connection could not be verified.",
  ],
  "authentication-failed": [
    "authentication",
    "The configured credential is unavailable or was rejected.",
  ],
  "invalid-server-response": [
    "provider_unavailable",
    "The server did not return a valid JSON metadata response.",
  ],
  "unsupported-probe-route": [
    "provider_unavailable",
    "Model listing is unavailable. A manual model ID remains unverified.",
  ],
  "response-too-large": [
    "bad_request",
    "The metadata response exceeded the size limit.",
  ],
  "malformed-metadata": [
    "bad_request",
    "The metadata has an invalid shape or exceeds record limits.",
  ],
  cancelled: ["cancelled", "The metadata probe was cancelled."],
  "unsafe-endpoint": [
    "authorization",
    "This endpoint is blocked or requires explicit private-network authorization.",
  ],
  "invalid-configuration": [
    "bad_request",
    "The self-hosted endpoint configuration is unavailable or invalid.",
  ],
  "request-limit": [
    "bad_request",
    "The handshake reached its metadata request limit.",
  ],
  busy: [
    "provider_unavailable",
    "The metadata probe queue is full. Retry after an active probe completes.",
  ],
  "persistence-failed": ["internal", "Probe evidence could not be saved."],
};
export function normalizeProbeError(error: ProbeError): NormalizedAiError {
  const [kind, message] = ERRORS[error.code] ?? [
    "unknown",
    "The metadata probe failed.",
  ];
  return {
    kind: error.statusCode === 429 ? "rate_limit" : kind,
    message,
    title: "Self-hosted metadata",
    errorCode: error.code,
    statusCode: error.statusCode ?? undefined,
    disposition: error.code === "cancelled" ? "terminal" : "recoverable",
    retryable: ["unreachable", "dns-failure", "timeout", "busy"].includes(
      error.code,
    ),
  };
}
