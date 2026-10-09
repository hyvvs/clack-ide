import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { emit } from "@tauri-apps/api/event";
import { createProviderContextResolver } from "@/modules/ai/lib/providerContext";
import { parseProviderContextCatalog } from "@/modules/ai/lib/providerModelEvidence";
import {
  openrouterCatalogFixture,
  minimaxFreeCatalogRecord,
} from "@/modules/ai/lib/openrouterCatalog.fixture";
import {
  createSavedProviderModel,
  getEnabledSavedProviderModelInfos,
  resolveModelTransportIdentity,
} from "@/modules/ai/lib/savedProviderModels";

const mocks = vi.hoisted(() => ({
  data: new Map<string, unknown>(),
  listeners: new Set<
    (event: { payload: { key: string; value: unknown } }) => void
  >(),
  local: new Set<(key: string, value: unknown) => void>(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async (_event, payload) => {
    for (const cb of mocks.listeners) cb({ payload });
  }),
  listen: vi.fn(async (_event, cb) => {
    mocks.listeners.add(cb);
    return () => mocks.listeners.delete(cb);
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(
    async (command: string, args?: { expected: unknown; value: unknown }) => {
      if (command === "self_hosted_profiles_snapshot")
        return structuredClone([...mocks.data]);
      if (command === "self_hosted_profiles_compare_and_swap" && args) {
        if (
          JSON.stringify(mocks.data.get("selfHostedInference") ?? null) !==
          JSON.stringify(args.expected)
        )
          return false;
        mocks.data.set("selfHostedInference", structuredClone(args.value));
        return true;
      }
      throw new Error(`Unexpected command: ${command}`);
    },
  ),
}));
vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    async entries() {
      return structuredClone([...mocks.data]);
    }
    async get(key: string) {
      return structuredClone(mocks.data.get(key));
    }
    async set(key: string, value: unknown) {
      mocks.data.set(key, structuredClone(value));
      for (const cb of mocks.local) cb(key, value);
    }
    async save() {}
    async onChange(cb: (key: string, value: unknown) => void) {
      mocks.local.add(cb);
      return () => mocks.local.delete(cb);
    }
  },
}));
import {
  loadPreferences,
  onPreferencesChange,
  setSavedProviderModels,
} from "@/modules/settings/store";

const id = minimaxFreeCatalogRecord.id;
const model = () =>
  createSavedProviderModel(
    {
      providerId: "openrouter",
      transportModelId: id,
      providerEvidence: parseProviderContextCatalog(
        openrouterCatalogFixture,
      ).get(id),
    },
    "minimax",
  );
beforeEach(() => {
  mocks.data.clear();
  mocks.listeners.clear();
  mocks.local.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("persists bounded evidence once per saved model and restores identical picker/routes after restart", async () => {
  const saved = model();
  await setSavedProviderModels([saved]);
  const first = await loadPreferences();
  const restarted = await loadPreferences();
  expect(first.savedProviderModels).toEqual([saved]);
  expect(restarted.savedProviderModels).toEqual(first.savedProviderModels);
  const picker = getEnabledSavedProviderModelInfos(
    restarted.savedProviderModels,
  )[0];
  const route = resolveModelTransportIdentity(picker.id, restarted);
  expect(route.providerEvidence).toEqual(picker.providerEvidence);
  const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
  vi.stubGlobal("fetch", fetcher);
  const a = await createProviderContextResolver()(
    id,
    "openrouter",
    true,
    route.providerEvidence,
  );
  const b = await createProviderContextResolver()(
    id,
    "openrouter",
    true,
    route.providerEvidence,
  );
  expect(a).toEqual(b);
  expect(a.reported).toBe(1048576);
  expect(fetcher).not.toHaveBeenCalled();
  expect(mocks.data.get("savedProviderModels")).toEqual([saved]);
});

it("delivers the same validated evidence to two existing preferences subscribers", async () => {
  const a = vi.fn();
  const b = vi.fn();
  const stopA = await onPreferencesChange(a);
  const stopB = await onPreferencesChange(b);
  const saved = model();
  await setSavedProviderModels([saved]);
  expect(a).toHaveBeenCalledWith("savedProviderModels", [saved]);
  expect(b).toHaveBeenCalledWith("savedProviderModels", [saved]);
  expect(emit).toHaveBeenCalledWith("terax://prefs-changed", {
    key: "savedProviderModels",
    value: [saved],
  });
  stopA();
  stopB();
});

it("fails closed on mismatched cross-window evidence without losing the saved selection", async () => {
  const receive = vi.fn();
  const stop = await onPreferencesChange(receive);
  const saved = model();
  await emit("terax://prefs-changed", {
    key: "savedProviderModels",
    value: [
      {
        ...saved,
        providerEvidence: {
          ...saved.providerEvidence,
          modelId: "minimax/minimax-m3",
        },
      },
    ],
  });
  const calls = receive.mock.calls.filter(([key]) => key === "savedProviderModels");
  const delivered = calls[calls.length - 1]?.[1];
  expect(delivered).toHaveLength(1);
  expect(delivered[0].transportModelId).toBe(id);
  expect(delivered[0].providerEvidence).toBeUndefined();
  stop();
});

it("preserves additive legacy saved-model migration without inventing capability evidence", async () => {
  mocks.data.set("openrouterModelId", id);
  const first = await loadPreferences();
  const second = await loadPreferences();
  expect(first.savedProviderModels).toEqual(second.savedProviderModels);
  expect(first.savedProviderModels[0].transportModelId).toBe(id);
  expect(first.savedProviderModels[0].providerEvidence).toBeUndefined();
});
