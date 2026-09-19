import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  budgetIdentity,
  profileBudgetLimits,
} from "@/modules/ai/lib/contextBudgetProfile";
import {
  addSelfHostedEndpoint,
  createSelfHostedEndpoint,
  editSelfHostedEndpoint,
  emptySelfHostedState,
  profileEvidence,
  setProfileOverride,
} from "@/modules/ai/lib/selfHostedProfiles";
import { saveSelfHostedModel } from "@/modules/ai/lib/selfHostedModels";
import type { ProbeSnapshot } from "@/modules/ai/lib/selfHostedProbe";
import { createRequestPreflight } from "@/modules/ai/lib/requestPreflight";
import { resolveContextBudget } from "@/modules/ai/lib/contextBudget";
import { invoke } from "@tauri-apps/api/core";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const endpoint = createSelfHostedEndpoint(
  {
    alias: "Server",
    baseURL: "http://localhost:1234/v1",
    backendHint: "lmstudio",
  },
  "server",
);
const state = saveSelfHostedModel(
  addSelfHostedEndpoint(emptySelfHostedState(), endpoint),
  endpoint.id,
  "model",
);
const profileId = state.profiles[0].id;
const now = Date.now();
function snapshot(observedAt = now, limit = 32768): ProbeSnapshot {
  return {
    endpointId: endpoint.id,
    configurationRevision: endpoint.configurationRevision,
    selectedModelId: "model",
    observedAt,
    connected: true,
    reachable: true,
    credentialUsed: false,
    stale: false,
    refreshing: false,
    inventoryTtlMs: 300000,
    instanceTtlMs: 30000,
    errors: [],
    models: [
      {
        id: "model",
        name: null,
        chat: "supported",
        evidence: [
          profileEvidence(
            state,
            profileId,
            "probe.loadedContext",
            limit,
            "backend-reported",
            observedAt,
            "reported",
          ),
          profileEvidence(
            state,
            profileId,
            "probe.advertisedContext",
            262144,
            "advertised",
            observedAt,
            "reported",
          ),
        ],
      },
    ],
  };
}
const body = {
  messages: [{ role: "user", content: "x".repeat(20000) }],
  max_tokens: 1024,
};
const runtime = (s = state) =>
  createRequestPreflight({
    modelId: "model",
    local: true,
    state: s,
    admission: { endpointId: endpoint.id, profileId, capacity: 1 },
  });
beforeEach(() => vi.resetAllMocks());

describe("budget evidence precedence and freshness", () => {
  it("uses fresh loaded context, not advertised model maximum", () => {
    expect(
      resolveContextBudget(
        profileBudgetLimits(state, profileId, snapshot(), now),
      ),
    ).toMatchObject({ ceiling: 32768, source: "deployed" });
  });
  it("expires loaded evidence after 30 seconds but retains the distinct advertised bound", () => {
    expect(
      profileBudgetLimits(state, profileId, snapshot(), now + 30001),
    ).toMatchObject({ deployed: undefined, advertised: 262144 });
    expect(
      resolveContextBudget(
        profileBudgetLimits(state, profileId, snapshot(), now + 30001),
      ).ceiling,
    ).toBe(4096);
  });
  it("manual assertion survives stale metadata", () => {
    const manual = setProfileOverride(
      state,
      profileId,
      "configuredContext",
      16000,
    );
    expect(
      resolveContextBudget(
        profileBudgetLimits(manual, profileId, snapshot(), now + 30001),
      ),
    ).toMatchObject({ ceiling: 16000, source: "manual" });
  });
  it("rejects a manual assertion above fresh loaded context", () => {
    const manual = setProfileOverride(
      state,
      profileId,
      "configuredContext",
      65536,
    );
    expect(() =>
      resolveContextBudget(
        profileBudgetLimits(manual, profileId, snapshot(), now),
      ),
    ).toThrow("pin exceeds");
  });
  it("rename preserves budget identity and evidence", () => {
    const renamed = editSelfHostedEndpoint(state, endpoint.id, {
      alias: "New alias",
    });
    expect(budgetIdentity(renamed, profileId)).toBe(
      budgetIdentity(state, profileId),
    );
    expect(
      profileBudgetLimits(renamed, profileId, snapshot(), now).deployed,
    ).toBe(32768);
  });
  it("configuration edits invalidate evidence and request identity", () => {
    const edited = editSelfHostedEndpoint(state, endpoint.id, {
      baseURL: "http://localhost:5678/v1",
    });
    expect(budgetIdentity(edited, profileId)).not.toBe(
      budgetIdentity(state, profileId),
    );
    expect(
      profileBudgetLimits(edited, profileId, snapshot(), now).deployed,
    ).toBeUndefined();
  });
  it("ignores future, disconnected, and other-deployment evidence", () => {
    expect(
      profileBudgetLimits(state, profileId, snapshot(now + 1000), now).deployed,
    ).toBeUndefined();
    expect(
      profileBudgetLimits(
        state,
        profileId,
        { ...snapshot(), connected: false },
        now,
      ).deployed,
    ).toBeUndefined();
  });
  it("refreshes stale evidence through metadata only before accounting", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) =>
      cmd === "self_hosted_probe_cache" ? snapshot(now - 31000) : snapshot(),
    );
    await expect(runtime().prepare(body)).resolves.toBeTypeOf("function");
    expect(vi.mocked(invoke).mock.calls.map(([cmd]) => cmd)).toEqual([
      "self_hosted_probe_cache",
      "self_hosted_probe",
    ]);
  });
  it("refresh failure uses valid manual fallback, never the stale large deployment", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "self_hosted_probe_cache") return snapshot(now - 31000);
      throw new Error("offline");
    });
    await expect(runtime().prepare(body)).rejects.toThrow(
      "4096-token planning policy",
    );
    await expect(
      runtime(
        setProfileOverride(state, profileId, "configuredContext", 16000),
      ).prepare(body),
    ).resolves.toBeTypeOf("function");
  });
  it("queue expiry remeasures the same material against fallback without metadata HTTP in the slot", async () => {
    let cached = snapshot();
    vi.mocked(invoke).mockImplementation(async (cmd) =>
      cmd === "self_hosted_profiles_snapshot"
        ? [["selfHostedInference", state]]
        : cached,
    );
    const revalidate = await runtime().prepare(body);
    cached = snapshot(now - 31000);
    await expect(revalidate()).rejects.toThrow("4096-token planning policy");
    expect(
      vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === "self_hosted_probe"),
    ).toBe(false);
  });
  it("queue rejects a changed pin but accepts a harmless alias edit", async () => {
    let current = state;
    vi.mocked(invoke).mockImplementation(async (cmd) =>
      cmd === "self_hosted_profiles_snapshot"
        ? [["selfHostedInference", current]]
        : snapshot(),
    );
    const revalidate = await runtime().prepare(body);
    current = editSelfHostedEndpoint(state, endpoint.id, { alias: "Renamed" });
    await expect(revalidate()).resolves.toBeUndefined();
    current = setProfileOverride(state, profileId, "workingContext", 1000);
    await expect(revalidate()).rejects.toThrow("settings changed");
  });
});
