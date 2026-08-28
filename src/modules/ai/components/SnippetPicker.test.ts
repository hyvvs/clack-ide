import { describe, expect, it } from "vitest";
import { pickerTypeLabel } from "./SnippetPicker";

describe("snippet picker labels", () => {
  it("distinguishes commands from inserted snippets", () => {
    expect(pickerTypeLabel("command")).toBe("Command");
    expect(pickerTypeLabel("snippet")).toBe("Snippet");
  });
});
