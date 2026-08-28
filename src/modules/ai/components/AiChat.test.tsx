import type { UIMessage } from "ai";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ContinueRow,
  HardLimitRow,
  ProviderRetryNotice,
  RenderedMessage,
} from "./AiChat";
import { AiInputBarConnect } from "./AiInputBar";
import { createRunBudget } from "../lib/runBudget";
import {
  normalizeAiError,
  normalizeAiStreamPartError,
} from "../lib/errors";

const onApproval = () => {};

function renderMessage(message: UIMessage): string {
  return renderToStaticMarkup(
    <RenderedMessage
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
      <ProviderRetryNotice
        retry={{ error, retryNumber: 1, maxRetries: 2 }}
      />,
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
