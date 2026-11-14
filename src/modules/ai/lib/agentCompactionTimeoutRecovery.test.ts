import { afterEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import {
  compactionFixture, disposeCompactionFixtures, textMessage,
} from "@/modules/ai/lib/conversationCompaction.fixture";
import { COMPACTION_POLICY, type ExtractionCall } from "@/modules/ai/lib/compactionExtraction";
import { conversationCompactionUnits } from "@/modules/ai/lib/conversationCompaction";
import { groupCompactionUnits } from "@/modules/ai/lib/compactionPlan";
import { installPreparationObserver, type PreparationObservation } from "@/modules/ai/lib/preparationLifecycle";

type Part = UIMessage["parts"][number];

/** The sealed ForgeBoard correction had two user turns, a single long
 * assistant transcript with 21 completed tool effects (10 writes), and an
 * empty new assistant turn at the point of its failed preparation. */
function forgeboardHistory(): UIMessage[] {
  const names = [
    "list_directory", "todo_write", ...Array(6).fill("create_directory"),
    "bash_run", "bash_run", ...Array(10).fill("write_file"), "todo_write",
  ] as string[];
  const parts: Part[] = names.flatMap((name, index) => [
    { type: "step-start" },
    { type: "text", text: `Completed tool ${index + 1} without replay.\n${"Original source and test evidence. ".repeat(95)}` },
    { type: `tool-${name}`, toolCallId: `forgeboard-effect-${index + 1}`,
      state: "output-available",
      input: name === "todo_write" ? { todos: [{ content: "Complete app", status: "in_progress" }] }
        : name === "bash_run" ? { command: "echo initialised" }
          : { path: `backend/src/file-${index}.ts`, content: `source file ${index}` },
      output: { ok: true, clackWorkspaceWrite: name === "write_file" || name === "create_directory",
        stdout: "completed", content: `effect ${index + 1} completed` },
    } as Part,
  ]);
  return [
    textMessage("original-forgeboard-spec", "user", "Build the full ForgeBoard frontend and backend, preserve every requirement.\n" + "Do not restart work. ".repeat(90)),
    { id: "original-agent-transcript", role: "assistant", parts },
    textMessage("one-time-correction", "user", "Change the task page size requirement from 50 to 25. Continue the same project and do not restart from scratch."),
    { id: "correction-assistant", role: "assistant", parts: [] },
  ];
}

type Outcome = "succeed" | "second-timeout" | "late-invalid" | "never-settles" | "stale" | "cancel";

function setup(mode: Outcome) {
  const original = forgeboardHistory();
  const f = compactionFixture(original);
  const before = JSON.stringify(f.originals);
  const observations: PreparationObservation[] = [];
  const unsubscribe = installPreparationObserver(record => observations.push(record));
  let steps = 21;
  let continuations = 0;
  const permissions = { read_file: true, write_file: true, request_conversation_evidence: true };
  const authority = JSON.stringify(permissions);
  const scope = { sessionId: "chat-a", runId: "real-mission-a:corrected", isCurrent: () => true };
  const controller = new AbortController();
  const valid = f.call.getMockImplementation();
  if (!valid) throw new Error("fixture extraction is missing");
  f.call.mockImplementation(async options => {
    const number = f.call.mock.calls.length;
    if (number === 1 || (number === 2 && mode === "second-timeout")) {
      if (mode === "late-invalid") return new Promise(resolve => {
        setTimeout(() => resolve({ text: "truncated invalid JSON", usage: {
          inputTokens: 120, outputTokens: 120, cachedInputTokens: 0,
        } }), COMPACTION_POLICY.timeoutMs + 500);
      });
      if (mode === "never-settles") return new Promise(() => {});
      return new Promise((_, reject) => {
        const abort = () => {
          if (mode === "stale") {
            const view = f.view();
            f.change({ preparation: { ...view.preparation, generation: view.preparation.generation + 1 } });
          }
          reject(options.abortSignal.reason);
        };
        options.abortSignal.addEventListener("abort", abort, { once: true });
        if (options.abortSignal.aborted) abort();
      });
    }
    return valid(options);
  });
  const start = () => f.start({
    scope, signal: controller.signal,
    context: { owner: { sessionId: "chat-a", workspaceId: "local:/workspace-a" },
      originals: structuredClone(f.originals), ready: f.ready,
      remainingCalls: () => 240 - steps - 1,
      chargeCall: async () => { steps++; },
    },
    limits: async () => ({ deployed: 32768, workingTarget: 8500, maxOutput: 4096, outputReserve: 4096 }),
    extractionRoute: async () => ({ model: {} as Parameters<ExtractionCall>[0]["model"],
      limits: async () => ({ deployed: 16384, maxOutput: 1024, outputReserve: 1024 }) }),
  });
  return { f, before, observations, unsubscribe, controller, scope, start,
    get steps() { return steps; },
    get continuations() { return continuations; },
    get permissions() { return JSON.stringify(permissions); },
    authority,
    advanceContinuation() { continuations++; },
  };
}

async function untilCall(f: ReturnType<typeof setup>["f"], count: number) {
  for (let i = 0; i < 150 && f.call.mock.calls.length < count; i++)
    await vi.advanceTimersByTimeAsync(0);
  expect(f.call.mock.calls.length).toBeGreaterThanOrEqual(count);
}

afterEach(() => {
  disposeCompactionFixtures();
  vi.useRealTimers();
});

describe("production-shaped ForgeBoard correction: bounded preparation timeout recovery", () => {
  it("keeps an unresolved historical tool effect dependency-closed, not summarized or replayed", async () => {
    const originals = forgeboardHistory();
    const pending = originals[1].parts.find(part =>
      part.type.startsWith("tool-") && "toolCallId" in part && part.toolCallId === "forgeboard-effect-14");
    expect(pending).toBeDefined();
    if (!pending || !("state" in pending)) throw new Error("Missing native tool effect");
    pending.state = "input-available";
    delete (pending as { output?: unknown }).output;
    const units = await conversationCompactionUnits(originals, originals, "chat-a", false, true);
    const groups = groupCompactionUnits(units);
    const affected = units.findIndex(unit => unit.source?.stepIndex === 13);
    expect(affected).toBeGreaterThan(0);
    expect(groups.find(group => group.start <= affected && group.end > affected)?.protected).toBe(true);
    expect(groups.some(group => !group.protected)).toBe(true);
  });

  it("retries one smaller intact original-source batch, publishes valid memory and continues the same session", async () => {
    vi.useFakeTimers();
    const s = setup("succeed");
    try {
      const c = await s.start();
      const pending = c.prepare();
      await untilCall(s.f, 1);
      const first = JSON.parse(s.f.call.mock.calls[0][0].messages[1].content as string);
      expect(first.sources.length).toBeGreaterThan(1);
      expect(s.f.view().revision).toBeNull();
      expect(JSON.stringify(s.f.originals)).toBe(s.before);
      await vi.advanceTimersByTimeAsync(COMPACTION_POLICY.timeoutMs);
      const prepared = await pending;
      const second = JSON.parse(s.f.call.mock.calls[1][0].messages[1].content as string);
      expect(second.sources.length).toBeGreaterThan(0);
      expect(second.sources.length).toBeLessThan(first.sources.length);
      expect(s.observations.filter(event => event.phase === "extraction-timeout-retry")).toHaveLength(1);
      expect(s.observations.filter(event => event.phase === "extractor-deadline-fired")).toHaveLength(1);
      expect(s.f.memory.commit).toHaveBeenCalled();
      expect(s.f.view().revision?.coverage.end).toBeGreaterThan(0);
      expect(s.f.view().revision?.coverage.unitMode).toBe("agent-steps-v1");
      const context = JSON.stringify(prepared);
      expect(context).toContain("Change the task page size requirement from 50 to 25");
      expect(context).toContain("Build the full ForgeBoard frontend and backend");
      expect(context).toContain("forgeboard-effect-21"); // latest completed todo remains verbatim
      expect(JSON.stringify(s.f.originals)).toBe(s.before);
      expect(s.f.originals[1].parts.filter(part => part.type.startsWith("tool-"))).toHaveLength(21);
      expect(s.f.originals[1].parts.filter(part => part.type === "tool-write_file")).toHaveLength(10);
      expect(s.steps).toBe(21 + s.f.call.mock.calls.length);
      expect(s.continuations).toBe(0);
      expect(s.permissions).toBe(s.authority);
      // Additional completed Agent work in the SAME captured conversation,
      // without replaying prior tool effects or replacing the correction.
      s.f.originals[3].parts.push({ type: "step-start" },
        { type: "text", text: "Continue new Agent work using the validated memory." },
        { type: "tool-write_file", toolCallId: "after-compaction-write", state: "output-available",
          input: { path: "frontend/src/main.tsx", content: "source" },
          output: { ok: true, clackWorkspaceWrite: true, content: "written once" } } as Part);
      const next = await s.start();
      const continued = await next.prepare();
      expect(JSON.stringify(continued)).toContain("after-compaction-write");
      expect(s.f.originals[1].parts.filter(part => part.type.startsWith("tool-"))).toHaveLength(21);
      expect(s.f.originals[3].parts.filter(part => part.type === "tool-write_file")).toHaveLength(1);
      expect(s.continuations).toBe(0);
      expect(s.permissions).toBe(s.authority);
    } finally { s.unsubscribe(); }
  });

  it("a second 120-second preparation timeout terminates without committing invalid partial evidence", async () => {
    vi.useFakeTimers();
    const s = setup("second-timeout");
    try {
      const c = await s.start();
      const pending = c.prepare();
      const failed = expect(pending).rejects.toMatchObject({ code: "compaction-timeout" });
      await untilCall(s.f, 1);
      await vi.advanceTimersByTimeAsync(COMPACTION_POLICY.timeoutMs);
      await untilCall(s.f, 2);
      await vi.advanceTimersByTimeAsync(COMPACTION_POLICY.timeoutMs);
      await failed;
      expect(s.f.call).toHaveBeenCalledTimes(2);
      expect(s.observations.filter(event => event.phase === "extraction-timeout-retry")).toHaveLength(1);
      expect(s.f.memory.commit).not.toHaveBeenCalled();
      expect(s.f.view().revision).toBeNull();
      expect(JSON.stringify(s.f.originals)).toBe(s.before);
      expect(s.steps).toBe(23);
    } finally { s.unsubscribe(); }
  });

  it("a provider that ignores cancellation never authorizes an overlapping retry", async () => {
    vi.useFakeTimers();
    const s = setup("never-settles");
    try {
      const c = await s.start();
      const pending = c.prepare();
      const failed = expect(pending).rejects.toMatchObject({ code: "compaction-timeout" });
      await untilCall(s.f, 1);
      await vi.advanceTimersByTimeAsync(COMPACTION_POLICY.timeoutMs + 5_000);
      await failed;
      expect(s.f.call).toHaveBeenCalledTimes(1);
      expect(s.f.memory.commit).not.toHaveBeenCalled();
      expect(JSON.stringify(s.f.originals)).toBe(s.before);
    } finally { s.unsubscribe(); }
  });

  it("late invalid extraction text is ignored, never committed, before the smaller valid batch", async () => {
    vi.useFakeTimers();
    const s = setup("late-invalid");
    try {
      const c = await s.start();
      const pending = c.prepare();
      await untilCall(s.f, 1);
      await vi.advanceTimersByTimeAsync(COMPACTION_POLICY.timeoutMs);
      expect(s.f.memory.commit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(500);
      await pending;
      expect(s.f.call.mock.calls.length).toBeGreaterThan(1);
      expect(s.f.memory.commit).toHaveBeenCalled();
      expect(JSON.stringify(s.f.view())).not.toContain("truncated invalid JSON");
      expect(JSON.stringify(s.f.originals)).toBe(s.before);
    } finally { s.unsubscribe(); }
  });

  it("rejects a stale preparation generation before dispatching a second model request", async () => {
    vi.useFakeTimers();
    const s = setup("stale");
    try {
      const c = await s.start();
      const pending = c.prepare();
      const failed = expect(pending).rejects.toMatchObject({ code: "compaction-stale" });
      await untilCall(s.f, 1);
      await vi.advanceTimersByTimeAsync(COMPACTION_POLICY.timeoutMs);
      await failed;
      expect(s.f.call).toHaveBeenCalledTimes(1);
      expect(s.f.memory.commit).not.toHaveBeenCalled();
      expect(JSON.stringify(s.f.originals)).toBe(s.before);
    } finally { s.unsubscribe(); }
  });

  it("explicit cancellation remains nonrecoverable and preserves original history", async () => {
    vi.useFakeTimers();
    const s = setup("cancel");
    try {
      const c = await s.start();
      const pending = c.prepare();
      const failed = expect(pending).rejects.toMatchObject({ name: "AbortError" });
      await untilCall(s.f, 1);
      s.controller.abort(new DOMException("Operator cancelled", "AbortError"));
      await failed;
      expect(s.f.call).toHaveBeenCalledTimes(1);
      expect(s.observations.filter(event => event.phase === "extraction-timeout-retry")).toHaveLength(0);
      expect(s.f.memory.commit).not.toHaveBeenCalled();
      expect(JSON.stringify(s.f.originals)).toBe(s.before);
    } finally { s.unsubscribe(); }
  });
});
