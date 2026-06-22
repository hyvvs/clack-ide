import { useTheme } from "@/modules/theme";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useShortcutLabel } from "@/modules/shortcuts";
import {
  Cancel01Icon,
  CleanIcon,
  ClipboardPasteIcon,
  Copy01Icon,
  LayoutTwoColumnIcon,
  LayoutTwoRowIcon,
  Search01Icon,
  TextSelectionIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SearchAddon } from "@xterm/addon-search";
import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { BlockOverlay } from "./block/BlockOverlay";
import { BlockWatermark } from "./block/BlockWatermark";
import {
  focusLeafInput,
  submitToLeaf,
  useTerminalSession,
} from "./lib/useTerminalSession";

export type TerminalPaneHandle = {
  write: (data: string) => void;
  focus: () => void;
  getBuffer: (maxLines?: number) => string | null;
  getSelection: () => string | null;
  selectAll: () => boolean;
  copySelection: () => Promise<boolean>;
  pasteClipboard: () => Promise<boolean>;
  clearScrollback: () => boolean;
};

type Props = {
  /** Stable identifier for this leaf (passed back through callbacks). */
  leafId: number;
  /** Tab containing this pane is on screen. */
  visible: boolean;
  /** This leaf is the active pane within its tab — receives auto-focus. */
  focused?: boolean;
  initialCwd?: string;
  /** Enable command-block decorations (OSC 133) for this terminal. */
  blocks?: boolean;
  onSearchReady?: (leafId: number, addon: SearchAddon) => void;
  onExit?: (leafId: number, code: number) => void;
  onCwd?: (leafId: number, cwd: string) => void;
  canSplit?: boolean;
  paneCount?: number;
  canCloseTab?: boolean;
  onSplit?: (leafId: number, dir: "row" | "col") => void;
  onClosePane?: (leafId: number) => void;
  onCloseTab?: () => void;
  onSearch?: (leafId: number) => void;
};

