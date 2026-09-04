import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  invokeHeaderStop,
  PeerAction,
  shouldShowHeaderStop,
} from "./AiMiniWindow";
import { canAddAiPane } from "../store/aiPaneStore";

describe("AI header Stop", () => {
  it("appears only for an active run", () => {
    expect(shouldShowHeaderStop("running")).toBe(true);
    expect(shouldShowHeaderStop("cancelled")).toBe(false);
    expect(shouldShowHeaderStop("interrupted")).toBe(false);
    expect(shouldShowHeaderStop("completed")).toBe(false);
    expect(shouldShowHeaderStop("failed")).toBe(false);
    expect(shouldShowHeaderStop(undefined)).toBe(false);
  });

  it("uses one cancellation callback", async () => {
    const cancel = vi.fn(async () => {});
    await invokeHeaderStop(cancel);
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("AI pane capacity", () => {
  it("requires usable pane widths and respects the four-pane cap", () => {
    expect(canAddAiPane(640, 1)).toBe(false);
    expect(canAddAiPane(900, 1)).toBe(true);
    expect(canAddAiPane(1440, 3)).toBe(true);
    expect(canAddAiPane(2560, 4)).toBe(false);
  });

  it("checks vertical splits against height instead of width", () => {
    expect(canAddAiPane(500, 1, "row", 900)).toBe(false);
    expect(canAddAiPane(500, 1, "col", 900)).toBe(true);
    expect(canAddAiPane(1400, 1, "col", 400)).toBe(false);
  });
});

describe("AI pane delegation", () => {
  it("keeps Ask another agent discoverable before another chat exists", () => {
    const html = renderToStaticMarkup(<PeerAction sessionId="chat-a" />);

    expect(html).toContain("Ask another agent");
    expect(html).toContain('aria-label="Ask another agent"');
  });
});
