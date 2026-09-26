import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { targetContextFixture } from "@/modules/ai/store/targetContext.fixture";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

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
  vi.mocked(invoke).mockImplementation(targetContextFixture);
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

it("prepares oversized tool history even when target tool support is unknown", async () => {
  usePreferencesStore.setState({
    customEndpoints: [
      {
        id: "small",
        name: "Small",
        modelId: "small",
        baseURL: "http://localhost:1234/v1",
        contextLimit: 20000,
      },
    ],
  });
  useChatStore.setState({ customEndpointKeys: { small: "test" } });
  seedMessages.set("chat-a", [
    history[0],
    ...Array.from(
      { length: 8 },
      (_, i): UIMessage => ({
        id: `old-${i}`,
        role: "assistant",
        parts: [{ type: "text", text: "observation ".repeat(10000) }],
      }),
    ),
    {
      id: "tool",
      role: "assistant",
      parts: [
        {
          type: "tool-read_file",
          toolCallId: "call",
          state: "output-available",
          input: { path: "README.md" },
          output: "Read successfully",
        },
      ],
    },
    {
      id: "current",
      role: "user",
      parts: [{ type: "text", text: "Continue." }],
    },
  ]);
  const result = await prepareModelSwitch("chat-a", "compat-small");
  expect(result.assessment.status, result.assessment.reasons.join(" ")).toBe(
    "warning",
  );
  expect(result.assessment.reasons.join(" ")).toContain(
    "bounded evidence preparation",
  );
  expect(useChatStore.getState().selectedModelId).toBe("gpt-5.4-mini");
  result.dispose?.();
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
    expect(await result.commit()).toEqual({ ok: true });
    expect(useChatStore.getState().sessions[0].profile?.modelId).toBe(
      "claude-sonnet-4-6",
    );
    expect(seedMessages.get("chat-a")).toBe(messages);
  });
  it("does not override B1 when unknown capacity cannot fit mandatory context", async () => {
    const result = await prepareModelSwitch(
      "chat-a",
      savedProviderModelSelectionId(saved.id),
      followActive,
    );
    expect(result.assessment.status).toBe("blocked");
    expect((await result.commit()).ok).toBe(false);
    expect(useChatStore.getState().selectedModelId).toBe("gpt-5.4-mini");
    expect((await result.commit(true)).ok).toBe(false);
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
    expect((await result.commit(true)).ok).toBe(false);
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
    expect((await result.commit(true)).ok).toBe(false);
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
    expect((await result.commit(true)).ok).toBe(false);
    expect(useChatStore.getState().selectedModelId).toBe("gpt-5.4-mini");
  });
});

describe("pre-switch race and history loading", () => {
  it("locks both selectors during preparation and cancels before a late source reply", async () => {
    const controller = new AbortController();
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      const reply = await targetContextFixture(command, args);
      if (command === "target_context_begin") {
        expect(
          (await prepareModelSwitch("chat-a", "claude-opus-4-7")).assessment
            .status,
        ).toBe("blocked");
        controller.abort();
      }
      return reply;
    });
    const result = await prepareModelSwitch(
      "chat-a",
      "claude-sonnet-4-6",
      false,
      controller.signal,
    );
    expect(result.assessment.status).toBe("blocked");
    expect((await result.commit(true)).ok).toBe(false);
    expect(useChatStore.getState().selectedModelId).toBe("gpt-5.4-mini");
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(([command]) => command === "target_context_cancel"),
    ).toBe(true);
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(([command]) => command === "target_context_commit"),
    ).toBe(false);
  });
  it.each([
    "credentials",
    "permission",
    "cancel",
    "native CAS",
  ])("leaves selection and memory unchanged on %s invalidation", async (cause) => {
    const controller = new AbortController();
    const before = JSON.stringify(useChatStore.getState().sessions);
    const result = await prepareModelSwitch(
      "chat-a",
      "claude-sonnet-4-6",
      false,
      controller.signal,
    );
    expect(result.assessment.status).toBe("compatible");
    if (cause === "credentials")
      useChatStore.setState({
        apiKeys: { ...useChatStore.getState().apiKeys, anthropic: "changed" },
      });
    if (cause === "permission")
      usePreferencesStore.setState({ agentPermissionProfiles: {} });
    if (cause === "cancel") controller.abort();
    if (cause === "native CAS")
      vi.mocked(invoke).mockImplementation(async (command, args) => {
        if (command === "target_context_commit")
          throw new Error("target_context_stale_session");
        return targetContextFixture(command, args);
      });
    expect((await result.commit(true)).ok).toBe(false);
    expect(JSON.stringify(useChatStore.getState().sessions)).toBe(before);
    result.dispose?.();
  });
  it("expires an old confirmation instead of relying on stale project context", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const result = await prepareModelSwitch("chat-a", "claude-sonnet-4-6");
    clock.mockReturnValue(now + 30_000);
    expect(await result.commit(true)).toMatchObject({
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
    expect((await result.commit(true)).ok).toBe(false);
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
    expect((await result.commit(true)).ok).toBe(false);
  });
  it("does not apply a delayed bottom-picker check to a different active chat", async () => {
    const result = await prepareModelSwitch(
      "chat-a",
      "claude-sonnet-4-6",
      true,
    );
    useChatStore.setState({ activeSessionId: "chat-b" });
    expect((await result.commit()).ok).toBe(false);
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
    expect((await result.commit()).ok).toBe(true);
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
    expect((await result.commit()).ok).toBe(true);
    expect(useChatStore.getState().sessions[0].profile?.modelId).toBe(
      "gpt-5.4-mini",
    );
  });
});
