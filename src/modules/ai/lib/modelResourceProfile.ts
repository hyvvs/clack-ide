import { z } from "zod";
import { type EvidenceValue, evidence, unknown } from "./hardwareProfile";
import type {
  ActualExecution,
  LocalRuntime,
  ModelArtifact,
  ModelDeployment,
} from "./localComputeFabric";
import { deploymentIdentity, executionPolicyIdentity, requestedExecutionSchema } from "./localComputeFabric";
import {
  MANAGED_LLAMA_ENGINE_VERSION,
  MANAGED_LOCAL_RUNTIME_ID,
  MANAGED_LOCAL_RUNTIME_TYPE,
  managedExecutionPolicyConfigurationIdentity,
  managedExecutionPolicyDeploymentId,
  managedLocalMaterialSchema,
} from "./managedLocalModels";

const positive = z.number().int().positive().safe().nullable().optional();
/** GGUF header fields are collected by the existing bounded native importer,
 * then checked again from its content-addressed private file by digest. */
export const nativeGgufResourceSchema = z
  .object({
    digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    size: z.number().int().positive().safe(),
    format: z.literal("gguf"),
    family: z.string().nullable().optional(),
    quantization: z.string().nullable().optional(),
    declaredContext: positive,
    fileIdentity: z.string().min(1).max(1024),
    blockCount: positive,
    embeddingLength: positive,
    attentionHeadCount: positive,
    attentionHeadCountKv: positive,
    attentionKeyLength: positive,
    attentionValueLength: positive,
  })
  .passthrough();
export type NativeGgufResource = z.infer<typeof nativeGgufResourceSchema>;

export type ExecutionPlacement = "CPU" | "GPU" | "Hybrid" | "Unknown";
export type ModelResourceProfile = {
  deploymentId: string;
  runtimeId: string;
  artifactId: string;
  configurationRevision: number;
  configurationIdentity: string | null;
  artifactDigest: string | null;
  artifactSizeBytes: EvidenceValue<number>;
  parameterCount: EvidenceValue<number>;
  quantization: EvidenceValue<string>;
  architecture: EvidenceValue<string>;
  declaredMaximumContext: EvidenceValue<number>;
  configuredContext: EvidenceValue<number>;
  concurrency: EvidenceValue<number>;
  executionPlacement: EvidenceValue<ExecutionPlacement>;
  /** Requested cap is an identity/configuration fact, not measured offload. */
  requestedGpuLayers: EvidenceValue<number>;
  /** V3 is independently observed layers, never a copy of its requested cap. */
  gpuLayers: EvidenceValue<number>;
  totalLayers: EvidenceValue<number>;
  weightMemoryBytes: EvidenceValue<number>;
  runtimeOverheadBytes: EvidenceValue<number>;
  batchOverheadBytes: EvidenceValue<number>;
  kvBytesPerToken: EvidenceValue<number>;
  kvPrecisionBytes: EvidenceValue<number>;
};

const MiB = 1024 * 1024;
function parseCount(label: string): number | null {
  const parsed = /^(\d+(?:\.\d+)?)\s*([KMBT])$/i.exec(label.trim());
  if (!parsed) return null;
  const count =
    Number(parsed[1]) *
    ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[parsed[2].toUpperCase()] ?? 0);
  return Number.isSafeInteger(count) && count > 0 ? count : null;
}

function configuredMaterial(
  deployment: ModelDeployment,
  runtime: LocalRuntime,
) {
  if (
    runtime.type !== MANAGED_LOCAL_RUNTIME_TYPE ||
    !deployment.configurationIdentity
  )
    return null;
  try {
    return (
      managedLocalMaterialSchema.safeParse(
        JSON.parse(deployment.configurationIdentity),
      ).data ?? null
    );
  } catch {
    return null;
  }
}

/** Do not take a context from a renderer candidate or from a merely plausible
 * JSON configuration. V3 context is valid only when the canonical config,
 * complete persisted policy and digest-derived deployment ID all agree. */
