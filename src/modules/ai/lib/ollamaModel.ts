import { InferenceTransportError } from "@/modules/ai/lib/inferenceErrors";
import { OllamaParserFailureState } from "@/modules/ai/lib/ollamaParserFailureDiagnostics";
import { normalizeEndpointUrl } from "@/modules/ai/lib/selfHostedProfiles";
import {
  APICallError,
  type LanguageModelV3,
  type LanguageModelV3CallOptions,
  type LanguageModelV3Content,
  type LanguageModelV3FinishReason,
  type LanguageModelV3StreamPart,
  type LanguageModelV3Usage,
  type SharedV3Warning,
  UnsupportedFunctionalityError,
} from "@ai-sdk/provider";
import { convertUint8ArrayToBase64 } from "@ai-sdk/provider-utils";
import { z } from "zod";

export function ollamaChatURL(baseURL: string): string {
  const url = new URL(normalizeEndpointUrl(baseURL));
  url.pathname = `${url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "")}/api/chat`;
  return url.href;
}

const unsupported = (functionality: string): never => {
  throw new UnsupportedFunctionalityError({ functionality });
};
function messages(prompt: LanguageModelV3CallOptions["prompt"]) {
  const system = prompt.flatMap((message) =>
    message.role === "system" ? [message.content] : [],
  );
  // Native model templates may allow exactly one system message, only at index zero.
  return [
    ...(system.length
      ? [{ role: "system", content: system.join("\n\n") }]
      : []),
    ...prompt.flatMap((message): Record<string, unknown>[] => {
      if (message.role === "system") return [];
      if (message.role === "tool")
        return message.content.map((part) => {
          if (part.type !== "tool-result")
            return unsupported("Ollama provider-executed approvals");
          const output = part.output;
          if (
            output.type === "content" &&
            output.value.some((p) => p.type !== "text")
          )
            return unsupported("Ollama non-text tool results");
          return {
            role: "tool",
            tool_name: part.toolName,
            tool_call_id: part.toolCallId,
            content:
              output.type === "execution-denied"
                ? (output.reason ?? "Tool execution denied")
                : output.type === "content"
                  ? output.value
                      .map((p) => (p.type === "text" ? p.text : ""))
                      .join("\n")
                  : typeof output.value === "string"
                    ? output.value
                    : JSON.stringify(output.value),
          };
        });
      const text: string[] = [],
        thinking: string[] = [],
        images: string[] = [];
      const calls: Record<string, unknown>[] = [];
      for (const part of message.content) {
        switch (part.type) {
          case "text":
            text.push(part.text);
            break;
          case "reasoning":
            thinking.push(part.text);
            break;
          case "tool-call":
            calls.push({
              id: part.toolCallId,
              function: { name: part.toolName, arguments: part.input },
            });
            break;
          case "file": {
            if (!part.mediaType.startsWith("image/"))
              return unsupported("Ollama non-image input");
            if (part.data instanceof URL) {
              const match =
                /^data:image\/[^;,]+;base64,([A-Za-z0-9+/=]+)$/.exec(
                  part.data.href,
                );
              if (!match) return unsupported("Ollama remote image URL");
              images.push(match[1]);
            } else
              images.push(
                typeof part.data === "string"
                  ? part.data
                  : convertUint8ArrayToBase64(part.data),
              );
            break;
          }
          default:
            return unsupported("Ollama assistant-side tool results");
        }
      }
      return [
        {
          role: message.role,
          content: text.join("\n"),
          ...(thinking.length ? { thinking: thinking.join("\n") } : {}),
          ...(images.length ? { images } : {}),
          ...(calls.length ? { tool_calls: calls } : {}),
        },
      ];
    }),
  ];
}

export function ollamaBody(
  model: string,
  params: LanguageModelV3CallOptions,
  stream: boolean,
) {
  const options: Record<string, unknown> = {
    num_predict: params.maxOutputTokens,
  };
  for (const [key, value] of Object.entries({
    temperature: params.temperature,
    top_p: params.topP,
    top_k: params.topK,
    seed: params.seed,
    stop: params.stopSequences,
    presence_penalty: params.presencePenalty,
    frequency_penalty: params.frequencyPenalty,
  }))
    if (value !== undefined) options[key] = value;
  const native = params.providerOptions?.ollama;
  if (native?.numCtx !== undefined) options.num_ctx = native.numCtx;
  const choice = params.toolChoice;
  const tools = params.tools
    ?.filter(
      (tool) =>
        choice?.type !== "none" &&
        (choice?.type !== "tool" || tool.name === choice.toolName),
    )
    .map((tool) => {
      if (tool.type !== "function")
        return unsupported("Ollama provider-defined tools");
      return {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      };
    });
  return {
    model,
    messages: messages(params.prompt),
    stream,
    options,
    ...(tools?.length ? { tools } : {}),
    ...(params.responseFormat?.type === "json"
      ? { format: params.responseFormat.schema ?? "json" }
      : {}),
    ...(native?.think !== undefined ? { think: native.think } : {}),
  };
}

