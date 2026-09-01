import { describe, expect, it, vi } from "vitest";
import {
  ATTACHMENT_LIMITS,
  type AttachmentRecord,
  createPendingPickerAttachment,
  detectAttachment,
  formatTextAttachmentBlock,
  mergeAttachmentRecords,
  normalizeAttachmentBytes,
  normalizePickerAttachment,
  normalizeWorkspaceAttachment,
} from "./attachments";

const SECURITY = {
  secretPathCheck: "passed" as const,
  workspaceScopeCheck: "not-applicable" as const,
  mimeSniffed: true,
};

function png(width = 16, height = 16): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function record(overrides: Partial<AttachmentRecord> = {}): AttachmentRecord {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    source: overrides.source ?? {
      kind: "picker",
      token: overrides.id ?? crypto.randomUUID(),
    },
    displayName: overrides.displayName ?? "note.txt",
    detectedMediaType: overrides.detectedMediaType ?? "text/plain",
    byteSize: overrides.byteSize ?? 10,
    contentKind: overrides.contentKind ?? "text",
    processingState: overrides.processingState ?? "ready",
    textRepresentation: overrides.textRepresentation ?? "hello",
    security: overrides.security ?? SECURITY,
    createdAt: overrides.createdAt ?? 1,
    ...overrides,
  };
}

describe("attachment detection", () => {
  it("uses image signatures instead of a reported MIME guess", () => {
    expect(detectAttachment(png(), "image.bin", "text/plain")).toMatchObject({
      contentKind: "image",
      mediaType: "image/png",
      imageDimensions: { width: 16, height: 16 },
    });
  });

  it("recognizes PDF and archive signatures without claiming support", () => {
    expect(
      detectAttachment(new TextEncoder().encode("%PDF-1.7"), "report.bin"),
    ).toMatchObject({ contentKind: "document", mediaType: "application/pdf" });
    expect(
      detectAttachment(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]), "bundle.bin"),
    ).toMatchObject({ contentKind: "archive", mediaType: "application/zip" });
  });

  it("does not trust a disguised executable's text extension or MIME", () => {
    expect(
      detectAttachment(
        Uint8Array.from([0x4d, 0x5a, 0, 0]),
        "notes.txt",
        "text/plain",
      ),
    ).toMatchObject({
      contentKind: "binary",
      mediaType: "application/vnd.microsoft.portable-executable",
    });
  });
});

describe("attachment normalization", () => {
  it("creates an immediate processing record for picker, drop, and paste files", () => {
    const bytes = png();
    const pending = createPendingPickerAttachment(
      new File([bytes.buffer as ArrayBuffer], "screen.png", {
        type: "image/png",
        lastModified: 7,
      }),
    );
    expect(pending).toMatchObject({
      displayName: "screen.png",
      byteSize: 24,
      processingState: "processing",
      security: { mimeSniffed: false },
    });
  });

  it("keeps bounded strict UTF-8 text and its line breaks", async () => {
    const normalized = await normalizeAttachmentBytes({
      source: { kind: "picker", token: "notes" },
      displayName: "notes.md",
      bytes: new TextEncoder().encode("one\ntwo\n"),
      reportedMediaType: "text/plain",
      security: SECURITY,
      options: { id: "attachment-text", createdAt: 10 },
    });
    expect(normalized).toMatchObject({
      id: "attachment-text",
      processingState: "ready",
      detectedMediaType: "text/markdown",
      textRepresentation: "one\ntwo\n",
    });
  });

  it("routes signed PDFs into backend document processing", async () => {
    const normalized = await normalizeAttachmentBytes({
      source: { kind: "picker", token: "pdf" },
      displayName: "report.pdf",
      bytes: new TextEncoder().encode("%PDF-1.7"),
      reportedMediaType: "application/octet-stream",
      security: SECURITY,
    });
    expect(normalized).toMatchObject({
      processingState: "ready",
      contentKind: "document",
      detectedMediaType: "application/pdf",
    });
  });

  it("rejects invalid UTF-8 instead of decoding binary replacement text", async () => {
    const normalized = await normalizeAttachmentBytes({
      source: { kind: "picker", token: "bad" },
      displayName: "bad.txt",
      bytes: Uint8Array.from([0xff, 0xfe, 0xfd]),
      reportedMediaType: "text/plain",
      security: SECURITY,
    });
    expect(normalized).toMatchObject({
      processingState: "unsupported",
      error: { code: "invalid_text_encoding" },
    });
  });

  it("bounds decoded raster dimensions before creating a data URL", async () => {
    const dataUrl = vi.fn(async () => "data:image/png;base64,ignored");
    const normalized = await normalizeAttachmentBytes({
      source: { kind: "picker", token: "huge" },
      displayName: "huge.png",
      bytes: png(20_000, 20_000),
      security: SECURITY,
      options: { dataUrl },
    });
    expect(normalized).toMatchObject({
      processingState: "failed",
      error: { code: "image_dimensions_unsafe" },
    });
    expect(dataUrl).not.toHaveBeenCalled();
  });

  it("accepts bounded UTF-8 SVG source without rendering a preview URL", async () => {
    const dataUrl = vi.fn();
    const normalized = await normalizeAttachmentBytes({
      source: { kind: "picker", token: "svg" },
      displayName: "icon.svg",
      bytes: new TextEncoder().encode('<svg viewBox="0 0 1 1"></svg>'),
      reportedMediaType: "image/svg+xml",
      security: SECURITY,
      options: { dataUrl },
    });
    expect(normalized).toMatchObject({
      processingState: "ready",
      contentKind: "image",
      detectedMediaType: "image/svg+xml",
    });
    expect(normalized.imageRepresentation).toBeUndefined();
    expect(dataUrl).not.toHaveBeenCalled();
  });

  it("rejects malformed SVG encoding", async () => {
    const normalized = await normalizeAttachmentBytes({
      source: { kind: "picker", token: "svg-bad" },
      displayName: "icon.svg",
      bytes: Uint8Array.from([0x3c, 0x73, 0x76, 0x67, 0x3e, 0xff]),
      reportedMediaType: "image/svg+xml",
      security: SECURITY,
    });
    expect(normalized).toMatchObject({
      processingState: "unsupported",
      error: { code: "invalid_svg_encoding" },
    });
  });

  it("keeps unsupported binaries explicit", async () => {
    const normalized = await normalizeAttachmentBytes({
      source: { kind: "picker", token: "binary" },
      displayName: "unknown.bin",
      bytes: Uint8Array.from([1, 2, 3, 4]),
      security: SECURITY,
    });
    expect(normalized).toMatchObject({
      processingState: "unsupported",
      error: { code: "binary_not_supported" },
    });
  });
});

