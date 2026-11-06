/** Offline, generic Agent context-safety controls. The preserved, private
 * ForgeBoard transcript is investigated separately; these fixtures contain no
 * model inference or copied sensitive workspace content. */
import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { planCompaction, groupCompactionUnits, type CompactionUnit } from "@/modules/ai/lib/compactionPlan";
import { COMPACTION_POLICY } from "@/modules/ai/lib/compactionExtraction";
import { measureRequest, resolveContextBudget } from "@/modules/ai/lib/contextBudget";

const limits = { deployed: 49152, outputReserve: 6144 };
const system: ModelMessage[] = [{ role: "system", content: "Preserve requirements and tool effects." }];
const tools: unknown[] = [];
const user: CompactionUnit = {
  messageId: "objective", role: "user", hasContentReferences: false,
  messages: [{ role: "user", content: "Implement and verify all project and task operations." }],
};
const assistant = (id: string, text: string): CompactionUnit => ({
  messageId: id, role: "assistant", hasContentReferences: false,
  messages: [{ role: "assistant", content: text }],
});
const large = (id: string) => assistant(id, `Work item ${id} ` + "implementation details ".repeat(1000));
const failedTool = (id: string): CompactionUnit => ({
  messageId: id, role: "assistant", hasContentReferences: false,
  messages: [
    { role: "assistant", content: [{ type: "tool-call", toolCallId: `cmd-${id}`, toolName: "bash_run", input: { command: "false" } }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: `cmd-${id}`, toolName: "bash_run", output: { type: "json", value: { error: "failed", exit_code: 1 } } }] },
  ] as ModelMessage[],
});
const opts = (units: CompactionUnit[], overrides: Partial<typeof limits> = {}, memory?: {end: number; claims: []}) => ({
  units, limits: { ...limits, ...overrides }, system, tools, ...(memory ? { memory } : {}),
});

describe("Agent protected budget and earliest safe compaction (production functions only)", () => {
  it("reconciles the exact preserved terminal estimate and the separate 10% safety margin", () => {
    const cost = { system: 4814, tools: 2819, conversation: 32005, uncertainMedia: false };
    const budget = resolveContextBudget(limits, cost);
    expect(budget).toMatchObject({ ceiling: 49152, output: 6144, reserve: 6144,
      margin: 3964, working: 31411, fits: false, source: "deployed" });
    expect(cost.system + cost.tools + cost.conversation).toBe(39638);
    expect(cost.conversation - budget.working).toBe(594);
    expect(COMPACTION_POLICY).toMatchObject({ trigger: .7, target: .55, maxGeneratedTokens: 4096 });
    expect(Math.floor(budget.working * .2)).toBe(6282);
  });

  it("a smaller earlier-sized protected request can fit but cannot erase a single protected assistant unit", () => {
    const units = [user, failedTool("locked")];
    expect(groupCompactionUnits(units)).toEqual([
      { start: 0, end: 1, protected: true }, { start: 1, end: 2, protected: true },
    ]);
    const plan = planCompaction(opts(units));
    expect(plan.budget.fits).toBe(true);
    expect(plan.needed).toBe(false);
  });

  it("protects the latest live plan without silently dropping its tool pair", () => {
    const units: CompactionUnit[] = [user, {
      messageId: "plan", role: "assistant", hasContentReferences: false,
      messages: [
        { role: "assistant", content: [{ type: "tool-call", toolName: "todo_write", toolCallId: "plan-id", input: {todos:[{title:"Finish",status:"pending"}] } }] },
        { role: "tool", content: [{ type: "tool-result", toolName: "todo_write", toolCallId: "plan-id", output: {type:"json",value:{ok:true,count:1}} }] },
      ] as ModelMessage[],
    }];
    expect(groupCompactionUnits(units)[1].protected).toBe(true);
    expect(planCompaction(opts(units)).messages.some(x => JSON.stringify(x).includes("plan-id"))).toBe(true);
  });

  it("a protected history that exceeds context fails closed, not by reducing the output reserve", () => {
    const protectedAttachment = assistant("large-protected", "a ".repeat(32000));
    protectedAttachment.hasContentReferences = true;
    const all = [user, protectedAttachment, failedTool("recent")];
    // A large completed unprotected group plus pinned recent evidence must
    // continue only if the full remaining protected request still fits.
    expect(() => planCompaction(opts(all, {deployed: 8192}))).toThrow(
      expect.objectContaining({ code: "compaction-protected-budget" }),
    );
    const full = resolveContextBudget(limits, measureRequest({messages: all.flatMap(x => x.messages), tools}));
    expect(full.reserve).toBe(6144);
    expect(full.ceiling).toBe(49152);
  });

  it("a completed, unpinned earlier assistant message can be selected for safe compaction before exhaustion", () => {
    const units = [user, large("historical-1"), large("historical-2"), large("historical-3"), assistant("tail", "Recent status.")];
    const plan = planCompaction(opts(units));
    expect(plan.needed).toBe(true);
    expect(plan.budget.fits).toBe(true);
    expect(plan.tailStart).toBeGreaterThan(1);
    expect(groupCompactionUnits(units).slice(1).every(x => !x.protected)).toBe(true);
    const compacted = planCompaction(opts(units, {}, {end: plan.tailStart, claims: []}));
    expect(compacted.budget.fits).toBe(true);
    expect(compacted.budget.cost.conversation).toBeLessThan(plan.budget.cost.conversation);
    expect(compacted.needed).toBe(false);
    expect(planCompaction(opts(units, {}, {end: plan.tailStart, claims: []})).needed).toBe(false);
  });

  it("never promotes 49K to an untrusted higher capacity or shrinks 6144 output reserve", () => {
    const request = measureRequest({messages: [
      {role:"user",content:"x ".repeat(30000)},
    ]});
    const budget = resolveContextBudget(limits, request);
    expect(budget.ceiling).toBe(49152);
    expect(budget.reserve).toBe(6144);
    expect(budget.cost.conversation > 0).toBe(true);
    const lessTrusted = resolveContextBudget({deployed:32768,outputReserve:6144}, request);
    expect(lessTrusted.ceiling).toBe(32768);
    expect(lessTrusted.working).toBeLessThanOrEqual(budget.working);
  });
});
