export type AiPaneShortcutId =
  | "tab.new"
  | "tab.close"
  | "pane.splitRight"
  | "pane.splitDown"
  | "pane.focusNext"
  | "pane.focusPrev";

type ClosestTarget = {
  closest?: (selector: string) => unknown;
};

export function isAiPaneShortcutTarget(target: EventTarget | null): boolean {
  return Boolean(
    (target as ClosestTarget | null)?.closest?.("[data-ai-mini-window]"),
  );
}

export function routeAiPaneShortcut(
  id: AiPaneShortcutId,
  target: EventTarget | null,
  actions: {
    split: (dir: "row" | "col") => void;
    close: () => void;
    focus: (delta: 1 | -1) => void;
  },
): boolean {
  if (!isAiPaneShortcutTarget(target)) return false;
  if (id === "tab.new" || id === "pane.splitRight") actions.split("row");
  else if (id === "pane.splitDown") actions.split("col");
  else if (id === "tab.close") actions.close();
  else if (id === "pane.focusNext") actions.focus(1);
  else actions.focus(-1);
  return true;
}
