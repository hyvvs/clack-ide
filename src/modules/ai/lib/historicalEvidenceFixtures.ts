import { z } from "zod";

/**
 * LM11–LM15: a bounded, read-only representation of older diagnostic facts.
 *
 * This module is NOT a source of LM2F receipts, LM6 runs, current readiness,
 * model eligibility or speed rankings. In particular, a source reference
 * supplied by a caller is a claim, not independently authenticated provenance.
 * Reviewed historical records are curated in source; arbitrary imported
 * fixtures are restricted to synthetic data.
 */
export const HISTORICAL_EVIDENCE_VERSION = 1 as const;
export const MAX_HISTORICAL_FIXTURE_BYTES = 32 * 1024;
export const MAX_HISTORICAL_FIXTURE_RECORDS = 32;

export const historicalEvidenceQualitySchema = z.enum([
  "historical-measured",
  "reconstructed",
  "synthetic",
]);
export type HistoricalEvidenceQuality = z.infer<typeof historicalEvidenceQualitySchema>;

export const historicalFailureKindSchema = z.enum([
  "first-output",
  "idle",
  "recovery",
  "context",
  "partial",
  "tool",
  "cpu-spill",
  "warm-cache",
  "interruption",
  "instruction",
]);
export type HistoricalFailureKind = z.infer<typeof historicalFailureKindSchema>;

export const historicalEvidenceMetricNameSchema = z.enum([
  "first-meaningful-output-ms",
  "semantic-idle-duration-ms",
  "recovery-attempt-count",
  "configured-context-tokens",
  "native-response-body-bytes",
  "runner-generated-tokens-approx",
  "tool-call-count",
  "cpu-spill-bytes",
  "warm-cache-first-output-ms",
  "interruption-duration-ms",
  "instruction-failure-count",
  "provider-delivered-tokens",
]);
export type HistoricalEvidenceMetricName = z.infer<typeof historicalEvidenceMetricNameSchema>;

const metricUnits: Record<HistoricalEvidenceMetricName, "ms" | "tokens" | "bytes" | "count"> = {
  "first-meaningful-output-ms": "ms",
  "semantic-idle-duration-ms": "ms",
  "recovery-attempt-count": "count",
  "configured-context-tokens": "tokens",
  "native-response-body-bytes": "bytes",
  "runner-generated-tokens-approx": "tokens",
  "tool-call-count": "count",
  "cpu-spill-bytes": "bytes",
  "warm-cache-first-output-ms": "ms",
  "interruption-duration-ms": "ms",
  "instruction-failure-count": "count",
  "provider-delivered-tokens": "tokens",
};

