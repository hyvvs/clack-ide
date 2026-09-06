import {
  updateSelfHostedProfiles,
  emitKeysChanged,
} from "@/modules/settings/store";
import { setCustomEndpointKey } from "@/modules/ai/lib/keyring";
import {
  addSelfHostedEndpoint,
  createSelfHostedEndpoint,
  editSelfHostedEndpoint,
  type SelfHostedEndpoint,
  type SelfHostedBackend,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  normalizeProbeError,
  type ProbeSnapshot,
} from "@/modules/ai/lib/selfHostedProbe";

export type ServerForm = {
  alias: string;
  baseURL: string;
  backendHint?: SelfHostedBackend;
  allowPrivateNetwork: boolean;
  removeCredential: boolean;
};

export async function saveServerConfiguration(
  previous: SelfHostedEndpoint | undefined,
  form: ServerForm,
  password: string,
  draftId?: string,
) {
  const candidate = createSelfHostedEndpoint(form, previous?.id ?? draftId);
  const credentialRef = password.trim()
    ? { kind: "custom-endpoint" as const, endpointId: candidate.id }
    : form.removeCredential
      ? null
      : (previous?.credentialRef ?? null);
  // Mark changed credentials stale before attempting the keychain write. A failed
  // write cannot leave evidence for a different credential advertised as current.
  const state = await updateSelfHostedProfiles((state) => {
    if (!previous)
      return addSelfHostedEndpoint(state, { ...candidate, credentialRef });
    const current = state.endpoints.find((e) => e.id === previous.id);
    if (
      current?.configurationRevision !== previous.configurationRevision ||
      current.revision !== previous.revision
    )
      throw new Error(
        "Server settings changed. Reopen this server before saving.",
      );
    const next = editSelfHostedEndpoint(state, previous.id, {
      ...form,
      credentialRef,
    });
    return password.trim()
      ? {
          ...next,
          endpoints: next.endpoints.map((e) =>
            e.id === previous.id
              ? { ...e, configurationRevision: e.configurationRevision + 1 }
              : e,
          ),
        }
      : next;
  });
  if (password.trim()) {
    try {
      await setCustomEndpointKey(candidate.id, password);
    } catch {
      throw new Error(
        "Server saved, but the credential could not be stored. Replace the credential before connecting.",
      );
    }
  }
  await emitKeysChanged();
  const endpoint = state.endpoints.find((e) => e.id === candidate.id);
  if (!endpoint) throw new Error("Server could not be saved.");
  return endpoint;
}

// Display-only retention. The native cache remains the sole routing authority.
export function retainServerInventory(
  previous: ProbeSnapshot | null,
  result: ProbeSnapshot,
): ProbeSnapshot {
  if (
    !result.connected &&
    !result.models.length &&
    previous?.models.length &&
    previous.endpointId === result.endpointId &&
    previous.configurationRevision === result.configurationRevision
  )
    return {
      ...result,
      models: previous.models,
      observedAt: previous.observedAt,
      stale: true,
    };
  return result;
}

export function serverConnectionStatus(
  snapshot: ProbeSnapshot | null,
  busy: boolean,
  credentialConfigured = false,
): string {
  if (busy) return snapshot?.models.length ? "Updating" : "Connecting";
  if (!snapshot) return "Not checked";
  if (
    snapshot.connected &&
    !snapshot.stale &&
    Date.now() - snapshot.observedAt < snapshot.inventoryTtlMs
  )
    return "Connected";
  if (snapshot.connected && snapshot.models.length)
    return "Cached / refresh needed";
  if (snapshot.models.length) return "Cached / refresh failed";
  const error = snapshot.errors[snapshot.errors.length - 1]?.error;
  switch (error?.code) {
    case "authentication-failed":
      return credentialConfigured
        ? "Authentication failed"
        : "Authentication required";
    case "unreachable":
    case "dns-failure":
      return "Server unreachable";
    case "timeout":
      return "Probe timed out";
    case "malformed-metadata":
    case "invalid-server-response":
      return "Invalid response";
    default:
      return error
        ? normalizeProbeError(error).message
        : "Model metadata unavailable";
  }
}
