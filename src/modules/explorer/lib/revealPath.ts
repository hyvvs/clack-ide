import {
  basename,
  normalizeExplorerPath,
  parentPath,
} from "./createTarget";

export type ExplorerRevealResult =
  | { ok: true; path: string; ancestorDirs: string[] }
  | { ok: false; message: string };

function sameExplorerPath(a: string, b: string): boolean {
  const left = normalizeExplorerPath(a);
  const right = normalizeExplorerPath(b);
  if (/^[A-Za-z]:/.test(left) && /^[A-Za-z]:/.test(right)) {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}

export function explorerPathContains(root: string, path: string): boolean {
  let left = normalizeExplorerPath(root);
  let right = normalizeExplorerPath(path);
  if (/^[A-Za-z]:/.test(left) && /^[A-Za-z]:/.test(right)) {
    left = left.toLowerCase();
    right = right.toLowerCase();
  }
  return right === left || right.startsWith(`${left}/`);
}

export function planExplorerReveal(
  rootPath: string | null,
  path: string,
): ExplorerRevealResult {
  if (!rootPath) {
    return { ok: false, message: "No folder is open in the file explorer." };
  }

  const root = normalizeExplorerPath(rootPath);
  const target = normalizeExplorerPath(path);
  if (!explorerPathContains(root, target)) {
    return {
      ok: false,
      message: `${basename(target)} is outside the current file explorer root.`,
    };
  }

  const ancestorDirs: string[] = [];
  let parent = parentPath(target, root);
  while (!sameExplorerPath(parent, root)) {
    ancestorDirs.unshift(parent);
    const next = parentPath(parent, root);
    if (sameExplorerPath(next, parent)) break;
    parent = next;
  }

  return { ok: true, path: target, ancestorDirs };
}
