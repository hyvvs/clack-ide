import { describe, expect, it, vi } from "vitest";
import {
  addSelfHostedEndpoint,
  createSelfHostedEndpoint,
  deleteSelfHostedEndpoint,
  emptySelfHostedState,
  ensureSelfHostedProfile,
  readSelfHostedState,
  editSelfHostedEndpoint,
  type SelfHostedState,
  setProfileOverride,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  savedSelfHostedModelInfos,
  selfHostedTransportIdentity,
  selfHostedSelectionId,
  selfHostedPickerStatus,
  saveSelfHostedModel,
  canonicalSelfHostedSelectionId,
} from "@/modules/ai/lib/selfHostedModels";
import { createInventoryRefresh } from "@/modules/ai/lib/selfHostedInventory";
import { createSelfHostedProbeClient } from "@/modules/ai/lib/selfHostedProbe";
import { budgetIdentity } from "@/modules/ai/lib/contextBudgetProfile";
import { effectiveFallback } from "@/modules/ai/lib/inferenceFallback";

const at = 1_000_000;
function connection(state = emptySelfHostedState(), id = "a") {
  return addSelfHostedEndpoint(
    state,
    createSelfHostedEndpoint(
      {
        alias: `Server ${id}`,
        baseURL: `https://${id}.example`,
        allowPrivateNetwork: false,
      },
      id,
      at,
    ),
  );
}
// Native merge_inventory/merge_evidence own this record shape; no saved-model operation.
function committed(
  state: SelfHostedState,
  ids: string[],
  endpointId = "a",
  digest = "rev1",
) {
  for (const id of ids)
    state = ensureSelfHostedProfile(state, endpointId, id, null, at).state;
  return readSelfHostedState({
    ...state,
    endpoints: state.endpoints.map((e) =>
      e.id === endpointId ? { ...e, detectedBackend: "ollama" } : e,
    ),
    profiles: state.profiles.map((p) =>
      p.endpointId === endpointId && ids.includes(p.transportModelId)
        ? { ...p, modelRevision: digest, backend: "ollama" }
        : p,
    ),
    inventories: [
      ...(state.inventories ?? []).filter((i) => i.endpointId !== endpointId),
      {
        endpointId,
        configurationRevision: 1,
        observedAt: at,
        backend: "ollama",
        connected: true,
        models: ids.map((id) => ({
          id,
          name: null,
          chat: "unknown",
          digest,
          size: 1234,
          modifiedAt: "2026-10-20",
        })),
      },
    ],
  });
}

