/** Single-use, non-ForgeBoard production compaction acceptance WebView.
 * All production modules are imported unchanged; only the first extractor's
 * deadline callback is fired early in this isolated host as an explicit test
 * injection. All subsequent timers retain their production 120-second policy.
 */
import { invoke } from "@tauri-apps/api/core";
import { generateText, wrapLanguageModel, type UIMessage } from "ai";
import { createConversationCompactor } from "@/modules/ai/lib/conversationCompaction";
import { COMPACTION_POLICY, type ExtractionCall } from "@/modules/ai/lib/compactionExtraction";
import { loadConversationMemory } from "@/modules/ai/lib/conversationMemory";
import { createOllamaModel } from "@/modules/ai/lib/ollamaModel";
import { createProxyFetch } from "@/modules/ai/lib/proxyFetch";
import { observePreparationSignal, installPreparationObserver } from "@/modules/ai/lib/preparationLifecycle";
import { saveSessionsList, saveMessages, type SessionMeta } from "@/modules/ai/lib/sessions";
import { createRunBudget } from "@/modules/ai/lib/runBudget";
import { controlledHistory } from "@/test/clackControlledCompactionHistory20261114";

const modelId = "muse-glimmer:30b";
const url = "http://127.0.0.1:11435";
const sessionId = "controlled-compaction-live-20261114-01";
const runId = "controlled-compaction-1";
const configuration = new URL(location.href).searchParams.get("configuration");
if (!configuration) throw new Error("Controlled proof configuration is missing");
const config = await (await fetch(configuration)).json() as { report: string, mode: string };
if (config.mode !== "non-forgeboard-compaction" || !("__TAURI_INTERNALS__" in window))
  throw new Error("Not in isolated production-native controlled verification host");

const observations: Array<{ phase: string, nativeRequestId?: string, at: number }> = [];
const detach = installPreparationObserver(entry => {
  if (entry.sessionId === sessionId && entry.runId === runId && observations.length < 256)
    observations.push({ phase: entry.phase, at: entry.at,
      ...(entry.nativeRequestId ? { nativeRequestId: entry.nativeRequestId } : {}) });
});
let compactor: Awaited<ReturnType<typeof createConversationCompactor>> | undefined;
let injected = false;
let charged = 5;
const calls: Array<{ sources: number, status: string }> = [];
let exitResult: Record<string, unknown> = { ok: false, stage: "initialization" };
const originals = controlledHistory();
const preserved = JSON.stringify(originals);
const owner = { sessionId, workspaceId: null };
const scope = { sessionId, runId, isCurrent: () => true };
const startedAt = Date.now();
const meta: SessionMeta = { id: sessionId, title: "Controlled live compaction verification",
  createdAt: startedAt, updatedAt: startedAt, profileVersion: 1,
  profile: { agentId: "builtin:coder", modelId, workspaceId: null, workspaceRoot: null },
  run: { state: "running", agentId: "builtin:coder", modelId, startedAt,
    budget: { ...createRunBudget("chat-only"), totalSteps: charged } },
};
const charge = async () => {
  charged++;
  meta.run!.budget = { ...meta.run!.budget!, totalSteps: charged };
  await saveSessionsList([meta]);
};
// Reuse SDK generateText's actual production extraction semantics, but observe
// only source counts, never persist prompts, claims or generated text.
const liveCall: ExtractionCall = async options => {
  const payload = JSON.parse(options.messages[1].content as string) as { sources: unknown[] };
  const receipt = { sources: payload.sources.length, status: "started" };
  calls.push(receipt);
  try {
    const result = await generateText({ ...options, maxRetries: 0 });
    observePreparationSignal(options.abortSignal, "sdk-generate-settled");
    receipt.status = "settled";
    return { text: result.text, usage: {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      cachedInputTokens: result.usage.inputTokenDetails?.cacheReadTokens ?? 0,
    } };
  } catch (error) {
    receipt.status = options.abortSignal.aborted ? "aborted" : "failed";
    throw error;
  }
};

