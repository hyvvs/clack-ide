import { cn } from "@/lib/utils";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, type MouseEvent } from "react";
import { InlineInput } from "./InlineInput";
import { explorerGitTextClass } from "./lib/gitStatusColor";
import type { GitStatusCode } from "./lib/gitStatusUtils";
import { fileIconUrl, folderIconUrl } from "./lib/iconResolver";

export type RowActions = {
  toggle: (path: string) => void;
  beginRename: (path: string) => void;
  commitRename: (newName: string) => void | Promise<void>;
  cancelRename: () => void;
};

export type EntryRowProps = {
  path: string;
  name: string;
  isDir: boolean;
  isExpanded: boolean;
  depth: number;
  actions: RowActions;
  renameInProgress: boolean;
  isSelected: boolean;
  isFocused?: boolean;
  isActiveFile?: boolean;
  isRenaming: boolean;
  isDropTarget?: boolean;
  onOpenFile: (path: string, pin?: boolean) => void;
  onSelectPath: (path: string, event: MouseEvent<HTMLButtonElement>) => void;
  gitStatusCode?: GitStatusCode | null;
  gitignored?: boolean;
};

function EntryRowImpl(props: EntryRowProps) {
  const {
    path,
    name,
    isDir,
    isExpanded,
    depth,
    actions,
    renameInProgress,
    isSelected,
    isFocused = false,
    isActiveFile = false,
    isRenaming,
    isDropTarget = false,
    onOpenFile,
    onSelectPath,
    gitStatusCode,
    gitignored = false,
  } = props;

  const iconUrl = isDir ? folderIconUrl(name, isExpanded) : fileIconUrl(name);
  const paddingLeft = 6 + depth * 12;

  if (isRenaming) {
    return (
      <div
        className="flex h-6 w-full min-w-0 items-center gap-2 px-1.5 text-[13px]"
        style={{ paddingLeft }}
      >
        <span className="size-3.5 shrink-0" />
        {iconUrl ? (
          <img src={iconUrl} alt="" className="size-4 shrink-0" />
        ) : (
          <span className="size-4 shrink-0" />
        )}
        <InlineInput
          initial={name}
          onCommit={actions.commitRename}
          onCancel={actions.cancelRename}
        />
      </div>
    );
  }

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (renameInProgress) return;
    onSelectPath(path, event);
    if (event.shiftKey || event.ctrlKey || event.metaKey) return;
    if (isDir) actions.toggle(path);
    else onOpenFile(path);
  };

  return (
    <button
      type="button"
      data-fs-path={path}
      onClick={handleClick}
      onDoubleClick={() => !isDir && actions.beginRename(path)}
      role="treeitem"
      aria-selected={isSelected}
      className={cn(
        "group relative flex h-6 w-full min-w-0 cursor-pointer items-center gap-2 rounded-[var(--clack-radius-button)] px-1.5 text-left text-[13px] transition-colors hover:bg-[rgba(159,177,210,0.08)]",
        isSelected
          ? "bg-[var(--clack-accent-soft)] text-[var(--clack-text-1)] ring-1 ring-inset ring-[var(--clack-border-accent)]"
          : gitignored
            ? "text-[var(--clack-text-3)]"
            : "text-[var(--clack-text-2)]",
        isFocused &&
          !isSelected &&
          "ring-1 ring-inset ring-[var(--clack-border-strong)]",
        isDropTarget &&
          "bg-[var(--clack-accent-soft)] ring-1 ring-inset ring-[var(--clack-focus)]",
      )}
      style={{ paddingLeft }}
    >
      {isActiveFile ? (
        <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-[var(--clack-focus)]" />
      ) : null}
      <span className="flex size-3.5 shrink-0 items-center justify-center text-[var(--clack-text-3)]">
        {isDir ? (
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={12}
            strokeWidth={2.25}
            className={cn("transition-transform", isExpanded && "rotate-90")}
          />
        ) : null}
      </span>
      {iconUrl ? (
        <img src={iconUrl} alt="" className="size-4 shrink-0" />
      ) : (
        <span className="size-4 shrink-0" />
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          !isSelected &&
            !gitignored &&
            gitStatusCode &&
            explorerGitTextClass(gitStatusCode),
        )}
      >
        {name}
      </span>
    </button>
  );
}

export const EntryRow = memo(EntryRowImpl);

export type PendingRowProps = {
  depth: number;
  kind: "file" | "dir";
  error?: string;
  onCommit: (name: string) => void | boolean | Promise<void | boolean>;
  onCancel: () => void;
  onValueChange?: () => void;
};

export function PendingRow({
  depth,
  kind,
  error,
  onCommit,
  onCancel,
  onValueChange,
}: PendingRowProps) {
  return (
    <div
      data-pending-create=""
      className="flex h-6 w-full min-w-0 items-center gap-2 px-1.5 text-[13px]"
      style={{ paddingLeft: 6 + depth * 12 }}
    >
      <span className="size-3.5 shrink-0" />
      <img
        src={
          kind === "dir" ? folderIconUrl("", false) : fileIconUrl("untitled")
        }
        alt=""
        className="size-4 shrink-0 opacity-70"
      />
      <InlineInput
        initial=""
        placeholder={kind === "dir" ? "New folder" : "New file"}
        commitOnBlur={!error}
        onCommit={onCommit}
        onCancel={onCancel}
        onValueChange={onValueChange}
      />
    </div>
  );
}

export function StatusRow({
  depth,
  message,
  tone,
}: {
  depth: number;
  message: string;
  tone: "muted" | "error";
}) {
  return (
    <div
      className={cn(
        "h-6 truncate px-2 text-[11px] leading-6",
        tone === "error" ? "text-[var(--clack-danger)]" : "text-[var(--clack-text-3)]",
      )}
      style={{ paddingLeft: 6 + depth * 12 + 18 }}
    >
      {message}
    </div>
  );
}
