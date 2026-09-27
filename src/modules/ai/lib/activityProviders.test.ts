import { describe, expect, it } from "vitest";
import {
  streamText,
  readUIMessageStream,
  type LanguageModel,
  type UIMessage,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { activityStream } from "@/modules/ai/lib/activityStream";
import { messageActivity } from "@/modules/ai/lib/activity";

function fetchEvents(events: unknown[]): typeof fetch {
  return async () =>
    new Response(
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
      { headers: { "Content-Type": "text/event-stream" } },
    );
}
async function present(model: LanguageModel, providerId: string) {
  let last: UIMessage | undefined;
  const stream = activityStream(
    [],
    {
      sessionId: "chat",
      runId: "chat:1",
      workspaceId: "workspace",
      providerId,
    },
    undefined,
    async () =>
      streamText({ model, prompt: "Test", maxRetries: 0 }).toUIMessageStream(),
    () => "Invalid provider response",
  );
  for await (const message of readUIMessageStream({
    stream,
    terminateOnError: false,
  }))
    last = message;
  if (!last) throw new Error("Provider fixture returned no message");
  return {
    message: last,
    events: messageActivity(last, "chat", "workspace"),
  };
}
function chatEvents(reasoning?: unknown) {
  return [
    {
      id: "response",
      model: "arbitrary-name",
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            ...(reasoning === undefined
              ? {}
              : { reasoning_content: reasoning, reasoning }),
          },
          finish_reason: null,
        },
      ],
    },
    {
      id: "response",
      choices: [
        { index: 0, delta: { content: "Final answer" }, finish_reason: "stop" },
      ],
    },
  ];
}

describe("installed provider adapter activity contracts (fixture HTTP, no live inference)", () => {
  it("OpenAI Responses summary deltas render as summary, never encrypted content", async () => {
    const events = [
      {
        type: "response.created",
        response: { id: "resp", created_at: 1, model: "arbitrary-name" },
      },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "reasoning",
          id: "reason",
          encrypted_content: "encrypted-private",
        },
      },
      {
        type: "response.reasoning_summary_part.added",
        item_id: "reason",
        summary_index: 0,
      },
      {
        type: "response.reasoning_summary_text.delta",
        item_id: "reason",
        summary_index: 0,
        delta: "A concise summary",
      },
      {
        type: "response.reasoning_summary_part.done",
        item_id: "reason",
        summary_index: 0,
      },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: { type: "reasoning", id: "reason" },
      },
      {
        type: "response.output_item.added",
        output_index: 1,
        item: { type: "message", id: "answer" },
      },
      {
        type: "response.output_text.delta",
        item_id: "answer",
        delta: "Final answer",
      },
      {
        type: "response.output_item.done",
        output_index: 1,
        item: { type: "message", id: "answer" },
      },
      {
        type: "response.completed",
        response: { usage: { input_tokens: 1, output_tokens: 2 } },
      },
    ];
    const result = await present(
      createOpenAI({ apiKey: "fixture", fetch: fetchEvents(events) })(
        "arbitrary-name",
      ),
      "openai",
    );
    expect(
      result.events.some(
        (e) =>
          e.label === "Provider reasoning summary" &&
          e.detail === "A concise summary",
      ),
    ).toBe(true);
    expect(JSON.stringify(result.events)).not.toContain("encrypted-private");
    expect(
      result.message.parts.some(
        (p) => p.type === "text" && p.text === "Final answer",
      ),
    ).toBe(true);
  });
  it("Google thought text is a summary and signatures are not displayed", async () => {
    const result = await present(
      createGoogleGenerativeAI({
        apiKey: "fixture",
        fetch: fetchEvents([
          {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      thought: true,
                      text: "A thought summary",
                      thoughtSignature: "opaque-signature",
                    },
                  ],
                },
              },
            ],
          },
          {
            candidates: [
              {
                content: { role: "model", parts: [{ text: "Final answer" }] },
                finishReason: "STOP",
              },
            ],
          },
        ]),
      })("arbitrary-name"),
      "google",
    );
    expect(
      result.events.some(
        (e) =>
          e.label === "Provider reasoning summary" &&
          e.detail === "A thought summary",
      ),
    ).toBe(true);
    expect(JSON.stringify(result.events)).not.toContain("opaque-signature");
  });
  it("Groq reasoning text is separate provider content", async () => {
    const result = await present(
      createGroq({
        apiKey: "fixture",
        fetch: fetchEvents(chatEvents("Exposed content")),
      })("arbitrary-name"),
      "groq",
    );
    expect(
      result.events.some(
        (e) =>
          e.label === "Provider reasoning content" &&
          e.detail === "Exposed content",
      ),
    ).toBe(true);
  });
  it("compatible servers only display reasoning actually returned, with unspecified format", async () => {
    const result = await present(
      createOpenAICompatible({
        name: "local",
        baseURL: "http://fixture/v1",
        fetch: fetchEvents(chatEvents("Exposed text")),
      })("arbitrary-name"),
      "openai-compatible",
    );
    expect(
      result.events.some(
        (e) =>
          e.label.includes("format unspecified") && e.detail === "Exposed text",
      ),
    ).toBe(true);
  });
  it("no reasoning returned means no reasoning UI, even for a reasoning-named model", async () => {
    const result = await present(
      createOpenAICompatible({
        name: "local",
        baseURL: "http://fixture/v1",
        fetch: fetchEvents(chatEvents()),
      })("reasoning-thinker"),
      "openai-compatible",
    );
    expect(
      result.events.filter(
        (e) => e.kind === "reasoning" || e.kind === "summary",
      ),
    ).toEqual([]);
    expect(result.message.parts.some((p) => p.type === "text")).toBe(true);
  });
  it("malformed compatible reasoning fails safely without fabricated text", async () => {
    const result = await present(
      createOpenAICompatible({
        name: "local",
        baseURL: "http://fixture/v1",
        fetch: fetchEvents(chatEvents({ invented: "not-text" })),
      })("arbitrary-name"),
      "openai-compatible",
    );
    expect(
      result.events.filter(
        (e) => e.kind === "reasoning" || e.kind === "summary",
      ),
    ).toEqual([]);
  });
});
