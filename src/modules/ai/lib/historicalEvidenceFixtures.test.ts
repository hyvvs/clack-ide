import { describe, expect, it } from "vitest";
import { buildDeploymentEvidenceCatalog, recommendAllDeployments } from "./deploymentEvidenceDecisions";
import { lm6RunSchema } from "./deploymentMeasurement";
import { deploymentQualificationEvidenceReceiptSchema } from "./localComputeFabric";
import { emptySelfHostedState } from "./selfHostedProfiles";
import {
  curatedHistoricalEvidence,
  currentAuthorityOfHistoricalEvidence,
  historicalEvidenceFixtureSchema,
  historicalEvidenceRecordSchema,
  historicalEvidenceScopePrecision,
  historicalFailureKindSchema,
  MAX_HISTORICAL_FIXTURE_BYTES,
  MAX_HISTORICAL_FIXTURE_RECORDS,
  parseUntrustedHistoricalFixture,
  type HistoricalEvidenceRecord,
} from "./historicalEvidenceFixtures";

const exampleAt = Date.parse("2026-10-01T12:00:00Z");
const syntheticRecord = (id: string): HistoricalEvidenceRecord => ({
  version: 1,
  id,
  authority: "historical-only",
  source: {
    kind: "synthetic-fixture",
    reference: "fixture:generic-offline-validation",
    manifestDigest: null,
  },
  observedAt: exampleAt,
  scope: {
    deploymentId: "example-deployment", hostId: "example-host",
    runtimeId: "example-runtime", runtimeVersion: "0.0-test", runtimeEpoch: "test-epoch",
    configurationIdentity: "test-context-4096-cpu", artifactDigest: `sha256:${"a".repeat(64)}`,
    modelLabel: "Generic sample", configuredContextTokens: 4096, backend: "CPU",
  },
  quality: "synthetic",
  outcome: "incomplete",
  failureKinds: ["first-output", "context"],
  cause: "not-established",
  metrics: [
    {
      name: "first-meaningful-output-ms", value: 60000, unit: "ms",
      provenance: "synthetic", boundary: "synthetic-test", approximate: false,
    },
    {
      name: "configured-context-tokens", value: 4096, unit: "tokens",
      provenance: "synthetic", boundary: "synthetic-test", approximate: false,
    },
    {
      name: "provider-delivered-tokens", value: null, unit: "tokens",
      provenance: "unknown", boundary: "not-observed", approximate: false,
    },
  ],
  limits: ["synthetic-only", "current-capability-unverified"],
});

const asBundle = (...records: unknown[]) => ({ version: 1, records });

