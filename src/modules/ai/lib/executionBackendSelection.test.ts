import { describe, expect, it } from "vitest";
import {
  actualExecutionSchema,
  computeDeviceSchema,
  deploymentIdentity,
  localComputeFabricSchema,
  requestedExecutionSchema,
  type RequestedExecution,
} from "./localComputeFabric";
import {
  deploymentRequestedExecution,
  observedActualExecution,
  runtimeBackendVariants,
  selectDeploymentExecution,
} from "./executionBackendSelection";
import {
  nativeHardwareObservationSchema,
  observedComputeHost,
  projectHardwareProfile,
  type NativeHardwareObservation,
} from "./hardwareProfile";
import { attachManagedLocalGguf, MANAGED_LLAMA_ENGINE_VERSION } from "./managedLocalModels";
import type { ManagedLocalNativeStatus } from "./managedLocalRuntime";
import { emptySelfHostedState } from "./selfHostedProfiles";

const at = 1_800_000_000_000;
const GiB = 1024 ** 3;
const value = <T,>(v: T) => ({value: v, source: "native-readonly-test", observedAt: at - 100});
const gpu = (id = "GPU-5070-ti") => ({
  deviceId: value(id), vendor: value("NVIDIA"), model: value("NVIDIA GeForce RTX 5070 Ti"),
  totalVramBytes: value(16_303 * 1024 ** 2),
  availableVramBytes: value(13_399 * 1024 ** 2),
  driverVersion: value("616.92"), computeArchitecture: value("CUDA compute capability 12.0"),
  cudaHardwareCapable: value(true),
});
const hardware = (withGpu = true): NativeHardwareObservation => ({
  os: "windows", architecture: "x86_64", observedAt: at - 100,
  logicalProcessors: 24, logicalProcessorsSource: "windows-kernel-processor-topology",
  cpuManufacturer: value("AuthenticAMD"), cpuModel: value("AMD Ryzen 9 9900X"),
  physicalCores: value(12), totalRamBytes: 64 * GiB,
  availableRamBytes: 30 * GiB, source: "native-os-readonly",
  gpus: withGpu ? [gpu()] : [], gpuInventoryComplete: true,
});
const installed: ManagedLocalNativeStatus = {
  installed: true, state: "Stopped", version: MANAGED_LLAMA_ENGINE_VERSION,
  epoch: "boot-one",
};
const cuda = (policy: RequestedExecution["fallback"]["policy"] = "disabled"): RequestedExecution =>
  requestedExecutionSchema.parse({
    backend: "cuda", gpuLayers: 40, contextLength: 2048,
    fallback: policy === "explicit-order"
      ? { policy, order: ["rocm", "cpu"] } : {policy},
  });

function setup(hasGpu = true, native: NativeHardwareObservation | null = hardware(hasGpu)) {
  const created = attachManagedLocalGguf(emptySelfHostedState(), {
    digest: `sha256:${"a".repeat(64)}`,
    size: 491_400_032, displayName: "Exact managed Qwen2.5-0.5B",
    material: {version: 1, context: 2048, gpu: 0, tool: false, grammar: false},
  });
  const fabric = localComputeFabricSchema.parse(created.state.fabric);
  const [host] = fabric.hosts, [runtime] = fabric.runtimes, [deployment] = fabric.deployments;
  const [artifact] = fabric.artifacts;
  const profile = projectHardwareProfile(host, runtime, native, at);
  const choose = (request?: RequestedExecution, status: ManagedLocalNativeStatus = installed) =>
    selectDeploymentExecution({
      host, runtime, deployment, artifact, hardware: profile, installedRuntime: status,
      ...(request ? {requested: request} : {}), nativeExecution: status, now: at,
    });
  return {fabric, host, runtime, artifact, deployment, profile, choose};
}

