import {
  AlertCircleIcon,
  CodeIcon,
  HashtagIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { type AttachmentRecord, formatBytes } from "../lib/attachments";
import type { Snippet } from "../lib/snippets";
import { Chip } from "./Chip";

type CommandChip = { name: string; label: string; icon: typeof HashtagIcon };

type Props = {
  files: AttachmentRecord[];
  onRemoveFile: (id: string) => void;
  snippets: Snippet[];
  onRemoveSnippet: (id: string) => void;
  commands: CommandChip[];
  onRemoveCommand: (name: string) => void;
  /** Passive chips rendered before the attachment chips (e.g. cwd + branch). */
  leading?: ReactNode;
};

export function ChipsRow({
  files,
  onRemoveFile,
  snippets,
  onRemoveSnippet,
  commands,
  onRemoveCommand,
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
      {files.map((f) => (
        <Chip
          key={f.id}
          iconNode={fileIcon(f)}
          title={
            f.error?.message ??
            `${f.detectedMediaType} · ${formatBytes(f.byteSize)}`
          }
          onRemove={() => onRemoveFile(f.id)}
        >
          {f.displayName}
          {f.contentKind === "selection" && f.textRepresentation ? (
            <span className="ml-1 opacity-60">
              · {selLineCount(f.textRepresentation)}L
            </span>
          ) : null}
          {f.processingState !== "ready" ? (
            <span className="ml-1 text-destructive">
              · {f.processingState === "unsupported" ? "Unsupported" : "Failed"}
            </span>
          ) : null}
        </Chip>
      ))}
    </div>
  );
}

function fileIcon(f: AttachmentRecord): ReactNode {
  if (f.processingState !== "ready") {
    return (
      <HugeiconsIcon
        icon={AlertCircleIcon}
        size={11}
        strokeWidth={1.75}
        className="shrink-0 text-destructive"
      />
    );
  }
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

function selLineCount(text: string): number {
  if (!text) return 0;
  const trimmed = text.replace(/\n+$/, "");
  if (!trimmed) return 0;
  return trimmed.split("\n").length;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "FILE" : name.slice(i + 1).toUpperCase();
}
