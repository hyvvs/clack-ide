import {
  deploymentIdentity, deploymentQualificationScope, reconcileLocalComputeFabric,
  type DeploymentQualificationScope, type RuntimeCapabilityName,
} from "./localComputeFabric";
import type { EvidenceCandidate } from "./deploymentEvidenceDecisions";
import { MANAGED_QUALIFICATION_MAX_OUTPUT } from "./deploymentQualificationFlight";
import { LM6_MAX_ATTEMPTS } from "./deploymentMeasurement";
import { observedManagedFabric } from "./deploymentQualificationView";
import {
  MANAGED_LOCAL_HOST_ID, MANAGED_LOCAL_RUNTIME_TYPE, managedLocalSelectionId,
  projectManagedQualificationDeclarations, resolveManagedLocalSelection,
} from "./managedLocalModels";
import type { ManagedLocalNativeStatus } from "./managedLocalRuntime";
import type { SelfHostedState } from "./selfHostedProfiles";

/** LM11–LM15 describe explicit bounded procedures. No runner, grant, or
 * qualification authority is created by selecting or previewing a plan. */
export type QualificationLabProcedureId =
  | "chat-and-adherence" | "cold-warm-cancellation" | "structured-json-schema"
  | "native-tool-correlation" | "context-configuration"
  | "coding-task" | "long-context-retrieval" | "reliability"
  | "agent-readiness" | "standalone-cancellation";
export type QualificationLabRunner =
  "managed-chat-qualification" | "bounded-deployment-measurement" | null;
export type QualificationLabStep = {
  id: string;
  title: string;
  workload: "chat" | "instruction-adherence" | "cancellation" |
    "structured-output" | "native-tools" | "context-configuration" |
    "coding" | "long-context-retrieval" | "reliability" | "agent-readiness";
  expectedEvidence: readonly string[];
  maxDispatches: 0 | 1;
  cancelAfterOutput: boolean;
};
export type QualificationLabBounds = {
  maxAttempts: number;
  /** End-to-end runner ceiling in milliseconds. This is enforcement evidence
   * only for procedures with an independently accepted original runner. */
  maxWallTimeMs: number;
  maxOutputTokensPerAttempt: number;
  maxOutputTokensTotal: number;
  maxRetries: 0;
  maxAutomaticContinuations: 0;
  cancelPolicy: "cancel-at-bound" | "bounded-cancellation-challenge" | "no-dispatch";
  sideEffectClass: "retained-chat-and-evidence" |
    "possible-native-start-and-retained-chat-evidence" | "none";
  aggregateWallDeadlineEnforced: boolean;
  outputTokensEnforcedByExistingFlight: boolean;
};
export type QualificationLabProcedureDescriptor = {
  id: QualificationLabProcedureId;
  title: string;
  purpose: string;
  capabilities: readonly RuntimeCapabilityName[];
  supportedProtocolRequired: readonly RuntimeCapabilityName[];
  runner: QualificationLabRunner;
  runnerMode: "default" | "standard" | null;
  limits: QualificationLabBounds;
  steps: readonly QualificationLabStep[];
  expectedAuthority: "qualificationReceipts" | "measurementRuns" | "none";
};

