/** Offline regression for the actual ForgeBoard-03 inference-19 -> inference-20
 * boundary: HTTP completion at ~116s, invalid extraction, then a fresh 120s
 * allowance for the *same intact* source batch. No model/native host is used. */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import {
  compactionFixture, disposeCompactionFixtures, textMessage,
} from "@/modules/ai/lib/conversationCompaction.fixture";
import { COMPACTION_POLICY, type ExtractionCall } from "@/modules/ai/lib/compactionExtraction";
import { installPreparationObserver, type PreparationObservation } from "@/modules/ai/lib/preparationLifecycle";
import { observeNativeDiagnostic } from "@/modules/ai/lib/inferenceDiagnosticCorrelation";
import { contextDigest } from "@/modules/ai/lib/targetContext";
import type { WriteCheckpoint } from "@/modules/ai/lib/writeCheckpoint";

type Part = UIMessage["parts"][number];
const clock = COMPACTION_POLICY.timeoutMs;
const invalid = () => ({
  // Completed, schema-valid JSON that unlawfully omits evidence coverage.
  text: '{"claims":[]}',
  usage: { inputTokens: 200, outputTokens: 25, cachedInputTokens: 0 },
});
function forgeboardHistory(withWriteCheckpoint = false): UIMessage[] {
  const names = ["list_directory", "todo_write", ...Array(6).fill("create_directory"),
    "bash_run", "bash_run", ...Array(10).fill("write_file"), "todo_write"];
  const parts: Part[] = names.flatMap((name, index) => [
    { type: "step-start" },
    { type: "text", text: `Completed historical effect ${index + 1} without replay.\n${"Historical source and test evidence. ".repeat(95)}` },
    { type: `tool-${name}`, toolCallId: `forgeboard-previous-${index + 1}`,
      state: "output-available",
      input: name === "todo_write" ? { todos: [{ content: "Complete app", status: "in_progress" }] }
        : { path: withWriteCheckpoint && [10, 19].includes(index)
          ? "backend/src/overwritten.ts" : `backend/src/file-${index}.ts`,
          content: withWriteCheckpoint && [10, 19].includes(index)
            ? `export const value = ${index};\n`.repeat(500) : `source file ${index}` },
      output: { ok: true, clackWorkspaceWrite: name === "write_file" || name === "create_directory",
        content: `prior effect ${index + 1} completed` },
    } as Part,
  ]);
  return [
    textMessage("forgeboard-original", "user", "Build the complete ForgeBoard backend and frontend, keep every requirement.\n" + "Do not restart. ".repeat(90)),
    { id: "forgeboard-transcript", role: "assistant", parts },
    textMessage("forgeboard-correction", "user", "Change the task page size from 50 to 25. Continue the same project."),
    { id: "forgeboard-next-agent", role: "assistant", parts: [] },
  ];
}
function fixture(withWriteCheckpoint = false) {
  const f = compactionFixture(forgeboardHistory(withWriteCheckpoint));
  const originalText = JSON.stringify(f.originals);
  const savedCall = f.call.getMockImplementation();
  if (!savedCall) throw new Error("Default extraction call missing");
  const observations: PreparationObservation[] = [];
  const unsubscribe = installPreparationObserver(e => observations.push(e));
  const controller = new AbortController();
  let steps = 21;
  const permissionAuthority = '{"write_file":"trusted-workspace","read_file":"trusted-workspace"}';
  const start = () => f.start({ signal: controller.signal,
    scope: { sessionId: "chat-a", runId: "forgeboard-03:correction", isCurrent: () => true },
    context: { owner: { sessionId: "chat-a", workspaceId: "local:/workspace-a" },
      originals: structuredClone(f.originals), ready: f.ready,
      remainingCalls: () => 240 - steps - 1,
      chargeCall: async () => { steps++; },
    },
    limits: async () => ({ deployed: 32768, workingTarget: 8500, maxOutput: 4096, outputReserve: 4096 }),
    extractionRoute: async () => ({ model: {} as Parameters<ExtractionCall>[0]["model"],
      limits: async () => ({ deployed: 16384, maxOutput: 1024, outputReserve: 1024 }) }),
  });
  return { f, savedCall, originalText, observations, unsubscribe, controller, start,
    get steps() { return steps; }, permissionAuthority };
}
const sources = (options: Parameters<ExtractionCall>[0]) =>
  (JSON.parse(options.messages[1].content as string) as { sources: unknown[] }).sources;
