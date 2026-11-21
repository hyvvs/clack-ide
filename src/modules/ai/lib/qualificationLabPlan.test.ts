import { describe, expect, it } from "vitest";
import { buildDeploymentEvidenceCatalog } from "./deploymentEvidenceDecisions";
import {
  attachManagedLocalGguf, resolveManagedLocalSelection,
} from "./managedLocalModels";
import { emptySelfHostedState } from "./selfHostedProfiles";
import {
  QUALIFICATION_LAB_PROCEDURES, buildQualificationLabPlan,
  type QualificationLabPlanOptions, type QualificationLabProcedureDescriptor,
} from "./qualificationLabPlan";

// All fixtures and tests are offline pure functions: no native runtime read,
// provider request, model installation, permission change or settings write.
const NOW = 1_800_000_000_000;
const DIGEST = `sha256:${"a".repeat(64)}`;
const OTHER_DIGEST = `sha256:${"b".repeat(64)}`;

function fixture() {
  const attached = attachManagedLocalGguf(emptySelfHostedState(), {
    digest: DIGEST, displayName: "Arbitrary local GGUF",
    material: { version: 1, context: 2048, gpu: 0, tool: false, grammar: false },
  });
  const selected = resolveManagedLocalSelection(attached.state, attached.selectionId);
  if (selected.status === "missing" || selected.status === "not-managed")
    throw new Error("Fixture could not resolve managed deployment");
  const status = {
    installed: true, state: "Ready" as const, version: "b12248",
    deploymentId: selected.deployment.id, modelDigest: selected.artifact.digest,
    epoch: "epoch-a", processId: 4321, port: 60200,
  };
  const [candidate] = buildDeploymentEvidenceCatalog(attached.state, {
    now: NOW, managedStatus: status, managedObservedAt: NOW - 10,
  });
  if (!candidate) throw new Error("Fixture catalog failed");
  const options: QualificationLabPlanOptions = {
    now: NOW, state: attached.state, managedStatus: status,
    managedObservedAt: NOW - 10, chatOnlyCoderConfirmed: true,
  };
  return { ...attached, selected, status, candidate, options };
}

