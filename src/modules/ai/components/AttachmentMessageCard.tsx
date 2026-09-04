import {
  File01Icon,
  Image01Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { formatBytes } from "@/modules/ai/lib/attachments";
import type { AttachmentMessagePart } from "@/modules/ai/lib/attachmentMessages";
import {
  inspectAttachmentContent,
  loadAttachmentContent,
} from "@/modules/ai/lib/attachmentStore";

export function AttachmentMessageCard({
  part,
}: {
  part: AttachmentMessagePart;
}) {
  const { data } = part;
  const image =
    data.contentKind === "image" && data.mediaType !== "image/svg+xml";
  const anchorRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(!image);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!image || nearViewport) return;
    const anchor = anchorRef.current;
    if (!anchor || typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setNearViewport(true);
        observer.disconnect();
      },
      { rootMargin: "240px" },
    );
    observer.observe(anchor);
    return () => observer.disconnect();
  }, [image, nearViewport]);

  useEffect(() => {
    if (image && !nearViewport) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setFailed(false);
    const validation = image
      ? loadAttachmentContent(data.contentId)
      : inspectAttachmentContent(data.contentId);
    void validation
      .then((content) => {
        const byteSize =
          content instanceof Uint8Array ? content.byteLength : content.byteSize;
        if (byteSize !== data.byteSize) {
          throw new Error("Stored attachment size changed.");
        }
        if (!(content instanceof Uint8Array)) return;
        const nextUrl = URL.createObjectURL(
          new Blob([Uint8Array.from(content).buffer], { type: data.mediaType }),
        );
        if (cancelled) {
          URL.revokeObjectURL(nextUrl);
          return;
        }
        objectUrl = nextUrl;
        setPreviewUrl(nextUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [data.byteSize, data.contentId, data.mediaType, image, nearViewport]);

  return (
    <div
      ref={anchorRef}
      data-clack-attachment={data.attachmentId}
      className="flex min-w-0 max-w-sm items-center gap-2 rounded-[var(--clack-radius-button)] border border-[color:var(--clack-border-subtle)] bg-[var(--clack-surface-2)] p-1.5"
      title={`${data.mediaType} | ${formatBytes(data.byteSize)}`}
    >
      <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[4px] bg-[var(--clack-surface-3)] text-[var(--clack-text-3)]">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <HugeiconsIcon
            icon={
              image && nearViewport && !failed
                ? Loading03Icon
                : image
                  ? Image01Icon
                  : File01Icon
            }
            size={15}
            strokeWidth={1.7}
            className={image && nearViewport && !failed ? "animate-spin" : ""}
          />
        )}
      </div>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[11px] font-medium text-[var(--clack-text-1)]">
          {data.displayName}
        </span>
        <span className="truncate text-[10px] text-[var(--clack-text-3)]">
          {failed
            ? "Attachment unavailable"
            : attachmentKindLabel(data.contentKind)}
          {data.documentRepresentation
            ? ` | ${data.documentRepresentation.pageCount} page${data.documentRepresentation.pageCount === 1 ? "" : "s"}`
            : ""}
          {data.archiveRepresentation
            ? ` | ${data.archiveRepresentation.fileCount} files | ${formatBytes(data.archiveRepresentation.totalExpandedBytes)}`
            : ""}
          {` | ${formatBytes(data.byteSize)}`}
        </span>
      </span>
    </div>
  );
}

function attachmentKindLabel(
  kind: AttachmentMessagePart["data"]["contentKind"],
): string {
  if (kind === "selection") return "Selection";
  if (kind === "image") return "Image";
  if (kind === "document") return "PDF";
  if (kind === "archive") return "Archive";
  if (kind === "text") return "Text";
  return "File";
}
