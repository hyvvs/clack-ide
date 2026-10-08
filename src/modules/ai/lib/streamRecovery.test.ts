import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import type { UIMessage } from "ai";
import {
  withProviderRetryTracking,
  retryDelay,
  PROVIDER_RECOVERY_LIMITS,
} from "@/modules/ai/lib/providerRetry";
import { InferenceTransportError } from "@/modules/ai/lib/inferenceErrors";
import { normalizeAiError } from "@/modules/ai/lib/errors";
import {
  withAnswerContinuation,
  recoverAnswerMessages,
  readAnswer,
  answerParts,
  type AnswerState,
} from "@/modules/ai/lib/answerContinuation";
import {
  recoveryAvailability,
  unresolvedExecution,
} from "@/modules/ai/lib/streamRecovery";
import type { ExecutionRecord } from "@/modules/ai/lib/customToolExecution";
import { createRunBudget } from "@/modules/ai/lib/runBudget";

const finish: LanguageModelV3StreamPart = {
  type: "finish",
  finishReason: { unified: "stop", raw: "stop" },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
};
const text = (delta: string): LanguageModelV3StreamPart[] => [
  { type: "text-start", id: "text" },
  { type: "text-delta", id: "text", delta },
  { type: "text-end", id: "text" },
];
const disconnect = () => new InferenceTransportError("remote-disconnect");
function fixture(
  attempts: (LanguageModelV3StreamPart[] | Error)[],
  extra: Partial<Parameters<typeof withProviderRetryTracking>[3]> = {},
) {
  const doStream = vi.fn(async () => {
    const next = attempts.shift();
    if (next instanceof Error) throw next;
    return {
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        start(c) {
          for (const part of next ?? []) c.enqueue(part);
          c.close();
        },
      }),
    };
  });
  const model: LanguageModelV3 = {
    specificationVersion: "v3",
    provider: "fixture",
    modelId: "captured",
    supportedUrls: {},
    doGenerate: vi.fn(),
    doStream,
  };
  const onRetry = vi.fn(),
    onRecovered = vi.fn(),
    beforeRetry = vi.fn(async () => {});
  const wrapped = withProviderRetryTracking(
    model,
    { onRetry, onRecovered },
    2,
    { delayMs: 0, beforeRetry, ...extra },
  ) as LanguageModelV3;
  return { wrapped, doStream, onRetry, onRecovered, beforeRetry };
}
async function collect(model: LanguageModelV3, signal?: AbortSignal) {
  const output: LanguageModelV3StreamPart[] = [];
  try {
    const result = await model.doStream({
      prompt: [
        { role: "user", content: [{ type: "text", text: "Original task" }] },
      ],
      abortSignal: signal,
    });
    for await (const part of result.stream as unknown as AsyncIterable<LanguageModelV3StreamPart>) {
      if (part.type === "error") throw part.error;
      output.push(part);
    }
    return { output, error: undefined };
  } catch (error) {
    return { output, error };
  }
}
afterEach(() => vi.useRealTimers());

