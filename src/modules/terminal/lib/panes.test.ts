import { describe, expect, it } from "vitest";

import { leafIds, type PaneNode, removeLeafAndFocus, splitLeaf } from "./panes";

const leaf = (id: number): PaneNode => ({ kind: "leaf", id });

describe("removeLeafAndFocus", () => {
  it("closes the right pane and keeps the left pane alive", () => {
    const tree = splitLeaf(leaf(1), 1, 10, 2, "row");

    const result = removeLeafAndFocus(tree, 2, 2);

    expect(result).toEqual({
      tree: leaf(1),
      activeLeafId: 1,
      removed: true,
    });
  });

  it("closes the left pane and focuses the nearest right sibling", () => {
    const tree = splitLeaf(leaf(1), 1, 10, 2, "row");

    const result = removeLeafAndFocus(tree, 1, 1);

    expect(result).toEqual({
      tree: leaf(2),
      activeLeafId: 2,
      removed: true,
    });
  });

  it("collapses nested splits without removing surviving panes", () => {
    const horizontal = splitLeaf(leaf(1), 1, 10, 2, "row");
    const tree = splitLeaf(horizontal, 2, 11, 3, "col");

    const result = removeLeafAndFocus(tree, 2, 2);

    expect(result.tree).not.toBeNull();
    expect(leafIds(result.tree as PaneNode)).toEqual([1, 3]);
    expect(result.activeLeafId).toBe(3);
  });

  it("returns a null tree when the final pane closes", () => {
    expect(removeLeafAndFocus(leaf(1), 1, 1)).toEqual({
      tree: null,
      activeLeafId: null,
      removed: true,
    });
  });

  it("does nothing when the requested pane is absent", () => {
    const tree = splitLeaf(leaf(1), 1, 10, 2, "row");

    const result = removeLeafAndFocus(tree, 99, 1);

    expect(result.tree).toBe(tree);
    expect(result.activeLeafId).toBe(1);
    expect(result.removed).toBe(false);
  });
});
