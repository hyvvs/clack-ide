import { z } from "zod";
import type {
  SelfHostedEndpoint,
  SelfHostedProfile,
  SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import { ollamaRuntimeCapabilities } from "@/modules/ai/lib/localRuntimeAdapters";
export { ollamaRuntimeCapabilities } from "@/modules/ai/lib/localRuntimeAdapters";

/**
 * LM2B: an additive, versioned projection INSIDE selfHostedInference.
 * The existing endpoint/profile/inventory registry remains the native CAS
 * authority; this is not another settings key or an inference permission.
 *
 * A rollback to the LM2A reader can ignore fabric and still use every saved
 * endpoint, model selection and historical qualification receipt.
 */
export const LOCAL_COMPUTE_FABRIC_VERSION = 1;
const name = z.string().min(1).max(2048);
const longIdentity = z.string().min(1).max(40 * 1024);
const small = z.string().min(1).max(128);
const optionalName = z.string().min(1).max(1024).optional();
const revision = z.number().int().positive();
const status = z.enum(["supported", "unsupported", "unknown", "requires-qualification"]);
export const RUNTIME_CAPABILITIES = [
  "chat", "completions", "streaming", "cancellation", "terminal-completion",
  "instruction-adherence", "reasoning-controls",
  "context-configuration", "token-accounting", "native-tools",
  "tool-protocol", "tool-arguments", "tool-results", "sequential-tools",
  "no-fabricated-effects", "parallel-tools", "json-mode", "json-schema", "grammar",
  "list-models", "inspect-model", "load-model", "unload-model",
  "model-residency", "runtime-health", "runtime-version",
  "hardware-telemetry", "gpu-offload", "kv-cache", "prompt-cache",
  "prompt-eval-metrics", "generation-metrics", "parallelism",
  "embeddings", "multimodal-input",
] as const;
export type RuntimeCapabilityName = typeof RUNTIME_CAPABILITIES[number];
export type RuntimeCapabilityStatus = z.infer<typeof status>;
// Unknown future statuses/keys remain bounded and intact on disk. They have
// NO affirmative meaning until this version of Clack understands them.
export const runtimeCapabilitySchema = z.object({
  status: z.string().min(1).max(64),
  source: z.string().min(1).max(64),
  observedAt: z.number().int().nonnegative().optional(),
}).passthrough();
export type RuntimeCapability = z.infer<typeof runtimeCapabilitySchema>;
const capabilitiesSchema = z.record(z.string().min(1).max(64), runtimeCapabilitySchema)
  .refine(value => Object.keys(value).length <= 64);
/** Backend identifiers belong to the Fabric, not display labels. Unknown future
 * identifiers are representable but never become executable by being named. */
export const KNOWN_EXECUTION_BACKENDS = [
  "cpu", "cuda", "rocm", "intel", "metal", "vulkan", "directml",
] as const;
export const executionBackendKindSchema = z.string().min(1).max(64)
  .regex(/^[a-z][a-z0-9-]*$/);
export type ExecutionBackendKind = z.infer<typeof executionBackendKindSchema>;
export const backendStateSchema = z.enum([
  "AVAILABLE", "UNAVAILABLE", "UNSUPPORTED", "UNKNOWN", "INSTALLED_NOT_USABLE",
]);
export type BackendState = z.infer<typeof backendStateSchema>;
export const backendTrustSchema = z.enum(["VERIFIED", "UNQUALIFIED", "UNKNOWN"]);
export const computeDeviceSchema = z.object({
  id: name, hostId: name, kind: z.enum(["cpu", "accelerator"]),
  vendor: optionalName, model: optionalName, architecture: optionalName,
  backendKinds: z.array(executionBackendKindSchema).max(16),
  availability: backendStateSchema,
  totalMemoryBytes: z.number().int().nonnegative().safe().optional(),
  availableMemoryBytes: z.number().int().nonnegative().safe().optional(),
  driverVersion: optionalName, source: small, observedAt: z.number().int().nonnegative().safe(),
  reason: optionalName, trust: backendTrustSchema,
}).strict();
export type ComputeDevice = z.infer<typeof computeDeviceSchema>;
export const runtimeBackendVariantSchema = z.object({
  id: name, backend: executionBackendKindSchema,
  support: backendStateSchema, installation: backendStateSchema,
  runtimeVersion: small.optional(), buildDigest: optionalName,
  source: small, trust: backendTrustSchema,
  supportedArtifactFormats: z.array(z.enum([
    "gguf", "ollama-manifest", "safetensors", "mlx-package", "opaque",
  ])).max(8).optional(),
  limitations: z.array(small).max(16).optional(),
}).strict();
export type RuntimeBackendVariant = z.infer<typeof runtimeBackendVariantSchema>;
export const executionFallbackSchema = z.object({
  policy: z.enum(["disabled", "allow-compatible", "explicit-order"]),
  order: z.array(executionBackendKindSchema).max(16).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.policy === "explicit-order" && !value.order?.length)
    ctx.addIssue({code: "custom", message: "Explicit-order fallback requires an ordered list"});
});
const memoryBytes = z.number().int().nonnegative().safe();
/** Exact user-authored candidate sequence. Unknown backends and multiple
 * devices remain representable, but require a separately implemented launcher. */
