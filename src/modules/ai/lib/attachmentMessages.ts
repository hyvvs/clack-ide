import type { UIMessage } from "ai";
import type {
  ArchiveRepresentation,
  AttachmentRecord,
  DocumentRepresentation,
} from "./attachments";
import {
  attachmentBytesToDataUrl,
  loadAttachmentContent,
  storeAttachmentContent,
  type AttachmentContentRef,
} from "./attachmentStore";
import {
  attachmentCapabilityStatus,
  type ModelInputCapabilities,
} from "./modelCapabilities";

export const CLACK_ATTACHMENT_PART_TYPE = "data-clack-attachment" as const;
const ATTACHMENT_CONTENT_KINDS = new Set([
  "text",
  "image",
  "selection",
  "document",
  "archive",
  "binary",
]);

export type AttachmentMessageReference = {
  attachmentId: string;
  contentId: string;
  contentHash: string;
  displayName: string;
  mediaType: string;
  byteSize: number;
  contentKind: AttachmentRecord["contentKind"];
  selectionSource?: "terminal" | "editor";
  archiveEntryProvenance?: {
    archiveAttachmentId: string;
    archiveContentId: string;
    archiveContentHash: string;
    archiveFormat: "zip" | "7z";
    archiveDisplayName: string;
    entryIndex: number;
    entryPath: string;
  };
  documentRepresentation?: DocumentRepresentation;
  archiveRepresentation?: Omit<ArchiveRepresentation, "entries">;
};

export type AttachmentMessagePart = {
  type: typeof CLACK_ATTACHMENT_PART_TYPE;
  data: AttachmentMessageReference;
};

type MaterializeDeps = {
  loadContent: (id: string) => Promise<Uint8Array>;
  toDataUrl: (bytes: Uint8Array, mediaType: string) => Promise<string>;
};

type LegacyMigrationDeps = {
  storeContent: (bytes: Uint8Array) => Promise<AttachmentContentRef>;
};

export function toAttachmentMessagePart(
  record: AttachmentRecord,
): AttachmentMessagePart {
  if (!record.contentRef || record.processingState !== "ready") {
    throw new Error("Attachment content is not ready for delivery.");
  }
  return {
    type: CLACK_ATTACHMENT_PART_TYPE,
    data: {
      attachmentId: record.id,
      contentId: record.contentRef.id,
      contentHash: record.contentRef.contentHash,
      displayName: record.displayName,
      mediaType: record.detectedMediaType,
      byteSize: record.byteSize,
      contentKind: record.contentKind,
      ...(record.source.kind === "selection"
        ? { selectionSource: record.source.surface }
        : {}),
      ...(record.source.kind === "archive-entry"
        ? {
            archiveEntryProvenance: {
              archiveAttachmentId: record.source.archiveAttachmentId,
              archiveContentId: record.source.archiveContentId,
              archiveContentHash: record.source.archiveContentHash,
              archiveFormat: record.source.archiveFormat,
              archiveDisplayName: record.source.archiveDisplayName,
              entryIndex: record.source.entryIndex,
              entryPath: record.source.path,
            },
          }
        : {}),
      ...(record.documentRepresentation
        ? { documentRepresentation: record.documentRepresentation }
        : {}),
      ...(record.archiveRepresentation
        ? {
            archiveRepresentation: {
              format: record.archiveRepresentation.format,
              entryCount: record.archiveRepresentation.entryCount,
              fileCount: record.archiveRepresentation.fileCount,
              folderCount: record.archiveRepresentation.folderCount,
              totalCompressedBytes:
                record.archiveRepresentation.totalCompressedBytes,
              totalExpandedBytes:
                record.archiveRepresentation.totalExpandedBytes,
              nestedArchiveDepthLimit:
                record.archiveRepresentation.nestedArchiveDepthLimit,
              manifestContentRef:
                record.archiveRepresentation.manifestContentRef,
            },
          }
        : {}),
    },
  };
}

