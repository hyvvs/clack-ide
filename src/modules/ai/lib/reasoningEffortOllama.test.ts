import { afterEach, describe, expect, it, vi } from "vitest";
import { hostedEffortFixture, ollamaEffortFixture } from "@/modules/ai/lib/reasoningEffort.fixture";
import { captureEffort, effortCapability, effortLabel, effortProviderOptions, sameEffortContract } from "@/modules/ai/lib/reasoningEffort";

function capture(values: unknown, model?: string) {
  const fixture = ollamaEffortFixture(values, model);
  return captureEffort("selection", fixture.identity, undefined, fixture.state);
}

afterEach(() => vi.restoreAllMocks());

describe("Ollama metadata-driven reasoning controls", () => {
  it("uses auto-detected native provider controls and rejects evidence from an older digest", () => {
    const fixture = ollamaEffortFixture([false, true, "medium"]);
    fixture.endpoint.backendHint = undefined;
    fixture.endpoint.detectedBackend = "ollama";
    const captured = captureEffort("selection", fixture.identity, undefined, fixture.state);
    expect(captured.capability.status).toBe("supported");
    expect(effortProviderOptions(captured)).toEqual({});
    expect(effortProviderOptions({ ...captured, choice: "none" })).toEqual({ ollama: { think: false } });
    fixture.state.profiles[0].modelRevision = "new-revision";
    expect(effortCapability(fixture.identity, fixture.state).status).toBe("unknown");
    fixture.profile.evidence = fixture.profile.evidence.map(e => ({ ...e, scope: { ...e.scope, modelRevision: "new-revision" } }));
    const revalidated = effortCapability(fixture.identity, fixture.state);
    expect(revalidated.status).toBe("supported");
    expect(revalidated.revision).not.toBe(captured.capability.revision);
  });
  it("normalizes captured Muse controls without discarding None or named effort", () => {
    const fixture = ollamaEffortFixture();
    const capability = effortCapability(fixture.identity, fixture.state);
    expect(capability.status).toBe("supported");
    expect(capability.levels).toEqual(["none", "low", "medium", "high", "max"]);
    const captured = captureEffort("selection", fixture.identity, undefined, fixture.state);
    expect(effortProviderOptions({ ...captured, choice: "none" })).toEqual({ ollama: { think: false } });
    expect(effortProviderOptions({ ...captured, choice: "low" })).toEqual({ ollama: { think: "low" } });
    expect(capability.mapping).toBe("ollama-mixed");
    expect(capability.ollamaControls).toEqual({ none: false, low: "low", medium: "medium", high: "high", max: "max" });
    expect(capability.levels.map(effortLabel)).toEqual(["None", "Low", "Medium", "High", "Maximum"]);
  });
  it.each([
    { values: ["low", "medium", "high"], levels: ["low", "medium", "high"], wire: ["low", "medium", "high"] },
    { values: [false], levels: ["none"], wire: [false] },
    { values: [true], levels: ["on"], wire: [true] },
    { values: [true, false], levels: ["none", "on"], wire: [false, true] },
    { values: [false, "low", "future_level"], levels: ["none", "low"], wire: [false, "low"] },
    { values: ["high", false, "low", "high"], levels: ["none", "low", "high"], wire: [false, "low", "high"] },
    { values: ["max", true, "high", false, "medium", "low"], levels: ["none", "on", "low", "medium", "high", "max"], wire: [false, true, "low", "medium", "high", "max"] },
    { values: [false, false, "none", true, "on", true, "low"], levels: ["none", "on", "low"], wire: [false, true, "low"] },
    { values: ["none", "on"], levels: ["none", "on"], wire: ["none", "on"] },
    { values: [true, "none"], levels: ["none", "on"], wire: ["none", true] },
    { values: [false, "on"], levels: ["none", "on"], wire: [false, "on"] },
    { values: ["xhigh", "minimal", "max"], levels: ["minimal", "xhigh", "max"], wire: ["minimal", "xhigh", "max"] },
  ])("preserves independent control semantics: $values", ({ values, levels, wire }) => {
    const result = capture(values);
    expect(result.capability.status).toBe("supported");
    expect(result.capability.levels).toEqual(levels);
    expect(effortProviderOptions(result)).toEqual({});
    levels.forEach((choice, index) => {
      expect(effortProviderOptions({ ...result, choice })).toEqual({ ollama: { think: wire[index] } });
    });
  });
  it("keeps ordering, duplicate entries and unknown future names out of the effective revision", () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.now());
    const original = { ...capture([false, "low", "high"]), choice: "low" };
    for (const values of [["high", "low", false, "high"], [false, "low", "future_level", "high"], [false, "low", "LOW", " low ", "high"]]) {
      const next = capture(values);
      expect(next.capability).toEqual(original.capability);
      expect(sameEffortContract(original, next.capability)).toBe(true);
    }
    expect(capture([false, "future_level"]).capability).toEqual(capture([false]).capability);
  });
  it("does not borrow Muse support from the model name", () => {
    expect(capture([false, "low"], "future-coder:unrelated").capability.levels).toEqual(["none", "low"]);
    expect(capture(["future_level"]).capability.status).toBe("unknown");
  });
  it.each([
    null, true, 123, "low", {}, { values: [false, "low"] }, [],
    [[false], "low"], [{ level: "low" }], [false, 1], [false, null],
    [false, ""], [false, "low\n"], [false, "a".repeat(33)], Array(17).fill(false),
  ])("rejects malformed metadata instead of using a legacy boolean fallback: %j", values => {
    const result = capture(values);
    expect(result.capability.status).toBe("unknown");
    expect(result.capability.levels).toEqual([]);
    expect(effortProviderOptions(result)).toEqual({});
    expect(() => effortProviderOptions({ ...result, choice: "none" })).toThrow();
  });
  it("rejects invalid JSON and conflicting evidence records", () => {
    const fixture = ollamaEffortFixture();
    const controls = fixture.profile.evidence.find(e => e.metric === "probe.thinkingControls");
    if (!controls) throw new Error("Missing fixture controls");
    controls.value = "not-json";
    expect(effortCapability(fixture.identity, fixture.state).status).toBe("unknown");
    controls.value = JSON.stringify([false, "low"]);
    fixture.profile.evidence.push(structuredClone(controls));
    expect(effortCapability(fixture.identity, fixture.state).status).toBe("unknown");
  });
  it("preserves expiry, revision scope and exact wire-contract validation", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const original = { ...capture([false, "low"]), choice: "none" };
    const differentWire = capture(["none", true, "low"]);
    expect(sameEffortContract(original, differentWire.capability)).toBe(false);
    const tampered = { ...original.capability, ollamaControls: { none: "high", low: "low" } };
    expect(() => effortProviderOptions({ ...original, capability: tampered })).toThrow(/native reasoning/);
    expect(sameEffortContract(original, tampered)).toBe(false);
    expect(() => effortProviderOptions({ ...original, capability: { ...original.capability, ollamaControls: undefined } })).toThrow();
    vi.mocked(Date.now).mockReturnValue(now + 30_000);
    expect(() => effortProviderOptions(original)).toThrow(/expired/);
    const fixture = ollamaEffortFixture();
    if (!fixture.identity.selfHosted) throw new Error("Missing fixture route");
    fixture.identity.selfHosted = { ...fixture.identity.selfHosted, configurationRevision: 2 };
    expect(effortCapability(fixture.identity, fixture.state).status).toBe("unknown");
  });
  it("retains the existing legacy boolean declaration format", () => {
    const fixture = ollamaEffortFixture();
    fixture.profile.evidence = fixture.profile.evidence.filter(e => e.metric !== "probe.thinkingControls");
    expect(effortCapability(fixture.identity, fixture.state)).toMatchObject({ status: "supported", levels: ["none", "on"], mapping: "ollama-boolean" });
    fixture.profile.evidence[0].value = false;
    expect(effortCapability(fixture.identity, fixture.state)).toMatchObject({ status: "unsupported", levels: [] });
  });
  it("does not broaden compatible-server contracts or change named cloud contracts", () => {
    const fixture = hostedEffortFixture();
    fixture.evidence.value = JSON.stringify({ status: "supported", wire: "reasoning_effort", accounting: "shared-output", levels: ["low", "future_level"] });
    expect(effortCapability(fixture.identity, fixture.state).status).toBe("unknown");
    expect(effortCapability({ providerId: "openai", transportModelId: "gpt-5.4-mini" })).toMatchObject({ mapping: "responses", levels: ["none", "low", "medium", "high", "xhigh"] });
    expect(effortCapability({ providerId: "anthropic", transportModelId: "claude-opus-4-7" }).levels).toContain("max");
  });
});
