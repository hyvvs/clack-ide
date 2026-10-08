import { describe, expect, it, vi } from "vitest";
import {
  editSelfHostedEndpoint,
  ensureSelfHostedProfile,
  effectiveProfileValue,
  setProfileOverride,
  setProfileRecommendation,
  profileEvidence,
  resetProfileOverride,
  readSelfHostedState,
  assertWritableSelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  appendCalibrationSamples,
  calibrationSummary,
  createCalibrationBatcher,
} from "@/modules/ai/lib/inferenceCalibration";
import { calibrationOutcome } from "@/modules/ai/lib/calibrationErrors";
import {
  CALIBRATION_LIMITS as L,
  calibrationSampleSchema,
  type CalibrationSample,
} from "@/modules/ai/lib/calibrationSchema";
import { InferenceTransportError } from "@/modules/ai/lib/inferenceErrors";
import { APICallError } from "ai";
import { endpointInferenceAdmission } from "@/modules/ai/lib/inferenceAdmission";
import {
  calibrationFixture,
  calibrationSample,
} from "@/modules/ai/lib/calibration.fixtures";
const add = (
  state = calibrationFixture(),
  count = 5,
  patch: Partial<CalibrationSample> = {},
  now = 1_100_000,
) =>
  appendCalibrationSamples(
    state,
    Array.from({ length: count }, (_, i) => ({
      profileId: state.profiles[0].id,
      sample: calibrationSample(i, patch),
    })),
    now,
  );

