import { describe, expect, it } from "vitest";
import {
  assessDeploymentSuitability,
  contextTargets,
  estimateContextCapacity,
  type ScopedMeasuredPerformance,
  type Workload,
} from "./deploymentSuitability";
import {
  evidence,
  type GpuHardware,
  type HardwareProfile,
  type NativeHardwareObservation,
  projectHardwareProfile,
  unknown,
} from "./hardwareProfile";
import {
  CURRENT_DEPLOYMENT_QUALIFICATION_PROCEDURES,
  type DeploymentRuntimeObservation,
  deploymentQualificationScope,
  type LocalComputeFabric,
  localComputeFabricSchema,
  type RuntimeCapabilityName,
  recordDeploymentQualification,
} from "./localComputeFabric";
import { attachManagedLocalGguf } from "./managedLocalModels";
import {
  type ModelResourceProfile,
  type NativeGgufResource,
  projectModelResourceProfile,
} from "./modelResourceProfile";
import { emptySelfHostedState } from "./selfHostedProfiles";

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const at = 1_800_000_000_000;
const digest = `sha256:${"a".repeat(64)}`;
const originalSize = 491_400_032;
const baseMeta: NativeGgufResource = {
  digest,
  size: originalSize,
  format: "gguf",
  family: "qwen2",
  quantization: null,
  declaredContext: 32768,
  fileIdentity: `${"a".repeat(64)}:${originalSize}`,
  blockCount: 24,
  embeddingLength: 896,
  attentionHeadCount: 14,
  attentionHeadCountKv: 2,
  attentionKeyLength: 64,
  attentionValueLength: 64,
};
const osObservation = (
  available = 32 * GiB,
  total = 64 * GiB,
): NativeHardwareObservation => ({
  os: "windows",
  architecture: "x86_64",
  logicalProcessors: 24,
  totalRamBytes: total,
  availableRamBytes: available,
  observedAt: at - 100,
  source: "native-os-readonly",
  gpuInventoryComplete: false,
});

