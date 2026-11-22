import type { SelfHostedState } from "./selfHostedProfiles";
import type { ManagedLocalNativeStatus } from "./managedLocalRuntime";
import { resolveManagedLocalSelection } from "./managedLocalModels";
import { observedManagedFabric } from "./deploymentQualificationView";
import { assessDeploymentAgentEligibility, assessDeploymentCapability } from "./deploymentQualificationPolicy";
import { observedManagedExecutionIdentity, type ManagedExecutionIdentity } from "./managedExecutionEvidence";
import { deploymentRequestedExecution, runtimeBackendVariants } from "./executionBackendSelection";
import type { RequestedExecution } from "./localComputeFabric";
import type { HardwareProfile } from "./hardwareProfile";
import { projectModelResourceProfile } from "./modelResourceProfile";
import { assessDeploymentSuitability, type Workload } from "./deploymentSuitability";
import type { ManagedCudaVariantStatus } from "./managedLocalRuntime";

/** One read-only compute-facing contract for Agent/model routing. It does not
 * activate Agent permission or choose a new scheduler. A hardware-discovered
 * CUDA adapter can never promote an unqualified deployment to Agent-ready. */
export type ComputeRouteEvidence = {
  deploymentId: string | null;
  deploymentAvailable: boolean;
  requestedBackendOrder: string[];
  /** Full immutable persisted execution policy, even when native is stopped. */
  requestedPolicy: RequestedExecution | null;
  backend: {
    requested: string | null;
    installed: boolean;
    verifiedBuild: boolean;
    backendAvailable: boolean;
    reason: string;
  };
  runtime: { ready: boolean; version: string | null; epoch: string | null };
  placement: {
    state: "native-verified" | "unverified" | "unknown";
    execution: ManagedExecutionIdentity | null;
  };
  qualification: {
    chatQualified: boolean;
    agentQualified: boolean;
    agentReason: string;
  };
  memory: { fit: "Fits" | "Tight" | "Insufficient" | "Unknown"; reason: string };
  /** Explanatory only. Native launch/status/route remains mandatory. */
  routeFor: "chat-only" | "agent-qualified" | "unavailable";
};

export function assessManagedComputeRoute(input: {
  state: SelfHostedState;
  selectionId: string;
  native?: ManagedLocalNativeStatus | null;
  cudaVariant?: ManagedCudaVariantStatus | null;
  hardware?: HardwareProfile | null;
  workload?: Workload;
  now?: number;
}): ComputeRouteEvidence {
  const {state,selectionId}=input;
  const now=input.now??Date.now();
  const selected=resolveManagedLocalSelection(state,selectionId);
  const missing=():ComputeRouteEvidence=>({
    deploymentId:null,deploymentAvailable:false,requestedBackendOrder:[],requestedPolicy:null,
    backend:{requested:null,installed:false,verifiedBuild:false,backendAvailable:false,
      reason:"No exact current managed deployment"},
    runtime:{ready:false,version:null,epoch:null},
    placement:{state:"unknown",execution:null},
    qualification:{chatQualified:false,agentQualified:false,
      agentReason:"Deployment missing; no Agent capability"},
    memory:{fit:"Unknown",reason:"No exact deployment resource identity"},
    routeFor:"unavailable",
  });
  if(selected.status!=="available" && selected.status!=="unavailable")return missing();
  // An explicitly disabled/offline Fabric owner remains historically resolvable,
  // but cannot be made routable by an old Ready snapshot or installed GPU.
  const deploymentAvailable=selected.status==="available";
  const requested=deploymentRequestedExecution(selected.deployment,selected.runtime);
  const exact = observedManagedExecutionIdentity(state,selectionId,input.native??null,now);
  const observation=observedManagedFabric(state,selectionId,input.native??null,now);
  const variants=runtimeBackendVariants(selected.runtime,input.native,input.cudaVariant);
  const requestedBackend=requested?.backend ?? null;
  const build=variants.find(row=>row.backend===requestedBackend);
  const installed=build?.installation==="AVAILABLE";
  const verifiedBuild=build?.trust==="VERIFIED" && build.support==="AVAILABLE";
  const actualVariant=exact?.actual.runtimeVariantId;
  const variant = actualVariant ? variants.find(row=>row.id===actualVariant) : build;
  // Only a verified native actual authorizes a v3 backend. Unknown/multiple
  // devices remain representable but NEVER executable based on hardware alone.
  const verifiedBackend = !!exact && !!variant &&
    variant.support==="AVAILABLE" && variant.trust==="VERIFIED" &&
    (variant.installation==="AVAILABLE" ||
      // The native Ready owner is stronger than a missing asynchronous UI
      // discovery probe; do not make a missing renderer probe an Agent grant.
      (!input.cudaVariant && exact.actual.backend==="cuda"));
  const eligibility=observation
    ? assessDeploymentAgentEligibility(observation.fabric,observation.deploymentId,
      observation.observation,{},now)
    : null;
  const chat=observation
    ? assessDeploymentCapability(observation.fabric,observation.deploymentId,
      "chat",observation.observation,{},now)
    : null;
  let fit: ComputeRouteEvidence["memory"]["fit"]="Unknown";
  let fitReason="No current independently measured workload demand";
  if(input.hardware && observation && exact && observation.observation) {
    const resource=projectModelResourceProfile(selected.artifact,selected.runtime,selected.deployment);
    const context=requested?.contextLength??resource.configuredContext.value;
    if(context){
      try{
        const assessment=assessDeploymentSuitability({
          fabric:observation.fabric,hardware:input.hardware,resource,
          deploymentId:selected.deployment.id,workload:input.workload??"Chat",
          context,observation:observation.observation,
          observedLoaded:true,now,
        });
        fit=assessment.capacity.fit;
        fitReason=assessment.capacity.reasons.join("; ") ||
          "Estimated resource suitability; native memory admission remains authoritative";
      }catch { /* Unknown and conservative if any input is mismatched. */ }
    }
  }
  const agentQualified=deploymentAvailable && !!chat?.available &&
    !!eligibility?.eligible && verifiedBackend;
  return {
    deploymentId:selected.deployment.id,deploymentAvailable,requestedPolicy:requested,
    requestedBackendOrder:requested?.candidates?.map(c=>c.backend) ??
      (requested ? [requested.backend,...(requested.fallback.order??[])] : []),
    backend:{
      requested:requestedBackend,installed,verifiedBuild,
      backendAvailable:deploymentAvailable && verifiedBackend,
      reason:!deploymentAvailable?"Deployment host or runtime is disabled or offline" :
        verifiedBackend?"Pinned, verified native execution owner" :
        !installed?"Requested backend not installed or evidence unavailable" :
          !verifiedBuild?"Runtime build is not verified" :
            "No current authenticated native execution for the deployment",
    },
    runtime:{
      ready:deploymentAvailable && !!exact,version:input.native?.version??null,
      epoch:deploymentAvailable?exact?.runtime.epoch??null:null,
    },
    placement:{state:exact && deploymentAvailable?"native-verified":"unverified",
      execution:deploymentAvailable?exact:null},
    qualification:{
      chatQualified:!!chat?.available,agentQualified,
      agentReason:!deploymentAvailable?"Deployment disabled or offline" :
        !verifiedBackend?"No currently verified executable backend" :
        !chat?.available?"Chat capability is not qualified for this execution" :
        eligibility?.reason??"No current LM2F qualification scope",
    },
    memory:{fit,reason:fitReason},
    routeFor:!deploymentAvailable || !exact || !verifiedBackend?"unavailable" :
      agentQualified?"agent-qualified":"chat-only",
  };
}
