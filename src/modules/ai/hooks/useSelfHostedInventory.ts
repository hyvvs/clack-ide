import { useEffect } from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { refreshSelfHostedInventories } from "@/modules/ai/lib/selfHostedInventory";

export function useSelfHostedInventory(active = true) {
  const hydrated = usePreferencesStore((s) => s.hydrated);
  const connections = usePreferencesStore((s) =>
    JSON.stringify(
      s.selfHostedInference.endpoints
        .filter((e) => e.deletedAt === undefined)
        .map((e) => [e.id, e.configurationRevision]),
    ),
  );
  useEffect(() => {
    if (active && hydrated && connections !== "[]")
      void refreshSelfHostedInventories(
        usePreferencesStore.getState().selfHostedInference,
      );
  }, [active, hydrated, connections]);
}