const chatStep: QualificationLabStep = {
  id: "single-chat-adherence",
  title: "One Chat-only exact-output challenge",
  workload: "instruction-adherence", maxDispatches: 1, cancelAfterOutput: false,
  expectedEvidence: [
    "Prepared exact model/system/persona and no-tool request",
    "One correlated request UUID, text start/deltas/end and terminal stop",
    "Independent Chat, streaming, terminal and exact-output verdicts",
    "Four verifier-owned version-2 receipts, including any negative result",
  ],
};
const coldStep: QualificationLabStep = {
  id: "cold-or-warm-adherence",
  title: "Initial instruction-adherence Chat; cold only with proved stopped-to-ready transition",
  workload: "instruction-adherence", maxDispatches: 1, cancelAfterOutput: false,
  expectedEvidence: [
    "Native runtime identity and separate Chat/native request IDs",
    "Measured or Unknown first meaningful text, token counts and completion",
    "Adherence pass/fail/incomplete independent of Chat completion",
  ],
};
const warmStep: QualificationLabStep = {
  id: "same-epoch-warm-chat", title: "One same-process warm Chat",
  workload: "chat", maxDispatches: 1, cancelAfterOutput: false,
  expectedEvidence: [
    "Same deployment, process and epoch before dispatch",
    "One independently settled native request and Chat activity UUID",
    "Source-tagged timing and usage observations or explicit Unknown",
  ],
};
const cancelStep: QualificationLabStep = {
  id: "bounded-cancellation", title: "One harmless cancellation challenge",
  workload: "cancellation", maxDispatches: 1, cancelAfterOutput: true,
  expectedEvidence: [
    "Recorded cancellation request and native acknowledgement",
    "Separate incomplete/cancelled Chat activity, if observed",
    "Bounded post-cancellation quiescence, without eternal-effects claims",
  ],
};
const unavailableStep = (id: string, title: string, workload: QualificationLabStep["workload"],
  expectedEvidence: readonly string[]): QualificationLabStep => ({
  id, title, workload, expectedEvidence, maxDispatches: 0, cancelAfterOutput: false,
});
const limits = (attempts: number, wallMs: number, output: number,
  cancel: QualificationLabBounds["cancelPolicy"],
  effects: QualificationLabBounds["sideEffectClass"],
  aggregateWallDeadlineEnforced = false): QualificationLabBounds => ({
  maxAttempts: attempts, maxWallTimeMs: wallMs,
  maxOutputTokensPerAttempt: output, maxOutputTokensTotal: attempts * output,
  maxRetries: 0, maxAutomaticContinuations: 0, cancelPolicy: cancel,
  sideEffectClass: effects, aggregateWallDeadlineEnforced,
  outputTokensEnforcedByExistingFlight: attempts > 0,
});

/** Immutable procedure catalog. Unsupported future protocols have zero
 * dispatch budget and no fake executor, regardless of model metadata. */