async function untilCalls(f: ReturnType<typeof fixture>["f"], count: number) {
  for (let i = 0; i < 100 && f.call.mock.calls.length < count; i++)
    await vi.advanceTimersByTimeAsync(0);
  expect(f.call.mock.calls.length).toBeGreaterThanOrEqual(count);
}
afterEach(() => { disposeCompactionFixtures(); vi.useRealTimers(); });

describe("ForgeBoard-03 extraction attempt deadline and retry ownership", () => {
  it("gives a complete-but-invalid 116-second response a fresh full 120-second validation retry, then commits and continues", async () => {
    vi.useFakeTimers();
    const s = fixture();
    s.f.call.mockImplementation(options => {
      if (s.f.call.mock.calls.length === 1)
        return new Promise(resolve => setTimeout(() => resolve(invalid()), 116_000));
      if (s.f.call.mock.calls.length === 2)
        return new Promise(resolve => setTimeout(async () => resolve(await s.savedCall(options)), 90_000));
      return s.savedCall(options);
    });
    try {
      const compactor = await s.start();
      const pending = compactor.prepare();
      await untilCalls(s.f, 1);
      const first = sources(s.f.call.mock.calls[0][0]);
      expect(first.length).toBeGreaterThan(1);
      await vi.advanceTimersByTimeAsync(116_000);
      await untilCalls(s.f, 2);
      expect(sources(s.f.call.mock.calls[1][0])).toEqual(first); // same intact batch, not smaller
      expect(s.f.view().revision).toBeNull();
      await vi.advanceTimersByTimeAsync(4_000); // old code cancelled inference-20 here
      expect(s.f.view().revision).toBeNull();
      expect(s.observations.map(e => e.phase)).not.toContain("extractor-deadline-fired");
      await vi.advanceTimersByTimeAsync(86_000);
      await vi.advanceTimersByTimeAsync(0);
      const result = await pending;
      expect(JSON.stringify(result)).toContain("Change the task page size from 50 to 25");
      expect(JSON.stringify(result)).toContain("forgeboard-previous-21");
      expect(s.f.view().revisionId).not.toBeNull();
      expect(s.f.memory.commit).toHaveBeenCalled();
      const begins = s.observations.filter(e => e.phase === "extraction-attempt-start");
      const ends = s.observations.filter(e => e.phase === "extraction-attempt-end");
      expect(begins.length).toBeLessThanOrEqual(COMPACTION_POLICY.maxModelAttemptsPerPreparation);
      expect(begins.length).toBeGreaterThanOrEqual(2);
      expect(ends.length).toBeGreaterThanOrEqual(2);
      expect(begins.slice(0, 2).map(e => e.attempt?.reason)).toEqual(["initial", "validation-retry"]);
      expect(begins.map(e => e.attempt?.deadlineMs)).toEqual(begins.map(() => clock));
      expect(begins[1].at - begins[0].at).toBeGreaterThanOrEqual(116_000);
      expect(ends.slice(0, 2).map(e => e.attempt?.validationReason)).toEqual(["coverage", undefined]);
      expect(ends.slice(0, 2).map(e => e.attempt?.settlement)).toEqual(["settled", "settled"]);
      expect(s.observations.filter(e => e.phase === "extraction-attempt-committed").length).toBeGreaterThanOrEqual(1);
      expect(s.observations.filter(e => e.phase === "extraction-timeout-retry")).toHaveLength(0);
      expect(s.steps).toBe(21 + s.f.call.mock.calls.length);
      expect(s.permissionAuthority).toBe('{"write_file":"trusted-workspace","read_file":"trusted-workspace"}');
      expect(JSON.stringify(s.f.originals)).toBe(s.originalText);
      // Another explicit original step and Todo can follow in this same logical session.
      s.f.originals[3].parts.push({ type: "step-start" },
        { type: "tool-write_file", toolCallId: "after-retry", state: "output-available",
          input: { path: "frontend/src/main.tsx", content: "source" },
          output: { ok: true, clackWorkspaceWrite: true } } as Part);
      const next = await s.start();
      expect(JSON.stringify(await next.prepare())).toContain("after-retry");
      expect(s.steps).toBe(21 + s.f.call.mock.calls.length);
    } finally { s.unsubscribe(); }
  });

  it("a second retry timeout remains terminal without a third attempt or invalid memory", async () => {
    vi.useFakeTimers();
    const s = fixture();
    s.f.call.mockImplementation(options => s.f.call.mock.calls.length === 1
      ? Promise.resolve(invalid())
      : new Promise((_, reject) => options.abortSignal.addEventListener("abort", () => reject(options.abortSignal.reason), { once: true })));
    try {
      const c = await s.start();
      const result = c.prepare();
      const failed = expect(result).rejects.toMatchObject({ code: "compaction-timeout" });
      await untilCalls(s.f, 2);
      await vi.advanceTimersByTimeAsync(clock);
      await failed;
      expect(s.f.call).toHaveBeenCalledTimes(2);
      expect(s.observations.filter(e => e.phase === "extraction-timeout-retry")).toHaveLength(0);
      expect(s.f.memory.commit).not.toHaveBeenCalled();
      expect(s.f.view().revision).toBeNull();
      expect(JSON.stringify(s.f.originals)).toBe(s.originalText);
    } finally { s.unsubscribe(); }
  });

  it("a second invalid output is terminal; one shared retry allowance cannot become a third timeout fallback", async () => {
    const s = fixture();
    s.f.call.mockResolvedValue(invalid());
    try {
      const c = await s.start();
      await expect(c.prepare()).rejects.toMatchObject({ code: "compaction-invalid-output", validationReason: "coverage" });
      expect(s.f.call).toHaveBeenCalledTimes(2);
      expect(s.observations.filter(e => e.phase === "extraction-attempt-start")).toHaveLength(2);
      expect(s.f.memory.commit).not.toHaveBeenCalled();
      expect(JSON.stringify(s.f.originals)).toBe(s.originalText);
    } finally { s.unsubscribe(); }
  });

  it("a timeout on the first extraction selects a strictly smaller prefix and its second model call gets all 120 seconds", async () => {
    vi.useFakeTimers();
    const s = fixture();
    s.f.call.mockImplementation(options => {
      if (s.f.call.mock.calls.length === 1)
        return new Promise((_, reject) => options.abortSignal.addEventListener("abort", () => reject(options.abortSignal.reason), { once: true }));
      if (s.f.call.mock.calls.length === 2)
        return new Promise(resolve => setTimeout(async () => resolve(await s.savedCall(options)), 90_000));
      return s.savedCall(options);
    });
    try {
      const c = await s.start();
      const pending = c.prepare();
      await untilCalls(s.f, 1);
      await vi.advanceTimersByTimeAsync(clock);
      await untilCalls(s.f, 2);
      const original = sources(s.f.call.mock.calls[0][0]);
      const smaller = sources(s.f.call.mock.calls[1][0]);
      expect(smaller.length).toBeGreaterThan(0);
      expect(smaller.length).toBeLessThan(original.length);
      await vi.advanceTimersByTimeAsync(90_000);
      await vi.advanceTimersByTimeAsync(0);
      await pending;
      expect(s.f.memory.commit).toHaveBeenCalled();
      expect(s.observations.filter(e => e.phase === "extraction-attempt-start").slice(0, 2).map(e => e.attempt?.reason))
        .toEqual(["initial", "smaller-prefix-timeout-retry"]);
      expect(s.observations.filter(e => e.phase === "extractor-deadline-fired")).toHaveLength(1);
      expect(s.observations.filter(e => e.phase === "extraction-attempt-committed").length).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(s.f.originals)).toBe(s.originalText);
    } finally { s.unsubscribe(); }
  });

  it("operator cancellation between invalid output and retry identity validation forbids all further calls", async () => {
    const s = fixture();
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const load = s.f.memory.load.getMockImplementation();
    if (!load) throw new Error("Memory fixture load missing");
    let count = 0;
    s.f.memory.load.mockImplementation(async owner => {
      count++;
      if (s.f.call.mock.calls.length === 1) await blocked;
      return load(owner);
    });
    s.f.call.mockResolvedValueOnce(invalid());
    try {
      const c = await s.start();
      const result = c.prepare();
      const failure = expect(result).rejects.toMatchObject({ name: "AbortError" });
      await vi.waitFor(() => expect(s.f.call).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(count).toBeGreaterThanOrEqual(3));
      s.controller.abort(new DOMException("Operator cancellation", "AbortError"));
      release();
      await failure;
      expect(s.f.call).toHaveBeenCalledTimes(1);
      expect(s.f.memory.commit).not.toHaveBeenCalled();
    } finally { release(); s.unsubscribe(); }
  });

  it("stale durable memory identity after a complete invalid result prevents any second request", async () => {
    const s = fixture();
    s.f.call.mockImplementationOnce(async () => {
      const before = s.f.view();
      s.f.change({ preparation: { ...before.preparation, generation: before.preparation.generation + 1 } });
      return invalid();
    });
    try {
      const c = await s.start();
      await expect(c.prepare()).rejects.toMatchObject({ code: "compaction-stale" });
      expect(s.f.call).toHaveBeenCalledTimes(1);
      expect(s.f.memory.commit).not.toHaveBeenCalled();
      expect(JSON.stringify(s.f.originals)).toBe(s.originalText);
    } finally { s.unsubscribe(); }
  });

  it("rejects a changed workspace-write checkpoint before the completed-but-invalid retry", async () => {
    const s = fixture(true);
    const message = s.f.originals[1];
    const oldPart = message.parts.find(p => p.type === "tool-write_file" && p.toolCallId === "forgeboard-previous-11");
    const latestPart = message.parts.find(p => p.type === "tool-write_file" && p.toolCallId === "forgeboard-previous-20");
    if (!oldPart || !latestPart || !('input' in oldPart) || !('input' in latestPart) ||
      !('output' in oldPart) || !('output' in latestPart)) throw new Error("Checkpoint fixture writes absent");
    const oldInput = oldPart.input as { path: string; content: string };
    const latestInput = latestPart.input as { path: string; content: string };
    const owner = { sessionId: "chat-a", workspaceId: "local:/workspace-a" };
    const evidenceId = "a".repeat(64);
    const snapshot: WriteCheckpoint = {
      version: 1, revision: "f".repeat(64), owner,
      source: { ...s.f.view().preparation.source, transcriptHash: await contextDigest(s.f.originals) },
      evidence: [{ id: evidenceId, digest: await contextDigest(oldPart), sourceRevision: 1,
        locator: { kind: "part", messageId: message.id, partIndex: message.parts.indexOf(oldPart) },
        contentIds: [], relatedSessions: [owner.sessionId] }],
      entries: [{ toolCallId: oldPart.toolCallId, path: "backend/src/overwritten.ts", canonical: oldInput.path,
        resultDigest: await contextDigest(oldInput.content),
        inputHash: await contextDigest(oldInput), outputHash: await contextDigest(oldPart.output),
        source: evidenceId, order: 11, latestToolCallId: latestPart.toolCallId,
        latestDigest: await contextDigest(latestInput.content), latestInputHash: await contextDigest(latestInput),
        latestOutputHash: await contextDigest(latestPart.output), latestOrder: 20,
        base: "full-overwrite-independent" }],
    };
    const prepareCheckpoint = vi.fn(async () => snapshot);
    const validateCheckpoint = vi.fn(async () => { throw new Error("checkpoint-revision-changed"); });
    s.f.call.mockResolvedValueOnce(invalid());
    try {
      const c = await s.f.start({ checkpointHistory: "ollama-native-v1",
        context: { owner, originals: structuredClone(s.f.originals), ready: s.f.ready,
          remainingCalls: () => 10, chargeCall: s.f.chargeCall,
          prepareCheckpoint, validateCheckpoint },
        limits: async () => ({ deployed: 32768, workingTarget: 8500, maxOutput: 4096, outputReserve: 4096 }),
        extractionRoute: async () => ({ model: {} as Parameters<ExtractionCall>[0]["model"],
          limits: async () => ({ deployed: 16384, maxOutput: 1024, outputReserve: 1024 }) }),
      });
      await expect(c.prepare()).rejects.toThrow("checkpoint-revision-changed");
      expect(prepareCheckpoint).toHaveBeenCalled();
      expect(validateCheckpoint).toHaveBeenCalledWith(snapshot);
      expect(s.f.call).toHaveBeenCalledTimes(1);
      expect(s.f.memory.commit).not.toHaveBeenCalled();
      expect(JSON.stringify(s.f.originals)).toBe(s.originalText);
    } finally { s.unsubscribe(); }
  });

  it("refuses a validation retry when the first SDK response arrives but the native request never settles", async () => {
    vi.useFakeTimers();
    const s = fixture();
    s.f.call.mockImplementationOnce(async options => {
      observeNativeDiagnostic(options.abortSignal, "native-id-linked", "native-19");
      return invalid();
    });
    try {
      const c = await s.start();
      const pending = c.prepare();
      const failed = expect(pending).rejects.toMatchObject({ code: "compaction-settlement" });
      await untilCalls(s.f, 1);
      await vi.advanceTimersByTimeAsync(5_000);
      await failed;
      expect(s.f.call).toHaveBeenCalledTimes(1);
      expect(s.observations.filter(e => e.phase === "extraction-attempt-end")[0]?.attempt)
        .toMatchObject({ settlement: "unsettled", validation: "invalid" });
      expect(s.f.memory.commit).not.toHaveBeenCalled();
    } finally { s.unsubscribe(); }
  });

  it("waits for real native settlement before sending a completed-but-invalid retry", async () => {
    vi.useFakeTimers();
    const s = fixture();
    s.f.call.mockImplementation(options => {
      if (s.f.call.mock.calls.length === 1) {
        observeNativeDiagnostic(options.abortSignal, "native-id-linked", "native-19");
        setTimeout(() => observeNativeDiagnostic(options.abortSignal, "native-settled", "native-19"), 2_500);
        return Promise.resolve(invalid());
      }
      return s.savedCall(options);
    });
    try {
      const c = await s.start();
      const pending = c.prepare();
      await untilCalls(s.f, 1);
      await vi.advanceTimersByTimeAsync(2_499);
      expect(s.f.call).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await untilCalls(s.f, 2);
      await pending;
      expect(s.f.memory.commit).toHaveBeenCalled();
      const begin = s.observations.filter(e => e.phase === "extraction-attempt-start");
      const native = s.observations.find(e => e.phase === "native-http-settled");
      expect(native).toBeDefined();
      expect(native!.at).toBeLessThanOrEqual(begin[1].at);
    } finally { s.unsubscribe(); }
  });

  it("user cancellation during the first model call remains authoritative and never starts recovery", async () => {
    const s = fixture();
    s.f.call.mockImplementation(options => new Promise((_, reject) =>
      options.abortSignal.addEventListener("abort", () => reject(options.abortSignal.reason), { once: true })));
    try {
      const c = await s.start();
      const pending = c.prepare();
      const failed = expect(pending).rejects.toMatchObject({ name: "AbortError" });
      await vi.waitFor(() => expect(s.f.call).toHaveBeenCalledTimes(1));
      s.controller.abort(new DOMException("Operator cancellation", "AbortError"));
      await failed;
      expect(s.f.call).toHaveBeenCalledTimes(1);
      expect(s.f.memory.commit).not.toHaveBeenCalled();
      expect(s.observations.filter(e => e.phase === "extraction-timeout-retry")).toHaveLength(0);
    } finally { s.unsubscribe(); }
  });
});
