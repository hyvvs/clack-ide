import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  FileAddIcon,
  Folder01Icon,
  FolderAddIcon,
  Refresh01Icon,
  Search01Icon,
  ViewIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { ExplorerSearch, type ExplorerSearchHandle } from "./ExplorerSearch";
import { EntryRow, PendingRow, StatusRow, type RowActions } from "./TreeRow";
import { InlineInput } from "./InlineInput";
import {
  copyToClipboard,
  relativePath,
  revealInFinder,
} from "./lib/contextActions";
import { fileIconUrl, folderIconUrl } from "./lib/iconResolver";
import { COMPACT_CONTENT, COMPACT_ITEM } from "./lib/menuItemClass";
import { explorerActionEligibility } from "./lib/actionEligibility";
import {
  basename,
  parentPath,
  resolveCreateTarget,
  type ExplorerEntryRef,
} from "./lib/createTarget";
import {
  pruneSelection,
  selectAllVisible,
  selectionAfterClick,
  selectionForRightClick,
  selectSingle,
  visibleRange,
  type ExplorerSelectionState,
} from "./lib/selection";
import { useExplorerDnd } from "./lib/useExplorerDnd";
import { useExplorerFileDrop } from "./lib/useExplorerFileDrop";
import { useFileTree } from "./lib/useFileTree";
import { useGitStatus } from "./lib/useGitStatus";
import { planExplorerReveal } from "./lib/revealPath";
import { getExplorerWorkspaceContext } from "./lib/workspaceContext";
import type { GitStatusCode } from "./lib/gitStatusUtils";
import { useGlobalShortcuts } from "@/modules/shortcuts";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setShowHidden } from "@/modules/settings/store";
import type { GitStatusSnapshot } from "@/modules/ai/lib/native";

export type FileExplorerRevealResult =
  | { ok: true }
  | { ok: false; message: string };

export type FileExplorerHandle = {
  focus: () => void;
  isFocused: () => boolean;
  focusSearch: () => void;
  revealPath: (path: string) => FileExplorerRevealResult;
};

type Props = {
  rootPath: string | null;
  workspaceRoot?: string | null;
  activeFilePath?: string | null;
  onOpenFolder?: () => void;
  onOpenWorkspacePath?: (path: string) => void;
  onReturnToWorkspaceRoot?: () => void;
  onCloseWorkspace?: () => void;
  onOpenFile: (path: string, pin?: boolean) => void;
  onPathRenamed?: (from: string, to: string) => void;
  onPathDeleted?: (path: string) => void;
  onRevealInTerminal?: (path: string) => void;
  onAttachToAgent?: (path: string) => void;
  gitStatus?: GitStatusSnapshot | null;
};

type Row =
  | {
      kind: "entry";
      key: string;
      path: string;
      name: string;
      isDir: boolean;
      isExpanded: boolean;
      depth: number;
      gitignored: boolean;
      gitStatusCode: GitStatusCode | null;
    }
  | {
      kind: "rename";
      key: string;
      path: string;
      name: string;
      isDir: boolean;
      depth: number;
      gitignored: boolean;
      gitStatusCode: GitStatusCode | null;
    }
  | {
      kind: "pending";
      key: string;
      depth: number;
      pendingKind: "file" | "dir";
      error?: string;
    }
  | {
      kind: "status";
      key: string;
      depth: number;
      tone: "muted" | "error";
      message: string;
    };

const ROW_HEIGHT = 24;
const OVERSCAN = 8;

