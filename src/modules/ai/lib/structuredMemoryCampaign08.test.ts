/** Offline, campaign-08-shaped regression. Never contacts Ollama or ForgeBoard. */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import {
  COMPACTION_EXTRACTION_JSON_SCHEMA,
  createBoundedExtractor,
  extractionMessages,
  extractionRequestCost,
  validateExtraction,
  type ExtractionCall,
  type ExtractionSource,
} from "@/modules/ai/lib/compactionExtraction";
import { installPreparationObserver, type PreparationObservation } from "@/modules/ai/lib/preparationLifecycle";
import { compactionFixture, disposeCompactionFixtures, history, textMessage } from "@/modules/ai/lib/conversationCompaction.fixture";

const scope = { sessionId: "campaign08-offline", runId: "campaign08-offline:one", isCurrent: () => true };
const passage = (index: number, repeat: number) =>
  `Task ${index} remains unresolved; a previous assistant reported a partial implementation. ` .repeat(repeat);
const source = (index: number, repeat: number): ExtractionSource => ({
  role: "assistant",
  passages: [passage(index, repeat)],
  evidence: { id: index.toString(16).padStart(64, "0"),
    digest: "d".repeat(64), sourceRevision: 1,
    locator: { kind: "message", messageId: `source-${index}` },
    contentIds: [], relatedSessions: [scope.sessionId] },
});
function sources6400() {
  let best = Array.from({ length: 8 }, (_, i) => source(i + 1, 1));
  let delta = Infinity;
  for (let n = 1; n <= 55; n++) {
    const current = Array.from({ length: 8 }, (_, i) => source(i + 1, n));
    const estimate = extractionRequestCost(extractionMessages(current, []), true).conversation;
    if (Math.abs(estimate - 6435) < delta) { best = current; delta = Math.abs(estimate - 6435); }
  }
  return best;
}
const response = (sources: readonly ExtractionSource[]) => JSON.stringify({ claims: sources.map((s, sourceIndex) => ({
  sourceIndex, section: "active-tasks", text: `Source ${sourceIndex} reports an unresolved task, not completed work`,
  quote: s.passages[0].slice(0, 55), status: "unresolved", contradicts: [],
})) });
const usage = { inputTokens: 6500, outputTokens: 420, cachedInputTokens: 0 };
const disposals: Array<() => void> = [];
function extractor(call: ExtractionCall, signal?: AbortSignal) {
  const run = createBoundedExtractor({ model: {} as LanguageModel, scope,
    limits: async () => ({ deployed: 32768, maxOutput: 1024, outputReserve: 1024 }),
    remainingCalls: 5, protectedCount: () => 3, call, signal });
  disposals.push(run.dispose);
  return run;
}
afterEach(() => { for (const dispose of disposals.splice(0)) dispose(); disposeCompactionFixtures(); });