describe("D3 single pre-output retry owner", () => {
  it("retries socket failure before headers against identical captured parameters", async () => {
    const f = fixture([disconnect(), [...text("Once"), finish]]);
    const result = await collect(f.wrapped);
    expect(result.error).toBeUndefined();
    expect(f.doStream).toHaveBeenCalledTimes(2);
    expect(f.doStream.mock.calls[1]).toEqual(f.doStream.mock.calls[0]);
    expect(f.beforeRetry).toHaveBeenCalledOnce();
    expect(f.onRetry).toHaveBeenCalledOnce();
    expect(f.onRecovered).toHaveBeenCalledOnce();
  });
  it("discards the failed stream's structural prefix and emits only the recovered stream", async () => {
    const f = fixture([
      [
        { type: "text-start", id: "old" },
        { type: "error", error: disconnect() },
      ],
      [...text("Once"), finish],
    ]);
    expect((await collect(f.wrapped)).output).toEqual([
      ...text("Once"),
      finish,
    ]);
    expect(f.beforeRetry).toHaveBeenCalledOnce();
  });
  it("exhausts at three attempts and never falsely reports recovery", async () => {
    const f = fixture([
      disconnect(),
      disconnect(),
      disconnect(),
      [...text("Never"), finish],
    ]);
    expect(normalizeAiError((await collect(f.wrapped)).error)).toMatchObject({
      errorCode: "remote-disconnect",
      retryAttempts: 2,
      title: "Retry exhausted",
    });
    expect(f.doStream).toHaveBeenCalledTimes(3);
    expect(f.onRetry).toHaveBeenCalledTimes(2);
    expect(f.onRecovered).not.toHaveBeenCalled();
  });
  it.each([
    401, 403, 402, 400,
  ])("never loops HTTP %s even if the adapter claims retryable", async (statusCode) => {
    const error = Object.assign(new Error("Provider rejected request"), {
      statusCode,
      isRetryable: true,
    });
    const f = fixture([error]);
    expect((await collect(f.wrapped)).error).toBe(error);
    expect(f.doStream).toHaveBeenCalledOnce();
    expect(f.onRetry).not.toHaveBeenCalled();
  });
  it("honors Retry-After rather than SDK plus app retry multiplication", async () => {
    vi.useFakeTimers();
    const error = Object.assign(new Error("Rate limited"), {
      statusCode: 429,
      responseHeaders: { "retry-after": "5" },
    });
    const f = fixture([error, [...text("Ready"), finish]], {
      delayMs: undefined,
    });
    const pending = collect(f.wrapped);
    await vi.advanceTimersByTimeAsync(4999);
    expect(f.doStream).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).error).toBeUndefined();
    expect(f.doStream).toHaveBeenCalledTimes(2);
  });
  it("rejects a Retry-After beyond the delay cap instead of retrying too soon", async () => {
    const error = Object.assign(new Error("Rate limit"), {
      statusCode: 429,
      responseHeaders: { "retry-after": "31" },
    });
    const f = fixture([error]);
    expect(retryDelay(error, 1)).toBeNull();
    expect((await collect(f.wrapped)).error).toBe(error);
    expect(f.onRetry).not.toHaveBeenCalled();
  });
  it("parses bounded HTTP dates and malformed values deterministically", () => {
    const now = Date.parse("2026-10-08T10:00:00Z");
    const error = (value: string) => ({
      statusCode: 429,
      responseHeaders: { "retry-after": value },
    });
    expect(retryDelay(error("Thu, 08 Oct 2026 10:00:10 GMT"), 1, now)).toBe(
      10000,
    );
    expect(retryDelay(error("nonsense"), 2, now)).toBe(4000);
    expect(retryDelay(error("999999999999999999999999"), 1, now)).toBeNull();
  });
  it("Stop during backoff prevents any further admission", async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const f = fixture([disconnect()], { delayMs: undefined });
    const pending = collect(f.wrapped, abort.signal);
    await vi.advanceTimersByTimeAsync(1);
    abort.abort(new DOMException("Cancelled", "AbortError"));
    await vi.advanceTimersByTimeAsync(6000);
    expect((await pending).error).toMatchObject({ name: "AbortError" });
    expect(f.doStream).toHaveBeenCalledOnce();
    expect(f.beforeRetry).not.toHaveBeenCalled();
  });
  it("a newer owner during preparation refuses admission and ignores late work", async () => {
    let current = true;
    const f = fixture([disconnect()], {
      isCurrent: () => current,
      beforeRetry: async () => {
        current = false;
      },
    });
    expect((await collect(f.wrapped)).error).toMatchObject({
      name: "AbortError",
    });
    expect(f.doStream).toHaveBeenCalledOnce();
  });
  it("failed B1/budget revalidation prevents retry", async () => {
    const f = fixture([disconnect()], {
      beforeRetry: async () => {
        throw new Error("B1 refused");
      },
    });
    expect((await collect(f.wrapped)).error).toMatchObject({
      message: "B1 refused",
    });
    expect(f.doStream).toHaveBeenCalledOnce();
  });
  it("delayed headers are bounded by the existing recovery ceiling", async () => {
    vi.useFakeTimers();
    const f = fixture([]);
    f.doStream.mockImplementation(() => new Promise(() => {}));
    const pending = collect(f.wrapped);
    await vi.advanceTimersByTimeAsync(PROVIDER_RECOVERY_LIMITS.totalMs);
    expect((await pending).error).toMatchObject({ code: "overall-deadline" });
    expect(f.doStream).toHaveBeenCalledOnce();
  });
  it.each([
    "a",
    "mid-wo",
    "Unicode \u{1F642}",
    "line\n",
    "```ts\nlet a =",
    " ",
  ])("never restarts after text %j", async (delta) => {
    const f = fixture([
      [...text(delta), { type: "error", error: disconnect() }],
      [...text(delta), finish],
    ]);
    const result = await collect(f.wrapped);
    expect(result.output).toEqual(text(delta));
    expect(result.error).toBeInstanceOf(InferenceTransportError);
    expect(f.doStream).toHaveBeenCalledOnce();
    expect(f.onRetry).not.toHaveBeenCalled();
  });
  it.each<LanguageModelV3StreamPart>([
    { type: "reasoning-delta", id: "r", delta: "Summary" },
    { type: "tool-input-start", id: "call", toolName: "edit" },
    { type: "tool-input-delta", id: "call", delta: '{"path":' },
    { type: "tool-call", toolCallId: "call", toolName: "edit", input: "{}" },
    {
      type: "tool-result",
      toolCallId: "call",
      toolName: "edit",
      result: "done",
    },
  ])("never retries after reasoning/tool boundary $type", async (part) => {
    const f = fixture([[part, { type: "error", error: disconnect() }]]);
    expect((await collect(f.wrapped)).output).toEqual([part]);
    expect(f.onRetry).not.toHaveBeenCalled();
    expect(f.doStream).toHaveBeenCalledOnce();
  });
  it("EOF without a finish remains interrupted, not D2 length", async () => {
    const f = fixture([text("Partial")]);
    expect((await collect(f.wrapped)).error).toMatchObject({
      code: "missing-final-event",
    });
    expect(f.onRetry).not.toHaveBeenCalled();
  });
  it("structural prefix memory is bounded", async () => {
    const f = fixture([
      Array.from({ length: 257 }, () => ({ type: "text-start", id: "t" })),
    ]);
    expect((await collect(f.wrapped)).error).toMatchObject({
      code: "malformed-stream",
    });
  });
});

