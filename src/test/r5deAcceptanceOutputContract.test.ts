import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveAgentOutputBudget } from "@/modules/ai/lib/agentOutputBudget";
import { CONTEXT_CALIBRATION } from "@/modules/ai/lib/contextCalibrationSchema";
import {
  r5deAcceptanceOutputContract,
  R5DE_LOGICAL_CONTINUATION_MARKER,
} from "./r5deAcceptanceOutputContract";

// These are purely offline parity tests. No provider transport or model runs.
describe("R5de harness output policy imported from production", () => {
  const originalContext = 73728;
  const contract = r5deAcceptanceOutputContract(CONTEXT_CALIBRATION.candidates, originalContext);
  it("captures original 8192 budget and exact verified-tier continuation budgets", () => {
    expect(contract.originalOutput).toBe(8192);
    expect(contract.continuationOutputs).toEqual(CONTEXT_CALIBRATION.candidates.map(context => ({
      context,
      output: resolveAgentOutputBudget({ deployed: context, runtimeTarget: context },
        { choice: "automatic", capability: { status: "supported" } } as Parameters<typeof resolveAgentOutputBudget>[1]),
    })));
    expect(contract.continuationOutputs).toEqual(expect.arrayContaining([
      { context: 32768, output: 4096 },
      { context: 49152, output: 6144 },
      { context: 65536, output: 8192 },
      { context: 73728, output: 8192 },
    ]));
  });
  it("locks the acceptance-only marker to the actual production logical-continuation string", () => {
    const source = readFileSync(new URL("../modules/ai/lib/agent.ts", import.meta.url), "utf8");
    expect(source).toContain(`? ${JSON.stringify(R5DE_LOGICAL_CONTINUATION_MARKER)}`);
    expect(R5DE_LOGICAL_CONTINUATION_MARKER).toContain("same logical run after an internal step batch");
  });
  it("does not manufacture additional tiers or duplicate/non-numeric contracts", () => {
    expect(() => r5deAcceptanceOutputContract([49152,49152],originalContext)).toThrow();
    expect(() => r5deAcceptanceOutputContract([73729],originalContext)).toThrow();
    expect(() => r5deAcceptanceOutputContract([],originalContext)).toThrow();
    expect(() => r5deAcceptanceOutputContract([0],originalContext)).toThrow();
  });
});
