import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { ToolContext } from "@/modules/ai/tools/context";

export function buildEvidenceTools(ctx: ToolContext): ToolSet {
  if (!ctx.requestConversationEvidence) return {};
  return {
    request_conversation_evidence: tool({
      description:
        "Request original evidence missing from this conversation's compacted context. Own conversation only, no project files or other chats. Two bounded local lookup rounds per preparation; results are prepared before your next response. Use an original message/evidence ID as anchor and expand for adjacent intact message/tool groups. If unavailable, disclose uncertainty instead of guessing.",
      inputSchema: z.object({
        query: z.string().min(1).max(4096),
        anchor: z.string().min(1).max(256).optional(),
        expand: z.boolean().default(false),
      }),
      execute: async ({ query, anchor, expand }) =>
        ctx.requestConversationEvidence?.(query, anchor, expand),
    }),
  };
}
