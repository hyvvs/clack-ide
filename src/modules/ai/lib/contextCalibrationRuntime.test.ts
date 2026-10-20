import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { invoke } from "@tauri-apps/api/core";
import {
  calibrateModelContext,
  ensureSelectedContext,
} from "@/modules/ai/lib/contextCalibrationRuntime";
import { useContextCalibrationJobs } from "@/modules/ai/store/contextCalibrationJobs";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { hostedEffortFixture } from "@/modules/ai/lib/reasoningEffort.fixture";
import {
  profileEvidence,
  readSelfHostedState,
  type SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import { selfHostedSelectionId } from "@/modules/ai/lib/selfHostedModels";
import { profileSnapshot } from "@/modules/ai/lib/modelOnboarding";
import {
  trustedContext,
  forgetContextRuntime,
} from "@/modules/ai/lib/contextCalibrationTrust";

const h = vi.hoisted(() => ({
  state: undefined as SelfHostedState | undefined,
  loaded: 0,
  calls: [] as number[],
  busy: false,
}));
function state() {
  if (!h.state) throw new Error("fixture missing");
  return h.state;
}
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
    refresh: async () => {
      const s = state(),
        p = s.profiles[0];
      p.evidence = Object.entries({
        runtimeContext: "per-request",
        advertisedContext: 1_048_576,
        loaded: h.loaded > 0,
        thinking: true,
        thinkingControls: "[false,true]",
        thinkingDefault: true,
        ...(h.loaded
          ? {
              loadedContext: h.loaded,
              runtimeAllocation: JSON.stringify([p.modelRevision, h.loaded]),
            }
          : {}),
      }).map(([metric, value]) =>
        profileEvidence(
          s,
          p.id,
          `probe.${metric}`,
          value,
          "backend-reported",
          Date.now(),
          "reported",
        ),
      );
      s.inventories = [
        {
          endpointId: p.endpointId,
          configurationRevision: 1,
          connected: true,
          observedAt: Date.now(),
          backend: "ollama",
          models: [
            {
              id: p.transportModelId,
              name: null,
              chat: "supported",
              digest: p.modelRevision,
            },
          ],
        },
      ];
      return profileSnapshot(s, p);
    },
  }),
}));
vi.mock("@/modules/ai/lib/agent", () => ({
  buildLanguageModel: async (
    _provider: unknown,
    _keys: unknown,
    _model: unknown,
    options: { calibrationContext: number },
  ) =>
    new MockLanguageModelV3({
      doStream: async () => {
        h.loaded = options.calibrationContext;
        h.calls.push(h.loaded);
        return {
          stream: new ReadableStream({
            start(c) {
              c.enqueue({ type: "text-start", id: "one" });
              c.enqueue({ type: "text-delta", id: "one", delta: "OK" });
              c.enqueue({ type: "text-end", id: "one" });
              c.enqueue({
                type: "finish",
                finishReason: { unified: "stop", raw: "stop" },
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
  f.profile.modelRevision = "runtime-digest";
  f.profile.evidence = [];
  h.state = f.state;
  h.loaded = 0;
  h.calls = [];
  h.busy = false;
  h.state.inventories = [
    {
      endpointId: f.endpoint.id,
      configurationRevision: 1,
      observedAt: Date.now(),
      connected: true,
      backend: "ollama",
      models: [
        {
          id: f.profile.transportModelId,
          name: null,
          chat: "supported",
          digest: f.profile.modelRevision,
        },
      ],
    },
  ];
  usePreferencesStore.setState({ selfHostedInference: h.state });
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "self_hosted_profiles_snapshot")
      return [["selfHostedInference", JSON.parse(JSON.stringify(state()))]];
    if (command === "self_hosted_context_runtime")
      return {
        epoch: "native-process",
        version: "1.2.3",
        configurationRevision: 1,
        at: Date.now(),
      };
    if (command === "self_hosted_context_lease") {
      if (h.busy && !(args && "release" in args && args.release)) throw new Error("Already verifying");
      return "native-process";
    }
    throw new Error(`Unexpected IPC ${command}`);
  });
});
afterEach(() => {
  usePreferencesStore.setState(preferences);
  forgetContextRuntime("server");
  vi.clearAllMocks();
});
describe("production context calibration orchestration", () => {
  it("first selected-model use calibrates once, publishes profiles and releases its lease/job", async () => {
    const s = state(),
      id = selfHostedSelectionId(s.profiles[0]);
    const prepared = await ensureSelectedContext(
      s,
      id,
      new AbortController().signal,
      undefined,
      16384,
    );
    expect(h.calls).toEqual([4096, 8192, 16384]);
    expect(trustedContext(prepared, prepared.profiles[0])).toBe(16384);
    expect(
      usePreferencesStore.getState().selfHostedInference.profiles[0]
        .contextCalibration?.highest,
    ).toBe(16384);
    expect(useContextCalibrationJobs.getState().jobs).toEqual({});
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(
          ([c, a]) => c === "self_hosted_context_lease" && a && "release" in a && a.release === true,
        ),
    ).toBe(true);
    const leases = vi.mocked(invoke).mock.calls.filter(([c]) => c === "self_hosted_context_lease").length;
    await ensureSelectedContext(
      state(),
      id,
      new AbortController().signal,
      undefined,
      16384,
    );
    expect(h.calls).toHaveLength(3);
    expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === "self_hosted_context_lease")).toHaveLength(leases);
  });
  it("a competing native lease yields conservative policy without cloud inference or model requests", async () => {
    h.busy = true;
    const s = state();
    const prepared = await ensureSelectedContext(
      s,
      selfHostedSelectionId(s.profiles[0]),
      new AbortController().signal,
    );
    expect(h.calls).toEqual([]);
    expect(prepared.profiles[0].contextCalibration).toBeUndefined();
    expect(useContextCalibrationJobs.getState().jobs).toEqual({});
  });
  it("unsupported provider selection performs no native calibration or inference", async () => {
    const s = state();
    s.endpoints[0].backendHint = "openai-compatible";
    expect(
      await ensureSelectedContext(
        s,
        selfHostedSelectionId(s.profiles[0]),
        new AbortController().signal,
      ),
    ).toBe(s);
    expect(invoke).not.toHaveBeenCalled();
    expect(h.calls).toEqual([]);
  });
  it("pre-cancelled verification cannot produce a model request and releases its native owner", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      calibrateModelContext({
        state: state(),
        profileId: state().profiles[0].id,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(h.calls).toEqual([]);
    expect(useContextCalibrationJobs.getState().jobs).toEqual({});
  });
});
