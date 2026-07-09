import { describe, expect, it, vi } from "vitest";
import type { FileStat } from "@/modules/ai/lib/native";
import type { WorkspaceEnv } from "@/modules/workspace";
import {
  nativeContainingFolderPath,
  nativeImageFilePath,
  openImageExternally,
  revealImageInSystemFileExplorer,
  type ImageFileActionDeps,
} from "./imageFileActions";

const localWorkspace: WorkspaceEnv = { kind: "local" };
const wslWorkspace: WorkspaceEnv = { kind: "wsl", distro: "Ubuntu-24.04" };
const fileStat: FileStat = { kind: "file", size: 10, mtime: 1 };

function deps(overrides: Partial<ImageFileActionDeps> = {}) {
  return {
    stat: vi.fn(async () => fileStat),
    revealPathInSystemFileExplorer: vi.fn(async () => ({
      fallbackUsed: false,
    })),
    openPathExternally: vi.fn(async () => undefined),
    workspace: vi.fn(() => localWorkspace),
    isWindows: true,
    ...overrides,
  };
}

describe("image file actions", () => {
  it("normalizes local Windows paths for native opener calls", () => {
    expect(
      nativeImageFilePath("C:/Users/Hayden/Pictures/cover.png", localWorkspace, true),
    ).toBe("C:\\Users\\Hayden\\Pictures\\cover.png");
  });

  it("preserves native Linux paths", () => {
    expect(
      nativeImageFilePath("/home/hayden/Pictures/cover.png", localWorkspace, false),
    ).toBe("/home/hayden/Pictures/cover.png");
  });

  it("preserves native macOS paths", () => {
    expect(
      nativeImageFilePath("/Users/hayden/Pictures/cover.png", localWorkspace, false),
    ).toBe("/Users/hayden/Pictures/cover.png");
  });

  it("does not convert WSL-style slash paths when not running on Windows", () => {
    expect(nativeImageFilePath("/home/hayden/cover.png", wslWorkspace, false)).toBe(
      "/home/hayden/cover.png",
    );
  });

  it("normalizes WSL paths to UNC paths on Windows", () => {
    expect(nativeImageFilePath("/home/hayden/cover.png", wslWorkspace, true)).toBe(
      "\\\\wsl.localhost\\Ubuntu-24.04\\home\\hayden\\cover.png",
    );
  });

  it("maps WSL mounted drive paths to Windows drive paths on Windows", () => {
    expect(
      nativeImageFilePath("/mnt/c/Users/Hayden/cover.png", wslWorkspace, true),
    ).toBe("C:\\Users\\Hayden\\cover.png");
  });

  it("preserves existing WSL UNC paths on Windows", () => {
    expect(
      nativeImageFilePath(
        "\\\\wsl$\\Ubuntu-24.04\\home\\hayden\\cover.png",
        localWorkspace,
        true,
      ),
    ).toBe("\\\\wsl$\\Ubuntu-24.04\\home\\hayden\\cover.png");
  });

  it("finds containing folders for native paths", () => {
    expect(
      nativeContainingFolderPath("C:\\Users\\Hayden\\Pictures\\cover.png", true),
    ).toBe("C:\\Users\\Hayden\\Pictures");
    expect(nativeContainingFolderPath("/home/hayden/cover.png", false)).toBe(
      "/home/hayden",
    );
  });

  it("reveals the stat-checked native path in the system file explorer", async () => {
    const mockDeps = deps();
    const workspaceRoot = "C:/Users/Hayden/Pictures";
    const result = await revealImageInSystemFileExplorer(
      "C:/Users/Hayden/Pictures/cover.png",
      { workspaceRoot },
      mockDeps,
    );

    expect(result).toEqual({ ok: true });
    expect(mockDeps.stat).toHaveBeenCalledWith(
      "C:/Users/Hayden/Pictures/cover.png",
      localWorkspace,
    );
    expect(mockDeps.revealPathInSystemFileExplorer).toHaveBeenCalledWith(
      "C:/Users/Hayden/Pictures/cover.png",
      localWorkspace,
      workspaceRoot,
    );
  });

  it("opens the stat-checked workspace path externally", async () => {
    const mockDeps = deps();
    const workspaceRoot = "C:/Users/Hayden/Pictures";
    const result = await openImageExternally(
      "C:/Users/Hayden/Pictures/cover.png",
      { workspaceRoot },
      mockDeps,
    );

    expect(result).toEqual({ ok: true });
    expect(mockDeps.openPathExternally).toHaveBeenCalledWith(
      "C:/Users/Hayden/Pictures/cover.png",
      localWorkspace,
      workspaceRoot,
    );
    expect(mockDeps.openPathExternally).not.toHaveBeenCalledWith(
      expect.stringContaining("asset"),
      expect.anything(),
      expect.anything(),
    );
    expect(mockDeps.openPathExternally).not.toHaveBeenCalledWith(
      expect.stringContaining("tauri"),
      expect.anything(),
      expect.anything(),
    );
  });

  it("keeps a Windows user workspace file eligible after stat validation", async () => {
    const mockDeps = deps();
    const workspaceRoot = "C:\\Users\\Hayden\\Documents\\Orison";
    const imagePath =
      "C:\\Users\\Hayden\\Documents\\Orison\\public\\orison-wordmark.png";

    const result = await openImageExternally(imagePath, { workspaceRoot }, mockDeps);

    expect(result).toEqual({ ok: true });
    expect(mockDeps.openPathExternally).toHaveBeenCalledWith(
      imagePath,
      localWorkspace,
      workspaceRoot,
    );
  });

  it("preserves Linux workspace paths for checked opener commands", async () => {
    const mockDeps = deps({ isWindows: false });
    const workspaceRoot = "/home/hayden/Orison";
    const imagePath = "/home/hayden/Orison/public/orison-wordmark.png";

    const result = await openImageExternally(imagePath, { workspaceRoot }, mockDeps);

    expect(result).toEqual({ ok: true });
    expect(mockDeps.openPathExternally).toHaveBeenCalledWith(
      imagePath,
      localWorkspace,
      workspaceRoot,
    );
  });

  it("preserves macOS workspace paths for checked opener commands", async () => {
    const mockDeps = deps({ isWindows: false });
    const workspaceRoot = "/Users/hayden/Orison";
    const imagePath = "/Users/hayden/Orison/public/orison-wordmark.png";

    const result = await openImageExternally(imagePath, { workspaceRoot }, mockDeps);

    expect(result).toEqual({ ok: true });
    expect(mockDeps.openPathExternally).toHaveBeenCalledWith(
      imagePath,
      localWorkspace,
      workspaceRoot,
    );
  });

  it("falls back to opening the containing folder when exact reveal fails", async () => {
    const mockDeps = deps({
      revealPathInSystemFileExplorer: vi.fn(async () => ({
        fallbackUsed: true,
      })),
    });
    const workspaceRoot = "C:/Users/Hayden/Pictures";
    const result = await revealImageInSystemFileExplorer(
      "C:/Users/Hayden/Pictures/cover.png",
      { workspaceRoot },
      mockDeps,
    );

    expect(result).toEqual({
      ok: true,
      message:
        "Exact file reveal was unavailable, opened the containing folder instead.",
    });
    expect(mockDeps.revealPathInSystemFileExplorer).toHaveBeenCalledWith(
      "C:/Users/Hayden/Pictures/cover.png",
      localWorkspace,
      workspaceRoot,
    );
  });

  it("reports both reveal and fallback errors when both opener calls fail", async () => {
    const mockDeps = deps({
      revealPathInSystemFileExplorer: vi.fn(async () => {
        throw new Error(
          "Exact file reveal failed: exact reveal unsupported; folder fallback failed: folder open failed",
        );
      }),
    });
    const result = await revealImageInSystemFileExplorer(
      "C:/Users/Hayden/Pictures/cover.png",
      { workspaceRoot: "C:/Users/Hayden/Pictures" },
      mockDeps,
    );

    expect(result).toEqual({
      ok: false,
      message:
        "Reveal in System File Explorer failed: Exact file reveal failed: exact reveal unsupported; folder fallback failed: folder open failed",
    });
  });

  it("reports unavailable files instead of invoking native opener actions", async () => {
    const mockDeps = deps({
      stat: vi.fn(async () => {
        throw new Error("not found");
      }),
    });
    const result = await openImageExternally(
      "C:/Users/Hayden/Pictures/missing.png",
      {},
      mockDeps,
    );

    expect(result).toEqual({
      ok: false,
      message: "Image file is unavailable: not found",
    });
    expect(mockDeps.openPathExternally).not.toHaveBeenCalled();
  });

  it("rejects non-file paths", async () => {
    const mockDeps = deps({
      stat: vi.fn(async (): Promise<FileStat> => ({
        kind: "dir",
        size: 0,
        mtime: 1,
      })),
    });
    const result = await revealImageInSystemFileExplorer(
      "C:/Users/Hayden/Pictures",
      { workspaceRoot: "C:/Users/Hayden/Pictures" },
      mockDeps,
    );

    expect(result).toEqual({
      ok: false,
      message: "Expected an image file, found dir.",
    });
    expect(mockDeps.revealPathInSystemFileExplorer).not.toHaveBeenCalled();
  });
});