export const QUALIFICATION_LAB_PROCEDURES: readonly QualificationLabProcedureDescriptor[] = [
  {
    id: "chat-and-adherence",
    title: "Chat transport and instruction adherence",
    purpose: "Verify Chat, streaming, completion and exact-output behavior separately.",
    capabilities: ["chat", "streaming", "terminal-completion", "instruction-adherence"],
    supportedProtocolRequired: ["chat", "streaming", "terminal-completion", "instruction-adherence"],
    runner: "managed-chat-qualification", runnerMode: "default",
    limits: limits(1, 120_000, MANAGED_QUALIFICATION_MAX_OUTPUT,
      "cancel-at-bound", "retained-chat-and-evidence", true),
    steps: [chatStep], expectedAuthority: "qualificationReceipts",
  },
  {
    id: "cold-warm-cancellation",
    title: "Cold/warm Chat and cancellation evidence",
    purpose: "Measure distinct transport boundaries and bounded cancellation; not Agent reliability.",
    capabilities: ["chat", "streaming", "terminal-completion", "instruction-adherence", "cancellation"],
    supportedProtocolRequired: ["chat", "streaming", "terminal-completion", "instruction-adherence", "cancellation"],
    runner: "bounded-deployment-measurement", runnerMode: "standard",
    limits: limits(LM6_MAX_ATTEMPTS, 300_000, MANAGED_QUALIFICATION_MAX_OUTPUT,
      "bounded-cancellation-challenge", "possible-native-start-and-retained-chat-evidence"),
    steps: [coldStep, warmStep, cancelStep], expectedAuthority: "measurementRuns",
  },
  {
    id: "structured-json-schema", title: "Structured JSON Schema",
    purpose: "Require observed constrained protocol and independent JSON Schema validation.",
    capabilities: ["json-schema"], supportedProtocolRequired: ["json-schema"],
    runner: null, runnerMode: null,
    limits: limits(0, 0, 0, "no-dispatch", "none"),
    steps: [unavailableStep("structured-schema", "Protocol-gated JSON Schema",
      "structured-output", ["Exact schema digest and verified native format route",
        "Independently validated output and bounded negative results"])],
    expectedAuthority: "none",
  },
  {
    id: "native-tool-correlation", title: "Native tool semantics",
    purpose: "Require genuine structured SDK tool calls, arguments and correlated effects.",
    capabilities: ["native-tools", "tool-protocol", "tool-arguments", "tool-results"],
    supportedProtocolRequired: ["native-tools", "tool-protocol", "tool-arguments", "tool-results"],
    runner: null, runnerMode: null,
    limits: limits(0, 0, 0, "no-dispatch", "none"),
    steps: [unavailableStep("native-tool", "Harmless native-tool challenge",
      "native-tools", ["Exact protocol/schema digest and validated structured call",
        "Matching tool-call ID and genuine result; no invented effects"])],
    expectedAuthority: "none",
  },
  {
    id: "context-configuration", title: "Working-context configuration",
    purpose: "Require independent bounded context proof before calling a setting qualified.",
    capabilities: ["context-configuration"], supportedProtocolRequired: ["context-configuration"],
    runner: null, runnerMode: null,
    limits: limits(0, 0, 0, "no-dispatch", "none"),
    steps: [unavailableStep("context", "Exact context load and output reserve",
      "context-configuration", ["Current loaded context and serialized native request",
        "Identity-matched runtime epoch and installed artifact revision"])],
    expectedAuthority: "none",
  },
  {
    id: "coding-task", title: "Standalone coding task",
    purpose: "Require isolated workspace output and independent build/test acceptance before judging coding reliability.",
    capabilities: ["chat", "native-tools", "tool-results"],
    supportedProtocolRequired: ["chat", "native-tools", "tool-results"],
    runner: null, runnerMode: null,
    limits: limits(0, 0, 0, "no-dispatch", "none"),
    steps: [unavailableStep("coding", "Isolated no-effect coding acceptance fixture",
      "coding", ["Exact reproducible task/permission/workspace specification",
        "Independent source, tests, build, runtime behavior and persisted failure receipts"])],
    expectedAuthority: "none",
  },
  {
    id: "long-context-retrieval", title: "Long-context retrieval",
    purpose: "Verify exact context/configuration and independent retrieval fidelity at a bounded workload size.",
    capabilities: ["chat", "context-configuration"],
    supportedProtocolRequired: ["chat", "context-configuration"],
    runner: null, runnerMode: null,
    limits: limits(0, 0, 0, "no-dispatch", "none"),
    steps: [unavailableStep("retrieval", "Exact-size retrieval challenge",
      "long-context-retrieval", ["Verified loaded context and serialized prompt digest",
        "Reference answer and independent exact-source retrieval evaluation"])],
    expectedAuthority: "none",
  },
  {
    id: "reliability", title: "Repeatability and reliability",
    purpose: "Report actual independent attempt denominators without retry-to-pass or historical outcome laundering.",
    capabilities: ["chat", "streaming", "terminal-completion"],
    supportedProtocolRequired: ["chat", "streaming", "terminal-completion"],
    runner: null, runnerMode: null,
    limits: limits(0, 0, 0, "no-dispatch", "none"),
    steps: [unavailableStep("reliability", "Pre-registered repeatability cohort",
      "reliability", ["Fixed attempt denominator including failure, cancellation and unavailable",
        "Exact matching runtime epoch and separate per-attempt native settlement"])],
    expectedAuthority: "none",
  },
  {
    id: "agent-readiness", title: "Automatic Agent prerequisites",
    purpose: "Check each required native-tool semantic and independent task completion without inferring permission.",
    capabilities: ["native-tools", "tool-arguments", "tool-results",
      "sequential-tools", "no-fabricated-effects"],
    supportedProtocolRequired: ["native-tools", "tool-arguments", "tool-results",
      "sequential-tools", "no-fabricated-effects"],
    runner: null, runnerMode: null,
    limits: limits(0, 0, 0, "no-dispatch", "none"),
    steps: [unavailableStep("agent", "Native Agent reliability preflight",
      "agent-readiness", ["Five independent exact-protocol native-tool capability verdicts",
        "Scoped permissions, effect correlation, task completion and user acceptance"])],
    expectedAuthority: "none",
  },
  {
    id: "standalone-cancellation", title: "Standalone cancellation",
    purpose: "Require bounded native cancellation and quiescence without dispatching the bundled LM6 three-request suite.",
    capabilities: ["cancellation"],
    supportedProtocolRequired: ["cancellation"],
    runner: null, runnerMode: null,
    limits: limits(0, 0, 0, "no-dispatch", "none"),
    steps: [unavailableStep("cancel-only", "Isolated cancellation challenge",
      "cancellation", ["Exact native request and authoritative cancellation acknowledgement",
        "Bounded after-cancel observation, no automatic continuation or extra request"])],
    expectedAuthority: "none",
  },
] as const;

