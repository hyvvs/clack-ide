import { afterEach, expect, it, vi } from "vitest";
import { ollamaEffortFixture } from "@/modules/ai/lib/reasoningEffort.fixture";
import {
  profileEvidence,
  readSelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  rememberContextRuntime,
  forgetContextRuntime,
} from "@/modules/ai/lib/contextCalibrationTrust";
import {
  agentToolCandidates,
  automaticAgentBatchContext,
  automaticAgentRecommendation,
  applyAgentRecommendation,
  requireAgentContinuationAllocation,
  resolveAutomaticAgentTools,
  toolEffortCapture,
} from "@/modules/ai/lib/agentConfiguration";
import {
  runToolVerification,
  toolVerificationState,
  toolEligibilityPredicates,
  type ProbeObservation,
} from "@/modules/ai/lib/toolVerification";
import { effortProviderOptions, captureEffort } from "@/modules/ai/lib/reasoningEffort";
import { modelOnboarding } from "@/modules/ai/lib/modelOnboarding";
import { createHash } from "node:crypto";
import live from "@/test/fixtures/automatic-agent-configuration-20261021.json";

const observation = (kind = "pass"): ProbeObservation => ({
  calls:
    kind === "pass"
      ? [
          {
            name: "get_probe_value",
            input: { key: "clack-probe-v1", count: 1 },
          },
        ]
      : [],
  text:
    kind === "text" ? '<function=get_probe_value>{"count":1}</function>' : "",
  finish: kind === "length" ? "length" : "stop",
  firstBodyAt: Date.now(),
  callAt: kind === "pass" ? Date.now() : null,
});
function fixture(
  values: (boolean | string)[] = [false, true, "low", "medium", "high"],
  defaultValue: boolean | string = false,
) {
  const f = ollamaEffortFixture(values, "generic-native-agent");
  f.profile.modelRevision = "digest";
  f.profile.evidence = Object.entries({
    thinking: true,
    thinkingControls: JSON.stringify(values),
    thinkingDefault: defaultValue,
    trainedForTools: true,
    runtimeContext: "per-request",
    advertisedContext: 262144,
  }).map(([k, v]) =>
    profileEvidence(
      f.state,
      f.profile.id,
      `probe.${k}`,
      v,
      "backend-reported",
      Date.now(),
      "reported",
    ),
  );
  f.state.inventories = [
    {
      endpointId: f.endpoint.id,
      configurationRevision: 1,
      connected: true,
      observedAt: Date.now(),
      backend: "ollama",
      models: [
        {
          id: f.profile.transportModelId,
          name: null,
          chat: "supported",
          digest: "digest",
        },
      ],
    },
  ];
  let state = f.state,
    version = "1.2.3",
    context = 4096;
  const requests: (boolean | string | undefined)[] = [],
    results = ["text", "pass", "pass"];
  const outputs: (number | undefined)[] = [];
  const get = () => state.profiles[0];
  const evidence = (metric: string) => {
    const entry = get().evidence.find((e) => e.metric === `probe.${metric}`);
    if (!entry) throw new Error("missing evidence");
    return entry;
  };
  const deps = {
    refresh: async () => state,
    inspect: async () => {
      rememberContextRuntime(f.endpoint.id, {
        epoch: "native",
        version,
        configurationRevision: 1,
        at: Date.now(),
      });
    },
    context: () => context,
    commit: async (change: (s: typeof state) => typeof state) => {
      state = readSelfHostedState(JSON.parse(JSON.stringify(change(state))));
      return state;
    },
    request: vi.fn(async (_state, _signal, configuration, output) => {
      requests.push(configuration?.wire);
      outputs.push(output);
      const kind = results.shift() ?? "pass";
      if (kind === "timeout" || kind === "offline")
        throw new Error(
          kind === "timeout" ? "first-output timeout" : "network offline",
        );
      return observation(kind);
    }) as import("@/modules/ai/lib/toolVerification").ToolProbeDependencies["request"],
  };
  const controller = new AbortController();
  const verify = (
    configuration?: import("@/modules/ai/lib/toolVerificationSchema").ToolConfiguration,
    force?: boolean,
    requestBudget?: import("@/modules/ai/lib/toolVerificationSchema").ToolRequestBudget,
  ) =>
    runToolVerification(
      { profileId: get().id, signal: controller.signal, configuration, force, requestBudget },
      deps,
    );
  const resolve = (force = false) =>
    resolveAutomaticAgentTools(
      { profileId: get().id, signal: controller.signal, force },
      { ...deps, verify },
    );
  return {
    get,
    evidence,
    state: () => state,
    requests,
    outputs,
    results,
    deps,
    resolve,
    verify,
    controller,
    restart: () => {
      state = readSelfHostedState(JSON.parse(JSON.stringify(state)));
    },
    version: (v: string) => {
      version = v;
    },
    context: (v: number) => {
      context = v;
    },
    recommendation: () => automaticAgentRecommendation(state, get(), context),
  };
}
afterEach(() => {
  forgetContextRuntime("server");
  vi.restoreAllMocks();
});

