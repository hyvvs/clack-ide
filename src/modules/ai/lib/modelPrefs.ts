import { usePreferencesStore } from "@/modules/settings/preferences";
import { canonicalSelfHostedSelectionId } from "@/modules/ai/lib/selfHostedModels";
import {
  setFavoriteModelIds,
  setRecentModelIds,
} from "@/modules/settings/store";

const RECENTS_MAX = 5;

export async function toggleFavoriteModel(id: string): Promise<void> {
  const state = usePreferencesStore.getState();
  const current = [...new Set(state.favoriteModelIds.map(value => canonicalSelfHostedSelectionId(value, state.selfHostedInference)))];
  const target = canonicalSelfHostedSelectionId(id, state.selfHostedInference);
  const next = current.includes(target)
    ? current.filter((x) => x !== target)
    : [...current, target];
  await setFavoriteModelIds(next);
}

export async function pushRecentModel(id: string): Promise<void> {
  const state = usePreferencesStore.getState();
  const current = [...new Set(state.recentModelIds.map(value => canonicalSelfHostedSelectionId(value, state.selfHostedInference)))];
  const target = canonicalSelfHostedSelectionId(id, state.selfHostedInference);
  const next = [target, ...current.filter((x) => x !== target)].slice(0, RECENTS_MAX);
  if (
    next.length === state.recentModelIds.length &&
    next.every((x, i) => x === state.recentModelIds[i])
  ) {
    return;
  }
  await setRecentModelIds(next);
}
