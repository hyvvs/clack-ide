import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { ToolContext } from "@/modules/ai/tools/context";

export function buildEvidenceTools(ctx: ToolContext): ToolSet {
  if (!ctx.requestConversationEvidence) return {};
  return {
    request_conversation_evidence: tool({
      description:
        "Request missing source evidence before your next response. Without a scoped anchor, searches only your own conversation; use an original message/evidence ID and expand for adjacent intact tool groups. For an authorized project/task query use anchor workspace, or select project:<recordId>, task:<taskId>, artifact:<taskId>:<artifactId>, or file:<workspace-relative-path>. Project/task evidence is also selected automatically. Never searches another private chat. Two bounded rounds total with a shared size/time allowance; if unavailable, disclose uncertainty instead of guessing.",
      inputSchema: z.object({
        query: z.string().min(1).max(4096),
        anchor: z.string().min(1).max(1100).optional(),
        expand: z.boolean().default(false),
      }),
      execute: async ({ query, anchor, expand }) =>
        ctx.requestConversationEvidence?.(query, anchor, expand),
    }),
  };
}
