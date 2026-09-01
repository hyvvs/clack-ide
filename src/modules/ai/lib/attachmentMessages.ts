import type { UIMessage } from "ai";
import type { AttachmentRecord } from "./attachments";
import {
  attachmentBytesToDataUrl,
  loadAttachmentContent,
  storeAttachmentContent,
  type AttachmentContentRef,
} from "./attachmentStore";

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
    ATTACHMENT_CONTENT_KINDS.has(data.contentKind)
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
      if (isAttachmentMessagePart(part)) ids.add(part.data.contentId);
    }
  }
  return [...ids];
}

export async function materializeAttachmentMessages(
  messages: UIMessage[],
  deps: MaterializeDeps = {
    loadContent: loadAttachmentContent,
    toDataUrl: attachmentBytesToDataUrl,
  },
): Promise<UIMessage[]> {
  let changed = false;
  const materialized: UIMessage[] = [];
  for (const message of messages) {
    const parts: unknown[] = [];
    for (const part of message.parts) {
      if (!isAttachmentMessagePart(part)) {
        parts.push(part);
        continue;
      }
      changed = true;
      const reference = part.data;
      const bytes = await deps.loadContent(reference.contentId);
      if (bytes.byteLength !== reference.byteSize) {
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
      if (reference.contentKind === "image") {
        parts.push({
          type: "file",
          mediaType: reference.mediaType,
          filename: reference.displayName,
          url: await deps.toDataUrl(bytes, reference.mediaType),
        });
        continue;
      }
      parts.push({
        type: "text",
        text: `Attachment ${JSON.stringify(reference.displayName)} is available as metadata only.`,
      });
    }
    materialized.push(
      changed ? ({ ...message, parts } as UIMessage) : message,
    );
  }
  return changed ? materialized : messages;
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
    throw new Error(`Stored attachment is no longer valid UTF-8: ${displayName}.`);
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
      return bytes.byteLength <= 8 * 1024 * 1024
        ? { bytes, mediaType }
        : null;
    }
    const bytes = new TextEncoder().encode(decodeURIComponent(match[3]));
    return bytes.byteLength <= 8 * 1024 * 1024
      ? { bytes, mediaType }
      : null;
  } catch {
    return null;
  }
}
