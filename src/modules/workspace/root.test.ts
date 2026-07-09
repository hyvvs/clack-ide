import { describe, expect, it } from "vitest";
import {
  findWorkspaceByRoot,
  normalizeWorkspacePath,
  removeRecentWorkspace,
  upsertRecentWorkspace,
  workspacePathContains,
  workspacePathsEqual,
  workspaceName,
  type RecentWorkspace,
} from "./root";

describe("workspace root helpers", () => {
  it("normalizes Windows separators and trailing slashes", () => {
    expect(normalizeWorkspacePath("C:\\Users\\me\\repo\\")).toBe(
      "C:/Users/me/repo",
    );
  });

  it("derives a display name from the root", () => {
    expect(workspaceName("C:/Users/me/repo")).toBe("repo");
    expect(workspaceName(null)).toBe("No workspace");
  });

  it("compares normalized Windows workspace paths case-insensitively", () => {
    expect(
      workspacePathsEqual("C:/Users/me/repo", "c:\\Users\\me\\repo\\"),
    ).toBe(true);
    expect(workspacePathsEqual("/Users/me/repo", "/users/me/repo")).toBe(false);
  });

  it("finds an existing workspace space by normalized root", () => {
    const spaces = [
      { id: "a", root: "C:/Users/me/one" },
      { id: "b", root: "C:/Users/me/two" },
    ];
    expect(findWorkspaceByRoot(spaces, "c:\\Users\\me\\two\\")?.id).toBe("b");
  });

  it("detects paths inside a workspace root with Windows normalization", () => {
    expect(
      workspacePathContains("C:/Users/me/repo", "c:\\Users\\me\\repo\\src"),
    ).toBe(true);
    expect(workspacePathContains("C:/Users/me/repo", "C:/Users/me")).toBe(
      false,
    );
  });

  it("prefers the current matching space when duplicate roots exist", () => {
    const spaces = [
      { id: "older", root: "C:/Users/me/repo" },
      { id: "current", root: "C:/Users/me/repo" },
    ];
    expect(findWorkspaceByRoot(spaces, "C:/Users/me/repo", "current")?.id).toBe(
      "current",
    );
  });

  it("deduplicates and orders recent workspaces", () => {
    const current: RecentWorkspace[] = [
      { path: "C:/a", name: "a", lastOpenedAt: 1 },
      { path: "C:/b", name: "b", lastOpenedAt: 2 },
    ];
    expect(upsertRecentWorkspace(current, "C:\\b\\", 3)).toEqual([
      { path: "C:/b", name: "b", lastOpenedAt: 3 },
      { path: "C:/a", name: "a", lastOpenedAt: 1 },
    ]);
  });

  it("deduplicates recent workspaces with Windows drive case differences", () => {
    const current: RecentWorkspace[] = [
      { path: "C:/Users/me/repo", name: "repo", lastOpenedAt: 1 },
    ];
    expect(upsertRecentWorkspace(current, "c:\\Users\\me\\repo\\", 2)).toEqual([
      { path: "c:/Users/me/repo", name: "repo", lastOpenedAt: 2 },
    ]);
  });

  it("removes recent workspaces by normalized path", () => {
    const current: RecentWorkspace[] = [
      { path: "C:/a", name: "a", lastOpenedAt: 1 },
      { path: "C:/b", name: "b", lastOpenedAt: 2 },
    ];
    expect(removeRecentWorkspace(current, "C:\\a\\")).toEqual([
      { path: "C:/b", name: "b", lastOpenedAt: 2 },
    ]);
  });
});
