import { describe, expect, it } from "vitest";
import { attachManagedExecutionPolicyVariant, attachManagedLocalGguf,
  resolveManagedLocalSelection } from "./managedLocalModels";
import { emptySelfHostedState, type SelfHostedState } from "./selfHostedProfiles";
import { observedManagedFabric } from "./deploymentQualificationView";
import {
  CURRENT_DEPLOYMENT_QUALIFICATION_PROCEDURES,
  deploymentIdentity, deploymentQualificationScope, executionPolicyIdentity,
  requestedExecutionSchema, type LocalComputeFabric, type RequestedExecution,
} from "./localComputeFabric";
import { completeLm6Run, lm6AttemptFromSignals, lm6ExactScope } from "./deploymentMeasurement";
import { lm6NativeExecutionForAttempt } from "./deploymentMeasurementRuntime";
import { observedManagedExecutionIdentity } from "./managedExecutionEvidence";
import type { ManagedLocalNativeStatus } from "./managedLocalRuntime";
import {
  buildDeploymentEvidenceCatalog, comparisonTimingCompatible,
  compareDeploymentEvidence, recommendDeployment, recommendAllDeployments,
  type EvidenceCandidate,
} from "./deploymentEvidenceDecisions";

// Deterministic offline fixtures. No inference, Tauri IPC, network or settings writes.
const NOW = 1_800_000_000_000;
const digest = `sha256:${"a".repeat(64)}`;
const proofHash = `sha256:${"f".repeat(64)}`;
const req = "51deba77-6a5a-450f-b554-682c883ef8f5";
const cpuDevice="clack-this-pc:cpu:0";
const gpuDevice="clack-this-pc:accelerator:GPU-30ab48fd-809d-dc7d-c437-6ad626ece81a";
const secondGpuDevice="clack-this-pc:accelerator:GPU-b36dc7ce-49ae-4d72-ae71-a0fe2c2144aa";
const pinnedCpu = {backend:"cpu" as const,deviceIds:[cpuDevice],gpuLayers:0,
  runtimeVariantId:"b12248/cpu",runtimeBuildDigest:
    "sha256:bb306bfd390f8782c0acaba490505d12f07392791b48f1dd039387a5bacf1181"};
const pinnedCuda = {backend:"cuda" as const,deviceIds:[gpuDevice],gpuLayers:40,
  runtimeVariantId:"b12248/cuda",runtimeBuildDigest:
    "sha256:ae0a1e064a94db82f3352c843ffa96eb190254fefafc29ce0213798c549a2799"};

function managedFixture() {
  const created = attachManagedLocalGguf(emptySelfHostedState(), {
    digest, size: 491_400_032, fileIdentity: `${digest.slice(7)}:491400032`,
    displayName: "Fixture Qwen", quantization: "Q4_K_M",
    material: { version: 1, context: 2048, gpu: 0, tool: false, grammar: false },
  });
  const selected = resolveManagedLocalSelection(created.state, created.selectionId);
  if (selected.status === "missing" || selected.status === "not-managed")
    throw Error("missing fixture");
  const native = {
    installed: true, state: "Ready" as const, epoch: "epoch-native-7", version: "b12248",
    processId: 7001, port: 61001,
    deploymentId: selected.deployment.id, modelDigest: selected.artifact.digest,
  };
  const observed = observedManagedFabric(created.state, created.selectionId, native, NOW);
  if (!observed?.observation) throw Error("no observed fixture");
  return { ...created, selected, native, observed };
}

function currentQualification(f: ReturnType<typeof managedFixture>,
  capability: "chat" | "instruction-adherence" = "chat", status: "verified" | "failed" = "verified") {
  const scope = deploymentQualificationScope(f.observed.fabric, f.selected.deployment.id,
    f.observed.observation, NOW);
  if (!scope) throw Error("no exact scope");
  return {
    version: 2 as const,
    scope: { ...scope, deploymentId: f.selected.deployment.id },
    capability, status, verifiedAt: NOW - 2000, expiresAt: NOW + 60_000,
    procedure: CURRENT_DEPLOYMENT_QUALIFICATION_PROCEDURES[capability],
    context: {},
    evidence: { source: "clack-transport" as const, reference: req,
      digest: proofHash, checks: [{ id: "bounded-chat", result: status === "verified" ? "pass" : "fail" }] },
  };
}

