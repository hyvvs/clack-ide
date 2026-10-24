import { z } from "zod";

export const TOOL_VERIFICATION = {
  protocol: "native-tools-v1",
  output: 512,
  outputs: [512, 1024, 2048],
  maxRequests: 5,
  deadlineMs: 120_000,
  ttlMs: 86400_000,
  backoffMs: 300_000,
} as const;
export const probeArguments = z
  .object({ key: z.literal("clack-probe-v1"), count: z.literal(1) })
  .strict();
export const TOOL_PROBE_NAME = "get_probe_value";
export const TOOL_PROBE_PROMPT =
  'Your next response must be exactly one native function call to get_probe_value with key "clack-probe-v1" and count 1. Invoke the provided function tool directly. Do not write an answer, describe the call, or output a text imitation (including JSON, XML, or code).';
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
  "request-limit",
]);
export type ToolRequestBudget = { remaining: number };
export const createToolRequestBudget = (): ToolRequestBudget => ({
  remaining: TOOL_VERIFICATION.maxRequests,
});
const probeOutput = z.union([z.literal(512), z.literal(1024), z.literal(2048)]);
const time = z.number().int().nonnegative().safe();
export const toolConfigurationSchema = z.object({
  choice: z.string().min(1).max(32),
  wire: z.union([z.boolean(), z.string().min(1).max(32)]),
}).strict();
export type ToolConfiguration = z.infer<typeof toolConfigurationSchema>;
export const toolFailureSchema = z.object({
  at: time,
  expiresAt: time,
  outcome: z.enum(["text-only", "wrong-tool", "invalid-arguments", "multiple-calls"]),
}).strict();
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
      "needs-attention",
      "incomplete",
      "unsupported",
    ]),
    outcome: toolOutcome,
    context: z.number().int().min(1).max(2_000_000),
    output: probeOutput,
    attempts: z.array(z.object({
      output: probeOutput,
      outcome: z.enum(["native-call", "wrong-tool", "invalid-arguments", "multiple-calls", "text-only", "empty", "output-length", "transport"]),
      finish: z.string().max(64),
      startedAt: time,
      completedAt: time,
    }).strict()).max(3).optional(),
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
    configuration: toolConfigurationSchema.optional(),
    confirmation: z.object({ id: z.string().min(1).max(128), at: time, expiresAt: time }).strict().optional(),
    failure: toolFailureSchema.optional(),
    retryAfter: time,
  })
  .strict()
  .refine(r => r.status !== "needs-attention" || r.failure !== undefined)
  .refine(r => !r.confirmation || (!!r.configuration && !!r.proof && r.confirmation.id !== r.id &&
    r.confirmation.at <= r.proof.at && r.confirmation.expiresAt > r.confirmation.at))
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
