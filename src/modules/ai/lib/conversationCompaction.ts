import {
  convertToModelMessages,
  pruneMessages,
  type LanguageModel,
  type ModelMessage,
  type UIMessage,
} from "ai";
import {
  COMPACTION_POLICY,
  CompactionError,
  createBoundedExtractor,
  extractionMessages,
  type ExtractionCall,
  type ExtractionSource,
  type ExtractionUsage,
} from "@/modules/ai/lib/compactionExtraction";
import {
  planCompaction,
  type CompactionUnit,
} from "@/modules/ai/lib/compactionPlan";
import {
  measureRequest,
  resolveContextBudget,
  type BudgetLimits,
} from "@/modules/ai/lib/contextBudget";
import {
  loadConversationMemory,
  readCompactionSources,
  commitConversationMemory,
  type MemoryOwner,
  type MemorySourceLocator,
  type MemoryView,
} from "@/modules/ai/lib/conversationMemory";
import type { InferenceScope } from "@/modules/ai/lib/inferenceLifecycle";
import {
  createConversationRetriever,
  type retrieveConversationEvidence,
  type RetrievalNotice,
} from "@/modules/ai/lib/conversationRetrieval";

export type CompactionNotice = {
  coveredMessages: number;
  retainedMessages: number;
  generatedTokens: number;
  omittedCompletedClaims: number;
};
export type ConversationCompactionContext = {
  owner: MemoryOwner;
  originals: UIMessage[];
  ready: () => Promise<void>;
  remainingCalls: () => number;
  chargeCall: () => Promise<void>;
};
const nativeMemory = {
  load: loadConversationMemory,
  read: readCompactionSources,
  commit: commitConversationMemory,
};

function memoryFailure(error: unknown): never {
  if (
    error instanceof CompactionError ||
    (error instanceof Error && error.name === "AbortError")
  )
    throw error;
  const code = String(error).match(/\bmemory_[a-z_]+\b/)?.[0];
  throw new CompactionError(
    "memory",
    code === "memory_stale_preparation"
      ? `Conversation memory changed during preparation (${code}). Retry with the current conversation state.`
      : `Conversation memory could not be read or published${code ? ` (${code})` : ""}. The next response request was blocked. Check memory integrity and workspace access before retrying; do not delete the original history.`,
  );
}

async function memoryOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    return memoryFailure(error);
  }
}

function equalJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.entries(a);
  const right = b as Record<string, unknown>;
  const keys = new Set(Object.keys(right));
  return (
    left.length === keys.size &&
    left.every(([key, value]) => keys.has(key) && equalJson(value, right[key]))
  );
}

function passages(message: UIMessage): string[] {
  return message.parts.flatMap((part) => {
    if (part.type === "text" || part.type === "reasoning")
      return part.text.trim() ? [part.text] : [];
    if (part.type.startsWith("tool-") || part.type === "dynamic-tool")
      return [JSON.stringify(part)];
    return [];
  });
}

function usable(view: MemoryView): void {
  if (view.sourceChanged)
    throw new CompactionError(
      "changed-source",
      "Earlier source messages changed. This memory cannot safely replace them; restore the original branch or start a new conversation.",
    );
  if (
    view.revision &&
    (view.revision.policyVersion !== COMPACTION_POLICY.version ||
      view.revision.coverage.start !== 0)
  )
    throw new CompactionError(
      "policy",
      "This memory revision requires an explicit policy migration before automatic use.",
    );
}

