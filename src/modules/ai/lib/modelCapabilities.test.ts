import { describe, expect, it } from "vitest";
import type { AttachmentRecord } from "./attachments";
import {
  attachmentCapabilityStatus,
  firstBlockedAttachment,
  resolveModelInputCapabilities,
} from "./modelCapabilities";

function attachment(
  contentKind: AttachmentRecord["contentKind"],
): AttachmentRecord {
  return {
    id: `attachment-${contentKind}`,
    source: { kind: "picker", token: "picker" },
    displayName: contentKind === "image" ? "screen.png" : "notes.txt",
    detectedMediaType: contentKind === "image" ? "image/png" : "text/plain",
    byteSize: 12,
    contentKind,
    processingState: "ready",
    security: {
      secretPathCheck: "not-applicable",
      workspaceScopeCheck: "not-applicable",
      mimeSniffed: true,
    },
    createdAt: 1,
  };
}

describe("model attachment capabilities", () => {
  it("uses explicit registry vision and tool tags for known models", () => {
    expect(resolveModelInputCapabilities("gpt-5.4-mini")).toMatchObject({
      text: "supported",
      image: "supported",
      tools: "supported",
      document: "unsupported",
      audio: "unsupported",
      evidence: "registry",
    });
  });

  it("treats a known model without a vision tag as image unsupported", () => {
    expect(resolveModelInputCapabilities("gpt-5.3-codex").image).toBe(
      "unsupported",
    );
  });

  it.each([
    "openrouter-custom",
    "openai-compatible-custom",
    "lmstudio-local",
    "mlx-local",
    "ollama-local",
    "saved-provider:personal",
    "compat-endpoint-a",
  ])("does not guess capabilities for freeform selection %s", (selectionId) => {
    expect(resolveModelInputCapabilities(selectionId)).toMatchObject({
      text: "supported",
      image: "unknown",
      document: "unknown",
      tools: "unknown",
      audio: "unknown",
      evidence: "freeform",
    });
  });

  it("blocks a known text-only model before an image is sent", () => {
    const model = resolveModelInputCapabilities("gpt-5.3-codex");
    expect(
      attachmentCapabilityStatus(attachment("image"), model),
    ).toMatchObject({
      state: "blocked",
      support: "unsupported",
      label: "Unsupported by model",
    });
  });

  it("blocks unknown image support with an explicit explanation", () => {
    const model = resolveModelInputCapabilities("saved-provider:personal");
    const status = attachmentCapabilityStatus(attachment("image"), model);
    expect(status).toMatchObject({
      state: "blocked",
      support: "unknown",
      label: "Support unknown",
    });
    expect(status.message).toContain(
      "Choose a model with confirmed vision support",
    );
  });

  it("allows bounded text representation independently of image capability", () => {
    const model = resolveModelInputCapabilities("saved-provider:personal");
    expect(attachmentCapabilityStatus(attachment("text"), model).state).toBe(
      "ready",
    );
  });

  it("routes SVG as bounded source text without claiming raster vision", () => {
    const svg = {
      ...attachment("image"),
      displayName: "icon.svg",
      detectedMediaType: "image/svg+xml",
    };
    const model = resolveModelInputCapabilities("gpt-5.3-codex");
    expect(attachmentCapabilityStatus(svg, model)).toMatchObject({
      state: "ready",
      support: "supported",
    });
  });

  it("routes extracted PDF text independently of native document support", () => {
    const document = {
      ...attachment("document"),
      displayName: "report.pdf",
      detectedMediaType: "application/pdf",
      documentRepresentation: {
        pageCount: 1,
        extractedTextBytes: 4,
        truncated: false,
        pages: [{ pageNumber: 1, textBytes: 4, truncated: false }],
        textContentRef: {
          id: "a".repeat(64),
          contentHash: "a".repeat(64),
          byteSize: 4,
        },
      },
    } satisfies AttachmentRecord;
    const model = resolveModelInputCapabilities("gpt-5.3-codex");
    expect(attachmentCapabilityStatus(document, model)).toMatchObject({
      state: "ready",
      support: "supported",
    });
  });

  it("returns the first blocked ready attachment and ignores ingestion failures", () => {
    const failed = {
      ...attachment("image"),
      processingState: "failed" as const,
    };
    const blocked = attachment("image");
    expect(
      firstBlockedAttachment(
        [failed, attachment("text"), blocked],
        resolveModelInputCapabilities("gpt-5.3-codex"),
      )?.attachment.id,
    ).toBe(blocked.id);
  });
});
