import type { ModelInfo, ProviderId } from "@/modules/ai/config";
import { modelOnboarding } from "@/modules/ai/lib/modelOnboarding";
import {
  ensureSelfHostedProfile,
  resolveSelfHostedSelection,
  endpointBackend,
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
  return `self-hosted:${profile.backend
    ? JSON.stringify([profile.endpointId, profile.transportModelId, profile.deploymentId, profile.modelRevision ?? null, profile.backend])
    : profile.modelRevision
    ? JSON.stringify([profile.endpointId, profile.transportModelId, profile.deploymentId, profile.modelRevision])
    : profile.id}`;
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
  const hint = endpointBackend(endpoint);
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
    label: target.profile.saved?.label ?? state.inventories?.find(i => i.endpointId === target.endpoint.id &&
      i.configurationRevision === target.endpoint.configurationRevision)?.models.find(m => m.id === target.profile.transportModelId)?.name ?? target.profile.transportModelId,
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
      (!p.saved && endpoint.legacy?.profileId !== p.id && !state.inventories?.some(i =>
        i.endpointId === endpoint.id && i.configurationRevision === endpoint.configurationRevision &&
        i.models.some(m => m.id === p.transportModelId)))
    )
      return [];
    const id =
      endpoint.legacy?.profileId === p.id && !p.modelRevision
        ? endpoint.legacy.selectionId
        : selfHostedSelectionId(p);
    const info = selfHostedModelInfo(id, state);
    return info ? [info] : [];
  });
}

export function canonicalSelfHostedSelectionId(id: string, state?: SelfHostedState): string {
  if (!state) return id;
  const target = resolveSelfHostedSelection(state, id);
  if (target.status !== "available" || !target.profile.modelRevision) return id;
  // Only unversioned legacy aliases migrate. A captured old digest never follows a new one.
  return selfHostedSelectionId(target.profile);
}

export function selfHostedPickerStatus(selectionId: string, state: SelfHostedState, now = Date.now()): { label: string; disabled: boolean } | undefined {
  const target = resolveSelfHostedSelection(state, selectionId);
  if (target.status === "not-managed") return undefined;
  if (target.status === "missing") return { label: "Unavailable", disabled: true };
  const inventory = state.inventories?.find(i => i.endpointId === target.endpoint.id &&
    i.configurationRevision === target.endpoint.configurationRevision);
  if (!inventory) return { label: "Unverified", disabled: false };
  if (!inventory.connected) {
    if (inventory.error === "unsupported-probe-route") return { label: "Unverified", disabled: false };
    return { label: inventory.error === "authentication-failed" ? "Authentication required" : "Offline", disabled: true };
  }
  const model = inventory.models.find(m => m.id === target.profile.transportModelId);
  if (!model) return { label: "Unavailable", disabled: true };
  if (model.chat === "unsupported") return { label: "Incompatible", disabled: true };
  const readiness = modelOnboarding(state, target.profile, now);
  if (readiness?.status === "Incompatible")
    return { label: readiness.status, disabled: true };
  if (inventory.observedAt > now || now - inventory.observedAt >= 300_000)
    return { label: "Unverified", disabled: false };
  return { label: readiness?.status ?? "Unverified", disabled: readiness?.status === "Needs attention" };
}

export function compatibleServerBaseURL(endpoint: SelfHostedEndpoint): string {
  const url = new URL(endpoint.baseURL);
  let path = url.pathname.replace(/\/+$/, "");
  if (
    !path ||
    ((endpointBackend(endpoint) === "ollama" ||
      endpointBackend(endpoint) === "lmstudio") &&
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
  const status = selfHostedPickerStatus(selectionId, state);
  if (status?.disabled)
    throw new Error(`Model unavailable (${status.label}). Refresh this server or explicitly choose another model.`);
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
