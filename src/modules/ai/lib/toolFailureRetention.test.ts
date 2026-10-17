import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { compactResolvedToolFailures, groupCompactionUnits, planCompaction } from "@/modules/ai/lib/compactionPlan";
import { measureRequest } from "@/modules/ai/lib/contextBudget";
import { multilineRefusal, refusedShellHistory, shellPair } from "@/modules/ai/lib/toolFailureRetention.fixture";

const project = (messages: ModelMessage[], pins: string[] = []) => compactResolvedToolFailures([messages], pins);
const prepared = (extra: ModelMessage[]) => planCompaction({ units: [], system: [], tools: [], extra, limits: { deployed: 32768, maxOutput: 512 } });

describe("proven pre-execution failure receipts", () => {
  it("compacts only the old rejected payload after guard adaptation and keeps paired success/originals intact", () => {
    const original = refusedShellHistory();
    const before = structuredClone(original);
    const projection = project(original);
    const text = JSON.stringify(projection.blocks);
    expect(projection.receipts).toMatchObject([{ toolCallId: "refused", adaptedBy: "adapted", sourceBlock: 0 }]);
    expect(text).toContain("refused-before-execution");
    expect(text).toContain("Commands must be single-line");
    expect(text).toContain("not established");
    expect(text).toContain("request_conversation_evidence anchor refused");
    expect(text).not.toContain("unexecuted draft");
    expect(projection.blocks[0].slice(-2)).toEqual(original.slice(-2));
    expect(measureRequest({ messages: projection.blocks[0] }).conversation).toBeLessThan(measureRequest({ messages: original }).conversation);
    expect(original).toEqual(before);
  });
  it("keeps the current refusal hot until a later successful guard-accepted execution", () => {
    const source = refusedShellHistory().slice(0, 2);
    expect(project(source).blocks[0]).toEqual(source);
    expect(project(source).receipts).toEqual([]);
  });
  it("keeps a recurrent latest failure while shortening the earlier adapted one", () => {
    const source = [...refusedShellHistory(), ...refusedShellHistory().slice(0, 2).map(message => ({ ...message, content: (message.content as Array<Record<string, unknown>>).map(part => ({ ...part, toolCallId: "latest" })) } as ModelMessage))];
    const result = project(source);
    expect(result.receipts.map(receipt => receipt.toolCallId)).toEqual(["refused"]);
    expect(result.blocks[0].slice(-2)).toEqual(source.slice(-2));
  });
  it("restores exact original pairs when pinned without replay", () => {
    const source = refusedShellHistory();
    expect(project(source, ["refused"]).blocks[0]).toEqual(source);
    expect(project(source, ["refused"]).receipts).toEqual([]);
  });
  it.each([
    { error: "Process exited after partial write" },
    { error: multilineRefusal, timed_out: true },
    { command: "mutate", stderr: "syntax error", stdout: "", exit_code: 1, timed_out: false },
    { command: "mutate", stderr: "", stdout: "partial", exit_code: 0, timed_out: true },
  ])("never shortens runtime/uncertain evidence %j", output => {
    const source = [...shellPair("uncertain", "mutate\n".repeat(1000), output), ...refusedShellHistory().slice(-2)];
    expect(project(source).blocks[0]).toEqual(source);
  });
  it("does not infer no-effect from error prose when the input guard would accept", () => {
    const source = [...shellPair("spoof", "echo safe", { error: multilineRefusal }), ...refusedShellHistory().slice(-2)];
    expect(project(source).blocks[0]).toEqual(source);
  });
  it("does not treat a failed/timed-out later command as adaptation", () => {
    for (const output of [{ exit_code: 1, timed_out: false }, { exit_code: 0, timed_out: true }]) {
      const source = refusedShellHistory();
      Object.assign((source[3].content as Array<{ output: { value: object } }>)[0].output.value, output);
      expect(project(source).receipts).toEqual([]);
    }
  });
  it("does not infer correction across a new user boundary", () => {
    const source = refusedShellHistory();
    source.splice(2, 0, { role: "user", content: "Different task." });
    expect(project(source).receipts).toEqual([]);
  });
  it("preserves approval evidence even when its linkage is unavailable", () => {
    const source = refusedShellHistory();
    source.splice(2, 0, { role: "tool", content: [{ type: "tool-approval-response", approvalId: "approval", approved: true }] });
    expect(project(source).blocks[0]).toEqual(source);
  });
  it("does not trust provider-executed or MCP impersonation", () => {
    for (const change of [{ providerExecuted: true }, { toolName: "custom_mcp" }]) {
      const source = refusedShellHistory();
      Object.assign((source[0].content as object[])[0], change);
      expect(project(source).receipts).toEqual([]);
    }
  });
  it("refuses duplicate call identities and reversed result ordering", () => {
    const source = refusedShellHistory();
    expect(project([...source.slice(0, 1), ...source]).receipts).toEqual([]);
    expect(project([source[1], source[0], ...source.slice(2)]).receipts).toEqual([]);
  });
  it("does not expand tiny failures into larger receipts", () => {
    const source = [...shellPair("tiny", "echo\nx", { error: multilineRefusal }), ...refusedShellHistory().slice(-2)];
    expect(project(source).receipts).toEqual([]);
  });
  it("preserves successful write pairs even if later writes use the same target", () => {
    const source = ["earlier", "current"].flatMap(id => shellPair(id, `write file ${"payload ".repeat(2000)}`, { command: `write file ${"payload ".repeat(2000)}`, stdout: "written", stderr: "", exit_code: 0, timed_out: false }));
    expect(project(source).blocks[0]).toEqual(source);
  });
  it("preserves durable source group/coverage boundaries while projecting their hot payloads", () => {
    const source = refusedShellHistory();
    const units = source.map((message, index) => ({ messageId: `source-${index}`, role: "assistant" as const, messages: [message], hasContentReferences: false }));
    const before = structuredClone(units);
    const plan = planCompaction({ units, extra: [], system: [], tools: [], limits: { deployed: 32768, maxOutput: 512 } });
    expect(plan.groups).toEqual(groupCompactionUnits(units));
    expect(plan.groups[0]).toEqual({ start: 0, end: 2, protected: true });
    expect(plan.toolReceipts).toHaveLength(1);
    expect(units).toEqual(before);
  });
  it("keeps genuine uncertain-effect overflow blocked regardless of age", () => {
    const source = [...shellPair("uncertain", "partial mutation ".repeat(8000), { error: "Connection lost after launch; effect unknown" }), ...Array.from({ length: 50 }, (): ModelMessage => ({ role: "assistant", content: "Later observation" })), ...refusedShellHistory().slice(-2)];
    expect(() => prepared(source)).toThrow(/cannot fit/);
    try { prepared(source); } catch (error) { expect(error).toMatchObject({ code: "compaction-protected-budget" }); }
  });
  it("keeps a genuine oversized current no-effect failure verbatim and blocked", () => {
    const source = shellPair("current", "unexecuted\n".repeat(12000), { error: multilineRefusal });
    expect(project(source).blocks[0]).toEqual(source);
    expect(() => prepared(source)).toThrow(/cannot fit/);
  });
});