function measuredRun(f: ReturnType<typeof managedFixture>, ms = 21) {
  const scope = lm6ExactScope(f.observed.fabric, f.selected.deployment.id,
    f.observed.observation, NOW);
  if (!scope) throw Error("no scope");
  const start = NOW - 5000;
  const attempt = lm6AttemptFromSignals({
    attemptId: "attempt-1", workload: "chat", thermal: "warm",
    thermalSource: "native-same-resident-process-before-request",
    startedAt: start, endedAt: NOW - 3000,
    result: "passed", failure: "none", requestId: req,
    nativeRequestId: "inference-1", nativeRequestOpenEvents: 1,
    distinctNativeRequestCount: 1, outputObserved: true, terminalObserved: true,
    signals: { requestStart: start + 100, firstFrame: start + 105,
      firstMeaningful: start + 100 + ms, terminal: start + 450,
      promptTokens: 1170, generatedTokens: 16, duplicateRequestObserved: false },
  });
  return completeLm6Run({
    runId: "00000000-0000-4000-8000-000000000001", scope,
    configuredContextTokens: 2048, backend: "CPU", startedAt: start - 100,
    endedAt: NOW - 2500, requestedAttempts: 1, attempts: [attempt],
  });
}

function catalog(withChat = true, withRun = true) {
  const f = managedFixture();
  const state: SelfHostedState = {
    ...f.state, fabric: {
      ...f.state.fabric!,
      qualificationReceipts: withChat ? [currentQualification(f)] : [],
      measurementRuns: withRun ? [measuredRun(f)] : [],
    } as LocalComputeFabric,
  };
  const options = { now: NOW, managedStatus: f.native, managedObservedAt: NOW - 100 };
  const cards = buildDeploymentEvidenceCatalog(state, options);
  if (cards.length !== 1) throw Error("fixture catalog not unique");
  return { f, state, options, card: cards[0] };
}

function v3Catalog(
  candidates: NonNullable<RequestedExecution["candidates"]> = [pinnedCuda],
  selectedCandidateIndex = 0, actualGpuLayers = 25,
  deviceStrategy?: RequestedExecution["deviceStrategy"],
) {
  const legacy=managedFixture();
  const requested=requestedExecutionSchema.parse({
    backend:candidates[0].backend,deviceIds:candidates[0].deviceIds,
    gpuLayers:candidates[0].gpuLayers,contextLength:2048,candidates,
    fallback:candidates.length===1 ? {policy:"disabled"} :
      {policy:"explicit-order",order:candidates.slice(1).map(row=>row.backend)},
    ...(deviceStrategy ? {deviceStrategy} : {}),
  });
  const attached=attachManagedExecutionPolicyVariant(legacy.state,legacy.selectionId,requested);
  const selected=resolveManagedLocalSelection(attached.state,attached.selectionId);
  if(selected.status==="missing"||selected.status==="not-managed")throw Error("missing v3 fixture");
  const candidate=candidates[selectedCandidateIndex];
  const backend=candidate.backend as "cpu"|"cuda";
  const fallbackUsed=selectedCandidateIndex>0;
  const actual = {
    backend, deviceIds:[...candidate.deviceIds],gpuLayers:actualGpuLayers,
    runtimeVariantId:`b12248/${backend}`,runtimeEpoch:legacy.native.epoch,
    contextLength:2048,observedAt:NOW-100,
    source:backend==="cpu" ? "native-verified-managed-cpu-launch" :
      "native-verified-cuda-init-and-layer-offload",
    executionReceipt:{version:3 as const,deploymentId:selected.deployment.id,
      deploymentIdentity:deploymentIdentity(selected.deployment),
      policyIdentity:executionPolicyIdentity(requested),selectedCandidateIndex,
      processId:legacy.native.processId,fallbackUsed,fallbackAuthorized:fallbackUsed,
      runtimeBuildDigest:candidate.runtimeBuildDigest},
  };
  const native:ManagedLocalNativeStatus = {...legacy.native,selectedBackend:backend,
    deploymentId:selected.deployment.id,requestedGpuLayers:requested.gpuLayers,
    selectedCandidateIndex,selectedGpuLayers:candidate.gpuLayers,
    fallbackUsed,fallbackAuthorized:fallbackUsed,actualExecution:actual};
  const state:SelfHostedState={...attached.state,fabric:{...attached.state.fabric!,
    // An existing legacy Chat pass and LM6 run must never qualify the v3 variant.
    qualificationReceipts:[currentQualification(legacy)],
    measurementRuns:[measuredRun(legacy)],
  }};
  const options={now:NOW,managedStatus:native,managedObservedAt:NOW-100,
    localMetadata:{digest,size:491_400_032,format:"gguf" as const,
      fileIdentity:`${digest.slice(7)}:491400032`,blockCount:25}};
  const list=()=>buildDeploymentEvidenceCatalog(state,options);
  const card=()=>{
    const found=list().find(row=>row.deploymentId===selected.deployment.id);
    if(!found)throw Error("missing v3 evidence candidate");
    return found;
  };
  return {legacy,selected,selectionId:attached.selectionId,requested,actual,native,state,options,list,card};
}