describe("LM11–LM15 generic historical evidence fixtures", () => {
  it("accepts strict, generic, synthetic-only offline observations with exact scope", () => {
    const record = syntheticRecord("generic-first-output");
    const parsed = parseUntrustedHistoricalFixture(asBundle(record));
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0].scope).toEqual(record.scope);
    expect(historicalEvidenceScopePrecision(parsed.records[0].scope)).toBe("exact-configured");
    expect(parsed.records[0].metrics[0].value).toBe(60000);
    expect(currentAuthorityOfHistoricalEvidence(parsed.records[0])).toEqual({
      eligible: false, status: "historical-only",
    });
  });

  it("supports each failure class without naming any model in production logic", () => {
    const kinds = historicalFailureKindSchema.options;
    expect(kinds).toEqual([
      "first-output", "idle", "recovery", "context", "partial",
      "tool", "cpu-spill", "warm-cache", "interruption", "instruction",
    ]);
    const sample = syntheticRecord("generic-multi-failure");
    const generic = { ...sample, failureKinds: [...kinds] };
    const renamed = {
      ...generic, id: "another-generic-model",
      scope: { ...generic.scope, modelLabel: "Other example label" },
    };
    const parsed = parseUntrustedHistoricalFixture(asBundle(generic, renamed));
    expect(parsed.records.map(row => row.failureKinds)).toEqual([kinds, kinds]);
    expect(parsed.records[0].scope.modelLabel).toBe("Generic sample");
    expect(parsed.records[1].scope.modelLabel).toBe("Other example label");
  });

  it("retains partial/unknown identity and unknown metrics rather than fabricating zeros", () => {
    const sample = syntheticRecord("generic-unknown-scope");
    const parsed = parseUntrustedHistoricalFixture(asBundle({
      ...sample,
      scope: {
        ...sample.scope, deploymentId: null, hostId: null, runtimeId: null,
        runtimeVersion: null, runtimeEpoch: null, configurationIdentity: null,
        artifactDigest: null, configuredContextTokens: null, backend: null,
      },
      metrics: [{
        name: "semantic-idle-duration-ms", value: null, unit: "ms",
        provenance: "unknown", boundary: "not-observed", approximate: false,
      }],
    })).records[0];
    expect(parsed.scope.deploymentId).toBeNull();
    expect(parsed.scope.runtimeEpoch).toBeNull();
    expect(historicalEvidenceScopePrecision(parsed.scope)).toBe("unknown");
    expect(historicalEvidenceScopePrecision({
      ...parsed.scope, runtimeVersion: "0.40.11",
    })).toBe("partial");
    expect(parsed.metrics[0].value).toBeNull();
    expect(parsed.metrics[0].provenance).toBe("unknown");
  });

  it("preserves grounded Muse observed bytes/idle duration and separately approximate runner tokens", () => {
    expect(curatedHistoricalEvidence.records).toHaveLength(1);
    const record = curatedHistoricalEvidence.records[0];
    expect(record.id).toBe("forgeboardmuse-20261109-01:inference-27");
    expect(record.source.reference).toBe("docs/CLACK_LOCAL_MUSE_STREAM_DELIVERY_OFFLINE_2026-11-09.md");
    expect(record.source.manifestDigest).toBe(
      "sha256:98314e64c5c3156e44fbc166231133f4ff116bee368549a31c17224c6fd31915",
    );
    expect(record.scope.modelLabel).toBe("Muse Glimmer");
    expect(record.scope.deploymentId).toBeNull();
    expect(record.scope.runtimeEpoch).toBeNull();
    expect(record.scope.configurationIdentity).toBeNull();
    expect(historicalEvidenceScopePrecision(record.scope)).toBe("unknown");
    expect(record.outcome).toBe("incomplete");
    expect(record.cause).toBe("unresolved");
    expect(record.failureKinds).toEqual(["idle", "partial", "interruption"]);
    expect(record.metrics).toContainEqual({
      name: "native-response-body-bytes", value: 302, unit: "bytes",
      provenance: "historical-measured", boundary: "clack-reqwest-body-read",
      approximate: false,
    });
    expect(record.metrics).toContainEqual({
      name: "semantic-idle-duration-ms", value: 180008, unit: "ms",
      provenance: "historical-measured", boundary: "native-semantic-idle-guard",
      approximate: false,
    });
    expect(record.metrics).toContainEqual({
      name: "runner-generated-tokens-approx", value: 1640, unit: "tokens",
      provenance: "reconstructed", boundary: "runtime-journal", approximate: true,
    });
    expect(record.metrics).toContainEqual({
      name: "provider-delivered-tokens", value: null, unit: "tokens",
      provenance: "unknown", boundary: "not-observed", approximate: false,
    });
    expect(record.limits).toContain("delivery-boundary-unresolved");
    expect(currentAuthorityOfHistoricalEvidence(record).eligible).toBe(false);
  });

  it("rejects arbitrary untrusted claims of historical measured or reconstructed provenance", () => {
    const sample = syntheticRecord("untrusted-source");
    const forged = {
      ...sample, source: {
        kind: "historical-audit",
        reference: "docs/REAL_LOCAL_MODEL_ACCEPTANCE.md",
        manifestDigest: null,
      },
      quality: "historical-measured",
      metrics: [{
        name: "first-meaningful-output-ms", value: 1, unit: "ms",
        provenance: "historical-measured", boundary: "native-stream",
        approximate: false,
      }],
    };
    // A structurally well-formed claimed report is still not authenticated
    // merely because someone supplied a plausible document path.
    expect(historicalEvidenceRecordSchema.safeParse(forged).success).toBe(true);
    expect(() => parseUntrustedHistoricalFixture(asBundle(forged))).toThrow(
      /Untrusted fixture cannot assert historical measurement provenance/,
    );
    expect(() => parseUntrustedHistoricalFixture(curatedHistoricalEvidence)).toThrow(
      /Untrusted fixture cannot assert historical measurement provenance/,
    );
  });

  it("refuses unknown keys, untrusted explicit authority grants and invalid identities", () => {
    const sample = syntheticRecord("generic-authority");
    for (const modification of [
      { ...sample, authority: "qualified" },
      { ...sample, currentReady: true },
      { ...sample, scope: { ...sample.scope, artifactDigest: "sha256:invalid" } },
      { ...sample, source: { ...sample.source, reference: "https://external.example/path" } },
      { ...sample, observedAt: -10 },
    ]) {
      expect(historicalEvidenceRecordSchema.safeParse(modification).success).toBe(false);
    }
  });

  it("rejects unit swaps, fake observed zeroes, invalid synthetic provenance, and approximate token laundering", () => {
    const sample = syntheticRecord("generic-metric");
    const first = sample.metrics[0];
    const mutations = [
      { ...first, unit: "tokens" },
      { ...first, value: 0, provenance: "unknown" },
      { ...first, value: null, provenance: "synthetic" },
      { ...first, provenance: "historical-measured", boundary: "native-stream" },
      { ...first, provenance: "synthetic", boundary: "clack-reqwest-body-read" },
      {
        ...first, name: "runner-generated-tokens-approx", unit: "tokens",
        value: 1640, approximate: false,
      },
    ];
    for (const metric of mutations) {
      expect(historicalEvidenceRecordSchema.safeParse({
        ...sample, metrics: [metric],
      }).success).toBe(false);
    }
  });

  it("rejects duplicate IDs, duplicate metrics/failures, unclassified failures and oversized counts", () => {
    const sample = syntheticRecord("generic-duplicates");
    expect(historicalEvidenceFixtureSchema.safeParse(asBundle(sample, sample)).success).toBe(false);
    expect(historicalEvidenceRecordSchema.safeParse({
      ...sample, failureKinds: ["idle", "idle"],
    }).success).toBe(false);
    expect(historicalEvidenceRecordSchema.safeParse({
      ...sample, metrics: [sample.metrics[0], sample.metrics[0]],
    }).success).toBe(false);
    expect(historicalEvidenceRecordSchema.safeParse({
      ...sample, outcome: "failed", failureKinds: [],
    }).success).toBe(false);
    expect(historicalEvidenceFixtureSchema.safeParse(asBundle(...Array.from(
      { length: MAX_HISTORICAL_FIXTURE_RECORDS + 1 },
      (_, index) => syntheticRecord(`generic-${index}`),
    ))).success).toBe(false);
  });

  it("enforces a bounded UTF-8 serialized fixture before schema validation", () => {
    const sample = syntheticRecord("generic-oversized");
    expect(() => parseUntrustedHistoricalFixture({
      ...asBundle(sample),
      unsolicitedText: "x".repeat(MAX_HISTORICAL_FIXTURE_BYTES),
    })).toThrow(/bounded JSON size/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => parseUntrustedHistoricalFixture(cyclic)).toThrow(/cannot be serialized/);
    const maxLengthSet = Array.from({ length: MAX_HISTORICAL_FIXTURE_RECORDS }, (_, index) => ({
      ...syntheticRecord(`large-${index}`),
      scope: {
        ...sample.scope,
        configurationIdentity: "x".repeat(1024),
      },
    }));
    expect(historicalEvidenceFixtureSchema.safeParse(asBundle(...maxLengthSet)).success)
      .toBe(false);
  });

  it("cannot affect existing LM2F/LM6 recommendation decisions or create current eligibility", () => {
    const catalog = buildDeploymentEvidenceCatalog(emptySelfHostedState(), { now: exampleAt });
    const before = recommendAllDeployments(catalog);
    const synthetic = parseUntrustedHistoricalFixture(asBundle(
      syntheticRecord("generic-strong-looking-model"),
    ));
    expect(synthetic.records[0].scope.runtimeEpoch).toBe("test-epoch");
    expect(currentAuthorityOfHistoricalEvidence(synthetic.records[0])).toEqual({
      eligible: false, status: "historical-only",
    });
    expect(currentAuthorityOfHistoricalEvidence(curatedHistoricalEvidence.records[0]).eligible).toBe(false);
    expect(lm6RunSchema.safeParse(curatedHistoricalEvidence.records[0]).success).toBe(false);
    expect(deploymentQualificationEvidenceReceiptSchema.safeParse(
      curatedHistoricalEvidence.records[0],
    ).success).toBe(false);
    expect(recommendAllDeployments(catalog)).toEqual(before);
    expect(before.every(row => row.deploymentId === null)).toBe(true);
  });
});
