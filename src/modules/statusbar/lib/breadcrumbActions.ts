import { workspacePathsEqual } from "@/modules/workspace";

export function parentPath(path: string): string | null {
  const cleaned = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalized = cleaned || (path.startsWith("/") ? "/" : cleaned);
  const drive = /^[A-Za-z]:$/.test(normalized) ? `${normalized}/` : null;
  if (drive) return null;
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return normalized === "/" ? null : "/";
  const parent = normalized.slice(0, idx);
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}/`;
  return parent;
}

export function getBreadcrumbFolderActions({
  path,
  workspaceRoot,
  canOpenWorkspace,
}: {
  path: string;
  workspaceRoot: string | null | undefined;
  canOpenWorkspace: boolean;
}) {
  const parent = parentPath(path);
  return {
    canOpenAsWorkspace: canOpenWorkspace,
    canOpenParentAsWorkspace:
      canOpenWorkspace && !!parent && !workspacePathsEqual(parent, path),
    canReturnToWorkspaceRoot:
      !!workspaceRoot && !workspacePathsEqual(path, workspaceRoot),
    parentPath: parent,
  };
}
