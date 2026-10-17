import { describe, expect, it } from "vitest";
import { createOllamaStreamTrace, ollamaDiagnosticMetrics, ollamaReplayParams } from "@/test/ollamaStreamTrace";
import { ollamaBody } from "@/modules/ai/lib/ollamaModel";

const bytes = (value: unknown) => [...new TextEncoder().encode(`${JSON.stringify(value)}\n`)];
describe("acceptance-only Ollama stream diagnostics", () => {
  it("allowlists numeric final metrics without arbitrary server strings, credentials or content", () => {
    const value = ollamaDiagnosticMetrics({ done: true, done_reason: "SECRET", eval_count: 49,
      prompt_eval_count: -1, total_duration: "SECRET", model: "SECRET", message: { thinking: "SECRET" }, token: "SECRET" });
    expect(value).toEqual({ done: true, done_reason: "other", eval_count: 49 });
    expect(JSON.stringify(value)).not.toContain("SECRET");
  });
  it("separates raw delivery, whitespace, empty frames and real text/reasoning/tools/final", () => {
    const trace = createOllamaStreamTrace();
    trace.receive(bytes({ message: { content: "" }, done: false }), 10);
    trace.receive(bytes({ message: { content: " \n" }, done: false }), 20);
    trace.receive(bytes({ message: { content: "SECRET_TEXT" }, done: false }), 30);
    trace.receive(bytes({ message: { thinking: "SECRET_REASONING" }, done: false }), 40);
    trace.receive(bytes({ message: { tool_calls: [{ function: { name: "SECRET", arguments: { key: "CREDENTIAL" } } }] } }), 50);
    trace.receive(bytes({ done: true, done_reason: "stop", eval_count: 7, prompt_eval_count: 12, credential: "SECRET" }), 60);
    trace.sdkPart("text-delta", 31);
    const summary = trace.summary();
    expect(summary).toMatchObject({ chunks: 6, frames: 6, lastRawAt: 60, firstFrameAt: 10, lastFrameAt: 60, lastMeaningfulAt: 50,
      maxRawGapMs: 10, final: { at: 60, reason: "stop", outputTokens: 7, inputTokens: 12 },
      categories: { "empty-or-metadata": 1, "whitespace-text": 1, text: 1, reasoning: 1, tools: 1, final: 1 },
      sdk: { "text-delta": { count: 1, lastAt: 31 } } });
    expect(summary.categoryTimes).toMatchObject({ "raw-chunk": { firstAt: 10, lastAt: 60 }, text: { firstAt: 30, lastAt: 30 } });
    expect(JSON.stringify(summary)).not.toMatch(/SECRET|CREDENTIAL|arguments|credential/);
  });
  it("handles arbitrary UTF-8 splits without treating partial raw bytes as parsed progress", () => {
    const trace = createOllamaStreamTrace(), input = bytes({ message: { content: "caf\u00e9" }, done: false });
    for (const [i, byte] of input.entries()) trace.receive([byte], i);
    expect(trace.summary()).toMatchObject({ chunks: input.length, frames: 1, invalid: 0,
      lastFrameAt: input.length - 1, categories: { text: 1 } });
  });
  it("isolates request traces and retains first/last category timestamps after event-ring eviction", () => {
    const first = createOllamaStreamTrace(), second = createOllamaStreamTrace();
    for (let i = 0; i < 400; i++) first.receive(bytes({ message: { content: "ok" } }), i + 1);
    second.receive(bytes({ message: { thinking: "private" } }), 1000);
    expect(first.summary()).toMatchObject({ chunks: 400, firstRawAt: 1, lastRawAt: 400,
      firstFrameAt: 1, categoryTimes: { text: { firstAt: 1, lastAt: 400 } } });
    expect(first.summary().events).toHaveLength(256);
    expect(first.summary().categories).not.toHaveProperty("reasoning");
    expect(second.summary()).toMatchObject({ chunks: 1, firstFrameAt: 1000,
      categories: { reasoning: 1 }, categoryTimes: { reasoning: { firstAt: 1000, lastAt: 1000 } } });
    expect(second.summary().categories).not.toHaveProperty("text");
  });
  it("does not invent a final frame, usage or a trailing idle gap", () => {
    const trace = createOllamaStreamTrace();
    trace.receive(bytes({ message: { content: "answer" }, done: false }), 100);
    const before = trace.summary();
    expect(trace.summary()).toEqual(before);
    expect(before).toMatchObject({ lastRawAt: 100, lastMeaningfulAt: 100, maxRawGapMs: 0, final: null });
  });
  it("parses an unterminated final line only on observed EOF without inventing later raw delivery", () => {
    const trace = createOllamaStreamTrace();
    const input = bytes({ done: true, done_reason: "stop", eval_count: 1 });
    trace.receive(input.slice(0, -1), 10);
    expect(trace.summary().final).toBeNull();
    trace.end(20);
    expect(trace.summary()).toMatchObject({ lastRawAt: 10, lastFrameAt: 20,
      pendingBytes: 0, final: { at: 20, outputTokens: 1 }, categories: { "stream-eof": 1 } });
  });
  it("bounds oversized frames and event history while retaining final timestamps and counters", () => {
    const trace = createOllamaStreamTrace();
    trace.receive(Array(300_000).fill(120), 1);
    trace.receive([10], 2);
    for (let i = 0; i < 400; i++) trace.receive(bytes({ message: { content: "ok" } }), i + 3);
    expect(trace.summary()).toMatchObject({ droppedFrames: 1, frames: 400, lastFrameAt: 402 });
    expect(trace.summary().events).toHaveLength(256);
    expect(trace.summary().droppedEvents).toBeGreaterThan(0);
  });
  it("records malformed frames and unfinished bytes without logging their content", () => {
    const trace = createOllamaStreamTrace();
    trace.receive([...new TextEncoder().encode('SECRET\n{"unfinished":')], 10);
    expect(trace.summary()).toMatchObject({ invalid: 1, frames: 0, pendingBytes: 14, lastFrameAt: null });
    expect(JSON.stringify(trace.summary())).not.toMatch(/SECRET|unfinished/);
  });
  it("preserves exact native prompt, tool identities and controls without attaching executors", () => {
    const body = { model: "qwen38-uncensored:latest", stream: true,
      options: { num_predict: 2048, num_ctx: 32768 }, think: false,
      messages: [{ role: "system", content: "Invariants" }, { role: "user", content: "Task" },
        { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "inspect", arguments: { path: "." } } }] },
        { role: "tool", tool_name: "inspect", tool_call_id: "c1", content: '{"entries":[]}' }],
      tools: [{ type: "function", function: { name: "inspect", description: "Inspect", parameters: { type: "object", properties: {} } } }] };
    const params = ollamaReplayParams(body);
    expect(ollamaBody(body.model, params, true)).toEqual(body);
    expect(params.tools?.[0]).not.toHaveProperty("execute");
  });
  it("rejects unsupported replay shapes rather than silently approximating the prompt", () => {
    expect(() => ollamaReplayParams({})).toThrow(/prompt/);
    expect(() => ollamaReplayParams({ messages: [{ role: "user", content: null }], tools: [] })).toThrow(/content/);
    expect(() => ollamaReplayParams({ messages: [{ role: "tool", content: "ok" }], tools: [] })).toThrow(/identity/);
  });
});
