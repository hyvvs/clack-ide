import { ContextBudgetError } from "@/modules/ai/lib/contextBudget";
import { budgetIdentity } from "@/modules/ai/lib/contextBudgetProfile";
import { normalizeAiError } from "@/modules/ai/lib/errors";
import {
  assertOllamaContextRoute,
  createRequestPreflight,
} from "@/modules/ai/lib/requestPreflight";
import { saveSelfHostedModel } from "@/modules/ai/lib/selfHostedModels";
import type { ProbeSnapshot } from "@/modules/ai/lib/selfHostedProbe";
import {
  addSelfHostedEndpoint,
  createSelfHostedEndpoint,
  editSelfHostedEndpoint,
  emptySelfHostedState,
  profileEvidence,
  setProfileOverride,
  setProfileRecommendation,
} from "@/modules/ai/lib/selfHostedProfiles";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const modelId = "generic-model:revision";
const endpointId = "offline-fixture";

function fixture() {
  const endpoint = createSelfHostedEndpoint(
    {
      alias: "Local tunnel",
      baseURL: "http://127.0.0.1:11435/",
      backendHint: "ollama",
    },
    endpointId,
  );
  let state = saveSelfHostedModel(
    addSelfHostedEndpoint(emptySelfHostedState(), endpoint),
    endpointId,
    modelId,
  );
  const profileId = state.profiles[0].id;
  state = setProfileOverride(state, profileId, "workingContext", 32768);
  state.profiles[0].modelRevision = "digest-a";
  const evidence = (metric: string, value: number | string | boolean) =>
    profileEvidence(
      state,
      profileId,
      metric,
      value,
      "backend-reported",
      Date.now(),
      "reported",
    );
  let snapshot: ProbeSnapshot = {
    endpointId,
    configurationRevision: 1,
    selectedModelId: modelId,
    observedAt: Date.now(),
    connected: true,
    reachable: true,
    credentialUsed: false,
    stale: false,
    refreshing: false,
    inventoryTtlMs: 300_000,
    instanceTtlMs: 30_000,
    errors: [],
    models: [
      {
        id: modelId,
        name: null,
        chat: "supported",
        digest: "digest-a",
        evidence: [
          evidence("probe.runtimeContext", "per-request"),
          evidence("probe.advertisedContext", 65536),
          evidence("probe.loadedContext", 32768),
          evidence("probe.requestedContext", 32768),
        ],
      },
    ],
  };
  let current = state;
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "self_hosted_profiles_snapshot")
      return [["selfHostedInference", current]];
    if (
      command === "self_hosted_probe_cache" ||
      command === "self_hosted_probe"
    )
      return snapshot;
    throw new Error(`unexpected native command: ${command}`);
  });
  const preflight = createRequestPreflight({
    providerId: "ollama",
    local: true,
    modelId,
    state,
    admission: { endpointId, profileId, capacity: 1 },
  });
  const body = (name: unknown = modelId, context: unknown = 32768) => ({
    model: name,
    options: { num_ctx: context, num_predict: 256 },
    messages: [{ role: "user", content: "offline test" }],
    stream: true,
  });
  return {
    state,
    profileId,
    preflight,
    body,
    current: (next: typeof state) => {
      current = next;
    },
    snapshot: (next: ProbeSnapshot) => {
      snapshot = next;
    },
    readSnapshot: () => snapshot,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("R5a: frozen R5 context-route boundary without inference", () => {
  it("accepts matching model, context, route and same-chat continuation", async () => {
    const f = fixture();
    const first = await f.preflight.prepare(f.body());
    await expect(first()).resolves.toBeUndefined();
    const continuation = await f.preflight.prepare(f.body());
    await expect(continuation()).resolves.toBeUndefined();
    expect(
      vi
        .mocked(invoke)
        .mock.calls.every(([cmd]) => !String(cmd).startsWith("ai_http_")),
    ).toBe(true);
  });

  it("rejects a genuine serialized model mismatch, keeping model names private", async () => {
    const f = fixture();
    await expect(f.preflight.prepare(f.body("wrong-model"))).rejects.toThrow(
      "serialized model differs from the captured model",
    );
    expect(() =>
      assertOllamaContextRoute(f.body("wrong-model"), modelId, 32768),
    ).toThrow("Ollama context-route preflight rejected");
  });

  it("rejects changed, absent and malformed num_ctx without weakening the comparison", async () => {
    const f = fixture();
    for (const value of [4096, undefined, "32768", null]) {
      const request = f.body();
      request.options.num_ctx = value;
      await expect(f.preflight.prepare(request)).rejects.toMatchObject({
        code: "ollama-context-route",
      });
    }
    expect(() =>
      assertOllamaContextRoute(f.body(modelId, 8192), modelId, 32768),
    ).toThrow("serialized num_ctx 8192; trusted runtime target 32768");
  });

  it("labels lost/unknown trusted runtime as unavailable, not as a false observed allocation", () => {
    expect(() =>
      assertOllamaContextRoute(
        { model: modelId, options: { num_ctx: 65536 } },
        modelId,
        undefined,
      ),
    ).toThrow("serialized num_ctx 65536; trusted runtime target unavailable");
    expect(() =>
      assertOllamaContextRoute({ model: modelId }, modelId, undefined),
    ).not.toThrow();
    const error = (() => {
      try {
        assertOllamaContextRoute(
          { model: modelId, options: { num_ctx: 65536 } },
          modelId,
          undefined,
        );
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(ContextBudgetError);
    expect(normalizeAiError(error)).toMatchObject({
      errorCode: "ollama-context-route",
      kind: "bad_request",
      retryable: false,
      title: "Context preflight",
    });
    expect(String((error as Error).message)).not.toMatch(
      /generic-model|127\.0\.0\.1|Bearer|prompt/,
    );
  });

  it("allows harmless endpoint alias/reconnection metadata churn but rejects a changed endpoint revision", async () => {
    const f = fixture();
    const check = await f.preflight.prepare(f.body());
    const alias = editSelfHostedEndpoint(f.state, endpointId, {
      alias: "Renamed local connection",
    });
    expect(budgetIdentity(alias, f.profileId)).toBe(
      budgetIdentity(f.state, f.profileId),
    );
    f.current(alias);
    await expect(check()).resolves.toBeUndefined();
    const changed = editSelfHostedEndpoint(alias, endpointId, {
      baseURL: "http://127.0.0.1:11436/",
    });
    expect(budgetIdentity(changed, f.profileId)).not.toBe(
      budgetIdentity(f.state, f.profileId),
    );
    f.current(changed);
    await expect(check()).rejects.toMatchObject({
      code: "context-settings-changed",
    });
  });

  it("rejects a changed captured model digest and profile configuration without inference", async () => {
    const f = fixture();
    const check = await f.preflight.prepare(f.body());
    const changed = structuredClone(f.state);
    changed.profiles[0].modelRevision = "digest-b";
    f.current(changed);
    await expect(check()).rejects.toMatchObject({
      code: "context-settings-changed",
    });
    changed.profiles[0].modelRevision = "digest-a";
    f.current(
      setProfileOverride(changed, f.profileId, "workingContext", 16384),
    );
    await expect(check()).rejects.toMatchObject({
      code: "context-settings-changed",
    });
  });

  it("rejects changed observed model digest and absent runtime context contract before native dispatch", async () => {
    const f = fixture();
    f.snapshot({
      ...f.readSnapshot(),
      models: [{ ...f.readSnapshot().models[0], digest: "digest-b" }],
    });
    await expect(f.preflight.prepare(f.body())).rejects.toThrow(
      "Model unavailable or revision changed",
    );
    const g = fixture();
    g.snapshot({
      ...g.readSnapshot(),
      models: [
        {
          ...g.readSnapshot().models[0],
          evidence: g
            .readSnapshot()
            .models[0].evidence.filter(
              (e) => e.metric !== "probe.runtimeContext",
            ),
        },
      ],
    });
    await expect(g.preflight.prepare(g.body())).rejects.toMatchObject({
      code: "ollama-context-unverified",
    });
  });

  it("a changed working-context recommendation changes the captured profile identity and fails closed", async () => {
    const f = fixture();
    const result = await f.preflight.prepare(f.body());
    const evidence = profileEvidence(
      f.state,
      f.profileId,
      "workingContext",
      16384,
      "recommendation",
      Date.now(),
      "observed",
    );
    const recommendation = setProfileRecommendation(
      f.state,
      f.profileId,
      "workingContext",
      evidence,
    );
    expect(budgetIdentity(recommendation, f.profileId)).not.toBe(
      budgetIdentity(f.state, f.profileId),
    );
    f.current(recommendation);
    await expect(result()).rejects.toMatchObject({
      code: "context-settings-changed",
    });
  });

  it("missing current profile state fails closed, not silently rebound", async () => {
    const f = fixture();
    const revalidate = await f.preflight.prepare(f.body());
    const changed = structuredClone(f.state);
    changed.profiles = [];
    f.current(changed);
    await expect(revalidate()).rejects.toMatchObject({
      code: "context-settings-changed",
    });
  });
});
