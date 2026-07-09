import { invoke } from "@tauri-apps/api/core";
import { IS_WINDOWS } from "@/lib/platform";
import { native, type FileStat } from "@/modules/ai/lib/native";
import { currentWorkspaceEnv, type WorkspaceEnv } from "@/modules/workspace";

export type ImageFileActionResult =
  | { ok: true; message?: string }
  | { ok: false; message: string };

type SystemRevealResult = {
  fallbackUsed: boolean;
};

export type ImageFileActionContext = {
  workspaceRoot?: string | null;
};

export type ImageFileActionDeps = {
  stat: (path: string, workspace?: WorkspaceEnv) => Promise<FileStat>;
  revealPathInSystemFileExplorer: (
    path: string,
    workspace: WorkspaceEnv,
    workspaceRoot: string | null,
  ) => Promise<SystemRevealResult>;
  openPathExternally: (
    path: string,
    workspace: WorkspaceEnv,
    workspaceRoot: string | null,
  ) => Promise<void>;
  workspace: () => WorkspaceEnv;
  isWindows: boolean;
};

const defaultDeps: ImageFileActionDeps = {
  stat: native.stat,
  revealPathInSystemFileExplorer: (path, workspace, workspaceRoot) =>
    invoke<SystemRevealResult>("reveal_path_in_system_file_explorer_checked", {
      path,
      workspace,
      workspaceRoot,
    }),
  openPathExternally: (path, workspace, workspaceRoot) =>
    invoke("open_path_externally_checked", {
      path,
      workspace,
      workspaceRoot,
    }),
  workspace: currentWorkspaceEnv,
  isWindows: IS_WINDOWS,
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeWindowsPath(path: string): string {
  if (path.startsWith("//wsl$/") || path.startsWith("//wsl.localhost/")) {
    return `\\\\${path.slice(2).replace(/\//g, "\\")}`;
  }
  return path.replace(/\//g, "\\");
}

function wslMountPathToWindowsPath(path: string): string | null {
  const match = path.match(/^\/mnt\/([a-zA-Z])(?:\/(.*))?$/);
  if (!match) return null;
  const drive = match[1].toUpperCase();
  const rest = match[2]?.replace(/\//g, "\\") ?? "";
  return rest ? `${drive}:\\${rest}` : `${drive}:\\`;
}

export function nativeImageFilePath(
  path: string,
  workspace: WorkspaceEnv,
  isWindows = IS_WINDOWS,
): string {
  if (!isWindows) return path;
  if (path.startsWith("\\\\wsl$\\") || path.startsWith("\\\\wsl.localhost\\")) {
    return normalizeWindowsPath(path);
  }
  if (workspace.kind === "wsl") {
    const mountedDrivePath = wslMountPathToWindowsPath(path);
    if (mountedDrivePath) return mountedDrivePath;
    if (!path.startsWith("/")) return normalizeWindowsPath(path);
    const clean = path.replace(/^\/+/, "").replace(/\//g, "\\");
    return `\\\\wsl.localhost\\${workspace.distro}\\${clean}`;
  }
  return normalizeWindowsPath(path);
}

export function nativeContainingFolderPath(
  path: string,
  isWindows = IS_WINDOWS,
): string | null {
  const normalized = isWindows ? normalizeWindowsPath(path) : path;
  const separator = isWindows ? "\\" : "/";
  const index = normalized.lastIndexOf(separator);
  if (index < 0) return null;
  if (!isWindows && index === 0) return "/";
  if (isWindows && /^[A-Za-z]:\\[^\\]+$/.test(normalized)) {
    return normalized.slice(0, 3);
  }
  if (isWindows && normalized.startsWith("\\\\") && index <= 1) return null;
  return normalized.slice(0, index);
}

async function ensureFile(
  path: string,
  deps: ImageFileActionDeps,
  workspace: WorkspaceEnv,
): Promise<ImageFileActionResult> {
  try {
    const stat = await deps.stat(path, workspace);
    if (stat.kind !== "file") {
      return {
        ok: false,
        message: `Expected an image file, found ${stat.kind}.`,
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: `Image file is unavailable: ${errorText(error)}`,
    };
  }
}

export async function revealImageInSystemFileExplorer(
  path: string,
  context: ImageFileActionContext = {},
  deps: ImageFileActionDeps = defaultDeps,
): Promise<ImageFileActionResult> {
  const workspace = deps.workspace();
  const file = await ensureFile(path, deps, workspace);
  if (!file.ok) return file;
  try {
    const result = await deps.revealPathInSystemFileExplorer(
      path,
      workspace,
      context.workspaceRoot ?? null,
    );
    if (result.fallbackUsed) {
      return {
        ok: true,
        message:
          "Exact file reveal was unavailable, opened the containing folder instead.",
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: `Reveal in System File Explorer failed: ${errorText(error)}`,
    };
  }
}

export async function openImageExternally(
  path: string,
  context: ImageFileActionContext = {},
  deps: ImageFileActionDeps = defaultDeps,
): Promise<ImageFileActionResult> {
  const workspace = deps.workspace();
  const file = await ensureFile(path, deps, workspace);
  if (!file.ok) return file;
  try {
    await deps.openPathExternally(
      path,
      workspace,
      context.workspaceRoot ?? null,
    );
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: `Open Externally failed: ${errorText(error)}`,
    };
  }
}
