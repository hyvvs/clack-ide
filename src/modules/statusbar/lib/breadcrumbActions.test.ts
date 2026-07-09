import { describe, expect, it } from "vitest";
import { getBreadcrumbFolderActions, parentPath } from "./breadcrumbActions";

describe("breadcrumb folder actions", () => {
  it("keeps workspace switching as an explicit folder action", () => {
    expect(
      getBreadcrumbFolderActions({
        path: "C:/repo/src",
        workspaceRoot: "C:/repo",
        canOpenWorkspace: true,
      }),
    ).toMatchObject({
      canOpenAsWorkspace: true,
      canReturnToWorkspaceRoot: true,
      parentPath: "C:/repo",
    });
  });

  it("does not offer workspace actions when no workspace opener is wired", () => {
    expect(
      getBreadcrumbFolderActions({
        path: "C:/repo/src",
        workspaceRoot: "C:/repo",
        canOpenWorkspace: false,
      }).canOpenAsWorkspace,
    ).toBe(false);
  });

  it("normalizes parent paths for drive roots and unix roots", () => {
    expect(parentPath("C:/repo/src")).toBe("C:/repo");
    expect(parentPath("C:/repo")).toBe("C:/");
    expect(parentPath("C:/")).toBeNull();
    expect(parentPath("/repo/src")).toBe("/repo");
    expect(parentPath("/")).toBeNull();
  });
});
