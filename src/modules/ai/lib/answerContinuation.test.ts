import { describe, expect, it, vi } from "vitest";
import {
  streamText,
  tool,
  jsonSchema,
  readUIMessageStream,
  stepCountIs,
  type UIMessage,
} from "ai";
import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
  LanguageModelV3CallOptions,
} from "@ai-sdk/provider";
import {
  ANSWER_LIMITS,
  answerMetadataStream,
  answerParts,
  normalizeAnswerFinish,
  readAnswer,
  recoverAnswerMessages,
  stitchAnswer,
  verifiedProviderFetch,
  withAnswerContinuation,
  type AnswerState,
} from "@/modules/ai/lib/answerContinuation";
import { z } from "zod";

const usage = {
  inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};
const finish = (raw = "stop", unified = raw): LanguageModelV3StreamPart => ({
  type: "finish",
  finishReason: { unified: unified as "stop", raw: raw || undefined },
  usage,
});
const text = (
  value = "A meaningful first answer segment.",
): LanguageModelV3StreamPart[] => [
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: value },
  { type: "text-end", id: "t" },
];
function fixture(parts: LanguageModelV3StreamPart[][]) {
  const doStream = vi.fn(async (_params: LanguageModelV3CallOptions) => ({
    stream: new ReadableStream<LanguageModelV3StreamPart>({
      start(c) {
        for (const p of parts.shift() ?? []) c.enqueue(p);
        c.close();
      },
    }),
  }));
  const model: LanguageModelV3 = {
    specificationVersion: "v3",
    provider: "fixture",
    modelId: "model",
    supportedUrls: {},
    doStream,
    doGenerate: vi.fn(),
  };
  const states: AnswerState[] = [];
  const charge = vi.fn(async () => {});
  return {
    model,
    doStream,
    states,
    charge,
    options: {
      runId: "chat:1",
      provider: "fixture",
      modelId: "model",
      isCurrent: () => true,
      limits: async () => ({ asserted: 32768 }),
      onState: (s: AnswerState) => states.push(s),
      charge,
    },
  };
}
async function collect(
  f: ReturnType<typeof fixture>,
  extra: Partial<Parameters<typeof withAnswerContinuation>[1]> = {},
) {
  const wrapped = withAnswerContinuation(f.model, {
    ...f.options,
    ...extra,
  }) as LanguageModelV3;
  const result = await wrapped.doStream({
    prompt: [
      { role: "user", content: [{ type: "text", text: "Write the answer" }] },
    ],
    tools: [
      { type: "function", name: "edit", inputSchema: { type: "object" } },
    ],
  });
  const output: LanguageModelV3StreamPart[] = [];
  for await (const chunk of result.stream as unknown as AsyncIterable<LanguageModelV3StreamPart>)
    output.push(chunk);
  return output;
}
describe("confirmed finish reasons and bounded continuation", () => {
  it("the continuation deadline settles stalled preparation without another request", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture([[...text(), finish("length")]]);
      const pending = collect(f, {
        validate: () => new Promise<void>(() => {}),
      });
      await vi.advanceTimersByTimeAsync(ANSWER_LIMITS.milliseconds + 1);
      await pending;
      expect(f.doStream).toHaveBeenCalledOnce();
      expect(f.charge).not.toHaveBeenCalled();
      expect(f.states[f.states.length - 1]).toMatchObject({
        state: "incomplete",
        continuationTimeMs: ANSWER_LIMITS.milliseconds,
      });
    } finally {
      vi.useRealTimers();
    }
  });
  it("reasoning output consumes the total reserve even when reported usage undercounts", async () => {
    const f = fixture([
      [
        { type: "reasoning-delta", id: "r", delta: "x".repeat(70_000) },
        ...text(),
        finish("length"),
      ],
    ]);
    await collect(f);
    expect(f.doStream).toHaveBeenCalledOnce();
    expect(f.charge).not.toHaveBeenCalled();
    expect(
      f.states[f.states.length - 1].segments[0].budgetTokens,
    ).toBeGreaterThan(ANSWER_LIMITS.tokens);
  });
  it("oversized reasoning stops without creating another request", async () => {
    const f = fixture([
      [
        {
          type: "reasoning-delta",
          id: "r",
          delta: "x".repeat(ANSWER_LIMITS.characters + 1),
        },
        finish("length"),
      ],
    ]);
    const out = await collect(f);
    expect(f.doStream).toHaveBeenCalledOnce();
    expect(out.some((p) => p.type === "reasoning-delta")).toBe(false);
    expect(f.states[f.states.length - 1]).toMatchObject({
      state: "incomplete",
      reason: "Answer content limit reached.",
    });
  });
  it("captured provider options, effort and exposed schemas remain unchanged", async () => {
    const f = fixture([
      [...text(), finish("length")],
      [...text(" The rest."), finish()],
    ]);
    const model = withAnswerContinuation(f.model, f.options) as LanguageModelV3;
    const options: LanguageModelV3CallOptions = {
      prompt: [{ role: "user", content: [{ type: "text", text: "Write" }] }],
      tools: [
        {
          type: "function",
          name: "edit",
          description: "Edit",
          inputSchema: { type: "object" },
        },
      ],
      providerOptions: { openai: { reasoningEffort: "high" } },
    };
    const out = await model.doStream(options);
    for await (const _p of out.stream as unknown as AsyncIterable<LanguageModelV3StreamPart>) {
      /* Drain the captured run. */
    }
    expect(f.doStream.mock.calls[1][0].tools).toBe(options.tools);
    expect(f.doStream.mock.calls[1][0].providerOptions).toBe(
      options.providerOptions,
    );
  });
  it("resuming the same visible answer preserves caps and provenance", async () => {
    const first = fixture([
      [...text(), finish("length")],
      [...text(" The rest."), finish()],
    ]);
    await collect(first);
    const previous = {
      ...first.states[first.states.length - 1],
      continuations: 3,
      continuationTimeMs: 120000,
    };
    const next = fixture([[...text(), finish("length")]]);
    await collect(next, { previous });
    expect(next.doStream).toHaveBeenCalledOnce();
    expect(next.charge).not.toHaveBeenCalled();
    expect(next.states[next.states.length - 1].segments).toHaveLength(3);
    expect(first.states[first.states.length - 1].segments).toHaveLength(2);
  });
  it("cancellation settles never-ending preparation without waiting for its callback", async () => {
    const abort = new AbortController();
    const f = fixture([[...text(), finish("length")]]);
    const validate = vi.fn(() => {
      abort.abort();
      return new Promise<void>(() => {});
    });
    await collect(f, { signal: abort.signal, validate });
    expect(f.doStream).toHaveBeenCalledOnce();
    expect(f.charge).not.toHaveBeenCalled();
  });
  it("continuation output is capped by the remaining total token reserve", async () => {
    const first = finish("length") as Extract<
      LanguageModelV3StreamPart,
      { type: "finish" }
    >;
    first.usage = {
      ...usage,
      outputTokens: { total: 16000, text: 16000, reasoning: 0 },
    };
    const f = fixture([
      [...text(), first],
      [...text(" The end."), finish()],
    ]);
    await collect(f);
    expect(f.doStream.mock.calls[1][0].maxOutputTokens).toBe(384);
  });
  it.each([
    ["stop", "stop"],
    ["length", "length"],
    ["tool_calls", "tool-calls"],
    ["max_tokens", "length"],
    ["MAX_TOKENS", "length"],
    ["end_turn", "stop"],
    ["SAFETY", "content-filter"],
    ["nonstandard", "other"],
    ["", "length"],
  ])("normalizes %s without guessing", (raw, unified) => {
    expect(normalizeAnswerFinish({ raw, unified })).toBe(
      !raw || unified === "other"
        ? "unknown"
        : unified === "content-filter"
          ? "policy"
          : unified,
    );
  });
  it.each([
    "stop",
    "tool-calls",
    "content-filter",
    "error",
    "other",
    "",
  ])("never continues %s", async (reason) => {
    const f = fixture([[...text("ends in a comma, ```"), finish(reason)]]);
    await collect(f);
    expect(f.doStream).toHaveBeenCalledOnce();
    expect(f.charge).not.toHaveBeenCalled();
  });
  it("continues length with internal instructions and accounts usage exactly once", async () => {
    const f = fixture([
      [...text(), finish("length")],
      [...text(" And the rest."), finish()],
    ]);
    const output = await collect(f);
    expect(f.doStream).toHaveBeenCalledTimes(2);
    expect(f.charge).toHaveBeenCalledOnce();
    expect(f.doStream.mock.calls[1][0].prompt.map((p) => p.role)).toEqual([
      "system",
      "user",
      "assistant",
    ]);
    expect(output.filter((p) => p.type === "finish")).toEqual([
      {
        ...finish(),
        usage: {
          inputTokens: { total: 40, noCache: 40, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 20, text: 20, reasoning: 0 },
        },
      },
    ]);
    expect(f.states[f.states.length - 1]).toMatchObject({
      state: "complete",
      continuations: 1,
      segments: [{ finish: "length" }, { finish: "stop" }],
    });
  });
  it("caps repeated length stops at three, preserving completed segments", async () => {
    const f = fixture(
      Array.from({ length: 5 }, (_, i) => [...text(`A meaningful new answer segment with progress ${i}.`), finish("length")]),
    );
    await collect(f);
    expect(f.doStream).toHaveBeenCalledTimes(4);
    expect(f.states[f.states.length - 1]).toMatchObject({
      state: "incomplete",
      continuations: 3,
      reason: "Answer continuation limit reached.",
    });
  });
  it("profile opt-out and tiny output prevent continuation storms", async () => {
    const f = fixture([[...text("x"), finish("length")]]);
    await collect(f);
    expect(f.charge).not.toHaveBeenCalled();
    const disabled = fixture([[...text(), finish("length")]]);
    await collect(disabled, { maxContinuations: 0 });
    expect(disabled.charge).not.toHaveBeenCalled();
  });
  it("B1 refusal preserves the first segment and does not send or charge", async () => {
    const f = fixture([[...text("x".repeat(1000)), finish("length")]]);
    await collect(f, { limits: async () => ({ asserted: 128 }) });
    expect(f.doStream).toHaveBeenCalledOnce();
    expect(f.charge).not.toHaveBeenCalled();
    expect(f.states[f.states.length - 1]).toMatchObject({
      state: "incomplete",
      reason: "Continuation stopped at the context limit.",
    });
  });
  it("shared run budget cannot be reset by length", async () => {
    const f = fixture([[...text(), finish("length")]]);
    await collect(f, { remaining: () => 1 });
    expect(f.charge).not.toHaveBeenCalled();
  });
  it("missing finish and error never masquerade as length", async () => {
    for (const end of [
      [],
      [
        {
          type: "error",
          error: new Error("Disconnected"),
        } as LanguageModelV3StreamPart,
        finish("length"),
      ],
    ]) {
      const f = fixture([[...text(), ...end]]);
      await collect(f);
      expect(f.doStream).toHaveBeenCalledOnce();
    }
  });
  it("cancellation in continuation preparation wins before send", async () => {
    const abort = new AbortController();
    const f = fixture([[...text(), finish("length")]]);
    await collect(f, {
      signal: abort.signal,
      validate: async () => abort.abort(),
    });
    expect(f.doStream).toHaveBeenCalledOnce();
    expect(f.charge).not.toHaveBeenCalled();
  });
  it("stale async preparation cannot mutate a newer run", async () => {
    let current = true;
    const f = fixture([[...text(), finish("length")]]);
    await collect(f, {
      isCurrent: () => current,
      validate: async () => {
        current = false;
      },
    });
    expect(f.doStream).toHaveBeenCalledOnce();
    expect(f.states[f.states.length - 1].state).toBe("preparing");
  });
});
const call = (input: string, id = "call"): LanguageModelV3StreamPart => ({
  type: "tool-call",
  toolCallId: id,
  toolName: "edit",
  input,
});
describe("quarantined tool calls and bounded repair", () => {
  it("completed current-run IDs cannot replay after an SDK step compacts away their prompt evidence", async () => {
    const f = fixture([
      [call("{}"), finish("tool_calls", "tool-calls")],
      [...text(), finish("length")],
      [call("{}"), finish("tool_calls", "tool-calls")],
    ]);
    const execute = vi.fn(async () => "Immutable completed result");
    const result = streamText({
      model: withAnswerContinuation(f.model, f.options),
      prompt: "Edit",
      tools: { edit: tool({ inputSchema: z.object({}), execute }) },
      stopWhen: stepCountIs(2),
      prepareStep: async ({ stepNumber }) =>
        stepNumber
          ? {
              messages: [
                {
                  role: "user",
                  content: "Continue using the compacted working context.",
                },
              ],
            }
          : {},
    });
    const chunks = [];
    for await (const p of result.fullStream) chunks.push(p);
    expect(execute).toHaveBeenCalledOnce();
    expect(chunks.filter((p) => p.type === "tool-call")).toHaveLength(1);
    expect(f.doStream).toHaveBeenCalledTimes(3);
  });
  it("syntactically complete repair still passes the actual SDK schema gate before approval", async () => {
    const f = fixture([
      [call('{"path":'), finish("length")],
      [call('{"path":123}'), finish("tool_calls", "tool-calls")],
    ]);
    const approval = vi.fn(() => true),
      execute = vi.fn();
    const result = streamText({
      model: withAnswerContinuation(f.model, f.options),
      prompt: "Edit",
      tools: {
        edit: tool({
          inputSchema: z.object({ path: z.string() }),
          needsApproval: approval,
          execute,
        }),
      },
    });
    const chunks = [];
    for await (const p of result.fullStream) chunks.push(p);
    expect(approval).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(chunks.some((p) => p.type === "tool-error")).toBe(true);
  });
  it("a streamed call missing input-end never executes even with complete JSON and normal finish", async () => {
    const f = fixture([
      [
        { type: "tool-input-start", id: "call", toolName: "edit" },
        { type: "tool-input-delta", id: "call", delta: "{}" },
        call("{}"),
        finish("tool_calls", "tool-calls"),
      ],
    ]);
    expect((await collect(f)).some((p) => p.type === "tool-call")).toBe(false);
  });
  it("an unexposed tool cannot be repaired or gain another paid request", async () => {
    const f = fixture([
      [
        {
          ...call('{"path":'),
          toolName: "hidden",
        } as LanguageModelV3StreamPart,
        finish("length"),
      ],
    ]);
    expect((await collect(f)).some((p) => p.type === "tool-call")).toBe(false);
    expect(f.doStream).toHaveBeenCalledOnce();
  });
  it("tool-result then length then a repeated completed ID is not executed twice by the actual SDK", async () => {
    const f = fixture([
      [call("{}"), finish("tool_calls", "tool-calls")],
      [...text(), finish("length")],
      [call("{}"), finish("tool_calls", "tool-calls")],
    ]);
    const execute = vi.fn(async () => "Immutable completed result");
    const result = streamText({
      model: withAnswerContinuation(f.model, f.options),
      prompt: "Edit",
      tools: {
        edit: tool({
          inputSchema: jsonSchema({ type: "object", properties: {} }),
          execute,
        }),
      },
      stopWhen: stepCountIs(3),
    });
    const chunks = [];
    for await (const chunk of result.fullStream) chunks.push(chunk);
    expect(execute).toHaveBeenCalledOnce();
    expect(chunks.filter((p) => p.type === "tool-result")).toMatchObject([
      { output: "Immutable completed result" },
    ]);
    expect(chunks.filter((p) => p.type === "tool-call")).toHaveLength(1);
    expect(f.doStream).toHaveBeenCalledTimes(3);
  });
  it("repair prose/JSON is preserved diagnostically, never stitched into the answer", async () => {
    const f = fixture([
      [...text(), call('{"path":'), finish("length")],
      [...text('{"path":"a"}'), finish()],
    ]);
    const out = await collect(f);
    expect(out.filter((p) => p.type === "text-delta")).toHaveLength(1);
    expect(f.states[f.states.length - 1].segments[1].repairOutput).toBe(
      '{"path":"a"}',
    );
    expect(out.some((p) => p.type === "tool-call")).toBe(false);
  });
  it("an already executed ID remains protected after history compaction", async () => {
    const f = fixture([[call("{}"), finish("tool_calls", "tool-calls")]]);
    expect(
      (await collect(f, { knownToolIds: ["call"] })).some(
        (p) => p.type === "tool-call",
      ),
    ).toBe(false);
  });
  it("streamed input without a completed call is not released", async () => {
    const f = fixture([
      [
        { type: "tool-input-start", id: "call", toolName: "edit" },
        { type: "tool-input-delta", id: "call", delta: "{}" },
        finish("tool_calls", "tool-calls"),
      ],
    ]);
    expect((await collect(f)).some((p) => p.type.startsWith("tool-"))).toBe(
      false,
    );
    expect(f.states[f.states.length - 1].segments[0].pending).toEqual([
      { id: "call", name: "edit", input: "{}" },
    ]);
  });
  it.each([
    "stop",
    "other",
    "",
    "error",
  ])("partial JSON never reaches execution after %s", async (reason) => {
    const f = fixture([[call('{"path":'), finish(reason)]]);
    const out = await collect(f);
    expect(out.some((p) => p.type === "tool-call")).toBe(false);
    expect(f.doStream).toHaveBeenCalledOnce();
  });
  it("missing terminator cannot execute even valid JSON", async () => {
    const f = fixture([[call('{"path":"a"}')]]);
    expect((await collect(f)).some((p) => p.type === "tool-call")).toBe(false);
  });
  it("length repair preserves ID/prefix and still uses normal SDK approval/schema validation", async () => {
    const f = fixture([
      [call('{"path":'), finish("length")],
      [call('{"path":"a"}'), finish("tool_calls", "tool-calls")],
    ]);
    const execute = vi.fn();
    const approval = vi.fn(() => true);
    const result = streamText({
      model: withAnswerContinuation(f.model, f.options),
      prompt: "Edit",
      tools: {
        edit: tool({
          inputSchema: jsonSchema({
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false,
          }),
          needsApproval: approval,
          execute,
        }),
      },
    });
    const chunks = [];
    for await (const p of result.fullStream) chunks.push(p);
    expect(approval).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
    expect(chunks.filter((p) => p.type === "tool-call")).toMatchObject([
      { toolCallId: "call", input: { path: "a" } },
    ]);
    expect(chunks.some((p) => p.type === "tool-approval-request")).toBe(true);
    expect(f.states[f.states.length - 1].repairs).toBe(1);
  });
  it.each([
    call('{"path":"b"}', "changed-id"),
    call('{"other":true}'),
    call('{"path":'),
  ])("mismatched repair is never released", async (repaired) => {
    const f = fixture([
      [call('{"path":'), finish("length")],
      [repaired, finish("tool_calls", "tool-calls")],
    ]);
    expect((await collect(f)).some((p) => p.type === "tool-call")).toBe(false);
  });
  it("completed source tool IDs cannot replay", async () => {
    const f = fixture([
      [call('{"path":"a"}'), finish("tool_calls", "tool-calls")],
    ]);
    const wrapped = withAnswerContinuation(
      f.model,
      f.options,
    ) as LanguageModelV3;
    const out = await wrapped.doStream({
      prompt: [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call",
              toolName: "edit",
              input: { path: "a" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call",
              toolName: "edit",
              output: { type: "text", value: "Done" },
            },
          ],
        },
      ],
    });
    const parts = [];
    for await (const p of out.stream as unknown as AsyncIterable<LanguageModelV3StreamPart>)
      parts.push(p);
    expect(parts.some((p) => p.type === "tool-call")).toBe(false);
  });
  it("duplicate emission within one segment is rejected", async () => {
    const f = fixture([
      [call("{}"), call("{}"), finish("tool_calls", "tool-calls")],
    ]);
    expect((await collect(f)).some((p) => p.type === "tool-call")).toBe(false);
  });
  it("text then length then a tool preserves boundaries", async () => {
    const f = fixture([
      [...text(), finish("length")],
      [
        ...text("Now checking."),
        call("{}"),
        finish("tool_calls", "tool-calls"),
      ],
    ]);
    const out = await collect(f);
    expect(out.filter((p) => p.type === "text-delta")).toHaveLength(2);
    expect(out.findIndex((p) => p.type === "tool-call")).toBeGreaterThan(
      out.map((p) => p.type).lastIndexOf("text-end"),
    );
  });
});
describe("stitching and restart reconstruction", () => {
  it("unsupported/corrupt provenance is isolated and never changes raw parts", () => {
    const message: UIMessage = {
      id: "m",
      role: "assistant",
      parts: [{ type: "text", text: "Original" }],
      metadata: { clackAnswer: { version: 2 } },
    };
    expect(readAnswer(message)).toBeNull();
    expect(answerParts(message)).toBe(message.parts);
    expect(recoverAnswerMessages([message])[0]).toBe(message);
  });
  it.each([
    ["Hello ", "world"],
    ["```ts\nconst x = ", "1;\n```"],
    ["`inline", " code`"],
    ['{"value":', '"data"}'],
    ["- first\n- ", "second"],
    ["caf", "\u00e9"],
    ["a\ud83d", "\ude80"],
    ["e", "\u0301"],
    ["repeat repeat", "repeat repeat"],
  ])("preserves exact boundary %s", (a, b) =>
    expect(stitchAnswer(a, b)).toBe(a + b));
  it("only conservative exact prose overlap is elided", () => {
    const boundary = "This sufficiently long and unique prose boundary.";
    expect(stitchAnswer(`Start. ${boundary}`, `${boundary} End.`)).toBe(
      `Start. ${boundary} End.`,
    );
  });
  it("persisted raw segments render once without changing the transcript or tool boundaries", async () => {
    const f = fixture([
      [...text("```ts\nconst x = compute("), finish("length")],
      [...text("1);\n```"), finish()],
    ]);
    await collect(f);
    const state = f.states[f.states.length - 1];
    const message: UIMessage = {
      id: "m",
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "```ts\nconst x = compute(",
          providerMetadata: {
            clackAnswer: { segmentId: state.segments[0].id },
          },
        },
        {
          type: "text",
          text: "1);\n```",
          providerMetadata: {
            clackAnswer: { segmentId: state.segments[1].id },
          },
        },
      ],
      metadata: { clackAnswer: state },
    };
    const original = JSON.stringify(message);
    const restored = JSON.parse(original) as UIMessage;
    expect(answerParts(restored)).toMatchObject([
      { type: "text", text: "```ts\nconst x = compute(1);\n```" },
    ]);
    expect(JSON.stringify(message)).toBe(original);
    expect(recoverAnswerMessages([restored])[0]).toEqual(restored);
    restored.parts.splice(1, 0, { type: "step-start" });
    expect(answerParts(restored)).toHaveLength(3);
  });
  it("unfinished restart is idempotent and never sends or replays", async () => {
    const f = fixture([[...text(), finish("length")]]);
    await collect(f, { maxContinuations: 0 });
    const state = { ...f.states[f.states.length - 1], state: "preparing" };
    const message: UIMessage = {
      id: "m",
      role: "assistant",
      parts: text()
        .filter((p) => p.type === "text-delta")
        .map((p) => ({ type: "text", text: (p as { delta: string }).delta })),
      metadata: { clackAnswer: state },
    };
    const recovered = recoverAnswerMessages([message]);
    expect(readAnswer(recovered[0])?.state).toBe("incomplete");
    expect(recoverAnswerMessages(recovered)).toEqual(recovered);
    expect(f.doStream).toHaveBeenCalledOnce();
  });
});
describe("protocol completion receipts", () => {
  it("terminal marker strings in model text or comments cannot forge completion", async () => {
    for (const payload of [
      'data: {"text":"data: [DONE]"}\n\n',
      ": data: [DONE]\n\n",
    ]) {
      const fetcher = vi.fn(
        async () =>
          new Response(payload, {
            headers: { "content-type": "text/event-stream" },
          }),
      );
      await expect(
        (
          await verifiedProviderFetch(fetcher)(
            "https://fixture/chat/completions",
          )
        ).text(),
      ).rejects.toThrow(/interrupted/i);
    }
  });
  it.each([
    ["chat/completions", "data: [DONE]\n\n"],
    ["messages", 'event: message_stop\ndata: {"type": "message_stop"}\n\n'],
    ["responses", 'data: {"type": "response.completed"}\n\n'],
  ])("validates %s split terminal markers", async (path, end) => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              const bytes = new TextEncoder().encode(end);
              c.enqueue(bytes.slice(0, 10));
              c.enqueue(bytes.slice(10));
              c.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    const response = await verifiedProviderFetch(fetcher)(
      `https://fixture/v1/${path}`,
    );
    expect(await response.text()).toBe(end);
  });
  it("missing DONE is interrupted even with a length finish field", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('data: {"choices":[{"finish_reason":"length"}]}\n\n', {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    await expect(
      (
        await verifiedProviderFetch(fetcher)("https://fixture/chat/completions")
      ).text(),
    ).rejects.toThrow(/interrupted/i);
  });
});
it("the actual SDK UI stream retains raw parts and reconstructs one coherent answer", async () => {
  const f = fixture([
    [...text("Hello, this is a long first part "), finish("length")],
    [...text("and its continuation."), finish()],
  ]);
  const stream = answerMetadataStream(async (onState) =>
    streamText({
      model: withAnswerContinuation(f.model, { ...f.options, onState }),
      prompt: "Write",
    }).toUIMessageStream(),
  );
  let final: UIMessage | undefined;
  for await (const message of readUIMessageStream({
    stream,
    terminateOnError: true,
  }))
    final = message;
  if (!final) throw new Error("The SDK did not produce a UI message.");
  expect(readAnswer(final)?.state).toBe("complete");
  expect(final.parts.filter((p) => p.type === "text")).toHaveLength(2);
  expect(answerParts(final).filter((p) => p.type === "text")).toMatchObject([
    { text: "Hello, this is a long first part and its continuation." },
  ]);
});
it("segment metadata is delivered during idle continuation preparation, not only at final finish", async () => {
  const state: AnswerState = {
    version: 1,
    runId: "run",
    state: "preparing",
    continuations: 1,
    repairs: 0,
    segments: [],
  };
  let publish: (state: AnswerState) => void = () => {};
  let close = () => {};
  const stream = answerMetadataStream(async (onState) => {
    publish = onState;
    return new ReadableStream({
      start(c) {
        c.enqueue({ type: "start", messageId: "answer" });
        close = () => c.close();
      },
    });
  });
  const reader = stream.getReader();
  expect((await reader.read()).value?.type).toBe("start");
  publish(state);
  expect((await reader.read()).value).toEqual({
    type: "message-metadata",
    messageMetadata: { clackAnswer: state },
  });
  close();
  expect((await reader.read()).done).toBe(true);
});
