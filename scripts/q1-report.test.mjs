import { describe, expect, it } from "vitest";
import { scenarios, frontendFiles } from "./q1-manifest.mjs";
import { summarize } from "./q1-report.mjs";

function fixture() {
  const names = [...new Set(scenarios.flatMap(s => s.native))].map(p => `fixture${p}case`);
  const native = `${names.map(n => `test ${n} ... ok`).join("\n")}\ntest result: ok. ${names.length} passed; 0 failed; 0 ignored`;
  const vitest = { success: true, numPassedTests: frontendFiles.length, numFailedTests: 0, testResults: frontendFiles.map(file => ({ name: `/repo/${file}`, assertionResults: [{ status: "passed", fullName: "fixture" }] })) };
  const measurements = {
    A: { status: "passed", baselines: { prepared: { criticalRetained: 4, criticalTotal: 4, fitsSmall: true } }, authorizedReferences: 1 },
    B: { status: "passed", cycles: Array.from({ length: 10 }, (_, i) => ({ revision: i + 1, criticalRetained: 4, criticalTotal: 4, references: 1, fitsSmall: true })), queriedOriginalFacts: 1, retrievedRecall: 1 },
    E: { taskCompletion: { completedStages: 4, requiredStages: 4 } },
    F: { requiredEvidenceIncluded: 1 },
  };
  return { native, vitest, measurements };
}
describe("Q1 fail-closed reporting", () => {
  it("accepts a fully enumerated passing fixture without conflating native GUI", () => {
    const f = fixture(); const result = summarize(f.vitest, f.native, f.measurements);
    expect(result.status).toBe("passed");
    expect(result.scenarios).toHaveLength(12);
    expect(result.scenarios.every(s => s.layers.nativeGui.includes("deferred"))).toBe(true);
  });
  it("missing or skipped evidence cannot be called passed", () => {
    const f = fixture(); f.vitest.testResults[0].assertionResults[0].status = "pending";
    expect(summarize(f.vitest, f.native, f.measurements).status).toBe("failed");
    f.vitest.testResults.shift();
    expect(summarize(f.vitest, f.native, f.measurements).status).toBe("failed");
    expect(summarize(f.vitest, "", f.measurements).status).toBe("failed");
    const g = fixture();
    const missing = scenarios.find(s => s.id === "E").native[0];
    expect(summarize(g.vitest, g.native.replace(`fixture${missing}case`, "unmapped_native_case"), g.measurements).status).toBe("failed");
  });
  it("source loss or refusing every task cannot be hidden behind passing averages", () => {
    const f = fixture(); f.measurements.A.baselines.prepared.criticalRetained = 3;
    expect(summarize(f.vitest, f.native, f.measurements).status).toBe("failed");
    f.measurements.A.baselines.prepared.criticalRetained = 4;
    f.measurements.E.taskCompletion.completedStages = 0;
    expect(summarize(f.vitest, f.native, f.measurements).status).toBe("failed");
  });
  it("ten observations of one revision or missing retrieval are not ten compaction cycles", () => {
    const f = fixture(); f.measurements.B.cycles.forEach(c => { c.revision = 1; });
    expect(summarize(f.vitest, f.native, f.measurements).status).toBe("failed");
    const g = fixture(); g.measurements.B.retrievedRecall = 0;
    expect(summarize(g.vitest, g.native, g.measurements).status).toBe("failed");
  });
});
