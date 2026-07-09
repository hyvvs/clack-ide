import type { DirEntry } from "./useFileTree";

export type ExplorerEntryRef = {
  path: string;
  isDir: boolean;
};

export type CreateSource = "toolbar" | "context" | "empty" | "breadcrumb";

export type CreateTargetInput = {
  rootPath: string | null;
  explorerLocation?: string | null;
  selectedEntries?: ExplorerEntryRef[];
  contextEntry?: ExplorerEntryRef | null;
  source: CreateSource;
};

export type CreateNameValidation =
  | { ok: true; name: string }
  | { ok: false; message: string };

const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

export function normalizeExplorerPath(path: string): string {
  if (!path) return path;
  const normalized = path.replace(/\\/g, "/");
  if (normalized === "/") return normalized;
  if (/^[A-Za-z]:\/$/.test(normalized)) return normalized;
  return normalized.replace(/\/+$/g, "");
}

export function basename(path: string): string {
  const normalized = normalizeExplorerPath(path);
  const parts = normalized.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : normalized;
}

export function parentPath(path: string, fallback: string): string {
  const normalized = normalizeExplorerPath(path);
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) return normalizeExplorerPath(fallback);
  if (slash === 2 && /^[A-Za-z]:\//.test(normalized)) {
    return normalized.slice(0, 3);
  }
  return normalized.slice(0, slash);
}

export function resolveCreateTarget({
  rootPath,
  explorerLocation,
  selectedEntries = [],
  contextEntry = null,
  source,
}: CreateTargetInput): string | null {
  const root = rootPath ? normalizeExplorerPath(rootPath) : null;
  const location = explorerLocation
    ? normalizeExplorerPath(explorerLocation)
    : root;
  if (!location) return null;

  if (source === "context" && contextEntry) {
    const contextPath = normalizeExplorerPath(contextEntry.path);
    return contextEntry.isDir
      ? contextPath
      : parentPath(contextPath, location);
  }

  if (source === "toolbar" && selectedEntries.length === 1) {
    const selected = selectedEntries[0];
    const selectedPath = normalizeExplorerPath(selected.path);
    return selected.isDir ? selectedPath : parentPath(selectedPath, location);
  }

  return location;
}

export function validateCreateName(name: string): CreateNameValidation {
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false, message: "Name is required." };
  }
  if (trimmed === "." || trimmed === "..") {
    return { ok: false, message: "Name cannot be . or .." };
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return { ok: false, message: "Use a name, not a path." };
  }
  if (/[\x00-\x1f]/.test(trimmed)) {
    return { ok: false, message: "Name contains an invalid control character." };
  }
  if (/[<>:"|?*]/.test(trimmed)) {
    return { ok: false, message: "Name contains a character Windows cannot use." };
  }
  if (/[. ]$/.test(trimmed)) {
    return { ok: false, message: "Name cannot end with a space or period." };
  }

  const reservedBase = trimmed.split(".")[0]?.toUpperCase();
  if (reservedBase && WINDOWS_RESERVED_NAMES.has(reservedBase)) {
    return { ok: false, message: `${reservedBase} is reserved on Windows.` };
  }

  return { ok: true, name: trimmed };
}

export function isDotfileName(name: string): boolean {
  return name.startsWith(".") && name !== "." && name !== "..";
}

export function existingNameConflict(
  entries: DirEntry[] | undefined,
  name: string,
): DirEntry | null {
  if (!entries) return null;
  const lowered = name.toLowerCase();
  return (
    entries.find((entry) => entry.name.toLowerCase() === lowered) ?? null
  );
}

export function duplicateCreateMessage(name: string, parentPath: string): string {
  return `${name} already exists in ${normalizeExplorerPath(parentPath)}.`;
}