describe("Slice 5 v3 authenticated execution evidence integration",()=>{
  it("preserves exact v3 identity and measured CUDA 25/25 versus requested 40; old CPU PASS is not transferred",()=>{
    const f=v3Catalog();
    const result=f.card();
    expect(result).toMatchObject({
      deploymentIdentity:deploymentIdentity(f.selected.deployment),
      contextTokens:2048,backend:"GPU",ready:true,readiness:"Ready",
      observedBackend:"cuda",observedRuntimeVariantId:"b12248/cuda",
      backendEvidence:{value:"GPU",provenance:"Measured"},
      requestedGpuLayers:{value:40,provenance:"Derived"},
      gpuLayers:{value:25,provenance:"Measured"},
    });
    expect(result.workloadAssessments.Chat).toBeDefined();
    expect(result.qualification.chat.available).toBe(false);
    expect(result.qualification.agent.eligible).toBe(false);
    expect(result.currentRun).toBeNull();
    expect(result.historyRunCount).toBe(0);
    expect(recommendDeployment([result],"Chat").deploymentId).toBeNull();
    expect(f.list().find(row=>row.deploymentId===f.legacy.selected.deployment.id)?.ready)
      .toBe(false);
  });

  it("reports canonical pinned CPU v3 from native receipt rather than a guessed CPU request",()=>{
    const f=v3Catalog([pinnedCpu],0,0);
    expect(f.card()).toMatchObject({
      backend:"CPU",observedBackend:"cpu",ready:true,
      requestedGpuLayers:{value:0},gpuLayers:{value:0,provenance:"Measured"},
    });
    expect(buildDeploymentEvidenceCatalog(f.state,{...f.options,managedStatus:{
      ...f.native,actualExecution:null,
    }}).find(row=>row.deploymentId===f.selected.deployment.id)).toMatchObject({
      ready:false,backend:"Unknown",observedBackend:null,
      backendEvidence:{value:null,provenance:"Unknown"},
      requestedGpuLayers:{value:0},gpuLayers:{value:null},
    });
  });

  it("distinguishes a CUDA-to-CPU fallback actual (0 layers) from requested CUDA (40)",()=>{
    const f=v3Catalog([pinnedCuda,pinnedCpu],1,0);
    expect(f.card()).toMatchObject({
      backend:"CPU",ready:true,observedBackend:"cpu",
      requestedGpuLayers:{value:40},gpuLayers:{value:0,provenance:"Measured"},
    });
    const falseFallback={...f.native,fallbackUsed:false};
    expect(buildDeploymentEvidenceCatalog(f.state,{...f.options,managedStatus:falseFallback})
      .find(row=>row.deploymentId===f.selected.deployment.id)).toMatchObject({
        ready:false,backend:"Unknown",gpuLayers:{value:null},
      });
  });

  it("cannot transfer a current CUDA Chat qualification to CPU fallback of the same v3 policy",()=>{
    const f=v3Catalog([pinnedCuda,pinnedCpu]);
    const observed=observedManagedFabric(f.state,f.selectionId,f.native,NOW);
    const scope=deploymentQualificationScope(observed!.fabric,f.selected.deployment.id,
      observed!.observation,NOW);
    if(!scope?.executionIdentity)throw Error("v3 qualification needs actual execution identity");
    const verified={version:2 as const,scope:{...scope,deploymentId:f.selected.deployment.id},
      capability:"chat" as const,status:"verified" as const,
      verifiedAt:NOW-2000,expiresAt:NOW+60_000,
      procedure:CURRENT_DEPLOYMENT_QUALIFICATION_PROCEDURES.chat,context:{},
      evidence:{source:"clack-transport" as const,reference:req,digest:proofHash,
        checks:[{id:"bounded-chat",result:"pass" as const}]}};
    const state:SelfHostedState={...f.state,fabric:{...f.state.fabric!,
      qualificationReceipts:[...f.state.fabric!.qualificationReceipts!,verified]}};
    const current=buildDeploymentEvidenceCatalog(state,f.options)
      .find(row=>row.deploymentId===f.selected.deployment.id);
    expect(current?.qualification.chat.available).toBe(true);
    const fallback:ManagedLocalNativeStatus={...f.native,selectedBackend:"cpu",
      selectedCandidateIndex:1,selectedGpuLayers:0,
      fallbackUsed:true,fallbackAuthorized:true,
      actualExecution:{...f.actual,backend:"cpu",deviceIds:[cpuDevice],gpuLayers:0,
        runtimeVariantId:"b12248/cpu",source:"native-verified-managed-cpu-launch",
        executionReceipt:{...f.actual.executionReceipt,selectedCandidateIndex:1,
          fallbackUsed:true,fallbackAuthorized:true,
          runtimeBuildDigest:pinnedCpu.runtimeBuildDigest}}};
    const cpu=buildDeploymentEvidenceCatalog(state,{...f.options,managedStatus:fallback})
      .find(row=>row.deploymentId===f.selected.deployment.id);
    expect(cpu).toMatchObject({ready:true,backend:"CPU",observedBackend:"cpu",
      qualification:{chat:{available:false}},
      gpuLayers:{value:0,provenance:"Measured"}});
  });

  it("ignores spoofed and stale Ready despite persisted CUDA selection or GPU hardware",()=>{
    const f=v3Catalog();
    for (const native of [
      {...f.native,epoch:"restarted",processId:7002},
      {...f.native,actualExecution:{...f.actual,gpuLayers:0}},
      {...f.native,actualExecution:{...f.actual,gpuLayers:41}},
      {...f.native,actualExecution:{...f.actual,executionReceipt:{
        ...f.actual.executionReceipt,policyIdentity:"wrong policy"}}},
    ]) {
      const result=buildDeploymentEvidenceCatalog(f.state,{...f.options,managedStatus:native})
        .find(row=>row.deploymentId===f.selected.deployment.id);
      expect(result).toMatchObject({ready:false,readiness:"Unverified",
        backend:"Unknown",observedBackend:null,gpuLayers:{value:null},
        requestedGpuLayers:{value:40},
        qualification:{chat:{available:false}}});
      expect(result?.currentRun).toBeNull();
    }
    const stale=buildDeploymentEvidenceCatalog(f.state,{...f.options,managedObservedAt:NOW-30_001})
      .find(row=>row.deploymentId===f.selected.deployment.id);
    expect(stale).toMatchObject({ready:false,backend:"Unknown"});
  });

  it("does not represent an unsupported multi-GPU plan as observed execution",()=>{
    const f=v3Catalog([{...pinnedCuda,deviceIds:[gpuDevice,secondGpuDevice]}],0,25,
      {kind:"multi",primaryDeviceId:gpuDevice,splitStrategy:"layers"});
    expect(f.card()).toMatchObject({ready:false,backend:"Unknown",
      observedBackend:null,gpuLayers:{value:null},requestedGpuLayers:{value:40}});
    expect(f.card().qualification.chat.available).toBe(false);
  });

  it("joins current LM6 measured GPU samples only in exact v3 deployment, context, backend and epoch",()=>{
    const f=v3Catalog();
    const observed=observedManagedFabric(f.state,f.selectionId,f.native,NOW);
    if (!observed?.observation) throw Error("missing native observation");
    const execution=observedManagedExecutionIdentity(f.state,f.selectionId,f.native,NOW);
    const nativeExecution=lm6NativeExecutionForAttempt(execution,"completed");
    if (!nativeExecution) throw Error("missing independently verified native LM6 execution");
    const scope=lm6ExactScope(observed.fabric,f.selected.deployment.id,observed.observation,NOW);
    if (!scope) throw Error("missing LM6 scoped identity");
    const start=NOW-5000;
    const attempt=lm6AttemptFromSignals({attemptId:"attempt-1",workload:"chat",
      thermal:"warm",thermalSource:"native-same-resident-process-before-request",
      startedAt:start,endedAt:NOW-3000,result:"passed",failure:"none",requestId:req,
      nativeRequestId:"inference-2",nativeRequestOpenEvents:1,distinctNativeRequestCount:1,
      outputObserved:true,terminalObserved:true,
      nativeExecution,
      signals:{requestStart:start+100,firstFrame:start+105,firstMeaningful:start+122,
        terminal:start+450,promptTokens:1170,generatedTokens:16,duplicateRequestObserved:false},
    });
    const run=completeLm6Run({runId:"00000000-0000-4000-8000-000000000002",scope,
      configuredContextTokens:2048,backend:"GPU",startedAt:start-100,
      endedAt:NOW-2500,requestedAttempts:1,attempts:[attempt]});
    const saved={...f.state,fabric:{...f.state.fabric!,
      measurementRuns:[...f.state.fabric!.measurementRuns!,run]}};
    const result=buildDeploymentEvidenceCatalog(saved,f.options)
      .find(row=>row.deploymentId===f.selected.deployment.id);
    expect(result).toMatchObject({backend:"GPU",ready:true,
      currentRun:{runId:run.runId},warmFirstOutput:{value:22,provenance:"Measured"},
      measuredChatSamples:1,qualification:{chat:{available:false}}});
    expect(recommendDeployment([result!],"Low latency").deploymentId).toBeNull();
    const invalid=buildDeploymentEvidenceCatalog(saved,{...f.options,
      managedStatus:{...f.native,epoch:"new epoch"}})
      .find(row=>row.deploymentId===f.selected.deployment.id);
    expect(invalid).toMatchObject({backend:"Unknown",currentRun:null});
    expect(invalid?.historyRunCount).toBe(1);
  });
});

