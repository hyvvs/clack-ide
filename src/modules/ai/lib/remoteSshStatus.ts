import { remoteSsh } from "@/modules/ai/lib/remoteSsh";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { updateSelfHostedProfiles } from "@/modules/settings/store";

let pending: Promise<void> | undefined;
export function refreshRemoteSshStatus(): Promise<void> {
  if (pending) return pending;
  const endpoints = usePreferencesStore.getState().selfHostedInference.endpoints.filter(e => e.ssh && e.deletedAt === undefined);
  if (!endpoints.length) return Promise.resolve();
  pending = (async () => {
    const offline = new Set<string>();
    for (const endpoint of endpoints) {
      try { if ((await remoteSsh.status(endpoint.id)).state !== "connected") offline.add(endpoint.id); }
      catch { offline.add(endpoint.id); }
    }
    if (usePreferencesStore.getState().selfHostedInference.inventories?.some(i => offline.has(i.endpointId) && i.connected)) {
      await updateSelfHostedProfiles(state => ({ ...state, inventories: state.inventories?.map(i => offline.has(i.endpointId) ? { ...i, connected: false, error: "unreachable" } : i) }));
    }
  })().catch(() => {}).finally(() => { pending = undefined; });
  return pending;
}
