import {
  AlertCircleIcon,
  Cancel01Icon,
  File01Icon,
  Folder01Icon,
  Search01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  type ArchiveManifestEntry,
  type AttachmentRecord,
  formatBytes,
} from "@/modules/ai/lib/attachments";

const MAX_VISIBLE_ENTRIES = 200;

type Props = {
  archive: AttachmentRecord;
  selectedEntries: AttachmentRecord[];
  onMaterialize: (entryIndex: number) => Promise<void>;
  onRemoveSelected: (attachmentId: string) => void;
  onRemove: () => void;
};

export function ArchiveAttachmentChip({
  archive,
  selectedEntries,
  onMaterialize,
  onRemoveSelected,
  onRemove,
}: Props) {
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<Set<number>>(() => new Set());
  const [entryError, setEntryError] = useState<Record<number, string>>({});
  const representation = archive.archiveRepresentation;
  const selectedByIndex = useMemo(
    () =>
      new Map(
        selectedEntries.flatMap((entry) =>
          entry.source.kind === "archive-entry"
            ? [[entry.source.entryIndex, entry] as const]
            : [],
        ),
      ),
    [selectedEntries],
  );
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const entries = representation?.entries ?? [];
    const matching = normalized
      ? entries.filter((entry) =>
          entry.path.toLocaleLowerCase().includes(normalized),
        )
      : entries;
    return {
      total: matching.length,
      visible: matching.slice(0, MAX_VISIBLE_ENTRIES),
    };
  }, [query, representation?.entries]);

  const toggleEntry = async (entry: ArchiveManifestEntry) => {
    const selected = selectedByIndex.get(entry.index);
    if (selected) {
      onRemoveSelected(selected.id);
      return;
    }
    if (!entry.selectable || pending.has(entry.index)) return;
    setEntryError((current) => {
      const next = { ...current };
      delete next[entry.index];
      return next;
    });
    setPending((current) => new Set(current).add(entry.index));
    try {
      await onMaterialize(entry.index);
    } catch (error) {
      setEntryError((current) => ({
        ...current,
        [entry.index]: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(entry.index);
        return next;
      });
    }
  };

  return (
    <Popover>
      <div className="group inline-flex h-[22px] items-center rounded-md border border-border/40 bg-foreground/[0.03] text-[11px] leading-none text-foreground/75">
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex h-full min-w-0 items-center gap-1.5 rounded-l-md px-2 outline-none hover:bg-foreground/[0.05] focus-visible:ring-1 focus-visible:ring-primary"
            title="Inspect archive contents"
          >
            <HugeiconsIcon icon={File01Icon} size={11} strokeWidth={1.75} />
            <span className="max-w-[10rem] truncate font-medium">
              {archive.displayName}
            </span>
            {representation ? (
              <span className="shrink-0 opacity-60">
                · {representation.fileCount} files
              </span>
            ) : null}
          </button>
        </PopoverTrigger>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${archive.displayName}`}
          className="mr-1 grid size-3.5 shrink-0 place-items-center rounded-sm opacity-0 transition-opacity hover:!opacity-100 group-hover:opacity-60 focus-visible:opacity-100"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={2} />
        </button>
      </div>
      <PopoverContent
        align="start"
        className="w-[min(30rem,calc(100vw-2rem))] gap-0 overflow-hidden p-0"
      >
        <div className="border-b border-border/50 px-3 py-2.5">
          <div className="truncate text-xs font-semibold text-foreground">
            {archive.displayName}
          </div>
          <div className="mt-0.5 text-[10.5px] text-muted-foreground">
            {representation
              ? `${representation.fileCount} files · ${representation.folderCount} folders · ${formatBytes(representation.totalExpandedBytes)}${representation.encrypted ? " · encrypted" : ""}`
              : "Archive manifest unavailable"}
          </div>
        </div>
        <label className="relative mx-3 my-2 block">
          <HugeiconsIcon
            icon={Search01Icon}
            size={13}
            strokeWidth={1.75}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter archive entries"
            className="h-7 w-full rounded-md border border-border/60 bg-background/45 pl-7 pr-2 text-[11px] outline-none placeholder:text-muted-foreground/70 focus:border-primary/60"
          />
        </label>
        <div className="max-h-72 overflow-y-auto border-t border-border/40 py-1">
          {filtered.visible.map((entry) => {
            const selected = selectedByIndex.get(entry.index);
            const isPending = pending.has(entry.index);
            const error = entryError[entry.index];
            const blockedReason = error ?? entry.reason;
            const depth = Math.min(entry.path.split("/").length - 1, 4);
            const name = entry.path.split("/").pop() ?? entry.path;
            const row = (
              <>
                <HugeiconsIcon
                  icon={
                    entry.entryType === "folder" ? Folder01Icon : File01Icon
                  }
                  size={13}
                  strokeWidth={1.6}
                  className="shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] text-foreground/85">
                    {name}
                  </span>
                  {entry.path !== name ? (
                    <span className="block truncate text-[9.5px] text-muted-foreground/75">
                      {entry.path}
                    </span>
                  ) : null}
                </span>
                {entry.entryType === "file" ? (
                  <span className="shrink-0 text-[9.5px] text-muted-foreground">
                    {formatBytes(entry.expandedSize)}
                  </span>
                ) : null}
                {selected ? (
                  <HugeiconsIcon
                    icon={Tick02Icon}
                    size={13}
                    strokeWidth={2}
                    className="shrink-0 text-primary"
                  />
                ) : blockedReason ? (
                  <HugeiconsIcon
                    icon={AlertCircleIcon}
                    size={13}
                    strokeWidth={1.75}
                    className="shrink-0 text-destructive"
                  />
                ) : null}
              </>
            );
            if (entry.entryType === "folder") {
              return (
                <div
                  key={entry.index}
                  className="flex min-h-8 items-center gap-2 px-3 py-1"
                  style={{ paddingLeft: `${12 + depth * 10}px` }}
                >
                  {row}
                </div>
              );
            }
            return (
              <button
                key={entry.index}
                type="button"
                disabled={!entry.selectable || isPending}
                title={blockedReason}
                onClick={() => void toggleEntry(entry)}
                className={cn(
                  "flex min-h-8 w-full items-center gap-2 px-3 py-1 text-left outline-none hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.07]",
                  selected && "bg-primary/[0.08]",
                  (!entry.selectable || isPending) &&
                    "cursor-not-allowed opacity-55 hover:bg-transparent",
                )}
                style={{ paddingLeft: `${12 + depth * 10}px` }}
              >
                {row}
              </button>
            );
          })}
          {filtered.total === 0 ? (
            <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">
              No matching entries
            </div>
          ) : null}
        </div>
        {filtered.total > filtered.visible.length ? (
          <div className="border-t border-border/40 px-3 py-2 text-[10px] text-muted-foreground">
            Showing {filtered.visible.length} of {filtered.total}. Filter to
            find other entries.
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
