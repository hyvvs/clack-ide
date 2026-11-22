import { invoke } from "@tauri-apps/api/core";
import type { ModelTransportIdentity } from "@/modules/ai/lib/savedProviderModels";
import type { ActualExecution, RequestedExecution } from "@/modules/ai/lib/localComputeFabric";

export type ManagedLocalRouteIdentity = NonNullable<ModelTransportIdentity["managedLocal"]>;
/** Read-only native candidate admission. UNKNOWN health is null until Ready.
 * observedAvailableBytes describes free capacity, not model consumption;
 * estimatedRequiredBytes is deliberately an estimate, not measured usage. */
export type ManagedNativeCandidateEvidence = {
  policyPosition: number;
  backend: string;
  deviceIds: string[];
  runtimeVariantId?: string | null;
  installed: boolean;
  verified: boolean;
  healthy: boolean | null;
  memoryAdmissible: boolean;
  trustState: string;
  qualificationState: string;
  state: "rejected" | "admitted" | "not-evaluated";
  reasons: string[];
  estimatedRequiredBytes?: number | null;
  observedAvailableBytes?: number | null;
};
export type ManagedLocalNativeStatus = {
  installed: boolean;
  state: "Not Installed" | "Stopped" | "Starting" | "Loading" | "Recovering" | "Ready" | "Stopping" | "Failed";
  version: string;
  runtimeId?: string;
  epoch: string;
  deploymentId?: string | null;
  /** Content-free native SHA-256 of canonical Fabric deployment identity. */
  deploymentIdentityHash?: `sha256:${string}` | null;
  modelDigest?: string | null;
  processId?: number | null;
  port?: number | null;
  error?: string | null;
  /** Native verified launch observation; absent unless exact owner is Ready. */
  actualExecution?: ActualExecution | null;
  requestedBackend?: string | null;
  selectedBackend?: string | null;
  requestedGpuLayers?: number | null;
  selectedGpuLayers?: number | null;
  selectedDeviceId?: string | null;
  fallbackUsed?: boolean;
  fallbackAuthorized?: boolean;
  fallbackReason?: string | null;
  gpuFreeBeforeBytes?: number | null;
  gpuFreeAfterBytes?: number | null;
  cudaProcessVramBytes?: number | null;
  /** Admission estimate, not a measured GPU allocation. */
  gpuEstimatedRequiredBytes?: number | null;
  /** Native owned-child recovery; never inferred from a renderer request. */
  recoveryState?: "none" | "pending-cpu-recovery" | "cpu-fallback-launched" | "failed";
  failureKind?: "child-exited-before-ready" | "ready-timeout" | "dependency-load-failure" | "port-collision" | "startup-failed" | "cpu-recovery-failed" | null;
  /** Conservative first inference-dispatch barrier: bearer route already issued. */
  inferenceRouteIssued?: boolean;
  /** Native-selected index into the exact persisted candidate order. */
  selectedCandidateIndex?: number | null;
  /** Authoritative native readback; never a second persisted policy authority. */
  requestedExecution?: RequestedExecution | null;
  candidateEvaluations?: ManagedNativeCandidateEvidence[];
};
export type ManagedCudaVariantStatus = {
  installed: boolean;
  runtimeVariantId: "b12248/cuda";
  backend: "cuda";
  version: string;
  platform: string;
  source: string;
  engineArchiveSha256: string;
  dependencyArchiveSha256: string;
  executableSha256: string;
  license: string;
  error?: string | null;
};
export type ManagedLocalNativeRoute = {
  baseUrl: string;
  apiKey: string;
  epoch: string;
  modelAlias: string;
  processId: number;
};

/**
 * The trusted native process owns installation, file identity, localhost
 * transport, secret and epoch. Neither the selection nor persisted fabric
 * contains an arbitrary URL or grants automatic runtime availability.
 */
export async function admittedManagedLocalRoute(
  deployment: ManagedLocalRouteIdentity,
): Promise<ManagedLocalNativeRoute> {
  const route = await invoke<ManagedLocalNativeRoute>("managed_local_runtime_route", {
    deploymentId: deployment.deploymentId,
    deploymentIdentity: deployment.deploymentIdentity,
  });
  assertManagedLocalNativeRoute(route);
  return route;
}

export function assertManagedLocalNativeRoute(
  route: ManagedLocalNativeRoute,
): void {
  let endpoint: URL;
  try { endpoint = new URL(route.baseUrl); }
  catch { throw new Error("Managed runtime returned an invalid loopback route"); }
  if (
    endpoint.protocol !== "http:" ||
    endpoint.hostname !== "127.0.0.1" ||
    !endpoint.port ||
    Number(endpoint.port) < 1 || Number(endpoint.port) > 65535 ||
    endpoint.pathname !== "/v1" ||
    endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
    !/^[0-9a-f]{64}$/.test(route.apiKey) ||
    !/^[0-9a-f]{64}$/.test(route.epoch) ||
    !/^clack-[0-9a-f]{16}$/.test(route.modelAlias) ||
    !Number.isSafeInteger(route.processId) || route.processId < 1
  ) {
    throw new Error("Managed runtime returned an untrusted route identity");
  }
}

/** Verify epoch and native process on EACH provider request, including Chat
 * streaming/continuation/compaction. A saved route never carries authority. */
export async function assertCurrentManagedLocalRoute(
  deployment: ManagedLocalRouteIdentity,
  captured: ManagedLocalNativeRoute,
): Promise<void> {
  const route = await admittedManagedLocalRoute(deployment);
  if (
    route.baseUrl !== captured.baseUrl ||
    route.apiKey !== captured.apiKey ||
    route.epoch !== captured.epoch ||
    route.modelAlias !== captured.modelAlias ||
    route.processId !== captured.processId
  ) {
    throw new Error("Managed runtime restarted or changed. No inference was sent.");
  }
}
