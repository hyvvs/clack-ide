import { PROVIDERS } from "@/modules/ai/config";
import {
  EMPTY_PROVIDER_KEYS,
  type ProviderKeys,
} from "@/modules/ai/lib/keyring";
import { describe, expect, it } from "vitest";
import { partitionProvidersByConfiguration } from "./providerOrdering";

describe("partitionProvidersByConfiguration", () => {
  it("updates configured providers from keys without mutating the registry", () => {
    const providersBefore = [...PROVIDERS];
    const withoutKeys = partitionProvidersByConfiguration(
      PROVIDERS,
      EMPTY_PROVIDER_KEYS,
    );
    const withOpenAi: ProviderKeys = {
      ...EMPTY_PROVIDER_KEYS,
      openai: "configured",
    };
    const withKeys = partitionProvidersByConfiguration(PROVIDERS, withOpenAi);

    expect(withoutKeys.unconfigured.map((provider) => provider.id)).toContain(
      "openai",
    );
    expect(withKeys.configured.map((provider) => provider.id)).toContain(
      "openai",
    );
    expect(PROVIDERS).toEqual(providersBefore);
  });

  it("keeps local providers configured and handles custom endpoints separately", () => {
    const result = partitionProvidersByConfiguration(
      PROVIDERS,
      EMPTY_PROVIDER_KEYS,
    );
    const configuredIds = result.configured.map((provider) => provider.id);
    const allIds = [...result.configured, ...result.unconfigured].map(
      (provider) => provider.id,
    );

    expect(configuredIds).toEqual(
      expect.arrayContaining(["lmstudio", "mlx", "ollama"]),
    );
    expect(allIds).not.toContain("openai-compatible");
  });
});
