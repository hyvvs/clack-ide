import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import type { AttachmentRecord } from "./attachments";
import {
  CLACK_ATTACHMENT_PART_TYPE,
  collectAttachmentContentIds,
  materializeAttachmentMessages,
  migrateLegacyDataUrlAttachments,
  toAttachmentMessagePart,
} from "./attachmentMessages";
import type { ModelInputCapabilities } from "./modelCapabilities";

const HASH = "a".repeat(64);
const VISION_CAPABILITIES: ModelInputCapabilities = {
  text: "supported",
  image: "supported",
  document: "unsupported",
  tools: "supported",
  audio: "unsupported",
  evidence: "registry",
};

function record(
  contentKind: "text" | "image" | "selection" = "text",
): AttachmentRecord {
  return {
    id: `record-${contentKind}`,
    source:
      contentKind === "selection"
        ? { kind: "selection", surface: "editor" }
        : { kind: "picker", token: contentKind },
    displayName: contentKind === "image" ? "screen.png" : "notes.txt",
    detectedMediaType: contentKind === "image" ? "image/png" : "text/plain",
    byteSize: 5,
    contentKind,
    processingState: "ready",
    contentRef: { id: HASH, contentHash: HASH, byteSize: 5 },
    security: {
      secretPathCheck: "passed",
      workspaceScopeCheck: "not-applicable",
      mimeSniffed: true,
    },
    createdAt: 1,
  };
}

function messageWith(...parts: unknown[]): UIMessage {
  return {
    id: "message-1",
    role: "user",
    parts,
  } as UIMessage;
}

describe("attachment message references", () => {
  it("serializes only bounded metadata and a content reference", () => {
    const part = toAttachmentMessagePart(record("text"));
    const serialized = JSON.stringify(part);
    expect(part.type).toBe(CLACK_ATTACHMENT_PART_TYPE);
    expect(part.data.contentId).toBe(HASH);
    expect(serialized).not.toContain("attachment body");
    expect(serialized.length).toBeLessThan(500);
  });

  it("materializes text content only for the outgoing model request", async () => {
    const reference = toAttachmentMessagePart(record("text"));
    const messages = [
      messageWith({ type: "text", text: "Review it" }, reference),
    ];
    const loadContent = vi.fn(async () => new TextEncoder().encode("hello"));
    const materialized = await materializeAttachmentMessages(
      messages,
      VISION_CAPABILITIES,
      {
        loadContent,
        toDataUrl: vi.fn(),
      },
    );
    expect(loadContent).toHaveBeenCalledWith(HASH);
    expect(materialized[0].parts).toHaveLength(2);
    expect(materialized[0].parts[1]).toMatchObject({
      type: "text",
      text: expect.stringContaining("hello"),
    });
    expect(messages[0].parts[1]).toBe(reference);
  });

  it("materializes image content as a transient file part", async () => {
    const reference = toAttachmentMessagePart(record("image"));
    const toDataUrl = vi.fn(async () => "data:image/png;base64,aGVsbG8=");
    const materialized = await materializeAttachmentMessages(
      [messageWith(reference)],
      VISION_CAPABILITIES,
      {
        loadContent: async () => new TextEncoder().encode("hello"),
        toDataUrl,
      },
    );
    expect(materialized[0].parts[0]).toMatchObject({
      type: "file",
      filename: "screen.png",
      mediaType: "image/png",
      url: "data:image/png;base64,aGVsbG8=",
    });
  });

  it("blocks image delivery for an explicitly text-only model", async () => {
    const reference = toAttachmentMessagePart(record("image"));
    const loadContent = vi.fn();
    await expect(
      materializeAttachmentMessages(
        [messageWith(reference)],
        { ...VISION_CAPABILITIES, image: "unsupported" },
        { loadContent, toDataUrl: vi.fn() },
      ),
    ).rejects.toMatchObject({
      code: "attachment_capability_blocked",
      attachmentName: "screen.png",
      support: "unsupported",
    });
    expect(loadContent).not.toHaveBeenCalled();
  });

  it("blocks image delivery when freeform model support is unknown", async () => {
    const reference = toAttachmentMessagePart(record("image"));
    await expect(
      materializeAttachmentMessages(
        [messageWith(reference)],
        { ...VISION_CAPABILITIES, image: "unknown", evidence: "freeform" },
        { loadContent: vi.fn(), toDataUrl: vi.fn() },
      ),
    ).rejects.toMatchObject({
      code: "attachment_capability_blocked",
      support: "unknown",
    });
  });

  it("collects deduplicated content IDs from persisted messages", () => {
    const reference = toAttachmentMessagePart(record("text"));
    expect(
      collectAttachmentContentIds([
        messageWith(reference, reference),
        messageWith({ type: "text", text: "plain" }),
      ]),
    ).toEqual([HASH]);
  });

  it("migrates a legacy data URL into the content store", async () => {
    const storeContent = vi.fn(async () => ({
      id: HASH,
      contentHash: HASH,
      byteSize: 5,
    }));
    const legacy = messageWith({
      type: "file",
      filename: "old.png",
      mediaType: "image/png",
      url: "data:image/png;base64,aGVsbG8=",
    });
    const migrated = await migrateLegacyDataUrlAttachments([legacy], {
      storeContent,
    });
    expect(migrated.changed).toBe(true);
    expect(storeContent).toHaveBeenCalledWith(
      Uint8Array.from([104, 101, 108, 108, 111]),
    );
    expect(migrated.messages[0].parts[0]).toMatchObject({
      type: CLACK_ATTACHMENT_PART_TYPE,
      data: { contentId: HASH, displayName: "old.png" },
    });
    expect(JSON.stringify(migrated.messages)).not.toContain("aGVsbG8=");
  });

  it("preserves legacy content when migration storage is unavailable", async () => {
    const legacy = messageWith({
      type: "file",
      filename: "old.png",
      mediaType: "image/png",
      url: "data:image/png;base64,aGVsbG8=",
    });
    const migrated = await migrateLegacyDataUrlAttachments([legacy], {
      storeContent: async () => {
        throw new Error("disk unavailable");
      },
    });
    expect(migrated.changed).toBe(false);
    expect(migrated.messages).toHaveLength(1);
    expect(migrated.messages[0]).toBe(legacy);
  });
});
