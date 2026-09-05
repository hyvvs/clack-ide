import type { AttachmentRecord } from "./attachments";
import { formatBytes } from "./attachments";
import type { AttachmentCapabilityStatus } from "./modelCapabilities";

export type AttachmentOutcome =
  | "ready"
  | "limited"
  | "unsupported"
  | "blocked"
  | "processing"
  | "failed";

export type AttachmentPresentationDetail = {
  label: string;
  value: string;
};

export type AttachmentPresentation = {
  outcome: AttachmentOutcome;
  statusLabel: string;
  summary: string;
  explanation: string;
  details: AttachmentPresentationDetail[];
};

export type AttachmentPresentationOptions = {
  capability?: AttachmentCapabilityStatus;
  modelLabel?: string;
  selectedArchiveEntries?: readonly Pick<AttachmentRecord, "displayName">[];
  delivered?: boolean;
  contentAvailable?: boolean;
};

export function buildAttachmentPresentation(
  attachment: AttachmentRecord,
  options: AttachmentPresentationOptions = {},
): AttachmentPresentation {
  const selectedEntries = options.selectedArchiveEntries ?? [];
  const modelLabel = options.modelLabel ?? "Selected model";
  const baseDetails: AttachmentPresentationDetail[] = [
    { label: "Detected type", value: detectedTypeLabel(attachment) },
    { label: "File size", value: formatBytes(attachment.byteSize) },
  ];

  if (options.contentAvailable === false) {
    return presentation(
      "failed",
      "Attachment unavailable",
      "The saved attachment content could not be loaded.",
      [
        ...baseDetails,
        { label: "Model input", value: "No" },
        { label: "Reason", value: "Saved content is unavailable" },
      ],
    );
  }

  if (attachment.processingState === "processing") {
    const summary = processingLabel(attachment);
    return presentation(
      "processing",
      summary,
      "Clack is still preparing this attachment. It cannot be sent yet.",
      [...baseDetails, { label: "Model input", value: "Not yet" }],
    );
  }

  if (isSensitiveAttachment(attachment)) {
    return presentation(
      "blocked",
      "Sensitive file",
      "Clack blocked this file before reading or sending its contents.",
      [
        ...baseDetails,
        { label: "Model input", value: "No" },
        { label: "Reason", value: "Sensitive file policy" },
      ],
    );
  }

  if (isPdfWithoutText(attachment)) {
    const pages = attachment.documentRepresentation?.pageCount;
    return presentation(
      "limited",
      "No embedded text · OCR unavailable",
      "Clack detected the PDF, but found no model-readable embedded text. OCR is not performed.",
      [
        ...baseDetails,
        ...(pages ? [{ label: "Pages detected", value: String(pages) }] : []),
        { label: "Pages processed", value: "0 with extractable text" },
        { label: "Text extracted", value: "0 B" },
        { label: "OCR", value: "Not performed" },
        { label: "Model input", value: "No PDF content" },
      ],
    );
  }

  if (isRar(attachment)) {
    return presentation(
      "unsupported",
      "Contents cannot be safely inspected",
      "Clack detected a RAR archive, but this build does not open or send its contents.",
      [
        ...baseDetails,
        { label: "Archive detected", value: "Yes" },
        { label: "Contents inspected", value: "No" },
        { label: "Model input", value: "No" },
      ],
    );
  }

  if (isMetadataOnlyBinary(attachment)) {
    return presentation(
      "limited",
      "Metadata only · Contents not sent",
      "Clack can show this file's name, type, and size, but cannot inspect or deliver its contents.",
      [
        ...baseDetails,
        { label: "Contents processed", value: "No" },
        { label: "Model input", value: "No" },
      ],
    );
  }

  if (attachment.processingState === "unsupported") {
    return presentation(
      "unsupported",
      friendlyFailureSummary(attachment),
      "Clack recognized this attachment but cannot prepare useful content for the model.",
      [
        ...baseDetails,
        { label: "Model input", value: "No" },
        { label: "Reason", value: friendlyFailureSummary(attachment) },
      ],
    );
  }

  if (attachment.processingState === "failed") {
    const reason = friendlyFailureSummary(attachment);
    return presentation(
      "failed",
      reason,
      "Clack could not finish processing this attachment. Its contents will not be sent.",
      [
        ...baseDetails,
        { label: "Model input", value: "No" },
        { label: "Reason", value: reason },
      ],
    );
  }

  if (attachment.contentKind === "image") {
    if (attachment.detectedMediaType === "image/svg+xml") {
      return presentation(
        "ready",
        "Source text",
        "Clack will send the bounded SVG source as text. It is not sent as raster vision input.",
        [
          ...baseDetails,
          { label: "Image vision input", value: "No" },
          { label: "Model input", value: "SVG source text" },
          { label: "Model", value: modelLabel },
        ],
      );
    }
    if (options.capability?.state === "blocked") {
      const unknown = options.capability.support === "unknown";
      return presentation(
        "unsupported",
        unknown
          ? "Model image support is not confirmed"
          : "Selected model cannot receive images",
        options.capability.message,
        [
          ...baseDetails,
          { label: "Image vision input", value: "No" },
          { label: "Model", value: modelLabel },
          {
            label: "Reason",
            value: unknown
              ? "Image support is not confirmed"
              : "Model is text-only",
          },
        ],
      );
    }
    if (!options.capability && !options.delivered) {
      return presentation(
        "limited",
        "Model compatibility not checked",
        "The image is processed, but Clack cannot yet confirm that the selected model will receive it.",
        [
          ...baseDetails,
          { label: "Image vision input", value: "Not confirmed" },
          { label: "Model", value: modelLabel },
        ],
      );
    }
    return presentation(
      "ready",
      "Vision input",
      options.delivered
        ? "The image was delivered as vision input."
        : "The image is processed and will be delivered as vision input.",
      [
        ...baseDetails,
        { label: "Image vision input", value: "Yes" },
        { label: "Model", value: modelLabel },
      ],
    );
  }

  if (attachment.contentKind === "document") {
    const document = attachment.documentRepresentation;
    if (!document?.textContentRef || document.extractedTextBytes === 0) {
      return presentation(
        "limited",
        "No model-readable PDF text",
        "The PDF was detected, but no extracted text is available to send.",
        [
          ...baseDetails,
          { label: "Pages detected", value: String(document?.pageCount ?? 0) },
          { label: "Text extracted", value: "0 B" },
          { label: "OCR", value: "Not performed" },
          { label: "Model input", value: "No PDF content" },
        ],
      );
    }
    const processedPages = document.pages.length;
    const details = [
      ...baseDetails,
      { label: "Pages detected", value: String(document.pageCount) },
      { label: "Pages processed", value: String(processedPages) },
      {
        label: "Text extracted",
        value: formatBytes(document.extractedTextBytes),
      },
      { label: "Truncated", value: document.truncated ? "Yes" : "No" },
      { label: "OCR", value: "Not performed" },
      { label: "Model input", value: "Extracted PDF text" },
    ];
    if (document.truncated) {
      return presentation(
        "limited",
        `${processedPages} of ${document.pageCount} pages processed`,
        "Clack will send only the bounded extracted text. Additional pages or text were omitted at the processing limit.",
        details,
      );
    }
    return presentation(
      "ready",
      `${document.pageCount} ${plural(document.pageCount, "page")} · Text extracted`,
      "Clack will send the extracted PDF text with page references. The raw PDF is not sent.",
      details,
    );
  }

  if (attachment.contentKind === "archive") {
    const archive = attachment.archiveRepresentation;
    if (!archive) {
      return presentation(
        "failed",
        "Archive index unavailable",
        "Clack could not produce a safe archive index, so no archive content will be sent.",
        [...baseDetails, { label: "Model input", value: "No" }],
      );
    }
    const selectedCount = selectedEntries.length;
    const selectedNames = selectedEntries.map((entry) => entry.displayName);
    return presentation(
      "ready",
      `${archive.fileCount} ${plural(archive.fileCount, "file")} indexed · ${selectedCount > 0 ? `${selectedCount} selected` : "Select files to include"}`,
      "Clack will send the bounded archive index. Entry contents are sent only for files you select.",
      [
        ...baseDetails,
        { label: "Archive indexed", value: "Yes" },
        { label: "Entries", value: String(archive.entryCount) },
        { label: "Files", value: String(archive.fileCount) },
        { label: "Selected entries", value: String(selectedCount) },
        {
          label: "Model input",
          value:
            selectedCount > 0
              ? `Archive index and ${selectedCount} selected ${plural(selectedCount, "file")}`
              : "Archive index only",
        },
        ...(selectedNames.length > 0
          ? [{ label: "Selected files", value: selectedNames.join(", ") }]
          : []),
      ],
    );
  }

  if (
    attachment.error?.code === "text_truncated" ||
    attachment.error?.code === "text_representation_truncated"
  ) {
    return presentation(
      "limited",
      "Text truncated to processing limit",
      "Clack will send the bounded text that was processed and omit the remainder.",
      [
        ...baseDetails,
        { label: "Text processed", value: formatBytes(attachment.byteSize) },
        { label: "Truncated", value: "Yes" },
        { label: "Model input", value: "Bounded text" },
      ],
    );
  }

  if (
    attachment.contentKind === "text" ||
    attachment.contentKind === "selection"
  ) {
    return presentation(
      "ready",
      `${attachment.contentKind === "selection" ? "Selection" : "Text"} · ${formatBytes(attachment.byteSize)}`,
      "Clack will send the complete bounded UTF-8 text.",
      [
        ...baseDetails,
        { label: "Text processed", value: formatBytes(attachment.byteSize) },
        { label: "Truncated", value: "No" },
        { label: "Model input", value: "Text" },
      ],
    );
  }

  return presentation(
    "limited",
    "Metadata only · Contents not sent",
    "Clack cannot prepare model-readable content for this attachment.",
    [...baseDetails, { label: "Model input", value: "No" }],
  );
}

