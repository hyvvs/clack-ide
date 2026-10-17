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
  confirmedWorkspaceWrites,
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
  rebaseConversationMemory,
  type MemoryOwner,
  type MemorySourceLocator,
  type MemoryView,
  type MemoryRevision,
} from "@/modules/ai/lib/conversationMemory";
import type { InferenceScope } from "@/modules/ai/lib/inferenceLifecycle";
import {
  createConversationRetriever,
  type retrieveConversationEvidence,
  type RetrievalNotice,
  RETRIEVAL_POLICY,
  RetrievalError,
} from "@/modules/ai/lib/conversationRetrieval";
import {
  createScopedRetriever,
  isScopedAnchor,
  type retrieveScopedEvidence,
} from "@/modules/ai/lib/scopedEvidence";
import {
  newRetrievalAllowance,
  claimRetrievalRound,
  type RetrievalAllowance,
} from "@/modules/ai/lib/retrievalAllowance";
import { projectCompletedPeerHistory } from "@/modules/ai/lib/peerHistory";
import { usePeerTaskStore } from "@/modules/ai/store/peerTaskStore";
import { contextDigest } from "@/modules/ai/lib/targetContext";

export type CompactionNotice = {
  coveredMessages: number;
  retainedMessages: number;
  generatedTokens: number;
  omittedCompletedClaims: number;
};
export type ConversationCompactionContext = {
  hasTargetContext?: boolean;
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
  rebase: rebaseConversationMemory,
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

export async function conversationCompactionUnits(originals: UIMessage[], materialized: UIMessage[], sessionId: string, keepReasoning = false): Promise<CompactionUnit[]> {
  const projected = await projectCompletedPeerHistory(originals, sessionId, usePeerTaskStore.getState().tasks);
  const units: CompactionUnit[] = [];
  for (const [index, original] of originals.entries()) {
    const message = projected[index]?.role !== original.role ? projected[index] : materialized[index];
    if (!message || message.id !== original.id)
      throw new CompactionError("source-identity", "Materialized context no longer matches the original conversation.");
    units.push({
      messageId: original.id,
      role: message.role,
      messages: pruneMessages({ messages: await convertToModelMessages([message]), reasoning: keepReasoning ? "none" : index < originals.length - 1 ? "all" : "before-last-message", emptyMessages: "remove" }),
      hasContentReferences: original.parts.some(part => part.type === "file" || part.type.startsWith("data-")),
    });
  }
  return units;
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
  memory?: Omit<typeof nativeMemory, "rebase"> & { rebase?: typeof rebaseConversationMemory };
  call?: ExtractionCall;
  retrieve?: typeof retrieveConversationEvidence;
  onRetrieved?: (notice: RetrievalNotice) => void;
  scopedEvidence?: {
    read: typeof retrieveScopedEvidence;
    allowed: () => boolean;
    onPrepared?: (sources: string[], omitted: number, issues: number) => void;
  };
  allowance?: RetrievalAllowance;
  targetSeed?: MemoryRevision;
  alwaysLoad?: boolean;
  extractionRoute?: () => Promise<{
    model: LanguageModel;
    limits: () => Promise<BudgetLimits>;
  }>;
}) {
  const { context } = options;
  const memory = options.memory ?? nativeMemory;
  let disposed = false;
  const check = () => {
    options.signal?.throwIfAborted();
    if (disposed || !options.scope.isCurrent())
      throw new CompactionError(
        "stale",
        "The captured conversation run is no longer current.",
      );
  };
  check();
  const units = await conversationCompactionUnits(context.originals, options.materialized, context.owner.sessionId, options.keepReasoning);
  check();
  let view: MemoryView | undefined;
  let extractor: ReturnType<typeof createBoundedExtractor> | undefined;
  let profileHash: string | undefined;
  let prepared = false;
  let published = 0;
  let initialReady = false;
  let targetSeed = options.targetSeed;
  let rebases = 0;
  let prefixHash: string | undefined;
  // The SDK extends one assistant message across batches. Its prior parts stay
  // immutable; only appended parts and app-owned activity receipts may advance.
  const tail = context.originals[context.originals.length - 1];
  const prefixCount = tail?.role === "assistant" && context.originals.length > 1 ? context.originals.length - 1 : context.originals.length;
  let tailPrefix: import("@/modules/ai/lib/conversationMemory").MemoryTailPrefix | undefined;
  let retiredCompletedClaims = 0;
  const withPreparation = async <T,>(operation: (preparation: MemoryView["preparation"]) => Promise<T>): Promise<T> => {
    for (let retries = 0; ; retries++) {
      const captured = view;
      if (!captured) throw new CompactionError("missing-memory", "Conversation memory is unavailable.");
      try { return await operation(captured.preparation); }
      catch (error) {
        check();
        const rebase = memory.rebase;
        if (!String(error).includes("memory_stale_preparation") || !rebase || retries >= 2 || rebases >= COMPACTION_POLICY.maxChunks * 2) memoryFailure(error);
        rebases++;
        await context.ready();
        check();
        prefixHash ??= await contextDigest(context.originals.slice(0, prefixCount));
        if (prefixCount < context.originals.length && !tailPrefix) {
          const header = JSON.parse(JSON.stringify(tail)) as Record<string, unknown>;
          delete header.parts;
          const metadata = header.metadata;
          if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
            delete (metadata as Record<string, unknown>).clackActivity;
            delete (metadata as Record<string, unknown>).clackAnswer;
            if (!Object.keys(metadata).length) delete header.metadata;
          }
          tailPrefix = { messageId: tail.id, headerHash: await contextDigest(header), partsCount: tail.parts.length, partsHash: await contextDigest(tail.parts) };
        }
        const hash = prefixHash;
        const next = await memoryOperation(() => rebase(captured.preparation, prefixCount, hash, tailPrefix));
        check();
        usable(next);
        if (next.preparation.source.profileHash !== captured.preparation.source.profileHash || next.revisionId !== captured.revisionId)
          throw new CompactionError("stale", "Conversation ownership or memory changed during preparation.");
        view = next;
      }
    }
  };
  const observedWrites = new Set<string>();
  const verbatimToolCallIds = new Set<string>();
  let receiptSources = new Map<string, number>();
  let pendingOriginal: string | undefined;
  const allowance = options.allowance ?? newRetrievalAllowance();
  const scoped =
    options.scopedEvidence && context.owner.workspaceId
      ? createScopedRetriever({
          scope: options.scope,
          originals: context.originals,
          workspaceId: context.owner.workspaceId,
          allowance,
          managedRound: true,
          signal: options.signal,
          ...options.scopedEvidence,
        })
      : undefined;
  const retriever = options.retrieve
    ? createConversationRetriever({
        originals: context.originals,
        scope: options.scope,
        signal: options.signal,
        read: options.retrieve,
        onNotice: options.onRetrieved,
        allowance,
        managedRound: true,
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
    view = targetSeed
      ? { ...next, revision: targetSeed, revisionId: null }
      : next;
    return view;
  };
  const summarize = (route: {
    model: LanguageModel;
    limits: () => Promise<BudgetLimits>;
  }) => {
    extractor ??= createBoundedExtractor({
      model: route.model,
      scope: options.scope,
      limits: route.limits,
      signal: options.signal,
      remainingCalls: context.remainingCalls(),
      onCall: context.chargeCall,
      onUsage: options.onUsage,
      call: options.call,
    });
    return extractor;
  };
  return {
    validateEvidence: () => scoped?.validate() ?? Promise.resolve(),
    dispose: () => {
      disposed = true;
      pendingOriginal = undefined;
      receiptSources.clear();
      verbatimToolCallIds.clear();
      extractor?.dispose();
      retriever?.dispose();
      scoped?.dispose();
    },
    requestEvidence: (query: string, anchor?: string, expand?: boolean) => {
      check();
      if (anchor && !isScopedAnchor(anchor) && receiptSources.has(anchor)) {
        if (query.length > 4096 || anchor.length > 256) return { status: "invalid", message: "Use a bounded query and original tool-call ID." };
        if (pendingOriginal || allowance.rounds >= RETRIEVAL_POLICY.rounds) return { status: "limit", message: "The shared evidence allowance is exhausted or an original-source request is pending." };
        pendingOriginal = anchor;
        return { status: "queued", message: "The original tool pair will be restored from this conversation before the next response, subject to B1. No tool will be replayed." };
      }
      return (isScopedAnchor(anchor)
        ? scoped?.request(query, anchor)
        : retriever?.request(query, anchor, expand)) ?? {
        status: "unavailable",
        message: "Conversation retrieval is unavailable.",
      };
    },
    async prepare(
      extra: ModelMessage[] = [],
      tools: unknown = options.tools,
    ): Promise<ModelMessage[]> {
      check();
      allowance.epoch++;
      if (pendingOriginal) {
        const anchor = pendingOriginal;
        pendingOriginal = undefined;
        const bytes = receiptSources.get(anchor);
        if (bytes === undefined || allowance.bytes + bytes > RETRIEVAL_POLICY.bytes || allowance.chunks >= RETRIEVAL_POLICY.chunks)
          throw new RetrievalError("limit", "The original tool pair exceeds the shared evidence allowance; inspect session history.");
        claimRetrievalRound(allowance);
        allowance.bytes += bytes;
        allowance.chunks++;
        allowance.conversationRounds++;
        verbatimToolCallIds.add(anchor);
      }
      let limits = await options.limits();
      check();
      const writes = confirmedWorkspaceWrites(extra).filter(id => !observedWrites.has(id));
      // Extraction transport also validates receipts, before final context assembly.
      if (writes.length) await scoped?.validate(true);
      check();
      for (const id of writes) observedWrites.add(id);
      const plan = () => {
        const result = planCompaction({
          units,
          limits,
          system: options.system,
          tools,
          extra,
          verbatimToolCallIds: [...verbatimToolCallIds],
          threshold: prepared
            ? COMPACTION_POLICY.target
            : COMPACTION_POLICY.trigger,
          memory: view?.revision
            ? { end: view.revision.coverage.end, claims: view.revision.claims }
            : undefined,
        });
        receiptSources = new Map(result.toolReceipts.map(receipt => [receipt.toolCallId, receipt.sourceBytes]));
        return result;
      };
      // Without shared evidence, small conversations retain the no-disk fast path.
      let current = plan();
      if (current.toolReceipts.length) {
        await context.ready();
        check();
      }
      if (
        !current.needed &&
        !view &&
        !retriever?.hasPending() &&
        !scoped &&
        !targetSeed &&
        !options.alwaysLoad
      )
        return current.messages;
      await load();
      current = plan();
      const finish = async () => {
        const messages =
          view && retriever
            ? await retriever.prepare(
                view,
                current.groups,
                current.messages,
                limits,
                tools,
              )
            : current.messages;
        return scoped ? scoped.prepare(messages, limits, tools) : messages;
      };
      if (!current.needed) return finish();
      if (targetSeed) {
        targetSeed = undefined;
        await load();
        current = plan();
        if (!current.needed) return finish();
      }
      const route = options.extractionRoute
        ? await options.extractionRoute()
        : { model: options.model, limits: options.limits };
      check();
      const batch = summarize(route);
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
          const extractionLimits = await route.limits();
          check();
          const prior = [
            ...(captured.revision?.claims ?? []).filter(claim => claim.status === "user-requirement"),
            ...current.selectedClaims,
          ];
          const retired = (captured.revision?.claims.length ?? 0) - prior.length;
          batch.assertCurrent();
          if (published >= COMPACTION_POLICY.maxChunks && current.budget.fits &&
            current.budget.cost.conversation <= current.budget.working * COMPACTION_POLICY.trigger)
            break;
          if (published >= COMPACTION_POLICY.maxChunks)
            throw new CompactionError(
              "batch-limit",
              `Prepared through original message ${start}. Retry to prepare the next bounded batch before sending this request.`,
              current.budget,
            );
          let end = start;
          let selected: ExtractionSource[] = [];
          let locators: MemorySourceLocator[] = [];
          const outputAllowance = Math.min(1024, resolveContextBudget(extractionLimits).output);
          const sourceAllowance = Math.max(1, Math.floor(outputAllowance / COMPACTION_POLICY.claimAllowanceTokens));
          for (const group of current.groups.filter(
            (g) => g.start >= start && g.end <= current.tailStart,
          )) {
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
              original = await withPreparation(preparation => memory.read(preparation, proposed));
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
            if (sources.filter(source => source.role !== "user" && source.role !== "system").length > sourceAllowance && end > start) break;
            const size = new TextEncoder().encode(
              JSON.stringify(sources),
            ).byteLength;
            if (
              size > COMPACTION_POLICY.maxSourceBytes ||
              !resolveContextBudget(
                extractionLimits,
                measureRequest({ messages: request }),
                Math.min(1024, resolveContextBudget(extractionLimits).output),
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
            tools,
            extra,
            memory: { end, claims },
            threshold: COMPACTION_POLICY.target,
          });
          const revisionId = await withPreparation(preparation => memory.commit({ ...candidate, preparation }, batch.signal));
          retiredCompletedClaims += retired;
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
            current.budget,
          );
        if (prepared)
          options.onOptimized?.({
            coveredMessages: view?.revision?.coverage.end ?? 0,
            retainedMessages: current.groups
              .filter((g) => g.protected || g.end > current.coveredEnd)
              .reduce((n, g) => n + g.end - g.start, 0),
            generatedTokens: batch.snapshot().generatedTokens,
            omittedCompletedClaims: retiredCompletedClaims + current.omittedCompletedClaims,
          });
        return await finish();
      } finally {
        options.onStep?.(null);
      }
    },
  };
}
