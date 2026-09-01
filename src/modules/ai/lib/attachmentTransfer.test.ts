import { describe, expect, it } from "vitest";
import {
  transferContainsFiles,
  transferContainsImage,
} from "./attachmentTransfer";

describe("attachment transfer detection", () => {
  it("recognizes file drag payloads without matching unrelated data", () => {
    expect(transferContainsFiles(["text/plain", "Files"])).toBe(true);
    expect(transferContainsFiles(["text/plain"])).toBe(false);
  });

  it("recognizes clipboard images without intercepting normal text paste", () => {
    expect(transferContainsImage([{ type: "image/png" }])).toBe(true);
    expect(transferContainsImage([{ type: "text/plain" }])).toBe(false);
    expect(transferContainsImage([])).toBe(false);
  });
});
