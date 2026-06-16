import type { Tab, TerminalTab } from "@/modules/tabs";

export type WorkspaceTab = Exclude<Tab, TerminalTab>;

export function isTerminalTab(tab: Tab | undefined): tab is TerminalTab {
  return tab?.kind === "terminal";
}

export function isWorkspaceTab(tab: Tab | undefined): tab is WorkspaceTab {
  return Boolean(tab && tab.kind !== "terminal");
}

export function selectActiveTerminalId(
  tabs: Tab[],
  activeId: number,
  preferredId: number | null,
): number | null {
  const terminals = tabs.filter(isTerminalTab);
  if (terminals.length === 0) return null;
  if (terminals.some((tab) => tab.id === activeId)) return activeId;
  if (preferredId !== null && terminals.some((tab) => tab.id === preferredId)) {
    return preferredId;
  }
  return terminals[terminals.length - 1].id;
}

export function selectActiveWorkspaceId(
  tabs: Tab[],
  activeId: number,
  preferredId: number | null,
): number | null {
  const workspaceTabs = tabs.filter(isWorkspaceTab);
  if (workspaceTabs.length === 0) return null;
  if (workspaceTabs.some((tab) => tab.id === activeId)) return activeId;
  if (
    preferredId !== null &&
    workspaceTabs.some((tab) => tab.id === preferredId)
  ) {
    return preferredId;
  }
  return workspaceTabs[workspaceTabs.length - 1].id;
}