export const persistedExecutionCandidateSchema = z.object({
  backend: executionBackendKindSchema,
  deviceIds: z.array(name).max(16),
  gpuLayers: z.number().int().nonnegative().max(1_000_000).optional(),
  runtimeVariantId: name.optional(),
  runtimeBuildDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
}).strict().superRefine((candidate, ctx) => {
  if (new Set(candidate.deviceIds).size !== candidate.deviceIds.length)
    ctx.addIssue({code: "custom", message: "Duplicate exact device identities"});
  if (candidate.backend === "cpu" && (candidate.gpuLayers ?? 0) !== 0)
    ctx.addIssue({code: "custom", message: "CPU candidate cannot offload GPU layers"});
});
export type PersistedExecutionCandidate = z.infer<typeof persistedExecutionCandidateSchema>;
export const executionMemoryBudgetSchema = z.object({
  maxDeviceBytes: memoryBytes.optional(),
  maxHostBytes: memoryBytes.optional(),
  reserveDeviceBytes: memoryBytes.optional(),
  reserveHostBytes: memoryBytes.optional(),
}).strict();
export const executionDeviceStrategySchema = z.object({
  kind: z.enum(["single", "multi"]),
  primaryDeviceId: name.optional(),
  splitStrategy: z.enum(["none", "layers", "rows"]).optional(),
}).strict();
export const requestedExecutionSchema = z.object({
  backend: executionBackendKindSchema,
  deviceIds: z.array(name).max(16).default([]),
  gpuLayers: z.number().int().nonnegative().max(1_000_000).optional(),
  cpuThreads: z.number().int().positive().max(65_536).optional(),
  contextLength: z.number().int().positive().max(8_388_608).optional(),
  minAvailableDeviceBytes: z.number().int().nonnegative().safe().optional(),
  minAvailableHostBytes: z.number().int().nonnegative().safe().optional(),
  fallback: executionFallbackSchema.default({policy: "disabled"}),
  // Additive v3 fields are ordered AFTER every historic request field. V2
  // identity serialization and native canonical reconstruction stay unchanged.
  candidates: z.array(persistedExecutionCandidateSchema).min(1).max(16).optional(),
  memoryBudget: executionMemoryBudgetSchema.optional(),
  deviceStrategy: executionDeviceStrategySchema.optional(),
}).strict().superRefine((request, ctx) => {
  if (!request.candidates) {
    if (request.memoryBudget || request.deviceStrategy)
      ctx.addIssue({code: "custom", message: "Explicit candidates required for execution policy"});
    return;
  }
  const [first] = request.candidates;
  if (first.backend !== request.backend ||
      JSON.stringify(first.deviceIds) !== JSON.stringify(request.deviceIds) ||
      (first.gpuLayers !== undefined && first.gpuLayers !== request.gpuLayers))
    ctx.addIssue({code: "custom", message: "First candidate must match requested execution"});
  const others = request.candidates.slice(1).map(candidate => candidate.backend);
  if (request.fallback.policy === "disabled" &&
      (others.length || request.fallback.order !== undefined))
    ctx.addIssue({code: "custom", message: "Disabled fallback permits one candidate only"});
  if (request.fallback.policy === "explicit-order" &&
      JSON.stringify(others) !== JSON.stringify(request.fallback.order))
    ctx.addIssue({code: "custom", message: "Fallback order must match exact candidate sequence"});
  if (request.fallback.policy === "allow-compatible" &&
      (request.backend !== "cuda" || others.length !== 1 || others[0] !== "cpu" ||
        request.fallback.order !== undefined))
    ctx.addIssue({code: "custom", message: "Compatible fallback requires an exact CUDA then CPU sequence"});
  if (request.deviceStrategy?.primaryDeviceId &&
      !first.deviceIds.includes(request.deviceStrategy.primaryDeviceId))
    ctx.addIssue({code: "custom", message: "Primary device must belong to the first candidate"});
  if (request.deviceStrategy?.kind === "single" &&
      request.candidates.some(candidate => candidate.deviceIds.length > 1))
    ctx.addIssue({code: "custom", message: "Single-device strategy cannot list multiple devices"});
});
export type RequestedExecution = z.infer<typeof requestedExecutionSchema>;
/** Observed native launch, never inferred from a placement or preference. */
export const actualExecutionSchema = z.object({
  backend: executionBackendKindSchema,
  deviceIds: z.array(name).max(16), gpuLayers: z.number().int().nonnegative(),
  runtimeVariantId: name, runtimeEpoch: name, source: small,
  contextLength: z.number().int().positive().max(8_388_608).optional(),
  observedAt: z.number().int().nonnegative().safe(),
  /** Native-authored proof for a v3 policy. Unproven placement is never
   * promoted by a renderer-selected candidate or a persisted trust label. */
  executionReceipt: z.object({
    version: z.literal(3),
    deploymentId: longIdentity,
    deploymentIdentity: longIdentity,
    policyIdentity: longIdentity,
    selectedCandidateIndex: z.number().int().nonnegative().max(15),
    processId: z.number().int().positive().safe(),
    runtimeBuildDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
    fallbackUsed: z.boolean(),
    fallbackAuthorized: z.boolean(),
    /** Available capacity before launch, NOT bytes consumed by the child. */
    measuredHostBytes: memoryBytes.optional(),
    measuredDeviceBytes: memoryBytes.optional(),
  }).strict().optional(),
}).strict();
export type ActualExecution = z.infer<typeof actualExecutionSchema>;
export const computeHostSchema = z.object({
  id: name,
  displayName: small,
  location: z.enum(["local", "remote", "unknown"]),
  enabled: z.boolean(),
  reachability: z.enum(["online", "offline", "unknown"]),
  os: optionalName,
  hardwareProfileId: name.optional(),
  runtimeIds: z.array(name).max(32),
  /** Optional ephemeral host snapshot. Never persist a free-memory snapshot as
   * permanent machine capacity or copy it to another host. */
  observedDevices: z.array(computeDeviceSchema).max(64).optional(),
}).passthrough();
export const localRuntimeSchema = z.object({
  id: name,
  hostId: name,
  // The set of *implemented* adapters is intentionally smaller than the set
  // of representable types. A new string is never treated as Ollama.
  type: small,
  displayName: small,
  legacyEndpointId: name.optional(),
  processIdentity: optionalName,
  version: z.string().max(64).optional(),
  enabled: z.boolean(),
  health: z.enum(["online", "offline", "unknown"]),
  configurationRevision: revision,
  runtimeEpoch: optionalName,
  capabilities: capabilitiesSchema,
  backendVariants: z.array(runtimeBackendVariantSchema).max(32).optional(),
}).passthrough();
export const modelArtifactSchema = z.object({
  id: longIdentity,
  displayName: z.string().min(1).max(1024),
  format: z.enum(["ollama-manifest", "gguf", "safetensors", "mlx-package", "opaque"]),
  digest: z.string().min(1).max(1024).optional(),
  /** Native-inspected byte identity; no filesystem location or filename. */
  fileIdentity: z.string().min(1).max(1024).optional(),
  family: optionalName,
  parameterSize: optionalName,
  quantization: optionalName,
  declaredContext: revision.optional(),
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  provenance: z.enum(["runtime-inventory", "user-supplied", "unknown"]),
}).passthrough();
export const modelDeploymentSchema = z.object({
  id: longIdentity,
  hostId: name,
  runtimeId: name,
  artifactId: longIdentity,
  runtimeModelName: name,
  configurationRevision: revision,
  // Legacy profile identity is unchanged, including its 3-element tuple.
  profileId: longIdentity.optional(),
  variantId: name.nullable().optional(),
  configurationIdentity: z.string().max(4096).optional(),
  requestedExecution: requestedExecutionSchema.optional(),
}).passthrough();
export const localComputeFabricSchema = z.object({
  version: z.literal(LOCAL_COMPUTE_FABRIC_VERSION),
  hosts: z.array(computeHostSchema).max(256),
  runtimes: z.array(localRuntimeSchema).max(512),
  artifacts: z.array(modelArtifactSchema).max(5000),
  deployments: z.array(modelDeploymentSchema).max(2048),
  // One historical receipt stream INSIDE the existing native CAS registry.
  // Unknown future versions remain inert, bounded, and losslessly preserved.
  // Slice 5: native-authenticated v3 scopes contain exact policy-inclusive
  // deployment and executed backend/device/build identities. They exceed the
  // historical 4 KiB v1/v2 row ceiling; retain the SAME native-CAS receipt
  // stream and require a strict 12 KiB per-row UTF-8 cap (native total state
  // limit 2 MiB). No second qualification database or implicit grants.
  qualificationReceipts: z.array(z.unknown()).max(128).refine(rows =>
    rows.every(row => JSON.stringify(row) !== undefined &&
      new TextEncoder().encode(JSON.stringify(row)).length <= 12 * 1024)).optional(),
  // LM6: bounded *measurement* history, deliberately never an LM2F grant.
  // Unknown newer records remain inert and losslessly retained on read.
  // Exact v1 validation and current/stale selection live in the LM6 adapter.
  measurementRuns: z.array(z.unknown()).max(48).refine(rows =>
    rows.every(row => JSON.stringify(row)?.length <= 16 * 1024)).optional(),
}).passthrough();
export type ComputeHost = z.infer<typeof computeHostSchema>;
export type LocalRuntime = z.infer<typeof localRuntimeSchema>;
export type ModelArtifact = z.infer<typeof modelArtifactSchema>;
export type ModelDeployment = z.infer<typeof modelDeploymentSchema>;
export type LocalComputeFabric = z.infer<typeof localComputeFabricSchema>;

