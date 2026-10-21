import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeResponse, sourcePageSize, toolFailed } from "./audit-fresh-nemotron.mjs";

const current = JSON.parse(readFileSync("src/test/fixtures/fresh-nemotron-20261021.json", "utf8"));
const qwen = JSON.parse(readFileSync("src/test/fixtures/hardened-qwen-20261021.json", "utf8"));

describe("one fresh frozen Nemotron ForgeBoard mission", () => {
  it("uses production Automatic on the exact installed revision, not manual tuning", () => {
    expect(current.model).toBe("nemotron-3.5-lightning:30b-a3b-q4_K_M");
    expect(current.digest).toBe("e7a64ff15fb174c42b4f463e5c888c4f2c7b9cabf9e8d65a1c0874405426c1b2");
    expect(current.version).toBe("0.40.5");
    expect(current.automatic).toMatchObject({ tools: "Verified", readiness: "Ready", effective: {}, providerDefault: true, profile: { overrides: {} } });
    expect(current.controls.every(r => r.context === 65536 && r.output === 2048 && r.think === "omitted")).toBe(true);
    expect(current.readiness).toMatchObject({ requests: 7, context: 6, tools: 1 });
  });
  it("preserves one specification and one authorized correction with full objective/capabilities", () => {
    expect(current.userMessages).toHaveLength(2);
    expect(current.userMessages[0].sha256).toBe("f97ec34eefa136ac5be5847187f768b64bf5587d36140d9fcc53b695fa3e4801");
    expect(current.correction).toMatchObject({ count: 1, nextRequest: "inference-28", originalObjective: true, fullCapabilities: true, sourcePageSize: 25, dynamicPageSize: null });
    expect(current.correction.boundary.writes.length).toBeGreaterThanOrEqual(3);
    expect(current.controls.every(r => ["read_file", "write_file", "bash_run"].every(n => r.tools.includes(n)))).toBe(true);
  });
  it("counts unsuccessful shell exits as failures instead of successful tool protocol deliveries", () => {
    expect(current).toMatchObject({ missionRequests: 40, nativeCalls: 39, successfulTools: 30, failedTools: 9 });
    expect(current.writes).toEqual({ verifiedDirect: 13, writeFile: 9, edits: 4 });
    expect(current.shells).toHaveLength(11);
    expect(current.shells.filter(s => s.code !== 0)).toHaveLength(6);
    expect(current.effects.filter(e => e.failed)).toHaveLength(9);
    expect(current.approvals).toEqual([]);
  });
  it("does not fabricate provider usage for the cancelled correction-boundary request", () => {
    expect(current.responses).toHaveLength(47);
    expect(current.responses.find(r => r.requestId === "inference-27")).toMatchObject({ settled: "cancelled", finish: null, inputTokens: null, outputTokens: null });
    expect(current.responseClasses).toEqual({ proseAlongsideNative: 15, proseWithoutNative: 0, textualToolIntents: 0, emptyCompleted: 0, outputLength: 0 });
    expect(current.continuations).toEqual({ answer: 0, softLimit: 0, manual: 0 });
  });
  it("separates the estimated local guard from actual provider token measurements", () => {
    const b = current.context.block;
    expect(b).toEqual({ system: 3755, schemas: 6244, conversation: 47963, input: 57962, reserve: 2048, margin: 5797, ceiling: 65536, required: 65807, deficit: 271 });
    expect(b.input + b.reserve + b.margin - b.ceiling).toBe(271);
    expect(current.context.minimumAdmittedHeadroom).toBe(3987);
    expect(current.context.lastProviderInput).toBe(27025);
    expect(current.context.sdkCounter).toBeNull();
    expect(current.context.independentNativeCounter).toBeNull();
    expect(current.terminal.classification).toBe("PRODUCT RUNTIME / PROTECTED CONTEXT BUDGET");
    expect(current.terminal.confirmedClackDefect).toBe(false);
  });
  it("traces three receipts to immutable source identity and qualifies offline savings", () => {
    expect(current.context).toMatchObject({ receipts: 3, savings: 3711, successfulCompactions: 0, memoryRevision: null, retrievals: 0, extractions: 0 });
    expect(current.context.receiptEvidence).toMatchObject({ before: 47567, after: 43856, savedEstimatedTokens: 3711 });
    expect(current.context.receiptEvidence.receipts.every(r => r.source.sessionId === "real-mission-a" && /^[a-f0-9]{64}$/.test(r.source.digest))).toBe(true);
  });
  it("records a startup failure and blocked checks, not nineteen executed API failures", () => {
    expect(current.sourceFreeze.files).toHaveLength(9);
    expect(current.independent).toMatchObject({ passed: 0, failed: 1, blocked: 18, evaluatorRepairs: 0, sourceUnchanged: true });
    expect(current.independent.commands.every(c => c.code === 1 && !c.timedOut)).toBe(true);
    expect(current.sourceFreeze.files.some(f => /\.tsx$|index\.html$|README|\.gitignore/.test(f.path))).toBe(false);
    expect(current).toMatchObject({ cloudInference: 0, modelDownloads: 0, evaluatorRepairs: 0 });
  });
  it("keeps the Qwen comparison evidence separate from this runtime-limited outcome", () => {
    expect(qwen).toMatchObject({ missionRequests: 20, structuredCalls: 17, fileWrites: 12 });
    expect(qwen.independentApi.passed).toBe(13);
    expect(current.nativeCalls).toBeGreaterThan(qwen.structuredCalls);
    expect(current.independent.passed).toBe(0);
    expect(current.usability).toContain("runtime context-limited");
  });
});

describe("auditor boundaries", () => {
  it.each([
    [{ type: "tool-bash_run", state: "output-available", output: { exit_code: 0 } }, false],
    [{ type: "tool-bash_run", state: "output-available", output: { exit_code: 1 } }, true],
    [{ type: "tool-write_file", state: "output-available", output: { error: "missing directory" } }, true],
    [{ type: "tool-read_file", state: "output-error" }, true],
  ])("distinguishes effects from transport success", (part, failed) => expect(toolFailed(part)).toBe(failed));
  it("uses TypeScript declarations, not comments, to inspect corrected page size", () => {
    expect(sourcePageSize("// pageSize = 50\nconst pageSize = 25;")).toBe(25);
    expect(sourcePageSize("const pageSize = 50;")).toBe(50);
    expect(() => sourcePageSize("// pageSize = 25")).toThrow();
  });
  it("does not reinterpret textual tool intent as a native call or invent missing usage", () => {
    const frame = JSON.stringify({ message: { content: "<tool_call>write_file</tool_call>" }, done: false }) + "\n";
    const response = decodeResponse({ requestId: "inference-1", at: 1 }, [{ kind: "hardened-native-event", at: 2,
      event: { requestId: "inference-1", kind: "chunk", bytes: [...new TextEncoder().encode(frame)] } }]);
    expect(response).toMatchObject({ calls: [], textualIntent: true, finish: null, inputTokens: null, outputTokens: null });
  });
});