describe("E2 deterministic calibration", () => {
  it("adds metadata only and preserves other profiles", () => {
    const original = calibrationFixture();
    const next = add(original, 1);
    expect(next.profiles[0].calibration?.samples).toHaveLength(1);
    expect(next.profiles.slice(1)).toEqual(original.profiles.slice(1));
    expect(JSON.stringify(next)).not.toMatch(
      /prompt|response|authorization|apiKey/,
    );
  });
  it("requires five comparable successes and never raises context or serial capacity", () => {
    expect(add(undefined, 4).profiles[0].recommendations).toEqual({});
    const state = add();
    expect(state.profiles[0].recommendations.prefillTimeoutMs?.value).toBe(
      108000,
    );
    expect(state.profiles[0].recommendations.idleTimeoutMs?.value).toBe(54000);
    expect(
      state.profiles[0].recommendations.concurrentGenerations,
    ).toBeUndefined();
    expect(state.profiles[0].recommendations.configuredContext).toBeUndefined();
    expect(
      endpointInferenceAdmission("a", state.profiles[0].id, state).capacity,
    ).toBe(1);
  });
  it("uses medians despite one extreme latency/throughput outlier", () => {
    const base = add(undefined, 4);
    const state = appendCalibrationSamples(
      base,
      [
        {
          profileId: base.profiles[0].id,
          sample: calibrationSample(4, {
            ttftMs: 500000,
            outputTokens: 1000000,
            generationMs: 300,
          }),
        },
      ],
      1_100_000,
    );
    const summary = calibrationSummary(state.profiles[0], 1, 1_100_000);
    expect(summary.ttftMs).toBe(1000);
    expect(summary.tokensPerSecond).toBe(25);
  });
  it("keeps absent usage unknown but permits latency guidance", () => {
    const state = add(undefined, 5, { inputTokens: null, outputTokens: null });
    const summary = calibrationSummary(state.profiles[0], 1, 1_100_000);
    expect(summary.tokensPerSecond).toBeNull();
    expect(summary.ttftMs).toBe(1000);
    expect(state.profiles[0].recommendations.prefillTimeoutMs?.value).toBe(
      108000,
    );
  });
  it("requires five actual TTFT observations, not five results with mostly missing timing", () => {
    const base = add(undefined, 4, { ttftMs: null });
    const next = appendCalibrationSamples(
      base,
      [{ profileId: base.profiles[0].id, sample: calibrationSample(4) }],
      1_100_000,
    );
    expect(next.profiles[0].recommendations.prefillTimeoutMs).toBeUndefined();
  });
  it.each([
    0, 1, 31,
  ])("does not infer speed from a short %i-token answer", (tokens) => {
    const state = add(undefined, 5, { outputTokens: tokens });
    expect(
      calibrationSummary(state.profiles[0], 1, 1_100_000).tokensPerSecond,
    ).toBeNull();
  });
  it("does not mix input-size, concurrency or synthetic cohorts", () => {
    const state = calibrationFixture();
    const samples = [
      calibrationSample(0),
      calibrationSample(1),
      calibrationSample(2, { inputTokens: 10000 }),
      calibrationSample(3, { concurrency: 2 }),
      calibrationSample(4, { requestClass: "optimization" }),
    ];
    const next = appendCalibrationSamples(
      state,
      samples.map((sample) => ({ profileId: state.profiles[0].id, sample })),
      1_100_000,
    );
    expect(next.profiles[0].recommendations).toEqual({});
  });
  it("excludes cold starts without hiding their evidence", () => {
    const state = add(undefined, 5, { thermal: "cold", ttftMs: 300000 });
    expect(state.profiles[0].recommendations).toEqual({});
    expect(calibrationSummary(state.profiles[0], 1, 1_100_000).coldCount).toBe(
      5,
    );
  });
  it("permits one capacity step with five actual concurrent successes", () => {
    const state = add(undefined, 5, { concurrency: 3 });
    expect(state.profiles[0].recommendations.concurrentGenerations?.value).toBe(
      2,
    );
  });
  it("pins win while evidence continues collecting; Reset removes only the pin", () => {
    let state = calibrationFixture();
    const id = state.profiles[0].id;
    state = setProfileOverride(state, id, "prefillTimeoutMs", 555000, 100);
    state = setProfileOverride(state, id, "concurrentGenerations", 8, 100);
    state = add(state, 5, { concurrency: 2 });
    expect(
      effectiveProfileValue(state, id, "prefillTimeoutMs", 1_100_000).value,
    ).toBe(555000);
    expect(
      effectiveProfileValue(state, id, "concurrentGenerations", 1_100_000)
        .value,
    ).toBe(8);
    const reset = resetProfileOverride(state, id, "concurrentGenerations");
    expect(reset.profiles[0].calibration).toEqual(
      state.profiles[0].calibration,
    );
    expect(
      effectiveProfileValue(reset, id, "concurrentGenerations", 1_100_000)
        .value,
    ).toBe(2);
  });
  it("reduces only Automatic immediately on explicit resource failure", () => {
    let state = calibrationFixture();
    const id = state.profiles[0].id;
    state = setProfileRecommendation(
      state,
      id,
      "concurrentGenerations",
      profileEvidence(state, id, "concurrentGenerations", 4, "recommendation"),
    );
    state = setProfileOverride(state, id, "concurrentGenerations", 8);
    state = add(state, 1, { outcome: "resource", concurrency: 4 });
    expect(state.profiles[0].recommendations.concurrentGenerations?.value).toBe(
      3,
    );
    expect(
      state.profiles[0].overrides.concurrentGenerations?.evidence.value,
    ).toBe(8);
  });
  it.each([
    "cancelled",
    "offline",
    "auth",
    "protocol",
    "provider",
    "loading",
    "interrupted",
  ] as const)("%s alone does not tune capacity", (outcome) => {
    const state = add(undefined, 5, { outcome, concurrency: 4 });
    expect(state.profiles[0].recommendations).toEqual({});
  });
  it("reduces overload after repeated concurrent timeouts, not serial failures", () => {
    let base = calibrationFixture();
    const id = base.profiles[0].id;
    base = setProfileRecommendation(
      base,
      id,
      "concurrentGenerations",
      profileEvidence(base, id, "concurrentGenerations", 4, "recommendation"),
    );
    expect(
      add(base, 2, { outcome: "timeout", concurrency: 4 }).profiles[0]
        .recommendations.concurrentGenerations?.value,
    ).toBe(4);
    expect(
      add(base, 3, { outcome: "timeout", concurrency: 4 }).profiles[0]
        .recommendations.concurrentGenerations?.value,
    ).toBe(3);
    expect(
      add(base, 5, { outcome: "timeout", concurrency: 1 }).profiles[0]
        .recommendations.concurrentGenerations?.value,
    ).toBe(4);
  });
  it("enforces hysteresis and 10% numeric adjustments across batches", () => {
    let state = add();
    const id = state.profiles[0].id;
    state = appendCalibrationSamples(
      state,
      Array.from({ length: 5 }, (_, i) => ({
        profileId: id,
        sample: calibrationSample(i + 5),
      })),
      1_100_001,
    );
    expect(state.profiles[0].recommendations.prefillTimeoutMs?.value).toBe(
      108000,
    );
    const next = appendCalibrationSamples(
      state,
      [
        {
          profileId: id,
          sample: calibrationSample(10, { observedAt: 2_000_000 }),
        },
      ],
      2_000_000,
    );
    expect(next.profiles[0].recommendations.prefillTimeoutMs?.value).toBe(
      97200,
    );
    expect(
      next.profiles[0].calibration?.tuning.prefillTimeoutMs?.sampleIds,
    ).toContain("s-10");
  });
  it("will not tune twice from the same successes", () => {
    const state = add();
    const next = appendCalibrationSamples(
      state,
      [
        {
          profileId: state.profiles[0].id,
          sample: calibrationSample(9, {
            outcome: "cancelled",
            observedAt: 2_000_000,
          }),
        },
      ],
      2_000_000,
    );
    expect(next.profiles[0].recommendations).toEqual(
      state.profiles[0].recommendations,
    );
  });
  it("material edits invalidate evidence, alias edits preserve it", () => {
    const state = add();
    const id = state.profiles[0].id;
    const renamed = editSelfHostedEndpoint(state, "a", { alias: "Renamed" });
    expect(
      effectiveProfileValue(renamed, id, "prefillTimeoutMs", 1_100_000).stale,
    ).toBe(false);
    const changed = editSelfHostedEndpoint(renamed, "a", {
      baseURL: "http://changed/v1",
    });
    expect(
      effectiveProfileValue(changed, id, "prefillTimeoutMs", 1_100_000).stale,
    ).toBe(true);
    expect(calibrationSummary(changed.profiles[0], 2, 1_100_000).count).toBe(0);
    expect(add(changed)).toEqual(changed);
  });
  it("rejects late samples from deleted endpoints or unknown profiles", () => {
    const state = calibrationFixture();
    expect(
      appendCalibrationSamples(state, [
        { profileId: "missing", sample: calibrationSample() },
      ]),
    ).toBe(state);
    const deleted = {
      ...state,
      endpoints: state.endpoints.map((e) => ({ ...e, deletedAt: 2 })),
    };
    expect(add(deleted)).toBe(deleted);
  });
  it("deduplicates sample identities deterministically", () => {
    const state = add(undefined, 1);
    expect(add(state, 1)).toBe(state);
  });
  it("bounds history to 100 samples, seven days and 512 globally", () => {
    let state = calibrationFixture();
    for (let i = 0; i < 120; i++)
      state = appendCalibrationSamples(
        state,
        [{ profileId: state.profiles[0].id, sample: calibrationSample(i) }],
        1_100_000,
      );
    expect(state.profiles[0].calibration?.samples).toHaveLength(100);
    expect(state.profiles[0].calibration?.samples[0].id).toBe("s-20");
    for (let i = 0; i < 10; i++) {
      state = ensureSelfHostedProfile(state, "b", `m-${i}`, null, 1).state;
      const id = state.profiles[state.profiles.length - 1].id;
      state = appendCalibrationSamples(
        state,
        Array.from({ length: 100 }, (_, j) => ({
          profileId: id,
          sample: calibrationSample(j, { id: `m${i}-${j}` }),
        })),
        1_100_000,
      );
    }
    expect(
      state.profiles.reduce(
        (n, p) => n + (p.calibration?.samples.length ?? 0),
        0,
      ),
    ).toBe(L.globalSamples);
    expect(JSON.stringify(state).length).toBeLessThan(512 * 1024);
    expect(
      calibrationSummary(state.profiles[0], 1, 1_100_000 + L.ageMs).count,
    ).toBe(0);
    expect(
      effectiveProfileValue(
        state,
        state.profiles[0].id,
        "prefillTimeoutMs",
        1_100_000 + L.ageMs,
      ).value,
    ).toBeUndefined();
  });
  it.each([
    NaN,
    -1,
    Infinity,
    1.5,
    100_000_001,
    "4",
  ])("rejects malformed usage %s instead of inventing it", (value) => {
    expect(
      calibrationSampleSchema.safeParse(
        calibrationSample(0, { inputTokens: value as number }),
      ).success,
    ).toBe(false);
  });
  it("survives JSON restart and additive migration without duplicate evidence", () => {
    const state = add();
    const restored = readSelfHostedState(JSON.parse(JSON.stringify(state)));
    expect(restored).toEqual(state);
    expect(add(restored)).toBe(restored);
    expect(readSelfHostedState(calibrationFixture()).profiles).toHaveLength(4);
  });
  it("preserves corrupt settings rather than publishing fabricated evidence", () => {
    const state = add();
    const raw = structuredClone(state);
    Object.assign(raw.profiles[0].calibration ?? {}, { version: 999 });
    expect(() => assertWritableSelfHostedState(raw)).toThrow("preserved");
    const restored = readSelfHostedState(raw).profiles.find(
      (p) => p.id === state.profiles[0].id,
    );
    expect(restored?.calibration).toBeUndefined();
    expect(restored?.overrides).toEqual(state.profiles[0].overrides);
    expect(
      effectiveProfileValue(
        readSelfHostedState(raw),
        state.profiles[0].id,
        "prefillTimeoutMs",
        1_100_000,
      ).value,
    ).toBeUndefined();
  });
  it.each([
    ["cancelled", "cancelled"],
    ["connect-timeout", "timeout"],
    ["connection-failed", "offline"],
    ["malformed-stream", "protocol"],
    ["remote-disconnect", "interrupted"],
  ] as const)("classifies native %s as %s", (code, kind) => {
    expect(calibrationOutcome(new InferenceTransportError(code))).toBe(kind);
  });
  it("recognizes explicit OOM without confusing auth/cancellation or ordinary server errors", () => {
    const error = (message: string, statusCode: number) =>
      new APICallError({
        message,
        statusCode,
        url: "http://server",
        requestBodyValues: {},
      });
    expect(calibrationOutcome(error("CUDA out of memory", 500))).toBe(
      "resource",
    );
    expect(calibrationOutcome(error("Unauthorized", 401))).toBe("auth");
    expect(calibrationOutcome(error("GPU out of memory", 401))).toBe("auth");
    expect(calibrationOutcome(error("Unavailable", 503))).toBe("provider");
    expect(
      calibrationOutcome(new DOMException("Cancelled", "AbortError")),
    ).toBe("cancelled");
  });
  it("batches passive metadata without synchronous writes or model calls", async () => {
    vi.useFakeTimers();
    try {
      const update = vi.fn(async () => {});
      const batcher = createCalibrationBatcher(update);
      batcher.record({ profileId: "a", sample: calibrationSample() });
      expect(update).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(L.batchMs);
      expect(update).toHaveBeenCalledTimes(1);
      await batcher.flush();
      expect(update).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("isolates persistence failure from inference", async () => {
    const update = vi.fn(async () => {
      throw new Error("Disk failure");
    });
    const batcher = createCalibrationBatcher(update);
    batcher.record({ profileId: "a", sample: calibrationSample() });
    await expect(batcher.flush()).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledTimes(1);
  });
});
