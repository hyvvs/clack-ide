import { z } from "zod";
import type { UIMessage } from "ai";

export const MAX_ACTIVITY_RECEIPTS = 512;
export const MAX_ACTIVITY_BYTES = 128 * 1024;
const id = z.string().min(1).max(1100);
export const activityOwnerSchema = z
  .object({
    sessionId: id,
    runId: id,
    workspaceId: id.nullable(),
    agentId: id.optional(),
    modelId: id.optional(),
    providerId: id.optional(),
    taskId: id.optional(),
  })
  .strict();
export type ActivityOwner = z.infer<typeof activityOwnerSchema>;
const receiptSchema = z
  .object({
    id,
    at: z.number().int().nonnegative(),
    kind: z.enum([
      "request",
      "retry",
      "recovered",
      "part",
      "tool",
      "response",
      "error",
      "cancelled",
    ]),
    label: z.string().max(300),
    part: z.number().int().nonnegative().optional(),
    format: z.enum(["summary", "content", "unspecified"]).optional(),
    owner: activityOwnerSchema.optional(),
  })
  .strict();
export const activitySchema = z
  .object({
    version: z.literal(1),
    owner: activityOwnerSchema,
    receipts: z.array(receiptSchema).max(MAX_ACTIVITY_RECEIPTS),
    omitted: z.number().int().nonnegative(),
  })
  .strict();
export type ActivityReceipt = z.infer<typeof receiptSchema>;
export type ActivityRecord = z.infer<typeof activitySchema>;

export function readActivity(
  message: UIMessage,
  sessionId: string,
  workspaceId: string | null,
) {
  const parsed = activitySchema.safeParse(
    object(message.metadata)?.clackActivity,
  );
  if (
    !parsed.success ||
    new TextEncoder().encode(JSON.stringify(parsed.data)).length >
      MAX_ACTIVITY_BYTES ||
    parsed.data.owner.sessionId !== sessionId ||
    parsed.data.owner.workspaceId !== workspaceId
  )
    return null;
  if (
    new Set(parsed.data.receipts.map((r) => r.id)).size !==
      parsed.data.receipts.length ||
    parsed.data.receipts.some(
      (r) =>
        (r.part !== undefined && r.part >= message.parts.length) ||
        (r.owner &&
          (r.owner.sessionId !== sessionId ||
            r.owner.workspaceId !== workspaceId)),
    )
  )
    return null;
  return parsed.data;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
