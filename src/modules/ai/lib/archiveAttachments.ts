import { invoke } from "@tauri-apps/api/core";
import {
  type ArchiveManifestEntry,
  type AttachmentRecord,
  normalizeAttachmentBytes,
  persistAttachmentRecord,
} from "@/modules/ai/lib/attachments";
import {
  loadAttachmentContent,
  retainAttachmentContent,
  storeAttachmentContent,
  type AttachmentContentRef,
} from "@/modules/ai/lib/attachmentStore";
import { checkReadable } from "@/modules/ai/lib/security";

export const ARCHIVE_LIMITS = {
  maxArchiveBytes: 8 * 1024 * 1024,
  maxEntryCount: 2_048,
  maxEntryBytes: 4 * 1024 * 1024,
  maxExpandedBytes: 64 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxPathBytes: 1_024,
  maxTotalPathBytes: 256 * 1024,
  maxManifestBytes: 768 * 1024,
  maxNestedArchiveDepth: 0,
} as const;

type ArchiveManifestContract = {
  format: "zip" | "7z";
  encrypted: boolean;
  entryCount: number;
  fileCount: number;
  folderCount: number;
  totalCompressedBytes: number;
  totalExpandedBytes: number;
  nestedArchiveDepthLimit: number;
  entries: ArchiveManifestEntry[];
};

type ArchiveProcessingDeps = {
  inspect: (bytes: Uint8Array) => Promise<unknown>;
  readEntry: (bytes: Uint8Array, entryIndex: number) => Promise<Uint8Array>;
  storeContent: (bytes: Uint8Array) => Promise<AttachmentContentRef>;
  loadContent: (id: string) => Promise<Uint8Array>;
};

const DEFAULT_DEPS: ArchiveProcessingDeps = {
  inspect: (bytes) => invoke("attachment_archive_inspect", bytes),
  readEntry: async (bytes, entryIndex) => {
    if (
      !Number.isInteger(entryIndex) ||
      entryIndex < 0 ||
      entryIndex > 0xffffffff
    ) {
      throw new Error("Archive entry index is invalid.");
    }
    const request = new Uint8Array(bytes.byteLength + 4);
    new DataView(request.buffer).setUint32(0, entryIndex, true);
    request.set(bytes, 4);
    const response = await invoke<ArrayBuffer>(
      "attachment_archive_read_entry",
      request,
    );
    return new Uint8Array(response);
  },
  storeContent: storeAttachmentContent,
  loadContent: loadAttachmentContent,
};

