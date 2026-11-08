/** Offline-only reproduction of the sealed 2026-11-08 compaction deadline.
 * No provider, native host, Ollama, or generated workspace is contacted.
 * These tests deliberately describe current behavior, not a proposed policy.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import { createOllamaModel } from "@/modules/ai/lib/ollamaModel";
import { installPreparationObserver, type PreparationObservation } from "@/modules/ai/lib/preparationLifecycle";
import {
  COMPACTION_POLICY,
  createBoundedExtractor,
  type ExtractionCall,
  type ExtractionSource,
} from "@/modules/ai/lib/compactionExtraction";
import {
  compactionFixture,
  disposeCompactionFixtures,
} from "@/modules/ai/lib/conversationCompaction.fixture";

const passage = "Original build result remains unresolved.";
const source: ExtractionSource = {
  role: "assistant",
  passages: [passage],
  evidence: {
    id: "a".repeat(64),
    digest: "d".repeat(64),
    sourceRevision: 1,
    locator: { kind: "message", messageId: "original" },
    contentIds: [],
    relatedSessions: ["offline-forensics"],
  },
};
const reply = () => ({
  text: JSON.stringify({ claims: [{
    source: source.evidence.id,
    section: "unresolved-issues",
    text: "The assistant reported an unresolved build.",
    quote: passage,
    status: "unresolved",
    contradicts: [],
  }] }),
  usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 0 },
});
const hung = <T,>() => new Promise<T>(() => {});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
};
const disposals: Array<() => void> = [];
function extractor(call: ExtractionCall, signal?: AbortSignal) {
  const run = createBoundedExtractor({
    model: {} as LanguageModel,
    scope: { sessionId: "offline-forensics", runId: "bounded", isCurrent: () => true },
    limits: async () => ({ deployed: 32768 }),
    remainingCalls: 4,
    call,
    signal,
  });
  disposals.push(run.dispose);
  return run;
}
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  disposeCompactionFixtures();
  vi.useRealTimers();
});

describe("sealed incident: 120-second extraction-batch deadline, no inference", () => {
  it("1: an extraction result well below the deadline validates successfully", async () => {
    vi.useFakeTimers();
    const call = vi.fn<ExtractionCall>(() =>
      new Promise(resolve => setTimeout(() => resolve(reply()), 60_000)));
    const run = extractor(call);
    const result = run.extract([source], []);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await result).toHaveLength(1);
    expect(run.snapshot()).toMatchObject({ calls: 1, chunks: 1 });
    expect(run.signal.aborted).toBe(false);
  });

  it("2: silent non-streaming inference is aborted at exactly the batch deadline", async () => {
    vi.useFakeTimers();
    const call = vi.fn<ExtractionCall>(() => hung());
    const run = extractor(call);
    const pending = run.extract([source], []);
    // Attach the rejection handler before advancing timers.
    const settled = expect(pending).rejects.toMatchObject({ code: "compaction-timeout" });
    await vi.advanceTimersByTimeAsync(COMPACTION_POLICY.timeoutMs);
    await settled;
    expect(run.signal.aborted).toBe(true);
    expect(run.snapshot()).toMatchObject({ calls: 1, chunks: 0 });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("3: unrelated native progress observations cannot reset the blind extractor clock", async () => {
    vi.useFakeTimers();
    const phases: number[] = [];
    const call = vi.fn<ExtractionCall>(() => hung());
    const run = extractor(call);
    const pending = run.extract([source], []);
    const settled = expect(pending).rejects.toMatchObject({ code: "compaction-timeout" });
    // These are real observed kinds of progress, but ExtractionCall has no
    // progress parameter. They intentionally cannot affect the production timer.
    for (const delay of [30_000, 60_000, 90_000]) {
      setTimeout(() => phases.push(Date.now()), delay);
    }
    await vi.advanceTimersByTimeAsync(COMPACTION_POLICY.timeoutMs);
    await settled;
    expect(phases).toHaveLength(3);
    expect(run.signal.aborted).toBe(true);
  });

  it("3b: production nonstreaming doGenerate is aborted while a simulated native request remains within its transport budget", async () => {
    vi.useFakeTimers();
    const activity: number[] = [];
    let wire: Record<string, unknown> | undefined;
    let abortedUpstream = false;
    const model = createOllamaModel({
      modelId: "offline-mock", baseURL: "http://127.0.0.1:9",
      fetch: async (_url, init) => {
        wire = JSON.parse(String(init?.body));
        return new Promise<Response>((resolve, reject) => {
          const completion = JSON.stringify({ model: "offline-mock", done: true,
            done_reason: "stop", message: { role: "assistant", content: reply().text },
            prompt_eval_count: 100, eval_count: 50 });
          const timer = setTimeout(() => resolve(new Response(completion, { status: 200 })), 150_000);
          const abort = () => { abortedUpstream = true; clearTimeout(timer); reject(init?.signal?.reason); };
          init?.signal?.addEventListener("abort", abort, { once: true });
        });
      },
    });
    const run = createBoundedExtractor({
      model, scope: { sessionId: "offline-forensics", runId: "native-mock", isCurrent: () => true },
      limits: async () => ({ deployed: 49152, maxOutput: 6144, outputReserve: 6144 }),
      remainingCalls: 4,
    });
    disposals.push(run.dispose);
    const pending = run.extract([source], []);
    const failure = expect(pending).rejects.toMatchObject({ code: "compaction-timeout" });
    // Simulated internal transport/provider activity is *not* response-body
    // progress, and cannot establish actual health in the sealed live run.
    for (const at of [30_000, 60_000, 90_000]) {
      setTimeout(() => activity.push(Date.now()), at);
    }
    await vi.advanceTimersByTimeAsync(COMPACTION_POLICY.timeoutMs);
    await failure;
    expect(activity).toHaveLength(3);
    expect(wire).toMatchObject({ stream: false });
    expect(abortedUpstream).toBe(true);
    expect(run.snapshot()).toMatchObject({ chunks: 0 });
  });

  it("4: a cooperative native memory commit stall aborts and leaves revision unchanged", async () => {
    vi.useFakeTimers();
    const f = compactionFixture();
    const entered = deferred<void>();
    f.memory.commit.mockImplementationOnce(async (_candidate, signal) => {
      entered.resolve();
      await new Promise<void>((_, reject) => {
        if (signal?.aborted) return reject(signal.reason);
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      throw new Error("unreachable");
    });
    const compactor = await f.start();
    const original = JSON.stringify(f.originals);
    const waiting = compactor.prepare();
    const failed = expect(waiting).rejects.toMatchObject({ code: "compaction-timeout" });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(COMPACTION_POLICY.timeoutMs);
    await failed;
    expect(f.view().revision).toBeNull();
    expect(JSON.stringify(f.originals)).toBe(original);
  });

  it("5: post-commit read-only memory reload now rejects at extractor deadline, never optimizes late", async () => {
    vi.useFakeTimers();
    const f = compactionFixture();
    const baseLoad = f.memory.load.getMockImplementation();
    expect(baseLoad).toBeDefined();
    const entered = deferred<void>(), release = deferred<void>();
    let loads = 0;
    f.memory.load.mockImplementation(async (owner) => {
      loads++;
      if (loads === 2) { entered.resolve(); await release.promise; }
      return baseLoad!(owner);
    });
    const compactor = await f.start();
    const pending = compactor.prepare();
    const failed = expect(pending).rejects.toMatchObject({ code: "compaction-timeout" });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(COMPACTION_POLICY.timeoutMs + 1);
    await failed;
    // The CAS already finished and must not be falsely reported as rolled back;
    // only subsequent prompt publication is blocked.
    expect(f.view().revisionId).not.toBeNull();
    expect(f.onOptimized).not.toHaveBeenCalled();
    release.resolve();
    await Promise.resolve();
    expect(f.memory.commit).toHaveBeenCalled();
    expect(f.onOptimized).not.toHaveBeenCalled();
  });

  it("6: explicit cancellation immediately rejects a stalled inference", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const run = extractor(() => hung(), controller.signal);
    const pending = run.extract([source], []);
    const cancelled = expect(pending).rejects.toBeDefined();
    controller.abort(new DOMException("Operator cancellation", "AbortError"));
    await cancelled;
    expect(run.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);
  });

  it("7: genuine provider failure propagates without a fake timeout or retry", async () => {
    const failed = new Error("provider connection lost");
    const call = vi.fn<ExtractionCall>(() => Promise.reject(failed));
    const run = extractor(call);
    await expect(run.extract([source], [])).rejects.toBe(failed);
    expect(call).toHaveBeenCalledOnce();
    expect(run.snapshot()).toMatchObject({ chunks: 0, retries: 0 });
  });

  it("8: stalled read-only extraction limits now reject immediately on deadline", async () => {
    vi.useFakeTimers();
    const gate = deferred<{ deployed: number }>();
    const call = vi.fn<ExtractionCall>(() => hung());
    const run = createBoundedExtractor({
      model: {} as LanguageModel,
      scope: { sessionId: "offline-forensics", runId: "limits", isCurrent: () => true },
      limits: () => gate.promise,
      remainingCalls: 4,
      call,
    });
    disposals.push(run.dispose);
    const pending = run.extract([source], []);
    const failed = expect(pending).rejects.toMatchObject({ code: "compaction-timeout" });
    await vi.advanceTimersByTimeAsync(COMPACTION_POLICY.timeoutMs + 1);
    expect(run.signal.aborted).toBe(true);
    await failed;
    expect(call).not.toHaveBeenCalled();
    gate.resolve({ deployed: 32768 });
    await Promise.resolve();
    expect(call).not.toHaveBeenCalled();
  });

  it("11: timestamps native/SDK JSON/validation boundaries but never reports fabricated token progress", async () => {
    vi.useFakeTimers();
    const observations: PreparationObservation[] = [];
    const unsubscribe = installPreparationObserver(event => observations.push(event));
    try {
      const model = createOllamaModel({ modelId: "offline", baseURL: "http://127.0.0.1:9",
        fetch: async () => new Response(JSON.stringify({ model: "offline", done: true,
          done_reason: "stop", message: { role: "assistant", content: reply().text },
          prompt_eval_count: 100, eval_count: 50 }), { status: 200 }),
      });
      const scope = { sessionId: "offline", runId: "json", isCurrent: () => true };
      const run = createBoundedExtractor({ model, scope, limits: async () => ({ deployed: 49152 }), remainingCalls: 4 });
      disposals.push(run.dispose);
      expect(await run.extract([source], [])).toHaveLength(1);
      const names = observations.map(event => event.phase);
      for (const stage of ["extractor-created", "extraction-model-start", "sdk-response-headers",
        "sdk-json-settled", "sdk-frame-validated", "sdk-generate-settled",
        "extraction-model-returned", "extraction-validate-start",
        "extraction-validate-completed", "extraction-completed"])
        expect(names).toContain(stage);
      expect(names.indexOf("sdk-json-settled")).toBeLessThan(names.indexOf("extraction-validate-start"));
      expect(observations.every(event => Object.keys(event).every(key =>
        ["at", "sessionId", "runId", "phase", "nativeRequestId"].includes(key)))).toBe(true);
      expect(names).not.toContain("extractor-deadline-fired");
      expect(names).not.toContain("native-response-headers"); // fake fetch is not native transport
    } finally { unsubscribe(); }
  });

  it("12: late success from a provider ignoring abort cannot publish claims or extend the elapsed clock", async () => {
    vi.useFakeTimers();
    const events: PreparationObservation[] = [];
    const unsubscribe = installPreparationObserver(event => events.push(event));
    try {
      const call = vi.fn<ExtractionCall>(() => new Promise(resolve => {
        setTimeout(() => resolve(reply()), COMPACTION_POLICY.timeoutMs + 5_000);
      }));
      const run = extractor(call);
      const pending = run.extract([source], []);
      const failed = expect(pending).rejects.toMatchObject({ code: "compaction-timeout" });
      await vi.advanceTimersByTimeAsync(COMPACTION_POLICY.timeoutMs);
      await failed;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(run.snapshot()).toMatchObject({ calls: 1, chunks: 0 });
      expect(events.map(event => event.phase)).toContain("extractor-deadline-fired");
      expect(events.map(event => event.phase)).not.toContain("extraction-validate-start");
      expect(events.map(event => event.phase)).not.toContain("extraction-completed");
    } finally { unsubscribe(); }
  });

  it("13: throwing diagnostic subscribers cannot change a successful extraction", async () => {
    const unsubscribe = installPreparationObserver(() => { throw new Error("observer failed"); });
    try {
      const run = extractor(async () => reply());
      expect(await run.extract([source], [])).toHaveLength(1);
      expect(run.signal.aborted).toBe(false);
    } finally { unsubscribe(); }
  });

  it("14: operator abort releases an initial native memory load without dispatching extraction", async () => {
    const f = compactionFixture();
    const controller = new AbortController();
    const entered = deferred<void>(), release = deferred<void>();
    const before = JSON.stringify(f.originals);
    f.memory.load.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return f.view();
    });
    const compactor = await f.start({ signal: controller.signal });
    const pending = compactor.prepare();
    const failed = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await entered.promise;
    controller.abort(new DOMException("cancelled", "AbortError"));
    await failed;
    release.resolve();
    await Promise.resolve();
    expect(f.call).not.toHaveBeenCalled();
    expect(f.memory.commit).not.toHaveBeenCalled();
    expect(JSON.stringify(f.originals)).toBe(before);
  });

  it("15: a non-idempotent budget charge remains attached until its authoritative settlement", async () => {
    vi.useFakeTimers();
    const charge = deferred<void>();
    const call = vi.fn<ExtractionCall>(() => hung());
    const run = createBoundedExtractor({
      model: {} as LanguageModel,
      scope: { sessionId: "offline", runId: "charge", isCurrent: () => true },
      limits: async () => ({ deployed: 32768 }), remainingCalls: 4,
      onCall: () => charge.promise, call,
    });
    disposals.push(run.dispose);
    const pending = run.extract([source], []);
    const settled = pending.then(() => true, () => true);
    await vi.advanceTimersByTimeAsync(COMPACTION_POLICY.timeoutMs);
    expect(run.signal.aborted).toBe(true);
    // An irrevocable persistence/charge operation must not be detached and
    // misreported as settled: this is a remaining authoritative-wait boundary.
    expect(await Promise.race([settled, Promise.resolve(false)])).toBe(false);
    charge.resolve();
    await expect(pending).rejects.toMatchObject({ code: "compaction-timeout" });
    expect(call).not.toHaveBeenCalled();
  });

  it("9: a timed-out extraction retains all original conversation and tool history", async () => {
    vi.useFakeTimers();
    const f = compactionFixture();
    const originals = JSON.stringify(f.originals);
    f.call.mockImplementation(() => hung());
    const compactor = await f.start();
    const pending = compactor.prepare();
    const timedOut = expect(pending).rejects.toMatchObject({ code: "compaction-timeout" });
    await vi.advanceTimersByTimeAsync(COMPACTION_POLICY.timeoutMs);
    await timedOut;
    expect(JSON.stringify(f.originals)).toBe(originals);
    expect(f.memory.commit).not.toHaveBeenCalled();
    expect(f.view().revision).toBeNull();
  });

  it("10: a timed-out failed commit never publishes a partial revision", async () => {
    vi.useFakeTimers();
    const f = compactionFixture();
    const original = f.view();
    const entered = deferred<void>();
    f.memory.commit.mockImplementationOnce(async (_candidate, signal) => {
      entered.resolve();
      await new Promise<void>((_, reject) => {
        if (signal?.aborted) return reject(signal.reason);
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      throw new Error("unreachable");
    });
    const compactor = await f.start();
    const pending = compactor.prepare();
    const failed = expect(pending).rejects.toMatchObject({ code: "compaction-timeout" });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(COMPACTION_POLICY.timeoutMs);
    await failed;
    expect(f.view()).toEqual(original);
    expect(f.onOptimized).not.toHaveBeenCalled();
  });
});