function buildRows(
  rootPath: string,
  tree: ReturnType<typeof useFileTree>,
  lookup: (path: string) => GitStatusCode | null,
): { rows: Row[]; entryIndexByPath: Map<string, number> } {
  const rows: Row[] = [];
  const entryIndexByPath = new Map<string, number>();

  const walk = (parent: string, depth: number, parentIgnored: boolean) => {
    const node = tree.nodes[parent];
    if (!node || node.status !== "loaded") return;
    for (const entry of node.entries) {
      const path = tree.joinPath(parent, entry.name);
      const isDir = entry.kind === "dir";
      const expanded = isDir && tree.expanded.has(path);
      const isRenaming = tree.renaming === path;
      const gitignored = parentIgnored || entry.gitignored;
      const gitStatusCode = gitignored ? null : lookup(path);
      if (isRenaming) {
        rows.push({
          kind: "rename",
          key: `rename:${path}`,
          path,
          name: entry.name,
          isDir,
          depth,
          gitignored,
          gitStatusCode,
        });
      } else {
        entryIndexByPath.set(path, rows.length);
        rows.push({
          kind: "entry",
          key: path,
          path,
          name: entry.name,
          isDir,
          isExpanded: expanded,
          depth,
          gitignored,
          gitStatusCode,
        });
      }
      if (isDir && expanded) {
        const child = tree.nodes[path];
        if (tree.pendingCreate?.parentPath === path) {
          rows.push({
            kind: "pending",
            key: `pending:${path}`,
            depth: depth + 1,
            pendingKind: tree.pendingCreate.kind,
            error: tree.pendingCreate.error,
          });
        }
        if (child?.status === "loading") {
          rows.push({
            kind: "status",
            key: `loading:${path}`,
            depth: depth + 1,
            tone: "muted",
            message: "Loading...",
          });
        } else if (child?.status === "error") {
          rows.push({
            kind: "status",
            key: `error:${path}`,
            depth: depth + 1,
            tone: "error",
            message: child.message,
          });
        } else if (child?.status === "loaded") {
          walk(path, depth + 1, gitignored);
        }
      }
    }
  };

  walk(rootPath, 0, false);
  return { rows, entryIndexByPath };
}

