import { describe, expect, it, vi } from "vitest";
import {
  createCommandItems,
  type CommandPaletteActionContext,
} from "./commands";

function context(
  overrides: Partial<CommandPaletteActionContext> = {},
): CommandPaletteActionContext {
  const noop = vi.fn();
  return {
    tabs: [],
    activeId: 0,
    searchTarget: null,
    explorerRoot: "C:/repo",
    recentWorkspaces: [],
    recentWorkspaceMissing: {},
    openFolder: noop,
    switchWorkspace: noop,
    closeWorkspace: noop,
    openRecentWorkspace: noop,
    openNewTab: noop,
    openNewBlock: noop,
    openNewPrivate: noop,
    openNewEditor: noop,
    openNewPreview: noop,
    openGitGraph: noop,
    toggleSourceControl: noop,
    closeActiveTabOrPane: noop,
    splitPaneRight: noop,
    splitPaneDown: noop,
    focusSearch: noop,
    focusExplorerSearch: noop,
    toggleSidebar: noop,
    toggleAi: noop,
    askAiSelection: noop,
    openSettings: noop,
    openThemes: noop,
    openKeyboardShortcuts: noop,
    spaces: [],
    activeSpaceId: null,
    openSpacesOverview: noop,
    newSpace: noop,
    switchSpace: noop,
    ...overrides,
  };
}

describe("createCommandItems workspace commands", () => {
  it("registers real workspace actions", () => {
    const openFolder = vi.fn();
    const switchWorkspace = vi.fn();
    const closeWorkspace = vi.fn();
    const items = createCommandItems(
      context({ openFolder, switchWorkspace, closeWorkspace }),
    );

    items.find((item) => item.id === "workspace.openFolder")?.run();
    items.find((item) => item.id === "workspace.switch")?.run();
    items.find((item) => item.id === "workspace.close")?.run();

    expect(openFolder).toHaveBeenCalledOnce();
    expect(switchWorkspace).toHaveBeenCalledOnce();
    expect(closeWorkspace).toHaveBeenCalledOnce();
  });

  it("disables Close Workspace and workspace file commands without a root", () => {
    const items = createCommandItems(context({ explorerRoot: null }));
    expect(items.find((item) => item.id === "workspace.close")).toMatchObject({
      disabledReason: "No workspace open",
    });
    expect(items.find((item) => item.id === "tab.newEditor")).toMatchObject({
      disabledReason: "No workspace root",
    });
  });

  it("registers recent workspace entries and disables missing folders", () => {
    const openRecentWorkspace = vi.fn();
    const items = createCommandItems(
      context({
        recentWorkspaces: [{ path: "C:/missing", name: "missing" }],
        recentWorkspaceMissing: { "C:/missing": true },
        openRecentWorkspace,
      }),
    );
    const recent = items.find(
      (item) => item.id === "workspace.recent.C:/missing",
    );

    expect(recent).toMatchObject({ disabledReason: "Missing folder" });
    recent?.run();
    expect(openRecentWorkspace).toHaveBeenCalledWith("C:/missing");
  });
});
