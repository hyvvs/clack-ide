import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  setFavoriteModelIds,
  setRecentModelIds,
} from "@/modules/settings/store";
import {
  pushRecentModel,
  toggleFavoriteModel,
} from "@/modules/ai/lib/modelPrefs";
import {
  addSelfHostedEndpoint,
  createSelfHostedEndpoint,
  emptySelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  saveSelfHostedModel,
  selfHostedSelectionId,
} from "@/modules/ai/lib/selfHostedModels";

vi.mock("@/modules/settings/store", async (original) => ({
  ...(await original<typeof import("@/modules/settings/store")>()),
  setFavoriteModelIds: vi.fn().mockResolvedValue(undefined),
  setRecentModelIds: vi.fn().mockResolvedValue(undefined),
}));
const original = usePreferencesStore.getState();
let state = emptySelfHostedState();
let a: string, b: string, legacy: string;
beforeEach(() => {
  vi.clearAllMocks();
  state = emptySelfHostedState();
  for (const id of ["a", "b"]) {
    state = addSelfHostedEndpoint(
      state,
      createSelfHostedEndpoint(
        { alias: id, baseURL: `https://${id}.example`, backendHint: "ollama" },
        id,
      ),
    );
    state = saveSelfHostedModel(state, id, "same");
  }
  legacy = selfHostedSelectionId(state.profiles[0]);
  state.profiles.forEach((p) => {
    p.modelRevision = "rev1";
  });
  a = selfHostedSelectionId(state.profiles[0]);
  b = selfHostedSelectionId(state.profiles[1]);
  usePreferencesStore.setState({
    selfHostedInference: state,
    favoriteModelIds: [legacy, b],
    recentModelIds: [legacy, b],
  });
});
afterEach(() => usePreferencesStore.setState(original));
it("legacy favorite aliases toggle the canonical row without affecting a duplicate tag on another server", async () => {
  await toggleFavoriteModel(a);
  expect(setFavoriteModelIds).toHaveBeenCalledWith([b]);
});
it("using a legacy selection reconciles recents without duplicate same-server rows or losing other destinations", async () => {
  await pushRecentModel(legacy);
  expect(setRecentModelIds).toHaveBeenCalledWith([a, b]);
});
it("known old revisions remain historical rather than following a new digest", async () => {
  state.profiles[0].modelRevision = "rev2";
  usePreferencesStore.setState({
    selfHostedInference: state,
    favoriteModelIds: [a],
    recentModelIds: [a, b],
  });
  const updated = selfHostedSelectionId(state.profiles[0]);
  await toggleFavoriteModel(updated);
  expect(setFavoriteModelIds).toHaveBeenCalledWith([a, updated]);
  await pushRecentModel(updated);
  expect(setRecentModelIds).toHaveBeenCalledWith([updated, a, b]);
});
it("cloud favorites and recents retain their normal identities", async () => {
  usePreferencesStore.setState({
    favoriteModelIds: ["gpt-5.4-mini"],
    recentModelIds: ["gpt-5.4-mini"],
  });
  await toggleFavoriteModel("gpt-5.4-mini");
  expect(setFavoriteModelIds).toHaveBeenCalledWith([]);
  await pushRecentModel("claude-sonnet-4-6");
  expect(setRecentModelIds).toHaveBeenCalledWith([
    "claude-sonnet-4-6",
    "gpt-5.4-mini",
  ]);
});
