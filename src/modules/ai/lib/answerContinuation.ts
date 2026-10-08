import {
  wrapLanguageModel,
  type LanguageModel,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from "@ai-sdk/provider";
import { z } from "zod";
import {
  ContextBudgetError,
  measureRequest,
  resolveContextBudget,
  type BudgetLimits,
} from "@/modules/ai/lib/contextBudget";
import {
  InferenceTransportError,
  deferStreamFailure,
} from "@/modules/ai/lib/inferenceErrors";
import { sanitizeAiErrorText } from "@/modules/ai/lib/errors";

export const ANSWER_LIMITS = {
  continuations: 3,
  repairs: 1,
  milliseconds: 120_000,
  tokens: 16_384,
  characters: 1_048_576,
  toolCharacters: 262_144,
  segments: 256,
  overlap: 256,
} as const;
export type AnswerFinish =
  | "stop"
  | "length"
  | "tool-calls"
  | "policy"
  | "cancelled"
  | "interrupted"
  | "error"
  | "unknown";
export function normalizeAnswerFinish(
  reason?: { unified?: string; raw?: string },
  failure?: "cancelled" | "interrupted" | "error",
  wireFinish?: string,
): AnswerFinish {
  if (failure) return failure;
  if (wireFinish === "response.failed") return "error";
  if (wireFinish === "response.completed" && reason?.unified === "stop")
    return "stop";
  if (wireFinish === "response.completed" && reason?.unified === "tool-calls")
    return "tool-calls";
  if (wireFinish === "response.incomplete")
    return reason?.raw && reason.unified === "length"
      ? "length"
      : reason?.unified === "content-filter"
        ? "policy"
        : "unknown";
  if (!reason?.raw) return "unknown";
  if (reason.unified === "stop") return "stop";
  if (reason.unified === "length") return "length";
  if (reason.unified === "tool-calls") return "tool-calls";
  if (reason.unified === "content-filter") return "policy";
  if (reason.unified === "error") return "error";
  return "unknown";
}
const finishSchema = z.enum([
  "stop",
  "length",
  "tool-calls",
  "policy",
  "cancelled",
  "interrupted",
  "error",
  "unknown",
]);
const pendingSchema = z.object({
  id: z.string().max(1024),
  name: z.string().max(1024),
  input: z.string().max(ANSWER_LIMITS.toolCharacters),
});
export const answerSchema = z.object({
  version: z.literal(1),
  runId: z.string().max(1024),
  state: z.enum(["streaming", "preparing", "complete", "incomplete"]),
  reason: z.string().max(256).optional(),
  continuations: z.number().int().min(0).max(3),
  repairs: z.number().int().min(0).max(1),
  continuationTimeMs: z.number().min(0).max(120_000).optional(),
  segments: z
    .array(
      z.object({
        id: z.string().max(1024),
        previous: z.string().max(1024).nullable(),
        recovery: z.boolean().optional(),
        provider: z.string().max(1024),
        model: z.string().max(1024),
        startedAt: z.number(),
        endedAt: z.number().optional(),
        finish: finishSchema,
        raw: z.string().max(256).optional(),
        wireFinish: z.string().max(64).optional(),
        inputTokens: z.number().nonnegative(),
        outputTokens: z.number().nonnegative(),
        budgetTokens: z.number().nonnegative().optional(),
        usageReported: z.boolean().optional(),
        repairOutput: z.string().max(262_144).optional(),
        pending: z.array(pendingSchema).max(64),
      }),
    )
    .max(ANSWER_LIMITS.segments),
});
export type AnswerState = z.infer<typeof answerSchema>;
export function readAnswer(message: UIMessage): AnswerState | null {
  const value = (message.metadata as { clackAnswer?: unknown } | undefined)
    ?.clackAnswer;
  if (!value) return null;
  try {
    if (JSON.stringify(value).length > 1_048_576) return null;
    const result = answerSchema.safeParse(value);
    if (!result.success) return null;
    const ids = new Set<string>();
    for (const [index, segment] of result.data.segments.entries()) {
      if (
        ids.has(segment.id) ||
        segment.previous !== (result.data.segments[index - 1]?.id ?? null) ||
        (segment.endedAt !== undefined && segment.endedAt < segment.startedAt)
      )
        return null;
      ids.add(segment.id);
    }
    return result.data;
  } catch {
    return null;
  }
}
export function stitchAnswer(left: string, right: string): string {
  // Only long, exact, unique boundaries qualify; short/repeated/code fragments remain intact.
  for (
    let n = Math.min(ANSWER_LIMITS.overlap, left.length, right.length);
    n >= 32;
    n--
  ) {
    const overlap = right.slice(0, n);
    if (
      !/[\r\n`{}[\]]/.test(overlap) &&
      left.endsWith(overlap) &&
      left.indexOf(overlap) === left.length - n &&
      right.indexOf(overlap, 1) === -1 &&
      !/[\uD800-\uDBFF]/.test(overlap.slice(-1))
    )
      return left + right.slice(n);
  }
  return left + right;
}
export function answerParts(message: UIMessage): UIMessage["parts"] {
  const answer = readAnswer(message);
  if (!answer) return message.parts;
  const parts: UIMessage["parts"] = [];
  for (const [index, part] of message.parts.entries()) {
    const previous = parts[parts.length - 1];
    const next = message.parts[index + 1];
    if (
      part.type === "step-start" &&
      previous?.type === "text" &&
      next?.type === "text"
    ) {
      const recovery = answer.segments.find(
        (s) => s.id === next.providerMetadata?.clackAnswer?.segmentId,
      );
      if (
        recovery?.recovery &&
        recovery.previous === previous.providerMetadata?.clackAnswer?.segmentId
      )
        continue;
    }
    const currentSegment =
      part.type === "text"
        ? part.providerMetadata?.clackAnswer?.segmentId
        : undefined;
    const previousSegment =
      previous?.type === "text"
        ? previous.providerMetadata?.clackAnswer?.segmentId
        : undefined;
    const segment = answer.segments.find((s) => s.id === currentSegment);
    if (
      part.type === "text" &&
      previous?.type === "text" &&
      segment?.previous === previousSegment &&
      (answer.segments.find((s) => s.id === previousSegment)?.finish ===
        "length" ||
        answer.segments.find((s) => s.id === currentSegment)?.recovery === true)
    )
      parts[parts.length - 1] = {
        ...part,
        text: stitchAnswer(previous.text, part.text),
      };
    else parts.push(part);
  }
  return parts;
}
export function recoverAnswerMessages(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => {
    const answer = readAnswer(message);
    if (
      !answer ||
      (answer.state !== "streaming" && answer.state !== "preparing")
    )
      return message;
    return {
      ...message,
      metadata: {
        ...(message.metadata as object),
        clackAnswer: {
          ...answer,
          state: "incomplete",
          reason: "Application stopped; continuation was not resumed.",
          segments: answer.segments.map((segment) =>
            segment.endedAt === undefined
              ? { ...segment, finish: "interrupted" }
              : segment,
          ),
        },
      },
    };
  });
}

export function verifiedProviderFetch(fetcher: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await fetcher(input, init);
    if (
      !response.ok ||
      !response.body ||
      !response.headers.get("content-type")?.includes("text/event-stream")
    )
      return response;
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const path = new URL(url).pathname;
    const protocol = path.endsWith("/chat/completions")
      ? "chat"
      : path.endsWith("/messages")
        ? "messages"
        : path.endsWith("/responses")
          ? "responses"
          : null;
    const decoder = new TextDecoder();
    let buffer = "",
      data: string[] = [],
      complete = false,
      eventSize = 0;
    const event = () => {
      const body = data.join("\n");
      data = [];
      eventSize = 0;
      if (protocol === "chat") {
        complete ||= body === "[DONE]";
        return;
      }
      try {
        const value = JSON.parse(body) as { type?: string };
        complete ||=
          protocol === "messages"
            ? value.type === "message_stop"
            : [
                "response.completed",
                "response.incomplete",
                "response.failed",
              ].includes(value.type ?? "");
      } catch {
        /* Nonterminal SSE records remain the adapter's responsibility. */
      }
    };
    const scan = () => {
      while (true) {
        const newline = /\r\n|\r|\n/.exec(buffer);
        if (
          !newline ||
          (newline[0] === "\r" && newline.index === buffer.length - 1)
        )
          break;
        const line = buffer.slice(0, newline.index);
        buffer = buffer.slice(newline.index + newline[0].length);
        eventSize += line.length;
        if (eventSize > 1_048_576)
          throw new InferenceTransportError("remote-disconnect");
        if (!line) event();
        else if (line.startsWith("data:"))
          data.push(line.slice(5).replace(/^ /, ""));
      }
      if (buffer.length > 1_048_576)
        throw new InferenceTransportError("remote-disconnect");
    };
    const reader = response.body.getReader();
    const signal =
      init?.signal ?? (input instanceof Request ? input.signal : undefined);
    let release: (() => void) | undefined;
    return new Response(
      new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await reader.read();
            if (!next.done) {
              buffer += decoder.decode(next.value, { stream: true });
              scan();
              controller.enqueue(next.value);
              return;
            }
            buffer += decoder.decode();
            scan();
            if (protocol && !complete)
              throw new InferenceTransportError("missing-final-event");
            controller.close();
          } catch (error) {
            // Drain adapter buffers before reporting failure; tool quarantine remains closed.
            if (deferStreamFailure(signal, error)) {
              await new Promise<void>((resolve) => {
                release = resolve;
              });
            } else controller.error(error);
            await reader.cancel().catch(() => {});
          }
        },
        cancel(reason) {
          release?.();
          return reader.cancel(reason);
        },
      }),
      {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      },
    );
  };
}

export function answerMetadataStream(
  execute: (
    onState: (state: AnswerState) => void,
  ) => Promise<ReadableStream<UIMessageChunk>>,
): ReadableStream<UIMessageChunk> {
  let active = true,
    started = false;
  let reader: ReadableStreamDefaultReader<UIMessageChunk> | undefined;
  let latest: AnswerState | undefined;
  return new ReadableStream({
    async start(controller) {
      const publish = (state: AnswerState) => {
        latest = state;
        if (active && started)
          controller.enqueue({
            type: "message-metadata",
            messageMetadata: { clackAnswer: state },
          });
      };
      try {
        const stream = await execute(publish);
        if (!active) {
          await stream.cancel();
          return;
        }
        reader = stream.getReader();
        while (active) {
          const next = await reader.read();
          if (next.done || !active) break;
          controller.enqueue(next.value);
          if (!started && next.value.type === "start") {
            started = true;
            if (latest) publish(latest);
          }
        }
      } catch (error) {
        if (active) controller.error(error);
        active = false;
      } finally {
        reader?.releaseLock();
        if (active) controller.close();
        active = false;
      }
    },
    cancel(reason) {
      active = false;
      return reader?.cancel(reason);
    },
  });
}

function sumUsage(
  left: LanguageModelV3Usage | undefined,
  right: LanguageModelV3Usage,
): LanguageModelV3Usage {
  const sum = (a?: number, b?: number) =>
    a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
  return {
    inputTokens: {
      total: sum(left?.inputTokens.total, right.inputTokens.total),
      noCache: sum(left?.inputTokens.noCache, right.inputTokens.noCache),
      cacheRead: sum(left?.inputTokens.cacheRead, right.inputTokens.cacheRead),
      cacheWrite: sum(
        left?.inputTokens.cacheWrite,
        right.inputTokens.cacheWrite,
      ),
    },
    outputTokens: {
      total: sum(left?.outputTokens.total, right.outputTokens.total),
      text: sum(left?.outputTokens.text, right.outputTokens.text),
      reasoning: sum(
        left?.outputTokens.reasoning,
        right.outputTokens.reasoning,
      ),
    },
  };
}
type FinishPart = Extract<LanguageModelV3StreamPart, { type: "finish" }>;
async function withinRun<T>(
  operation: PromiseLike<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted)
    throw new DOMException("Cancelled or deadline expired", "AbortError");
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () =>
      reject(new DOMException("Cancelled or deadline expired", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([operation, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
export function withAnswerContinuation(
  model: LanguageModel,
  options: {
    runId: string;
    provider: string;
    modelId: string;
    isCurrent: () => boolean;
    signal?: AbortSignal;
    limits: () => Promise<BudgetLimits>;
    charge?: () => Promise<void>;
    remaining?: () => number;
    maxContinuations?: number;
    validate?: () => Promise<void>;
    onState?: (state: AnswerState) => void;
    previous?: AnswerState;
    knownToolIds?: readonly string[];
    recovery?: boolean;
  },
): LanguageModel {
  if (typeof model === "string" || model.specificationVersion !== "v3")
    return model;
  const inner = model as LanguageModelV3;
  const responseProtocol =
    inner.provider === "openai.responses" || inner.provider === "xai.responses";
  const state: AnswerState =
    options.previous?.runId === options.runId
      ? structuredClone(options.previous)
      : {
          version: 1,
          runId: options.runId,
          state: "streaming",
          continuations: 0,
          repairs: 0,
          segments: [],
        };
  const publish = () => {
    if (options.isCurrent()) options.onState?.(structuredClone(state));
  };
  const check = () => {
    if (options.signal?.aborted || !options.isCurrent())
      throw new DOMException("Cancelled", "AbortError");
  };
  const knownIds = new Set(options.knownToolIds ?? []);
  let generated = state.segments.reduce(
      (n, s) => n + (s.budgetTokens ?? s.outputTokens),
      0,
    ),
    characters = 0;
  return wrapLanguageModel({
    model: inner,
    middleware: {
      specificationVersion: "v3",
      async wrapStream({ params }) {
        check();
        const deadline = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const signal = AbortSignal.any([
          deadline.signal,
          ...(params.abortSignal ? [params.abortSignal] : []),
          ...(options.signal ? [options.signal] : []),
        ]);
        const current = () => {
          check();
          if (signal.aborted)
            throw new DOMException(
              "Cancelled or deadline expired",
              "AbortError",
            );
        };
        let initial: Awaited<ReturnType<LanguageModelV3["doStream"]>>;
        try {
          initial = await withinRun(
            inner.doStream({
              ...params,
              includeRawChunks: responseProtocol || params.includeRawChunks,
              abortSignal: signal,
            }),
            signal,
          );
        } catch (error) {
          clearTimeout(timer);
          throw error;
        }
        let active = true;
        let reader:
          | ReadableStreamDefaultReader<LanguageModelV3StreamPart>
          | undefined;
        let continuationStarted: number | undefined;
        const elapsed = state.continuationTimeMs ?? 0;
        const recordTime = () => {
          if (continuationStarted !== undefined)
            state.continuationTimeMs = Math.min(
              ANSWER_LIMITS.milliseconds,
              elapsed + Date.now() - continuationStarted,
            );
        };
        const stream = new ReadableStream<LanguageModelV3StreamPart>({
          async start(controller) {
            let usage: LanguageModelV3Usage | undefined;
            let prompt = params.prompt;
            let result = initial;
            let repair: z.infer<typeof pendingSchema> | undefined;
            let interruptedCalls: {
              id: string;
              name: string;
              input: string;
            }[] = [];
            for (const id of params.prompt.flatMap((m) =>
              m.role === "assistant" || m.role === "tool"
                ? m.content.flatMap((p) =>
                    "toolCallId" in p ? [p.toolCallId] : [],
                  )
                : [],
            ))
              knownIds.add(id);
            const allowed = new Set(
              params.tools
                ?.filter((t) => t.type === "function")
                .map((t) => t.name) ?? [],
            );
            try {
              while (true) {
                current();
                if (state.segments.length >= ANSWER_LIMITS.segments)
                  throw new Error("Answer segment limit reached.");
                const segment: AnswerState["segments"][number] = {
                  id: crypto.randomUUID(),
                  previous:
                    state.segments[state.segments.length - 1]?.id ?? null,
                  ...(options.recovery &&
                  state.segments.length === options.previous?.segments.length
                    ? { recovery: true }
                    : {}),
                  provider: options.provider,
                  model: options.modelId,
                  startedAt: Date.now(),
                  finish: "unknown",
                  inputTokens: 0,
                  outputTokens: 0,
                  pending: [],
                };
                state.segments.push(segment);
                state.state = "streaming";
                publish();
                let text = "",
                  generatedCharacters = 0,
                  finish: FinishPart | undefined,
                  failed = false;
                const calls = new Map<
                  string,
                  {
                    id: string;
                    name: string;
                    input: string;
                    call?: Extract<
                      LanguageModelV3StreamPart,
                      { type: "tool-call" }
                    >;
                  }
                >();
                const toolEvents: LanguageModelV3StreamPart[] = [];
                const inputsStarted = new Set<string>(),
                  inputsEnded = new Set<string>();
                reader = result.stream.getReader();
                while (true) {
                  const next = await withinRun(reader.read(), signal);
                  check();
                  if (!active || signal.aborted)
                    throw new DOMException(
                      "Cancelled or deadline expired",
                      "AbortError",
                    );
                  if (next.done) break;
                  const part = next.value;
                  if (responseProtocol && part.type === "raw") {
                    const type =
                      part.rawValue &&
                      typeof part.rawValue === "object" &&
                      "type" in part.rawValue
                        ? part.rawValue.type
                        : null;
                    if (
                      typeof type === "string" &&
                      [
                        "response.completed",
                        "response.incomplete",
                        "response.failed",
                      ].includes(type)
                    )
                      segment.wireFinish = type;
                    if (!params.includeRawChunks) continue;
                  }
                  if (toolEvents.length > 4096)
                    throw new Error("Tool stream event limit reached.");
                  if (part.type === "finish") {
                    if (finish) failed = true;
                    finish = part;
                    continue;
                  }
                  if (part.type === "error") {
                    throw part.error;
                  }
                  if (part.type === "tool-input-start") {
                    if (
                      calls.has(part.id) ||
                      calls.size >= 64 ||
                      part.id.length > 1024 ||
                      part.toolName.length > 1024
                    )
                      throw new Error("Conflicting tool identity.");
                    inputsStarted.add(part.id);
                    calls.set(part.id, {
                      id: part.id,
                      name: part.toolName,
                      input: "",
                    });
                    interruptedCalls = [...calls.values()].map(
                      ({ id, name, input }) => ({ id, name, input }),
                    );
                    segment.pending = interruptedCalls;
                    publish();
                    toolEvents.push(part);
                    continue;
                  }
                  if (part.type === "tool-input-delta") {
                    const call = calls.get(part.id);
                    if (!call || call.call)
                      throw new Error(
                        "Tool input lacks its original unresolved identity.",
                      );
                    call.input += part.delta;
                    if (
                      [...calls.values()].reduce(
                        (n, c) => n + c.input.length,
                        0,
                      ) > ANSWER_LIMITS.toolCharacters
                    )
                      throw new Error("Tool input limit reached.");
                    interruptedCalls = [...calls.values()].map(
                      ({ id, name, input }) => ({ id, name, input }),
                    );
                    segment.pending = interruptedCalls;
                    publish();
                    toolEvents.push(part);
                    continue;
                  }
                  if (part.type === "tool-input-end") {
                    inputsEnded.add(part.id);
                    toolEvents.push(part);
                    continue;
                  }
                  if (part.type === "tool-call") {
                    const old = calls.get(part.toolCallId);
                    if (
                      part.input.length +
                        [...calls.values()].reduce(
                          (n, c) =>
                            n + (c.id === part.toolCallId ? 0 : c.input.length),
                          0,
                        ) >
                        ANSWER_LIMITS.toolCharacters ||
                      (!old && calls.size >= 64) ||
                      part.toolCallId.length > 1024 ||
                      part.toolName.length > 1024
                    )
                      throw new Error("Tool input limit reached.");
                    calls.set(part.toolCallId, {
                      id: part.toolCallId,
                      name: part.toolName,
                      input: part.input,
                      call: part,
                    });
                    if (old?.call || (old && old.name !== part.toolName))
                      failed = true;
                    interruptedCalls = [...calls.values()].map(
                      ({ id, name, input }) => ({ id, name, input }),
                    );
                    segment.pending = interruptedCalls;
                    publish();
                    toolEvents.push(part);
                    continue;
                  }
                  if (
                    part.type === "tool-result" ||
                    part.type === "tool-approval-request"
                  ) {
                    failed = true;
                    continue;
                  }
                  if (
                    part.type === "text-delta" ||
                    part.type === "reasoning-delta"
                  ) {
                    generatedCharacters += part.delta.length;
                    characters += part.delta.length;
                    if (characters > ANSWER_LIMITS.characters)
                      throw new Error("Answer content limit reached.");
                  }
                  if (part.type === "text-delta") {
                    text += part.delta;
                    if (repair && text.length > ANSWER_LIMITS.toolCharacters)
                      throw new Error("Answer content limit reached.");
                  }
                  if (repair && part.type.startsWith("text-")) {
                    segment.repairOutput = text;
                    continue;
                  }
                  if (
                    part.type === "text-start" ||
                    part.type === "text-delta" ||
                    part.type === "text-end" ||
                    part.type === "reasoning-start" ||
                    part.type === "reasoning-delta" ||
                    part.type === "reasoning-end"
                  )
                    controller.enqueue({
                      ...part,
                      id: `${segment.id}:${part.id}`,
                      providerMetadata: {
                        ...part.providerMetadata,
                        clackAnswer: { segmentId: segment.id },
                      },
                    });
                  else if (
                    part.type !== "stream-start" ||
                    state.segments.length === 1
                  )
                    controller.enqueue(part);
                  if (
                    [...calls.values()].reduce(
                      (n, c) => n + c.input.length,
                      0,
                    ) > ANSWER_LIMITS.toolCharacters ||
                    calls.size > 64
                  )
                    throw new Error("Tool input limit reached.");
                }
                reader.releaseLock();
                reader = undefined;
                segment.endedAt = Date.now();
                recordTime();
                segment.finish = normalizeAnswerFinish(
                  finish?.finishReason,
                  failed ? "error" : undefined,
                  segment.wireFinish,
                );
                segment.raw = finish?.finishReason.raw
                  ? sanitizeAiErrorText(finish.finishReason.raw, 256)
                  : undefined;
                segment.inputTokens = finish?.usage.inputTokens.total ?? 0;
                segment.outputTokens = finish?.usage.outputTokens.total ?? 0;
                segment.usageReported =
                  finish?.usage.inputTokens.total !== undefined &&
                  finish?.usage.outputTokens.total !== undefined;
                segment.budgetTokens = Math.max(
                  segment.outputTokens,
                  Math.ceil(
                    (generatedCharacters +
                      [...calls.values()].reduce(
                        (n, c) => n + c.input.length,
                        0,
                      )) /
                      4,
                  ),
                );
                generated += segment.budgetTokens;
                if (finish) usage = sumUsage(usage, finish.usage);
                const toolComplete =
                  (segment.finish === "stop" ||
                    segment.finish === "tool-calls") &&
                  !failed &&
                  [...calls.values()].every((c) => {
                    if (
                      !c.call ||
                      c.call.providerExecuted ||
                      knownIds.has(c.id) ||
                      (inputsStarted.has(c.id) && !inputsEnded.has(c.id))
                    )
                      return false;
                    try {
                      const value = JSON.parse(c.input);
                      return (
                        value !== null &&
                        typeof value === "object" &&
                        !Array.isArray(value)
                      );
                    } catch {
                      return false;
                    }
                  });
                const repairMatches =
                  !repair ||
                  (calls.size === 1 &&
                    calls.get(repair.id)?.name === repair.name &&
                    calls.get(repair.id)?.input.startsWith(repair.input));
                if (calls.size && toolComplete && repairMatches) {
                  segment.pending = [];
                  interruptedCalls = [];
                  for (const event of toolEvents) controller.enqueue(event);
                  for (const call of calls.values()) knownIds.add(call.id);
                } else if (calls.size)
                  segment.pending = [...calls.values()].map(
                    ({ id, name, input }) => ({ id, name, input }),
                  );
                if (
                  repair &&
                  (!toolComplete || !repairMatches || calls.size !== 1)
                )
                  throw new Error(
                    "Tool repair was not complete and identity-preserving; no tool executed.",
                  );
                if (segment.finish !== "length") {
                  state.state =
                    segment.finish === "stop" || segment.finish === "tool-calls"
                      ? segment.pending.length
                        ? "incomplete"
                        : "complete"
                      : "incomplete";
                  state.reason =
                    state.state === "incomplete"
                      ? segment.pending.length
                        ? "Incomplete or repeated tool call; no tool executed."
                        : `Provider finish: ${segment.finish}.`
                      : undefined;
                  publish();
                  if (
                    !failed &&
                    (segment.finish === "unknown" || segment.finish === "error")
                  )
                    controller.enqueue({
                      type: "error",
                      error: new InferenceTransportError(
                        segment.finish === "unknown"
                          ? "missing-final-event"
                          : "provider-error",
                      ),
                    });
                  if (finish)
                    controller.enqueue({
                      ...finish,
                      usage: usage ?? finish.usage,
                      finishReason: segment.pending.length
                        ? { unified: "other", raw: "incomplete-tool" }
                        : finish.finishReason,
                    });
                  else throw new InferenceTransportError("remote-disconnect");
                  break;
                }
                state.state = "preparing";
                publish();
                if (!timer) {
                  if (elapsed >= ANSWER_LIMITS.milliseconds)
                    throw new Error("Answer continuation time limit reached.");
                  continuationStarted = Date.now();
                  timer = setTimeout(
                    () => deadline.abort(),
                    ANSWER_LIMITS.milliseconds - elapsed,
                  );
                }
                if (
                  generated >= ANSWER_LIMITS.tokens ||
                  (options.remaining?.() ?? 2) <= 1
                )
                  throw new Error(
                    "Answer continuation reached the shared token/run limit.",
                  );
                if ((options.maxContinuations ?? 3) <= 0)
                  throw new Error("Automatic output continuation is disabled.");
                if (calls.size) {
                  if (
                    calls.size !== 1 ||
                    state.repairs >= ANSWER_LIMITS.repairs ||
                    knownIds.has([...calls.keys()][0]) ||
                    !allowed.has([...calls.values()][0].name)
                  )
                    throw new Error(
                      "Incomplete tool call cannot be safely repaired; no tool executed.",
                    );
                  repair = segment.pending[0];
                  state.repairs++;
                } else {
                  if (
                    state.continuations >=
                    Math.min(3, options.maxContinuations ?? 3)
                  )
                    throw new Error("Answer continuation limit reached.");
                  if (text.trim().length < 16)
                    throw new Error(
                      "Answer continuation made insufficient progress.",
                    );
                  state.continuations++;
                }
                const directive = repair
                  ? `Complete the interrupted tool call ONLY. Re-emit the full JSON object for tool ${JSON.stringify(repair.name)} with the SAME call ID ${JSON.stringify(repair.id)}. Preserve this exact argument prefix: ${JSON.stringify(repair.input)}. Do not execute anything or create another call.`
                  : "Continue the SAME assistant answer exactly from its last character. Do not repeat any prior text, restart the task, or add a new introduction. Preserve whitespace, code and Markdown. Existing permissions and approvals remain in force.";
                prompt = [
                  ...prompt.filter((m) => m.role === "system"),
                  { role: "system", content: directive },
                  ...prompt.filter((m) => m.role !== "system"),
                  ...(text
                    ? [
                        {
                          role: "assistant" as const,
                          content: [{ type: "text" as const, text }],
                        },
                      ]
                    : []),
                ];
                await withinRun(
                  options.validate?.() ?? Promise.resolve(),
                  signal,
                );
                current();
                const cost = measureRequest({
                  system: prompt.filter((m) => m.role === "system"),
                  messages: prompt.filter((m) => m.role !== "system"),
                  tools: params.tools,
                });
                const limits = await withinRun(options.limits(), signal);
                const output = Math.min(
                  params.maxOutputTokens ?? resolveContextBudget(limits).output,
                  ANSWER_LIMITS.tokens - generated,
                );
                const budget = resolveContextBudget(limits, cost, output);
                if (!budget.fits)
                  throw new ContextBudgetError(
                    "answer-continuation-budget",
                    "The incomplete answer cannot continue within the captured context budget.",
                    budget,
                  );
                await withinRun(
                  options.charge?.() ?? Promise.resolve(),
                  signal,
                );
                current();
                publish();
                result = await withinRun(
                  inner.doStream({
                    ...params,
                    prompt,
                    includeRawChunks:
                      responseProtocol || params.includeRawChunks,
                    maxOutputTokens: output,
                    abortSignal: signal,
                  }),
                  signal,
                );
                current();
              }
            } catch (error) {
              recordTime();
              state.state = "incomplete";
              state.reason =
                options.signal?.aborted || !options.isCurrent()
                  ? "Continuation cancelled."
                  : error instanceof ContextBudgetError
                    ? "Continuation stopped at the context limit."
                    : error instanceof Error
                      ? sanitizeAiErrorText(error.message, 256)
                      : "Continuation failed.";
              const last = state.segments[state.segments.length - 1];
              if (last && !last.endedAt) last.pending = interruptedCalls;
              if (last && !last.endedAt) {
                last.endedAt = Date.now();
                last.finish = options.signal?.aborted
                  ? "cancelled"
                  : "interrupted";
              }
              publish();
              if (active && options.isCurrent() && !options.signal?.aborted) {
                controller.enqueue({ type: "error", error });
                if (usage)
                  controller.enqueue({
                    type: "finish",
                    finishReason: { unified: "other", raw: "incomplete" },
                    usage,
                  });
              }
            } finally {
              clearTimeout(timer);
              await reader?.cancel().catch(() => {});
              if (active) controller.close();
            }
          },
          cancel(reason) {
            active = false;
            deadline.abort();
            clearTimeout(timer);
            return reader?.cancel(reason);
          },
        });
        return { ...initial, stream };
      },
    },
  });
}
