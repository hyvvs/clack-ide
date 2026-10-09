import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ModelSwitchNotice } from "@/modules/ai/components/ModelSwitchNotice";
import {
  contextBudgetPresentation,
  resolveContextBudget,
} from "@/modules/ai/lib/contextBudget";

it.each([
  "reported",
  "unknown-policy",
] as const)("keeps %s budget arithmetic inside closed Technical details", (source) => {
  const budget = resolveContextBudget(
    source === "reported" ? { reported: 4096 } : {},
    {
      system: 3300,
      tools: 0,
      conversation: 37,
      uncertainMedia: false,
      breakdown: { core: 3000, agent: 300, history: 37 },
    },
  );
  const html = renderToStaticMarkup(
    <ModelSwitchNotice
      targetLabel="Target"
      assessment={{
        status: "blocked",
        contextBlocked: true,
        contextCapacity: source === "unknown-policy" ? "unknown" : "known",
        reasons: [
          source === "reported"
            ? "This conversation needs more context than this model supports."
            : "Clack couldn't verify this model's context capacity, so the switch was stopped before sending anything.",
        ],
        contextLimit: budget.ceiling,
        estimatedTokens: 3337,
        details: contextBudgetPresentation(budget).details.split("\n"),
      }}
      onBack={() => {}}
      onConfirm={() => {}}
    />,
  );
  const primary = html.split("<details")[0];
  expect(primary).toContain(
    source === "unknown-policy"
      ? "Clack can&#x27;t verify this model&#x27;s context capacity."
      : "This model can&#x27;t fit the required context for this conversation.",
  );
  if (source === "unknown-policy") {
    expect(primary).toContain("stopped before sending anything");
    expect(primary).not.toContain("can&#x27;t fit");
  }
  expect(primary).not.toMatch(
    /3337|4096|Output reserve|Safety margin|reduce the new request/,
  );
  expect(html).toContain("Technical details");
  expect(html).toContain("Output reserve: 614");
  expect(html).toContain("Safety margin: 334");
  expect(html).toContain("Ceiling provenance:");
  expect(html).toContain("Core system instructions: 3000");
  expect(html).not.toMatch(/<details[^>]*\bopen\b/);
  expect(html).not.toContain("Optimize and switch");
});
