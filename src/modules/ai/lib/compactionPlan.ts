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

type Part = { type: string; toolCallId?: string; toolName?: string; output?: unknown };
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
}) {
  const { units, limits, system, tools } = options;
  const groups = groupCompactionUnits(units);
  const extra = options.extra ?? [];
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
  };
}
