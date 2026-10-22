/** Browser-safe, bounded acceptance reporting; no influence on inference dispatch. */
export async function flushR5bReceipts(
  work: Promise<unknown>,
  timeoutMs = 2_000,
): Promise<"flushed" | "failed" | "timed-out"> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000)
    throw new Error("Invalid receipt flush bound");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(work).then(() => "flushed" as const, () => "failed" as const),
      new Promise<"timed-out">(resolve => {
        timer = setTimeout(() => resolve("timed-out"), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
