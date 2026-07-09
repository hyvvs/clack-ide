export type ExplorerSelectionState = {
  selectedPaths: string[];
  focusedPath: string | null;
  anchorPath: string | null;
};

export type ExplorerClickSelectionInput = {
  visiblePaths: string[];
  state: ExplorerSelectionState;
  path: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
};

function unique(paths: string[]): string[] {
  return [...new Set(paths)];
}

export function selectSingle(path: string): ExplorerSelectionState {
  return {
    selectedPaths: [path],
    focusedPath: path,
    anchorPath: path,
  };
}

export function visibleRange(
  visiblePaths: string[],
  anchorPath: string | null,
  targetPath: string,
): string[] {
  const targetIndex = visiblePaths.indexOf(targetPath);
  if (targetIndex < 0) return [targetPath];
  const anchorIndex = anchorPath ? visiblePaths.indexOf(anchorPath) : -1;
  if (anchorIndex < 0) return [targetPath];
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return visiblePaths.slice(start, end + 1);
}

export function selectionAfterClick({
  visiblePaths,
  state,
  path,
  ctrlKey = false,
  metaKey = false,
  shiftKey = false,
}: ExplorerClickSelectionInput): ExplorerSelectionState {
  const modifier = ctrlKey || metaKey;
  if (shiftKey) {
    const anchor = state.anchorPath ?? path;
    const range = visibleRange(visiblePaths, anchor, path);
    return {
      selectedPaths: modifier
        ? unique([...state.selectedPaths, ...range])
        : range,
      focusedPath: path,
      anchorPath: anchor,
    };
  }

  if (modifier) {
    const selected = new Set(state.selectedPaths);
    if (selected.has(path)) selected.delete(path);
    else selected.add(path);
    return {
      selectedPaths: [...selected],
      focusedPath: path,
      anchorPath: path,
    };
  }

  return selectSingle(path);
}

export function selectionForRightClick(
  selectedPaths: string[],
  path: string | null,
): string[] {
  if (!path) return [];
  return selectedPaths.includes(path) ? selectedPaths : [path];
}

export function pruneSelection(
  state: ExplorerSelectionState,
  visiblePaths: string[],
): ExplorerSelectionState {
  const visible = new Set(visiblePaths);
  const selectedPaths = state.selectedPaths.filter((path) => visible.has(path));
  return {
    selectedPaths,
    focusedPath:
      state.focusedPath && visible.has(state.focusedPath)
        ? state.focusedPath
        : selectedPaths[0] ?? null,
    anchorPath:
      state.anchorPath && visible.has(state.anchorPath)
        ? state.anchorPath
        : selectedPaths[0] ?? null,
  };
}

export function selectAllVisible(visiblePaths: string[]): ExplorerSelectionState {
  return {
    selectedPaths: [...visiblePaths],
    focusedPath: visiblePaths[0] ?? null,
    anchorPath: visiblePaths[0] ?? null,
  };
}
