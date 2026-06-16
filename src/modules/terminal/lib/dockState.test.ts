import { describe, expect, it } from "vitest";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import {
  isWorkspaceTab,
  selectActiveTerminalId,
  selectActiveWorkspaceId,
} from "./dockState";

function terminal(id: number): Tab {
  return {
    id,
    kind: "terminal",
    spaceId: "s1",
    title: "shell",
    paneTree: { kind: "leaf", id: id * 10 },
    activeLeafId: id * 10,
  };
}

function editor(id: number): Tab {
  return {
    id,
    kind: "editor",
    spaceId: "s1",
    title: `file-${id}.ts`,
    path: `/tmp/file-${id}.ts`,
    dirty: false,
    preview: false,
  };
}

describe("terminal dock tab selection", () => {
  it("keeps the active terminal separate from the active workspace tab", () => {
    const tabs = [terminal(1), editor(2), terminal(3), editor(4)];

    expect(selectActiveTerminalId(tabs, 4, 1)).toBe(1);
    expect(selectActiveWorkspaceId(tabs, 1, 4)).toBe(4);
  });

  it("prefers the current active id when it matches the requested area", () => {
    const tabs = [terminal(1), editor(2), terminal(3), editor(4)];

    expect(selectActiveTerminalId(tabs, 3, 1)).toBe(3);
    expect(selectActiveWorkspaceId(tabs, 4, 2)).toBe(4);
  });

  it("falls back to the most recent tab in each area", () => {
    const tabs = [terminal(1), editor(2), terminal(3), editor(4)];

    expect(selectActiveTerminalId(tabs, 999, null)).toBe(3);
    expect(selectActiveWorkspaceId(tabs, 999, null)).toBe(4);
  });

  it("classifies non-terminal tabs as workspace tabs", () => {
    expect(isWorkspaceTab(editor(2))).toBe(true);
    expect(isWorkspaceTab(terminal(1))).toBe(false);
  });
});
