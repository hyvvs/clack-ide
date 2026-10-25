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
  type ToolProbeDependencies,
  verificationRecord,
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
  type ToolRequestBudget,
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
  const request = vi.fn<ToolProbeDependencies["request"]>(async () => observed());
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
    run: (force = false, requestBudget?: ToolRequestBudget) =>
      runToolVerification(
        { profileId: get().id, signal: controller.signal, force, requestBudget },
        deps,
      ),
    verdict: () => toolVerificationState(state, get()),
  };
}
afterEach(() => {
  forgetContextRuntime("server");
  vi.restoreAllMocks();
});

describe("bounded verifier output exhaustion", () => {
  it("preserves 65K proof when genuinely verifying 32K; caches the exact tier after native success", async () => {
    const f = fixture();
    await f.run();
    const original = f.get().toolVerification;
    expect(original).toMatchObject({ status: "verified", context: 4096 });
    const tier = await runToolVerification({
      profileId: f.get().id, signal: f.controller.signal, tierContext: 32768,
    }, { ...f.deps, context: () => 32768 });
    expect(tier).toMatchObject({ status: "verified", context: 32768, outcome: "native-call" });
    if (!tier || !("id" in tier)) throw new Error("Expected a persisted exact-tier native record");
    expect(f.get().toolVerification).toEqual(original);
    expect(f.get().agentToolTierProofs).toHaveLength(1);
    expect(verificationRecord(f.get(), undefined, 32768)?.id).toBe(tier.id);
    expect(verificationRecord(f.get(), undefined, 4096)?.id).toBe(original?.id);
    expect(toolVerificationState(f.state(), { ...f.get(),
      toolVerification: verificationRecord(f.get(), undefined, 32768) }, Date.now(), 32768)).toBe("Verified");
    f.deps.request.mockClear();
    await runToolVerification({
      profileId: f.get().id, signal: f.controller.signal, tierContext: 32768,
    }, { ...f.deps, context: () => 32768 });
    expect(f.deps.request).not.toHaveBeenCalled();
    f.replace(readSelfHostedState(JSON.parse(JSON.stringify(f.state()))));
    expect(verificationRecord(f.get(), undefined, 32768)?.id).toBe(tier.id);
  });
  it("failed tier verification is isolated, and cannot borrow a different-context proof", async () => {
    const f = fixture();
    await f.run();
    f.deps.request.mockResolvedValueOnce(observed({ calls: [], callAt: null, text: "text only", finish: "stop" }));
    const failed = await runToolVerification({
      profileId: f.get().id, signal: f.controller.signal, tierContext: 32768,
    }, { ...f.deps, context: () => 32768 });
    expect(failed).toMatchObject({ context: 32768, status: "needs-attention" });
    expect(verificationRecord(f.get(), undefined, 32768)?.status).toBe("needs-attention");
    expect(toolVerificationState(f.state(), { ...f.get(),
      toolVerification: verificationRecord(f.get(), undefined, 32768) }, Date.now(), 32768)).not.toBe("Verified");
    expect(verificationRecord(f.get(), undefined, 4096)?.status).toBe("verified");
    f.deps.request.mockClear();
    await runToolVerification({ profileId: f.get().id, signal: f.controller.signal, tierContext: 32768 },
      { ...f.deps, context: () => 32768 });
    expect(f.deps.request).not.toHaveBeenCalled(); // bounded negative observation
  });
  it("digest, runtime epoch, provider version and expiration invalidate a stored tier proof", async () => {
    const f = fixture();
    await runToolVerification({ profileId: f.get().id, signal: f.controller.signal, tierContext: 32768 },
      { ...f.deps, context: () => 32768 });
    const check = () => toolVerificationState(f.state(), { ...f.get(),
      toolVerification: verificationRecord(f.get(), undefined, 32768) }, Date.now(), 32768);
    expect(check()).toBe("Verified");
    f.get().modelRevision = "another-digest";
    expect(check()).not.toBe("Verified");
    f.get().modelRevision = "digest";
    f.version("new-version");
    await f.deps.inspect();
    expect(check()).not.toBe("Verified");
    f.version("1.2.3");
    await f.deps.inspect();
    expect(check()).toBe("Verified");
    rememberContextRuntime(f.endpoint.id, { epoch: "different-runtime", version: "1.2.3",
      configurationRevision: 1, at: Date.now() });
    expect(check()).not.toBe("Verified");
    await f.deps.inspect();
    const proof = verificationRecord(f.get(), undefined, 32768);
    if (proof?.proof) proof.proof.expiresAt = Date.now() - 1;
    expect(check()).not.toBe("Verified");
  });
  const length = () => observed({ calls: [], text: "", finish: "length", callAt: null });
  const outputs = (f: ReturnType<typeof fixture>) => f.deps.request.mock.calls.map(c => c[3]);

  it.each([1024, 2048])("only explicit length escalates to a native PASS at %s", async output => {
    const f = fixture();
    f.deps.request.mockResolvedValueOnce(length());
    if (output === 2048) f.deps.request.mockResolvedValueOnce(length());
    await f.run();
    expect(outputs(f)).toEqual(output === 1024 ? [512, 1024] : [512, 1024, 2048]);
    expect(f.get().toolVerification).toMatchObject({ status: "verified", outcome: "native-call", output });
    expect(f.get().toolVerification?.attempts?.map(a => a.outcome)).toEqual(output === 1024 ?
      ["output-length", "native-call"] : ["output-length", "output-length", "native-call"]);
    f.replace(readSelfHostedState(JSON.parse(JSON.stringify(f.state()))));
    expect(f.verdict()).toBe("Verified");
    expect(modelOnboarding(f.state(), f.get())?.status).toBe("Ready");
  });
  it("hard-cap exhaustion persists Incomplete, never negative compliance, and backs off", async () => {
    const f = fixture(); f.deps.request.mockResolvedValue(length());
    await f.run(); await f.run();
    expect(outputs(f)).toEqual([512, 1024, 2048]);
    expect(f.get().toolVerification).toMatchObject({ status: "incomplete", outcome: "output-length", output: 2048, proof: null });
    expect(f.get().toolVerification?.failure).toBeUndefined();
    f.replace(readSelfHostedState(JSON.parse(JSON.stringify(f.state()))));
    expect(f.verdict()).toBe("Incomplete");
  });
  it.each(["text", "pseudo", "empty"])("normal-stop %s does not escalate", async kind => {
    const f = fixture();
    f.deps.request.mockResolvedValue(observed({ calls: [], finish: "stop", callAt: null,
      text: kind === "pseudo" ? '<function=get_probe_value>{"count":1}</function>' : kind === "text" ? "not native" : "" }));
    await f.run();
    expect(outputs(f)).toEqual([512]);
    expect(f.verdict()).toBe(kind === "empty" ? "Incomplete" : "Needs attention");
  });
  it("a native verdict takes precedence over a coincident length finish", async () => {
    const f = fixture(); f.deps.request.mockResolvedValue(observed({ finish: "length" }));
    await f.run(); expect(outputs(f)).toEqual([512]); expect(f.verdict()).toBe("Verified");
  });
  it("a wrong native call is a verdict, not output uncertainty", async () => {
    const f = fixture(); f.deps.request.mockResolvedValue(observed({ calls: [{ ...call, name: "wrong" }], finish: "length" }));
    await f.run(); expect(outputs(f)).toEqual([512]); expect(f.verdict()).toBe("Needs attention");
  });
  it("Qwen's already-demonstrated small native response retains the initial allowance", async () => {
    const f = fixture(); await f.run();
    expect(outputs(f)).toEqual([512]);
    expect(f.get().toolVerification?.attempts).toHaveLength(1);
  });
  it("reconfirmation reuses a same-scope successful allowance, not a failed one", async () => {
    const f = fixture(); f.deps.request.mockResolvedValueOnce(length());
    await f.run(); await f.run(true);
    expect(outputs(f)).toEqual([512, 1024, 1024]);
  });
  it("stops without another dispatch when the shared request budget is spent", async () => {
    const f = fixture(); f.deps.request.mockResolvedValue(length());
    await f.run(false, { remaining: 1 });
    expect(outputs(f)).toEqual([512]);
    expect(f.get().toolVerification).toMatchObject({ status: "incomplete", outcome: "request-limit", output: 512 });
  });
  it.each(["digest", "reasoning", "context", "override"])("a changed %s after length cannot dispatch an escalation", async kind => {
    const f = fixture();
    f.deps.request.mockImplementationOnce(async () => {
      if (kind === "digest") f.get().modelRevision = "new-digest";
      if (kind === "reasoning") f.add("thinkingDefault", false);
      if (kind === "context") f.deps.context = () => 8192;
      if (kind === "override") f.get().overrides.workingContext = { mode: "manual",
        evidence: profileEvidence(f.state(), f.get().id, "workingContext", 8192, "user-assertion", Date.now(), "unverified") };
      return length();
    });
    if (kind === "digest") await expect(f.run()).rejects.toThrow(/settings changed/);
    else { await f.run(); expect(f.get().toolVerification?.outcome).toBe("revision-changed"); }
    expect(outputs(f)).toEqual([512]); expect(f.verdict()).not.toBe("Verified");
  });
  it("offline after length withdraws readiness without escalation", async () => {
    const f = fixture(); f.deps.request.mockImplementationOnce(async () => {
      const inventory = f.state().inventories?.[0]; if (inventory) inventory.connected = false;
      return length();
    });
    await f.run(); expect(outputs(f)).toEqual([512]); expect(f.get().toolVerification?.outcome).toBe("offline");
  });
  it("cancellation between allowances never replays or activates a proof", async () => {
    const f = fixture(); f.deps.request.mockImplementationOnce(async () => { f.controller.abort(); return length(); });
    await f.run(); expect(outputs(f)).toEqual([512]);
    expect(f.get().toolVerification).toMatchObject({ status: "incomplete", outcome: "cancelled", proof: null });
  });
  it("explicit reasoning configuration remains byte-equivalent across output steps", async () => {
    const f = fixture(); const configuration = { choice: "none", wire: false };
    f.deps.request.mockResolvedValueOnce(length());
    await runToolVerification({ profileId: f.get().id, signal: f.controller.signal, configuration }, f.deps);
    expect(f.deps.request.mock.calls.map(c => c[2])).toEqual([configuration, configuration]);
  });
  it("mutating the selected explicit configuration cancels escalation", async () => {
    const f = fixture(); const configuration = { choice: "none", wire: false };
    f.deps.request.mockImplementationOnce(async () => { configuration.wire = true; return length(); });
    await runToolVerification({ profileId: f.get().id, signal: f.controller.signal, configuration }, f.deps);
    expect(outputs(f)).toEqual([512]); expect(f.get().agentToolConfigurations?.[0].outcome).toBe("revision-changed");
  });
  it("rejects oversized/unsupported persisted output evidence while retaining legacy 512 records", async () => {
    const f = fixture(); await f.run(); const record = f.get().toolVerification;
    expect(toolVerificationSchema.safeParse({ ...record, attempts: undefined }).success).toBe(true);
    expect(toolVerificationSchema.safeParse({ ...record, output: 4096 }).success).toBe(false);
    expect(toolVerificationSchema.safeParse({ ...record, attempts: Array(4).fill(record?.attempts?.[0]) }).success).toBe(false);
  });
  it("the output ladder shares one unchanged verifier deadline rather than resetting it", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.deps.refresh = async () => {
        f.get().evidence = f.get().evidence.map(e => ({ ...e, observedAt: Date.now() }));
        return f.state();
      };
      f.deps.request.mockImplementation(async (_state, signal) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(length()), 65000);
        signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
      }));
      const pending = f.run();
      await vi.advanceTimersByTimeAsync(TOOL_VERIFICATION.deadlineMs + 1);
      await pending;
      expect(outputs(f)).toEqual([512, 1024]);
      expect(f.get().toolVerification?.outcome).toBe("timeout");
    } finally { vi.useRealTimers(); }
  });
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
  it("verified tools can use the conservative context policy without claiming a calibrated context", async () => {
    const f = fixture();
    await f.run();
    expect(modelOnboarding(f.state(), f.get())?.status).toBe("Ready");
    expect(modelOnboarding(f.state(), f.get())?.context.verified).toBeUndefined();
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
