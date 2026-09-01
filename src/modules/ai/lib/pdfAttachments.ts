import { invoke } from "@tauri-apps/api/core";
import type {
  AttachmentRecord,
  DocumentPageRepresentation,
} from "./attachments";
import {
  retainAttachmentContent,
  storeAttachmentContent,
  type AttachmentContentRef,
} from "./attachmentStore";

export const PDF_LIMITS = {
  maxPageCount: 10_000,
  maxExtractedPages: 128,
  maxPageTextBytes: 64 * 1024,
  maxExtractedTextBytes: 512 * 1024,
  maxStoredRepresentationBytes: 768 * 1024,
} as const;

type PdfPageExtraction = {
  pageNumber: number;
  text: string;
  truncated: boolean;
  error?: string | null;
};

type PdfExtraction = {
  pageCount: number;
  pages: PdfPageExtraction[];
  extractedTextBytes: number;
  truncated: boolean;
};

type PdfProcessingDeps = {
  extract: (bytes: Uint8Array) => Promise<unknown>;
  storeContent: (bytes: Uint8Array) => Promise<AttachmentContentRef>;
};

const DEFAULT_DEPS: PdfProcessingDeps = {
  extract: (bytes) => invoke("attachment_pdf_extract", bytes),
  storeContent: storeAttachmentContent,
};

export async function processPdfAttachment(
  record: AttachmentRecord,
  bytes: Uint8Array,
  deps: PdfProcessingDeps = DEFAULT_DEPS,
): Promise<AttachmentRecord> {
  if (
    record.contentKind !== "document" ||
    record.detectedMediaType !== "application/pdf" ||
    record.processingState !== "ready" ||
    !record.contentRef
  ) {
    return record;
  }
  try {
    const extraction = validatePdfExtraction(await deps.extract(bytes));
    const pages = pageRepresentations(extraction.pages);
    const representationText = formatPdfRepresentation(
      record.displayName,
      extraction.pages,
    );
    if (!representationText.trim()) {
      return {
        ...record,
        processingState: "unsupported",
        documentRepresentation: {
          pageCount: extraction.pageCount,
          extractedTextBytes: 0,
          truncated: extraction.truncated,
          pages,
        },
        error: {
          code: "pdf_no_extractable_text",
          message: `PDF has ${extraction.pageCount} page${extraction.pageCount === 1 ? "" : "s"}, but no embedded text was found. OCR is not run automatically.`,
        },
      };
    }
    const encoded = new TextEncoder().encode(representationText);
    if (encoded.byteLength > PDF_LIMITS.maxStoredRepresentationBytes) {
      throw new Error("PDF text representation exceeds Clack's safe limit.");
    }
    const textContentRef = await deps.storeContent(encoded);
    retainAttachmentContent(textContentRef.id);
    return {
      ...record,
      documentRepresentation: {
        pageCount: extraction.pageCount,
        extractedTextBytes: extraction.extractedTextBytes,
        truncated: extraction.truncated,
        pages,
        textContentRef,
      },
      error: undefined,
    };
  } catch (error) {
    return {
      ...record,
      processingState: "failed",
      documentRepresentation: undefined,
      error: {
        code: "pdf_processing_failed",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function validatePdfExtraction(value: unknown): PdfExtraction {
  if (!value || typeof value !== "object") {
    throw new Error("PDF parser returned invalid metadata.");
  }
  const candidate = value as Partial<PdfExtraction>;
  if (
    !Number.isInteger(candidate.pageCount) ||
    (candidate.pageCount ?? 0) <= 0 ||
    (candidate.pageCount ?? 0) > PDF_LIMITS.maxPageCount ||
    !Array.isArray(candidate.pages) ||
    candidate.pages.length > PDF_LIMITS.maxExtractedPages ||
    !Number.isInteger(candidate.extractedTextBytes) ||
    (candidate.extractedTextBytes ?? -1) < 0 ||
    (candidate.extractedTextBytes ?? 0) > PDF_LIMITS.maxExtractedTextBytes ||
    typeof candidate.truncated !== "boolean"
  ) {
    throw new Error("PDF parser returned out-of-bounds metadata.");
  }
  let actualTextBytes = 0;
  const pages = candidate.pages.map((page, index) => {
    if (!page || typeof page !== "object") {
      throw new Error("PDF parser returned an invalid page record.");
    }
    const entry = page as Partial<PdfPageExtraction>;
    const text = typeof entry.text === "string" ? entry.text : "";
    const textBytes = new TextEncoder().encode(text).byteLength;
    actualTextBytes += textBytes;
    if (
      !Number.isInteger(entry.pageNumber) ||
      (entry.pageNumber ?? 0) <= 0 ||
      (entry.pageNumber ?? 0) > (candidate.pageCount ?? 0) ||
      textBytes > PDF_LIMITS.maxPageTextBytes ||
      typeof entry.truncated !== "boolean" ||
      (entry.error != null &&
        (typeof entry.error !== "string" || entry.error.length > 512))
    ) {
      throw new Error(`PDF parser returned invalid page ${index + 1}.`);
    }
    return {
      pageNumber: entry.pageNumber,
      text,
      truncated: entry.truncated,
      ...(entry.error ? { error: entry.error } : {}),
    } as PdfPageExtraction;
  });
  if (
    actualTextBytes !== candidate.extractedTextBytes ||
    actualTextBytes > PDF_LIMITS.maxExtractedTextBytes
  ) {
    throw new Error("PDF parser returned inconsistent text bounds.");
  }
  return {
    pageCount: candidate.pageCount,
    pages,
    extractedTextBytes: actualTextBytes,
    truncated: candidate.truncated,
  } as PdfExtraction;
}

function pageRepresentations(
  pages: readonly PdfPageExtraction[],
): DocumentPageRepresentation[] {
  return pages.map((page) => ({
    pageNumber: page.pageNumber,
    textBytes: new TextEncoder().encode(page.text).byteLength,
    truncated: page.truncated,
    ...(page.error ? { error: page.error } : {}),
  }));
}

function formatPdfRepresentation(
  displayName: string,
  pages: readonly PdfPageExtraction[],
): string {
  return pages
    .filter((page) => page.text.trim().length > 0)
    .map((page) =>
      [
        "----- CLACK PDF PAGE -----",
        JSON.stringify({ name: displayName, page: page.pageNumber }),
        page.text,
        "----- END CLACK PDF PAGE -----",
      ].join("\n"),
    )
    .join("\n\n");
}
