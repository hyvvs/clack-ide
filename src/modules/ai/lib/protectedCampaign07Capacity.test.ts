/**
 * Campaign 07 budget *model*, NOT a replay of the archived native request.
 * The historical persisted failure reported 26,469 input + 4,096 output +
 * 2,647 margin = 33,212 against a verified 32,768-token allocation. Its full
 * original system prompt and serialized 14 tool schemas were not captured as
 * an interchangeable deterministic fixture. All content below is synthetic.
 * No inference, native commands, filesystem writes or evidence pruning occur.
 */
import { describe, expect, it } from "vitest";
import type { ModelMessage, ToolSet } from "ai";
import { planCompaction, type CompactionUnit } from "@/modules/ai/lib/compactionPlan";
import { CompactionError } from "@/modules/ai/lib/compactionExtraction";
import { estimateTextTokens, measureRequest, resolveContextBudget } from "@/modules/ai/lib/contextBudget";
import { buildStableSystem } from "@/modules/ai/lib/agent";
import { BUILTIN_AGENTS } from "@/modules/ai/lib/agents";
import { CORE_SYSTEM_PROMPT, DEFAULT_CLACK_BEHAVIOR } from "@/modules/ai/config";
import { serializedToolSchemas } from "@/modules/ai/lib/requestPreflight";
import { buildTools } from "@/modules/ai/tools/tools";
import type { ToolContext } from "@/modules/ai/tools/context";

const limits = { deployed: 32768, maxOutput: 4096, outputReserve: 4096 };
const mission = "Build the local-first project/task board. Port 4317; 50 tasks per page; 120-character title limit; 750 ms debounce. Preserve corrections, test failures, verified tool effects, SSE, persistence, tests and the latest working plan. No cloud.";
const user: CompactionUnit = {
  messageId: "campaign07-synthetic-user", role: "user", hasContentReferences: false,
  messages: [{ role: "user", content: mission }],
};
const toolNames = [
  "list_directory", "todo_write", "create_directory", "create_directory",
  "write_file", "write_file", "create_directory", "create_directory",
  "write_file", "write_file", "write_file", "write_file", "write_file",
  "todo_write", "create_directory", "write_file", "write_file",
  "bash_run", "bash_run", "read_file", "bash_run", "edit",
] as const;
// Captured campaign07 selection names from mission-a-1.requests.jsonl. The
// historical JSON schema bytes are not copied into this synthetic fixture.
const campaignToolNames = [
  "read_file", "list_directory", "write_file", "create_directory", "edit",
  "grep", "glob", "bash_run", "bash_list", "open_preview", "todo_write",
  "request_peer_task", "cancel_peer_task", "propose_custom_tool",
] as const;
const filePath = (step: number) => `/workspace/backend/src/source-${step}.ts`;
const plan = (current: number) => Array.from({ length: 16 }, (_, i) => ({
  id: `task-${i}`, title: `Implement and verify project task feature ${i}`,
  status: i < current ? "completed" : i === current ? "in_progress" : "pending",
}));

