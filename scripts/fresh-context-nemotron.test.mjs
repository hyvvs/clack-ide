import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { protectedStop } from "./audit-fresh-context-nemotron.mjs";

const result = JSON.parse(readFileSync("src/test/fixtures/fresh-context-nemotron-20261021.json", "utf8"));
describe("fresh Nemotron with hardened context diagnostics", () => {
  it("retains exact identity and the existing saved connection without new endpoint controls", () => {
    expect(result).toMatchObject({ base: "88a95ef0939dad557253af6f708e7c4e518f28a7", model: "nemotron-3.5-lightning:30b-a3b-q4_K_M",
      digest: "e7a64ff15fb174c42b4f463e5c888c4f2c7b9cabf9e8d65a1c0874405426c1b2", providerVersion: "0.40.5", connection: { id: "real-qwen", newEndpoint: false, configurationRevision: 1 } });
    expect(result.preflight.isolation).toEqual([]);
    expect(result.savedConnection.sha256).toBe("017900d9f8cfc4b208b660024f3c8ec69ecfc84ad4a12839ad6db1e8e21702cd");
  });
  it("separates seven normal readiness probes from the actual 33-request mission", () => {
    expect(result.readiness.controls.map(r => [r.context, r.output])).toEqual([4096, 8192, 16384, 32768, 49152, 65536].map(n => [n, 32]).concat([[65536, 512]]));
    expect(result.readiness).toMatchObject({ requests: 7, timeouts: 0, toolOutcome: "native-call" });
    expect(result.readiness.attempts.every(a => a.outcome === "success")).toBe(true);
    expect(result.missionRequests).toBe(33);
    expect(result.missionRequests).toBeLessThan(40);
  });
  it("records Ready/Verified Automatic controls without a forced profile override", () => {
    expect(result.automatic).toMatchObject({ choice: "automatic", tools: "Verified", status: "Ready", providerDefault: true,
      context: { recommended: 65536, verified: 65536, loaded: 65536, advertised: 1048576 }, output: 2048, profileOverrides: {}, fallback: "never", cloudInference: 0 });
    expect(result.controls.every(c => c.context === 65536 && c.output === 2048 && c.think === "omitted")).toBe(true);
  });
  it("does not mistake the product budget stop for a harness context rejection", () => {
    expect(result.guard).toMatchObject({ attempted: 40, accepted: 40, rejected: 0, maxRequested: 65536, rejectedValue: null,
      rejectedAttemptId: null, rejectedProviderId: null, rejectionExitCode: null });
    expect(result.terminal).toMatchObject({ classification: "PRODUCT RUNTIME / PROTECTED CONTEXT BUDGET", errorCode: "answer-continuation-budget", harnessRejected: false });
  });
  it("keeps actual tool successes separate from failed shell exits", () => {
    expect(result).toMatchObject({ nativeCalls: 29, successfulTools: 25, failedTools: 4, directWrites: 5, directoryTools: 0, approvals: 0 });
    expect(result.shells).toHaveLength(12);
    expect(result.shells.filter(s => s.exit !== 0)).toHaveLength(4);
    expect(result.uniqueDirectFiles).toHaveLength(3);
    expect(result.effects).toHaveLength(29);
  });
  it("preserves exactly one original specification and one qualified correction", () => {
    expect(result.specificationSends).toBe(1);
    expect(result.userMessages.map(m => m.sha256)).toEqual(["f97ec34eefa136ac5be5847187f768b64bf5587d36140d9fcc53b695fa3e4801", "9e532209ebeeb8ca4e061d91f684635cd9a154854ce6a63602801c7bff4b69cc"]);
    expect(result.correction).toMatchObject({ count: 1, confirmedWriteEvents: 3, pageEvidence: { kind: "current-accepted-plan" }, sourcePageSize: 25, livePageSize: null,
      objectivePresent: true, codingToolsPresent: true, firstNextRequest: "inference-19" });
  });
  it("keeps F1 coding routes on every dispatched mission and continuation", () => {
    expect(result.controls.every(c => ["read_file", "write_file", "bash_run"].every(t => c.tools.includes(t)))).toBe(true);
    expect(result.continuations.records.filter(c => c.next).every(c => c.objectivePresent && c.pendingPlan.length === 5 && c.planStateAt > 0 && ["read_file", "write_file", "bash_run"].every(t => c.tools.includes(t)))).toBe(true);
  });
  it("distinguishes two dispatched length continuations from the blocked third preparation", () => {
    expect(result.continuations).toMatchObject({ answerRecorded: 3, dispatched: 2, blocked: 1, agentSoftLimit: 0, manual: 0 });
    expect(result.continuations.records.map(c => [c.after, c.next])).toEqual([["inference-32", "inference-33"], ["inference-36", "inference-37"], ["inference-40", null]]);
    expect(result.continuations.records.every(c => c.trigger === "provider length finish")).toBe(true);
  });
  it("preserves partial textual intent without executing it as a native tool", () => {
    expect(result.responseClasses).toMatchObject({ native: 29, proseAlongsideNative: 11, proseWithoutNative: 3,
      textualPseudoToolIntents: 3, outputLength: 3, emptyCompleted: 0, cancelled: 1, providerDeadline: 0 });
    expect(result.responses.filter(r => r.phase === "mission" && r.finish === "length").every(r => r.calls.length === 0 && r.textualIntent && r.outputTokens === 2048)).toBe(true);
    expect(result.effects.filter(e => e.path?.endsWith("frontend/src/App.tsx") && e.name === "tool-write_file")).toEqual([]);
  });
  it("does not fabricate finish/usage for the request cancelled at the correction boundary", () => {
    const cancelled = result.responses.filter(r => r.phase === "mission" && r.settled === "cancelled");
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]).toMatchObject({ finish: null, inputTokens: null, outputTokens: null });
  });
  it("records admitted and blocked protected budgets as different request stages", () => {
    expect(result.context).toMatchObject({ maximumDispatchedRequired: 64805, minimumDispatchedHeadroom: 731,
      maximumProtectedRequired: 68889, minimumProtectedHeadroom: -3353,
      blocked: { input: 60764, output: 2048, margin: 6077, ceiling: 65536, system: 3888, schemas: 5795, history: 51081,
        required: 68889, headroom: -3353, requestId: null, networkDispatch: false, estimate: true } });
    expect(result.context.dispatched.every(b => b.headroom >= 0)).toBe(true);
  });
  it("excludes actual local answer annotations and source-verifies the active receipt", () => {
    expect(result.accounting.localAnswer).toEqual({ annotationParts: 62, providerWireOccurrences: 0, sharedEstimatorDeltaAfterRemovingAnnotations: 0, originalTranscriptUnchanged: true });
    expect(result.accounting.receipts).toMatchObject({ requestId: "inference-40", count: 1, before: 48623, after: 47410, savedEstimatedTokens: 1213, providerTokenSavings: null });
    expect(result.accounting.receipts.receipts[0].source.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.context).toMatchObject({ memoryRevision: null, successfulCompactions: 0, retrievalToolCalls: 0, retrievalTotal: null, extractionTotal: null });
  });
  it("uses real chronology and leaves unachieved milestones unavailable", () => {
    expect(result.timings).toMatchObject({ elapsedMs: 581798, totalRunnerMs: 640504, firstOutputMs: 12189, firstNativeCallMs: 19261, firstDirectWriteMs: 92538,
      startupMs: null, persistenceMs: null, SSEMs: null, substantiveFrontendMs: null, authoredTestMs: null, passingAuthoredTestMs: null, modelProductionBuildMs: null });
    expect(result.shellIdentity.advertised).toEqual(["shell: PowerShell (pwsh.exe)", "shell_syntax: PowerShell; not POSIX Bash"]);
  });
  it("does not call blocked backend checks executed API failures", () => {
    expect(result.application.independent).toMatchObject({ startup: { executed: 1, passed: 0, failed: 1 }, backend: { executed: 0, passed: 0, failed: 0, blocked: 22 }, evaluatorRepairs: 0 });
    expect(result.application.independent.persistence.status).toBe("blocked");
    expect(result.application.independent.sse.status).toBe("blocked");
    expect(result.application.independent.commands.map(c => [c.name, c.code])).toEqual([["test", 1], ["build", 1], ["start", 1], ["typecheck", 1], ["frontend-build", 0], ["entry", 1]]);
  });
  it("separates the buildable keyboard-operable Vite demo from a working ForgeBoard UI", () => {
    expect(result.application.frontend).toMatchObject({ rendered: true, scaffoldKeyboardCounter: true, forgeBoardHeading: 0, pageErrors: [], networkAPIRequests: [], widths: [1280, 390] });
    expect(Object.values(result.application.frontend.productFunctionality).every(v => v === "not implemented")).toBe(true);
    expect(result.application).toMatchObject({ rootReadme: false, rootIgnore: false, meaningfulAuthoredTests: 0, modelTestsExecuted: 0, modelBuildsExecuted: 0 });
  });
  it("retains source/artifact provenance without claiming a new model-quality winner", () => {
    expect(result.sourceFreeze).toEqual({ sourceFilesUnchanged: 955, originalWorkspaceUnchanged: true, evaluatorRepairs: 0 });
    expect(result.application.sourceFilesFrozen).toBe(25);
    expect(result.artifacts).toHaveLength(22);
    expect(result.artifacts.every(a => /^[a-f0-9]{64}$/.test(a.sha256))).toBe(true);
    expect(result).toMatchObject({ usability: "LOCAL AGENT USABILITY STILL LIMITED", productionChanges: 0, modelDownloads: 0, cloudInference: 0, remoteChanges: 0, manualTunnelChanges: 0 });
    expect(result.terminal).toMatchObject({ modelVoluntaryStop: false, confirmedClackDefect: false });
    expect(result.nextCheckpoint).toBe("Audit Length-Continuation Protected-Context Preparation");
  });
});

