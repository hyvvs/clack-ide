import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonSchema, tool } from "ai";
import {
  prepareHandoff,
  type HandoffInput,
  type HandoffEvidence,
} from "@/modules/ai/lib/peerHandoff";
import {
  preparePeerCommunication,
  transitionPeerEvent,
  reconcilePeerCommunication,
  routePeerCommunication,
  PEER_QUESTION_LIFETIME,
} from "@/modules/ai/lib/peerCommunication";
import {
  PEER_TASK_SCHEMA_VERSION,
  recoverInterruptedPeerTasks,
  type PeerTask,
} from "@/modules/ai/lib/peerTasks";
import { reconcilePeerTaskDependencies } from "@/modules/ai/lib/peerTaskDependencies";
import {
  capturePeerReview,
  validatePeerReview,
} from "@/modules/ai/lib/peerReview";
import { native } from "@/modules/ai/lib/native";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  prepareToolExposure,
  clearExposureCache,
} from "@/modules/ai/lib/toolExposure";
import {
  measureRequest,
  resolveContextBudget,
} from "@/modules/ai/lib/contextBudget";
import type { ToolContext } from "@/modules/ai/tools/context";
import {
  corpus,
  digest,
  assertPrivateAbsent,
  recordMetrics,
} from "@/modules/ai/quality/oracle";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));
const preferences = usePreferencesStore.getState();
beforeEach(() => {
  vi.useFakeTimers({ now: 1420, toFake: ["Date"] });
  clearExposureCache();
  let sequence = 0;
  vi.spyOn(crypto, "randomUUID").mockImplementation(
    () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  );
  usePreferencesStore.setState({
    agentPermissionProfiles: {
      investigator: { mode: "full-access", categories: {} },
      coder: { mode: "full-access", categories: {} },
      reviewer: { mode: "full-access", categories: {} },
    },
    agentWorkspacePermissions: [],
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  usePreferencesStore.setState(preferences);
});
function task(
  id: string,
  target: string,
  overrides: Partial<PeerTask> = {},
): PeerTask {
  return {
    schemaVersion: PEER_TASK_SCHEMA_VERSION,
    id,
    rootTaskId: "investigate",
    parentTaskId: null,
    sourceSessionId: "owner-chat",
    sourceAgentId: "owner",
    sourceModelId: "cloud",
    targetSessionId: `${target}-chat`,
    targetAgentId: target,
    targetModelId: target === "coder" ? "small" : "cloud",
    workspaceId: corpus.workspaceId,
    workspaceRoot: "/workspace-a",
    workspaceEnvironment: { kind: "local" },
    kind: "delegate",
    executionMode: "read-only",
    prompt: "Preserve API v1. No network. Correct the timeout.",
    artifactRefs: [],
    dependsOn: [],
    hopCount: 0,
    status: "running",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}
function evidence(id: string, text: string, required = true): HandoffEvidence {
  return {
    id,
    text,
    workspaceId: corpus.workspaceId,
    source: { taskId: "investigate" },
    revision: 1,
    contentHash: digest(text),
    freshness: "current",
    qualification: "verified-observation",
    required,
  };
}
function input(t: PeerTask, sources: HandoffEvidence[]): HandoffInput {
  return {
    task: t,
    recipient: {
      sessionId: t.targetSessionId,
      agentId: t.targetAgentId,
      modelId: t.targetModelId,
      workspaceId: t.workspaceId,
      policyRevision: "a".repeat(64),
    },
    limits: { deployed: 4096 },
    system: "Authorized recipient only",
    tools: [],
    history: [],
    evidence: sources,
    artifacts: [],
    notes: "",
    configuration: { context: 4096 },
  };
}
describe("Q1 bounded collaboration trace", () => {
  it("E/H: investigation -> implementation -> review -> correction preserves identities and rejects stale apply evidence", async () => {
    const finding = evidence(
      "investigation-result",
      corpus.adversarial.correction,
    );
    const investigator = task("investigate", "investigator", {
      status: "completed",
      result: {
        summary: finding.text,
        targetSessionId: "investigator-chat",
        targetAgentId: "investigator",
        targetModelId: "cloud",
        completedAt: 2,
        artifacts: [],
      },
    });
    let coder = task("implement", "coder", {
      parentTaskId: investigator.id,
      sourceSessionId: investigator.targetSessionId,
      sourceAgentId: investigator.targetAgentId,
      sourceModelId: investigator.targetModelId,
      dependsOn: [investigator.id],
      status: "waiting",
    });
    coder = reconcilePeerTaskDependencies([investigator, coder], 3)[1];
    expect(coder.status).toBe("queued");
    const handoff = await prepareHandoff(input(coder, [finding]));
    expect(handoff.text).toContain(finding.text);
    expect(handoff.text).toContain(coder.prompt);
    expect(handoff.receipt.sources).toEqual([finding.id]);
    assertPrivateAbsent(handoff);
    coder = {
      ...coder,
      status: "completed",
      changeSet: {
        baseSha: "fixture-base",
        changedPaths: ["src/api.ts"],
        patch: "-timeout = 900\n+timeout = 750",
      },
    };
    const reviewer = task("review", "reviewer", {
      parentTaskId: coder.id,
      sourceSessionId: coder.targetSessionId,
      sourceAgentId: coder.targetAgentId,
      sourceModelId: coder.targetModelId,
      dependsOn: [coder.id],
      kind: "review",
    });
    vi.spyOn(native, "canonicalize").mockImplementation(async (path) => path);
    vi.spyOn(native, "readFile").mockResolvedValue({
      kind: "text",
      content: "timeout = 750",
      size: 13,
    });
    const review = await capturePeerReview(reviewer, [
      investigator,
      coder,
      reviewer,
    ]);
    await validatePeerReview({ ...reviewer, review }, [
      investigator,
      coder,
      reviewer,
    ]);
    const actor = {
      sessionId: reviewer.targetSessionId,
      agentId: reviewer.targetAgentId,
      modelId: reviewer.targetModelId,
      policyRevision: "a".repeat(64),
      runStartedAt: 4,
      toolCallId: "review-defect",
    };
    const coderIdentity = {
      sessionId: coder.targetSessionId,
      agentId: coder.targetAgentId,
      modelId: coder.targetModelId,
      policyRevision: "a".repeat(64),
    };
    const reviewerIdentity = {
      sessionId: actor.sessionId,
      agentId: actor.agentId,
      modelId: actor.modelId,
      policyRevision: actor.policyRevision,
    };
    const requested = await preparePeerCommunication(
      [investigator, coder, reviewer],
      {
        taskId: reviewer.id,
        kind: "review-request",
        text: "Review the timeout boundary.",
        evidence: [],
      },
      { ...coderIdentity, runStartedAt: 4, toolCallId: "request-review" },
      reviewerIdentity,
      4,
    );
    const deliveredReview = transitionPeerEvent(
      { ...reviewer, communication: [requested] },
      requested.id,
      "delivered",
      4,
    );
    const acknowledgedReview = transitionPeerEvent(
      deliveredReview,
      requested.id,
      "acknowledged",
      4,
    );
    const correction = await preparePeerCommunication(
      [investigator, coder, acknowledgedReview],
      {
        taskId: reviewer.id,
        kind: "review-response",
        replyTo: requested.id,
        text: "Defect: use timeout >= 750, not > 750.",
        evidence: [],
      },
      actor,
      coderIdentity,
      5,
    );
    expect(correction.recipient.sessionId).toBe("coder-chat");
    expect(correction.rootTaskId).toBe("investigate");
    if (!coder.changeSet) throw new Error("Missing fixture change set");
    const corrected = {
      ...coder,
      changeSet: { ...coder.changeSet, patch: "+timeout >= 750" },
    };
    await expect(
      validatePeerReview({ ...reviewer, review }, [
        investigator,
        corrected,
        reviewer,
      ]),
    ).rejects.toThrow("stale");
    const newReview = await capturePeerReview(reviewer, [
      investigator,
      corrected,
      reviewer,
    ]);
    await validatePeerReview({ ...reviewer, review: newReview }, [
      investigator,
      corrected,
      reviewer,
    ]);
    expect(newReview.patches[0].hash).not.toBe(review.patches[0].hash);
    assertPrivateAbsent([correction, newReview]);
    const unrelated = task("unrelated", "other", {
      rootTaskId: "other-root",
      status: "queued",
    });
    const blocked = reconcilePeerTaskDependencies(
      [
        { ...investigator, status: "failed" },
        { ...coder, status: "waiting" },
        unrelated,
      ],
      6,
    );
    expect(blocked[1].status).toBe("blocked");
    expect(blocked[2].status).toBe("queued");
    recordMetrics("E", {
      status: "passed",
      taskCompletion: { completedStages: 4, requiredStages: 4 },
      sourceAccuracy: { valid: handoff.receipt.sources.length, total: 1 },
      handoffUsefulness: {
        requiredEvidenceIncluded: 1,
        totalRequiredEvidence: 1,
      },
      unauthorizedDeliveries: 0,
      contextTokens: measureRequest({ messages: [handoff.text] }).conversation,
      model: "cloud investigator / small coder / cloud reviewer fixtures",
      preparationCalls: 1,
      sourceCoverage: [finding.id],
    });
  });
  it("F/K: constrained handoff uses F1 schemas without irrelevant or denied context", async () => {
    const t = task("implement", "coder");
    const context = {
      getSessionId: () => t.targetSessionId,
      getAgentId: () => t.targetAgentId,
      getWorkspaceId: () => t.workspaceId,
      getWorkspaceRoot: () => t.workspaceRoot,
      getCwd: () => t.workspaceRoot,
      getRunId: () => 1,
    } as unknown as ToolContext;
    const tools = Object.fromEntries(
      ["read_file", "list_directory", "unrelated_weather"].map((name) => [
        name,
        tool({
          description: name === "read_file" ? "Read API code file" : name,
          inputSchema: jsonSchema({
            type: "object",
            properties: { path: { type: "string" } },
          }),
          execute: async () => "fixture",
        }),
      ]),
    );
    const exposure = await prepareToolExposure(tools, {
      context,
      target: "small",
      limits: { deployed: 4096 },
      messages: [{ role: "user", content: "Read API code file" }],
      mandatory: ["read_file"],
    });
    const required = evidence("verified", corpus.adversarial.correction);
    const irrelevant = evidence(
      "background",
      "irrelevant background ".repeat(3000),
      false,
    );
    const request = input(t, [required, irrelevant]);
    request.tools = exposure.schemas;
    const handoff = await prepareHandoff(request);
    expect(handoff.text).toContain(required.text);
    expect(handoff.text).not.toContain("irrelevant background");
    expect(handoff.receipt.omitted).toBe(1);
    expect(exposure.names).toContain("read_file");
    expect(
      resolveContextBudget(
        request.limits,
        measureRequest({
          system: request.system,
          messages: [handoff.text],
          tools: exposure.schemas,
        }),
      ).fits,
    ).toBe(true);
    assertPrivateAbsent(handoff);
    assertPrivateAbsent(exposure.schemas);
    await expect(
      prepareHandoff(
        input(t, [
          {
            ...required,
            workspaceId: "local:/workspace-b",
            text: corpus.canaries[1],
          },
        ]),
      ),
    ).rejects.toThrow("cross_workspace");
    await expect(
      prepareHandoff(
        input(t, [evidence("huge", "mandatory evidence ".repeat(20000))]),
      ),
    ).rejects.toThrow("cannot fit");
    recordMetrics("F", {
      status: "passed",
      missionRetained: true,
      requiredEvidenceIncluded: 1,
      optionalEvidenceOmitted: handoff.receipt.omitted,
      sourceCoverage: handoff.receipt.sources,
      contextTokens: measureRequest({ messages: [handoff.text] }).conversation,
      schemaCost: exposure.metrics,
      unauthorizedDeliveries: 0,
      model: "4096-token recipient fixture",
    });
  });
  it("G/L: exact clarification receipt, expiration and restart do not replay work", async () => {
    const t = task("implement", "coder");
    const recipient = {
      sessionId: t.sourceSessionId,
      agentId: t.sourceAgentId,
      modelId: t.sourceModelId,
      policyRevision: "a".repeat(64),
    };
    const actor = {
      sessionId: t.targetSessionId,
      agentId: t.targetAgentId,
      modelId: t.targetModelId,
      policyRevision: "a".repeat(64),
      runStartedAt: 4,
      toolCallId: "clarify",
    };
    const question = await preparePeerCommunication(
      [t],
      {
        taskId: t.id,
        kind: "clarification-request",
        text: "Does API v1 need timeout 750 ms?",
        evidence: [],
      },
      actor,
      recipient,
      10,
    );
    const delivered = transitionPeerEvent(
      { ...t, communication: [question] },
      question.id,
      "delivered",
      11,
    );
    const received = transitionPeerEvent(
      delivered,
      question.id,
      "acknowledged",
      12,
    );
    expect(
      transitionPeerEvent(received, question.id, "acknowledged", 12),
    ).toEqual(received);
    const restored = recoverInterruptedPeerTasks(
      JSON.parse(JSON.stringify([received])),
    );
    expect(restored[0].status).toBe("failed");
    expect(restored[0].communication?.[0].state).toBe("blocked");
    const expired = reconcilePeerCommunication(
      [{ ...t, communication: [question] }],
      10 + PEER_QUESTION_LIFETIME,
    );
    expect(expired[0].communication?.[0].state).toBe("blocked");
    expect(() =>
      routePeerCommunication(
        [t],
        { taskId: t.id, kind: "note", text: "private", evidence: [] },
        { ...actor, agentId: "unrelated" },
      ),
    ).toThrow("sender_denied");
    assertPrivateAbsent(restored);
    recordMetrics("L", {
      status: "passed",
      resumedDeadRuns: 0,
      approvalReplays: 0,
      sourceCoverage: [question.id],
      model: "deterministic task state, no inference",
    });
  });
});
