import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/settings/store", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/modules/settings/store")>();
  return {
    ...original,
    setLastUsedAiSelection: vi.fn().mockResolvedValue(undefined),
    setRecentModelIds: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../lib/sessions", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/sessions")>();
  return {
    ...original,
    loadMessages: vi.fn().mockResolvedValue(null),
    loadAll: vi.fn(),
    saveActiveId: vi.fn().mockResolvedValue(undefined),
    saveSessionsList: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../lib/todos", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/todos")>();
  return {
    ...original,
    loadTodos: vi.fn().mockResolvedValue([]),
    saveTodos: vi.fn().mockResolvedValue(undefined),
    deleteTodos: vi.fn().mockResolvedValue(undefined),
  };
});

import { createConversationProfile, loadAll, saveSessionsList, type SessionMeta } from "../lib/sessions";
import { attachManagedLocalGguf } from "../lib/managedLocalModels";
import { emptySelfHostedState } from "../lib/selfHostedProfiles";
import { resolveModelTransportIdentity } from "../lib/savedProviderModels";
import {
  createSavedProviderModel,
  savedProviderModelSelectionId,
} from "../lib/savedProviderModels";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useAgentsStore } from "./agentsStore";
import { chats, seedMessages, useChatStore } from "./chatStore";

const originalChatState = useChatStore.getState();
const originalAgentId = useAgentsStore.getState().activeId;
const originalSavedModels = usePreferencesStore.getState().savedProviderModels;
const originalSelfHosted = usePreferencesStore.getState().selfHostedInference;
const ROOT = "C:/Work/Clack";

function session(id: string, agentId: string, modelId: string): SessionMeta {
  return {
    id,
    title: id,
    createdAt: 1,
    updatedAt: 1,
    profileVersion: 1,
    profile: createConversationProfile({
      agentId,
      modelId,
      workspaceRoot: ROOT,
      workspaceEnvironment: "local",
    }),
  };
}

beforeEach(() => {
  chats.clear();
  seedMessages.clear();
  useAgentsStore.setState({ activeId: "builtin:coder" });
  useChatStore.setState({
    sessionsHydrated: true,
    sessions: [
      session("chat-a", "builtin:coder", "gpt-5.4-mini"),
      session("chat-b", "builtin:reviewer", "claude-sonnet-4-6"),
    ],
    activeSessionId: "chat-a",
    selectedModelId: "gpt-5.4-mini",
    live: {
      ...originalChatState.live,
      getCwd: () => ROOT,
      getWorkspaceRoot: () => ROOT,
    },
  });
});

afterEach(() => {
  chats.clear();
  seedMessages.clear();
  useAgentsStore.setState({ activeId: originalAgentId });
  usePreferencesStore.setState({ savedProviderModels: originalSavedModels });
  usePreferencesStore.setState({ selfHostedInference: originalSelfHosted });
  useChatStore.setState({
    sessionsHydrated: originalChatState.sessionsHydrated,
    sessions: originalChatState.sessions,
    activeSessionId: originalChatState.activeSessionId,
    selectedModelId: originalChatState.selectedModelId,
    live: originalChatState.live,
  });
});

