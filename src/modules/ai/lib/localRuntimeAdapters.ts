import type { ProviderId } from "@/modules/ai/config";
import { invoke } from "@tauri-apps/api/core";
import type { SelfHostedEndpoint } from "@/modules/ai/lib/selfHostedProfiles";
import type { ManagedLocalRouteIdentity, ManagedLocalNativeRoute } from "@/modules/ai/lib/managedLocalRuntime";
import { assertManagedLocalNativeRoute } from "@/modules/ai/lib/managedLocalRuntime";
import type { ManagedLocalNativeStatus, ManagedCudaVariantStatus } from "@/modules/ai/lib/managedLocalRuntime";
import type {
  ResolvedModelDeployment, RuntimeCapability,
  RuntimeCapabilityStatus,
} from "@/modules/ai/lib/localComputeFabric";
import { KNOWN_EXECUTION_BACKENDS } from "@/modules/ai/lib/localComputeFabric";

/** LM2C: runtime adapters are explicit. Merely persisting a future runtime
 * type never activates a provider, a loader or a generic HTTP fallback. */
export type RuntimeProviderTransport = {
  providerId: ProviderId;
  modelName: string;
  baseURL: string;
};
export interface RuntimeAdapter {
  readonly type: string;
  resolve(target: ResolvedModelDeployment): RuntimeProviderTransport;
  capabilities(connected?: boolean, version?: string): Record<string, RuntimeCapability>;
}

/** LM2D: conceptual managed GGUF has no legacy endpoint/profile. Its own
 * adapter requires the native-verified process route, never a generic URL. */
export const ManagedLlamaRuntimeAdapter = {
  type: "clack-managed-llama.cpp" as const,
  resolve(deployment: ManagedLocalRouteIdentity, nativeRoute: ManagedLocalNativeRoute): RuntimeProviderTransport {
    assertManagedLocalNativeRoute(nativeRoute);
    const digest = deployment.artifactDigest;
    if (!/^sha256:[a-f0-9]{64}$/.test(digest) ||
        nativeRoute.modelAlias !== `clack-${digest.slice(7, 23)}` ||
        !deployment.deploymentId || !deployment.deploymentIdentity ||
        !Number.isSafeInteger(deployment.configurationRevision) ||
        deployment.configurationRevision < 1) {
      throw new Error("Native managed runtime route does not match the exact GGUF deployment");
    }
    return {
      providerId: "openai-compatible",
      modelName: nativeRoute.modelAlias,
      baseURL: nativeRoute.baseUrl,
    };
  },
};

/** Runtime-provider lifecycle boundary. The native runtime owner remains the
 * ONE scheduler/launcher/credential source. An adapter describes observable
 * capabilities and delegates to existing audited IPC; it is not a second
 * process manager, trust database or universal speculative launcher. */
export type RuntimeExecutionAdapter = {
  readonly runtimeId: string;
  readonly runtimeVersion: string;
  readonly implementedBackends: readonly string[];
  readonly futureBackends: readonly string[];
  describeBackends(): ReadonlyArray<{
    backend: string;
    executable: boolean;
    state: "IMPLEMENTED" | "UNSUPPORTED";
    reason: string;
  }>;
  /** Static supported device modes, not a discovery of physical devices.
   * Physical device availability and executable ownership are independently
   * established by LM3 and exact native runtime Ready evidence. */
  describeDeviceSupport(): ReadonlyArray<{
    backend: string;
    deviceClass: "cpu" | "accelerator";
    singleDeviceExecutable: boolean;
    physicalMultiDeviceExecutable: false;
  }>;
  provision(input: {kind:"cpu";officialArchivePath:string} |
    {kind:"cuda";officialEngineArchivePath:string;officialDependenciesArchivePath:string}): Promise<void>;
  verify(): Promise<{runtime: ManagedLocalNativeStatus; cuda: ManagedCudaVariantStatus}>;
  /** Health and manifest provenance are native observations, not adapter guesses. */
  health(identity: ManagedLocalRouteIdentity): Promise<ManagedLocalNativeStatus>;
  provenance(): Promise<{runtime: ManagedLocalNativeStatus; cuda: ManagedCudaVariantStatus}>;
  status(identity: ManagedLocalRouteIdentity): Promise<ManagedLocalNativeStatus>;
  start(identity: ManagedLocalRouteIdentity): Promise<ManagedLocalNativeStatus>;
  stop(identity: ManagedLocalRouteIdentity): Promise<ManagedLocalNativeStatus>;
  restart(identity: ManagedLocalRouteIdentity): Promise<ManagedLocalNativeStatus>;
  readyRoute(identity: ManagedLocalRouteIdentity): Promise<ManagedLocalNativeRoute>;
  /** Actual evidence is ONLY sourced from the native status receipt. */
  actualEvidence(status: ManagedLocalNativeStatus): ManagedLocalNativeStatus["actualExecution"];
};

