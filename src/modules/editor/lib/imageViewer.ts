import { CLACK_Z_INDEX } from "@/lib/layers";
import type { CSSProperties } from "react";

export const IMAGE_VIEWER_CONTENT_Z_INDEX = CLACK_Z_INDEX.fileContent;

export type ImageViewerMenuCapabilities = {
  canRevealInExplorer: boolean;
  canRevealInSystemFileExplorer: boolean;
  canOpenExternally: boolean;
  canAttachFileToAgent: boolean;
  canCloseTab: boolean;
};

export function imageViewerFileName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function imageViewerMenuActions({
  canRevealInExplorer,
  canRevealInSystemFileExplorer,
  canOpenExternally,
  canAttachFileToAgent,
  canCloseTab,
}: ImageViewerMenuCapabilities) {
  return {
    copyFilePath: true,
    copyFileName: true,
    revealInExplorer: canRevealInExplorer,
    revealInSystemFileExplorer: canRevealInSystemFileExplorer,
    openExternally: canOpenExternally,
    attachFileToAgent: canAttachFileToAgent,
    closeTab: canCloseTab,
    askAiAboutImage: false,
    openAsWorkspace: false,
  };
}

export const IMAGE_VIEWER_PANEL_CLASS =
  "clack-file-content-surface flex h-full min-h-0 flex-col items-center justify-center overflow-auto p-4";

export const IMAGE_VIEWER_CANVAS_CLASS =
  "clack-image-transparency-canvas flex max-h-full max-w-full items-center justify-center overflow-hidden rounded-md border border-border p-2 shadow-sm";

export const IMAGE_VIEWER_PANEL_STYLE: CSSProperties = {
  position: "relative",
  zIndex: IMAGE_VIEWER_CONTENT_Z_INDEX,
  backgroundColor: "#0b1020",
  backgroundClip: "padding-box",
  isolation: "isolate",
  mixBlendMode: "normal",
  filter: "none",
  backdropFilter: "none",
};

export const IMAGE_VIEWER_CANVAS_STYLE: CSSProperties = {
  position: "relative",
  backgroundColor: "#0f172a",
  backgroundImage:
    "conic-gradient(#cbd5e1 0.25turn, #f8fafc 0.25turn 0.5turn, #cbd5e1 0.5turn 0.75turn, #f8fafc 0.75turn)",
  backgroundSize: "20px 20px",
  backgroundClip: "padding-box",
  isolation: "isolate",
  mixBlendMode: "normal",
  filter: "none",
  backdropFilter: "none",
};

export const IMAGE_VIEWER_IMAGE_STYLE: CSSProperties = {
  opacity: 1,
  mixBlendMode: "normal",
  filter: "none",
  backdropFilter: "none",
};
