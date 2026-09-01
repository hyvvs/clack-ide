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
});
