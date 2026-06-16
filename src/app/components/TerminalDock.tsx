import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { labelFor, TabIcon, type Tab, type TerminalTab } from "@/modules/tabs";
import { TerminalStack, type TerminalPaneHandle } from "@/modules/terminal";
import type { SearchAddon } from "@xterm/addon-search";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  ComputerTerminal02Icon,
  IncognitoIcon,
  LayoutTwoColumnIcon,
  LayoutTwoRowIcon,
  PencilEdit02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";

type Props = {
  tabs: TerminalTab[];
  stackTabs: Tab[];
  activeId: number | null;
  height: number;
  collapsed: boolean;
  canSplit: boolean;
  onResizeHeight: (height: number) => void;
  onToggleCollapsed: () => void;
  onSelect: (id: number) => void;
  onNew: () => void;
  onNewBlock: () => void;
  onNewPrivate: () => void;
  onClose: (id: number) => void;
  onRename: (id: number, title: string) => void;
  onSplitRight: () => void;
  onSplitDown: () => void;
  registerHandle: (leafId: number, handle: TerminalPaneHandle | null) => void;
  onSearchReady: (leafId: number, addon: SearchAddon) => void;
  onCwd: (leafId: number, cwd: string) => void;
  onExit: (leafId: number, code: number) => void;
  onFocusLeaf: (tabId: number, leafId: number) => void;
};

