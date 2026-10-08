import { z } from "zod";

export const CALIBRATION_LIMITS = {
  samples: 100,
  globalSamples: 512,
  ageMs: 7 * 24 * 60 * 60 * 1000,
  intervalMs: 10 * 60 * 1000,
  comparable: 5,
  pending: 128,
  batch: 16,
  batchMs: 500,
  profileBytes: 64 * 1024,
} as const;

const duration = z.number().finite().min(0).max(3_600_000).nullable();
const tokens = z.number().int().min(0).max(100_000_000).nullable();
const timestamp = z.number().int().nonnegative().safe();
export const calibrationSampleSchema = z
  .object({
    id: z.string().min(1).max(128),
    configurationRevision: z.number().int().positive(),
    observedAt: timestamp,
    requestClass: z.enum(["generation", "optimization"]),
    outcome: z.enum([
      "success",
      "cancelled",
      "timeout",
      "offline",
      "loading",
      "auth",
      "rate-limit",
      "protocol",
      "provider",
      "resource",
      "interrupted",
      "unknown",
    ]),
    thermal: z.enum(["cold", "warm", "unknown"]),
    queueMs: duration,
    ttftMs: duration,
    latencyMs: duration,
    generationMs: duration,
    maxGapMs: duration,
    inputTokens: tokens,
    outputTokens: tokens,
    concurrency: z.number().int().min(1).max(8).nullable(),
    outputKind: z.enum(["none", "text", "reasoning", "tool"]),
  })
  .strict();
export type CalibrationSample = z.infer<typeof calibrationSampleSchema>;
export const CALIBRATED_FIELDS = [
  "concurrentGenerations",
  "prefillTimeoutMs",
  "idleTimeoutMs",
] as const;
export const calibrationSchema = z
  .object({
    version: z.literal(1),
    samples: z.array(calibrationSampleSchema).max(CALIBRATION_LIMITS.samples),
    lastTunedAt: timestamp.nullable(),
    tuning: z.partialRecord(
      z.enum(CALIBRATED_FIELDS),
      z
        .object({
          sampleIds: z.array(z.string().min(1).max(128)).min(1).max(20),
          configurationRevision: z.number().int().positive(),
          updatedAt: timestamp,
        })
        .strict(),
    ),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.samples.map((s) => s.id)).size === value.samples.length &&
      Object.values(value.tuning).every(
        (t) => t && new Set(t.sampleIds).size === t.sampleIds.length,
      ) &&
      new TextEncoder().encode(JSON.stringify(value)).byteLength <=
        CALIBRATION_LIMITS.profileBytes,
  );
export type ProfileCalibration = z.infer<typeof calibrationSchema>;
