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
    // Immutable managed v3 selection IDs include serialized execution policy
    // and may exceed the historic 1,100-char model tag bound. Permit the same
    // bounded 40 KiB exact Fabric identity without broadening session/tool IDs.
    modelId: z.string().min(1).max(40 * 1024).optional(),
    providerId: id.optional(),
    taskId: id.optional(),
  })
  .strict();
export type ActivityOwner = z.infer<typeof activityOwnerSchema>;
/** Slice 5: one bounded content-free reference inside the EXISTING durable
 * Chat activity metadata, not a new trace database or independent trust grant.
 * SDK terminal and native request terminal are deliberately separate facts. */
export const managedActivityExecutionSchema = z.object({
  version: z.literal(1),
  stableExecutionIdentity: z.string().min(1).max(40*1024),
  deploymentId: z.string().min(1).max(40*1024),
  requestedBackendOrder: z.array(z.string().min(1).max(64)).max(16),
  selectedBackend: z.string().min(1).max(64),
  actualBackend: z.string().min(1).max(64),
  deviceIds: z.array(z.string().min(1).max(2048)).max(16),
  runtimeVariantId: z.string().min(1).max(2048),
  runtimeBuildDigest: z.string().max(2048).nullable(),
  actualGpuLayers: z.number().int().nonnegative(),
  requestedGpuLayers: z.number().int().nonnegative().nullable(),
  cpuThreads: z.number().int().positive().nullable(),
  processId: z.number().int().positive().safe(),
  runtimeEpoch: z.string().min(1).max(2048),
  routeBaseUrl: z.string().max(2048).nullable(),
  fallbackUsed: z.boolean(),
  fallbackReason: z.string().max(1024).nullable(),
  nativeHostAvailableBytes: z.number().int().nonnegative().safe().nullable(),
  nativeDeviceAvailableBytes: z.number().int().nonnegative().safe().nullable(),
  estimatedDeviceRequirementBytes: z.number().int().nonnegative().safe().nullable(),
  observedAt: z.number().int().nonnegative().safe(),
  sdkTerminalOutcome: z.enum(["completed","failed","cancelled","unknown"]),
  /** Stream completion alone is NOT the native Tauri inference-N terminal. */
  nativeRequestTerminal: z.literal("Unknown"),
  processStillCurrentAtTerminal: z.boolean(),
}).strict();
export type ManagedActivityExecution = z.infer<typeof managedActivityExecutionSchema>;
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
    managedExecution: managedActivityExecutionSchema.optional(),
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
