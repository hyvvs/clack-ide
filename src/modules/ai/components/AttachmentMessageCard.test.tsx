import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CLACK_ATTACHMENT_PART_TYPE } from "../lib/attachmentMessages";
import { AttachmentMessageCard } from "./AttachmentMessageCard";

const HASH = "a".repeat(64);

describe("AttachmentMessageCard", () => {
  it("keeps persisted SVG source inert instead of rendering an image preview", () => {
    const html = renderToStaticMarkup(
      <AttachmentMessageCard
        part={{
          type: CLACK_ATTACHMENT_PART_TYPE,
          data: {
            attachmentId: "svg-1",
            contentId: HASH,
            contentHash: HASH,
            displayName: "icon.svg",
            mediaType: "image/svg+xml",
            byteSize: 11,
            contentKind: "image",
          },
        }}
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("icon.svg");
  });

  it("shows PDF page count without loading raw document content", () => {
    const html = renderToStaticMarkup(
      <AttachmentMessageCard
        part={{
          type: CLACK_ATTACHMENT_PART_TYPE,
          data: {
            attachmentId: "pdf-1",
            contentId: HASH,
            contentHash: HASH,
            displayName: "report.pdf",
            mediaType: "application/pdf",
            byteSize: 1024,
            contentKind: "document",
            documentRepresentation: {
              pageCount: 3,
              extractedTextBytes: 12,
              truncated: false,
              pages: [{ pageNumber: 1, textBytes: 12, truncated: false }],
              textContentRef: {
                id: "b".repeat(64),
                contentHash: "b".repeat(64),
                byteSize: 12,
              },
            },
          },
        }}
      />,
    );
    expect(html).toContain("PDF | 3 pages");
    expect(html).toContain("report.pdf");
  });
});