export const FileExplorer = memo(
  forwardRef<FileExplorerHandle, Props>(function FileExplorer(
    {
      rootPath,
      workspaceRoot,
      activeFilePath,
      onOpenFolder,
      onOpenWorkspacePath,
      onReturnToWorkspaceRoot,
      onCloseWorkspace,
      onOpenFile,
      onPathRenamed,
      onPathDeleted,
      onRevealInTerminal,
      onAttachToAgent,
      gitStatus,
    },
    ref,
  ) {
    const [selection, setSelection] = useState<ExplorerSelectionState>({
      selectedPaths: [],
      focusedPath: null,
      anchorPath: null,
    });
    const pendingRevealPathRef = useRef<string | null>(null);
    const handlePathCreated = useCallback(
      (path: string, kind: "file" | "dir") => {
        pendingRevealPathRef.current = path;
        setSelection(selectSingle(path));
        if (kind === "file") onOpenFile(path);
      },
      [onOpenFile],
    );
    const tree = useFileTree(rootPath, {
      onPathCreated: handlePathCreated,
      onPathRenamed,
      onPathDeleted,
    });
    const gitDecorations = usePreferencesStore((s) => s.explorerGitDecorations);
    const showHidden = usePreferencesStore((s) => s.showHidden);
    const { lookup: lookupGitStatus } = useGitStatus(
      rootPath,
      gitDecorations ? gitStatus : null,
      gitDecorations,
    );
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [isSearchActive, setIsSearchActive] = useState(false);
    const searchRef = useRef<ExplorerSearchHandle>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    const { rows, entryIndexByPath } = useMemo(() => {
      if (!rootPath)
        return {
          rows: [] as Row[],
          entryIndexByPath: new Map<string, number>(),
        };
      return buildRows(rootPath, tree, lookupGitStatus);
      // `tree` is intentionally omitted: its identity changes every render, but
      // the listed fields are the only inputs buildRows actually reads.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      rootPath,
      tree.nodes,
      tree.expanded,
      tree.renaming,
      tree.pendingCreate,
      lookupGitStatus,
    ]);

    const rowActions = useMemo<RowActions>(
      () => ({
        toggle: tree.toggle,
        beginRename: tree.beginRename,
        commitRename: tree.commitRename,
        cancelRename: tree.cancelRename,
      }),
      [tree.toggle, tree.beginRename, tree.commitRename, tree.cancelRename],
    );
    const renameInProgress =
      tree.renaming !== null ||
      (tree.pendingCreate !== null && !tree.pendingCreate.error);

    const [menuTarget, setMenuTarget] = useState<{
      path: string;
      name: string;
      isDir: boolean;
    } | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState(false);
    // Bumped on every right-click so the menu content remounts and the popper
    // re-anchors to the new cursor (floating-ui won't reposition on an anchor
    // change alone, only on scroll/resize).
    const [menuNonce, setMenuNonce] = useState(0);
    const menuSelectionCount =
      menuTarget && selection.selectedPaths.includes(menuTarget.path)
        ? selection.selectedPaths.length
        : menuTarget
          ? 1
          : 0;
    const workspaceContext = useMemo(
      () =>
        getExplorerWorkspaceContext({
          rootPath,
          workspaceRoot,
          targetIsDir:
            menuSelectionCount === 1 && menuTarget?.isDir === true,
          canOpenWorkspace: Boolean(onOpenWorkspacePath),
          canOpenFolder: Boolean(onOpenFolder),
          canCloseWorkspace: Boolean(onCloseWorkspace),
        }),
      [
        rootPath,
        workspaceRoot,
        menuTarget?.isDir,
        menuSelectionCount,
        onOpenWorkspacePath,
        onOpenFolder,
        onCloseWorkspace,
      ],
    );

    const entryPaths = useMemo<string[]>(() => {
      const out: string[] = [];
      for (const row of rows) if (row.kind === "entry") out.push(row.path);
      return out;
    }, [rows]);
    const selectedPathSet = useMemo(
      () => new Set(selection.selectedPaths),
      [selection.selectedPaths],
    );

    const entryRefForPath = useCallback(
      (path: string): ExplorerEntryRef | null => {
        const idx = entryIndexByPath.get(path);
        const row = idx !== undefined ? rows[idx] : undefined;
        return row?.kind === "entry"
          ? { path: row.path, isDir: row.isDir }
          : null;
      },
      [entryIndexByPath, rows],
    );

    const selectedEntries = useMemo(
      () =>
        selection.selectedPaths
          .map((path) => entryRefForPath(path))
          .filter((entry): entry is ExplorerEntryRef => entry !== null),
      [selection.selectedPaths, entryRefForPath],
    );
    const menuSelectedPaths = useMemo(() => {
      if (!menuTarget) return [];
      return selectionForRightClick(selection.selectedPaths, menuTarget.path);
    }, [menuTarget, selection.selectedPaths]);
    const menuSelectedEntries = useMemo(
      () =>
        menuSelectedPaths
          .map((path) => entryRefForPath(path))
          .filter((entry): entry is ExplorerEntryRef => entry !== null),
      [menuSelectedPaths, entryRefForPath],
    );
    const menuIsMulti = menuSelectedEntries.length > 1;
    const menuActions = useMemo(
      () => explorerActionEligibility(menuSelectedEntries),
      [menuSelectedEntries],
    );

    const isDirAt = useCallback(
      (path: string): boolean | undefined => {
        const idx = entryIndexByPath.get(path);
        const row = idx !== undefined ? rows[idx] : undefined;
        return row?.kind === "entry" ? row.isDir : undefined;
      },
      [entryIndexByPath, rows],
    );
    const dnd = useExplorerDnd({
      rootPath: rootPath ?? "",
      isDir: isDirAt,
      selectedPaths: selection.selectedPaths,
      onMove: tree.movePaths,
    });

    const fileDrop = useExplorerFileDrop({
      rootPath,
      isDir: isDirAt,
      onCopied: tree.refresh,
    });

    const dropTargetDir = dnd.dropTargetDir ?? fileDrop.externalTargetDir;
    const rootIsDropTarget =
      dropTargetDir != null && dropTargetDir === rootPath;
    useEffect(() => {
      if (!dropTargetDir || dropTargetDir === rootPath) return;
      if (tree.expanded.has(dropTargetDir)) return;
      const id = window.setTimeout(() => tree.expand(dropTargetDir), 700);
      return () => window.clearTimeout(id);
    }, [dropTargetDir, rootPath, tree.expanded, tree.expand]);

    useEffect(() => {
      setSelection((current) => pruneSelection(current, entryPaths));
    }, [entryPaths]);

    const virtualizer = useVirtualizer({
      count: rows.length,
      getScrollElement: () => scrollRef.current,
      estimateSize: () => ROW_HEIGHT,
      overscan: OVERSCAN,
      getItemKey: (index) => rows[index]?.key ?? index,
    });

    const scrollEntryIntoView = useCallback(
      (path: string) => {
        const index = entryIndexByPath.get(path);
        if (index === undefined) return;
        virtualizer.scrollToIndex(index, { align: "auto" });
      },
      [entryIndexByPath, virtualizer],
    );

    const lastSyncedActivePathRef = useRef<string | null>(null);
    useEffect(() => {
      if (
        !activeFilePath ||
        activeFilePath === lastSyncedActivePathRef.current
      ) {
        return;
      }
      if (!entryIndexByPath.has(activeFilePath)) return;
      lastSyncedActivePathRef.current = activeFilePath;
      setSelection((current) =>
        current.selectedPaths.length === 0
          ? selectSingle(activeFilePath)
          : { ...current, focusedPath: activeFilePath },
      );
      requestAnimationFrame(() => scrollEntryIntoView(activeFilePath));
    }, [activeFilePath, entryIndexByPath, scrollEntryIntoView]);

    useEffect(() => {
      const path = pendingRevealPathRef.current;
      if (!path || !entryIndexByPath.has(path)) return;
      pendingRevealPathRef.current = null;
      setSelection(selectSingle(path));
      requestAnimationFrame(() => scrollEntryIntoView(path));
    }, [entryIndexByPath, scrollEntryIntoView]);

    const revealPathInTree = useCallback(
      (path: string): FileExplorerRevealResult => {
        const plan = planExplorerReveal(rootPath, path);
        if (!plan.ok) return plan;
        for (const dir of plan.ancestorDirs) tree.expand(dir);
        containerRef.current?.focus();
        if (entryIndexByPath.has(plan.path)) {
          pendingRevealPathRef.current = null;
          setSelection(selectSingle(plan.path));
          requestAnimationFrame(() => scrollEntryIntoView(plan.path));
        } else {
          pendingRevealPathRef.current = plan.path;
        }
        return { ok: true };
      },
      [entryIndexByPath, rootPath, scrollEntryIntoView, tree.expand],
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          containerRef.current?.focus();
          if (!selection.focusedPath && entryPaths.length > 0) {
            const first = entryPaths[0];
            setSelection(selectSingle(first));
            requestAnimationFrame(() => scrollEntryIntoView(first));
          }
        },
        isFocused: () => {
          const c = containerRef.current;
          if (!c) return false;
          const active = document.activeElement;
          return active instanceof Node && c.contains(active);
        },
        focusSearch: () => {
          setIsSearchOpen(true);
          searchRef.current?.focus();
        },
        revealPath: revealPathInTree,
      }),
      [entryPaths, revealPathInTree, scrollEntryIntoView, selection.focusedPath],
    );

    useGlobalShortcuts({
      "explorer.search": () => {
        if (searchRef.current?.isFocused()) {
          setIsSearchOpen(false);
          return;
        }
        setIsSearchOpen(true);
        searchRef.current?.focus();
      },
    });

    if (!rootPath) {
      return (
        <div className="clack-panel flex h-full flex-col items-center justify-center gap-3 border-r p-6 text-center">
          <HugeiconsIcon
            icon={Folder01Icon}
            size={24}
            strokeWidth={1.5}
            className="text-[var(--clack-text-3)]"
          />
          <div className="text-xs font-medium text-[var(--clack-text-2)]">
            No workspace open
          </div>
          {onOpenFolder ? (
            <Button size="sm" className="h-8 gap-1.5" onClick={onOpenFolder}>
              <HugeiconsIcon icon={Folder01Icon} size={13} strokeWidth={1.8} />
              Open Folder...
            </Button>
          ) : null}
        </div>
      );
    }

    const root = tree.nodes[rootPath];
    const pendingAtRoot =
      tree.pendingCreate?.parentPath === rootPath ? tree.pendingCreate : null;
    const toolbarCreateTarget = resolveCreateTarget({
      rootPath,
      explorerLocation: rootPath,
      selectedEntries,
      source: "toolbar",
    });
    const beginCreate = (
      kind: "file" | "dir",
      source: "toolbar" | "context" | "empty",
      contextEntry?: ExplorerEntryRef | null,
    ) => {
      const target = resolveCreateTarget({
        rootPath,
        explorerLocation: rootPath,
        selectedEntries,
        contextEntry,
        source,
      });
      if (!target) return;
      tree.beginCreate(target, kind);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;

      if (e.key === "Escape") {
        if (tree.pendingCreate) {
          e.preventDefault();
          tree.cancelCreate();
          return;
        }
        if (tree.renaming) {
          e.preventDefault();
          tree.cancelRename();
          return;
        }
      }

      if (tree.renaming || tree.pendingCreate || isSearchOpen) return;
      if (entryPaths.length === 0) return;

      if (e.key === "Escape") {
        e.preventDefault();
        setSelection({
          selectedPaths: [],
          focusedPath: null,
          anchorPath: null,
        });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelection(selectAllVisible(entryPaths));
        return;
      }

      const currentIdx = selection.focusedPath
        ? entryPaths.indexOf(selection.focusedPath)
        : -1;
      const move = (next: number, extend = false) => {
        const clamped = Math.max(0, Math.min(entryPaths.length - 1, next));
        const path = entryPaths[clamped];
        if (extend) {
          setSelection((current) => ({
            selectedPaths: visibleRange(
              entryPaths,
              current.anchorPath ?? current.focusedPath ?? path,
              path,
            ),
            focusedPath: path,
            anchorPath: current.anchorPath ?? current.focusedPath ?? path,
          }));
        } else {
          setSelection(selectSingle(path));
        }
        requestAnimationFrame(() => scrollEntryIntoView(path));
      };

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          move(currentIdx < 0 ? 0 : currentIdx + 1, e.shiftKey);
          break;
        case "ArrowUp":
          e.preventDefault();
          move(
            currentIdx < 0 ? entryPaths.length - 1 : currentIdx - 1,
            e.shiftKey,
          );
          break;
        case "ArrowRight": {
          if (currentIdx < 0) return;
          e.preventDefault();
          const path = entryPaths[currentIdx];
          const idx = entryIndexByPath.get(path);
          if (idx === undefined) break;
          const row = rows[idx];
          if (row.kind !== "entry") break;
          if (row.isDir) {
            if (!row.isExpanded) tree.toggle(row.path);
            else move(currentIdx + 1);
          }
          break;
        }
        case "ArrowLeft": {
          if (currentIdx < 0) return;
          e.preventDefault();
          const path = entryPaths[currentIdx];
          const idx = entryIndexByPath.get(path);
          if (idx === undefined) break;
          const row = rows[idx];
          if (row.kind !== "entry") break;
          if (row.isDir && row.isExpanded) {
            tree.toggle(row.path);
          } else {
            const parent = parentPath(row.path, rootPath);
            if (parent && parent !== rootPath) setSelection(selectSingle(parent));
          }
          break;
        }
        case "Enter": {
          if (currentIdx < 0) return;
          e.preventDefault();
          const path = entryPaths[currentIdx];
          const idx = entryIndexByPath.get(path);
          if (idx === undefined) break;
          const row = rows[idx];
          if (row.kind !== "entry") break;
          if (row.isDir) tree.toggle(row.path);
          else onOpenFile(row.path);
          break;
        }
      }
    };

    const handleRowSelect = (
      path: string,
      event: React.MouseEvent<HTMLButtonElement>,
    ) => {
      setSelection((current) =>
        selectionAfterClick({
          visiblePaths: entryPaths,
          state: current,
          path,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        }),
      );
    };

    const renderRow = (row: Row) => {
      switch (row.kind) {
        case "entry":
        case "rename": {
          return (
            <EntryRow
              path={row.path}
              name={row.name}
              isDir={row.isDir}
              isExpanded={row.kind === "entry" ? row.isExpanded : false}
              depth={row.depth}
              actions={rowActions}
              renameInProgress={renameInProgress}
              isSelected={selectedPathSet.has(row.path)}
              isFocused={selection.focusedPath === row.path}
              isActiveFile={activeFilePath === row.path}
              isRenaming={row.kind === "rename"}
              isDropTarget={dropTargetDir === row.path}
              onOpenFile={onOpenFile}
              onSelectPath={handleRowSelect}
              gitStatusCode={row.gitStatusCode}
              gitignored={gitDecorations && row.gitignored}
            />
          );
        }
        case "pending":
          return (
            <PendingRow
              depth={row.depth}
              kind={row.pendingKind}
              error={row.error}
              onCommit={tree.commitCreate}
              onCancel={tree.cancelCreate}
              onValueChange={tree.clearCreateError}
            />
          );
        case "status":
          return (
            <StatusRow
              depth={row.depth}
              message={row.message}
              tone={row.tone}
            />
          );
      }
    };

    return (
      <div
        ref={containerRef}
        className="clack-panel flex h-full flex-col border-r outline-none"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <div className="clack-shell flex h-8 shrink-0 items-center gap-1 border-b px-2">
          <span
            className="flex flex-1 items-center truncate text-xs font-semibold text-[var(--clack-text-2)]"
            title={rootPath}
          >
            <img
              src={folderIconUrl(basename(rootPath), false)}
              alt=""
              height={15}
              width={15}
              className="mx-1.5"
            />
            {basename(rootPath)}
          </span>

          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => setIsSearchOpen((v) => !v)}
            title="Search files"
            aria-label="Search files"
          >
            <HugeiconsIcon icon={Search01Icon} size={13} strokeWidth={2} />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => beginCreate("file", "toolbar")}
            title={
              toolbarCreateTarget
                ? `New file in ${toolbarCreateTarget}`
                : "New file"
            }
          >
            <HugeiconsIcon icon={FileAddIcon} size={13} strokeWidth={2} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => beginCreate("dir", "toolbar")}
            title={
              toolbarCreateTarget
                ? `New folder in ${toolbarCreateTarget}`
                : "New folder"
            }
          >
            <HugeiconsIcon icon={FolderAddIcon} size={13} strokeWidth={2} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "size-6",
              showHidden && "bg-[var(--clack-accent-soft)] text-[var(--clack-text-1)]",
            )}
            onClick={() => void setShowHidden(!showHidden)}
            title={showHidden ? "Hide hidden files" : "Show hidden files"}
            aria-label={showHidden ? "Hide hidden files" : "Show hidden files"}
          >
            <HugeiconsIcon
              icon={showHidden ? ViewIcon : ViewOffIcon}
              size={13}
              strokeWidth={2}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => tree.refresh(rootPath)}
            title="Refresh"
          >
            <HugeiconsIcon icon={Refresh01Icon} size={12} strokeWidth={2} />
          </Button>
        </div>

        {workspaceContext.browsingOutsideWorkspace ? (
          <div className="flex shrink-0 items-center gap-1 border-b border-[var(--clack-border-subtle)] bg-[var(--clack-surface-raised)] px-2 py-1 text-[10.5px] text-[var(--clack-text-3)]">
            <span className="min-w-0 flex-1 truncate">
              Browsing outside workspace
            </span>
            {workspaceContext.canOpenRootAsWorkspace && rootPath ? (
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-[var(--clack-text-2)] hover:bg-[var(--clack-accent-soft)] hover:text-[var(--clack-text-1)]"
                onClick={() => onOpenWorkspacePath?.(rootPath)}
              >
                Open as Workspace
              </button>
            ) : null}
            {workspaceContext.canReturnToWorkspaceRoot ? (
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-[var(--clack-text-2)] hover:bg-[var(--clack-accent-soft)] hover:text-[var(--clack-text-1)]"
                onClick={() => onReturnToWorkspaceRoot?.()}
              >
                Return
              </button>
            ) : null}
          </div>
        ) : null}

        {tree.pendingCreate ? (
          <div className="flex shrink-0 items-center gap-1 border-b border-[var(--clack-border-subtle)] bg-[var(--clack-surface-raised)] px-2 py-1 text-[10.5px]">
            <span className="text-[var(--clack-text-3)]">
              {tree.pendingCreate.kind === "dir" ? "New folder in" : "New file in"}
            </span>
            <span
              className="min-w-0 flex-1 truncate text-[var(--clack-text-2)]"
              title={tree.pendingCreate.parentPath}
            >
              {tree.pendingCreate.parentPath}
            </span>
            {tree.pendingCreate.error ? (
              <span
                className="min-w-0 max-w-[45%] truncate text-[var(--clack-danger)]"
                title={tree.pendingCreate.error}
              >
                {tree.pendingCreate.error}
              </span>
            ) : null}
          </div>
        ) : null}

        <ExplorerSearch
          ref={searchRef}
          rootPath={rootPath}
          onOpenFile={onOpenFile}
          open={isSearchOpen}
          onRequestClose={() => setIsSearchOpen(false)}
          onActiveChange={setIsSearchActive}
          onRevealInTerminal={onRevealInTerminal}
          onAttachToAgent={onAttachToAgent}
        />

        {!isSearchActive ? (
          <ContextMenu
            onOpenChange={(open) => {
              if (!open) setDeleteConfirm(false);
            }}
          >
            <ContextMenuTrigger asChild>
              <div
                ref={scrollRef}
                data-explorer-drop=""
                className={cn(
                  "min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]",
                  rootIsDropTarget &&
                    "rounded-[var(--clack-radius-button)] ring-1 ring-inset ring-[var(--clack-focus)]",
                )}
                role="tree"
                aria-multiselectable="true"
                onPointerDown={(e) => {
                  if (
                    tree.pendingCreate?.error &&
                    !(e.target as HTMLElement).closest("[data-pending-create]")
                  ) {
                    tree.cancelCreate();
                  }
                  dnd.onPointerDown(e);
                  if (e.button !== 0) return;
                  const el = (e.target as HTMLElement).closest<HTMLElement>(
                    "[data-fs-path]",
                  );
                  if (!el) {
                    setSelection({
                      selectedPaths: [],
                      focusedPath: null,
                      anchorPath: null,
                    });
                  }
                }}
                onClickCapture={dnd.onClickCapture}
                onContextMenuCapture={(e) => {
                  if (
                    tree.pendingCreate?.error &&
                    !(e.target as HTMLElement).closest("[data-pending-create]")
                  ) {
                    tree.cancelCreate();
                  }
                  const el = (e.target as HTMLElement).closest<HTMLElement>(
                    "[data-fs-path]",
                  );
                  const path = el?.getAttribute("data-fs-path") ?? null;
                  const idx =
                    path != null ? entryIndexByPath.get(path) : undefined;
                  const row = idx !== undefined ? rows[idx] : undefined;
                  if (row && row.kind === "entry") {
                    const nextPaths = selectionForRightClick(
                      selection.selectedPaths,
                      row.path,
                    );
                    setSelection({
                      selectedPaths: nextPaths,
                      focusedPath: row.path,
                      anchorPath: row.path,
                    });
                  } else {
                    setSelection({
                      selectedPaths: [],
                      focusedPath: null,
                      anchorPath: null,
                    });
                  }
                  setMenuTarget(
                    row && row.kind === "entry"
                      ? { path: row.path, name: row.name, isDir: row.isDir }
                      : null,
                  );
                  setDeleteConfirm(false);
                  setMenuNonce((n) => n + 1);
                }}
              >
                {pendingAtRoot ? (
                  <div
                    data-pending-create=""
                    className="flex h-6 w-full min-w-0 items-center gap-2 px-1.5 text-[13px]"
                    style={{ paddingLeft: 6 }}
                  >
                    <span className="size-3.5 shrink-0" />
                    <img
                      src={
                        pendingAtRoot.kind === "dir"
                          ? folderIconUrl("", false)
                          : fileIconUrl("untitled")
                      }
                      alt=""
                      className="size-4 shrink-0 opacity-70"
                    />
                    <InlineInput
                      initial=""
                      placeholder={
                        pendingAtRoot.kind === "dir" ? "New folder" : "New file"
                      }
                      commitOnBlur={!pendingAtRoot.error}
                      onCommit={tree.commitCreate}
                      onCancel={tree.cancelCreate}
                      onValueChange={tree.clearCreateError}
                    />
                  </div>
                ) : null}
                {root?.status === "loading" && (
                  <div className="px-3 py-2 text-[11px] text-[var(--clack-text-3)]">
                    Loading...
                  </div>
                )}
                {root?.status === "error" && (
                  <div className="px-3 py-2 text-[11px] text-[var(--clack-danger)]">
                    {root.message}
                  </div>
                )}
                {root?.status === "loaded" ? (
                  <div
                    style={{
                      height: virtualizer.getTotalSize(),
                      position: "relative",
                      width: "100%",
                    }}
                  >
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                      const row = rows[virtualRow.index];
                      if (!row) return null;
                      return (
                        <div
                          key={virtualRow.key}
                          data-virtual-row-index={virtualRow.index}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            height: virtualRow.size,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          {renderRow(row)}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent
              key={menuNonce}
              className={COMPACT_CONTENT}
              onCloseAutoFocus={(e) => {
                if (tree.renaming || tree.pendingCreate) e.preventDefault();
              }}
            >
              {menuTarget ? (
                <>
                  {workspaceContext.canOpenTargetAsWorkspace && (
                    <>
                      <ContextMenuItem
                        className={COMPACT_ITEM}
                        onSelect={() => onOpenWorkspacePath?.(menuTarget.path)}
                      >
                        Open as Workspace
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                    </>
                  )}
                  {menuActions.canOpenFile && (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => onOpenFile(menuTarget.path, true)}
                    >
                      Open
                    </ContextMenuItem>
                  )}
                  {menuActions.canOpenFolderInTerminal && onRevealInTerminal && (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => onRevealInTerminal(menuTarget.path)}
                    >
                      Open in Terminal
                    </ContextMenuItem>
                  )}
                  {menuActions.canRevealSingle ? (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => void revealInFinder(menuTarget.path)}
                    >
                      Reveal in Finder
                    </ContextMenuItem>
                  ) : null}
                  {menuActions.canRevealSingle ? <ContextMenuSeparator /> : null}
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() =>
                      beginCreate(
                        "file",
                        "context",
                        menuIsMulti ? null : menuSelectedEntries[0],
                      )
                    }
                  >
                    {menuIsMulti ? "New File in Current Folder" : "New File"}
                  </ContextMenuItem>
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() =>
                      beginCreate(
                        "dir",
                        "context",
                        menuIsMulti ? null : menuSelectedEntries[0],
                      )
                    }
                  >
                    {menuIsMulti ? "New Folder in Current Folder" : "New Folder"}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => void copyToClipboard(menuSelectedPaths.join("\n"))}
                  >
                    {menuIsMulti ? "Copy Paths" : "Copy Path"}
                  </ContextMenuItem>
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() =>
                      void copyToClipboard(
                        menuSelectedPaths
                          .map((path) => relativePath(rootPath, path))
                          .join("\n"),
                      )
                    }
                  >
                    {menuIsMulti ? "Copy Relative Paths" : "Copy Relative Path"}
                  </ContextMenuItem>
                  {menuActions.canAttachSingle ? (
                    <>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        className={COMPACT_ITEM}
                        onSelect={() => onAttachToAgent?.(menuTarget.path)}
                      >
                        Attach to Agent
                      </ContextMenuItem>
                    </>
                  ) : null}
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    variant="destructive"
                    onSelect={(e) => {
                      e.preventDefault();
                      if (deleteConfirm) {
                        void tree.deletePaths(menuSelectedPaths).then(() =>
                          setSelection({
                            selectedPaths: [],
                            focusedPath: null,
                            anchorPath: null,
                          }),
                        );
                      } else {
                        setDeleteConfirm(true);
                      }
                    }}
                  >
                    {deleteConfirm
                      ? "Click again to confirm"
                      : menuIsMulti
                        ? `Delete ${menuSelectedPaths.length} Items`
                        : "Delete"}
                  </ContextMenuItem>
                </>
              ) : (
                <>
                  {workspaceContext.canOpenFolder && (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => onOpenFolder?.()}
                    >
                      Open Folder...
                    </ContextMenuItem>
                  )}
                  {workspaceContext.canOpenRootAsWorkspace && rootPath ? (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => onOpenWorkspacePath?.(rootPath)}
                    >
                      Open as Workspace
                    </ContextMenuItem>
                  ) : null}
                  {workspaceContext.canReturnToWorkspaceRoot ? (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => onReturnToWorkspaceRoot?.()}
                    >
                      Return to Workspace Root
                    </ContextMenuItem>
                  ) : null}
                  {workspaceContext.canCloseWorkspace ? (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => onCloseWorkspace?.()}
                    >
                      Close Workspace
                    </ContextMenuItem>
                  ) : null}
                  {workspaceContext.canOpenFolder ||
                  workspaceContext.canOpenRootAsWorkspace ||
                  workspaceContext.canReturnToWorkspaceRoot ||
                  workspaceContext.canCloseWorkspace ? (
                    <ContextMenuSeparator />
                  ) : null}
                  {onRevealInTerminal && (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => onRevealInTerminal(rootPath)}
                    >
                      Open in Terminal
                    </ContextMenuItem>
                  )}
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => void revealInFinder(rootPath)}
                  >
                    Reveal in Finder
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => beginCreate("file", "empty")}
                  >
                    New File
                  </ContextMenuItem>
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => beginCreate("dir", "empty")}
                  >
                    New Folder
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => void copyToClipboard(rootPath)}
                  >
                    Copy Path
                  </ContextMenuItem>
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => tree.refresh(rootPath)}
                  >
                    Refresh
                  </ContextMenuItem>
                </>
              )}
            </ContextMenuContent>
          </ContextMenu>
        ) : null}

        {dnd.dragLabel ? (
          <div
            ref={dnd.ghostRef}
            className="clack-card pointer-events-none fixed left-0 top-0 z-50 flex items-center gap-1.5 px-2 py-1 text-[12px] text-[var(--clack-text-1)] shadow-md"
          >
            {dnd.dragLabel}
          </div>
        ) : null}
      </div>
    );
  }),
);
