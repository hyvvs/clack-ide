import {
  compatModelIdForEndpoint,
  endpointIdFromCompatModel,
  isCompatModelId,
  MODELS,
  providerNeedsKey,
  type CustomEndpoint,
  type ProviderId,
} from "../config";
import type { ProviderKeys } from "./keyring";
import {
  findSavedProviderModel,
  isSavedProviderModelSelectionId,
  providerForModelSelection,
  savedProviderModelSelectionId,
  type SavedProviderModel,
} from "./savedProviderModels";

export type ProviderRestoreConfig = {
  apiKeys: ProviderKeys;
  defaultModelId: string;
  lastUsedProviderId: ProviderId | null;
  lastUsedModelId: string | null;
  lmstudioBaseURL: string;
  lmstudioModelId: string;
  mlxBaseURL: string;
  mlxModelId: string;
  ollamaBaseURL: string;
  ollamaModelId: string;
  openaiCompatibleBaseURL: string;
  openaiCompatibleModelId: string;
  openrouterModelId: string;
  customEndpoints: readonly CustomEndpoint[];
  savedProviderModels: readonly SavedProviderModel[];
};

function filled(value: string): boolean {
  return value.trim().length > 0;
}

function endpointUsable(endpoint: CustomEndpoint): boolean {
  return filled(endpoint.baseURL) && filled(endpoint.modelId);
}

export function isProviderConfigured(
  provider: ProviderId,
  config: ProviderRestoreConfig,
): boolean {
  if (providerNeedsKey(provider)) return Boolean(config.apiKeys[provider]);
  switch (provider) {
    case "lmstudio":
      return filled(config.lmstudioBaseURL) && filled(config.lmstudioModelId);
    case "mlx":
      return filled(config.mlxBaseURL) && filled(config.mlxModelId);
    case "ollama":
      return filled(config.ollamaBaseURL) && filled(config.ollamaModelId);
    case "openai-compatible":
      return (
        (filled(config.openaiCompatibleBaseURL) &&
          filled(config.openaiCompatibleModelId)) ||
        config.customEndpoints.some(endpointUsable)
      );
    default:
      return true;
  }
}

function modelUsable(
  modelId: string,
  provider: ProviderId,
  config: ProviderRestoreConfig,
): boolean {
  if (!isProviderConfigured(provider, config)) return false;
  if (isSavedProviderModelSelectionId(modelId)) {
    const saved = findSavedProviderModel(modelId, config.savedProviderModels);
    return Boolean(saved?.enabled && saved.providerId === provider);
  }
  if (isCompatModelId(modelId)) {
    if (provider !== "openai-compatible") return false;
    const endpointId = endpointIdFromCompatModel(modelId);
    return config.customEndpoints.some(
      (endpoint) => endpoint.id === endpointId && endpointUsable(endpoint),
    );
  }
  const model = MODELS.find((candidate) => candidate.id === modelId);
  if (!model || model.provider !== provider) return false;
  if (model.id === "lmstudio-local") return filled(config.lmstudioModelId);
  if (model.id === "mlx-local") return filled(config.mlxModelId);
  if (model.id === "ollama-local") return filled(config.ollamaModelId);
  if (model.id === "openai-compatible-custom") {
    return (
      filled(config.openaiCompatibleBaseURL) &&
      filled(config.openaiCompatibleModelId)
    );
  }
  if (model.id === "openrouter-custom") {
    return filled(config.openrouterModelId);
  }
  return true;
}

function fallbackForProvider(
  provider: ProviderId,
  config: ProviderRestoreConfig,
): string | null {
  const saved = config.savedProviderModels.find(
    (model) => model.providerId === provider && model.enabled,
  );
  if (saved && isProviderConfigured(provider, config)) {
    return savedProviderModelSelectionId(saved.id);
  }
  const registered = MODELS.find((model) =>
    modelUsable(model.id, provider, config),
  );
  if (registered) return registered.id;
  if (provider === "openai-compatible") {
    const endpoint = config.customEndpoints.find(endpointUsable);
    return endpoint ? compatModelIdForEndpoint(endpoint.id) : null;
  }
  return null;
}

export function resolveRestoredModel(
  config: ProviderRestoreConfig,
): string | null {
  const lastProvider = config.lastUsedProviderId;
  const lastModel = config.lastUsedModelId;
  if (lastProvider && isProviderConfigured(lastProvider, config)) {
    if (lastProvider === "openrouter" && lastModel === "openrouter-custom") {
      const migrated = config.savedProviderModels.find(
        (model) =>
          model.providerId === "openrouter" &&
          model.enabled &&
          (!config.openrouterModelId ||
            model.transportModelId === config.openrouterModelId),
      );
      if (migrated) return savedProviderModelSelectionId(migrated.id);
    }
    if (lastModel && modelUsable(lastModel, lastProvider, config)) {
      return lastModel;
    }
    const sameProviderFallback = fallbackForProvider(lastProvider, config);
    if (sameProviderFallback) return sameProviderFallback;
  }

  const defaultModel = MODELS.find(
    (model) => model.id === config.defaultModelId,
  );
  if (
    defaultModel &&
    modelUsable(defaultModel.id, defaultModel.provider, config)
  ) {
    return defaultModel.id;
  }

  for (const model of MODELS) {
    if (modelUsable(model.id, model.provider, config)) return model.id;
  }
  const endpoint = config.customEndpoints.find(endpointUsable);
  return endpoint ? compatModelIdForEndpoint(endpoint.id) : null;
}

export function providerForSelectedModel(
  modelId: string,
  customEndpoints: readonly CustomEndpoint[],
  savedProviderModels: readonly SavedProviderModel[],
): ProviderId | null {
  return providerForModelSelection(
    modelId,
    customEndpoints,
    savedProviderModels,
  );
}
