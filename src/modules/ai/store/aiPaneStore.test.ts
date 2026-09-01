import { describe, expect, it } from "vitest";
import {
  bindAiPaneSession,
  closeAiPaneLayout,
  createAiPaneLayout,
  MAX_AI_PANES,
  splitAiPaneLayout,
} from "./aiPaneStore";

describe("AI pane layout", () => {
  it("splits a session into an unbound neighboring pane", () => {
    const initial = createAiPaneLayout("chat-a");
    const split = splitAiPaneLayout(initial, 1, "row");
    expect(split).not.toBeNull();
    expect(split?.bindings).toEqual({ 1: "chat-a", 3: null });
    expect(split?.activePaneId).toBe(3);
  });

  it("supports terminal-style splits below the active pane", () => {
    const split = splitAiPaneLayout(createAiPaneLayout("chat-a"), 1, "col");
    expect(split?.tree.kind).toBe("split");
    if (split?.tree.kind !== "split") {
      throw new Error("Expected a split layout");
    }
    expect(split.tree.dir).toBe("col");
    expect(split.bindings).toEqual({ 1: "chat-a", 3: null });
  });

  it("prevents the same session from being visible twice", () => {
    const split = splitAiPaneLayout(createAiPaneLayout("chat-a"), 1, "row");
    expect(split).not.toBeNull();
    if (!split) throw new Error("Expected split layout");
    expect(bindAiPaneSession(split, 3, "chat-a")).toBeNull();
    expect(bindAiPaneSession(split, 3, "chat-b")?.bindings[3]).toBe("chat-b");
  });

  it("closes only the pane view and keeps the remaining binding", () => {
    const split = splitAiPaneLayout(createAiPaneLayout("chat-a"), 1, "row");
    if (!split) throw new Error("Expected split layout");
    const bound = bindAiPaneSession(split, 3, "chat-b");
    if (!bound) throw new Error("Expected bound layout");
    const closed = closeAiPaneLayout(bound, 3);
    expect(closed?.bindings).toEqual({ 1: "chat-a" });
    expect(closed?.activePaneId).toBe(1);
  });

  it("keeps one pane and caps the layout", () => {
    expect(closeAiPaneLayout(createAiPaneLayout("chat-a"), 1)).toBeNull();
    let layout = createAiPaneLayout("chat-a");
    for (let index = 1; index < MAX_AI_PANES; index += 1) {
      const next = splitAiPaneLayout(layout, layout.activePaneId, "row");
      if (!next) throw new Error("Expected split layout before the cap");
      layout = next;
    }
    expect(splitAiPaneLayout(layout, layout.activePaneId, "row")).toBeNull();
  });

  it("can bind the hydrated active chat after an empty first render", async () => {
    const { useAiPaneStore } = await import("./aiPaneStore");
    useAiPaneStore.setState({
      ...createAiPaneLayout(null),
      initialized: true,
    });
    useAiPaneStore.getState().initialize("hydrated-chat");
    expect(useAiPaneStore.getState().bindings[1]).toBe("hydrated-chat");
  });
});
