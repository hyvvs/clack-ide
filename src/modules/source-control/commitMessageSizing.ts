export const COMMIT_MESSAGE_EDITOR_MIN_HEIGHT = 72;
export const COMMIT_MESSAGE_EDITOR_MAX_HEIGHT = 224;
export const COMMIT_MESSAGE_EDITOR_PANEL_RATIO = 0.36;

export type CommitMessageEditorMetrics = {
  height: number;
  maxHeight: number;
  overflowY: "auto" | "hidden";
};

type CommitMessageEditorElement = {
  readonly scrollHeight: number;
  readonly value: string;
  readonly selectionEnd?: number | null;
  readonly selectionStart?: number | null;
  scrollTop?: number;
  style: Pick<CSSStyleDeclaration, "height" | "maxHeight" | "overflowY">;
};

export function getCommitMessageEditorMetrics(
  contentHeight: number,
  panelHeight: number,
): CommitMessageEditorMetrics {
  const responsiveMax =
    panelHeight > 0
      ? Math.floor(panelHeight * COMMIT_MESSAGE_EDITOR_PANEL_RATIO)
      : COMMIT_MESSAGE_EDITOR_MAX_HEIGHT;
  const maxHeight = Math.max(
    COMMIT_MESSAGE_EDITOR_MIN_HEIGHT,
    Math.min(COMMIT_MESSAGE_EDITOR_MAX_HEIGHT, responsiveMax),
  );
  const height = Math.min(
    maxHeight,
    Math.max(COMMIT_MESSAGE_EDITOR_MIN_HEIGHT, Math.ceil(contentHeight)),
  );

  return {
    height,
    maxHeight,
    overflowY: contentHeight > maxHeight ? "auto" : "hidden",
  };
}

export function resizeCommitMessageEditor(
  editor: CommitMessageEditorElement,
  panelHeight: number,
): CommitMessageEditorMetrics {
  editor.style.height = "auto";
  const metrics = getCommitMessageEditorMetrics(
    editor.scrollHeight,
    panelHeight,
  );
  editor.style.height = `${metrics.height}px`;
  editor.style.maxHeight = `${metrics.maxHeight}px`;
  editor.style.overflowY = metrics.overflowY;
  if (
    metrics.overflowY === "auto" &&
    editor.selectionStart === editor.value.length &&
    editor.selectionEnd === editor.value.length
  ) {
    editor.scrollTop = editor.scrollHeight;
  }
  return metrics;
}
