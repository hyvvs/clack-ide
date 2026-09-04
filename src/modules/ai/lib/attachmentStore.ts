import { invoke } from "@tauri-apps/api/core";

const contentLeases = new Map<string, number>();

export type AttachmentContentRef = {
  id: string;
  contentHash: string;
  byteSize: number;
};

export type AttachmentContentIssueCode =
  | "attachment_content_missing"
  | "attachment_content_integrity_failed"
  | "attachment_content_invalid";

export type AttachmentContentIssue = {
  id: string;
  code: AttachmentContentIssueCode;
  message: string;
};

export type AttachmentReconcileResult = {
  removedCount: number;
  issues: AttachmentContentIssue[];
};

export class AttachmentContentError extends Error {
  constructor(
    readonly code: AttachmentContentIssueCode,
    message: string,
  ) {
    super(message);
    this.name = "AttachmentContentError";
  }
}

export async function storeAttachmentContent(
  bytes: Uint8Array,
): Promise<AttachmentContentRef> {
  const stored = await invoke<AttachmentContentRef>(
    "attachment_store_put",
    bytes,
  );
  if (
    !/^[a-f0-9]{64}$/.test(stored.id) ||
    stored.contentHash !== stored.id ||
    stored.byteSize !== bytes.byteLength
  ) {
    throw new Error("Clack attachment storage returned invalid metadata.");
  }
  return stored;
}

export async function loadAttachmentContent(id: string): Promise<Uint8Array> {
  if (!/^[a-f0-9]{64}$/.test(id)) {
    throw new AttachmentContentError(
      "attachment_content_invalid",
      "Attachment content ID is invalid.",
    );
  }
  try {
    const response = await invoke<ArrayBuffer>("attachment_store_get", { id });
    return new Uint8Array(response);
  } catch (error) {
    throw attachmentContentError(error);
  }
}

export async function inspectAttachmentContent(
  id: string,
): Promise<AttachmentContentRef> {
  if (!/^[a-f0-9]{64}$/.test(id)) {
    throw new AttachmentContentError(
      "attachment_content_invalid",
      "Attachment content ID is invalid.",
    );
  }
  try {
    return await invoke<AttachmentContentRef>("attachment_store_inspect", {
      id,
    });
  } catch (error) {
    throw attachmentContentError(error);
  }
}

export async function reconcileAttachmentContent(
  retainIds: readonly string[],
): Promise<AttachmentReconcileResult> {
  const retained = new Set(retainIds);
  for (const id of contentLeases.keys()) retained.add(id);
  return invoke<AttachmentReconcileResult>(
    "attachment_store_reconcile",
    { retainIds: [...retained] },
  );
}

function attachmentContentError(error: unknown): AttachmentContentError {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  const code: AttachmentContentIssueCode = lower.includes("integrity validation")
    ? "attachment_content_integrity_failed"
    : lower.includes("unavailable") || lower.includes("not found")
      ? "attachment_content_missing"
      : "attachment_content_invalid";
  return new AttachmentContentError(code, message);
}

export function retainAttachmentContent(id: string): void {
  contentLeases.set(id, (contentLeases.get(id) ?? 0) + 1);
}

export function releaseAttachmentContent(id: string): void {
  const count = contentLeases.get(id) ?? 0;
  if (count <= 1) contentLeases.delete(id);
  else contentLeases.set(id, count - 1);
}

export function attachmentBytesToDataUrl(
  bytes: Uint8Array,
  mediaType: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not load attachment content."));
    reader.readAsDataURL(
      new Blob([Uint8Array.from(bytes).buffer], { type: mediaType }),
    );
  });
}
