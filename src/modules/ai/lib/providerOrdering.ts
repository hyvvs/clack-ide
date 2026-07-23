import {
  providerNeedsKey,
  type ProviderInfo,
} from "@/modules/ai/config";
import type { ProviderKeys } from "@/modules/ai/lib/keyring";

export function partitionProvidersByConfiguration(
  providers: readonly ProviderInfo[],
  apiKeys: ProviderKeys,
): { configured: ProviderInfo[]; unconfigured: ProviderInfo[] } {
  const configured: ProviderInfo[] = [];
  const unconfigured: ProviderInfo[] = [];

  for (const provider of providers) {
    if (provider.id === "openai-compatible") continue;
    const hasRequiredKey = providerNeedsKey(provider.id)
      ? Boolean(apiKeys[provider.id])
      : true;
    (hasRequiredKey ? configured : unconfigured).push(provider);
  }

  return { configured, unconfigured };
}
