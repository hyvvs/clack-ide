import {
  leafIds,
  nextLeafId,
  removeLeafAndFocus,
  splitLeaf,
  type PaneNode,
  type SplitDir,
} from "@/modules/terminal/lib/panes";
import { create } from "zustand";

export const MAX_AI_PANES = 4;

export function canAddAiPane(
  viewportWidth: number,
  paneCount: number,
  dir: SplitDir = "row",
  viewportHeight = viewportWidth,
): boolean {
  if (paneCount >= MAX_AI_PANES) return false;
  const available = dir === "row" ? viewportWidth : viewportHeight;
  const minimumPaneSize = dir === "row" ? 320 : 240;
  return available >= (paneCount + 1) * minimumPaneSize + 32;
}

export type AiPaneBindings = Record<number, string | null>;

export type AiPaneLayout = {
  tree: PaneNode;
  activePaneId: number;
  bindings: AiPaneBindings;
  nextId: number;
};

export function createAiPaneLayout(sessionId: string | null): AiPaneLayout {
  return {
    tree: { kind: "leaf", id: 1 },
    activePaneId: 1,
    bindings: { 1: sessionId },
    nextId: 2,
  };
}

export function splitAiPaneLayout(
  layout: AiPaneLayout,
  targetPaneId: number,
  dir: SplitDir,
): AiPaneLayout | null {
  if (leafIds(layout.tree).length >= MAX_AI_PANES) return null;
  if (!leafIds(layout.tree).includes(targetPaneId)) return null;
  const splitId = layout.nextId;
  const newPaneId = splitId + 1;
  return {
    tree: splitLeaf(layout.tree, targetPaneId, splitId, newPaneId, dir),
    activePaneId: newPaneId,
    bindings: { ...layout.bindings, [newPaneId]: null },
    nextId: newPaneId + 1,
  };
}

export function closeAiPaneLayout(
  layout: AiPaneLayout,
  paneId: number,
): AiPaneLayout | null {
  if (leafIds(layout.tree).length <= 1) return null;
  const removal = removeLeafAndFocus(layout.tree, paneId, layout.activePaneId);
  if (!removal.removed || !removal.tree || removal.activeLeafId === null) {
    return null;
  }
  const bindings = { ...layout.bindings };
  delete bindings[paneId];
  return {
    ...layout,
    tree: removal.tree,
    activePaneId: removal.activeLeafId,
    bindings,
  };
}

export function bindAiPaneSession(
  layout: AiPaneLayout,
  paneId: number,
  sessionId: string,
): AiPaneLayout | null {
  if (!leafIds(layout.tree).includes(paneId)) return null;
  const duplicate = Object.entries(layout.bindings).some(
    ([candidatePaneId, candidateSessionId]) =>
      Number(candidatePaneId) !== paneId && candidateSessionId === sessionId,
  );
  if (duplicate) return null;
  return {
    ...layout,
    activePaneId: paneId,
    bindings: { ...layout.bindings, [paneId]: sessionId },
  };
}

type AiPaneStore = AiPaneLayout & {
  initialized: boolean;
  initialize: (sessionId: string | null) => void;
  splitPane: (paneId: number, dir: SplitDir) => number | null;
  closePane: (paneId: number) => number | null;
  focusPane: (paneId: number) => void;
  focusAdjacent: (delta: 1 | -1) => number;
  bindSession: (paneId: number, sessionId: string) => boolean;
  visibleSessionIds: () => string[];
};

export const useAiPaneStore = create<AiPaneStore>((set, get) => ({
  ...createAiPaneLayout(null),
  initialized: false,
  initialize: (sessionId) => {
    if (get().initialized) {
      const state = get();
      if (
        sessionId &&
        leafIds(state.tree).length === 1 &&
        !state.bindings[state.activePaneId]
      ) {
        set({
          bindings: { ...state.bindings, [state.activePaneId]: sessionId },
        });
      }
      return;
    }
    set({ ...createAiPaneLayout(sessionId), initialized: true });
  },
  splitPane: (paneId, dir) => {
    const next = splitAiPaneLayout(get(), paneId, dir);
    if (!next) return null;
    set(next);
    return next.activePaneId;
  },
  closePane: (paneId) => {
    const next = closeAiPaneLayout(get(), paneId);
    if (!next) return null;
    set(next);
    return next.activePaneId;
  },
  focusPane: (paneId) => {
    if (!leafIds(get().tree).includes(paneId)) return;
    set({ activePaneId: paneId });
  },
  focusAdjacent: (delta) => {
    const state = get();
    const paneId = nextLeafId(state.tree, state.activePaneId, delta);
    set({ activePaneId: paneId });
    return paneId;
  },
  bindSession: (paneId, sessionId) => {
    const next = bindAiPaneSession(get(), paneId, sessionId);
    if (!next) return false;
    set(next);
    return true;
  },
  visibleSessionIds: () =>
    leafIds(get().tree)
      .map((paneId) => get().bindings[paneId])
      .filter((sessionId): sessionId is string => Boolean(sessionId)),
}));

export function focusAiPaneElement(paneId: number): void {
  requestAnimationFrame(() => {
    const pane = document.querySelector<HTMLElement>(
      `[data-ai-pane-id="${paneId}"]`,
    );
    pane?.focus();
  });
}
