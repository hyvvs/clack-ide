import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const result = JSON.parse(readFileSync("src/test/fixtures/checkpointed-nemotron-20261022.json", "utf8"));
describe("prospective Nemotron checkpoint acceptance evidence", () => {
  it("starts from the requested base, with no competing run and exact installed model", () => {
    expect(result.base.startsWith("8a4f7bc")).toBe(true);
    expect(result.preflight.isolation).toEqual([]);
    expect(result).toMatchObject({ model: "nemotron-3.5-lightning:30b-a3b-q4_K_M", version: "0.40.5",
      digest: "e7a64ff15fb174c42b4f463e5c888c4f2c7b9cabf9e8d65a1c0874405426c1b2", productionChanges: 0, cloudInference: 0, modelDownloads: 0 });
  });
  it("does not hide the zero-inference prelaunch envelope-guard rejection", () => {
    expect(result.prelaunchRejection).toMatchObject({ inference: 0, specificationSends: 0, missionRequests: 0,
      originalAttempt: { policy_reason: "reasoning_output_changed", requested_num_ctx: 4096, requested_output: 32, network_dispatch: false } });
    expect(readFileSync("scripts/run-checkpointed-nemotron.mjs", "utf8")).not.toContain("CLACK_PRODUCT_EXPECT_AUTOMATIC");
  });
  it("records actual Automatic recommendation, not the anticipated omitted control", () => {
    expect(result.automatic).toMatchObject({ requested: "automatic", effective: "automatic", overrides: {}, status: "Ready", tools: "Verified",
      actualMissionThink: true, expectedOmittedThinkObserved: false, output: 2048, context: { recommended: 65536, loaded: 65536, verified: 65536 }, fallback: "never" });
    expect(result.readiness.map(r => [r.context, r.output, r.think])).toEqual([4096, 8192, 16384, 32768, 49152, 65536].map(n => [n, 32, "omitted"])
      .concat([[65536, 512, "omitted"], [65536, 512, true], [65536, 512, true]]));
  });
  it("keeps readiness, mission dispatches and executed operations distinct", () => {
    expect(result).toMatchObject({ allRequests: 22, missionRequests: 13, nativeCalls: 9, successfulOperations: 9, failedOperations: 0, directWrites: 2 });
    expect(result.responses.filter(r => r.settled === "completed")).toHaveLength(12);
    expect(result.responses.at(-1)).toMatchObject({ settled: "cancelled", inputTokens: null, outputTokens: null, calls: [] });
  });
  it("retains two native source observations without inventing overwrite lineage", () => {
    expect(result.writeObservations.map(w => [w.order, w.path, w.observedCount])).toEqual([[1, "src/types.ts", 1], [2, "src/storage.ts", 2]]);
    expect(result.writeObservations.every(w => w.digest.length === 64 && w.inputHash.length === 64 && w.runId === result.timings.start &&
      w.observedBeforeAcknowledged && w.currentSnapshot === null && w.previousSnapshot === null && w.previousDigest === null && !w.eligible && !w.projected)).toBe(true);
  });
  it("does not equate observed writes with exercised pressure projection", () => {
    expect(result).toMatchObject({ eligibleWrites: 0, projectedWrites: 0, nativePreparationCalls: 0 });
    expect(result.checkpoint).toMatchObject({ activation: null, rawTokensRemoved: 0, receiptCost: 0, netSavings: 0, providerReduction: 0,
      originalWriteBodiesRetained: true, durableTranscriptExact: true, staleReuse: false });
    expect(result.context.maximumPressureRatio).toBeLessThan(0.7);
    expect(result.nativePayloads.every(p => p.checkpointReceipts === 0)).toBe(true);
  });
  it("does not send an unqualified correction or discard active intent", () => {
    expect(result.specificationSends).toBe(1);
    expect(result.specificationSha256).toBe("f97ec34eefa136ac5be5847187f768b64bf5587d36140d9fcc53b695fa3e4801");
    expect(result.correction).toMatchObject({ sent: false, page25: "not applicable" });
    expect(result.checkpoint.objectiveExact).toBe(true);
    expect(result.checkpoint.pseudoToolsExecuted).toBe(false);
    expect(result.checkpoint.olderDraftsRaw).toBe(true);
  });
  it("keeps all three unfinished answers exact with full coding routes", () => {
    expect(result.continuations.map(c => [c.after, c.next, c.partialChars])).toEqual([["inference-19", "inference-20", 7927], ["inference-20", "inference-21", 7971], ["inference-21", "inference-22", 8000]]);
    expect(result.continuations.every(c => c.exactPartialRetained && c.objectiveRetained && c.toolsExposed === 14 && c.plan.length === 13 && c.plan.every(t => t.status === "pending"))).toBe(true);
    expect(result.context.F1).toBe(true);
  });
  it("distinguishes the continuation deadline from protected context or a host timeout", () => {
    expect(result.stop).toMatchObject({ classification: "PRODUCT RUNTIME / ANSWER CONTINUATION DEADLINE / INCOMPLETE", deadlineMs: 120000,
      continuationTimeMs: 120000, finalBodyBytes: 0, notOverall600s: true, notHarnessTimeout: true, confirmedProductionDefect: false });
    expect(result.context).toMatchObject({ protectedBlock: false, guardRejected: false, minimumHeadroom: 25604, maximumRequired: 39932 });
    expect(result.runnerExit).toMatchObject({ code: 0, signal: null });
  });
  it("does not award product completion for two source files or default npm scripts", () => {
    expect(result.application).toMatchObject({ executedAPI: 0, passedAPI: 0, failedAPI: 0, blockedAPI: 19, readme: false, runtimeIgnore: false, evaluatorRepairs: 0 });
    expect(result.application.commands.map(c => c.code)).toEqual([1, 1, 1]);
    expect(result.sourceFiles.map(f => f.path)).toEqual(["package-lock.json", "package.json", "src/storage.ts", "src/types.ts", "tsconfig.json"]);
    expect(result.usability).toBe("LOCAL AGENT USABILITY STILL LIMITED");
  });
  it("labels marginal draft inventory as diagnosis rather than achieved savings", () => {
    expect(result.inventory).toMatchObject({ allTextualDraftsMarginal: 12621, olderDraftsMarginal: 8390, currentPartialMarginal: 4231 });
    expect(result.checkpoint.netSavings).toBe(0);
    expect(result.sourceFrozen).toBe(977);
    expect(result.artifacts.every(a => /^[a-f0-9]{64}$/.test(a.sha256))).toBe(true);
  });
  it("exposes every native checkpoint operation through observation-only adapters", () => {
    const host = readFileSync("src-tauri/examples/hardened_agent_acceptance.rs", "utf8");
    const adapter = readFileSync("src-tauri/examples/support/checkpoint_observation.rs", "utf8");
    for (const operation of ["observe", "prepare", "validate", "restore"]) {
      expect(host).toContain(`checkpoint_observation::conversation_checkpoint_${operation}`);
      expect(adapter).toContain(`checkpoint::conversation_checkpoint_${operation}`);
    }
    expect(adapter).toContain('"manifest":manifest');
  });
});
