import {beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("@tauri-apps/api/core",()=>({invoke:vi.fn()}));
import {invoke} from "@tauri-apps/api/core";
import {ManagedLlamaExecutionAdapter} from "./localRuntimeAdapters";
import type {ManagedLocalNativeRoute,ManagedLocalNativeStatus} from "./managedLocalRuntime";
const identity={
  deploymentId:"deployment-v3",deploymentIdentity:"exact-fabric-identity",
  artifactDigest:`sha256:${"a".repeat(64)}`,configurationRevision:1,
};
const route:ManagedLocalNativeRoute={
  baseUrl:"http://127.0.0.1:49832/v1",
  apiKey:"b".repeat(64),epoch:"c".repeat(64),modelAlias:`clack-${"a".repeat(16)}`,
  processId:7711,
};
const ready:ManagedLocalNativeStatus={installed:true,state:"Ready",version:"b12248",
  epoch:route.epoch,processId:route.processId,deploymentId:identity.deploymentId,
  actualExecution:{backend:"cpu",deviceIds:["clack-this-pc:cpu:0"],gpuLayers:0,
    runtimeVariantId:"b12248/cpu",runtimeEpoch:route.epoch,
    source:"native-verified-managed-cpu-launch",observedAt:1800000000000}};
beforeEach(()=>vi.mocked(invoke).mockReset());

describe("Slice 5 runtime adapter contract uses one existing native owner",()=>{
  it("advertises CPU/CUDA implemented only; ROCm/Intel/Metal/Vulkan/DirectML are never launchable",()=>{
    expect(ManagedLlamaExecutionAdapter.runtimeId).toBe("clack-managed-llama.cpp");
    expect(ManagedLlamaExecutionAdapter.runtimeVersion).toBe("b12248");
    const all=ManagedLlamaExecutionAdapter.describeBackends();
    expect(all.map(row=>row.backend)).toEqual([
      "cpu","cuda","rocm","intel","metal","vulkan","directml"]);
    expect(all.filter(row=>row.executable).map(row=>row.backend)).toEqual(["cpu","cuda"]);
    expect(all.filter(row=>!row.executable).every(row=>row.state==="UNSUPPORTED")).toBe(true);
    const devices=ManagedLlamaExecutionAdapter.describeDeviceSupport();
    expect(devices.filter(row=>row.singleDeviceExecutable).map(row=>row.backend))
      .toEqual(["cpu","cuda"]);
    expect(devices.every(row=>row.physicalMultiDeviceExecutable===false)).toBe(true);
  });
  it("provisions only explicit approved CPU or CUDA archives through existing IPC",async()=>{
    vi.mocked(invoke).mockResolvedValue(undefined);
    await ManagedLlamaExecutionAdapter.provision({
      kind:"cpu",officialArchivePath:"C:/approved/b12248-cpu.zip"});
    await ManagedLlamaExecutionAdapter.provision({
      kind:"cuda",officialEngineArchivePath:"C:/approved/cuda-engine.zip",
      officialDependenciesArchivePath:"C:/approved/cuda-dlls.zip"});
    expect(invoke).toHaveBeenNthCalledWith(1,"managed_local_runtime_install_bundle",
      {path:"C:/approved/b12248-cpu.zip"});
    expect(invoke).toHaveBeenNthCalledWith(2,"managed_local_runtime_install_cuda_bundles",{
      engineZipPath:"C:/approved/cuda-engine.zip",cudaDllZipPath:"C:/approved/cuda-dlls.zip"});
  });
  it("delegates verification, exact start/status/stop and ordered restart to same native commands",async()=>{
    vi.mocked(invoke).mockImplementation(async(command)=>{
      if(command==="managed_local_runtime_cuda_variant_status")
        return {installed:true,backend:"cuda",runtimeVariantId:"b12248/cuda",version:"b12248"};
      return ready;
    });
    expect((await ManagedLlamaExecutionAdapter.verify()).runtime).toEqual(ready);
    expect((await ManagedLlamaExecutionAdapter.provenance()).runtime).toEqual(ready);
    expect(await ManagedLlamaExecutionAdapter.health(identity)).toEqual(ready);
    await ManagedLlamaExecutionAdapter.status(identity);
    await ManagedLlamaExecutionAdapter.start(identity);
    await ManagedLlamaExecutionAdapter.stop(identity);
    await ManagedLlamaExecutionAdapter.restart(identity);
    const calls=vi.mocked(invoke).mock.calls.map(([cmd])=>cmd);
    expect(calls).toEqual([
      "managed_local_runtime_status","managed_local_runtime_cuda_variant_status",
      "managed_local_runtime_status","managed_local_runtime_cuda_variant_status",
      "managed_local_runtime_status",
      "managed_local_runtime_status","managed_local_runtime_start",
      "managed_local_runtime_stop","managed_local_runtime_stop","managed_local_runtime_start",
    ]);
    for(const args of vi.mocked(invoke).mock.calls.slice(4))
      expect(args[1]).toEqual({deploymentId:identity.deploymentId,
        deploymentIdentity:identity.deploymentIdentity});
    expect(ManagedLlamaExecutionAdapter.actualEvidence(ready)).toEqual(ready.actualExecution);
    expect(ManagedLlamaExecutionAdapter.actualEvidence({...ready,state:"Stopped"})).toBeNull();
  });
  it("observes only independently admitted live native route, never caches a URL or bearer",async()=>{
    vi.mocked(invoke).mockResolvedValue(route);
    const observed=await ManagedLlamaExecutionAdapter.readyRoute(identity);
    expect(observed).toEqual(route);
    expect(invoke).toHaveBeenCalledWith("managed_local_runtime_route",{
      deploymentId:identity.deploymentId,deploymentIdentity:identity.deploymentIdentity});
    vi.mocked(invoke).mockResolvedValue({...route,baseUrl:"http://external.invalid/v1"});
    await expect(ManagedLlamaExecutionAdapter.readyRoute(identity)).rejects.toThrow(
      "untrusted route identity");
  });
});
