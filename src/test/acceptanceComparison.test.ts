import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("controlled local-model comparison setup", () => {
  it("preserves the exact original ForgeBoard mission and correction", () => {
    const source = readFileSync("src/test/realLocalProductAcceptance.tsx", "utf8").replace(/\r\n/g, "\n");
    const mission = source.match(/const mission = `([\s\S]*?)`;/)?.[1];
    expect(mission).toBeDefined();
    expect(createHash("sha256").update(mission ?? "").digest("hex")).toBe("f97ec34eefa136ac5be5847187f768b64bf5587d36140d9fcc53b695fa3e4801");
    expect(source).toContain("Change the task page size requirement from 50 to 25. The new value supersedes 50 everywhere. Continue the same project and do not restart from scratch.");
    expect(source).toContain("const result = streamText({");
  });
  it("limits setup to the two authorized models without changing context/output/deadlines", () => {
    const runner = readFileSync("scripts/check-real-local-product.mjs", "utf8");
    const host = readFileSync("src-tauri/examples/coworking_acceptance.rs", "utf8");
    expect(runner).toContain('["qwen38-uncensored:latest", "qwen3-coder:30b", "devstral-small-2:24b"].includes(modelId)');
    expect(host).toContain('assert_eq!(body["model"], model)');
    expect(host).toContain('assert_eq!(body["options"]["num_ctx"], 32768)');
    expect(host).toContain('phase.starts_with("system-preflight-")');
    expect(runner).toContain("CLACK_ACCEPTANCE_OLLAMA_URL");
  });
  it("authorizes the exact Muse tag only in acceptance fixtures and validates supported effort", () => {
    for (const file of ["scripts/check-real-local-product.mjs", "src-tauri/examples/coworking_acceptance.rs", "src/test/realLocalProductAcceptance.tsx"]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain('"muse-glimmer:30b"');
      expect(source).not.toContain('"muse-glimmer:latest"');
    }
    const fixture = readFileSync("src/test/realLocalProductAcceptance.tsx", "utf8");
    expect(fixture).toContain("await setSessionEffort(id, config.realProduct.reasoningChoice)");
  });
});
