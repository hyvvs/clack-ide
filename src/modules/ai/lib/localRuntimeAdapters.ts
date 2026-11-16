import type { ProviderId } from "@/modules/ai/config";
import type { SelfHostedEndpoint } from "@/modules/ai/lib/selfHostedProfiles";
import type { ManagedLocalRouteIdentity, ManagedLocalNativeRoute } from "@/modules/ai/lib/managedLocalRuntime";
import { assertManagedLocalNativeRoute } from "@/modules/ai/lib/managedLocalRuntime";
import type {
  ResolvedModelDeployment, RuntimeCapability,
  RuntimeCapabilityStatus,
} from "@/modules/ai/lib/localComputeFabric";

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
    "native-tools": declared("requires-qualification"),
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
