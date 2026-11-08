import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateText, jsonSchema, stepCountIs, streamText, tool } from "ai";
import { withAnswerContinuation } from "@/modules/ai/lib/answerContinuation";
import { invoke } from "@tauri-apps/api/core";
import { buildConfiguredLanguageModel, buildLanguageModel, runAgentStream } from "@/modules/ai/lib/agent";
import {rememberContextRuntime, forgetContextRuntime} from "@/modules/ai/lib/contextCalibrationTrust";
import {toolScope} from "@/modules/ai/lib/toolVerification";
import type {ToolContext} from "@/modules/ai/tools/context";
import {usePreferencesStore} from "@/modules/settings/preferences";
import { endpointInferenceAdmission } from "@/modules/ai/lib/inferenceAdmission";
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
import { MUSE_THINKING_VALUES } from "@/modules/ai/lib/reasoningEffort.fixture";
import { TOOL_PROBE_NAME, TOOL_PROBE_PROMPT, probeArguments } from "@/modules/ai/lib/toolVerificationSchema";

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
let beforeResponse: (() => void) | undefined;
let refreshProbe: ((value: ProbeSnapshot) => ProbeSnapshot | Promise<ProbeSnapshot>) | undefined;
let reply: ((index: number) => { message: Record<string, unknown>; done_reason: string }) | undefined;
const sent: {
  url: string;
  body: Record<string, unknown>;
  private: boolean;
  admission: unknown;
  headers: unknown;
}[] = [];
const approvals = new Map<string, (value: boolean) => void>();
function configuration(modelId = "exact:latest") {
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
    modelId,
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
  const evidence = (metric: string, value: number | boolean | string) => {
    const requestMeasurement = metric === "probe.requestedContext";
    return profileEvidence(
      state,
      profile.id,
      metric,
      value,
      requestMeasurement ? "measured" : "backend-reported",
      Date.now(),
      requestMeasurement ? "observed" : "reported",
    );
  };
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
        digest: profile.modelRevision,
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
  beforeResponse = undefined;
  refreshProbe = undefined;
  reply = undefined;
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
      const next = metadata(
        loadedAfter,
        (args.options as { requestedContext?: number }).requestedContext,
      );
      snapshot = refreshProbe ? await refreshProbe(next) : next;
      current = structuredClone(current);
      current.profiles[0].evidence = snapshot.models[0]?.evidence ?? [];
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
    beforeResponse?.();
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
            prompt_eval_count: 20,
            eval_count: 64,
            ...reply?.(sent.length),
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
const originalPreferences = usePreferencesStore.getState();
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); usePreferencesStore.setState(originalPreferences); forgetContextRuntime("ollama-endpoint"); });
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
  it.each(["automatic", "none", "chat-only", "stale-explicit"])("the real Agent route uses confirmed reasoning only for Automatic tools, preserving %s", async mode => {
    const p = state.profiles[0], e = state.endpoints[0], now = Date.now();
    p.modelRevision = "digest"; snapshot = metadata(32768,32768); p.evidence = snapshot.models[0].evidence;
    state.inventories = [{endpointId:e.id,configurationRevision:e.configurationRevision,connected:true,observedAt:now,backend:"ollama",
      models:[{id:p.transportModelId,name:null,chat:"supported",digest:"digest"}]}];
    rememberContextRuntime(e.id,{epoch:"native",version:"1.2.3",configurationRevision:e.configurationRevision,at:now});
    const scope = toolScope(p,e);
    if (!scope) throw new Error("scope missing");
    const base = {version:1 as const,id:"default",scope,status:"needs-attention" as const,outcome:"text-only" as const,
      context:32768,output:512 as const,startedAt:now,completedAt:now,firstBodyAt:now,callAt:null,calls:0,validArguments:false,
      textualIntent:true,textChars:20,finish:"stop",proof:null,retryAfter:now+86400000,
      failure:{at:now,expiresAt:now+86400000,outcome:"text-only" as const}};
    p.toolVerification = base;
    p.agentToolConfigurations = [{...base,id:"confirmed",configuration:{choice:"none",wire:false},status:"verified",outcome:"native-call",
      calls:1,validArguments:true,callAt:now,proof:{at:now,expiresAt:now+86400000},failure:undefined,
      confirmation:{id:"first-pass",at:now,expiresAt:now+86400000}}];
    current = state;
    usePreferencesStore.setState({agentPermissionProfiles:{"builtin:coder":{mode:mode === "chat-only" ? "chat-only" : "full-access",categories:{}}}});
    const selection = selfHostedSelectionId(p), identity = selfHostedTransportIdentity(selection,state);
    if (!identity) throw new Error("identity missing");
    const automatic = captureEffort(selection,identity,undefined,state);
    const pending = runAgentStream({keys:EMPTY_PROVIDER_KEYS,modelId:selection,selfHostedInference:state,
      customEndpointKeys:{"proxy-credential":"only-this-credential"},reasoning:mode === "stale-explicit" ? {...automatic,unresolvedExplicitChoice:"none"} : mode === "none" ? {...automatic,choice:"none"} : automatic,
      toolContext:{getCwd:()=>"/fixture",getWorkspaceRoot:()=>"/fixture",getAgentId:()=>"builtin:coder",getSessionId:()=>"agent-configuration",
        readCache:new Map()} as ToolContext,
      uiMessages:[{id:"u",role:"user",parts:[{type:"text",text:"Say hello without tools."}]}]});
    if (mode === "stale-explicit") {await expect(pending).rejects.toThrow(/revalidation/);expect(sent).toHaveLength(0);return;}
    const result = await pending;
    await result.consumeStream();
    expect(sent).toHaveLength(1);
    if (mode === "chat-only") expect(sent[0].body).not.toHaveProperty("think"); else expect(sent[0].body.think).toBe(false);
    expect(automatic.choice).toBe("automatic");
    expect(sent[0].body.model).toBe("exact:latest");
    forgetContextRuntime(e.id);
  });
  it("verifies a native structured probe through SDK and native HTTP without executing the tool", async () => {
    reply = () => ({ message: { role: "assistant", content: "", tool_calls: [{ function: { name: TOOL_PROBE_NAME, arguments: { key: "clack-probe-v1", count: 1 } } }] }, done_reason: "stop" });
    const built = await buildLanguageModel("ollama", EMPTY_PROVIDER_KEYS, "exact:latest", {
      selfHosted: true, selfHostedInference: state, toolVerification: true, ollamaBaseURL: state.endpoints[0].baseURL,
      admission: endpointInferenceAdmission(state.endpoints[0].id, state.profiles[0].id, state),
      inferenceScope: { sessionId: "tool-probe", runId: "tool-probe", isCurrent: () => true },
      calibration: { requestClass: "optimization", record: () => {} },
    }, "only-this-credential");
    const definitions = { [TOOL_PROBE_NAME]: tool({ inputSchema: probeArguments }) };
    const result = streamText({ model: built, prompt: TOOL_PROBE_PROMPT, tools: definitions, maxOutputTokens: 512, maxRetries: 0 });
    await result.consumeStream();
    expect(await result.toolCalls).toMatchObject([{ toolName: TOOL_PROBE_NAME, input: { key: "clack-probe-v1", count: 1 } }]);
    expect(await result.toolResults).toEqual([]); expect(definitions[TOOL_PROBE_NAME]).not.toHaveProperty("execute");
    expect(sent).toHaveLength(1); expect(sent[0].url).toBe("https://private.test/proxy/api/chat");
    expect(sent[0].body.options).toMatchObject({ num_ctx: 32768, num_predict: 512 });
    expect(sent[0].body).not.toHaveProperty("think");
    expect((sent[0].body.tools as { function: { name: string } }[]).map(t => t.function.name)).toEqual([TOOL_PROBE_NAME]);
  });
  it("serializes a bounded calibration allocation through the production SDK/native route without tools, thinking override or user-pin mutation", async () => {
    const pin = JSON.stringify(state.profiles[0].overrides);
    const built = await buildLanguageModel("ollama", EMPTY_PROVIDER_KEYS, "exact:latest", {
      selfHosted: true, selfHostedInference: state, calibrationContext: 8192,
      ollamaBaseURL: state.endpoints[0].baseURL,
      admission: endpointInferenceAdmission(state.endpoints[0].id, state.profiles[0].id, state),
      inferenceScope: { sessionId: "context-only", runId: "context-only", isCurrent: () => true },
    }, "only-this-credential");
    const result = streamText({ model: built, prompt: "Reply with OK.", maxOutputTokens: 32, maxRetries: 0 });
    await result.consumeStream();
    expect(await result.finishReason).toBe("stop");
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://private.test/proxy/api/chat");
    expect(sent[0].body.options).toMatchObject({ num_ctx: 8192, num_predict: 32 });
    expect(sent[0].body).not.toHaveProperty("think");
    expect(sent[0].body.tools ?? []).toEqual([]);
    expect(JSON.stringify(state.profiles[0].overrides)).toBe(pin);
  });
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
  it("rejects changed reasoning controls during admission", async () => {
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
      current = structuredClone(current);
      current.profiles[0].evidence.push(profileEvidence(state, state.profiles[0].id,
        "probe.thinkingControls", '["low","high"]', "backend-reported", now, "reported"));
    };
    await expect(built.doGenerate(params)).rejects.toThrow();
    expect(sent).toHaveLength(0);
    expect(invoke).toHaveBeenCalledWith("ai_http_preflight", expect.objectContaining({ approved: false }));
  });
});

