import {
  Cancel01Icon,
  CodeIcon,
  HashtagIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import type { AttachmentRecord } from "../lib/attachments";
import { buildAttachmentPresentation } from "../lib/attachmentPresentation";
import type { AttachmentCapabilityStatus } from "../lib/modelCapabilities";
import type { Snippet } from "../lib/snippets";
import {
  AttachmentDetailsPopover,
  AttachmentStateIcon,
} from "./AttachmentDetailsPopover";
import { ArchiveAttachmentChip } from "./ArchiveAttachmentChip";
import { Chip } from "./Chip";

type CommandChip = { name: string; label: string; icon: typeof HashtagIcon };

type Props = {
  files: AttachmentRecord[];
  onRemoveFile: (id: string) => void;
  onMaterializeArchiveEntry: (
    archiveAttachmentId: string,
    entryIndex: number,
  ) => Promise<void>;
  snippets: Snippet[];
  onRemoveSnippet: (id: string) => void;
  commands: CommandChip[];
  onRemoveCommand: (name: string) => void;
  attachmentCapabilities?: Readonly<Record<string, AttachmentCapabilityStatus>>;
  modelLabel?: string;
  /** Passive chips rendered before the attachment chips (e.g. cwd + branch). */
  leading?: ReactNode;
};

export function ChipsRow({
  files,
  onRemoveFile,
  onMaterializeArchiveEntry,
  snippets,
  onRemoveSnippet,
  commands,
  onRemoveCommand,
  attachmentCapabilities,
  modelLabel,
  leading,
}: Props) {
  const hasAttachments =
    files.length > 0 || snippets.length > 0 || commands.length > 0;
  if (!leading && !hasAttachments) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {leading}
      {commands.map((cmd) => (
        <Chip
          key={`cmd-${cmd.name}`}
          icon={cmd.icon}
          title={cmd.label}
          onRemove={() => onRemoveCommand(cmd.name)}
          removeLabel="Remove command"
        >
          #{cmd.name}
        </Chip>
      ))}
      {snippets.map((s) => (
        <Chip
          key={`snip-${s.id}`}
          tone="primary"
          icon={HashtagIcon}
          title={s.description || s.name}
          onRemove={() => onRemoveSnippet(s.id)}
          removeLabel="Remove snippet"
        >
          {s.handle}
        </Chip>
      ))}
      {files.map((f) => {
        const selectedEntries = files.filter(
          (entry) =>
            entry.source.kind === "archive-entry" &&
            entry.source.archiveAttachmentId === f.id,
        );
        if (
          f.contentKind === "archive" &&
          f.processingState === "ready" &&
          f.archiveRepresentation
        ) {
          return (
            <ArchiveAttachmentChip
              key={f.id}
              archive={f}
              selectedEntries={selectedEntries}
              modelLabel={modelLabel}
              onMaterialize={(entryIndex) =>
                onMaterializeArchiveEntry(f.id, entryIndex)
              }
              onRemoveSelected={onRemoveFile}
              onRemove={() => onRemoveFile(f.id)}
            />
          );
        }
        const presentation = buildAttachmentPresentation(f, {
          capability: attachmentCapabilities?.[f.id],
          modelLabel,
        });
        return (
          <div
            key={f.id}
            className="group inline-flex h-7 min-w-0 max-w-[25rem] items-center rounded-md border border-border/40 bg-foreground/[0.03] text-[10.5px] text-foreground/75"
          >
            <AttachmentDetailsPopover
              displayName={f.displayName}
              presentation={presentation}
            >
              <button
                type="button"
                className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-l-md px-2 text-left outline-none hover:bg-foreground/[0.05] focus-visible:ring-1 focus-visible:ring-primary"
                title={`Show delivery details for ${f.displayName}`}
                aria-label={`Show delivery details for ${f.displayName}`}
              >
                {fileIcon(f)}
                <span className="max-w-32 truncate font-medium">
                  {f.displayName}
                </span>
                <span className="flex min-w-0 items-center gap-1 text-[10px] text-[var(--clack-text-3)]">
                  <AttachmentStateIcon outcome={presentation.outcome} />
                  <span className="shrink-0 font-medium">
                    {presentation.statusLabel}
                  </span>
                  <span aria-hidden>·</span>
                  <span className="truncate">{presentation.summary}</span>
                </span>
              </button>
            </AttachmentDetailsPopover>
            <button
              type="button"
              onClick={() => onRemoveFile(f.id)}
              aria-label={`Remove ${f.displayName}`}
              className="mr-1 grid size-4 shrink-0 place-items-center rounded-sm opacity-0 transition-opacity hover:!opacity-100 group-hover:opacity-60 focus-visible:opacity-100"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={2} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function fileIcon(f: AttachmentRecord): ReactNode {
  if (
    f.contentKind === "image" &&
    f.imageRepresentation &&
    f.detectedMediaType !== "image/svg+xml"
  ) {
    return (
      <img
        src={f.imageRepresentation}
        alt=""
        className="size-4 shrink-0 rounded object-cover"
      />
    );
  }
  if (f.contentKind === "selection") {
    return (
      <HugeiconsIcon
        icon={
          f.source.kind === "selection" && f.source.surface === "editor"
            ? CodeIcon
            : TerminalIcon
        }
        size={11}
        strokeWidth={1.75}
        className="shrink-0 opacity-80"
      />
    );
  }
  return (
    <span className="shrink-0 font-mono text-[10px] opacity-70">
      {extOf(f.displayName)}
    </span>
  );
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "FILE" : name.slice(i + 1).toUpperCase();
}