/** Keep unresolved or acknowledged native tickets within their original
 * bounded CAS history. If the oldest row is protected and the history is
 * full, fail closed rather than silently delete restart reconciliation. */
export function appendNativeSafeHistory(
  existing: readonly unknown[], additions: readonly unknown[], limit: number,
): unknown[] {
  const trim = Math.max(0, existing.length + additions.length - limit);
  if (existing.length + additions.length < 1 || trim > existing.length ||
      existing.slice(0, trim).some(row => !!row && typeof row === "object" &&
        "qualificationCas" in row))
    throw new Error("Native qualification history cannot evict an unresolved ticket");
  return [...existing.slice(trim), ...additions];
}
export type ResolvedModelDeployment = {
  host: ComputeHost;
  runtime: LocalRuntime;
  artifact: ModelArtifact;
  deployment: ModelDeployment;
  endpoint: SelfHostedEndpoint;
  profile: SelfHostedProfile;
  identity: string;
};

/**
 * LM2F: deployment evidence belongs to one active runtime instance and one
 * model configuration. A shared artifact digest is never a qualification
 * identity. Receipts are deliberately separate from the durable fabric graph:
 * this contract does not make a conceptual runtime executable or persist
 * qualification in the legacy Ollama profile.
 */
const evidenceTime = z.number().int().nonnegative();
export const deploymentRuntimeObservationSchema = z.object({
  runtimeId: name,
  configurationRevision: revision,
  version: small,
  epoch: name,
  observedAt: evidenceTime,
  /** Native-authenticated backend/device/variant/policy/build identity.
   * Optional for historic v1/v2 deployments and unmanaged runtimes. */
  executionIdentity: longIdentity.optional(),
}).strict();
export type DeploymentRuntimeObservation = z.infer<typeof deploymentRuntimeObservationSchema>;

export const deploymentQualificationScopeSchema = z.object({
  deploymentIdentity: longIdentity,
  hostId: name,
  runtimeId: name,
  runtimeType: small,
  runtimeProcessIdentity: z.string().max(1024).nullable(),
  runtimeConfigurationRevision: revision,
  runtimeVersion: small,
  runtimeEpoch: name,
  artifactId: longIdentity,
  artifactDigest: z.string().min(1).max(1024),
  artifactFormat: modelArtifactSchema.shape.format,
  /** A v3 proof is scoped to actual executed placement, not just its
   * requested policy. CUDA->CPU fallback cannot qualify later CUDA. */
  executionIdentity: longIdentity.optional(),
}).strict();
export type DeploymentQualificationScope = z.infer<typeof deploymentQualificationScopeSchema>;

export const deploymentQualificationReceiptSchema = z.object({
  version: z.literal(1),
  scope: deploymentQualificationScopeSchema,
  capability: z.enum(RUNTIME_CAPABILITIES),
  status: z.enum(["verified", "incomplete", "unsupported"]),
  verifiedAt: evidenceTime,
  expiresAt: evidenceTime,
}).strict().refine(receipt => receipt.expiresAt > receipt.verifiedAt &&
  receipt.expiresAt - receipt.verifiedAt <= 86_400_000);