export function isAttachmentMessagePart(
  value: unknown,
): value is AttachmentMessagePart {
  if (!value || typeof value !== "object") return false;
  const part = value as { type?: unknown; data?: unknown };
  if (part.type !== CLACK_ATTACHMENT_PART_TYPE) return false;
  if (!part.data || typeof part.data !== "object") return false;
  const data = part.data as Partial<AttachmentMessageReference>;
  return (
    typeof data.attachmentId === "string" &&
    data.attachmentId.length > 0 &&
    data.attachmentId.length <= 256 &&
    typeof data.contentId === "string" &&
    /^[a-f0-9]{64}$/.test(data.contentId) &&
    data.contentHash === data.contentId &&
    typeof data.displayName === "string" &&
    data.displayName.length > 0 &&
    data.displayName.length <= 1024 &&
    typeof data.mediaType === "string" &&
    data.mediaType.length > 0 &&
    data.mediaType.length <= 256 &&
    typeof data.byteSize === "number" &&
    Number.isInteger(data.byteSize) &&
    data.byteSize > 0 &&
    data.byteSize <= 8 * 1024 * 1024 &&
    typeof data.contentKind === "string" &&
    ATTACHMENT_CONTENT_KINDS.has(data.contentKind) &&
    (data.documentRepresentation == null || data.contentKind === "document") &&
    validDocumentRepresentation(data.documentRepresentation) &&
    validArchiveEntryProvenance(data.archiveEntryProvenance) &&
    (data.archiveRepresentation == null || data.contentKind === "archive") &&
    validArchiveRepresentation(data.archiveRepresentation)
  );
}

export function collectAttachmentContentIds(messages: unknown): string[] {
  if (!Array.isArray(messages)) return [];
  const ids = new Set<string>();
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const parts = (message as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (!isAttachmentMessagePart(part)) continue;
      ids.add(part.data.contentId);
      const extracted = part.data.documentRepresentation?.textContentRef;
      if (extracted) ids.add(extracted.id);
      const manifest = part.data.archiveRepresentation?.manifestContentRef;
      if (manifest) ids.add(manifest.id);
    }
  }
  return [...ids];
}

export async function materializeAttachmentMessages(
  messages: UIMessage[],
  capabilities: ModelInputCapabilities,
  deps: MaterializeDeps = {
    loadContent: loadAttachmentContent,
    toDataUrl: attachmentBytesToDataUrl,
  },
): Promise<UIMessage[]> {
  let changed = false;
  const materialized: UIMessage[] = [];
  for (const message of messages) {
    let messageChanged = false;
    const parts: unknown[] = [];
    for (const part of message.parts) {
      if (!isAttachmentMessagePart(part)) {
        parts.push(part);
        continue;
      }
      changed = true;
      messageChanged = true;
      const reference = part.data;
      const compatibility = attachmentCapabilityStatus(
        referenceAsRecord(reference),
        capabilities,
      );
      if (compatibility.state === "blocked") {
        throw new AttachmentCapabilityError(
          reference.displayName,
          compatibility.support,
          compatibility.message,
        );
      }
      if (
        reference.contentKind !== "text" &&
        reference.contentKind !== "selection" &&
        reference.contentKind !== "image" &&
        reference.contentKind !== "document" &&
        reference.contentKind !== "archive"
      ) {
        parts.push({
          type: "text",
          text: `Attachment ${JSON.stringify(reference.displayName)} is available as metadata only.`,
        });
        continue;
      }
      const contentRef = (() => {
        if (reference.contentKind === "document") {
          return reference.documentRepresentation?.textContentRef;
        }
        if (reference.contentKind === "archive") {
          return reference.archiveRepresentation?.manifestContentRef;
        }
        return { id: reference.contentId, byteSize: reference.byteSize };
      })();
      if (!contentRef) {
        parts.push({
          type: "text",
          text: `${reference.contentKind === "archive" ? "Archive" : "PDF"} ${JSON.stringify(reference.displayName)} has no inspectable representation.`,
        });
        continue;
      }
      const bytes = await deps.loadContent(contentRef.id);
      if (bytes.byteLength !== contentRef.byteSize) {
        throw new Error(
          `Stored attachment size changed for ${reference.displayName}.`,
        );
      }
      if (
        reference.contentKind === "text" ||
        reference.contentKind === "selection"
      ) {
        const text = decodeStoredText(bytes, reference.displayName);
        parts.push({
          type: "text",
          text:
            reference.contentKind === "selection"
              ? formatSelectionBlock(reference, text)
              : formatTextBlock(reference, text),
        });
        continue;
      }
      if (
        reference.contentKind === "document" ||
        reference.contentKind === "archive"
      ) {
        parts.push({
          type: "text",
          text: decodeStoredText(bytes, reference.displayName),
        });
        continue;
      }
      if (reference.contentKind === "image") {
        if (reference.mediaType === "image/svg+xml") {
          parts.push({
            type: "text",
            text: formatTextBlock(
              reference,
              decodeStoredText(bytes, reference.displayName),
            ),
          });
        } else {
          parts.push({
            type: "file",
            mediaType: reference.mediaType,
            filename: reference.displayName,
            url: await deps.toDataUrl(bytes, reference.mediaType),
          });
        }
      }
    }
    materialized.push(
      messageChanged ? ({ ...message, parts } as UIMessage) : message,
    );
  }
  return changed ? materialized : messages;
}

