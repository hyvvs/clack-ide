import {
  endpointIdFromCompatModel,
  getProvider,
  isCompatModelId,
  PROVIDERS,
  resolveModel,
  type CustomEndpoint,
  type ModelInfo,
  type ProviderId,
} from "@/modules/ai/config";

export const SAVED_PROVIDER_MODELS_SCHEMA_VERSION = 1;
export const SAVED_PROVIDER_MODEL_SELECTION_PREFIX = "saved-provider:";

export type SavedProviderModel = {
  id: string;
  providerId: ProviderId;
  transportModelId: string;
  displayName?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export type SavedProviderModelsMigration = {
  models: SavedProviderModel[];
  version: number;
  changed: boolean;
};

export type ModelTransportIdentity = {
  providerId: ProviderId;
  transportModelId: string;
  endpointBaseURL?: string;
  customEndpointId?: string;
};

type CreateSavedProviderModelInput = {
  providerId: ProviderId;
  transportModelId: string;
  displayName?: string;
  enabled?: boolean;
};

const PROVIDER_IDS = new Set<string>(PROVIDERS.map((provider) => provider.id));

export function newSavedProviderModelId(): string {
  return `spm-${crypto.randomUUID()}`;
}

export function createSavedProviderModel(
  input: CreateSavedProviderModelInput,
  id = newSavedProviderModelId(),
  now = Date.now(),
): SavedProviderModel {
  const normalizedId = id.trim();
  const transportModelId = input.transportModelId.trim();
  const displayName = input.displayName?.trim();
  if (!normalizedId) throw new Error("Saved model ID is empty");
  if (!PROVIDER_IDS.has(input.providerId)) {
    throw new Error(`Unknown provider: ${input.providerId}`);
  }
  if (!transportModelId) throw new Error("Provider model ID is empty");
  return {
    id: normalizedId,
    providerId: input.providerId,
    transportModelId,
    ...(displayName ? { displayName } : {}),
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeSavedProviderModels(
  value: unknown,
): SavedProviderModel[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const providerModels = new Set<string>();
  const result: SavedProviderModel[] = [];
  for (const entry of value) {
    const normalized = normalizeSavedProviderModel(entry);
    if (!normalized) continue;
    const providerModelKey = `${normalized.providerId}\0${normalized.transportModelId}`;
    if (ids.has(normalized.id) || providerModels.has(providerModelKey)) continue;
    ids.add(normalized.id);
    providerModels.add(providerModelKey);
    result.push(normalized);
  }
  return result;
}

export function migrateSavedProviderModels(input: {
  stored: unknown;
  storedVersion: unknown;
  legacyOpenrouterModelId: string;
  now?: number;
}): SavedProviderModelsMigration {
  const normalized = normalizeSavedProviderModels(input.stored);
  const models = normalized.slice();
  const legacyModelId = input.legacyOpenrouterModelId.trim();
  if (
    legacyModelId &&
    !models.some(
      (model) =>
        model.providerId === "openrouter" &&
        model.transportModelId === legacyModelId,
    )
  ) {
    models.push(
      createSavedProviderModel(
        { providerId: "openrouter", transportModelId: legacyModelId },
        legacyOpenrouterSavedModelId(legacyModelId),
        input.now ?? Date.now(),
      ),
    );
  }
  const storedWasCanonical =
    Array.isArray(input.stored) &&
    JSON.stringify(input.stored) === JSON.stringify(normalized);
  return {
    models,
    version: SAVED_PROVIDER_MODELS_SCHEMA_VERSION,
    changed:
      input.storedVersion !== SAVED_PROVIDER_MODELS_SCHEMA_VERSION ||
      !storedWasCanonical ||
      models.length !== normalized.length,
  };
}

export function savedProviderModelSelectionId(savedModelId: string): string {
  return `${SAVED_PROVIDER_MODEL_SELECTION_PREFIX}${savedModelId}`;
}

export function isSavedProviderModelSelectionId(value: string): boolean {
  return (
    value.startsWith(SAVED_PROVIDER_MODEL_SELECTION_PREFIX) &&
    value.length > SAVED_PROVIDER_MODEL_SELECTION_PREFIX.length
  );
}

export function savedProviderModelIdFromSelection(value: string): string {
  return isSavedProviderModelSelectionId(value)
    ? value.slice(SAVED_PROVIDER_MODEL_SELECTION_PREFIX.length)
    : "";
}

export function findSavedProviderModel(
  selectionId: string,
  models: readonly SavedProviderModel[],
): SavedProviderModel | null {
  const id = savedProviderModelIdFromSelection(selectionId);
  if (!id) return null;
  return models.find((model) => model.id === id) ?? null;
}

export function resolveSavedProviderModelTarget(
  selectionId: string,
  models: readonly SavedProviderModel[],
): { providerId: ProviderId; transportModelId: string } | null {
  const model = findSavedProviderModel(selectionId, models);
  if (!model?.enabled) return null;
  return {
    providerId: model.providerId,
    transportModelId: model.transportModelId,
  };
}

export function getSavedProviderModelInfo(
  selectionId: string,
  models: readonly SavedProviderModel[],
): ModelInfo {
  const model = findSavedProviderModel(selectionId, models);
  if (!model) throw new Error(`Saved provider model not found: ${selectionId}`);
  const provider = getProvider(model.providerId);
  return {
    id: selectionId,
    provider: model.providerId,
    label: model.displayName || model.transportModelId,
    hint: provider.label,
    description: `${provider.label} model ${model.transportModelId}`,
    capabilities: { intelligence: 3, speed: 3, cost: 3 },
  };
}

export function getEnabledSavedProviderModelInfos(
  models: readonly SavedProviderModel[],
): ModelInfo[] {
  return models
    .filter((model) => model.enabled)
    .map((model) =>
      getSavedProviderModelInfo(savedProviderModelSelectionId(model.id), models),
    );
}

export function modelSelectionMatchesQuery(
  model: ModelInfo,
  query: string,
): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return (
    model.label.toLowerCase().includes(normalized) ||
    model.hint.toLowerCase().includes(normalized) ||
    model.description.toLowerCase().includes(normalized) ||
    model.provider.includes(normalized) ||
    (model.tags?.some((tag) => tag.toLowerCase().includes(normalized)) ?? false)
  );
}

export function resolveModelSelectionInfo(
  selectionId: string,
  customEndpoints: readonly CustomEndpoint[] = [],
  savedModels: readonly SavedProviderModel[] = [],
): ModelInfo {
  return isSavedProviderModelSelectionId(selectionId)
    ? getSavedProviderModelInfo(selectionId, savedModels)
    : resolveModel(selectionId, customEndpoints);
}

export function providerForModelSelection(
  selectionId: string,
  customEndpoints: readonly CustomEndpoint[],
  savedModels: readonly SavedProviderModel[],
): ProviderId | null {
  try {
    return resolveModelSelectionInfo(
      selectionId,
      customEndpoints,
      savedModels,
    ).provider;
  } catch {
    return null;
  }
}

export function resolveModelTransportIdentity(
  selectionId: string,
  config: {
    customEndpoints?: readonly CustomEndpoint[];
    savedProviderModels?: readonly SavedProviderModel[];
    lmstudioModelId?: string;
    mlxModelId?: string;
    ollamaModelId?: string;
    openaiCompatibleBaseURL?: string;
    openaiCompatibleModelId?: string;
    openrouterModelId?: string;
  } = {},
): ModelTransportIdentity {
  const saved = resolveSavedProviderModelTarget(
    selectionId,
    config.savedProviderModels ?? [],
  );
  if (saved) return saved;

  if (isCompatModelId(selectionId)) {
    const endpointId = endpointIdFromCompatModel(selectionId);
    const endpoint = config.customEndpoints?.find(
      (candidate) => candidate.id === endpointId,
    );
    if (!endpoint?.modelId.trim() || !endpoint.baseURL.trim()) {
      throw new Error(`Custom endpoint is unavailable: ${endpointId}`);
    }
    return {
      providerId: "openai-compatible",
      transportModelId: endpoint.modelId.trim(),
      endpointBaseURL: endpoint.baseURL.trim(),
      customEndpointId: endpointId,
    };
  }

  const info = resolveModel(selectionId, config.customEndpoints ?? []);
  let transportModelId = info.id;
  let endpointBaseURL: string | undefined;
  if (info.id === "lmstudio-local") {
    transportModelId = requiredConfiguredId("LM Studio", config.lmstudioModelId);
  } else if (info.id === "mlx-local") {
    transportModelId = requiredConfiguredId("MLX", config.mlxModelId);
  } else if (info.id === "ollama-local") {
    transportModelId = requiredConfiguredId("Ollama", config.ollamaModelId);
  } else if (info.id === "openai-compatible-custom") {
    transportModelId = requiredConfiguredId(
      "OpenAI-compatible",
      config.openaiCompatibleModelId,
    );
    endpointBaseURL = requiredConfiguredId(
      "OpenAI-compatible endpoint",
      config.openaiCompatibleBaseURL,
    );
  } else if (info.id === "openrouter-custom") {
    transportModelId = requiredConfiguredId(
      "OpenRouter",
      config.openrouterModelId,
    );
  }
  return {
    providerId: info.provider,
    transportModelId,
    ...(endpointBaseURL ? { endpointBaseURL } : {}),
  };
}

function requiredConfiguredId(label: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is not configured.`);
  return normalized;
}

function normalizeSavedProviderModel(value: unknown): SavedProviderModel | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Record<keyof SavedProviderModel, unknown>>;
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const providerId =
    typeof candidate.providerId === "string" ? candidate.providerId : "";
  const transportModelId =
    typeof candidate.transportModelId === "string"
      ? candidate.transportModelId.trim()
      : "";
  if (!id || !PROVIDER_IDS.has(providerId) || !transportModelId) return null;
  const displayName =
    typeof candidate.displayName === "string"
      ? candidate.displayName.trim()
      : "";
  const createdAt = finiteTimestamp(candidate.createdAt);
  const updatedAt = finiteTimestamp(candidate.updatedAt, createdAt);
  return {
    id,
    providerId: providerId as ProviderId,
    transportModelId,
    ...(displayName ? { displayName } : {}),
    enabled: candidate.enabled !== false,
    createdAt,
    updatedAt,
  };
}

function finiteTimestamp(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function legacyOpenrouterSavedModelId(modelId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < modelId.length; i++) {
    hash ^= modelId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `spm-openrouter-${(hash >>> 0).toString(36)}`;
}