function presentation(
  outcome: AttachmentOutcome,
  summary: string,
  explanation: string,
  details: AttachmentPresentationDetail[],
): AttachmentPresentation {
  return {
    outcome,
    statusLabel: statusLabel(outcome),
    summary,
    explanation,
    details,
  };
}

function statusLabel(outcome: AttachmentOutcome): string {
  if (outcome === "ready") return "Ready";
  if (outcome === "limited") return "Limited";
  if (outcome === "unsupported") return "Unsupported";
  if (outcome === "blocked") return "Blocked";
  if (outcome === "processing") return "Processing";
  return "Failed";
}

function processingLabel(attachment: AttachmentRecord): string {
  if (
    attachment.contentKind === "archive" ||
    /\.(?:zip|7z|rar)$/i.test(attachment.displayName)
  ) {
    return "Indexing archive…";
  }
  if (
    attachment.contentKind === "document" ||
    attachment.detectedMediaType === "application/pdf" ||
    /\.pdf$/i.test(attachment.displayName)
  ) {
    return "Extracting PDF text…";
  }
  if (
    attachment.contentKind === "image" ||
    attachment.detectedMediaType.startsWith("image/") ||
    /\.(?:png|jpe?g|webp|gif|svg)$/i.test(attachment.displayName)
  ) {
    return "Processing image…";
  }
  if (
    attachment.contentKind === "text" ||
    attachment.contentKind === "selection"
  ) {
    return "Reading text…";
  }
  return "Inspecting file…";
}