it("prefers a working provider default without probing alternatives", async () => {
  const f = fixture();
  f.results.splice(0, 3, "pass");
  await f.resolve();
  await f.resolve();
  expect(f.requests).toEqual([undefined]);
  expect(f.recommendation()?.choice).toBe("automatic");
  expect(
    effortProviderOptions(applyAgentRecommendation(f.state(), f.get(), 4096)),
  ).toEqual({});
});
it("resolves output uncertainty before considering any alternate reasoning configuration", async () => {
  const f = fixture(); f.results.splice(0, 3, "length", "pass");
  await f.resolve();
  expect(f.requests).toEqual([undefined, undefined]);
  expect(f.outputs).toEqual([512, 1024]);
  expect(f.recommendation()?.choice).toBe("automatic");
});
it("length at every output allowance stays Incomplete without reasoning search", async () => {
  const f = fixture(); f.results.splice(0, 3, "length", "length", "length");
  await f.resolve();
  expect(f.requests).toEqual([undefined, undefined, undefined]);
  expect(f.outputs).toEqual([512, 1024, 2048]);
  expect(f.recommendation()).toBeUndefined();
});
it("escalation and alternate confirmation share the five-request cap", async () => {
  const f = fixture(); f.results.splice(0, 3, "length", "text", "length", "pass", "pass");
  await f.resolve();
  expect(f.requests).toEqual([undefined, undefined, false, false, false]);
  expect(f.outputs).toEqual([512, 1024, 512, 1024, 1024]);
  expect(f.recommendation()?.configuration).toEqual({ choice: "none", wire: false });
});
it("three configuration candidates cannot multiply the global physical request bound", async () => {
  const f = fixture(); f.results.splice(0, 3, "length", "text", "length", "text", "length", "pass");
  await f.resolve();
  expect(f.requests).toHaveLength(5);
  expect(f.outputs).toEqual([512, 1024, 512, 1024, 512]);
  expect(f.get().agentToolConfigurations?.some(r => r.outcome === "request-limit")).toBe(true);
  expect(f.recommendation()).toBeUndefined();
});
it("recovers the nearest wire-distinct None, confirms it and persists without erasing provider-default failure", async () => {
  const f = fixture();
  await f.resolve();
  expect(f.requests).toEqual([undefined, false, false]);
  expect(f.get().toolVerification).toMatchObject({
    outcome: "text-only",
    status: "needs-attention",
  });
  expect(toolVerificationState(f.state(), f.get())).toBe("Needs attention");
  expect(f.recommendation()?.configuration).toEqual({
    choice: "none",
    wire: false,
  });
  expect(f.get().agentToolConfigurations?.[0].confirmation?.id).not.toBe(
    f.get().agentToolConfigurations?.[0].id,
  );
  const before = JSON.stringify(f.state());
  f.restart();
  await f.resolve();
  expect(f.requests).toHaveLength(3);
  expect(JSON.stringify(f.state())).toBe(before);
  expect(modelOnboarding(f.state(), f.get())).toMatchObject({
    status: "Ready",
    tools: "Verified",
    providerDefaultTools: "Needs attention",
    reasoning: { providerDefault: false, recommended: "None", wire: "omit" },
    context: { provenance: "conservative-policy" },
  });
  const resolved = applyAgentRecommendation(f.state(), f.get(), 4096);
  expect(effortProviderOptions(resolved)).toEqual({ ollama: { think: false } });
  expect(resolved.automaticAgentRecommendation).toBe(
    f.recommendation()?.record.id,
  );
});
it("reuses current negative provider-default evidence without another default request, even on Verify", async () => {
  const f = fixture();
  await f.verify();
  await f.resolve(true);
  expect(f.requests).toEqual([undefined, false, false]);
});
it("one alternative PASS alone is not a durable recommendation", async () => {
  const f = fixture();
  await f.verify();
  await f.verify({ choice: "none", wire: false });
  expect(f.recommendation()).toBeUndefined();
  expect(() => applyAgentRecommendation(f.state(), f.get(), 4096)).toThrow(
    /not verified/,
  );
  await f.resolve();
  expect(f.requests).toEqual([undefined, false, false]);
  expect(f.recommendation()).toBeDefined();
});
it.each([
  false,
  true,
  "medium",
])("tries explicit advertised default %s before lower-cost alternatives", async (value) => {
  const f = fixture([false, true, "low", "medium", "high"], value);
  await f.deps.inspect();
  expect(agentToolCandidates(f.state(), f.get())[0].wire).toBe(value);
  await f.resolve();
  expect(f.requests).toEqual([undefined, value, value]);
});
it("orders the lowest supported costs, ignores unknown future values and caps at three configurations", async () => {
  const f = fixture(["high", "future", "low", "medium", false], "future");
  expect(agentToolCandidates(f.state(), f.get())).toEqual([
    { choice: "none", wire: false },
    { choice: "low", wire: "low" },
  ]);
  f.results.splice(0, 3, "text", "text", "text");
  await f.resolve();
  await f.resolve();
  expect(f.requests).toEqual([undefined, false, "low"]);
  expect(f.recommendation()).toBeUndefined();
  expect(modelOnboarding(f.state(), f.get())?.status).toBe("Needs attention");
});
it("a failed confirmation tries at most one more candidate and never reuses the failed candidate's proof", async () => {
  const f = fixture();
  f.results.splice(0, 3, "text", "pass", "text", "pass", "pass");
  await f.resolve();
  expect(f.requests).toEqual([undefined, false, false, "low", "low"]);
  expect(f.recommendation()?.configuration?.wire).toBe("low");
  expect(
    f
      .get()
      .agentToolConfigurations?.find((r) => r.configuration?.wire === false)
      ?.proof,
  ).not.toBeNull();
});
it.each([
  "timeout",
  "offline",
  "empty",
])("does not search after provider-default %s", async (kind) => {
  const f = fixture();
  f.results.splice(0, 3, kind);
  await f.resolve();
  await f.resolve();
  expect(f.requests).toEqual([undefined]);
  expect(f.recommendation()).toBeUndefined();
});
it("stops and backs off after a transient confirmation failure instead of tuning another control", async () => {
  const f = fixture();
  f.results.splice(0, 3, "text", "pass", "timeout");
  await f.resolve();
  await f.resolve();
  expect(f.requests).toEqual([undefined, false, false]);
  expect(f.recommendation()).toBeUndefined();
});
it.each([
  "offline",
  "unsupported",
  "no-controls",
  "cancelled",
])("does not search when %s", async (kind) => {
  const f = fixture();
  if (kind === "offline") {
    const inventory = f.state().inventories?.[0];
    if (!inventory) throw new Error("missing inventory");
    inventory.connected = false;
  }
  if (kind === "unsupported") f.evidence("trainedForTools").value = false;
  if (kind === "no-controls")
    f.evidence("thinkingControls").value = '["future"]';
  if (kind === "cancelled") f.controller.abort();
  if (kind === "cancelled") await expect(f.resolve()).rejects.toThrow();
  else await f.resolve();
  expect(f.requests.length).toBe(kind === "no-controls" ? 1 : 0);
});
it.each([
  "digest",
  "version",
  "reasoning",
  "context",
  "expiry",
  "server",
])("invalidates the recommendation on %s without rewriting unrelated evidence", async (kind) => {
  const f = fixture();
  await f.resolve();
  const previous = JSON.stringify(f.get().agentToolConfigurations);
  if (kind === "digest") f.get().modelRevision = "new";
  if (kind === "version") {
    f.version("new");
    await f.deps.inspect();
  }
  if (kind === "reasoning") f.evidence("thinkingDefault").value = true;
  if (kind === "context") f.context(8192);
  if (kind === "server") f.state().endpoints[0].configurationRevision++;
  if (kind === "expiry") {
    const time = Date.now() + 86400_001;
    vi.spyOn(Date, "now").mockReturnValue(time);
    f.get().evidence.forEach((e) => {
      e.observedAt = time;
    });
    await f.deps.inspect();
  }
  expect(f.recommendation()).toBeUndefined();
  expect(JSON.stringify(f.get().agentToolConfigurations)).toBe(previous);
});
it.each([
  "none",
  "high",
])("never changes an explicit user %s override", async (choice) => {
  const f = fixture();
  await f.resolve();
  const explicit = toolEffortCapture(f.state(), f.get(), {
    choice,
    wire: choice === "none" ? false : choice,
  });
  expect(applyAgentRecommendation(f.state(), f.get(), 4096, explicit)).toBe(
    explicit,
  );
  expect(effortProviderOptions(explicit)).toEqual({
    ollama: { think: choice === "none" ? false : choice },
  });
});
it("rejects an explicit wire that the normalized supported control does not represent", () => {
  const f = fixture();
  expect(() =>
    toolEffortCapture(f.state(), f.get(), { choice: "none", wire: "none" }),
  ).toThrow(/configuration changed/);
});
it("isolates malformed candidate records while retaining the original default, context and overrides", async () => {
  const f = fixture();
  await f.resolve();
  const raw = JSON.parse(JSON.stringify(f.state()));
  raw.profiles[0].agentToolConfigurations[0].configuration.wire = {};
  const restored = readSelfHostedState(raw);
  expect(restored.profiles[0].agentToolConfigurations).toBeUndefined();
  expect(restored.profiles[0].toolVerification).toEqual(
    f.get().toolVerification,
  );
  expect(restored.profiles[0].overrides).toEqual(f.get().overrides);
});
it("the same model tag on another server cannot inherit a recommendation", async () => {
  const f = fixture();
  await f.resolve();
  expect(
    automaticAgentRecommendation(
      f.state(),
      { ...f.get(), endpointId: "another-server" },
      4096,
    ),
  ).toBeUndefined();
});
it("an unsupported future tool protocol is not trusted as a recommendation", async () => {
  const f = fixture();
  await f.resolve();
  const raw = JSON.parse(JSON.stringify(f.state()));
  raw.profiles[0].agentToolConfigurations[0].scope.protocol = "future";
  const restored = readSelfHostedState(raw);
  expect(
    automaticAgentRecommendation(restored, restored.profiles[0], 4096),
  ).toBeUndefined();
});
it("cancelled preparation stops before considering another candidate", async () => {
  const f = fixture();
  f.deps.request = async () => {
    f.controller.abort();
    return observation("text");
  };
  await expect(f.resolve()).rejects.toThrow();
  expect(f.get().agentToolConfigurations).toBeUndefined();
});
it("preserves native production acceptance controls, confirmation, unchanged default and zero execution", () => {
  expect(live.ok).toBe(true);
  expect(live.cloudInference).toBe(0);
  expect(live.toolExecutions).toBe(0);
  const [defaultRequest, alternative, confirmation, secondModel] =
    live.responses;
  expect(defaultRequest.request.body).not.toHaveProperty("think");
  expect(alternative.request.body).toEqual({
    ...defaultRequest.request.body,
    think: false,
  });
  expect(confirmation.request.body).toEqual(alternative.request.body);
  expect(secondModel.request.body).not.toHaveProperty("think");
  expect(live.responses.map((r) => r.calls.length)).toEqual([0, 1, 1, 1]);
  for (const response of live.responses) {
    expect(
      createHash("sha256").update(response.rawResponse).digest("hex"),
    ).toBe(response.sha256);
    expect(response.final.done_reason).toBe("stop");
  }
  expect(live.models.map((m) => m.after.status)).toEqual(["Ready", "Ready"]);
  expect(live.models.every((m) => m.cachedNoInference)).toBe(true);
  expect(live.models[0].after.providerDefaultTools).toBe("Needs attention");
  expect(live.models[0].effective).toEqual({ ollama: { think: false } });
  expect(live.models[1].effective).toEqual({});
});
it("metadata expiring during candidate projection withdraws candidates instead of throwing from settings", () => {
  const f = fixture(), now = Date.now();
  let reads = 0;
  vi.spyOn(Date, "now").mockImplementation(() => ++reads < 3 ? now : now + 30_000);
  expect(agentToolCandidates(f.state(),f.get())).toEqual([]);
});
it("a saved explicit choice with stale metadata is not consent to Automatic recovery", () => {
  const f = fixture(), p = f.get(), endpoint = f.state().endpoints[0];
  const identity = {providerId:"ollama" as const,transportModelId:p.transportModelId,selfHosted:{endpointId:endpoint.id,
    profileId:p.id,configurationRevision:endpoint.configurationRevision,allowPrivateNetwork:false,credentialRequired:false,credentialRef:endpoint.credentialRef}};
  const original = captureEffort(p.id,identity,undefined,f.state());
  const preferences = {version:1 as const,choices:[{key:original.key,choice:"none",revision:original.capability.revision}]};
  p.evidence.forEach(e=>{e.observedAt=Date.now()-30_001;});
  const stale = captureEffort(p.id,identity,preferences,f.state());
  expect(stale.unresolvedExplicitChoice).toBe("none");
  expect(()=>applyAgentRecommendation(f.state(),p,4096,stale)).toThrow(/cannot replace/);
  expect(f.requests).toEqual([]); expect(preferences.choices[0].choice).toBe("none");
});

