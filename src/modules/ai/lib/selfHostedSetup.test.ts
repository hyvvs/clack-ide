import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptySelfHostedState,
  type SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  saveServerConfiguration,
  serverConnectionStatus,
  retainServerInventory,
} from "@/modules/ai/lib/selfHostedSetup";
import type {
  ProbeSnapshot,
  ProbeErrorCode,
} from "@/modules/ai/lib/selfHostedProbe";
import { setCustomEndpointKey } from "@/modules/ai/lib/keyring";

let state: SelfHostedState;
vi.mock("@/modules/settings/store", () => ({
  updateSelfHostedProfiles: vi.fn(
    async (change: (s: SelfHostedState) => SelfHostedState) => {
      state = change(state);
      return state;
    },
  ),
  emitKeysChanged: vi.fn(),
}));
vi.mock("@/modules/ai/lib/keyring", () => ({ setCustomEndpointKey: vi.fn() }));
beforeEach(() => {
  state = emptySelfHostedState();
  vi.clearAllMocks();
});
const form = {
  alias: "Server",
  baseURL: "https://server.example/v1",
  allowPrivateNetwork: false,
  removeCredential: false,
};

describe("secure setup edits", () => {
  it("stores only credential references and rotates without changing identity", async () => {
    const endpoint = await saveServerConfiguration(
      undefined,
      form,
      "secret-one",
    );
    expect(setCustomEndpointKey).toHaveBeenCalledWith(
      endpoint.id,
      "secret-one",
    );
    const next = await saveServerConfiguration(endpoint, form, "secret-two");
    expect(next.id).toBe(endpoint.id);
    expect(next.configurationRevision).toBeGreaterThan(
      endpoint.configurationRevision,
    );
    expect(JSON.stringify(state)).not.toContain("secret-");
    expect(state.endpoints).toHaveLength(1);
  });
  it("rename does not invalidate metadata or overwrite credential", async () => {
    const endpoint = await saveServerConfiguration(undefined, form, "secret");
    const next = await saveServerConfiguration(
      endpoint,
      { ...form, alias: "Renamed" },
      "",
    );
    expect(next.credentialRef).toEqual(endpoint.credentialRef);
    expect(next.configurationRevision).toBe(endpoint.configurationRevision);
    expect(setCustomEndpointKey).toHaveBeenCalledTimes(1);
  });
  it("changing URL invalidates only this server", async () => {
    const endpoint = await saveServerConfiguration(undefined, form, "");
    const other = await saveServerConfiguration(
      undefined,
      { ...form, alias: "Other" },
      "",
    );
    const next = await saveServerConfiguration(
      endpoint,
      { ...form, baseURL: "https://new.example/prefix/v1" },
      "",
    );
    expect(next.configurationRevision).toBe(2);
    expect(state.endpoints[1]).toEqual(other);
  });
  it("preserves a safely unusable reference if keychain save fails", async () => {
    vi.mocked(setCustomEndpointKey).mockRejectedValueOnce(
      new Error("raw secret error"),
    );
    await expect(
      saveServerConfiguration(undefined, form, "secret", "draft-id"),
    ).rejects.toThrow("credential could not be stored");
    expect(state.endpoints[0].credentialRef).toEqual({
      kind: "custom-endpoint",
      endpointId: "draft-id",
    });
    expect(JSON.stringify(state)).not.toContain("secret");
  });
  it("rejects stale edits from another window", async () => {
    const endpoint = await saveServerConfiguration(undefined, form, "");
    await saveServerConfiguration(
      endpoint,
      { ...form, alias: "Other edit" },
      "",
    );
    await expect(
      saveServerConfiguration(endpoint, form, "new secret"),
    ).rejects.toThrow("Server settings changed");
    expect(setCustomEndpointKey).not.toHaveBeenCalled();
  });
});

describe("connection labels", () => {
  const snapshot = (code?: ProbeErrorCode): ProbeSnapshot => ({
    endpointId: "e",
    configurationRevision: 1,
    selectedModelId: null,
    observedAt: Date.now(),
    connected: !code,
    reachable: true,
    credentialUsed: !code,
    stale: !!code,
    refreshing: false,
    models: [],
    errors: code
      ? [{ route: null, error: { code, statusCode: null, reachable: true } }]
      : [],
    inventoryTtlMs: 300000,
    instanceTtlMs: 30000,
  });
  it("shows connected only for validated success", () => {
    expect(serverConnectionStatus(snapshot(), false, true)).toBe("Connected");
    expect(serverConnectionStatus(null, false)).toBe("Not checked");
    expect(serverConnectionStatus(null, true)).toBe("Connecting");
  });
  it("keeps display inventory stale after a failed model-detail refresh", () => {
    const previous = snapshot();
    previous.models = [{ id: "a", name: null, chat: "unknown", evidence: [] }];
    const failed = { ...snapshot("unreachable"), selectedModelId: "a" };
    const retained = retainServerInventory(previous, failed);
    expect(retained.models).toEqual(previous.models);
    expect(retained.observedAt).toBe(previous.observedAt);
    expect(retained.stale).toBe(true);
    expect(retained.connected).toBe(false);
    expect(retained.errors).toEqual(failed.errors);
    expect(failed.models).toEqual([]);
    expect(
      retainServerInventory(previous, { ...failed, configurationRevision: 2 })
        .models,
    ).toEqual([]);
    expect(
      retainServerInventory(previous, { ...failed, endpointId: "other" })
        .models,
    ).toEqual([]);
    expect(retainServerInventory(previous, snapshot()).models).toEqual([]);
  });
  it.each([
    ["authentication-failed", "Authentication failed"],
    ["unreachable", "Server unreachable"],
    ["timeout", "Probe timed out"],
    ["malformed-metadata", "Invalid response"],
  ] as const)("surfaces %s", (code, label) =>
    expect(serverConnectionStatus(snapshot(code), false, true)).toBe(label));
  it("distinguishes missing auth and cached refresh states", () => {
    const s = snapshot("authentication-failed");
    expect(serverConnectionStatus(s, false, false)).toBe(
      "Authentication required",
    );
    s.models = [{ id: "a", name: null, chat: "unknown", evidence: [] }];
    expect(serverConnectionStatus(s, true)).toBe("Updating");
    expect(serverConnectionStatus(s, false)).toBe("Cached / refresh failed");
  });
});
