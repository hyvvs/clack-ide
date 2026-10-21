import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const entry = readFileSync("src/test/hardenedLocalAgentAcceptance.tsx", "utf8");
const driver = readFileSync("scripts/check-hardened-local-agent.mjs", "utf8");
const native = readFileSync("src-tauri/examples/hardened_agent_acceptance.rs", "utf8");
describe("hardened-runtime acceptance ownership", () => {
  it("uses production context and tool readiness without manual overrides", () => {
    expect(entry).toContain("await ensureSelectedContext(state, selfHostedSelectionId(initial), signal)");
    expect(entry).toContain("await ensureSelectedTools(state, selfHostedSelectionId(initial), signal)");
    expect(entry).not.toContain("setProfileOverride");
    expect(entry).not.toContain("49152");
    expect(entry).not.toContain("think: false");
    expect(entry).not.toContain('"none"');
  });
  it("keeps the mission and syntax-aware correction in the existing fixture", () => {
    expect(entry).toContain("await runRealLocalProduct(config)");
    expect(driver).toContain("createCorrectionObserver");
    expect(driver).toContain("evaluateAcceptanceApproval");
    expect(driver).toContain('assert.equal(singleSpec, false');
  });
  it("checks exact revision and Verified readiness before the single mission", () => {
    expect(entry.indexOf("initial.modelRevision !== digest")).toBeLessThan(entry.indexOf("await ensureSelectedContext"));
    expect(entry.indexOf('view?.tools !== "Verified"')).toBeLessThan(entry.indexOf("await runRealLocalProduct"));
    expect(entry.match(/await runRealLocalProduct\(config\)/g)).toHaveLength(1);
    expect(driver).toContain('assert.equal(phase, "mission-a"');
  });
  it("retains native provider controls and the production request deadline", () => {
    expect(native).toContain("net::inference::ai_http_stream");
    expect(native).toContain("inference_probe::context::self_hosted_context_runtime");
    expect(native).toContain("inference_probe::context::self_hosted_context_lease");
    expect(native).not.toContain('assert_eq!(body["options"]["num_ctx"], 32768)');
    expect(native).not.toContain("REQUEST_TIMEOUT");
    expect(native).toContain('"nemotron-3.5-lightning:30b-a3b-q4_K_M"');
    expect(native).toContain('assert_eq!(body["model"], model)');
  });
  it("separates pre-mission requests from mission budget reconstruction", () => {
    expect(driver).toContain("request.at >= (result.readiness?.readyAt ?? Infinity)");
    expect(entry).toContain('kind: "mission-readiness"');
    expect(entry).toContain('kind: "hardened-native-event"');
    expect(entry).toContain('kind: "tool-state"');
  });
  it("carries the prechecked exact model revision without prescribing reasoning", () => {
    expect(driver).toContain('process.env.CLACK_PRODUCT_DIGEST');
    expect(driver).toContain('modelId, modelDigest');
    expect(entry).toContain('config.realProduct.modelDigest');
    expect(entry).toContain('config.realProduct.modelId');
    expect(entry).toContain('initial.modelRevision !== digest');
    expect(driver).toContain('const reasoningChoice = "automatic"');
  });
  it("readiness-only verification cannot dispatch the product specification", () => {
    expect(driver).toContain('process.env.CLACK_PRODUCT_READINESS_ONLY === "1"');
    expect(entry).toContain('if (config.realProduct.readinessOnly)');
    expect(entry.indexOf('if (config.realProduct.readinessOnly)')).toBeLessThan(entry.indexOf('await runRealLocalProduct(config)'));
    expect(entry).toContain('sessions: [], conversations: []');
  });
});
