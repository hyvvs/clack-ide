import { describe, expect, it } from "vitest";
import { flushR5bReceipts } from "@/test/r5cReceiptFlush";

describe("R5c receipt flush is independent of SDK completion", () => {
  it("surfaces success, failed persistence, and hanging persistence distinctly", async () => {
    expect(await flushR5bReceipts(Promise.resolve())).toBe("flushed");
    expect(await flushR5bReceipts(Promise.reject(new Error("local sink unavailable")))).toBe("failed");
    const pending = new Promise<void>(() => {});
    expect(await flushR5bReceipts(pending, 10)).toBe("timed-out");
  });
  it("allows the final report after a bounded stalled incremental write", async () => {
    const pending = new Promise<void>(() => {});
    const reports: string[] = [];
    const flushStatus = await flushR5bReceipts(pending, 10);
    reports.push(flushStatus);
    expect(reports).toEqual(["timed-out"]);
  });
});
