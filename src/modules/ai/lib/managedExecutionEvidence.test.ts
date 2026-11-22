import {describe,expect,it} from "vitest";
import {
  deploymentIdentity,executionPolicyIdentity,requestedExecutionSchema,
  deploymentQualificationScope,
  type RequestedExecution,
} from "./localComputeFabric";
import {
  attachManagedLocalGguf,attachManagedExecutionPolicyVariant,resolveManagedLocalSelection,
} from "./managedLocalModels";
import {
  observedManagedExecutionIdentity,isCurrentManagedExecutionIdentity,
  correlateManagedExecutionTelemetry,stableManagedExecutionKey,
} from "./managedExecutionEvidence";
import {observedManagedFabric} from "./deploymentQualificationView";
import type {ManagedLocalNativeStatus,ManagedLocalNativeRoute} from "./managedLocalRuntime";
import {emptySelfHostedState} from "./selfHostedProfiles";
import type {NativeHardwareObservation} from "./hardwareProfile";

const NOW=1_800_000_000_000;
const digest=`sha256:${"a".repeat(64)}`;
const device="clack-this-pc:accelerator:GPU-30ab48fd-809d-dc7d-c437-6ad626ece81a";
const cpuDevice="clack-this-pc:cpu:0";
const CPU_SHA="sha256:bb306bfd390f8782c0acaba490505d12f07392791b48f1dd039387a5bacf1181";
const CUDA_SHA="sha256:ae0a1e064a94db82f3352c843ffa96eb190254fefafc29ce0213798c549a2799";
const cpu={backend:"cpu",deviceIds:[cpuDevice],gpuLayers:0,
  runtimeVariantId:"b12248/cpu",runtimeBuildDigest:CPU_SHA};
const cuda={backend:"cuda",deviceIds:[device],gpuLayers:40,
  runtimeVariantId:"b12248/cuda",runtimeBuildDigest:CUDA_SHA};
const source=attachManagedLocalGguf(emptySelfHostedState(),{
  digest,displayName:"Native receipt test GGUF",
  material:{version:1,context:2048,gpu:0,tool:false,grammar:false},
});
function fixture(kind:"cpu"|"cuda"|"fallback"="cpu"){
  const candidates=kind==="cpu"?[cpu]:kind==="cuda"?[cuda]:[cuda,cpu];
  const req:RequestedExecution=requestedExecutionSchema.parse({
    backend:candidates[0].backend,deviceIds:candidates[0].deviceIds,
    gpuLayers:candidates[0].gpuLayers,contextLength:2048,
    fallback:kind==="fallback"?{policy:"explicit-order",order:["cpu"]}:{policy:"disabled"},
    candidates,deviceStrategy:{kind:"single",primaryDeviceId:candidates[0].deviceIds[0]},
  });
  const created=attachManagedExecutionPolicyVariant(source.state,source.selectionId,req);
  const resolved=resolveManagedLocalSelection(created.state,created.selectionId);
  if(resolved.status==="missing"||resolved.status==="not-managed") throw Error("fixture");
  const actualBackend=kind==="fallback"?"cpu":kind;
  const actualCandidate=actualBackend==="cpu"?cpu:cuda;
  const fallbackUsed=kind==="fallback";
  const pid=4711,epoch="b".repeat(64),offload=actualBackend==="cuda"?25:0;
  const native:ManagedLocalNativeStatus={
    installed:true,state:"Ready",runtimeId:resolved.runtime.id,
    version:"b12248",epoch,processId:pid,port:49222,
    deploymentId:resolved.deployment.id,modelDigest:digest,
    selectedBackend:actualBackend,requestedBackend:req.backend,
    requestedGpuLayers:req.gpuLayers,selectedGpuLayers:fallbackUsed?0:req.gpuLayers,
    fallbackUsed,fallbackAuthorized:fallbackUsed,
    fallbackReason:fallbackUsed?"CUDA startup memory admission rejected":null,
    gpuFreeBeforeBytes:actualBackend==="cuda"?8*1024**3:null,
    gpuEstimatedRequiredBytes:actualBackend==="cuda"?2*1024**3:null,
    actualExecution:{
      backend:actualBackend,deviceIds:actualCandidate.deviceIds,
      gpuLayers:offload,runtimeVariantId:actualCandidate.runtimeVariantId,
      runtimeEpoch:epoch,observedAt:NOW-100,contextLength:2048,
      source:actualBackend==="cuda"?"native-verified-cuda-init-and-layer-offload"
        :"native-verified-managed-cpu-launch",
      executionReceipt:{
        version:3,deploymentId:resolved.deployment.id,
        deploymentIdentity:deploymentIdentity(resolved.deployment),
        policyIdentity:executionPolicyIdentity(req),
        selectedCandidateIndex:fallbackUsed?1:0,processId:pid,
        runtimeBuildDigest:actualCandidate.runtimeBuildDigest,
        fallbackUsed,fallbackAuthorized:fallbackUsed,
        measuredHostBytes:12*1024**3,
        ...(actualBackend==="cuda"?{measuredDeviceBytes:8*1024**3}:{}),
      },
    },
  };
  const route:ManagedLocalNativeRoute={
    baseUrl:"http://127.0.0.1:49222/v1",apiKey:"c".repeat(64),
    epoch,modelAlias:`clack-${digest.slice(7,23)}`,processId:pid,
  };
  return {...created,resolved,req,native,route};
}
const gpuObs=(id="GPU-30ab48fd-809d-dc7d-c437-6ad626ece81a")=>{
  const at=NOW-150;
  const v=<T,>(value:T)=>({value,source:"native-os-readonly",observedAt:at});
  return {deviceId:v(id),vendor:v("NVIDIA"),
    model:v("RTX 5070 Ti"),totalVramBytes:v(16*1024**3),
    availableVramBytes:v(10*1024**3),driverVersion:v("616.92"),
    computeArchitecture:v("12.0"),cudaHardwareCapable:v(true)};
};
function hardware():NativeHardwareObservation{return {
  os:"windows",architecture:"x86_64",logicalProcessors:16,
  logicalProcessorsSource:"native-os-readonly",
  cpuManufacturer:null,cpuModel:null,physicalCores:null,
  totalRamBytes:32*1024**3,availableRamBytes:14*1024**3,
  observedAt:NOW-150,source:"native-os-readonly",
  gpus:[gpuObs()],gpuInventoryComplete:true,
};}

