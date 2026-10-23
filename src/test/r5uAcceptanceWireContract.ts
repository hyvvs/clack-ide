/** Acceptance-only projection of current production request builders.
 * This does not change or replace production policy. The isolated host gets
 * this at launch, rather than maintaining independent Rust token ladders.
 */
import { z } from "zod";
import { CONTEXT_CALIBRATION } from "@/modules/ai/lib/contextCalibrationSchema";
import {
  TOOL_VERIFICATION,
  TOOL_PROBE_NAME,
  probeArguments,
} from "@/modules/ai/lib/toolVerificationSchema";

export function productionAcceptanceWireContract(
  agentOutput: number, agentContext: number, agentToolNames: string[],
) {
  if (!agentToolNames.length || new Set(agentToolNames).size !== agentToolNames.length ||
      agentToolNames.some(name => !/^[a-z][a-z0-9_]{1,63}$/.test(name)) ||
      agentToolNames.includes(TOOL_PROBE_NAME) ||
      !Number.isSafeInteger(agentOutput) || agentOutput < 1 ||
      !Number.isSafeInteger(agentContext) || agentContext < 1)
    throw new Error("Original acceptance Agent request contract unavailable");
  return {
    calibration: {
      candidates: [...CONTEXT_CALIBRATION.candidates],
      output: CONTEXT_CALIBRATION.output,
    },
    verification: {
      outputs: [...TOOL_VERIFICATION.outputs],
      name: TOOL_PROBE_NAME,
      parameters: z.toJSONSchema(probeArguments),
    },
    agent: { output: agentOutput, context: agentContext, toolNames: [...agentToolNames].sort() },
  };
}
