export type WorkspaceInputMode = "shell" | "ai";

export function resolveWorkspaceInputPresentation(input: {
  isBlockTab: boolean;
  hasComposer: boolean;
  mode: WorkspaceInputMode;
  keysLoaded: boolean;
  panelOpen: boolean;
}): {
  showToggle: boolean;
  effectiveMode: WorkspaceInputMode;
  mounted: boolean;
  open: boolean;
} {
  return {
    showToggle: input.isBlockTab && input.hasComposer,
    effectiveMode: !input.isBlockTab
      ? "ai"
      : input.hasComposer
        ? input.mode
        : "shell",
    mounted: input.keysLoaded || input.isBlockTab,
    open: input.isBlockTab || (input.keysLoaded && input.panelOpen),
  };
}
