import type { UIMessage } from "ai";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ContinueRow,
  HardLimitRow,
  ProviderRetryNotice,
  RenderedMessage,
  shouldShowStepContinuation,
} from "./AiChat";
import { AiInputBarConnect } from "./AiInputBar";
import { createRunBudget } from "../lib/runBudget";
import { normalizeAiError, normalizeAiStreamPartError } from "../lib/errors";

const onApproval = () => {};
it("F2 renders preserved output with a structured watchdog explanation", () => {
  const html = renderMessage({
    ...assistantMessage("Accepted answer remains visible"),
    metadata: { clackAnswer: {
      version: 1, runId: "chat:1", state: "incomplete",
      reason: "Stopped repeated output without progress. The partial answer is preserved.",
      watchdog: { version: 1, reason: "repeated_output", observedAt: 3 },
      continuations: 0, repairs: 0,
      segments: [{ id: "first", previous: null, provider: "fixture", model: "model", startedAt: 1, endedAt: 3, finish: "watchdog", inputTokens: 0, outputTokens: 0, pending: [] }],
    } },
  });
  expect(html).toContain("Accepted answer remains visible");
  expect(html).toContain("Output watchdog:");
  expect(html).toContain("Stopped repeated output without progress.");
  expect(html).not.toContain("Incomplete answer:");
});
it("D2 renders adjacent confirmed continuation segments once and exposes incomplete provenance", () => {
  const message: UIMessage = { id: "segmented", role: "assistant", parts: [
    { type: "text", text: "Hello ", providerMetadata: { clackAnswer: { segmentId: "first" } } },
    { type: "text", text: "world", providerMetadata: { clackAnswer: { segmentId: "second" } } },
  ], metadata: { clackAnswer: { version: 1, runId: "chat:1", state: "incomplete", reason: "Continuation limit reached.", continuations: 1, repairs: 0, segments: [
    { id: "first", previous: null, provider: "fixture", model: "model", startedAt: 1, endedAt: 2, finish: "length", inputTokens: 10, outputTokens: 10, pending: [] },
    { id: "second", previous: "first", provider: "fixture", model: "model", startedAt: 3, endedAt: 4, finish: "length", inputTokens: 20, outputTokens: 10, pending: [] },
  ] } } };
  const html = renderMessage(message);
  expect(html).toContain("Hello world"); expect(html.match(/Hello/g)).toHaveLength(1);
  expect(html).toContain("Incomplete answer:"); expect(html).toContain("Continuation limit reached."); expect(html).toContain("Response segments (2)");
});

function renderMessage(message: UIMessage): string {
  return renderToStaticMarkup(
    <RenderedMessage
      sessionId="test-session"
      message={message}
      onApproval={onApproval}
      streaming={false}
    />,
  );
}

function userMessage(text: string): UIMessage {
  return {
    id: "user-message",
    role: "user",
    parts: [{ type: "text", text }],
  };
}

function assistantMessage(text: string): UIMessage {
  return {
    id: "assistant-message",
    role: "assistant",
    parts: [{ type: "text", text }],
  };
}

const groupedReadMessage = {
  id: "grouped-read-message",
  role: "assistant",
  parts: [
    {
      type: "tool-read_file",
      toolCallId: "read-one",
      state: "output-available",
      input: { path: "src/first.ts" },
      output: "first",
    },
    {
      type: "tool-read_file",
      toolCallId: "read-two",
      state: "output-available",
      input: { path: "src/second.ts" },
      output: "second",
    },
  ],
} as unknown as UIMessage;

function toolMessage(part: Record<string, unknown>): UIMessage {
  return {
    id: "tool-message",
    role: "assistant",
    parts: [part],
  } as unknown as UIMessage;
}

