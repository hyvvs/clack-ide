export const COMPOSER_TEXTAREA_MIN_HEIGHT_PX = 22;
export const COMPOSER_TEXTAREA_MAX_HEIGHT_PX = 160;

export function resizeComposerTextarea(
  textarea: HTMLTextAreaElement | null,
  expectedValue: string,
): void {
  if (!textarea || textarea.value !== expectedValue) return;

  textarea.style.height = "0px";
  const measuredHeight =
    expectedValue.length === 0
      ? COMPOSER_TEXTAREA_MIN_HEIGHT_PX
      : textarea.scrollHeight;
  const height = Math.max(
    COMPOSER_TEXTAREA_MIN_HEIGHT_PX,
    Math.min(measuredHeight, COMPOSER_TEXTAREA_MAX_HEIGHT_PX),
  );

  textarea.style.height = `${height}px`;
  textarea.style.overflowY =
    measuredHeight > COMPOSER_TEXTAREA_MAX_HEIGHT_PX ? "auto" : "hidden";
}