export type QualificationLabScopePreview = {
  deploymentId: string;
  /** Canonical ModelDeployment tuple from saved source, never display alias. */
  deploymentIdentity: string | null;
  hostId: string;
  runtimeId: string;
  runtimeType: string | null;
  runtimeVersion: string | null;
  runtimeConfigurationRevision: number | null;
  runtimeEpoch: string | null;
  runtimeProcessIdentity: string | null;
  artifactId: string | null;
  artifactDigest: string | null;
  artifactFormat: string | null;
  configurationIdentity: string | null;
  backend: EvidenceCandidate["backend"];
  contextTokens: number | null;
  exactObservedScope: (DeploymentQualificationScope & { deploymentId: string }) | null;
};
export type QualificationLabGate = {
  id: "procedure" | "identity" | "native" | "permissions" | "protocol" |
    "implementation" | "bounds";
  allowed: boolean;
  reason: string;
};
export type QualificationLabPlanOptions = {
  /** Mandatory to enable: resolve canonical deployed model from existing CAS. */
  state?: SelfHostedState;
  /** Separately read native status; builder itself performs no IPC. */
  managedStatus?: ManagedLocalNativeStatus | null;
  managedObservedAt?: number | null;
  chatOnlyCoderConfirmed?: boolean;
  now?: number;
};
export type QualificationLabPlan = {
  procedure: QualificationLabProcedureDescriptor;
  scope: QualificationLabScopePreview;
  enabled: boolean;
  unavailableReason: string | null;
  gates: QualificationLabGate[];
  runner: QualificationLabRunner;
  runnerMode: QualificationLabProcedureDescriptor["runnerMode"];
  requiresFinalPreflight: true;
  aggregateWallDeadlineEnforced: boolean;
};

function distinctId<T extends { id: string }>(rows: readonly T[], id: string): T | null {
  const found = rows.filter(row => row.id === id);
  return found.length === 1 ? found[0] : null;
}
function recent(value: number | null | undefined, now: number): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) &&
    value <= now && now - value < 30_000;
}

/** Pure immutable preview. Enabled indicates existing-runner eligibility only:
 * no new authority, permission, runtime status lookup, or automatic inference.
 * The caller must recheck every identity/permission/native condition at use. */