/** V1 is recognized as historical only: no observed evidence or procedure was
 * recorded, so it is never sufficient for a new LM2F capability grant. */
export type HistoricalDeploymentQualificationReceipt = z.infer<typeof deploymentQualificationReceiptSchema>;

export const deploymentQualificationContextSchema = z.object({
  contextTokens: z.number().int().positive().max(8_388_608).optional(),
  personaId: name.optional(),
  systemContextDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  toolProtocol: small.optional(),
  toolSchemaDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  formatSchemaDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
}).strict();
export type DeploymentQualificationContext = z.infer<typeof deploymentQualificationContextSchema>;

/** V2 carries only bounded verifier-owned facts; never transcripts, paths or
 * provider-supplied capability claims. This is behavioral deployment proof,
 * not an artifact-scoped metadata declaration. */
export const deploymentQualificationEvidenceReceiptSchema = z.object({
  version: z.literal(2),
  scope: deploymentQualificationScopeSchema.extend({ deploymentId: longIdentity }).strict(),
  capability: z.enum(RUNTIME_CAPABILITIES),
  status: z.enum(["verified", "failed", "incomplete", "unsupported"]),
  verifiedAt: evidenceTime,
  expiresAt: evidenceTime,
  procedure: z.object({
    id: small,
    version: revision,
  }).strict(),
  context: deploymentQualificationContextSchema,
  evidence: z.object({
    source: z.enum(["clack-transport", "native-observation", "deterministic-evaluator", "legacy-ollama-tool-verification"]),
    reference: z.string().min(1).max(256),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    checks: z.array(z.object({
      id: small,
      result: z.enum(["pass", "fail", "incomplete"]),
    }).strict()).min(1).max(16),
  }).strict(),
}).passthrough().superRefine((receipt, ctx) => {
  if (receipt.expiresAt <= receipt.verifiedAt ||
      receipt.expiresAt - receipt.verifiedAt > 7 * 86_400_000)
    ctx.addIssue({ code: "custom", message: "Invalid qualification lifetime" });
  if (receipt.status === "verified" &&
      receipt.evidence.checks.some(check => check.result !== "pass"))
    ctx.addIssue({ code: "custom", message: "A verified qualification requires passing checks" });
  if (receipt.status === "failed" &&
      !receipt.evidence.checks.some(check => check.result === "fail"))
    ctx.addIssue({ code: "custom", message: "Failed qualification requires a failed check" });
  if (receipt.status === "unsupported" &&
      !receipt.evidence.checks.some(check => check.result === "fail"))
    ctx.addIssue({ code: "custom", message: "Unsupported requires an observed negative check" });
  if (receipt.status === "incomplete" &&
      !receipt.evidence.checks.some(check => check.result === "incomplete"))
    ctx.addIssue({ code: "custom", message: "Incomplete qualification requires incomplete evidence" });
  if (receipt.capability === "instruction-adherence" &&
      (!receipt.context.personaId || !receipt.context.systemContextDigest))
    ctx.addIssue({ code: "custom", message: "Adherence requires exact persona/system context" });
  if (["native-tools", "tool-protocol", "tool-arguments", "tool-results",
      "sequential-tools", "no-fabricated-effects", "parallel-tools"].includes(receipt.capability) &&
      (!receipt.context.toolProtocol || !receipt.context.toolSchemaDigest))
    ctx.addIssue({ code: "custom", message: "Tool qualification requires exact protocol/schema" });
  if (["json-schema", "grammar"].includes(receipt.capability) &&
      !receipt.context.formatSchemaDigest)
    ctx.addIssue({ code: "custom", message: "Constrained output requires schema/grammar identity" });
});
export type DeploymentQualificationEvidenceReceipt = z.infer<typeof deploymentQualificationEvidenceReceiptSchema>;
export type DeploymentQualificationReceipt =
  | HistoricalDeploymentQualificationReceipt | DeploymentQualificationEvidenceReceipt;
export type DeploymentQualificationState =
  "Verified" | "Unverified" | "Stale" | "Incomplete" | "Unsupported" | "Failed";

/** Procedure revisions are part of the authority policy, not untrusted
 * provider metadata. Bumping a verifier/protocol here invalidates its old
 * PASS receipts while keeping the original evidence for historical review.
 * No capability without a registered procedure can ever become qualified. */
export const CURRENT_DEPLOYMENT_QUALIFICATION_PROCEDURES = {
  chat: { id: "clack-managed-chat-bounded", version: 1 },
  streaming: { id: "clack-managed-chat-bounded", version: 1 },
  "terminal-completion": { id: "clack-managed-chat-bounded", version: 1 },
  "instruction-adherence": { id: "clack-instruction-adherence", version: 1 },
  "context-configuration": { id: "clack-context-qualification", version: 1 },
  "native-tools": { id: "clack-native-tools-qualification", version: 1 },
  "tool-protocol": { id: "clack-native-tools-qualification", version: 1 },
  "tool-arguments": { id: "clack-native-tools-qualification", version: 1 },
  "tool-results": { id: "clack-native-tools-qualification", version: 1 },
  "sequential-tools": { id: "clack-native-tools-qualification", version: 1 },
  "no-fabricated-effects": { id: "clack-native-tools-qualification", version: 1 },
  "parallel-tools": { id: "clack-native-tools-qualification", version: 1 },
  "json-mode": { id: "clack-structured-output-qualification", version: 1 },
  "json-schema": { id: "clack-structured-output-qualification", version: 1 },
  grammar: { id: "clack-structured-output-qualification", version: 1 },
} as const satisfies Partial<Record<RuntimeCapabilityName, { id: string; version: number }>>;

