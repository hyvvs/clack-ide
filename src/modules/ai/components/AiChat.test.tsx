import type { UIMessage } from "ai";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RenderedMessage } from "./AiChat";

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
});