export async function createConversationCompactor(options: {
  context: ConversationCompactionContext;
  materialized: UIMessage[];
  system: ModelMessage[];
  tools: unknown;
  model: LanguageModel;
  scope: InferenceScope;
  limits: () => Promise<BudgetLimits>;
  signal?: AbortSignal;
  keepReasoning?: boolean;
  onStep?: (step: string | null) => void;
  onUsage?: (usage: ExtractionUsage) => void;
  onOptimized?: (notice: CompactionNotice) => void;
  memory?: typeof nativeMemory;
  call?: ExtractionCall;
  retrieve?: typeof retrieveConversationEvidence;
  onRetrieved?: (notice: RetrievalNotice) => void;
}) {
  const { context } = options;
  const memory = options.memory ?? nativeMemory;
  const check = () => {
    options.signal?.throwIfAborted();
    if (!options.scope.isCurrent())
      throw new CompactionError(
        "stale",
        "The captured conversation run is no longer current.",
      );
  };
  check();
  const units: CompactionUnit[] = [];
  for (const [index, original] of context.originals.entries()) {
    const materialized = options.materialized[index];
    if (!materialized || materialized.id !== original.id)
      throw new CompactionError(
        "source-identity",
        "Materialized context no longer matches the original conversation.",
      );
    units.push({
      messageId: original.id,
      role: original.role,
      messages: pruneMessages({
        messages: await convertToModelMessages([materialized]),
        reasoning: options.keepReasoning
          ? "none"
          : index < context.originals.length - 1
            ? "all"
            : "before-last-message",
        emptyMessages: "remove",
      }),
      hasContentReferences: original.parts.some(
        (part) => part.type === "file" || part.type.startsWith("data-"),
      ),
    });
  }
  let view: MemoryView | undefined;
  let extractor: ReturnType<typeof createBoundedExtractor> | undefined;
  let profileHash: string | undefined;
  let prepared = false;
  let published = 0;
  let initialReady = false;
  const retriever = options.retrieve
    ? createConversationRetriever({
        originals: context.originals,
        scope: options.scope,
        signal: options.signal,
        read: options.retrieve,
        onNotice: options.onRetrieved,
      })
    : undefined;
  const load = async () => {
    check();
    if (!initialReady) {
      await context.ready();
      initialReady = true;
      check();
    }
    const next = await memoryOperation(() => memory.load(context.owner));
    check();
    usable(next);
    if (profileHash && profileHash !== next.preparation.source.profileHash)
      throw new CompactionError(
        "stale",
        "The conversation model, agent or workspace changed during preparation.",
      );
    profileHash = next.preparation.source.profileHash;
    view = next;
    return next;
  };
  const summarize = () => {
    extractor ??= createBoundedExtractor({
      model: options.model,
      scope: options.scope,
      limits: options.limits,
      signal: options.signal,
      remainingCalls: context.remainingCalls(),
      onCall: context.chargeCall,
      onUsage: options.onUsage,
      call: options.call,
    });
    return extractor;
  };
  return {
    dispose: () => {
      extractor?.dispose();
      retriever?.dispose();
    },
    requestEvidence: (query: string, anchor?: string, expand?: boolean) =>
      retriever?.request(query, anchor, expand) ?? {
        status: "unavailable",
        message: "Conversation retrieval is unavailable.",
      },
    async prepare(extra: ModelMessage[] = []): Promise<ModelMessage[]> {
      check();
      let limits = await options.limits();
      check();
      const plan = () =>
        planCompaction({
          units,
          limits,
          system: options.system,
          tools: options.tools,
          extra,
          threshold: prepared
            ? COMPACTION_POLICY.target
            : COMPACTION_POLICY.trigger,
          memory: view?.revision
            ? { end: view.revision.coverage.end, claims: view.revision.claims }
            : undefined,
        });
      // Small conversations require neither disk reads nor model-assisted preparation.
      let current = plan();
      if (!current.needed && !view && !retriever?.hasPending())
        return current.messages;
      await load();
      current = plan();
      const finish = () =>
        view && retriever
          ? retriever.prepare(
              view,
              current.groups,
              current.messages,
              limits,
              options.tools,
            )
          : Promise.resolve(current.messages);
      if (!current.needed) return finish();
      const batch = summarize();
      options.onStep?.("Preparing conversation context...");
      try {
        for (;;) {
          check();
          const captured = view;
          if (!captured)
            throw new CompactionError(
              "missing-memory",
              "Conversation memory is unavailable.",
            );
          const start = captured.revision?.coverage.end ?? 0;
          const prior = captured.revision?.claims ?? [];
          batch.assertCurrent();
          if (published >= COMPACTION_POLICY.maxChunks)
            throw new CompactionError(
              "batch-limit",
              `Prepared through original message ${start}. Retry to prepare the next bounded batch before sending this request.`,
            );
          let end = start;
          let selected: ExtractionSource[] = [];
          let locators: MemorySourceLocator[] = [];
          for (const group of current.groups.filter(
            (g) => g.start >= start && g.end <= current.tailStart,
          )) {
            if (group.end - start > 4 && end > start) break;
            const proposed: MemorySourceLocator[] = units
              .slice(start, group.end)
              .map((unit) => ({ kind: "message", messageId: unit.messageId }));
            if (
              proposed.length + (captured.revision?.evidence.length ?? 0) >
              COMPACTION_POLICY.maxEvidence
            )
              break;
            let original: Awaited<ReturnType<typeof memory.read>>;
            try {
              original = await memory.read(captured.preparation, proposed);
            } catch (error) {
              if (
                String(error).includes("memory_evidence_quota") &&
                end > start
              )
                break;
              memoryFailure(error);
            }
            check();
            const sources: ExtractionSource[] = [];
            for (const [offset, expected] of context.originals
              .slice(start, group.end)
              .entries()) {
              const item = original.find(
                (s) =>
                  s.evidence.locator.kind === "message" &&
                  s.evidence.locator.messageId === expected.id,
              );
              if (!item || !equalJson(item.value, expected))
                throw new CompactionError(
                  "stale",
                  "Original message content changed before extraction.",
                );
              const text = passages(expected);
              // Protected originals remain verbatim; don't reinterpret their envelopes.
              if (text.length)
                sources.push({
                  evidence: item.evidence,
                  role: units[start + offset].role,
                  passages: text,
                });
            }
            const request = extractionMessages(sources, prior);
            const size = new TextEncoder().encode(
              JSON.stringify(sources),
            ).byteLength;
            if (
              size > COMPACTION_POLICY.maxSourceBytes ||
              !resolveContextBudget(
                limits,
                measureRequest({ messages: request }),
                Math.min(1024, resolveContextBudget(limits).output),
              ).fits
            )
              break;
            end = group.end;
            selected = sources;
            locators = proposed;
          }
          if (end === start)
            throw new CompactionError(
              "source-budget",
              "The next intact original-message/tool group or retained memory exceeds the extraction bound. Choose a larger verified context or a new conversation; no source was truncated.",
            );
          const claims = selected.length
            ? await batch.extract(selected, prior)
            : prior;
          check();
          batch.assertCurrent();
          const retained: MemorySourceLocator[] = captured.revisionId
            ? (captured.revision?.evidence ?? []).map((e) => ({
                kind: "retained",
                revisionId: captured.revisionId as string,
                evidenceId: e.id,
              }))
            : [];
          const candidate = {
            preparation: captured.preparation,
            policyVersion: COMPACTION_POLICY.version,
            start: 0,
            end,
            sources: [...retained, ...locators],
            claims,
          };
          if (
            new TextEncoder().encode(JSON.stringify(candidate)).byteLength >
            COMPACTION_POLICY.maxSourceBytes
          )
            throw new CompactionError(
              "record-limit",
              "The bounded memory record is full; the previous revision remains valid.",
            );
          // A partial batch may leave uncovered history over budget, but its new
          // mandatory memory and protected originals must fit before publication.
          planCompaction({
            units,
            limits,
            system: options.system,
            tools: options.tools,
            extra,
            memory: { end, claims },
            threshold: COMPACTION_POLICY.target,
          });
          const revisionId = await memoryOperation(() =>
            memory.commit(candidate, batch.signal),
          );
          published++;
          check();
          const loaded = await load();
          if (loaded.revisionId !== revisionId)
            throw new CompactionError(
              "stale",
              "Another memory revision was committed during preparation. Retry with current state.",
            );
          limits = await options.limits();
          check();
          prepared = true;
          current = plan();
          const target = current.budget.working * COMPACTION_POLICY.target;
          if (
            current.budget.fits &&
            (current.budget.cost.conversation <= target || !current.needed)
          )
            break;
        }
        if (!current.budget.fits)
          throw new CompactionError(
            "budget",
            current.budget.reason ?? "The prepared request still exceeds B1.",
          );
        if (prepared)
          options.onOptimized?.({
            coveredMessages: view?.revision?.coverage.end ?? 0,
            retainedMessages: current.groups
              .filter((g) => g.protected || g.end > current.coveredEnd)
              .reduce((n, g) => n + g.end - g.start, 0),
            generatedTokens: batch.snapshot().generatedTokens,
            omittedCompletedClaims: current.omittedCompletedClaims,
          });
        return await finish();
      } finally {
        options.onStep?.(null);
      }
    },
  };
}
