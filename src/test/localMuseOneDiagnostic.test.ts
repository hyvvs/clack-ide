import { describe, expect, it } from "vitest";
import { oneMuseOnce } from "./localMuseOneDiagnostic";

describe("isolated one-Muse browser dispatch", () => {
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
