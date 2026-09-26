import { beforeEach, expect, it, vi } from "vitest";
import { create } from "zustand";
import type { SessionMeta } from "@/modules/ai/lib/sessions";
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@/modules/ai/store/chatStore", () => ({
  useChatStore: create(() => ({
    sessions: [] as SessionMeta[],
    activeSessionId: "a",
    selectedModelId: "source",
  })),
}));
import { useChatStore } from "@/modules/ai/store/chatStore";
import { applyCommittedModelSwitch } from "@/modules/ai/store/modelSwitchSync";
const session = (id: string, revision = 0): SessionMeta => ({
  id,
  title: id,
  createdAt: 1,
  updatedAt: 1,
  modelRevision: revision,
  profile: {
    agentId: "coder",
    modelId: revision ? "target" : "source",
    workspaceId: null,
    workspaceRoot: null,
  },
  targetContext: revision ? { key: "validated-native-key" } : undefined,
});
beforeEach(() =>
  useChatStore.setState({
    sessions: [session("a"), session("b")],
    activeSessionId: "a",
    selectedModelId: "source",
  }),
);
it("converges the active selection and context pair without changing another conversation", () => {
  const other = useChatStore.getState().sessions[1];
  const committed = session("a", 2);
  applyCommittedModelSwitch(committed);
  expect(useChatStore.getState().sessions[0]).toBe(committed);
  expect(useChatStore.getState().selectedModelId).toBe("target");
  expect(useChatStore.getState().sessions[1]).toBe(other);
});
it("ignores late and duplicate events", () => {
  const committed = session("a", 3);
  applyCommittedModelSwitch(committed);
  applyCommittedModelSwitch(session("a", 2));
  applyCommittedModelSwitch(session("a", 3));
  expect(useChatStore.getState().sessions[0]).toBe(committed);
});
it("updates a background conversation without switching the foreground model", () => {
  applyCommittedModelSwitch(session("b", 1));
  expect(useChatStore.getState().sessions[1].profile?.modelId).toBe("target");
  expect(useChatStore.getState().selectedModelId).toBe("source");
});
it("does not resurrect a deleted conversation", () => {
  applyCommittedModelSwitch(session("deleted", 8));
  expect(useChatStore.getState().sessions).toHaveLength(2);
});
