// Cost-only, lossless projection of the lockfile-pinned Tokenlens catalog.
// Regenerate via: node scripts/generate-model-usage-pricing.mjs
// The context UI never uses Tokenlens's model metadata or context registry;
// shipping those provider records needlessly expands the production JS.
import modelPrices from "./modelUsagePricing.generated.json";

type Rates = readonly [number | null, number | null, number | null, number | null, number | null];
type CostUsage = {
  input?: number;
  output?: number;
  reasoningTokens?: number;
  cacheReads?: number;
  cacheWrites?: number;
};
const prices = modelPrices as unknown as Record<string, Rates | null>;

function lookupRates(modelId: string): Rates | null | undefined {
  const base = modelId.trim().toLowerCase();
  const candidates = [base];
  if (base.includes("/")) {
    const split = base.indexOf("/");
    const provider = base.slice(0, split);
    const rest = base.slice(split + 1);
    candidates.push(`${provider}:${rest}`);
    candidates.push(`${provider}:${rest.replace(/(\d)\.(\d)/g, "$1-$2")}`);
  }
  if (base.includes(":")) {
    const split = base.indexOf(":");
    const provider = base.slice(0, split);
    candidates.push(`${provider}:${base.slice(split + 1).replace(/(\d)\.(\d)/g, "$1-$2")}`);
  }
  if (!base.includes(":") && !base.includes("/"))
    candidates.push(base.replace(/(\d)\.(\d)/g, "$1-$2"));

  for (const key of candidates) {
    const split = key.indexOf(":");
    if (split > 0) {
      const suffix = key.slice(split + 1);
      // Tokenlens accepts the first provider's matching model key even when
      // supplied a different nonempty provider prefix. Mirror that behavior.
      if (suffix && Object.prototype.hasOwnProperty.call(prices, suffix)) return prices[suffix];
    }
    if (Object.prototype.hasOwnProperty.call(prices, key)) return prices[key];
  }
  return undefined;
}

/** Exactly Tokenlens getUsage({ modelId, usage }).costUSD?.totalUSD for
 * the input/output/reasoning/cache usage shapes rendered by Context. */
export function modelUsageCostUSD(modelId: string, usage: CostUsage): number | undefined {
  const rates = lookupRates(modelId);
  if (!rates) return undefined;
  const [input, output, reasoning, cacheRead, cacheWrite] = rates;
  const parts: number[] = [];
  if (input !== null) parts.push(((usage.input ?? 0) / 1_000_000) * input);
  if (output !== null) parts.push(((usage.output ?? 0) / 1_000_000) * output);
  if (reasoning !== null && typeof usage.reasoningTokens === "number")
    parts.push((usage.reasoningTokens / 1_000_000) * reasoning);
  if (cacheRead !== null && typeof usage.cacheReads === "number")
    parts.push((usage.cacheReads / 1_000_000) * cacheRead);
  if (cacheWrite !== null && typeof usage.cacheWrites === "number")
    parts.push((usage.cacheWrites / 1_000_000) * cacheWrite);
  return parts.length ? parts.reduce((sum, part) => sum + part, 0) : undefined;
}
