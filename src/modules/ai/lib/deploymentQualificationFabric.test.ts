import { describe, expect, it } from "vitest";
import {
  assertWritableSelfHostedState,
  readSelfHostedState,
  type SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  deploymentQualificationEvidenceReceiptSchema,
  CURRENT_DEPLOYMENT_QUALIFICATION_PROCEDURES,
  deploymentQualificationScope,
  deploymentQualificationState,
  localComputeFabricSchema,
  reconcileLocalComputeFabric,
  recordDeploymentQualification,
  type DeploymentQualificationContext,
  type DeploymentQualificationEvidenceReceipt,
  type DeploymentRuntimeObservation,
  type LocalComputeFabric,
  type RuntimeCapabilityName,
} from "./localComputeFabric";
import {
  AGENT_QUALIFICATION_REQUIREMENTS,
  assessDeploymentAgentEligibility,
  assessDeploymentCapability,
} from "./deploymentQualificationPolicy";
import {
  evaluateInstructionAdherence,
  instructionAdherenceReceipt,
} from "./instructionAdherenceQualification";

const now = 1_800_000_000_000;
const digest = `sha256:${"1".repeat(64)}`;
const schema = `sha256:${"2".repeat(64)}`;
const contextHash = `sha256:${"3".repeat(64)}` as const;
const artifact = { id: "artifact-a", displayName: "Same Name",
  format: "gguf" as const, digest, provenance: "user-supplied" as const };
const host = { id: "host-a", displayName: "Local", location: "local" as const,
  enabled: true, reachability: "online" as const, runtimeIds: ["runtime-a"] };
const capabilities = Object.fromEntries([
  "chat", "streaming", "terminal-completion", "cancellation", "instruction-adherence",
  "json-mode", "json-schema", "grammar", "native-tools", ...AGENT_QUALIFICATION_REQUIREMENTS,
].map(capability => [capability, { status: "requires-qualification", source: "declared" }]));
const runtime = { id: "runtime-a", hostId: host.id, type: "fixture-runtime",
  displayName: "Runtime A", version: "1.0.0", processIdentity: "pid-01",
  enabled: true, health: "online" as const, configurationRevision: 1,
  runtimeEpoch: "epoch-a", capabilities };
const deployment = { id: "deployment-a", hostId: host.id, runtimeId: runtime.id,
  artifactId: artifact.id, runtimeModelName: "same-model", configurationRevision: 1,
  configurationIdentity: '{"context":2048,"tool":"native-v1"}' };
const live: DeploymentRuntimeObservation = {
  runtimeId: runtime.id, version: "1.0.0", configurationRevision: 1,
  epoch: "epoch-a", observedAt: now - 10,
};
const toolContext: DeploymentQualificationContext = {
  toolProtocol: "native-v1", toolSchemaDigest: schema,
};

function base(): SelfHostedState {
  return {
    version: 1, revision: 1, endpoints: [], profiles: [],
    fabric: localComputeFabricSchema.parse({
      version: 1, hosts: [host], runtimes: [runtime],
      artifacts: [artifact], deployments: [deployment],
    }),
  };
}
function fixtureReceipt(
  fabric: LocalComputeFabric,
  capability: RuntimeCapabilityName = "chat",
  context: DeploymentQualificationContext = {},
  status: DeploymentQualificationEvidenceReceipt["status"] = "verified",
): DeploymentQualificationEvidenceReceipt {
  const scope = deploymentQualificationScope(fabric, deployment.id, live, now)!;
  return deploymentQualificationEvidenceReceiptSchema.parse({
    version: 2,
    scope: { ...scope, deploymentId: deployment.id },
    capability, context, status,
    verifiedAt: now - 100, expiresAt: now + 86_400_000,
    procedure: CURRENT_DEPLOYMENT_QUALIFICATION_PROCEDURES[capability as keyof typeof CURRENT_DEPLOYMENT_QUALIFICATION_PROCEDURES]
      ?? { id: "no-registered-verifier", version: 1 },
    evidence: {
      source: "native-observation", reference: "run-1", digest: schema,
      checks: [{ id: "deterministic", result: status === "verified" ? "pass"
        : status === "incomplete" ? "incomplete" : "fail" }],
    },
  });
}
function recorded(capability: RuntimeCapabilityName = "chat", context: DeploymentQualificationContext = {}) {
  const state = base();
  const receipt = fixtureReceipt(reconcileLocalComputeFabric(state), capability, context);
  return { state: recordDeploymentQualification(state, deployment.id, live, receipt, now), receipt };
}
function check(state: SelfHostedState, capability: RuntimeCapabilityName, obs = live,
               context: DeploymentQualificationContext = {}) {
  return assessDeploymentCapability(reconcileLocalComputeFabric(state),
    deployment.id, capability, obs, context, now);
}

