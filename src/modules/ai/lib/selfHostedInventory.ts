import {
  createSelfHostedProbeClient,
  PROBE_INVENTORY_TTL_MS,
} from "@/modules/ai/lib/selfHostedProbe";
import { endpointAllowsPrivate } from "@/modules/ai/lib/selfHostedModels";
import type { SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";

export function createInventoryRefresh(
  client = createSelfHostedProbeClient(),
  clock = Date.now,
) {
  const active = new Map<string, Promise<unknown>>();
  const attempted = new Map<string, number>();
  return async (state: SelfHostedState): Promise<void> => {
    const endpoints = state.endpoints.filter((e) => e.deletedAt === undefined && !e.ssh);
    let index = 0;
    const worker = async () => {
      while (index < endpoints.length) {
        const endpoint = endpoints[index++];
        const key = JSON.stringify([
          endpoint.id,
          endpoint.configurationRevision,
        ]);
        const inventory = state.inventories?.find(
          (i) =>
            i.endpointId === endpoint.id &&
            i.configurationRevision === endpoint.configurationRevision,
        );
        const age = inventory ? clock() - inventory.observedAt : Infinity;
        if (
          inventory &&
          age >= 0 &&
          age < (inventory.connected ? PROBE_INVENTORY_TTL_MS : 30_000)
        )
          continue;
        const existing = active.get(key);
        if (existing) {
          await existing;
          continue;
        }
        if (clock() - (attempted.get(key) ?? -Infinity) < 30_000) continue;
        attempted.set(key, clock());
        if (attempted.size > 256)
          attempted.delete(attempted.keys().next().value as string);
        const work = client
          .refresh({
            endpointId: endpoint.id,
            allowPrivateNetwork: endpointAllowsPrivate(endpoint),
          })
          .catch(() => undefined)
          .finally(() => active.delete(key));
        active.set(key, work);
        await work;
      }
    };
    await Promise.all([worker(), worker()]);
  };
}

export const refreshSelfHostedInventories = createInventoryRefresh();