const count = z.number().int().nonnegative().safe().optional();
const frameSchema = z.object({
  model: z.string().optional(),
  created_at: z.string().optional(),
  message: z
    .object({
      role: z.literal("assistant").optional(),
      content: z.string().optional(),
      thinking: z.string().optional(),
      tool_calls: z
        .array(
          z.object({
            id: z.string().min(1).max(256).optional(),
            function: z.object({
              index: z.number().int().nonnegative().optional(),
              name: z.string().min(1).max(1024),
              arguments: z.record(z.string(), z.unknown()),
            }),
          }),
        )
        .max(128)
        .optional(),
    })
    .optional(),
  done: z.boolean().optional(),
  done_reason: z.string().optional(),
  error: z.string().optional(),
  prompt_eval_count: count,
  eval_count: count,
});
type Frame = z.infer<typeof frameSchema>;
function finish(frame: Frame, tools: boolean): LanguageModelV3FinishReason {
  return {
    unified:
      frame.done_reason === "length"
        ? "length"
        : tools
          ? "tool-calls"
          : frame.done_reason === "stop"
            ? "stop"
            : "other",
    raw: frame.done_reason,
  };
}
function usage(frame: Frame): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: frame.prompt_eval_count,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: frame.eval_count,
      text: undefined,
      reasoning: undefined,
    },
  };
}
function toolParts(frame: Frame, ids: Set<string>): LanguageModelV3Content[] {
  return (frame.message?.tool_calls ?? []).map((call) => {
    const toolCallId = call.id ?? crypto.randomUUID();
    if (ids.has(toolCallId))
      throw new InferenceTransportError("malformed-stream");
    ids.add(toolCallId);
    return {
      type: "tool-call",
      toolCallId,
      toolName: call.function.name,
      input: JSON.stringify(call.function.arguments),
    };
  });
}
function priorCallIds(params: LanguageModelV3CallOptions) {
  return new Set(
    params.prompt.flatMap((message) =>
      message.role === "assistant"
        ? message.content.flatMap((part) =>
            part.type === "tool-call" ? [part.toolCallId] : [],
          )
        : [],
    ),
  );
}
function warnings(params: LanguageModelV3CallOptions): SharedV3Warning[] {
  return params.toolChoice?.type === "required" ||
    params.toolChoice?.type === "tool"
    ? [
        {
          type: "unsupported",
          feature: "toolChoice",
          details:
            "Ollama native API cannot force a tool call. Named selection restricts exposed tools, but may still return text.",
        },
      ]
    : [];
}

