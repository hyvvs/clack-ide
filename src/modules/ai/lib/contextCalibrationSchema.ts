import { z } from "zod";

export const CONTEXT_CALIBRATION = {
  version: 1,
  candidates: [4096, 8192, 16384, 32768, 49152, 65536],
  ceiling: 65536,
  requests: 7,
  output: 32,
  wallMs: 240_000,
  requestMs: 75_000,
  evidenceMs: 15 * 60_000,
  runtimeMs: 30_000,
  backoffMs: 5 * 60_000,
} as const;
export const contextOutcome = z.enum([
  "success",
  "capacity",
  "allocation-mismatch",
  "transient",
  "timeout",
  "offline",
  "revision-changed",
  "cancelled",
  "unsupported",
  "interrupted",
]);
const tokens = z.number().int().min(1).max(2_000_000);
const candidate = tokens.max(CONTEXT_CALIBRATION.ceiling);
const time = z.number().int().nonnegative().safe();
export const contextCalibrationSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1).max(128),
    scope: z
      .object({
        endpointId: z.string().min(1).max(2048),
        configurationRevision: z.number().int().positive(),
        model: z.string().min(1).max(2048),
        deployment: z.string().max(2048).nullable(),
        digest: z.string().min(1).max(1024),
        backend: z.literal("ollama"),
        runtimeEpoch: z.string().min(1).max(128),
        providerVersion: z.string().min(1).max(64),
        reasoning: z.string().max(2048),
      })
      .strict(),
    status: z.enum([
      "verifying",
      "verified",
      "incomplete",
      "capacity",
      "cancelled",
      "unsupported",
    ]),
    highest: candidate.nullable(),
    failedNext: candidate.nullable(),
    failure: contextOutcome.nullable(),
    allocation: z.string().max(1024).nullable(),
    startedAt: time,
    updatedAt: time,
    expiresAt: time,
    retryAfter: time,
    attempts: z
      .array(
        z
          .object({
            context: candidate,
            requested: candidate,
            loaded: tokens.nullable(),
            outcome: contextOutcome,
            at: time,
            latencyMs: z.number().nonnegative().max(600_000),
            thermal: z.enum(["cold", "warm", "unknown"]),
            finish: z.string().max(64).nullable(),
            think: z.literal("omitted"),
          })
          .strict(),
      )
      .max(7),
  })
  .strict()
  .refine(
    (r) =>
      r.attempts.every(
        (a) =>
          a.requested === a.context &&
          (a.outcome !== "success" || a.loaded === a.context),
      ) &&
      (r.highest === null ||
        r.attempts.some(
          (a) => a.context === r.highest && a.outcome === "success",
        )) &&
      (r.highest === null || r.highest <= CONTEXT_CALIBRATION.ceiling),
  );
export type ContextCalibration = z.infer<typeof contextCalibrationSchema>;
export type ContextOutcome = z.infer<typeof contextOutcome>;
