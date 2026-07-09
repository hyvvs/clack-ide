import { describe, expect, it } from "vitest";
import { explorerPathContains, planExplorerReveal } from "./revealPath";

describe("explorer reveal planning", () => {
  it("accepts paths inside the current explorer root", () => {
    expect(
      explorerPathContains(
        "C:/Users/Hayden/Documents/Orison",
        "c:\\Users\\Hayden\\Documents\\Orison\\public\\cover.png",
      ),
    ).toBe(true);
  });

  it("builds ancestor directories that must be expanded", () => {
    expect(
      planExplorerReveal(
        "C:/Users/Hayden/Documents/Orison",
        "C:/Users/Hayden/Documents/Orison/public/images/cover.png",
      ),
    ).toEqual({
      ok: true,
      path: "C:/Users/Hayden/Documents/Orison/public/images/cover.png",
      ancestorDirs: [
        "C:/Users/Hayden/Documents/Orison/public",
        "C:/Users/Hayden/Documents/Orison/public/images",
      ],
    });
  });

  it("returns a clear error when no explorer root is open", () => {
    expect(planExplorerReveal(null, "C:/repo/cover.png")).toEqual({
      ok: false,
      message: "No folder is open in the file explorer.",
    });
  });

  it("returns a clear error for paths outside the current root", () => {
    expect(planExplorerReveal("C:/repo", "C:/other/cover.png")).toEqual({
      ok: false,
      message: "cover.png is outside the current file explorer root.",
    });
  });
});
