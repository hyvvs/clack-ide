import { afterEach, describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import {
  runBoundedOptimization,
  OPTIMIZATION_LIMITS as L,
} from "@/modules/ai/lib/calibrationOptimization";
import {
  calibrationFixture,
  calibrationSample,
} from "@/modules/ai/lib/calibration.fixtures";
import type { ScopedCalibrationSample } from "@/modules/ai/lib/inferenceCalibration";
import { editSelfHostedEndpoint } from "@/modules/ai/lib/selfHostedProfiles";
import { cancelSessionInference } from "@/modules/ai/lib/inferenceLifecycle";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));
function fixture() {
  let state = calibrationFixture();
  let record!: (sample: ScopedCalibrationSample) => void;
  let queued!: () => void;
  let calls = 0;
  const controller = new AbortController();
  const options = {
    state,
    profileId: state.profiles[0].id,
    signal: controller.signal,
  };
  const build = vi.fn(async (_signal, onSample, onQueued) => {
    record = onSample;
    queued = onQueued;
    return {} as LanguageModel;
  });
  const call = vi.fn(async (_model, _prompt, _output, _signal) => {
    record({
      profileId: state.profiles[0].id,
      sample: calibrationSample(calls++, {
        observedAt: Date.now(),
        requestClass: "optimization",
      }),
    });
    return { inputTokens: 20, outputTokens: 100 };
  });
  const commit = vi.fn(async (change) => {
    state = change(state);
  });
  return {
    options,
    controller,
    build,
    call,
    commit,
    queued: () => queued(),
    state: () => state,
    change: () => {
      state = editSelfHostedEndpoint(state, "a", {
        baseURL: "http://changed/v1",
      });
    },
  };
}
afterEach(() => vi.useRealTimers());
describe("E2 explicit bounded optimization", () => {
  it("runs exactly three sequential static prompts with no tools or retries", async () => {
    const f = fixture();
    const result = await runBoundedOptimization(f.options, f);
    expect(f.call).toHaveBeenCalledTimes(3);
    expect(
      f.call.mock.calls.every(
        ([, prompt, output]) => prompt.includes("No tools") && output === 170,
      ),
    ).toBe(true);
    expect(result).toEqual({
      completed: 3,
      inputTokens: 60,
      outputTokens: 300,
    });
    expect(f.state().profiles[0].calibration?.samples).toHaveLength(3);
    expect(f.state().profiles[0].recommendations).toEqual({});
  });
  it("preserves unknown usage instead of inventing zero tokens", async () => {
    const f = fixture();
    const original = f.call.getMockImplementation();
    f.call.mockImplementation(async (...args) => {
      await original?.(...args);
      return {} as { inputTokens: number; outputTokens: number };
    });
    const result = await runBoundedOptimization(f.options, f);
    expect(result.inputTokens).toBeNull();
    expect(result.outputTokens).toBeNull();
  });
  it("stops on the first failure with no speculative batch or retry", async () => {
    const f = fixture();
    f.call.mockRejectedValueOnce(new Error("Offline"));
    await expect(runBoundedOptimization(f.options, f)).rejects.toThrow(
      "Offline",
    );
    expect(f.call).toHaveBeenCalledTimes(1);
    expect(f.commit).not.toHaveBeenCalled();
  });
  it("does not begin after cancellation", async () => {
    const f = fixture();
    f.controller.abort();
    await expect(runBoundedOptimization(f.options, f)).rejects.toThrow();
    expect(f.build).not.toHaveBeenCalled();
  });
  it("cancels during preparation and ignores late results", async () => {
    const f = fixture();
    f.build.mockImplementationOnce(async () => {
      f.controller.abort();
      return {} as LanguageModel;
    });
    await expect(runBoundedOptimization(f.options, f)).rejects.toThrow();
    expect(f.call).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
  });
  it("cancels between calls without committing incomplete measurements", async () => {
    const f = fixture();
    const options = { ...f.options, onProgress: () => f.controller.abort() };
    await expect(runBoundedOptimization(options, f)).rejects.toThrow();
    expect(f.call).toHaveBeenCalledTimes(1);
    expect(f.commit).not.toHaveBeenCalled();
  });
  it("honors D1 session cancellation", async () => {
    const f = fixture();
    const options = {
      ...f.options,
      scope: {
        sessionId: "optimization",
        runId: "test",
        isCurrent: () => true,
      },
    };
    f.build.mockImplementationOnce(async () => {
      void cancelSessionInference("optimization");
      return {} as LanguageModel;
    });
    await expect(runBoundedOptimization(options, f)).rejects.toThrow();
    expect(f.call).not.toHaveBeenCalled();
  });
  it("stops at native E1 saturation instead of waiting or increasing capacity", async () => {
    const f = fixture();
    f.call.mockImplementationOnce(async () => {
      f.queued();
      return { inputTokens: 20, outputTokens: 100 };
    });
    await expect(runBoundedOptimization(f.options, f)).rejects.toThrow(
      "capacity",
    );
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.call).toHaveBeenCalledTimes(1);
  });
  it("bounds total wall time including queued/preparing work", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.build.mockImplementationOnce(() => new Promise(() => {}));
    const operation = expect(
      runBoundedOptimization(f.options, f),
    ).rejects.toThrow("60-second");
    await vi.advanceTimersByTimeAsync(L.wallMs);
    await operation;
    expect(f.call).not.toHaveBeenCalled();
  });
  it.each([
    { inputTokens: 5000, outputTokens: 100 },
    { inputTokens: 20, outputTokens: 600 },
    { inputTokens: NaN, outputTokens: 100 },
  ])("rejects over-budget/malformed reported usage %j", async (usage) => {
    const f = fixture();
    f.call.mockResolvedValueOnce(usage);
    await expect(runBoundedOptimization(f.options, f)).rejects.toThrow(
      "budget",
    );
    expect(f.commit).not.toHaveBeenCalled();
  });
  it("rejects stale profile publication", async () => {
    const f = fixture();
    const options = {
      ...f.options,
      onProgress: (n: number) => {
        if (n === 3) f.change();
      },
    };
    await expect(runBoundedOptimization(options, f)).rejects.toThrow(
      "settings changed",
    );
    expect(f.state().profiles[0].calibration).toBeUndefined();
  });
  it("prevents two optimization runs from multiplying one endpoint budget", async () => {
    const f = fixture();
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const original = f.build.getMockImplementation();
    f.build.mockImplementationOnce(async (...args) => {
      await gate;
      return (await original?.(...args)) as LanguageModel;
    });
    const first = runBoundedOptimization(f.options, f);
    await expect(runBoundedOptimization(f.options, f)).rejects.toThrow(
      "already",
    );
    resume();
    await first;
  });
});