function sameRunSteps(): ModelMessage[] {
  return toolNames.flatMap((toolName, index): ModelMessage[] => {
    const step = index + 1;
    const id = `campaign07-step-${step}`;
    const input = toolName === "todo_write" ? { todos: plan(step === 2 ? 0 : 4) }
      : toolName === "bash_run" ? { command: step === 18 ? "cd backend && npm install"
        : step === 19 ? "Set-Location backend; npm install" : "Get-Content backend/package.json" }
      : toolName === "write_file" ? { path: filePath(step), content: `// Step ${step}\n${"verified implementation details ".repeat(step === 13 ? 150 : step === 17 ? 60 : 30)}` }
      : toolName === "edit" ? { path: filePath(5), old_string: "old dev dependency", new_string: "corrected dev dependency" }
      : { path: step === 20 ? filePath(5) : `/workspace/backend/generated-${step}` };
    const output = toolName === "todo_write" ? { ok: true, count: 16 }
      : toolName === "bash_run" ? step === 18
        ? { command: input.command, exit_code: 1, stderr: "Correction required: && is not a supported separator", stdout: "", timed_out: false }
        : step === 19 ? { command: input.command, exit_code: 1, stderr: "ETARGET @types/supertest version unavailable", stdout: "", timed_out: false }
        : { command: input.command, exit_code: 0, stderr: "", stdout: "dependency correction evidence", timed_out: false }
      : toolName === "write_file" ? { ok: true, clackWorkspaceWrite: true, path: input.path,
        bytesWritten: "content" in input && typeof input.content === "string" ? input.content.length : 0 }
      : toolName === "edit" ? { ok: true, clackWorkspaceWrite: true, path: input.path, bytesWritten: 516 }
      : toolName === "create_directory" ? { ok: true, clackWorkspaceWrite: true, path: input.path }
      : { path: input.path, entries: [] };
    return [
      { role: "assistant", content: [
        { type: "text", text: `Historical step ${step}: ${"checked implementation and observations ".repeat(10)}` },
        { type: "tool-call", toolCallId: id, toolName, input },
      ] },
      { role: "tool", content: [{
        type: "tool-result", toolCallId: id, toolName,
        output: { type: "json", value: output },
      }] },
    ];
  });
}

// Fourteen synthetic schemas, not the campaign's archived schema bytes.
function schemas(descriptionWords = 25): unknown[] {
  return campaignToolNames.map((name, index) => ({
    type: "function", function: {
      name, description: `Tool ${index}: ` + "strict safe local operation ".repeat(descriptionWords),
      parameters: { type: "object", properties: {
        path: { type: "string", description: "Absolute workspace path, never outside owner root" },
        content: { type: "string", description: "Structured input or expected output" },
      }, required: ["path"], additionalProperties: false },
    },
  }));
}

const system: ModelMessage[] = [
  { role: "system", content: "Preserve all original requirements, tool receipts, active plan and rejected operations. " +
    "Use native tools only for permitted workspace actions. ".repeat(110) },
  { role: "system", content: "Coding agent: verify real build, tests and correction attempts. ".repeat(50) },
];
const extra = sameRunSteps();
const tools = schemas();
const options = (overrides: { system?: ModelMessage[]; tools?: unknown } = {}) => ({
  units: [user], extra, system: overrides.system ?? system, tools: overrides.tools ?? tools, limits,
});
const countInput = (systemMessages = system, definitions: unknown = tools) =>
  measureRequest({ messages: [...systemMessages, ...user.messages, ...extra], tools: definitions });