export function TerminalDock({
  tabs,
  stackTabs,
  activeId,
  height,
  collapsed,
  canSplit,
  onResizeHeight,
  onToggleCollapsed,
  onSelect,
  onNew,
  onNewBlock,
  onNewPrivate,
  onClose,
  onRename,
  onSplitRight,
  onSplitDown,
  registerHandle,
  onSearchReady,
  onCwd,
  onExit,
  onFocusLeaf,
}: Props) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const dockRef = useRef<HTMLElement | null>(null);
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0] ?? null;
  const activeLabel = activeTab ? labelFor(activeTab) : "No terminal";
  const maxHeight = getMaxDockHeight();

  const beginResize = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (collapsed) return;
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = height;
      const onMove = (moveEvent: globalThis.PointerEvent) => {
        onResizeHeight(
          clampDockHeight(startHeight + startY - moveEvent.clientY),
        );
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
    },
    [collapsed, height, onResizeHeight],
  );

  if (collapsed) {
    return (
      <section
        ref={dockRef}
        className="clack-terminal-dock flex h-9 shrink-0 items-center gap-2 border-t px-2 text-[11px]"
      >
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--clack-radius-button)] px-2 py-1 text-left text-[var(--clack-text-2)] outline-none transition-colors hover:bg-[rgba(159,177,210,0.08)] hover:text-[var(--clack-text-1)] focus-visible:ring-1 focus-visible:ring-[var(--clack-focus)]"
          title="Expand terminal"
        >
          <HugeiconsIcon
            icon={ArrowUp01Icon}
            size={13}
            strokeWidth={1.9}
            className="shrink-0 text-[var(--clack-accent)]"
          />
          <span className="font-semibold uppercase tracking-[0.14em]">
            Terminal
          </span>
          <span className="min-w-0 truncate text-[var(--clack-text-3)]">{activeLabel}</span>
          <span className="clack-pill ml-auto px-1.5 py-px font-mono text-[10px]">
            {tabs.length}
          </span>
        </button>
        <NewTerminalMenu
          onNew={onNew}
          onNewBlock={onNewBlock}
          onNewPrivate={onNewPrivate}
        />
      </section>
    );
  }

  return (
    <section
      ref={dockRef}
      className="clack-terminal-dock relative flex shrink-0 flex-col overflow-hidden border-t text-[var(--clack-text-1)]"
      style={{ height }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-valuemin={160}
        aria-valuemax={maxHeight}
        aria-valuenow={height}
        tabIndex={0}
        title="Resize terminal panel"
        onPointerDown={beginResize}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") {
            event.preventDefault();
            onResizeHeight(clampDockHeight(height + 24));
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            onResizeHeight(clampDockHeight(height - 24));
          }
        }}
        className="absolute inset-x-0 top-0 z-10 h-2 cursor-row-resize bg-transparent before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-[var(--clack-border-accent)] hover:before:bg-[var(--clack-accent)]"
      />
      <header
        data-tauri-drag-region
        className="flex h-9 shrink-0 items-center gap-2 border-b border-[color:var(--clack-border-subtle)] bg-[color-mix(in_srgb,var(--clack-bg-shell)_94%,transparent)] px-2 pl-3"
      >
        <div className="flex shrink-0 items-center gap-2">
          <span className="inline-flex size-5 items-center justify-center rounded-[var(--clack-radius-button)] border border-[color:var(--clack-border-accent)] bg-[var(--clack-accent-soft)] text-[var(--clack-accent)]">
            <HugeiconsIcon
              icon={ComputerTerminal02Icon}
              size={13}
              strokeWidth={1.8}
            />
          </span>
          <span className="clack-section-label">
            Terminal
          </span>
          <span className="clack-pill px-1.5 py-px font-mono text-[10px]">
            {tabs.length}
          </span>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const active = tab.id === activeId;
            if (editingId === tab.id) {
              return (
                <div
                  key={tab.id}
                  className="flex h-6 min-w-28 shrink-0 items-center gap-1.5 rounded-[var(--clack-radius-button)] border border-[color:var(--clack-border-accent)] bg-[var(--clack-accent-soft)] px-1.5"
                >
                  <TabIcon tab={tab} />
                  <TerminalRenameInput
                    initial={labelFor(tab)}
                    onCommit={(value) => {
                      onRename(tab.id, value);
                      setEditingId(null);
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                </div>
              );
            }

            const tabButton = (
              <div
                key={tab.id}
                className={cn(
                  "clack-tab group flex h-6 min-w-0 max-w-52 shrink-0 items-center gap-1.5 px-1.5 text-[11px] outline-none transition-colors",
                  active
                    ? "border-[color:var(--clack-border-accent)] bg-[var(--clack-accent-soft)] text-[var(--clack-text-1)]"
                    : "border-transparent text-[var(--clack-text-3)]",
                )}
              >
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelect(tab.id)}
                  onAuxClick={(event) => {
                    if (event.button === 1 && tabs.length > 1) {
                      event.preventDefault();
                      onClose(tab.id);
                    }
                  }}
                  className="flex min-w-0 flex-1 items-center gap-1.5 outline-none"
                >
                  <TabIcon tab={tab} />
                  <span className="min-w-0 truncate">{labelFor(tab)}</span>
                </button>
                {tabs.length > 1 ? (
                  <button
                    type="button"
                    aria-label="Close terminal"
                    onClick={(event) => {
                      event.stopPropagation();
                      onClose(tab.id);
                    }}
                    className="ml-0.5 rounded p-0.5 opacity-0 transition-opacity hover:bg-[rgba(159,177,210,0.14)] group-hover:opacity-75"
                  >
                    <HugeiconsIcon
                      icon={Cancel01Icon}
                      size={10}
                      strokeWidth={2}
                    />
                  </button>
                ) : null}
              </div>
            );

            return (
              <ContextMenu key={tab.id}>
                <ContextMenuTrigger asChild>{tabButton}</ContextMenuTrigger>
                <ContextMenuContent
                  className="min-w-36"
                  onCloseAutoFocus={(event) => event.preventDefault()}
                >
                  <ContextMenuItem onSelect={() => setEditingId(tab.id)}>
                    <HugeiconsIcon
                      icon={PencilEdit02Icon}
                      size={14}
                      strokeWidth={1.75}
                    />
                    <span className="flex-1">Rename</span>
                  </ContextMenuItem>
                  {tabs.length > 1 ? (
                    <>
                      <ContextMenuSeparator />
                      <ContextMenuItem onSelect={() => onClose(tab.id)}>
                        <HugeiconsIcon
                          icon={Cancel01Icon}
                          size={14}
                          strokeWidth={1.75}
                        />
                        <span className="flex-1">Close</span>
                      </ContextMenuItem>
                    </>
                  ) : null}
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <DockAction
            label="Split right"
            icon={LayoutTwoColumnIcon}
            disabled={!canSplit}
            onClick={onSplitRight}
          />
          <DockAction
            label="Split down"
            icon={LayoutTwoRowIcon}
            disabled={!canSplit}
            onClick={onSplitDown}
          />
          <NewTerminalMenu
            onNew={onNew}
            onNewBlock={onNewBlock}
            onNewPrivate={onNewPrivate}
          />
          <DockAction
            label="Collapse terminal"
            icon={ArrowDown01Icon}
            onClick={onToggleCollapsed}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 bg-[linear-gradient(180deg,rgba(125,183,255,0.045),transparent_42%)] p-2">
        {tabs.length > 0 && activeId !== null ? (
          <TerminalStack
            tabs={stackTabs}
            activeId={activeId}
            registerHandle={registerHandle}
            onSearchReady={onSearchReady}
            onCwd={onCwd}
            onExit={onExit}
            onFocusLeaf={onFocusLeaf}
          />
        ) : (
          <div className="grid h-full place-items-center text-xs text-[var(--clack-text-3)]">
            No terminal is open
          </div>
        )}
      </div>
    </section>
  );
}

