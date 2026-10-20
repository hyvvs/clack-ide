import { z } from "zod";

export const TOOL_VERIFICATION = {
  protocol: "native-tools-v1",
  output: 512,
  deadlineMs: 120_000,
  ttlMs: 86400_000,
  backoffMs: 300_000,
} as const;
export const probeArguments = z
  .object({ key: z.literal("clack-probe-v1"), count: z.literal(1) })
  .strict();
export const TOOL_PROBE_NAME = "get_probe_value";
export const TOOL_PROBE_PROMPT =
  'Call get_probe_value exactly once with key "clack-probe-v1" and count 1. Use the native tool interface. Do not answer in text or simulate a tool call.';
export const toolOutcome = z.enum([
  "native-call",
  "wrong-tool",
  "invalid-arguments",
  "multiple-calls",
  "text-only",
  "empty",
  "output-length",
  "timeout",
  "transport",
  "offline",
  "revision-changed",
  "cancelled",
  "unsupported",
  "interrupted",
]);
const time = z.number().int().nonnegative().safe();
export const toolVerificationSchema = z
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
        protocol: z.literal(TOOL_VERIFICATION.protocol),
      })
      .strict(),
    status: z.enum([
      "verifying",
      "verified",
      "incompatible",
      "incomplete",
      "unsupported",
    ]),
    outcome: toolOutcome,
    context: z.number().int().min(1).max(2_000_000),
    output: z.literal(TOOL_VERIFICATION.output),
    startedAt: time,
    completedAt: time.nullable(),
    firstBodyAt: time.nullable(),
    callAt: time.nullable(),
    calls: z.number().int().min(0).max(2),
    validArguments: z.boolean(),
    textualIntent: z.boolean(),
    textChars: z.number().int().min(0).max(65536),
    finish: z.string().max(64).nullable(),
    proof: z.object({ at: time, expiresAt: time }).strict().nullable(),
    retryAfter: time,
  })
  .strict()
  .refine(
    (r) =>
      r.status !== "verified" ||
      (r.outcome === "native-call" &&
        r.calls === 1 &&
        r.validArguments &&
        r.callAt !== null &&
        r.completedAt !== null &&
        r.proof !== null),
  );
export type ToolVerification = z.infer<typeof toolVerificationSchema>;
