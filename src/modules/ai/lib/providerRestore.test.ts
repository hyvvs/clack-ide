import { EMPTY_PROVIDER_KEYS, type ProviderKeys } from "./keyring";
import { describe, expect, it } from "vitest";
import {
  resolveRestoredModel,
  type ProviderRestoreConfig,
} from "./providerRestore";
import {
  createSavedProviderModel,
  savedProviderModelSelectionId,
} from "./savedProviderModels";

function config(
  keys: Partial<ProviderKeys>,
  overrides: Partial<ProviderRestoreConfig> = {},
): ProviderRestoreConfig {
  return {
    apiKeys: { ...EMPTY_PROVIDER_KEYS, ...keys },
    defaultModelId: "gpt-5.4-mini",
    lastUsedProviderId: "openai",
    lastUsedModelId: "gpt-5.4-mini",
    lmstudioBaseURL: "http://localhost:1234/v1",
    lmstudioModelId: "",
    mlxBaseURL: "http://localhost:8080/v1",
    mlxModelId: "",
    ollamaBaseURL: "http://localhost:11434/v1",
    ollamaModelId: "",
    openaiCompatibleBaseURL: "",
    openaiCompatibleModelId: "",
    openrouterModelId: "",
    customEndpoints: [],
    savedProviderModels: [],
    ...overrides,
  };
}

describe("resolveRestoredModel", () => {
  it("restores a valid last-used provider and model", () => {
    expect(resolveRestoredModel(config({ openai: "key" }))).toBe(
      "gpt-5.4-mini",
    );
  });

  it("falls back within a valid provider when its model disappeared", () => {
    expect(
      resolveRestoredModel(
        config(
          { openai: "key" },
          { lastUsedModelId: "removed-openai-model" },
        ),
      ),
    ).toBe("gpt-5.5");
  });

  it("does not restore an unconfigured provider", () => {
    expect(
      resolveRestoredModel(
        config(
          { anthropic: "key" },
          {
            lastUsedProviderId: "openai",
            lastUsedModelId: "gpt-5.4-mini",
          },
        ),
      ),
    ).toBe("claude-opus-4-7");
  });

  it("returns no selection when no provider is configured", () => {
    expect(resolveRestoredModel(config({}))).toBeNull();
  });

  it("restores one of multiple saved OpenRouter model identities", () => {
    const first = createSavedProviderModel(
      {
        providerId: "openrouter",
        transportModelId: "anthropic/claude-sonnet-4.6",
      },
      "personal-sonnet",
      10,
    );
    const second = createSavedProviderModel(
      {
        providerId: "openrouter",
        transportModelId: "openai/gpt-5.5",
        displayName: "GPT 5.5",
      },
      "personal-gpt",
      20,
    );
    expect(
      resolveRestoredModel(
        config(
          { openrouter: "key" },
          {
            lastUsedProviderId: "openrouter",
            lastUsedModelId: savedProviderModelSelectionId(second.id),
            savedProviderModels: [first, second],
          },
        ),
      ),
    ).toBe(savedProviderModelSelectionId(second.id));
  });

  it("falls back to an enabled saved model when the prior one was removed", () => {
    const remaining = createSavedProviderModel(
      {
        providerId: "openrouter",
        transportModelId: "google/gemini-2.5-pro",
      },
      "remaining",
      30,
    );
    expect(
      resolveRestoredModel(
        config(
          { openrouter: "key" },
          {
            lastUsedProviderId: "openrouter",
            lastUsedModelId: savedProviderModelSelectionId("deleted"),
            savedProviderModels: [remaining],
          },
        ),
      ),
    ).toBe(savedProviderModelSelectionId(remaining.id));
  });

  it("maps the legacy OpenRouter selection to its migrated stable model", () => {
    const migrated = createSavedProviderModel(
      {
        providerId: "openrouter",
        transportModelId: "anthropic/legacy-model",
      },
      "migrated",
      40,
    );
    expect(
      resolveRestoredModel(
        config(
          { openrouter: "key" },
          {
            lastUsedProviderId: "openrouter",
            lastUsedModelId: "openrouter-custom",
            openrouterModelId: "anthropic/legacy-model",
            savedProviderModels: [migrated],
          },
        ),
      ),
    ).toBe(savedProviderModelSelectionId(migrated.id));
  });
});
