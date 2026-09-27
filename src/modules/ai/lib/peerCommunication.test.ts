import { describe, expect, it } from "vitest";
import {
  PEER_TASK_SCHEMA_VERSION,
  normalizePeerTask,
  recoverInterruptedPeerTasks,
  type PeerTask,
} from "@/modules/ai/lib/peerTasks";
import {
  communicationDigest,
  communicationPayload,
  formatPeerCommunication,
  parsePeerCommunication,
  pendingPeerQuestion,
  preparePeerCommunication,
  reconcilePeerCommunication,
  routePeerCommunication,
  transitionPeerEvent,
  PEER_QUESTION_LIFETIME,
  type PeerCommunicationActor,
  type PeerCommunicationInput,
} from "@/modules/ai/lib/peerCommunication";

const policyRevision = "a".repeat(64);
const source = {
  sessionId: "source",
  agentId: "agent-a",
  modelId: "model-a",
  policyRevision,
};
const target = {
  sessionId: "target",
  agentId: "agent-b",
  modelId: "model-b",
  policyRevision,
};
const actor: PeerCommunicationActor = {
  ...target,
  runStartedAt: 1,
  toolCallId: "call-1",
};
const input: PeerCommunicationInput = {
  taskId: "task",
  kind: "clarification-request",
  text: "Which API version?",
  evidence: [],
};
function task(overrides: Partial<PeerTask> = {}): PeerTask {
  return {
    schemaVersion: PEER_TASK_SCHEMA_VERSION,
    id: "task",
    sourceSessionId: "source",
    targetSessionId: "target",
    sourceAgentId: "agent-a",
    sourceModelId: "model-a",
    targetAgentId: "agent-b",
    targetModelId: "model-b",
    workspaceId: "local:c:/workspace",
    workspaceRoot: "C:/workspace",
    workspaceEnvironment: { kind: "local" },
    kind: "delegate",
    executionMode: "read-only",
    prompt: "Implement the API",
    artifactRefs: [],
    parentTaskId: null,
    rootTaskId: "task",
    hopCount: 0,
    dependsOn: [],
    status: "running",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}
async function question() {
  const event = await preparePeerCommunication(
    [task()],
    input,
    actor,
    source,
    10,
  );
  return task({ communication: [event] });
}

describe("task-scoped routes", () => {
  it("routes child to its source and source to the assigned child", () => {
    expect(routePeerCommunication([task()], input, actor).sessionId).toBe(
      "source",
    );
    expect(
      routePeerCommunication(
        [task()],
        { ...input, kind: "note" },
        { ...actor, ...source },
      ).sessionId,
    ).toBe("target");
  });
  it("allows explicit parent/child target edges and dependency producer to consumer", () => {
    const child = task({
      id: "child",
      parentTaskId: "task",
      targetSessionId: "child-chat",
    });
    const dependent = task({
      id: "dependent",
      dependsOn: ["task"],
      targetSessionId: "dependent-chat",
    });
    expect(
      routePeerCommunication(
        [task(), child],
        { ...input, kind: "finding", recipientTaskId: "child" },
        actor,
      ).sessionId,
    ).toBe("child-chat");
    expect(
      routePeerCommunication(
        [task(), dependent],
        { ...input, kind: "dependency-update", recipientTaskId: "dependent" },
        actor,
      ).sessionId,
    ).toBe("dependent-chat");
    expect(
      routePeerCommunication(
        [task(), child],
        { ...input, taskId: "child", recipientTaskId: "task", kind: "blocker" },
        { ...actor, sessionId: "child-chat" },
      ).sessionId,
    ).toBe("target");
  });
  it("rejects unrelated tasks in the same root", () => {
    expect(() =>
      routePeerCommunication(
        [task(), task({ id: "other", targetSessionId: "other" })],
        { ...input, recipientTaskId: "other", kind: "note" },
        actor,
      ),
    ).toThrow("route_denied");
  });
  it.each([
    "sessionId",
    "agentId",
    "modelId",
  ] as const)("rejects spoofed sender %s", (key) => {
    expect(() =>
      routePeerCommunication([task()], input, { ...actor, [key]: "spoofed" }),
    ).toThrow("sender_denied");
  });
  it.each([
    "workspaceId",
    "rootTaskId",
  ] as const)("rejects mismatched %s", (key) => {
    expect(() =>
      routePeerCommunication(
        [task(), task({ id: "child", parentTaskId: "task", [key]: "other" })],
        { ...input, recipientTaskId: "child" },
        actor,
      ),
    ).toThrow("workspace_denied");
  });
  it("rejects clarification to arbitrary descendants", () => {
    expect(() =>
      routePeerCommunication(
        [
          task(),
          task({ id: "child", parentTaskId: "task", targetSessionId: "child" }),
        ],
        { ...input, recipientTaskId: "child" },
        actor,
      ),
    ).toThrow("clarification_route_denied");
  });
  it("rejects missing evidence instead of fabricating links", async () => {
    await expect(
      preparePeerCommunication(
        [task()],
        {
          ...input,
          evidence: [
            {
              taskId: "task",
              artifactId: "missing",
              contentHash: policyRevision,
            },
          ],
        },
        actor,
        source,
      ),
    ).rejects.toThrow("evidence_missing");
  });
});

describe("bounded durable events", () => {
  it("round trips schema, identity, sequence and payload digest", async () => {
    const record = await question();
    const restored = required(
      normalizePeerTask(JSON.parse(JSON.stringify(record))),
    );
    expect(restored).toEqual(record);
    const event = required(restored.communication?.[0]);
    expect(event.digest).toBe(
      await communicationDigest(communicationPayload(event)),
    );
    expect(event).toMatchObject({
      sequence: 1,
      state: "queued",
      runStartedAt: 1,
      deadline: 10 + PEER_QUESTION_LIFETIME,
    });
  });
  it("deduplicates an identical tool call without another round", async () => {
    const record = await question();
    expect(
      await preparePeerCommunication([record], input, actor, source, 11),
    ).toEqual(record.communication?.[0]);
    await expect(
      preparePeerCommunication(
        [record],
        { ...input, text: "Different" },
        actor,
        source,
      ),
    ).rejects.toThrow("identity_conflict");
  });
  it("allows only one outstanding question", async () => {
    await expect(
      preparePeerCommunication(
        [await question()],
        input,
        { ...actor, toolCallId: "second" },
        source,
        11,
      ),
    ).rejects.toThrow("outstanding");
  });
  it("requires receipt before answer and links response to exact question", async () => {
    let record = await question();
    const id = required(record.communication?.[0]).id;
    const answer = {
      ...input,
      kind: "clarification-response" as const,
      text: "v2",
      replyTo: id,
    };
    await expect(
      preparePeerCommunication(
        [record],
        answer,
        { ...actor, ...source },
        target,
        11,
      ),
    ).rejects.toThrow("reply_stale");
    record = transitionPeerEvent(record, id, "delivered", 12);
    record = transitionPeerEvent(record, id, "acknowledged", 13);
    const response = await preparePeerCommunication(
      [record],
      answer,
      { ...actor, ...source },
      target,
      14,
    );
    expect(response).toMatchObject({ sequence: 2, replyTo: id, text: "v2" });
    record = transitionPeerEvent(record, id, "answered", 15);
    expect(pendingPeerQuestion(record)).toBeUndefined();
  });
  it("makes receipts idempotent but rejects out-of-order transitions", async () => {
    const record = await question();
    const id = required(record.communication?.[0]).id;
    expect(() => transitionPeerEvent(record, id, "acknowledged")).toThrow(
      "transition_stale",
    );
    const delivered = transitionPeerEvent(record, id, "delivered");
    expect(transitionPeerEvent(delivered, id, "delivered")).toBe(delivered);
  });
  it("blocks expired questions at the persisted deadline", async () => {
    const record = await question();
    expect(
      reconcilePeerCommunication([record], 10 + PEER_QUESTION_LIFETIME)[0],
    ).toMatchObject({
      status: "blocked",
      communication: [{ state: "blocked" }],
    });
  });
  it("does not replay pending or acknowledged work on restart", async () => {
    const record = await question();
    for (const state of ["queued", "acknowledged"] as const) {
      const pending = {
        ...record,
        communication: [{ ...required(record.communication?.[0]), state }],
      };
      const recovered = recoverInterruptedPeerTasks([pending], 20);
      expect(recovered[0]).toMatchObject({
        status: "failed",
        communication: [{ state: "blocked" }],
      });
      expect(recoverInterruptedPeerTasks(recovered, 30)).toEqual(recovered);
    }
  });
  it("cancellation terminalizes pending messages and rejects late responses", async () => {
    const record = await question();
    const cancelled = reconcilePeerCommunication([
      { ...record, status: "cancelled" },
    ])[0];
    expect(required(cancelled.communication?.[0]).state).toBe("cancelled");
    await expect(
      preparePeerCommunication([cancelled], input, actor, source),
    ).rejects.toThrow("inactive");
  });
  it("enforces two rounds per task and four per root", async () => {
    const record = await question();
    const original = required(record.communication?.[0]);
    const done = { ...original, state: "answered" as const };
    const two = task({
      communication: [done, { ...done, id: "q2", text: "Other", sequence: 2 }],
    });
    await expect(
      preparePeerCommunication(
        [two],
        { ...input, text: "Third" },
        { ...actor, toolCallId: "third" },
        source,
      ),
    ).rejects.toThrow("round_limit");
    const root = [two, task({ id: "other", communication: two.communication })];
    await expect(
      preparePeerCommunication(
        [...root, task({ id: "fresh" })],
        { ...input, taskId: "fresh" },
        { ...actor, toolCallId: "fresh" },
        source,
      ),
    ).rejects.toThrow("round_limit");
  });
  it("blocks repeated question text even with a new tool identity", async () => {
    const record = await question();
    required(record.communication?.[0]).state = "answered";
    await expect(
      preparePeerCommunication(
        [record],
        input,
        { ...actor, toolCallId: "new" },
        source,
      ),
    ).rejects.toThrow("no_progress");
  });
  it("rejects oversized UTF-8, malformed metadata and duplicate IDs", async () => {
    await expect(
      preparePeerCommunication(
        [task()],
        { ...input, text: "\u20ac".repeat(1500) },
        actor,
        source,
      ),
    ).rejects.toThrow("payload_invalid");
    expect(() => parsePeerCommunication([{ malformed: true }])).toThrow();
    const record = await question();
    expect(() =>
      parsePeerCommunication([
        record.communication?.[0],
        record.communication?.[0],
      ]),
    ).toThrow();
  });
  it("transfers an explicit payload, not the task prompt or a transcript", async () => {
    const record = await question();
    const wire = formatPeerCommunication(required(record.communication?.[0]));
    expect(wire).toContain("Which API version?");
    expect(wire).not.toContain("Implement the API");
    expect(wire).not.toContain("messages");
  });
  it("keeps independent roots unaffected by deadline or cancellation", async () => {
    const record = await question();
    const independent = task({ id: "independent", rootTaskId: "independent" });
    expect(
      reconcilePeerCommunication(
        [record, independent],
        10 + PEER_QUESTION_LIFETIME,
      )[1],
    ).toBe(independent);
  });
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Missing test fixture value.");
  return value;
}
