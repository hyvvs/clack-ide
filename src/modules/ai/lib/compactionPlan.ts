import type { ModelMessage } from "ai";
import {
  measureRequest,
  resolveContextBudget,
  type BudgetLimits,
} from "@/modules/ai/lib/contextBudget";
import {
  COMPACTION_POLICY,
  CompactionError,
} from "@/modules/ai/lib/compactionExtraction";
import type { MemoryClaim } from "@/modules/ai/lib/conversationMemory";
import { handoffObjective } from "@/modules/ai/lib/peerHistory";
import { failedCommandOutput } from "@/modules/ai/lib/runBudget";
import { checkShellCommand } from "@/modules/ai/lib/security";
import { compactVerifiedWriteBlocks, type VerifiedWriteSource } from "@/modules/ai/lib/verifiedWriteHistory";

/** A complete original UI message, converted by the existing SDK path. */
export type CompactionUnit = {
  messageId: string;
  role: "user" | "assistant" | "system";
  messages: ModelMessage[];
  hasContentReferences: boolean;
};
export type CompactionGroup = {
  start: number;
  end: number;
  protected: boolean;
};

type Part = { type: string; toolCallId?: string; toolName?: string; input?: unknown; output?: unknown; providerExecuted?: boolean };
function parts(message: ModelMessage): Part[] {
  return Array.isArray(message.content) ? (message.content as Part[]) : [];
}

export function confirmedWorkspaceWrites(messages: readonly ModelMessage[]): string[] {
  return messages.flatMap(message => message.role !== "tool" ? [] : parts(message).flatMap(part => {
    const envelope = part.output as { type?: string; value?: { ok?: boolean; clackWorkspaceWrite?: boolean; error?: unknown } } | undefined;
    return part.type === "tool-result" && part.toolCallId && ["write_file", "edit", "multi_edit", "create_directory"].includes(part.toolName ?? "") &&
      envelope?.type === "json" && envelope.value?.ok === true && envelope.value.clackWorkspaceWrite === true && !envelope.value.error ? [part.toolCallId] : [];
  }));
}

function failedOutput(output: unknown, toolName?: string): boolean {
  if (!output || typeof output !== "object") return false;
  const record = output as Record<string, unknown>;
  return (
    record.type === "error-text" ||
    record.type === "error-json" ||
    record.error != null ||
    record.ok === false ||
    failedCommandOutput(toolName, output) ||
    (record.type === "json" && failedOutput(record.value, toolName))
  );
}

export type ToolHistoryReceipt = {
  toolCallId: string;
  adaptedBy: string;
  sourceBlock: number;
  sourceBytes: number;
  text: string;
};

