import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { MockLanguageModelV3 } from "ai/test";
import {
  verifyModelTools,
  ensureSelectedTools,
  canonicalProbeTools,
} from "@/modules/ai/lib/toolVerificationRuntime";
import { hostedEffortFixture } from "@/modules/ai/lib/reasoningEffort.fixture";
import {
  profileEvidence,
  readSelfHostedState,
  type SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import { profileSnapshot } from "@/modules/ai/lib/modelOnboarding";
import { selfHostedSelectionId } from "@/modules/ai/lib/selfHostedModels";
import { forgetContextRuntime } from "@/modules/ai/lib/contextCalibrationTrust";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useToolVerificationJobs } from "@/modules/ai/store/toolVerificationJobs";
const h = vi.hoisted(() => ({
  state: undefined as SelfHostedState | undefined,
  modelCalls: 0,
  stall: false,
  calls: [] as {
    type: "tool-call";
    toolCallId: string;
    toolName: string;
    input: string;
  }[],
  text: "",
  busy: false,
  finishes: [] as ("stop" | "length")[],
  requests: [] as { output: number | undefined; prompt: unknown; tools: unknown; providerOptions: unknown }[],
}));
const state = () => {
  if (!h.state) throw new Error("fixture");
  return h.state;
};
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));
vi.mock("@/modules/settings/store", async (original) => ({
  ...(await original<typeof import("@/modules/settings/store")>()),
  updateSelfHostedProfiles: async (
    change: (s: SelfHostedState) => SelfHostedState,
  ) => {
    h.state = readSelfHostedState(JSON.parse(JSON.stringify(change(state()))));
    h.state.revision++;
    return h.state;
  },
}));
vi.mock("@/modules/ai/lib/selfHostedProbe", async (original) => ({
  ...(await original<typeof import("@/modules/ai/lib/selfHostedProbe")>()),
  createSelfHostedProbeClient: () => ({
    refresh: async () => profileSnapshot(state(), state().profiles[0]),
  }),
}));
vi.mock("@/modules/ai/lib/agent", () => ({
  buildLanguageModel: async () =>
    new MockLanguageModelV3({
      doStream: async (options) => {
        h.modelCalls++;
        expect(options.tools).toHaveLength(1);
        expect([512, 1024, 2048]).toContain(options.maxOutputTokens);
        h.requests.push({ output: options.maxOutputTokens, prompt: options.prompt, tools: options.tools, providerOptions: options.providerOptions });
        const finish = h.finishes.shift() ?? "stop";
        return {
          stream: new ReadableStream({
            start(c) {
              if (h.stall) return;
              if (finish !== "length") for (const call of h.calls) c.enqueue(call);
              if (h.text) {
                c.enqueue({ type: "text-start", id: "text" });
                c.enqueue({ type: "text-delta", id: "text", delta: h.text });
                c.enqueue({ type: "text-end", id: "text" });
              }
              c.enqueue({
                type: "finish",
                finishReason: { unified: finish, raw: finish },
                usage: {
                  inputTokens: {
                    total: 1,
                    noCache: 1,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  outputTokens: { total: 1, text: 1, reasoning: 0 },
                },
              });
              c.close();
            },
          }),
        };
      },
    }),
}));
const preferences = usePreferencesStore.getState();
beforeEach(() => {
  const f = hostedEffortFixture();
  f.endpoint.backendHint = "ollama";
  f.profile.backend = "ollama";
  f.profile.modelRevision = "digest";
  f.profile.evidence = Object.entries({
    runtimeContext: "per-request",
    advertisedContext: 262144,
    thinking: true,
    thinkingControls: "[false,true]",
    thinkingDefault: true,
    trainedForTools: true,
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
  h.state = f.state;
  h.modelCalls = 0;
  h.stall = false;
  h.busy = false;
  h.text = "";
  h.finishes = [];
  h.requests = [];
  h.calls = [
    {
      type: "tool-call",
      toolCallId: "native",
      toolName: "get_probe_value",
      input: JSON.stringify({ key: "clack-probe-v1", count: 1 }),
    },
  ];
  usePreferencesStore.setState({ selfHostedInference: h.state });
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "self_hosted_profiles_snapshot")
      return [["selfHostedInference", state()]];
    if (command === "self_hosted_context_runtime")
      return {
        epoch: "native",
        version: "1.2.3",
        configurationRevision: 1,
        at: Date.now(),
      };
    if (command === "self_hosted_context_lease") {
      if (h.busy && !(args && "release" in args && args.release))
        throw new Error("busy");
      return "native";
    }
    throw new Error(`Unexpected IPC ${command}`);
  });
});
afterEach(() => {
  usePreferencesStore.setState(preferences);
  forgetContextRuntime("server");
  vi.clearAllMocks();
});
it("first tool-capable use verifies once and publishes proof, with no executable probe handler", async () => {
  const current = state(),
    id = selfHostedSelectionId(current.profiles[0]);
  await ensureSelectedTools(current, id, new AbortController().signal);
  expect(state().profiles[0].toolVerification?.status).toBe("verified");
  expect(h.modelCalls).toBe(1);
  expect(useToolVerificationJobs.getState().jobs).toEqual({});
  expect(Object.keys(canonicalProbeTools())).toEqual(["get_probe_value"]);
  expect(canonicalProbeTools().get_probe_value.execute).toBeUndefined();
  await ensureSelectedTools(state(), id, new AbortController().signal);
  expect(h.modelCalls).toBe(1);
});
it("SDK escalation changes only output while preserving native prompt, schema and provider reasoning", async () => {
  h.finishes = ["length", "stop"];
  await ensureSelectedTools(state(), selfHostedSelectionId(state().profiles[0]), new AbortController().signal);
  expect(h.requests.map(r => r.output)).toEqual([512, 1024]);
  expect(h.requests[1]).toEqual({ ...h.requests[0], output: 1024 });
  expect(state().profiles[0].toolVerification).toMatchObject({ status: "verified", output: 1024 });
  expect(canonicalProbeTools().get_probe_value.execute).toBeUndefined();
});
it("SDK length exhaustion reaches 2048 but never tunes reasoning or claims Ready", async () => {
  h.finishes = ["length", "length", "length"];
  await expect(ensureSelectedTools(state(), selfHostedSelectionId(state().profiles[0]), new AbortController().signal)).rejects.toThrow(/Incomplete/);
  expect(h.requests.map(r => r.output)).toEqual([512, 1024, 2048]);
  expect(h.requests[2]).toEqual({ ...h.requests[0], output: 2048 });
  expect(state().profiles[0].toolVerification).toMatchObject({ status: "incomplete", outcome: "output-length", output: 2048 });
});
it("text-only Agent calls are blocked with Chat Only guidance without claiming incompatibility", async () => {
  h.calls = [];
  h.text = '<tool_call>{"name":"get_probe_value"}</tool_call>';
  await expect(
    ensureSelectedTools(
      state(),
      selfHostedSelectionId(state().profiles[0]),
      new AbortController().signal,
    ),
  ).rejects.toThrow(/Chat Only/);
  expect(state().profiles[0].toolVerification?.outcome).toBe("text-only");
  expect(state().profiles[0].toolVerification?.status).toBe("needs-attention");
  expect(h.modelCalls).toBe(3);
  await expect(ensureSelectedTools(state(), selfHostedSelectionId(state().profiles[0]), new AbortController().signal)).rejects.toThrow(/Needs attention/);
  expect(h.modelCalls).toBe(3);
});
it("a later successful recheck does not silently restore Agent access after conflicting evidence", async () => {
  const controls = state().profiles[0].evidence.find(e => e.metric === "probe.thinkingControls");
  if (!controls) throw new Error("missing controls");
  controls.value = "[]";
  const id = selfHostedSelectionId(state().profiles[0]);
  await ensureSelectedTools(state(), id, new AbortController().signal);
  const proof = structuredClone(state().profiles[0].toolVerification?.proof);
  h.calls = []; h.text = "I will call a tool";
  await verifyModelTools({state: state(), profileId: state().profiles[0].id, signal: new AbortController().signal, force: true});
  expect(state().profiles[0].toolVerification?.proof).toEqual(proof);
  h.calls = [{type: "tool-call", toolCallId: "second-native", toolName: "get_probe_value", input: JSON.stringify({key: "clack-probe-v1", count: 1})}]; h.text = "";
  await verifyModelTools({state: state(), profileId: state().profiles[0].id, signal: new AbortController().signal, force: true});
  await expect(ensureSelectedTools(state(), id, new AbortController().signal)).rejects.toThrow(/Needs attention/);
  expect(h.modelCalls).toBe(3);
});
it("native competing verification lease performs no inference", async () => {
  h.busy = true;
  await expect(ensureSelectedTools(
    state(),
    selfHostedSelectionId(state().profiles[0]),
    new AbortController().signal,
  )).rejects.toThrow(/Chat Only/);
  expect(h.modelCalls).toBe(0);
  expect(useToolVerificationJobs.getState().jobs).toEqual({});
});
it("cancellation before dispatch produces no request", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    verifyModelTools({
      state: state(),
      profileId: state().profiles[0].id,
      signal: controller.signal,
    }),
  ).rejects.toThrow();
  expect(h.modelCalls).toBe(0);
});
it("in-flight cancellation settles without a proof or execution and releases ownership", async () => {
  h.stall = true; const controller = new AbortController();
  const pending = verifyModelTools({ state: state(), profileId: state().profiles[0].id, signal: controller.signal });
  await vi.waitFor(() => expect(h.modelCalls).toBe(1)); controller.abort(); await pending;
  expect(state().profiles[0].toolVerification).toMatchObject({ status: "incomplete", outcome: "cancelled", proof: null });
  expect(useToolVerificationJobs.getState().jobs).toEqual({});
});
