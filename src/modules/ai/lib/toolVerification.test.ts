import { afterEach, describe, expect, it, vi } from "vitest";
import { ollamaEffortFixture } from "@/modules/ai/lib/reasoningEffort.fixture";
import {
  profileEvidence,
  readSelfHostedState,
  setProfileRecommendation,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  rememberContextRuntime,
  forgetContextRuntime,
} from "@/modules/ai/lib/contextCalibrationTrust";
import {
  runToolVerification,
  classifyToolObservation,
  commitToolVerification,
  toolVerificationState,
  type ProbeObservation,
} from "@/modules/ai/lib/toolVerification";
import { modelOnboarding } from "@/modules/ai/lib/modelOnboarding";
import {
  selfHostedPickerStatus,
  selfHostedSelectionId,
} from "@/modules/ai/lib/selfHostedModels";
import {
  TOOL_PROBE_NAME,
  TOOL_VERIFICATION,
  toolVerificationSchema,
} from "@/modules/ai/lib/toolVerificationSchema";

const call = {
  name: TOOL_PROBE_NAME,
  input: { key: "clack-probe-v1", count: 1 },
};
const observed = (
  changes: Partial<ProbeObservation> = {},
): ProbeObservation => ({
  calls: [call],
  text: "",
  finish: "tool-calls",
  firstBodyAt: Date.now(),
  callAt: Date.now(),
  ...changes,
});
function fixture() {
  const f = ollamaEffortFixture([false, true, "medium"], "generic-tools");
  let state = f.state,
    version = "1.2.3";
  const controller = new AbortController();
  f.profile.modelRevision = "digest";
  const get = () => state.profiles[0];
  const add = (metric: string, value: string | number | boolean) => {
    get().evidence = [
      ...get().evidence.filter((e) => e.metric !== `probe.${metric}`),
      profileEvidence(
        state,
        get().id,
        `probe.${metric}`,
        value,
        "backend-reported",
        Date.now(),
        "reported",
      ),
    ];
  };
  for (const [metric, value] of Object.entries({
    trainedForTools: true,
    runtimeContext: "per-request",
    advertisedContext: 262144,
    thinking: true,
    thinkingControls: '[false,true,"medium"]',
    thinkingDefault: true,
  }))
    add(metric, value);
  state.inventories = [
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
  const inspect = async () =>
    rememberContextRuntime(f.endpoint.id, {
      epoch: "native",
      version,
      configurationRevision: state.endpoints[0].configurationRevision,
      at: Date.now(),
    });
  const request = vi.fn(async () => observed());
  const deps = {
    refresh: async () => state,
    inspect,
    request,
    context: () => 4096,
    commit: async (change: (s: typeof state) => typeof state) => {
      state = readSelfHostedState(JSON.parse(JSON.stringify(change(state))));
      return state;
    },
  };
  return {
    ...f,
    get,
    add,
    state: () => state,
    replace: (s: typeof state) => {
      state = s;
    },
    deps,
    controller,
    version: (v: string) => {
      version = v;
    },
    run: (force = false) =>
      runToolVerification(
        { profileId: get().id, signal: controller.signal, force },
        deps,
      ),
    verdict: () => toolVerificationState(state, get()),
  };
}
afterEach(() => {
  forgetContextRuntime("server");
  vi.restoreAllMocks();
});
describe("canonical native tool evidence", () => {
  it("a revision change during inference cannot activate the old verdict", async () => {
    const f = fixture(); f.deps.request.mockImplementationOnce(async () => { f.get().modelRevision = "changed-during-request"; return observed(); });
    await expect(f.run()).rejects.toThrow(/settings changed/); expect(f.verdict()).not.toBe("Verified");
  });
  it("interrupted persisted verification is incomplete without replay", async () => {
    const f = fixture(); await f.run(); const record = f.get().toolVerification;
    if (!record) throw new Error("record missing"); record.status = "verifying"; record.outcome = "interrupted"; record.completedAt = null;
    f.replace(readSelfHostedState(JSON.parse(JSON.stringify(f.state()))));
    expect(f.verdict()).toBe("Incomplete"); expect(f.deps.request).toHaveBeenCalledTimes(1);
  });
  it.each([
    [observed(), "native-call"],
    [observed({ calls: [{ ...call, name: "write_file" }] }), "wrong-tool"],
    [
      observed({
        calls: [{ ...call, input: { key: "clack-probe-v1", count: "1" } }],
      }),
      "invalid-arguments",
    ],
    [
      observed({
        calls: [{ ...call, input: { ...call.input, path: "secret" } }],
      }),
      "invalid-arguments",
    ],
    [observed({ calls: [{ ...call, invalid: true }] }), "invalid-arguments"],
    [observed({ calls: [call, call] }), "multiple-calls"],
    [
      observed({
        calls: [],
        text: '<tool_call>{"name":"get_probe_value"}</tool_call>',
        finish: "stop",
      }),
      "text-only",
    ],
    [
      observed({ calls: [], text: JSON.stringify(call), finish: "stop" }),
      "text-only",
    ],
    [
      observed({ calls: [], text: "I will call a tool", finish: "stop" }),
      "text-only",
    ],
    [observed({ calls: [], text: "", finish: "stop" }), "empty"],
    [observed({ calls: [], text: "", finish: "length" }), "output-length"],
    [observed({ finish: "unknown" }), "transport"],
  ])("classifies structured and textual evidence without executing or repairing it", (observation, expected) => {
    expect(classifyToolObservation(observation as ProbeObservation)).toBe(
      expected,
    );
  });
  it("advertised metadata alone is not direct proof", () => {
    const f = fixture();
    expect(f.verdict()).toBe("Advertised / unverified");
    expect(modelOnboarding(f.state(), f.get())?.status).toBe("Unverified");
  });
  it("explicit unsupported metadata does not infer", async () => {
    const f = fixture();
    f.add("trainedForTools", false);
    expect(await f.run()).toMatchObject({ status: "unsupported" });
    expect(f.deps.request).not.toHaveBeenCalled();
    expect(f.verdict()).toBe("Unsupported");
  });
  it("unknown metadata may use one bounded native probe", async () => {
    const f = fixture();
    f.get().evidence = f
      .get()
      .evidence.filter((e) => e.metric !== "probe.trainedForTools");
    await f.run();
    expect(f.verdict()).toBe("Verified");
  });
  it("verified proof persists, is reused and makes calibrated Automatic Agent-ready", async () => {
    const f = fixture();
    await f.run();
    expect(f.verdict()).toBe("Verified");
    expect(f.get().toolVerification).toMatchObject({
      status: "verified",
      calls: 1,
      validArguments: true,
      output: 512,
      context: 4096,
    });
    f.replace(
      setProfileRecommendation(
        f.state(),
        f.get().id,
        "workingContext",
        profileEvidence(
          f.state(),
          f.get().id,
          "workingContext",
          49152,
          "measured",
          Date.now(),
          "observed",
        ),
      ),
    );
    expect(modelOnboarding(f.state(), f.get())?.tools).toBe("Stale");
    f.deps.context = () => 49152;
    await f.run();
    expect(f.get().toolVerification?.context).toBe(49152);
    expect(modelOnboarding(f.state(), f.get())?.status).toBe("Ready");
    expect(
      selfHostedPickerStatus(selfHostedSelectionId(f.get()), f.state())?.label,
    ).toBe("Ready");
    f.replace(readSelfHostedState(JSON.parse(JSON.stringify(f.state()))));
    await f.run();
    expect(f.deps.request).toHaveBeenCalledTimes(2);
  });
  it("tool success alone cannot claim calibrated Agent readiness", async () => {
    const f = fixture();
    await f.run();
    expect(modelOnboarding(f.state(), f.get())?.status).toBe("Unverified");
  });
  it("one text response needs attention, leaves Chat Only selectable and is not automatically retried", async () => {
    const f = fixture();
    f.deps.request.mockResolvedValue(
      observed({
        calls: [],
        text: "<function=get_probe_value>",
        finish: "stop",
      }),
    );
    await f.run();
    await f.run();
    expect(f.verdict()).toBe("Needs attention");
    expect(f.deps.request).toHaveBeenCalledTimes(1);
    expect(modelOnboarding(f.state(), f.get())?.status).toBe("Needs attention");
    expect(
      selfHostedPickerStatus(selfHostedSelectionId(f.get()), f.state())
        ?.disabled,
    ).toBe(false);
  });
  it("PASS then text FAIL preserves capability proof but blocks readiness across restart and later PASS", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const f = fixture();
    await f.run();
    const proof = structuredClone(f.get().toolVerification?.proof);
    f.deps.request.mockResolvedValueOnce(observed({ calls: [], text: "not a native call", finish: "stop", callAt: null }));
    await f.run(true);
    expect(f.get().toolVerification).toMatchObject({ status: "needs-attention", outcome: "text-only", proof });
    expect(f.verdict()).toBe("Needs attention");
    f.replace(readSelfHostedState(JSON.parse(JSON.stringify(f.state()))));
    await f.run();
    expect(f.deps.request).toHaveBeenCalledTimes(2);
    vi.mocked(Date.now).mockReturnValue(now + 1_000);
    await f.run(true);
    expect(f.get().toolVerification).toMatchObject({ status: "verified", outcome: "native-call", failure: { outcome: "text-only", at: now } });
    expect(f.verdict()).toBe("Needs attention");
    expect(modelOnboarding(f.state(), f.get())?.status).toBe("Needs attention");
    vi.mocked(Date.now).mockReturnValue(now + TOOL_VERIFICATION.ttlMs + 1);
    f.get().evidence = f.get().evidence.map(e => ({...e, observedAt: Date.now(), expiresAt: Date.now() + 300_000}));
    await f.deps.inspect();
    expect(f.verdict()).toBe("Verified");
  });
  it("a transient recheck cannot remove a previous failed invocation", async () => {
    const f = fixture();
    f.deps.request.mockResolvedValueOnce(observed({ calls: [], text: "no", callAt: null }));
    await f.run();
    f.deps.request.mockRejectedValueOnce(new Error("network failure"));
    await f.run(true);
    expect(f.verdict()).toBe("Needs attention");
    expect(f.get().toolVerification?.proof).toBeNull();
  });
  it("legacy incompatible observations project truthfully without rewriting stored evidence", async () => {
    const f = fixture();
    f.deps.request.mockResolvedValueOnce(observed({ calls: [], text: "no" }));
    await f.run();
    const record = f.get().toolVerification;
    if (!record) throw new Error("missing record");
    record.status = "incompatible";
    delete record.failure;
    f.replace(readSelfHostedState(JSON.parse(JSON.stringify(f.state()))));
    const before = JSON.stringify(f.state());
    expect(f.verdict()).toBe("Needs attention");
    expect(JSON.stringify(f.state())).toBe(before);
    await f.run(true);
    expect(f.verdict()).toBe("Needs attention");
    expect(f.get().toolVerification?.proof).not.toBeNull();
  });
  it.each(["wrong-tool", "invalid-arguments", "multiple-calls"])("a %s observation also preserves proof without restoring readiness", async outcome => {
    const f = fixture();
    await f.run();
    const proof = structuredClone(f.get().toolVerification?.proof);
    f.deps.request.mockResolvedValueOnce(observed({calls: outcome === "multiple-calls" ? [call, call] :
      [outcome === "wrong-tool" ? {...call, name: "other"} : {...call, input: {key: "wrong", count: 1}}]}));
    await f.run(true);
    expect(f.get().toolVerification).toMatchObject({proof, failure: {outcome}, status: "needs-attention"});
    expect(f.verdict()).toBe("Needs attention");
  });
  it("malformed negative evidence fails validation instead of granting readiness", async () => {
    const f = fixture();
    await f.run();
    const record = f.get().toolVerification;
    expect(toolVerificationSchema.safeParse({...record, status: "needs-attention"}).success).toBe(false);
    expect(toolVerificationSchema.safeParse({...record, failure: {at: 1, expiresAt: 2, outcome: "native-call"}}).success).toBe(false);
  });
  it.each(["reasoning", "context", "digest"])("negative evidence cannot cross a changed %s configuration", async (kind) => {
    const f = fixture();
    f.deps.request.mockResolvedValueOnce(observed({ calls: [], text: "no" }));
    await f.run();
    if (kind === "reasoning") f.add("thinkingDefault", false);
    if (kind === "context") f.deps.context = () => 8192;
    if (kind === "digest") f.get().modelRevision = "new";
    expect(toolVerificationState(f.state(), f.get(), Date.now(), f.deps.context())).toBe("Stale");
    await f.run();
    expect(f.get().toolVerification?.failure).toBeUndefined();
    expect(f.verdict()).toBe("Verified");
  });
  it.each([
    "first-output timeout",
    "stream-idle timeout",
    "network failure",
  ])("%s stays incomplete with backoff and no auto retry", async (message) => {
    const f = fixture();
    f.deps.request.mockRejectedValue(new Error(message));
    await f.run();
    await f.run();
    expect(f.verdict()).toBe("Incomplete");
    expect(f.deps.request).toHaveBeenCalledTimes(1);
    expect(f.get().toolVerification?.outcome).toBe(
      message === "network failure" ? "transport" : "timeout",
    );
  });
  it("completed empty output is incomplete, not unsupported", async () => {
    const f = fixture();
    f.deps.request.mockResolvedValue(
      observed({ calls: [], text: "", finish: "stop" }),
    );
    await f.run();
    expect(f.get().toolVerification).toMatchObject({
      status: "incomplete",
      outcome: "empty",
    });
  });
  it("offline does not infer and withdraws active readiness", async () => {
    const f = fixture();
    await f.run();
    const inventory = f.state().inventories?.[0];
    if (inventory) inventory.connected = false;
    expect(await f.run()).toMatchObject({ status: "offline" });
    expect(modelOnboarding(f.state(), f.get())?.status).toBe("Offline");
    expect(f.deps.request).toHaveBeenCalledTimes(1);
  });
  it.each([
    "digest",
    "connection",
    "model",
    "version",
    "reasoning",
    "epoch",
    "expiry",
  ])("%s changes withdraw current proof", async (kind) => {
    const f = fixture();
    await f.run();
    if (kind === "digest") f.get().modelRevision = "other";
    if (kind === "connection") f.state().endpoints[0].configurationRevision++;
    if (kind === "model") f.get().transportModelId = "other";
    if (kind === "version") {
      f.version("changed");
      await f.deps.inspect();
    }
    if (kind === "reasoning") f.add("thinkingDefault", false);
    if (kind === "epoch") forgetContextRuntime(f.endpoint.id);
    if (kind === "expiry") {
      const r = f.get().toolVerification;
      if (r?.proof) r.proof.expiresAt = 0;
    }
    expect(f.verdict()).not.toBe("Verified");
  });
  it("same model tag on a second server cannot inherit a verdict", async () => {
    const f = fixture();
    await f.run();
    expect(
      toolVerificationState(f.state(), { ...f.get(), endpointId: "another" }),
    ).toBe("Unverified");
  });
  it("cancelled work never activates a proof", async () => {
    const f = fixture();
    f.deps.request.mockImplementationOnce(async () => {
      f.controller.abort();
      return observed();
    });
    await f.run();
    expect(f.get().toolVerification).toMatchObject({
      status: "incomplete",
      outcome: "cancelled",
      proof: null,
    });
  });
  it("stale writers cannot replace valid proof", async () => {
    const f = fixture();
    await f.run();
    const before = JSON.stringify(f.state()),
      record = f.get().toolVerification;
    if (!record) throw new Error("missing record");
    expect(() =>
      commitToolVerification(
        f.state(),
        f.get().id,
        { ...record, id: "old" },
        "wrong",
      ),
    ).toThrow();
    expect(JSON.stringify(f.state())).toBe(before);
  });
  it("a transient recheck preserves prior same-scope valid evidence", async () => {
    const f = fixture();
    await f.run();
    f.deps.request.mockRejectedValue(new Error("network failure"));
    await f.run(true);
    expect(f.get().toolVerification?.status).toBe("incomplete");
    expect(f.verdict()).toBe("Verified");
  });
  it("malformed records are isolated without losing context or pins", async () => {
    const f = fixture();
    await f.run();
    const raw = JSON.parse(JSON.stringify(f.state()));
    raw.profiles[0].toolVerification.version = 999;
    expect(
      toolVerificationSchema.safeParse(raw.profiles[0].toolVerification)
        .success,
    ).toBe(false);
    const restored = readSelfHostedState(raw);
    expect(restored.profiles).toHaveLength(1);
    expect(restored.profiles[0].toolVerification).toBeUndefined();
    expect(restored.profiles[0].overrides).toEqual(f.get().overrides);
  });
  it("other backends are unavailable for verification, not assigned fake Ollama semantics", async () => {
    const f = fixture();
    f.state().endpoints[0].backendHint = "openai-compatible";
    expect(await f.run()).toMatchObject({ status: "unavailable" });
    expect(f.deps.request).not.toHaveBeenCalled();
  });
  it("a new runtime can explicitly reverify without replaying a saved request", async () => {
    const f = fixture();
    await f.run();
    f.version("new");
    await f.run();
    expect(f.verdict()).toBe("Verified");
    expect(f.deps.request).toHaveBeenCalledTimes(2);
    expect(TOOL_VERIFICATION.protocol).toBe("native-tools-v1");
  });
});
