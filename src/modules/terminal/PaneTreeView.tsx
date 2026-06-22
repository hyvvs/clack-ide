import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { SearchAddon } from "@xterm/addon-search";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Fragment } from "react";
import { useTerminalDropStore } from "./lib/dropStore";
import { leafIds, type PaneNode } from "./lib/panes";
import { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";

type LeafBundle = {
  setRef: (h: TerminalPaneHandle | null) => void;
  onSearchReady: (leafId: number, addon: SearchAddon) => void;
  onCwd: (leafId: number, cwd: string) => void;
  onExit: (leafId: number, code: number) => void;
};

type Props = {
  node: PaneNode;
  tabVisible: boolean;
  activeLeafId: number;
  blocks: boolean;
  paneCount: number;
  canSplit: boolean;
  canCloseTab: boolean;
  onFocusLeaf: (leafId: number) => void;
  onSplit: (leafId: number, dir: "row" | "col") => void;
  onClosePane: (leafId: number) => void;
  onCloseTab: () => void;
  onSearch: (leafId: number) => void;
  getBundle: (leafId: number) => LeafBundle;
};

export function PaneTreeView(props: Props) {
  const { node } = props;
  if (node.kind === "leaf") {
    const {
      tabVisible,
      activeLeafId,
      blocks,
      paneCount,
      canSplit,
      canCloseTab,
      onFocusLeaf,
      onSplit,
      onClosePane,
      onCloseTab,
      onSearch,
      getBundle,
    } = props;
    const focused = node.id === activeLeafId;
    const b = getBundle(node.id);
    return (
      <div
        onMouseDownCapture={() => {
          if (!focused) onFocusLeaf(node.id);
        }}
        // Catches focus from Tab, programmatic focus, or any path that
        // skips mousedown — keeps activeLeafId in sync with DOM focus.
        onFocus={() => {
          if (!focused) onFocusLeaf(node.id);
        }}
        onContextMenuCapture={() => {
          if (!focused) onFocusLeaf(node.id);
        }}
        data-pane-leaf={node.id}
        className="group/pane relative h-full min-h-0 w-full overflow-hidden"
      >
        <TerminalPane
          leafId={node.id}
          visible={tabVisible}
          focused={focused}
          initialCwd={node.cwd}
          blocks={blocks}
          ref={b.setRef}
          onSearchReady={b.onSearchReady}
          onCwd={b.onCwd}
          onExit={b.onExit}
          paneCount={paneCount}
          canSplit={canSplit}
          canCloseTab={canCloseTab}
          onSplit={onSplit}
          onClosePane={onClosePane}
          onCloseTab={onCloseTab}
          onSearch={onSearch}
        />
        {paneCount > 1 || canCloseTab ? (
          <button
            type="button"
            aria-label={
              paneCount > 1 ? "Close terminal pane" : "Close terminal tab"
            }
            title={paneCount > 1 ? "Close pane" : "Close terminal tab"}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              onClosePane(node.id);
            }}
            className={`absolute right-2 top-2 z-20 inline-flex size-6 items-center justify-center rounded-[var(--clack-radius-button)] border border-[color:var(--clack-border-subtle)] bg-[color-mix(in_srgb,var(--clack-surface-raised)_92%,transparent)] text-[var(--clack-text-3)] shadow-sm outline-none transition-[opacity,color,background-color] hover:bg-[var(--clack-accent-soft)] hover:text-[var(--clack-text-1)] focus-visible:ring-1 focus-visible:ring-[var(--clack-focus)] ${
              focused
                ? "opacity-70 hover:opacity-100"
                : "opacity-0 group-hover/pane:opacity-70 focus:opacity-100"
            }`}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
          </button>
        ) : null}
        <DropOverlay leafId={node.id} />
      </div>
    );
  }

  return (
    <ResizablePanelGroup
      orientation={node.dir === "row" ? "horizontal" : "vertical"}
    >
      {node.children.map((child, i) => (
        // Keyed by the subtree's first leaf, not the node id: when a leaf is
        // split in place, the replacing split node gets a fresh id and would
        // otherwise remount the surviving pane.
        <Fragment key={leafIds(child)[0]}>
          {i > 0 && <ResizableHandle />}
          <ResizablePanel id={`pane-${child.id}`} minSize="10%">
            <PaneTreeView {...props} node={child} />
          </ResizablePanel>
        </Fragment>
      ))}
    </ResizablePanelGroup>
  );
}

function DropOverlay({ leafId }: { leafId: number }) {
  const active = useTerminalDropStore((s) => s.targetLeafId === leafId);
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-lg border border-primary/45 bg-background/70 text-xs font-medium text-foreground shadow-lg backdrop-blur-sm">
      Drop file path here
    </div>
  );
}
