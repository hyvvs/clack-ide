import { describe, expect, it } from "vitest";
import { resolveExplorerRoot, resolveNewTerminalCwd } from "./useWorkspaceCwd";

describe("workspace cwd helpers", () => {
  it("keeps explorer root tied to the explicit workspace root", () => {
    expect(resolveExplorerRoot("C:/Users/me/project-a")).toBe(
      "C:/Users/me/project-a",
    );
    expect(resolveExplorerRoot(null)).toBeNull();
  });

  it("starts new terminals at the workspace root when one is open", () => {
    expect(
      resolveNewTerminalCwd(
        "C:/Users/me/project-b",
        "C:/Users/me/project-a/subdir",
        "C:/Users/me",
      ),
    ).toBe("C:/Users/me/project-b");
  });

  it("falls back to terminal cwd only when no workspace is open", () => {
    expect(
      resolveNewTerminalCwd(null, "C:/Users/me/scratch", "C:/Users/me"),
    ).toBe("C:/Users/me/scratch");
  });
});