describe("D3 persistence, explicit recovery and tool boundary", () => {
  const segment = {
    id: "first",
    previous: null,
    provider: "fixture",
    model: "captured",
    startedAt: 1,
    finish: "interrupted" as const,
    inputTokens: 0,
    outputTokens: 0,
    pending: [],
  };
  const answer: AnswerState = {
    version: 1,
    runId: "chat:1",
    state: "incomplete",
    continuations: 0,
    repairs: 0,
    segments: [segment],
  };
  const message: UIMessage = {
    id: "answer",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "A long unique prose ending of at least thirty two characters.",
        providerMetadata: { clackAnswer: { segmentId: "first" } },
      },
    ],
    metadata: { clackAnswer: answer },
  };
  const run = {
    state: "interrupted" as const,
    startedAt: 1,
    budget: createRunBudget("ask"),
  };
  it("allows explicit recovery only for source-linked pure text", () => {
    expect(recoveryAvailability(run, [message], "chat")).toMatchObject({
      allowed: true,
      partial: true,
    });
    expect(
      recoveryAvailability({ ...run, recoveryAttempts: 1 }, [message], "chat").allowed,
    ).toBe(false);
    expect(
      recoveryAvailability({ ...run, state: "cancelled" }, [message], "chat").allowed,
    ).toBe(false);
    expect(
      recoveryAvailability(run, [{ ...message, metadata: undefined }], "chat").allowed,
    ).toBe(false);
    expect(recoveryAvailability(run, [message], "other-conversation").allowed).toBe(false);
  });
  it.each([
    "input-streaming",
    "approval-requested",
    "approval-responded",
    "output-available",
    "output-error",
  ])("does not replay tool/approval state %s", (state) => {
    const part = {
      type: "tool-edit",
      toolCallId: "done",
      state,
      input: {},
      output: "written",
    } as UIMessage["parts"][number];
    expect(
      recoveryAvailability(run, [
        { ...message, parts: [...message.parts, part] },
      ], "chat").allowed,
    ).toBe(false);
  });
  it.each([
    "awaiting-approval",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "timed-out",
    "interrupted",
  ])("native execution ledger %s blocks original-task replay", (state) => {
    expect(
      unresolvedExecution(
        [{ runId: 1, state, effect: "unknown" } as ExecutionRecord],
        1,
      ),
    ).toBe(true);
    expect(
      unresolvedExecution(
        [{ runId: 2, state, effect: "unknown" } as ExecutionRecord],
        1,
      ),
    ).toBe(false);
  });
  it("quarantines even complete tool JSON until verified provider completion", async () => {
    const f = fixture([
      [
        { type: "tool-input-start", id: "call", toolName: "edit" },
        { type: "tool-input-delta", id: "call", delta: "{}" },
        { type: "tool-input-end", id: "call" },
        {
          type: "tool-call",
          toolCallId: "call",
          toolName: "edit",
          input: "{}",
        },
        { type: "error", error: disconnect() },
      ],
    ]);
    const states: AnswerState[] = [];
    const wrapped = withAnswerContinuation(f.wrapped, {
      runId: "chat:1",
      modelId: "captured",
      provider: "fixture",
      isCurrent: () => true,
      limits: async () => ({ asserted: 32768 }),
      onState: (s) => states.push(s),
    }) as LanguageModelV3;
    const result = await collect(wrapped);
    expect(result.output.some((p) => p.type === "tool-call")).toBe(false);
    expect(states[states.length - 1]).toMatchObject({
      state: "incomplete",
      segments: [
        {
          finish: "interrupted",
          pending: [{ id: "call", name: "edit", input: "{}" }],
        },
      ],
    });
    expect(f.doStream).toHaveBeenCalledOnce();
  });
  it("restart reconstructs once without fabricating completion, rewriting disk, or inference", () => {
    const original = {
      ...message,
      metadata: {
        clackAnswer: {
          ...answer,
          state: "streaming",
          segments: [{ ...segment, finish: "unknown" }],
        },
      },
    };
    const before = JSON.stringify(original);
    const loaded = recoverAnswerMessages([original]);
    expect(recoverAnswerMessages(loaded)).toEqual(loaded);
    expect(readAnswer(loaded[0])).toMatchObject({
      state: "incomplete",
      segments: [{ finish: "interrupted" }],
    });
    expect(loaded[0].parts).toBe(original.parts);
    expect(JSON.stringify(original)).toBe(before);
  });
  it("explicit segment linkage dedupes bounded exact prose across SDK steps, not raw history", () => {
    const updated: UIMessage = {
      ...message,
      parts: [
        ...message.parts,
        { type: "step-start" },
        {
          type: "text",
          text: "A long unique prose ending of at least thirty two characters. More.",
          providerMetadata: { clackAnswer: { segmentId: "second" } },
        },
      ],
      metadata: {
        clackAnswer: {
          ...answer,
          segments: [
            segment,
            {
              ...segment,
              id: "second",
              previous: "first",
              recovery: true,
              finish: "stop",
            },
          ],
        },
      },
    };
    expect(answerParts(updated).filter((p) => p.type === "text")).toMatchObject(
      [
        {
          text: "A long unique prose ending of at least thirty two characters. More.",
        },
      ],
    );
    expect(updated.parts).toHaveLength(3);
  });
  it.each([
    [new Error("ECONNREFUSED"), "network"],
    [new Error("ECONNRESET"), "network"],
    [new Error("Server restarted"), "backend_restart"],
    [new Error("Model is loading"), "model_loading"],
    [new Error("Timed out"), "timeout"],
    [new Error("Unknown wire problem"), "unknown"],
    [new InferenceTransportError("missing-final-event"), "interrupted"],
  ])("distinguishes evidence-supported endpoint state %#", (error, kind) =>
    expect(normalizeAiError(error).kind).toBe(kind));
});