describe("RenderedMessage", () => {
  it("renders the user branch that previously returned before message grouping", () => {
    const html = renderMessage(
      userMessage(
        '<selection source="editor">\nconst answer = 42;\n</selection>\nExplain this',
      ),
    );

    expect(html).toContain("Editor selection");
    expect(html).toContain("Explain this");
  });

  it("renders a normal assistant message", () => {
    expect(renderMessage(assistantMessage("A normal response"))).toContain(
      "A normal response",
    );
  });
  it("keeps returned summary collapsible and final text primary in the R1 transcript", () => {
    const html = renderToStaticMarkup(<RenderedMessage sessionId="chat" workspaceId="workspace" activityPresented message={{ id: "m", role: "assistant", parts: [{ type: "reasoning", text: "Private provider body", state: "done" }, { type: "text", text: "Final answer remains visible" }], metadata: { clackActivity: { version: 1, owner: { sessionId: "chat", runId: "chat:1", workspaceId: "workspace" }, receipts: [{ id: "r", at: 1, kind: "part", label: "reasoning-start", part: 0, format: "summary" }], omitted: 0 } } }} onApproval={onApproval} streaming={false} />);
    expect(html).toContain("Provider reasoning summary");
    expect(html).not.toContain("Private provider body");
    expect(html).toContain("Final answer remains visible");
    expect(html).toContain('id="evidence-chat-m"');
  });

  it("renders normalized legacy attachment blocks without internal delimiters", () => {
    const html = renderMessage(
      userMessage(
        '----- CLACK ATTACHMENT -----\n{"name":"notes.md","mediaType":"text/markdown"}\none\ntwo\n----- END CLACK ATTACHMENT -----\nReview it',
      ),
    );
    expect(html).toContain("notes.md");
    expect(html).toContain("2L");
    expect(html).toContain("Review it");
    expect(html).not.toContain("CLACK ATTACHMENT");
  });

  it("renders a persisted attachment reference as a compact transcript card", () => {
    const hash = "c".repeat(64);
    const html = renderMessage({
      id: "attachment-message",
      role: "user",
      parts: [
        { type: "text", text: "Inspect this" },
        {
          type: "data-clack-attachment",
          data: {
            attachmentId: "attachment-1",
            contentId: hash,
            contentHash: hash,
            displayName: "screen.png",
            mediaType: "image/png",
            byteSize: 1024,
            contentKind: "image",
          },
        },
      ],
    } as UIMessage);

    expect(html).toContain("screen.png");
    expect(html).toContain("Ready");
    expect(html).toContain("Vision input");
    expect(html).toContain("Show delivery details for screen.png");
    expect(html).toContain('data-clack-attachment="attachment-1"');
  });

  it("groups consecutive read tool parts", () => {
    const html = renderMessage(groupedReadMessage);

    expect(html).toContain("2 files");
    expect(html).toContain("first.ts");
    expect(html).toContain("second.ts");
  });

  it("renders each message branch in sequence without throwing", () => {
    expect(() => {
      renderMessage(userMessage("User branch"));
      renderMessage(assistantMessage("Assistant branch"));
      renderMessage(groupedReadMessage);
    }).not.toThrow();
  });

  it("renders an error-shaped tool result as a tool failure", () => {
    const html = renderMessage(
      toolMessage({
        type: "tool-read_file",
        toolCallId: "read-failed",
        state: "output-available",
        input: { path: "docs/missing.md" },
        output: { error: "File not found", path: "docs/missing.md" },
      }),
    );

    expect(html).toContain("failed");
    expect(html).toContain("File not found");
    expect(html).not.toContain("Provider error");
  });

  it("renders a denied approval as denied rather than failed", () => {
    const html = renderMessage(
      toolMessage({
        type: "tool-write_file",
        toolCallId: "write-denied",
        state: "output-denied",
        input: { path: "src/protected.ts" },
      }),
    );

    expect(html).toContain('aria-label="denied"');
    expect(html).not.toContain("failed");
    expect(html).not.toContain("Something went wrong");
  });

  it("keeps a failed edit row beside a corrected edit result", () => {
    const failed = normalizeAiStreamPartError({
      name: "AI_InvalidToolInputError",
      toolName: "edit",
      message: "Invalid input for tool edit: Type validation failed",
    });
    const html = renderMessage({
      id: "edit-retry",
      role: "assistant",
      parts: [
        {
          type: "tool-edit",
          toolCallId: "edit-failed",
          state: "output-error",
          input: { path: "src/app.ts" },
          errorText: failed.text,
        },
        {
          type: "tool-edit",
          toolCallId: "edit-corrected",
          state: "output-available",
          input: { path: "src/app.ts" },
          output: { ok: true },
        },
      ],
    } as unknown as UIMessage);

    expect(html).toContain("Tool input did not match the expected schema");
    expect(html).toContain("failed");
    expect(html).toContain('aria-label="done"');
  });
});

describe("provider retry notice", () => {
  it("renders a compact OpenRouter rate-limit state", () => {
    const error = normalizeAiError(
      {
        statusCode: 429,
        message: "Rate limited",
        responseHeaders: { "retry-after": "2" },
      },
      { provider: "OpenRouter", disposition: "retrying" },
    );
    const html = renderToStaticMarkup(
      <ProviderRetryNotice retry={{ error, retryNumber: 1, maxRetries: 2 }} />,
    );

    expect(html).toContain("Rate limited by OpenRouter. Retrying...");
    expect(html).toContain("HTTP 429");
    expect(html).toContain("retry 1/2");
    expect(html).not.toContain("AI run failed");
  });
});

describe("AI provider fallback", () => {
  it("still renders the no-provider connection route", () => {
    const html = renderToStaticMarkup(<AiInputBarConnect onAdd={() => {}} />);

    expect(html).toContain("Connect any AI provider");
    expect(html).toContain("Connect provider");
  });
});

describe("run limit notices", () => {
  it("shows the step gate only for a live, genuinely unfinished tool batch", () => {
    const run = { state: "running" as const, startedAt: 1, budget: { ...createRunBudget("ask"), phase: "soft-limit" as const, lastFinishReason: "tool-calls" } };
    const message = assistantMessage("Tool output has been collected");
    expect(shouldShowStepContinuation(run, message, false)).toBe(true);
    expect(shouldShowStepContinuation(run, message, true)).toBe(false);
    expect(shouldShowStepContinuation({ ...run, state: "completed" }, message, false)).toBe(false);
    expect(shouldShowStepContinuation({ ...run, state: "interrupted" }, message, false)).toBe(false);
    expect(shouldShowStepContinuation({ ...run, state: "failed" }, message, false)).toBe(false);
    expect(shouldShowStepContinuation({ ...run, budget: { ...run.budget, lastFinishReason: "stop" } }, message, false)).toBe(false);
    expect(shouldShowStepContinuation({ ...run, budget: { ...run.budget, lastFinishReason: "length" } }, message, false)).toBe(false);
  });
  it("distinguishes the ordinary soft gate from the hard safety boundary", () => {
    const soft = renderToStaticMarkup(
      <ContinueRow onContinue={() => undefined} />,
    );
    const hardBudget = {
      ...createRunBudget("full-access"),
      totalSteps: 240,
      continuationCount: 9,
      phase: "hard-limit" as const,
      stopReason: "total-steps" as const,
    };
    const hard = renderToStaticMarkup(
      <HardLimitRow budget={hardBudget} onContinue={() => undefined} />,
    );

    expect(soft).toContain("Hit the step limit");
    expect(soft).not.toContain("Autonomous run limit reached");
    expect(hard).toContain("Autonomous run limit reached");
    expect(hard).toContain("240 total steps");
    expect(hard).toContain("Continue anyway");
  });
});