it("R5m: a same-run pre-verification capture cannot inherit newly verified proof until the prepared state is retained", async () => {
  const f = fixture();
  const captured = readSelfHostedState(JSON.parse(JSON.stringify(f.state())));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  f.results.splice(0, 3, "pass");
  await f.resolve(); // deterministic native-call fixture; no Ollama or tool execution
  expect(automaticAgentRecommendation(captured, captured.profiles[0], 4096)).toBeUndefined();
  expect(() => applyAgentRecommendation(captured, captured.profiles[0], 4096)).toThrow(/not verified/);
  const diagnostic = warn.mock.calls[warn.mock.calls.length - 1]?.[1] as { default: ReturnType<typeof toolEligibilityPredicates> };
  expect(diagnostic.default.recordPresent).toBe(false);
  expect(diagnostic.default.verdict).not.toBe("Verified");
  expect(JSON.stringify(diagnostic)).not.toContain(f.get().transportModelId);
  expect(applyAgentRecommendation(f.state(), f.get(), 4096).choice).toBe("automatic");
  expect(f.requests).toEqual([undefined]);
  f.restart(); // proof survives deserialization with unchanged, still-fresh runtime evidence
  expect(applyAgentRecommendation(f.state(), f.get(), 4096).choice).toBe("automatic");
});

