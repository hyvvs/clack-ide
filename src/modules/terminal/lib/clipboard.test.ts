import { describe, expect, it, vi } from "vitest";
import { copyTerminalSelection, pasteTerminalClipboard } from "./clipboard";

describe("terminal clipboard", () => {
  it("waits for selection updates and preserves multiline output", async () => {
    const order: string[] = [];
    const selection = "line 1\nline 2\nline 200";
    const write = vi.fn(async (text: string) => {
      order.push("write");
      expect(text).toBe(selection);
      return true;
    });

    await expect(
      copyTerminalSelection(
        () => {
          order.push("read");
          return selection;
        },
        write,
        async () => {
          order.push("wait");
        },
      ),
    ).resolves.toBe(true);

    expect(order).toEqual(["wait", "read", "write"]);
  });

  it("does not write when the pane has no selection", async () => {
    const write = vi.fn(async () => true);
    await expect(
      copyTerminalSelection(
        () => "",
        write,
        async () => {},
      ),
    ).resolves.toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it("pastes native clipboard text without changing newlines", async () => {
    const paste = vi.fn();
    await expect(
      pasteTerminalClipboard(paste, async () => "one\r\ntwo"),
    ).resolves.toBe(true);
    expect(paste).toHaveBeenCalledWith("one\r\ntwo");
  });
});
