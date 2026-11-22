import { describe, expect, it } from "vitest";
import { attachManagedCudaVariant, attachManagedLocalGguf,
  managedCudaConfigurationIdentity, managedCudaDeploymentId, managedLocalSelectionId,
  resolveManagedLocalSelection, savedManagedLocalModelInfos,
} from "./managedLocalModels";
import { deploymentIdentity,localComputeFabricSchema } from "./localComputeFabric";
import {emptySelfHostedState} from "./selfHostedProfiles";
import {runtimeBackendVariants,observedActualExecution} from "./executionBackendSelection";

const digest=`sha256:${"a".repeat(64)}`;
const device="clack-this-pc:accelerator:GPU-30ab48fd-809d-dc7d-c437-6ad626ece81a";
const created=()=>attachManagedLocalGguf(emptySelfHostedState(),{
  digest,displayName:"Qwen2.5 0.5B",size:491400032,
  material:{version:1,context:2048,gpu:0,tool:false,grammar:false},
});

describe("managed b12248/CUDA native-bound variant",()=>{
  it("registers a distinct canonical CUDA deployment without rewriting the CPU model or receipt arrays",()=>{
    const cpu=created();
    const old=JSON.stringify(cpu.state.fabric);
    const cuda=attachManagedCudaVariant(cpu.state,cpu.selectionId,{deviceId:device,gpuLayers:40,fallback:"disabled"});
    expect(JSON.stringify(cpu.state.fabric)).toBe(old);
    expect(cuda.state.fabric?.deployments).toHaveLength(2);
    expect(cuda.state.fabric?.runtimes).toHaveLength(1);
    expect(cuda.state.fabric?.artifacts).toHaveLength(1);
    expect(cuda.state.fabric?.deployments[0]).toEqual(cpu.state.fabric?.deployments[0]);
    const resolved=resolveManagedLocalSelection(cuda.state,cuda.selectionId);
    expect(resolved.status).not.toBe("missing");
    if(resolved.status==="missing"||resolved.status==="not-managed")throw Error("missing");
    expect(resolved.deployment).toMatchObject({variantId:"b12248/cuda",
      configurationIdentity:managedCudaConfigurationIdentity(2048),
      requestedExecution:{backend:"cuda",gpuLayers:40,contextLength:2048,
        deviceIds:[device],fallback:{policy:"disabled"}}});
    expect(resolved.deployment.id).toBe(managedCudaDeploymentId(digest,2048,40,device,"disabled"));
    expect(cuda.selectionId).toBe(managedLocalSelectionId(resolved.deployment));
    expect(deploymentIdentity(localComputeFabricSchema.parse(cuda.state.fabric).deployments[1]))
      .toBe(resolved.identity);
    expect(savedManagedLocalModelInfos(cuda.state)).toHaveLength(2);
  });
  it("is idempotent on an identical CUDA registration and isolates fallback-policy identity",()=>{
    const cpu=created();
    const cuda=attachManagedCudaVariant(cpu.state,cpu.selectionId,{deviceId:device,gpuLayers:40,fallback:"disabled"});
    const repeat=attachManagedCudaVariant(cuda.state,cpu.selectionId,{deviceId:device,gpuLayers:40,fallback:"disabled"});
    expect(repeat.state.fabric?.deployments).toHaveLength(2);
    expect(repeat.selectionId).toBe(cuda.selectionId);
    const fallback=attachManagedCudaVariant(repeat.state,cpu.selectionId,{deviceId:device,gpuLayers:40,fallback:"allow-compatible"});
    expect(fallback.state.fabric?.deployments).toHaveLength(3);
    expect(fallback.selectionId).not.toBe(cuda.selectionId);
    expect(fallback.state.fabric?.deployments[0]).toEqual(cpu.state.fabric?.deployments[0]);
  });
  it("rejects invalid devices, GPU layers and chained CUDA registrations",()=>{
    const cpu=created();
    expect(()=>attachManagedCudaVariant(cpu.state,cpu.selectionId,{deviceId:"GPU-unknown",gpuLayers:40,fallback:"disabled"})).toThrow();
    expect(()=>attachManagedCudaVariant(cpu.state,cpu.selectionId,{deviceId:device,gpuLayers:0,fallback:"disabled"})).toThrow();
    const cuda=attachManagedCudaVariant(cpu.state,cpu.selectionId,{deviceId:device,gpuLayers:40,fallback:"disabled"});
    expect(()=>attachManagedCudaVariant(cuda.state,cuda.selectionId,{deviceId:device,gpuLayers:20,fallback:"disabled"})).toThrow();
    expect(resolveManagedLocalSelection(cpu.state,cuda.selectionId)).toEqual({status:"missing"});
  });
  it("separates physically installed CPU and independently verified native CUDA variant",()=>{
    const runtime=localComputeFabricSchema.parse(created().state.fabric).runtimes[0];
    const cpu={installed:true,version:"b12248"};
    const notInstalled={installed:false,version:"b12248",engineArchiveSha256:"cuda-engine-archive-hash"};
    const unknown=runtimeBackendVariants(runtime,cpu);
    expect(unknown.find(v=>v.backend==="cuda")?.installation).toBe("UNKNOWN");
    expect(runtimeBackendVariants(runtime,cpu,notInstalled).find(v=>v.backend==="cuda")?.installation).toBe("UNAVAILABLE");
    expect(runtimeBackendVariants(runtime,cpu,{...notInstalled,installed:true}).find(v=>v.backend==="cuda"))
      .toMatchObject({support:"AVAILABLE",installation:"AVAILABLE",buildDigest:"cuda-engine-archive-hash"});
    expect(runtimeBackendVariants(runtime,cpu,notInstalled).find(v=>v.backend==="cpu"))
      .toMatchObject({support:"AVAILABLE",installation:"AVAILABLE"});
  });
  it("accepts native CUDA actual only when same deployment/device, real offload, fresh epoch",()=>{
    const cpu=created();
    const createdCuda=attachManagedCudaVariant(cpu.state,cpu.selectionId,{deviceId:device,gpuLayers:40,fallback:"disabled"});
    const fabric=localComputeFabricSchema.parse(createdCuda.state.fabric);
    const row=fabric.deployments[1],runtime=fabric.runtimes[0];
    const now=1800000000000;
    const status={installed:true,state:"Ready" as const,version:"b12248",epoch:"fresh",deploymentId:row.id,
      selectedBackend:"cuda",actualExecution:{backend:"cuda",deviceIds:[device],gpuLayers:25,
        runtimeVariantId:"b12248/cuda",runtimeEpoch:"fresh",observedAt:now-100,
        source:"native-verified-cuda-init-and-layer-offload"}};
    expect(observedActualExecution(runtime,row,status,now)).toMatchObject({backend:"cuda",gpuLayers:25});
    expect(observedActualExecution(runtime,row,{...status,actualExecution:{...status.actualExecution,gpuLayers:0}},now)).toBeNull();
    expect(observedActualExecution(runtime,row,{...status,actualExecution:{...status.actualExecution,deviceIds:["GPU-not-selected"]}},now)).toBeNull();
    expect(observedActualExecution(runtime,row,{...status,epoch:"stale"},now)).toBeNull();
    expect(observedActualExecution(runtime,row,status,now+40000)).toBeNull();
    expect(observedActualExecution(runtime,localComputeFabricSchema.parse(cpu.state.fabric).deployments[0],status,now)).toBeNull();
  });
});