function NewTerminalMenu({
  onNew,
  onNewBlock,
  onNewPrivate,
}: {
  onNew: () => void;
  onNewBlock: () => void;
  onNewPrivate: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          title="New terminal"
        >
          <HugeiconsIcon icon={PlusSignIcon} size={13} strokeWidth={2} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-44"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DropdownMenuItem onSelect={onNew}>
          <HugeiconsIcon
            icon={ComputerTerminal02Icon}
            size={14}
            strokeWidth={1.75}
          />
          <span className="flex-1">Terminal</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onNewBlock}>
          <HugeiconsIcon
            icon={ComputerTerminal02Icon}
            size={14}
            strokeWidth={1.75}
          />
          <span className="flex-1">Blocks</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onNewPrivate}>
          <HugeiconsIcon icon={IncognitoIcon} size={14} strokeWidth={1.75} />
          <span className="flex-1">Private</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DockAction({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: typeof LayoutTwoColumnIcon;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-6 disabled:opacity-35"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <HugeiconsIcon icon={icon} size={13} strokeWidth={1.85} />
    </Button>
  );
}

function TerminalRenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const finish = (fn: () => void) => {
    if (done.current) return;
    done.current = true;
    fn();
  };

  const commit = (value: string, explicit: boolean) => {
    if (!explicit && value.trim() === initial.trim()) finish(onCancel);
    else finish(() => onCommit(value));
  };

  return (
    <input
      ref={ref}
      defaultValue={initial}
      aria-label="Rename terminal"
      className="min-w-0 flex-1 rounded-[var(--clack-radius-button)] border border-[color:var(--clack-border-subtle)] bg-[var(--clack-bg-root)] px-1 text-[11px] text-[var(--clack-text-1)] outline-none focus:border-[color:var(--clack-border-accent)]"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") commit(event.currentTarget.value, true);
        else if (event.key === "Escape") finish(onCancel);
      }}
      onBlur={(event) => {
        if (!document.hasFocus()) return;
        commit(event.currentTarget.value, false);
      }}
    />
  );
}

function clampDockHeight(height: number): number {
  const max = getMaxDockHeight();
  return Math.min(max, Math.max(160, Math.round(height)));
}

function getMaxDockHeight(): number {
  const viewport = typeof window === "undefined" ? 900 : window.innerHeight;
  return Math.max(260, Math.round(viewport * 0.72));
}