const boundedId = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const boundedText = z.string().min(1).max(256);
const boundedTime = z.number().int().nonnegative().safe();
const nonnegativeMeasurement = z.number().finite().nonnegative().max(1e12);
const sourceReference = z.string().min(1).max(256)
  .regex(/^(?:docs\/[A-Za-z0-9/_.#-]+|fixture:[a-z0-9][a-z0-9._-]*)$/);

/** Exact identity fields are null until a contemporaneous source proves them.
 * A display label is only presentation metadata; never a deployment lookup. */
export const historicalEvidenceScopeSchema = z.object({
  deploymentId: boundedText.nullable(),
  hostId: boundedText.nullable(),
  runtimeId: boundedText.nullable(),
  runtimeVersion: boundedText.nullable(),
  runtimeEpoch: boundedText.nullable(),
  configurationIdentity: z.string().min(1).max(1024).nullable(),
  artifactDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/).nullable(),
  modelLabel: boundedText.nullable(),
  configuredContextTokens: z.number().int().positive().safe().nullable(),
  backend: z.enum(["CPU", "GPU", "Hybrid", "Unknown"]).nullable(),
}).strict();
export type HistoricalEvidenceScope = z.infer<typeof historicalEvidenceScopeSchema>;

/** Display-only precision. A model label is not an identity, and even an
 * exact configured deployment here is historical without fresh runtime proof. */
export function historicalEvidenceScopePrecision(scope: HistoricalEvidenceScope):
  "exact-configured" | "partial" | "unknown" {
  const fields = [
    scope.deploymentId, scope.hostId, scope.runtimeId,
    scope.configurationIdentity, scope.artifactDigest,
  ];
  if (fields.every(Boolean)) return "exact-configured";
  if (fields.some(Boolean) || scope.runtimeEpoch || scope.runtimeVersion)
    return "partial";
  return "unknown";
}

/** The boundary records WHAT was observed. It cannot prove events across
 * the runtime → HTTP → SSH → reqwest → WebView → SDK chain by implication. */
export const historicalMetricBoundarySchema = z.enum([
  "native-stream",
  "native-semantic-idle-guard",
  "clack-reqwest-body-read",
  "runtime-journal",
  "saved-qualification-ledger",
  "saved-measurement-ledger",
  "independent-evaluator",
  "reconstructed-timeline",
  "synthetic-test",
  "not-observed",
]);

export const historicalEvidenceMetricSchema = z.object({
  name: historicalEvidenceMetricNameSchema,
  value: nonnegativeMeasurement.nullable(),
  unit: z.enum(["ms", "tokens", "bytes", "count"]),
  provenance: z.enum(["historical-measured", "reconstructed", "synthetic", "unknown"]),
  boundary: historicalMetricBoundarySchema,
  approximate: z.boolean(),
}).strict().superRefine((metric, ctx) => {
  if (metricUnits[metric.name] !== metric.unit)
    ctx.addIssue({ code: "custom", message: "Metric unit does not match the named observation" });
  if ((metric.provenance === "unknown") !== (metric.value === null))
    ctx.addIssue({ code: "custom", message: "Unknown metrics require null; observed metrics require a value" });
  if ((metric.value === null) !== (metric.boundary === "not-observed") &&
      metric.boundary !== "synthetic-test")
    ctx.addIssue({ code: "custom", message: "Missing metrics require the not-observed boundary" });
  if (metric.provenance === "synthetic" && metric.boundary !== "synthetic-test")
    ctx.addIssue({ code: "custom", message: "Synthetic numbers require a synthetic boundary" });
  if (metric.provenance === "historical-measured" &&
      ["reconstructed-timeline", "synthetic-test", "not-observed"].includes(metric.boundary))
    ctx.addIssue({ code: "custom", message: "Measured data requires a direct recorded boundary" });
  if (metric.name === "runner-generated-tokens-approx" && metric.value !== null &&
      !metric.approximate)
    ctx.addIssue({ code: "custom", message: "Approximate runner-token counts must stay approximate" });
});
export type HistoricalEvidenceMetric = z.infer<typeof historicalEvidenceMetricSchema>;

export const historicalEvidenceRecordSchema = z.object({
  version: z.literal(HISTORICAL_EVIDENCE_VERSION),
  id: boundedId,
  authority: z.literal("historical-only"),
  source: z.object({
    kind: z.enum(["sealed-run", "saved-ledger", "historical-audit", "synthetic-fixture"]),
    reference: sourceReference,
    /** Optional historical sealed-manifest fingerprint, not a runtime proof. */
    manifestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  }).strict(),
  observedAt: boundedTime,
  scope: historicalEvidenceScopeSchema,
  quality: historicalEvidenceQualitySchema,
  outcome: z.enum(["completed", "incomplete", "failed", "unknown"]),
  failureKinds: z.array(historicalFailureKindSchema).max(10),
  cause: z.enum(["observed", "unresolved", "not-established"]),
  metrics: z.array(historicalEvidenceMetricSchema).max(12),
  limits: z.array(z.enum([
    "missing-exact-deployment",
    "missing-runtime-epoch",
    "missing-configuration-identity",
    "provider-completion-unobserved",
    "delivery-boundary-unresolved",
    "runtime-generation-not-client-delivery",
    "reconstructed-only",
    "synthetic-only",
    "not-comparable",
    "current-capability-unverified",
  ])).max(10),
}).strict().superRefine((record, ctx) => {
  if (new Set(record.failureKinds).size !== record.failureKinds.length)
    ctx.addIssue({ code: "custom", message: "Duplicate failure classifications" });
  if (new Set(record.metrics.map(metric => metric.name)).size !== record.metrics.length)
    ctx.addIssue({ code: "custom", message: "Duplicate metric names" });
  if (record.outcome === "failed" && record.failureKinds.length === 0)
    ctx.addIssue({ code: "custom", message: "Failed outcomes require an explicit failure classification" });
  const synthetic = record.source.kind === "synthetic-fixture";
  if (synthetic !== record.source.reference.startsWith("fixture:"))
    ctx.addIssue({ code: "custom", message: "Synthetic fixture sources must remain explicitly synthetic" });
  if (synthetic !== (record.quality === "synthetic"))
    ctx.addIssue({ code: "custom", message: "Synthetic fixture and measurement quality must agree" });
  if (record.quality === "historical-measured" && !record.metrics.some(metric =>
    metric.provenance === "historical-measured"))
    ctx.addIssue({ code: "custom", message: "Historical measured records need an observed metric" });
  if (record.metrics.some(metric =>
    record.quality === "synthetic"
      ? !["synthetic", "unknown"].includes(metric.provenance)
      : record.quality === "reconstructed"
        ? !["reconstructed", "unknown"].includes(metric.provenance)
        : metric.provenance === "synthetic"))
    ctx.addIssue({ code: "custom", message: "Metric provenance cannot exceed record quality" });
});
export type HistoricalEvidenceRecord = z.infer<typeof historicalEvidenceRecordSchema>;

export const historicalEvidenceFixtureSchema = z.object({
  version: z.literal(HISTORICAL_EVIDENCE_VERSION),
  records: z.array(historicalEvidenceRecordSchema).max(MAX_HISTORICAL_FIXTURE_RECORDS),
}).strict().superRefine((bundle, ctx) => {
  if (new Set(bundle.records.map(record => record.id)).size !== bundle.records.length)
    ctx.addIssue({ code: "custom", message: "Fixture record IDs must be unique" });
  if (new TextEncoder().encode(JSON.stringify(bundle)).length > MAX_HISTORICAL_FIXTURE_BYTES)
    ctx.addIssue({ code: "custom", message: "Historical fixture exceeds the bounded JSON size" });
});
export type HistoricalEvidenceFixture = z.infer<typeof historicalEvidenceFixtureSchema>;

function checkFixtureBytes(value: unknown): void {
  let serialized: string | undefined;
  try { serialized = JSON.stringify(value); }
  catch { throw new Error("Historical fixture cannot be serialized"); }
  if (serialized === undefined ||
      new TextEncoder().encode(serialized).length > MAX_HISTORICAL_FIXTURE_BYTES)
    throw new Error("Historical fixture exceeds the bounded JSON size");
}

/** Structural validation is NOT source authentication. Callers can only
 * import untrusted data as synthetic test fixtures. Grounded observations
 * require an explicitly reviewed in-source fixture such as the one below. */
export function parseUntrustedHistoricalFixture(value: unknown): HistoricalEvidenceFixture {
  checkFixtureBytes(value);
  const parsed = historicalEvidenceFixtureSchema.parse(value);
  if (parsed.records.some(record => record.source.kind !== "synthetic-fixture"))
    throw new Error("Untrusted fixture cannot assert historical measurement provenance");
  return parsed;
}

/** Even an authenticated, perfectly scoped old observation has ZERO current
 * qualification or recommendation authority; only the current LM2F/LM6
 * native observation and procedure rules can establish current facts. */
export function currentAuthorityOfHistoricalEvidence(_record: HistoricalEvidenceRecord): {
  eligible: false;
  status: "historical-only";
} {
  return { eligible: false, status: "historical-only" };
}

/** Curated from docs/CLACK_LOCAL_MUSE_STREAM_DELIVERY_OFFLINE_2026-11-09.md,
 * 'Historical facts and non-negotiable interpretation' (2026-11-09).
 * This is a historical delivery-boundary incident, not a Muse capability,
 * reliability, quality, recovery, or Agent verdict. All unknown scope stays
 * explicitly null; 1,640 was runner-journal generation (approximately),
 * never bytes or output verified delivered to Clack's user interface. */
export const curatedHistoricalEvidence: HistoricalEvidenceFixture = (() => {
  const fixture = {
    version: HISTORICAL_EVIDENCE_VERSION,
    records: [{
      version: HISTORICAL_EVIDENCE_VERSION,
      id: "forgeboardmuse-20261109-01:inference-27",
      authority: "historical-only",
      source: {
        kind: "sealed-run",
        reference: "docs/CLACK_LOCAL_MUSE_STREAM_DELIVERY_OFFLINE_2026-11-09.md",
        manifestDigest: "sha256:98314e64c5c3156e44fbc166231133f4ff116bee368549a31c17224c6fd31915",
      },
      observedAt: Date.parse("2026-11-09T03:51:27Z"),
      scope: {
        deploymentId: null, hostId: null, runtimeId: null, runtimeVersion: null,
        runtimeEpoch: null, configurationIdentity: null, artifactDigest: null,
        modelLabel: "Muse Glimmer", configuredContextTokens: null, backend: null,
      },
      quality: "historical-measured",
      outcome: "incomplete",
      failureKinds: ["idle", "partial", "interruption"],
      cause: "unresolved",
      metrics: [
        {
          name: "native-response-body-bytes", value: 302, unit: "bytes",
          provenance: "historical-measured", boundary: "clack-reqwest-body-read",
          approximate: false,
        },
        {
          name: "semantic-idle-duration-ms", value: 180_008, unit: "ms",
          provenance: "historical-measured", boundary: "native-semantic-idle-guard",
          approximate: false,
        },
        {
          name: "runner-generated-tokens-approx", value: 1640, unit: "tokens",
          provenance: "reconstructed", boundary: "runtime-journal",
          approximate: true,
        },
        {
          name: "provider-delivered-tokens", value: null, unit: "tokens",
          provenance: "unknown", boundary: "not-observed",
          approximate: false,
        },
      ],
      limits: [
        "missing-exact-deployment", "missing-runtime-epoch",
        "missing-configuration-identity", "provider-completion-unobserved",
        "delivery-boundary-unresolved", "runtime-generation-not-client-delivery",
        "current-capability-unverified",
      ],
    }],
  };
  checkFixtureBytes(fixture);
  return historicalEvidenceFixtureSchema.parse(fixture);
})();