describe("Slice 5 single canonical managed execution identity",()=>{
  it("joins actual authenticated CPU and CUDA, not requested GPU existence or estimated offload",()=>{
    const c=fixture("cpu"),g=fixture("cuda");
    const cpuProof=observedManagedExecutionIdentity(c.state,c.selectionId,c.native,NOW,c.route)!;
    const cudaProof=observedManagedExecutionIdentity(g.state,g.selectionId,g.native,NOW,g.route)!;
    expect(cpuProof).toMatchObject({actual:{backend:"cpu",gpuLayers:0},
      runtime:{processId:4711,epoch:"b".repeat(64)},
      deployment:{artifactDigest:digest}});
    expect(cudaProof).toMatchObject({requested:{gpuLayers:40},
      selected:{selectedGpuLayers:40},actual:{backend:"cuda",gpuLayers:25,
        deviceIds:[device]},memory:{deviceAvailableBeforeBytes:8*1024**3}});
    expect(cpuProof.stableExecutionIdentity).not.toEqual(cudaProof.stableExecutionIdentity);
    expect(JSON.stringify(cudaProof)).not.toContain(g.route.apiKey);
    expect(cudaProof.runtime.route).toEqual({baseUrl:g.route.baseUrl,
      alias:g.route.modelAlias,processId:4711,epoch:g.route.epoch});
  });
  it("scopes LM2F by actual backend/device/build/policy rather than transferring CPU to CUDA",()=>{
    const c=fixture("cpu"),g=fixture("cuda"),f=fixture("fallback");
    const proofs=[c,g,f].map(row=>{
      const projection=observedManagedFabric(row.state,row.selectionId,row.native,NOW)!;
      expect(projection.observation?.executionIdentity).toBeTruthy();
      return deploymentQualificationScope(projection.fabric,
        row.resolved.deployment.id,projection.observation,NOW)!;
    });
    expect(new Set(proofs.map(row=>row.executionIdentity)).size).toBe(3);
    expect(proofs[0].deploymentIdentity).not.toEqual(proofs[1].deploymentIdentity);
    expect(proofs[2].executionIdentity).not.toBe(proofs[1].executionIdentity);
    const altered={...g.native,actualExecution:undefined};
    expect(observedManagedFabric(g.state,g.selectionId,altered,NOW)?.observation).toBeUndefined();
    expect(observedManagedExecutionIdentity(g.state,g.selectionId,altered,NOW)).toBeNull();
  });
  it("refuses stale, stopped, policy-switched, spoofed-route and restarted liveness",()=>{
    const a=fixture("cuda");
    const proof=observedManagedExecutionIdentity(a.state,a.selectionId,a.native,NOW,a.route)!;
    expect(isCurrentManagedExecutionIdentity(proof,a.state,a.selectionId,a.native,a.route,NOW)).toBe(true);
    expect(observedManagedExecutionIdentity(a.state,a.selectionId,a.native,NOW+30_001)).toBeNull();
    expect(isCurrentManagedExecutionIdentity(proof,a.state,a.selectionId,
      {...a.native,state:"Stopped"},a.route,NOW)).toBe(false);
    expect(observedManagedExecutionIdentity(a.state,a.selectionId,a.native,NOW,
      {...a.route,epoch:"d".repeat(64)})).toBeNull();
    const newEpoch="e".repeat(64);
    const restartedNative={...a.native,epoch:newEpoch,processId:6009,
      actualExecution:{...a.native.actualExecution!,runtimeEpoch:newEpoch,observedAt:NOW,
        executionReceipt:{...a.native.actualExecution!.executionReceipt!,processId:6009}}};
    const newRoute={...a.route,epoch:newEpoch,processId:6009,
      baseUrl:"http://127.0.0.1:49222/v1"};
    const current=observedManagedExecutionIdentity(a.state,a.selectionId,restartedNative,NOW,newRoute);
    expect(current?.stableExecutionIdentity).toEqual(proof.stableExecutionIdentity);
    expect(isCurrentManagedExecutionIdentity(proof,a.state,a.selectionId,
      restartedNative,newRoute,NOW)).toBe(false);
    const changed=fixture("cpu");
    expect(isCurrentManagedExecutionIdentity(proof,changed.state,changed.selectionId,
      changed.native,changed.route,NOW)).toBe(false);
  });
  it("correlates RTX telemetry ONLY by canonical device UUID, never array position",()=>{
    const a=fixture("cuda");
    const proof=observedManagedExecutionIdentity(a.state,a.selectionId,a.native,NOW)!;
    const good=correlateManagedExecutionTelemetry(proof,hardware(),NOW);
    expect(good.gpuModel).toMatchObject({value:"RTX 5070 Ti",provenance:"Measured"});
    expect(good.availableDeviceMemoryBytes).toMatchObject({
      value:10*1024**3,provenance:"Measured"});
    expect(good.nativeAvailableBeforeBytes).toMatchObject({
      value:8*1024**3,provenance:"Measured"});
    expect(good.nativeEstimatedDeviceRequirementBytes).toMatchObject({
      value:2*1024**3,provenance:"Estimated"});
    expect(correlateManagedExecutionTelemetry(proof,{...hardware(),
      gpus:[gpuObs("GPU-same-display-different-UUID")]},NOW)
      .availableDeviceMemoryBytes.value).toBeNull();
    expect(correlateManagedExecutionTelemetry(proof,null,NOW).gpuModel.value).toBeNull();
    expect(correlateManagedExecutionTelemetry(proof,hardware(),NOW+30_001)
      .availableDeviceMemoryBytes.value).toBeNull();
    const cpu=fixture("cpu");
    const cpuProof=observedManagedExecutionIdentity(cpu.state,cpu.selectionId,cpu.native,NOW)!;
    const cpuTelemetry=correlateManagedExecutionTelemetry(cpuProof,hardware(),NOW);
    expect(cpuTelemetry.cpuLogicalProcessors.value).toBe(16);
    expect(cpuTelemetry.availableDeviceMemoryBytes.value).toBeNull();
    expect(cpuTelemetry.nativeAvailableBeforeBytes.value).toBeNull();
  });
  it("keeps future backend/multi-device canonical identities representable, not physical actual",()=>{
    const key=stableManagedExecutionKey({
      deploymentIdentity:"deployment",policyIdentity:"policy",runtimeVersion:"x",
      backend:"rocm",deviceIds:["stable-uuid-A","stable-uuid-B"],
      runtimeVariantId:"future/rocm",runtimeBuildDigest:null,
    });
    expect(key).toContain("stable-uuid-A");
    expect(key).toContain("stable-uuid-B");
    expect(key).not.toContain("pid:");
    const cudaPolicy=fixture("cuda");
    const invalid={...cudaPolicy.native,actualExecution:{
      ...cudaPolicy.native.actualExecution!,deviceIds:[device,"second-gpu"]}};
    expect(observedManagedExecutionIdentity(cudaPolicy.state,cudaPolicy.selectionId,
      invalid,NOW)).toBeNull();
  });
});
