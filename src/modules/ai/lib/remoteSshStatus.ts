import { remoteSsh } from "@/modules/ai/lib/remoteSsh";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { updateSelfHostedProfiles } from "@/modules/settings/store";
import { createSelfHostedProbeClient } from "@/modules/ai/lib/selfHostedProbe";
import { endpointAllowsPrivate } from "@/modules/ai/lib/selfHostedModels";

let pending: Promise<void> | undefined;
const healthAttempts=new Map<string,number>();
export function refreshRemoteSshStatus(): Promise<void> {
  if (pending) return pending;
  const endpoints = usePreferencesStore.getState().selfHostedInference.endpoints.filter(e => e.ssh && e.deletedAt === undefined);
  if (!endpoints.length) return Promise.resolve();
  pending = (async () => {
    const offline = new Set<string>();
    for (const endpoint of endpoints) {
      try {
        if ((await remoteSsh.status(endpoint.id)).state !== "connected") offline.add(endpoint.id);
        else {
          const inventory=usePreferencesStore.getState().selfHostedInference.inventories?.find(i=>i.endpointId===endpoint.id && i.configurationRevision===endpoint.configurationRevision);
          const key=JSON.stringify([endpoint.id,endpoint.configurationRevision]);
          if(!inventory?.connected && Date.now()-(healthAttempts.get(key) ?? -Infinity)>=30_000){
            healthAttempts.set(key,Date.now());if(healthAttempts.size>256)healthAttempts.delete(healthAttempts.keys().next().value as string);
            await createSelfHostedProbeClient().refresh({endpointId:endpoint.id,allowPrivateNetwork:endpointAllowsPrivate(endpoint)});
          }
        }
      }
      catch { offline.add(endpoint.id); }
    }
    if (usePreferencesStore.getState().selfHostedInference.inventories?.some(i => offline.has(i.endpointId) && i.connected)) {
      await updateSelfHostedProfiles(state => ({ ...state, inventories: state.inventories?.map(i => offline.has(i.endpointId) ? { ...i, connected: false, error: "unreachable" } : i) }));
    }
  })().catch(() => {}).finally(() => { pending = undefined; });
  return pending;
}