const exactManagedSelector=(identity:ManagedLocalRouteIdentity)=>({
  deploymentId:identity.deploymentId,deploymentIdentity:identity.deploymentIdentity,
});
/** First concrete implementation: the existing pinned and manifest-verified
 * llama.cpp b12248 CPU/CUDA owner. Future backends retain truthful states
 * until separately reviewed and native-implemented. */
export const ManagedLlamaExecutionAdapter: RuntimeExecutionAdapter = {
  runtimeId:"clack-managed-llama.cpp",
  runtimeVersion:"b12248",
  implementedBackends:["cpu","cuda"],
  // Avoid top-level cycle: Fabric imports Ollama adapter declarations during
  // module initialization. Future identifiers do not instantiate launchers.
  futureBackends:["rocm","intel","metal","vulkan","directml"],
  describeBackends(){
    return KNOWN_EXECUTION_BACKENDS.map(backend=>({
      backend,executable:backend==="cpu"||backend==="cuda",
      state:backend==="cpu"||backend==="cuda" ? "IMPLEMENTED" as const : "UNSUPPORTED" as const,
      reason:backend==="cpu"||backend==="cuda"
        ? "Requires native installation, pinned manifest verification and exact Ready receipt"
        : "Adapter is representable but no native launcher/readiness/provenance contract is implemented",
    }));
  },
  describeDeviceSupport(){
    return KNOWN_EXECUTION_BACKENDS.map(backend=>({
      backend,deviceClass:backend==="cpu" ? "cpu" as const : "accelerator" as const,
      singleDeviceExecutable:backend==="cpu"||backend==="cuda",
      // Slice 4 can persist a multi-device policy; no physical execution
      // adapter or hardware acceptance for that mode exists yet.
      physicalMultiDeviceExecutable:false as const,
    }));
  },
  async provision(input){
    // Never automatically discover, download or run any executable by name.
    if(input.kind==="cpu"){
      await invoke("managed_local_runtime_install_bundle",{path:input.officialArchivePath});
    }else {
      await invoke("managed_local_runtime_install_cuda_bundles",{
        engineZipPath:input.officialEngineArchivePath,
        cudaDllZipPath:input.officialDependenciesArchivePath,
      });
    }
  },
  async verify(){
    const [runtime,cuda]=await Promise.all([
      invoke<ManagedLocalNativeStatus>("managed_local_runtime_status"),
      invoke<ManagedCudaVariantStatus>("managed_local_runtime_cuda_variant_status"),
    ]);
    return {runtime,cuda};
  },
  health(identity){return this.status(identity);},
  provenance(){return this.verify();},
  status(identity){return invoke("managed_local_runtime_status",exactManagedSelector(identity));},
  start(identity){return invoke("managed_local_runtime_start",exactManagedSelector(identity));},
  stop(identity){return invoke("managed_local_runtime_stop",exactManagedSelector(identity));},
  async restart(identity){
    await this.stop(identity);
    return this.start(identity);
  },
  async readyRoute(identity){
    const {admittedManagedLocalRoute}=await import("./managedLocalRuntime");
    return admittedManagedLocalRoute(identity);
  },
  actualEvidence(status){
    return status.state==="Ready" && status.installed
      ? status.actualExecution ?? null : null;
  },
};

