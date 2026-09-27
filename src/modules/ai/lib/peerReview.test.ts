import { beforeEach, expect, it, vi } from "vitest";
import {
  capturePeerReview,
  validatePeerReview,
  validatePeerApplyReview,
} from "@/modules/ai/lib/peerReview";
import { native } from "@/modules/ai/lib/native";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { usePeerTaskStore } from "@/modules/ai/store/peerTaskStore";
import {
  PEER_TASK_SCHEMA_VERSION,
  type PeerTask,
} from "@/modules/ai/lib/peerTasks";
const coder: PeerTask = {
  schemaVersion: PEER_TASK_SCHEMA_VERSION,
  id: "coder",
  sourceSessionId: "owner",
  targetSessionId: "coder-chat",
  sourceAgentId: "owner",
  sourceModelId: "cloud",
  targetAgentId: "coder",
  targetModelId: "cloud",
  workspaceId: "local:c:/project",
  workspaceRoot: "C:/project",
  workspaceEnvironment: { kind: "local" },
  kind: "delegate",
  executionMode: "isolated-worktree",
  prompt: "Implement API",
  artifactRefs: [],
  parentTaskId: null,
  rootTaskId: "coder",
  hopCount: 0,
  dependsOn: [],
  status: "completed",
  createdAt: 1,
  updatedAt: 1,
  changeSet: {
    baseSha: "base",
    patch: "diff api.ts",
    changedPaths: ["api.ts"],
  },
};
const reviewer: PeerTask = {
  ...coder,
  id: "reviewer",
  targetSessionId: "reviewer-chat",
  targetAgentId: "reviewer",
  targetModelId: "local",
  kind: "review",
  executionMode: "read-only",
  parentTaskId: "coder",
  dependsOn: ["coder"],
  changeSet: undefined,
  createdAt: 2,
};
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(native, "canonicalize").mockImplementation(async (path) => path);
  vi.spyOn(native, "readFile").mockResolvedValue({
    kind: "text",
    content: "original",
    size: 8,
  });
  usePreferencesStore.setState({
    agentPermissionProfiles: {
      reviewer: { mode: "full-access", categories: {} },
    },
    agentWorkspacePermissions: [],
  });
  usePeerTaskStore.setState({ tasks: [coder, reviewer] });
});
it("binds review to exact file observation and immutable patch", async () => {
  const review = await capturePeerReview(reviewer, [coder, reviewer]);
  expect(review.files[0]).toMatchObject({
    path: "api.ts",
    hash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(review.patches[0].taskId).toBe("coder");
  await expect(
    validatePeerReview({ ...reviewer, review }, [coder, reviewer]),
  ).resolves.toBeUndefined();
});
it("changed file invalidates findings and apply eligibility", async () => {
  const review = await capturePeerReview(reviewer, [coder, reviewer]);
  usePeerTaskStore.setState({ tasks: [coder, { ...reviewer, review }] });
  vi.mocked(native.readFile).mockResolvedValue({
    kind: "text",
    content: "changed",
    size: 7,
  });
  await expect(validatePeerApplyReview(coder)).rejects.toThrow(
    "peer_review_stale",
  );
});
it("changed patch invalidates review even if file is unchanged", async () => {
  const review = await capturePeerReview(reviewer, [coder, reviewer]);
  await expect(
    validatePeerReview({ ...reviewer, review }, [
      {
        ...coder,
        changeSet: {
          baseSha: "base",
          changedPaths: ["api.ts"],
          patch: "new patch",
        },
      },
      reviewer,
    ]),
  ).rejects.toThrow("stale");
});
it("failed or pending requested review prevents apply", async () => {
  usePeerTaskStore.setState({
    tasks: [coder, { ...reviewer, status: "failed" }],
  });
  await expect(validatePeerApplyReview(coder)).rejects.toThrow("incomplete");
});
it("a new completed review supersedes older stale apply gating", async () => {
  const review = await capturePeerReview(reviewer, [coder, reviewer]);
  usePeerTaskStore.setState({
    tasks: [
      coder,
      { ...reviewer, status: "failed" },
      { ...reviewer, id: "new-review", createdAt: 3, review },
    ],
  });
  await expect(validatePeerApplyReview(coder)).resolves.toBeUndefined();
});
it.each([
  "secret",
  "symlink",
  "permission",
  "missing",
  "binary",
  "oversized",
])("refuses %s evidence rather than asserting freshness", async (mode) => {
  let reviewed = coder;
  if (mode === "secret")
    reviewed = {
      ...coder,
      changeSet: {
        baseSha: "base",
        patch: "diff api.ts",
        changedPaths: [".env"],
      },
    };
  if (mode === "symlink")
    vi.mocked(native.canonicalize).mockImplementation(async (path) =>
      path.endsWith("api.ts") ? "C:/other/api.ts" : path,
    );
  if (mode === "permission")
    usePreferencesStore.setState({
      agentPermissionProfiles: {
        reviewer: { mode: "chat-only", categories: {} },
      },
    });
  if (mode === "missing")
    vi.mocked(native.readFile).mockRejectedValue(new Error("missing"));
  if (mode === "binary")
    vi.mocked(native.readFile).mockResolvedValue({ kind: "binary", size: 8 });
  if (mode === "oversized")
    vi.mocked(native.readFile).mockResolvedValue({
      kind: "text",
      content: "large",
      size: 2 * 1024 * 1024,
    });
  await expect(
    capturePeerReview(reviewer, [reviewed, reviewer]),
  ).rejects.toThrow();
});
it("cross-workspace dependencies cannot supply review evidence", async () => {
  await expect(
    capturePeerReview(reviewer, [{ ...coder, workspaceId: "other" }, reviewer]),
  ).rejects.toThrow("dependency_unavailable");
});
