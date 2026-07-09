import { useCallback, useEffect, useRef } from "react";
import type { Tab } from "./useTabs";

type Result = {
  explorerRoot: string | null;
  inheritedCwdForNewTab: () => string | undefined;
};

export function resolveExplorerRoot(
  workspaceRoot: string | null,
): string | null {
  return workspaceRoot;
}

export function resolveNewTerminalCwd(
  workspaceRoot: string | null,
  lastTerminalCwd: string | null,
  home: string | null,
): string | undefined {
  return workspaceRoot ?? lastTerminalCwd ?? home ?? undefined;
}

export function useWorkspaceCwd(
  activeTab: Tab | undefined,
  workspaceRoot: string | null,
  home: string | null,
): Result {
  const lastTerminalCwd = useRef<string | null>(null);

  useEffect(() => {
    if (activeTab?.kind === "terminal" && activeTab.cwd) {
      lastTerminalCwd.current = activeTab.cwd;
    }
  }, [activeTab]);

  const inheritedCwdForNewTab = useCallback((): string | undefined => {
    return resolveNewTerminalCwd(workspaceRoot, lastTerminalCwd.current, home);
  }, [workspaceRoot, home]);

  return {
    explorerRoot: resolveExplorerRoot(workspaceRoot),
    inheritedCwdForNewTab,
  };
}