async function explicitNoneModel() {
  snapshot = metadata(32768, 32768);
  state.profiles[0].evidence = snapshot.models[0].evidence;
  current = state;
  const identity = selfHostedTransportIdentity(selfHostedSelectionId(state.profiles[0]), state);
  if (!identity) throw new Error("Missing fixture identity");
  const captured = { ...captureEffort("selection", identity, undefined, state), choice: "none" };
  return { built: await model(false, captured), captured };
}

describe("captured reasoning evidence across real adapter steps", () => {
  it.each(["automatic", "none", "low", "medium", "high", "max"])("serializes mixed Muse %s through production admission and the native adapter, entirely intercepted", async choice => {
    state = configuration("muse-glimmer:30b");
    current = state;
    snapshot = metadata(32768, 32768);
    snapshot.models[0].evidence.push(profileEvidence(state, state.profiles[0].id, "probe.thinkingControls", JSON.stringify(MUSE_THINKING_VALUES), "backend-reported", Date.now(), "reported"));
    state.profiles[0].evidence = snapshot.models[0].evidence;
    const identity = selfHostedTransportIdentity(selfHostedSelectionId(state.profiles[0]), state);
    if (!identity) throw new Error("Missing fixture identity");
    const reasoning = { ...captureEffort("selection", identity, undefined, state), choice };
    const fetcher = vi.fn(() => { throw new Error("No network allowed in offline reasoning test"); });
    vi.stubGlobal("fetch", fetcher);
    try {
      await (await model(false, reasoning)).doGenerate({ ...params, maxOutputTokens: 2048 });
      expect(sent).toHaveLength(1);
      expect(sent[0].body).toMatchObject({ model: "muse-glimmer:30b", options: { num_ctx: 32768, num_predict: 2048 } });
      if (choice === "automatic") expect(sent[0].body).not.toHaveProperty("think");
      else expect(sent[0].body.think).toBe(choice === "none" ? false : choice);
      expect(fetcher).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it.each(["future-level", "changed-wire"])("revalidates mixed controls at admission: %s", async change => {
    snapshot = metadata(32768, 32768);
    snapshot.models[0].evidence.push(profileEvidence(state, state.profiles[0].id, "probe.thinkingControls", JSON.stringify([false, true, "low"]), "backend-reported", Date.now(), "reported"));
    state.profiles[0].evidence = snapshot.models[0].evidence;
    current = state;
    const identity = selfHostedTransportIdentity(selfHostedSelectionId(state.profiles[0]), state);
    if (!identity) throw new Error("Missing fixture identity");
    const reasoning = { ...captureEffort("selection", identity, undefined, state), choice: "none" };
    const built = await model(false, reasoning);
    beforeAdmission = () => {
      current = structuredClone(current);
      const controls = current.profiles[0].evidence.find(e => e.metric === "probe.thinkingControls");
      if (!controls) throw new Error("Missing fixture controls");
      controls.value = JSON.stringify(change === "future-level" ? [false, true, "low", "future_level"] : ["none", true, "low"]);
    };
    if (change === "future-level") {
      await built.doGenerate(params);
      expect(sent).toHaveLength(1);
      expect(sent[0].body.think).toBe(false);
    } else {
      await expect(built.doGenerate(params)).rejects.toThrow();
      expect(sent).toHaveLength(0);
    }
  });
  it("revalidates an expired capture when rebuilding the same model for a later run segment", async () => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { captured } = await explicitNoneModel();
    const original = structuredClone(captured);
    now += 40_000;
    const rebuilt = await model(false, captured);
    await rebuilt.doGenerate(params);
    expect(sent).toHaveLength(1);
    expect(sent[0].body.think).toBe(false);
    expect(captured).toEqual(original);
  });
  it("revalidates the same contract after slow model responses and 40-second tool work without replay", async () => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { built, captured } = await explicitNoneModel();
    const original = structuredClone(captured);
    beforeResponse = () => { now += 56_000; };
    reply = index => ({
      message: index < 3
        ? { role: "assistant", content: "Inspecting.", tool_calls: [{ function: { name: "inspect_workspace", arguments: {} } }] }
        : { role: "assistant", content: "Verified." },
      done_reason: "stop",
    });
    let effects = 0;
    const result = await generateText({
      model: built, prompt: "Inspect twice, then report.", maxOutputTokens: 2048,
      tools: { inspect_workspace: tool({ inputSchema: jsonSchema({ type: "object", properties: {} }), execute: async () => {
        now += 40_000;
        return { observation: ++effects };
      } }) },
      stopWhen: stepCountIs(4), maxRetries: 0,
    });
    expect(result.text).toBe("Verified.");
    expect(effects).toBe(2);
    expect(result.steps).toHaveLength(3);
    expect(sent).toHaveLength(3);
    for (const request of sent) expect(request.body).toMatchObject({ model: "exact:latest", think: false, options: { num_ctx: 32768, num_predict: 2048 } });
    expect(captured).toEqual(original);
    expect(invoke).toHaveBeenCalledWith("self_hosted_probe", expect.objectContaining({ options: expect.objectContaining({ selectedModelId: "exact:latest", force: true, restart: false }) }));
  });

  it("refreshes after an expired queue wait before approving the original think:false body", async () => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { built } = await explicitNoneModel();
    beforeAdmission = () => { now += 40_000; };
    await built.doGenerate(params);
    expect(sent).toHaveLength(1);
    expect(sent[0].body.think).toBe(false);
    const calls = vi.mocked(invoke).mock.calls;
    const waiting = calls.findIndex(([command]) => command === "ai_http_stream");
    const refreshed = calls.findIndex(([command], index) => index > waiting && command === "self_hosted_probe");
    const approved = calls.findIndex(([command, args]) => command === "ai_http_preflight" && (args as { approved: boolean }).approved);
    expect(refreshed).toBeGreaterThan(waiting);
    expect(approved).toBeGreaterThan(refreshed);
  });
  it("refreshes near expiry instead of racing the unchanged TTL at admission", async () => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { built } = await explicitNoneModel();
    beforeAdmission = () => { now += 29_999; };
    await built.doGenerate(params);
    expect(sent).toHaveLength(1);
    expect(sent[0].body.think).toBe(false);
  });

  it.each(["unsupported", "different mapping", "different model", "different deployment", "endpoint revision"])("fails closed when refresh reveals %s", async scenario => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { built } = await explicitNoneModel();
    await built.doGenerate(params);
    now += 40_000;
    refreshProbe = next => {
      current = structuredClone(current);
      if (scenario === "unsupported") {
        const thinking = next.models[0].evidence.find(e => e.metric === "probe.thinking");
        if (!thinking) throw new Error("Missing fixture evidence");
        thinking.value = false;
      }
      if (scenario === "different mapping") next.models[0].evidence.push(profileEvidence(state, state.profiles[0].id,
        "probe.thinkingControls", '["none","on"]', "backend-reported", now, "reported"));
      if (scenario === "different model") current.profiles[0].transportModelId = "other:latest";
      if (scenario === "different deployment") current.profiles[0].deploymentId = "other";
      if (scenario === "endpoint revision") current.endpoints[0].configurationRevision++;
      return next;
    };
    await expect(built.doGenerate(params)).rejects.toThrow(/reasoning-control contract changed|settings changed/);
    expect(sent).toHaveLength(1);
  });

  it.each(["unavailable", "missing support"])("does not manufacture support or repeatedly probe when refresh is %s", async scenario => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { built } = await explicitNoneModel();
    await built.doGenerate(params);
    now += 40_000;
    refreshProbe = next => {
      if (scenario === "unavailable") throw new Error("Metadata offline");
      next.models[0].evidence = next.models[0].evidence.filter(e => e.metric !== "probe.thinking");
      return next;
    };
    for (let attempt = 0; attempt < 2; attempt++)
      await expect(built.doGenerate(params)).rejects.toThrow(/could not be revalidated/);
    expect(sent).toHaveLength(1);
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "self_hosted_probe")).toHaveLength(1);
  });

  it("bounds a stalled post-queue metadata refresh without sending or replaying after late completion", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const { built } = await explicitNoneModel();
    let release: (value: ProbeSnapshot) => void = () => {};
    beforeAdmission = () => {
      vi.setSystemTime(now + 40_000);
      refreshProbe = () => new Promise(resolve => { release = resolve; });
    };
    const pending = expect(built.doGenerate(params)).rejects.toThrow(/could not be revalidated/);
    await vi.advanceTimersByTimeAsync(3001);
    await pending;
    expect(sent).toHaveLength(0);
    release(metadata(32768, 32768));
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(0);
    expect(invoke).toHaveBeenCalledWith("ai_http_preflight", expect.objectContaining({ approved: false }));
  });

  it("D2 revalidates after a slow length segment and retains one leading system message and think:false", async () => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { built } = await explicitNoneModel();
    beforeResponse = () => { now += 40_000; };
    reply = index => ({
      message: { role: "assistant", content: index === 1 ? "A meaningful first answer segment with useful progress. " : "Its continuation." },
      done_reason: index === 1 ? "length" : "stop",
    });
    const errors: unknown[] = [];
    const result = streamText({
      model: withAnswerContinuation(built, {
        runId: "same-run", provider: "ollama", modelId: "exact:latest", isCurrent: () => true,
        limits: () => modelBudgetLimits(built),
      }),
      system: "Retain all constraints.", prompt: "Answer fully.", maxOutputTokens: 2048, maxRetries: 0,
      onError: ({ error }) => { errors.push(error); },
    });
    expect(await result.text).toContain("Its continuation.");
    expect(errors).toHaveLength(0);
    expect(sent).toHaveLength(2);
    for (const request of sent) {
      expect(request.body.think).toBe(false);
      expect((request.body.messages as { role: string }[]).filter(m => m.role === "system")).toHaveLength(1);
    }
  });
});
