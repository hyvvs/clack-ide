import { describe, it, expect, vi } from "vitest";
import type { UIMessage, UIMessageChunk } from "ai";
import { captureEffort } from "@/modules/ai/lib/reasoningEffort";
import { resolveModelInputCapabilities } from "@/modules/ai/lib/modelCapabilities";
import {
  createRequestPreflight,
  preflightFetch,
} from "@/modules/ai/lib/requestPreflight";
import { MockLanguageModelV3 } from "ai/test";
import {
  FALLBACK_CATEGORIES,
  effectiveFallback,
  fallbackCompatibility,
  fallbackStream,
  safeFallbackHistory,
  sameDestination,
  type FallbackDestination,
  type FallbackRequest,
} from "@/modules/ai/lib/inferenceFallback";

const destination: FallbackDestination = {
  modelId: "gpt-4.1-mini",
  identity: { providerId: "openai", transportModelId: "gpt-4.1-mini" },
  baseUrl: "https://api.openai.com/v1",
  configurationHash: "a".repeat(64),
};
const messages: UIMessage[] = [
  {
    id: "u",
    role: "user",
    parts: [{ type: "text", text: "PRIVATE_G3_FIXTURE" }],
  },
];
const transient = Object.assign(new Error("Unavailable"), { statusCode: 503 });
function stream(parts: UIMessageChunk[]) {
  return new ReadableStream<UIMessageChunk>({
    start(c) {
      for (const part of parts) c.enqueue(part);
      c.close();
    },
  });
}
async function collect(s: ReadableStream<UIMessageChunk>) {
  const r = s.getReader();
  const parts: UIMessageChunk[] = [];
  while (true) {
    const next = await r.read();
    if (next.done) break;
    parts.push(next.value);
  }
  return parts;
}
function request(): FallbackRequest {
  return {
    primary: destination,
    messages,
    requirements: { tools: ["read_file"], output: 1024 },
    error: transient,
  };
}