// Native NDJSON maps directly to SDK v3, without a fake OpenAI wire protocol.
export function createOllamaModel(config: {
  modelId: string;
  baseURL: string;
  fetch: typeof fetch;
  apiKey?: string;
  onFinish?: () => Promise<void>;
  onStreamBoundary?: (stage: string) => void;
}): LanguageModelV3 {
  const boundary = (stage: string) => {
    try { config.onStreamBoundary?.(stage); } catch { /* diagnostics only */ }
  };
  const url = ollamaChatURL(config.baseURL);
  const send = async (params: LanguageModelV3CallOptions, stream: boolean) => {
    const body = JSON.stringify(ollamaBody(config.modelId, params, stream));
    const headers = new Headers(params.headers as HeadersInit);
    headers.set("Content-Type", "application/json");
    if (config.apiKey) headers.set("Authorization", `Bearer ${config.apiKey}`);
    const response = await config.fetch(url, {
      method: "POST",
      headers,
      body,
      signal: params.abortSignal,
    });
    if (!response.ok) {
      const responseBody = (await response.text()).slice(0, 16384);
      let message = `Ollama returned HTTP ${response.status}`;
      try {
        const value = JSON.parse(responseBody);
        if (typeof value.error === "string") message = value.error;
      } catch {
        /* Non-JSON proxy error. */
      }
      throw new APICallError({
        message,
        url,
        requestBodyValues: JSON.parse(body),
        statusCode: response.status,
        responseBody,
        isRetryable: false,
      });
    }
    return { body, response };
  };
  return {
    specificationVersion: "v3",
    provider: "ollama",
    modelId: config.modelId,
    supportedUrls: { "image/*": [/^data:image\//] },
    async doGenerate(params) {
      const { body, response } = await send(params, false);
      const frame = frameSchema.parse(await response.json());
      if (frame.error) throw new Error(frame.error);
      if (!frame.done || !frame.message)
        throw new Error("Incomplete Ollama response");
      const calls = toolParts(frame, priorCallIds(params));
      await config.onFinish?.();
      return {
        content: [
          ...(frame.message.thinking
            ? [{ type: "reasoning" as const, text: frame.message.thinking }]
            : []),
          ...(frame.message.content
            ? [{ type: "text" as const, text: frame.message.content }]
            : []),
          ...calls,
        ],
        finishReason: finish(frame, calls.length > 0),
        usage: usage(frame),
        warnings: warnings(params),
        request: { body },
        response: {
          modelId: frame.model,
          headers: Object.fromEntries(response.headers),
        },
      };
    },
    async doStream(params) {
      const { body, response } = await send(params, true);
      if (!response.body) throw new Error("Missing Ollama response stream");
      let pending = "",
        done = false,
        eof = false,
        text = false,
        reasoning = false,
        calls = 0;
      let terminal: Frame | undefined;
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const reader = response.body.getReader();
      const parseDiagnostic = new OllamaParserFailureState();
      const ids = priorCallIds(params);
      const events: LanguageModelV3StreamPart[] = [
        { type: "stream-start", warnings: warnings(params) },
      ];
      const parse = async (line: string) => {
        if (!line.trim()) return;
        parseDiagnostic.phase = "parse-frame";
        parseDiagnostic.readingFrame(line);
        if (done) throw new Error("Ollama sent data after completion");
        const frame = frameSchema.parse(JSON.parse(line));
        parseDiagnostic.parsed(frame);
        if (frame.error) throw new Error(frame.error);
        if (!frame.message && frame.done !== true)
          throw new Error("Invalid Ollama stream frame");
        if (frame.message?.thinking) {
          if (!reasoning) {
            reasoning = true;
            events.push({ type: "reasoning-start", id: "reasoning" });
          }
          events.push({
            type: "reasoning-delta",
            id: "reasoning",
            delta: frame.message.thinking,
          });
        }
        if (frame.message?.content) {
          if (!text) {
            text = true;
            events.push({ type: "text-start", id: "text" });
          }
          events.push({
            type: "text-delta",
            id: "text",
            delta: frame.message.content,
          });
        }
        for (const call of toolParts(frame, ids)) {
          if (++calls > 128 || call.type !== "tool-call")
            throw new Error("Too many Ollama tool calls");
          events.push(
            {
              type: "tool-input-start",
              id: call.toolCallId,
              toolName: call.toolName,
            },
            {
              type: "tool-input-delta",
              id: call.toolCallId,
              delta: call.input,
            },
            { type: "tool-input-end", id: call.toolCallId },
            call,
          );
        }
        if (frame.done) {
          boundary("sdk-parser-terminal");
          done = true;
          terminal = frame;
          if (reasoning)
            events.push({ type: "reasoning-end", id: "reasoning" });
          if (text) events.push({ type: "text-end", id: "text" });
        }
      };
      return {
        request: { body },
        response: { headers: Object.fromEntries(response.headers) },
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          async pull(controller) {
            try {
              while (!events.length) {
                const newline = pending.indexOf("\n");
                if (newline >= 0) {
                  const line = pending.slice(0, newline);
                  pending = pending.slice(newline + 1);
                  await parse(line);
                  continue;
                }
                if (eof) {
                  controller.close();
                  return;
                }
                const chunk = await reader.read();
                if (chunk.done) {
                  boundary("response-body-eof");
                  parseDiagnostic.phase = "decoder-flush";
                  parseDiagnostic.flushed = true;
                  pending += decoder.decode();
                  if (pending) {
                    const line = pending;
                    pending = "";
                    await parse(line);
                  }
                  if (!terminal)
                    throw new InferenceTransportError("missing-final-event");
                  eof = true;
                  await config.onFinish?.();
                  events.push({
                    type: "finish",
                    finishReason: finish(terminal, calls > 0),
                    usage: usage(terminal),
                  });
                } else {
                  parseDiagnostic.observeChunk(chunk.value);
                  parseDiagnostic.phase = "decode";
                  pending += decoder.decode(chunk.value, { stream: true });
                }
                if (pending.length > 4 * 1024 * 1024)
                  throw new Error("Ollama stream frame exceeds limit");
              }
              controller.enqueue(events.shift() as LanguageModelV3StreamPart);
            } catch (error) {
              parseDiagnostic.failure("native-adapter", response, error, pending, true);
              boundary("response-body-error");
              // Fixed metadata only, not the error message/provider content.
              await reader.cancel("ollama-sdk-stream-error").catch(() => {});
              controller.error(error);
            }
          },
          cancel: (reason) => { boundary("response-body-cancelled"); return reader.cancel(reason); },
        }),
      };
    },
  };
}