describe("sealed campaign-08 failure shape and bounded corrective memory publication", () => {
  it("uses 8 original source groups, 3 protected groups, ~6.4K extraction input and a categorical repair", async () => {
    const sources = sources6400();
    const estimated = extractionRequestCost(extractionMessages(sources, []), true);
    expect(estimated.conversation).toBeGreaterThan(6000);
    expect(estimated.conversation).toBeLessThan(6900);
    expect(estimated.tools).toBeGreaterThan(0); // native schema is included in B1
    expect(COMPACTION_EXTRACTION_JSON_SCHEMA).toMatchObject({ type: "object" });
    const events: PreparationObservation[] = [];
    const stop = installPreparationObserver(event => events.push(event));
    const call = vi.fn<ExtractionCall>().mockResolvedValueOnce({ text: "```json\n{}\n```", usage })
      .mockResolvedValueOnce({ text: response(sources), usage });
    try {
      const run = extractor(call);
      const claims = await run.extract(sources, []);
      expect(call).toHaveBeenCalledTimes(2);
      expect(run.snapshot()).toMatchObject({ calls: 2, retries: 1, chunks: 1 });
      expect(claims).toHaveLength(8);
      expect(claims.map(c => c.sources[0])).toEqual(sources.map(s => s.evidence.id));
      expect(claims.every(c => c.status === "unresolved" && c.text.includes("Source quote:"))).toBe(true);
      const [first, second] = call.mock.calls.map(c => c[0].messages);
      expect(second[1]).toEqual(first[1]);
      expect(second[0].content).toContain("Validation repair: Return one syntactically valid JSON object");
      expect(JSON.stringify(first)).not.toContain(sources[0].evidence.id);
      expect(JSON.stringify(first)).not.toContain(sources[0].evidence.digest);
      const started = events.filter(e => e.phase === "extraction-attempt-start");
      const ended = events.filter(e => e.phase === "extraction-attempt-end");
      expect(started).toHaveLength(2);
      expect(started.map(e => e.attempt?.reason)).toEqual(["initial", "validation-retry"]);
      expect(started.every(e => e.attempt?.sourceCount === 8 && e.attempt?.protectedCount === 3)).toBe(true);
      expect(started.every(e => e.attempt?.deadlineMs === 120_000)).toBe(true);
      expect(ended.map(e => e.attempt?.validationReason)).toEqual(["json-syntax", undefined]);
    } finally { stop(); }
  });

  it("publishes only after corrected extraction and continues using original conversation authority", async () => {
    const originals = [...history(), textMessage("active-assistant", "assistant", "")];
    const f = compactionFixture(originals);
    const old = JSON.stringify(f.originals);
    const valid = f.call.getMockImplementation();
    if (!valid) throw new Error("Missing source-grounded extraction fixture");
    f.call.mockImplementation(options => f.call.mock.calls.length === 1
      ? Promise.resolve({ text: "not json", usage: { ...usage, outputTokens: 30 } })
      : valid(options));
    const compactor = await f.start({
      limits: async () => ({ deployed: 32768, workingTarget: 6000, maxOutput: 4096, outputReserve: 4096 }),
      extractionRoute: async () => ({ model: {} as LanguageModel,
        limits: async () => ({ deployed: 32768, maxOutput: 1024, outputReserve: 1024 }) }),
    });
    const prepared = await compactor.prepare();
    expect(f.call.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(f.memory.commit).toHaveBeenCalled();
    expect(f.view().revisionId).not.toBeNull();
    expect(f.view().revision?.claims.length).toBeGreaterThan(0);
    expect(JSON.stringify(f.originals)).toBe(old);
    expect(JSON.stringify(prepared)).toContain("Never change port 1420");
    f.originals[f.originals.length - 1].parts.push({ type: "text", text: "Continue with the next unresolved task" });
    const next = await f.start();
    expect(JSON.stringify(await next.prepare())).toContain("Continue with the next unresolved task");
  });

  it.each([
    ["invalid JSON twice", "bad-json", "json-syntax"],
    ["missing coverage twice", '{"claims":[]}', "coverage"],
    ["invented source index twice", '{"claims":[{"sourceIndex":120,"section":"errors","text":"invented","quote":"fabricated","status":"unresolved","contradicts":[] }]}', "source-index"],
    ["model-owned revision twice", '{"claims":[],"revisionId":"forged"}', "schema-unknown-field"],
  ])("fails closed on %s with exactly two attempts", async (_, invalid, reason) => {
    const run = extractor(vi.fn<ExtractionCall>().mockResolvedValue({ text: invalid, usage: { ...usage, outputTokens: 40 } }));
    await expect(run.extract(sources6400(), [])).rejects.toMatchObject({
      code: "compaction-invalid-output", validationReason: reason,
    });
    expect(run.snapshot()).toMatchObject({ calls: 2, retries: 1, chunks: 0 });
  });

  it("never accepts a partially covered but structurally valid memory", async () => {
    const eight = sources6400();
    const partial = response(eight.slice(0, 7));
    await expect(validateExtraction(partial, eight, [], 2))
      .rejects.toMatchObject({ code: "compaction-invalid-output", validationReason: "coverage" });
  });

  it("never publishes extracted claims against a changed authoritative source revision", async () => {
    const f = compactionFixture();
    const valid = f.call.getMockImplementation();
    if (!valid) throw new Error("Missing native-shaped memory fixture");
    f.call.mockImplementation(async options => {
      const generated = await valid(options);
      const view = f.view();
      f.change({ preparation: {
        ...view.preparation,
        generation: view.preparation.generation + 1,
        source: { ...view.preparation.source,
          transcriptRevision: view.preparation.source.transcriptRevision + 1 },
      } });
      return generated;
    });
    await expect((await f.start()).prepare()).rejects.toThrow("memory_stale_preparation");
    expect(f.view().revision).toBeNull();
    expect(f.view().revisionId).toBeNull();
  });

  it("cancellation before the second extraction cannot publish a partial result", async () => {
    const abort = new AbortController();
    const call = vi.fn<ExtractionCall>().mockImplementation(async () => {
      abort.abort(new DOMException("cancelled", "AbortError"));
      return { text: response(sources6400()), usage };
    });
    const run = extractor(call, abort.signal);
    await expect(run.extract(sources6400(), [])).rejects.toThrow();
    expect(run.snapshot()).toMatchObject({ chunks: 0 });
    expect(call).toHaveBeenCalledTimes(1);
  });
});