it("R5m: the production continuation guard distinguishes every required stale proof operand", async () => {
  const f = fixture();
  f.results.splice(0, 3, "pass");
  await f.resolve();
  const state = f.state(), profile = f.get();
  const restored = readSelfHostedState(JSON.parse(JSON.stringify(state)));
  expect(applyAgentRecommendation(restored, restored.profiles[0], 4096)).toBeDefined();
  const check = (p: typeof profile, s = state, expected = 4096) => {
    expect(automaticAgentRecommendation(s, p, expected)).toBeUndefined();
    expect(() => applyAgentRecommendation(s, p, expected)).toThrow(/not verified/);
  };
  check({ ...profile, toolVerification: undefined });
  check({ ...profile, modelRevision: "wrong-digest" });
  check({ ...profile, endpointId: "another-endpoint" });
  check({ ...profile, evidence: profile.evidence.map(e => e.metric === "probe.thinkingDefault" ? { ...e, value: true } : e) });
  const proof = profile.toolVerification;
  if (!proof) throw new Error("Expected fixture proof");
  check({ ...profile, toolVerification: { ...proof, scope: { ...proof.scope, protocol: "future-tool-schema" as "native-tools-v1" } } });
  check({ ...profile, evidence: profile.evidence.map(e => e.metric === "probe.trainedForTools" ? { ...e, value: false } : e) });
  check(profile, state, 8192);
  check(profile, { ...state, endpoints: [{ ...state.endpoints[0], configurationRevision: 2 }] });
  const at = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(at + 30_001);
  expect(toolEligibilityPredicates(state, profile).runtimeFresh).toBe(false);
  check(profile);
  vi.mocked(Date.now).mockReturnValue(at + 86400_001);
  expect(toolEligibilityPredicates(state, profile).proofFresh).toBe(false);
  check(profile);
  vi.mocked(Date.now).mockReturnValue(at);
  forgetContextRuntime(state.endpoints[0].id); // process reload without native runtime observation
  expect(toolEligibilityPredicates(state, profile).runtimeObserved).toBe(false);
  check(profile);
  rememberContextRuntime(state.endpoints[0].id, { epoch: "different-epoch", version: "1.2.3", configurationRevision: 1, at });
  expect(toolEligibilityPredicates(state, profile).runtimeEpochMatches).toBe(false);
  check(profile);
  await f.deps.inspect(); // real runtime inspection in production, fixture-only in this test
  expect(applyAgentRecommendation(state, profile, 4096)).toBeDefined();
});

