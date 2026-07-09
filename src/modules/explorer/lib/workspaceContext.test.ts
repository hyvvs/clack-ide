import { describe, expect, it } from "vitest";
import { getExplorerWorkspaceContext } from "./workspaceContext";

describe("getExplorerWorkspaceContext", () => {
  it("exposes Open as Workspace only for folder targets", () => {
    expect(
      getExplorerWorkspaceContext({
        rootPath: "C:/repo",
        workspaceRoot: "C:/repo",
        targetIsDir: true,
        canOpenWorkspace: true,
        canOpenFolder: true,
        canCloseWorkspace: true,
      }).canOpenTargetAsWorkspace,
    ).toBe(true);

    expect(
      getExplorerWorkspaceContext({
        rootPath: "C:/repo",
        workspaceRoot: "C:/repo",
        targetIsDir: false,
        canOpenWorkspace: true,
        canOpenFolder: true,
        canCloseWorkspace: true,
      }).canOpenTargetAsWorkspace,
    ).toBe(false);
  });

  it("shows return and outside-workspace state only for real browsing drift", () => {
    const inside = getExplorerWorkspaceContext({
      rootPath: "C:/repo/src",
      workspaceRoot: "C:/repo",
      targetIsDir: false,
      canOpenWorkspace: true,
      canOpenFolder: true,
      canCloseWorkspace: true,
    });
    expect(inside.canReturnToWorkspaceRoot).toBe(true);
    expect(inside.browsingOutsideWorkspace).toBe(false);

    const outside = getExplorerWorkspaceContext({
      rootPath: "C:/Users/me",
      workspaceRoot: "C:/Users/me/repo",
      targetIsDir: false,
      canOpenWorkspace: true,
      canOpenFolder: true,
      canCloseWorkspace: true,
    });
    expect(outside.canReturnToWorkspaceRoot).toBe(true);
    expect(outside.browsingOutsideWorkspace).toBe(true);
  });
});
