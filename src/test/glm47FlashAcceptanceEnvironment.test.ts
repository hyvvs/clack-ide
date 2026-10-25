import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("GLM-4.7-Flash exclusive acceptance identity and environment", () => {
  it("binds the new runner and real production calibration to only this live digest", () => {
    const runner = read("scripts/r5av-smoke-agent.mjs");
    const calibration = read("src/test/r5avSmokeCalibrationAgent.tsx");
    const acceptance = read("src/test/r5avSmokeAgentAcceptance.tsx");
    const host = read("src-tauri/examples/r5av_acceptance.rs");
    for (const file of [runner, calibration, acceptance, host])
      expect(file).toContain("glm-4.7-flash:q4_K_M");
    expect(calibration).toContain("4475827791a269b02c8ec49b1c3bc1abb5846bacf3fae015b75d33986322d8f6");
    expect(runner).toContain("glm47flash-r5av-qualification-20261025-01");
    expect(runner).toContain("glm47flash-r5av-notes-20261025-01");
    expect(runner).toContain('assert(maxOutput === undefined, "Original Agent output limits cannot be overridden")');
    expect(runner).toContain("resolveAgentOutputBudget");
  });

  it("isolates WebView2 rendering only for the dedicated acceptance child", () => {
    const runner = read("scripts/r5av-smoke-agent.mjs");
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
    const glm = extract(read("src/test/r5avSmokeAgentAcceptance.tsx"));
    expect(original).toBeTruthy();
    expect(glm).toBe(original);
    expect(read("scripts/r5ap-independent-notes.mjs")).toContain("persistenceAcrossRestart");
  });
});
