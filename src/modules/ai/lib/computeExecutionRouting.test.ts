import { describe, expect, it } from "vitest";
import {
  CURRENT_DEPLOYMENT_QUALIFICATION_PROCEDURES,
  deploymentIdentity, deploymentQualificationScope, executionPolicyIdentity,
  requestedExecutionSchema, type RequestedExecution,
} from "./localComputeFabric";
import { assessManagedComputeRoute } from "./computeExecutionRouting";
import { observedManagedFabric } from "./deploymentQualificationView";
import { projectHardwareProfile, type NativeHardwareObservation } from "./hardwareProfile";
import {
  attachManagedExecutionPolicyVariant, attachManagedLocalGguf,
  resolveManagedLocalSelection,
} from "./managedLocalModels";
import type { ManagedCudaVariantStatus, ManagedLocalNativeStatus } from "./managedLocalRuntime";
import { emptySelfHostedState, type SelfHostedState } from "./selfHostedProfiles";

// All fixtures are offline; no provider, native IPC, settings write or scheduler.
const NOW = 1_800_000_000_000;
const digest = `sha256:${"a".repeat(64)}`;
const cpuDevice = "clack-this-pc:cpu:0";
const gpuDevice = "clack-this-pc:accelerator:GPU-30ab48fd-809d-dc7d-c437-6ad626ece81a";
const otherGpu = "clack-this-pc:accelerator:GPU-b36dc7ce-49ae-4d72-ae71-a0fe2c2144aa";
const cpuBuild = "sha256:bb306bfd390f8782c0acaba490505d12f07392791b48f1dd039387a5bacf1181";
const cudaBuild = "sha256:ae0a1e064a94db82f3352c843ffa96eb190254fefafc29ce0213798c549a2799";
const cpu = { backend: "cpu" as const, deviceIds: [cpuDevice], gpuLayers: 0,
  runtimeVariantId: "b12248/cpu", runtimeBuildDigest: cpuBuild };
const cuda = { backend: "cuda" as const, deviceIds: [gpuDevice], gpuLayers: 40,
  runtimeVariantId: "b12248/cuda", runtimeBuildDigest: cudaBuild };
const cudaVariant: ManagedCudaVariantStatus = {
  installed: true, runtimeVariantId: "b12248/cuda", backend: "cuda", version: "b12248",
  platform: "windows-x64", source: "official-pinned-native", engineArchiveSha256: cudaBuild,
  dependencyArchiveSha256: cudaBuild, executableSha256: cudaBuild, license: "MIT",
};
const legacy = attachManagedLocalGguf(emptySelfHostedState(), {
  digest, displayName: "Offline routing GGUF", size: 491_400_032,
  fileIdentity: `${digest.slice(7)}:491400032`,
  material: { version: 1, context: 2048, gpu: 0, tool: false, grammar: false },
});

function fixture(kind: "cpu" | "cuda" | "fallback" = "cpu",
  candidates?: NonNullable<RequestedExecution["candidates"]>) {
  const order = candidates ?? (kind === "cpu" ? [cpu] : kind === "cuda" ? [cuda] : [cuda, cpu]);
  const first = order[0];
  const requested = requestedExecutionSchema.parse({
    backend: first.backend, deviceIds: first.deviceIds, gpuLayers: first.gpuLayers,
    contextLength: 2048, candidates: order,
    fallback: order.length > 1
      ? { policy: "explicit-order", order: order.slice(1).map(row => row.backend) }
      : { policy: "disabled" },
  });
  const created = attachManagedExecutionPolicyVariant(legacy.state, legacy.selectionId, requested);
  // The saved native owner's liveness is a separate Fabric fact from a
  // passing native execution receipt. Make the healthy case explicit here.
  const state: SelfHostedState = {...created.state, fabric: {
    ...created.state.fabric!,
    hosts: created.state.fabric!.hosts.map(row =>
      ({...row, reachability: "online" as const})),
    runtimes: created.state.fabric!.runtimes.map(row =>
      ({...row, health: "online" as const})),
  }};
  const selected = resolveManagedLocalSelection(state, created.selectionId);
  if (selected.status === "missing" || selected.status === "not-managed")
    throw Error("Invalid exact v3 fixture");
  const index = kind === "fallback" ? 1 : 0;
  const backend = kind === "fallback" ? "cpu" : kind;
  const selectedCandidate = order[index];
  const fallback = index > 0;
  const native: ManagedLocalNativeStatus = {
    installed: true, state: "Ready", runtimeId: selected.runtime.id,
    version: "b12248", epoch: "epoch-native-7", processId: 7001, port: 61001,
    deploymentId: selected.deployment.id, modelDigest: digest,
    requestedBackend: requested.backend, selectedBackend: backend,
    selectedCandidateIndex: index, requestedGpuLayers: requested.gpuLayers,
    selectedGpuLayers: selectedCandidate.gpuLayers, selectedDeviceId: selectedCandidate.deviceIds[0],
    fallbackUsed: fallback, fallbackAuthorized: fallback,
    actualExecution: {
      backend, deviceIds: selectedCandidate.deviceIds, gpuLayers: backend === "cuda" ? 25 : 0,
      runtimeVariantId: selectedCandidate.runtimeVariantId ?? `b12248/${backend}`,
      runtimeEpoch: "epoch-native-7", observedAt: NOW - 100, contextLength: 2048,
      source: backend === "cuda" ? "native-verified-cuda-init-and-layer-offload"
        : "native-verified-managed-cpu-launch",
      executionReceipt: {
        version: 3, deploymentId: selected.deployment.id,
        deploymentIdentity: deploymentIdentity(selected.deployment),
        policyIdentity: executionPolicyIdentity(requested), selectedCandidateIndex: index,
        processId: 7001, runtimeBuildDigest: selectedCandidate.runtimeBuildDigest,
        fallbackUsed: fallback, fallbackAuthorized: fallback,
      },
    },
  };
  const assess = (options: Parameters<typeof assessManagedComputeRoute>[0] = {
    state, selectionId: created.selectionId, native, now: NOW,
    cudaVariant: kind === "cpu" ? null : cudaVariant,
  }) => assessManagedComputeRoute(options);
  return { ...created, state, selected, requested, native, assess };
}

