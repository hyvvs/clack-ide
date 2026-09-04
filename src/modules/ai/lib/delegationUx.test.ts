import type { UIMessage } from "@ai-sdk/react";
import { describe, expect, it } from "vitest";
import type { AttachmentMessageReference } from "./attachmentMessages";
import {
  buildDelegationRequest,
  collectDelegationArtifactChoices,
  delegationCardTitle,
  delegationStatusLabel,
  delegationTargetStatus,
  eligibleDelegationTargets,
} from "./delegationUx";
import {
  PEER_TASK_SCHEMA_VERSION,
  type PeerTask,
  type PeerTaskArtifact,
} from "./peerTasks";
import type { SessionMeta } from "./sessions";

describe("delegation UX", () => {
  it("offers only configured peer chats from the same workspace", () => {
    const targets = eligibleDelegationTargets(
      [
        session("source", "local:c:/one"),
        session("busy", "local:c:/one", true, 5),
        session("idle", "local:c:/one", false, 2),
        session("elsewhere", "local:c:/two"),
        session("unconfigured", "local:c:/one", false, 1, false),
      ],
      "source",
    );

    expect(targets.map((target) => target.id)).toEqual(["idle", "busy"]);
    expect(targets).not.toContainEqual(
      expect.objectContaining({ id: "source" }),
    );
    expect(targets).not.toContainEqual(
      expect.objectContaining({ id: "elsewhere" }),
    );
    const busyTarget = targets.find((target) => target.id === "busy");
    expect(busyTarget).toBeDefined();
    if (busyTarget) {
      expect(delegationTargetStatus(busyTarget)).toBe("Running, will queue");
    }
  });

  it("submits to the selected target with only explicitly selected artifacts", () => {
    const first = reference("a", "screen.png");
    const second = reference("b", "spec.md");
    const request = buildDelegationRequest({
      sourceSessionId: "source",
      targetSessionId: "reviewer",
      kind: "review",
      executionMode: "read-only",
      prompt: "Review this exact image.",
      choices: [
        { reference: first, originLabel: "From this chat" },
        { reference: second, originLabel: "From this chat" },
      ],
      selectedContentIds: new Set([first.contentId]),
    });

    expect(request).toMatchObject({
      sourceSessionId: "source",
      targetSessionId: "reviewer",
      kind: "review",
      executionMode: "read-only",
      awaitCompletion: false,
    });
    expect(request.attachmentReferences).toEqual([first]);
    expect(request.attachmentReferences).not.toContain(second);
  });

  it("keeps context empty until the user checks an artifact", () => {
    const choice = {
      reference: reference("a", "screen.png"),
      originLabel: "From this chat",
    };
    const request = buildDelegationRequest({
      sourceSessionId: "source",
      targetSessionId: "reviewer",
      kind: "question",
      executionMode: "read-only",
      prompt: "Check this.",
      choices: [choice],
      selectedContentIds: new Set(),
    });

    expect(request.attachmentReferences).toEqual([]);
  });

  it("offers chat attachments and returned artifacts without unrelated results", () => {
    const chatReference = reference("a", "screen.png");
    const returned = artifact("b", "review.md");
    const unrelated = task({
      id: "unrelated",
      sourceSessionId: "other-a",
      targetSessionId: "other-b",
      result: resultWith(artifact("c", "private.md")),
    });
    const choices = collectDelegationArtifactChoices(
      [message(chatReference)],
      [task({ result: resultWith(returned) }), unrelated],
      "source",
    );

    expect(choices.map((choice) => choice.reference.displayName)).toEqual([
      "screen.png",
      "review.md",
    ]);
    expect(choices[1]?.originLabel).toBe("Returned by another agent");
  });

  it("uses human status and source-card language", () => {
    expect(
      delegationStatusLabel(task({ status: "running", result: undefined })),
    ).toBe("Working");
    expect(
      delegationStatusLabel(task({ status: "queued", result: undefined })),
    ).toBe("Queued");
    expect(
      delegationStatusLabel(task({ status: "waiting", result: undefined })),
    ).toBe("Waiting");
    expect(
      delegationStatusLabel(task({ status: "blocked", result: undefined })),
    ).toBe("Blocked");
    expect(delegationStatusLabel(task())).toBe("Review complete");
    expect(delegationCardTitle(task(), true, "Coder", "Reviewer")).toBe(
      "Review complete",
    );
    expect(
      delegationCardTitle(
        task({ status: "running", result: undefined }),
        true,
        "Coder",
        "Reviewer",
      ),
    ).toBe("Reviewer is working");
  });

  it("makes target provenance explicit", () => {
    expect(delegationCardTitle(task(), false, "Coder", "Reviewer")).toBe(
      "Delegated by Coder",
    );
  });
});