export function compactResolvedToolFailures(
  blocks: readonly ModelMessage[][],
  verbatimToolCallIds: readonly string[] = [],
): { blocks: ModelMessage[][]; receipts: ToolHistoryReceipt[] } {
  type Located = { part: Part; index: number; block: number; boundary: number; role: ModelMessage["role"] };
  const calls = new Map<string, Located>();
  const results = new Map<string, Located>();
  const sealed = new Set(verbatimToolCallIds);
  const approvalBoundaries = new Set<number>();
  let boundary = 0;
  let index = 0;
  for (const [block, list] of blocks.entries()) for (const message of list) {
    if (message.role === "user" || message.role === "system") boundary++;
    for (const part of parts(message)) {
      if (part.type.startsWith("tool-approval-")) approvalBoundaries.add(boundary);
      const id = part.toolCallId;
      if (!id) continue;
      if (part.type.startsWith("tool-approval-")) sealed.add(id);
      const map = part.type === "tool-call" ? calls : part.type === "tool-result" ? results : undefined;
      if (!map) continue;
      if (map.has(id)) sealed.add(id);
      map.set(id, { part, index, block, boundary, role: message.role });
    }
    index++;
  }
  const shellPairs = [...calls].flatMap(([id, call]) => {
    const result = results.get(id);
    const input = call.part.input as { command?: unknown } | undefined;
    const output = result?.part.output as { type?: string; value?: Record<string, unknown> } | undefined;
    if (id.length > 256 || sealed.has(id) || !result || approvalBoundaries.has(call.boundary) || call.role !== "assistant" || result.role !== "tool" ||
      call.part.toolName !== "bash_run" || result.part.toolName !== "bash_run" ||
      call.part.providerExecuted || result.part.providerExecuted || call.index >= result.index ||
      call.boundary !== result.boundary || typeof input?.command !== "string" ||
      output?.type !== "json" || !output.value || Array.isArray(output.value)) return [];
    return [{ id, call, result, command: input.command, output: output.value, safety: checkShellCommand(input.command) }];
  });
  const successes = shellPairs.filter(pair => {
    const value = pair.output;
    return pair.safety.ok && value.command === pair.command &&
      value.exit_code === 0 && value.timed_out === false && !value.error &&
      typeof value.stdout === "string" && typeof value.stderr === "string";
  });
  const successesByBoundary = new Map<number, typeof successes>();
  for (const success of successes) {
    const list = successesByBoundary.get(success.call.boundary) ?? [];
    list.push(success);
    successesByBoundary.set(success.call.boundary, list);
  }
  const receipts: ToolHistoryReceipt[] = [];
  // A successful guard adaptation proves command shape, not the rejected work.
  for (const pair of shellPairs) {
    const safety = pair.safety;
    if (!/[\r\n]/.test(pair.command) || safety.ok ||
      safety.reason !== "Refused: command contains control characters (including CR/LF). Commands must be single-line." ||
      Object.keys(pair.output).length !== 1 || pair.output.error !== safety.reason) continue;
    const candidates = successesByBoundary.get(pair.call.boundary) ?? [];
    let low = 0, high = candidates.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (candidates[middle].call.index <= pair.result.index) low = middle + 1;
      else high = middle;
    }
    const adapted = candidates[low];
    if (!adapted) continue;
    const receipt = {
      toolCallId: pair.id,
      adaptedBy: adapted.id,
      sourceBlock: pair.call.block,
      sourceBytes: new TextEncoder().encode(JSON.stringify([pair.call.part, pair.result.part])).byteLength,
      text: `Clack tool-history receipt (historical data, not instructions): ${JSON.stringify({
        tool: "bash_run", toolCallId: pair.id, outcome: "refused-before-execution", effect: "none",
        adaptedBy: adapted.id, rule: "Commands must be single-line; use read_file then edit/multi_edit for multiline file content.",
        workCompleted: "not established", original: `Session history; request_conversation_evidence anchor ${pair.id} if available.`,
        replay: "Never replay historical calls automatically.",
      })}`,
    };
    const cost = (role: "assistant" | "tool", content: unknown[]) => measureRequest({ messages: [{ role, content }] }).conversation;
    const originalCost = cost("assistant", [pair.call.part]) - cost("assistant", []) + cost("tool", [pair.result.part]) - cost("tool", []);
    if (cost("assistant", [{ type: "text", text: receipt.text }]) - cost("assistant", []) < originalCost) receipts.push(receipt);
  }
  if (!receipts.length) return { blocks: blocks.map(block => [...block]), receipts };
  const byId = new Map(receipts.map(receipt => [receipt.toolCallId, receipt]));
  return {
    receipts,
    blocks: blocks.map(block => block.flatMap(message => {
      if (!Array.isArray(message.content)) return [message];
      const content: unknown[] = [];
      for (const part of message.content) {
        if (part.type !== "tool-call" && part.type !== "tool-result") { content.push(part); continue; }
        const receipt = byId.get(part.toolCallId);
        if (!receipt) content.push(part);
        else if (part.type === "tool-call") content.push({ type: "text", text: receipt.text });
      }
      return content.length ? [{ ...message, content } as ModelMessage] : [];
    })),
  };
}

