import type { ExtractionCall } from "@/modules/ai/lib/compactionExtraction";
import { createConversationCompactor } from "@/modules/ai/lib/conversationCompaction";
import type {
  MemoryCandidate,
  MemoryEvidence,
  MemorySourceLocator,
  MemoryView,
} from "@/modules/ai/lib/conversationMemory";
import type { LanguageModel, UIMessage } from "ai";
import { expect, vi } from "vitest";

export const limits = { deployed: 32768, workingTarget: 6000 };
const defaultOwner = { sessionId: "chat-a", workspaceId: "local:/workspace-a" };
export const textMessage = (
  id: string,
  role: "user" | "assistant",
  text: string,
): UIMessage => ({ id, role, parts: [{ type: "text", text }] });
export function history(label = "schema 3") {
  return [
    textMessage(
      "user-original",
      "user",
      "Never change port 1420, auth.ts or the permission checks.",
    ),
    ...Array.from({ length: 8 }, (_, i) =>
      textMessage(
        `assistant-${i}`,
        "assistant",
        `Decision ${i}: use ${label}; tests remain unresolved.\n${"historical details ".repeat(230)}`,
      ),
    ),
    textMessage(
      "latest-user",
      "user",
      "Continue the pending migration; preserve the constraints.",
    ),
  ];
}
const disposals: Array<() => void> = [];
export function disposeCompactionFixtures() {
  for (const dispose of disposals.splice(0)) dispose();
}

