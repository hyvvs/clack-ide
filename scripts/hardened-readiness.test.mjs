import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reconstructReadiness } from "./audit-hardened-readiness.mjs";

const evidence = JSON.parse(readFileSync("src/test/fixtures/hardened-nemotron-20261021.json", "utf8"));
const qwen = JSON.parse(readFileSync("src/test/fixtures/hardened-qwen-20261021.json", "utf8"));

describe("frozen Nemotron production Automatic readiness", () => {
  it("uses the exact installed revision, not another model or a manual configuration", () => {
    expect(evidence.model).toBe("nemotron-3.5-lightning:30b-a3b-q4_K_M");
    expect(evidence.digest).toBe("e7a64ff15fb174c42b4f463e5c888c4f2c7b9cabf9e8d65a1c0874405426c1b2");
    expect(evidence.automatic.overrides).toEqual({});
    expect(evidence.automatic.providerDefault).toBe(true);
    expect(evidence.automatic.supported).toEqual({ none: false, on: true, medium: "medium" });
    expect(evidence.automatic.wireReasoning).toEqual(["omitted"]);
    expect(evidence.automatic.verifiedAgentRecommendation).toBeNull();
    expect(evidence.responses.every(r => r.model === evidence.model)).toBe(true);
  });
  it("separates six real calibration allocations from the bounded tool probe", () => {
    expect(evidence.readinessRequests).toBe(7);
    expect(evidence.calibrationRequests).toBe(6);
    expect(evidence.toolVerificationRequests).toBe(1);
    expect(evidence.automatic.calibration.attempts.map(a => [a.requested, a.loaded, a.outcome])).toEqual(
      [4096, 8192, 16384, 32768, 49152, 65536].map(n => [n, n, "success"]));
    expect(evidence.automatic.advertisedContext).toBe(1048576);
    expect(evidence.context.verified).toBe(65536);
    expect(evidence.automatic.finalLoaded[0].context).toBe(65536);
    expect(evidence.automatic.missionContext).toBeNull();
    expect(evidence.automatic.missionOutput).toBeNull();
  });
  it("retains a complete length-limited provider response, not an engine stall", () => {
    expect(evidence.responses[6]).toMatchObject({ context: 65536, output: 512, finish: "length",
      outputTokens: 512, inputTokens: 335, nativeCalls: 0, textChars: 29, thinkingChars: 1604,
      partialDsmlIntent: true, settled: "completed" });
    expect(evidence.automatic.tools).toMatchObject({ status: "incomplete", outcome: "output-length", proof: null });
    expect(evidence.terminal).toMatchObject({ classification: "PRODUCT READINESS / TOOL VERIFICATION INCOMPLETE / OUTPUT-LENGTH",
      deadline: false, engineStall: false, confirmedClackDefect: false, automaticRegressionEstablished: false });
  });
  it("does not fabricate a ForgeBoard attempt, correction, effects or application failures", () => {
    expect(evidence).toMatchObject({ missionRequests: 0, specificationSubmissions: 0, corrections: 0, continuations: 0,
      nativeCalls: 0, successfulTools: 0, failedTools: 0, writes: 0, directories: 0, shells: 0, approvals: 0 });
    expect(evidence.sourceFreeze.authoredFiles).toEqual([]);
    expect(evidence.sourceFreeze.changedDuringRun).toEqual([]);
    expect(evidence.application.backendAudit).toBe("NOT RUN - no implementation");
    expect(evidence.context.minimumHeadroom).toBeNull();
    expect(evidence.terminal.missionOutcome).toContain("INCONCLUSIVE");
  });
  it("distinguishes native clean exit from the runner's readiness assertion", () => {
    expect(evidence.process.native).toMatchObject({ code: 0, signal: null });
    expect(evidence.process.runnerExit).toBe(1);
    expect(evidence.artifacts).toHaveLength(8);
    expect(evidence.artifacts.every(a => /^[a-f0-9]{64}$/.test(a.sha256))).toBe(true);
    expect(evidence).toMatchObject({ cloudInference: 0, modelDownloads: 0, remoteMutations: 0, manualRetries: 0 });
  });
  it("does not turn a readiness rejection into a new model-quality ranking", () => {
    expect(qwen).toMatchObject({ missionRequests: 20, structuredCalls: 17, fileWrites: 12 });
    expect(qwen.independentApi.passed).toBe(13);
    expect(evidence.missionRequests).toBe(0);
    expect(evidence.usability).toContain("task quality not evaluated");
  });
});

