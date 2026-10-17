import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import type { JSONValue } from "@ai-sdk/provider";
import { planCompaction } from "@/modules/ai/lib/compactionPlan";
import { measureRequest, resolveContextBudget } from "@/modules/ai/lib/contextBudget";

const limits = { deployed: 32768, outputReserve: 2048, maxOutput: 2048 };
const objective = "Build ForgeBoard. React and TypeScript frontend, Node and TypeScript backend, npm. Port 4317. Page size 50. Maximum task title 120. Debounce 750ms. Real SSE, local persistence, meaningful tests and production build. No telemetry or cloud. Finish the current unfinished plan.";
const todos = [{ title: "Inspect environment", status: "in_progress" }, { title: "Implement ForgeBoard, test and build", description: objective, status: "pending" },
  ...["Scaffold npm workspaces and TypeScript configuration", "Implement persistent backend API and SSE", "Verify API validation and combined filtering", "Implement keyboard-operable React frontend", "Verify frontend behavior and debounce", "Execute tests/build and document evidence"].map(title => ({ title, description: "Keep all original requirements and report unfinished verification honestly.", status: "pending" })),
];
const call = (id: string, toolName: string, input: unknown): ModelMessage => ({ role: "assistant", content: [{ type: "tool-call", toolCallId: id, toolName, input }] });
const result = (id: string, toolName: string, value: JSONValue): ModelMessage => ({ role: "tool", content: [{ type: "tool-result", toolCallId: id, toolName, output: { type: "json", value } }] });
const plan = (id: string, updated = false): ModelMessage[] => [call(id, "todo_write", { todos: updated ? todos.map((todo, index) => ({ ...todo, status: index === 0 ? "completed" : index === 1 ? "in_progress" : "pending" })) : todos }), result(id, "todo_write", { ok: true, count: todos.length })];
const units = [{ messageId: "original-spec", role: "user" as const, messages: [{ role: "user" as const, content: objective }], hasContentReferences: false }];
const system: ModelMessage[] = [{ role: "system", content: "Preserve permissions, source provenance and uncertain effects. Never replay completed effects." }];
function prepare(extra: ModelMessage[], tools: unknown = []) {
  return planCompaction({ units, limits, system, tools, extra });
}
function fitCost(target: number, measure: (value: string) => number) {
  let low = 0, high = target * 4;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (measure("x".repeat(mid)) < target) low = mid + 1;
    else high = mid;
  }
  const text = "x".repeat(low);
  expect(measure(text)).toBe(target);
  return text;
}

describe("superseded full-plan working projection", () => {
  it("reproduces the 32K protected overflow and retains all requirements/effects after retiring only a superseded plan", () => {
    const tools = [{ type: "function", function: { name: "read_file", description: "Read authorized files", parameters: { type: "object" } } }];
    const frame: ModelMessage[] = [{ role: "system", content: fitCost(3617, text => measureRequest({ messages: [{ role: "system", content: text }] }).system) }];
    const schemaText = fitCost(7250, text => measureRequest({ tools: [{ ...tools[0], function: { ...tools[0].function, description: text } }] }).tools);
    tools[0].function.description = schemaText;
    const history = [...plan("old-plan"),
      call("failed-command", "bash_run", { command: "bad PowerShell quoting" }), result("failed-command", "bash_run", { exit_code: 1, stderr: "Keep this debugging evidence." }),
      ...plan("current-plan", true),
      call("write", "bash_run", { command: "Write verified scaffold once." }), result("write", "bash_run", { exit_code: 0, stdout: "" }),
      call("uncertain", "custom_fixture", { effect: "unknown" }), result("uncertain", "custom_fixture", { effect: "unknown", error: "Do not replay." }),
    ];
    const receipt = history[7].content as unknown as Array<{ output: { value: { stdout: string } } }>;
    receipt[0].output.value.stdout = fitCost(17423, text => {
      receipt[0].output.value.stdout = text;
      return measureRequest({ messages: [...units[0].messages, ...history] }).conversation;
    });
    const before = JSON.stringify({ units, history });
    const raw = resolveContextBudget(limits, measureRequest({ messages: [...frame, ...units[0].messages, ...history], tools }));
    expect(raw).toMatchObject({ ceiling: 32768, reserve: 2048, margin: 2829, working: 17024, fits: false, cost: { system: 3617, tools: 7250, conversation: 17423 } });
    const prepared = planCompaction({ units, limits, system: frame, tools, extra: history });
    expect(prepared.budget.fits).toBe(true);
    const output = JSON.stringify(prepared.messages);
    expect(output).not.toContain('"toolCallId":"old-plan"');
    for (const id of ["current-plan", "failed-command", "write", "uncertain"]) expect(output).toContain(`"toolCallId":"${id}"`);
    expect(output).toContain(objective);
    expect(output).toContain("Keep this debugging evidence.");
    expect(JSON.stringify({ units, history })).toBe(before);
  });
  it("removes only the old full-plan call/result, not narrative, mutations or failures", () => {
    const extra = [...plan("old"), call("effect", "bash_run", { command: "Write once" }), result("effect", "bash_run", { exit_code: 1, stderr: "Unresolved" }), ...plan("new", true)];
    (extra[0].content as unknown[]).unshift({ type: "text", text: "Keep this earlier unresolved architecture observation." });
    const before = JSON.stringify(extra);
    const prepared = prepare(extra).messages;
    expect(JSON.stringify(prepared)).not.toContain('"toolCallId":"old"');
    expect(JSON.stringify(prepared)).toContain("Keep this earlier unresolved architecture observation.");
    for (const id of ["effect", "new"]) expect(JSON.stringify(prepared)).toContain(`"toolCallId":"${id}"`);
    expect(JSON.stringify(extra)).toBe(before);
  });
  it.each(["failed", "unresolved", "wrong-count", "provider", "duplicate", "parallel", "approval", "new-user"])("never retires an unproven replacement or protected relationship: %s", variant => {
    let extra = [...plan("old"), ...plan("new", true)];
    if (variant === "failed") extra[3] = result("new", "todo_write", { error: "Not saved" });
    if (variant === "unresolved") extra.pop();
    if (variant === "wrong-count") extra[3] = result("new", "todo_write", { ok: true, count: 0 });
    if (variant === "provider") (extra[2].content as Array<Record<string, unknown>>)[0].providerExecuted = true;
    if (variant === "duplicate") extra.push(call("old", "todo_write", { todos }));
    if (variant === "parallel") extra = [extra[0], extra[2], extra[1], extra[3]];
    if (variant === "approval") (extra[0].content as unknown[]).push({ type: "tool-approval-request", toolCallId: "old", approvalId: "approval" });
    if (variant === "new-user") extra.splice(2, 0, { role: "user", content: "Different task boundary" });
    expect(JSON.stringify(prepare(extra).messages)).toContain('"toolCallId":"old"');
  });
  it("still blocks genuinely oversized latest plans and recent tool results at 8K and 32K", () => {
    for (const deployed of [8192, 32768]) {
      const extra = [...plan("current"), call("large", "read_file", { path: "required.txt" }), result("large", "read_file", { content: "required ".repeat(deployed) })];
      expect(() => planCompaction({ units, limits: { ...limits, deployed }, system, tools: [], extra })).toThrow(expect.objectContaining({ code: "compaction-protected-budget" }));
    }
  });
});
