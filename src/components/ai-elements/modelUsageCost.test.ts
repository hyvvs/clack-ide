import { getModels } from "@tokenlens/models";
import { getUsage } from "tokenlens";
import { describe, expect, it } from "vitest";
import pricing from "./modelUsagePricing.generated.json";
import { modelUsageCostUSD } from "./modelUsageCost";

const cases = [
  { input: 42_001, output: 731 },
  { input: 0, output: 29_999 },
  { reasoningTokens: 5_203 },
  { input: 0, output: 0, cacheReads: 3_005 },
  { input: 2_341, output: 12_345, cacheReads: 151, cacheWrites: 47, reasoningTokens: 27 },
];

describe("lossless cost-only Tokenlens projection in the context UI", () => {
  it("retains the complete installed catalog, including unpriced shadowing entries", () => {
    const expected: Record<string, number[] | null> = {};
    for (const provider of Object.values(getModels())) {
      for (const [key, value] of Object.entries(provider.models ?? {})) {
        if (Object.prototype.hasOwnProperty.call(expected, key)) continue;
        const cost = value.cost;
        const fields = ["input", "output", "reasoning", "cache_read", "cache_write"] as const;
        expected[key] = cost && fields.some((field) => typeof cost[field] === "number")
          ? fields.map((field) => typeof cost[field] === "number" ? cost[field] : null) as number[]
          : null;
      }
    }
    expect(pricing).toEqual(expected);
  });

  it("matches original Tokenlens USD totals for every model and all five rendered usage shapes", () => {
    const unique = new Set<string>();
    for (const [provider, entry] of Object.entries(getModels())) {
      for (const name of Object.keys(entry.models ?? {})) {
        unique.add(name);
        unique.add(`${provider}:${name}`);
        unique.add(`${provider}/${name}`);
      }
    }
    for (const modelId of [
      ...unique, "UNKNOWN-LOCAL-FOO", "gpt-5-nano", " OPENAI/GPT-5-NANO ",
      "anthropic/claude-3.5-sonnet", "openai:gpt-5.4", "__proto__", "constructor",
    ]) {
      for (const usage of cases) {
        const original = getUsage({ modelId, usage }).costUSD?.totalUSD;
        const projected = modelUsageCostUSD(modelId, usage);
        if (!Object.is(projected, original)) {
          throw new Error(`${modelId}: expected Tokenlens ${original}, projected ${projected}, usage ${JSON.stringify(usage)}`);
        }
      }
    }
  });
});
