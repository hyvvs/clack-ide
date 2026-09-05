import {
  File01Icon,
  Image01Icon,
  InformationCircleIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import {
  attachmentReferenceAsRecord,
  type AttachmentMessagePart,
} from "@/modules/ai/lib/attachmentMessages";
import { buildAttachmentPresentation } from "@/modules/ai/lib/attachmentPresentation";
import {
  inspectAttachmentContent,
  loadAttachmentContent,
} from "@/modules/ai/lib/attachmentStore";
import {
  AttachmentDetailsPopover,
  AttachmentStateIcon,
} from "./AttachmentDetailsPopover";

export function AttachmentMessageCard({
  part,
  selectedArchiveEntries = [],
}: {
  part: AttachmentMessagePart;
  selectedArchiveEntries?: string[];
}) {
  const { data } = part;
  const image =
    data.contentKind === "image" && data.mediaType !== "image/svg+xml";
  const anchorRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(!image);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const presentation = buildAttachmentPresentation(
    attachmentReferenceAsRecord(data),
    {
      delivered: true,
      contentAvailable: !failed,
      selectedArchiveEntries: selectedArchiveEntries.map((displayName) => ({
        displayName,
      })),
    },
  );

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
      title={`${presentation.statusLabel} · ${presentation.summary}`}
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
        <span className="flex min-w-0 items-center gap-1 truncate text-[10px] text-[var(--clack-text-3)]">
          <AttachmentStateIcon outcome={presentation.outcome} />
          <span className="shrink-0 font-medium">
            {presentation.statusLabel}
          </span>
          <span aria-hidden>·</span>
          <span className="truncate">{presentation.summary}</span>
        </span>
      </span>
      <AttachmentDetailsPopover
        displayName={data.displayName}
        presentation={presentation}
      >
        <button
          type="button"
          className="grid size-6 shrink-0 place-items-center rounded-[var(--clack-radius-button)] text-[var(--clack-text-3)] outline-none hover:bg-[var(--clack-surface-hover)] hover:text-[var(--clack-text-1)] focus-visible:ring-1 focus-visible:ring-[var(--clack-focus)]"
          aria-label={`Show delivery details for ${data.displayName}`}
          title="What the model received"
        >
          <HugeiconsIcon
            icon={InformationCircleIcon}
            size={12}
            strokeWidth={1.75}
          />
        </button>
      </AttachmentDetailsPopover>
    </div>
  );
}