export class AttachmentCapabilityError extends Error {
  readonly code = "attachment_capability_blocked";

  constructor(
    readonly attachmentName: string,
    readonly support: "unsupported" | "unknown",
    message: string,
  ) {
    super(`${attachmentName}: ${message}`);
    this.name = "AttachmentCapabilityError";
  }
}

export async function migrateLegacyDataUrlAttachments(
  messages: UIMessage[],
  deps: LegacyMigrationDeps = { storeContent: storeAttachmentContent },
): Promise<{ messages: UIMessage[]; changed: boolean }> {
  let changed = false;
  const migrated: UIMessage[] = [];
  for (const message of messages) {
    const parts: unknown[] = [];
    for (let index = 0; index < message.parts.length; index += 1) {
      const part = message.parts[index] as {
        type?: unknown;
        url?: unknown;
        mediaType?: unknown;
        filename?: unknown;
      };
      if (part.type !== "file" || typeof part.url !== "string") {
        parts.push(part);
        continue;
      }
      const decoded = decodeLegacyDataUrl(part.url);
      if (!decoded) {
        parts.push(part);
        continue;
      }
      let stored: AttachmentContentRef;
      try {
        stored = await deps.storeContent(decoded.bytes);
      } catch {
        parts.push(part);
        continue;
      }
      const mediaType =
        typeof part.mediaType === "string" && part.mediaType
          ? part.mediaType
          : decoded.mediaType;
      const displayName =
        typeof part.filename === "string" && part.filename
          ? part.filename
          : `Attachment ${index + 1}`;
      parts.push({
        type: CLACK_ATTACHMENT_PART_TYPE,
        data: {
          attachmentId: `legacy-${message.id}-${index}`,
          contentId: stored.id,
          contentHash: stored.contentHash,
          displayName,
          mediaType,
          byteSize: stored.byteSize,
          contentKind: mediaType.startsWith("image/") ? "image" : "binary",
        } satisfies AttachmentMessageReference,
      });
      changed = true;
    }
    migrated.push(changed ? ({ ...message, parts } as UIMessage) : message);
  }
  return { messages: changed ? migrated : messages, changed };
}

function decodeStoredText(bytes: Uint8Array, displayName: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(
      `Stored attachment is no longer valid UTF-8: ${displayName}.`,
    );
  }
}

function formatTextBlock(
  reference: AttachmentMessageReference,
  text: string,
): string {
  return [
    "----- CLACK ATTACHMENT -----",
    JSON.stringify({
      name: reference.displayName,
      mediaType: reference.mediaType,
    }),
    text,
    "----- END CLACK ATTACHMENT -----",
  ].join("\n");
}

function formatSelectionBlock(
  reference: AttachmentMessageReference,
  text: string,
): string {
  return [
    "----- CLACK SELECTION -----",
    JSON.stringify({ source: reference.selectionSource ?? "terminal" }),
    text,
    "----- END CLACK SELECTION -----",
  ].join("\n");
}

function referenceAsRecord(
  reference: AttachmentMessageReference,
): AttachmentRecord {
  return {
    id: reference.attachmentId,
    source: reference.selectionSource
      ? { kind: "selection", surface: reference.selectionSource }
      : { kind: "picker", token: "persisted" },
    displayName: reference.displayName,
    detectedMediaType: reference.mediaType,
    byteSize: reference.byteSize,
    contentKind: reference.contentKind,
    processingState: "ready",
    documentRepresentation: reference.documentRepresentation,
    archiveRepresentation: reference.archiveRepresentation,
    security: {
      secretPathCheck: "not-applicable",
      workspaceScopeCheck: "not-applicable",
      mimeSniffed: true,
    },
    createdAt: 0,
  };
}