function currentQualificationProcedure(
  capability: RuntimeCapabilityName,
): { id: string; version: number } | undefined {
  return (CURRENT_DEPLOYMENT_QUALIFICATION_PROCEDURES as Partial<Record<
    RuntimeCapabilityName, { id: string; version: number }
  >>)[capability];
}

/** A fresh, external runtime observation is mandatory for all non-legacy proof. */
export function deploymentQualificationScope(
  fabric: LocalComputeFabric,
  deploymentId: string,
  observation: DeploymentRuntimeObservation | undefined,
  now = Date.now(),
): DeploymentQualificationScope | undefined {
  if (!observation || !deploymentRuntimeObservationSchema.safeParse(observation).success ||
      observation.observedAt > now || now - observation.observedAt >= 30_000)
    return;
  const deployment = fabric.deployments.find(row => row.id === deploymentId);
  const runtime = fabric.runtimes.find(row => row.id === deployment?.runtimeId);
  const host = fabric.hosts.find(row => row.id === deployment?.hostId);
  const artifact = fabric.artifacts.find(row => row.id === deployment?.artifactId);
  if (!deployment || !runtime || !host || !artifact ||
      fabric.deployments.filter(row => row.id === deploymentId).length !== 1 ||
      fabric.runtimes.filter(row => row.id === runtime.id).length !== 1 ||
      fabric.hosts.filter(row => row.id === host.id).length !== 1 ||
      fabric.artifacts.filter(row => row.id === artifact.id).length !== 1 ||
      !runtime.enabled || runtime.health !== "online" ||
      !host.enabled || host.reachability !== "online" ||
      runtime.hostId !== host.id || !host.runtimeIds.includes(runtime.id) ||
      deployment.runtimeId !== runtime.id ||
      deployment.configurationRevision !== runtime.configurationRevision ||
      observation.runtimeId !== runtime.id ||
      observation.configurationRevision !== runtime.configurationRevision ||
      (runtime.version !== undefined && runtime.version !== observation.version) ||
      (runtime.runtimeEpoch !== undefined && runtime.runtimeEpoch !== observation.epoch) ||
      // Unknown model contents or behavior cannot be certified by a stale path
      // or display name. The legacy Ollama bridge retains its own proven scope.
      !artifact.digest || !deployment.configurationIdentity?.trim() ||
      // A persisted v3 candidate list alone cannot confer a runtime's actual
      // backend/device/build trust. Require the independent native receipt key.
      (deployment.requestedExecution?.candidates && !observation.executionIdentity))
    return;
  const scope = deploymentQualificationScopeSchema.safeParse({
    deploymentIdentity: deploymentIdentity(deployment),
    hostId: host.id,
    runtimeId: runtime.id,
    runtimeType: runtime.type,
    runtimeProcessIdentity: runtime.processIdentity ?? null,
    runtimeConfigurationRevision: runtime.configurationRevision,
    runtimeVersion: observation.version,
    runtimeEpoch: observation.epoch,
    artifactId: artifact.id,
    artifactDigest: artifact.digest,
    artifactFormat: artifact.format,
    ...(observation.executionIdentity
      ? {executionIdentity: observation.executionIdentity} : {}),
  });
  return scope.success ? scope.data : undefined;
}

export function deploymentQualificationState(
  fabric: LocalComputeFabric,
  deploymentId: string,
  capability: RuntimeCapabilityName,
  observation: DeploymentRuntimeObservation | undefined,
  receipt?: DeploymentQualificationReceipt,
  now = Date.now(),
  context: DeploymentQualificationContext = {},
): DeploymentQualificationState {
  const deployment = fabric.deployments.find(row => row.id === deploymentId);
  const runtime = fabric.runtimes.find(row => row.id === deployment?.runtimeId);
  if (runtime && capabilityStatus(runtime, capability) === "unsupported")
    return "Unsupported";
  const historical = fabric.qualificationReceipts?.filter(row =>
    !!row && typeof row === "object" && "scope" in row &&
    (row as { scope?: { deploymentId?: unknown } }).scope?.deploymentId === deploymentId &&
    "capability" in row && row.capability === capability) ?? [];
  // If two observations have the same millisecond timestamp the last
  // appended record wins. Otherwise an older PASS could outrank an equally
  // timestamped later FAIL and accidentally resurrect revoked authority.
  const selected = receipt ?? (historical
    .map((record, index) => ({
      record, index, at: Number((record as { verifiedAt?: number }).verifiedAt ?? 0),
    }))
    .sort((a, b) => b.at - a.at || b.index - a.index)[0]
    ?.record as DeploymentQualificationReceipt | undefined);
  if (!selected) return "Unverified";
  // An abandoned native B03 prepared receipt is never usable. The exact
  // existing CAS must have durably acknowledged its operation identity.
  const qualifier = (selected as DeploymentQualificationReceipt & {
    qualificationCas?: { phase?: unknown; operationId?: unknown; nativeEpoch?: unknown };
  }).qualificationCas;
  if (qualifier && (qualifier.phase !== "acknowledged" ||
      typeof qualifier.operationId !== "string" ||
      typeof qualifier.nativeEpoch !== "string"))
    return "Incomplete";
  if (selected.version !== 2) return "Stale";
  const parsed = deploymentQualificationEvidenceReceiptSchema.safeParse(selected);
  const current = deploymentQualificationScope(fabric, deploymentId, observation, now);
  const requestedContext = deploymentQualificationContextSchema.safeParse(context);
  const expectedProcedure = currentQualificationProcedure(capability);
  if (!parsed.success || !current || !requestedContext.success || selected.capability !== capability ||
      !expectedProcedure || JSON.stringify(parsed.data.procedure) !== JSON.stringify(expectedProcedure) ||
      JSON.stringify(parsed.data.scope) !== JSON.stringify({ ...current, deploymentId }) ||
      JSON.stringify(parsed.data.context) !== JSON.stringify(requestedContext.data) ||
      selected.verifiedAt > now || selected.expiresAt <= now)
    return "Stale";
  if (selected.status === "incomplete") return "Incomplete";
  if (selected.status === "unsupported") return "Unsupported";
  if (selected.status === "failed") return "Failed";
  return "Verified";
}

