import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildLanguageModel,
  buildConfiguredLanguageModel,
} from "@/modules/ai/lib/agent";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import type { ProviderId } from "@/modules/ai/config";
import { invoke } from "@tauri-apps/api/core";
import { normalizeAiError } from "@/modules/ai/lib/errors";
import { ContextBudgetError } from "@/modules/ai/lib/contextBudget";
import {
  knownTransportContextLimit,
  modelBudgetLimits,
} from "@/modules/ai/lib/requestPreflight";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage = (_e: unknown) => {};
  },
}));
const bodies: Record<string, unknown>[] = [];
const approvals = new Map<string, (approved: boolean) => void>();
beforeEach(() => {
  bodies.length = 0;
  approvals.clear();
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          error: { message: "fixture", type: "invalid_request_error" },
        }),
        { status: 400 },
      );
    }),
  );
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "ai_http_open") return crypto.randomUUID();
    if (command === "ai_http_preflight") {
      const a = args as { requestId: string; approved: boolean };
      approvals.get(a.requestId)?.(a.approved);
    }
    if (command !== "ai_http_stream") return null;
    const a = args as {
      body: number[];
      requestId: string;
      onEvent: { onmessage: (e: unknown) => void };
    };
    const approved = await new Promise<boolean>((resolve) => {
      approvals.set(a.requestId, resolve);
      a.onEvent.onmessage({ requestId: a.requestId, kind: "preflight" });
    });
    expect(approved).toBe(true);
    bodies.push(JSON.parse(new TextDecoder().decode(Uint8Array.from(a.body))));
    a.onEvent.onmessage({
      requestId: a.requestId,
      kind: "headers",
      status: 400,
      headers: {},
    });
    a.onEvent.onmessage({
      requestId: a.requestId,
      kind: "chunk",
      bytes: [...new TextEncoder().encode('{"error":{"message":"fixture"}}')],
    });
    a.onEvent.onmessage({
      requestId: a.requestId,
      kind: "settled",
      phase: "failed",
      error: { code: "provider-error" },
    });
    return null;
  });
});
afterEach(() => vi.unstubAllGlobals());