try {
  await saveSessionsList([meta]);
  await saveMessages(sessionId, originals);
  const before = await loadConversationMemory(owner);
  if (before.revisionId !== null || before.uncoveredMessages !== originals.length)
    throw new Error("Isolated native memory does not begin with untouched original history");
  const nativeModel = createOllamaModel({ modelId, baseURL: url,
    fetch: createProxyFetch({ scope, selfHosted: true, allowPrivateNetwork: true }) });
  // Explicit controlled allocation matching the failed production extraction;
  // no model, prompt, response or timeout is mocked on the successful retry.
  const model = wrapLanguageModel({ model: nativeModel, middleware: {
    specificationVersion: "v3",
    transformParams: async ({ params }) => ({ ...params,
      providerOptions: { ...params.providerOptions, ollama: { ...params.providerOptions?.ollama, numCtx: 16384 } },
    }),
  } });
  const limits = async () => ({ deployed: 32768, workingTarget: 7900, maxOutput: 4096, outputReserve: 4096 });
  const route = async () => ({ model, limits: async () => ({ deployed: 16384, maxOutput: 1024, outputReserve: 1024 }) });
  compactor = await createConversationCompactor({
    context: { owner, originals: structuredClone(originals), ready: async () => {},
      remainingCalls: () => 240 - charged - 1, chargeCall: charge },
    materialized: structuredClone(originals), system: [{ role: "system", content: "Preserve current obligations and prior completed tool results. Only answer the controlled task." }],
    tools: [], model, scope, limits, extractionRoute: route, call: liveCall,
  });
  // Inject the *existing* production deadline callback precisely once at the
  // extraction boundary. The production CompactionError and abort path execute
  // unchanged. Restore normal 120000-ms timers before the smaller retry exists.
  const originalTimeout = globalThis.setTimeout;
  (globalThis as { setTimeout: typeof setTimeout }).setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    if (!injected && timeout === COMPACTION_POLICY.timeoutMs) {
      injected = true;
      globalThis.setTimeout = originalTimeout;
      return originalTimeout(handler, 3_000, ...args);
    }
    return originalTimeout(handler, timeout, ...args);
  }) as typeof setTimeout;
  let prepared: Awaited<ReturnType<typeof compactor.prepare>>;
  try { prepared = await compactor.prepare(); }
  finally { globalThis.setTimeout = originalTimeout; }
  const after = await loadConversationMemory(owner);
  const disk = await invoke<UIMessage[] | null>("conversation_session_get", { key: `messages:${sessionId}` });
  const retry = observations.filter(item => item.phase === "extraction-timeout-retry");
  const fired = observations.filter(item => item.phase === "extractor-deadline-fired");
  const links = observations.filter(item => item.phase === "native-request-linked");
  const settled = observations.filter(item => item.phase === "native-http-settled");
  const retryIndex = observations.findIndex(item => item.phase === "extraction-timeout-retry");
  const beforeRetryNative = links.filter(item => observations.indexOf(item) < retryIndex);
  const settledBeforeRetry = settled.filter(item => observations.indexOf(item) < retryIndex);
  const second = links.filter(item => observations.indexOf(item) > retryIndex);
  const serializedPrepared = JSON.stringify(prepared);
  const existingToolCalls = originals.flatMap(m => m.parts).filter(part => part.type.startsWith("tool-")).length;
  const valid = injected && fired.length === 1 && retry.length === 1 && calls.length >= 2 &&
    calls[0].status === "aborted" && calls[1].status === "settled" &&
    calls[0].sources > calls[1].sources && calls[1].sources > 0 &&
    beforeRetryNative.length === 1 && settledBeforeRetry.length === 1 &&
    beforeRetryNative[0].nativeRequestId === settledBeforeRetry[0].nativeRequestId &&
    second.length >= 1 && after.revisionId !== null && !!after.revision &&
    after.revision.coverage.end > 0 && after.preparation.generation > before.preparation.generation &&
    JSON.stringify(disk) === preserved && JSON.stringify(originals) === preserved &&
    serializedPrepared.includes("controlled-correction-user") === false &&
    serializedPrepared.includes("Continue the same logical task") &&
    serializedPrepared.includes("controlled-completed-5") && existingToolCalls === 5 &&
    charged === 5 + calls.length && meta.run!.budget?.continuationCount === 0;
  if (!valid) throw new Error("Live compaction recovery invariant mismatch (see redacted evidence)");
  // One further preparation in the same native session reads the durable
  // revision without touching, replaying or replacing any original tool result.
  compactor.dispose(); compactor = undefined;
  const same = await createConversationCompactor({
    context: { owner, originals: structuredClone(originals), ready: async () => {},
      remainingCalls: () => 240 - charged - 1, chargeCall: charge },
    materialized: structuredClone(originals), system: [{ role: "system", content: "Preserve current obligations and prior completed tool results. Only answer the controlled task." }],
    tools: [], model, scope, limits, extractionRoute: route, call: liveCall,
  });
  let continuationOutputTokens = 0;
  try {
    const carriedMessages = await same.prepare();
    const carried = JSON.stringify(carriedMessages);
    if (!carried.includes("Continue the same logical task") || !carried.includes("controlled-completed-5"))
      throw new Error("Logical controlled Agent conversation did not retain protected obligations");
    // Demonstrate a genuine additional provider generation on the *same*
    // logical conversation and its durable compacted memory. No tools are
    // offered or executed; all earlier tool effects remain historical only.
    const continued = await generateText({ model, messages: carriedMessages,
      maxOutputTokens: 128, maxRetries: 0 });
    continuationOutputTokens = continued.usage.outputTokens ?? 0;
    if (!continued.text.trim() || continuationOutputTokens < 1)
      throw new Error("Native model did not continue the controlled conversation");
  } finally { same.dispose(); }
  exitResult = { ok: true, status: "PRODUCTION_AGENT_COMPACTION_RECOVERY=PASS",
    source: "native-production", injectedTimeout: true, firstDeadlinePolicyMs: COMPACTION_POLICY.timeoutMs,
    firstDeadlineInjectedAtMs: 3000, calls, charged, continuationCount: meta.run!.budget?.continuationCount,
    before: { generation: before.preparation.generation, revisionId: before.revisionId },
    after: { generation: after.preparation.generation, revisionId: after.revisionId,
      coverageEnd: after.revision?.coverage.end ?? 0, claims: after.revision?.claims.length ?? 0 },
    originalHistoryIntact: true, originalToolResults: existingToolCalls,
    observations, sameConversationReprepared: true,
    sameConversationNativeContinued: true, continuationOutputTokens };
} catch (error) {
  exitResult = { ok: false, status: "PRODUCTION_AGENT_COMPACTION_RECOVERY=FAIL",
    errorName: error instanceof Error ? error.name : typeof error,
    errorCode: error && typeof error === "object" && "code" in error ? String(error.code) : undefined,
    errorMessage: error instanceof Error ? error.message.slice(0, 400) : "unknown",
    injected, calls, charged, observations };
} finally {
  compactor?.dispose(); detach();
  try { await fetch(config.report, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(exitResult), signal: AbortSignal.timeout(15_000) }); }
  finally { await invoke("coworking_exit"); }
}