/** An affirmative per-deployment receipt must also respect runtime support. */
export function deploymentCapabilityQualified(
  fabric: LocalComputeFabric,
  deploymentId: string,
  capability: RuntimeCapabilityName,
  observation: DeploymentRuntimeObservation | undefined,
  receipt?: DeploymentQualificationReceipt,
  now = Date.now(),
  context: DeploymentQualificationContext = {},
) {
  const deployment = fabric.deployments.find(row => row.id === deploymentId);
  const runtime = fabric.runtimes.find(row => row.id === deployment?.runtimeId);
  return !!runtime && deploymentQualificationState(
    fabric, deploymentId, capability, observation, receipt, now, context,
  ) === "Verified" && runtimeCapabilityAllows(runtime, capability, true);
}

/** Historical evidence is never silently promoted. Writes use the same
 * topology and compare-and-swap persistence as the rest of the fabric. */
export function recordDeploymentQualification(
  state: SelfHostedState,
  deploymentId: string,
  observation: DeploymentRuntimeObservation,
  value: DeploymentQualificationEvidenceReceipt,
  now = Date.now(),
): SelfHostedState {
  const receipt = deploymentQualificationEvidenceReceiptSchema.parse(value);
  const fabric = reconcileLocalComputeFabric(state);
  const verdict = deploymentQualificationState(
    fabric, deploymentId, receipt.capability, observation, receipt, now, receipt.context,
  );
  if (!["Verified", "Failed", "Incomplete", "Unsupported"].includes(verdict))
    throw new Error("Qualification result does not match the current execution identity");
  const runtime = fabric.runtimes.find(row => row.id ===
    fabric.deployments.find(row => row.id === deploymentId)?.runtimeId);
  if (!runtime || capabilityStatus(runtime, receipt.capability) === "unknown" ||
      (capabilityStatus(runtime, receipt.capability) === "unsupported" &&
        receipt.status !== "unsupported") ||
      (verdict === "Verified" && !runtimeCapabilityAllows(runtime, receipt.capability, true)))
    throw new Error("Runtime declaration cannot authorize this capability");
  const history = appendNativeSafeHistory(fabric.qualificationReceipts ?? [], [receipt], 128);
  return withLocalComputeFabric({
    ...state,
    fabric: localComputeFabricSchema.parse({ ...fabric, qualificationReceipts: history }),
  });
}

export function runtimeIdForEndpoint(endpointId: string) {
  return `runtime:${endpointId}`;
}
function backendType(endpoint: SelfHostedEndpoint) {
  return endpoint.backendHint ?? endpoint.detectedBackend ?? "openai-compatible-local";
}
function runtimeCapability(
  value: RuntimeCapability | undefined,
): RuntimeCapabilityStatus {
  return value && status.safeParse(value.status).success
    ? value.status as RuntimeCapabilityStatus : "unknown";
}
export function capabilityStatus(runtime: LocalRuntime, name: string): RuntimeCapabilityStatus {
  return runtimeCapability(runtime.capabilities[name]);
}
export function runtimeCapabilityAllows(
  runtime: LocalRuntime,
  name: string,
  deploymentQualified = false,
) {
  const status = capabilityStatus(runtime, name);
  const modelSpecific = ["native-tools", "reasoning-controls", "context-configuration",
    "json-mode", "json-schema", "grammar", "multimodal-input"].includes(name);
  return runtime.enabled && (!modelSpecific || deploymentQualified) &&
    (status === "supported" ||
      (deploymentQualified && status === "requires-qualification"));
}

export function artifactIdFor(
  runtime: LocalRuntime,
  profile: SelfHostedProfile,
) {
  // The only cross-host artifact equality claim is a digest supplied by the
  // runtime. With no digest, identity is runtime-local and explicitly opaque.
  return profile.modelRevision
    ? JSON.stringify(["digest", profile.modelRevision])
    : JSON.stringify(["opaque", runtime.id, profile.transportModelId]);
}
function configuredBehavior(profile: SelfHostedProfile) {
  // The captured transport changes only when settings affecting behavior do.
  // Do not key timestamps, health, token counts, or transient runtime probes.
  return JSON.stringify(Object.entries(profile.overrides)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([field, pin]) => [field, pin?.evidence.value ?? null]));
}
export function deploymentIdentity(
  deployment: ModelDeployment,
): string {
  const base = [
    deployment.hostId, deployment.runtimeId, deployment.artifactId,
    deployment.runtimeModelName, deployment.configurationRevision,
    deployment.variantId ?? null, deployment.configurationIdentity ?? null,
  ];
  // Preserve every legacy identity byte-for-byte; only explicit new requests
  // participate in a new deployment's identity.
  return JSON.stringify(deployment.requestedExecution
    ? [...base, requestedExecutionSchema.parse(deployment.requestedExecution)] : base);
}
/** Canonical request bytes for persisted v3 identity and native attestation. */
export function executionPolicyIdentity(request: RequestedExecution): string {
  return JSON.stringify(requestedExecutionSchema.parse(request));
}
function unique<T extends { id: string }>(rows: T[]): T[] {
  return [...new Map(rows.map(row => [row.id, row])).values()];
}

/** Retain future inert metadata without carrying stale routing/trust fields
 * from a previous endpoint revision into an authoritative projection. */
function inertExtensions(row: Record<string, unknown> | undefined, known: Record<string, unknown>) {
  if (!row) return {};
  return Object.fromEntries(Object.entries(row).filter(([key]) => !(key in known)));
}

/**
 * Reconcile from authoritative endpoint/profile/inventory snapshots. Native
 * discovery may update those while Clack is running, independently of the
 * additive fabric cache. Never use the persisted cache to override the
 * endpoint address, selected digest or qualification scope.
 */
