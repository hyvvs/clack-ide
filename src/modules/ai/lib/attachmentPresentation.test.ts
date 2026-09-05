import { describe, expect, it } from "vitest";
import type { AttachmentRecord } from "./attachments";
import { buildAttachmentPresentation } from "./attachmentPresentation";
import type { AttachmentCapabilityStatus } from "./modelCapabilities";

const HASH = "a".repeat(64);
const READY_CAPABILITY: AttachmentCapabilityStatus = {
  state: "ready",
  support: "supported",
  label: "Ready",
  message: "Image is ready for the selected model.",
};
const TEXT_ONLY_CAPABILITY: AttachmentCapabilityStatus = {
  state: "blocked",
  support: "unsupported",
  label: "Unsupported by model",
  message: "The selected model does not support image input.",
};

describe("truthful attachment presentation", () => {
  it("marks a processed raster image ready for a confirmed vision model", () => {
    const value = buildAttachmentPresentation(image(), {
      capability: READY_CAPABILITY,
      modelLabel: "Vision model",
    });
    expect(value).toMatchObject({
      outcome: "ready",
      statusLabel: "Ready",
      summary: "Vision input",
    });
    expect(detail(value, "Image vision input")).toBe("Yes");
  });

  it("marks a raster image unsupported for a confirmed text-only model", () => {
    const value = buildAttachmentPresentation(image(), {
      capability: TEXT_ONLY_CAPABILITY,
      modelLabel: "Text model",
    });
    expect(value).toMatchObject({
      outcome: "unsupported",
      summary: "Selected model cannot receive images",
    });
    expect(detail(value, "Model")).toBe("Text model");
  });

  it("reacts to a model capability change without changing attachment bytes", () => {
    const attachment = image();
    const blocked = buildAttachmentPresentation(attachment, {
      capability: TEXT_ONLY_CAPABILITY,
    });
    const ready = buildAttachmentPresentation(attachment, {
      capability: READY_CAPABILITY,
    });
    expect(blocked.outcome).toBe("unsupported");
    expect(ready.outcome).toBe("ready");
    expect(attachment.contentRef?.id).toBe(HASH);
  });

  it("reports complete PDF extraction", () => {
    const value = buildAttachmentPresentation(pdf());
    expect(value).toMatchObject({
      outcome: "ready",
      summary: "3 pages · Text extracted",
    });
    expect(detail(value, "Pages processed")).toBe("3");
    expect(detail(value, "Truncated")).toBe("No");
  });

  it("reports bounded PDF truncation", () => {
    const value = buildAttachmentPresentation(
      pdf({
        pageCount: 420,
        truncated: true,
        pages: Array.from({ length: 128 }, (_, index) => ({
          pageNumber: index + 1,
          textBytes: 4,
          truncated: false,
        })),
      }),
    );
    expect(value).toMatchObject({
      outcome: "limited",
      summary: "128 of 420 pages processed",
    });
    expect(detail(value, "Truncated")).toBe("Yes");
  });

  it("reports a PDF with no embedded text as limited and names missing OCR", () => {
    const value = buildAttachmentPresentation(
      pdf(
        {
          extractedTextBytes: 0,
          pages: [],
          textContentRef: undefined,
        },
        "unsupported",
        {
          code: "pdf_no_extractable_text",
          message: "No embedded text.",
        },
      ),
    );
    expect(value).toMatchObject({
      outcome: "limited",
      summary: "No embedded text · OCR unavailable",
    });
    expect(detail(value, "OCR")).toBe("Not performed");
    expect(detail(value, "Model input")).toBe("No PDF content");
  });

  it("distinguishes an indexed ZIP from selected entry contents", () => {
    const value = buildAttachmentPresentation(archive("zip"));
    expect(value).toMatchObject({
      outcome: "ready",
      summary: "184 files indexed · Select files to include",
    });
    expect(detail(value, "Selected entries")).toBe("0");
    expect(detail(value, "Model input")).toBe("Archive index only");
  });

  it("reports the exact selected ZIP entry count and names", () => {
    const value = buildAttachmentPresentation(archive("zip"), {
      selectedArchiveEntries: [
        { displayName: "src/main.ts" },
        { displayName: "README.md" },
      ],
    });
    expect(value.summary).toBe("184 files indexed · 2 selected");
    expect(detail(value, "Selected files")).toBe("src/main.ts, README.md");
  });

  it("uses the same indexed-versus-selected truth for 7z", () => {
    const value = buildAttachmentPresentation(archive("7z"), {
      selectedArchiveEntries: [{ displayName: "notes.md" }],
    });
    expect(value).toMatchObject({
      outcome: "ready",
      summary: "184 files indexed · 1 selected",
    });
    expect(detail(value, "Detected type")).toBe("7z archive");
  });

  it("reports RAR as detected but unsupported", () => {
    const value = buildAttachmentPresentation(
      record({
        displayName: "backup.rar",
        detectedMediaType: "application/vnd.rar",
        contentKind: "archive",
        processingState: "unsupported",
        error: {
          code: "archive_not_supported",
          message: "RAR inspection is unavailable.",
        },
      }),
    );
    expect(value).toMatchObject({
      outcome: "unsupported",
      summary: "Contents cannot be safely inspected",
    });
    expect(detail(value, "Contents inspected")).toBe("No");
  });

  it("reports an unknown binary as limited metadata that is not sent", () => {
    const value = buildAttachmentPresentation(
      record({
        displayName: "data.bin",
        contentKind: "binary",
        processingState: "unsupported",
        error: {
          code: "binary_not_supported",
          message: "Unknown binary.",
        },
      }),
    );
    expect(value).toMatchObject({
      outcome: "limited",
      summary: "Metadata only · Contents not sent",
    });
    expect(detail(value, "Model input")).toBe("No");
  });

  it("reports a secret file as blocked", () => {
    const value = buildAttachmentPresentation(
      record({
        displayName: "credentials.env",
        processingState: "failed",
        error: { code: "secret_path_rejected", message: "Secret path." },
        security: {
          secretPathCheck: "rejected",
          workspaceScopeCheck: "not-applicable",
          mimeSniffed: false,
        },
      }),
    );
    expect(value).toMatchObject({
      outcome: "blocked",
      summary: "Sensitive file",
    });
  });

  it("makes bounded text truncation visible", () => {
    const value = buildAttachmentPresentation(
      record({
        contentKind: "text",
        detectedMediaType: "text/plain",
        error: {
          code: "text_representation_truncated",
          message: "Bounded text.",
        },
      }),
    );
    expect(value).toMatchObject({
      outcome: "limited",
      summary: "Text truncated to processing limit",
    });
    expect(detail(value, "Truncated")).toBe("Yes");
  });

  it("transitions from image processing to ready", () => {
    const processing = buildAttachmentPresentation(
      image({ processingState: "processing" }),
    );
    const ready = buildAttachmentPresentation(image(), {
      capability: READY_CAPABILITY,
    });
    expect(processing).toMatchObject({
      outcome: "processing",
      summary: "Processing image…",
    });
    expect(ready.outcome).toBe("ready");
  });

  it("transitions from processing to a user-facing failure", () => {
    const processing = buildAttachmentPresentation(
      record({ processingState: "processing" }),
    );
    const failed = buildAttachmentPresentation(
      record({
        processingState: "failed",
        error: { code: "attachment_read_failed", message: "Internal error." },
      }),
    );
    expect(processing.outcome).toBe("processing");
    expect(failed).toMatchObject({
      outcome: "failed",
      summary: "Could not read file",
    });
    expect(failed.explanation).not.toContain("Internal error");
  });

  it("reports unavailable persisted content without claiming delivery", () => {
    const value = buildAttachmentPresentation(image(), {
      delivered: true,
      contentAvailable: false,
    });
    expect(value).toMatchObject({
      outcome: "failed",
      summary: "Attachment unavailable",
    });
    expect(detail(value, "Model input")).toBe("No");
  });

  it("keeps SVG delivery explicitly source-text based", () => {
    const value = buildAttachmentPresentation(
      image({
        displayName: "diagram.svg",
        detectedMediaType: "image/svg+xml",
      }),
      { capability: TEXT_ONLY_CAPABILITY },
    );
    expect(value).toMatchObject({ outcome: "ready", summary: "Source text" });
    expect(detail(value, "Image vision input")).toBe("No");
    expect(detail(value, "Model input")).toBe("SVG source text");
  });
});

