import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AI_CHAT_TOOLTIP,
  AiChatButton,
} from "./AiChatButton";

describe("AiChatButton", () => {
  it("exposes a clear label, shortcut, and closed state", () => {
    const html = renderToStaticMarkup(
      <AiChatButton open={false} onOpen={() => {}} />,
    );

    expect(AI_CHAT_TOOLTIP).toContain("Open AI Chat");
    expect(AI_CHAT_TOOLTIP).toContain("Ctrl+I");
    expect(html).toContain(`aria-label="${AI_CHAT_TOOLTIP}"`);
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('data-state="closed"');
    expect(html).toContain("AI Chat");
  });

  it("reflects the visible transcript state", () => {
    const html = renderToStaticMarkup(
      <AiChatButton open={true} onOpen={() => {}} />,
    );

    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-state="open"');
  });
});