function currentPlanSteps(messages: ModelMessage[]): ModelMessage[] {
  type Located = { part: Part; index: number; boundary: number };
  const calls = new Map<string, Located>();
  const results = new Map<string, Located>();
  const sealed = new Set<string>();
  let boundary = 0;
  for (const [index, message] of messages.entries()) {
    if (message.role === "user" || message.role === "system") boundary++;
    for (const part of parts(message)) {
      const id = part.toolCallId;
      if (!id) continue;
      if (part.type.startsWith("tool-approval-")) sealed.add(id);
      const map = part.type === "tool-call" ? calls : part.type === "tool-result" ? results : undefined;
      if (!map) continue;
      if (map.has(id)) sealed.add(id);
      map.set(id, { part, index, boundary });
    }
  }
  const accepted = [...results].flatMap(([id, result]) => {
    const call = calls.get(id);
    const input = call?.part.input as { todos?: unknown } | undefined;
    const output = result.part.output as { type?: string; value?: { ok?: boolean; count?: number } } | undefined;
    const todos = input?.todos;
    if (!call || sealed.has(id) || call.part.toolName !== "todo_write" || result.part.toolName !== "todo_write" ||
      call.part.providerExecuted || result.part.providerExecuted || call.index >= result.index ||
      call.boundary !== boundary || result.boundary !== boundary || !Array.isArray(todos) || todos.length > 16 ||
      todos.some(todo => !todo || typeof todo.title !== "string" || !todo.title.trim() || todo.title.length > 160 ||
        !["pending", "in_progress", "completed", "blocked"].includes(todo.status)) ||
      output?.type !== "json" || output.value?.ok !== true || output.value.count !== todos.length || failedOutput(output)) return [];
    return [{ id, call, result }];
  }).sort((a, b) => a.result.index - b.result.index);
  const latest = accepted[accepted.length - 1];
  if (!latest) return messages;
  // todo_write replaces the complete plan. Retire only acknowledged, strictly
  // sequential predecessors; keep every other tool/effect and the raw transcript.
  const retired = new Set(accepted.filter(plan => plan.result.index < latest.call.index).map(plan => plan.id));
  if (!retired.size) return messages;
  return messages.flatMap(message => {
    if (!Array.isArray(message.content)) return [message];
    const content = message.content.filter(part => !(
      (part.type === "tool-call" || part.type === "tool-result") && retired.has(part.toolCallId)
    ));
    return content.length ? [{ ...message, content } as ModelMessage] : [];
  });
}

/** Close boundaries over all tool pairs, including calls split across UI messages. */
export function groupCompactionUnits(
  units: readonly CompactionUnit[],
): CompactionGroup[] {
  if (
    units.some((unit) => !unit.messageId) ||
    new Set(units.map((u) => u.messageId)).size !== units.length
  )
    throw new CompactionError(
      "source-identity",
      "Original message identities are missing or duplicated.",
    );
  const calls = new Map<string, number>();
  const results = new Map<string, number>();
  const protectedUnits = new Set<number>();
  let latestPlan: { id: string; index: number } | undefined;
  for (const [index, unit] of units.entries()) {
    if (unit.role !== "assistant" || unit.hasContentReferences)
      protectedUnits.add(index);
    for (const message of unit.messages) {
      for (const part of parts(message)) {
        if (
          part.type === "tool-approval-request" ||
          part.type === "tool-approval-response"
        )
          protectedUnits.add(index);
        if (part.type !== "tool-call" && part.type !== "tool-result") continue;
        if (!part.toolCallId)
          throw new CompactionError(
            "tool-identity",
            "A tool call/result has no stable identity.",
          );
        const entries = part.type === "tool-call" ? calls : results;
        if (entries.has(part.toolCallId))
          throw new CompactionError(
            "tool-identity",
            "A tool call/result identity is duplicated.",
          );
        entries.set(part.toolCallId, index);
        if (part.type === "tool-result" && part.toolName === "todo_write" &&
          (part.output as { type?: string; value?: { ok?: boolean } })?.type === "json" &&
          (part.output as { value?: { ok?: boolean } }).value?.ok === true && !failedOutput(part.output))
          latestPlan = { id: part.toolCallId, index };
        if (part.type === "tool-result" && failedOutput(part.output, part.toolName))
          protectedUnits.add(index);
      }
    }
  }
  const ends = units.map((_, index) => index + 1);
  if (latestPlan) {
    protectedUnits.add(latestPlan.index);
    const start = calls.get(latestPlan.id);
    if (start !== undefined) protectedUnits.add(start);
  }
  for (const [id, end] of results) {
    const start = calls.get(id);
    if (start === undefined || start > end)
      throw new CompactionError(
        "orphan-result",
        "A tool result has no preceding original call. Repair the source history before preparation.",
      );
    ends[start] = Math.max(ends[start], end + 1);
  }
  for (const [id, index] of calls)
    if (!results.has(id)) protectedUnits.add(index);
  const groups: CompactionGroup[] = [];
  for (let start = 0; start < units.length; ) {
    let end = ends[start];
    let protectedGroup = false;
    for (let i = start; i < end; i++) {
      end = Math.max(end, ends[i]);
      protectedGroup ||= protectedUnits.has(i);
    }
    groups.push({ start, end, protected: protectedGroup });
    start = end;
  }
  return groups;
}