function detail(
  value: ReturnType<typeof buildAttachmentPresentation>,
  label: string,
): string | undefined {
  return value.details.find((item) => item.label === label)?.value;
}

function record(overrides: Partial<AttachmentRecord> = {}): AttachmentRecord {
  return {
    id: "attachment-1",
    source: { kind: "picker", token: "picker" },
    displayName: "notes.txt",
    detectedMediaType: "application/octet-stream",
    byteSize: 1024,
    contentKind: "text",
    processingState: "ready",
    contentRef: { id: HASH, contentHash: HASH, byteSize: 1024 },
    security: {
      secretPathCheck: "passed",
      workspaceScopeCheck: "not-applicable",
      mimeSniffed: true,
    },
    createdAt: 1,
    ...overrides,
  };
}

function image(overrides: Partial<AttachmentRecord> = {}): AttachmentRecord {
  return record({
    displayName: "screen.png",
    detectedMediaType: "image/png",
    contentKind: "image",
    ...overrides,
  });
}

function pdf(
  representationOverrides: Partial<
    NonNullable<AttachmentRecord["documentRepresentation"]>
  > = {},
  processingState: AttachmentRecord["processingState"] = "ready",
  error?: AttachmentRecord["error"],
): AttachmentRecord {
  const textHash = "b".repeat(64);
  return record({
    displayName: "report.pdf",
    detectedMediaType: "application/pdf",
    contentKind: "document",
    processingState,
    documentRepresentation: {
      pageCount: 3,
      extractedTextBytes: 12,
      truncated: false,
      pages: [1, 2, 3].map((pageNumber) => ({
        pageNumber,
        textBytes: 4,
        truncated: false,
      })),
      textContentRef: {
        id: textHash,
        contentHash: textHash,
        byteSize: 12,
      },
      ...representationOverrides,
    },
    error,
  });
}

function archive(format: "zip" | "7z"): AttachmentRecord {
  const manifestHash = "c".repeat(64);
  return record({
    displayName: format === "zip" ? "project.zip" : "project.7z",
    detectedMediaType:
      format === "zip" ? "application/zip" : "application/x-7z-compressed",
    contentKind: "archive",
    archiveRepresentation: {
      format,
      entryCount: 190,
      fileCount: 184,
      folderCount: 6,
      totalCompressedBytes: 1024,
      totalExpandedBytes: 4096,
      nestedArchiveDepthLimit: 0,
      manifestContentRef: {
        id: manifestHash,
        contentHash: manifestHash,
        byteSize: 512,
      },
      entries: [],
    },
  });
}
