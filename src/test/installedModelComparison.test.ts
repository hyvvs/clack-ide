import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const candidates = [
  "devstral-small-2:24b",
  "hf.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:Q4_K_M",
  "hf.co/HauhauCS/Gemma4-26B-A4B-QAT-Uncensored-HauhauCS-Balanced-MTP:Q4_K_M",
  "hf.co/HauhauCS/Qwen3.6-27B-Uncensored-HauhauCS-Aggressive:IQ3_M",
];
describe("installed-model acceptance bounds", () => {
  it.each(candidates)("allows the exact installed model in every harness boundary: %s", (model) => {
    for (const file of ["scripts/check-real-local-product.mjs", "src/test/realLocalProductAcceptance.tsx", "src-tauri/examples/coworking_acceptance.rs"])
      expect(readFileSync(file, "utf8")).toContain(`"${model}"`);
  });
  it("records unsupported reasoning explicitly and validates omission on the wire", () => {
    const ui = readFileSync("src/test/realLocalProductAcceptance.tsx", "utf8");
    const runner = readFileSync("scripts/check-real-local-product.mjs", "utf8");
    expect(ui).toContain('captured.capability.status === "unsupported"');
    expect(ui).toContain('effective: "unsupported-no-control"');
    expect(runner).toContain('assert(!Object.hasOwn(body, "think")');
    expect(runner).toContain("else assert.equal(body.think, false)");
    expect(runner).toContain('assert.equal(requests.length, 1, "Tool protocol probe must send exactly one inference")');
    expect(ui).toContain("toolExecutionCount: 0");
  });
});
