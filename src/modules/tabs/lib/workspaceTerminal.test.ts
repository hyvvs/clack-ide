import { describe, expect, it } from "vitest";
import type { TerminalTab } from "./useTabs";
import {
  terminalCanAdoptCwd,
  terminalHasCwd,
  terminalLeafIdForCwd,
  terminalWithCwd,
} from "./useTabs";

function terminalTab(over: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: 1,
    kind: "terminal",
    spaceId: "default",
    title: "shell",
    paneTree: { kind: "leaf", id: 2 },
    activeLeafId: 2,
    ...over,
  };
}

describe("workspace terminal helpers", () => {
  it("matches Windows cwd regardless of separators and drive casing", () => {
    const tab = terminalTab({ cwd: "C:/Users/Hayden/Orison" });
    expect(terminalHasCwd(tab, "c:\\Users\\Hayden\\Orison\\")).toBe(true);
  });

  it("matches cwd from split pane leaves", () => {
    const tab = terminalTab({
      cwd: "C:/Users/Hayden/clack",
      paneTree: {
        kind: "split",
        id: 10,
        dir: "row",
        children: [
          { kind: "leaf", id: 2, cwd: "C:/Users/Hayden/clack" },
          { kind: "leaf", id: 3, cwd: "C:/Users/Hayden/Orison" },
        ],
      },
    });
    expect(terminalHasCwd(tab, "C:/Users/Hayden/Orison")).toBe(true);
    expect(terminalLeafIdForCwd(tab, "C:/Users/Hayden/Orison")).toBe(3);
  });

  it("can adopt only an unused one-leaf terminal", () => {
    expect(terminalCanAdoptCwd(terminalTab())).toBe(true);
    expect(terminalCanAdoptCwd(terminalTab({ cwd: "C:/repo" }))).toBe(false);
  });

  it("retargets the active leaf when adopting a workspace cwd", () => {
    const adopted = terminalWithCwd(terminalTab(), "C:/Users/Hayden/Orison");
    expect(adopted.cwd).toBe("C:/Users/Hayden/Orison");
    expect(adopted.title).toBe("Orison");
    expect(adopted.paneTree).toMatchObject({
      kind: "leaf",
      id: 2,
      cwd: "C:/Users/Hayden/Orison",
    });
  });
});
