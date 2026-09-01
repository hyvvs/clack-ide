import { describe, expect, it } from "vitest";
import {
  COMPOSER_TEXTAREA_MAX_HEIGHT_PX,
  COMPOSER_TEXTAREA_MIN_HEIGHT_PX,
  resizeComposerTextarea,
} from "./composerTextareaSizing";

function textareaStub({
  value = "",
  height = "",
  scrollHeight = 22,
  onMeasure,
}: {
  value?: string;
  height?: string;
  scrollHeight?: number;
  onMeasure?: (height: string) => void;
} = {}): HTMLTextAreaElement {
  const style = { height, overflowY: "" } as CSSStyleDeclaration;
  return {
    value,
    style,
    get scrollHeight() {
      onMeasure?.(style.height);
      return scrollHeight;
    },
  } as HTMLTextAreaElement;
}

describe("composer textarea sizing", () => {
  it("resets an empty composer that retained a stale expanded height", () => {
    const textarea = textareaStub({
      height: `${COMPOSER_TEXTAREA_MAX_HEIGHT_PX}px`,
    });

    resizeComposerTextarea(textarea, "");

    expect(textarea.style.height).toBe(
      `${COMPOSER_TEXTAREA_MIN_HEIGHT_PX}px`,
    );
    expect(textarea.style.overflowY).toBe("hidden");
  });

  it("measures content from a collapsed baseline", () => {
    let measuredFromHeight = "";
    const textarea = textareaStub({
      value: "two\nlines",
      height: `${COMPOSER_TEXTAREA_MAX_HEIGHT_PX}px`,
      scrollHeight: 48,
      onMeasure: (height) => {
        measuredFromHeight = height;
      },
    });

    resizeComposerTextarea(textarea, textarea.value);

    expect(measuredFromHeight).toBe("0px");
    expect(textarea.style.height).toBe("48px");
    expect(textarea.style.overflowY).toBe("hidden");
  });

  it("caps long content and enables internal scrolling", () => {
    const textarea = textareaStub({
      value: "long draft",
      scrollHeight: 400,
    });

    resizeComposerTextarea(textarea, textarea.value);

    expect(textarea.style.height).toBe(
      `${COMPOSER_TEXTAREA_MAX_HEIGHT_PX}px`,
    );
    expect(textarea.style.overflowY).toBe("auto");
  });

  it("does not resize a textarea whose DOM value has changed", () => {
    const textarea = textareaStub({ value: "new value", height: "71px" });

    resizeComposerTextarea(textarea, "stale value");

    expect(textarea.style.height).toBe("71px");
  });
});
