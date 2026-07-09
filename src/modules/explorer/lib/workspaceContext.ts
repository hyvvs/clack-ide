import {
  workspacePathContains,
  workspacePathsEqual,
} from "@/modules/workspace";

type Input = {
  rootPath: string | null;
  workspaceRoot: string | null | undefined;
  targetIsDir: boolean;
  canOpenWorkspace: boolean;
  canOpenFolder: boolean;
  canCloseWorkspace: boolean;
};

export type ExplorerWorkspaceContext = {
  canOpenFolder: boolean;
  canCloseWorkspace: boolean;
  canOpenTargetAsWorkspace: boolean;
  canOpenRootAsWorkspace: boolean;
  canReturnToWorkspaceRoot: boolean;
  browsingOutsideWorkspace: boolean;
};

export function getExplorerWorkspaceContext({
  rootPath,
  workspaceRoot,
  targetIsDir,
  canOpenWorkspace,
  canOpenFolder,
  canCloseWorkspace,
}: Input): ExplorerWorkspaceContext {
  const hasDifferentExplorerRoot =
    !!rootPath && !workspacePathsEqual(rootPath, workspaceRoot);
  return {
    canOpenFolder,
    canCloseWorkspace: canCloseWorkspace && !!workspaceRoot,
    canOpenTargetAsWorkspace: canOpenWorkspace && targetIsDir,
    canOpenRootAsWorkspace: canOpenWorkspace && hasDifferentExplorerRoot,
    canReturnToWorkspaceRoot: !!workspaceRoot && hasDifferentExplorerRoot,
    browsingOutsideWorkspace:
      !!rootPath &&
      !!workspaceRoot &&
      !workspacePathContains(workspaceRoot, rootPath),
  };
}