export function reconcileLocalComputeFabric(state: SelfHostedState): LocalComputeFabric {
  const saved = state.fabric;
  const hosts = (saved?.hosts ?? []).map(host => ({
    ...host, runtimeIds: [...host.runtimeIds],
  }));
  const runtimes = [...(saved?.runtimes ?? [])];
  const artifacts = [...(saved?.artifacts ?? [])];
  // Only independent conceptual deployments may survive without a legacy
  // profile. Never rehydrate a deleted model from a cached projection.
  const activeProfileIds = new Set(state.profiles.map(profile => profile.id));
  const deployments = (saved?.deployments ?? []).filter(row =>
    !row.profileId || activeProfileIds.has(row.profileId));
  for (const endpoint of state.endpoints) {
    const inventory = state.inventories?.find(row =>
      row.endpointId === endpoint.id &&
      row.configurationRevision === endpoint.configurationRevision);
    const previousRuntime = runtimes.find(row => row.legacyEndpointId === endpoint.id)
      ?? runtimes.find(row => row.id === runtimeIdForEndpoint(endpoint.id));
    const runtimeId = previousRuntime?.id ?? runtimeIdForEndpoint(endpoint.id);
    const hostId = previousRuntime?.hostId ?? endpoint.id;
    const previousHost = hosts.find(row => row.id === hostId);
    const runtime: LocalRuntime = {
      ...inertExtensions(previousRuntime, localRuntimeSchema.shape),
      id: runtimeId, hostId,
      // Runtime identity is independent of the machine name and endpoint.
      type: previousRuntime?.configurationRevision === endpoint.configurationRevision
        ? previousRuntime.type : backendType(endpoint),
      displayName: previousRuntime?.displayName ?? (
        backendType(endpoint) === "ollama" ? "Ollama" : endpoint.alias),
      legacyEndpointId: endpoint.id,
      enabled: endpoint.enabled !== false && endpoint.deletedAt === undefined,
      configurationRevision: endpoint.configurationRevision,
      health: !inventory ? "unknown" : inventory.connected ? "online" : "offline",
      ...(inventory?.version ? { version: inventory.version } : {}),
      ...(previousRuntime?.processIdentity ? { processIdentity: previousRuntime.processIdentity } : {}),
      capabilities: backendType(endpoint) === "ollama"
        ? { ...ollamaRuntimeCapabilities(inventory?.connected, inventory?.version),
            ...(previousRuntime?.configurationRevision === endpoint.configurationRevision
              ? previousRuntime.capabilities : {}) }
        : previousRuntime?.capabilities ?? {},
    };
    const host: ComputeHost = {
      ...inertExtensions(previousHost, computeHostSchema.shape),
      id: hostId,
      displayName: previousHost && previousHost.id !== endpoint.id
        ? previousHost.displayName : endpoint.alias,
      location: endpoint.location ?? previousHost?.location ?? "unknown",
      // Legacy endpoint availability belongs to its runtime. A disabled
      // endpoint must not permanently disable the physical host on re-enable.
      enabled: previousHost?.enabled ?? true,
      reachability: !inventory ? "unknown" : inventory.connected ? "online" : "offline",
      ...(previousHost?.os ? { os: previousHost.os } : {}),
      ...(previousHost?.hardwareProfileId ? { hardwareProfileId: previousHost.hardwareProfileId } : {}),
      runtimeIds: unique([...runtimes.filter(row => row.hostId === hostId), runtime].map(row => ({id: row.id})))
        .map(row => row.id),
    };
    const hostIndex = hosts.findIndex(row => row.id === hostId);
    if (hostIndex >= 0) hosts[hostIndex] = host;
    else hosts.push(host);
    const runtimeIndex = runtimes.findIndex(row => row.id === runtimeId);
    if (runtimeIndex >= 0) runtimes[runtimeIndex] = runtime;
    else runtimes.push(runtime);
    for (const profile of state.profiles.filter(p => p.endpointId === endpoint.id)) {
      const model = inventory?.models.find(m => m.id === profile.transportModelId &&
        (!profile.modelRevision || m.digest === profile.modelRevision));
      const artifactId = artifactIdFor(runtime, profile);
      const artifact: ModelArtifact = {
        id: artifactId,
        // A saved display label belongs to a deployment/profile, not shared
        // model files. Same-digest artifacts may have different user labels.
        displayName: model?.name ?? profile.transportModelId,
        format: backendType(endpoint) === "ollama" && profile.modelRevision ? "ollama-manifest" : "opaque",
        ...(profile.modelRevision ? { digest: profile.modelRevision } : {}),
        ...(model?.family ? { family: model.family } : {}),
        ...(model?.parameterSize ? { parameterSize: model.parameterSize } : {}),
        ...(model?.quantizationLevel ? { quantization: model.quantizationLevel } : {}),
        ...(model?.size !== undefined ? { size: model.size } : {}),
        provenance: model ? "runtime-inventory" : "unknown",
      };
      const ai = artifacts.findIndex(a => a.id === artifactId);
      if (ai < 0) artifacts.push(artifact);
      else artifacts[ai] = { ...artifacts[ai], ...artifact };
      const deployment: ModelDeployment = {
        id: profile.id, profileId: profile.id,
        hostId, runtimeId, artifactId,
        runtimeModelName: profile.transportModelId,
        configurationRevision: endpoint.configurationRevision,
        variantId: profile.deploymentId,
        configurationIdentity: configuredBehavior(profile),
      };
      const di = deployments.findIndex(d => d.id === profile.id);
      if (di < 0) deployments.push(deployment);
      else deployments[di] = deployment;
    }
  }
  // Preserve conceptual future runtimes, including uninstalled LM2D entries.
  // Never turn one into an active adapter merely because its type is named.
  for (const host of hosts) {
    const hosted = runtimes.filter(r => r.hostId === host.id);
    host.runtimeIds = unique(hosted
      .map(r => ({ id: r.id }))).map(r => r.id);
    host.reachability = hosted.some(r => r.health === "online")
      ? "online" : hosted.length && hosted.every(r => r.health === "offline")
        ? "offline" : "unknown";
  }
  return localComputeFabricSchema.parse({
    ...(saved ?? {}),
    version: LOCAL_COMPUTE_FABRIC_VERSION,
    hosts: unique(hosts), runtimes: unique(runtimes),
    artifacts: unique(artifacts), deployments: unique(deployments),
  });
}

