import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/sessions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/sessions")>()),
  loadMessages: vi.fn().mockResolvedValue([]),
  saveSessionsList: vi.fn(),
}));
vi.mock("@/modules/settings/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/settings/store")>()),
  setLastUsedAiSelection: vi.fn(),
  setRecentModelIds: vi.fn(),
}));
vi.mock("../lib/transport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/transport")>()),
  readProjectMemory: vi.fn().mockResolvedValue(null),
}));

import { usePreferencesStore } from "@/modules/settings/preferences";
import { EMPTY_PROVIDER_KEYS } from "../lib/keyring";
import { loadMessages } from "../lib/sessions";
import { readProjectMemory } from "../lib/transport";
import {
  createSavedProviderModel,
  savedProviderModelSelectionId,
} from "../lib/savedProviderModels";
import { chats, seedMessages, useChatStore } from "./chatStore";
import { prepareModelSwitch } from "./modelSwitch";

const original = useChatStore.getState();
const preferences = usePreferencesStore.getState();
const saved = createSavedProviderModel(
  { providerId: "openrouter", transportModelId: "custom/unknown" },
  "unknown",
  1,
);
const history: UIMessage[] = [
  {
    id: "old",
    role: "user",
    parts: [{ type: "text", text: "Keep this context." }],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  chats.clear();
  seedMessages.clear();
  seedMessages.set("chat-a", structuredClone(history));
  seedMessages.set("chat-b", []);
  usePreferencesStore.setState({
    savedProviderModels: [saved],
    customInstructions: "",
  });
  useChatStore.setState({
    activeSessionId: "chat-a",
    selectedModelId: "gpt-5.4-mini",
    apiKeys: {
      ...EMPTY_PROVIDER_KEYS,
      anthropic: "test",
      openrouter: "test",
      deepseek: "test",
    },
    sessions: ["chat-a", "chat-b"].map((id) => ({
      id,
      title: id,
      createdAt: 1,
      updatedAt: 1,
      profile: {
        agentId: "builtin:coder",
        modelId: "gpt-5.4-mini",
        workspaceId: null,
        workspaceRoot: null,
      },
    })),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  chats.clear();
  seedMessages.clear();
  useChatStore.setState(original);
  usePreferencesStore.setState(preferences);
});

describe.each([
  false,
  true,
])("shared model switch gate (follows active: %s)", (followActive) => {
  it("commits a compatible idle switch without confirmation or transcript changes", async () => {
    const messages = seedMessages.get("chat-a");
    const result = await prepareModelSwitch(
      "chat-a",
      "claude-sonnet-4-6",
      followActive,
    );
    expect(result.assessment.status).toBe("compatible");
    expect(useChatStore.getState().selectedModelId).toBe("gpt-5.4-mini");
    expect(result.commit()).toEqual({ ok: true });
    expect(useChatStore.getState().sessions[0].profile?.modelId).toBe(
      "claude-sonnet-4-6",
    );
    expect(seedMessages.get("chat-a")).toBe(messages);
  });
  it("requires explicit confirmation for unknown capacity", async () => {
    const result = await prepareModelSwitch(
      "chat-a",
      savedProviderModelSelectionId(saved.id),
      followActive,
    );
    expect(result.assessment.status).toBe("warning");
    expect(result.commit().ok).toBe(false);
    expect(useChatStore.getState().selectedModelId).toBe("gpt-5.4-mini");
    expect(result.commit(true)).toEqual({ ok: true });
  });
  it("blocks incompatible historical images before any selection is committed", async () => {
    const messages: UIMessage[] = [
      {
        id: "image",
        role: "user",
        parts: [
          {
            type: "file",
            mediaType: "image/png",
            url: "data:image/png;base64,AA==",
          },
        ],
      },
      ...history,
    ];
    seedMessages.set("chat-a", messages);
    const result = await prepareModelSwitch(
      "chat-a",
      "deepseek-v4-flash",
      followActive,
    );
    expect(result.assessment.status).toBe("blocked");
    expect(result.commit(true).ok).toBe(false);
    expect(useChatStore.getState().selectedModelId).toBe("gpt-5.4-mini");
    expect(seedMessages.get("chat-a")).toEqual(messages);
  });
  it("blocks context overflow before switching without compacting stored messages", async () => {
    const messages: UIMessage[] = [
      {
        id: "large",
        role: "user",
        parts: [{ type: "text", text: "x".repeat(900_000) }],
      },
    ];
    seedMessages.set("chat-a", messages);
    const result = await prepareModelSwitch(
      "chat-a",
      "claude-sonnet-4-6",
      followActive,
    );
    expect(result.assessment.status).toBe("blocked");
    expect(result.commit(true).ok).toBe(false);
    expect(seedMessages.get("chat-a")).toBe(messages);
  });
  it("rechecks run safety before committing an earlier confirmation", async () => {
    const result = await prepareModelSwitch(
      "chat-a",
      savedProviderModelSelectionId(saved.id),
      followActive,
    );
    useChatStore.setState((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === "chat-a"
          ? {
              ...session,
              run: { state: "running", startedAt: 1, modelId: "gpt-5.4-mini" },
            }
          : session,
      ),
    }));
    expect(result.commit(true).ok).toBe(false);
    expect(useChatStore.getState().selectedModelId).toBe("gpt-5.4-mini");
  });
});

