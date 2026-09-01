import { describe, expect, it, vi } from "vitest";
import type { AttachmentRecord } from "@/modules/ai/lib/attachments";
import {
  ARCHIVE_LIMITS,
  materializeArchiveEntry,
  processArchiveAttachment,
} from "@/modules/ai/lib/archiveAttachments";

const RAW_HASH = "a".repeat(64);
const MANIFEST_HASH = "b".repeat(64);
const ENTRY_HASH = "c".repeat(64);

const MANIFEST = {
  format: "zip",
  encrypted: false,
  entryCount: 2,
  fileCount: 2,
  folderCount: 0,
  totalCompressedBytes: 10,
  totalExpandedBytes: 10,
  nestedArchiveDepthLimit: 0,
  entries: [
    {
      index: 0,
      path: "src/main.ts",
      entryType: "file",
      compressedSize: 5,
      expandedSize: 5,
      mediaType: "text/typescript",
      status: "ready",
      selectable: true,
      encrypted: false,
      reason: null,
    },
    {
      index: 1,
      path: "nested.zip",
      entryType: "file",
      compressedSize: 5,
      expandedSize: 5,
      mediaType: "application/zip",
      status: "blocked",
      selectable: false,
      encrypted: false,
      reason: "Nested archives are not opened automatically.",
    },
  ],
} as const;

function zipRecord(): AttachmentRecord {
  return {
    id: "zip-1",
    source: { kind: "picker", token: "project" },
    displayName: "project.zip",
    detectedMediaType: "application/zip",
    byteSize: 16,
    contentKind: "archive",
    processingState: "ready",
    contentRef: { id: RAW_HASH, contentHash: RAW_HASH, byteSize: 16 },
    security: {
      secretPathCheck: "passed",
      workspaceScopeCheck: "not-applicable",
      mimeSniffed: true,
    },
    createdAt: 1,
  };
}

function processedZipRecord(): AttachmentRecord {
  return {
    ...zipRecord(),
    archiveRepresentation: {
      ...MANIFEST,
      entries: MANIFEST.entries.map((entry) => ({
        ...entry,
        reason: entry.reason ?? undefined,
      })),
      manifestContentRef: {
        id: MANIFEST_HASH,
        contentHash: MANIFEST_HASH,
        byteSize: 100,
      },
    },
  };
}

describe("ZIP attachment processing", () => {
  it("stores a bounded manifest by content reference", async () => {
    const storeContent = vi.fn(async (bytes: Uint8Array) => ({
      id: MANIFEST_HASH,
      contentHash: MANIFEST_HASH,
      byteSize: bytes.byteLength,
    }));
    const processed = await processArchiveAttachment(
      zipRecord(),
      new Uint8Array(16),
      {
        inspect: async () => MANIFEST,
        readEntry: vi.fn(),
        storeContent,
        loadContent: vi.fn(),
      },
    );
    expect(processed).toMatchObject({
      processingState: "ready",
      archiveRepresentation: {
        format: "zip",
        fileCount: 2,
        totalExpandedBytes: 10,
        manifestContentRef: { id: MANIFEST_HASH },
      },
    });
    const stored = new TextDecoder().decode(storeContent.mock.calls[0][0]);
    expect(stored).toContain('"path":"src/main.ts"');
    expect(stored).toContain('"status":"blocked"');
  });

  it("materializes only the selected entry through normal attachment handling", async () => {
    const readEntry = vi.fn(async () => new TextEncoder().encode("hello"));
    const storeContent = vi.fn(async (bytes: Uint8Array) => ({
      id: ENTRY_HASH,
      contentHash: ENTRY_HASH,
      byteSize: bytes.byteLength,
    }));
    const selected = await materializeArchiveEntry(processedZipRecord(), 0, {
      inspect: vi.fn(),
      readEntry,
      storeContent,
      loadContent: async () => new Uint8Array(16),
    });
    expect(readEntry).toHaveBeenCalledOnce();
    expect(readEntry).toHaveBeenCalledWith(expect.any(Uint8Array), 0);
    expect(selected).toMatchObject({
      source: {
        kind: "archive-entry",
        archiveAttachmentId: "zip-1",
        entryIndex: 0,
      },
      displayName: "src/main.ts",
      contentKind: "text",
      processingState: "ready",
      contentRef: { id: ENTRY_HASH },
    });
  });

  it("does not bypass normal text attachment limits", async () => {
    const storeContent = vi.fn();
    const selected = await materializeArchiveEntry(processedZipRecord(), 0, {
      inspect: vi.fn(),
      readEntry: async () =>
        new Uint8Array(1024 * 1024 + 1).fill("a".charCodeAt(0)),
      storeContent,
      loadContent: async () => new Uint8Array(16),
    });
    expect(selected).toMatchObject({
      processingState: "failed",
      error: { code: "text_attachment_too_large" },
    });
    expect(storeContent).not.toHaveBeenCalled();
  });

  it("rejects blocked, sensitive, and nested entries before reading", async () => {
    const readEntry = vi.fn();
    await expect(
      materializeArchiveEntry(processedZipRecord(), 1, {
        inspect: vi.fn(),
        readEntry,
        storeContent: vi.fn(),
        loadContent: vi.fn(),
      }),
    ).rejects.toThrow("not safe");
    expect(readEntry).not.toHaveBeenCalled();
  });

  it("rejects out-of-bounds or inconsistent inspector output", async () => {
    const storeContent = vi.fn();
    const processed = await processArchiveAttachment(
      zipRecord(),
      new Uint8Array(16),
      {
        inspect: async () => ({
          ...MANIFEST,
          totalExpandedBytes: ARCHIVE_LIMITS.maxExpandedBytes + 1,
        }),
        readEntry: vi.fn(),
        storeContent,
        loadContent: vi.fn(),
      },
    );
    expect(processed).toMatchObject({
      processingState: "failed",
      error: { code: "archive_processing_failed" },
    });
    expect(storeContent).not.toHaveBeenCalled();
  });

  it("accepts the shared 7z manifest without a format-specific pipeline", async () => {
    const record = {
      ...zipRecord(),
      displayName: "project.7z",
      detectedMediaType: "application/x-7z-compressed",
    };
    const processed = await processArchiveAttachment(
      record,
      new Uint8Array(16),
      {
        inspect: async () => ({ ...MANIFEST, format: "7z" }),
        readEntry: vi.fn(),
        storeContent: async (bytes) => ({
          id: MANIFEST_HASH,
          contentHash: MANIFEST_HASH,
          byteSize: bytes.byteLength,
        }),
        loadContent: vi.fn(),
      },
    );
    expect(processed).toMatchObject({
      processingState: "ready",
      archiveRepresentation: { format: "7z", fileCount: 2 },
    });
  });

  it("rejects a parser format that disagrees with signature detection", async () => {
    const processed = await processArchiveAttachment(
      zipRecord(),
      new Uint8Array(16),
      {
        inspect: async () => ({ ...MANIFEST, format: "7z" }),
        readEntry: vi.fn(),
        storeContent: vi.fn(),
        loadContent: vi.fn(),
      },
    );
    expect(processed).toMatchObject({
      processingState: "failed",
      error: { code: "archive_processing_failed" },
    });
  });
});