describe("inventory-backed picker identities and lifecycle", () => {
  it.each([
    1, 10,
  ])("one server automatically contributes %i models without manual saved records", (count) => {
    const state = committed(
      connection(),
      Array.from({ length: count }, (_, i) => `model-${i}`),
    );
    expect(state.endpoints).toHaveLength(1);
    expect(state.profiles.every((p) => !p.saved)).toBe(true);
    expect(savedSelfHostedModelInfos(state)).toHaveLength(count);
    const id = savedSelfHostedModelInfos(state)[0].id;
    expect(JSON.parse(id.slice("self-hosted:".length))).toEqual([
      "a",
      "model-0",
      null,
      "rev1",
      "ollama",
    ]);
    expect(selfHostedTransportIdentity(id, state)).toMatchObject({
      providerId: "ollama",
      transportModelId: "model-0",
      endpointBaseURL: "https://a.example/v1",
      selfHosted: { endpointId: "a" },
    });
  });
  it("two servers with duplicate tags contribute four distinct exact routes", () => {
    const state = committed(
      committed(connection(connection(), "b"), ["same", "other-a"]),
      ["same", "other-b"],
      "b",
    );
    const choices = savedSelfHostedModelInfos(state);
    expect(choices).toHaveLength(4);
    expect(new Set(choices.map((m) => m.id)).size).toBe(4);
    const duplicates = choices.filter((m) => m.label === "same");
    expect(
      duplicates
        .map((m) => selfHostedTransportIdentity(m.id, state)?.endpointBaseURL)
        .sort(),
    ).toEqual(["https://a.example/v1", "https://b.example/v1"]);
  });
  it("refresh publishes a new model without re-adding the connection or saving models", () => {
    const initial = committed(connection(), ["a", "b"]);
    const next = committed(initial, ["a", "b", "c"]);
    expect(savedSelfHostedModelInfos(next).map((m) => m.label)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(next.endpoints).toEqual(initial.endpoints);
    expect(next.profiles.every((p) => !p.saved)).toBe(true);
  });
  it("removal preserves historical binding but blocks inference without substitution", () => {
    const before = committed(connection(), ["a", "b"]);
    const chat = { modelId: selfHostedSelectionId(before.profiles[1]) };
    const after = committed(before, ["a"]);
    expect(savedSelfHostedModelInfos(after).map((m) => m.label)).toEqual(["a"]);
    expect(chat.modelId).toBe(selfHostedSelectionId(before.profiles[1]));
    expect(selfHostedPickerStatus(chat.modelId, after, at)).toEqual({
      label: "Unavailable",
      disabled: true,
    });
    expect(() => selfHostedTransportIdentity(chat.modelId, after)).toThrow(
      /unavailable/i,
    );
    expect(effectiveFallback(undefined)).toBeNull();
  });
  it("offline cached candidates are disabled and return online without identity churn", () => {
    const state = committed(connection(), ["a", "b"]);
    const choices = savedSelfHostedModelInfos(state);
    const offline = {
      ...state,
      inventories: state.inventories?.map((i) => ({
        ...i,
        connected: false,
        error: "unreachable",
      })),
    };
    expect(savedSelfHostedModelInfos(offline).map((m) => m.id)).toEqual(
      choices.map((m) => m.id),
    );
    expect(selfHostedPickerStatus(choices[0].id, offline, at)).toEqual({
      label: "Offline",
      disabled: true,
    });
    expect(() => selfHostedTransportIdentity(choices[0].id, offline)).toThrow(
      /unavailable/i,
    );
    const online = committed(offline, ["a", "b"]);
    expect(selfHostedPickerStatus(choices[0].id, online, at)?.disabled).toBe(
      false,
    );
    expect(
      selfHostedTransportIdentity(choices[0].id, online)?.selfHosted
        ?.endpointId,
    ).toBe("a");
  });
  it("digest changes invalidate revision-bound chats, recents and favorites rather than rebinding them", () => {
    const before = committed(connection(), ["same"]);
    const id = selfHostedSelectionId(before.profiles[0]);
    const recent = [id],
      favorites = [id];
    const after = committed(before, ["same"], "a", "rev2");
    expect(after.inventories?.[0].models[0]).toMatchObject({
      digest: "rev2",
      size: 1234,
      modifiedAt: "2026-10-20",
    });
    expect(budgetIdentity(before, before.profiles[0].id)).not.toBe(
      budgetIdentity(after, after.profiles[0].id),
    );
    expect(selfHostedSelectionId(after.profiles[0])).not.toBe(id);
    for (const historical of [...recent, ...favorites])
      expect(() => selfHostedTransportIdentity(historical, after)).toThrow(
        /unavailable/i,
      );
    expect(recent).toEqual([id]);
    expect(favorites).toEqual([id]);
    expect(canonicalSelfHostedSelectionId(id, after)).toBe(id);
  });
  it("legacy saved labels, pins and old three-part bindings reconcile without duplicate rows", () => {
    let before = saveSelfHostedModel(
      connection(),
      "a",
      "same",
      "My custom label",
    );
    const oldBinding = selfHostedSelectionId(before.profiles[0]);
    before = setProfileOverride(
      before,
      before.profiles[0].id,
      "workingContext",
      32768,
    );
    const state = committed(before, ["same", "new"]);
    expect(savedSelfHostedModelInfos(state).map((m) => m.label)).toEqual([
      "My custom label",
      "new",
    ]);
    expect(
      selfHostedTransportIdentity(oldBinding, state)?.selfHosted?.endpointId,
    ).toBe("a");
    expect(canonicalSelfHostedSelectionId(oldBinding, state)).toBe(
      selfHostedSelectionId(state.profiles[0]),
    );
    expect(state.profiles[0].saved?.label).toBe("My custom label");
    expect(state.profiles[0].overrides).toEqual(before.profiles[0].overrides);
  });
  it("server deletion removes only its candidates and cannot reroute historical references", () => {
    const state = committed(
      committed(connection(connection(), "b"), ["same"]),
      ["same"],
      "b",
    );
    const previous = selfHostedSelectionId(state.profiles[0]);
    const deleted = deleteSelfHostedEndpoint(state, "a");
    expect(savedSelfHostedModelInfos(deleted)).toHaveLength(1);
    expect(() => selfHostedTransportIdentity(previous, deleted)).toThrow(
      /unavailable/i,
    );
    expect(
      selfHostedTransportIdentity(
        savedSelfHostedModelInfos(deleted)[0].id,
        deleted,
      )?.selfHosted?.endpointId,
    ).toBe("b");
  });
  it("stale inventory is unverified; configuration edits discard its authority and detection", () => {
    const state = committed(connection(), ["same"]);
    const id = selfHostedSelectionId(state.profiles[0]);
    expect(selfHostedPickerStatus(id, state, at + 300_000)?.label).toBe(
      "Unverified",
    );
    const edited = editSelfHostedEndpoint(state, "a", {
      baseURL: "https://replacement.example",
    });
    expect(edited.inventories).toEqual([]);
    expect(edited.endpoints[0].detectedBackend).toBeUndefined();
    expect(savedSelfHostedModelInfos(edited)).toEqual([]);
    const changedProvider = editSelfHostedEndpoint(state, "a", { backendHint: "openai-compatible" });
    expect(() => selfHostedTransportIdentity(id, changedProvider)).toThrow(/unavailable/i);
  });
  it("providers without enumeration can still use explicitly saved manual models", () => {
    const state = saveSelfHostedModel(connection(), "a", "manual");
    state.inventories = [
      {
        endpointId: "a",
        configurationRevision: 1,
        observedAt: at,
        connected: false,
        error: "unsupported-probe-route",
        models: [],
      },
    ];
    expect(savedSelfHostedModelInfos(state)).toHaveLength(1);
    expect(
      selfHostedPickerStatus(
        selfHostedSelectionId(state.profiles[0]),
        state,
        at,
      )?.label,
    ).toBe("Unverified");
    expect(
      selfHostedTransportIdentity(
        selfHostedSelectionId(state.profiles[0]),
        state,
      )?.transportModelId,
    ).toBe("manual");
  });
  it("additive restart loading is idempotent and malformed inventory is isolated", () => {
    const state = committed(connection(), ["same"]);
    expect(readSelfHostedState(JSON.parse(JSON.stringify(state)))).toEqual(
      state,
    );
    expect(readSelfHostedState(readSelfHostedState(state))).toEqual(state);
    const invalid = {
      ...state,
      inventories: [
        { ...state.inventories?.[0], models: [{ id: "\u0000bad" }] },
      ],
    };
    expect(readSelfHostedState(invalid).inventories).toEqual([]);
    expect(readSelfHostedState(invalid).profiles).toEqual(state.profiles);
  });
});

describe("bounded automatic refresh coordination", () => {
  it("deduplicates overlapping picker/startup refreshes and sends only metadata IPC", async () => {
    let done: (value: unknown) => void = () => {};
    const call = vi.fn(
      () =>
        new Promise((resolve) => {
          done = resolve;
        }),
    );
    const client = createSelfHostedProbeClient(call as never);
    const refresh = createInventoryRefresh(client, () => at);
    const state = connection();
    const first = refresh(state),
      second = refresh(state);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0]).toEqual([
      "self_hosted_probe",
      {
        options: {
          endpointId: "a",
          allowPrivateNetwork: false,
          force: true,
          restart: false,
        },
      },
    ]);
    done({});
    await first;
    await second;
    await refresh(state);
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("skips fresh inventory, refreshes stale inventory, and respects offline retry backoff", async () => {
    const call = vi.fn().mockResolvedValue({});
    let now = at;
    const refresh = createInventoryRefresh(
      createSelfHostedProbeClient(call),
      () => now,
    );
    const state = committed(connection(), ["same"]);
    await refresh(state);
    expect(call).not.toHaveBeenCalled();
    now += 300_001;
    await refresh(state);
    expect(call).toHaveBeenCalledTimes(1);
    const offline = {
      ...state,
      inventories: state.inventories?.map((i) => ({
        ...i,
        connected: false,
        observedAt: now,
      })),
    };
    await refresh(offline);
    expect(call).toHaveBeenCalledTimes(1);
    now += 30_001;
    await refresh(offline);
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("preserves explicit private-network consent and never sends credentials or inference", async () => {
    const state = connection();
    state.endpoints[0].credentialRef = {
      kind: "custom-endpoint",
      endpointId: "secret-reference",
    };
    const call = vi.fn().mockResolvedValue({});
    const refresh = createInventoryRefresh(
      createSelfHostedProbeClient(call),
      () => at,
    );
    await refresh(state);
    expect(call).toHaveBeenCalledWith(
      "self_hosted_probe",
      expect.objectContaining({
        options: expect.objectContaining({ allowPrivateNetwork: false }),
      }),
    );
    expect(JSON.stringify(call.mock.calls)).not.toContain("secret-reference");
    expect(
      call.mock.calls.every(([command]) => command === "self_hosted_probe"),
    ).toBe(true);
  });
});
