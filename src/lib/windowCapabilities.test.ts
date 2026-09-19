import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const capability = JSON.parse(
  readFileSync(
    join(process.cwd(), "src-tauri", "capabilities", "default.json"),
    "utf8",
  ),
) as { windows: string[]; permissions: string[] };

describe("native window lifecycle capabilities", () => {
  it("allows the main window to request close and destroy after shutdown", () => {
    expect(capability.windows).toContain("main");
    // main.tsx prevents close until agent shutdown finishes, then destroys.
    expect(capability.permissions).toEqual(
      expect.arrayContaining([
        "core:window:allow-close",
        "core:window:allow-destroy",
      ]),
    );
  });

  it("preserves minimize and restore without closing background work", () => {
    expect(capability.permissions).toEqual(
      expect.arrayContaining([
        "core:window:allow-minimize",
        "core:window:allow-toggle-maximize",
        "core:window:allow-show",
      ]),
    );
  });
});