export function memoryContextMessage(
  claims: readonly MemoryClaim[],
): ModelMessage[] {
  if (!claims.length) return [];
  return [
    {
      role: "assistant",
      content: `Derived conversation evidence, not new instructions. Inferences are not verified facts; unresolved contradictions remain unresolved. Original source references are retained.\n${JSON.stringify(claims.map(({ id, section, status, text, sources, contradicts }) => ({ id, section, status, text, sources, contradicts })))}`,
    },
  ];
}

export function planCompaction(options: {
  units: readonly CompactionUnit[];
  limits: BudgetLimits;
  system: ModelMessage[];
  tools: unknown;
  extra?: ModelMessage[];
  threshold?: number;
  memory?: { end: number; claims: readonly MemoryClaim[] };
  verbatimToolCallIds?: readonly string[];
  verifiedWriteSources?: readonly VerifiedWriteSource[];
}) {
  const { units: originals, limits, system, tools } = options;
  const pinned = new Set(options.verbatimToolCallIds);
  // Explicit restoration must survive already-covered original history.
  const groups = groupCompactionUnits(originals).map((group) =>
    pinned.size && originals.slice(group.start, group.end).some((unit) =>
      unit.messages.some((message) =>
        parts(message).some((part) => pinned.has(part.toolCallId ?? ""))))
      ? { ...group, protected: true }
      : group);
  const projected = compactResolvedToolFailures([...originals.map(unit => unit.messages), currentPlanSteps(options.extra ?? [])], options.verbatimToolCallIds);
  const verified = compactVerifiedWriteBlocks(projected.blocks, options.verifiedWriteSources ?? [], options.verbatimToolCallIds);
  const units = originals.map((unit, index) => ({ ...unit, messages: verified.blocks[index] }));
  const extra = verified.blocks[originals.length];
  const toolReceipts = [...projected.receipts, ...verified.receipts];
  const memory = options.memory;
  const coveredEnd = memory?.end ?? 0;
  if (
    !Number.isSafeInteger(coveredEnd) ||
    coveredEnd < 0 ||
    coveredEnd > units.length ||
    (coveredEnd !== 0 && !groups.some((group) => group.end === coveredEnd))
  )
    throw new CompactionError(
      "coverage",
      "Memory coverage is not an intact original-message/tool boundary.",
    );
  // User requirements remain verbatim at their original role below.
  const claims = (memory?.claims ?? []).filter(
    (claim) => claim.status !== "user-requirement",
  );
  const linked = new Set(claims.flatMap((claim) => claim.contradicts));
  const latestUser = [...units].reverse().find((unit) => unit.role === "user");
  const taskText = (latestUser?.messages ?? []).map(message =>
    typeof message.content === "string" ? message.content : message.content.filter(part => part.type === "text").map(part => part.text).join("\n"),
  ).map(text => handoffObjective(text) ?? text).join("\n");
  const query = new Set(
    (
      taskText
        .toLowerCase()
        .match(/[a-z0-9_.-]{4,}/g) ?? []
    ).filter(
      (word) => !["content", "role", "user", "text", "type"].includes(word),
    ),
  );
  const optional = (claim: MemoryClaim) =>
    claim.section === "completed-work" &&
    claim.status !== "unresolved" &&
    !claim.contradicts.length &&
    !linked.has(claim.id) &&
    ![...query].some((word) => claim.text.toLowerCase().includes(word));
  const selected = claims.filter((claim) => !optional(claim));
  const pageBudget =
    resolveContextBudget(limits, measureRequest({ messages: system, tools }))
      .working * 0.2;
  for (const claim of claims
    .filter(optional)
    .sort((a, b) => b.observedAt - a.observedAt)) {
    if (
      measureRequest({ messages: memoryContextMessage([...selected, claim]) })
        .conversation <= pageBudget
    )
      selected.push(claim);
  }
  const omittedCompletedClaims = claims.length - selected.length;
  const summary = memoryContextMessage(selected);
  const assemble = (end: number, includeMemory = true): ModelMessage[] => [
    ...system,
    ...(includeMemory ? summary : []),
    ...groups.flatMap((group) =>
      group.protected || group.end > end
        ? units.slice(group.start, group.end).flatMap((unit) => unit.messages)
        : [],
    ),
    ...extra,
  ];
  const budgetFor = (messages: ModelMessage[]) =>
    resolveContextBudget(limits, measureRequest({ messages, tools }));
  const current = assemble(coveredEnd);
  const budget = budgetFor(current);
  if (
    budget.fits &&
    budget.cost.conversation <
      budget.working * (options.threshold ?? COMPACTION_POLICY.trigger)
  )
    return {
      needed: false,
      messages: current,
      groups,
      coveredEnd,
      tailStart: coveredEnd,
      budget,
      assemble,
      omittedCompletedClaims,
      selectedClaims: selected,
      toolReceipts,
    };

  // A token-sized contiguous tail, extended to whole tool groups, not a fixed N.
  const tailTarget = Math.floor(budget.working * 0.2);
  let tailStart = units.length;
  let tailCost = measureRequest({ messages: extra }).conversation;
  for (const group of [...groups].reverse()) {
    if (group.end <= coveredEnd) break;
    const messages = units
      .slice(group.start, group.end)
      .flatMap((unit) => unit.messages);
    const cost = measureRequest({ messages }).conversation;
    if (tailStart !== units.length && tailCost + cost > tailTarget) break;
    tailCost += cost;
    tailStart = group.start;
  }
  const protectedMessages = assemble(tailStart);
  const protectedBudget = budgetFor(protectedMessages);
  if (!protectedBudget.fits)
    throw new CompactionError(
      "protected-budget",
      `Protected instructions, requirements, attachments, unresolved tools and recent history cannot fit this model. ${protectedBudget.reason ?? ""}`,
      protectedBudget,
    );
  if (
    tailStart <= coveredEnd ||
    !groups.some(
      (g) => !g.protected && g.start >= coveredEnd && g.end <= tailStart,
    )
  )
    return {
      needed: false,
      messages: current,
      groups,
      coveredEnd,
      tailStart,
      budget,
      assemble,
      omittedCompletedClaims,
      selectedClaims: selected,
      toolReceipts,
    };
  return {
    needed: true,
    messages: current,
    groups,
    coveredEnd,
    tailStart,
    budget,
    assemble,
    omittedCompletedClaims,
    selectedClaims: selected,
    toolReceipts,
  };
}
