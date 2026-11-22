import { describe, expect, it } from "vitest";
import { deploymentIdentity, executionPolicyIdentity, requestedExecutionSchema,
  type ActualExecution, type RequestedExecution } from "./localComputeFabric";
import { attachManagedCudaVariant, attachManagedExecutionPolicyVariant, attachManagedLocalGguf,
  resolveManagedLocalSelection } from "./managedLocalModels";
import { projectModelResourceProfile } from "./modelResourceProfile";
import { emptySelfHostedState } from "./selfHostedProfiles";

const at = 1_800_000_000_000;
const digest = `sha256:${"a".repeat(64)}`;
const cpuId = "clack-this-pc:cpu:0";
const gpuId = "clack-this-pc:accelerator:GPU-30ab48fd-809d-dc7d-c437-6ad626ece81a";
const cpuCandidate = {backend:"cpu" as const,deviceIds:[cpuId],gpuLayers:0,
  runtimeVariantId:"b12248/cpu"};
const cudaCandidate = {backend:"cuda" as const,deviceIds:[gpuId],gpuLayers:40,
  runtimeVariantId:"b12248/cuda"};

function fixture(candidates: NonNullable<RequestedExecution["candidates"]> = [cudaCandidate]) {
  const original = attachManagedLocalGguf(emptySelfHostedState(),{
    digest, displayName:"Measured model",size:491_400_032,
    fileIdentity:`${digest.slice(7)}:491400032`,
    material:{version:1,context:2048,gpu:0,tool:false,grammar:false},
  });
  const legacy = resolveManagedLocalSelection(original.state,original.selectionId);
  if (legacy.status === "missing" || legacy.status === "not-managed") throw Error("missing fixture");
  const requested = requestedExecutionSchema.parse({
    backend:candidates[0].backend,deviceIds:candidates[0].deviceIds,
    gpuLayers:candidates[0].gpuLayers,contextLength:2048,candidates,
    fallback:candidates.length > 1
      ? {policy:"explicit-order",order:candidates.slice(1).map(c=>c.backend)}
      : {policy:"disabled"},
  });
  const attached = attachManagedExecutionPolicyVariant(original.state,original.selectionId,requested);
  const selected = resolveManagedLocalSelection(attached.state,attached.selectionId);
  if (selected.status === "missing" || selected.status === "not-managed") throw Error("missing v3");
  const {artifact,runtime,deployment} = selected;
  const project = (actual?: ActualExecution | null, blockCount?: number) =>
    projectModelResourceProfile(artifact,runtime,deployment,
      blockCount ? {digest,size:491_400_032,format:"gguf" as const,
        fileIdentity:`${digest.slice(7)}:491400032`,blockCount} : null,actual);
  const actual = (backend: "cpu"|"cuda",gpuLayers: number,selectedCandidateIndex: number): ActualExecution => ({
    backend,deviceIds:[backend === "cpu" ? cpuId : gpuId],gpuLayers,
    runtimeVariantId:`b12248/${backend}`,runtimeEpoch:"native-current",contextLength:2048,
    source:backend === "cpu" ? "native-verified-managed-cpu-launch" :
      "native-verified-cuda-init-and-layer-offload",observedAt:at-100,
    executionReceipt:{version:3,deploymentId:deployment.id,
      deploymentIdentity:deploymentIdentity(deployment),policyIdentity:executionPolicyIdentity(requested),
      selectedCandidateIndex,processId:7001,
      fallbackUsed:selectedCandidateIndex > 0,fallbackAuthorized:selectedCandidateIndex > 0},
  });
  return {original,legacy,requested,artifact,runtime,deployment,project,actual};
}

describe("v3 canonical model-resource projection is observation-only",()=>{
  it("preserves legacy v1 CPU derived geometry and v2 CUDA unknown placement",()=>{
    const f=fixture();
    const v1=projectModelResourceProfile(f.legacy.artifact,f.legacy.runtime,f.legacy.deployment);
    expect(v1.configuredContext.value).toBe(2048);
    expect(v1.executionPlacement).toMatchObject({value:"CPU",provenance:"Derived"});
    expect(v1.gpuLayers).toMatchObject({value:0,provenance:"Derived"});
    const v2 = attachManagedCudaVariant(f.original.state,f.original.selectionId,
      {deviceId:gpuId,gpuLayers:40,fallback:"disabled"});
    const selected=resolveManagedLocalSelection(v2.state,v2.selectionId);
    if(selected.status==="missing"||selected.status==="not-managed")throw Error("missing v2");
    const projected=projectModelResourceProfile(selected.artifact,selected.runtime,selected.deployment);
    expect(projected.executionPlacement.value).toBeNull();
    expect(projected.gpuLayers.value).toBeNull();
  });

  it("recovers v3 context only from exact canonical config and persisted policy, never from a candidate",()=>{
    const f=fixture();
    expect(f.project()).toMatchObject({
      configuredContext:{value:2048,provenance:"Derived"},
      requestedGpuLayers:{value:40,provenance:"Derived"},
      executionPlacement:{value:null,provenance:"Unknown"},
      gpuLayers:{value:null,provenance:"Unknown"},
    });
    for (const deployment of [
      {...f.deployment,configurationIdentity:JSON.stringify({version:3,context:4096,tool:false,grammar:false})},
      {...f.deployment,id:"a different identity"},
      {...f.deployment,requestedExecution:{...f.requested,contextLength:4096}},
      {...f.deployment,requestedExecution:{...f.requested,gpuLayers:20}},
    ]) {
      const invalid=projectModelResourceProfile(f.artifact,f.runtime,deployment);
      expect(invalid.configuredContext.value).toBeNull();
      expect(invalid.executionPlacement.value).toBeNull();
      expect(invalid.requestedGpuLayers.value).toBeNull();
    }
  });

  it("shows 40 requested CUDA layers but 25 actual, with conservative GPU/Hybrid geometry",()=>{
    const f=fixture();
    const actual=f.actual("cuda",25,0);
    expect(f.project(actual,25)).toMatchObject({
      executionPlacement:{value:"GPU",provenance:"Measured"},
      requestedGpuLayers:{value:40,provenance:"Derived"},
      gpuLayers:{value:25,provenance:"Measured"},
      configuredContext:{value:2048},
    });
    expect(f.project(actual,40).executionPlacement.value).toBe("Hybrid");
    expect(f.project().gpuLayers.value).toBeNull();
    expect(f.project(actual).gpuLayers.source).toBe("native-verified-cuda-init-and-layer-offload");
    if (!actual.executionReceipt) throw Error("missing native proof");
    expect(f.project({...actual,executionReceipt:{...actual.executionReceipt,
      deploymentIdentity:"another deployment"}}).gpuLayers.value).toBeNull();
  });

  it("distinguishes authorized CUDA-to-CPU fallback from initial CUDA request",()=>{
    const f=fixture([cudaCandidate,cpuCandidate]);
    const projected=f.project(f.actual("cpu",0,1));
    expect(projected.executionPlacement).toMatchObject({value:"CPU",provenance:"Measured"});
    expect(projected.gpuLayers).toMatchObject({value:0,provenance:"Measured"});
    expect(projected.requestedGpuLayers).toMatchObject({value:40,provenance:"Derived"});
    expect(fixture([cpuCandidate]).project().executionPlacement.value).toBeNull();
  });
});