describe("pre-switch race and history loading", () => {
  it("expires an old confirmation instead of relying on stale project context", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const result = await prepareModelSwitch(
      "chat-a",
      savedProviderModelSelectionId(saved.id),
    );
    clock.mockReturnValue(now + 30_000);
    expect(result.commit(true)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("expired"),
    });
  });
  it("rejects a context check overtaken by a new request while loading history", async () => {
    seedMessages.delete("chat-a");
    let resolveHistory: (messages: UIMessage[]) => void = () => {};
    vi.mocked(loadMessages).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveHistory = resolve;
        }),
    );
    const preparing = prepareModelSwitch("chat-a", "claude-sonnet-4-6");
    useChatStore.setState((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === "chat-a"
          ? {
              ...session,
              run: { state: "running", startedAt: 1, modelId: "gpt-5.4-mini" },
            }
          : session,
      ),
    }));
    resolveHistory(history);
    const result = await preparing;
    expect(result.assessment.status).toBe("blocked");
    expect(result.commit(true).ok).toBe(false);
  });
  it("loads an evicted conversation before assessing it", async () => {
    seedMessages.delete("chat-a");
    vi.mocked(loadMessages).mockResolvedValueOnce([
      {
        id: "old-image",
        role: "user",
        parts: [
          {
            type: "file",
            mediaType: "image/png",
            url: "data:image/png;base64,AA==",
          },
        ],
      },
    ]);
    const result = await prepareModelSwitch("chat-a", "deepseek-v4-flash");
    expect(loadMessages).toHaveBeenCalledWith("chat-a");
    expect(result.assessment.status).toBe("blocked");
  });
  it("fails closed when history cannot be inspected", async () => {
    seedMessages.delete("chat-a");
    vi.mocked(loadMessages).mockRejectedValueOnce(new Error("private detail"));
    const result = await prepareModelSwitch("chat-a", "claude-sonnet-4-6");
    expect(result.assessment.status).toBe("blocked");
    expect(result.assessment.reasons.join(" ")).not.toContain("private detail");
  });
  it("includes project memory and custom instructions in the same budget", async () => {
    usePreferencesStore.setState({ customInstructions: "x".repeat(400_000) });
    vi.mocked(readProjectMemory).mockResolvedValueOnce("x".repeat(400_000));
    const result = await prepareModelSwitch("chat-a", "claude-sonnet-4-6");
    expect(result.assessment.status).toBe("blocked");
    expect(result.assessment.estimatedTokens).toBeGreaterThan(200_000);
  });
  it.each([
    "history",
    "model metadata",
    "instructions",
    "session deletion",
  ])("invalidates a confirmation after %s changes", async (change) => {
    const result = await prepareModelSwitch(
      "chat-a",
      savedProviderModelSelectionId(saved.id),
    );
    if (change === "history")
      seedMessages.set("chat-a", [
        ...history,
        {
          id: "new",
          role: "user",
          parts: [{ type: "text", text: "new message" }],
        },
      ]);
    if (change === "model metadata")
      usePreferencesStore.setState({ savedProviderModels: [] });
    if (change === "instructions")
      usePreferencesStore.setState({ customInstructions: "Changed" });
    if (change === "session deletion") useChatStore.setState({ sessions: [] });
    expect(result.commit(true).ok).toBe(false);
  });
  it("does not apply a delayed bottom-picker check to a different active chat", async () => {
    const result = await prepareModelSwitch(
      "chat-a",
      "claude-sonnet-4-6",
      true,
    );
    useChatStore.setState({ activeSessionId: "chat-b" });
    expect(result.commit().ok).toBe(false);
    expect(useChatStore.getState().sessions[1].profile?.modelId).toBe(
      "gpt-5.4-mini",
    );
  });
  it("keeps an explicit idle pane's selection scoped even when another pane becomes active", async () => {
    const result = await prepareModelSwitch(
      "chat-a",
      "claude-sonnet-4-6",
      false,
    );
    useChatStore.setState({ activeSessionId: "chat-b" });
    expect(result.commit().ok).toBe(true);
    expect(useChatStore.getState().sessions[1].profile?.modelId).toBe(
      "gpt-5.4-mini",
    );
  });
  it("does not gate a no-chat default on another conversation's history", async () => {
    useChatStore.setState({ activeSessionId: null });
    const result = await prepareModelSwitch(
      null,
      savedProviderModelSelectionId(saved.id),
      true,
    );
    expect(result.assessment.status).toBe("compatible");
    expect(result.commit().ok).toBe(true);
    expect(useChatStore.getState().sessions[0].profile?.modelId).toBe(
      "gpt-5.4-mini",
    );
  });
});
