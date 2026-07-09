import { describe, expect, it } from "vitest";
import { fallbackTerminalCwd } from "./useSpacesBoot";

describe("fallbackTerminalCwd", () => {
  it("prefers the saved workspace root over launch cwd and home", () => {
    expect(
      fallbackTerminalCwd(
        "C:/Users/Hayden/Orison",
        "C:/Users/Hayden/clack",
        "C:/Users/Hayden",
      ),
    ).toBe("C:/Users/Hayden/Orison");
  });

  it("falls back when a space has no workspace root", () => {
    expect(
      fallbackTerminalCwd(null, "C:/Users/Hayden/clack", "C:/Users/Hayden"),
    ).toBe("C:/Users/Hayden/clack");
    expect(fallbackTerminalCwd(null, null, "C:/Users/Hayden")).toBe(
      "C:/Users/Hayden",
    );
  });
});
