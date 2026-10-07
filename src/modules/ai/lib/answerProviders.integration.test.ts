import { describe, expect, it, vi } from "vitest";
import { streamText, jsonSchema, tool } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createXai } from "@ai-sdk/xai";
import { createGroq } from "@ai-sdk/groq";
import { createCerebras } from "@ai-sdk/cerebras";
import {
  verifiedProviderFetch,
  withAnswerContinuation,
  type AnswerState,
} from "@/modules/ai/lib/answerContinuation";

const sse = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
const content = "This is a meaningful segment of the same answer.";
const ending = " The final distinct continuation.";
function wire(provider: string, length: boolean, raw?: string): string {
  const segmentText = length ? content : ending;
  if (provider === "responses")
    return [
      {
        type: "response.created",
        response: { id: "response", created_at: 1, model: "gpt-4.1" },
      },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { id: "msg", type: "message" },
      },
      {
        type: "response.output_text.delta",
        item_id: "msg",
        delta: segmentText,
      },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: { id: "msg", type: "message" },
      },
      {
        type: length ? "response.incomplete" : "response.completed",
        response: {
          incomplete_details: length
            ? { reason: raw ?? "max_output_tokens" }
            : null,
          usage: { input_tokens: 20, output_tokens: 10 },
        },
      },
    ]
      .map(sse)
      .join("");
  if (provider === "anthropic")
    return [
      {
        type: "message_start",
        message: {
          id: "msg",
          type: "message",
          role: "assistant",
          model: "claude",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 20, output_tokens: 0 },
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: segmentText },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: {
          stop_reason: raw ?? (length ? "max_tokens" : "end_turn"),
          stop_sequence: null,
        },
        usage: { output_tokens: 10 },
      },
      { type: "message_stop" },
    ]
      .map(sse)
      .join("");
  if (provider === "google")
    return sse({
      candidates: [
        {
          index: 0,
          content: { role: "model", parts: [{ text: segmentText }] },
          finishReason: raw ?? (length ? "MAX_TOKENS" : "STOP"),
        },
      ],
      usageMetadata: {
        promptTokenCount: 20,
        candidatesTokenCount: 10,
        totalTokenCount: 30,
      },
    });
  return `${sse({
    id: "response",
    object: "chat.completion.chunk",
    created: 1,
    model: "model",
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: segmentText },
        finish_reason: raw ?? (length ? "length" : "stop"),
      },
    ],
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
  })}data: [DONE]\n\n`;
}
const factories = {
  responses: (fetch: typeof globalThis.fetch) =>
    createOpenAI({ apiKey: "fixture", fetch })("gpt-4.1"),
  openai: (fetch: typeof globalThis.fetch) =>
    createOpenAI({ apiKey: "fixture", fetch }).chat("gpt-4.1"),
  compatible: (fetch: typeof globalThis.fetch) =>
    createOpenAICompatible({
      name: "self-hosted",
      baseURL: "http://fixture/v1",
      fetch,
    })("model"),
  anthropic: (fetch: typeof globalThis.fetch) =>
    createAnthropic({ apiKey: "fixture", fetch })("claude-sonnet-4-5"),
  google: (fetch: typeof globalThis.fetch) =>
    createGoogleGenerativeAI({ apiKey: "fixture", fetch })("gemini-2.5-flash"),
  xai: (fetch: typeof globalThis.fetch) =>
    createXai({ apiKey: "fixture", fetch }).chat("grok-3"),
  groq: (fetch: typeof globalThis.fetch) =>
    createGroq({ apiKey: "fixture", fetch })("llama-3.3-70b-versatile"),
  cerebras: (fetch: typeof globalThis.fetch) =>
    createCerebras({ apiKey: "fixture", fetch })("llama3.1-8b"),
};
describe("actual installed provider adapters with intercepted protocol fixtures", () => {
  it("OpenAI Responses completed function calls retain normal approval despite absent raw reason", async () => {
    const payload = [
      {
        type: "response.created",
        response: { id: "response", created_at: 1, model: "gpt-4.1" },
      },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          id: "fn",
          type: "function_call",
          call_id: "call",
          name: "edit",
          arguments: "",
        },
      },
      {
        type: "response.function_call_arguments.delta",
        item_id: "fn",
        output_index: 0,
        delta: "{}",
      },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          id: "fn",
          type: "function_call",
          call_id: "call",
          name: "edit",
          arguments: "{}",
          status: "completed",
        },
      },
      {
        type: "response.completed",
        response: { usage: { input_tokens: 20, output_tokens: 10 } },
      },
    ]
      .map(sse)
      .join("");
    const fetcher = vi.fn(
      async () =>
        new Response(payload, {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const states: AnswerState[] = [],
      execute = vi.fn(),
      approval = vi.fn(() => true);
    const model = withAnswerContinuation(
      factories.responses(verifiedProviderFetch(fetcher)),
      {
        runId: "run",
        provider: "openai",
        modelId: "captured",
        isCurrent: () => true,
        limits: async () => ({ asserted: 32768 }),
        onState: (state) => states.push(state),
      },
    );
    const result = streamText({
      model,
      prompt: "Edit",
      tools: {
        edit: tool({
          inputSchema: jsonSchema({ type: "object", properties: {} }),
          needsApproval: approval,
          execute,
        }),
      },
      maxRetries: 0,
    });
    const chunks = [];
    for await (const p of result.fullStream) chunks.push(p);
    expect(approval).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
    expect(chunks.some((p) => p.type === "tool-approval-request")).toBe(true);
    expect(states[states.length - 1]).toMatchObject({
      state: "complete",
      segments: [{ finish: "tool-calls", wireFinish: "response.completed" }],
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("OpenAI Responses nonstandard incomplete details stay unknown even if the adapter defaults to stop", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(wire("responses", true, "strange-halt"), {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const states: AnswerState[] = [];
    const model = withAnswerContinuation(
      factories.responses(verifiedProviderFetch(fetcher)),
      {
        runId: "run",
        provider: "openai",
        modelId: "model",
        isCurrent: () => true,
        limits: async () => ({ asserted: 32768 }),
        onState: (state) => states.push(state),
      },
    );
    const result = streamText({ model, prompt: "Write", maxRetries: 0 });
    for await (const _p of result.fullStream) {
      /* Consume the actual SDK stream. */
    }
    expect(fetcher).toHaveBeenCalledOnce();
    expect(states[states.length - 1].segments[0].finish).toBe("unknown");
  });
  it.each(
    Object.keys(factories) as (keyof typeof factories)[],
  )("%s length continues on the captured destination", async (provider) => {
    const bodies: unknown[] = [];
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(init?.body as string));
      return new Response(wire(provider, bodies.length === 1), {
        headers: { "content-type": "text/event-stream" },
      });
    });
    const states: AnswerState[] = [];
    const model = withAnswerContinuation(
      factories[provider](verifiedProviderFetch(fetcher)),
      {
        runId: "run",
        provider,
        modelId: "captured",
        isCurrent: () => true,
        limits: async () => ({ asserted: 32768 }),
        onState: (state) => states.push(state),
      },
    );
    const result = streamText({
      model,
      prompt: "Write a detailed answer",
      maxRetries: 0,
    });
    const errors: unknown[] = [];
    for await (const p of result.fullStream)
      if (p.type === "error") errors.push(p.error);
    expect(errors).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await result.text).toBe(content + ending);
    expect(states[states.length - 1]).toMatchObject({
      state: "complete",
      continuations: 1,
      segments: [{ finish: "length" }, { finish: "stop" }],
    });
    expect(JSON.stringify(bodies[1])).toContain(
      "Continue the SAME assistant answer",
    );
    expect(fetcher.mock.calls[1][0]).toBe(fetcher.mock.calls[0][0]);
  });
  it("a compatible endpoint's nonstandard reason remains unknown", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(wire("compatible", false, "generation-cap"), {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const states: AnswerState[] = [];
    const model = withAnswerContinuation(
      factories.compatible(verifiedProviderFetch(fetcher)),
      {
        runId: "run",
        provider: "compatible",
        modelId: "model",
        isCurrent: () => true,
        limits: async () => ({ asserted: 32768 }),
        onState: (state) => states.push(state),
      },
    );
    const result = streamText({ model, prompt: "Write", maxRetries: 0 });
    for await (const _p of result.fullStream) {
      /* Consume the actual SDK stream. */
    }
    expect(fetcher).toHaveBeenCalledOnce();
    expect(states[states.length - 1]).toMatchObject({
      state: "incomplete",
      segments: [{ finish: "unknown" }],
    });
  });
});
