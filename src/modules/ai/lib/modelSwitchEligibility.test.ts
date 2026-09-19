import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { toAttachmentMessagePart } from "./attachmentMessages";
import type { AttachmentRecord } from "./attachments";
import {
  assessModelSwitch,
  knownModelContextLimit,
} from "./modelSwitchEligibility";
import { compatModelIdForEndpoint, type CustomEndpoint } from "../config";
import { savedProviderModelSelectionId } from "./savedProviderModels";

const hash = "a".repeat(64);
function attachment(
  kind: AttachmentRecord["contentKind"],
  bytes = 20,
): AttachmentRecord {
  return {
    id: "attachment",
    source: { kind: "picker", token: "file" },
    displayName: "file",
    detectedMediaType: kind === "image" ? "image/png" : "text/plain",
    byteSize: bytes,
    contentKind: kind,
    processingState: "ready",
    contentRef: { id: hash, contentHash: hash, byteSize: bytes },
    security: {
      secretPathCheck: "passed",
      workspaceScopeCheck: "not-applicable",
      mimeSniffed: true,
    },
    createdAt: 1,
  };
}
function history(...parts: UIMessage["parts"]): UIMessage[] {
  return [
    { id: "old", role: "user", parts },
    { id: "latest", role: "user", parts: [{ type: "text", text: "Continue" }] },
  ];
}
function check(
  messages: UIMessage[],
  modelId = "claude-sonnet-4-6",
  limit: number | null = 32_000,
  systemText = "",
) {
  return assessModelSwitch({
    messages,
    targetModelId: modelId,
    contextLimit: limit,
    systemText,
  });
}

describe("known target context metadata", () => {
  it("uses existing registry and configured endpoint limits", () => {
    expect(knownModelContextLimit("claude-sonnet-4-6")).toBe(200_000);
    const endpoint: CustomEndpoint = {
      id: "local",
      name: "Local",
      baseURL: "http://localhost:1234/v1",
      modelId: "test",
      contextLimit: 8192,
    };
    expect(
      knownModelContextLimit(compatModelIdForEndpoint("local"), [endpoint]),
    ).toBe(8192);
    expect(knownModelContextLimit("openai-compatible-custom", [], 4096)).toBe(
      4096,
    );
  });
  it.each([
    "openrouter-custom",
    "ollama-local",
    "lmstudio-local",
    "mlx-local",
    "unknown-model",
    savedProviderModelSelectionId("claude-sonnet-4-6"),
  ])("does not invent a window for %s", (modelId) => {
    expect(knownModelContextLimit(modelId)).toBeNull();
  });
  it("rejects missing and invalid endpoint limits", () => {
    expect(knownModelContextLimit(compatModelIdForEndpoint("gone"))).toBeNull();
    expect(
      knownModelContextLimit("openai-compatible-custom", [], 0),
    ).toBeNull();
    expect(
      knownModelContextLimit("openai-compatible-custom", [], Number.NaN),
    ).toBeNull();
  });
});

describe("historical attachment compatibility", () => {
  it("blocks explicit text-only targets without rewriting historical images", () => {
    const messages = history(toAttachmentMessagePart(attachment("image")));
    const original = structuredClone(messages);
    const result = check(messages, "deepseek-v4-flash");
    expect(result.status).toBe("blocked");
    expect(result.reasons).toContain(
      "This chat contains images that this model cannot receive.",
    );
    expect(messages).toEqual(original);
  });
  it("warns for unknown vision without inferring from a saved model's name", () => {
    const result = check(
      history(toAttachmentMessagePart(attachment("image"))),
      savedProviderModelSelectionId("vision-gpt"),
      null,
    );
    expect(result.status).toBe("warning");
    expect(result.reasons.join(" ")).toContain("Sending remains blocked");
  });
  it("keeps confirmed vision images eligible with honest unmeasured-overhead warning", () => {
    const result = check(history(toAttachmentMessagePart(attachment("image"))));
    expect(result.status).toBe("warning");
    expect(result.reasons.join(" ")).toContain("model-dependent context usage");
    expect(result.reasons.join(" ")).not.toContain("cannot receive");
  });
  it("also checks legacy inline images and native document files", () => {
    expect(
      check(
        history({
          type: "file",
          mediaType: "image/png",
          url: "data:image/png;base64,AA==",
        }),
        "deepseek-v4-flash",
      ).status,
    ).toBe("blocked");
    expect(
      check(
        history({
          type: "file",
          mediaType: "application/pdf",
          url: "data:application/pdf;base64,AA==",
        }),
      ).status,
    ).toBe("blocked");
  });
  it("treats persisted SVG as text and detection-only binaries as metadata", () => {
    const svg = { ...attachment("image"), detectedMediaType: "image/svg+xml" };
    expect(
      check(history(toAttachmentMessagePart(svg)), "deepseek-v4-flash").status,
    ).toBe("compatible");
    expect(
      check(history(toAttachmentMessagePart(attachment("binary", 8_000_000))))
        .status,
    ).toBe("compatible");
  });
  it("blocks invalid historical attachment references instead of overlooking them", () => {
    expect(
      check(history({ type: "data-clack-attachment", data: {} })).status,
    ).toBe("blocked");
  });
});

