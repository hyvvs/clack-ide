import { useEffect, useState } from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { readSelfHostedSnapshot } from "@/modules/ai/lib/selfHostedCapabilities";
import type { ProbeSnapshot } from "@/modules/ai/lib/selfHostedProbe";

export function useSelfHostedSnapshot(selectionId: string) {
  const state = usePreferencesStore((s) => s.selfHostedInference);
  const [value, setValue] = useState<{
    selectionId: string;
    revision: number;
    snapshot: ProbeSnapshot | null;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void readSelfHostedSnapshot(state, selectionId).then((snapshot) => {
      if (!alive) return;
      setValue({ selectionId, revision: state.revision, snapshot });
      if (snapshot)
        timer = setTimeout(
          () => {
            setValue(null);
          },
          Math.max(
            0,
            snapshot.observedAt + snapshot.inventoryTtlMs - Date.now(),
          ),
        );
    });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [selectionId, state]);
  return {
    state,
    snapshot:
      value?.selectionId === selectionId && value.revision === state.revision
        ? value.snapshot
        : null,
  };
}
