export type MarkdownContext = {
  selectedText: string;
  linkUrl: string | null;
  imageUrl: string | null;
};

export type MarkdownActionCapabilities = {
  canReveal: boolean;
  canAskAi: boolean;
  canAttach: boolean;
};

export function openableMarkdownLink(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol)
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

export function markdownContextActions(
  context: MarkdownContext,
  capabilities: MarkdownActionCapabilities,
) {
  const hasSelection = context.selectedText.trim().length > 0;
  return {
    copySelection: hasSelection,
    copyLink: context.linkUrl !== null,
    openLink: openableMarkdownLink(context.linkUrl) !== null,
    copyImageUrl: context.imageUrl !== null,
    copyFilePath: true,
    revealInExplorer: capabilities.canReveal,
    askAiSelection: capabilities.canAskAi && hasSelection,
    attachFileToAgent: capabilities.canAttach,
  };
}
