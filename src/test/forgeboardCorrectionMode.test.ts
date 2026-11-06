import { describe, expect, it } from "vitest";
import { shouldObserveForgeBoardCorrection } from "@/test/forgeboardCorrectionMode";

describe("one-shot ForgeBoard correction monitoring", () => {
  const state = { phase: "mission-a" as const, singleSpec: true, alreadyCorrected: false,
    correcting: false, harnessStopped: false };

  it("keeps the observer active in a single mission even with singleSpec enabled", () => {
    expect(shouldObserveForgeBoardCorrection(state)).toBe(true);
    expect(shouldObserveForgeBoardCorrection({ ...state, singleSpec: false })).toBe(true);
  });

  it("stops observation after a correction is claimed or sent, or on harness stop", () => {
    expect(shouldObserveForgeBoardCorrection({ ...state, correcting: true })).toBe(false);
    expect(shouldObserveForgeBoardCorrection({ ...state, alreadyCorrected: true })).toBe(false);
    expect(shouldObserveForgeBoardCorrection({ ...state, harnessStopped: true })).toBe(false);
  });
});