const isWinner = (candidate: EvidenceCandidate, category: Parameters<typeof recommendDeployment>[1]) =>
  recommendDeployment([candidate], category).deploymentId === candidate.deploymentId;

describe("LM8–LM10 exact-deployment comparison and deterministic recommendations", () => {
  it("01 a single native-backed managed deployment is indexed by exact deployment ID, not its display name", () => {
    const { f, card } = catalog();
    expect(card.deploymentId).toBe(f.selected.deployment.id);
    expect(card.displayName).toBe("Fixture Qwen");
    expect(card.artifactDigest).toBe(digest);
    expect(card.quantization).toBe("Q4_K_M");
    expect(card.runtimeVersion).toBe("b12248");
    expect(card.contextTokens).toBe(2048);
    expect(card.backend).toBe("CPU");
  });

  it("02 status needs a fresh independently supplied native Ready and exact epoch", () => {
    const { state, options, card } = catalog();
    expect(card.ready).toBe(true);
    expect(card.qualification.chat.available).toBe(true);
    expect(buildDeploymentEvidenceCatalog(state, { ...options, managedObservedAt: NOW - 30_001 })[0].ready)
      .toBe(false);
    expect(buildDeploymentEvidenceCatalog(state, { ...options, managedStatus: null })[0].ready)
      .toBe(false);
  });

  it("03 a stale runtime epoch revokes LM2F and LM6 current evidence without erasing the old run", () => {
    const { state, options } = catalog();
    const changed = buildDeploymentEvidenceCatalog(state, {
      ...options, managedStatus: { ...options.managedStatus, epoch: "other-epoch", processId: 8001 },
    })[0];
    expect(changed.ready).toBe(true);
    expect(changed.qualification.chat.available).toBe(false);
    expect(changed.currentRun).toBeNull();
    expect(changed.historyRunCount).toBe(1);
    expect(changed.warmFirstOutput.provenance).toBe("Unknown");
  });

  it("04 Chat winner must have exact current LM2F qualification", () => {
    const { card } = catalog();
    expect(isWinner(card, "Chat")).toBe(true);
    expect(recommendDeployment([card], "Chat").reasons.join(" ")).toContain("Current LM2F");
  });

  it("05 Chat with only LM6 measured output but no LM2F authority cannot win", () => {
    const { card } = catalog(false, true);
    expect(card.measuredChatSamples).toBe(1);
    expect(card.qualification.chat.available).toBe(false);
    expect(recommendDeployment([card], "Chat").deploymentId).toBeNull();
  });

  it("06 unavailable runtime cannot win despite retained successful receipts", () => {
    const { card } = catalog();
    expect(isWinner({ ...card, ready: false }, "Chat")).toBe(false);
  });

  it("07 no Agent winner when required native tool/effect proofs are missing", () => {
    const { card } = catalog();
    const output = recommendDeployment([card], "Automatic Agent");
    expect(output.deploymentId).toBeNull();
    expect(output.reasons[0]).toContain("No currently qualified");
    expect(card.qualification.agent.eligible).toBe(false);
  });

  it("08 unsupported native tools remain unsupported even for fast Chat", () => {
    const { card } = catalog();
    expect(card.qualification.nativeTools.state).toBe("Unsupported");
    expect(isWinner(card, "Native Tools")).toBe(false);
  });

  it("09 instruction-adherence failure prevents Coding from winning", () => {
    const { card } = catalog();
    expect(card.qualification.instruction.available).toBe(false);
    expect(isWinner(card, "Coding")).toBe(false);
  });

  it("10 structured output without current protocol proof cannot win", () => {
    const { card } = catalog();
    expect(isWinner(card, "Structured Output")).toBe(false);
  });

  it("11 Low latency requires measured current warm output, not an estimate", () => {
    const { card } = catalog();
    expect(isWinner(card, "Low latency")).toBe(true);
    const estimated = { ...card, warmFirstOutput: {
      ...card.warmFirstOutput, provenance: "Estimated" as const,
    } };
    expect(isWinner(estimated, "Low latency")).toBe(false);
  });

  it("12 zero current runs leaves throughput and timing Unknown", () => {
    const { card } = catalog(true, false);
    expect(card.currentRun).toBeNull();
    expect(card.warmFirstOutput.value).toBeNull();
    expect(card.generationThroughput.provenance).toBe("Unknown");
    expect(card.historyRunCount).toBe(0);
  });

  it("13 provider count without generation duration must not create made-up throughput", () => {
    const { card } = catalog();
    expect(card.currentRun?.attempts[0].usage.generatedTokens.value).toBe(16);
    expect(card.generationThroughput.value).toBeNull();
  });

  it("14 same scope and procedure allow measured timing comparison", () => {
    const { card } = catalog();
    const other = { ...card, deploymentId: "other-deployment", displayName: "Other",
      warmFirstOutput: { ...card.warmFirstOutput, value: 40 } };
    expect(comparisonTimingCompatible(card, other)).toBe(true);
    expect(compareDeploymentEvidence(card, other).comparableTiming).toBe(true);
  });

  it("15 different hosts are visible but cannot be declared like-for-like", () => {
    const { card } = catalog();
    const remote = { ...card, hostId: "remote-host", hostLocation: "remote" as const };
    const compared = compareDeploymentEvidence(card, remote);
    expect(compared.comparableTiming).toBe(false);
    expect(compared.warnings.join(" ")).toContain("Different hosts");
  });

  it("16 materially different contexts forbid timing equivalence", () => {
    const { card } = catalog();
    const compared = compareDeploymentEvidence(card, { ...card, contextTokens: 32_768 });
    expect(compared.comparableTiming).toBe(false);
    expect(compared.warnings.join(" ")).toContain("Configured context differs");
  });

  it("17 different backend and runtime revisions are explicitly flagged", () => {
    const { card } = catalog();
    const compared = compareDeploymentEvidence(card, {
      ...card, runtimeVersion: "b99999", backend: "GPU" as const,
    });
    expect(compared.warnings.some(x => x.includes("runtime"))).toBe(true);
    expect(compared.warnings.some(x => x.includes("backends"))).toBe(true);
  });

  it("18 a different measurement procedure revision is noncomparable", () => {
    const { card } = catalog();
    const run = { ...card.currentRun!, procedure: {
      ...card.currentRun!.procedure, version: 10 as 1,
    } };
    const compared = compareDeploymentEvidence(card, { ...card, currentRun: run });
    expect(compared.comparableTiming).toBe(false);
    expect(compared.warnings.join(" ")).toContain("procedure revision");
  });

  it("19 a stale measured field cannot outrank an otherwise current measurement", () => {
    const { card } = catalog();
    const stale = { ...card, deploymentId: "aaa-old",
      currentRun: null, warmFirstOutput: { ...card.warmFirstOutput, value: 2 } };
    const output = recommendDeployment([stale, card], "Low latency");
    expect(output.deploymentId).toBe(card.deploymentId);
  });

  it("20 incomparable current low latency deployments produce no false winner", () => {
    const { card } = catalog();
    const other = { ...card, deploymentId: "different-host", hostId: "elsewhere" };
    const output = recommendDeployment([card, other], "Low latency");
    expect(output.deploymentId).toBeNull();
    expect(output.alternatives).toHaveLength(2);
  });

  it("21 recommendations are independent of input order", () => {
    const { card } = catalog();
    const a = { ...card, deploymentId: "aaa" }, b = { ...card, deploymentId: "zzz" };
    expect(recommendDeployment([a, b], "Chat").deploymentId)
      .toBe(recommendDeployment([b, a], "Chat").deploymentId);
  });

  it("22 exact score ties use lexical deployment identity, never model reputation", () => {
    const { card } = catalog();
    const a = { ...card, deploymentId: "aaa", displayName: "Tiny" };
    const z = { ...card, deploymentId: "zzz", displayName: "Famous Large Model" };
    expect(recommendDeployment([z, a], "Chat").deploymentId).toBe("aaa");
  });

  it("23 changed capability evidence changes the winner immediately", () => {
    const { card } = catalog();
    expect(isWinner(card, "Chat")).toBe(true);
    expect(isWinner({ ...card, qualification: {
      ...card.qualification, chat: {
        state: "Qualification Failed", available: false,
        reason: "New failed receipt", lastResultAt: NOW, lastResult: "failed",
      },
    } }, "Chat")).toBe(false);
  });

  it("24 this-PC preference applies only to the explicitly local category", () => {
    const { card } = catalog();
    const remote = { ...card, deploymentId: "remote", hostLocation: "remote" as const };
    expect(isWinner(remote, "Chat")).toBe(true);
    expect(isWinner(remote, "This PC")).toBe(false);
    expect(isWinner(card, "This PC")).toBe(true);
  });

  it("25 a configured 2048 context cannot win a long-context category", () => {
    const { card } = catalog();
    expect(isWinner(card, "Long context")).toBe(false);
  });

  it("26 a declared 32768 context without current instruction proof cannot win long-context coding", () => {
    const { card } = catalog();
    expect(isWinner({ ...card, contextTokens: 32_768 }, "Long context")).toBe(false);
  });

  it("27 normal Chat reliability counts only normal Chat attempts, not expected cancellation", () => {
    const { card } = catalog();
    expect(card.normalChatReliability).toBe(1);
    expect(card.measuredChatSamples).toBe(1);
  });

  it("28 comparison always displays explicit metric provenance and Unknown", () => {
    const { card } = catalog();
    const other = { ...card, generationThroughput: {
      ...card.generationThroughput, provenance: "Estimated" as const, value: 15,
    } };
    const compared = compareDeploymentEvidence(card, other);
    const line = compared.fields.find(x => x.label === "Generation throughput")!;
    expect(line.left).toBe("Unknown");
    expect(line.right).toBe("15.00 tokens/s");
    expect(line.provenance).toEqual({ left: "Unknown", right: "Estimated" });
  });

  it("29 the algorithm has fixed categories and explanatory limiting factors", () => {
    const { card } = catalog();
    const output = recommendAllDeployments([card]);
    expect(output).toHaveLength(9);
    expect(output.find(x => x.category === "Chat")?.limitingFactors)
      .toContain("Automatic Agent unavailable");
    expect(output.find(x => x.category === "Automatic Agent")?.deploymentId).toBeNull();
  });

  it("30 empty or untrusted deployment catalogs return explicit no-candidate answers", () => {
    expect(buildDeploymentEvidenceCatalog(emptySelfHostedState())).toEqual([]);
    expect(recommendAllDeployments([]).every(x =>
      x.deploymentId === null && x.reasons[0].includes("No currently qualified"))).toBe(true);
  });
});