export function buildQualificationLabPlan(
  candidate: EvidenceCandidate,
  procedure: QualificationLabProcedureId | QualificationLabProcedureDescriptor,
  options: QualificationLabPlanOptions = {},
): QualificationLabPlan {
  const now = options.now ?? Date.now();
  const registered = QUALIFICATION_LAB_PROCEDURES.find(item =>
    item.id === (typeof procedure === "string" ? procedure : procedure.id));
  const descriptor = registered ?? QUALIFICATION_LAB_PROCEDURES[0];
  const gates: QualificationLabGate[] = [];
  const gate = (id: QualificationLabGate["id"], allowed: boolean, reason: string) =>
    gates.push({ id, allowed, reason });
  gate("procedure", !!registered && (typeof procedure === "string" || procedure === registered),
    "Only a registered immutable qualification procedure is accepted.");
  let fabric: ReturnType<typeof reconcileLocalComputeFabric> | null = null;
  try {
    if (options.state) fabric = reconcileLocalComputeFabric(options.state);
  } catch { /* Broken current registry is not executable. */ }
  const deployment = fabric && distinctId(fabric.deployments, candidate.deploymentId);
  const host = fabric && deployment && distinctId(fabric.hosts, deployment.hostId);
  const runtime = fabric && deployment && distinctId(fabric.runtimes, deployment.runtimeId);
  const artifact = fabric && deployment && distinctId(fabric.artifacts, deployment.artifactId);
  const canonicalIdentity = deployment ? deploymentIdentity(deployment) : null;
  const consistent = !!deployment && !!host && !!runtime && !!artifact &&
    !!artifact.digest && !!deployment.configurationIdentity &&
    host.enabled && runtime.enabled && host.runtimeIds.includes(runtime.id) &&
    runtime.hostId === host.id && deployment.hostId === host.id &&
    deployment.configurationRevision === runtime.configurationRevision &&
    candidate.hostId === host.id && candidate.runtimeId === runtime.id &&
    candidate.runtimeVersion === (runtime.version ?? null) &&
    candidate.artifactDigest === artifact.digest &&
    candidate.artifactFormat === artifact.format &&
    candidate.configurationIdentity === deployment.configurationIdentity;
  gate("identity", consistent,
    "Saved host/runtime/artifact/deployment identity must match the selected candidate.");

  let observedScope: QualificationLabScopePreview["exactObservedScope"] = null;
  let managedSelection: string | null = null;
  if (consistent && options.state && deployment && runtime && host && artifact &&
      runtime.type === MANAGED_LOCAL_RUNTIME_TYPE &&
      host.id === MANAGED_LOCAL_HOST_ID && host.location === "local") {
    try {
      managedSelection = managedLocalSelectionId(deployment);
      const verifiedSelection = resolveManagedLocalSelection(options.state, managedSelection);
      if (verifiedSelection.status !== "missing" &&
          verifiedSelection.status !== "not-managed" &&
          verifiedSelection.identity === canonicalIdentity &&
          recent(options.managedObservedAt, now) &&
          recent(candidate.observation?.observedAt, now) &&
          candidate.ready && candidate.readiness === "Ready" &&
          options.managedStatus?.state === "Ready") {
        const projected = observedManagedFabric(options.state, managedSelection,
          options.managedStatus, now);
        const actual = projected?.observation &&
          deploymentQualificationScope(projected.fabric,
            candidate.deploymentId, projected.observation, now);
        if (actual && projected?.observation &&
            candidate.observation?.runtimeId === projected.observation.runtimeId &&
            candidate.observation.version === projected.observation.version &&
            candidate.observation.configurationRevision ===
              projected.observation.configurationRevision &&
            candidate.observation.epoch === projected.observation.epoch &&
            actual.deploymentIdentity === canonicalIdentity)
          observedScope = { ...actual, deploymentId: candidate.deploymentId };
      }
    } catch { /* Ambiguous legacy or corrupted managed identity. */ }
  }
  gate("native", !!observedScope,
    "Fresh independently read native Ready status must match digest/version/PID/epoch.");
  gate("permissions", options.chatOnlyCoderConfirmed === true,
    "Existing builtin:coder profile must already be Chat Only.");
  const denied = descriptor.supportedProtocolRequired.find(capability => {
    // Existing pre-LM2F registrations have two absent protocol declarations.
    // Its established read-only projection never overrides explicit unknown
    // or unsupported declarations and grants no qualification.
    const declaredRuntime = runtime && runtime.type === MANAGED_LOCAL_RUNTIME_TYPE
      ? projectManagedQualificationDeclarations(runtime) : runtime;
    const declaration = declaredRuntime?.capabilities[capability]?.status ?? "unknown";
    return declaration !== "supported" && declaration !== "requires-qualification";
  });
  gate("protocol", !denied, denied ?
    `Required runtime protocol ${denied} is unavailable, unknown or explicitly unsupported.` :
    "All required protocols are declared compatible with explicit verification.");
  gate("implementation", descriptor.runner !== null && managedSelection !== null,
    "Only exact managed Chat/LM6 adapters exist; other protocols have no safe executor.");
  // The LM11 B01–B03 physical acceptance covers this ORIGINAL 120s Chat
  // runner, not LM6's separately bounded three-attempt 300s procedure. A
  // metadata flag alone cannot claim a different adapter has proven safety.
  const aggregateDeadlineProven = descriptor.runner === "managed-chat-qualification" &&
    descriptor.runnerMode === "default" &&
    descriptor.expectedAuthority === "qualificationReceipts" &&
    descriptor.limits.maxWallTimeMs === 120_000 &&
    descriptor.limits.maxAttempts === 1 &&
    descriptor.limits.cancelPolicy === "cancel-at-bound" &&
    descriptor.limits.aggregateWallDeadlineEnforced === true;
  gate("bounds", descriptor.limits.maxAttempts > 0 &&
    descriptor.limits.maxAttempts === descriptor.steps.reduce((n, step) => n + step.maxDispatches, 0) &&
    descriptor.limits.maxOutputTokensPerAttempt === MANAGED_QUALIFICATION_MAX_OUTPUT &&
    descriptor.limits.maxOutputTokensTotal ===
      descriptor.limits.maxAttempts * descriptor.limits.maxOutputTokensPerAttempt &&
    descriptor.limits.outputTokensEnforcedByExistingFlight === true &&
    descriptor.limits.maxRetries === 0 && descriptor.limits.maxAutomaticContinuations === 0 &&
    aggregateDeadlineProven,
    "This procedure has no independently accepted aggregate runner deadline; Lab execution remains disabled.");

  if (consistent && descriptor.runner !== null && runtime && deployment) {
    let material: unknown;
    try { material = JSON.parse(deployment.configurationIdentity ?? ""); } catch { /* invalid */ }
    const config = material && typeof material === "object" ? material as Record<string, unknown> : null;
    gate("identity", candidate.backend === "CPU" && config?.gpu === 0 &&
      config?.tool === false && config?.grammar === false &&
      config?.context === candidate.contextTokens &&
      typeof candidate.contextTokens === "number" &&
      Number.isSafeInteger(candidate.contextTokens) &&
      candidate.contextTokens >= 512 && candidate.contextTokens <= 131_072,
      "Existing managed executor requires exact CPU-only, no-tool/grammar context.");
  }
  const scope: QualificationLabScopePreview = {
    deploymentId: candidate.deploymentId, deploymentIdentity: canonicalIdentity,
    hostId: host?.id ?? candidate.hostId,
    runtimeId: runtime?.id ?? candidate.runtimeId,
    runtimeType: runtime?.type ?? null,
    runtimeVersion: runtime?.version ?? null,
    runtimeConfigurationRevision: runtime?.configurationRevision ?? null,
    runtimeEpoch: observedScope?.runtimeEpoch ?? null,
    runtimeProcessIdentity: observedScope?.runtimeProcessIdentity ?? null,
    artifactId: artifact?.id ?? null,
    artifactDigest: artifact?.digest ?? candidate.artifactDigest,
    artifactFormat: artifact?.format ?? null,
    configurationIdentity: deployment?.configurationIdentity ?? candidate.configurationIdentity,
    backend: candidate.backend, contextTokens: candidate.contextTokens,
    exactObservedScope: observedScope,
  };
  const enabled = gates.every(value => value.allowed);
  return {
    procedure: descriptor, scope, enabled,
    unavailableReason: enabled ? null :
      (descriptor.runner === null ? gates.find(value => value.id === "implementation") :
        gates.find(value => !value.allowed))?.reason ?? "No safe procedure",
    gates, runner: descriptor.runner,
    runnerMode: descriptor.runnerMode,
    requiresFinalPreflight: true,
    aggregateWallDeadlineEnforced: aggregateDeadlineProven,
  };
}
