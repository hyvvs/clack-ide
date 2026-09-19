import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { compile } from "@tailwindcss/node";
import { describe, expect, it } from "vitest";

describe("Tailwind source boundaries", () => {
  it("scans Clack UI and Streamdown, not the whole workspace", async () => {
    const file = join(process.cwd(), "src", "styles", "globals.css");
    const compiler = await compile(readFileSync(file, "utf8"), {
      base: dirname(file),
      onDependency: () => {},
    });
    expect(compiler.root).not.toBeNull();
    expect(compiler.root).not.toBe("none");
    if (!compiler.root || compiler.root === "none") return;
    expect(resolve(compiler.root.base, compiler.root.pattern)).toBe(
      join(process.cwd(), "src"),
    );
    expect(compiler.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pattern: "../../node_modules/streamdown/dist/index.js",
        }),
      ]),
    );
    const css = compiler.build(["flex", "hidden", "bg-background"]);
    expect(css).toContain("display: flex");
    expect(css).toContain("display: none");
    expect(css).toContain("background-color: var(--background)");
  });
});
