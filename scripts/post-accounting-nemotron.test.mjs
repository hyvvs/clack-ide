import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyReadinessAbort } from "./audit-post-accounting-nemotron.mjs";
const result = JSON.parse(readFileSync("src/test/fixtures/post-accounting-nemotron-20261021.json", "utf8"));

describe("post-accounting fresh Nemotron acceptance evidence", () => {
  it("retains the exact authorized model, digest, base and unchanged route", () => {
    expect(result.base).toBe("f662fb55509ab67d3fe1ed63ff643b0671431630");
    expect(result.model).toBe("nemotron-3.5-lightning:30b-a3b-q4_K_M");
    expect(result.digest).toBe("e7a64ff15fb174c42b4f463e5c888c4f2c7b9cabf9e8d65a1c0874405426c1b2");
    expect(result.providerVersion).toBe("0.40.5");
    expect(result.route).toContain("http://127.0.0.1:11435");
  });
  it("distinguishes an intercepted request from a forwarded inference", () => {
    expect(result).toMatchObject({ providerReadinessRequests: 1, interceptedRequests: 2,
      rejectedSecondRequest: { forwarded: false, captured: false, exactBody: null } });
  });
  it("does not invent a ForgeBoard mission or a model product failure", () => {
    expect(result).toMatchObject({ specificationSends: 0, missionRequests: 0, nativeMissionCalls: 0,
      sourceMutations: 0, confirmedProductionDefect: false, classification: "TEST_HARNESS / PREMISSION ABORT / INCONCLUSIVE" });
    expect(result.productAudit).toMatchObject({ performed: false, executed: 0, passed: null, failed: null, blocked: null });
    expect(result.freeze.files).toEqual([]);
  });
  it("preserves the actual probe deadline without changing or inferring capacity", () => {
    expect(result.coldReadinessTimeoutMs).toBe(75002);
    expect(result.readiness.calibration).toMatchObject({ status: "incomplete", highest: null, failure: "timeout" });
    expect(result.request.body.options).toEqual({ num_ctx: 4096, num_predict: 32 });
    expect(result.configuration).toMatchObject({ selectedReasoning: "automatic", firstProbeThink: "omitted", missionContext: null, loadedContext: null, missionOutput: null });
    expect(result.readiness.overrides).toEqual({});
  });
  it("does not infer provider token counts or a finish from a cancelled request", () => {
    expect(result.request.response).toMatchObject({ settled: "cancelled", finish: null, inputTokens: null, outputTokens: null, calls: [] });
  });
  it("ties the exit to the recorded non-unwinding assertion, not an assumed watchdog", () => {
    expect(result.runner).toMatchObject({ hostExitHex: "0xC0000409", hostExit: { code: 3221226505 }, elapsedMs: 83752 });
    expect(result.runner.panic.join("\n")).toContain("num_ctx");
    expect(result.runner.panic.join("\n")).toContain("cannot unwind");
  });
  it("does not claim the accounting fix was naturally exercised by a long mission", () => {
    expect(result.accounting).toMatchObject({ missionObserved: false, maximumRequired: null, minimumHeadroom: null,
      excludedAnnotations: null, excludedEstimatedTokens: null, receiptSavings: null });
    expect(result.configuration).toMatchObject({ cloudInference: 0, downloads: 0, fallback: "never" });
  });
  it("retains immutable evidence references and untouched source checks", () => {
    expect(result.artifacts).toHaveLength(8);
    expect(result.artifacts.every(a => /^[a-f0-9]{64}$/.test(a.sha256))).toBe(true);
    expect(result.freeze.sourceUnchanged).toBe(948);
  });
  it("rejects attempts to use the premission classifier after specification dispatch", () => {
    expect(() => classifyReadinessAbort({ requests: [result.request], events: [{ kind: "state" }],
      failure: { childExit: result.runner.hostExit, nativeLog: result.runner.panic.join("\n") }, calibration: result.readiness.calibration })).toThrow();
  });
});
