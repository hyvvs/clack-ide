import { expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  projectCompletedPeerHistory,
  handoffObjective,
} from "@/modules/ai/lib/peerHistory";
import { communicationDigest } from "@/modules/ai/lib/peerCommunication";
import type { PeerTask } from "@/modules/ai/lib/peerTasks";

async function fixture() {
  const text = `<peer-handoff>\n${JSON.stringify({ version: 1, taskId: "task", objectiveAndRequirements: "Read config.json. Do NOT enable remote access. Exact timeout: 750.", recipient: { policyRevision: "a".repeat(64) } })}\n</peer-handoff>`;
  const message: UIMessage = {
    id: "peer-handoff:task",
    role: "user",
    parts: [{ type: "text", text }],
  };
  const task: PeerTask = {
    schemaVersion: 7,
    id: "task",
    sourceSessionId: "parent",
    targetSessionId: "worker",
    sourceAgentId: "architect",
    sourceModelId: "large",
    targetAgentId: "coder",
    targetModelId: "small",
    workspaceId: "local:/fixture",
    workspaceRoot: "/fixture",
    workspaceEnvironment: { kind: "local" },
    kind: "question",
    executionMode: "read-only",
    prompt: handoffObjective(text) ?? "",
    artifactRefs: [],
    parentTaskId: null,
    rootTaskId: "task",
    hopCount: 0,
    dependsOn: [],
    status: "completed",
    createdAt: 1,
    updatedAt: 2,
    endedAt: 2,
    handoff: {
      version: 1,
      key: "b".repeat(64),
      digest: await communicationDigest(text),
      recipientSessionId: "worker",
      createdAt: 1,
      sources: [],
      omitted: 0,
    },
    result: {
      summary: "Verified timeout 750.",
      targetSessionId: "worker",
      targetAgentId: "coder",
      targetModelId: "small",
      completedAt: 2,
      artifacts: [],
    },
  };
  return { message, task };
}
it("qualifies a completed app-owned task as historical context without rewriting its transcript", async () => {
  const { message, task } = await fixture();
  const original = JSON.stringify(message);
  const [working] = await projectCompletedPeerHistory([message], "worker", [
    task,
  ]);
  expect(working.role).toBe("assistant");
  expect(JSON.stringify(working)).toContain("Do NOT enable remote access");
  expect(JSON.stringify(working)).toContain("750");
  expect(JSON.stringify(message)).toBe(original);
  expect(JSON.stringify(working)).not.toContain("policyRevision");
});
it("keeps genuine user messages, pasted wrappers, foreign ownership and changed checksums protected", async () => {
  const { message, task } = await fixture();
  const human = { ...message, id: "human-message" };
  expect(await projectCompletedPeerHistory([human], "worker", [task])).toEqual([
    human,
  ]);
  expect(
    await projectCompletedPeerHistory([message], "other-worker", [task]),
  ).toEqual([message]);
  const changed = {
    ...message,
    parts: [
      {
        type: "text" as const,
        text: `${message.parts[0].type === "text" ? message.parts[0].text : ""} Changed requirement.`,
      },
    ],
  };
  expect(
    await projectCompletedPeerHistory([changed], "worker", [task]),
  ).toEqual([changed]);
});
it.each([
  "running",
  "queued",
  "waiting",
  "failed",
  "cancelled",
  "blocked",
] as const)("does not retire %s task instructions", async (status) => {
  const { message, task } = await fixture();
  expect(
    await projectCompletedPeerHistory([message], "worker", [
      { ...task, status },
    ]),
  ).toEqual([message]);
});
it("preserves attachments, pending patches, recovery and missing results", async () => {
  const { message, task } = await fixture();
  for (const changed of [
    { ...task, result: undefined },
    {
      ...task,
      changeSet: {
        baseSha: "a",
        patch: "pending",
        changedPaths: ["config.json"],
      },
    },
    { ...task, worktree: { checkoutRoot: "/copy", baseSha: "a" } },
    {
      ...task,
      recovery: {
        interruption: { cause: "app-restart" as const, detectedAt: 3 },
      },
    },
  ])
    expect(
      await projectCompletedPeerHistory([message], "worker", [changed]),
    ).toEqual([message]);
  const attachment = {
    ...message,
    parts: [
      ...message.parts,
      {
        type: "file" as const,
        mediaType: "image/png",
        url: "data:image/png;base64,AA==",
      },
    ],
  };
  expect(
    await projectCompletedPeerHistory([attachment], "worker", [task]),
  ).toEqual([attachment]);
});