export function withLocalComputeFabric(state: SelfHostedState): SelfHostedState {
  const projected = reconcileLocalComputeFabric(state);
  // LM2A profile/inventory rows remain the ONLY persisted owners of their
  // artifact/deployment facts. Save just the durable host/runtime topology and
  // genuinely independent conceptual artifacts/deployments. Duplicating every
  // legacy model would create a second writable registry and bloat the native
  // 2 MiB CAS envelope; derive those rows on read instead.
  const legacyArtifacts = new Set(projected.deployments.filter(d => d.profileId)
    .map(d => d.artifactId));
  const conceptual = projected.deployments.filter(d => !d.profileId);
  const conceptualArtifacts = new Set(conceptual.map(d => d.artifactId));
  const fabric: LocalComputeFabric = {
    ...projected,
    artifacts: projected.artifacts.filter(a =>
      !legacyArtifacts.has(a.id) || conceptualArtifacts.has(a.id)),
    deployments: conceptual,
  };
  return state.fabric && JSON.stringify(state.fabric) === JSON.stringify(fabric)
    ? state : { ...state, fabric };
}

export function resolveModelDeployment(
  state: SelfHostedState,
  profile: SelfHostedProfile,
): ResolvedModelDeployment | undefined {
  const endpoint = state.endpoints.find(e => e.id === profile.endpointId);
  if (!endpoint || endpoint.deletedAt !== undefined || endpoint.enabled === false ||
      state.endpoints.filter(e => e.id === endpoint.id).length !== 1 ||
      state.profiles.filter(p => p.id === profile.id).length !== 1) return;
  const fabric = reconcileLocalComputeFabric(state);
  const deployment = fabric.deployments.find(d => d.id === profile.id && d.profileId === profile.id);
  const runtime = fabric.runtimes.find(r => r.id === deployment?.runtimeId);
  const host = fabric.hosts.find(h => h.id === deployment?.hostId);
  const artifact = fabric.artifacts.find(a => a.id === deployment?.artifactId);
  // The compatibility projection deliberately de-duplicates stale cache
  // rows. It must not conceal ambiguous *persisted* identities at admission.
  const saved = state.fabric;
  if (saved && [
    [saved.hosts, host?.id],
    [saved.runtimes, runtime?.id],
    [saved.artifacts, artifact?.id],
    [saved.deployments, deployment?.id],
  ].some(([rows, id]) => !!id && (rows as { id: string }[]).filter(row => row.id === id).length > 1))
    return;
  if (!deployment || !runtime || !host || !artifact || !host.enabled ||
      !runtime.enabled || runtime.legacyEndpointId !== endpoint.id ||
      runtime.hostId !== host.id ||
      deployment.configurationRevision !== endpoint.configurationRevision ||
      deployment.artifactId !== artifactIdFor(runtime, profile) ||
      deployment.runtimeModelName !== profile.transportModelId ||
      runtime.configurationRevision !== endpoint.configurationRevision ||
      runtime.type !== backendType(endpoint)) return;
  return { host, runtime, artifact, deployment, endpoint, profile,
    identity: deploymentIdentity(deployment) };
}

/**
 * LM2B bridge for existing LM2A qualification receipts. Those receipts are
 * owned by endpoint/model/digest/revision/epoch, not a free-floating artifact.
 * Only the one-to-one migrated runtime may consume them. LM2D must introduce
 * a new runtime-specific qualification scope for its separate deployments;
 * no managed-runtime proof is fabricated by this compatibility bridge.
 */
export function acceptsLegacyDeploymentQualification(
  state: SelfHostedState,
  profile: SelfHostedProfile,
  resolved?: ResolvedModelDeployment,
) {
  const target = resolved ?? resolveModelDeployment(state, profile);
  return !!target &&
    target.runtime.type === "ollama" &&
    target.runtime.id === runtimeIdForEndpoint(profile.endpointId) &&
    target.host.id === profile.endpointId &&
    target.deployment.id === profile.id &&
    target.artifact.id === artifactIdFor(target.runtime, profile);
}

/** A future LM2D managed runtime can be represented now, but not executed. */
export function addConceptualRuntime(
  state: SelfHostedState, runtime: LocalRuntime, host: ComputeHost,
  artifact?: ModelArtifact, deployment?: ModelDeployment,
): SelfHostedState {
  const fabric = reconcileLocalComputeFabric(state);
  if (fabric.runtimes.some(r => r.id === runtime.id) ||
      (fabric.hosts.some(h => h.id === host.id) &&
        !fabric.hosts.find(h => h.id === host.id)?.enabled))
    throw new Error("Duplicate runtime identity or disabled host");
  if (runtime.hostId !== host.id || deployment &&
      (deployment.hostId !== host.id || deployment.runtimeId !== runtime.id ||
       deployment.artifactId !== artifact?.id))
    throw new Error("Invalid conceptual deployment ownership");
  const hosts = fabric.hosts.map(current => current.id === host.id ? {
    ...current, runtimeIds: [...current.runtimeIds, runtime.id],
  } : current);
  return {
    ...state,
    fabric: localComputeFabricSchema.parse({
      ...fabric,
      hosts: fabric.hosts.some(h => h.id === host.id)
        ? hosts : [...hosts, { ...host, runtimeIds: [...new Set([...host.runtimeIds, runtime.id])] }],
      runtimes: [...fabric.runtimes, runtime],
      artifacts: artifact ? unique([...fabric.artifacts, artifact]) : fabric.artifacts,
      deployments: deployment ? [...fabric.deployments, deployment] : fabric.deployments,
    }),
  };
}