function sample() {
  const model = evidence.model, digest = evidence.digest;
  const request = { requestId: "inference-1", at: 10, url: "http://127.0.0.1:11435/api/chat",
    body: { model, options: { num_ctx: 65536, num_predict: 512 }, tools: [{ function: { name: "get_probe_value" } }], messages: [] } };
  const report = { stage: "readiness", ok: false, sessions: [], conversations: [], settings: { profiles: [{ transportModelId: model,
    modelRevision: digest, overrides: {}, contextCalibration: { highest: 65536 }, toolVerification: { status: "incomplete", outcome: "output-length" } }] },
    initialHealth: { body: { version: "fixture" } }, finalModels: { models: [] }, destinations: [request.url],
    startedAt: 1, endedAt: 30, root: "fixture", runId: "fixture", error: "Incomplete" };
  const initial = { kind: "readiness-start", at: 2, model, digest,
    before: { reasoning: { providerDefault: true, capability: { ollamaControls: {} } }, context: { advertised: 1048576 } } };
  const raw = JSON.stringify({ message: { content: "<\uff5cDSML\uff5cfunction_calls>", thinking: "fixture reasoning" }, done: true,
    done_reason: "length", eval_count: 512, prompt_eval_count: 335 }) + "\n";
  const bytes = new TextEncoder().encode(raw);
  const chunk = part => ({ kind: "hardened-native-event", at: 20, event: { requestId: request.requestId, kind: "chunk", bytes: [...part] } });
  const split = bytes.findIndex(b => b > 127) + 1;
  return { report, requests: [request], events: [initial, chunk(bytes.slice(0, split)), chunk(bytes.slice(split))], raw, chunk };
}

describe("readiness evidence reconstruction boundaries", () => {
  it("decodes split UTF-8 without interpreting textual intent as a native call", () => {
    const f = sample(), result = reconstructReadiness(f.report, f.requests, f.events);
    expect(result.responses[0]).toMatchObject({ partialDsmlIntent: true, nativeCalls: 0, finish: "length", outputTokens: 512 });
    expect(result.partialTextualIntents).toBe(1);
  });
  it("does not infer provider usage when no final frame arrived", () => {
    const f = sample();
    f.events.splice(1, 2, f.chunk(new TextEncoder().encode(JSON.stringify({ message: { content: "partial" }, done: false }) + "\n")));
    expect(reconstructReadiness(f.report, f.requests, f.events).responses[0]).toMatchObject({ finish: null, inputTokens: null, outputTokens: null });
  });
  it("rejects a report with an already-created mission session", () => {
    const f = sample(); f.report.sessions.push({ id: "real-mission-a" });
    expect(() => reconstructReadiness(f.report, f.requests, f.events)).toThrow(/mission session/);
  });
  it("rejects another model or inference destination", () => {
    const f = sample(); f.requests[0].body.model = "unauthorized";
    expect(() => reconstructReadiness(f.report, f.requests, f.events)).toThrow(/No other model/);
    f.requests[0].body.model = evidence.model; f.requests[0].url = "https://other.invalid";
    expect(() => reconstructReadiness(f.report, f.requests, f.events)).toThrow();
  });
  it("rejects a secretly submitted specification", () => {
    const f = sample(); f.requests[0].body.messages.push({ content: "Build ForgeBoard from scratch" });
    expect(() => reconstructReadiness(f.report, f.requests, f.events)).toThrow();
  });
  it("fails closed on truncated transport frames rather than calling them complete", () => {
    const f = sample(); f.events.splice(1, 2, f.chunk(new TextEncoder().encode(f.raw.trim())));
    expect(() => reconstructReadiness(f.report, f.requests, f.events)).toThrow(/Incomplete NDJSON/);
  });
});
