import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("Qwen3.6 exclusive acceptance identity and environment", () => {
  it("binds the new runner and real production calibration to only this live digest", () => {
    const runner = read("scripts/r5au-smoke-agent.mjs");
    const calibration = read("src/test/r5auSmokeCalibrationAgent.tsx");
    const acceptance = read("src/test/r5auSmokeAgentAcceptance.tsx");
    const host = read("src-tauri/examples/r5au_acceptance.rs");
    for (const file of [runner, calibration, acceptance, host])
      expect(file).toContain("qwen3.6:27b-coding");
    expect(calibration).toContain("8bdf0bc645c4de0a5025639b1e9a4ccc7fbcbb306a5ff04bc766e39d1db50d4d");
    expect(runner).toContain("qwen36-r5au-qualification-20261025-01");
    expect(runner).toContain("qwen36-r5au-notes-20261025-01");
    expect(runner).toContain('assert(maxOutput === undefined, "Original Agent output limits cannot be overridden")');
    expect(runner).toContain("resolveAgentOutputBudget");
  });

  it("isolates WebView2 rendering only for the dedicated acceptance child", () => {
    const runner = read("scripts/r5au-smoke-agent.mjs");
    const argument = runner.indexOf("env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS =");
    expect(argument).toBeGreaterThan(0);
    expect(runner.slice(argument, argument + 120)).toContain("--disable-gpu --disable-gpu-compositing");
    expect(runner.indexOf("child = spawn(")).toBeGreaterThan(argument);
    expect(runner).not.toContain("process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS =");
    for (const production of ["src/modules/ai/lib/proxyFetch.ts", "src/modules/ai/lib/ollamaModel.ts", "src/modules/ai/lib/contextCalibrationRuntime.ts"])
      expect(read(production)).not.toContain("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS");
  });

  it("keeps the complete original notes mission identical to the independent baseline", () => {
    const extract = (value: string) => /const mission = `([\s\S]*?)`;/u.exec(value)?.[1];
    const original = extract(read("src/test/r5apSmokeAgentAcceptance.tsx"));
    const qwen = extract(read("src/test/r5auSmokeAgentAcceptance.tsx"));
    expect(original).toBeTruthy();
    expect(qwen).toBe(original);
    expect(read("scripts/r5ap-independent-notes.mjs")).toContain("persistenceAcrossRestart");
  });
});
