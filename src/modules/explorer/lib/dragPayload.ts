export function parentDir(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/g, "");
  const i = normalized.lastIndexOf("/");
  if (i <= 0) return normalized;
  if (i === 2 && /^[A-Za-z]:\//.test(normalized)) return normalized.slice(0, 3);
  return normalized.slice(0, i);
}

export function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

export function compactMoveSources(sources: string[]): string[] {
  const normalized = [...new Set(sources.map((path) => path.replace(/\\/g, "/")))];
  return normalized.filter(
    (source) =>
      !normalized.some(
        (candidate) => candidate !== source && source.startsWith(`${candidate}/`),
      ),
  );
}

export function dragSourcesFor(
  source: string,
  selectedPaths: string[],
): string[] {
  return selectedPaths.includes(source)
    ? compactMoveSources(selectedPaths)
    : [source];
}

export function invalidMoveReason(
  source: string,
  targetDir: string,
): string | null {
  const normalizedSource = source.replace(/\\/g, "/").replace(/\/+$/g, "");
  const normalizedTarget = targetDir.replace(/\\/g, "/").replace(/\/+$/g, "");
  if (normalizedTarget === normalizedSource) {
    return "Cannot move a folder into itself.";
  }
  if (normalizedTarget.startsWith(`${normalizedSource}/`)) {
    return "Cannot move a folder into one of its own children.";
  }
  if (parentDir(normalizedSource) === normalizedTarget) {
    return "Item is already in that folder.";
  }
  return null;
}

export function invalidDropReason(
  sources: string[],
  targetDir: string | null,
): string | null {
  if (!targetDir) return "No target folder.";
  for (const source of compactMoveSources(sources)) {
    const reason = invalidMoveReason(source, targetDir);
    if (reason) return reason;
  }
  return null;
}

export function dragLabelForSources(sources: string[]): string {
  return sources.length === 1 ? basename(sources[0]) : `${sources.length} items`;
}
