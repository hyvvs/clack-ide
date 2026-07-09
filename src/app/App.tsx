import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getLaunchDir } from "@/lib/launchDir";
import { usePresence } from "@/lib/usePresence";
import { quoteShellArg } from "@/lib/shellQuote";
import { useZoom } from "@/lib/useZoom";
import { AgentNotificationsBridge } from "@/modules/agents";
import {
  AgentRunBridge,
  AiMiniWindow,
  LocalAgentNotificationsBridge,
  SelectionAskAi,
  useAiBootstrap,
  useAiLiveBridge,
  useChatStore,
  useSelectionAskAi,
} from "@/modules/ai";
import { AiComposerProvider } from "@/modules/ai/lib/composer";
import { native } from "@/modules/ai/lib/native";
import { CommandPalette, createCommandItems } from "@/modules/command-palette";
import {
  NewEditorDialog,
  useEditorFileSync,
  type EditorPaneHandle,
} from "@/modules/editor";
import { FileExplorer, type FileExplorerHandle } from "@/modules/explorer";
import {
  copyToClipboard,
  revealInFinder,
} from "@/modules/explorer/lib/contextActions";
import type { GitHistorySearchHandle } from "@/modules/git-history";
import {
  Header,
  type SearchInlineHandle,
  type SearchTarget,
} from "@/modules/header";
import type { PreviewPaneHandle } from "@/modules/preview";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { isMarkdownPath } from "@/lib/utils";
import {
  useGlobalShortcuts,
  type ShortcutHandlers,
  type ShortcutId,
} from "@/modules/shortcuts";
import {
  SidebarRail,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useSidebarPanel,
} from "@/modules/sidebar";
import {
  SourceControlPanel,
  useSourceControlContext,
} from "@/modules/source-control";
import { StatusBar } from "@/modules/statusbar";
import {
  MAX_PANES_PER_TAB,
  type TerminalTab,
  useTabs,
  useWindowTitle,
  useWorkspaceCwd,
} from "@/modules/tabs";
import {
  clearFocusedTerminal,
  disposeSession,
  findLeafCwd,
  hasLeaf,
  leafIds,
  navigateFocusedBlocks,
  respawnSession,
  type TerminalPaneHandle,
  useTerminalFileDrop,
  writeToSession,
} from "@/modules/terminal";
import {
  isTerminalTab as isTerminalKind,
  isWorkspaceTab,
  selectActiveTerminalId,
  selectActiveWorkspaceId,
} from "@/modules/terminal/lib/dockState";
import {
  SpaceSwitcher,
  useSpaces,
  useSpacePersistence,
  useSpacesBoot,
} from "@/modules/spaces";
import { DEFAULT_SPACE_ID } from "@/modules/tabs/lib/useTabs";
import { ThemeProvider, useThemeFileEditing } from "@/modules/theme";
import {
  loadRecentWorkspaces,
  LOCAL_WORKSPACE,
  findWorkspaceByRoot,
  normalizeWorkspacePath,
  pickWorkspaceFolder,
  recordRecentWorkspace,
  removeRecentWorkspace,
  workspacePathContains,
  workspacePathsEqual,
  useWorkspaceEnvStore,
  workspaceName,
  type RecentWorkspace,
  type WorkspaceEnv,
} from "@/modules/workspace";
import type { SearchAddon } from "@xterm/addon-search";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CloseDialogs } from "./components/CloseDialogs";
import { TerminalDock } from "./components/TerminalDock";
import {
  TOGGLE_BLOCK_INPUT_EVENT,
  WorkspaceInputBar,
} from "./components/WorkspaceInputBar";
import { WorkspaceSurface } from "./components/WorkspaceSurface";
import { useTabCloseGuards } from "./hooks/useTabCloseGuards";
import { useWorkspaceSwitcher } from "./hooks/useWorkspaceSwitcher";

const TERMINAL_DOCK_HEIGHT_KEY = "clack.terminalDock.height";
const TERMINAL_DOCK_COLLAPSED_KEY = "clack.terminalDock.collapsed";
const TERMINAL_DOCK_DEFAULT_HEIGHT = 260;

function readTerminalDockHeight(): number {
  if (typeof window === "undefined") return TERMINAL_DOCK_DEFAULT_HEIGHT;
  try {
    const raw = window.localStorage.getItem(TERMINAL_DOCK_HEIGHT_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed)) {
      return Math.min(720, Math.max(160, Math.round(parsed)));
    }
  } catch {
    // ignore storage failures
  }
  return TERMINAL_DOCK_DEFAULT_HEIGHT;
}

function readTerminalDockCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TERMINAL_DOCK_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export default function App() {
  const {
    tabs,
    activeId,
    setActiveId,
    allocId,
    replaceTabs,
    moveTabToSpace,
    reorderTab,
    newTabInSpace,
    removeTabsForSpace,
    removeWorkspaceTabsForSpace,
    ensureTerminalInSpace,
    markBooted,
    setActiveSpaceForNewTabs,
    newTab,
    newBlockTab,
    newAgentTab,
    newPrivateTab,
    openFileTab,
    pinTab,
    newPreviewTab,
    newMarkdownTab,
    setMarkdownView,
    openAiDiffTab,
    closeAiDiffTab,
    openGitDiffTab,
    openCommitHistoryTab,
    openCommitFileDiffTab,
    closeTab,
    updateTab,
    setLeafCwd,
    focusPane,
    focusNextPaneInTab,
    splitPane,
    splitActivePane,
    closeActivePane,
    closePaneByLeaf,
    resetWorkspace,
  } = useTabs(getLaunchDir() ? { cwd: getLaunchDir() } : undefined);

  // Mirror `tabs` into a ref so callbacks scheduled with `setTimeout`
  // (e.g. cdInNewTab) read the latest pane state instead of a stale closure.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const activeTab = useMemo(
    () => tabs.find((x) => x.id === activeId),
    [tabs, activeId],
  );

  const searchAddons = useRef<Map<number, SearchAddon>>(new Map());
  const [activeSearchAddon, setActiveSearchAddon] =
    useState<SearchAddon | null>(null);
  const searchInlineRef = useRef<SearchInlineHandle | null>(null);
  const terminalRefs = useRef<Map<number, TerminalPaneHandle>>(new Map());
  const editorRefs = useRef<Map<number, EditorPaneHandle>>(new Map());
  const previewRefs = useRef<Map<number, PreviewPaneHandle>>(new Map());
  const [activeEditorHandle, setActiveEditorHandle] =
    useState<EditorPaneHandle | null>(null);
  const [gitHistoryHandle, setGitHistoryHandle] =
    useState<GitHistorySearchHandle | null>(null);
  const { zoomIn, zoomOut, zoomReset } = useZoom();
  useTerminalFileDrop();
  const explorerRef = useRef<FileExplorerHandle>(null);

  // Drives session disposal off the pane tree, not React lifecycles —
  // split/unsplit re-mount components but the leaf is still live.
  const liveLeavesRef = useRef<Set<number>>(new Set());

  const clearWorkspaceState = useCallback(() => {
    for (const id of liveLeavesRef.current) disposeSession(id);
    searchAddons.current.clear();
    terminalRefs.current.clear();
    editorRefs.current.clear();
    previewRefs.current.clear();
    setActiveSearchAddon(null);
    setActiveEditorHandle(null);
  }, []);

  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const setWorkspaceEnv = useWorkspaceEnvStore((s) => s.setEnv);
  const { home, launchCwd, launchCwdResolved, switchWorkspace } =
    useWorkspaceSwitcher({
      tabsRef,
      workspaceEnv,
      setWorkspaceEnv,
      resetWorkspace,
      clearWorkspaceState,
    });

  const activeSpaceId = useSpaces((s) => s.activeId);
  const spaces = useSpaces((s) => s.spaces);
  const spacesHydrated = useSpaces((s) => s.hydrated);
  const activeSpace = useMemo(
    () => spaces.find((space) => space.id === activeSpaceId) ?? null,
    [spaces, activeSpaceId],
  );
  const activeWorkspaceRoot = activeSpace?.root ?? null;
  const activeExplorerLocation =
    activeSpace?.explorerPath ?? activeWorkspaceRoot;

  useSpacesBoot({
    ready: launchCwdResolved,
    launchCwd,
    home,
    allocId,
    replaceTabs,
    markBooted,
    setActiveSpaceForNewTabs,
  });

  useSpacePersistence({
    tabs,
    activeId,
    activeSpaceId: activeSpaceId ?? DEFAULT_SPACE_ID,
    enabled: spacesHydrated,
  });

  const prevSpaceRef = useRef(activeSpaceId);
  useEffect(() => {
    if (!spacesHydrated || !activeSpaceId) return;
    setActiveSpaceForNewTabs(activeSpaceId);
    const prev = prevSpaceRef.current;
    prevSpaceRef.current = activeSpaceId;
    if (prev === null || prev === activeSpaceId) return;
    const inSpace = tabsRef.current.filter((t) => t.spaceId === activeSpaceId);
    if (inSpace.length === 0) return;
    // Keep the active tab if it already belongs to the newly active space (a
    // cross-space jump set it explicitly); else fall to the space's last tab.
    if (inSpace.some((t) => t.id === activeId)) return;
    setActiveId(inSpace[inSpace.length - 1].id);
  }, [
    activeSpaceId,
    activeId,
    spacesHydrated,
    setActiveSpaceForNewTabs,
    setActiveId,
  ]);

  const [switcherOpen, setSwitcherOpen] = useState(false);

  const spaceTabs = useMemo(
    () => tabs.filter((t) => t.spaceId === (activeSpaceId ?? DEFAULT_SPACE_ID)),
    [tabs, activeSpaceId],
  );
  const workspaceTabs = useMemo(
    () => spaceTabs.filter(isWorkspaceTab),
    [spaceTabs],
  );
  const terminalTabs = useMemo(
    () => spaceTabs.filter(isTerminalKind),
    [spaceTabs],
  );
  const [lastWorkspaceTabId, setLastWorkspaceTabId] = useState<number | null>(
    null,
  );
  const [lastTerminalTabId, setLastTerminalTabId] = useState<number | null>(
    null,
  );
  const activeWorkspaceId = useMemo(
    () => selectActiveWorkspaceId(spaceTabs, activeId, lastWorkspaceTabId),
    [spaceTabs, activeId, lastWorkspaceTabId],
  );
  const activeTerminalId = useMemo(
    () => selectActiveTerminalId(spaceTabs, activeId, lastTerminalTabId),
    [spaceTabs, activeId, lastTerminalTabId],
  );
  const activeWorkspaceTab = useMemo(
    () => tabs.find((x) => x.id === activeWorkspaceId),
    [tabs, activeWorkspaceId],
  );
  const activeTerminalTab = useMemo(
    () =>
      tabs.find(
        (x): x is TerminalTab =>
          x.id === activeTerminalId && x.kind === "terminal",
      ),
    [tabs, activeTerminalId],
  );
  const activeLeafId = activeTerminalTab?.activeLeafId ?? null;

  const [terminalDockHeight, setTerminalDockHeightState] = useState(
    readTerminalDockHeight,
  );
  const [terminalDockCollapsed, setTerminalDockCollapsedState] = useState(
    readTerminalDockCollapsed,
  );

  const activeTabKind = activeTab?.kind;
  const activeTabId = activeTab?.id;
  useEffect(() => {
    if (activeTabKind === "terminal" && activeTabId !== undefined) {
      setLastTerminalTabId(activeTabId);
      setTerminalDockCollapsedState(false);
      try {
        window.localStorage.setItem(TERMINAL_DOCK_COLLAPSED_KEY, "false");
      } catch {
        // ignore storage failures
      }
    } else if (activeTabId !== undefined) {
      setLastWorkspaceTabId(activeTabId);
    }
  }, [activeTabKind, activeTabId]);

  const setTerminalDockHeight = useCallback((height: number) => {
    setTerminalDockHeightState(height);
    try {
      window.localStorage.setItem(TERMINAL_DOCK_HEIGHT_KEY, String(height));
    } catch {
      // ignore storage failures
    }
  }, []);

  const setTerminalDockCollapsed = useCallback((collapsed: boolean) => {
    setTerminalDockCollapsedState(collapsed);
    try {
      window.localStorage.setItem(
        TERMINAL_DOCK_COLLAPSED_KEY,
        String(collapsed),
      );
    } catch {
      // ignore storage failures
    }
  }, []);

  useEffect(() => {
    if (terminalDockCollapsed || activeTerminalId === null) return;
    const activeTerminal = terminalTabs.find(
      (tab) => tab.id === activeTerminalId,
    );
    if (activeTerminal?.cold) setActiveId(activeTerminalId);
  }, [terminalDockCollapsed, activeTerminalId, terminalTabs, setActiveId]);

  const {
    sidebarRef,
    sidebarWidthRef,
    sidebarView,
    persistSidebarView,
    toggleSidebar,
    cycleSidebarView,
    persistSidebarWidth,
    toggleExplorerFocus,
    showExplorer,
  } = useSidebarPanel(explorerRef);

  const [newEditorOpen, setNewEditorOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [paletteInitialMode, setPaletteInitialMode] = useState<
    "commands" | "content"
  >("commands");
  const openCommandPalette = useCallback(
    (mode: "commands" | "content" = "commands") => {
      setPaletteInitialMode(mode);
      setCommandPaletteOpen(true);
    },
    [],
  );
  const miniOpen = useChatStore((s) => s.mini.open);
  const miniPresence = usePresence(miniOpen, 200);
  const openMini = useChatStore((s) => s.openMini);
  const focusInput = useChatStore((s) => s.focusInput);
  const openPanel = useChatStore((s) => s.openPanel);
  const panelOpen = useChatStore((s) => s.panelOpen);
  const setLive = useChatStore((s) => s.setLive);
  const respondToApproval = useChatStore((s) => s.respondToApproval);

  const { hasComposer, keysLoaded } = useAiBootstrap();

  const isTerminalTab = activeTab?.kind === "terminal";
  const isBlockTab = activeTerminalTab?.blocks === true;
  const isEditorTab = activeTab?.kind === "editor";
  const isGitHistoryTab = activeTab?.kind === "git-history";

  useEditorFileSync({ tabs, tabsRef, editorRefs });
  useThemeFileEditing({ tabsRef, openFileTab });

  const { explorerRoot, inheritedCwdForNewTab } = useWorkspaceCwd(
    activeTerminalTab ?? activeTab,
    activeWorkspaceRoot,
    launchCwd ?? home,
  );
  const explorerLocation = explorerRoot
    ? (activeExplorerLocation ?? explorerRoot)
    : null;
  const explorerBrowsingOutsideWorkspace =
    !!explorerRoot &&
    !!explorerLocation &&
    !workspacePathContains(explorerRoot, explorerLocation);
  const explorerLocationDiffersFromRoot =
    !!explorerRoot &&
    !!explorerLocation &&
    !workspacePathsEqual(explorerRoot, explorerLocation);

  useWindowTitle(activeTab, explorerRoot);

  useEffect(() => {
    setActiveSearchAddon(
      activeLeafId !== null
        ? (searchAddons.current.get(activeLeafId) ?? null)
        : null,
    );
    setActiveEditorHandle(editorRefs.current.get(activeId) ?? null);
  }, [activeId, activeLeafId]);

  const handleSearchReady = useCallback(
    (leafId: number, addon: SearchAddon) => {
      searchAddons.current.set(leafId, addon);
      if (leafId === activeLeafId) setActiveSearchAddon(addon);
    },
    [activeLeafId],
  );

  const disposeTab = useCallback(
    (id: number) => {
      // Terminal-leaf-keyed maps (terminalRefs/searchAddons) are pruned by
      // the effect below as the pane tree changes; only the tab-id-keyed
      // handles need explicit cleanup here.
      editorRefs.current.delete(id);
      previewRefs.current.delete(id);
      closeTab(id);
    },
    [closeTab],
  );

  const {
    pendingCloseTab,
    pendingTerminalCloseTab,
    pendingDeleteTabs,
    handleClose,
    confirmClose,
    cancelClose,
    confirmTerminalClose,
    cancelTerminalClose,
    confirmDeleteClose,
    cancelDeleteClose,
    handlePathDeleted,
  } = useTabCloseGuards({ tabs, disposeTab });

  useEffect(() => {
    const live = new Set<number>();
    for (const t of tabs) {
      if (t.kind === "terminal") {
        for (const id of leafIds(t.paneTree)) live.add(id);
      }
    }
    for (const id of liveLeavesRef.current) {
      if (!live.has(id)) disposeSession(id);
    }
    liveLeavesRef.current = live;
    for (const k of [...terminalRefs.current.keys()])
      if (!live.has(k)) terminalRefs.current.delete(k);
    for (const k of [...searchAddons.current.keys()])
      if (!live.has(k)) searchAddons.current.delete(k);
  }, [tabs]);

  const cycleTab = useCallback(
    (delta: 1 | -1) => {
      const active = tabsRef.current.find((t) => t.id === activeId);
      const scoped = tabsRef.current.filter((t) => {
        if (t.spaceId !== (activeSpaceId ?? DEFAULT_SPACE_ID)) return false;
        return active?.kind === "terminal"
          ? t.kind === "terminal"
          : t.kind !== "terminal";
      });
      if (scoped.length < 2) return;
      const idx = scoped.findIndex((t) => t.id === activeId);
      const nextIdx = (idx + delta + scoped.length) % scoped.length;
      setActiveId(scoped[nextIdx].id);
    },
    [activeId, activeSpaceId, setActiveId],
  );

  const cycleSpace = useCallback((delta: 1 | -1) => {
    const { spaces, activeId: sid, setActive } = useSpaces.getState();
    if (spaces.length < 2) return;
    const idx = spaces.findIndex((s) => s.id === sid);
    const next = (idx + delta + spaces.length) % spaces.length;
    setActive(spaces[next].id);
  }, []);

  const captureActiveSelection = useCallback((): string | null => {
    const t = tabs.find((x) => x.id === activeId);
    if (!t) return null;
    if (t.kind === "terminal") {
      const lid = t.activeLeafId;
      return terminalRefs.current.get(lid)?.getSelection() ?? null;
    }
    if (t.kind === "editor") {
      return editorRefs.current.get(activeId)?.getSelection() ?? null;
    }
    return null;
  }, [tabs, activeId]);

  const togglePanelAndFocus = useCallback(() => {
    if (!hasComposer) {
      void openSettingsWindow("models");
      return;
    }
    if (panelOpen) {
      useChatStore.getState().closePanel();
    } else {
      openPanel();
      focusInput(null);
    }
  }, [hasComposer, panelOpen, openPanel, focusInput]);

  const attachSelection = useChatStore((s) => s.attachSelection);

  const handleAttachFileToAgent = useCallback(
    (path: string) => {
      if (!hasComposer) {
        void openSettingsWindow("models");
        return;
      }
      // Dispatch a window event the composer listens for. Same pattern as
      // selections — keeps file-explorer decoupled from the AI module.
      window.dispatchEvent(
        new CustomEvent<string>("terax:ai-attach-file", { detail: path }),
      );
      openPanel();
      focusInput(null);
    },
    [hasComposer, openPanel, focusInput],
  );

  const askFromSelection = useCallback(() => {
    if (!hasComposer) {
      void openSettingsWindow("models");
      return;
    }
    const selection = captureActiveSelection();
    if (!selection || !selection.trim()) {
      focusInput(null);
      return;
    }
    const source: "terminal" | "editor" =
      activeTab?.kind === "editor" ? "editor" : "terminal";
    attachSelection(selection, source);
  }, [
    hasComposer,
    captureActiveSelection,
    focusInput,
    attachSelection,
    activeTab,
  ]);

  const askFromMarkdownSelection = useCallback(
    (selection: string) => {
      if (!hasComposer) {
        void openSettingsWindow("models");
        return;
      }
      if (!selection.trim()) {
        focusInput(null);
        return;
      }
      attachSelection(selection, "editor");
    },
    [hasComposer, focusInput, attachSelection],
  );

  const { askPopup, setAskPopup, onAskFromSelection } = useSelectionAskAi({
    captureActiveSelection,
    askFromSelection,
  });
  const askPresence = usePresence(Boolean(askPopup), 120);

  const openNewTab = useCallback(() => {
    const id = newTab(inheritedCwdForNewTab());
    setLastTerminalTabId(id);
    setTerminalDockCollapsed(false);
  }, [newTab, inheritedCwdForNewTab, setTerminalDockCollapsed]);

  const openNewPrivateTab = useCallback(() => {
    const id = newPrivateTab(inheritedCwdForNewTab());
    setLastTerminalTabId(id);
    setTerminalDockCollapsed(false);
  }, [newPrivateTab, inheritedCwdForNewTab, setTerminalDockCollapsed]);

  const openNewBlockTab = useCallback(() => {
    const id = newBlockTab(inheritedCwdForNewTab());
    setLastTerminalTabId(id);
    setTerminalDockCollapsed(false);
  }, [newBlockTab, inheritedCwdForNewTab, setTerminalDockCollapsed]);

  const sendCd = useCallback(
    (path: string) => {
      if (activeLeafId === null) return;
      const term = terminalRefs.current.get(activeLeafId);
      if (!term) return;
      term.write(`cd ${quoteShellArg(path)}\r`);
      term.focus();
    },
    [activeLeafId],
  );

  const cdInNewTab = useCallback(
    (path: string) => {
      const tabId = newTab(path);
      setLastTerminalTabId(tabId);
      setTerminalDockCollapsed(false);
      setTimeout(() => {
        const tab = tabsRef.current.find((x) => x.id === tabId);
        if (!tab || tab.kind !== "terminal") return;
        const t = terminalRefs.current.get(tab.activeLeafId);
        if (!t) return;
        t.write(`cd ${quoteShellArg(path)}\r`);
        t.focus();
      }, 80);
    },
    [newTab, setTerminalDockCollapsed],
  );

  const handleOpenFile = useCallback(
    (path: string, pin?: boolean) => {
      // Markdown opens in its rendered view by default; a per-tab toggle flips
      // it to the raw editor. Other files open as persistent tabs by default.
      if (isMarkdownPath(path)) newMarkdownTab(path);
      else openFileTab(path, pin ?? true);
    },
    [openFileTab, newMarkdownTab],
  );

  const handlePathRenamed = useCallback(
    (from: string, to: string) => {
      for (const t of tabs) {
        if (t.kind !== "editor") continue;
        if (t.path === from) {
          const i = to.lastIndexOf("/");
          updateTab(t.id, { path: to, title: i === -1 ? to : to.slice(i + 1) });
        } else if (t.path.startsWith(`${from}/`)) {
          const suffix = t.path.slice(from.length);
          const newPath = `${to}${suffix}`;
          const i = newPath.lastIndexOf("/");
          updateTab(t.id, {
            path: newPath,
            title: i === -1 ? newPath : newPath.slice(i + 1),
          });
        }
      }
    },
    [tabs, updateTab],
  );

  const activeTerminalLeafCwd =
    activeTerminalTab?.kind === "terminal"
      ? (findLeafCwd(
          activeTerminalTab.paneTree,
          activeTerminalTab.activeLeafId,
        ) ??
        activeTerminalTab.cwd ??
        null)
      : null;

  const explorerActiveFilePath =
    activeWorkspaceTab?.kind === "editor" ||
    activeWorkspaceTab?.kind === "markdown"
      ? activeWorkspaceTab.path
      : null;

  const revealWorkspacePathInExplorer = useCallback(
    (path: string) => {
      showExplorer();
      let attempts = 0;
      const reveal = () => {
        const explorer = explorerRef.current;
        if (!explorer) {
          attempts += 1;
          if (attempts <= 3) {
            requestAnimationFrame(reveal);
          } else {
            toast.error("File explorer is not ready.");
          }
          return;
        }
        const result = explorer.revealPath(path);
        if (!result.ok) toast.error(result.message);
      };
      requestAnimationFrame(reveal);
    },
    [showExplorer],
  );

  const revealActiveWorkspacePathInExplorer = useCallback(() => {
    if (!explorerActiveFilePath) {
      toast.error("No active file to reveal.");
      return;
    }
    revealWorkspacePathInExplorer(explorerActiveFilePath);
  }, [explorerActiveFilePath, revealWorkspacePathInExplorer]);

  const { sourceControl, toggleSourceControl, openGitGraphFromContext } =
    useSourceControlContext({
      activeTab: activeWorkspaceTab,
      tabs,
      explorerRoot,
      sidebarView,
      cycleSidebarView,
      openCommitHistoryTab,
    });
  const explorerGitDecorations = usePreferencesStore(
    (s) => s.explorerGitDecorations,
  );

  const openPreviewTab = useCallback(
    (url: string) => {
      const id = newPreviewTab(url);
      // Focus the address bar if the URL is empty so the user can type.
      if (!url) {
        setTimeout(() => previewRefs.current.get(id)?.focusAddressBar(), 0);
      }
      return id;
    },
    [newPreviewTab],
  );

  const splitActivePaneInActiveTab = useCallback(
    (dir: "row" | "col") => {
      if (activeTerminalId === null) return;
      const t = tabsRef.current.find((x) => x.id === activeTerminalId);
      if (!t || t.kind !== "terminal") return;
      setActiveId(activeTerminalId);
      splitActivePane(activeTerminalId, dir);
      setTerminalDockCollapsed(false);
    },
    [activeTerminalId, setActiveId, splitActivePane, setTerminalDockCollapsed],
  );

  const splitTerminalPane = useCallback(
    (tabId: number, leafId: number, dir: "row" | "col") => {
      setActiveId(tabId);
      setLastTerminalTabId(tabId);
      splitPane(tabId, leafId, dir);
      setTerminalDockCollapsed(false);
    },
    [setActiveId, splitPane, setTerminalDockCollapsed],
  );

  const closeTerminalPane = useCallback(
    (tabId: number, leafId: number) => {
      const tab = tabsRef.current.find(
        (candidate) => candidate.id === tabId && candidate.kind === "terminal",
      );
      if (tab?.kind !== "terminal") return;
      if (leafIds(tab.paneTree).length > 1) {
        closePaneByLeaf(leafId);
      } else {
        void handleClose(tabId);
      }
    },
    [closePaneByLeaf, handleClose],
  );

  const handleCloseTabOrPane = useCallback(() => {
    const t = tabsRef.current.find((x) => x.id === activeId);
    if (t?.kind === "terminal" && leafIds(t.paneTree).length > 1) {
      closeActivePane(activeId);
      return;
    }
    void handleClose(activeId);
  }, [activeId, closeActivePane, handleClose]);

  const [zenMode, setZenMode] = useState(false);

  const shortcutHandlers = useMemo<ShortcutHandlers>(
    () => ({
      "commandPalette.open": () => openCommandPalette("commands"),
      "commandPalette.content": () => openCommandPalette("content"),
      "tab.new": openNewTab,
      "tab.newBlock": openNewBlockTab,
      "tab.newPrivate": openNewPrivateTab,
      "tab.newPreview": () => openPreviewTab(""),
      "tab.newEditor": () => setNewEditorOpen(true),
      "tab.close": handleCloseTabOrPane,
      "tab.next": () => cycleTab(1),
      "tab.prev": () => cycleTab(-1),
      "tab.selectByIndex": (e) => {
        const idx = parseInt(e.key, 10) - 1;
        const scoped =
          activeTab?.kind === "terminal" ? terminalTabs : workspaceTabs;
        const t = scoped[idx];
        if (t) setActiveId(t.id);
      },
      "space.next": () => cycleSpace(1),
      "space.prev": () => cycleSpace(-1),
      "space.overview": () => setSwitcherOpen(true),
      "pane.splitRight": () => splitActivePaneInActiveTab("row"),
      "pane.splitDown": () => splitActivePaneInActiveTab("col"),
      "pane.focusNext": () => focusNextPaneInTab(activeId, 1),
      "pane.focusPrev": () => focusNextPaneInTab(activeId, -1),
      "pane.source": toggleSourceControl,
      "terminal.selectAll": () => {
        if (activeLeafId !== null) {
          terminalRefs.current.get(activeLeafId)?.selectAll();
        }
      },
      "terminal.copy": () => {
        if (activeLeafId !== null) {
          void terminalRefs.current.get(activeLeafId)?.copySelection();
        }
      },
      "terminal.paste": () => {
        if (activeLeafId !== null) {
          void terminalRefs.current.get(activeLeafId)?.pasteClipboard();
        }
      },
      "terminal.search": () => searchInlineRef.current?.focus(),
      "terminal.clear": () => {
        clearFocusedTerminal();
      },
      "terminal.toggleInput": () =>
        window.dispatchEvent(new CustomEvent(TOGGLE_BLOCK_INPUT_EVENT)),
      "blocks.prev": () => navigateFocusedBlocks(-1),
      "blocks.next": () => navigateFocusedBlocks(1),
      "search.focus": () => searchInlineRef.current?.focus(),
      "ai.toggle": togglePanelAndFocus,
      "ai.askSelection": askFromSelection,
      "settings.open": () => void openSettingsWindow(),
      "sidebar.toggle": toggleSidebar,
      "explorer.focus": toggleExplorerFocus,
      "view.zoomIn": zoomIn,
      "view.zoomOut": zoomOut,
      "view.zoomReset": zoomReset,
      "view.zenMode": () => setZenMode((v) => !v),
      "editor.undo": () => editorRefs.current.get(activeId)?.undo(),
      "editor.redo": () => editorRefs.current.get(activeId)?.redo(),
    }),
    [
      activeId,
      openCommandPalette,
      cycleTab,
      cycleSpace,
      handleCloseTabOrPane,
      openNewTab,
      openNewBlockTab,
      openNewPrivateTab,
      openPreviewTab,
      setActiveId,
      splitActivePaneInActiveTab,
      focusNextPaneInTab,
      activeLeafId,
      toggleSourceControl,
      togglePanelAndFocus,
      askFromSelection,
      toggleSidebar,
      toggleExplorerFocus,
      zoomIn,
      zoomOut,
      zoomReset,
      activeTab,
      terminalTabs,
      workspaceTabs,
    ],
  );

  const shortcutsDisabled = useCallback(
    (id: ShortcutId, e: KeyboardEvent) => {
      const target = (e.target as HTMLElement | null) ?? document.activeElement;
      const inTerminal = !!(target as HTMLElement | null)?.closest?.(
        ".clack-terminal-pane",
      );
      if (id === "explorer.search" && inTerminal) return true;
      if (
        id === "terminal.selectAll" ||
        id === "terminal.copy" ||
        id === "terminal.paste" ||
        id === "terminal.search"
      ) {
        return !inTerminal;
      }
      if (
        (id === "pane.focusNext" || id === "pane.focusPrev") &&
        e.altKey &&
        e.shiftKey
      ) {
        return !inTerminal;
      }
      if (id === "editor.undo" || id === "editor.redo") {
        return activeTab?.kind !== "editor";
      }
      if (id === "ai.askSelection") {
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        const inTerminal = !!(target as HTMLElement | null)?.closest?.(
          ".xterm",
        );
        if (!inTerminal) return false;
        const sel = captureActiveSelection();
        return !sel || !sel.trim();
      }
      if (id === "terminal.clear") {
        // Only intercept ⌘K while a terminal is focused; elsewhere let the key
        // fall through (we never preventDefault when disabled).
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        return !(target as HTMLElement | null)?.closest?.(".xterm");
      }
      if (
        id === "terminal.toggleInput" ||
        id === "blocks.prev" ||
        id === "blocks.next"
      ) {
        return !(activeTab?.kind === "terminal" && activeTab.blocks === true);
      }
      if (id === "sidebar.toggle") {
        // Ctrl+B is also Claude Code's "run in background" key. While a terminal
        // is focused, let Ctrl+B reach the shell/Claude instead of toggling the
        // sidebar. Ctrl+Shift+B (second binding) still toggles it from anywhere.
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        const inTerminal = !!(target as HTMLElement | null)?.closest?.(
          ".xterm",
        );
        // Only defer the plain (no-shift) Ctrl/⌘+B binding; the Shift variant
        // is the always-on toggle and is never claimed by the terminal.
        return inTerminal && !e.shiftKey;
      }
      return false;
    },
    [activeTab, captureActiveSelection],
  );

  useGlobalShortcuts(shortcutHandlers, { isDisabled: shortcutsDisabled });

  const registerTerminalHandle = useCallback(
    (leafId: number, h: TerminalPaneHandle | null) => {
      if (h) terminalRefs.current.set(leafId, h);
      else terminalRefs.current.delete(leafId);
    },
    [],
  );

  const registerEditorHandle = useCallback(
    (id: number, h: EditorPaneHandle | null) => {
      if (h) {
        editorRefs.current.set(id, h);
        const line = pendingGotoLine.current.get(id);
        if (line != null) {
          pendingGotoLine.current.delete(id);
          h.gotoLine(line);
        }
      } else {
        editorRefs.current.delete(id);
      }
      if (id === activeId) setActiveEditorHandle(h);
    },
    [activeId],
  );

  const registerPreviewHandle = useCallback(
    (id: number, h: PreviewPaneHandle | null) => {
      if (h) previewRefs.current.set(id, h);
      else previewRefs.current.delete(id);
    },
    [],
  );

  const handlePreviewUrl = useCallback(
    (id: number, url: string) => updateTab(id, { url }),
    [updateTab],
  );

  const authorizedCwds = useRef(new Set<string>());
  const handleTerminalCwd = useCallback(
    (leafId: number, cwd: string) => {
      setLeafCwd(leafId, cwd);
      if (cwd && !authorizedCwds.current.has(cwd)) {
        authorizedCwds.current.add(cwd);
        native.workspaceAuthorize(cwd).catch(() => {
          authorizedCwds.current.delete(cwd);
        });
      }
    },
    [setLeafCwd],
  );

  const handleFocusLeaf = useCallback(
    (tabId: number, leafId: number) => {
      setActiveId(tabId);
      setLastTerminalTabId(tabId);
      setTerminalDockCollapsed(false);
      focusPane(tabId, leafId);
    },
    [setActiveId, focusPane, setTerminalDockCollapsed],
  );

  const searchTerminalPane = useCallback(
    (tabId: number, leafId: number) => {
      handleFocusLeaf(tabId, leafId);
      requestAnimationFrame(() => searchInlineRef.current?.focus());
    },
    [handleFocusLeaf],
  );

  const onActivateAgent = useCallback(
    (tabId: number, leafId: number) => {
      setActiveId(tabId);
      setLastTerminalTabId(tabId);
      setTerminalDockCollapsed(false);
      focusPane(tabId, leafId);
    },
    [setActiveId, focusPane, setTerminalDockCollapsed],
  );

  const onActivateLocalAgent = useCallback(() => {
    openPanel();
    focusInput(null);
  }, [openPanel, focusInput]);

  const handleLeafExit = useCallback(
    (leafId: number, _code: number) => {
      const all = tabsRef.current;
      const tab = all.find(
        (t) => t.kind === "terminal" && hasLeaf(t.paneTree, leafId),
      );
      if (!tab || tab.kind !== "terminal") return;
      const isLast =
        leafIds(tab.paneTree).length === 1 &&
        all.filter((t) => t.kind === "terminal").length === 1;
      if (isLast) {
        void respawnSession(leafId, tab.cwd);
      } else {
        closePaneByLeaf(leafId);
      }
    },
    [closePaneByLeaf],
  );

  const handleEditorDirty = useCallback(
    (id: number, dirty: boolean) => updateTab(id, { dirty }),
    [updateTab],
  );

  const handleRenameTab = useCallback(
    (id: number, title: string) => updateTab(id, { customTitle: title.trim() }),
    [updateTab],
  );

  const searchTarget = useMemo<SearchTarget>(() => {
    if (isTerminalTab && activeLeafId !== null && activeSearchAddon)
      return {
        kind: "terminal",
        addon: activeSearchAddon,
        focus: () => terminalRefs.current.get(activeLeafId)?.focus(),
      };
    if (isEditorTab && activeEditorHandle)
      return {
        kind: "editor",
        handle: activeEditorHandle,
        focus: () => activeEditorHandle.focus(),
      };
    if (isGitHistoryTab && gitHistoryHandle)
      return {
        kind: "git-history",
        handle: gitHistoryHandle,
        focus: () => {},
      };
    return null;
  }, [
    isTerminalTab,
    isEditorTab,
    isGitHistoryTab,
    activeLeafId,
    activeSearchAddon,
    activeEditorHandle,
    gitHistoryHandle,
  ]);

  const activeCwd = activeTerminalLeafCwd;
  const statusBarCwd = explorerLocation ?? activeCwd;
  const statusBarDirectoryLabel = explorerLocation
    ? explorerLocationDiffersFromRoot
      ? "Explorer"
      : "Workspace"
    : "Terminal";
  const statusBarDirectoryTitle = explorerLocation
    ? explorerBrowsingOutsideWorkspace
      ? "Browsing outside workspace"
      : explorerLocationDiffersFromRoot
        ? "Explorer location"
        : "Workspace root"
    : "Terminal current directory";

  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>(
    [],
  );
  const [recentWorkspaceMissing, setRecentWorkspaceMissing] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    let alive = true;
    void loadRecentWorkspaces().then((items) => {
      if (alive) setRecentWorkspaces(items);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void Promise.all(
      recentWorkspaces.map(async (item) => {
        try {
          const stat = await native.stat(item.path, LOCAL_WORKSPACE);
          return [item.path, stat.kind !== "dir"] as const;
        } catch {
          return [item.path, true] as const;
        }
      }),
    ).then((entries) => {
      if (!alive) return;
      setRecentWorkspaceMissing(Object.fromEntries(entries));
    });
    return () => {
      alive = false;
    };
  }, [recentWorkspaces]);

  const clearWorkspaceTabsForRootChange = useCallback((): boolean => {
    if (!activeSpaceId) return false;
    const dirty = tabsRef.current.some(
      (t) => t.spaceId === activeSpaceId && t.kind === "editor" && t.dirty,
    );
    if (dirty) {
      window.alert(
        "Save or close unsaved editor tabs before switching workspace.",
      );
      return false;
    }
    removeWorkspaceTabsForSpace(activeSpaceId);
    setLastWorkspaceTabId(null);
    return true;
  }, [activeSpaceId, removeWorkspaceTabsForSpace]);

  const openWorkspaceRoot = useCallback(
    async (path: string) => {
      setWorkspaceEnv(LOCAL_WORKSPACE);
      let root: string;
      try {
        root = normalizeWorkspacePath(await native.workspaceAuthorize(path));
      } catch (e) {
        window.alert(String(e));
        return;
      }

      const { spaces, create, setActive, setRoot } = useSpaces.getState();
      const existing = findWorkspaceByRoot(spaces, root, activeSpaceId);
      let targetSpaceId = existing?.id ?? activeSpaceId;

      if (existing) {
        setActive(existing.id);
      } else if (targetSpaceId && !activeWorkspaceRoot) {
        setRoot(targetSpaceId, root, {
          name: workspaceName(root),
          env: LOCAL_WORKSPACE,
        });
      } else {
        const meta = create({
          name: workspaceName(root),
          root,
          env: LOCAL_WORKSPACE,
        });
        targetSpaceId = meta.id;
        setActive(meta.id);
      }

      if (!targetSpaceId) return;
      setActiveSpaceForNewTabs(targetSpaceId);
      const terminalId = ensureTerminalInSpace(targetSpaceId, root);
      if (terminalId !== null) setLastTerminalTabId(terminalId);
      setTerminalDockCollapsed(false);
      setRecentWorkspaces(await recordRecentWorkspace(root));
    },
    [
      activeSpaceId,
      activeWorkspaceRoot,
      setWorkspaceEnv,
      ensureTerminalInSpace,
      setActiveSpaceForNewTabs,
      setTerminalDockCollapsed,
    ],
  );

  const handleOpenFolder = useCallback(async () => {
    const selected = await pickWorkspaceFolder();
    if (selected) await openWorkspaceRoot(selected);
  }, [openWorkspaceRoot]);

  const handleOpenRecentWorkspace = useCallback(
    async (path: string) => {
      if (recentWorkspaceMissing[path]) return;
      await openWorkspaceRoot(path);
    },
    [openWorkspaceRoot, recentWorkspaceMissing],
  );

  const handleRemoveRecentWorkspace = useCallback(async (path: string) => {
    setRecentWorkspaces(await removeRecentWorkspace(path));
  }, []);

  const handleCloseWorkspaceRoot = useCallback(() => {
    if (!activeSpaceId || !activeWorkspaceRoot) return;
    if (!clearWorkspaceTabsForRootChange()) return;
    useSpaces.getState().setRoot(activeSpaceId, null, {
      name: "No workspace",
      env: workspaceEnv,
    });
  }, [
    activeSpaceId,
    activeWorkspaceRoot,
    clearWorkspaceTabsForRootChange,
    workspaceEnv,
  ]);

  const browseExplorerLocation = useCallback(
    async (path: string) => {
      if (!explorerRoot || !activeSpaceId) {
        sendCd(path);
        return;
      }
      try {
        const canonical = await native.workspaceAuthorize(path);
        useSpaces
          .getState()
          .setExplorerPath(activeSpaceId, normalizeWorkspacePath(canonical));
      } catch (e) {
        window.alert(String(e));
      }
    },
    [activeSpaceId, explorerRoot, sendCd],
  );

  const handleReturnToWorkspaceRoot = useCallback(() => {
    if (!activeSpaceId || !explorerRoot) return;
    useSpaces.getState().setExplorerPath(activeSpaceId, explorerRoot);
  }, [activeSpaceId, explorerRoot]);

  const handleStatusBarCd = useCallback(
    (path: string) => {
      void browseExplorerLocation(path);
    },
    [browseExplorerLocation],
  );

  const handleWorkspaceEnvChange = useCallback(
    async (env: WorkspaceEnv) => {
      const nextHome = await switchWorkspace(env);
      if (!nextHome || !activeSpaceId) return;
      const root = normalizeWorkspacePath(nextHome);
      useSpaces.getState().setRoot(activeSpaceId, root, {
        name: workspaceName(root),
        env,
      });
      const terminalId = ensureTerminalInSpace(activeSpaceId, root);
      if (terminalId !== null) setLastTerminalTabId(terminalId);
      setTerminalDockCollapsed(false);
    },
    [
      activeSpaceId,
      switchWorkspace,
      ensureTerminalInSpace,
      setTerminalDockCollapsed,
    ],
  );

  const handleNewSpace = useCallback(() => {
    const { spaces, create, setActive } = useSpaces.getState();
    const meta = create({
      name: `Space ${spaces.length + 1}`,
      root: explorerRoot,
      env: workspaceEnv,
    });
    setActiveSpaceForNewTabs(meta.id);
    const tabId = newTab(explorerRoot ?? undefined);
    setLastTerminalTabId(tabId);
    setTerminalDockCollapsed(false);
    setActive(meta.id);
    return meta.id;
  }, [
    explorerRoot,
    workspaceEnv,
    newTab,
    setActiveSpaceForNewTabs,
    setTerminalDockCollapsed,
  ]);

  const handleDeleteSpace = useCallback(
    (id: string) => {
      useSpaces.getState().remove(id);
      removeTabsForSpace(id);
    },
    [removeTabsForSpace],
  );

  const handleMoveTab = useCallback(
    (tabId: number, targetSpaceId: string) => {
      if (moveTabToSpace(tabId, targetSpaceId)) {
        useSpaces.getState().setActive(targetSpaceId);
      }
    },
    [moveTabToSpace],
  );

  const handleReorderTab = useCallback(
    (tabId: number, targetTabId: number, edge: "top" | "bottom") => {
      if (reorderTab(tabId, targetTabId, edge)) {
        const target = tabsRef.current.find((x) => x.id === targetTabId);
        if (target) useSpaces.getState().setActive(target.spaceId);
      }
    },
    [reorderTab],
  );

  const handleNewTabInSpace = useCallback(
    (spaceId: string) => {
      const root = useSpaces
        .getState()
        .spaces.find((s) => s.id === spaceId)?.root;
      newTabInSpace(spaceId, root ?? undefined);
    },
    [newTabInSpace],
  );

  const jumpToTab = useCallback(
    (tabId: number) => {
      const t = tabsRef.current.find((x) => x.id === tabId);
      if (!t) return;
      setActiveId(tabId);
      useSpaces.getState().setActive(t.spaceId);
      setSwitcherOpen(false);
    },
    [setActiveId],
  );

  const spaceSwitcher = (
    <SpaceSwitcher
      open={switcherOpen}
      onOpenChange={setSwitcherOpen}
      tabs={tabs}
      workspaceRoot={explorerRoot}
      workspaceLocation={explorerLocation}
      recentWorkspaces={recentWorkspaces}
      recentWorkspaceMissing={recentWorkspaceMissing}
      onOpenFolder={() => void handleOpenFolder()}
      onCloseWorkspace={handleCloseWorkspaceRoot}
      onCopyWorkspacePath={() => {
        if (explorerRoot) void copyToClipboard(explorerRoot);
      }}
      onRevealWorkspaceRoot={() => {
        if (explorerRoot) void revealInFinder(explorerRoot);
      }}
      onReturnToWorkspaceRoot={handleReturnToWorkspaceRoot}
      onOpenRecentWorkspace={(path) => void handleOpenRecentWorkspace(path)}
      onRemoveRecentWorkspace={(path) => void handleRemoveRecentWorkspace(path)}
      onNewSpace={() => void handleNewSpace()}
      onDeleteSpace={handleDeleteSpace}
      onNewTabInSpace={handleNewTabInSpace}
      onJumpTab={jumpToTab}
      onCloseTab={handleClose}
      onMoveTabToSpace={handleMoveTab}
      onReorderTab={handleReorderTab}
      onReorderSpaces={(ids) => useSpaces.getState().reorder(ids)}
    />
  );

  const commandPaletteItems = useMemo(
    () =>
      commandPaletteOpen
        ? createCommandItems({
            tabs,
            activeId,
            searchTarget,
            explorerRoot,
            recentWorkspaces,
            recentWorkspaceMissing,
            openFolder: () => void handleOpenFolder(),
            switchWorkspace: () => setSwitcherOpen(true),
            closeWorkspace: handleCloseWorkspaceRoot,
            openRecentWorkspace: (path) => void handleOpenRecentWorkspace(path),
            openNewTab,
            openNewBlock: openNewBlockTab,
            openNewPrivate: openNewPrivateTab,
            openNewEditor: () => setNewEditorOpen(true),
            openNewPreview: () => openPreviewTab(""),
            openGitGraph: openGitGraphFromContext,
            toggleSourceControl,
            closeActiveTabOrPane: handleCloseTabOrPane,
            splitPaneRight: () => splitActivePaneInActiveTab("row"),
            splitPaneDown: () => splitActivePaneInActiveTab("col"),
            focusSearch: () => searchInlineRef.current?.focus(),
            focusExplorerSearch: () => explorerRef.current?.focusSearch(),
            toggleSidebar,
            toggleAi: togglePanelAndFocus,
            askAiSelection: askFromSelection,
            openSettings: () => void openSettingsWindow(),
            openThemes: () => void openSettingsWindow("themes"),
            openKeyboardShortcuts: () => void openSettingsWindow("shortcuts"),
            spaces: useSpaces.getState().spaces,
            activeSpaceId,
            openSpacesOverview: () => setSwitcherOpen(true),
            newSpace: () => void handleNewSpace(),
            switchSpace: (id) => useSpaces.getState().setActive(id),
          })
        : [],
    [
      commandPaletteOpen,
      tabs,
      activeId,
      searchTarget,
      explorerRoot,
      recentWorkspaces,
      recentWorkspaceMissing,
      handleOpenFolder,
      handleCloseWorkspaceRoot,
      handleOpenRecentWorkspace,
      openNewTab,
      openNewBlockTab,
      openNewPrivateTab,
      openPreviewTab,
      openGitGraphFromContext,
      toggleSourceControl,
      handleCloseTabOrPane,
      splitActivePaneInActiveTab,
      toggleSidebar,
      togglePanelAndFocus,
      askFromSelection,
      activeSpaceId,
      handleNewSpace,
    ],
  );

  const pendingGotoLine = useRef<Map<number, number>>(new Map());
  const openContentHit = useCallback(
    (path: string, line: number) => {
      const id = openFileTab(path, true);
      if (id == null) return;
      const h = editorRefs.current.get(id);
      if (h) h.gotoLine(line);
      else pendingGotoLine.current.set(id, line);
    },
    [openFileTab],
  );

  const insertHistoryCommand = useMemo(
    () =>
      isTerminalTab && activeLeafId !== null
        ? (cmd: string) => {
            writeToSession(activeLeafId, cmd);
            terminalRefs.current.get(activeLeafId)?.focus();
          }
        : null,
    [isTerminalTab, activeLeafId],
  );

  const canSplitActiveTerminal =
    !!activeTerminalTab &&
    activeTerminalTab.blocks !== true &&
    leafIds(activeTerminalTab.paneTree).length < MAX_PANES_PER_TAB;

  const selectWorkspaceTab = useCallback(
    (id: number) => {
      setLastWorkspaceTabId(id);
      setActiveId(id);
    },
    [setActiveId],
  );

  const selectTerminalTab = useCallback(
    (id: number) => {
      setLastTerminalTabId(id);
      setActiveId(id);
      setTerminalDockCollapsed(false);
    },
    [setActiveId, setTerminalDockCollapsed],
  );

  const toggleTerminalDockCollapsed = useCallback(() => {
    setTerminalDockCollapsed(!terminalDockCollapsed);
  }, [terminalDockCollapsed, setTerminalDockCollapsed]);

  useAiLiveBridge({
    setLive,
    activeId,
    activeTerminalId,
    activeWorkspaceId,
    tabs,
    explorerRoot,
    openPreviewTab,
    newAgentTab,
    terminalRefs,
  });

  const shell = (
    <ThemeProvider>
      <TooltipProvider>
        <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
          {!zenMode && (
            <Header
              tabs={workspaceTabs}
              activeId={activeWorkspaceId ?? activeId}
              onSelect={selectWorkspaceTab}
              onNew={openNewTab}
              onNewBlock={openNewBlockTab}
              onNewPrivate={openNewPrivateTab}
              onNewPreview={() => openPreviewTab("")}
              onNewEditor={() => setNewEditorOpen(true)}
              onNewGitGraph={openGitGraphFromContext}
              onClose={handleClose}
              onPin={pinTab}
              onRename={handleRenameTab}
              onToggleSidebar={toggleSidebar}
              onOpenCommandPalette={() => openCommandPalette("commands")}
              onActivateAgent={onActivateAgent}
              onActivateLocalAgent={onActivateLocalAgent}
              onOpenSettings={() => void openSettingsWindow()}
              spaceSwitcher={spaceSwitcher}
              searchTarget={searchTarget}
              searchRef={searchInlineRef}
            />
          )}

          <main className="zoom-content flex min-h-0 flex-1 flex-col bg-zinc-950/20">
            <ResizablePanelGroup
              orientation="horizontal"
              className="min-h-0 flex-1"
            >
              <ResizablePanel
                id="sidebar"
                panelRef={sidebarRef}
                defaultSize={`${sidebarWidthRef.current}px`}
                minSize={`${SIDEBAR_MIN_WIDTH}px`}
                maxSize={`${SIDEBAR_MAX_WIDTH}px`}
                collapsible
                collapsedSize={0}
                onResize={(size) => {
                  if (size.inPixels > 0) persistSidebarWidth(size.inPixels);
                }}
              >
                <div className="flex h-full min-h-0 flex-col border-r border-violet-400/15 bg-zinc-950/90">
                  <div
                    key={sidebarView}
                    className="min-h-0 flex-1 clack-panel-in"
                  >
                    {sidebarView === "explorer" ? (
                      <FileExplorer
                        ref={explorerRef}
                        rootPath={explorerLocation}
                        workspaceRoot={explorerRoot}
                        gitStatus={
                          explorerGitDecorations ? sourceControl.status : null
                        }
                        activeFilePath={explorerActiveFilePath}
                        onOpenFolder={() => void handleOpenFolder()}
                        onOpenWorkspacePath={(path) =>
                          void openWorkspaceRoot(path)
                        }
                        onReturnToWorkspaceRoot={handleReturnToWorkspaceRoot}
                        onCloseWorkspace={handleCloseWorkspaceRoot}
                        onOpenFile={handleOpenFile}
                        onPathRenamed={handlePathRenamed}
                        onPathDeleted={handlePathDeleted}
                        onRevealInTerminal={cdInNewTab}
                        onAttachToAgent={handleAttachFileToAgent}
                      />
                    ) : (
                      <SourceControlPanel
                        open
                        sourceControl={sourceControl}
                        onOpenDiff={openGitDiffTab}
                        onOpenGitGraph={openGitGraphFromContext}
                        onOpenFile={handleOpenFile}
                      />
                    )}
                  </div>
                  <SidebarRail
                    activeView={sidebarView}
                    onSelectView={persistSidebarView}
                    changedCount={sourceControl.changedCount}
                  />
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel id="workspace" defaultSize="78%" minSize="30%">
                <div className="flex h-full min-h-0 flex-col bg-background">
                  <div className="relative min-h-0 flex-1 bg-[linear-gradient(180deg,rgba(124,58,237,0.045),transparent_34%)]">
                    <WorkspaceSurface
                      tabs={tabs}
                      activeId={activeWorkspaceId ?? -1}
                      activeTab={activeWorkspaceTab}
                      registerEditorHandle={registerEditorHandle}
                      onEditorDirtyChange={handleEditorDirty}
                      onEditorCloseTab={disposeTab}
                      registerPreviewHandle={registerPreviewHandle}
                      onPreviewUrlChange={handlePreviewUrl}
                      onAiDiffAccept={(id) => respondToApproval(id, true)}
                      onAiDiffReject={(id) => respondToApproval(id, false)}
                      onOpenCommitFile={openCommitFileDiffTab}
                      onGitHistorySearchHandle={setGitHistoryHandle}
                      onSetMarkdownView={setMarkdownView}
                      onAskAiSelection={askFromSelection}
                      onAskAiMarkdownSelection={askFromMarkdownSelection}
                      onRevealInExplorer={revealActiveWorkspacePathInExplorer}
                      onAttachFileToAgent={handleAttachFileToAgent}
                      workspaceRoot={explorerRoot}
                      onOpenFolder={() => void handleOpenFolder()}
                      onNewEditor={() => setNewEditorOpen(true)}
                      onNewPreview={() => openPreviewTab("")}
                      onOpenCommandPalette={() =>
                        openCommandPalette("commands")
                      }
                    />
                  </div>

                  {!zenMode && (
                    <TerminalDock
                      tabs={terminalTabs}
                      stackTabs={tabs}
                      activeId={activeTerminalId}
                      height={terminalDockHeight}
                      collapsed={terminalDockCollapsed}
                      canSplit={canSplitActiveTerminal}
                      onResizeHeight={setTerminalDockHeight}
                      onToggleCollapsed={toggleTerminalDockCollapsed}
                      onSelect={selectTerminalTab}
                      onNew={openNewTab}
                      onNewBlock={openNewBlockTab}
                      onNewPrivate={openNewPrivateTab}
                      onClose={handleClose}
                      onRename={handleRenameTab}
                      onSplitRight={() => splitActivePaneInActiveTab("row")}
                      onSplitDown={() => splitActivePaneInActiveTab("col")}
                      registerHandle={registerTerminalHandle}
                      onSearchReady={handleSearchReady}
                      onCwd={handleTerminalCwd}
                      onExit={handleLeafExit}
                      onFocusLeaf={handleFocusLeaf}
                      onSplitPane={splitTerminalPane}
                      onClosePane={closeTerminalPane}
                      onSearchPane={searchTerminalPane}
                    />
                  )}
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </main>

          <WorkspaceInputBar
            isBlockTab={isBlockTab && !terminalDockCollapsed}
            isTerminalTab={isTerminalTab}
            activeLeafId={activeLeafId}
            cwd={activeCwd}
            home={home}
            hasComposer={hasComposer}
            panelOpen={panelOpen}
            keysLoaded={keysLoaded}
            onConnect={() => void openSettingsWindow("models")}
          />

          {!zenMode && (
            <StatusBar
              cwd={statusBarCwd}
              directoryLabel={statusBarDirectoryLabel}
              directoryTitle={statusBarDirectoryTitle}
              home={home}
              onCd={handleStatusBarCd}
              workspaceRoot={explorerRoot}
              onOpenWorkspace={(path) => void openWorkspaceRoot(path)}
              onReturnToWorkspaceRoot={handleReturnToWorkspaceRoot}
              onWorkspaceChange={(env) => void handleWorkspaceEnvChange(env)}
              onOpenMini={openMini}
              hasComposer={hasComposer}
              terminalCount={terminalTabs.length}
              privateActive={
                activeTerminalTab?.kind === "terminal" &&
                activeTerminalTab.private === true
              }
            />
          )}

          <AgentNotificationsBridge
            tabs={tabs}
            activeId={activeId}
            onActivate={onActivateAgent}
          />
          <Toaster position="bottom-right" />

          {hasComposer ? (
            <>
              <AgentRunBridge
                openAiDiffTab={openAiDiffTab}
                closeAiDiffTab={closeAiDiffTab}
              />
              <LocalAgentNotificationsBridge />
            </>
          ) : null}

          {hasComposer && miniPresence.mounted ? (
            <AiMiniWindow state={miniPresence.state} />
          ) : null}
          {askPresence.mounted ? (
            <SelectionAskAi
              state={askPresence.state}
              x={askPopup?.x ?? 0}
              y={askPopup?.y ?? 0}
              onAsk={onAskFromSelection}
              onDismiss={() => setAskPopup(null)}
            />
          ) : null}

          <CommandPalette
            open={commandPaletteOpen}
            onOpenChange={setCommandPaletteOpen}
            initialMode={paletteInitialMode}
            commandItems={commandPaletteItems}
            workspaceRoot={explorerRoot}
            onOpenContentHit={openContentHit}
            insertCommand={insertHistoryCommand}
          />

          <NewEditorDialog
            open={newEditorOpen}
            onOpenChange={setNewEditorOpen}
            rootPath={explorerRoot}
            onCreated={(path) => openFileTab(path)}
          />

          <CloseDialogs
            tabs={tabs}
            pendingCloseTab={pendingCloseTab}
            onCancelClose={cancelClose}
            onConfirmClose={confirmClose}
            pendingTerminalCloseTab={pendingTerminalCloseTab}
            onCancelTerminalClose={cancelTerminalClose}
            onConfirmTerminalClose={confirmTerminalClose}
            pendingDeleteTabs={pendingDeleteTabs}
            onCancelDeleteClose={cancelDeleteClose}
            onConfirmDeleteClose={confirmDeleteClose}
          />
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );

  return <AiComposerProvider>{shell}</AiComposerProvider>;
}
