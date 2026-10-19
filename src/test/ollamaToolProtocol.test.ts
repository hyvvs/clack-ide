import { createOllamaModel } from "@/modules/ai/lib/ollamaModel";
import { streamText, tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const markup = '<function=get_test_value>\n<parameter=value>\nprotocol-check\n</parameter>\n</function>\n</tool_call>';
const diagnostic = tool({ description: "Harmless diagnostic value lookup; no filesystem, shell or external effects.", inputSchema: z.object({ value: z.string() }) });
const messages = [
  { role: "system" as const, content: "You are a tool-using assistant. Follow the user's tool request." },
  { role: "user" as const, content: 'Call get_test_value exactly once with value "protocol-check". Do not answer in prose.' },
];

async function probe(modelId: string, message: Record<string, unknown>, thinking: "off" | "unsupported" = "off") {
  let body: Record<string, unknown> | undefined;
  let requests = 0;
  const model = createOllamaModel({ modelId, baseURL: "http://127.0.0.1:11435", fetch: async (_url, init) => {
    requests++;
    body = JSON.parse(String(init?.body));
    return new Response(`${JSON.stringify({ model: modelId, message: { role: "assistant", ...message }, done: true, done_reason: "stop", prompt_eval_count: 100, eval_count: 20 })}\n`, { headers: { "content-type": "application/x-ndjson" } });
  } });
  const result = streamText({ model, messages, tools: { get_test_value: diagnostic }, providerOptions: { ollama: { numCtx: 32768, ...(thinking === "off" ? { think: false } : {}) } }, maxOutputTokens: 2048, maxRetries: 0 });
  return { body: () => body, requests: () => requests, text: await result.text, calls: await result.toolCalls, finish: await result.finishReason };
}

describe("non-executing native tool protocol diagnostics", () => {
  it("uses native Devstral structured fields without inventing a thinking override", async () => {
    const result = await probe("devstral-small-2:24b", { content: "", tool_calls: [{ function: { name: "get_test_value", arguments: { value: "protocol-check" } } }] }, "unsupported");
    expect(result.calls).toMatchObject([{ toolName: "get_test_value", input: { value: "protocol-check" } }]);
    expect(result.body()).toMatchObject({ model: "devstral-small-2:24b", options: { num_ctx: 32768, num_predict: 2048 } });
    expect(result.body()).not.toHaveProperty("think");
    expect(result.requests()).toBe(1);
    expect(result.text).toBe("");
    expect(diagnostic.execute).toBeUndefined();
  });
  it("never promotes Devstral textual tool markup into an executable call", async () => {
    const result = await probe("devstral-small-2:24b", { content: markup }, "unsupported");
    expect(result.calls).toEqual([]);
    expect(result.text).toBe(markup);
    expect(result.finish).toBe("stop");
    expect(result.body()).not.toHaveProperty("think");
    expect(result.requests()).toBe(1);
    expect(diagnostic.execute).toBeUndefined();
  });
  it("keeps XML-like assistant text untrusted and does not fabricate a tool call", async () => {
    const result = await probe("qwen3-coder:30b", { content: markup });
    expect(result.text).toBe(markup);
    expect(result.calls).toEqual([]);
    expect(result.finish).toBe("stop");
    expect(diagnostic.execute).toBeUndefined();
    expect(result.requests()).toBe(1);
  });
  it.each(["qwen38-uncensored:latest", "qwen3-coder:30b"])("preserves a structured native call without executing or following up: %s", async model => {
    const result = await probe(model, { content: "", tool_calls: [{ function: { name: "get_test_value", arguments: { value: "protocol-check" } } }] });
    expect(result.calls).toMatchObject([{ toolName: "get_test_value", input: { value: "protocol-check" } }]);
    expect(result.requests()).toBe(1);
    expect(result.body()).toMatchObject({ model, stream: true, think: false, options: { num_ctx: 32768, num_predict: 2048 }, tools: [{ type: "function", function: { name: "get_test_value", parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"] } } }] });
    expect(result.text).toBe("");
    expect(diagnostic.execute).toBeUndefined();
  });
});