describe("LM2F native-owned durable deployment qualification", () => {
  it("01 persists verified receipts through the existing CAS fabric with exact deployment identity", () => {
    const { state, receipt } = recorded();
    expect(state.fabric!.qualificationReceipts).toHaveLength(1);
    assertWritableSelfHostedState(state);
    const reloaded = readSelfHostedState(JSON.parse(JSON.stringify(state)));
    expect(reloaded.fabric!.qualificationReceipts).toEqual([receipt]);
    expect(check(reloaded, "chat")).toMatchObject({ state: "Qualified", available: true });
    expect(check(reloaded, "streaming")).toMatchObject({ state: "Requires Qualification", available: false });
  });

  it.each([
    ["different host", (f: LocalComputeFabric) => {
      const h = f.hosts[0];h.id = "host-b";
      f.runtimes[0].hostId = h.id;f.deployments[0].hostId = h.id;
    }],
    ["different runtime", (f: LocalComputeFabric, o: DeploymentRuntimeObservation) => {
      const r = f.runtimes[0];r.id = "runtime-b";
      f.hosts[0].runtimeIds = [r.id];f.deployments[0].runtimeId = r.id;
      o.runtimeId = r.id;
    }],
    ["different runtime implementation", (f: LocalComputeFabric) => {
      f.runtimes[0].type = "other-runtime";
    }],
    ["runtime version", (f: LocalComputeFabric, o: DeploymentRuntimeObservation) => {
      f.runtimes[0].version = "2.0.0";o.version = "2.0.0";
    }],
    ["same name, new artifact digest", (f: LocalComputeFabric) => {
      f.artifacts[0].digest = `sha256:${"4".repeat(64)}`;
    }],
    ["configuration changed", (f: LocalComputeFabric) => {
      f.deployments[0].configurationIdentity = '{"context":4096,"tool":"native-v2"}';
    }],
    ["runtime configuration revision", (f: LocalComputeFabric, o: DeploymentRuntimeObservation) => {
      f.runtimes[0].configurationRevision = 2;f.deployments[0].configurationRevision = 2;
      o.configurationRevision = 2;
    }],
    ["runtime epoch restart", (f: LocalComputeFabric, o: DeploymentRuntimeObservation) => {
      f.runtimes[0].runtimeEpoch = "epoch-b";o.epoch = "epoch-b";
    }],
    ["runtime process replaced", (f: LocalComputeFabric) => {
      f.runtimes[0].processIdentity = "pid-02";
    }],
    ["deployment deleted and recreated with different authoritative ID", (f: LocalComputeFabric) => {
      f.deployments[0].id = "deployment-b";
    }],
  ] as const)("02-11 historical Chat proof cannot transfer on %s", (_reason, change) => {
    const { state } = recorded();
    const modified = structuredClone(reconcileLocalComputeFabric(state));
    const observation = { ...live };
    change(modified, observation);
    const id = modified.deployments[0].id;
    expect(assessDeploymentCapability(modified, id, "chat", observation, {}, now).available).toBe(false);
  });

  it("12 keeps expired and changed-context history but cannot use it as current authorization", () => {
    const { state, receipt } = recorded("native-tools", toolContext);
    const fabric = reconcileLocalComputeFabric(state);
    expect(assessDeploymentCapability(fabric, deployment.id, "native-tools", live, toolContext, now).available).toBe(true);
    expect(assessDeploymentCapability(fabric, deployment.id, "native-tools", live,
      { ...toolContext, toolSchemaDigest: digest }, now).state).toBe("Qualification Stale");
    expect(assessDeploymentCapability(fabric, deployment.id, "native-tools", live, toolContext,
      receipt.expiresAt + 1).available).toBe(false);
    expect(fabric.qualificationReceipts).toContainEqual(receipt);
  });

  it("13 chat is independently qualified while native Agent tools remain unauthorized", () => {
    const { state } = recorded("chat");
    const fabric = reconcileLocalComputeFabric(state);
    expect(assessDeploymentCapability(fabric, deployment.id, "chat", live, {}, now).available).toBe(true);
    expect(assessDeploymentAgentEligibility(fabric, deployment.id, live, toolContext, now))
      .toMatchObject({ eligible: false });
    expect(assessDeploymentAgentEligibility(fabric, deployment.id, live, toolContext, now).reason)
      .toContain("native-tools");
  });

  it("14 even runtime native-tool support and one verified tool protocol cannot authorize Agent", () => {
    let state = recorded("native-tools", toolContext).state;
    const fabric = reconcileLocalComputeFabric(state);
    expect(assessDeploymentAgentEligibility(fabric, deployment.id, live, toolContext, now).eligible).toBe(false);
    state = recordDeploymentQualification(state, deployment.id, live,
      fixtureReceipt(fabric, "tool-arguments", toolContext), now);
    expect(assessDeploymentAgentEligibility(reconcileLocalComputeFabric(state),
      deployment.id, live, toolContext, now).eligible).toBe(false);
    for (const required of ["tool-results", "sequential-tools", "no-fabricated-effects"] as const) {
      state = recordDeploymentQualification(state, deployment.id, live,
        fixtureReceipt(reconcileLocalComputeFabric(state), required, toolContext), now);
    }
    expect(assessDeploymentAgentEligibility(reconcileLocalComputeFabric(state),
      deployment.id, live, toolContext, now).eligible).toBe(true);
    expect(assessDeploymentAgentEligibility(reconcileLocalComputeFabric(state),
      deployment.id, live, { ...toolContext, toolProtocol: "other-protocol" }, now).eligible).toBe(false);
  });

  it("15 structured JSON-schema qualification is independent of native tools", () => {
    const context = { formatSchemaDigest: schema };
    const { state } = recorded("json-schema", context);
    expect(check(state, "json-schema", live, context).available).toBe(true);
    expect(check(state, "native-tools", live, toolContext).available).toBe(false);
    expect(check(state, "json-mode").available).toBe(false);
    expect(check(state, "grammar", live, context).available).toBe(false);
  });

  it("16 unknown or explicitly unsupported runtime capabilities always fail closed", () => {
    const { state } = recorded();
    const unknown = structuredClone(reconcileLocalComputeFabric(state));
    unknown.runtimes[0].capabilities.chat = { status: "future-super-supported", source: "runtime-claim" };
    expect(assessDeploymentCapability(unknown, deployment.id, "chat", live, {}, now).state).toBe("Unknown");
    const denied = structuredClone(reconcileLocalComputeFabric(state));
    denied.runtimes[0].capabilities.chat = { status: "unsupported", source: "observed" };
    expect(assessDeploymentCapability(denied, deployment.id, "chat", live, {}, now).state).toBe("Unsupported");
  });

  it("17 switching deployments cannot reuse another ID's receipt, even with the same digest", () => {
    const { state } = recorded();
    const fabric = reconcileLocalComputeFabric(state);
    fabric.deployments.push({ ...fabric.deployments[0], id: "another-deployment" });
    expect(assessDeploymentCapability(fabric, "another-deployment", "chat", live, {}, now).available).toBe(false);
    expect(assessDeploymentCapability(fabric, deployment.id, "chat", live, {}, now).available).toBe(true);
    expect(deploymentQualificationState(fabric, "another-deployment", "chat", live,
      state.fabric?.qualificationReceipts?.[0] as DeploymentQualificationEvidenceReceipt,
      now)).toBe("Stale");
  });

  it("18 offline/disabled host and missing current runtime observation cannot authorize historical proof", () => {
    const { state } = recorded();
    const fabric = reconcileLocalComputeFabric(state);
    expect(assessDeploymentCapability(fabric, deployment.id, "chat", undefined, {}, now).available).toBe(false);
    fabric.hosts[0].enabled = false;
    expect(assessDeploymentCapability(fabric, deployment.id, "chat", live, {}, now).available).toBe(false);
    fabric.hosts[0].enabled = true;fabric.runtimes[0].health = "offline";
    expect(assessDeploymentCapability(fabric, deployment.id, "chat", live, {}, now).available).toBe(false);
  });

  it("19 preserves unknown future receipt versions without trusting them", () => {
    const { state, receipt } = recorded();
    const unknown = { ...receipt, version: 3, verifiedAt: now - 20,
      future: { capability: "super-agent", grant: true } };
    const next = { ...state, fabric: {
      ...state.fabric!, qualificationReceipts: [...state.fabric!.qualificationReceipts!, unknown],
      futureSchemaMetadata: { preserved: true },
    } };
    assertWritableSelfHostedState(next);
    const loaded = readSelfHostedState(JSON.parse(JSON.stringify(next)));
    expect(loaded.fabric?.qualificationReceipts).toContainEqual(unknown);
    expect((loaded.fabric as typeof next.fabric).futureSchemaMetadata).toEqual({ preserved: true });
    expect(check(loaded, "chat").available).toBe(false);
  });

  it("20 rejects forged passing receipts and invented model claims", () => {
    const fabric = reconcileLocalComputeFabric(base());
    const good = fixtureReceipt(fabric);
    expect(deploymentQualificationEvidenceReceiptSchema.safeParse({
      ...good, status: "verified",
      evidence: { ...good.evidence, checks: [{ id: "exact", result: "fail" }] },
    }).success).toBe(false);
    expect(deploymentQualificationEvidenceReceiptSchema.safeParse({
      ...good, evidence: { ...good.evidence, source: "model-says-it-can" },
    }).success).toBe(false);
    expect(() => recordDeploymentQualification(base(), deployment.id,
      { ...live, epoch: "different" }, good, now)).toThrow(/current execution identity/);
  });

  it("21 records instruction-adherence PASS and FAIL independently of Chat", async () => {
    const test = (output: string, personaId = "builtin:coder") => ({
      output, personaId, systemContextDigest: contextHash,
      requestId: `req-${output.length}`, finish: "stop" as const,
      contract: { kind: "exact" as const, expected: "EXACT-ACK" },
    });
    expect(evaluateInstructionAdherence(test("EXACT-ACK")).status).toBe("verified");
    expect(evaluateInstructionAdherence(test("EXACT-ACK\n")).status).toBe("failed");
    expect(evaluateInstructionAdherence(test("unrelated plan")).status).toBe("failed");
    expect(evaluateInstructionAdherence({ ...test("EXACT-ACK"), finish: "length" }).status).toBe("incomplete");
    expect(evaluateInstructionAdherence({
      ...test("A\nB"), contract: { kind: "required-lines", lines: ["A", "B"], maxChars: 5 },
    }).status).toBe("verified");
    const original = base(), fabric = reconcileLocalComputeFabric(original);
    const pass = await instructionAdherenceReceipt(fabric, deployment.id, live, test("EXACT-ACK"), now);
    const failed = await instructionAdherenceReceipt(fabric, deployment.id, live, test("unrelated plan"), now);
    expect(pass.status).toBe("verified");
    expect(failed.status).toBe("failed");
    const stored = recordDeploymentQualification(original, deployment.id, live, pass, now);
    const ctx = { personaId: "builtin:coder", systemContextDigest: contextHash };
    expect(check(stored, "instruction-adherence", live, ctx).available).toBe(true);
    expect(check(stored, "chat").available).toBe(false);
    expect(check(stored, "instruction-adherence", live,
      { ...ctx, personaId: "builtin:architect" }).available).toBe(false);
    const failedState = recordDeploymentQualification(stored, deployment.id, live, {
      ...failed, verifiedAt: now + 1, expiresAt: now + 86_400_000 + 1,
    }, now + 1);
    expect(assessDeploymentCapability(reconcileLocalComputeFabric(failedState),
      deployment.id, "instruction-adherence", { ...live, observedAt: now },
      ctx, now + 1).state).toBe("Qualification Failed");
  });

  it("22 does not claim streaming, completion or cancellation from one Chat receipt", () => {
    const { state } = recorded("chat");
    for (const capability of ["streaming", "terminal-completion", "cancellation"] as const)
      expect(check(state, capability).available).toBe(false);
  });

  it("23 a newer failure with the exact same millisecond timestamp revokes an earlier PASS", () => {
    const { state, receipt } = recorded();
    const failing = fixtureReceipt(reconcileLocalComputeFabric(state), "chat", {}, "failed");
    expect(failing.verifiedAt).toBe(receipt.verifiedAt);
    const next = recordDeploymentQualification(state, deployment.id, live, failing, now);
    expect(check(next, "chat")).toMatchObject({
      state: "Qualification Failed", available: false,
    });
    expect(next.fabric!.qualificationReceipts).toEqual([receipt, failing]);
  });

  it("24 changing the recognized qualification procedure/version stales the old receipt", () => {
    const { state, receipt } = recorded();
    const fabric = reconcileLocalComputeFabric(state);
    expect(check(state, "chat").state).toBe("Qualified");
    expect(assessDeploymentCapability({
      ...fabric,
      qualificationReceipts: [{ ...receipt, procedure: {
        ...receipt.procedure, version: receipt.procedure.version + 1,
      } }],
    }, deployment.id, "chat", live, {}, now).state).toBe("Qualification Stale");
    expect(assessDeploymentCapability({
      ...fabric, qualificationReceipts: [{ ...receipt, procedure: {
        id: "model-provided-claim", version: 1,
      } }],
    }, deployment.id, "chat", live, {}, now).available).toBe(false);
  });
});