describe("G3 stream boundary", () => {
  it("buffers structural/answer metadata and emits exactly one fallback start", async () => {
    const fallback = vi.fn(async () =>
      stream([
        { type: "start", messageId: "fallback" },
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "Recovered" },
        { type: "text-end", id: "t" },
        { type: "finish" },
      ]),
    );
    const output = await collect(
      fallbackStream({
        primary: async () =>
          stream([
            { type: "start", messageId: "primary" },
            {
              type: "message-metadata",
              messageMetadata: {
                clackAnswer: { segments: [{ pending: [], outputTokens: 0 }] },
              },
            },
            { type: "error", errorText: "failed" },
          ]),
        error: () => transient,
        fallback,
        formatError: String,
        eligible: true,
      }),
    );
    expect(fallback).toHaveBeenCalledOnce();
    expect(output.filter((p) => p.type === "start")).toEqual([
      { type: "start", messageId: "fallback" },
    ]);
    expect(output.some((p) => p.type === "error")).toBe(false);
  });
  it.each([
    { type: "text-delta", id: "t", delta: "partial" },
    { type: "reasoning-delta", id: "t", delta: "partial" },
    { type: "tool-input-start", toolCallId: "call", toolName: "write_file" },
    {
      type: "tool-output-available",
      toolCallId: "call",
      output: { effect: "unknown" },
    },
    {
      type: "message-metadata",
      messageMetadata: {
        clackAnswer: { segments: [{ pending: [{}], outputTokens: 0 }] },
      },
    },
    { type: "data-unknown", data: "unclassified" },
  ] as UIMessageChunk[])("does not reroute after $type", async (part) => {
    const fallback = vi.fn();
    const output = await collect(
      fallbackStream({
        primary: async () =>
          stream([part, { type: "error", errorText: "failed" }]),
        error: () => transient,
        fallback,
        formatError: String,
        eligible: true,
      }),
    );
    expect(fallback).not.toHaveBeenCalled();
    expect(output[output.length - 1]?.type).toBe("error");
  });
  it.each([
    401, 403, 400, 404,
  ])("auth/security/client failure %i cannot fallback", async (statusCode) => {
    const fallback = vi.fn();
    await collect(
      fallbackStream({
        primary: async () => {
          throw Object.assign(new Error("Denied"), { statusCode });
        },
        error: () => undefined,
        fallback,
        formatError: String,
        eligible: true,
      }),
    );
    expect(fallback).not.toHaveBeenCalled();
  });
  it("Never/unsafe root and cancellation never invoke the fallback route", async () => {
    for (const cancelled of [false, true]) {
      const signal = new AbortController();
      if (cancelled) signal.abort();
      const fallback = vi.fn();
      await collect(
        fallbackStream({
          primary: async () => {
            throw transient;
          },
          error: () => undefined,
          fallback,
          formatError: String,
          signal: signal.signal,
          eligible: cancelled,
        }),
      );
      expect(fallback).not.toHaveBeenCalled();
    }
  });
  it("failed alternate never invokes a third destination", async () => {
    const fallback = vi.fn(async () =>
      stream([{ type: "error", errorText: "Fallback failed" }]),
    );
    const output = await collect(
      fallbackStream({
        primary: async () => {
          throw transient;
        },
        error: () => undefined,
        fallback,
        formatError: String,
        eligible: true,
      }),
    );
    expect(fallback).toHaveBeenCalledOnce();
    expect(output).toEqual([{ type: "error", errorText: "Fallback failed" }]);
  });
  it("bounded structural prefix overflow disables fallback", async () => {
    const fallback = vi.fn();
    await collect(
      fallbackStream({
        primary: async () =>
          stream([
            ...Array.from({ length: 257 }, () => ({
              type: "start-step" as const,
            })),
            { type: "error", errorText: "failed" },
          ]),
        error: () => transient,
        fallback,
        formatError: String,
        eligible: true,
      }),
    );
    expect(fallback).not.toHaveBeenCalled();
  });
});
describe("G3 identity and compatibility", () => {
  it("actual serialized fallback B1 rejects a payload fitting only the primary", async () => {
    const wire = JSON.stringify({
      model: "target",
      messages: [
        { role: "user", content: `PRIVATE_G3_B1_FIXTURE ${"x".repeat(16000)}` },
      ],
      max_tokens: 512,
      tools: [
        {
          type: "function",
          function: {
            name: "read_file",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
            },
          },
        },
      ],
    });
    const traffic = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("{}"),
    );
    await preflightFetch(
      traffic,
      createRequestPreflight({
        modelId: "primary",
        local: true,
        assertedContext: 32768,
      }),
    )("https://primary.example/v1", { method: "POST", body: wire });
    await expect(
      preflightFetch(
        traffic,
        createRequestPreflight({
          modelId: "target",
          local: true,
          assertedContext: 2048,
        }),
      )("https://target.example/v1", { method: "POST", body: wire }),
    ).rejects.toThrow();
    expect(traffic).toHaveBeenCalledOnce();
    expect(String(traffic.mock.calls[0][0])).toContain("primary.example");
  });
  it("fallback output requirements cannot silently clamp to a smaller target", async () => {
    const calls = vi.fn();
    const model = createRequestPreflight({
      modelId: "target",
      local: true,
      assertedContext: 4096,
      optimization: true,
      requireRequestedOutput: true,
    }).wrap(new MockLanguageModelV3({ doGenerate: calls }));
    if (typeof model === "string" || model.specificationVersion !== "v3")
      throw new Error("Expected V3 target");
    await expect(
      model.doGenerate({ prompt: [], maxOutputTokens: 100000 }),
    ).rejects.toThrow("output allowance");
    expect(calls).not.toHaveBeenCalled();
  });
  it("rollback defaults to Never without changing durable history", () => {
    const stored = {
      version: 1,
      revision: 1,
      mode: "trusted",
      agentId: null,
      workspaceId: null,
      primary: destination,
      destination,
      categories: FALLBACK_CATEGORIES,
      history: [{ kind: "policy", at: 1 }],
    };
    expect(effectiveFallback(stored, false)?.mode).toBe("never");
    expect(stored.mode).toBe("trusted");
    expect(stored.history).toHaveLength(1);
  });
  it("legacy, corrupt and unknown version policy defaults to Never", () => {
    for (const value of [
      undefined,
      null,
      {},
      { version: 2, mode: "trusted" },
      { version: 1, revision: 1, mode: "trusted", history: [] },
    ])
      expect(effectiveFallback(value)).toBeNull();
    expect(
      effectiveFallback({
        version: 1,
        revision: 1,
        mode: "trusted",
        agentId: null,
        workspaceId: null,
        primary: destination,
        destination,
        categories: FALLBACK_CATEGORIES,
        history: [],
      })?.mode,
    ).toBe("trusted");
  });
  it("material endpoint/model/profile changes invalidate identity", () => {
    expect(sameDestination(destination, structuredClone(destination))).toBe(
      true,
    );
    for (const changed of [
      { ...destination, baseUrl: "https://evil.example/v1" },
      { ...destination, modelId: "other" },
      { ...destination, configurationHash: "b".repeat(64) },
      {
        ...destination,
        identity: { ...destination.identity, transportModelId: "other" },
      },
    ])
      expect(sameDestination(destination, changed)).toBe(false);
  });
  it("new user boundary permits historic tools but rejects current partial effects", () => {
    expect(safeFallbackHistory(messages)).toBe(true);
    expect(
      safeFallbackHistory([
        ...messages,
        {
          id: "partial",
          role: "assistant",
          parts: [{ type: "text", text: "partial" }],
        },
      ]),
    ).toBe(false);
    expect(safeFallbackHistory([])).toBe(false);
  });
  it.each([
    "unsupported",
    "unknown",
  ] as const)("mandatory tools block %s target", (tools) => {
    expect(() =>
      fallbackCompatibility(request(), destination, {
        ...resolveModelInputCapabilities(destination.modelId),
        tools,
      }),
    ).toThrow("requirements");
  });
  it("images block a non-vision or unconfirmed target", () => {
    const r = request();
    r.messages = [
      {
        id: "image",
        role: "user",
        parts: [
          {
            type: "file",
            mediaType: "image/png",
            url: "data:image/png;base64,AA==",
          },
        ],
      },
    ];
    for (const image of ["unsupported", "unknown"] as const)
      expect(() =>
        fallbackCompatibility(r, destination, {
          ...resolveModelInputCapabilities(destination.modelId),
          image,
        }),
      ).toThrow();
  });
  it("explicit incompatible effort is not silently stripped", () => {
    const r = request();
    r.reasoning = {
      ...captureEffort(destination.modelId, destination.identity),
      choice: "xhigh",
    };
    expect(() =>
      fallbackCompatibility(
        r,
        destination,
        resolveModelInputCapabilities(destination.modelId),
      ),
    ).toThrow("effort");
    r.reasoning.choice = "automatic";
    expect(
      fallbackCompatibility(
        r,
        destination,
        resolveModelInputCapabilities(destination.modelId),
      ).choice,
    ).toBe("automatic");
  });
});