async function model(provider: ProviderId, id: string) {
  const built = await buildLanguageModel(
    provider,
    { ...EMPTY_PROVIDER_KEYS, [provider]: "fixture-key" },
    id,
    {
      inferenceScope: {
        sessionId: "fixture",
        runId: crypto.randomUUID(),
        isCurrent: () => true,
      },
      openaiCompatibleBaseURL: "http://localhost:1234/v1",
    },
  );
  if (typeof built === "string" || built.specificationVersion !== "v3")
    throw new Error("Unexpected model");
  return built;
}
describe("real installed adapters serialize shared output/preflight", () => {
  it("provider-qualified exact metadata does not infer capacity from names or another provider", () => {
    expect(
      knownTransportContextLimit("anthropic/claude-sonnet-4.6", "openrouter"),
    ).toBe(1000000);
    expect(knownTransportContextLimit("claude-sonnet-4-6", "anthropic")).toBe(
      200000,
    );
    for (const [id, provider] of [
      ["claude-sonnet-4-6", "openrouter"],
      ["claude-sonnet-4-6", "openai"],
      ["gpt-5.5", "ollama"],
      ["anthropic/claude-sonnet-4.6:free", "openrouter"],
      ["unknown/large-128k", "openrouter"],
    ] as const)
      expect(knownTransportContextLimit(id, provider)).toBeUndefined();
  });
  it("forwards the legacy manual pin in direct and captured model construction", async () => {
    const configuration = {
      openaiCompatibleBaseURL: "http://localhost:1234/v1",
      openaiCompatibleModelId: "private-model",
      openaiCompatibleContextLimit: 8192,
    };
    const direct = await buildConfiguredLanguageModel(
      "openai-compatible-custom",
      EMPTY_PROVIDER_KEYS,
      configuration,
    );
    const captured = await buildConfiguredLanguageModel(
      "openai-compatible-custom",
      EMPTY_PROVIDER_KEYS,
      {
        ...configuration,
        capturedModelIdentity: {
          providerId: "openai-compatible",
          transportModelId: "private-model",
          endpointBaseURL: configuration.openaiCompatibleBaseURL,
        },
      },
    );
    expect(await modelBudgetLimits(direct)).toMatchObject({ asserted: 8192 });
    expect(await modelBudgetLimits(captured)).toMatchObject({ asserted: 8192 });
    const unknown = await buildConfiguredLanguageModel(
      "ollama-local",
      EMPTY_PROVIDER_KEYS,
      { ollamaModelId: "gpt-5.5" },
    );
    expect(await modelBudgetLimits(unknown)).not.toHaveProperty(
      "reported",
      1050000,
    );
  });
  it("uses Anthropic's installed API output cap and measures the final capped request", async () => {
    const built = await model("anthropic", "claude-sonnet-4-6");
    await Promise.resolve(
      built.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        maxOutputTokens: 1000000,
      }),
    ).catch(() => undefined);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].max_tokens).toBe(128000);
  });
  it("does not promote old generic display defaults to model evidence", () => {
    expect(knownTransportContextLimit("openrouter-custom")).toBeUndefined();
    expect(knownTransportContextLimit("ollama-local")).toBeUndefined();
    expect(knownTransportContextLimit("claude-sonnet-4-6")).toBe(200000);
  });
  it.each([
    ["openrouter", "openai/gpt-oss-20b", "max_tokens"],
    ["anthropic", "claude-sonnet-4-6", "max_tokens"],
    ["openai", "gpt-4.1-mini", "max_output_tokens"],
    ["openai-compatible", "custom", "max_tokens"],
    ["ollama", "local", "options"],
    ["lmstudio", "local", "max_tokens"],
    ["mlx", "local", "max_tokens"],
    ["google", "gemini-2.5-flash", "generationConfig"],
    ["xai", "grok-4-fast-reasoning", "max_completion_tokens"],
    ["groq", "llama-3.3-70b-versatile", "max_tokens"],
    ["cerebras", "gpt-oss-120b", "max_tokens"],
    ["deepseek", "deepseek-reasoner", "max_tokens"],
    ["mistral", "mistral-large-latest", "max_tokens"],
  ] as const)("%s maps exactly one response limit", async (provider, id, key) => {
    const built = await model(provider, id);
    await Promise.resolve(
      built.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        maxOutputTokens: 123,
      }),
    ).catch(() => undefined);
    expect(bodies).toHaveLength(1);
    expect(
      key === "generationConfig"
        ? (bodies[0][key] as { maxOutputTokens: number }).maxOutputTokens
        : key === "options" ? (bodies[0][key] as { num_predict: number }).num_predict
        : bodies[0][key],
    ).toBe(123);
    expect(
      [
        "max_tokens",
        "max_output_tokens",
        "max_completion_tokens",
        "generationConfig",
        "options",
      ].filter((field) => bodies[0][field] !== undefined),
    ).toHaveLength(1);
  });
  it.each([
    "openrouter",
    "ollama",
  ] as const)("%s sends zero oversized requests, one fitting request, independently", async (provider) => {
    const built = await model(provider, "unknown-model");
    await expect(
      built.doGenerate({
        prompt: [
          {
            role: "user",
            content: [{ type: "text", text: "x".repeat(100000) }],
          },
        ],
      }),
    ).rejects.toThrow("exceeds");
    expect(bodies).toHaveLength(0);
    expect(
      vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === "ai_http_open"),
    ).toBe(false);
    await Promise.resolve(
      built.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      }),
    ).catch(() => undefined);
    expect(bodies).toHaveLength(1);
  });
  it("normalizes budget refusal as a nonretryable structured error without prompt content", () => {
    expect(
      normalizeAiError(
        new ContextBudgetError("context-overflow", "Budget exceeded"),
      ),
    ).toMatchObject({
      errorCode: "context-overflow",
      retryable: false,
      kind: "bad_request",
      title: "Context preflight",
    });
  });
  it("preserves structured provider overflow without automatic shrink/retry", () => {
    expect(
      normalizeAiError({
        statusCode: 400,
        code: "context_length_exceeded",
        message: "Maximum context length exceeded",
        isRetryable: true,
      }),
    ).toMatchObject({
      errorCode: "context_length_exceeded",
      retryable: false,
      title: "Provider context limit",
    });
  });
});
