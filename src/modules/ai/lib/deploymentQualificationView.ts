import {
  reconcileLocalComputeFabric,
  resolveModelDeployment,
  type DeploymentRuntimeObservation,
  type LocalComputeFabric,
} from "@/modules/ai/lib/localComputeFabric";
import { contextRuntime } from "@/modules/ai/lib/contextCalibrationTrust";
import {
  isManagedLocalSelectionId,
  projectManagedQualificationDeclarations,
  resolveManagedLocalSelection,
} from "@/modules/ai/lib/managedLocalModels";
import type { ManagedLocalNativeStatus } from "@/modules/ai/lib/managedLocalRuntime";
import {
  resolveSelfHostedSelection,
  type SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import { observedManagedExecutionIdentity } from "@/modules/ai/lib/managedExecutionEvidence";
import { toolVerificationState } from "@/modules/ai/lib/toolVerification";
import {
  deploymentQualificationPanelStatus,
  assessDeploymentCapability,
  type CapabilityDecision,
  type QualificationPanelStatus,
} from "@/modules/ai/lib/deploymentQualificationPolicy";

export type DeploymentQualificationView = {
  deploymentId: string;
  readiness: string;
  panel: QualificationPanelStatus;
  instruction: CapabilityDecision;
  legacyNativeToolQualification: string | null;
};

/** A native Ready snapshot is a fresh observation, never persistent authority.
 * The saved fabric is only cloned for this read-only evaluation, not modified. */
export function observedManagedFabric(
  state: SelfHostedState, selectionId: string,
  native: ManagedLocalNativeStatus | null, now: number,
): { fabric: LocalComputeFabric; deploymentId: string; observation?: DeploymentRuntimeObservation } | undefined {
  const selected = resolveManagedLocalSelection(state, selectionId);
  if (selected.status === "not-managed" || selected.status === "missing") return;
  const fabric = structuredClone(reconcileLocalComputeFabric(state));
  // Older persisted b12248 registrations have no terminal/adherence verifier
  // declarations. Project only the two `requires-qualification` protocol
  // states in this read-only view, without mutating saved user settings or
  // treating a runtime claim as execution authority.
  fabric.runtimes = fabric.runtimes.map(projectManagedQualificationDeclarations);
  const deploymentId = selected.deployment.id;
  if (!native || !native.installed || native.state !== "Ready" ||
      !native.epoch || native.version !== selected.runtime.version ||
      native.deploymentId !== deploymentId ||
      native.modelDigest !== selected.artifact.digest ||
      !Number.isSafeInteger(native.processId) || (native.processId ?? 0) < 1)
    return { fabric, deploymentId };
  // Slice 5: a persisted v3 request is NOT a native execution observation.
  // The exact CPU/CUDA/device/variant/build/PID/epoch policy receipt must pass
  // the Slice 4 native proof fence before exposing current LM11/LM6 scope.
  // Legacy v1/v2 native scopes remain byte-for-byte compatible.
  const v3 = !!selected.deployment.requestedExecution?.candidates?.length;
  const exactExecution = v3
    ? observedManagedExecutionIdentity(state,selectionId,native,now) : null;
  if (v3 && !exactExecution) return { fabric, deploymentId };
  const runtime = fabric.runtimes.find(row => row.id === selected.runtime.id);
  const host = fabric.hosts.find(row => row.id === selected.host.id);
  if (!runtime || !host || !runtime.enabled || !host.enabled) return { fabric, deploymentId };
  runtime.health = "online";
  runtime.runtimeEpoch = native.epoch;
  runtime.processIdentity = `pid:${native.processId}`;
  host.reachability = "online";
  return {
    fabric, deploymentId,
    observation: {
      runtimeId: runtime.id, version: native.version,
      configurationRevision: runtime.configurationRevision,
      epoch: native.epoch, observedAt: now,
      ...(exactExecution
        ? {executionIdentity: exactExecution.stableExecutionIdentity} : {}),
    },
  };
}

export function deploymentQualificationView(
  state: SelfHostedState,
  selectionId: string,
  managedStatus: ManagedLocalNativeStatus | null = null,
  now = Date.now(),
): DeploymentQualificationView | null {
  if (isManagedLocalSelectionId(selectionId)) {
    const observed = observedManagedFabric(state, selectionId, managedStatus, now);
    if (!observed) return null;
    return {
      deploymentId: observed.deploymentId,
      readiness: observed.observation ? "Native Ready · Chat transport available" :
        "Registered · no matching current native Ready observation",
      panel: deploymentQualificationPanelStatus(observed.fabric, observed.deploymentId, observed.observation, now),
      instruction: assessDeploymentCapability(observed.fabric, observed.deploymentId,
        "instruction-adherence", observed.observation, {}, now),
      legacyNativeToolQualification: null,
    };
  }
  const target = resolveSelfHostedSelection(state, selectionId);
  if (target.status !== "available") return null;
  const resolved = resolveModelDeployment(state, target.profile);
  if (!resolved) return null;
  const fabric = reconcileLocalComputeFabric(state);
  const runtime = contextRuntime(target.endpoint.id);
  const observation: DeploymentRuntimeObservation | undefined = runtime &&
    runtime.configurationRevision === target.endpoint.configurationRevision &&
    runtime.at <= now && now - runtime.at < 30_000
    ? {
        runtimeId: resolved.runtime.id,
        version: runtime.version,
        epoch: runtime.epoch,
        configurationRevision: runtime.configurationRevision,
        observedAt: runtime.at,
      } : undefined;
  const legacy = resolved.runtime.type === "ollama"
    ? toolVerificationState(state, target.profile, now) : null;
  const panel = deploymentQualificationPanelStatus(fabric, resolved.deployment.id, observation, now);
  if (legacy === "Verified")
    panel.nativeTools = {
      state: "Qualified", available: true,
      reason: "Current exact-scoped legacy Ollama native-tool verification; not proof of full Agent reliability.",
      lastResultAt: target.profile.toolVerification?.completedAt ?? null,
    };
  return {
    deploymentId: resolved.deployment.id,
    readiness: observation ? "Current native runtime observation" : "Runtime observation missing or stale",
    panel,
    instruction: assessDeploymentCapability(fabric, resolved.deployment.id,
      "instruction-adherence", observation, {}, now),
    legacyNativeToolQualification: legacy,
  };
}