describe("workspace attachment security", () => {
  it("blocks secret-denied picker files before loading their contents", async () => {
    const file = new File(["API_KEY=secret"], ".env", {
      type: "text/plain",
      lastModified: 1,
    });
    const normalized = await normalizePickerAttachment(file);
    expect(normalized).toMatchObject({
      processingState: "failed",
      error: { code: "secret_path_rejected" },
      security: { secretPathCheck: "rejected" },
    });
  });

  it("blocks secret-denied names before reading bytes", async () => {
    const canonicalize = vi.fn(async (path: string) => path);
    const readBytes = vi.fn(async () => new TextEncoder().encode("secret"));
    const normalized = await normalizeWorkspaceAttachment(
      "/repo/.env",
      "/repo",
      {
        canonicalize,
        readBytes,
      },
    );
    expect(normalized).toMatchObject({
      processingState: "failed",
      error: { code: "secret_path_rejected" },
      security: { secretPathCheck: "rejected" },
    });
    expect(readBytes).not.toHaveBeenCalled();
  });

  it("uses the canonical path and reports backend scope failures", async () => {
    const readBytes = vi.fn(async () => {
      throw new Error("Attachment path is outside the authorized workspace.");
    });
    const normalized = await normalizeWorkspaceAttachment(
      "/repo/link.txt",
      "/repo",
      {
        canonicalize: async () => "/outside/file.txt",
        readBytes,
      },
    );
    expect(readBytes).toHaveBeenCalledWith("/outside/file.txt", "/repo");
    expect(normalized).toMatchObject({
      processingState: "failed",
      error: { code: "workspace_attachment_read_failed" },
      security: { workspaceScopeCheck: "rejected" },
    });
  });

  it("stores authorized workspace text by content reference", async () => {
    const hash = "b".repeat(64);
    const persistContent = vi.fn(async () => ({
      id: hash,
      contentHash: hash,
      byteSize: 5,
    }));
    const normalized = await normalizeWorkspaceAttachment(
      "/repo/note.txt",
      "/repo",
      {
        canonicalize: async (path) => path,
        readBytes: async () => new TextEncoder().encode("hello"),
        persistContent,
      },
    );
    expect(normalized).toMatchObject({
      processingState: "ready",
      contentRef: { id: hash, contentHash: hash, byteSize: 5 },
      textRepresentation: undefined,
    });
    expect(persistContent).toHaveBeenCalledOnce();
  });
});

describe("attachment message limits", () => {
  it("enforces attachment count without silently replacing records", () => {
    const existing = Array.from(
      { length: ATTACHMENT_LIMITS.maxCount },
      (_, index) =>
        record({
          id: `existing-${index}`,
          source: { kind: "picker", token: `${index}` },
        }),
    );
    const merged = mergeAttachmentRecords(existing, [
      record({ id: "extra", source: { kind: "picker", token: "extra" } }),
    ]);
    expect(merged.records).toHaveLength(ATTACHMENT_LIMITS.maxCount);
    expect(merged.rejected[0]?.message).toContain("up to 8 attachments");
  });

  it("marks aggregate overflow as failed and removes its payload", () => {
    const existing = [8, 8, 4].map((mebibytes, index) =>
      record({
        id: `existing-${index}`,
        source: { kind: "picker", token: `existing-${index}` },
        byteSize: mebibytes * 1024 * 1024,
      }),
    );
    const overflow = record({
      id: "overflow",
      source: { kind: "picker", token: "overflow" },
      byteSize: 1,
    });
    const merged = mergeAttachmentRecords(existing, [overflow]);
    expect(merged.records[3]).toMatchObject({
      processingState: "failed",
      textRepresentation: undefined,
      error: { code: "attachment_aggregate_too_large" },
    });
  });

  it("escapes attachment metadata instead of interpolating a filename attribute", () => {
    const block = formatTextAttachmentBlock(
      record({
        displayName: 'bad"\nname.txt',
        textRepresentation: "safe body",
      }),
    );
    expect(block).toContain('"name":"bad\\"\\nname.txt"');
    expect(block).not.toContain('<file name="');
  });
});
