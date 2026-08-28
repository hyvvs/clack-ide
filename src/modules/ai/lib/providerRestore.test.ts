import { EMPTY_PROVIDER_KEYS, type ProviderKeys } from "./keyring";
import { describe, expect, it } from "vitest";
import {
  resolveRestoredModel,
  type ProviderRestoreConfig,
} from "./providerRestore";

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
});
