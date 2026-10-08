import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { createCalibrationCapture } from "@/modules/ai/lib/calibrationCapture";
import {
  beginStreamValidation,
  deferStreamFailure,
  InferenceTransportError,
} from "@/modules/ai/lib/inferenceErrors";
import type { ScopedCalibrationSample } from "@/modules/ai/lib/inferenceCalibration";

const finish: LanguageModelV3StreamPart = {
  type: "finish",
  finishReason: { unified: "stop", raw: "stop" },
  usage: {
    inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 100, text: 100, reasoning: 0 },
  },
};
function fixture(profileId = crypto.randomUUID(), nativeStart = 1000) {
  let now = 1000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const setTime = (value: number) => {
    now = value;
  };
  const samples: ScopedCalibrationSample[] = [];
  const record = vi.fn((s: ScopedCalibrationSample) => samples.push(s));
  const capture = createCalibrationCapture({
    endpointId: "server",
    profileId,
    configurationRevision: 1,
    record,
  });
  const signal = new AbortController().signal;
  const admission = (started = nativeStart, settledAt: number | null = null) =>
    capture.observe(signal, {
      endpointId: "server",
      profileId,
      capacity: 2,
      queueEnteredAt: 100,
      admittedAt: 900,
      attemptStartedAt: started,
      settledAt,
    });
  let stream!: ReadableStreamDefaultController<LanguageModelV3StreamPart>;
  const source: LanguageModelV3 = {
    specificationVersion: "v3",
    provider: "fixture",
    modelId: "coder",
    supportedUrls: {},
    doGenerate: vi.fn(),
    doStream: vi.fn(async () => {
      admission();
      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(c) {
            stream = c;
          },
        }),
      };
    }),
  };
  const model = capture.wrap(source) as LanguageModelV3;
  const open = () => model.doStream({ prompt: [], abortSignal: signal });
  return {
    profileId,
    capture,
    signal,
    admission,
    model,
    source,
    open,
    setTime,
    samples,
    record,
    emit: (part: LanguageModelV3StreamPart) => stream.enqueue(part),
    close: () => {
      admission(nativeStart, Date.now());
      stream.close();
    },
    fail: (e: unknown) => stream.error(e),
  };
}
afterEach(() => vi.restoreAllMocks());
describe("E2 cheap provider metadata capture", () => {
  it("captures actual first decoded output separately from queue latency", async () => {
    const f = fixture();
    const reader = (await f.open()).stream.getReader();
    f.setTime(2000);
    f.emit({ type: "text-delta", id: "text", delta: "private answer" });
    await reader.read();
    f.setTime(3000);
    f.emit({ type: "text-delta", id: "text", delta: " ending" });
    await reader.read();
    f.setTime(5000);
    f.emit(finish);
    await reader.read();
    f.close();
    await reader.read();
    expect(f.samples[0].sample).toMatchObject({
      outcome: "success",
      ttftMs: 1000,
      queueMs: 800,
      latencyMs: 4000,
      generationMs: 1000,
      maxGapMs: 1000,
      inputTokens: 100,
      outputTokens: 100,
      concurrency: 1,
    });
    expect(JSON.stringify(f.samples)).not.toContain("private answer");
    expect(f.source.doStream).toHaveBeenCalledTimes(1);
  });
  it("captures missing/malformed adapter usage as null without changing the original stream", async () => {
    const f = fixture();
    const reader = (await f.open()).stream.getReader();
    const bad = {
      ...finish,
      usage: { inputTokens: { total: NaN }, outputTokens: { total: -2 } },
    } as LanguageModelV3StreamPart;
    f.emit(bad);
    expect((await reader.read()).value).toEqual(bad);
    f.close();
    await reader.read();
    expect(f.samples[0].sample.inputTokens).toBeNull();
    expect(f.samples[0].sample.outputTokens).toBeNull();
    expect(f.samples[0].sample.ttftMs).toBeNull();
  });
  it("retains reasoned/tool output classification without recording its contents", async () => {
    const f = fixture();
    const reader = (await f.open()).stream.getReader();
    f.emit({ type: "reasoning-delta", id: "r", delta: "secret reasoning" });
    await reader.read();
    f.emit({ type: "tool-input-start", id: "call", toolName: "private_tool" });
    await reader.read();
    f.emit(finish);
    await reader.read();
    f.close();
    await reader.read();
    expect(f.samples[0].sample.outputKind).toBe("tool");
    expect(JSON.stringify(f.samples)).not.toMatch(
      /secret reasoning|private_tool|call/,
    );
  });
  it("classifies error parts and exceptions without persisting provider text", async () => {
    const f = fixture();
    const reader = (await f.open()).stream.getReader();
    f.emit({
      type: "error",
      error: new InferenceTransportError("first-output-timeout"),
    });
    await reader.read();
    f.close();
    await reader.read();
    expect(f.samples[0].sample.outcome).toBe("timeout");
  });
  it("fails closed on missing final result", async () => {
    const f = fixture();
    const reader = (await f.open()).stream.getReader();
    f.close();
    await reader.read();
    expect(f.samples[0].sample.outcome).not.toBe("success");
  });
  it("uses D3 deferred wire failure rather than a false SDK success", async () => {
    const f = fixture();
    const validation = beginStreamValidation(f.signal);
    const reader = (await f.open()).stream.getReader();
    deferStreamFailure(
      f.signal,
      new InferenceTransportError("missing-final-event"),
    );
    f.emit(finish);
    await reader.read();
    f.close();
    await reader.read();
    expect(f.samples[0].sample.outcome).toBe("interrupted");
    validation.dispose();
  });
  it("records explicit cancellation once and cleans its overlap slot", async () => {
    const f = fixture();
    const reader = (await f.open()).stream.getReader();
    await reader.cancel();
    expect(f.samples).toHaveLength(1);
    expect(f.samples[0].sample.outcome).toBe("cancelled");
    const reader2 = (await f.open()).stream.getReader();
    f.emit(finish);
    await reader2.read();
    f.close();
    await reader2.read();
    expect(f.samples[1].sample.concurrency).toBe(1);
  });
  it("does not attribute pre-admission failures as inference performance", async () => {
    const f = fixture();
    vi.mocked(f.source.doStream).mockRejectedValueOnce(
      new Error("No inference sent"),
    );
    await expect(f.open()).rejects.toThrow();
    expect(f.samples).toEqual([]);
  });
  it("ignores mismatched admission ownership", async () => {
    const f = fixture();
    vi.mocked(f.source.doStream).mockImplementationOnce(async () => {
      f.capture.observe(f.signal, {
        endpointId: "other",
        profileId: "profile",
        capacity: 8,
        queueEnteredAt: 1,
        admittedAt: 2,
        attemptStartedAt: 3,
        settledAt: 4,
      });
      return {
        stream: new ReadableStream({
          start(c) {
            c.enqueue(finish);
            c.close();
          },
        }),
      };
    });
    const reader = (await f.open()).stream.getReader();
    await reader.read();
    await reader.read();
    expect(f.samples).toEqual([]);
  });
  it("measures overlapping native attempts, not a configured capacity guess", async () => {
    const f = fixture();
    const g = fixture(f.profileId);
    const r1 = (await f.open()).stream.getReader(),
      r2 = (await g.open()).stream.getReader();
    g.setTime(5000);
    f.emit(finish);
    await r1.read();
    f.close();
    await r1.read();
    g.emit(finish);
    await r2.read();
    g.close();
    await r2.read();
    expect(f.samples[0].sample.concurrency).toBe(1);
    expect(g.samples[0].sample.concurrency).toBe(2);
  });
  it("does not infer concurrency from late-delivered nonoverlapping intervals", async () => {
    const f = fixture();
    const g = fixture(f.profileId, 3000);
    const r1 = (await f.open()).stream.getReader(),
      r2 = (await g.open()).stream.getReader();
    f.admission(1000, 2000);
    g.admission(3000, 4000);
    f.emit(finish);
    await r1.read();
    f.close();
    await r1.read();
    g.emit(finish);
    await r2.read();
    g.close();
    await r2.read();
    expect(f.samples[0].sample.concurrency).toBe(1);
    expect(g.samples[0].sample.concurrency).toBe(1);
  });
  it("isolates ambiguous parallel calls with the same signal instead of guessing", async () => {
    const f = fixture();
    const a = (await f.open()).stream.getReader();
    const b = (await f.open()).stream.getReader();
    await a.cancel();
    await b.cancel();
    expect(f.samples).toEqual([]);
  });
});
