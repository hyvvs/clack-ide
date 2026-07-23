import {
  COMMIT_MESSAGE_EDITOR_MAX_HEIGHT,
  COMMIT_MESSAGE_EDITOR_MIN_HEIGHT,
  getCommitMessageEditorMetrics,
  resizeCommitMessageEditor,
} from "@/modules/source-control/commitMessageSizing";
import { describe, expect, it } from "vitest";

function createEditor(value: string, contentHeight: () => number) {
  return {
    value,
    selectionStart: value.length,
    selectionEnd: value.length,
    scrollTop: 0,
    get scrollHeight() {
      return contentHeight();
    },
    style: {
      height: "",
      maxHeight: "",
      overflowY: "",
    },
  };
}

describe("commit message editor sizing", () => {
  it("keeps a short message compact", () => {
    expect(getCommitMessageEditorMetrics(40, 600)).toEqual({
      height: COMMIT_MESSAGE_EDITOR_MIN_HEIGHT,
      maxHeight: 216,
      overflowY: "hidden",
    });
  });

  it("grows with multi-line content before reaching the cap", () => {
    expect(getCommitMessageEditorMetrics(156, 600)).toEqual({
      height: 156,
      maxHeight: 216,
      overflowY: "hidden",
    });
  });

  it("caps growth to the responsive panel allowance and scrolls internally", () => {
    expect(getCommitMessageEditorMetrics(480, 500)).toEqual({
      height: 180,
      maxHeight: 180,
      overflowY: "auto",
    });
  });

  it("never grows beyond the absolute maximum", () => {
    expect(getCommitMessageEditorMetrics(600, 1200)).toEqual({
      height: COMMIT_MESSAGE_EDITOR_MAX_HEIGHT,
      maxHeight: COMMIT_MESSAGE_EDITOR_MAX_HEIGHT,
      overflowY: "auto",
    });
  });

  it("shrinks to the compact height after the message is cleared", () => {
    let contentHeight = 480;
    const editor = createEditor("subject\n\nbody", () => contentHeight);

    resizeCommitMessageEditor(editor, 600);
    expect(editor.style.height).toBe("216px");
    expect(editor.style.overflowY).toBe("auto");

    contentHeight = 32;
    resizeCommitMessageEditor(editor, 600);
    expect(editor.style.height).toBe(`${COMMIT_MESSAGE_EDITOR_MIN_HEIGHT}px`);
    expect(editor.style.overflowY).toBe("hidden");
  });

  it("does not alter long or unbroken commit-message content", () => {
    const message = `subject\n\n${"https://example.com/".repeat(80)}`;
    const editor = createEditor(message, () => 800);

    resizeCommitMessageEditor(editor, 600);

    expect(editor.value).toBe(message);
    expect(editor.scrollTop).toBe(800);
  });
});
