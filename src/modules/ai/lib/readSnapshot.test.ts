import { describe, expect, it } from "vitest";
import { hashText, validateReadSnapshot } from "./readSnapshot";

describe("read snapshots", () => {
  it("accepts content that still matches the session read", () => {
    const content = "const value = 1;\n";
    expect(
      validateReadSnapshot(content, {
        size: content.length,
        hash: hashText(content),
      }),
    ).toEqual({ ok: true });
  });

  it("requires a read before overwriting an existing file", () => {
    expect(validateReadSnapshot("existing", undefined)).toMatchObject({
      ok: false,
      code: "read_required_before_write",
    });
  });

  it("rejects content changed after the session read", () => {
    expect(
      validateReadSnapshot("changed by another run", {
        size: 8,
        hash: hashText("original"),
      }),
    ).toMatchObject({
      ok: false,
      code: "stale_file_snapshot",
    });
  });
});
