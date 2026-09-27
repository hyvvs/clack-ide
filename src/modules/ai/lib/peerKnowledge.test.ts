import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/modules/ai/lib/projectMemory", () => ({
  projectMemoryClient: vi.fn(),
}));
vi.mock("@/modules/ai/lib/peerCommunicationCoordinator", () => ({
  peerEndpoint: vi.fn().mockResolvedValue({
    sessionId: "source",
    agentId: "coder",
    policyRevision: "policy",
  }),
}));
vi.mock("@/modules/ai/lib/peerReview", () => ({
  validatePeerReview: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/modules/ai/store/peerTaskStore", async (original) => ({
  ...(await original<typeof import("@/modules/ai/store/peerTaskStore")>()),
  flushPeerTasks: vi.fn().mockResolvedValue(undefined),
}));
import { promotePeerFinding } from "@/modules/ai/lib/peerKnowledge";
import { projectMemoryClient } from "@/modules/ai/lib/projectMemory";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePeerTaskStore } from "@/modules/ai/store/peerTaskStore";
import {
  PEER_TASK_SCHEMA_VERSION,
  type PeerTask,
} from "@/modules/ai/lib/peerTasks";
import { validatePeerReview } from "@/modules/ai/lib/peerReview";
const task: PeerTask = {
  schemaVersion: PEER_TASK_SCHEMA_VERSION,
  id: "task",
  sourceSessionId: "source",
  targetSessionId: "target",
  status: "completed",
  workspaceId: "workspace",
  sourceAgentId: "source-agent",
  sourceModelId: "cloud",
  targetAgentId: "target-agent",
  targetModelId: "local",
  workspaceRoot: "/project",
  workspaceEnvironment: { kind: "local" },
  kind: "delegate",
  executionMode: "read-only",
  prompt: "Check API",
  artifactRefs: [],
  parentTaskId: null,
  rootTaskId: "task",
  hopCount: 0,
  dependsOn: [],
  createdAt: 1,
  updatedAt: 1,
  result: {
    summary: "API preserves v1",
    artifacts: [],
    targetSessionId: "target",
    targetAgentId: "target-agent",
    targetModelId: "local",
    completedAt: 2,
  },
};
const entry = {
  id: "entry",
  sourceSessionId: "source",
  locator: { kind: "taskResult", taskId: "task" },
  text: "API preserves v1",
  status: "pending",
};
const client = {
  load: vi.fn(),
  propose: vi.fn(),
  decide: vi.fn(),
  verify: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  usePeerTaskStore.setState({ tasks: [task], recoveryReady: true });
  useChatStore.setState({
    sessions: [
      {
        id: "source",
        title: "Source",
        createdAt: 1,
        updatedAt: 1,
        profile: {
          workspaceId: "workspace",
          workspaceRoot: "/project",
          agentId: "coder",
          modelId: "model",
        },
      },
    ],
  });
  client.load.mockResolvedValue({ revision: 1, entries: [entry] });
  client.decide.mockResolvedValue(undefined);
  client.verify.mockResolvedValue(undefined);
  vi.mocked(validatePeerReview).mockResolvedValue(undefined);
  vi.mocked(projectMemoryClient).mockReturnValue(
    client as unknown as ReturnType<typeof projectMemoryClient>,
  );
});
it("uses existing native consent and verification without asserting automatic truth", async () => {
  await expect(
    promotePeerFinding("source", "task", entry.text, ["api.ts"]),
  ).resolves.toMatchObject({ status: "user-validated" });
  expect(client.decide).toHaveBeenCalledWith(expect.anything(), "entry", {
    kind: "approve",
  });
  expect(client.verify).toHaveBeenCalledWith(
    expect.anything(),
    "entry",
    "api.ts",
    "",
    [],
  );
  expect(client.propose).not.toHaveBeenCalled();
});
it("declined sharing does not verify or silently retry", async () => {
  client.decide.mockRejectedValue(new Error("project_user_consent_required"));
  await expect(
    promotePeerFinding("source", "task", entry.text, ["api.ts"]),
  ).rejects.toThrow("consent");
  expect(client.verify).not.toHaveBeenCalled();
});
it("unrelated conversation cannot promote another task", async () => {
  await expect(
    promotePeerFinding("unrelated", "task", entry.text, ["api.ts"]),
  ).rejects.toThrow("denied");
  expect(client.decide).not.toHaveBeenCalled();
});
it("invalidated review cannot become verified project knowledge", async () => {
  vi.mocked(validatePeerReview).mockRejectedValue(new Error("review stale"));
  await expect(
    promotePeerFinding("source", "task", entry.text, ["api.ts"]),
  ).rejects.toThrow("stale");
  expect(client.decide).not.toHaveBeenCalled();
});