function fixture(
  available = 32 * GiB,
  native: NativeGgufResource | null = baseMeta,
) {
  const saved = attachManagedLocalGguf(emptySelfHostedState(), {
    digest,
    fileIdentity: `${"a".repeat(64)}:${originalSize}`,
    size: originalSize,
    family: "qwen2",
    declaredContext: 32768,
    displayName: "Qwen test fixture",
    material: {
      version: 1,
      context: 2048,
      gpu: 0,
      tool: false,
      grammar: false,
    },
  });
  const state = structuredClone(saved.state);
  const fabric = state.fabric!;
  const host = fabric.hosts.find((x) => x.id === "clack-this-pc")!;
  const runtime = fabric.runtimes.find(
    (x) => x.id === "clack-managed-llama.cpp",
  )!;
  const artifact = fabric.artifacts.find((x) => x.digest === digest)!;
  const deployment = fabric.deployments.find(
    (x) => x.artifactId === artifact.id,
  )!;
  host.reachability = "online";
  runtime.health = "online";
  runtime.processIdentity = "pid:100";
  runtime.runtimeEpoch = "epoch-a";
  const observation: DeploymentRuntimeObservation = {
    runtimeId: runtime.id,
    version: runtime.version!,
    configurationRevision: runtime.configurationRevision,
    epoch: "epoch-a",
    observedAt: at - 100,
  };
  const hardware = projectHardwareProfile(
    host,
    runtime,
    osObservation(available),
    at,
  );
  const resource = projectModelResourceProfile(
    artifact,
    runtime,
    deployment,
    native,
  );
  const evaluate = (
    workload: Workload = "Chat",
    context = 2048,
    h: HardwareProfile = hardware,
    res: ModelResourceProfile = resource,
    f: LocalComputeFabric = fabric,
    obs: DeploymentRuntimeObservation | undefined = observation,
    performance?: ScopedMeasuredPerformance,
  ) =>
    assessDeploymentSuitability({
      fabric: f,
      hardware: h,
      resource: res,
      deploymentId: deployment.id,
      workload,
      context,
      observation: obs,
      measuredPerformance: performance,
      now: at,
    });
  return {
    saved,
    state,
    fabric,
    host,
    runtime,
    artifact,
    deployment,
    hardware,
    resource,
    observation,
    evaluate,
  };
}
function gpu(freeBytes = 14 * GiB, totalBytes = 16 * GiB): GpuHardware {
  const E = <T>(v: T, unit = "value") =>
    evidence(v, unit, "Measured", "trusted-native-gpu-fixture", at - 100);
  return {
    deviceId: E("PCI:test"),
    vendor: E("NVIDIA"),
    model: E("Synthetic GPU"),
    totalVramBytes: E(totalBytes, "bytes"),
    availableVramBytes: E(freeBytes, "bytes"),
    computeArchitecture: E("synthetic"),
    driverVersion: E("test-1"),
    supportedBackends: E(["cuda"]),
  };
}
function gpuScenario(
  freeVram: number,
  totalVram = 16 * GiB,
  place: "GPU" | "Hybrid" = "GPU",
) {
  const v = fixture();
  const h = structuredClone(v.hardware);
  h.gpuInventoryComplete = true;
  h.gpus = [gpu(freeVram, totalVram)];
  h.backends.cuda = {
    hardwareSupports: evidence(
      true,
      "boolean",
      "Measured",
      "synthetic-driver",
      at - 100,
    ),
    installedRuntimeExecutes: evidence(
      true,
      "boolean",
      "Measured",
      "synthetic-runtime",
      at - 100,
    ),
  };
  const r = structuredClone(v.resource);
  r.executionPlacement = evidence(
    place,
    "placement",
    "Measured",
    "synthetic-residency",
    at - 100,
  );
  r.weightMemoryBytes = evidence(
    4 * GiB,
    "bytes",
    "Estimated",
    "synthetic-weights-v1",
  );
  r.kvBytesPerToken = evidence(
    65_536,
    "elements/token",
    "Derived",
    "synthetic-gguf-geometry",
  );
  r.kvPrecisionBytes = evidence(
    2,
    "bytes/element",
    "Estimated",
    "fp16-fixture",
  );
  r.totalLayers = evidence(32, "layers", "Derived", "synthetic-model-header");
  r.gpuLayers = evidence(
    place === "GPU" ? 32 : 16,
    "layers",
    "Measured",
    "synthetic-engine-config",
  );
  return { ...v, h, r };
}
function withReceipt(
  v: ReturnType<typeof fixture>,
  capability: RuntimeCapabilityName,
  status: "verified" | "failed" = "verified",
) {
  const state = structuredClone(v.state);
  if (!state.fabric) throw Error("No fabric");
  if (capability === "instruction-adherence")
    state.fabric.runtimes[0].capabilities[capability] = {
      status: "requires-qualification",
      source: "declared",
    };
  const scope = deploymentQualificationScope(
    state.fabric,
    v.deployment.id,
    v.observation,
    at,
  )!;
  const context =
    capability === "instruction-adherence"
      ? {
          personaId: "builtin:coder",
          systemContextDigest: `sha256:${"f".repeat(64)}`,
        }
      : {};
  const receipt = {
    version: 2 as const,
    scope: { ...scope, deploymentId: v.deployment.id },
    capability,
    status,
    context,
    verifiedAt: at - 100,
    expiresAt: at + 86_400_000,
    procedure:
      CURRENT_DEPLOYMENT_QUALIFICATION_PROCEDURES[
        capability as keyof typeof CURRENT_DEPLOYMENT_QUALIFICATION_PROCEDURES
      ],
    evidence: {
      source: "native-observation" as const,
      reference: "bounded-synthetic-fixture",
      digest: `sha256:${"e".repeat(64)}`,
      checks: [
        {
          id: "fixture",
          result: status === "verified" ? ("pass" as const) : ("fail" as const),
        },
      ],
    },
  };
  return recordDeploymentQualification(
    state,
    v.deployment.id,
    v.observation,
    receipt,
    at,
  ).fabric!;
}

