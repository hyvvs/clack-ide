import { z } from "zod";
import type { ModelInfo } from "@/modules/ai/config";
import {
  deploymentIdentity,
  localComputeFabricSchema,
  requestedExecutionSchema,
  reconcileLocalComputeFabric,
  withLocalComputeFabric,
  type ComputeHost,
  type LocalComputeFabric,
  type LocalRuntime,
  type ModelArtifact,
  type ModelDeployment,
  type RequestedExecution,
} from "@/modules/ai/lib/localComputeFabric";
import type { SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import type { ModelTransportIdentity } from "@/modules/ai/lib/savedProviderModels";

/** LM2D conceptual model registration; actual native routes remain separately gated. */
export const MANAGED_LOCAL_SELECTION_PREFIX = "managed-local:";
export const MANAGED_LOCAL_HOST_ID = "clack-this-pc";
export const MANAGED_LOCAL_RUNTIME_ID = "clack-managed-llama.cpp";
export const MANAGED_LOCAL_RUNTIME_TYPE = "clack-managed-llama.cpp";
export const MANAGED_LLAMA_ENGINE_VERSION = "b12248";
/** A pre-LM2F managed registration predates these two *verifier protocols*.
 * Their absence must not prevent recording an observed negative result.
 * This is a pure, read-only declaration projection, NEVER a capability PASS;
 * an explicit persisted `unsupported`/`unknown` remains authoritative. */
export function projectManagedQualificationDeclarations(runtime: LocalRuntime): LocalRuntime {
  if (runtime.id !== MANAGED_LOCAL_RUNTIME_ID ||
      runtime.type !== MANAGED_LOCAL_RUNTIME_TYPE ||
      runtime.version !== MANAGED_LLAMA_ENGINE_VERSION ||
      (runtime.capabilities["terminal-completion"] !== undefined &&
        runtime.capabilities["instruction-adherence"] !== undefined)) return runtime;
  return {
    ...runtime,
    capabilities: {
      "terminal-completion": { status: "requires-qualification", source: "declared" },
      "instruction-adherence": { status: "requires-qualification", source: "declared" },
      ...runtime.capabilities,
    },
  };
}
const ggufDigest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export const managedLocalMaterialSchema = z.object({
  version: z.literal(1),
  context: z.number().int().min(512).max(131_072),
  gpu: z.literal(0),
  tool: z.literal(false),
  grammar: z.literal(false),
}).strict();
export type ManagedLocalMaterial = z.infer<typeof managedLocalMaterialSchema>;
/** V2 material is an explicitly accelerated deployment variant, not a rewrite
 * of the original v1 CPU configuration or the Qwen qualification identity. */
const managedCudaMaterialSchema = z.object({
  version: z.literal(2), context: z.number().int().min(512).max(131_072),
  tool: z.literal(false), grammar: z.literal(false),
}).strict();
export function managedCudaConfigurationIdentity(context: number): string {
  const material = managedCudaMaterialSchema.parse({version:2,context,tool:false,grammar:false});
  return JSON.stringify(material);
}
const cudaDeviceId = z.string().regex(/^clack-this-pc:accelerator:GPU-[0-9a-fA-F-]{12,96}$/);
export function managedCudaDeploymentId(
  digest: string, context: number, gpuLayers: number,
  deviceId: string, policy: "disabled" | "allow-compatible",
): string {
  return JSON.stringify(["managed-gguf-cuda",ggufDigest.parse(digest),
    managedCudaConfigurationIdentity(context),gpuLayers,cudaDeviceId.parse(deviceId),policy]);
}

/** Registers a distinct model deployment under the EXISTING host, runtime and
 * content-addressed artifact. No process runs, no legacy record is modified. */
export function attachManagedCudaVariant(
  state: SelfHostedState, sourceSelectionId: string,
  options: {deviceId: string; gpuLayers: number; fallback: "disabled" | "allow-compatible"},
): {state:SelfHostedState;selectionId:string} {
  const source = resolveManagedLocalSelection(state,sourceSelectionId);
  if (source.status !== "available" && source.status !== "unavailable")
    throw new Error("CUDA deployment requires an existing verified managed GGUF registration");
  const {artifact,runtime,host,deployment} = source;
  if (runtime.id !== MANAGED_LOCAL_RUNTIME_ID || host.id !== MANAGED_LOCAL_HOST_ID ||
      deployment.requestedExecution) throw new Error("CUDA variant must originate from a legacy CPU managed deployment");
  if (!artifact.digest) throw new Error("Managed CUDA variant requires the original content-addressed GGUF digest");
  const material = managedLocalMaterialSchema.parse(JSON.parse(deployment.configurationIdentity ?? "null"));
  const deviceId = cudaDeviceId.parse(options.deviceId);
  if (!Number.isSafeInteger(options.gpuLayers) || options.gpuLayers < 1 || options.gpuLayers > 999)
    throw new Error("CUDA GPU layer count must be between 1 and 999");
  const requested: RequestedExecution = requestedExecutionSchema.parse({
    backend:"cuda",deviceIds:[deviceId],gpuLayers:options.gpuLayers,
    contextLength:material.context,fallback:{policy:options.fallback},
  });
  const cuda: ModelDeployment = {
    id:managedCudaDeploymentId(artifact.digest,material.context,options.gpuLayers,deviceId,options.fallback),
    hostId:host.id,runtimeId:runtime.id,artifactId:artifact.id,
    runtimeModelName:deployment.runtimeModelName,
    configurationRevision:runtime.configurationRevision,
    configurationIdentity:managedCudaConfigurationIdentity(material.context),
    variantId:"b12248/cuda",requestedExecution:requested,
  };
  const fabric = managedLocalFabric(state);
  const prior = fabric.deployments.find(row=>row.id===cuda.id);
  if(prior && deploymentIdentity(prior)!==deploymentIdentity(cuda))
    throw new Error("Conflicting CUDA deployment identity");
  const next=withLocalComputeFabric({...state,fabric:localComputeFabricSchema.parse({
    ...fabric,deployments:prior?fabric.deployments:[...fabric.deployments,cuda],
  })});
  return {state:next,selectionId:managedLocalSelectionId(cuda)};
}
export type AttachManagedLocalGguf = {
  digest: string;
  /** Optional import-time hint; only its basename can become a display label. */
  modelPath?: string;
  displayName?: string;
  fileIdentity?: string;
  size?: number;
  family?: string;
  quantization?: string;
  declaredContext?: number;
  material: ManagedLocalMaterial;
};
export type ManagedLocalDeployment = {
  deployment: ModelDeployment;
  artifact: ModelArtifact;
  runtime: LocalRuntime;
  host: ComputeHost;
  identity: string;
};
export type ManagedLocalSelection =
  | { status: "not-managed" }
  | { status: "missing" }
  | ({ status: "available" | "unavailable" } & ManagedLocalDeployment);

export function managedLocalConfigurationIdentity(material: ManagedLocalMaterial): string {
  const parsed = managedLocalMaterialSchema.parse(material);
  // Rebuild with fixed key order so equivalent material always gets one identity.
  return JSON.stringify({
    version: parsed.version, context: parsed.context,
    gpu: parsed.gpu, tool: parsed.tool, grammar: parsed.grammar,
  });
}

export function managedLocalDeploymentId(digest: string, material: ManagedLocalMaterial): string {
  return JSON.stringify(["managed-gguf", ggufDigest.parse(digest),
    managedLocalConfigurationIdentity(material)]);
}

export function managedLocalArtifactId(digest: string): string {
  return JSON.stringify(["digest", ggufDigest.parse(digest)]);
}

export function managedLocalSelectionId(deployment: ModelDeployment): string {
  return MANAGED_LOCAL_SELECTION_PREFIX +
    JSON.stringify([deployment.id, deploymentIdentity(deployment)]);
}

export function isManagedLocalSelectionId(selectionId: string): boolean {
  return selectionId.startsWith(MANAGED_LOCAL_SELECTION_PREFIX);
}

function managedLocalFabric(state: SelfHostedState): LocalComputeFabric {
  // Reconciliation de-duplicates IDs for legacy projection compatibility.
  // An exact managed selection must reject ambiguous *persisted* identities
  // before that compatibility projection can hide them.
  if (state.fabric && [
    state.fabric.hosts,
    state.fabric.runtimes,
    state.fabric.artifacts,
    state.fabric.deployments,
  ].some(rows => new Set(rows.map(row => row.id)).size !== rows.length))
    throw new Error("Ambiguous managed fabric identity");
  const fabric = reconcileLocalComputeFabric(state);
  return {
    ...fabric,
    runtimes: fabric.runtimes.map(projectManagedQualificationDeclarations),
  };
}

function managedLocalAttachment(fabric: LocalComputeFabric, deployment: ModelDeployment): ManagedLocalDeployment | undefined {
  const runtime = fabric.runtimes.find(r => r.id === MANAGED_LOCAL_RUNTIME_ID);
  const host = fabric.hosts.find(h => h.id === MANAGED_LOCAL_HOST_ID);
  const artifact = fabric.artifacts.find(a => a.id === deployment.artifactId);
  if (!runtime || !host || !artifact ||
      fabric.deployments.filter(d => d.id === deployment.id).length !== 1 ||
      fabric.runtimes.filter(r => r.id === runtime.id).length !== 1 ||
      fabric.hosts.filter(h => h.id === host.id).length !== 1 ||
      fabric.artifacts.filter(a => a.id === artifact.id).length !== 1 ||
      runtime.id !== deployment.runtimeId ||
      runtime.hostId !== host.id || runtime.type !== MANAGED_LOCAL_RUNTIME_TYPE ||
      runtime.version !== MANAGED_LLAMA_ENGINE_VERSION ||
      runtime.legacyEndpointId !== undefined ||
      !host.runtimeIds.includes(runtime.id) || host.location !== "local" ||
      deployment.hostId !== host.id ||
      deployment.profileId !== undefined ||
      deployment.configurationRevision !== runtime.configurationRevision ||
      artifact.format !== "gguf" || !artifact.digest ||
      !ggufDigest.safeParse(artifact.digest).success ||
      artifact.id !== managedLocalArtifactId(artifact.digest) ||
      deployment.runtimeModelName !== `managed-gguf:${artifact.digest}` ||
      !deployment.configurationIdentity)
    return;
  let material: unknown;
  try { material = JSON.parse(deployment.configurationIdentity); } catch { return; }
  if (deployment.variantId === "b12248/cuda") {
    const parsed=managedCudaMaterialSchema.safeParse(material);
    const requested=requestedExecutionSchema.safeParse(deployment.requestedExecution);
    const layers=requested.success ? requested.data.gpuLayers : undefined;
    if(!parsed.success||!requested.success||requested.data.backend!=="cuda"||
       requested.data.contextLength!==parsed.data.context||
       requested.data.deviceIds.length!==1||
       !cudaDeviceId.safeParse(requested.data.deviceIds[0]).success||
       layers===undefined||!Number.isInteger(layers)||layers<1||layers>999||
       (requested.data.fallback.policy!=="disabled"&&requested.data.fallback.policy!=="allow-compatible")||
       deployment.configurationIdentity!==managedCudaConfigurationIdentity(parsed.data.context)||
       deployment.id!==managedCudaDeploymentId(artifact.digest,parsed.data.context,
         layers,requested.data.deviceIds[0],requested.data.fallback.policy))return;
  } else {
    const parsed = managedLocalMaterialSchema.safeParse(material);
    if (!parsed.success || deployment.requestedExecution!==undefined || deployment.variantId!==undefined ||
        deployment.configurationIdentity !== managedLocalConfigurationIdentity(parsed.data) ||
        deployment.id !== managedLocalDeploymentId(artifact.digest, parsed.data)) return;
  }
  return { deployment, artifact, runtime, host, identity: deploymentIdentity(deployment) };
}

/**
 * Registers a GGUF by its *externally measured* digest. File paths are owned
 * by the native import store; the fabric persists only a digest-derived alias.
 * The caller must validate the file contents separately before supplying the
 * digest. No managed runtime is marked verified/online or Agent-ready.
 */
export function attachManagedLocalGguf(
  state: SelfHostedState,
  input: AttachManagedLocalGguf,
): { state: SelfHostedState; selectionId: string } {
  const digest = ggufDigest.parse(input.digest);
  const material = managedLocalMaterialSchema.parse(input.material);
  const label = input.displayName?.trim() ||
    input.modelPath?.split(/[\\/]/).pop()?.trim() || "Imported GGUF";
  if (!label || label.length > 1024 || /[\u0000-\u001f\u007f]/.test(label))
    throw new Error("Invalid managed GGUF name");
  if (input.size !== undefined && (!Number.isSafeInteger(input.size) || input.size < 24))
    throw new Error("Invalid native-inspected GGUF size");
  if (input.fileIdentity !== undefined &&
      (input.size === undefined ||
        input.fileIdentity !== `${digest.slice(7)}:${input.size}`))
    throw new Error("GGUF file identity disagrees with inspected bytes");
  if ([input.family, input.quantization].some(value =>
    value !== undefined && (!value || value.length > 1024 || /[\u0000-\u001f\u007f]/.test(value))))
    throw new Error("Invalid native-inspected model metadata");
  if (input.declaredContext !== undefined &&
      (!Number.isSafeInteger(input.declaredContext) || input.declaredContext < 1 ||
        input.declaredContext > 8_388_608))
    throw new Error("Invalid native-inspected GGUF context");
  // Check the persisted graph before withLocalComputeFabric normalizes duplicate
  // identifiers; a conflicting conceptual attachment must never be repaired
  // into a different selection silently.
  if (state.fabric) managedLocalFabric(state);
  const prepared = withLocalComputeFabric(state);
  const fabric = managedLocalFabric(prepared);
  const existingHost = fabric.hosts.find(h => h.id === MANAGED_LOCAL_HOST_ID);
  const existingRuntime = fabric.runtimes.find(r => r.id === MANAGED_LOCAL_RUNTIME_ID);
  if (fabric.hosts.filter(h => h.id === MANAGED_LOCAL_HOST_ID).length > 1 ||
      fabric.runtimes.filter(r => r.id === MANAGED_LOCAL_RUNTIME_ID).length > 1 ||
      (existingHost && existingHost.location !== "local") ||
      (existingRuntime && (existingRuntime.hostId !== MANAGED_LOCAL_HOST_ID ||
        existingRuntime.type !== MANAGED_LOCAL_RUNTIME_TYPE ||
        existingRuntime.version !== MANAGED_LLAMA_ENGINE_VERSION ||
        existingRuntime.legacyEndpointId !== undefined)))
    throw new Error("Managed runtime identity conflict");
  const host: ComputeHost = existingHost ?? {
    id: MANAGED_LOCAL_HOST_ID, displayName: "This PC", location: "local",
    enabled: true, reachability: "unknown", runtimeIds: [MANAGED_LOCAL_RUNTIME_ID],
  };
  const runtime: LocalRuntime = existingRuntime ?? {
    id: MANAGED_LOCAL_RUNTIME_ID, hostId: host.id,
    type: MANAGED_LOCAL_RUNTIME_TYPE, displayName: "Clack Managed llama.cpp",
    version: MANAGED_LLAMA_ENGINE_VERSION,
    enabled: true, health: "unknown", configurationRevision: 1,
    capabilities: {
      // These describe the native lifecycle/llama-server protocol only, not
      // evidence that this specific GGUF deployment is loaded or ready.
      chat: { status: "supported", source: "declared" },
      completions: { status: "supported", source: "declared" },
      streaming: { status: "supported", source: "declared" },
      cancellation: { status: "supported", source: "declared" },
      "terminal-completion": { status: "requires-qualification", source: "declared" },
      "instruction-adherence": { status: "requires-qualification", source: "declared" },
      "context-configuration": { status: "requires-qualification", source: "declared" },
      "json-schema": { status: "requires-qualification", source: "declared" },
      grammar: { status: "requires-qualification", source: "declared" },
      // A server grammar/JSON protocol is not a native Agent tool proof.
      "native-tools": { status: "unsupported", source: "declared" },
      "parallel-tools": { status: "unknown", source: "declared" },
    },
  };
  const artifactId = managedLocalArtifactId(digest);
  const existingArtifact = fabric.artifacts.find(a => a.id === artifactId);
  if (existingArtifact && (existingArtifact.digest !== digest ||
      existingArtifact.format !== "gguf" || fabric.artifacts.filter(a => a.id === artifactId).length !== 1))
    throw new Error("Managed GGUF artifact identity conflict");
  const artifact: ModelArtifact = existingArtifact ?? {
    id: artifactId, digest, format: "gguf", displayName: label,
    ...(input.fileIdentity ? { fileIdentity: input.fileIdentity } : {}),
    ...(input.size !== undefined ? { size: input.size } : {}),
    ...(input.family ? { family: input.family } : {}),
    ...(input.quantization ? { quantization: input.quantization } : {}),
    ...(input.declaredContext !== undefined ? { declaredContext: input.declaredContext } : {}),
    provenance: "user-supplied",
  };
  const deployment: ModelDeployment = {
    id: managedLocalDeploymentId(digest, material),
    hostId: host.id, runtimeId: runtime.id, artifactId,
    runtimeModelName: `managed-gguf:${digest}`,
    configurationRevision: runtime.configurationRevision,
    configurationIdentity: managedLocalConfigurationIdentity(material),
  };
  const current = fabric.deployments.find(d => d.id === deployment.id);
  if (current && (fabric.deployments.filter(d => d.id === deployment.id).length !== 1 ||
      JSON.stringify(current) !== JSON.stringify(deployment)))
    throw new Error("Managed GGUF deployment identity conflict");
  const nextFabric = localComputeFabricSchema.parse({
    ...fabric,
    hosts: existingHost ? fabric.hosts.map(h => h.id === host.id ?
      { ...h, runtimeIds: [...new Set([...h.runtimeIds, runtime.id])] } : h)
      : [...fabric.hosts, host],
    runtimes: existingRuntime ? fabric.runtimes : [...fabric.runtimes, runtime],
    artifacts: existingArtifact ? fabric.artifacts : [...fabric.artifacts, artifact],
    deployments: current ? fabric.deployments : [...fabric.deployments, deployment],
  });
  const projected = withLocalComputeFabric({ ...prepared, fabric: nextFabric });
  return { state: projected, selectionId: managedLocalSelectionId(deployment) };
}

/** LM2D attachment entrypoint; updates only the existing self-hosted fabric. */
export const createManagedDeployment = attachManagedLocalGguf;

/**
 * Exact selection never follows the latest model name, digest, runtime or
 * configuration. An unavailable runtime keeps its historical selection.
 */
export function resolveManagedLocalSelection(
  state: SelfHostedState | undefined,
  selectionId: string,
): ManagedLocalSelection {
  if (!isManagedLocalSelectionId(selectionId)) return { status: "not-managed" };
  if (!state) return { status: "missing" };
  let tuple: unknown;
  try { tuple = JSON.parse(selectionId.slice(MANAGED_LOCAL_SELECTION_PREFIX.length)); }
  catch { return { status: "missing" }; }
  if (!Array.isArray(tuple) || tuple.length !== 2 ||
      !tuple.every(v => typeof v === "string" && v.length > 0))
    return { status: "missing" };
  const [id, identity] = tuple as [string, string];
  let fabric: LocalComputeFabric;
  try { fabric = managedLocalFabric(state); } catch { return { status: "missing" }; }
  const deployment = fabric.deployments.find(d => d.id === id);
  const target = deployment ? managedLocalAttachment(fabric, deployment) : undefined;
  if (!target || target.identity !== identity ||
      selectionId !== managedLocalSelectionId(deployment!))
    return { status: "missing" };
  return {
    ...target,
    status: target.host.enabled && target.runtime.enabled &&
      target.host.reachability === "online" && target.runtime.health === "online"
      ? "available" : "unavailable",
  };
}

export function managedLocalSelectionStatus(
  state: SelfHostedState,
  selectionId: string,
): { label: string; disabled: boolean } | undefined {
  const result = resolveManagedLocalSelection(state, selectionId);
  if (result.status === "not-managed") return;
  if (result.status === "missing") return { label: "Unavailable", disabled: true };
  if (result.status === "unavailable") return { label: "Runtime unavailable", disabled: true };
  return { label: "Runtime verification required", disabled: false };
}

export function managedLocalModelInfo(
  selectionId: string,
  state?: SelfHostedState,
): ModelInfo | null {
  const result = resolveManagedLocalSelection(state, selectionId);
  if (result.status === "not-managed") return null;
  if (result.status === "missing") throw new Error("Managed GGUF selection changed or is missing");
  return {
    id: selectionId, provider: "openai-compatible",
    label: result.artifact.displayName,
    hint: "This PC",
    description: `Managed GGUF / ${result.deployment.runtimeModelName}`,
    capabilities: { intelligence: 0, speed: 0, cost: 0 },
  };
}

export function savedManagedLocalModelInfos(state: SelfHostedState): ModelInfo[] {
  let fabric: LocalComputeFabric;
  try { fabric = managedLocalFabric(state); } catch { return []; }
  return fabric.deployments.flatMap(deployment => {
    if (deployment.runtimeId !== MANAGED_LOCAL_RUNTIME_ID ||
        deployment.hostId !== MANAGED_LOCAL_HOST_ID ||
        !managedLocalAttachment(fabric, deployment)) return [];
    const info = managedLocalModelInfo(managedLocalSelectionId(deployment), state);
    return info ? [info] : [];
  });
}

/** Picker-facing alias used alongside the existing self-hosted model list. */
export const managedLocalModelInfos = savedManagedLocalModelInfos;

export function managedLocalTransportIdentity(
  selectionId: string,
  state?: SelfHostedState,
): ModelTransportIdentity | null {
  const result = resolveManagedLocalSelection(state, selectionId);
  if (result.status === "not-managed") return null;
  if (result.status === "missing") throw new Error("Managed GGUF selection changed or is missing");
  // Native route admission must independently verify the current process,
  // GGUF bytes and deployment. This identity intentionally carries NO URL.
  return {
    providerId: "openai-compatible",
    transportModelId: result.deployment.runtimeModelName,
    managedLocal: {
      deploymentId: result.deployment.id,
      deploymentIdentity: result.identity,
      artifactDigest: result.artifact.digest!,
      configurationRevision: result.deployment.configurationRevision,
    },
  };
}

export function managedLocalChatDeclared(selection: ManagedLocalSelection): boolean {
  // This is static protocol declaration for a structurally valid attachment.
  // Runtime health is not persisted as evidence of native readiness; the
  // managed_local_runtime_route admission independently checks actual Ready.
  return selection.status === "available" || selection.status === "unavailable";
}