function validDocumentRepresentation(value: unknown): boolean {
  if (value == null) return true;
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DocumentRepresentation>;
  if (
    !Number.isInteger(candidate.pageCount) ||
    (candidate.pageCount ?? 0) <= 0 ||
    (candidate.pageCount ?? 0) > 10_000 ||
    !Number.isInteger(candidate.extractedTextBytes) ||
    (candidate.extractedTextBytes ?? -1) < 0 ||
    (candidate.extractedTextBytes ?? 0) > 512 * 1024 ||
    typeof candidate.truncated !== "boolean" ||
    !Array.isArray(candidate.pages) ||
    candidate.pages.length > 128
  ) {
    return false;
  }
  if (
    candidate.textContentRef &&
    (!/^[a-f0-9]{64}$/.test(candidate.textContentRef.id) ||
      candidate.textContentRef.contentHash !== candidate.textContentRef.id ||
      !Number.isInteger(candidate.textContentRef.byteSize) ||
      candidate.textContentRef.byteSize <= 0 ||
      candidate.textContentRef.byteSize > 768 * 1024)
  ) {
    return false;
  }
  return candidate.pages.every(
    (page) =>
      page &&
      Number.isInteger(page.pageNumber) &&
      page.pageNumber > 0 &&
      page.pageNumber <= (candidate.pageCount ?? 0) &&
      Number.isInteger(page.textBytes) &&
      page.textBytes >= 0 &&
      page.textBytes <= 64 * 1024 &&
      typeof page.truncated === "boolean" &&
      (page.error == null ||
        (typeof page.error === "string" && page.error.length <= 512)),
  );
}

function validArchiveRepresentation(value: unknown): boolean {
  if (value == null) return true;
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ArchiveRepresentation>;
  const manifest = candidate.manifestContentRef;
  return (
    (candidate.format === "zip" || candidate.format === "7z") &&
    Number.isInteger(candidate.entryCount) &&
    (candidate.entryCount ?? -1) >= 0 &&
    (candidate.entryCount ?? 0) <= 2_048 &&
    Number.isInteger(candidate.fileCount) &&
    (candidate.fileCount ?? -1) >= 0 &&
    Number.isInteger(candidate.folderCount) &&
    (candidate.folderCount ?? -1) >= 0 &&
    (candidate.fileCount ?? 0) + (candidate.folderCount ?? 0) ===
      candidate.entryCount &&
    Number.isInteger(candidate.totalCompressedBytes) &&
    (candidate.totalCompressedBytes ?? -1) >= 0 &&
    (candidate.totalCompressedBytes ?? 0) <= 8 * 1024 * 1024 &&
    Number.isInteger(candidate.totalExpandedBytes) &&
    (candidate.totalExpandedBytes ?? -1) >= 0 &&
    (candidate.totalExpandedBytes ?? 0) <= 64 * 1024 * 1024 &&
    candidate.nestedArchiveDepthLimit === 0 &&
    candidate.entries == null &&
    Boolean(manifest) &&
    /^[a-f0-9]{64}$/.test(manifest?.id ?? "") &&
    manifest?.contentHash === manifest?.id &&
    Number.isInteger(manifest?.byteSize) &&
    (manifest?.byteSize ?? 0) > 0 &&
    (manifest?.byteSize ?? 0) <= 768 * 1024
  );
}

function validArchiveEntryProvenance(value: unknown): boolean {
  if (value == null) return true;
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<
    NonNullable<AttachmentMessageReference["archiveEntryProvenance"]>
  >;
  return (
    typeof candidate.archiveAttachmentId === "string" &&
    candidate.archiveAttachmentId.length > 0 &&
    /^[a-f0-9]{64}$/.test(candidate.archiveContentId ?? "") &&
    candidate.archiveContentHash === candidate.archiveContentId &&
    (candidate.archiveFormat === "zip" || candidate.archiveFormat === "7z") &&
    typeof candidate.archiveDisplayName === "string" &&
    candidate.archiveDisplayName.length > 0 &&
    Number.isInteger(candidate.entryIndex) &&
    (candidate.entryIndex ?? -1) >= 0 &&
    typeof candidate.entryPath === "string" &&
    candidate.entryPath.length > 0
  );
}

function decodeLegacyDataUrl(
  value: string,
): { bytes: Uint8Array; mediaType: string } | null {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(value);
  if (!match) return null;
  const mediaType = match[1] || "application/octet-stream";
  try {
    if (match[2]) {
      const encoded = match[3].replace(/\s/g, "");
      if (encoded.length > 11_184_812) return null;
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes.byteLength <= 8 * 1024 * 1024 ? { bytes, mediaType } : null;
    }
    const bytes = new TextEncoder().encode(decodeURIComponent(match[3]));
    return bytes.byteLength <= 8 * 1024 * 1024 ? { bytes, mediaType } : null;
  } catch {
    return null;
  }
}
