import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSelfHostedPersistence,
  nativeSelfHostedStorage,
} from "@/modules/settings/selfHostedPersistence";
import {
  addSelfHostedEndpoint,
  createSelfHostedEndpoint,
  editSelfHostedEndpoint,
  emptySelfHostedState,
  ensureSelfHostedProfile,
  setProfileOverride,
  SELF_HOSTED_SETTINGS_KEY,
  type SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";

const mocks = vi.hoisted(() => ({
  data: new Map<string, unknown>(),
  listeners: new Set<
    (event: { payload: { key: string; value: unknown } }) => void
  >(),
  local: new Set<(key: string, value: unknown) => void>(),
  invokes: [] as string[],
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
      mocks.invokes.push(command);
      if (command === "self_hosted_profiles_snapshot")
        return structuredClone([...mocks.data]);
      if (command === "self_hosted_profiles_compare_and_swap" && args) {
        if (
          JSON.stringify(mocks.data.get(SELF_HOSTED_SETTINGS_KEY) ?? null) !==
          JSON.stringify(args.expected)
        )
          return false;
        mocks.data.set(SELF_HOSTED_SETTINGS_KEY, structuredClone(args.value));
        for (const cb of mocks.local) cb(SELF_HOSTED_SETTINGS_KEY, args.value);
        return true;
      }
      throw new Error(`Unexpected native command: ${command}`);
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
  setOllamaBaseURL,
  updateSelfHostedProfiles,
} from "@/modules/settings/store";

beforeEach(() => {
  mocks.data.clear();
  mocks.listeners.clear();
  mocks.local.clear();
  mocks.invokes.length = 0;
});

describe("persistent self-hosted settings", () => {
  it("persists migration once and reloads the same identities", async () => {
    mocks.data.set("ollamaModelId", "qwen");
    const repository = createSelfHostedPersistence(nativeSelfHostedStorage());
    const first = await repository.load();
    const restarted = await createSelfHostedPersistence(
      nativeSelfHostedStorage(),
    ).load();
    expect(restarted).toEqual(first);
    expect(
      mocks.invokes.filter((cmd) => cmd.endsWith("compare_and_swap")),
    ).toHaveLength(1);
    expect(mocks.data.get("ollamaModelId")).toBe("qwen");
  });

  it("preserves distinct simultaneous edits from independent window repositories", async () => {
    mocks.data.set("ollamaModelId", "qwen");
    const left = createSelfHostedPersistence(nativeSelfHostedStorage());
    const right = createSelfHostedPersistence(nativeSelfHostedStorage());
    const start = await left.load();
    const profileId = start.profiles[0]?.id;
    if (!profileId) throw new Error("missing migrated profile");
    await Promise.all([
      left.update((state) =>
        editSelfHostedEndpoint(
          state,
          "legacy:ollama",
          { alias: "AI Server" },
          10,
        ),
      ),
      right.update((state) =>
        setProfileOverride(state, profileId, "concurrentGenerations", 1, 10),
      ),
    ]);
    const result = await left.load();
    expect(result.endpoints[0]?.alias).toBe("AI Server");
    expect(
      result.profiles[0]?.overrides.concurrentGenerations?.evidence.value,
    ).toBe(1);
    expect(await right.load()).toEqual(result);
  });

  it("survives a snapshot/save conflict without losing new endpoints", async () => {
    const repository = createSelfHostedPersistence(nativeSelfHostedStorage());
    await repository.load();
    const a = createSelfHostedEndpoint(
      { alias: "Same", baseURL: "http://one/v1" },
      "a",
      1,
    );
    const b = createSelfHostedEndpoint(
      { alias: "Same", baseURL: "http://two/v1" },
      "b",
      1,
    );
    await Promise.all([
      repository.update((state) => addSelfHostedEndpoint(state, a)),
      repository.update((state) => addSelfHostedEndpoint(state, b)),
    ]);
    expect((await repository.load()).endpoints.map((e) => e.id).sort()).toEqual(
      ["a", "b"],
    );
  });

  it("bounds contended retries", async () => {
    const compareAndSwap = vi.fn(async () => false);
    const repository = createSelfHostedPersistence({
      entries: async () => [],
      compareAndSwap,
    });
    await expect(repository.load()).rejects.toThrow("another window");
    expect(compareAndSwap).toHaveBeenCalledTimes(8);
  });

  it("does not claim successful persistence after an IO failure", async () => {
    const repository = createSelfHostedPersistence({
      entries: async () => [],
      compareAndSwap: async () => {
        throw new Error("disk full");
      },
    });
    await expect(repository.load()).rejects.toThrow("disk full");
  });

  it("leaves unknown future versions untouched and rejects edits", async () => {
    const original = { version: 20, important: "future metadata" };
    mocks.data.set(SELF_HOSTED_SETTINGS_KEY, original);
    const repository = createSelfHostedPersistence(nativeSelfHostedStorage());
    expect(await repository.load()).toEqual(emptySelfHostedState());
    await expect(repository.update((state) => state)).rejects.toThrow(
      "preserved",
    );
    expect(mocks.data.get(SELF_HOSTED_SETTINGS_KEY)).toEqual(original);
  });

  it("preserves corrupt supported-version records instead of overwriting them", async () => {
    const original = {
      ...emptySelfHostedState(),
      revision: 12,
      endpoints: [{ id: "broken", alias: "Keep my data", baseURL: "invalid" }],
    };
    mocks.data.set(SELF_HOSTED_SETTINGS_KEY, original);
    const repository = createSelfHostedPersistence(nativeSelfHostedStorage());
    expect((await repository.load()).endpoints).toEqual([]);
    await expect(repository.update((state) => state)).rejects.toThrow(
      "preserved",
    );
    expect(mocks.data.get(SELF_HOSTED_SETTINGS_KEY)).toEqual(original);
    expect(mocks.invokes).not.toContain(
      "self_hosted_profiles_compare_and_swap",
    );
  });

  it("rejects invalid mutations instead of silently discarding profile pins", async () => {
    mocks.data.set("ollamaModelId", "qwen");
    const repository = createSelfHostedPersistence(nativeSelfHostedStorage());
    const original = await repository.load();
    await expect(
      repository.update((state) => ({
        ...state,
        profiles: state.profiles.map((profile) => ({
          ...profile,
          endpointId: "missing",
        })),
      })),
    ).rejects.toThrow("preserved");
    expect(await repository.load()).toEqual(original);
  });

  it("synchronizes edits to both existing preference subscribers", async () => {
    mocks.data.set("ollamaModelId", "qwen");
    const left: SelfHostedState[] = [];
    const right: SelfHostedState[] = [];
    const stopLeft = await onPreferencesChange((key, value) => {
      if (key === "selfHostedInference") left.push(value as SelfHostedState);
    });
    const stopRight = await onPreferencesChange((key, value) => {
      if (key === "selfHostedInference") right.push(value as SelfHostedState);
    });
    await updateSelfHostedProfiles((state) =>
      editSelfHostedEndpoint(state, "legacy:ollama", { alias: "Renamed" }, 10),
    );
    expect(left[left.length - 1]?.endpoints[0]?.alias).toBe("Renamed");
    expect(right[right.length - 1]).toEqual(left[left.length - 1]);
    const old = left[0];
    if (!old) throw new Error("missing initial notification");
    for (const cb of mocks.listeners)
      cb({ payload: { key: SELF_HOSTED_SETTINGS_KEY, value: old } });
    expect(left[left.length - 1]?.endpoints[0]?.alias).toBe("Renamed");
    stopLeft();
    stopRight();
    expect(mocks.listeners.size).toBe(0);
  });

  it("does not publish speculative native store writes before durable notification", async () => {
    const updates: unknown[] = [];
    const stop = await onPreferencesChange((key, value) => {
      if (key === "selfHostedInference") updates.push(value);
    });
    const initialCount = updates.length;
    for (const cb of mocks.local)
      cb(SELF_HOSTED_SETTINGS_KEY, {
        ...emptySelfHostedState(),
        revision: 999,
      });
    expect(updates).toHaveLength(initialCount);
    stop();
  });

  it("loads through existing preferences without altering cloud or saved models", async () => {
    const saved = [
      {
        id: "spm-one",
        providerId: "openrouter",
        transportModelId: "qwen/qwen",
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    mocks.data.set("savedProviderModels", saved);
    mocks.data.set("savedProviderModelsVersion", 1);
    mocks.data.set("defaultModelId", "gpt-5.4-mini");
    mocks.data.set("lastUsedModelId", "saved-provider:spm-one");
    mocks.data.set("lastUsedProviderId", "openrouter");
    mocks.data.set("ollamaModelId", "qwen");
    const preferences = await loadPreferences();
    expect(preferences.selfHostedInference.endpoints).toHaveLength(1);
    expect(preferences.defaultModelId).toBe("gpt-5.4-mini");
    expect(preferences.lastUsedModelId).toBe("saved-provider:spm-one");
    expect(preferences.savedProviderModels).toEqual(saved);
    expect(
      mocks.invokes.some((command) => /secret|http|ping/.test(command)),
    ).toBe(false);
  });

  it("synchronizes legacy address changes while preserving profile pins", async () => {
    mocks.data.set("ollamaModelId", "qwen");
    const state = await createSelfHostedPersistence(
      nativeSelfHostedStorage(),
    ).load();
    const profileId = state.profiles[0]?.id;
    if (!profileId) throw new Error("missing migrated profile");
    await updateSelfHostedProfiles((current) =>
      setProfileOverride(current, profileId, "concurrentGenerations", 1),
    );
    await setOllamaBaseURL("http://ai-server:11434/v1");
    const loaded = await loadPreferences();
    expect(loaded.selfHostedInference.endpoints[0]).toMatchObject({
      id: "legacy:ollama",
      baseURL: "http://ai-server:11434/v1",
    });
    expect(
      loaded.selfHostedInference.profiles[0]?.overrides.concurrentGenerations
        ?.evidence.value,
    ).toBe(1);
  });

  it("sanitizes unknown credential fields before the native commit", async () => {
    const endpoint = createSelfHostedEndpoint(
      {
        alias: "Remote",
        baseURL: "https://server/v1",
        credentialRef: { kind: "custom-endpoint", endpointId: "one" },
      },
      "one",
      1,
    );
    await updateSelfHostedProfiles(
      (state) =>
        ({
          ...state,
          endpoints: [
            {
              ...endpoint,
              credentialRef: {
                ...endpoint.credentialRef,
                apiKey: "NEVER_PERSIST",
              },
            },
          ],
        }) as unknown as SelfHostedState,
    );
    expect(
      JSON.stringify(mocks.data.get(SELF_HOSTED_SETTINGS_KEY)),
    ).not.toContain("NEVER_PERSIST");
  });

  it("keeps manual values through a full repository restart", async () => {
    const endpoint = createSelfHostedEndpoint(
      { alias: "PC", baseURL: "http://server/v1" },
      "one",
      1,
    );
    await updateSelfHostedProfiles((state) => {
      const next = ensureSelfHostedProfile(
        addSelfHostedEndpoint(state, endpoint),
        "one",
        "model",
      );
      return setProfileOverride(
        next.state,
        next.profile.id,
        "autoCompaction",
        false,
      );
    });
    const restarted = await createSelfHostedPersistence(
      nativeSelfHostedStorage(),
    ).load();
    expect(
      restarted.profiles[0]?.overrides.autoCompaction?.evidence.value,
    ).toBe(false);
  });
});
