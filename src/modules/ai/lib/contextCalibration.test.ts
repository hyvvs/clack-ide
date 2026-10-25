import { afterEach, describe, expect, it, vi } from "vitest";
import { ollamaEffortFixture } from "@/modules/ai/lib/reasoningEffort.fixture";
import {
  calibrationCandidates,
  classifyContextFailure,
  commitContextCalibration,
  runContextCalibration,
} from "@/modules/ai/lib/contextCalibration";
import {
  contextMetadata,
  forgetContextRuntime,
  rememberContextRuntime,
  trustedContext,
} from "@/modules/ai/lib/contextCalibrationTrust";
import {
  profileEvidence,
  readSelfHostedState,
  setProfileOverride,
  effectiveProfileValue,
} from "@/modules/ai/lib/selfHostedProfiles";
import { CONTEXT_CALIBRATION, contextCalibrationSchema } from "@/modules/ai/lib/contextCalibrationSchema";
import {
  profileSnapshot,
  modelOnboarding,
} from "@/modules/ai/lib/modelOnboarding";
import { profileBudgetLimits } from "@/modules/ai/lib/contextBudgetProfile";

function fixture() {
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const base = ollamaEffortFixture([false, true, "medium"], "generic-model");
  let state = base.state;
  state.profiles[0].modelRevision = "digest";
  state.profiles[0].backend = "ollama";
  state.profiles[0].evidence = [];
  let loaded = 0,
    advertised = 1_048_576,
    connected = true,
    epoch = "process-one",
    version = "1.2.3";
  const id = state.profiles[0].id;
  const failures = new Map<number, Error>();
  const controller = new AbortController();
  const get = () => state.profiles[0];
  const refresh = async () => {
    const p = get();
    const data = {
      runtimeContext: "per-request",
      advertisedContext: advertised,
      thinking: true,
      thinkingControls: '[false,true,"medium"]',
      thinkingDefault: true,
      trainedForTools: true,
      loaded: loaded > 0,
      ...(loaded
        ? {
            loadedContext: loaded,
            runtimeAllocation: JSON.stringify([
              p.modelRevision,
              loaded * 1024,
              loaded * 512,
            ]),
          }
        : {}),
    };
    p.evidence = Object.entries(data).map(([metric, value]) =>
      profileEvidence(
        state,
        p.id,
        `probe.${metric}`,
        value,
        "backend-reported",
        now,
        "reported",
      ),
    );
    state.inventories = [
      {
        endpointId: p.endpointId,
        configurationRevision: state.endpoints[0].configurationRevision,
        observedAt: now,
        connected,
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
    const snapshot = profileSnapshot(state, p);
    if (!snapshot) throw new Error("fixture snapshot missing");
    return { state, snapshot };
  };
  const inspectRuntime = async () =>
    rememberContextRuntime(base.endpoint.id, {
      epoch,
      version,
      configurationRevision: state.endpoints[0].configurationRevision,
      at: now,
    });
  const request = vi.fn(
    async (context: number, _state: typeof state, signal: AbortSignal) => {
      signal.throwIfAborted();
      now += 10;
      if (failures.has(context)) throw failures.get(context);
      loaded = context;
      return { finish: "stop" };
    },
  );
  const commit = async (change: (s: typeof state) => typeof state) => {
    state = readSelfHostedState(JSON.parse(JSON.stringify(change(state))));
    return state;
  };
  const deps = { refresh, inspectRuntime, request, commit, clock: () => now };
  const run = (ceiling = 49152, force = false) =>
    runContextCalibration(
      { state, profileId: id, signal: controller.signal, ceiling, force },
      deps,
    );
  return {
    get,
    state: () => state,
    run,
    deps,
    controller,
    failures,
    advance: (ms: number) => {
      now += ms;
    },
    loaded: (n: number) => {
      loaded = n;
    },
    max: (n: number) => {
      advertised = n;
    },
    offline: () => {
      connected = false;
    },
    online: () => {
      connected = true;
    },
    epoch: (s: string) => {
      epoch = s;
    },
    version: (s: string) => {
      version = s;
    },
    trust: () => trustedContext(state, get(), now),
    replace: (s: typeof state) => {
      state = s;
    },
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  forgetContextRuntime("server");
});
describe("bounded practical context calibration", () => {
  it("bounds post-stream metadata refresh by the existing request deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const f = fixture();
    const refresh = f.deps.refresh;
    let calls = 0;
    let release!: (value: Awaited<ReturnType<typeof refresh>>) => void;
    const hanging = new Promise<Awaited<ReturnType<typeof refresh>>>((resolve) => { release = resolve; });
    f.deps.refresh = () => ++calls === 2 ? hanging : refresh();
    const pending = f.run(4096);
    try {
      for (let i = 0; i < 30 && calls < 2; i++) await Promise.resolve();
      expect(calls).toBe(2);
      let settled = false;
      void pending.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(CONTEXT_CALIBRATION.requestMs + 1);
      expect(settled).toBe(true);
      const record = await pending;
      expect(record).toMatchObject({ status: "incomplete", highest: null, failure: "timeout" });
      expect(record && "attempts" in record ? record.attempts[0] : null).toMatchObject({ context: 4096, outcome: "timeout" });
      expect(f.trust()).toBeUndefined();
    } finally {
      release(await refresh());
      await pending;
      vi.useRealTimers();
    }
  });
  it("cancellation during post-response runtime inspection cannot verify a completed stream", async () => {
    const f = fixture();
    const inspect = f.deps.inspectRuntime;
    let calls = 0;
    f.deps.inspectRuntime = async () => {
      if (++calls === 2) return new Promise<void>(() => {});
      return inspect();
    };
    const pending = f.run(4096);
    for (let i = 0; i < 40 && calls < 2; i++) await Promise.resolve();
    expect(calls).toBe(2);
    f.controller.abort(new Error("fixture cancellation"));
    const record = await pending;
    expect(record).toMatchObject({ status: "cancelled", failure: "cancelled", highest: null });
    expect(record && "attempts" in record ? record.attempts[0] : null).toMatchObject({ context: 4096, outcome: "cancelled" });
    expect(f.trust()).toBeUndefined();
  });
  it("starts conservative without production evidence or historical report parsing", async () => {
    const f = fixture();
    await f.deps.refresh();
    expect(
      effectiveProfileValue(f.state(), f.get().id, "workingContext").value,
    ).toBeUndefined();
    expect(
      profileBudgetLimits(
        f.state(),
        f.get().id,
        profileSnapshot(f.state(), f.get()),
      ).runtimeTarget,
    ).toBeUndefined();
    expect(modelOnboarding(f.state(), f.get())?.context.recommended).toBe(4096);
  });
  it.each([
    8192, 16384, 32768, 49152,
  ])("persists verified %i and makes Automatic request that exact allocation", async (ceiling) => {
    const f = fixture();
    const result = await f.run(ceiling);
    expect(result).toMatchObject({
      highest: ceiling,
      status: "verified",
      failure: null,
    });
    expect(f.trust()).toBe(ceiling);
    expect(
      effectiveProfileValue(f.state(), f.get().id, "workingContext").value,
    ).toBe(ceiling);
    expect(
      profileBudgetLimits(
        f.state(),
        f.get().id,
        profileSnapshot(f.state(), f.get()),
      ).runtimeTarget,
    ).toBe(ceiling);
    expect(modelOnboarding(f.state(), f.get())).toMatchObject({
      status: "Unverified",
      context: { verified: ceiling },
    });
    expect(
      f
        .get()
        .contextCalibration?.attempts.every(
          (a) => a.requested === a.loaded && a.think === "omitted",
        ),
    ).toBe(true);
  });
  it("never pursues huge model maxima and respects a lower advertised ceiling", () => {
    expect(calibrationCandidates(1_048_576)).toEqual([
      4096, 8192, 16384, 32768, 49152, 65536, 73728,
    ]);
    expect(calibrationCandidates(12000)).toEqual([4096, 8192]);
    expect(calibrationCandidates(2048)).toEqual([2048]);
    expect(calibrationCandidates(70000)).toEqual([4096, 8192, 16384, 32768, 49152, 65536]);
  });
  it("qualifies 73,728 only after seven measured allocations; preserves legacy 65K records", async () => {
    const f = fixture();
    const verified = await f.run(73728);
    expect(verified).toMatchObject({ status: "verified", highest: 73728, failure: null });
    expect(f.deps.request.mock.calls.map(([tier]) => tier)).toEqual(CONTEXT_CALIBRATION.candidates);
    expect(verified && "attempts" in verified ? verified.attempts : []).toHaveLength(7);
    expect(f.trust()).toBe(73728);
    expect(contextCalibrationSchema.safeParse(verified).success).toBe(true);
    if (!verified || !("attempts" in verified)) throw new Error("missing calibration");
    const legacy = { ...verified, highest: 65536, attempts: verified.attempts.slice(0, 6) };
    expect(contextCalibrationSchema.safeParse(legacy).success).toBe(true);
    expect(contextCalibrationSchema.safeParse({ ...verified, highest: 81920 }).success).toBe(false);
  });
  it("fails closed when the new tier cannot load and retains only proven 65K capacity", async () => {
    const f = fixture();
    f.deps.request.mockImplementation(async (tier) => {
      f.loaded(tier === 73728 ? 65536 : tier);
      return { finish: "stop" };
    });
    const outcome = await f.run(73728);
    expect(outcome).toMatchObject({ status: "capacity", highest: 65536, failedNext: 73728, failure: "allocation-mismatch" });
    expect(f.trust()).toBe(65536);
    expect(f.deps.request.mock.calls.map(([tier]) => tier)).toEqual(CONTEXT_CALIBRATION.candidates);
  });
  it("stops upward at one resource failure, retains 32K and never retries known-failing 48K", async () => {
    const f = fixture();
    f.failures.set(49152, new Error("out of memory"));
    expect(await f.run()).toMatchObject({
      highest: 32768,
      failedNext: 49152,
      failure: "capacity",
      status: "capacity",
    });
    expect(f.trust()).toBe(32768);
    expect(f.deps.request.mock.calls.map((c) => c[0])).toEqual([
      4096, 8192, 16384, 32768, 49152,
    ]);
    f.advance(300_001);
    await f.run(65536, true);
    expect(
      f.deps.request.mock.calls.filter((c) => c[0] === 49152),
    ).toHaveLength(1);
    expect(
      f.deps.request.mock.calls.filter((c) => c[0] === 65536),
    ).toHaveLength(0);
  });
  it("rejects silent smaller allocation and restores only an already successful candidate", async () => {
    const f = fixture();
    f.deps.request.mockImplementation(async (context) => {
      f.loaded(context === 49152 ? 8192 : context);
      return { finish: "stop" };
    });
    const result = await f.run();
    expect(result).toMatchObject({
      highest: 32768,
      failedNext: 49152,
      failure: "allocation-mismatch",
    });
    expect(f.deps.request.mock.calls.map((c) => c[0])).toEqual([
      4096, 8192, 16384, 32768, 49152, 32768,
    ]);
    expect(f.trust()).toBe(32768);
  });
  it("never retries a previously verified allocation after it now fails capacity", async () => {
    const f = fixture();
    await f.run(49152);
    f.advance(15 * 60_000 + 1);
    f.loaded(0);
    f.failures.set(49152, new Error("out of memory"));
    const before = f.deps.request.mock.calls.length;
    expect(await f.run()).toMatchObject({
      highest: null,
      failedNext: 49152,
      failure: "capacity",
    });
    expect(f.deps.request.mock.calls.slice(before).map((c) => c[0])).toEqual([
      49152,
    ]);
    expect(f.trust()).toBeUndefined();
  });
  it.each([
    "connection reset",
    "first-output timeout",
    "stream-idle timed-out",
  ])("does not establish a capacity bound for %s", async (message) => {
    const f = fixture();
    f.failures.set(49152, new Error(message));
    const result = await f.run();
    expect(result).toMatchObject({
      highest: 32768,
      failedNext: null,
      status: "incomplete",
    });
    expect(f.trust()).toBe(32768);
    const calls = f.deps.request.mock.calls.length;
    await f.run();
    expect(f.deps.request.mock.calls).toHaveLength(calls);
  });
  it("offline never infers, and a returning server can establish evidence", async () => {
    const f = fixture();
    f.offline();
    expect(await f.run()).toMatchObject({ status: "offline" });
    expect(f.deps.request).not.toHaveBeenCalled();
    f.online();
    await f.run(16384);
    expect(f.trust()).toBe(16384);
  });
  it("cancellation stops the ladder and cannot activate a partial larger result", async () => {
    const f = fixture();
    f.deps.request.mockImplementationOnce(async () => {
      f.controller.abort();
      return { finish: "stop" };
    });
    const result = await f.run();
    expect(result).toMatchObject({
      status: "cancelled",
      failure: "cancelled",
      highest: null,
    });
    expect(f.deps.request).toHaveBeenCalledTimes(1);
    expect(f.trust()).toBeUndefined();
  });
  it("explicit model/chat working pins survive recommendation updates and win", async () => {
    const f = fixture();
    f.replace(
      setProfileOverride(f.state(), f.get().id, "workingContext", 16384),
    );
    expect(await f.run()).toMatchObject({ status: "manual" });
    expect(f.deps.request).not.toHaveBeenCalled();
    await f.run(32768, true);
    expect(f.get().overrides.workingContext?.evidence.value).toBe(16384);
    expect(
      effectiveProfileValue(f.state(), f.get().id, "workingContext"),
    ).toMatchObject({ mode: "manual", value: 16384 });
  });
  it("serialization retains ownership but a new native epoch cannot reuse context", async () => {
    const f = fixture();
    await f.run(32768);
    f.replace(readSelfHostedState(JSON.parse(JSON.stringify(f.state()))));
    expect(f.trust()).toBe(32768);
    f.epoch("new-process");
    await f.deps.inspectRuntime();
    expect(f.trust()).toBeUndefined();
    expect(
      effectiveProfileValue(f.state(), f.get().id, "workingContext").value,
    ).toBeUndefined();
    f.deps.request.mockClear();
    await f.run(16384);
    expect(f.deps.request.mock.calls.map(([context]) => context)).toEqual([4096, 8192, 16384]);
    expect(f.trust()).toBe(16384);
  });
  it.each([
    "version",
    "allocation",
    "digest",
    "connection",
    "expiry",
  ])("invalidates %s changes without dropping explicit pins or transcript", async (kind) => {
    const f = fixture();
    await f.run(32768);
    if (kind === "version") {
      f.version("different");
      await f.deps.inspectRuntime();
    }
    if (kind === "allocation") {
      f.loaded(8192);
      await f.deps.refresh();
    }
    if (kind === "digest") f.get().modelRevision = "new-digest";
    if (kind === "connection") f.state().endpoints[0].configurationRevision++;
    if (kind === "expiry") f.advance(15 * 60_000 + 1);
    expect(f.trust()).toBeUndefined();
  });
  it("same digest on a different server/model cannot inherit evidence", async () => {
    const f = fixture();
    await f.run(32768);
    expect(
      trustedContext(f.state(), { ...f.get(), endpointId: "other-server" }),
    ).toBeUndefined();
    expect(
      trustedContext(f.state(), {
        ...f.get(),
        transportModelId: "other-model",
      }),
    ).toBeUndefined();
  });
  it("failed/stale commits preserve the previous valid record", async () => {
    const f = fixture();
    await f.run(16384);
    const before = JSON.stringify(f.state());
    const record = f.get().contextCalibration;
    if (!record) throw new Error("missing record");
    expect(() =>
      commitContextCalibration(
        f.state(),
        f.get().id,
        { ...record, id: "stale-writer" },
        "wrong-owner",
      ),
    ).toThrow(/identity/);
    expect(JSON.stringify(f.state())).toBe(before);
  });
  it("unsupported backends never infer or receive Ollama context semantics", async () => {
    const f = fixture();
    f.state().endpoints[0].backendHint = "openai-compatible";
    expect(await f.run()).toMatchObject({ status: "unsupported" });
    expect(f.deps.request).not.toHaveBeenCalled();
  });
  it("rejects malformed/unsupported records while preserving the discovered profile", async () => {
    const f = fixture();
    await f.run(8192);
    const raw = JSON.parse(JSON.stringify(f.state()));
    raw.profiles[0].contextCalibration.version = 99;
    expect(
      contextCalibrationSchema.safeParse(raw.profiles[0].contextCalibration)
        .success,
    ).toBe(false);
    const recovered = readSelfHostedState(raw);
    expect(recovered.profiles).toHaveLength(1);
    expect(
      recovered.profiles[0].recommendations.workingContext,
    ).toBeUndefined();
  });
  it("metadata alone is not an allocation proof", async () => {
    const f = fixture();
    f.deps.request.mockImplementation(async () => ({ finish: "stop" }));
    expect(await f.run()).toMatchObject({
      highest: null,
      status: "incomplete",
      failure: "transient",
    });
    expect(f.trust()).toBeUndefined();
    expect(
      contextMetadata(f.get(), f.state().endpoints[0], "advertisedContext"),
    ).toBe(1_048_576);
  });
  it.each([
    "first-output deadline",
    "stream-idle timeout",
    "network timeout",
  ])("classifies %s as timeout, never capacity", (value) =>
    expect(classifyContextFailure(new Error(value))).toBe("timeout"));
});
