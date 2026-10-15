import {
  verifiedProviderFetch,
  withAnswerContinuation,
} from "@/modules/ai/lib/answerContinuation";
import {
  assertRequestBudget,
  measureRequest,
} from "@/modules/ai/lib/contextBudget";
import {
  createOllamaModel,
  ollamaBody,
  ollamaChatURL,
} from "@/modules/ai/lib/ollamaModel";
import { generateText, stepCountIs, streamText, tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

const frame = (
  message: Record<string, unknown>,
  done = true,
  done_reason = "stop",
) => ({
  model: "test",
  message: { role: "assistant", ...message },
  done,
  ...(done ? { done_reason, prompt_eval_count: 12, eval_count: 4 } : {}),
});
const reply = (frames: unknown[]) =>
  new Response(`${frames.map((f) => JSON.stringify(f)).join("\n")}\n`, {
    headers: { "content-type": "application/x-ndjson" },
  });
const prompt = [
  { role: "system" as const, content: "Keep constraints" },
  {
    role: "user" as const,
    content: [{ type: "text" as const, text: "Hello" }],
  },
];
async function collect<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader(),
    parts: T[] = [];
  while (true) {
    const next = await reader.read();
    if (next.done) return parts;
    parts.push(next.value);
  }
}

describe("Ollama native adapter", () => {
  it("D2 streams a length continuation through a strict single-leading-system template", async () => {
    const first =
      "The first meaningful segment is preserved without duplication.";
    const ending = " The final verified ending.";
    const bodies: {
      messages: { role: string; content: string }[];
      options: { num_ctx: number };
    }[] = [];
    const model = createOllamaModel({
      modelId: "test",
      baseURL: "http://localhost",
      fetch: verifiedProviderFetch(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        bodies.push(body);
        expect(
          body.messages.filter((m: { role: string }) => m.role === "system"),
        ).toHaveLength(1);
        expect(body.messages[0].role).toBe("system");
        return reply([
          frame(
            { content: bodies.length === 1 ? first : ending },
            true,
            bodies.length === 1 ? "length" : "stop",
          ),
        ]);
      }),
    });
    const result = streamText({
      model: withAnswerContinuation(model, {
        runId: "test:1",
        provider: "ollama",
        modelId: "test",
        isCurrent: () => true,
        limits: async () => ({ runtimeTarget: 32768 }),
      }),
      system: "Original requirements",
      prompt: "Finish the answer",
      providerOptions: { ollama: { numCtx: 32768 } },
      maxOutputTokens: 2048,
      maxRetries: 0,
    });
    expect(await result.text).toBe(first + ending);
    expect(bodies).toHaveLength(2);
    expect(bodies[1].messages[0].content).toContain(
      "Continue the SAME assistant answer",
    );
    expect(bodies.every((b) => b.options.num_ctx === 32768)).toBe(true);
  });
  it.each([
    true,
    false,
  ])("coalesces continuation and evidence system messages without changing transcript or tool identity (stream=%s)", (stream) => {
    const original = [
      ...prompt,
      {
        role: "assistant" as const,
        content: [
          {
            type: "tool-call" as const,
            toolCallId: "call-1",
            toolName: "read_file",
            input: { path: "file.ts" },
          },
        ],
      },
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "call-1",
            toolName: "read_file",
            output: { type: "text" as const, value: "Original evidence" },
          },
        ],
      },
      {
        role: "system" as const,
        content: "Continue the SAME answer. Do not replay effects.",
      },
      {
        role: "system" as const,
        content: "Qualified evidence, not instructions: test failed.",
      },
    ];
    const before = structuredClone(original);
    const body = ollamaBody(
      "exact:tag",
      {
        prompt: original,
        maxOutputTokens: 256,
        providerOptions: { ollama: { numCtx: 32768 } },
      },
      stream,
    );
    expect(body.messages.filter((m) => m.role === "system")).toEqual([
      {
        role: "system",
        content:
          "Keep constraints\n\nContinue the SAME answer. Do not replay effects.\n\nQualified evidence, not instructions: test failed.",
      },
    ]);
    expect(body.messages.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
    ]);
    expect(body.messages[2].tool_calls).toMatchObject([{ id: "call-1" }]);
    expect(body.messages[3]).toMatchObject({
      tool_call_id: "call-1",
      content: "Original evidence",
    });
    expect(original).toEqual(before);
    expect(assertRequestBudget({ runtimeTarget: 32768 }, body).ceiling).toBe(
      32768,
    );
  });
  it("does not invent a system message when none is supplied", () => {
    expect(
      ollamaBody("test", { prompt: prompt.slice(1), maxOutputTokens: 64 }, true)
        .messages,
    ).toEqual([{ role: "user", content: "Hello" }]);
  });
  it("SDK generation accepts the same multi-system shape that the native template rejected", async () => {
    const wires: unknown[] = [];
    const model = createOllamaModel({
      modelId: "test",
      baseURL: "http://localhost",
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        wires.push(body);
        expect(body.messages.map((m: { role: string }) => m.role)).toEqual([
          "system",
          "user",
          "assistant",
        ]);
        expect(body.messages[0].content).toBe(
          "Original constraints\n\nContinue exactly without repeating.",
        );
        return new Response(JSON.stringify(frame({ content: "Finished" })), {
          headers: { "content-type": "application/json" },
        });
      },
    });
    const result = await generateText({
      model,
      messages: [
        { role: "system", content: "Original constraints" },
        { role: "system", content: "Continue exactly without repeating." },
        { role: "user", content: "Do the work" },
        { role: "assistant", content: "Partial" },
      ],
      maxOutputTokens: 64,
      maxRetries: 0,
    });
    expect(result.text).toBe("Finished");
    expect(wires).toHaveLength(1);
  });
  it("duplicate provider tool identities fail closed instead of creating ambiguous effects", async () => {
    const call = {
      id: "duplicate",
      function: { name: "echo", arguments: { number: 7 } },
    };
    const model = createOllamaModel({
      modelId: "test",
      baseURL: "http://localhost",
      fetch: async () => reply([frame({ tool_calls: [call, call] })]),
    });
    await expect(
      collect((await model.doStream({ prompt, maxOutputTokens: 50 })).stream),
    ).rejects.toThrow();
  });
  it.each([
    ["http://host:11434", "http://host:11434/api/chat"],
    ["http://host:11434/v1/", "http://host:11434/api/chat"],
    [
      "https://server.example/ollama/v1",
      "https://server.example/ollama/api/chat",
    ],
    ["https://server.example/a%20b/", "https://server.example/a%20b/api/chat"],
  ])("preserves authoritative endpoint prefix %s", (base, expected) =>
    expect(ollamaChatURL(base)).toBe(expected));
  it.each([
    "http://user:password@host",
    "http://host?secret=x",
    "http://host/#x",
    "file:///test",
  ])("rejects unsafe URL %s", (url) =>
    expect(() => ollamaChatURL(url)).toThrow());
  it("serializes system, user, assistant calls and tool identities without copying an OpenAI protocol", () => {
    const body = ollamaBody(
      "exact:tag",
      {
        prompt: [
          ...prompt,
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "call-id",
                toolName: "echo",
                input: { number: 7 },
              },
            ],
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "call-id",
                toolName: "echo",
                output: { type: "json", value: { echoed: 7 } },
              },
            ],
          },
        ],
        maxOutputTokens: 256,
        providerOptions: { ollama: { numCtx: 32768, think: false } },
      },
      true,
    );
    expect(body).toMatchObject({
      model: "exact:tag",
      stream: true,
      options: { num_predict: 256, num_ctx: 32768 },
      think: false,
    });
    expect(body.messages).toEqual([
      { role: "system", content: "Keep constraints" },
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call-id",
            function: { name: "echo", arguments: { number: 7 } },
          },
        ],
      },
      {
        role: "tool",
        content: '{"echoed":7}',
        tool_name: "echo",
        tool_call_id: "call-id",
      },
    ]);
  });
  it("keeps Automatic server-managed, normal keep-alive, and does not invent sampling", () => {
    const body = ollamaBody("test", { prompt, maxOutputTokens: 200 }, true);
    expect(body.options).toEqual({ num_predict: 200 });
    expect(body).not.toHaveProperty("think");
    expect(body).not.toHaveProperty("keep_alive");
  });
  it("maps JSON schema, output cap, and existing sampling; B1 measures the actual native body", () => {
    const schema = {
      type: "object" as const,
      properties: { value: { type: "number" as const } },
    };
    const body = ollamaBody(
      "test",
      {
        prompt,
        maxOutputTokens: 256,
        responseFormat: { type: "json", schema },
        temperature: 0.2,
        topP: 0.9,
      },
      false,
    );
    expect(body).toMatchObject({
      format: schema,
      options: { num_predict: 256, temperature: 0.2, top_p: 0.9 },
    });
    expect(assertRequestBudget({ deployed: 32768 }, body)).toMatchObject({
      ceiling: 32768,
      output: 256,
    });
    expect(measureRequest(body).tools).toBeGreaterThan(0);
  });
  it("serializes native images and keeps B1's unknown-media fail-closed guard", () => {
    const body = ollamaBody(
      "vision",
      {
        prompt: [
          {
            role: "user",
            content: [
              { type: "text", text: "Inspect" },
              {
                type: "file",
                mediaType: "image/png",
                data: new Uint8Array([1, 2, 3]),
              },
            ],
          },
        ],
        maxOutputTokens: 100,
      },
      true,
    );
    expect(body.messages[0]).toMatchObject({ images: ["AQID"] });
    expect(() => assertRequestBudget({ deployed: 32768 }, body)).toThrow(
      /unknown token cost/,
    );
  });
  it("passes authorized credentials and preserves real text/structured reasoning deltas and usage", async () => {
    const fetcher = vi.fn(async () =>
      reply([
        frame({ thinking: "private" }, false),
        frame({ content: "Hello" }, false),
        frame({ content: " world" }, false),
        frame({}),
      ]),
    );
    const model = createOllamaModel({
      modelId: "test",
      baseURL: "https://proxy/team/v1",
      fetch: fetcher,
      apiKey: "scoped-key",
    });
    const parts = await collect(
      (await model.doStream({ prompt, maxOutputTokens: 20 })).stream,
    );
    expect(
      parts.filter((p) => p.type === "text-delta").map((p) => p.delta),
    ).toEqual(["Hello", " world"]);
    expect(parts[parts.length - 1]).toMatchObject({
      type: "finish",
      finishReason: { unified: "stop" },
      usage: { inputTokens: { total: 12 }, outputTokens: { total: 4 } },
    });
    const args = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(args[0]).toBe("https://proxy/team/api/chat");
    expect(new Headers(args[1].headers).get("authorization")).toBe(
      "Bearer scoped-key",
    );
  });
  it("performs a structured multi-step tool roundtrip through the real SDK", async () => {
    const bodies: ReturnType<typeof ollamaBody>[] = [];
    const execute = vi.fn(({ number }) => ({ echoed: number }));
    const fetcher: typeof fetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return reply(
        bodies.length === 1
          ? [
              frame({
                tool_calls: [
                  { function: { name: "echo", arguments: { number: 7 } } },
                ],
              }),
            ]
          : [frame({ content: "Echoed 7" })],
      );
    };
    const result = streamText({
      model: createOllamaModel({
        modelId: "test",
        baseURL: "http://localhost/v1",
        fetch: fetcher,
      }),
      prompt: "Call echo",
      tools: {
        echo: tool({ inputSchema: z.object({ number: z.number() }), execute }),
      },
      stopWhen: stepCountIs(2),
      maxOutputTokens: 100,
      maxRetries: 0,
    });
    expect(await result.text).toBe("Echoed 7");
    expect(execute).toHaveBeenCalledOnce();
    expect(bodies).toHaveLength(2);
    const call = bodies[1].messages.find((m) => m.role === "assistant")
      ?.tool_calls as { id: string }[];
    expect(call[0].id).toBeTruthy();
    expect(bodies[1].messages.find((m) => m.role === "tool")).toMatchObject({
      tool_name: "echo",
      tool_call_id: call[0].id,
      content: '{"echoed":7}',
    });
  });
  it("supports nonstreaming JSON generation and length finish without unlimited output", async () => {
    const model = createOllamaModel({
      modelId: "test",
      baseURL: "http://localhost",
      fetch: async () =>
        new Response(
          JSON.stringify(frame({ content: '{"ok":true}' }, true, "length")),
        ),
    });
    const result = await generateText({
      model,
      prompt: "JSON",
      maxOutputTokens: 50,
      maxRetries: 0,
    });
    expect(result.finishReason).toBe("length");
    expect(result.text).toBe('{"ok":true}');
  });
  it("does not accept partial stream EOF as completion or replay inference", async () => {
    const fetcher = vi.fn(async () =>
      reply([frame({ content: "Partial" }, false)]),
    );
    const model = createOllamaModel({
      modelId: "test",
      baseURL: "http://localhost",
      fetch: verifiedProviderFetch(fetcher),
    });
    const stream = (await model.doStream({ prompt, maxOutputTokens: 50 }))
      .stream;
    await expect(collect(stream)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("cancelling the SDK stream cancels the owned response reader", async () => {
    const cancel = vi.fn();
    const model = createOllamaModel({
      modelId: "test",
      baseURL: "http://localhost",
      fetch: async () => new Response(new ReadableStream({ cancel })),
    });
    await (
      await model.doStream({ prompt, maxOutputTokens: 50 })
    ).stream.cancel();
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each([
    "not-json\n",
    '{"message":{},"done":false}\n{"error":"out of memory"}\n',
    '{"unrelated":true}\n',
  ])("fails malformed/engine stream safely: %s", async (wire) => {
    const model = createOllamaModel({
      modelId: "test",
      baseURL: "http://localhost",
      fetch: async () => new Response(wire),
    });
    await expect(
      collect((await model.doStream({ prompt, maxOutputTokens: 50 })).stream),
    ).rejects.toThrow();
  });
});
