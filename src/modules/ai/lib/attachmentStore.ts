import { invoke } from "@tauri-apps/api/core";

const contentLeases = new Map<string, number>();

export type AttachmentContentRef = {
  id: string;
  contentHash: string;
  byteSize: number;
};

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
    throw new Error("Attachment content ID is invalid.");
  }
  const response = await invoke<ArrayBuffer>("attachment_store_get", { id });
  return new Uint8Array(response);
}

export async function reconcileAttachmentContent(
  retainIds: readonly string[],
): Promise<number> {
  const retained = new Set(retainIds);
  for (const id of contentLeases.keys()) retained.add(id);
  const result = await invoke<{ removedCount: number }>(
    "attachment_store_reconcile",
    { retainIds: [...retained] },
  );
  return result.removedCount;
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
