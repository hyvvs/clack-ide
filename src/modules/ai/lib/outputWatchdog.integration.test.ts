import { describe, expect, it, vi } from "vitest";
import { readUIMessageStream, streamText, type UIMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import {
  answerMetadataStream,
  answerParts,
  readAnswer,
  recoverAnswerMessages,
  withAnswerContinuation,
  type AnswerState,
} from "@/modules/ai/lib/answerContinuation";
import {
  beginInference,
  cancelSessionInference,
  sessionInference,
} from "@/modules/ai/lib/inferenceLifecycle";
import {
  createOutputWatchdog,
  OutputWatchdogError,
} from "@/modules/ai/lib/outputWatchdog";
import { normalizeAiError } from "@/modules/ai/lib/errors";
import { createRunBudget } from "@/modules/ai/lib/runBudget";
import { recoveryAvailability } from "@/modules/ai/lib/streamRecovery";
import { withProviderRetryTracking } from "@/modules/ai/lib/providerRetry";

const delta = `Meaningful partial output. ${" ".repeat(8200)}`;
const sse = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const text = (value: string): LanguageModelV3StreamPart[] => [
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: value },
  { type: "text-end", id: "t" },
];
const finish = (reason = "stop"): LanguageModelV3StreamPart => ({
  type: "finish",
  finishReason: { unified: reason as "stop", raw: reason },
  usage,
});
async function sdkMessage(
  model: LanguageModelV3,
  extra: Partial<Parameters<typeof withAnswerContinuation>[1]> = {},
) {
  const states: AnswerState[] = [],
    errors: unknown[] = [];
  const stream = answerMetadataStream(async (onState) =>
    streamText({
      model: withAnswerContinuation(
        withProviderRetryTracking(
          model,
          { onRetry: () => {}, onRecovered: () => {} },
          2,
          { delayMs: 0 },
        ),
        {
          runId: "f2:1",
          provider: model.provider,
          modelId: model.modelId,
          isCurrent: () => true,
          limits: async () => ({ asserted: 32768 }),
          onState: (state) => {
            states.push(state);
            onState(state);
          },
          ...extra,
        },
      ),
      prompt: "Write a useful answer.",
      maxRetries: 0,
      onError: () => {},
    }).toUIMessageStream({
      onError: (error) => {
        errors.push(error);
        return normalizeAiError(error).message;
      },
    }),
  );
  let final: UIMessage | undefined;
  for await (const message of readUIMessageStream({
    stream,
    terminateOnError: false,
  }))
    final = message;
  if (!final) throw new Error("Missing SDK UI message");
  return { final, states, errors };
}
describe("F2 installed provider adapters and SDK persistence boundary", () => {
  it.each([
    "openai",
    "compatible",
    "anthropic",
    "google",
  ] as const)("preserves partial %s output and persists a watchdog stop through the actual adapter", async (provider) => {
    const chatPayload =
      sse({
        id: "r",
        created: 1,
        model: "fixture",
        choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
      }) +
      sse({
        id: "r",
        created: 1,
        model: "fixture",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      }) +
      "data: [DONE]\n\n";
    const anthropicPayload = [
      [
        "message_start",
        {
          type: "message_start",
          message: {
            id: "r",
            type: "message",
            role: "assistant",
            model: "fixture",
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 0 },
          },
        },
      ],
      [
        "content_block_start",
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
      ],
      [
        "content_block_delta",
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: delta },
        },
      ],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      [
        "message_delta",
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 1 },
        },
      ],
      ["message_stop", { type: "message_stop" }],
    ]
      .map(([event, value]) => `event: ${event}\n${sse(value)}`)
      .join("");
    const googlePayload = sse({
      candidates: [
        {
          index: 0,
          content: { role: "model", parts: [{ text: delta }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 1,
        candidatesTokenCount: 1,
        totalTokenCount: 2,
      },
    });
    const fetcher = vi.fn(
      async () =>
        new Response(
          provider === "anthropic"
            ? anthropicPayload
            : provider === "google"
              ? googlePayload
              : chatPayload,
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    const model =
      provider === "openai"
        ? createOpenAI({ apiKey: "fixture", fetch: fetcher }).chat(
            "gpt-fixture",
          )
        : provider === "compatible"
          ? createOpenAICompatible({
              name: "fixture",
              baseURL: "https://fixture.invalid/v1",
              fetch: fetcher,
            })("model")
          : provider === "anthropic"
            ? createAnthropic({ apiKey: "fixture", fetch: fetcher })(
                "claude-fixture",
              )
            : createGoogleGenerativeAI({ apiKey: "fixture", fetch: fetcher })(
                "gemini-fixture",
              );
    const { final, errors } = await sdkMessage(model);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(
      final.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join(""),
    ).toBe(delta);
    expect(readAnswer(final)).toMatchObject({
      state: "incomplete",
      watchdog: { reason: "excessive_whitespace" },
    });
    expect(normalizeAiError(errors[0])).toMatchObject({
      kind: "watchdog",
      retryable: false,
    });
    const restored = JSON.parse(JSON.stringify(final)) as UIMessage;
    expect(recoverAnswerMessages([restored])[0]).toBe(restored);
    expect(answerParts(restored)).toEqual(final.parts);
    expect(
      recoveryAvailability(
        {
          state: "failed",
          startedAt: 1,
          error: normalizeAiError(errors[0]),
          budget: createRunBudget("trusted-workspace"),
        },
        [restored],
        "f2",
      ).allowed,
    ).toBe(false);
  });
  it("stops identical continuation suffixes before D2's final request without discarding any accepted segment", async () => {
    const value =
      "This is meaningful prose but the next continuation emits exactly the same ending again.";
    const call = vi.fn(async () => ({
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        start(c) {
          for (const p of [...text(value), finish("length")]) c.enqueue(p);
          c.close();
        },
      }),
    }));
    const { final } = await sdkMessage({
      specificationVersion: "v3",
      provider: "fixture",
      modelId: "m",
      supportedUrls: {},
      doStream: call,
      doGenerate: vi.fn(),
    });
    expect(call).toHaveBeenCalledTimes(3);
    expect(
      final.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join(""),
    ).toBe(value.repeat(3));
    expect(readAnswer(final)?.watchdog?.reason).toBe("continuation_loop");
  });
  it("stops tiny continuation churn but permits useful D2 progress", async () => {
    const plans = [
      "A meaningful first answer with useful progress.",
      "This is tiny output.",
      "This is tiny output.",
    ];
    const call = vi.fn(async () => ({
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        start(c) {
          for (const p of [...text(plans.shift() ?? "late"), finish("length")])
            c.enqueue(p);
          c.close();
        },
      }),
    }));
    const result = await sdkMessage({
      specificationVersion: "v3",
      provider: "fixture",
      modelId: "m",
      supportedUrls: {},
      doStream: call,
      doGenerate: vi.fn(),
    });
    expect(call).toHaveBeenCalledTimes(3);
    expect(readAnswer(result.final)?.watchdog?.reason).toBe(
      "continuation_loop",
    );
  });
  it("uses D1 cancellation, settles the admitted attempt, and rejects late chunks", async () => {
    const scope = { sessionId: "f2", runId: "f2:1", isCurrent: () => true };
    let late!: ReadableStreamDefaultController<LanguageModelV3StreamPart>;
    const aborted = vi.fn();
    const call = vi.fn(async () => {
      const attempt = beginInference(scope, () => {
        aborted();
        attempt.settle();
      });
      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(c) {
            late = c;
            c.enqueue({ type: "text-start", id: "t" });
            c.enqueue({ type: "text-delta", id: "t", delta });
          },
          cancel() {
            attempt.settle();
          },
        }),
      };
    });
    const stop = vi.fn(() => {
      void cancelSessionInference(scope.sessionId);
    });
    const result = await sdkMessage(
      {
        specificationVersion: "v3",
        provider: "fixture",
        modelId: "m",
        supportedUrls: {},
        doStream: call,
        doGenerate: vi.fn(),
      },
      { onWatchdog: stop },
    );
    expect(stop).toHaveBeenCalledOnce();
    expect(aborted).toHaveBeenCalledOnce();
    expect(sessionInference("f2")).toBeNull();
    expect(() =>
      late.enqueue({ type: "text-delta", id: "t", delta: "late" }),
    ).toThrow();
    expect(
      result.final.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join(""),
    ).toBe(delta);
  });
  it("does not confuse ordinary valid finishes or disconnects with watchdog stops", async () => {
    const error = new Error("network disconnected");
    const call = vi.fn(async () => ({
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        start(c) {
          c.enqueue({ type: "error", error });
          c.close();
        },
      }),
    }));
    const result = await sdkMessage({
      specificationVersion: "v3",
      provider: "fixture",
      modelId: "m",
      supportedUrls: {},
      doStream: call,
      doGenerate: vi.fn(),
    });
    expect(readAnswer(result.final)?.watchdog).toBeUndefined();
    expect(normalizeAiError(result.errors[0]).kind).not.toBe("watchdog");
  });
  it("does not resume a detector already stopped in a previous logical batch", async () => {
    const watchdog = createOutputWatchdog();
    watchdog.observe(" ".repeat(8200));
    const call = vi.fn();
    const model = withAnswerContinuation(
      {
        specificationVersion: "v3",
        provider: "fixture",
        modelId: "m",
        supportedUrls: {},
        doStream: call,
        doGenerate: vi.fn(),
      },
      {
        runId: "f2:1",
        provider: "fixture",
        modelId: "m",
        isCurrent: () => true,
        limits: async () => ({ asserted: 32768 }),
        watchdog,
      },
    ) as LanguageModelV3;
    await expect(model.doStream({ prompt: [] })).rejects.toThrow("whitespace");
    expect(call).not.toHaveBeenCalled();
    expect(
      normalizeAiError(new OutputWatchdogError("repeated_tool_call")).kind,
    ).toBe("watchdog");
  });
});