describe("pre-switch context budget", () => {
  it("allows a smaller model when history fits", () => {
    expect(
      check(
        history({ type: "text", text: "hello".repeat(100) }),
        "claude-sonnet-4-6",
        8000,
      ).status,
    ).toBe("compatible");
  });
  it("blocks an oversized history and leaves every message intact", () => {
    const messages = history({ type: "text", text: "x".repeat(40_000) });
    const original = structuredClone(messages);
    const result = check(messages, "claude-sonnet-4-6", 8000);
    expect(result.status).toBe("blocked");
    expect(result.reasons).toContain(
      "This conversation is too large for this model's context window.",
    );
    expect(messages).toEqual(original);
  });
  it("warns rather than fabricating limits for freeform models", () => {
    const result = check(
      history({ type: "text", text: "x".repeat(40_000) }),
      "openrouter-custom",
      null,
    );
    expect(result.status).toBe("warning");
    expect(result.contextLimit).toBeNull();
  });
  it("includes system instructions even in an empty chat", () => {
    expect(
      check([], "claude-sonnet-4-6", 8000, "x".repeat(40_000)).status,
    ).toBe("blocked");
  });
  it("counts completed tool calls and results", () => {
    const messages: UIMessage[] = [
      {
        id: "tool",
        role: "assistant",
        parts: [
          {
            type: "tool-read_file",
            toolCallId: "read",
            state: "output-available",
            input: { path: "file" },
            output: "x".repeat(40_000),
          },
        ],
      },
    ];
    expect(check(messages, "claude-sonnet-4-6", 8000).status).toBe("blocked");
  });
  it("counts text attachments and derived PDF/archive text, not original payload size", () => {
    expect(
      check(
        history(toAttachmentMessagePart(attachment("text", 40_000))),
        "claude-sonnet-4-6",
        8000,
      ).status,
    ).toBe("blocked");
    const pdf = attachment("document", 8_000_000);
    pdf.documentRepresentation = {
      pageCount: 1,
      extractedTextBytes: 40_000,
      truncated: false,
      pages: [{ pageNumber: 1, textBytes: 40_000, truncated: false }],
      textContentRef: { id: hash, contentHash: hash, byteSize: 40_000 },
    };
    expect(
      check(history(toAttachmentMessagePart(pdf)), "claude-sonnet-4-6", 8000)
        .status,
    ).toBe("blocked");
    pdf.documentRepresentation.textContentRef = {
      id: hash,
      contentHash: hash,
      byteSize: 100,
    };
    pdf.documentRepresentation.extractedTextBytes = 100;
    expect(
      check(history(toAttachmentMessagePart(pdf)), "claude-sonnet-4-6", 8000)
        .status,
    ).toBe("compatible");
    const archive = attachment("archive", 8_000_000);
    archive.archiveRepresentation = {
      format: "zip",
      entryCount: 1,
      fileCount: 1,
      folderCount: 0,
      entries: [],
      totalCompressedBytes: 8_000_000,
      totalExpandedBytes: 8_000_000,
      nestedArchiveDepthLimit: 0,
      manifestContentRef: { id: hash, contentHash: hash, byteSize: 40_000 },
    };
    expect(
      check(
        history(toAttachmentMessagePart(archive)),
        "claude-sonnet-4-6",
        8000,
      ).status,
    ).toBe("blocked");
  });
  it("warns near compaction territory rather than deleting history to fit", () => {
    expect(
      check(
        history({ type: "text", text: "x".repeat(15_000) }),
        "claude-sonnet-4-6",
        8000,
      ).status,
    ).toBe("warning");
  });
  it("warns about provider-specific reasoning only when present across providers", () => {
    const result = assessModelSwitch({
      messages: history({ type: "reasoning", text: "prior reasoning" }),
      targetModelId: "claude-sonnet-4-6",
      contextLimit: 200_000,
      providerChanged: true,
    });
    expect(result.reasons.join(" ")).toContain("reasoning may not transfer");
  });
});
