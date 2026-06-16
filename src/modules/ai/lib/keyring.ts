import { invoke } from "@tauri-apps/api/core";
import {
  getProvider,
  KEYRING_SERVICE,
  LEGACY_KEYRING_SERVICE,
  PROVIDERS,
  providerSupportsKey,
  type CustomEndpoint,
  type ProviderId,
} from "../config";

export type ProviderKeys = Record<ProviderId, string | null>;
export type CustomEndpointKeys = Record<string, string | null>;

export const EMPTY_PROVIDER_KEYS: ProviderKeys = {
  openai: null,
  anthropic: null,
  google: null,
  xai: null,
  cerebras: null,
  groq: null,
  deepseek: null,
  mistral: null,
  openrouter: null,
  "openai-compatible": null,
  lmstudio: null,
  mlx: null,
  ollama: null,
};

async function readSecret(
  service: string,
  account: string,
): Promise<string | null> {
  try {
    const v = await invoke<string | null>("secrets_get", { service, account });
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

async function writeMigratedSecret(
  account: string,
  value: string,
): Promise<void> {
  try {
    await invoke("secrets_set", {
      service: KEYRING_SERVICE,
      account,
      password: value,
    });
  } catch {
    // Legacy read still succeeded; migration can retry on the next load.
  }
}

async function readSecretWithLegacy(account: string): Promise<string | null> {
  const current = await readSecret(KEYRING_SERVICE, account);
  if (current) return current;
  const legacy = await readSecret(LEGACY_KEYRING_SERVICE, account);
  if (legacy) void writeMigratedSecret(account, legacy);
  return legacy;
}

export async function getKey(provider: ProviderId): Promise<string | null> {
  if (!providerSupportsKey(provider)) return null;
  return readSecretWithLegacy(getProvider(provider).keyringAccount);
}

export async function setKey(provider: ProviderId, key: string): Promise<void> {
  if (!providerSupportsKey(provider)) {
    throw new Error(`${provider} does not use an API key`);
  }
  const trimmed = key.trim();
  if (!trimmed) throw new Error("API key is empty");
  await invoke("secrets_set", {
    service: KEYRING_SERVICE,
    account: getProvider(provider).keyringAccount,
    password: trimmed,
  });
}

export async function clearKey(provider: ProviderId): Promise<void> {
  if (!providerSupportsKey(provider)) return;
  try {
    await invoke("secrets_delete", {
      service: KEYRING_SERVICE,
      account: getProvider(provider).keyringAccount,
    });
  } catch {
    // already absent — fine
  }
}

export async function getAllKeys(): Promise<ProviderKeys> {
  const out = { ...EMPTY_PROVIDER_KEYS };
  const need = PROVIDERS.filter((p) => providerSupportsKey(p.id));
  try {
    const accounts = need.map((p) => p.keyringAccount);
    const results = await invoke<(string | null)[]>("secrets_get_all", {
      service: KEYRING_SERVICE,
      accounts,
    });
    const legacyResults = await invoke<(string | null)[]>("secrets_get_all", {
      service: LEGACY_KEYRING_SERVICE,
      accounts,
    });
    need.forEach((p, i) => {
      const v = results[i] || legacyResults[i];
      out[p.id] = v && v.length > 0 ? v : null;
      if (!results[i] && legacyResults[i]) {
        void writeMigratedSecret(p.keyringAccount, legacyResults[i]);
      }
    });
    return out;
  } catch {
    const entries = await Promise.all(
      need.map(async (p) => [p.id, await getKey(p.id)] as const),
    );
    for (const [id, v] of entries) out[id] = v;
    return out;
  }
}

export function hasAnyKey(keys: ProviderKeys): boolean {
  return PROVIDERS.some((p) => providerSupportsKey(p.id) && !!keys[p.id]);
}

function compatKeyringAccount(endpointId: string): string {
  return `compat-${endpointId}-api-key`;
}

export async function getCustomEndpointKey(
  endpointId: string,
): Promise<string | null> {
  return readSecretWithLegacy(compatKeyringAccount(endpointId));
}

export async function setCustomEndpointKey(
  endpointId: string,
  key: string,
): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) throw new Error("API key is empty");
  await invoke("secrets_set", {
    service: KEYRING_SERVICE,
    account: compatKeyringAccount(endpointId),
    password: trimmed,
  });
}

export async function clearCustomEndpointKey(
  endpointId: string,
): Promise<void> {
  try {
    await invoke("secrets_delete", {
      service: KEYRING_SERVICE,
      account: compatKeyringAccount(endpointId),
    });
  } catch {}
}

export async function getAllCustomEndpointKeys(
  endpoints: readonly CustomEndpoint[],
): Promise<CustomEndpointKeys> {
  if (endpoints.length === 0) return {};
  const out: CustomEndpointKeys = {};
  try {
    const accounts = endpoints.map((e) => compatKeyringAccount(e.id));
    const results = await invoke<(string | null)[]>("secrets_get_all", {
      service: KEYRING_SERVICE,
      accounts,
    });
    const legacyResults = await invoke<(string | null)[]>("secrets_get_all", {
      service: LEGACY_KEYRING_SERVICE,
      accounts,
    });
    endpoints.forEach((e, i) => {
      const v = results[i] || legacyResults[i];
      out[e.id] = v && v.length > 0 ? v : null;
      if (!results[i] && legacyResults[i]) {
        const account = accounts[i];
        if (account) void writeMigratedSecret(account, legacyResults[i]);
      }
    });
  } catch {
    for (const e of endpoints) {
      out[e.id] = await getCustomEndpointKey(e.id);
    }
  }
  return out;
}
