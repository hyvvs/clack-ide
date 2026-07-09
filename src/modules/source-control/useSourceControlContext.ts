import { useCallback, useMemo } from "react";
import { native } from "@/modules/ai/lib/native";
import type { SidebarViewId } from "@/modules/sidebar";
import type { Tab } from "@/modules/tabs";
import { useSourceControl } from "./useSourceControl";

function dirname(path: string | null): string | null {
  if (!path) return null;
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return normalized;
  return normalized.slice(0, idx);
}

type Params = {
  activeTab: Tab | undefined;
  tabs: Tab[];
  explorerRoot: string | null;
  sidebarView: SidebarViewId;
  cycleSidebarView: (view: SidebarViewId) => void;
  openCommitHistoryTab: (args: {
    repoRoot: string;
    branch: string | null;
  }) => void;
};

export function resolveSourceControlContextPath(
  activeTab: Tab | undefined,
  explorerRoot: string | null,
): string | null {
  if (activeTab?.kind === "editor") return dirname(activeTab.path);
  if (activeTab?.kind === "markdown") return dirname(activeTab.path);
  if (activeTab?.kind === "git-diff") return activeTab.repoRoot;
  if (activeTab?.kind === "git-commit-file") return activeTab.repoRoot;
  if (activeTab?.kind === "git-history") return activeTab.repoRoot;
  return explorerRoot;
}

/**
 * Resolves the source-control context path off the active tab and feeds the
 * source-control summary. When git is not active the badge tracks a stable
 * per-session path so tab switches / cd don't re-fire git IPC.
 */
export function useSourceControlContext({
  activeTab,
  tabs,
  explorerRoot,
  sidebarView,
  cycleSidebarView,
  openCommitHistoryTab,
}: Params) {
  const sourceControlContextPath = resolveSourceControlContextPath(
    activeTab,
    explorerRoot,
  );
  const hasOpenGitTab = useMemo(
    () =>
      tabs.some(
        (t) =>
          t.kind === "git-diff" ||
          t.kind === "git-history" ||
          t.kind === "git-commit-file",
      ),
    [tabs],
  );
  const sourceControlActive = hasOpenGitTab || sidebarView === "source-control";
  const badgeContextPath = explorerRoot;
  const sourceControlPath = sourceControlActive
    ? sourceControlContextPath
    : badgeContextPath;
  const sourceControl = useSourceControl(sourceControlPath, true);

  const toggleSourceControl = useCallback(() => {
    cycleSidebarView("source-control");
  }, [cycleSidebarView]);

  const openGitGraphFromContext = useCallback(async () => {
    const known = sourceControl.hasRepo ? sourceControl.repo : null;
    if (known) {
      openCommitHistoryTab({
        repoRoot: known.repoRoot,
        branch: sourceControl.status?.branch ?? null,
      });
      return;
    }
    if (!sourceControlContextPath) return;
    try {
      const repo = await native.gitResolveRepo(sourceControlContextPath);
      if (!repo) return;
      openCommitHistoryTab({ repoRoot: repo.repoRoot, branch: repo.branch });
    } catch {
      /* noop */
    }
  }, [
    openCommitHistoryTab,
    sourceControl.hasRepo,
    sourceControl.repo,
    sourceControl.status?.branch,
    sourceControlContextPath,
  ]);

  return { sourceControl, toggleSourceControl, openGitGraphFromContext };
}