export async function processArchiveAttachment(
  record: AttachmentRecord,
  bytes: Uint8Array,
  deps: ArchiveProcessingDeps = DEFAULT_DEPS,
): Promise<AttachmentRecord> {
  if (
    record.contentKind !== "archive" ||
    record.processingState !== "ready" ||
    !record.contentRef
  ) {
    return record;
  }
  try {
    const manifest = validateArchiveManifest(
      await deps.inspect(bytes),
      record.detectedMediaType,
    );
    const representation = formatArchiveManifest(record.displayName, manifest);
    const encoded = new TextEncoder().encode(representation);
    if (encoded.byteLength > ARCHIVE_LIMITS.maxManifestBytes) {
      throw new Error("Archive manifest exceeds Clack's safe storage limit.");
    }
    const manifestContentRef = await deps.storeContent(encoded);
    retainAttachmentContent(manifestContentRef.id);
    return {
      ...record,
      archiveRepresentation: {
        ...manifest,
        manifestContentRef,
      },
      error: undefined,
    };
  } catch (error) {
    return {
      ...record,
      processingState: "failed",
      archiveRepresentation: undefined,
      error: {
        code: "archive_processing_failed",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export async function materializeArchiveEntry(
  archive: AttachmentRecord,
  entryIndex: number,
  deps: ArchiveProcessingDeps = DEFAULT_DEPS,
): Promise<AttachmentRecord> {
  const representation = archive.archiveRepresentation;
  const entry = representation?.entries?.find(
    (candidate) => candidate.index === entryIndex,
  );
  if (
    archive.contentKind !== "archive" ||
    archive.processingState !== "ready" ||
    !archive.contentRef ||
    !representation ||
    !entry ||
    !entry.selectable ||
    entry.entryType !== "file"
  ) {
    throw new Error("Archive entry is not safe to materialize.");
  }
  const archiveFormat = representation.format;
  const readable = checkReadable(entry.path);
  if (!readable.ok) throw new Error(readable.reason);
  const archiveBytes = await deps.loadContent(archive.contentRef.id);
  if (archiveBytes.byteLength !== archive.contentRef.byteSize) {
    throw new Error(
      "Stored archive size changed before entry materialization.",
    );
  }
  const entryBytes = await deps.readEntry(archiveBytes, entry.index);
  const security = {
    secretPathCheck: "passed" as const,
    workspaceScopeCheck: "not-applicable" as const,
    mimeSniffed: true,
  };
  const normalized = await normalizeAttachmentBytes({
    source: {
      kind: "archive-entry",
      archiveAttachmentId: archive.id,
      archiveContentId: archive.contentRef.id,
      archiveContentHash: archive.contentRef.contentHash,
      archiveFormat,
      archiveDisplayName: archive.displayName,
      entryIndex: entry.index,
      path: entry.path,
    },
    displayName: entry.path,
    bytes: entryBytes,
    reportedMediaType: entry.mediaType,
    security,
  });
  if (normalized.processingState !== "ready") return normalized;
  return persistAttachmentRecord(normalized, entryBytes, deps.storeContent);
}

function expectedArchiveFormat(mediaType: string): "zip" | "7z" | undefined {
  if (mediaType === "application/zip") return "zip";
  if (mediaType === "application/x-7z-compressed") return "7z";
  return undefined;
}

function validateArchiveManifest(
  value: unknown,
  detectedMediaType: string,
): ArchiveManifestContract {
  if (!value || typeof value !== "object") {
    throw new Error("Archive inspector returned invalid metadata.");
  }
  const candidate = value as Partial<ArchiveManifestContract>;
  const expectedFormat = expectedArchiveFormat(detectedMediaType);
  if (
    (candidate.format !== "zip" && candidate.format !== "7z") ||
    (expectedFormat != null && candidate.format !== expectedFormat) ||
    typeof candidate.encrypted !== "boolean" ||
    !Number.isInteger(candidate.entryCount) ||
    (candidate.entryCount ?? -1) < 0 ||
    (candidate.entryCount ?? 0) > ARCHIVE_LIMITS.maxEntryCount ||
    !Number.isInteger(candidate.fileCount) ||
    (candidate.fileCount ?? -1) < 0 ||
    !Number.isInteger(candidate.folderCount) ||
    (candidate.folderCount ?? -1) < 0 ||
    !Number.isInteger(candidate.totalCompressedBytes) ||
    (candidate.totalCompressedBytes ?? -1) < 0 ||
    (candidate.totalCompressedBytes ?? 0) > ARCHIVE_LIMITS.maxArchiveBytes ||
    !Number.isInteger(candidate.totalExpandedBytes) ||
    (candidate.totalExpandedBytes ?? -1) < 0 ||
    (candidate.totalExpandedBytes ?? 0) > ARCHIVE_LIMITS.maxExpandedBytes ||
    candidate.nestedArchiveDepthLimit !==
      ARCHIVE_LIMITS.maxNestedArchiveDepth ||
    !Array.isArray(candidate.entries) ||
    candidate.entries.length !== candidate.entryCount ||
    (candidate.fileCount ?? 0) + (candidate.folderCount ?? 0) !==
      candidate.entryCount
  ) {
    throw new Error("Archive inspector returned out-of-bounds metadata.");
  }

  const entryCount = candidate.entryCount as number;

  let totalPathBytes = 0;
  let totalCompressedBytes = 0;
  let totalExpandedBytes = 0;
  const indexes = new Set<number>();
  const paths = new Set<string>();
  const entries = candidate.entries.map((entry, position) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(
        `Archive inspector returned invalid entry ${position + 1}.`,
      );
    }
    const item = entry as Partial<ArchiveManifestEntry>;
    const index = item.index ?? -1;
    const compressedSize = item.compressedSize ?? -1;
    const expandedSize = item.expandedSize ?? -1;
    const pathBytes =
      typeof item.path === "string"
        ? new TextEncoder().encode(item.path).byteLength
        : 0;
    if (
      !Number.isInteger(item.index) ||
      index < 0 ||
      index >= entryCount ||
      indexes.has(index) ||
      typeof item.path !== "string" ||
      pathBytes === 0 ||
      pathBytes > ARCHIVE_LIMITS.maxPathBytes ||
      paths.has(item.path) ||
      (item.entryType !== "file" && item.entryType !== "folder") ||
      !Number.isInteger(item.compressedSize) ||
      compressedSize < 0 ||
      !Number.isInteger(item.expandedSize) ||
      expandedSize < 0 ||
      expandedSize > ARCHIVE_LIMITS.maxEntryBytes ||
      (item.mediaType != null &&
        (typeof item.mediaType !== "string" || item.mediaType.length > 128)) ||
      (item.status !== "ready" && item.status !== "blocked") ||
      typeof item.selectable !== "boolean" ||
      (item.encrypted != null && typeof item.encrypted !== "boolean") ||
      (item.entryType === "folder" && item.selectable) ||
      (item.status === "blocked" && item.selectable) ||
      (item.reason != null &&
        (typeof item.reason !== "string" || item.reason.length > 256))
    ) {
      throw new Error(
        `Archive inspector returned invalid entry ${position + 1}.`,
      );
    }
    indexes.add(index);
    paths.add(item.path);
    totalPathBytes += pathBytes;
    totalCompressedBytes += compressedSize;
    totalExpandedBytes += expandedSize;
    const validated = item as ArchiveManifestEntry;
    const readable =
      validated.entryType === "file"
        ? checkReadable(validated.path)
        : ({ ok: true } as const);
    return readable.ok
      ? validated
      : {
          ...validated,
          status: "blocked" as const,
          selectable: false,
          reason: readable.reason,
        };
  });
  if (
    totalPathBytes > ARCHIVE_LIMITS.maxTotalPathBytes ||
    totalCompressedBytes !== candidate.totalCompressedBytes ||
    totalExpandedBytes !== candidate.totalExpandedBytes
  ) {
    throw new Error(
      "Archive inspector returned inconsistent aggregate metadata.",
    );
  }
  return { ...(candidate as ArchiveManifestContract), entries };
}

function formatArchiveManifest(
  displayName: string,
  manifest: ArchiveManifestContract,
): string {
  const formatLabel = manifest.format === "7z" ? "7Z" : "ZIP";
  const header = [
    `----- CLACK ${formatLabel} MANIFEST -----`,
    JSON.stringify({
      name: displayName,
      files: manifest.fileCount,
      folders: manifest.folderCount,
      expandedBytes: manifest.totalExpandedBytes,
      encrypted: manifest.encrypted,
      nestedArchiveDepthLimit: manifest.nestedArchiveDepthLimit,
    }),
  ];
  const entries = manifest.entries.map((entry) =>
    JSON.stringify({
      index: entry.index,
      path: entry.path,
      type: entry.entryType,
      bytes: entry.expandedSize,
      status: entry.status,
      selectable: entry.selectable,
      ...(entry.encrypted ? { encrypted: true } : {}),
      ...(entry.reason ? { reason: entry.reason } : {}),
    }),
  );
  return [
    ...header,
    ...entries,
    `----- END CLACK ${formatLabel} MANIFEST -----`,
  ].join("\n");
}