export function compatibleRuntimeEndpoint(endpoint: SelfHostedEndpoint) {
  const url = new URL(endpoint.baseURL);
  let path = url.pathname.replace(/\/+$/, "");
  const backend = endpoint.backendHint ?? endpoint.detectedBackend;
  if (!path || ((backend === "ollama" || backend === "lmstudio") &&
      !path.endsWith("/v1"))) path += "/v1";
  url.pathname = path;
  return url.href.replace(/\/$/, "");
}

/** Native Ollama API route names stay at the runtime boundary, not Chat/Agent. */
export const OllamaRuntimeAdapter: RuntimeAdapter & {
  nativePaths: Readonly<{
    models: "/api/tags";
    metadata: "/api/show";
    version: "/api/version";
    residency: "/api/ps";
  }>;
} = {
  type: "ollama",
  nativePaths: {
    models: "/api/tags",
    metadata: "/api/show",
    version: "/api/version",
    residency: "/api/ps",
  },
  resolve(target) {
    if (target.runtime.type !== "ollama" ||
        target.runtime.legacyEndpointId !== target.endpoint.id ||
        (target.endpoint.backendHint ?? target.endpoint.detectedBackend) !== "ollama")
      throw new Error("Ollama runtime deployment identity changed");
    return {
      providerId: "ollama",
      modelName: target.deployment.runtimeModelName,
      baseURL: compatibleRuntimeEndpoint(target.endpoint),
    };
  },
  capabilities: ollamaRuntimeCapabilities,
};

/** Protocol-level declarations, not deployment-level native-tool proof. */
export function ollamaRuntimeCapabilities(
  connected: boolean | undefined,
  version: string | undefined,
): Record<string, RuntimeCapability> {
  const declared = (value: RuntimeCapabilityStatus): RuntimeCapability => ({
    status: value, source: "declared",
  });
  return {
    chat: declared("supported"),
    completions: declared("supported"),
    streaming: declared("supported"),
    cancellation: declared("supported"),
    "terminal-completion": declared("requires-qualification"),
    "instruction-adherence": declared("requires-qualification"),
    "native-tools": declared("requires-qualification"),
    "tool-protocol": declared("requires-qualification"),
    "tool-arguments": declared("requires-qualification"),
    "tool-results": declared("requires-qualification"),
    "sequential-tools": declared("requires-qualification"),
    "no-fabricated-effects": declared("requires-qualification"),
    "reasoning-controls": declared("requires-qualification"),
    "context-configuration": declared("requires-qualification"),
    "list-models": connected === undefined
      ? declared("unknown") : { status: connected ? "supported" : "unknown", source: connected ? "observed" : "unknown" },
    "inspect-model": declared("unknown"),
    "runtime-health": connected === undefined
      ? declared("unknown") : { status: "supported", source: "observed" },
    "runtime-version": version
      ? { status: "supported", source: "observed" } : declared("unknown"),
  };
}

// Compatibility for already-supported non-Ollama self-hosted providers.
// This is NOT an LM Studio, vLLM, MLX or llama.cpp *new* adapter.
const legacyProvider = (target: ResolvedModelDeployment): RuntimeProviderTransport => {
  const backend = target.endpoint.backendHint ?? target.endpoint.detectedBackend;
  const legacyUnknown = !backend && target.runtime.type === "openai-compatible-local";
  if (!legacyUnknown && (!backend || target.runtime.type !== backend))
    throw new Error("No runtime adapter for this deployment");
  return {
    // Existing managed non-Ollama endpoints were already transported through
    // the OpenAI-compatible SDK. Advertised runtime type is not a provider
    // implementation or an alternate reasoning wire.
    providerId: "openai-compatible",
    modelName: target.deployment.runtimeModelName,
    baseURL: compatibleRuntimeEndpoint(target.endpoint),
  };
};

export function resolveRuntimeProviderTransport(
  target: ResolvedModelDeployment,
): RuntimeProviderTransport {
  if (target.runtime.type === "ollama")
    return OllamaRuntimeAdapter.resolve(target);
  if (!target.runtime.legacyEndpointId)
    throw new Error("Runtime is configured but no provider adapter is installed");
  return legacyProvider(target);
}
