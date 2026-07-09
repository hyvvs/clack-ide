import { describe, expect, it } from "vitest";
import { explorerActionEligibility } from "./actionEligibility";

describe("explorerActionEligibility", () => {
  it("allows folder-only workspace actions for one folder", () => {
    expect(
      explorerActionEligibility([{ path: "/repo/folder-a", isDir: true }]),
    ).toMatchObject({
      canOpenAsWorkspace: true,
      canOpenFolderInTerminal: true,
      canOpenFile: false,
    });
  });

  it("allows open-file actions for one file", () => {
    expect(
      explorerActionEligibility([{ path: "/repo/a.txt", isDir: false }]),
    ).toMatchObject({
      canOpenFile: true,
      canOpenAsWorkspace: false,
    });
  });

  it("keeps multi-selection to batch-safe actions", () => {
    expect(
      explorerActionEligibility([
        { path: "/repo/a.txt", isDir: false },
        { path: "/repo/folder-a", isDir: true },
      ]),
    ).toEqual({
      canOpenFile: false,
      canOpenFolderInTerminal: false,
      canOpenAsWorkspace: false,
      canRevealSingle: false,
      canAttachSingle: false,
      canDelete: true,
      canCopyPaths: true,
    });
  });
});
