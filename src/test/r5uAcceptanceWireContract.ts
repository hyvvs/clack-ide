/** Acceptance-only projection of current production request builders.
 * This does not change or replace production policy. The isolated host gets
 * this at launch, rather than maintaining independent Rust token ladders.
 */
import { z } from "zod";
import { CONTEXT_CALIBRATION } from "@/modules/ai/lib/contextCalibrationSchema";
import {
  COMPACTION_EXTRACTION_MAX_CLAIMS,
  COMPACTION_EXTRACTION_MAX_SOURCES,
  COMPACTION_EXTRACTION_MAX_SOURCE_BYTES,
  COMPACTION_EXTRACTION_REQUEST_MAX_OUTPUT,
  COMPACTION_EXTRACTION_SYSTEM,
} from "@/modules/ai/lib/compactionExtraction";
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
    extraction: {
      maxOutput: COMPACTION_EXTRACTION_REQUEST_MAX_OUTPUT,
      maxSources: COMPACTION_EXTRACTION_MAX_SOURCES,
      maxSourceBytes: COMPACTION_EXTRACTION_MAX_SOURCE_BYTES,
      maxClaims: COMPACTION_EXTRACTION_MAX_CLAIMS,
      systemPrompt: COMPACTION_EXTRACTION_SYSTEM,
    },
    agent: { output: agentOutput, context: agentContext, toolNames: [...agentToolNames].sort() },
  };
}
