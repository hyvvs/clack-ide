export type ReadSnapshot = { size: number; hash: number };

export function hashText(content: string): number {
  let hash = 5381;
  for (let index = 0; index < content.length; index += 1) {
    hash = ((hash << 5) + hash + content.charCodeAt(index)) | 0;
  }
  return hash >>> 0;
}

export function isMissingPathError(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return (
    message.includes("no such file") ||
    message.includes("os error 2") ||
    message.includes("not found")
  );
}

export function validateReadSnapshot(
  content: string,
  snapshot: ReadSnapshot | undefined,
): { ok: true } | { ok: false; code: string; error: string } {
  if (!snapshot) {
    return {
      ok: false,
      code: "read_required_before_write",
      error: "must call read_file on this path before modifying an existing file.",
    };
  }
  if (snapshot.hash !== hashText(content)) {
    return {
      ok: false,
      code: "stale_file_snapshot",
      error:
        "the file changed after this chat read it. Read the latest content, review the other changes, and retry without overwriting them.",
    };
  }
  return { ok: true };
}
