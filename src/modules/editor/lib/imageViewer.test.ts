import { describe, expect, it } from "vitest";
import { CLACK_Z_INDEX, CLACK_Z_INDEX_CEILING } from "@/lib/layers";
import {
  IMAGE_VIEWER_CANVAS_CLASS,
  IMAGE_VIEWER_CANVAS_STYLE,
  IMAGE_VIEWER_CONTENT_Z_INDEX,
  IMAGE_VIEWER_IMAGE_STYLE,
  IMAGE_VIEWER_PANEL_CLASS,
  IMAGE_VIEWER_PANEL_STYLE,
  imageViewerFileName,
  imageViewerMenuActions,
} from "./imageViewer";

describe("image viewer surface styles", () => {
  it("keeps the file viewer panel opaque", () => {
    expect(IMAGE_VIEWER_PANEL_CLASS).toContain("clack-file-content-surface");
    expect(IMAGE_VIEWER_PANEL_CLASS).not.toContain("opacity-");
    expect(IMAGE_VIEWER_PANEL_STYLE.opacity).toBeUndefined();
    expect(IMAGE_VIEWER_PANEL_STYLE.position).toBe("relative");
    expect(IMAGE_VIEWER_PANEL_STYLE.zIndex).toBe(
      IMAGE_VIEWER_CONTENT_Z_INDEX,
    );
    expect(IMAGE_VIEWER_CONTENT_Z_INDEX).toBe(CLACK_Z_INDEX.fileContent);
    expect(IMAGE_VIEWER_CONTENT_Z_INDEX).toBeLessThan(
      CLACK_Z_INDEX.floatingUi,
    );
    expect(IMAGE_VIEWER_CONTENT_Z_INDEX).toBeLessThan(
      CLACK_Z_INDEX_CEILING,
    );
    expect(IMAGE_VIEWER_PANEL_STYLE.backgroundColor).toBeTruthy();
    expect(IMAGE_VIEWER_PANEL_STYLE.backgroundClip).toBe("padding-box");
    expect(IMAGE_VIEWER_PANEL_STYLE.mixBlendMode).toBe("normal");
  });

  it("uses a checkerboard canvas for transparent image content", () => {
    expect(IMAGE_VIEWER_CANVAS_CLASS).toContain(
      "clack-image-transparency-canvas",
    );
    expect(IMAGE_VIEWER_CANVAS_CLASS).not.toContain("opacity-");
    expect(String(IMAGE_VIEWER_CANVAS_STYLE.backgroundImage)).toContain(
      "conic-gradient",
    );
    expect(IMAGE_VIEWER_CANVAS_STYLE.opacity).toBeUndefined();
    expect(IMAGE_VIEWER_CANVAS_STYLE.backgroundClip).toBe("padding-box");
    expect(IMAGE_VIEWER_CANVAS_STYLE.mixBlendMode).toBe("normal");
  });

  it("forces the image element itself to render at full opacity", () => {
    expect(IMAGE_VIEWER_IMAGE_STYLE.opacity).toBe(1);
    expect(IMAGE_VIEWER_IMAGE_STYLE.mixBlendMode).toBe("normal");
    expect(IMAGE_VIEWER_IMAGE_STYLE.filter).toBe("none");
    expect(IMAGE_VIEWER_IMAGE_STYLE.backdropFilter).toBe("none");
  });

  it("extracts image names from Windows and POSIX paths", () => {
    expect(imageViewerFileName("C:\\Users\\Hayden\\Pictures\\cover.png")).toBe(
      "cover.png",
    );
    expect(imageViewerFileName("/home/hayden/Pictures/cover.png")).toBe(
      "cover.png",
    );
  });

  it("exposes only real direct image menu actions", () => {
    expect(
      imageViewerMenuActions({
        canRevealInExplorer: true,
        canRevealInSystemFileExplorer: true,
        canOpenExternally: true,
        canAttachFileToAgent: true,
        canCloseTab: true,
      }),
    ).toEqual({
      copyFilePath: true,
      copyFileName: true,
      revealInExplorer: true,
      revealInSystemFileExplorer: true,
      openExternally: true,
      attachFileToAgent: true,
      closeTab: true,
      askAiAboutImage: false,
      openAsWorkspace: false,
    });

    expect(
      imageViewerMenuActions({
        canRevealInExplorer: false,
        canRevealInSystemFileExplorer: false,
        canOpenExternally: false,
        canAttachFileToAgent: false,
        canCloseTab: false,
      }),
    ).toMatchObject({
      revealInExplorer: false,
      revealInSystemFileExplorer: false,
      openExternally: false,
      attachFileToAgent: false,
      closeTab: false,
    });
  });
});
