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
    expect(html).toContain("Ready");
    expect(html).toContain("3 pages · Text extracted");
    expect(html).toContain("Show delivery details for report.pdf");
    expect(html).toContain("report.pdf");
  });

  it("shows ZIP file count and expanded size compactly", () => {
    const manifestHash = "c".repeat(64);
    const html = renderToStaticMarkup(
      <AttachmentMessageCard
        part={{
          type: CLACK_ATTACHMENT_PART_TYPE,
          data: {
            attachmentId: "zip-1",
            contentId: HASH,
            contentHash: HASH,
            displayName: "project.zip",
            mediaType: "application/zip",
            byteSize: 1024,
            contentKind: "archive",
            archiveRepresentation: {
              format: "zip",
              entryCount: 127,
              fileCount: 120,
              folderCount: 7,
              totalCompressedBytes: 1024,
              totalExpandedBytes: 4 * 1024 * 1024,
              nestedArchiveDepthLimit: 0,
              manifestContentRef: {
                id: manifestHash,
                contentHash: manifestHash,
                byteSize: 100,
              },
            },
          },
        }}
      />,
    );
    expect(html).toContain("120 files indexed · Select files to include");
    expect(html).toContain("project.zip");
  });

  it("shows how many archive entries were actually selected", () => {
    const manifestHash = "d".repeat(64);
    const html = renderToStaticMarkup(
      <AttachmentMessageCard
        selectedArchiveEntries={["src/main.ts", "README.md"]}
        part={{
          type: CLACK_ATTACHMENT_PART_TYPE,
          data: {
            attachmentId: "zip-2",
            contentId: HASH,
            contentHash: HASH,
            displayName: "source.zip",
            mediaType: "application/zip",
            byteSize: 1024,
            contentKind: "archive",
            archiveRepresentation: {
              format: "zip",
              entryCount: 12,
              fileCount: 10,
              folderCount: 2,
              totalCompressedBytes: 1024,
              totalExpandedBytes: 4096,
              nestedArchiveDepthLimit: 0,
              manifestContentRef: {
                id: manifestHash,
                contentHash: manifestHash,
                byteSize: 100,
              },
            },
          },
        }}
      />,
    );
    expect(html).toContain("10 files indexed · 2 selected");
  });
});