export const TerminalPane = memo(
  forwardRef<TerminalPaneHandle, Props>(function TerminalPane(
    {
      leafId,
      visible,
      focused = true,
      initialCwd,
      blocks = false,
      onSearchReady,
      onExit,
      onCwd,
      canSplit = false,
      paneCount = 1,
      canCloseTab = false,
      onSplit,
      onClosePane,
      onCloseTab,
      onSearch,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const downYRef = useRef<number | null>(null);
    const [hasSelection, setHasSelection] = useState(false);
    const { resolvedMode, themeId, customThemes } = useTheme();
    const selectAllShortcut = useShortcutLabel("terminal.selectAll");
    const copyShortcut = useShortcutLabel("terminal.copy");
    const pasteShortcut = useShortcutLabel("terminal.paste");
    const searchShortcut = useShortcutLabel("terminal.search");
    const clearShortcut = useShortcutLabel("terminal.clear");

    const session = useTerminalSession({
      leafId,
      container: containerRef,
      visible,
      focused,
      initialCwd,
      blocks,
      onSearchReady: (a) => onSearchReady?.(leafId, a),
      onExit: (c) => onExit?.(leafId, c),
      onCwd: (c) => onCwd?.(leafId, c),
    });

    useEffect(() => {
      // Defer one frame so CSS-variable token resolution sees the new class.
      const id = requestAnimationFrame(() => session.applyTheme());
      return () => cancelAnimationFrame(id);
    }, [resolvedMode, themeId, customThemes, session]);

    useImperativeHandle(
      ref,
      () => ({
        write: (data: string) => session.write(data),
        focus: () => session.focus(),
        getBuffer: (max?: number) => session.getBuffer(max),
        getSelection: () => session.getSelection(),
        selectAll: () => session.selectAll(),
        copySelection: () => session.copySelection(),
        pasteClipboard: () => session.pasteClipboard(),
        clearScrollback: () => session.clearScrollback(),
      }),
      [session],
    );

    const hideStyle = {
      visibility: visible ? ("visible" as const) : ("hidden" as const),
      pointerEvents: visible ? ("auto" as const) : ("none" as const),
    };

    const promptReady = session.blockMode === "prompt";

    const content = blocks ? (
      <div
        className="clack-terminal-pane zoom-exempt flex h-full min-h-0 w-full flex-col overflow-hidden"
        style={hideStyle}
      >
        <div className="relative min-h-0 flex-1">
          {/* biome-ignore lint/a11y/noStaticElementInteractions: terminal surface; pointer selects command blocks */}
          <div
            ref={containerRef}
            className="absolute inset-0 z-0"
            onMouseDown={(e) => {
              downYRef.current = e.clientY;
            }}
            onMouseUp={(e) => {
              const moved =
                downYRef.current != null &&
                Math.abs(e.clientY - downYRef.current) > 4;
              downYRef.current = null;
              if (!moved) session.selectBlockAt(e.clientY);
              if (session.blockMode === "prompt") focusLeafInput(leafId);
            }}
          />
          <BlockWatermark leafId={leafId} subscribe={session.subscribeBlocks} />
          <BlockOverlay
            subscribe={session.subscribeBlocks}
            getVisible={session.visibleBlocks}
            readOutput={(id) => session.readBlockId(id)?.output ?? null}
            searchBlock={session.searchBlock}
            revealMatch={session.revealMatch}
            clearSearch={session.clearSearch}
            promptReady={promptReady}
            onRunAgain={(cmd) => submitToLeaf(leafId, cmd)}
            onRestoreFocus={() => {
              if (session.blockMode === "prompt") focusLeafInput(leafId);
            }}
          />
        </div>
      </div>
    ) : (
      <div
        ref={containerRef}
        className="clack-terminal-pane zoom-exempt h-full min-h-0 w-full overflow-hidden"
        style={hideStyle}
      />
    );

    return (
      <ContextMenu
        onOpenChange={(open) => {
          if (open) setHasSelection(session.getSelection() !== null);
        }}
      >
        <ContextMenuTrigger asChild>{content}</ContextMenuTrigger>
        <ContextMenuContent
          className="min-w-56"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <ContextMenuItem
            disabled={!hasSelection}
            onSelect={() => void session.copySelection()}
          >
            <HugeiconsIcon icon={Copy01Icon} size={14} strokeWidth={1.75} />
            <span className="flex-1">Copy</span>
            <ContextMenuShortcut>{copyShortcut}</ContextMenuShortcut>
          </ContextMenuItem>
          {!blocks ? (
            <ContextMenuItem onSelect={() => void session.pasteClipboard()}>
              <HugeiconsIcon
                icon={ClipboardPasteIcon}
                size={14}
                strokeWidth={1.75}
              />
              <span className="flex-1">Paste</span>
              <ContextMenuShortcut>{pasteShortcut}</ContextMenuShortcut>
            </ContextMenuItem>
          ) : null}
          <ContextMenuItem onSelect={() => session.selectAll()}>
            <HugeiconsIcon
              icon={TextSelectionIcon}
              size={14}
              strokeWidth={1.75}
            />
            <span className="flex-1">Select All</span>
            <ContextMenuShortcut>{selectAllShortcut}</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => onSearch?.(leafId)}>
            <HugeiconsIcon icon={Search01Icon} size={14} strokeWidth={1.75} />
            <span className="flex-1">Search</span>
            <ContextMenuShortcut>{searchShortcut}</ContextMenuShortcut>
          </ContextMenuItem>
          {!blocks ? (
            <ContextMenuItem onSelect={() => session.clearScrollback()}>
              <HugeiconsIcon icon={CleanIcon} size={14} strokeWidth={1.75} />
              <span className="flex-1">Clear Scrollback</span>
              <ContextMenuShortcut>{clearShortcut}</ContextMenuShortcut>
            </ContextMenuItem>
          ) : null}
          {canSplit ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => onSplit?.(leafId, "row")}>
                <HugeiconsIcon
                  icon={LayoutTwoColumnIcon}
                  size={14}
                  strokeWidth={1.75}
                />
                <span>Split Right</span>
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => onSplit?.(leafId, "col")}>
                <HugeiconsIcon
                  icon={LayoutTwoRowIcon}
                  size={14}
                  strokeWidth={1.75}
                />
                <span>Split Down</span>
              </ContextMenuItem>
            </>
          ) : null}
          {paneCount > 1 || canCloseTab ? <ContextMenuSeparator /> : null}
          {paneCount > 1 ? (
            <ContextMenuItem onSelect={() => onClosePane?.(leafId)}>
              <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
              <span>Close Pane</span>
            </ContextMenuItem>
          ) : null}
          {canCloseTab ? (
            <ContextMenuItem onSelect={onCloseTab}>
              <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
              <span>Close Terminal Tab</span>
            </ContextMenuItem>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
    );
  }),
);
