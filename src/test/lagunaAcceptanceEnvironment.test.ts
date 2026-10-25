import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("Laguna acceptance-host WebView2 crash isolation", () => {
  it("gives only the dedicated test child software-rendering flags before spawn", () => {
    const runner = readSource("scripts/r5at-smoke-agent.mjs");
    const position = runner.indexOf("env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS =");
    expect(position).toBeGreaterThan(0);
    expect(runner.slice(position, position + 125)).toContain("--disable-gpu --disable-gpu-compositing");
    expect(runner.indexOf("child = spawn(")).toBeGreaterThan(position);
    expect(runner).toContain("laguna-r5at-qualification-20261025-02");
    expect(runner).toContain("laguna-r5at-notes-20261025-02");
    expect(runner).not.toContain("laguna-r5at-qualification-20261025-01");
    expect(runner).not.toMatch(/process\.env\.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS\s*=/);
    expect(runner).not.toMatch(/CLACK_PRODUCT_MAX_OUTPUT\s*=\s*['"](?:4096|8192)/);
    expect(runner).toContain('assert(maxOutput === undefined, "Original Agent output limits cannot be overridden")');
  });

  it("does not modify the actual production fetch/channel/SDK or other candidate harnesses", () => {
    for (const path of [
      "src/modules/ai/lib/proxyFetch.ts",
      "src/modules/ai/lib/ollamaModel.ts",
      "src/modules/ai/lib/contextCalibrationRuntime.ts",
      "scripts/r5as-smoke-agent.mjs",
    ]) expect(readSource(path)).not.toContain("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS");
  });
});
