import { afterEach, describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { conversationCompactionUnits } from "@/modules/ai/lib/conversationCompaction";
import { groupCompactionUnits, planCompaction } from "@/modules/ai/lib/compactionPlan";
import { measureRequest, resolveContextBudget } from "@/modules/ai/lib/contextBudget";
import {
  compactionFixture, disposeCompactionFixtures, textMessage,
} from "@/modules/ai/lib/conversationCompaction.fixture";
import { AGENT_STEP_COMPACTION_VERSION } from "@/modules/ai/lib/compactionExtraction";

afterEach(disposeCompactionFixtures);

type ToolPart = UIMessage["parts"][number];
const failedSteps = new Set([28, 44, 47, 53, 55, 56, 58]);
function steps(begin: number, end: number, repetitions = 65): ToolPart[] {
  const result: ToolPart[] = [];
  for (let step = begin; step <= end; step++) {
    result.push({ type: "step-start" });
    result.push({ type: "text", text: `Step ${step} observation.\n${"Previous command and inspected output. ".repeat(repetitions)}` });
    // Three no-tool reasoning/text-only steps; all 55 tool calls are resolved.
    if ([5, 15, 35].includes(step)) continue;
    const tool = step === 50 ? "todo_write"
      : [44, 47].includes(step) ? "read_file"
      : step === 55 ? "edit"
      : step % 4 === 0 || failedSteps.has(step) ? "bash_run"
      : "write_file";
    const input = step === 50
      ? { todos: [{ title: "Keep the current pending task", status: "in_progress" }] }
      : tool === "bash_run" ? { command: `echo ${step}` }
      : { path: `src/step-${step}.ts`, content: "generated file" };
    const output = failedSteps.has(step) ? { error: `step-${step}: command failed, no successful effect` }
      : step === 50 ? { ok: true, count: 1 }
      : { ok: true, clackWorkspaceWrite: tool === "write_file" || tool === "edit", content: `step ${step} result` };
    result.push({
      type: `tool-${tool}`, toolCallId: `call-${step}`,
      state: "output-available", input, output,
    } as ToolPart);
  }
  return result;
}

function history(end: number, repetitions = 65): UIMessage[] {
  return [
    textMessage("current-user", "user", "Build the current application, preserve tool effects and the current instructions."),
    { id: "long-agent-run", role: "assistant", parts: steps(1, end, repetitions) },
  ];
}
const budget = { deployed: 49152, outputReserve: 6144, maxOutput: 6144 };
const system = [{ role: "system" as const, content: "Do not rerun completed effects. Keep permission boundaries." }];

describe("dependency-closed virtual Agent step compaction", () => {
  it("retains exactly the original SDK reasoning-pruning boundary across historical steps", async () => {
    const originals: UIMessage[] = [
      textMessage("u", "user", "Continue without exposing historical reasoning."),
      { id: "a", role: "assistant", parts: [
        { type: "step-start" },
        { type: "reasoning", text: "Reasoning in completed older step" },
        { type: "text", text: "Previous observed action" },
        { type: "step-start" },
        { type: "reasoning", text: "Reasoning in current step" },
        { type: "text", text: "Current response" },
      ] },
    ];
    const originalMessages = (await conversationCompactionUnits(originals, originals, "chat-a")).flatMap(u => u.messages);
    const splitMessages = (await conversationCompactionUnits(originals, originals, "chat-a", false, true)).flatMap(u => u.messages);
    expect(splitMessages).toEqual(originalMessages);
    expect(JSON.stringify(splitMessages)).not.toContain("Reasoning in completed older step");
  });

  it("joins a call and result across step sources but keeps unresolved calls protected", () => {
    const mk = (id: string, messages: Parameters<typeof groupCompactionUnits>[0][number]["messages"]) =>
      ({ messageId: id, role: "assistant" as const, hasContentReferences: false, messages });
    const call = mk("call-step", [{ role: "assistant", content: [
      { type: "tool-call", toolCallId: "cross-step", toolName: "read_file", input: { path: "src/a" } },
    ] }]);
    const result = mk("result-step", [{ role: "tool", content: [
      { type: "tool-result", toolCallId: "cross-step", toolName: "read_file",
        output: { type: "json", value: { ok: true } } },
    ] }]);
    expect(groupCompactionUnits([call, result])).toEqual([{ start: 0, end: 2, protected: false }]);
    expect(groupCompactionUnits([call])).toEqual([{ start: 0, end: 1, protected: true }]);
    expect(() => groupCompactionUnits([result])).toThrow();
  });

  it("reproduces old 2-group coarsening and proves 59 chronological paired groups with 50 eligible", async () => {
    const originals = history(58);
    const legacy = await conversationCompactionUnits(originals, originals, "chat-a");
    const finer = await conversationCompactionUnits(originals, originals, "chat-a", false, true);
    const oldGroups = groupCompactionUnits(legacy);
    const groups = groupCompactionUnits(finer);
    expect(legacy).toHaveLength(2);
    expect(oldGroups).toHaveLength(2);
    expect(oldGroups.every(g => g.protected)).toBe(true);
    expect(finer).toHaveLength(59);
    expect(groups).toHaveLength(59);
    expect(groups.filter(g => !g.protected)).toHaveLength(50);
    expect(groups.filter(g => g.protected)).toHaveLength(9);
    const originalMessages = legacy.flatMap(u => u.messages);
    const virtualMessages = finer.flatMap(u => u.messages);
    expect(virtualMessages).toEqual(originalMessages);
    const ids = (type: "tool-call" | "tool-result") => virtualMessages.flatMap(m =>
      typeof m.content === "string" ? [] : m.content.filter(p => p.type === type)
        .map(p => (p as { toolCallId: string }).toolCallId));
    expect(ids("tool-call")).toHaveLength(55);
    expect(ids("tool-result")).toEqual(ids("tool-call"));
    expect(new Set(ids("tool-call")).size).toBe(55);
    expect(finer[50].messages.some(m => JSON.stringify(m).includes("call-50"))).toBe(true);
    expect(finer[58].messages.some(m => JSON.stringify(m).includes("call-58"))).toBe(true);
  });

  it("keeps failed, current and pending tools in context and does not bypass a genuine protected budget", async () => {
    const originals = history(58);
    const units = await conversationCompactionUnits(originals, originals, "chat-a", false, true);
    const groups = groupCompactionUnits(units);
    for (const step of failedSteps) expect(groups[step].protected).toBe(true);
    expect(groups[50].protected).toBe(true);
    const pending: UIMessage[] = [
      textMessage("u", "user", "Keep pending commands."),
      { id: "assistant", role: "assistant", parts: [
        { type: "step-start" },
        { type: "tool-bash_run", toolCallId: "pending", state: "input-available", input: { command: "echo pending" } },
      ] as ToolPart[] },
    ];
    const pendingUnits = await conversationCompactionUnits(pending, pending, "chat-a", false, true);
    expect(groupCompactionUnits(pendingUnits)[1].protected).toBe(true);
    expect(() => planCompaction({
      units: pendingUnits, system, tools: [], limits: { deployed: 4096, outputReserve: 1024 },
      extra: [{ role: "assistant", content: "large nonoptional current result ".repeat(2000) }],
    })).toThrow();
  });

  it("commits deterministic extraction through the production coordinator and reloads safely", async () => {
    const originals = history(42, 55);
    const untouched = JSON.stringify(originals);
    const f = compactionFixture(originals);
    const extract = f.call.getMockImplementation();
    if (!extract) throw new Error("Missing deterministic extraction stub");
    f.call.mockImplementation(async options => {
      const response = await extract(options);
      return { ...response, usage: { inputTokens: 100, outputTokens: 100, cachedInputTokens: 0 } };
    });
    const limits = { deployed: 32768, outputReserve: 3072, maxOutput: 3072 };
    const coordinator = await f.start({ limits: async () => limits });
    const result = await coordinator.prepare();
    const revision = f.view().revision;
    expect(revision).not.toBeNull();
    expect(revision?.policyVersion).toBe(AGENT_STEP_COMPACTION_VERSION);
    expect(revision?.coverage.unitMode).toBe("agent-steps-v1");
    expect(revision?.coverage.end).toBeGreaterThan(29);
    expect(revision?.coverage.end).toBeLessThan(43);
    expect(revision?.coverage.latestMessageId).toMatch(/^agent-step:long-agent-run:\d+$/);
    expect(revision?.evidence.some(e => e.locator.kind === "agentStep")).toBe(true);
    expect(revision?.evidence.every(e => e.locator.kind !== "message")).toBe(true);
    expect(revision?.evidence.some(e => e.locator.kind === "agentStep" && e.locator.stepIndex === 27)).toBe(false);
    expect(f.call.mock.calls.every(([request]) => {
      const extraction = JSON.parse(request.messages[1].content as string) as {
        sources: Array<{ passages: string[] }>;
      };
      return extraction.sources.every(source => !source.passages.some(text => text.includes("call-28")));
    })).toBe(true);
    const compacted = JSON.stringify(result);
    expect(compacted).toContain("Build the current application");
    expect(compacted).toContain("call-28"); // Historical failure is protected verbatim.
    expect(compacted).toContain("call-42"); // Current working step is verbatim.
    expect(resolveContextBudget(limits, measureRequest({ messages: result, tools: [] })).fits).toBe(true);
    expect(JSON.stringify(f.originals)).toBe(untouched);
    expect(f.call).toHaveBeenCalled();
    const before = f.call.mock.calls.length;
    coordinator.dispose();
    const resumed = await f.start({ limits: async () => limits });
    const afterReload = await resumed.prepare();
    expect(JSON.stringify(afterReload)).toContain("call-28");
    expect(f.call.mock.calls.length).toBe(before);
    expect(f.view().revision?.coverage.unitMode).toBe("agent-steps-v1");
    // A continuation appends new steps to the *same* durable assistant UI
    // message. Its previously committed step IDs/cursor remain stable.
    f.originals[1].parts.push(...steps(43, 58, 55));
    const continued = await f.start({
      limits: async () => ({ deployed: 49152, outputReserve: 6144, maxOutput: 6144 }),
    });
    const output = await continued.prepare();
    const context = JSON.stringify(output);
    expect(context).toContain("call-58");
    expect(context).toContain("call-53");
    expect(context).toContain("call-28");
    expect(f.view().revision?.coverage.end).toBeGreaterThanOrEqual(revision?.coverage.end ?? 0);
    expect(f.call.mock.calls.length - before).toBeLessThanOrEqual(4);
    expect(resolveContextBudget(
      { deployed: 49152, outputReserve: 6144, maxOutput: 6144 },
      measureRequest({ messages: output, tools: [] }),
    ).fits).toBe(true);
  });

  it("keeps a committed step-index revision after the active pending tool resolves successfully", async () => {
    const originals = history(42, 55);
    for (const part of originals[1].parts) {
      if (!part.type.startsWith("tool-")) continue;
      if (!("toolCallId" in part)) continue;
      if (failedSteps.has(Number(part.toolCallId.slice(5)))) {
        (part as { output?: unknown }).output = { ok: true, content: "repaired and completed" };
      }
    }
    const current = originals[1].parts[originals[1].parts.length - 1];
    if (!current.type.startsWith("tool-")) throw new Error("Expected pending tail tool");
    (current as { state: string }).state = "input-available";
    delete (current as { output?: unknown }).output;
    const f = compactionFixture(originals);
    const extract = f.call.getMockImplementation();
    if (!extract) throw new Error("Missing mock extraction");
    f.call.mockImplementation(async options => ({
      ...await extract(options),
      usage: { inputTokens: 100, outputTokens: 100, cachedInputTokens: 0 },
    }));
    const limits = { deployed: 32768, outputReserve: 3072, maxOutput: 3072 };
    const first = await f.start({ limits: async () => limits });
    const result = await first.prepare();
    expect(JSON.stringify(result)).toContain("call-42");
    expect(f.view().revision?.coverage.unitMode).toBe("agent-steps-v1");
    const covered = f.view().revision?.coverage.end ?? 0;
    expect(covered).toBeLessThan(43);
    first.dispose();
    (current as { state: string }).state = "output-available";
    (current as { output?: unknown }).output = { ok: true, content: "active tool returned" };
    const next = await f.start({ limits: async () => limits });
    const after = await next.prepare();
    expect(f.view().revision?.coverage.unitMode).toBe("agent-steps-v1");
    expect(f.view().revision?.coverage.end).toBeGreaterThanOrEqual(covered);
    expect(JSON.stringify(after)).toContain("active tool returned");
  });

  it("never changes the capacity ceiling or reserves when planning finer history", async () => {
    const originals = history(58);
    const finer = await conversationCompactionUnits(originals, originals, "chat-a", false, true);
    const planning = planCompaction({ units: finer, system, tools: [], limits: budget });
    expect(planning.budget.ceiling).toBe(49152);
    expect(planning.budget.reserve).toBe(6144);
    expect(planning.groups.filter(g => !g.protected)).toHaveLength(50);
  });
});