export function compactionFixture(originals = history(), owner = defaultOwner) {
  let view: MemoryView = {
    preparation: {
      runtimeId: "process",
      owner,
      source: {
        transcriptRevision: 1,
        profileRevision: 1,
        transcriptHash: "a".repeat(64),
        profileHash: "b".repeat(64),
      },
      generation: 0,
      previous: null,
    },
    revisionId: null,
    revision: null,
    uncoveredMessages: originals.length,
    sourceChanged: false,
  };
  const records = new Map<string, MemoryEvidence>();
  const sourceId = (id: string) =>
    (originals.findIndex((m) => m.id === id) + 1)
      .toString(16)
      .padStart(64, "0");
  const stepBounds = (message: UIMessage) => {
    const starts = message.parts.flatMap((part, index) => part.type === "step-start" ? [index] : []);
    return starts[0] === 0
      ? starts.map((start, index) => [start, starts[index + 1] ?? message.parts.length] as const)
      : [];
  };
  const sourceUnits = (mode?: "agent-steps-v1") =>
    originals.flatMap(message => mode && message.role === "assistant" && stepBounds(message).length
      ? stepBounds(message).map(([start, end], index) => ({
          id: `agent-step:${message.id}:${index}`, role: "assistant", parts: message.parts.slice(start, end),
        }))
      : [message]);
  const locatorId = (locator: MemorySourceLocator) => {
    if (locator.kind === "agentStep")
      return ((originals.findIndex(m => m.id === locator.messageId) + 1) * 1000 + locator.stepIndex + 1)
        .toString(16).padStart(64, "0");
    if (locator.kind === "message") return sourceId(locator.messageId);
    throw new Error("fixture unsupported locator");
  };
  const read = vi.fn(async (prep, sources) => {
    if (JSON.stringify(prep) !== JSON.stringify(view.preparation))
      throw new Error("memory_stale_preparation");
    return (sources as MemorySourceLocator[]).map(locator => {
      if (locator.kind !== "message" && locator.kind !== "agentStep")
        throw new Error("fixture unsupported locator");
      const ancestor = originals.find(m => m.id === locator.messageId);
      if (!ancestor) throw new Error("memory_missing_message");
      const value = locator.kind === "agentStep"
        ? (() => {
            const bounds = stepBounds(ancestor)[locator.stepIndex];
            if (!bounds) throw new Error("memory_missing_agent_step");
            return { id: `agent-step:${ancestor.id}:${locator.stepIndex}`,
              role: "assistant" as const, parts: ancestor.parts.slice(bounds[0], bounds[1]) };
          })()
        : ancestor;
      const evidence: MemoryEvidence = {
        id: locatorId(locator),
        digest: "d".repeat(64),
        sourceRevision: 1,
        locator,
        contentIds: [],
        relatedSessions: [owner.sessionId],
      };
      records.set(evidence.id, evidence);
      return { value: structuredClone(value), evidence };
    });
  });
  const memory = {
    load: vi.fn(async (asked) => {
      expect(asked).toEqual(owner);
      return structuredClone(view);
    }),
    read,
    commit: vi.fn(async (candidate: MemoryCandidate, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      if (
        JSON.stringify(candidate.preparation) !==
        JSON.stringify(view.preparation)
      )
        throw new Error("memory_stale_preparation");
      if (view.revision && view.revision.coverage.unitMode !== candidate.unitMode)
        throw new Error("memory_coverage_mode_migration_required");
      const coverage = sourceUnits(candidate.unitMode);
      if (candidate.end > coverage.length)
        throw new Error("memory_invalid_candidate");
      const revision = (view.revision?.revision ?? 0) + 1;
      const revisionId = revision.toString(16).padStart(64, "0");
      const evidence = candidate.sources
        .map((s) =>
          s.kind === "retained"
            ? records.get(s.evidenceId)
            : s.kind === "message" || s.kind === "agentStep"
              ? records.get(locatorId(s))
              : undefined,
        )
        .filter((e): e is MemoryEvidence => Boolean(e));
      view = {
        ...view,
        revisionId,
        preparation: {
          ...view.preparation,
          generation: view.preparation.generation + 1,
          previous: revisionId,
        },
        revision: {
          schemaVersion: 1,
          preparation: candidate.preparation,
          revision,
          createdAt: 1,
          producer: {},
          policyVersion: candidate.policyVersion,
          coverage: {
            start: candidate.start,
            end: candidate.end,
            digest: "c".repeat(64),
            latestMessageId: coverage[candidate.end - 1].id,
            sourceMessageCount: coverage.length,
            ...(candidate.unitMode ? { unitMode: candidate.unitMode } : {}),
          },
          evidence,
          claims: candidate.claims,
        },
        uncoveredMessages: coverage.length - candidate.end,
      };
      return revisionId;
    }),
  };
  const call = vi.fn<ExtractionCall>(async (options) => {
    const request = JSON.parse(options.messages[1].content as string);
    return {
      text: JSON.stringify({
        claims: request.sources.map(
          (source: { id: string; passages: string[] }) => ({
            source: source.id,
            section: "decisions",
            text: source.passages[0].split("\n")[0],
            quote: source.passages[0].split("\n")[0],
            status: "unresolved",
            contradicts: [],
          }),
        ),
      }),
      usage: { inputTokens: 100, outputTokens: 700, cachedInputTokens: 0 },
    };
  });
  const ready = vi.fn(async () => {});
  const chargeCall = vi.fn(async () => {});
  const onOptimized = vi.fn();
  const onStep = vi.fn();
  const start = async (
    extra: Partial<Parameters<typeof createConversationCompactor>[0]> = {},
  ) => {
    const compactor = await createConversationCompactor({
      context: {
        owner,
        originals: structuredClone(originals),
        ready,
        remainingCalls: () => 10,
        chargeCall,
      },
      materialized: structuredClone(originals),
      model: {} as LanguageModel,
      scope: {
        sessionId: owner.sessionId,
        runId: "captured-run",
        isCurrent: () => true,
      },
      system: [
        {
          role: "system",
          content: "Keep the authorized route and workspace permissions.",
        },
      ],
      tools: [],
      limits: async () => limits,
      memory,
      call,
      onOptimized,
      onStep,
      ...extra,
    });
    disposals.push(compactor.dispose);
    return compactor;
  };
  return {
    originals,
    memory,
    call,
    start,
    ready,
    chargeCall,
    onOptimized,
    onStep,
    view: () => structuredClone(view),
    change: (next: Partial<MemoryView>) => {
      view = { ...view, ...next };
    },
  };
}
