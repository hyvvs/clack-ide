import { describe, expect, it, vi } from "vitest";
import { routeAiPaneShortcut } from "./aiPaneShortcuts";

function target(inAiWindow: boolean): EventTarget {
  return {
    closest: () => (inAiWindow ? {} : null),
  } as unknown as EventTarget;
}

describe("AI pane shortcut routing", () => {
  it("routes Ctrl+T to an AI split only from the AI window", () => {
    const split = vi.fn();
    const actions = { split, close: vi.fn(), focus: vi.fn() };
    expect(routeAiPaneShortcut("tab.new", target(true), actions)).toBe(true);
    expect(split).toHaveBeenCalledWith("row");
    expect(routeAiPaneShortcut("tab.new", target(false), actions)).toBe(false);
  });

  it("routes close and focus without invoking terminal actions", () => {
    const actions = { split: vi.fn(), close: vi.fn(), focus: vi.fn() };
    routeAiPaneShortcut("tab.close", target(true), actions);
    routeAiPaneShortcut("pane.focusPrev", target(true), actions);
    expect(actions.close).toHaveBeenCalledOnce();
    expect(actions.focus).toHaveBeenCalledWith(-1);
  });

  it("routes the split-down command to a vertical AI pane split", () => {
    const actions = { split: vi.fn(), close: vi.fn(), focus: vi.fn() };
    routeAiPaneShortcut("pane.splitDown", target(true), actions);
    expect(actions.split).toHaveBeenCalledWith("col");
  });
});
