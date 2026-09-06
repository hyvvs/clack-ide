import type { ModelInfo, ProviderId } from "@/modules/ai/config";
import {
  ensureSelfHostedProfile,
  resolveSelfHostedSelection,
  type SelfHostedState,
  type SelfHostedEndpoint,
  type SelfHostedProfile,
} from "@/modules/ai/lib/selfHostedProfiles";
import type { ModelTransportIdentity } from "@/modules/ai/lib/savedProviderModels";
import type {
  ProviderKeys,
  CustomEndpointKeys,
} from "@/modules/ai/lib/keyring";

export const SELF_HOSTED_BACKENDS = {
  ollama: "Ollama",
  lmstudio: "LM Studio",
  vllm: "vLLM",
  mlx: "MLX",
  "openai-compatible": "OpenAI-compatible server",
} as const;

export function selfHostedSelectionId(profile: SelfHostedProfile): string {
  return `self-hosted:${profile.id}`;
}

export function saveSelfHostedModel(
  state: SelfHostedState,
  endpointId: string,
  modelId: string,
  label?: string,
): SelfHostedState {
  if (/[\u0000-\u001f\u007f]/.test(modelId))
    throw new Error("Invalid model ID");
  const result = ensureSelfHostedProfile(state, endpointId, modelId);
  return {
    ...result.state,
    profiles: result.state.profiles.map((p) =>
      p.id === result.profile.id
        ? {
            ...p,
            saved: {
              ...(label?.trim() ? { label: label.trim().slice(0, 1024) } : {}),
            },
          }
        : p,
    ),
  };
}

export function endpointProvider(endpoint: SelfHostedEndpoint): ProviderId {
  const hint = endpoint.backendHint;
  return hint === "ollama" || hint === "lmstudio" || hint === "mlx"
    ? hint
    : "openai-compatible";
}

export function endpointAllowsPrivate(endpoint: SelfHostedEndpoint): boolean {
  // Legacy local/custom adapters already explicitly allowed private endpoints.
  return endpoint.allowPrivateNetwork ?? !!endpoint.legacy;
}

export function selfHostedModelInfo(
  selectionId: string,
  state?: SelfHostedState,
): ModelInfo | null {
  if (!state) {
    if (selectionId.startsWith("self-hosted:"))
      throw new Error("Model unavailable");
    return null;
  }
  const target = resolveSelfHostedSelection(state, selectionId);
  if (target.status === "not-managed") return null;
  if (target.status === "missing")
    throw new Error("Model unavailable. Choose a model in Models & Providers.");
  return {
    id: selectionId,
    provider: endpointProvider(target.endpoint),
    label: target.profile.saved?.label ?? target.profile.transportModelId,
    hint: target.endpoint.alias,
    description: `${target.endpoint.alias} / ${target.profile.transportModelId}`,
    capabilities: { intelligence: 0, speed: 0, cost: 0 },
  };
}

export function savedSelfHostedModelInfos(state: SelfHostedState): ModelInfo[] {
  return state.profiles.flatMap((p) => {
    const endpoint = state.endpoints.find(
      (e) => e.id === p.endpointId && e.deletedAt === undefined,
    );
    if (
      !endpoint ||
      p.deploymentId !== null ||
      (!p.saved && endpoint.legacy?.profileId !== p.id)
    )
      return [];
    const id =
      endpoint.legacy?.profileId === p.id
        ? endpoint.legacy.selectionId
        : selfHostedSelectionId(p);
    const info = selfHostedModelInfo(id, state);
    return info ? [info] : [];
  });
}

export function compatibleServerBaseURL(endpoint: SelfHostedEndpoint): string {
  const url = new URL(endpoint.baseURL);
  let path = url.pathname.replace(/\/+$/, "");
  if (
    !path ||
    ((endpoint.backendHint === "ollama" ||
      endpoint.backendHint === "lmstudio") &&
      !path.endsWith("/v1"))
  )
    path += "/v1";
  url.pathname = path;
  return url.href.replace(/\/$/, "");
}

export function selfHostedTransportIdentity(
  selectionId: string,
  state?: SelfHostedState,
): ModelTransportIdentity | null {
  if (!state) {
    if (selectionId.startsWith("self-hosted:"))
      throw new Error("Model unavailable");
    return null;
  }
  const target = resolveSelfHostedSelection(state, selectionId);
  if (target.status === "not-managed") return null;
  if (target.status === "missing")
    throw new Error(
      "Model unavailable. Restore the server or choose another model.",
    );
  const { endpoint, profile } = target;
  return {
    providerId: endpointProvider(endpoint),
    transportModelId: profile.transportModelId,
    endpointBaseURL: compatibleServerBaseURL(endpoint),
    selfHosted: {
      endpointId: endpoint.id,
      profileId: profile.id,
      configurationRevision: endpoint.configurationRevision,
      allowPrivateNetwork: endpointAllowsPrivate(endpoint),
      credentialRef: endpoint.credentialRef,
      // Migrated compatible configurations historically permit keyless access.
      credentialRequired: !!endpoint.credentialRef && !endpoint.legacy,
    },
  };
}

export function selfHostedCredential(
  identity: ModelTransportIdentity,
  keys: ProviderKeys,
  endpointKeys: CustomEndpointKeys,
): string | undefined {
  const ref = identity.selfHosted?.credentialRef;
  const key =
    ref?.kind === "provider"
      ? keys[ref.providerId]
      : ref?.kind === "custom-endpoint"
        ? endpointKeys[ref.endpointId]
        : null;
  if (!key && identity.selfHosted?.credentialRequired)
    throw new Error(
      "Authentication required. Configure this server's credential in Models & Providers.",
    );
  return key || undefined;
}