function managedV3Configuration(
  artifact: ModelArtifact, runtime: LocalRuntime, deployment: ModelDeployment,
): { context: number; requestedGpuLayers: number | null; policyIdentity: string } | null {
  if (runtime.id !== MANAGED_LOCAL_RUNTIME_ID ||
      runtime.type !== MANAGED_LOCAL_RUNTIME_TYPE ||
      runtime.version !== MANAGED_LLAMA_ENGINE_VERSION ||
      deployment.runtimeId !== runtime.id ||
      deployment.configurationRevision !== runtime.configurationRevision ||
      deployment.variantId !== undefined || !deployment.configurationIdentity ||
      !artifact.digest || deployment.artifactId !== artifact.id) return null;
  try {
    const config: unknown = JSON.parse(deployment.configurationIdentity);
    if (!config || typeof config !== "object" || Array.isArray(config) ||
        !("version" in config) || config.version !== 3 ||
        !("context" in config) || typeof config.context !== "number") return null;
    const context = config.context;
    const requested = requestedExecutionSchema.safeParse(deployment.requestedExecution);
    if (!requested.success || !requested.data.candidates?.length ||
        requested.data.contextLength !== context ||
        deployment.configurationIdentity !== managedExecutionPolicyConfigurationIdentity(context) ||
        deployment.id !== managedExecutionPolicyDeploymentId(artifact.digest, context, requested.data) ||
        JSON.stringify(deployment.requestedExecution) !== executionPolicyIdentity(requested.data))
      return null;
    return {context, requestedGpuLayers: requested.data.gpuLayers ?? null,
      policyIdentity: executionPolicyIdentity(requested.data)};
  } catch { return null; }
}

/** Source-of-truth: exact fabric artifact + a digest-checked native GGUF
 * header, when available. Never infer parameters/quantization from name. */
