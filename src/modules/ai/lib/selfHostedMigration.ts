import {
  LMSTUDIO_DEFAULT_BASE_URL,
  MLX_DEFAULT_BASE_URL,
  OLLAMA_DEFAULT_BASE_URL,
} from "@/modules/ai/config";
import {
  addSelfHostedEndpoint,
  createSelfHostedEndpoint,
  editSelfHostedEndpoint,
  ensureSelfHostedProfile,
  readSelfHostedState,
  setProfileOverride,
  type EndpointCredentialReference,
  type SelfHostedBackend,
  type SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";

type LegacyEndpoint = {
  id: string;
  selectionId: string;
  alias: string;
  baseURL: string;
  modelId: string;
  contextLimit?: number;
  backendHint: SelfHostedBackend;
  credentialRef: EndpointCredentialReference | null;
};

export function migrateSelfHostedProfiles(
  raw: unknown,
  legacy: ReadonlyMap<string, unknown>,
  now = Date.now(),
): SelfHostedState {
  let state = readSelfHostedState(raw);
  for (const candidate of legacyEndpoints(legacy)) {
    let created: ReturnType<typeof createSelfHostedEndpoint>;
    try {
      created = createSelfHostedEndpoint(candidate, candidate.id, now);
    } catch {
      // Keep malformed legacy values untouched; they must not prevent startup.
      continue;
    }
    const snapshot = {
      alias: created.alias,
      baseURL: created.baseURL,
      modelId: candidate.modelId,
      contextLimit: candidate.contextLimit ?? null,
    };
    const serialized = JSON.stringify(snapshot);
    let previous: Partial<typeof snapshot> = {};
    let endpoint = state.endpoints.find(
      (e) => e.legacy?.selectionId === candidate.selectionId,
    );
    if (
      endpoint?.deletedAt !== undefined ||
      endpoint?.legacy?.snapshot === serialized
    )
      continue;
    if (!endpoint) {
      if (state.endpoints.some((e) => e.id === created.id)) continue;
      if (state.endpoints.length >= 256) break;
      state = addSelfHostedEndpoint(state, created);
      endpoint = created;
    } else {
      try {
        previous = JSON.parse(endpoint.legacy?.snapshot ?? "{}") ?? {};
      } catch {
        /* invalid old snapshot */
      }
      state = editSelfHostedEndpoint(
        state,
        endpoint.id,
        {
          ...(previous.alias !== snapshot.alias
            ? { alias: snapshot.alias }
            : {}),
          ...(previous.baseURL !== snapshot.baseURL
            ? { baseURL: snapshot.baseURL }
            : {}),
        },
        now,
      );
    }
    let profileId: string | null = null;
    if (
      candidate.modelId &&
      candidate.modelId.length <= 1024 &&
      (state.profiles.length < 2048 ||
        state.profiles.some(
          (profile) =>
            profile.endpointId === endpoint.id &&
            profile.transportModelId === candidate.modelId &&
            profile.deploymentId === null,
        ))
    ) {
      const ensured = ensureSelfHostedProfile(
        state,
        endpoint.id,
        candidate.modelId,
        null,
        now,
      );
      const isNewProfile = ensured.state !== state;
      state = ensured.state;
      profileId = ensured.profile.id;
      // A legacy value has no proof of backend configuration or observation time.
      const existingPin = ensured.profile.overrides.configuredContext;
      if (
        candidate.contextLimit !== undefined &&
        (isNewProfile || previous.contextLimit !== snapshot.contextLimit) &&
        (!existingPin || existingPin.evidence.observedAt === null)
      ) {
        state = setProfileOverride(
          state,
          profileId,
          "configuredContext",
          candidate.contextLimit,
          now,
        );
        state = {
          ...state,
          profiles: state.profiles.map((p) => {
            const pin = p.overrides.configuredContext;
            return p.id === profileId && pin
              ? {
                  ...p,
                  overrides: {
                    ...p.overrides,
                    configuredContext: {
                      ...pin,
                      evidence: { ...pin.evidence, observedAt: null },
                    },
                  },
                }
              : p;
          }),
        };
      }
    }
    state = {
      ...state,
      endpoints: state.endpoints.map((e) =>
        e.id === endpoint.id
          ? {
              ...e,
              legacy: {
                selectionId: candidate.selectionId,
                profileId,
                snapshot: serialized,
              },
            }
          : e,
      ),
    };
  }
  return state;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function context(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function legacyEndpoints(
  legacy: ReadonlyMap<string, unknown>,
): LegacyEndpoint[] {
  const result: LegacyEndpoint[] = [];
  const locals = [
    ["ollama", "Ollama", OLLAMA_DEFAULT_BASE_URL],
    ["lmstudio", "LM Studio", LMSTUDIO_DEFAULT_BASE_URL],
    ["mlx", "MLX", MLX_DEFAULT_BASE_URL],
  ] as const;
  for (const [provider, alias, defaultURL] of locals) {
    const modelId = text(legacy.get(`${provider}ModelId`));
    const configuredURL = text(legacy.get(`${provider}BaseURL`));
    if (!modelId && !configuredURL) continue;
    result.push({
      id: `legacy:${provider}`,
      selectionId: `${provider}-local`,
      alias,
      baseURL: configuredURL || defaultURL,
      modelId,
      backendHint: provider,
      credentialRef: null,
    });
  }
  const custom = legacy.get("customEndpoints");
  if (Array.isArray(custom))
    for (const item of custom.slice(0, 256)) {
      if (!item || typeof item !== "object") continue;
      const endpointId = text(item.id);
      if (!endpointId || endpointId.length > 512) continue;
      result.push({
        id: endpointId,
        selectionId: `compat-${endpointId}`,
        alias: text(item.name) || "Custom endpoint",
        baseURL: text(item.baseURL),
        modelId: text(item.modelId),
        contextLimit: context(item.contextLimit),
        backendHint: "openai-compatible",
        credentialRef: { kind: "custom-endpoint", endpointId },
      });
    }
  const legacyURL = text(legacy.get("openaiCompatibleBaseURL"));
  const legacyModel = text(legacy.get("openaiCompatibleModelId"));
  if (legacyURL || legacyModel)
    result.push({
      id: "legacy:openai-compatible",
      selectionId: "openai-compatible-custom",
      alias: "Custom endpoint",
      baseURL: legacyURL,
      modelId: legacyModel,
      contextLimit: context(legacy.get("openaiCompatibleContextLimit")),
      backendHint: "openai-compatible",
      credentialRef: { kind: "provider", providerId: "openai-compatible" },
    });
  return result;
}
