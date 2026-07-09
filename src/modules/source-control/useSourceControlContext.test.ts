import { describe, expect, it } from "vitest";
import type { Tab } from "@/modules/tabs";
import { resolveSourceControlContextPath } from "./useSourceControlContext";

describe("resolveSourceControlContextPath", () => {
  it("uses the explicit workspace root when no file context is selected", () => {
    expect(resolveSourceControlContextPath(undefined, "C:/repo")).toBe(
      "C:/repo",
    );
  });

  it("uses selected editor file context without changing the workspace root", () => {
    const tab: Tab = {
      id: 1,
      kind: "editor",
      spaceId: "s1",
      title: "a.ts",
      path: "C:/repo/src/a.ts",
      dirty: false,
      preview: false,
    };
    expect(resolveSourceControlContextPath(tab, "C:/repo")).toBe("C:/repo/src");
  });

  it("does not use terminal cwd as a source-control context", () => {
    const tab: Tab = {
      id: 1,
      kind: "terminal",
      spaceId: "s1",
      title: "shell",
      cwd: "C:/other",
      paneTree: { kind: "leaf", id: 2, cwd: "C:/other" },
      activeLeafId: 2,
    };
    expect(resolveSourceControlContextPath(tab, "C:/repo")).toBe("C:/repo");
  });
});
