import { describe, expect, it } from "vitest";
import {
  pruneSelection,
  selectAllVisible,
  selectionAfterClick,
  selectionForRightClick,
} from "./selection";

const visible = [
  "/repo/folder-a",
  "/repo/folder-a/file-1.txt",
  "/repo/folder-a/file-2.txt",
  "/repo/folder-b",
  "/repo/README.md",
];

describe("selectionAfterClick", () => {
  it("single-click selects one item", () => {
    expect(
      selectionAfterClick({
        visiblePaths: visible,
        state: { selectedPaths: [], focusedPath: null, anchorPath: null },
        path: visible[1],
      }),
    ).toEqual({
      selectedPaths: [visible[1]],
      focusedPath: visible[1],
      anchorPath: visible[1],
    });
  });

  it("ctrl-click toggles items", () => {
    const state = selectionAfterClick({
      visiblePaths: visible,
      state: { selectedPaths: [visible[1]], focusedPath: visible[1], anchorPath: visible[1] },
      path: visible[3],
      ctrlKey: true,
    });
    expect(state.selectedPaths).toEqual([visible[1], visible[3]]);

    expect(
      selectionAfterClick({
        visiblePaths: visible,
        state,
        path: visible[1],
        ctrlKey: true,
      }).selectedPaths,
    ).toEqual([visible[3]]);
  });

  it("shift-click selects a visible range", () => {
    expect(
      selectionAfterClick({
        visiblePaths: visible,
        state: { selectedPaths: [visible[1]], focusedPath: visible[1], anchorPath: visible[1] },
        path: visible[3],
        shiftKey: true,
      }).selectedPaths,
    ).toEqual([visible[1], visible[2], visible[3]]);
  });

  it("ctrl-shift-click extends a range", () => {
    expect(
      selectionAfterClick({
        visiblePaths: visible,
        state: { selectedPaths: [visible[4]], focusedPath: visible[4], anchorPath: visible[1] },
        path: visible[3],
        ctrlKey: true,
        shiftKey: true,
      }).selectedPaths,
    ).toEqual([visible[4], visible[1], visible[2], visible[3]]);
  });
});

describe("right-click and workspace pruning", () => {
  it("right-clicking selected item preserves selection", () => {
    expect(selectionForRightClick([visible[1], visible[3]], visible[3])).toEqual(
      [visible[1], visible[3]],
    );
  });

  it("right-clicking unselected item replaces selection", () => {
    expect(selectionForRightClick([visible[1], visible[3]], visible[4])).toEqual(
      [visible[4]],
    );
  });

  it("selects all visible rows for ctrl-a", () => {
    expect(selectAllVisible(visible).selectedPaths).toEqual(visible);
  });

  it("drops selections that are no longer visible after workspace changes", () => {
    expect(
      pruneSelection(
        {
          selectedPaths: [visible[1], "/other/file.txt"],
          focusedPath: "/other/file.txt",
          anchorPath: "/other/file.txt",
        },
        visible,
      ),
    ).toEqual({
      selectedPaths: [visible[1]],
      focusedPath: visible[1],
      anchorPath: visible[1],
    });
  });
});
