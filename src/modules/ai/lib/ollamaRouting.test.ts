import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { buildConfiguredLanguageModel } from "@/modules/ai/lib/agent";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import {
  addSelfHostedEndpoint,
  createSelfHostedEndpoint,
  emptySelfHostedState,
  setProfileOverride,
  setProfileRecommendation,
  profileEvidence,
  editSelfHostedEndpoint,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  saveSelfHostedModel,
  selfHostedSelectionId,
  selfHostedTransportIdentity,
} from "@/modules/ai/lib/selfHostedModels";
import { profileBudgetLimits } from "@/modules/ai/lib/contextBudgetProfile";
import { modelBudgetLimits } from "@/modules/ai/lib/requestPreflight";
import {
  resolveContextBudget,
  assertRequestBudget,
} from "@/modules/ai/lib/contextBudget";
import { serverModelDetails } from "@/modules/ai/lib/selfHostedCapabilities";
import {
  captureEffort,
  effortProviderOptions,
} from "@/modules/ai/lib/reasoningEffort";
import type { ProbeSnapshot } from "@/modules/ai/lib/selfHostedProbe";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage = (_e: unknown) => {};
  },
}));
let state = configuration();
let current = state;
let snapshot: ProbeSnapshot;
let loadedAfter = 32768;
let beforeAdmission: (() => void) | undefined;
const sent: {
  url: string;
  body: Record<string, unknown>;
  private: boolean;
  admission: unknown;
  headers: unknown;
}[] = [];
const approvals = new Map<string, (value: boolean) => void>();
function configuration() {
  let value = saveSelfHostedModel(
    addSelfHostedEndpoint(
      emptySelfHostedState(),
      createSelfHostedEndpoint(
        {
          alias: "Ollama",
          baseURL: "https://private.test/proxy/v1/",
          backendHint: "ollama",
          allowPrivateNetwork: false,
          credentialRef: {
            kind: "custom-endpoint",
            endpointId: "proxy-credential",
          },
        },
        "ollama-endpoint",
      ),
    ),
    "ollama-endpoint",
    "exact:latest",
  );
  value = setProfileOverride(
    value,
    value.profiles[0].id,
    "workingContext",
    32768,
  );
  return value;
}
function metadata(loaded?: number, requested?: number): ProbeSnapshot {
  const profile = state.profiles[0],
    endpoint = state.endpoints[0];
  const evidence = (metric: string, value: number | boolean | string) =>
    profileEvidence(
      state,
      profile.id,
      metric,
      value,
      "backend-reported",
      Date.now(),
      "reported",
    );
  return {
    endpointId: endpoint.id,
    configurationRevision: endpoint.configurationRevision,
    selectedModelId: profile.transportModelId,
    observedAt: Date.now(),
    connected: true,
    reachable: true,
    credentialUsed: true,
    stale: false,
    refreshing: false,
    inventoryTtlMs: 300000,
    instanceTtlMs: 30000,
    errors: [],
    models: [
      {
        id: profile.transportModelId,
        name: null,
        chat: "supported",
        evidence: [
          evidence("probe.advertisedContext", 262144),
          evidence("probe.runtimeContext", "per-request"),
          evidence("probe.loaded", loaded !== undefined),
          evidence("probe.thinking", true),
          ...(loaded ? [evidence("probe.loadedContext", loaded)] : []),
          ...(requested ? [evidence("probe.requestedContext", requested)] : []),
        ],
      },
    ],
  };
}
beforeEach(() => {
  state = configuration();
  current = state;
  snapshot = metadata();
  loadedAfter = 32768;
  beforeAdmission = undefined;
  sent.length = 0;
  approvals.clear();
  vi.clearAllMocks();
  vi.mocked(invoke).mockImplementation(async (command, raw) => {
    const args = raw as Record<string, unknown>;
    if (command === "self_hosted_profiles_snapshot")
      return [["selfHostedInference", current]];
    if (command === "self_hosted_probe_cache") {
      expect(
        (args.options as { allowPrivateNetwork: boolean }).allowPrivateNetwork,
      ).toBe(false);
      return snapshot;
    }
    if (command === "self_hosted_probe") {
      snapshot = metadata(
        loadedAfter,
        (args.options as { requestedContext?: number }).requestedContext,
      );
      return snapshot;
    }
    if (command === "ai_http_open") return crypto.randomUUID();
    if (command === "ai_http_preflight") {
      approvals.get(String(args.requestId))?.(args.approved === true);
      return;
    }
    if (command !== "ai_http_stream") return null;
    const a = args as unknown as {
      requestId: string;
      body: number[];
      url: string;
      allowPrivateNetwork: boolean;
      admission: unknown;
      headers: unknown;
      onEvent: { onmessage: (e: unknown) => void };
    };
    beforeAdmission?.();
    const approved = await new Promise<boolean>((resolve) => {
      approvals.set(a.requestId, resolve);
      a.onEvent.onmessage({ kind: "preflight", requestId: a.requestId });
    });
    if (!approved) {
      a.onEvent.onmessage({
        kind: "settled",
        requestId: a.requestId,
        phase: "failed",
        error: { code: "context-preflight-rejected" },
      });
      return;
    }
    const body = JSON.parse(new TextDecoder().decode(Uint8Array.from(a.body)));
    sent.push({
      url: a.url,
      body,
      private: a.allowPrivateNetwork,
      admission: a.admission,
      headers: a.headers,
    });
    a.onEvent.onmessage({
      kind: "headers",
      requestId: a.requestId,
      status: 200,
      headers: { "content-type": "application/json" },
    });
    a.onEvent.onmessage({
      kind: "chunk",
      requestId: a.requestId,
      bytes: [
        ...new TextEncoder().encode(
          JSON.stringify({
            model: body.model,
            message: { role: "assistant", content: "done" },
            done: true,
            done_reason: "stop",
          }),
        ),
      ],
    });
    a.onEvent.onmessage({
      kind: "settled",
      requestId: a.requestId,
      phase: "completed",
    });
  });
});
const params = {
  prompt: [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: "Hello" }],
    },
  ],
  maxOutputTokens: 256,
};
async function model(
  legacy = false,
  reasoning?: ReturnType<typeof captureEffort>,
) {
  const built = await buildConfiguredLanguageModel(
    legacy ? "ollama-local" : selfHostedSelectionId(state.profiles[0]),
    EMPTY_PROVIDER_KEYS,
    {
      selfHostedInference: state,
      reasoning,
      customEndpointKeys: { "proxy-credential": "only-this-credential" },
      ...(legacy
        ? {
            ollamaModelId: "exact:latest",
            ollamaBaseURL: "http://localhost:11434/v1",
          }
        : {}),
      inferenceScope: {
        sessionId: "owner",
        runId: crypto.randomUUID(),
        isCurrent: () => true,
      },
    },
  );
  if (typeof built === "string" || built.specificationVersion !== "v3")
    throw new Error("Wrong adapter");
  return built;
}
describe("production Ollama route, B1 and runtime evidence", () => {
  it("Automatic does not budget against an earlier larger allocation without a default-context contract", async () => {
    state.profiles[0].overrides = {}; current = state; snapshot = metadata(32768);
    const built = await model();
    expect(resolveContextBudget(await modelBudgetLimits(built))).toMatchObject({ ceiling: 4096, source: "unknown-policy" });
    await built.doGenerate(params);
    expect(sent[0].body.options).not.toHaveProperty("num_ctx");
  });
  it("a bounded existing recommendation controls allocation and manual choice wins", async () => {
    state.profiles[0].overrides = {};
    state = setProfileRecommendation(
      state,
      state.profiles[0].id,
      "workingContext",
      profileEvidence(
        state,
        state.profiles[0].id,
        "workingContext",
        16384,
        "recommendation",
      ),
    );
    current = state;
    loadedAfter = 16384;
    await (await model()).doGenerate(params);
    expect(sent[0].body.options).toMatchObject({ num_ctx: 16384 });
    state = setProfileOverride(
      state,
      state.profiles[0].id,
      "workingContext",
      32768,
    );
    current = state;
    await (await model()).doGenerate(params);
    expect(sent[1].body.options).toMatchObject({ num_ctx: 32768 });
  });
  it("reuses fresh post-request evidence without a metadata call on every inference", async () => {
    const built = await model();
    await built.doGenerate(params);
    await built.doGenerate(params);
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(([command]) => command === "self_hosted_probe"),
    ).toHaveLength(1);
    expect(sent).toHaveLength(2);
  });
  it("cold first request sends actual native num_ctx and the exact B1 ceiling without warm-up", async () => {
    const built = await model();
    expect(resolveContextBudget(await modelBudgetLimits(built))).toMatchObject({
      ceiling: 32768,
      source: "requested",
    });
    await built.doGenerate(params);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      url: "https://private.test/proxy/api/chat",
      private: false,
      admission: {
        endpointId: "ollama-endpoint",
        profileId: state.profiles[0].id,
      },
      body: {
        model: "exact:latest",
        options: { num_ctx: 32768, num_predict: 256 },
      },
    });
    expect(
      new Headers(sent[0].headers as HeadersInit).get("authorization"),
    ).toBe("Bearer only-this-credential");
    expect(
      assertRequestBudget(await modelBudgetLimits(built), sent[0].body).ceiling,
    ).toBe(32768);
    expect(
      serverModelDetails(state.endpoints[0], "exact:latest", snapshot)
        .serverContext,
    ).toBe("32,768 tokens (loaded)");
  });
  it("a previously loaded 4K allocation does not prevent an explicit new 32K request", async () => {
    snapshot = metadata(4096);
    await (await model()).doGenerate(params);
    expect(sent[0].body.options).toMatchObject({ num_ctx: 32768 });
  });
  it("a post-request 4K mismatch is truthful and blocks subsequent budgeting, not replaying the sent request", async () => {
    loadedAfter = 4096;
    const built = await model();
    await built.doGenerate(params);
    expect(
      serverModelDetails(state.endpoints[0], "exact:latest", snapshot)
        .serverContext,
    ).toContain("4,096");
    await expect(built.doGenerate(params)).rejects.toThrow(
      /after Clack requested 32768/,
    );
    expect(sent).toHaveLength(1);
    // A new runtime/window observes the same shared native evidence.
    await expect((await model()).doGenerate(params)).rejects.toThrow(
      /after Clack requested/,
    );
  });
  it("Automatic does not turn asserted capacity into runtime allocation", async () => {
    state.profiles[0].overrides = {};
    state = setProfileOverride(
      state,
      state.profiles[0].id,
      "configuredContext",
      32768,
    );
    current = state;
    await (await model()).doGenerate(params);
    expect(sent[0].body.options).not.toHaveProperty("num_ctx");
  });
  it.each([
    0, -1, 2.5, 2000001, 262145,
  ])("rejects invalid/above-model target %s without inference", async (target) => {
    const override = state.profiles[0].overrides.workingContext;
    if (!override) throw new Error("Missing fixture override");
    override.evidence.value = target;
    await expect((await model()).doGenerate(params)).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });
  it("unprobed runtime contract fails closed", async () => {
    snapshot.models[0].evidence = snapshot.models[0].evidence.filter(
      (e) => e.metric !== "probe.runtimeContext",
    );
    await expect((await model()).doGenerate(params)).rejects.toThrow(/Refresh/);
    expect(sent).toHaveLength(0);
  });
  it.each([
    "profile",
    "endpoint",
    "model",
  ])("captured %s change while waiting fails before inference", async (change) => {
    const built = await model();
    beforeAdmission = () => {
      current = structuredClone(state);
      if (change === "profile")
        current = setProfileOverride(
          current,
          current.profiles[0].id,
          "workingContext",
          16384,
        );
      if (change === "endpoint")
        current = editSelfHostedEndpoint(current, current.endpoints[0].id, {
          baseURL: "https://other.test/v1",
        });
      if (change === "model")
        current.profiles[0].transportModelId = "different:model";
    };
    await expect(built.doGenerate(params)).rejects.toThrow(/settings changed/);
    expect(sent).toHaveLength(0);
  });
  it("legacy Ollama uses the same native implementation, without forcing a context default", async () => {
    state = emptySelfHostedState();
    current = state;
    await (await model(true)).doGenerate(params);
    expect(sent[0].url).toBe("http://localhost:11434/api/chat");
    expect(sent[0].body.options).not.toHaveProperty("num_ctx");
  });
  it("keeps generic compatible deployment limits unchanged", () => {
    state.endpoints[0].backendHint = "vllm";
    snapshot = metadata(4096);
    expect(
      profileBudgetLimits(state, state.profiles[0].id, snapshot),
    ).toMatchObject({ deployed: 4096, workingTarget: 32768 });
  });
  it("captures supported native thinking without inventing named effort levels", () => {
    state.profiles[0].evidence = snapshot.models[0].evidence;
    const identity = selfHostedTransportIdentity(
      selfHostedSelectionId(state.profiles[0]),
      state,
    );
    if (!identity) throw new Error("Missing fixture identity");
    const automatic = captureEffort("selection", identity, undefined, state);
    expect(automatic.adapter).toBe("ollama");
    expect(effortProviderOptions(automatic)).toEqual({});
    expect(automatic.capability.levels).toEqual(["none", "on"]);
    expect(effortProviderOptions({ ...automatic, choice: "none" })).toEqual({
      ollama: { think: false },
    });
    expect(() =>
      effortProviderOptions({ ...automatic, choice: "high" }),
    ).toThrow();
  });
  it("keeps an explicit reasoning choice alive across successful Ollama tool-loop steps", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    snapshot = metadata(32768, 32768);
    state.profiles[0].evidence = snapshot.models[0].evidence;
    current = state;
    const identity = selfHostedTransportIdentity(
      selfHostedSelectionId(state.profiles[0]),
      state,
    );
    if (!identity) throw new Error("Missing fixture identity");
    const reasoning = {
      ...captureEffort("selection", identity, undefined, state),
      choice: "none",
    };
    const built = await model(false, reasoning);
    beforeAdmission = () => vi.mocked(Date.now).mockReturnValue(now + 20_000);
    await built.doGenerate(params);
    expect(sent[0].body.think).toBe(false);

    beforeAdmission = undefined;
    vi.mocked(Date.now).mockReturnValue(now + 45_000);
    snapshot = metadata(32768, 32768);
    current.profiles[0].evidence = snapshot.models[0].evidence;
    await built.doGenerate(params);
    expect(sent).toHaveLength(2);
    expect(sent[1].body.think).toBe(false);
  });
  it("newer exact thinking levels override legacy boolean capabilities", () => {
    state.profiles[0].evidence = [
      ...snapshot.models[0].evidence,
      profileEvidence(
        state,
        state.profiles[0].id,
        "probe.thinkingControls",
        '["low","high"]',
        "backend-reported",
        Date.now(),
        "reported",
      ),
    ];
    const identity = selfHostedTransportIdentity(
      selfHostedSelectionId(state.profiles[0]),
      state,
    );
    if (!identity) throw new Error("Missing fixture identity");
    const captured = captureEffort("selection", identity, undefined, state);
    expect(captured.capability.levels).toEqual(["low", "high"]);
    expect(effortProviderOptions({ ...captured, choice: "low" })).toEqual({
      ollama: { think: "low" },
    });
  });
  it.each(["expired admission", "changed controls"])("rejects an explicit reasoning choice with %s", async (scenario) => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    snapshot = metadata(32768, 32768);
    state.profiles[0].evidence = snapshot.models[0].evidence;
    current = state;
    const identity = selfHostedTransportIdentity(selfHostedSelectionId(state.profiles[0]), state);
    if (!identity) throw new Error("Missing fixture identity");
    const reasoning = { ...captureEffort("selection", identity, undefined, state), choice: "none" };
    const built = await model(false, reasoning);
    beforeAdmission = () => {
      if (scenario === "expired admission") vi.mocked(Date.now).mockReturnValue(now + 31_000);
      else {
        current = structuredClone(current);
        current.profiles[0].evidence.push(profileEvidence(state, state.profiles[0].id,
          "probe.thinkingControls", '["low","high"]', "backend-reported", now, "reported"));
      }
    };
    await expect(built.doGenerate(params)).rejects.toThrow();
    expect(sent).toHaveLength(0);
    expect(invoke).toHaveBeenCalledWith("ai_http_preflight", expect.objectContaining({ approved: false }));
  });
});