function detectedTypeLabel(attachment: AttachmentRecord): string {
  if (isRar(attachment)) return "RAR archive";
  if (attachment.detectedMediaType === "application/zip") return "ZIP archive";
  if (attachment.detectedMediaType === "application/x-7z-compressed") {
    return "7z archive";
  }
  if (attachment.detectedMediaType === "application/pdf") return "PDF";
  if (attachment.detectedMediaType === "image/svg+xml") return "SVG source";
  if (attachment.contentKind === "image") return "Image";
  if (attachment.contentKind === "selection") return "Selection";
  if (attachment.contentKind === "text") return "Text";
  if (attachment.contentKind === "binary") return "Binary file";
  return attachment.detectedMediaType || "Unknown file";
}

function friendlyFailureSummary(attachment: AttachmentRecord): string {
  const code = attachment.error?.code ?? "";
  const message = attachment.error?.message ?? "";
  if (code.includes("too_large") || code.includes("aggregate")) {
    return "File is too large";
  }
  if (code === "workspace_required") return "Open a workspace first";
  if (code === "invalid_text_encoding") return "Text is not valid UTF-8";
  if (code === "invalid_svg_encoding") return "SVG source is not valid UTF-8";
  if (code === "image_dimensions_unsafe") {
    return "Image dimensions exceed the safety limit";
  }
  if (code === "attachment_persistence_failed") {
    return "Attachment content is unavailable";
  }
  if (code === "archive_processing_failed") {
    if (/encrypt/i.test(message))
      return "Encrypted archive cannot be inspected";
    return "Could not safely inspect archive";
  }
  if (code === "pdf_processing_failed") {
    if (/encrypt/i.test(message)) return "Encrypted PDF cannot be processed";
    return "Could not extract PDF text";
  }
  if (code.includes("read_failed")) return "Could not read file";
  return "Could not process file";
}

function isSensitiveAttachment(attachment: AttachmentRecord): boolean {
  return (
    attachment.error?.code === "secret_path_rejected" ||
    attachment.security.secretPathCheck === "rejected"
  );
}

function isPdfWithoutText(attachment: AttachmentRecord): boolean {
  return (
    attachment.detectedMediaType === "application/pdf" &&
    (attachment.error?.code === "pdf_no_extractable_text" ||
      (attachment.documentRepresentation != null &&
        attachment.documentRepresentation.extractedTextBytes === 0))
  );
}

function isRar(attachment: AttachmentRecord): boolean {
  return attachment.detectedMediaType === "application/vnd.rar";
}

function isMetadataOnlyBinary(attachment: AttachmentRecord): boolean {
  return (
    attachment.contentKind === "binary" &&
    (attachment.error?.code === "binary_not_supported" ||
      attachment.detectedMediaType === "application/octet-stream")
  );
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}
