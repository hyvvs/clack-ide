import { describe, expect, it } from "vitest";
import {
  compactMoveSources,
  dragLabelForSources,
  dragSourcesFor,
  invalidDropReason,
  invalidMoveReason,
} from "./dragPayload";

describe("drag payload rules", () => {
  it("drags only an unselected source", () => {
    expect(dragSourcesFor("/repo/c.txt", ["/repo/a.txt", "/repo/b.txt"])).toEqual(
      ["/repo/c.txt"],
    );
  });

  it("drags the selected group when the source is selected", () => {
    expect(dragSourcesFor("/repo/a.txt", ["/repo/a.txt", "/repo/b.txt"])).toEqual(
      ["/repo/a.txt", "/repo/b.txt"],
    );
  });

  it("compacts children under selected folders", () => {
    expect(
      compactMoveSources([
        "/repo/folder-a",
        "/repo/folder-a/file-1.txt",
        "/repo/folder-b/file-2.txt",
      ]),
    ).toEqual(["/repo/folder-a", "/repo/folder-b/file-2.txt"]);
  });

  it("blocks moves into self, descendants, and the current parent", () => {
    expect(invalidMoveReason("/repo/folder-a", "/repo/folder-a")).toBeTruthy();
    expect(
      invalidMoveReason("/repo/folder-a", "/repo/folder-a/child"),
    ).toBeTruthy();
    expect(invalidMoveReason("/repo/folder-a/file.txt", "/repo/folder-a")).toBeTruthy();
    expect(invalidMoveReason("/repo/folder-a/file.txt", "/repo/folder-b")).toBeNull();
  });

  it("reports invalid selected group drops", () => {
    expect(
      invalidDropReason(["/repo/folder-a", "/repo/folder-b"], "/repo/folder-a"),
    ).toBeTruthy();
  });

  it("labels single and multi-item drags", () => {
    expect(dragLabelForSources(["/repo/a.txt"])).toBe("a.txt");
    expect(dragLabelForSources(["/repo/a.txt", "/repo/b.txt"])).toBe("2 items");
  });
});
