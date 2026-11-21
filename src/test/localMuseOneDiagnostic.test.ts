import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ONE_MUSE_CLACK_CAPTURE_LIMIT } from "@/modules/ai/lib/localDeliveryObserver";
import { oneMuseOnce } from "./localMuseOneDiagnostic";

describe("isolated one-Muse browser dispatch", () => {
  it("uses the high-volume capture budget only on the isolated diagnostic path", () => {
    const source = readFileSync(new URL("./localMuseOneDiagnostic.tsx", import.meta.url), "utf8");
    expect(source).toContain(
      "installLocalDeliveryCapture(persist, ONE_MUSE_CLACK_CAPTURE_LIMIT, state.runId)",
    );
    expect(ONE_MUSE_CLACK_CAPTURE_LIMIT).toBe(48_000);
  });

  it("does not invoke inference when constructing the one-shot function", async () => {
    let calls = 0;
    const run = oneMuseOnce(async () => { calls++; return "provider-response"; });
    expect(calls).toBe(0);
    expect(await run()).toBe("provider-response");
    await expect(run()).rejects.toThrow("already consumed");
    expect(calls).toBe(1);
  });

  it("consumes the allowance synchronously before asynchronous completion", async () => {
    let resolve!: (value: string) => void;
    const pending = new Promise<string>(r => { resolve = r; });
    let calls = 0;
    const run = oneMuseOnce(() => { calls++; return pending; });
    const first = run();
    await expect(run()).rejects.toThrow("already consumed");
    expect(calls).toBe(1);
    resolve("ok");
    expect(await first).toBe("ok");
  });

  it("never rearms an invocation after the first action fails", async () => {
    let calls = 0;
    const run = oneMuseOnce(async () => { calls++; throw new Error("offline failure"); });
    await expect(run()).rejects.toThrow("offline failure");
    await expect(run()).rejects.toThrow("already consumed");
    expect(calls).toBe(1);
  });
});
