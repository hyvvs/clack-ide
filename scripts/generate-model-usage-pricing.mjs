// Rebuild the exact UI-only pricing projection from the installed, lockfile-
// pinned Tokenlens catalog. Does not query the internet or alter provider data.
import { getModels } from "@tokenlens/models";
import { readFileSync, writeFileSync } from "node:fs";

const destination = new URL("../src/components/ai-elements/modelUsagePricing.generated.json", import.meta.url);
const rateNames = ["input", "output", "reasoning", "cache_read", "cache_write"];
const rates = Object.create(null);
// Tokenlens searches provider catalogs in declaration order and returns the
// first matching model ID (including provider-prefixed lookup candidates).
// Keep *all* IDs, including unpriced ones, to retain shadowing/unknown-cost.
for (const provider of Object.values(getModels())) {
  for (const [modelId, model] of Object.entries(provider.models ?? {})) {
    if (Object.hasOwn(rates, modelId)) continue;
    const cost = model.cost;
    rates[modelId] = cost && rateNames.some((key) => typeof cost[key] === "number")
      ? rateNames.map((key) => typeof cost[key] === "number" ? cost[key] : null)
      : null;
  }
}
const serialized = JSON.stringify(rates) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(destination, "utf8") !== serialized) {
    throw new Error("UI pricing projection differs from lockfile-pinned Tokenlens; regenerate and review");
  }
  console.log(`UI_PRICING_PROJECTION=PASS models=${Object.keys(rates).length}`);
} else {
  writeFileSync(destination, serialized);
  console.log(`UI_PRICING_PROJECTION=GENERATED models=${Object.keys(rates).length}`);
}