describe("Universal Compute Foundation — native-bound CPU/CUDA admission", () => {
  it("CPU-only host has a real CPU device and selects installed CPU runtime", () => {
    const ctx = setup(false);
    expect(ctx.profile.devices).toHaveLength(1);
    expect(ctx.profile.devices[0]).toMatchObject({
      id: "clack-this-pc:cpu:0", availability: "AVAILABLE", kind: "cpu", trust: "VERIFIED",
    });
    expect(ctx.choose()).toMatchObject({state: "selected", selected: {
      backend: "cpu", gpuLayers: 0,
    }, fallbackUsed: false, actual: null});
  });

  it("NVIDIA is physically CUDA-capable but pinned b12248 is a CPU-only runtime build", () => {
    const ctx = setup();
    expect(ctx.profile.backendAvailability.cuda).toBe("AVAILABLE");
    expect(ctx.profile.devices[1]).toMatchObject({
      kind: "accelerator", vendor: "NVIDIA", architecture: "CUDA compute capability 12.0",
      driverVersion: "616.92", totalMemoryBytes: 16_303 * 1024 ** 2,
      availableMemoryBytes: 13_399 * 1024 ** 2,
    });
    expect(runtimeBackendVariants(ctx.runtime, installed).map(v => [v.backend, v.support]))
      .toContainEqual(["cuda", "UNSUPPORTED"]);
    expect(runtimeBackendVariants(ctx.runtime, installed)[0]).toMatchObject({
      backend: "cpu", support: "AVAILABLE", installation: "AVAILABLE",
      id: "b12248/cpu", trust: "VERIFIED",
    });
  });

  it("CUDA requested with disabled fallback is rejected, never reported as CUDA", () => {
    const result = setup().choose(cuda());
    expect(result).toMatchObject({state: "rejected", selected: null, actual: null,
      fallbackUsed: false, fallbackAuthorized: false});
    expect(result.reasons.join(" ")).toContain("cuda: runtime build support UNSUPPORTED");
  });

  it("authorized compatible fallback records requested CUDA, selected CPU and reason", () => {
    const result = setup().choose(cuda("allow-compatible"));
    expect(result.requested?.backend).toBe("cuda");
    expect(result).toMatchObject({state: "fallback", selected: {backend: "cpu", gpuLayers: 0},
      fallbackUsed: true, fallbackAuthorized: true, actual: null});
    expect(result.reasons.join(" ")).toContain("cuda → cpu authorized");
  });

  it("explicit-order skips unimplemented ROCm and uses only an expressly ordered CPU", () => {
    const result = setup().choose(cuda("explicit-order"));
    expect(result.state).toBe("fallback");
    expect(result.reasons.join(" ")).toContain("rocm: fallback execution not implemented");
    expect(() => requestedExecutionSchema.parse({backend:"cuda",fallback:{policy:"explicit-order"}})).toThrow();
  });

  it("unknown physical backend stays UNKNOWN rather than fabricated UNSUPPORTED", () => {
    const ctx = setup(false, null);
    expect(ctx.profile.backendAvailability.cuda).toBe("UNKNOWN");
    expect(ctx.profile.devices[0].availability).toBe("UNKNOWN");
    const request = requestedExecutionSchema.parse({backend:"future-npu"});
    expect(ctx.choose(request).reasons.join(" ")).toContain("support UNKNOWN");
    expect(ctx.choose().state).toBe("rejected");
  });

  it("legacy gpuLayers 0 survives JSON persisted Fabric parse, identity and Qwen CPU projection", () => {
    const ctx = setup();
    const id = deploymentIdentity(ctx.deployment);
    const persisted = localComputeFabricSchema.parse(JSON.parse(JSON.stringify(ctx.fabric)));
    expect(persisted.deployments[0].configurationIdentity)
      .toBe('{"version":1,"context":2048,"gpu":0,"tool":false,"grammar":false}');
    expect(deploymentIdentity(persisted.deployments[0])).toBe(id);
    expect(deploymentRequestedExecution(ctx.deployment, ctx.runtime)).toMatchObject({
      backend: "cpu", gpuLayers: 0, contextLength: 2048, fallback: {policy: "disabled"},
    });
    expect(ctx.choose().selected?.backend).toBe("cpu");
  });

  it("requested CUDA cannot be reported as actual without exact native Ready evidence", () => {
    const ctx = setup();
    const requested = cuda("allow-compatible");
    expect(ctx.choose(requested).actual).toBeNull();
    const withClaim: ManagedLocalNativeStatus = {...installed, state: "Ready", deploymentId: ctx.deployment.id,
      actualExecution: {backend:"cuda", deviceIds:["GPU-5070-ti"],gpuLayers:40,
        runtimeVariantId:"b12248/cuda",runtimeEpoch:installed.epoch,
        source:"native-verified-managed-cpu-launch",observedAt:at-100}};
    expect(observedActualExecution(ctx.runtime, ctx.deployment, withClaim, at)).toBeNull();
    const genuine: ManagedLocalNativeStatus = {...withClaim, actualExecution: {
      backend:"cpu",deviceIds:["clack-this-pc:cpu:0"],gpuLayers:0,
      runtimeVariantId:"b12248/cpu",runtimeEpoch:installed.epoch,
      source:"native-verified-managed-cpu-launch",observedAt:at-100}};
    expect(actualExecutionSchema.safeParse(genuine.actualExecution).success).toBe(true);
    expect(observedActualExecution(ctx.runtime, ctx.deployment, genuine, at)?.backend).toBe("cpu");
    expect(observedActualExecution(ctx.runtime, ctx.deployment, {...genuine, epoch:"changed"}, at)).toBeNull();
    expect(observedActualExecution(ctx.runtime, ctx.deployment, genuine, at+30_001)).toBeNull();
    const selected = ctx.choose(requested, genuine);
    expect(selected.requested?.backend).toBe("cuda");
    expect(selected.actual?.backend).toBe("cpu");
    expect(selected.fallbackUsed).toBe(true);
  });

  it("native GPU UUID/device identity remains stable across inventory ordering", () => {
    const ctx = setup();
    const first = ctx.profile.devices[1].id;
    const second = projectHardwareProfile(ctx.host, ctx.runtime, {
      ...hardware(), gpus: [gpu("GPU-other"), gpu()],
    }, at).devices;
    expect(second.map(d => d.id)).toContain(first);
    expect(computeDeviceSchema.parse(ctx.profile.devices[1]).id).toBe(first);
    expect(observedComputeHost(ctx.host, ctx.profile).observedDevices?.[1].id).toBe(first);
    expect(nativeHardwareObservationSchema.safeParse(hardware()).success).toBe(true);
  });

  it("unknown available VRAM cannot pass a known CUDA memory requirement", () => {
    const ctx = setup();
    const futureRuntime = {...ctx.runtime, id: "test-verified-cuda-runtime", type: "test-runtime",
      backendVariants: [{id:"test/cuda",backend:"cuda",support:"AVAILABLE" as const,
        installation:"AVAILABLE" as const,source:"verified-native-test",trust:"VERIFIED" as const,
        supportedArtifactFormats:["gguf" as const]}]};
    const deployment = {...ctx.deployment, runtimeId:futureRuntime.id};
    const profile = projectHardwareProfile(ctx.host, futureRuntime, {
      ...hardware(), gpus:[{...gpu(), availableVramBytes:null}],
    }, at);
    const host = {...ctx.host, runtimeIds: [...ctx.host.runtimeIds, futureRuntime.id]};
    const result = selectDeploymentExecution({host,runtime:futureRuntime,deployment,artifact:ctx.artifact,hardware:profile,
      requested:cuda(),requiredDeviceBytes:2*GiB});
    expect(result.state).toBe("rejected");
    expect(result.reasons.join(" ")).toContain("device memory UNKNOWN");
    const low = projectHardwareProfile(ctx.host, futureRuntime, {
      ...hardware(), gpus:[{...gpu(), availableVramBytes:value(1*GiB)}],
    }, at);
    expect(selectDeploymentExecution({host,runtime:futureRuntime,deployment,artifact:ctx.artifact,hardware:low,
      requested:cuda(),requiredDeviceBytes:2*GiB}).reasons.join(" "))
      .toContain("insufficient available device memory");
  });

  it("unverified runtime backend variant is rejected rather than treated as executable", () => {
    const ctx = setup();
    const runtime = {...ctx.runtime,id:"new-runtime",type:"new-runtime",backendVariants:[{
      id:"new/cuda",backend:"cuda",support:"AVAILABLE" as const,
      installation:"AVAILABLE" as const,trust:"UNQUALIFIED" as const,source:"unverified-test",
    }]};
    const deployment = {...ctx.deployment,runtimeId:runtime.id};
    const profile = projectHardwareProfile(ctx.host,runtime,hardware(),at);
    const host = {...ctx.host,runtimeIds:[...ctx.host.runtimeIds,runtime.id]};
    expect(selectDeploymentExecution({host,runtime,deployment,artifact:ctx.artifact,hardware:profile,requested:cuda()}).reasons.join(" "))
      .toContain("runtime build trust UNQUALIFIED");
  });

  it("artifact format, digest ownership and declared context constrain backend admission", () => {
    const ctx = setup();
    const input = {host:ctx.host,runtime:ctx.runtime,deployment:ctx.deployment,
      artifact:ctx.artifact,hardware:ctx.profile,installedRuntime:installed};
    expect(selectDeploymentExecution({...input,artifact:{...ctx.artifact,id:"other"}}).reasons.join(" "))
      .toContain("artifact/deployment identity mismatch");
    expect(selectDeploymentExecution({...input,artifact:{...ctx.artifact,format:"opaque"}}).reasons.join(" "))
      .toContain("artifact format opaque compatibility UNKNOWN or unsupported");
    expect(selectDeploymentExecution({...input,artifact:{...ctx.artifact,declaredContext:1024}}).reasons.join(" "))
      .toContain("Requested context exceeds model-declared context limit");
  });

  it("selection and host projection never mutate persisted qualification or LM6 history", () => {
    const ctx = setup();
    ctx.fabric.qualificationReceipts = [{version:2, status:"failed", evidence:{checks:[{id:"instruction",result:"fail"}]}}];
    ctx.fabric.measurementRuns = [{version:1, result:"historic"}];
    const before = JSON.stringify(ctx.fabric);
    ctx.choose(cuda("allow-compatible"));
    observedComputeHost(ctx.host,ctx.profile);
    expect(JSON.stringify(ctx.fabric)).toBe(before);
    expect(localComputeFabricSchema.parse(ctx.fabric).qualificationReceipts).toEqual(ctx.fabric.qualificationReceipts);
  });
});
