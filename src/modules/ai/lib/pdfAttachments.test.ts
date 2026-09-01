import { describe, expect, it, vi } from "vitest";
import type { AttachmentRecord } from "./attachments";
import { PDF_LIMITS, processPdfAttachment } from "./pdfAttachments";

const RAW_HASH = "a".repeat(64);
const TEXT_HASH = "b".repeat(64);

function pdfRecord(): AttachmentRecord {
  return {
    id: "pdf-1",
    source: { kind: "picker", token: "report" },
    displayName: "report.pdf",
    detectedMediaType: "application/pdf",
    byteSize: 100,
    contentKind: "document",
    processingState: "ready",
    contentRef: { id: RAW_HASH, contentHash: RAW_HASH, byteSize: 100 },
    security: {
      secretPathCheck: "passed",
      workspaceScopeCheck: "not-applicable",
      mimeSniffed: true,
    },
    createdAt: 1,
  };
}

describe("PDF attachment processing", () => {
  it("stores bounded page-aware text by content reference", async () => {
    const storeContent = vi.fn(async (bytes: Uint8Array) => ({
      id: TEXT_HASH,
      contentHash: TEXT_HASH,
      byteSize: bytes.byteLength,
    }));
    const processed = await processPdfAttachment(
      pdfRecord(),
      new Uint8Array([1]),
      {
        extract: async () => ({
          pageCount: 2,
          pages: [
            {
              pageNumber: 1,
              text: "First page",
              truncated: false,
              error: null,
            },
            {
              pageNumber: 2,
              text: "Second page",
              truncated: false,
              error: null,
            },
          ],
          extractedTextBytes: 21,
          truncated: false,
        }),
        storeContent,
      },
    );
    expect(processed).toMatchObject({
      processingState: "ready",
      documentRepresentation: {
        pageCount: 2,
        extractedTextBytes: 21,
        textContentRef: { id: TEXT_HASH },
        pages: [
          { pageNumber: 1, textBytes: 10 },
          { pageNumber: 2, textBytes: 11 },
        ],
      },
    });
    const stored = new TextDecoder().decode(storeContent.mock.calls[0][0]);
    expect(stored).toContain('"page":1');
    expect(stored).toContain("First page");
    expect(stored).toContain('"page":2');
  });

  it("reports image-only PDFs honestly without running OCR", async () => {
    const processed = await processPdfAttachment(
      pdfRecord(),
      new Uint8Array(),
      {
        extract: async () => ({
          pageCount: 3,
          pages: [
            { pageNumber: 1, text: "", truncated: false, error: null },
            { pageNumber: 2, text: "", truncated: false, error: null },
          ],
          extractedTextBytes: 0,
          truncated: false,
        }),
        storeContent: vi.fn(),
      },
    );
    expect(processed).toMatchObject({
      processingState: "unsupported",
      documentRepresentation: { pageCount: 3 },
      error: { code: "pdf_no_extractable_text" },
    });
    expect(processed.error?.message).toContain("OCR is not run automatically");
  });

  it("keeps malformed and encrypted parser failures visible", async () => {
    const processed = await processPdfAttachment(
      pdfRecord(),
      new Uint8Array(),
      {
        extract: async () => {
          throw new Error("Encrypted PDFs are not supported.");
        },
        storeContent: vi.fn(),
      },
    );
    expect(processed).toMatchObject({
      processingState: "failed",
      error: {
        code: "pdf_processing_failed",
        message: "Encrypted PDFs are not supported.",
      },
    });
  });

  it("rejects out-of-bounds parser output before storing it", async () => {
    const storeContent = vi.fn();
    const processed = await processPdfAttachment(
      pdfRecord(),
      new Uint8Array(),
      {
        extract: async () => ({
          pageCount: 1,
          pages: [
            {
              pageNumber: 1,
              text: "a".repeat(PDF_LIMITS.maxPageTextBytes + 1),
              truncated: false,
            },
          ],
          extractedTextBytes: PDF_LIMITS.maxPageTextBytes + 1,
          truncated: false,
        }),
        storeContent,
      },
    );
    expect(processed).toMatchObject({
      processingState: "failed",
      error: { code: "pdf_processing_failed" },
    });
    expect(storeContent).not.toHaveBeenCalled();
  });
});