function session(
  id: string,
  workspaceId: string,
  busy = false,
  updatedAt = 1,
  configured = true,
): SessionMeta {
  return {
    id,
    title: `${id} chat`,
    createdAt: 1,
    updatedAt,
    profile: {
      agentId: configured ? `agent-${id}` : null,
      modelId: configured ? `model-${id}` : null,
      workspaceId,
      workspaceRoot: workspaceId.replace(/^local:/, ""),
    },
    ...(busy ? { run: { state: "running", startedAt: 1 } } : {}),
  };
}

function reference(
  seed: string,
  displayName: string,
): AttachmentMessageReference {
  const contentId = seed.repeat(64);
  return {
    attachmentId: `attachment-${seed}`,
    contentId,
    contentHash: contentId,
    displayName,
    mediaType: displayName.endsWith(".png") ? "image/png" : "text/markdown",
    byteSize: 12,
    contentKind: displayName.endsWith(".png") ? "image" : "text",
  };
}

function message(referenceValue: AttachmentMessageReference): UIMessage {
  return {
    id: "message-1",
    role: "user",
    parts: [{ type: "data-clack-attachment", data: referenceValue }],
  } as UIMessage;
}

function artifact(seed: string, displayName: string): PeerTaskArtifact {
  const contentId = seed.repeat(64);
  return {
    id: `artifact-${seed}`,
    attachmentId: `attachment-${seed}`,
    contentRef: { id: contentId, contentHash: contentId, byteSize: 12 },
    displayName,
    mediaType: "text/markdown",
    contentKind: "text",
    byteSize: 12,
    sourceSessionId: "target",
    sourceTaskId: "task",
    sourceAgentId: "reviewer",
    sourceModelId: "model",
    workspaceId: "local:c:/workspace",
    workspaceRoot: "C:/workspace",
    createdAt: 2,
    originType: "generated-file",
    accessPolicy: "model-input",
  };
}

function resultWith(artifactValue: PeerTaskArtifact) {
  return {
    summary: "Done",
    targetSessionId: "target",
    targetAgentId: "reviewer",
    targetModelId: "model",
    completedAt: 2,
    artifacts: [artifactValue],
  };
}

function task(overrides: Partial<PeerTask> = {}): PeerTask {
  return {
    schemaVersion: PEER_TASK_SCHEMA_VERSION,
    id: "task",
    sourceSessionId: "source",
    targetSessionId: "target",
    sourceAgentId: "coder",
    sourceModelId: "model-a",
    targetAgentId: "reviewer",
    targetModelId: "model-b",
    workspaceId: "local:c:/workspace",
    workspaceRoot: "C:/workspace",
    workspaceEnvironment: { kind: "local" },
    kind: "review",
    executionMode: "read-only",
    prompt: "Review this change.",
    artifactRefs: [],
    parentTaskId: null,
    rootTaskId: "task",
    hopCount: 0,
    dependsOn: [],
    status: "completed",
    createdAt: 1,
    updatedAt: 2,
    result: {
      summary: "Looks good.",
      targetSessionId: "target",
      targetAgentId: "reviewer",
      targetModelId: "model-b",
      completedAt: 2,
      artifacts: [],
    },
    ...overrides,
  };
}
