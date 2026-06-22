import { MOD_PROP } from "@/lib/platform";
import { describe, expect, it } from "vitest";

import { SHORTCUTS, type ShortcutId } from "./shortcuts";

const bindings = (id: ShortcutId) =>
  SHORTCUTS.find((shortcut) => shortcut.id === id)?.defaultBindings ?? [];

describe("terminal shortcut registry", () => {
  it.each([
    ["terminal.selectAll", "a"],
    ["terminal.copy", "c"],
    ["terminal.paste", "v"],
    ["terminal.search", "f"],
  ] as const)("maps %s to the safe Shift chord", (id, key) => {
    expect(bindings(id)).toContainEqual({
      [MOD_PROP]: true,
      shift: true,
      key,
    });
  });

  it("maps pane switching to Alt+Shift+arrows", () => {
    expect(bindings("pane.focusNext")).toContainEqual({
      alt: true,
      shift: true,
      key: "ArrowRight",
    });
    expect(bindings("pane.focusPrev")).toContainEqual({
      alt: true,
      shift: true,
      key: "ArrowLeft",
    });
  });

  it("does not register plain Ctrl+C, Ctrl+V, Ctrl+Z, Ctrl+R, or Ctrl+L", () => {
    const unsafe = new Set(["c", "v", "z", "r", "l"]);
    const terminalBindings = SHORTCUTS.filter(
      (shortcut) => shortcut.group === "Terminal",
    ).flatMap((shortcut) => shortcut.defaultBindings);

    expect(
      terminalBindings.some(
        (binding) =>
          binding.ctrl === true &&
          !binding.shift &&
          !binding.alt &&
          unsafe.has(binding.key.toLowerCase()),
      ),
    ).toBe(false);
  });
});
