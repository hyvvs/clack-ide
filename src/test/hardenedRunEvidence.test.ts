import { describe, expect, it } from "vitest";
import evidence from "@/test/fixtures/hardened-qwen-20261021.json";

describe("one frozen hardened-runtime Qwen mission", () => {
  it("keeps readiness separate from the single mission", () => {
    expect(evidence.model).toBe("qwen3-coder:30b");
    expect(evidence.digest).toBe("06c1097efce0431c2045fe7b2e5108366e43bee1b4603a7aded8f21689e90bca");
    expect(evidence.readinessRequests).toBe(9);
    expect(evidence.missionRequests).toBe(20);
    expect(evidence.responses).toHaveLength(29);
    expect(evidence.userMessages).toHaveLength(2);
    expect(evidence.userMessages[0].sha256).toBe("f97ec34eefa136ac5be5847187f768b64bf5587d36140d9fcc53b695fa3e4801");
  });
  it("proves production Automatic reasoning and measured context on every request", () => {
    expect(evidence.automatic.tools).toBe("Verified");
    expect(evidence.automatic.agentRecommendation).toEqual({ choice: "none", wire: false });
    expect(evidence.automatic.context).toMatchObject({ verified: 65536, recommended: 65536, loaded: 65536 });
    expect(evidence.toolsByRequest.every(r => r.think === false && r.context === 65536 && r.output === 2048)).toBe(true);
  });
  it("counts actual native calls and file effects, not displayed markup", () => {
    expect(evidence.structuredCalls).toBe(17);
    expect(evidence.successfulTools).toBe(17);
    expect(evidence.failedTools).toBe(0);
    expect(evidence.fileWrites).toBe(12);
    expect(evidence.directoryCreations).toBe(4);
    expect(evidence.successfulMutations).toBe(16);
    expect(evidence.sourceFreeze.files).toHaveLength(11);
    expect(evidence.sourceFreeze.files.some(f => f.path.endsWith("App.tsx"))).toBe(false);
    expect(evidence.textualToolIntents).toBe(1);
  });
  it("does not invent usage for the request cancelled at the correction boundary", () => {
    const interrupted = evidence.responses.find(r => r.requestId === "inference-19");
    expect(interrupted).toMatchObject({ finish: null, inputTokens: null, outputTokens: null });
    expect(evidence.correction.sent).toBe(1);
    expect(evidence.correction.boundary.writes.length).toBeGreaterThanOrEqual(3);
    expect(evidence.correction.finalBackendPageSize).toBe(25);
  });
  it("retains implementation capability and accurately distinguishes continuation types", () => {
    expect(evidence.toolsByRequest.every(r => r.tools.includes("write_file") && r.tools.includes("bash_run"))).toBe(true);
    expect(evidence.continuations).toMatchObject({ answer: 1, agentSoftLimit: 0, manual: 0 });
    expect(evidence.responses[evidence.responses.length - 2]).toMatchObject({ requestId: "inference-28", finish: "length", calls: [] });
    expect(evidence.responses[evidence.responses.length - 1]).toMatchObject({ requestId: "inference-29", finish: "stop", calls: [] });
    expect(evidence.terminal.confirmedClackDefect).toBe(false);
  });
  it("qualifies reconstructed budgets instead of fabricating independent native counters", () => {
    expect(evidence.context.minimumReconstructedWireHeadroom).toBe(27518);
    expect(evidence.context.directSdkHeadroom).toBeNull();
    expect(evidence.context.directNativeAcknowledgementHeadroom).toBeNull();
    expect(evidence.context.budgets.every(b => b.context - b.required === b.headroom)).toBe(true);
    expect(evidence.context.budgets.every(b => b.provenance === "estimated")).toBe(true);
    expect(evidence.context).toMatchObject({ compactions: 0, retrievals: 0, extractions: 0, protectedBlock: false });
  });
  it("preserves failures from the independent audit without promoting a partial app to complete", () => {
    expect(evidence.independentApi).toMatchObject({ passed: 13, failed: 6 });
    expect(evidence.independentApi.checks.find(c => c.name.includes("persistence across"))?.passed).toBe(false);
    expect(evidence.usability).toBe("LOCAL AGENT USABILITY STILL LIMITED");
    expect(evidence.terminal.classification).toBe("MODEL-INCOMPLETE / TEXTUAL TOOL INTENT / PREMATURE STOP");
    expect(evidence.cloudInference).toBe(0);
    expect(evidence.modelDownloads).toBe(0);
    expect(evidence.remoteMutations).toBe(0);
  });
});
