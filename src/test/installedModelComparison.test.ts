import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const candidates = [
  "nemotron-3.5-lightning:30b-a3b-q4_K_M",
  "north-mini-code-1.0:q4_K_M",
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
    expect(runner).toContain('else assert.equal(body.think, reasoningChoice === "low" ? "low" : false)');
    expect(runner).toContain('assert.equal(requests.length, 1, "Tool protocol probe must send exactly one inference")');
    expect(ui).toContain("toolExecutionCount: 0");
  });
  it("accepts explicit Low only through normal validation and preserves native failure reports", () => {
    const runner = readFileSync("scripts/check-real-local-product.mjs", "utf8");
    const host = readFileSync("src-tauri/examples/coworking_acceptance.rs", "utf8");
    expect(runner).toContain('["automatic", "none", "low"].includes(reasoningChoice)');
    expect(runner).toContain('env.CLACK_ACCEPTANCE_EXPECTED_THINK = "low"');
    expect(host).toContain('body["think"] != "low"');
    expect(host).toContain('body["options"]["num_predict"] != 2048');
    expect(runner.indexOf('.native-report.json')).toBeLessThan(runner.indexOf('assert.equal(requests.length, 1, "Tool protocol probe'));
  });
  it("can fail closed before dispatch if explicit None serializes anything except false", () => {
    const runner = readFileSync("scripts/check-real-local-product.mjs", "utf8");
    const host = readFileSync("src-tauri/examples/coworking_acceptance.rs", "utf8");
    expect(runner).toContain('process.env.CLACK_PRODUCT_EXPECT_NO_THINK === "1"');
    expect(runner).toContain('assert.equal(reasoningChoice, "none"');
    expect(runner).toContain('env.CLACK_ACCEPTANCE_EXPECTED_THINK = "false"');
    expect(host).toContain('think == "false" && body["think"] != false');
  });
  it("preserves provider-default Automatic without serializing a reasoning override", () => {
    const runner = readFileSync("scripts/check-real-local-product.mjs", "utf8");
    const host = readFileSync("src-tauri/examples/coworking_acceptance.rs", "utf8");
    expect(runner).toContain('process.env.CLACK_PRODUCT_EXPECT_AUTOMATIC === "1"');
    expect(runner).toContain('assert.equal(reasoningChoice, "automatic"');
    expect(runner).toContain('env.CLACK_ACCEPTANCE_EXPECTED_THINK = "omitted"');
    expect(runner).toContain('else if (reasoningChoice === "automatic")');
    expect(runner).toContain('"Automatic must preserve the provider default"');
    expect(host).toContain('think == "omitted" && body.get("think").is_some()');
  });
  it("records normal normalized capability during metadata-only preparation without inference", () => {
    const ui = readFileSync("src/test/realLocalProductAcceptance.tsx", "utf8");
    expect(ui).toContain('phase === "preflight" && config.realProduct.prepareOnly');
    expect(ui).toContain('requested: "discovery-only", effective: captured.choice, capability: captured.capability');
    expect(ui).toContain('const captured = sessionEffort(session)');
  });
});