function gpuHardware(f: ReturnType<typeof fixture>) {
  const value = <T,>(data: T) => ({ value: data, source: "native-os-readonly", observedAt: NOW - 100 });
  const hardware: NativeHardwareObservation = {
    os: "windows", architecture: "x86_64", logicalProcessors: 16,
    logicalProcessorsSource: "native-os-readonly", cpuManufacturer: null,
    cpuModel: null, physicalCores: null, totalRamBytes: 32 * 1024 ** 3,
    availableRamBytes: 14 * 1024 ** 3, observedAt: NOW - 100,
    source: "native-os-readonly", gpuInventoryComplete: true,
    gpus: [{ deviceId: value(gpuDevice.slice(gpuDevice.lastIndexOf(":") + 1)),
      vendor: value("NVIDIA"), model: value("RTX 5070 Ti"),
      totalVramBytes: value(16 * 1024 ** 3), availableVramBytes: value(9 * 1024 ** 3),
      driverVersion: value("616.92"), computeArchitecture: value("12.0"),
      cudaHardwareCapable: value(true) }],
  };
  return projectHardwareProfile(f.selected.host, f.selected.runtime, hardware, NOW);
}

describe("Slice 5 read-only compute-facing route integration", () => {
  it("does not fabricate a deployment, backend, route or Agent authority for a missing selection", () => {
    const missing = assessManagedComputeRoute({state: legacy.state,
      selectionId: "managed-local:missing", now: NOW});
    expect(missing).toMatchObject({deploymentAvailable:false, deploymentId:null,
      requestedPolicy:null,
      runtime:{ready:false}, placement:{state:"unknown",execution:null},
      qualification:{chatQualified:false,agentQualified:false},
      memory:{fit:"Unknown"},routeFor:"unavailable"});
  });

  it("admits a native-verified pinned CPU execution but never equates Chat transport with qualification", () => {
    const f = fixture("cpu");
    const result = f.assess();
    expect(result.requestedPolicy).toEqual(f.requested);
    expect(result).toMatchObject({deploymentAvailable:true,
      requestedBackendOrder:["cpu"],backend:{requested:"cpu",installed:true,
        verifiedBuild:true,backendAvailable:true},runtime:{ready:true,version:"b12248"},
      placement:{state:"native-verified",execution:{actual:{backend:"cpu",gpuLayers:0}}},
      qualification:{chatQualified:false,agentQualified:false},memory:{fit:"Unknown"},
      routeFor:"chat-only"});
  });

  it("separates CUDA hardware discovery and a trusted installed CUDA variant from Agent proof", () => {
    const f = fixture("cuda");
    const real = f.assess({...{
      state:f.state, selectionId:f.selectionId, now:NOW, native:f.native,
      cudaVariant, hardware:gpuHardware(f),
    }});
    expect(real).toMatchObject({requestedBackendOrder:["cuda"],
      backend:{requested:"cuda",installed:true,verifiedBuild:true,backendAvailable:true},
      runtime:{ready:true},placement:{state:"native-verified",
        execution:{selected:{requestedGpuLayers:40},actual:{backend:"cuda",gpuLayers:25}}},
      qualification:{agentQualified:false,chatQualified:false},routeFor:"chat-only"});
    expect(real.qualification.agentReason).toContain("Chat capability");
    const detectedOnly = f.assess({state:f.state,selectionId:f.selectionId,now:NOW,
      hardware:gpuHardware(f),cudaVariant});
    expect(detectedOnly).toMatchObject({backend:{backendAvailable:false},
      runtime:{ready:false},placement:{state:"unverified",execution:null},
      qualification:{agentQualified:false},routeFor:"unavailable"});
  });

  it("retains requested CUDA order but shows independently observed CPU fallback, not fabricated GPU offload", () => {
    const f=fixture("fallback");
    const route=f.assess();
    expect(route.requestedPolicy?.fallback.policy).toBe("explicit-order");
    expect(route).toMatchObject({requestedBackendOrder:["cuda","cpu"],
      placement:{state:"native-verified",execution:{selected:{fallbackUsed:true,
        fallbackAuthorized:true},actual:{backend:"cpu",gpuLayers:0}}},
      runtime:{ready:true},qualification:{agentQualified:false},routeFor:"chat-only"});
  });

  it("revokes current backend/route on stale, stopped, mismatched or missing native Ready", () => {
    const f=fixture("cuda");
    const deny = (native: ManagedLocalNativeStatus | null, now=NOW) =>
      f.assess({state:f.state,selectionId:f.selectionId,native,cudaVariant,now});
    for (const native of [null,{...f.native,state:"Stopped" as const},
      {...f.native,modelDigest:`sha256:${"b".repeat(64)}`},
      {...f.native,epoch:"restarted",processId:8002},
      {...f.native,actualExecution:null}]) {
      const result=deny(native);
      expect(result).toMatchObject({runtime:{ready:false},
        placement:{state:"unverified",execution:null},
        qualification:{agentQualified:false,chatQualified:false},routeFor:"unavailable"});
    }
    expect(deny(f.native,NOW+30_001).runtime.ready).toBe(false);
  });

  it("rejects disabled or offline Fabric ownership even with a genuinely matching native Ready", () => {
    const f=fixture("cpu");
    for (const state of [
      {...f.state,fabric:{...f.state.fabric!,hosts:f.state.fabric!.hosts.map(row=>
        ({...row,enabled:false}))}},
      {...f.state,fabric:{...f.state.fabric!,runtimes:f.state.fabric!.runtimes.map(row=>
        ({...row,enabled:false}))}},
      // Canonical Fabric derives host reachability from its runtimes, so
      // merely mutating host.reachability while runtime stays online is not
      // a genuine offline owner after reconciliation.
      {...f.state,fabric:{...f.state.fabric!,runtimes:f.state.fabric!.runtimes.map(row=>
        ({...row,health:"offline" as const}))}},
    ]) {
      const evidence=f.assess({state,selectionId:f.selectionId,native:f.native,now:NOW});
      expect(evidence).toMatchObject({deploymentAvailable:false,
        backend:{backendAvailable:false},runtime:{ready:false},
        qualification:{agentQualified:false},routeFor:"unavailable"});
    }
  });

  it("recognizes only exact current Chat qualification; identical policy CPU fallback cannot inherit CUDA proof", () => {
    const f=fixture("cuda");
    const viewed=observedManagedFabric(f.state,f.selectionId,f.native,NOW);
    const scope=viewed?.observation && deploymentQualificationScope(viewed.fabric,
      f.selected.deployment.id,viewed.observation,NOW);
    if(!scope?.executionIdentity)throw Error("Expected native-scoped v3 qualification");
    const receipt={version:2 as const,scope:{...scope,deploymentId:f.selected.deployment.id},
      capability:"chat" as const,status:"verified" as const,
      verifiedAt:NOW-2000,expiresAt:NOW+60_000,
      procedure:CURRENT_DEPLOYMENT_QUALIFICATION_PROCEDURES.chat,context:{},
      evidence:{source:"clack-transport" as const,reference:"bounded-chat",digest,
        checks:[{id:"bounded-chat",result:"pass" as const}]}};
    const qualified:SelfHostedState={...f.state,fabric:{...f.state.fabric!,
      qualificationReceipts:[receipt]}};
    const current=assessManagedComputeRoute({state:qualified,
      selectionId:f.selectionId,native:f.native,cudaVariant,now:NOW});
    expect(current.qualification).toMatchObject({chatQualified:true,agentQualified:false});
    expect(current.routeFor).toBe("chat-only");
    const stopped=assessManagedComputeRoute({state:qualified,
      selectionId:f.selectionId,native:{...f.native,state:"Stopped"},cudaVariant,now:NOW});
    expect(stopped.qualification.chatQualified).toBe(false);
    const changed=fixture("fallback");
    const fallback:SelfHostedState={...changed.state,fabric:{...changed.state.fabric!,
      qualificationReceipts:[receipt]}};
    expect(assessManagedComputeRoute({state:fallback,selectionId:changed.selectionId,
      native:changed.native,cudaVariant,now:NOW}).qualification.chatQualified).toBe(false);
  });

  it("keeps future and multi-device candidates representable but never actual or executable", () => {
    const future=fixture("cpu",[{backend:"rocm",deviceIds:["device-future"],gpuLayers:40}]);
    expect(future.assess({state:future.state,selectionId:future.selectionId,now:NOW}))
      .toMatchObject({requestedBackendOrder:["rocm"],
        runtime:{ready:false},placement:{execution:null},routeFor:"unavailable"});
    const multi=fixture("cuda",[{...cuda,deviceIds:[gpuDevice,otherGpu]}]);
    expect(multi.assess()).toMatchObject({requestedBackendOrder:["cuda"],
      runtime:{ready:false},placement:{execution:null},
      qualification:{agentQualified:false},routeFor:"unavailable"});
  });
});
