export type RecentWorkspace = {
  path: string;
  name: string;
  lastOpenedAt: number;
};

export function normalizeWorkspacePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function workspacePathsEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return a === b;
  const left = normalizeWorkspacePath(a);
  const right = normalizeWorkspacePath(b);
  if (/^[A-Za-z]:/.test(left) && /^[A-Za-z]:/.test(right)) {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}

export function workspacePathContains(
  root: string | null | undefined,
  path: string | null | undefined,
): boolean {
  if (!root || !path) return false;
  let left = normalizeWorkspacePath(root);
  let right = normalizeWorkspacePath(path);
  if (/^[A-Za-z]:/.test(left) && /^[A-Za-z]:/.test(right)) {
    left = left.toLowerCase();
    right = right.toLowerCase();
  }
  return right === left || right.startsWith(`${left}/`);
}

export function findWorkspaceByRoot<
  T extends { id: string; root: string | null },
>(spaces: T[], root: string, preferredId?: string | null): T | null {
  return (
    spaces.find(
      (space) =>
        space.id === preferredId && workspacePathsEqual(space.root, root),
    ) ??
    spaces.find((space) => workspacePathsEqual(space.root, root)) ??
    null
  );
}

export function workspaceName(path: string | null): string {
  if (!path) return "No workspace";
  const normalized = normalizeWorkspacePath(path);
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

export function upsertRecentWorkspace(
  current: RecentWorkspace[],
  path: string,
  now: number,
  limit = 12,
): RecentWorkspace[] {
  const normalized = normalizeWorkspacePath(path);
  const next = current
    .filter((item) => !workspacePathsEqual(item.path, normalized))
    .map((item) => ({ ...item, path: normalizeWorkspacePath(item.path) }));
  next.unshift({
    path: normalized,
    name: workspaceName(normalized),
    lastOpenedAt: now,
  });
  return next.slice(0, limit);
}

export function removeRecentWorkspace(
  current: RecentWorkspace[],
  path: string,
): RecentWorkspace[] {
  const normalized = normalizeWorkspacePath(path);
  return current.filter((item) => !workspacePathsEqual(item.path, normalized));
}
