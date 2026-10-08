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
import {
  applyCommittedModelSwitch,
  applyCommittedFallback,
} from "@/modules/ai/store/modelSwitchSync";
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
it("fallback events converge without replacing in-flight progress, pane ownership or selection", () => {
  const current = {
    ...session("a"),
    title: "Renamed locally",
    run: { state: "running" as const, startedAt: 10, recoveryAttempts: 1 },
  };
  useChatStore.setState({ sessions: [current, session("b")] });
  const saved = {
    ...session("a"),
    modelRevision: 2,
    title: "Older native title",
    fallback: {
      version: 1 as const,
      revision: 1,
      mode: "never" as const,
      agentId: null,
      workspaceId: null,
      primary: null,
      destination: null,
      categories: [],
      history: [],
    },
  };
  applyCommittedFallback(saved);
  expect(useChatStore.getState().sessions[0].run).toBe(current.run);
  expect(useChatStore.getState().sessions[0].title).toBe("Renamed locally");
  expect(useChatStore.getState().selectedModelId).toBe("source");
  expect(useChatStore.getState().sessions[1].fallback).toBeUndefined();
  applyCommittedFallback({ ...saved, modelRevision: 1, fallback: undefined });
  expect(useChatStore.getState().sessions[0].fallback).toBe(saved.fallback);
});
