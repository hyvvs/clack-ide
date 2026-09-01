import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AttachmentRecord } from "../lib/attachments";
import type { AttachmentCapabilityStatus } from "../lib/modelCapabilities";
import { ChipsRow } from "./ChipsRow";

const IMAGE: AttachmentRecord = {
  id: "image-1",
  source: { kind: "picker", token: "picker" },
  displayName: "screen.png",
  detectedMediaType: "image/png",
  byteSize: 128,
  contentKind: "image",
  processingState: "ready",
  security: {
    secretPathCheck: "not-applicable",
    workspaceScopeCheck: "not-applicable",
    mimeSniffed: true,
  },
  createdAt: 1,
};

function render(status: AttachmentCapabilityStatus): string {
  return renderToStaticMarkup(
    <ChipsRow
      files={[IMAGE]}
      attachmentCapabilities={{ [IMAGE.id]: status }}
      onRemoveFile={() => {}}
      onMaterializeArchiveEntry={async () => {}}
      snippets={[]}
      onRemoveSnippet={() => {}}
      commands={[]}
      onRemoveCommand={() => {}}
    />,
  );
}

describe("ChipsRow model capability state", () => {
  it("shows an explicit selected-model incompatibility", () => {
    const html = render({
      state: "blocked",
      support: "unsupported",
      label: "Unsupported by model",
      message: "The selected model does not support image input.",
    });
    expect(html).toContain("Unsupported by model");
    expect(html).toContain("selected model does not support image input");
  });

  it("does not add a warning label for a ready image", () => {
    const html = render({
      state: "ready",
      support: "supported",
      label: "Ready",
      message: "Image is ready for the selected model.",
    });
    expect(html).not.toContain("Unsupported by model");
    expect(html).not.toContain("Support unknown");
  });

  it("shows processing while the shared normalizer is reading a file", () => {
    const html = renderToStaticMarkup(
      <ChipsRow
        files={[{ ...IMAGE, processingState: "processing" }]}
        onRemoveFile={() => {}}
        onMaterializeArchiveEntry={async () => {}}
        snippets={[]}
        onRemoveSnippet={() => {}}
        commands={[]}
        onRemoveCommand={() => {}}
      />,
    );
    expect(html).toContain("Processing");
  });

  it("renders a compact inspectable ZIP chip instead of every manifest entry", () => {
    const manifestHash = "b".repeat(64);
    const archive = {
      ...IMAGE,
      id: "zip-1",
      displayName: "project.zip",
      detectedMediaType: "application/zip",
      contentKind: "archive" as const,
      archiveRepresentation: {
        format: "zip" as const,
        entryCount: 2,
        fileCount: 2,
        folderCount: 0,
        totalCompressedBytes: 10,
        totalExpandedBytes: 20,
        nestedArchiveDepthLimit: 0,
        manifestContentRef: {
          id: manifestHash,
          contentHash: manifestHash,
          byteSize: 20,
        },
        entries: [
          {
            index: 0,
            path: "first.txt",
            entryType: "file" as const,
            compressedSize: 5,
            expandedSize: 10,
            status: "ready" as const,
            selectable: true,
          },
          {
            index: 1,
            path: "second.txt",
            entryType: "file" as const,
            compressedSize: 5,
            expandedSize: 10,
            status: "ready" as const,
            selectable: true,
          },
        ],
      },
    } satisfies AttachmentRecord;
    const html = renderToStaticMarkup(
      <ChipsRow
        files={[archive]}
        onRemoveFile={() => {}}
        onMaterializeArchiveEntry={async () => {}}
        snippets={[]}
        onRemoveSnippet={() => {}}
        commands={[]}
        onRemoveCommand={() => {}}
      />,
    );
    expect(html).toContain("project.zip");
    expect(html).toContain("2 files");
    expect(html).not.toContain("first.txt");
    expect(html).not.toContain("second.txt");
  });
});
