import { describe, expect, it } from "vitest";
import { markdownContextActions, openableMarkdownLink } from "./contextActions";

describe("Markdown context actions", () => {
  it("enables selection actions only for real selected text", () => {
    const actions = markdownContextActions(
      { selectedText: "selected", linkUrl: null, imageUrl: null },
      { canReveal: true, canAskAi: true, canAttach: true },
    );
    expect(actions.copySelection).toBe(true);
    expect(actions.askAiSelection).toBe(true);
    expect(actions.copyLink).toBe(false);
    expect(actions.copyImageUrl).toBe(false);
  });

  it("exposes link and image actions only for the clicked target", () => {
    const actions = markdownContextActions(
      {
        selectedText: "",
        linkUrl: "https://clack.dev/docs",
        imageUrl: "https://clack.dev/logo.png",
      },
      { canReveal: false, canAskAi: true, canAttach: false },
    );
    expect(actions.copyLink).toBe(true);
    expect(actions.openLink).toBe(true);
    expect(actions.copyImageUrl).toBe(true);
    expect(actions.askAiSelection).toBe(false);
    expect(actions.revealInExplorer).toBe(false);
  });

  it("opens only external URL schemes handled by the opener plugin", () => {
    expect(openableMarkdownLink("https://clack.dev")).toBe(
      "https://clack.dev/",
    );
    expect(openableMarkdownLink("mailto:hello@clack.dev")).toBe(
      "mailto:hello@clack.dev",
    );
    expect(openableMarkdownLink("./local.md")).toBeNull();
    expect(openableMarkdownLink("javascript:alert(1)")).toBeNull();
  });
});
