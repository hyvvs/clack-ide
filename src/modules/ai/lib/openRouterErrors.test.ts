import { normalizeAiError } from "@/modules/ai/lib/errors";
import {
  OpenRouterStreamError,
  openRouterStreamErrorFromRaw,
  preserveOpenRouterErrorMetadata,
} from "@/modules/ai/lib/openRouterErrors";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import { describe, expect, it } from "vitest";

describe("openRouterErrorStructure", () => {
  it("preserves the full in-band streaming error envelope", () => {
    const upstream = openRouterStreamErrorFromRaw({
      error: {
        message: "Provider returned error",
        code: 404,
        metadata: {
          raw: JSON.stringify({
            error: {
              message: "No endpoints are available for model stealth/ox-alpha",
              code: "model_not_found",
            },
            request_id: "req_openrouter_stream",
          }),
        },
      },
    });
    if (!upstream) throw new Error("Error envelope was not recognized");
    const normalized = normalizeAiError(upstream, {
      provider: "OpenRouter",
      model: "stealth/ox-alpha",
      endpoint: "https://openrouter.ai/api/v1",
    });

    expect(upstream).toBeInstanceOf(OpenRouterStreamError);
    expect(upstream.message).toBe("Provider returned error");
    expect(normalized.kind).toBe("model_not_found");
    expect(normalized.statusCode).toBe(404);
    expect(normalized.errorCode).toBe("model_not_found");
    expect(normalized.requestId).toBe("req_openrouter_stream");
    expect(normalized.details).toContain("stealth/ox-alpha");
  });

  it("survives the installed AI SDK streaming boundary as an object", async () => {
    const envelope = {
      error: {
        message: "Provider returned error",
        code: 502,
        metadata: {
          raw: JSON.stringify({
            error: {
              message: "Upstream inference service is overloaded",
              code: "provider_overloaded",
            },
            request_id: "req_sdk_stream",
          }),
        },
      },
    };
    const provider = createOpenAICompatible({
      name: "openrouter-test",
      baseURL: "https://openrouter.invalid/api/v1",
      apiKey: "test-key",
      fetch: async () =>
        new Response(`data: ${JSON.stringify(envelope)}\n\ndata: [DONE]\n\n`, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    });
    const model = provider("stealth/ox-alpha");
    const result = streamText({
      model,
      prompt: "test",
      maxRetries: 0,
      includeRawChunks: true,
      experimental_transform: preserveOpenRouterErrorMetadata,
      onError: () => undefined,
    });
    const parts = [];

    for await (const part of result.fullStream) parts.push(part);

    const errorPart = parts.find((part) => part.type === "error");
    expect(errorPart?.type).toBe("error");
    if (errorPart?.type !== "error") throw new Error("Missing error part");
    expect(errorPart.error).toBeInstanceOf(OpenRouterStreamError);
    const normalized = normalizeAiError(errorPart.error, {
      provider: "OpenRouter",
      model: "stealth/ox-alpha",
    });
    expect(normalized.statusCode).toBe(502);
    expect(normalized.errorCode).toBe("provider_overloaded");
    expect(normalized.requestId).toBe("req_sdk_stream");
    expect(normalized.kind).toBe("provider_unavailable");
  });
});