describe("campaign07-sized protected same-run context (offline synthetic, no historical wire replay)", () => {
  it("models the 32,768 ceiling and fails closed with 22 completed same-run tool pairs", () => {
    expect(toolNames).toHaveLength(22);
    expect(toolNames.filter(name => name === "write_file")).toHaveLength(9);
    expect(toolNames.filter(name => name === "todo_write")).toHaveLength(2);
    expect(toolNames.filter(name => name === "bash_run")).toHaveLength(3);
    expect(tools).toHaveLength(14);
    const cost = countInput();
    const budget = resolveContextBudget(limits, cost);
    const input = cost.system + cost.tools + cost.conversation;
    const total = input + budget.reserve + budget.margin;
    // Approximate synthetic sizing, not an assertion that we regenerated the
    // lost historical prompt/schema serialization or its exact 33,212 count.
    expect(total).toBeGreaterThan(32768);
    expect(total).toBeGreaterThan(32000);
    expect(total).toBeLessThan(35000);
    expect(budget).toMatchObject({ ceiling: 32768, reserve: 4096, fits: false });
    let blocked: unknown;
    try { planCompaction(options()); } catch (error) { blocked = error; }
    expect(blocked).toBeInstanceOf(CompactionError);
    expect(blocked).toMatchObject({
      code: "compaction-protected-budget",
      budget: expect.objectContaining({ ceiling: 32768, reserve: 4096, fits: false }),
    });
    const failedBudget = (blocked as CompactionError).budget;
    expect(failedBudget).toBeDefined();
    if (!failedBudget) throw new Error("Expected a measured protected budget");
    const projectedInput = failedBudget.cost.system + failedBudget.cost.tools + failedBudget.cost.conversation;
    // Approximation of the saved 33,212 only; it includes production's
    // acknowledged-plan projection, which legitimately retires the old plan.
    expect(projectedInput + failedBudget.reserve + failedBudget.margin).toBeGreaterThanOrEqual(32900);
    expect(projectedInput + failedBudget.reserve + failedBudget.margin).toBeLessThanOrEqual(33500);
  });

  it("never mutates the same-run source; keeps latest plan, failed commands and current writes", () => {
    const frozenUser = JSON.stringify(user);
    const frozenExtra = JSON.stringify(extra);
    const frozenSchemas = JSON.stringify(tools);
    // A larger *verified* ceiling lets us inspect the production projection;
    // it does not grant the 32K campaign permission to dispatch.
    const result = planCompaction({ ...options(), limits: { deployed: 65536, maxOutput: 4096, outputReserve: 4096 } });
    const text = JSON.stringify(result.messages);
    expect(result.groups).toEqual([{ start: 0, end: 1, protected: true }]);
    expect(text).toContain(mission);
    expect(text).toContain("campaign07-step-14"); // latest acknowledged todo_write
    expect(text).toContain("Correction required: &&"); // failed bash, never silently retired
    expect(text).toContain("ETARGET @types/supertest"); // second failed bash
    expect(text).toContain("campaign07-step-22"); // most recent edit
    expect(text).toContain("campaign07-step-17"); // current generated source
    expect(text.includes('"toolCallId":"campaign07-step-2"')).toBe(false); // only superseded acknowledged plan
    for (const step of [18, 19, 20, 21, 22]) expect(text).toContain(`campaign07-step-${step}`);
    const ids = (kind: "tool-call" | "tool-result") => result.messages.flatMap(message =>
      typeof message.content === "string" ? [] : message.content.flatMap(part =>
        part.type === kind && "toolCallId" in part ? [part.toolCallId] : []));
    const callIds = ids("tool-call");
    expect(ids("tool-result")).toEqual(callIds);
    expect(callIds).toHaveLength(21); // 22 pairs minus only the superseded acknowledged plan
    for (let step = 1; step <= 22; step++) {
      expect(callIds.includes(`campaign07-step-${step}`)).toBe(step !== 2);
    }
    expect(result.toolReceipts).toEqual([]); // no fabricated verified-write checkpoint
    expect(JSON.stringify(user)).toBe(frozenUser);
    expect(JSON.stringify(extra)).toBe(frozenExtra);
    expect(JSON.stringify(tools)).toBe(frozenSchemas);
  });

  it("measures the CURRENT real Coder system and 14 production tool schemas without removing any protected evidence", async () => {
    const before = JSON.stringify(extra);
    const coder = BUILTIN_AGENTS.find(agent => agent.id === "builtin:coder");
    if (!coder) throw new Error("Missing production Coder persona");
    const currentSystem: ModelMessage[] = [{
      role: "system", content: buildStableSystem("muse-glimmer:30b", coder, undefined, null),
    }];
    const ctx: ToolContext = {
      getCwd: () => "/workspace", getWorkspaceRoot: () => "/workspace",
      getWorkspaceId: () => "local:/workspace",
      getSessionId: () => "campaign07-synthetic", getAgentId: () => "builtin:coder",
      getTerminalContext: () => null, isActiveTerminalPrivate: () => false,
      injectIntoActivePty: () => false, openPreview: () => false,
      spawnAgent: () => null, readAgentOutput: () => null, readCache: new Map(),
    };
    // Defining schemas is pure/offline. Do not load the custom registry or
    // execute any tool, IPC command, model call or workspace mutation.
    const available: ToolSet = buildTools(ctx);
    for (const name of campaignToolNames) expect(available).toHaveProperty(name);
    const selected = Object.fromEntries(campaignToolNames.map(name => [name, available[name]]));
    const currentSchemas = await serializedToolSchemas(selected);
    expect(currentSchemas).toHaveLength(14);
    // The source-only baseline was independently measured using the same
    // production estimator on committed HEAD for the same 14 tool names.
    // It is NOT the frozen provider's exact on-wire schema capture (which
    // reported 6,411 rather than 6,486 estimated tool tokens).
    const sourceBase = { instructions: 4477, tools: 6486 };
    const currentInstructions = estimateTextTokens(CORE_SYSTEM_PROMPT) +
      estimateTextTokens(DEFAULT_CLACK_BEHAVIOR) + estimateTextTokens(coder.instructions);
    const currentTools = measureRequest({ tools: currentSchemas }).tools;
    const sourceSavings = (sourceBase.instructions - currentInstructions) +
      (sourceBase.tools - currentTools);
    const projectedInput = 26_469 - sourceSavings;
    const projectedRequired = projectedInput + 4096 + Math.ceil(projectedInput * 0.1);
    expect(sourceSavings).toBeGreaterThan(2500);
    expect(projectedRequired).toBeLessThanOrEqual(30_000);
    expect(32_768 - projectedRequired).toBeGreaterThanOrEqual(2700);
    const rawBudget = resolveContextBudget(limits, countInput(currentSystem, currentSchemas));
    let prepared: ReturnType<typeof planCompaction> | undefined;
    let rejection: unknown;
    try { prepared = planCompaction(options({ system: currentSystem, tools: currentSchemas })); }
    catch (error) { rejection = error; }
    // The exact active tool selection, custom instructions and original
    // provider wire bytes were not retained in the synthetic model.
    expect(rawBudget.cost.schemas?.exposed).toBe(14);
    if (!prepared) {
      expect(rejection).toBeInstanceOf(CompactionError);
      throw new Error(`CURRENT production prompt/schema do not fit synthetic 32K history: ${String(rejection)}`);
    }
    expect(prepared.budget).toMatchObject({ ceiling: 32768, reserve: 4096, fits: true });
    const preparedInput = prepared.budget.cost.system + prepared.budget.cost.tools + prepared.budget.cost.conversation;
    const headroom = 32768 - prepared.budget.reserve - prepared.budget.margin - preparedInput;
    expect(headroom).toBeGreaterThanOrEqual(2000);
    const projected = JSON.stringify(prepared.messages);
    expect(prepared.messages[0]).toEqual(currentSystem[0]); // entire current trusted prompt, not a slice
    expect(prepared.messages).toContainEqual(user.messages[0]); // exact original user requirements
    expect(projected).toContain(mission);
    for (const step of [14, 17, 18, 19, 20, 21, 22]) expect(projected).toContain(`campaign07-step-${step}`);
    expect(prepared.messages.some(message => message.role === "tool")).toBe(true);
    expect(prepared.messages.some(message => message.role === "system" &&
      typeof message.content === "string" && message.content.includes(coder.instructions))).toBe(true);
    expect(JSON.stringify(extra)).toBe(before);
  });

  it("removing effects to force a fit is not an evidence-preserving compaction strategy", () => {
    const withoutFailures = extra.filter(message =>
      !JSON.stringify(message).includes("campaign07-step-18") &&
      !JSON.stringify(message).includes("campaign07-step-19"));
    expect(JSON.stringify(withoutFailures)).not.toContain("ETARGET @types/supertest");
    expect(JSON.stringify(withoutFailures)).not.toContain("Correction required: &&");
    // Retention is verified against the complete source instead; this test
    // deliberately does NOT treat an edited source as an authorized solution.
    expect(JSON.stringify(extra)).toContain("ETARGET @types/supertest");
    expect(JSON.stringify(extra)).toContain("Correction required: &&");
  });
});
