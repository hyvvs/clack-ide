import { invoke } from "@tauri-apps/api/core";
import type { ModelTransportIdentity } from "@/modules/ai/lib/savedProviderModels";
import type { ActualExecution } from "@/modules/ai/lib/localComputeFabric";

export type ManagedLocalRouteIdentity = NonNullable<ModelTransportIdentity["managedLocal"]>;
export type ManagedLocalNativeStatus = {
  installed: boolean;
  state: "Not Installed" | "Stopped" | "Starting" | "Loading" | "Ready" | "Stopping" | "Failed";
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