it("R5w: logical continuation retains exact native tool proof context instead of an aged fallback recommendation", async () => {
  const f = fixture();
  f.results.splice(0, 3, "pass");
  await f.resolve();
  const original = f.get();
  if (!original.toolVerification) throw new Error("Fixture must verify native tools");
  // The R5v 65,536/4,096 mismatch is reproduced independently against the
  // original production eligibility function, without model requests.
  const profile = { ...original, toolVerification: { ...original.toolVerification, context: 65536 } };
  const state = { ...f.state(), profiles: [profile] };
  expect(automaticAgentRecommendation(state, profile, 4096)).toBeUndefined();
  const batch = automaticAgentBatchContext(profile, { recommended: 4096 }, true);
  expect(batch).toEqual({ expected: 65536, pinned: 65536 });
  expect(applyAgentRecommendation(state, profile, batch.expected)).toBeDefined();
  expect(() => requireAgentContinuationAllocation(batch.pinned, 4096)).toThrow(/working context changed/);
  expect(() => requireAgentContinuationAllocation(batch.pinned, undefined)).toThrow(/working context changed/);
  expect(() => requireAgentContinuationAllocation(batch.pinned, 65536)).not.toThrow();
  expect(automaticAgentBatchContext(profile, { recommended: 4096 }, false)).toEqual({ expected: 4096, pinned: undefined });
  expect(automaticAgentBatchContext(profile, { recommended: 4096, override: 8192 }, true)).toEqual({ expected: 8192, pinned: undefined });
  expect(automaticAgentBatchContext({ ...profile, toolVerification: { ...profile.toolVerification, status: "incomplete" } }, { recommended: 4096 }, true)).toEqual({ expected: 4096, pinned: undefined });
  expect(() => applyAgentRecommendation(state, { ...profile, modelRevision: "wrong-digest" }, batch.expected)).toThrow(/not verified/);
});
