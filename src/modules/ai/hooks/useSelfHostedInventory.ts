import { useEffect } from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { refreshSelfHostedInventories } from "@/modules/ai/lib/selfHostedInventory";
import { refreshRemoteSshStatus } from "@/modules/ai/lib/remoteSshStatus";

export function useSelfHostedInventory(active = true) {
  const hydrated = usePreferencesStore((s) => s.hydrated);
  const connections = usePreferencesStore((s) =>
    JSON.stringify(
      s.selfHostedInference.endpoints
        .filter((e) => e.deletedAt === undefined)
        .map((e) => [e.id, e.configurationRevision]),
    ),
  );
  const remote = usePreferencesStore(s => s.selfHostedInference.endpoints.some(e => e.ssh && e.deletedAt === undefined));
  useEffect(() => {
    if (!active || !hydrated || !remote) return;
    void refreshRemoteSshStatus();
    const timer = setInterval(() => void refreshRemoteSshStatus(), 2000);
    return () => clearInterval(timer);
  }, [active, hydrated, remote]);
  useEffect(() => {
    if (active && hydrated && connections !== "[]")
      void refreshSelfHostedInventories(
        usePreferencesStore.getState().selfHostedInference,
      );
  }, [active, hydrated, connections]);
}