export function projectModelResourceProfile(
  artifact: ModelArtifact,
  runtime: LocalRuntime,
  deployment: ModelDeployment,
  native?: NativeGgufResource | null,
  /** Only pass an authenticated result of observedActualExecution. A selected
   * plan or native status's unverified backend hints are not observations. */
  verifiedActual?: ActualExecution | null,
): ModelResourceProfile {
  const candidate = nativeGgufResourceSchema.safeParse(native);
  const importedIdentityValid =
    !!artifact.digest &&
    !!artifact.fileIdentity &&
    artifact.size !== undefined &&
    artifact.fileIdentity === `${artifact.digest.slice(7)}:${artifact.size}`;
  const inspected =
    candidate.success &&
    artifact.format === "gguf" &&
    candidate.data.digest === artifact.digest &&
    (artifact.size === undefined || artifact.size === candidate.data.size) &&
    (artifact.fileIdentity === undefined ||
      artifact.fileIdentity === candidate.data.fileIdentity) &&
    candidate.data.fileIdentity ===
      `${candidate.data.digest.slice(7)}:${candidate.data.size}`
      ? candidate.data
      : null;
  const size = inspected?.size ?? artifact.size;
  const sizeSource = inspected
    ? "native-imported-gguf-sha256-rechecked"
    : artifact.provenance === "runtime-inventory"
      ? "backend-reported-model-inventory"
      : artifact.provenance === "user-supplied" && importedIdentityValid
        ? "native-import-inspection"
        : "persisted-artifact-declaration";
  const sizeProvenance =
    inspected || importedIdentityValid
      ? ("Measured" as const)
      : ("Derived" as const);
  const sizeValue =
    size !== undefined && Number.isSafeInteger(size) && size > 0
      ? evidence(size, "bytes", sizeProvenance, sizeSource)
      : unknown<number>("bytes", "Artifact byte size unavailable");
  const parameter = artifact.parameterSize
    ? parseCount(artifact.parameterSize)
    : null;
  const material = configuredMaterial(deployment, runtime);
  const v3 = managedV3Configuration(artifact, runtime, deployment);
  const actual = v3 && verifiedActual?.executionReceipt?.deploymentId === deployment.id &&
    verifiedActual.executionReceipt.deploymentIdentity === deploymentIdentity(deployment) &&
    verifiedActual.executionReceipt.policyIdentity === v3.policyIdentity &&
    verifiedActual.contextLength === v3.context &&
    (verifiedActual.backend === "cpu" || verifiedActual.backend === "cuda")
    ? verifiedActual : null;
  let context = v3?.context ?? material?.context ?? null;
  // V3 declares a context, not an independently verified concurrency setting.
  let parallel: number | null = material ? 1 : null;
  if (
    !material &&
    runtime.type !== MANAGED_LOCAL_RUNTIME_TYPE &&
    deployment.configurationIdentity
  ) {
    try {
      const entries: unknown = JSON.parse(deployment.configurationIdentity);
      if (Array.isArray(entries)) {
        const pairs = entries.filter(
          (entry): entry is [string, unknown] =>
            Array.isArray(entry) &&
            entry.length === 2 &&
            typeof entry[0] === "string",
        );
        const field = (key: string) =>
          pairs.find((entry) => entry[0] === key)?.[1];
        const ctx = field("configuredContext");
        if (typeof ctx === "number" && Number.isSafeInteger(ctx) && ctx > 0)
          context = ctx;
        const count = field("concurrentGenerations");
        if (
          typeof count === "number" &&
          Number.isSafeInteger(count) &&
          count >= 1 &&
          count <= 64
        )
          parallel = count;
      }
    } catch {
      /* malformed configuration is unknown; not permission to guess */
    }
  }
  const nativeMax = inspected?.declaredContext;
  const maximum = nativeMax ?? artifact.declaredContext;
  const blocks = inspected?.blockCount;
  const kvHeads = inspected?.attentionHeadCountKv;
  const heads = inspected?.attentionHeadCount;
  const width = inspected?.embeddingLength;
  const defaultHeadDim =
    width && heads && width % heads === 0 ? width / heads : null;
  const keyDim = inspected?.attentionKeyLength ?? defaultHeadDim;
  const valueDim = inspected?.attentionValueLength ?? defaultHeadDim;
  const elements =
    blocks && kvHeads && keyDim && valueDim
      ? blocks * kvHeads * (keyDim + valueDim)
      : null;
  const validElements =
    elements !== null && Number.isSafeInteger(elements) && elements > 0;
  // Legacy v1 is pinned CPU. For v3, only independently observed native
  // execution (not a CUDA request, selected plan or host GPU) proves backend.
  const cpuOnly =
    runtime.type === MANAGED_LOCAL_RUNTIME_TYPE && material?.gpu === 0;
  const placement: ExecutionPlacement | null = actual?.backend === "cpu" ? "CPU" :
    actual?.backend === "cuda" ?
      (blocks && actual.gpuLayers < blocks ? "Hybrid" : "GPU") : null;
  return {
    deploymentId: deployment.id,
    runtimeId: runtime.id,
    artifactId: artifact.id,
    configurationRevision: deployment.configurationRevision,
    configurationIdentity: deployment.configurationIdentity ?? null,
    artifactDigest: artifact.digest ?? null,
    artifactSizeBytes: sizeValue,
    parameterCount:
      parameter !== null
        ? evidence(
            parameter,
            "parameters",
            "Derived",
            "backend-reported-parameter-label",
            null,
            [
              "SI suffix parsed from runtime inventory; not verified parameter tensor count",
            ],
          )
        : unknown("parameters", "No parseable verified parameter count"),
    quantization:
      inspected?.quantization || artifact.quantization
        ? evidence(
            (inspected?.quantization || artifact.quantization)!,
            "format",
            "Derived",
            inspected?.quantization
              ? "native-gguf-header"
              : "fabric-artifact-metadata",
            null,
            ["Quantization label does not measure inference memory"],
          )
        : unknown(
            "format",
            "Quantization metadata unavailable; no filename inference",
          ),
    architecture:
      inspected?.family || artifact.family
        ? evidence(
            (inspected?.family || artifact.family)!,
            "architecture",
            "Derived",
            inspected?.family
              ? "native-gguf-header"
              : "fabric-artifact-metadata",
          )
        : unknown("architecture", "Architecture metadata unavailable"),
    declaredMaximumContext:
      maximum !== undefined && maximum !== null
        ? evidence(
            maximum,
            "tokens",
            "Derived",
            nativeMax != null
              ? "native-gguf-header"
              : "fabric-artifact-metadata",
            null,
            ["Model-declared limit is not an observed working context"],
          )
        : unknown("tokens", "No model-declared maximum context"),
    configuredContext:
      context !== null
        ? evidence(
            context,
            "tokens",
            "Derived",
            "exact-deployment-configuration",
          )
        : unknown(
            "tokens",
            "No configured context in exact deployment identity",
          ),
    concurrency:
      parallel !== null
        ? evidence(
            parallel,
            "requests",
            "Derived",
            "exact-deployment-configuration",
          )
        : unknown(
            "requests",
            "Concurrency unknown; do not assume one for capacity",
          ),
    executionPlacement: actual && placement !== null
      ? evidence<ExecutionPlacement>(placement, "placement", "Measured",
          actual.source, actual.observedAt,
          ["Native-verified backend/offload; placement does not measure GPU memory residency"])
      : cpuOnly
      ? evidence<ExecutionPlacement>(
          "CPU",
          "placement",
          "Derived",
          "pinned-b12248-cpu-only-config",
        )
      : unknown<ExecutionPlacement>(
          "placement",
          "No authoritative CPU/GPU allocation observation",
        ),
    requestedGpuLayers: v3?.requestedGpuLayers !== null && v3?.requestedGpuLayers !== undefined
      ? evidence(v3.requestedGpuLayers, "layers", "Derived", "exact-v3-persisted-policy-cap")
      : material ? evidence(material.gpu, "layers", "Derived", "exact-deployment-configuration")
      : unknown("layers", "No canonical requested GPU layer cap"),
    gpuLayers: actual
      ? evidence(actual.gpuLayers, "layers", "Measured", actual.source, actual.observedAt)
      : v3
        ? unknown("layers", "V3 actual offload requires native Ready execution receipt")
        : material
      ? evidence(
          material.gpu,
          "layers",
          "Derived",
          "exact-deployment-configuration",
        )
      : unknown("layers", "GPU layer count not known"),
    totalLayers: blocks
      ? evidence(blocks, "layers", "Derived", "native-gguf-header")
      : unknown("layers", "Transformer block count unknown"),
    weightMemoryBytes:
      sizeValue.value !== null
        ? evidence(
            Math.ceil(sizeValue.value * 1.08),
            "bytes",
            "Estimated",
            sizeSource,
            null,
            [
              "Estimated 1.08x artifact byte size for resident quantized weights/alignment; not measured RAM",
            ],
          )
        : unknown("bytes", "Cannot estimate weights without artifact bytes"),
    runtimeOverheadBytes: material
      ? evidence(
          256 * MiB,
          "bytes",
          "Estimated",
          "llama-cpp-cpu-heuristic-v1",
          null,
          [
            "Assumes 256 MiB non-weight process/runtime overhead, not a measured value",
          ],
        )
      : unknown(
          "bytes",
          "Runtime overhead not measured/estimated for this backend",
        ),
    batchOverheadBytes: material
      ? evidence(
          64 * MiB,
          "bytes",
          "Estimated",
          "llama-cpp-cpu-heuristic-v1",
          null,
          [
            "Assumes 64 MiB batch/compute buffers; actual allocation depends on backend and batch settings",
          ],
        )
      : unknown("bytes", "Batch/compute overhead unknown for this runtime"),
    kvBytesPerToken: validElements
      ? evidence(
          elements!,
          "elements/token",
          "Derived",
          "native-gguf-attention-dimensions",
          null,
          ["block count × KV heads × (key head width + value head width)"],
        )
      : unknown(
          "elements/token",
          "KV head/dimension/block metadata missing; context memory cannot be calculated",
        ),
    kvPrecisionBytes: material
      ? evidence(
          2,
          "bytes/element",
          "Estimated",
          "assumed-default-fp16-kv-v1",
          null,
          [
            "Assumes fp16 KV; no cache precision observation; different KV type changes requirements",
          ],
        )
      : unknown("bytes/element", "KV cache precision unknown for this runtime"),
  };
}
