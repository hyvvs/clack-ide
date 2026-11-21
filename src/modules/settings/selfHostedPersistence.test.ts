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
import { ensureDefaultOllamaHost } from "@/modules/ai/lib/selfHostedMigration";
import {
  reconcileLocalComputeFabric,
  resolveModelDeployment,
  withLocalComputeFabric,
} from "@/modules/ai/lib/localComputeFabric";
import { saveSelfHostedModel, selfHostedSelectionId, selfHostedTransportIdentity } from "@/modules/ai/lib/selfHostedModels";

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
  it("migrates the live-accepted Secondary PC snapshot without changing the saved selection or duplicating This PC", async () => {
    const id = "sh-906dc712-b5bb-445a-9a88-ca71865f4d9e";
    const digest = "24277f07f62db8f9cb68e9dfc679ea1818a7fbac47a50eff0a701d3f645b63c8";
    const local = ensureDefaultOllamaHost(emptySelfHostedState(), new Map(), 1);
    const remote = {
      ...createSelfHostedEndpoint({
        alias: "Secondary PC", baseURL: "http://192.168.1.44:11434/",
        backendHint: "ollama", allowPrivateNetwork: true,
      }, id, 2),
      configurationRevision: 2,
    };
    let raw = addSelfHostedEndpoint(local, remote);
    const modelNames = ["devstral-small-2:24b", ...Array.from({ length: 14 }, (_, i) => `model-${i}:latest`)];
    for (const model of modelNames) raw = ensureSelfHostedProfile(raw, id, model).state;
    raw = {
      ...raw, revision: 948,
      profiles: raw.profiles.map(p => p.transportModelId !== modelNames[0] ? p : {
        ...p, modelRevision: digest, backend: "ollama" as const,
      }),
      inventories: [{
        endpointId: id, configurationRevision: 2,
        observedAt: 100, connected: true, backend: "ollama", version: "0.40.11",
        models: modelNames.map((model, index) => ({
          id: model, name: model, chat: "supported" as const,
          ...(index === 0 ? { digest } : {}),
        })),
      }],
    };
    const selected = selfHostedSelectionId(raw.profiles[0]);
    const route = selfHostedTransportIdentity(selected, raw);
    mocks.data.set(SELF_HOSTED_SETTINGS_KEY, structuredClone(raw));
    mocks.data.set("lastUsedModelId", selected);
    const repository = createSelfHostedPersistence(nativeSelfHostedStorage());
    const first = await repository.load();
    expect(first.fabric?.version).toBe(1);
    expect(first.fabric?.hosts).toHaveLength(2);
    expect(first.fabric?.runtimes).toHaveLength(2);
    expect(first.fabric?.deployments).toHaveLength(0);
    expect(reconcileLocalComputeFabric(first).deployments).toHaveLength(15);
    expect(first.endpoints.filter(e => e.alias === "Secondary PC")).toHaveLength(1);
    expect(first.endpoints.filter(e => e.alias === "This PC")).toHaveLength(1);
    expect(first.profiles).toEqual(raw.profiles);
    expect(first.inventories).toEqual(raw.inventories);
    expect(mocks.data.get("lastUsedModelId")).toBe(selected);
    const deployed = resolveModelDeployment(first, first.profiles[0])!;
    expect(deployed.runtime.type).toBe("ollama");
    expect(deployed.artifact.digest).toBe(digest);
    expect(selfHostedTransportIdentity(selected, first)).toMatchObject({
      providerId: "ollama", endpointBaseURL: "http://192.168.1.44:11434/v1",
      selfHosted: { endpointId: id, profileId: raw.profiles[0].id },
    });
    expect(route?.selfHosted?.endpointId).toBe(id);
    const second = await repository.load();
    expect(second).toEqual(first);
    expect(mocks.invokes.filter(c => c.endsWith("compare_and_swap"))).toHaveLength(1);
    const disabled = await repository.update(state => editSelfHostedEndpoint(state, id, { enabled: false }, 500));
    expect(disabled.fabric?.runtimes.find(r => r.legacyEndpointId === id)?.enabled).toBe(false);
    const restored = await repository.update(state => editSelfHostedEndpoint(state, id, { enabled: true }, 501));
    expect(restored.endpoints.find(e => e.id === id)?.configurationRevision).toBe(3);
    expect(restored.fabric?.hosts.find(h => h.id === id)?.enabled).toBe(true);
    expect(reconcileLocalComputeFabric(restored).deployments).toHaveLength(15);
    expect(resolveModelDeployment(restored, restored.profiles[0])?.identity)
      .not.toBe(deployed.identity);
    expect(restored.profiles).toEqual(raw.profiles);
    expect(mocks.data.get("lastUsedModelId")).toBe(selected);
  });

  it("preserves future-schema source bytes and an unavailable conceptual runtime without triggering a rewrite", async () => {
    const host = createSelfHostedEndpoint({
      alias: "This PC", baseURL: "http://127.0.0.1:11434/",
      backendHint: "ollama",
    }, "local", 1);
    const base = withLocalComputeFabric(addSelfHostedEndpoint(emptySelfHostedState(), host));
    const fabric = reconcileLocalComputeFabric(base);
    const conceptual = {
      ...base, fabric: {
        ...fabric,
        runtimes: [...fabric.runtimes, {
          id: "future", hostId: "local", type: "clack-llama-cpp",
          displayName: "Managed Runtime", configurationRevision: 1,
          enabled: false, health: "unknown" as const,
          capabilities: { "future-capability": { status: "coming-soon", source: "unknown" } },
        }],
      },
    };
    mocks.data.set(SELF_HOSTED_SETTINGS_KEY, conceptual);
    const repo = createSelfHostedPersistence(nativeSelfHostedStorage());
    const loaded = await repo.load();
    expect(loaded.fabric?.runtimes.find(r => r.id === "future")).toMatchObject({
      enabled: false, type: "clack-llama-cpp",
    });
    expect(loaded.fabric?.runtimes.find(r => r.id === "future")?.capabilities["future-capability"].status)
      .toBe("coming-soon");
    const future = { ...loaded, fabric: { ...loaded.fabric!, version: 2 } };
    mocks.data.set(SELF_HOSTED_SETTINGS_KEY, structuredClone(future));
    mocks.invokes.length = 0;
    await repo.load(); // Read-only fallback, not a silent future-schema rewrite.
    expect(mocks.invokes.filter(c => c.endsWith("compare_and_swap"))).toHaveLength(0);
    expect(mocks.data.get(SELF_HOSTED_SETTINGS_KEY)).toEqual(future);
    await expect(repo.update(s => s)).rejects.toThrow(/unsupported schema/);
    expect(mocks.data.get(SELF_HOSTED_SETTINGS_KEY)).toEqual(future);
  });

  it("retains unknown inert fields in the supported envelope and fabric during an additive host edit", async () => {
    const endpoint = createSelfHostedEndpoint({
      alias: "This PC", baseURL: "http://127.0.0.1:11434/", backendHint: "ollama",
    }, "future-safe-host", 1);
    const saved = withLocalComputeFabric(saveSelfHostedModel(
      addSelfHostedEndpoint(emptySelfHostedState(), endpoint), endpoint.id, "local:latest",
    ));
    const selection = selfHostedSelectionId(saved.profiles[0]);
    const raw = {
      ...saved,
      nextSchemaMetadata: { release: 4, opaque: ["do-not-flatten"] },
      endpoints: saved.endpoints.map(e => ({ ...e, futureLocationEvidence: { method: "upcoming" } })),
      profiles: saved.profiles.map(p => ({ ...p, futureQualificationRecord: { eligible: true } })),
      fabric: {
        ...saved.fabric!,
        futureFabricIndex: { version: 3 },
        hosts: saved.fabric!.hosts.map(h => ({ ...h, futureHostAttestation: "opaque" })),
        runtimes: saved.fabric!.runtimes.map(r => ({ ...r, futureRuntimeField: { state: "unknown" } })),
      },
    };
    mocks.data.set(SELF_HOSTED_SETTINGS_KEY, structuredClone(raw));
    const repo = createSelfHostedPersistence(nativeSelfHostedStorage());
    const loaded = await repo.load();
    expect((loaded as typeof raw).nextSchemaMetadata).toEqual(raw.nextSchemaMetadata);
    const changed = await repo.update(state => editSelfHostedEndpoint(state, endpoint.id,
      { alias: "Renamed local runtime" }, 20));
    expect(changed.endpoints[0].alias).toBe("Renamed local runtime");
    const stored = mocks.data.get(SELF_HOSTED_SETTINGS_KEY) as typeof raw;
    expect(stored.nextSchemaMetadata).toEqual(raw.nextSchemaMetadata);
    expect(stored.endpoints[0].futureLocationEvidence).toEqual(raw.endpoints[0].futureLocationEvidence);
    expect(stored.profiles[0].futureQualificationRecord).toEqual(raw.profiles[0].futureQualificationRecord);
    expect(stored.fabric.futureFabricIndex).toEqual(raw.fabric.futureFabricIndex);
    expect(stored.fabric.hosts[0].futureHostAttestation).toBe("opaque");
    expect(stored.fabric.runtimes[0].futureRuntimeField).toEqual({ state: "unknown" });
    expect(stored.profiles[0].id).toBe(saved.profiles[0].id);
    expect(selfHostedSelectionId(stored.profiles[0])).toBe(selection);
  });

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
      ["a", "b", "legacy:ollama"],
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

  it("allows a remote host to be added after native offline Ollama inventory stored unknown metadata as null", async () => {
    const repository = createSelfHostedPersistence(nativeSelfHostedStorage());
    const initial = await repository.load();
    const local = initial.endpoints.find(endpoint => endpoint.id === "legacy:ollama");
    if (!local) throw new Error("default host missing");
    const withProfile = await repository.update(state =>
      ensureSelfHostedProfile(state, local.id, "qwen").state,
    );
    const nativeOfflineState = {
      ...withProfile,
      inventories: [{
        endpointId: local.id,
        configurationRevision: local.configurationRevision,
        observedAt: 1_000,
        connected: false,
        backend: "ollama",
        error: "unreachable",
        models: [],
        lastSuccessAt: null,
        version: null,
      }],
    };
    mocks.data.set(SELF_HOSTED_SETTINGS_KEY, nativeOfflineState);

    const remote = createSelfHostedEndpoint({
      alias: "Secondary PC",
      baseURL: "http://192.168.1.44:11434/",
      backendHint: "ollama",
      allowPrivateNetwork: true,
    }, "secondary-pc", 2_000);
    const saved = await repository.update(state => addSelfHostedEndpoint(state, remote));
    expect(saved.endpoints.find(endpoint => endpoint.id === remote.id)).toEqual(remote);
    expect(saved.profiles).toEqual(withProfile.profiles);
    expect(saved.inventories?.[0]).toMatchObject({
      endpointId: local.id,
      connected: false,
      models: [],
    });
    expect(saved.inventories?.[0]?.lastSuccessAt).toBeUndefined();
    expect(saved.inventories?.[0]?.version).toBeUndefined();
    expect((await repository.load()).profiles).toEqual(withProfile.profiles);
  });

  it("does not rewrite an otherwise current native inventory merely to remove unknown optional null observations", async () => {
    const repository = createSelfHostedPersistence(nativeSelfHostedStorage());
    const initial = await repository.load();
    const local = initial.endpoints.find(endpoint => endpoint.id === "legacy:ollama");
    if (!local) throw new Error("default host missing");
    const current = withLocalComputeFabric({
      ...initial,
      inventories: [{
        endpointId: local.id,
        configurationRevision: local.configurationRevision,
        observedAt: 1_000,
        connected: false,
        backend: "ollama" as const,
        error: "unreachable",
        models: [],
      }],
    });
    const persisted = {
      ...current,
      revision: 1495,
      inventories: current.inventories!.map(inventory => ({
        ...inventory, lastSuccessAt: null, version: null,
      })),
    };
    mocks.data.set(SELF_HOSTED_SETTINGS_KEY, structuredClone(persisted));
    mocks.invokes.length = 0;
    const first = await repository.load();
    const second = await repository.load();

    expect(first.revision).toBe(1495);
    expect(second).toEqual(first);
    expect(first.inventories?.[0]?.lastSuccessAt).toBeUndefined();
    expect(first.inventories?.[0]?.version).toBeUndefined();
    expect(mocks.invokes.filter(command =>
      command === "self_hosted_profiles_compare_and_swap")).toHaveLength(0);
    // The native writer's original null observations remain on disk verbatim.
    expect(mocks.data.get(SELF_HOSTED_SETTINGS_KEY)).toEqual(persisted);
  });

  it("preserves ordinary preferences, unknown extensions, FAILED receipts, LM6 history, and conceptual registration on an idle load", async () => {
    const repository = createSelfHostedPersistence(nativeSelfHostedStorage());
    const installed = await repository.load();
    const local = installed.endpoints.find(endpoint => endpoint.id === "legacy:ollama");
    if (!local || !installed.fabric) throw new Error("default registered fabric missing");
    const receipt = { version: 2, capability: "instruction-adherence", status: "failed", immutableEvidence: "historical" };
    const lm6 = { version: 1, status: "complete", immutableEvidence: "historical-measurement" };
    const current = withLocalComputeFabric({
      ...installed,
      inventories: [{
        endpointId: local.id,
        configurationRevision: local.configurationRevision,
        observedAt: 2_000,
        connected: false,
        backend: "ollama" as const,
        models: [],
      }],
      fabric: {
        ...installed.fabric,
        futureFabricMetadata: { opaque: ["retain"] },
        qualificationReceipts: [receipt],
        measurementRuns: [lm6],
      },
    });
    const persisted = {
      ...current,
      revision: 800,
      futureEnvelopeMetadata: { opaque: "keep", nested: { version: 42 } },
      endpoints: current.endpoints.map(endpoint => ({
        ...endpoint, futureEndpointMetadata: { retained: true },
      })),
      inventories: current.inventories!.map(inventory => ({
        ...inventory, lastSuccessAt: null, version: null,
      })),
    };
    const agentPermissions = {
      "builtin:coder": { mode: "full-access", categories: {} },
      "builtin:architect": { mode: "chat-only", categories: {} },
    };
    mocks.data.set(SELF_HOSTED_SETTINGS_KEY, structuredClone(persisted));
    mocks.data.set("agentPermissionProfiles", structuredClone(agentPermissions));
    mocks.data.set("futureTopLevelSettings", { opaque: "also retained" });
    mocks.invokes.length = 0;
    const first = await repository.load();
    const second = await repository.load();

    expect(first.revision).toBe(800);
    expect(second).toEqual(first);
    expect(first.fabric?.qualificationReceipts).toEqual([receipt]);
    expect(first.fabric?.measurementRuns).toEqual([lm6]);
    expect(first.fabric?.deployments).toEqual(installed.fabric.deployments);
    expect(first.fabric?.artifacts).toEqual(installed.fabric.artifacts);
    expect((first as unknown as typeof persisted).futureEnvelopeMetadata).toEqual(persisted.futureEnvelopeMetadata);
    expect((first as unknown as typeof persisted).fabric?.futureFabricMetadata).toEqual(persisted.fabric?.futureFabricMetadata);
    expect(mocks.invokes.filter(command =>
      command === "self_hosted_profiles_compare_and_swap")).toHaveLength(0);
    expect(mocks.data.get(SELF_HOSTED_SETTINGS_KEY)).toEqual(persisted);
    expect(mocks.data.get("agentPermissionProfiles")).toEqual(agentPermissions);
    expect(mocks.data.get("futureTopLevelSettings")).toEqual({ opaque: "also retained" });
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