describe("LM3–LM5 deterministic deployment-scoped suitability", () => {
  it("01 plenty of genuine runtime GPU/VRAM headroom yields resource Good without model-quality claim", () => {
    const v = gpuScenario(14 * GiB);
    const result = v.evaluate("Chat", 2048, v.h, v.r);
    expect(result.capacity).toMatchObject({ fit: "Fits", vramFit: "Fits" });
    expect(result.resourceRating).toBe("Good");
    expect(result.rating).not.toBe("Excellent");
    expect(result.measuredPerformance).toBeNull();
  });

  it("02 weights alone fit VRAM but KV and safety headroom make a tight allocation", () => {
    const v = gpuScenario(5 * GiB + 256 * MiB);
    const result = v.evaluate("Chat", 2048, v.h, v.r);
    expect(result.capacity.vramFit).toBe("Tight");
    expect(result.capacity.fit).toBe("Tight");
  });

  it("03 partial GPU offload causes CPU spill and degrades resource rating", () => {
    const v = gpuScenario(14 * GiB, 16 * GiB, "Hybrid");
    const result = v.evaluate("Chat", 2048, v.h, v.r);
    expect(result.resourceRating).toBe("Marginal");
    expect(result.recommendations.map((x) => x.code)).toContain("cpu-spill");
    expect(result.reasons.join(" ")).toMatch(/Hybrid/);
  });

  it("04 insufficient RAM is a real memory limit, not an observed inference failure", () => {
    const v = fixture(300 * MiB);
    const result = v.evaluate();
    expect(result.capacity.ramFit).toBe("Insufficient");
    expect(result.resourceRating).toBe("Poor");
    expect(result.recommendations.some((x) => x.code === "smaller-model")).toBe(
      true,
    );
  });

  it("05 unknown GPU free memory cannot be treated as zero or plentiful", () => {
    const v = gpuScenario(14 * GiB);
    v.h.gpuInventoryComplete = false;
    v.h.gpus = [];
    const result = v.evaluate("Chat", 2048, v.h, v.r);
    expect(result.capacity.vramFit).toBe("Unknown");
    expect(result.resourceRating).toBe("Unknown");
  });

  it("06 remote host with only endpoint identity keeps every physical memory field Unknown", () => {
    const v = fixture();
    const remoteHost = {
      ...v.host,
      id: "secondary-pc",
      location: "remote" as const,
    };
    const remoteRuntime = {
      ...v.runtime,
      hostId: remoteHost.id,
      id: "secondary-ollama",
      type: "ollama",
    };
    const h = projectHardwareProfile(
      remoteHost,
      remoteRuntime,
      osObservation(),
      at,
    );
    expect(h.memory.totalRamBytes.provenance).toBe("Unknown");
    expect(h.memory.availableRamBytes.provenance).toBe("Unknown");
    expect(h.backends.cuda.installedRuntimeExecutes.value).toBeNull();
    expect(h.gpuInventoryComplete).toBe(false);
  });

  it("07 tiny Qwen-class artifact has easy CPU resource fit but never Excellent Agent", () => {
    const v = fixture();
    expect(v.evaluate().resourceRating).toBe("Good");
    expect(v.evaluate("Automatic Agent")).toMatchObject({
      workloadAuthorized: false,
      placement: "CPU",
      rating: "Poor",
    });
  });

  it("08 large model on constrained GPU is insufficient even if CPU RAM is large", () => {
    const v = gpuScenario(7 * GiB, 8 * GiB);
    v.r.weightMemoryBytes = evidence(
      36 * GiB,
      "bytes",
      "Estimated",
      "large-model-fixture",
    );
    expect(v.evaluate("Chat", 2048, v.h, v.r).capacity.vramFit).toBe(
      "Insufficient",
    );
  });

  it("09 one artifact can fit at 8K but become marginal at 32K", () => {
    const v = fixture(1900 * MiB);
    const res = structuredClone(v.resource);
    res.kvBytesPerToken = evidence(
      14_000,
      "elements/token",
      "Derived",
      "synthetic-large-kv",
    );
    const good = v.evaluate("Chat", 8192, v.hardware, res);
    const marginal = v.evaluate("Chat", 32768, v.hardware, res);
    expect(good.capacity.fit).toBe("Fits");
    expect(marginal.capacity.fit).toBe("Tight");
    expect(good.capacity.estimatedKvBytes.value).toBeLessThan(
      marginal.capacity.estimatedKvBytes.value!,
    );
    expect(marginal.warnings.join(" ")).toMatch(/different context/);
  });

  it("10 same artifact on different hosts never inherits local RAM measurement", () => {
    const v = fixture();
    const remote = {
      ...v.host,
      id: "different-host",
      location: "remote" as const,
    };
    const remoteRuntime = { ...v.runtime, hostId: remote.id };
    const h = projectHardwareProfile(
      remote,
      remoteRuntime,
      osObservation(),
      at,
    );
    expect(v.hardware.memory.availableRamBytes.value).not.toBeNull();
    expect(h.memory.availableRamBytes.value).toBeNull();
  });

  it("11 same digest on an unverified runtime cannot borrow the managed CPU backend", () => {
    const v = fixture();
    const unknownRuntime = { ...v.runtime, type: "new-opaque-runtime" };
    const h = projectHardwareProfile(
      v.host,
      unknownRuntime,
      osObservation(),
      at,
    );
    expect(h.backends.cpu.installedRuntimeExecutes.value).toBeNull();
    const assessment = v.evaluate("Chat", 2048, h);
    expect(assessment.resourceRating).toBe("Unknown");
  });

  it("12 absent quantization metadata stays unknown, never parsed from filename", () => {
    const v = fixture();
    expect(v.resource.quantization.value).toBeNull();
    expect(v.resource.quantization.provenance).toBe("Unknown");
  });

  it("13 absent parameter metadata stays unknown even if the label says Qwen 0.5B", () => {
    const v = fixture();
    expect(v.resource.parameterCount.value).toBeNull();
    expect(v.resource.parameterCount.provenance).toBe("Unknown");
  });

  it("14 GPU hardware support is not sufficient if installed runtime backend unavailable", () => {
    const v = gpuScenario(14 * GiB);
    v.h.backends.cuda.installedRuntimeExecutes = evidence(
      false,
      "boolean",
      "Measured",
      "cpu-only-runtime",
    );
    const result = v.evaluate("Chat", 2048, v.h, v.r);
    expect(result.capacity.fit).toBe("Insufficient");
    expect(result.capacity.reasons.join(" ")).toMatch(
      /Installed runtime cannot execute/,
    );
  });

  it("15 CUDA-capable hardware with CPU-only deployment keeps actual placement CPU", () => {
    const v = fixture();
    const h = structuredClone(v.hardware);
    h.gpus = [gpu()];
    h.gpuInventoryComplete = true;
    h.backends.cuda.hardwareSupports = evidence(
      true,
      "boolean",
      "Measured",
      "fixture",
    );
    expect(h.backends.cuda.installedRuntimeExecutes.value).toBe(false);
    expect(v.evaluate("Chat", 2048, h).placement).toBe("CPU");
  });

  it("16 Agent hardware Good with zero LM2F tool proof remains unavailable", () => {
    const v = fixture();
    const r = v.evaluate("Automatic Agent");
    expect(r.resourceRating).toBe("Good");
    expect(r.workloadAuthorized).toBe(false);
    expect(r.rating).toBe("Poor");
  });

  it("17 real-shaped independent Chat PASS never licenses Agent", () => {
    const v = fixture();
    const withChat = withReceipt(v, "chat", "verified");
    expect(
      v.evaluate("Chat", 2048, v.hardware, v.resource, withChat)
        .workloadAuthorized,
    ).toBe(true);
    expect(
      v.evaluate("Automatic Agent", 2048, v.hardware, v.resource, withChat)
        .workloadAuthorized,
    ).toBe(false);
  });

  it("18 negative instruction-adherence evidence remains separate from Chat PASS", () => {
    const v = fixture();
    const chat = withReceipt(v, "chat", "verified");
    const state = { ...v.state, fabric: localComputeFabricSchema.parse(chat) };
    const scope = deploymentQualificationScope(
      state.fabric!,
      v.deployment.id,
      v.observation,
      at,
    )!;
    const receipt = {
      version: 2 as const,
      scope: { ...scope, deploymentId: v.deployment.id },
      capability: "instruction-adherence" as const,
      status: "failed" as const,
      context: {
        personaId: "builtin:coder",
        systemContextDigest: `sha256:${"f".repeat(64)}`,
      },
      verifiedAt: at - 80,
      expiresAt: at + 86_400_000,
      procedure:
        CURRENT_DEPLOYMENT_QUALIFICATION_PROCEDURES["instruction-adherence"],
      evidence: {
        source: "deterministic-evaluator" as const,
        reference: "failed-fixture",
        digest: `sha256:${"e".repeat(64)}`,
        checks: [{ id: "exact", result: "fail" as const }],
      },
    };
    const failed = recordDeploymentQualification(
      state,
      v.deployment.id,
      v.observation,
      receipt,
      at,
    ).fabric!;
    expect(
      v.evaluate("Chat", 2048, v.hardware, v.resource, failed)
        .workloadAuthorized,
    ).toBe(true);
    const agent = v.evaluate(
      "Automatic Agent",
      2048,
      v.hardware,
      v.resource,
      failed,
    );
    expect(agent.workloadAuthorized).toBe(false);
    expect(agent.warnings.join(" ")).toMatch(
      /instruction-adherence receipt previously failed/,
    );
  });

  it("19 structured output remains unsupported despite sufficient physical resources", () => {
    const v = fixture();
    const f = structuredClone(v.fabric);
    f.runtimes[0].capabilities["json-schema"] = {
      status: "unsupported",
      source: "declared",
    };
    const result = v.evaluate(
      "Structured Output",
      2048,
      v.hardware,
      v.resource,
      f,
    );
    expect(result.resourceRating).toBe("Good");
    expect(result.rating).toBe("Poor");
    expect(result.workloadAuthorized).toBe(false);
  });

  it("20 no memory telemetry means Unknown, never Poor", () => {
    const v = fixture();
    const h = structuredClone(v.hardware);
    h.memory.availableRamBytes = unknown("bytes", "unobserved");
    h.memory.totalRamBytes = unknown("bytes", "unobserved");
    const r = v.evaluate("Chat", 2048, h);
    expect(r.capacity.fit).toBe("Unknown");
    expect(r.resourceRating).toBe("Unknown");
  });

  it("21 recommendations are read-only descriptions; they cannot mutate config", () => {
    const v = fixture(250 * MiB);
    const before = JSON.stringify({
      fabric: v.fabric,
      hardware: v.hardware,
      resource: v.resource,
    });
    const result = v.evaluate();
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations.every((row) => row.requiresUserAction)).toBe(
      true,
    );
    expect(
      JSON.stringify({
        fabric: v.fabric,
        hardware: v.hardware,
        resource: v.resource,
      }),
    ).toBe(before);
  });

  it("22 historical/wrong-epoch performance cannot masquerade as current measured speed", () => {
    const v = fixture();
    const fake: ScopedMeasuredPerformance = {
      source: "clack-native-measured",
      deploymentId: v.deployment.id,
      runtimeId: v.runtime.id,
      runtimeEpoch: "old-epoch",
      configurationRevision: 1,
      observedAt: at - 100_000,
      generationTokensPerSecond: 800,
      sampleCount: 500,
      reliabilityFraction: 1,
    };
    const r = v.evaluate(
      "Chat",
      2048,
      v.hardware,
      v.resource,
      v.fabric,
      v.observation,
      fake,
    );
    expect(r.measuredPerformance).toBeNull();
    expect(r.resourceRating).toBe("Good");
    expect(r.confidence).not.toBe("High");
  });
});