describe("protected-stop evidence parser", () => {
  const details = "Input estimate: 60764\nOutput reserve: 2048\nSafety margin: 6077\nEffective ceiling: 65536\nSystem total: 3888\nSchema/options total: 5795\nConversation total: 51081";
  it("computes the exact unforwarded preparation without a native request ID", () => {
    expect(protectedStop({ error: { errorCode: "answer-continuation-budget", details } })).toMatchObject({ required: 68889, headroom: -3353, networkDispatch: false, requestId: null });
  });
  it("rejects another error layer, incomplete data and inconsistent totals", () => {
    expect(() => protectedStop({ error: { errorCode: "provider-timeout", details } })).toThrow();
    expect(() => protectedStop({ error: { errorCode: "answer-continuation-budget", details: "" } })).toThrow();
    expect(() => protectedStop({ error: { errorCode: "answer-continuation-budget", details: details.replace("60764", "60765") } })).toThrow();
  });
  it("pins the authoritative specification hash independently of the generated output", () => {
    const text = readFileSync("src/test/realLocalProductAcceptance.tsx", "utf8").match(/const mission = `([\s\S]*?)`;/)[1];
    // JavaScript template literal evaluation normalizes CRLF (and CR) to LF.
    // Hash the actual runtime string, not platform checkout line endings.
    expect(createHash("sha256").update(text.replace(/\r\n?/g, "\n")).digest("hex")).toBe(result.userMessages[0].sha256);
  });
});