describe("conversation-owned profiles", () => {
  it("persists, reopens and switches away from only the exact managed deployment in the active chat", async () => {
    const managed = attachManagedLocalGguf(emptySelfHostedState(), {
      digest: `sha256:${"c".repeat(64)}`,
      displayName: "Qwen2.5-0.5B-Instruct",
      material: { version: 1, context: 2048, gpu: 0, tool: false, grammar: false },
    });
    usePreferencesStore.setState({ selfHostedInference: managed.state });
    const selection = managed.selectionId;
    expect(useChatStore.getState().setSessionModelId("chat-a", selection, false)).toBe(true);
    const committed = structuredClone(useChatStore.getState().sessions);
    expect(committed[0].profile?.modelId).toBe(selection);
    expect(committed[1].profile?.modelId).toBe("claude-sonnet-4-6");
    expect(vi.mocked(saveSessionsList)).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: "chat-a", profile: expect.objectContaining({ modelId: selection }) }),
    ]));
    const reloaded = structuredClone(committed);
    reloaded[0].title = "New chat"; // real hydration reuses the persisted placeholder
    vi.mocked(loadAll).mockResolvedValueOnce({
      sessions: reloaded, activeId: "chat-a", attachmentContentIds: [],
    });
    useChatStore.setState({
      sessionsHydrated: false, sessions: [], activeSessionId: null, selectedModelId: "gpt-5.4-mini",
    });
    await useChatStore.getState().hydrateSessions();
    expect(useChatStore.getState().activeSessionId).toBe("chat-a");
    expect(useChatStore.getState().selectedModelId).toBe(selection);
    expect(resolveModelTransportIdentity(selection, usePreferencesStore.getState()).managedLocal?.deploymentId)
      .toBe(managed.state.fabric!.deployments[0].id);
    expect(useChatStore.getState().sessions.find(item => item.id === "chat-b")?.profile?.modelId)
      .toBe("claude-sonnet-4-6");
    expect(useChatStore.getState().setSessionModelId("chat-a", "gpt-5.4-mini", false)).toBe(true);
    expect(useChatStore.getState().selectedModelId).toBe("gpt-5.4-mini");
    expect(useChatStore.getState().sessions.find(item => item.id === "chat-b")?.profile?.modelId)
      .toBe("claude-sonnet-4-6");
  });
  it("restores each chat's agent and model independently", async () => {
    useChatStore.getState().switchSession("chat-b");
    await vi.waitFor(() => {
      expect(useChatStore.getState().activeSessionId).toBe("chat-b");
    });
    expect(useChatStore.getState().selectedModelId).toBe("claude-sonnet-4-6");

    useChatStore.getState().setSelectedModelId("claude-opus-4-7");
    expect(
      useChatStore.getState().setSessionAgentId("chat-b", "builtin:security"),
    ).toBe(true);

    useChatStore.getState().switchSession("chat-a");
    await vi.waitFor(() => {
      expect(useChatStore.getState().activeSessionId).toBe("chat-a");
    });
    const state = useChatStore.getState();
    expect(state.selectedModelId).toBe("gpt-5.4-mini");
    expect(
      state.sessions.find((item) => item.id === "chat-a")?.profile,
    ).toMatchObject({
      agentId: "builtin:coder",
      modelId: "gpt-5.4-mini",
    });
    expect(
      state.sessions.find((item) => item.id === "chat-b")?.profile,
    ).toMatchObject({
      agentId: "builtin:security",
      modelId: "claude-opus-4-7",
    });
  });

  it("keeps a running chat's captured identity immutable", () => {
    expect(useChatStore.getState().beginRun("chat-a")).toEqual({ ok: true });
    useChatStore.getState().setSelectedModelId("model-a-mutated");
    expect(
      useChatStore.getState().setSessionAgentId("chat-a", "builtin:reviewer"),
    ).toBe(false);

    const active = useChatStore
      .getState()
      .sessions.find((item) => item.id === "chat-a");
    expect(active?.profile).toMatchObject({
      agentId: "builtin:coder",
      modelId: "gpt-5.4-mini",
    });
    expect(active?.run).toMatchObject({
      agentId: "builtin:coder",
      modelId: "gpt-5.4-mini",
      providerId: "openai",
      transportModelId: "gpt-5.4-mini",
      workspaceRoot: ROOT,
    });
  });

  it("changes one pane's agent and model without mutating another", () => {
    expect(
      useChatStore.getState().setSessionAgentId("chat-b", "builtin:security"),
    ).toBe(true);
    expect(
      useChatStore.getState().setSessionModelId("chat-b", "claude-opus-4-7"),
    ).toBe(true);

    const state = useChatStore.getState();
    expect(
      state.sessions.find((item) => item.id === "chat-a")?.profile,
    ).toMatchObject({
      agentId: "builtin:coder",
      modelId: "gpt-5.4-mini",
    });
    expect(
      state.sessions.find((item) => item.id === "chat-b")?.profile,
    ).toMatchObject({
      agentId: "builtin:security",
      modelId: "claude-opus-4-7",
    });
  });

  it("captures the visible defaults and workspace for a new chat", () => {
    useAgentsStore.setState({ activeId: "builtin:architect" });
    useChatStore.setState({ selectedModelId: "model-new" });
    const id = useChatStore.getState().newSession();
    expect(
      useChatStore.getState().sessions.find((item) => item.id === id)?.profile,
    ).toMatchObject({
      agentId: "builtin:architect",
      modelId: "model-new",
      workspaceRoot: ROOT,
    });
  });

  it("captures a saved provider's exact transport model for the run", () => {
    const saved = createSavedProviderModel(
      {
        providerId: "openrouter",
        transportModelId: "anthropic/claude-review-model",
      },
      "review-model",
      10,
    );
    const selectionId = savedProviderModelSelectionId(saved.id);
    usePreferencesStore.setState({ savedProviderModels: [saved] });
    useChatStore.setState({
      sessions: [session("chat-a", "builtin:coder", selectionId)],
      activeSessionId: "chat-a",
      selectedModelId: selectionId,
    });

    expect(useChatStore.getState().beginRun("chat-a")).toEqual({ ok: true });
    usePreferencesStore.setState({ savedProviderModels: [] });

    expect(useChatStore.getState().sessions[0].run).toMatchObject({
      modelId: selectionId,
      providerId: "openrouter",
      transportModelId: "anthropic/claude-review-model",
    });
  });
});