describe("LM3 / LM5 metadata and context provenance", () => {
  it("native Ready is distinct from generic runtime observation and a hypothetical context", () => {
    const v = fixture();
    const ordinary = v.evaluate();
    expect(ordinary.canLoad).toBe("Likely Fits");
    const ready = assessDeploymentSuitability({
      fabric: v.fabric,
      hardware: v.hardware,
      resource: v.resource,
      deploymentId: v.deployment.id,
      workload: "Chat",
      context: 2048,
      observation: v.observation,
      observedLoaded: true,
      now: at,
    });
    expect(ready.canLoad).toBe("Observed Loaded");
    const hypothetical = assessDeploymentSuitability({
      fabric: v.fabric,
      hardware: v.hardware,
      resource: v.resource,
      deploymentId: v.deployment.id,
      workload: "Chat",
      context: 8192,
      observation: v.observation,
      observedLoaded: true,
      now: at,
    });
    expect(hypothetical.canLoad).not.toBe("Observed Loaded");
    const stale = assessDeploymentSuitability({
      fabric: v.fabric,
      hardware: v.hardware,
      resource: v.resource,
      deploymentId: v.deployment.id,
      workload: "Chat",
      context: 2048,
      observation: { ...v.observation, observedAt: at - 31_000 },
      observedLoaded: true,
      now: at,
    });
    expect(stale.canLoad).not.toBe("Observed Loaded");
  });

  it("transient free RAM shortage is At Risk, not structural Cannot Fit", () => {
    const v = fixture(300 * MiB);
    expect(v.evaluate().capacity.fit).toBe("Insufficient");
    expect(v.evaluate().capacity.structuralLimit).toBe(false);
    expect(v.evaluate().canLoad).toBe("At Risk");
    const h = projectHardwareProfile(
      v.host,
      v.runtime,
      osObservation(300 * MiB, 400 * MiB),
      at,
    );
    const impossible = v.evaluate("Chat", 2048, h);
    expect(impossible.capacity.structuralLimit).toBe(true);
    expect(impossible.canLoad).toBe("Cannot Fit");
  });

  it("capacity does not borrow different runtime backend or stale deployment configuration", () => {
    const v = fixture();
    const differentBackend = structuredClone(v.hardware);
    differentBackend.runtimeId = "another-runtime-on-the-same-host";
    expect(v.evaluate("Chat", 2048, differentBackend).rating).toBe("Unknown");
    const changedConfig = structuredClone(v.fabric);
    changedConfig.deployments[0].configurationIdentity =
      "changed-after-profile";
    expect(
      v.evaluate("Chat", 2048, v.hardware, v.resource, changedConfig).rating,
    ).toBe("Unknown");
  });

  it("rejects a forged changed-digest GGUF metadata response even when display labels match", () => {
    const v = fixture();
    const rejected = projectModelResourceProfile(
      v.artifact,
      v.runtime,
      v.deployment,
      { ...baseMeta, digest: `sha256:${"b".repeat(64)}` },
    );
    expect(rejected.kvBytesPerToken.provenance).toBe("Unknown");
    expect(rejected.artifactSizeBytes.value).toBe(originalSize);
  });

  it("rejects native metadata when persisted artifact file identity disagrees with matching digest and size", () => {
    const v = fixture();
    const inconsistentArtifact = {
      ...v.artifact,
      fileIdentity: `${"b".repeat(64)}:${originalSize}`,
    };
    const projected = projectModelResourceProfile(
      inconsistentArtifact,
      v.runtime,
      v.deployment,
      baseMeta,
    );
    expect(projected.kvBytesPerToken.provenance).toBe("Unknown");
    expect(projected.artifactSizeBytes.value).toBe(originalSize);
    expect(projected.artifactSizeBytes.provenance).toBe("Derived");
    expect(projected.artifactSizeBytes.source).toBe(
      "persisted-artifact-declaration",
    );
  });

  it("each fallback GGUF field cites its actual fabric source rather than the native header", () => {
    const v = fixture();
    const artifact = {
      ...v.artifact,
      quantization: "Q4_K_M",
      family: "fabric-known-architecture",
      declaredContext: 16384,
    };
    const partialHeader = {
      ...baseMeta,
      family: null,
      quantization: null,
      declaredContext: null,
    };
    const projected = projectModelResourceProfile(
      artifact,
      v.runtime,
      v.deployment,
      partialHeader,
    );
    expect(projected.quantization).toMatchObject({
      value: "Q4_K_M",
      source: "fabric-artifact-metadata",
      provenance: "Derived",
    });
    expect(projected.architecture).toMatchObject({
      value: "fabric-known-architecture",
      source: "fabric-artifact-metadata",
      provenance: "Derived",
    });
    expect(projected.declaredMaximumContext).toMatchObject({
      value: 16384,
      source: "fabric-artifact-metadata",
      provenance: "Derived",
    });
    expect(projected.kvBytesPerToken.value).not.toBeNull();
  });

  it("unknown tensor metadata preserves Unknown KV and context-fit outcome", () => {
    const v = fixture(32 * GiB, null);
    const budget = estimateContextCapacity(v.hardware, v.resource, 2048);
    expect(budget.estimatedKvBytes.value).toBeNull();
    expect(budget.fit).toBe("Unknown");
  });

  it("generates context tiers from the exact configured context and declared model max", () => {
    const v = fixture();
    expect(contextTargets(v.resource).map((row) => row.tokens)).toEqual([
      2048, 8192, 32768,
    ]);
    expect(
      contextTargets({
        ...v.resource,
        configuredContext: unknown("tokens", "not configured"),
        declaredMaximumContext: unknown("tokens", "not advertised"),
      }),
    ).toEqual([]);
  });

  it("fails to borrow physical RAM from stale native samples", () => {
    const v = fixture();
    const stale = projectHardwareProfile(
      v.host,
      v.runtime,
      { ...osObservation(), observedAt: at - 31_000 },
      at,
    );
    expect(stale.memory.availableRamBytes.provenance).toBe("Unknown");
    expect(stale.backends.cpu.installedRuntimeExecutes.value).toBe(true);
  });

  it("bounded estimated performance cannot raise model quality without measured reliability", () => {
    const v = fixture();
    const m: ScopedMeasuredPerformance = {
      source: "clack-native-measured",
      deploymentId: v.deployment.id,
      runtimeId: v.runtime.id,
      runtimeEpoch: "epoch-a",
      configurationRevision: 1,
      observedAt: at - 100,
      generationTokensPerSecond: 900,
      sampleCount: 1,
    };
    const r = v.evaluate(
      "Coding",
      2048,
      v.hardware,
      v.resource,
      v.fabric,
      v.observation,
      m,
    );
    expect(r.resourceRating).not.toBe("Excellent");
    expect(r.warnings.join(" ")).toMatch(/coding accuracy/);
  });
});