describe("LM11–LM15 deterministic qualification lab planning", () => {
  it("registers bounded and immutable generic procedures with truthful evidence destinations", () => {
    expect(QUALIFICATION_LAB_PROCEDURES.map(p => p.id)).toEqual([
      "chat-and-adherence", "cold-warm-cancellation", "structured-json-schema",
      "native-tool-correlation", "context-configuration", "coding-task",
      "long-context-retrieval", "reliability", "agent-readiness",
      "standalone-cancellation",
    ]);
    expect(new Set(QUALIFICATION_LAB_PROCEDURES.map(p => p.id)).size).toBe(10);
    for (const procedure of QUALIFICATION_LAB_PROCEDURES) {
      expect(procedure.limits.maxAttempts).toBe(
        procedure.steps.reduce((sum, step) => sum + step.maxDispatches, 0));
      expect(procedure.limits.maxOutputTokensTotal).toBe(
        procedure.limits.maxOutputTokensPerAttempt * procedure.limits.maxAttempts);
      expect(procedure.limits.maxRetries).toBe(0);
      expect(procedure.limits.maxAutomaticContinuations).toBe(0);
      expect(procedure.limits.aggregateWallDeadlineEnforced).toBe(
        procedure.id === "chat-and-adherence");
      expect(procedure.capabilities.length).toBeGreaterThan(0);
      expect(procedure.steps.every(step => step.expectedEvidence.length > 0)).toBe(true);
      expect(procedure.title).not.toMatch(/qwen|devstral|glm/i);
    }
    expect(QUALIFICATION_LAB_PROCEDURES[0]).toMatchObject({
      runner: "managed-chat-qualification", runnerMode: "default",
      expectedAuthority: "qualificationReceipts",
      limits: { maxAttempts: 1, maxOutputTokensPerAttempt: 128, maxOutputTokensTotal: 128,
        maxWallTimeMs: 120_000, aggregateWallDeadlineEnforced: true,
        sideEffectClass: "retained-chat-and-evidence" },
    });
    expect(QUALIFICATION_LAB_PROCEDURES[1]).toMatchObject({
      runner: "bounded-deployment-measurement", runnerMode: "standard",
      expectedAuthority: "measurementRuns",
      limits: { maxAttempts: 3, maxOutputTokensTotal: 384, maxWallTimeMs: 300_000,
        cancelPolicy: "bounded-cancellation-challenge", aggregateWallDeadlineEnforced: false,
        sideEffectClass: "possible-native-start-and-retained-chat-evidence" },
    });
    for (const unsupported of QUALIFICATION_LAB_PROCEDURES.slice(2)) {
      expect(unsupported).toMatchObject({
        runner: null, runnerMode: null, expectedAuthority: "none",
        limits: { maxAttempts: 0, maxWallTimeMs: 0, maxOutputTokensTotal: 0,
          aggregateWallDeadlineEnforced: false,
          sideEffectClass: "none", cancelPolicy: "no-dispatch" },
      });
    }
  });

  it("enables only original 120s Chat runner for an exact fresh managed deployment", () => {
    const f = fixture();
    const original = JSON.stringify(f.state);
    const chat = buildQualificationLabPlan(f.candidate, "chat-and-adherence", f.options);
    const measure = buildQualificationLabPlan(f.candidate, "cold-warm-cancellation", f.options);
    expect(chat.enabled).toBe(true);
    expect(chat.unavailableReason).toBeNull();
    expect(chat.runner).toBe("managed-chat-qualification");
    expect(chat.runnerMode).toBe("default");
    expect(chat.scope).toMatchObject({
      deploymentId: f.selected.deployment.id,
      deploymentIdentity: f.selected.identity,
      runtimeId: f.selected.runtime.id, hostId: f.selected.host.id,
      runtimeVersion: "b12248", runtimeEpoch: "epoch-a",
      runtimeProcessIdentity: "pid:4321",
      artifactId: f.selected.artifact.id, artifactDigest: DIGEST,
      configurationIdentity: f.selected.deployment.configurationIdentity,
      backend: "CPU", contextTokens: 2048,
      exactObservedScope: { deploymentId: f.selected.deployment.id,
        runtimeProcessIdentity: "pid:4321" },
    });
    expect(chat.requiresFinalPreflight).toBe(true);
    expect(chat.aggregateWallDeadlineEnforced).toBe(true);
    expect(chat.gates.every(g => g.allowed)).toBe(true);
    expect(measure.enabled).toBe(false);
    expect(measure.aggregateWallDeadlineEnforced).toBe(false);
    expect(measure.unavailableReason).toContain("no independently accepted aggregate runner deadline");
    expect(measure.runner).toBe("bounded-deployment-measurement");
    expect(measure.runnerMode).toBe("standard");
    expect(measure.gates.filter(g => !g.allowed)).toMatchObject([{
      id: "bounds", allowed: false,
    }]);
    expect(measure.procedure.steps.map(s => [s.workload, s.cancelAfterOutput])).toEqual([
      ["instruction-adherence", false], ["chat", false], ["cancellation", true],
    ]);
    expect(JSON.stringify(f.state)).toBe(original);
  });

  it("two-argument preview and unconfirmed Chat-only permission are disabled", () => {
    const f = fixture();
    const missing = buildQualificationLabPlan(f.candidate, "chat-and-adherence");
    expect(missing.enabled).toBe(false);
    expect(missing.scope.deploymentIdentity).toBeNull();
    expect(missing.runner).toBe("managed-chat-qualification");
    const noPermission = buildQualificationLabPlan(f.candidate,
      "chat-and-adherence", { ...f.options, chatOnlyCoderConfirmed: false });
    expect(noPermission.enabled).toBe(false);
    expect(noPermission.gates.find(g => g.id === "permissions")?.allowed).toBe(false);
  });

  it("rejects stale native observations and changed runtime process/epoch/artifact", () => {
    const f = fixture();
    const cases: QualificationLabPlanOptions[] = [
      { ...f.options, managedObservedAt: NOW - 30_000 },
      { ...f.options, managedStatus: { ...f.status, processId: null } },
      { ...f.options, managedStatus: { ...f.status, epoch: "another-epoch" } },
      { ...f.options, managedStatus: { ...f.status, modelDigest: OTHER_DIGEST } },
      { ...f.options, managedStatus: { ...f.status, version: "future-engine" } },
      { ...f.options, managedStatus: { ...f.status, state: "Stopped" } },
    ];
    for (const options of cases) {
      const plan = buildQualificationLabPlan(f.candidate, "chat-and-adherence", options);
      expect(plan.enabled).toBe(false);
      expect(plan.aggregateWallDeadlineEnforced).toBe(true);
      expect(plan.runner).toBe("managed-chat-qualification");
      expect(plan.scope.exactObservedScope).toBeNull();
    }
    if (!f.candidate.observation) throw new Error("Fixture native observation unavailable");
    const staleCandidate = {
      ...f.candidate,
      observation: { ...f.candidate.observation, observedAt: NOW - 30_000 },
    };
    expect(buildQualificationLabPlan(staleCandidate, "chat-and-adherence", f.options).enabled)
      .toBe(false);
  });

  it("rejects changed configuration, digest, host, runtime version and backend without weakening the registry", () => {
    const f = fixture();
    const candidates = [
      { ...f.candidate, configurationIdentity: "different" },
      { ...f.candidate, artifactDigest: OTHER_DIGEST },
      { ...f.candidate, hostId: "other-host" },
      { ...f.candidate, runtimeVersion: "changed-version" },
      { ...f.candidate, backend: "GPU" as const },
      { ...f.candidate, contextTokens: 4096 },
    ];
    for (const candidate of candidates) {
      const plan = buildQualificationLabPlan(candidate, "chat-and-adherence", f.options);
      expect(plan.enabled).toBe(false);
    }
    const mutated = structuredClone(f.state);
    if (!mutated.fabric) throw new Error("Fixture fabric unavailable");
    mutated.fabric.deployments[0].configurationIdentity = "changed-material";
    expect(buildQualificationLabPlan(f.candidate, "chat-and-adherence", {
      ...f.options, state: mutated,
    }).enabled).toBe(false);
    const duplicated = structuredClone(f.state);
    if (!duplicated.fabric) throw new Error("Fixture fabric unavailable");
    duplicated.fabric.deployments.push({ ...duplicated.fabric.deployments[0] });
    expect(buildQualificationLabPlan(f.candidate, "chat-and-adherence", {
      ...f.options, state: duplicated,
    }).enabled).toBe(false);
  });

  it("unsupported, unknown and unimplemented protocols remain disabled without testing the model", () => {
    const f = fixture();
    for (const procedure of QUALIFICATION_LAB_PROCEDURES.slice(2)) {
      const result = buildQualificationLabPlan(f.candidate, procedure.id, f.options);
      expect(result.enabled).toBe(false);
      expect(result.runner).toBeNull();
      expect(result.procedure.limits.maxAttempts).toBe(0);
      expect(result.gates.find(g => g.id === "implementation")?.allowed).toBe(false);
      expect(result.procedure.expectedAuthority).toBe("none");
    }
    const unknown = structuredClone(f.state);
    if (!unknown.fabric) throw new Error("Fixture fabric unavailable");
    delete unknown.fabric.runtimes[0].capabilities.chat;
    const plan = buildQualificationLabPlan(f.candidate, "chat-and-adherence", {
      ...f.options, state: unknown,
    });
    expect(plan.enabled).toBe(false);
    expect(plan.gates.find(g => g.id === "protocol")).toMatchObject({ allowed: false });
    const unsupported = structuredClone(f.state);
    if (!unsupported.fabric) throw new Error("Fixture fabric unavailable");
    unsupported.fabric.runtimes[0].capabilities.chat = {
      status: "unsupported", source: "declared",
    };
    expect(buildQualificationLabPlan(f.candidate, "chat-and-adherence", {
      ...f.options, state: unsupported,
    }).enabled).toBe(false);
  });

  it("the established legacy managed declaration projection only fills missing verifier protocols", () => {
    const f = fixture();
    const legacy = structuredClone(f.state);
    if (!legacy.fabric) throw new Error("Fixture fabric unavailable");
    delete legacy.fabric.runtimes[0].capabilities["terminal-completion"];
    delete legacy.fabric.runtimes[0].capabilities["instruction-adherence"];
    const projected = buildQualificationLabPlan(f.candidate, "chat-and-adherence", {
      ...f.options, state: legacy,
    });
    expect(projected.gates.find(g => g.id === "protocol")?.allowed).toBe(true);
    expect(projected.enabled).toBe(true); // only absent declarations are projected
    const denied = structuredClone(legacy);
    if (!denied.fabric) throw new Error("Fixture fabric unavailable");
    denied.fabric.runtimes[0].capabilities["instruction-adherence"] = {
      status: "unsupported", source: "native-declaration",
    };
    expect(buildQualificationLabPlan(f.candidate, "chat-and-adherence", {
      ...f.options, state: denied,
    }).gates.find(g => g.id === "protocol")?.allowed).toBe(false);
  });

  it("unknown and forged descriptors can neither add dispatches nor gain a runner", () => {
    const f = fixture();
    const spoofed: QualificationLabProcedureDescriptor = {
      ...QUALIFICATION_LAB_PROCEDURES[0], limits: {
        ...QUALIFICATION_LAB_PROCEDURES[0].limits, maxRetries: 0, maxAttempts: 99,
      },
    };
    const forged = buildQualificationLabPlan(f.candidate, spoofed, f.options);
    expect(forged.enabled).toBe(false);
    expect(forged.gates.find(g => g.id === "procedure")?.allowed).toBe(false);
    const invalid = buildQualificationLabPlan(f.candidate, "unknown" as
      QualificationLabProcedureDescriptor["id"], f.options);
    expect(invalid.enabled).toBe(false);
    expect(invalid.gates.find(g => g.id === "procedure")?.allowed).toBe(false);
  });

  it("unsupported task/protocol categories have explicit unavailable runner reasons and zero side effects", () => {
    const f = fixture();
    for (const id of ["coding-task", "long-context-retrieval", "reliability",
      "agent-readiness", "standalone-cancellation"] as const) {
      const result = buildQualificationLabPlan(f.candidate, id, f.options);
      expect(result.enabled).toBe(false);
      expect(result.runner).toBeNull();
      expect(result.unavailableReason).toContain("no safe executor");
      expect(result.procedure.steps.every(s => s.maxDispatches === 0)).toBe(true);
      expect(result.procedure.limits).toMatchObject({
        maxAttempts: 0, maxWallTimeMs: 0, maxRetries: 0,
        maxOutputTokensTotal: 0, sideEffectClass: "none",
      });
    }
  });
});
