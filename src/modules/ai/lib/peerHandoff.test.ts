import { describe, expect, it } from "vitest";
import {
  prepareHandoff,
  peerHandoffReceipt,
  peerReviewBinding,
  type HandoffInput,
  type HandoffEvidence,
} from "@/modules/ai/lib/peerHandoff";
import {
  PEER_TASK_SCHEMA_VERSION,
  normalizePeerTask,
  recoverInterruptedPeerTasks,
} from "@/modules/ai/lib/peerTasks";
import {
  measureRequest,
  resolveContextBudget,
} from "@/modules/ai/lib/contextBudget";

function handoffInput(): HandoffInput {
  return {
    task: {
      schemaVersion: PEER_TASK_SCHEMA_VERSION,
      id: "task",
      rootTaskId: "task",
      parentTaskId: null,
      sourceSessionId: "investigator",
      targetSessionId: "coder",
      sourceAgentId: "large",
      sourceModelId: "cloud",
      targetAgentId: "small",
      targetModelId: "local",
      workspaceId: "workspace",
      workspaceRoot: "/project",
      workspaceEnvironment: { kind: "local" },
      kind: "delegate",
      executionMode: "read-only",
      prompt:
        "Implement API. Requirement: preserve v1 clients. Constraint: no network. Blocker: clarify deployment.",
      artifactRefs: [],
      hopCount: 0,
      dependsOn: [],
      status: "running",
      createdAt: 1,
      updatedAt: 1,
    },
    recipient: {
      sessionId: "coder",
      agentId: "small",
      modelId: "local",
      workspaceId: "workspace",
      policyRevision: "a".repeat(64),
    },
    limits: { deployed: 4096 },
    system: "Recipient instructions",
    tools: {},
    history: [],
    evidence: [],
    notes: "",
    artifacts: [],
    configuration: {},
  };
}
function evidence(
  id: string,
  overrides: Partial<HandoffEvidence> = {},
): HandoffEvidence {
  return {
    id,
    workspaceId: "workspace",
    source: { recordId: id },
    revision: 1,
    contentHash: "b".repeat(64),
    text: "Verified test observation",
    freshness: "current",
    qualification: "verified-observation",
    required: false,
    ...overrides,
  };
}
describe("recipient-sized handoff", () => {
  it("large Investigator to small local Coder retains critical instructions and verified evidence without private history", async () => {
    const input = handoffInput();
    input.evidence = [
      evidence("test", { required: true }),
      evidence("optional", {
        text: "old background ".repeat(2500),
        freshness: "historical",
      }),
    ];
    const prepared = await prepareHandoff(input);
    expect(prepared.text).toContain(input.task.prompt);
    expect(prepared.text).toContain("Verified test observation");
    expect(prepared.text).not.toContain("old background");
    expect(prepared.receipt.omitted).toBe(1);
    expect(
      resolveContextBudget(
        input.limits,
        measureRequest({
          system: input.system,
          tools: input.tools,
          messages: [input.history, prepared.text],
        }),
      ).fits,
    ).toBe(true);
  });
  it("small source to large recipient retains more optional evidence", async () => {
    const input = handoffInput();
    input.evidence = [
      evidence("detail", { text: "useful detail ".repeat(2400) }),
    ];
    const small = await prepareHandoff(input);
    input.limits = { deployed: 128000 };
    const large = await prepareHandoff(input);
    expect(small.receipt.omitted).toBe(1);
    expect(large.receipt.omitted).toBe(0);
    expect(large.receipt.key).not.toBe(small.receipt.key);
  });
  it("does not cut required text to claim a fit", async () => {
    const input = handoffInput();
    input.task.prompt = "critical requirement ".repeat(6000);
    await expect(prepareHandoff(input)).rejects.toThrow("cannot fit");
  });
  it("deduplicates identical evidence without losing provenance", async () => {
    const input = handoffInput();
    input.evidence = [evidence("same"), evidence("same")];
    expect((await prepareHandoff(input)).receipt.sources).toEqual(["same"]);
  });
  it("rejects contradictory content under one evidence identity", async () => {
    const input = handoffInput();
    input.evidence = [
      evidence("same"),
      evidence("same", { text: "different" }),
    ];
    await expect(prepareHandoff(input)).rejects.toThrow("conflicting_evidence");
  });
  it("preserves stale, disputed and superseded qualifications", async () => {
    const input = handoffInput();
    input.evidence = [
      evidence("stale", {
        freshness: "stale",
        qualification: "disputed",
        source: { supersedes: "old", conflicts: ["other"] },
      }),
    ];
    const result = await prepareHandoff(input);
    expect(result.text).toContain('"qualification":"disputed"');
    expect(result.text).toContain('"supersedes":"old"');
  });
  it.each([
    "modelId",
    "agentId",
    "workspaceId",
    "sessionId",
  ] as const)("rejects changed recipient %s", async (field) => {
    const input = handoffInput();
    input.recipient[field] = "other";
    await expect(prepareHandoff(input)).rejects.toThrow("identity_changed");
  });
  it("rejects evidence from another workspace", async () => {
    const input = handoffInput();
    input.evidence = [evidence("foreign", { workspaceId: "other" })];
    await expect(prepareHandoff(input)).rejects.toThrow("cross_workspace");
  });
  it.each([
    "policy",
    "revision",
    "freshness",
    "task",
    "endpoint",
  ])("invalidates reuse after %s changes", async (change) => {
    const input = handoffInput();
    input.evidence = [evidence("fact")];
    const before = await prepareHandoff(input);
    if (change === "policy") input.recipient.policyRevision = "c".repeat(64);
    if (change === "revision") input.evidence[0].revision = 2;
    if (change === "freshness") input.evidence[0].freshness = "invalidated";
    if (change === "task") input.task.prompt += " additional constraint";
    if (change === "endpoint") input.configuration = { endpoint: "other" };
    expect((await prepareHandoff(input)).receipt.key).not.toBe(
      before.receipt.key,
    );
  });
  it("preserves a valid durable receipt through restart without replaying running work", async () => {
    const input = handoffInput();
    const { receipt } = await prepareHandoff(input);
    const normalized = normalizePeerTask(
      JSON.parse(JSON.stringify({ ...input.task, handoff: receipt })),
    );
    expect(normalized?.handoff).toEqual(receipt);
    if (!normalized) throw new Error("Expected a valid task");
    expect(recoverInterruptedPeerTasks([normalized])[0].status).toBe("failed");
  });
  it("rejects malformed receipts and review identities", () => {
    expect(peerHandoffReceipt.safeParse({ version: 2 }).success).toBe(false);
    expect(
      peerReviewBinding.safeParse({
        version: 1,
        files: [{ path: "x", hash: "filename" }],
        patches: [],
      }).success,
    ).toBe(false);
  });
  it("migrates H1 without inventing a delivered handoff", () => {
    const old = normalizePeerTask({ ...handoffInput().task, schemaVersion: 6 });
    expect(old?.schemaVersion).toBe(PEER_TASK_SCHEMA_VERSION);
    expect(old?.handoff).toBeUndefined();
  });
});
