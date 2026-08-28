import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Chat, UIMessage } from "@ai-sdk/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/settings/store", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/modules/settings/store")>();
  return {
    ...original,
    setLastUsedAiSelection: vi.fn(),
    setRecentModelIds: vi.fn(),
  };
});

vi.mock("../lib/sessions", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/sessions")>();
  return {
    ...original,
    saveActiveId: vi.fn(),
    saveSessionsList: vi.fn(),
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
import { cancelActiveRun, chats, useChatStore } from "./chatStore";
import {
  continueActiveRun,
  sendMessageToSession,
  shouldAutomaticallySendSession,
} from "./chatRuntime";
import {
  normalizeAiError,
  normalizeAiStreamPartError,
  shouldPresentAiError,
} from "../lib/errors";
import { useTodosStore } from "./todoStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { AGENT_HARD_STEP_LIMIT, AGENT_SOFT_STEP_LIMIT } from "../lib/runBudget";
import { shouldShowHeaderStop } from "../components/AiMiniWindow";
import { shouldShowTodoStrip } from "../components/TodoStrip";

const SESSION_ID = "compact-session";
const ORIGINAL_API_KEYS = useChatStore.getState().apiKeys;
const ORIGINAL_SELECTED_MODEL = useChatStore.getState().selectedModelId;

afterEach(() => {
  chats.delete(SESSION_ID);
  usePreferencesStore.setState({ agentPermissionProfiles: {} });
  useChatStore.setState({
    activeSessionId: null,
    mini: { open: false, minimized: false },
    panelOpen: false,
    apiKeys: ORIGINAL_API_KEYS,
    selectedModelId: ORIGINAL_SELECTED_MODEL,
    sessions: [],
    agentMeta: {
      ...useChatStore.getState().agentMeta,
      status: "idle",
      step: null,
      approvalsPending: 0,
      error: null,
    },
  });
});

describe("cancelActiveRun", () => {
  it("denies pending approvals, stops once, and terminalizes the run", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const respond = vi.fn();
    chats.set(SESSION_ID, {
      stop,
      messages: [
        {
          id: "assistant",
          role: "assistant",
          parts: [
            {
              type: "tool-write_file",
              state: "approval-requested",
              approval: { id: "approval-1" },
            },
          ],
        },
      ],
    } as unknown as Chat<UIMessage>);
    useChatStore.setState({
      activeSessionId: SESSION_ID,
      approvalResponder: respond,
      sessions: [
        {
          id: SESSION_ID,
          title: "Run",
          createdAt: 1,
          updatedAt: 1,
          run: { state: "running", startedAt: 1 },
        },
      ],
    });

    await cancelActiveRun();

    expect(respond).toHaveBeenCalledWith("approval-1", false);
    expect(stop).toHaveBeenCalledOnce();
    expect(useChatStore.getState().sessions[0].run?.state).toBe("cancelled");
    expect(useChatStore.getState().agentMeta.status).toBe("idle");

    useChatStore.getState().beginRun(SESSION_ID, "builtin:coder");
    expect(useChatStore.getState().sessions[0].run?.state).toBe("running");
    expect(useChatStore.getState().agentMeta.status).toBe("thinking");
  });

  it("prevents a pending Full Access continuation when Stop wins the race", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    setPermissionMode("full-access");
    useChatStore.setState({
      activeSessionId: SESSION_ID,
      sessions: [sessionMeta()],
    });
    useChatStore.getState().beginRun(SESSION_ID, "builtin:coder");
    useChatStore.getState().recordRunBatch(SESSION_ID, cappedBatch());
    chats.set(SESSION_ID, { stop, messages: [] } as unknown as Chat<UIMessage>);

    expect(useChatStore.getState().sessions[0].run?.budget?.phase).toBe(
      "auto-continue-pending",
    );
    await cancelActiveRun();

    expect(stop).toHaveBeenCalledOnce();
    expect(useChatStore.getState().consumeAutoContinuation(SESSION_ID)).toBe(
      false,
    );
    expect(useChatStore.getState().sessions[0].run?.state).toBe("cancelled");
  });
});

describe("autonomous run budget integration", () => {
  it("keeps Ask behind a soft limit without finalizing the logical run", () => {
    setPermissionMode("ask");
    useChatStore.setState({ sessions: [sessionMeta()] });
    useChatStore.getState().beginRun(SESSION_ID, "builtin:coder");
    useTodosStore
      .getState()
      .setTodos(SESSION_ID, [
        { id: "active", title: "Keep working", status: "in_progress" },
      ]);

    useChatStore.getState().recordRunBatch(SESSION_ID, cappedBatch());

    const run = useChatStore.getState().sessions[0].run;
    expect(run?.state).toBe("running");
    expect(run?.budget?.phase).toBe("soft-limit");
    expect(useTodosStore.getState().bySession[SESSION_ID]).toHaveLength(1);
  });

  it("continues Full Access in the same logical run and preserves todos", () => {
    setPermissionMode("full-access");
    useChatStore.setState({
      sessions: [sessionMeta("gpt-5.4-mini")],
      selectedModelId: "gpt-5.4-mini",
    });
    useChatStore.getState().beginRun(SESSION_ID, "builtin:coder");
    useTodosStore
      .getState()
      .setTodos(SESSION_ID, [
        { id: "active", title: "Keep working", status: "in_progress" },
      ]);
    const startedAt = useChatStore.getState().sessions[0].run?.startedAt;
    useChatStore.setState({ selectedModelId: "claude-sonnet-4-6" });

    useChatStore.getState().recordRunBatch(SESSION_ID, cappedBatch());
    const messages: UIMessage[] = [
      {
        id: "assistant",
        role: "assistant",
        parts: [{ type: "text", text: "Still working" }],
      },
    ];
    const consumed = shouldAutomaticallySendSession(SESSION_ID, messages);

    const run = useChatStore.getState().sessions[0].run;
    expect(consumed).toBe(true);
    expect(run?.startedAt).toBe(startedAt);
    expect(run?.agentId).toBe("builtin:coder");
    expect(run?.modelId).toBe("gpt-5.4-mini");
    expect(run?.budget?.continuationCount).toBe(1);
    expect(useTodosStore.getState().bySession[SESSION_ID]).toHaveLength(1);
    expect(messages).toHaveLength(1);
  });

  it("honors a Full Access downgrade before a pending continuation starts", () => {
    setPermissionMode("full-access");
    useChatStore.setState({ sessions: [sessionMeta()] });
    useChatStore.getState().beginRun(SESSION_ID, "builtin:coder");
    useChatStore.getState().recordRunBatch(SESSION_ID, cappedBatch());
    setPermissionMode("ask");

    const shouldContinue = shouldAutomaticallySendSession(SESSION_ID, []);

    expect(shouldContinue).toBe(false);
    expect(useChatStore.getState().sessions[0].run?.budget?.phase).toBe(
      "soft-limit",
    );
  });

  it("does not add a synthetic message when the user continues Ask mode", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const messages: UIMessage[] = [
      {
        id: "assistant",
        role: "assistant",
        parts: [{ type: "text", text: "Working" }],
      },
    ];
    setPermissionMode("ask");
    useChatStore.setState({
      activeSessionId: SESSION_ID,
      sessions: [sessionMeta()],
    });
    useChatStore.getState().beginRun(SESSION_ID, "builtin:coder");
    useChatStore.getState().recordRunBatch(SESSION_ID, cappedBatch());
    const startedAt = useChatStore.getState().sessions[0].run?.startedAt;
    chats.set(SESSION_ID, {
      sendMessage,
      messages,
    } as unknown as Chat<UIMessage>);

    await continueActiveRun(false);

    expect(sendMessage).toHaveBeenCalledWith();
    expect(messages).toHaveLength(1);
    expect(useChatStore.getState().sessions[0].run?.startedAt).toBe(startedAt);
  });

  it("stops Full Access at the hard ceiling", () => {
    setPermissionMode("full-access");
    useChatStore.setState({ sessions: [sessionMeta()] });
    useChatStore.getState().beginRun(SESSION_ID, "builtin:coder");
    useChatStore.setState((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === SESSION_ID && session.run?.budget
          ? {
              ...session,
              run: {
                ...session.run,
                budget: {
                  ...session.run.budget,
                  totalSteps: AGENT_HARD_STEP_LIMIT - AGENT_SOFT_STEP_LIMIT,
                  continuationCount: 8,
                },
              },
            }
          : session,
      ),
    }));

    useChatStore.getState().recordRunBatch(SESSION_ID, cappedBatch());

    expect(useChatStore.getState().sessions[0].run?.budget).toMatchObject({
      phase: "hard-limit",
      stopReason: "total-steps",
      totalSteps: AGENT_HARD_STEP_LIMIT,
    });
    expect(useChatStore.getState().consumeAutoContinuation(SESSION_ID)).toBe(
      false,
    );
  });

  it("does not turn a provider 429 into another autonomous continuation", () => {
    setPermissionMode("full-access");
    useChatStore.setState({ sessions: [sessionMeta()] });
    useChatStore.getState().beginRun(SESSION_ID, "builtin:coder");
    useChatStore.getState().recordRunBatch(SESSION_ID, cappedBatch());
    useChatStore.getState().patchAgentMeta({
      status: "error",
      error: normalizeAiError({ statusCode: 429, message: "Rate limited" }),
    });

    useChatStore.getState().finishRun(SESSION_ID, "failed");

    expect(useChatStore.getState().consumeAutoContinuation(SESSION_ID)).toBe(
      false,
    );
    expect(useChatStore.getState().sessions[0].run?.state).toBe("failed");
  });
});

describe("run error state", () => {
  it("keeps recoverable tool validation inside the same Full Access run", () => {
    setPermissionMode("full-access");
    useChatStore.setState({
      activeSessionId: SESSION_ID,
      sessions: [sessionMeta()],
    });
    useChatStore.getState().beginRun(SESSION_ID, "builtin:coder");
    const startedAt = useChatStore.getState().sessions[0].run?.startedAt;
    const toolFailure = normalizeAiStreamPartError({
      name: "AI_InvalidToolInputError",
      toolName: "edit",
      message: "Invalid input for tool edit: Type validation failed",
    });

    expect(toolFailure.error.disposition).toBe("recoverable");
    expect(useChatStore.getState().sessions[0].run?.state).toBe("running");
    expect(useChatStore.getState().agentMeta.error).toBeNull();

    useChatStore.getState().recordRunBatch(SESSION_ID, cappedBatch());
    expect(shouldAutomaticallySendSession(SESSION_ID, [])).toBe(true);
    expect(useChatStore.getState().sessions[0].run?.startedAt).toBe(startedAt);
  });

  it("keeps a retrying 429 running and clears the transient state on recovery", () => {
    useChatStore.setState({
      activeSessionId: SESSION_ID,
      sessions: [sessionMeta()],
    });
    useChatStore.getState().beginRun(SESSION_ID, "builtin:coder");
    const error = normalizeAiError(
      { statusCode: 429, message: "Rate limited" },
      { provider: "OpenRouter", disposition: "retrying" },
    );

    useChatStore.getState().setProviderRetry(SESSION_ID, {
      error,
      retryNumber: 1,
      maxRetries: 2,
    });

    expect(useChatStore.getState().sessions[0].run?.state).toBe("running");
    expect(useChatStore.getState().agentMeta.status).toBe("retrying");
    expect(shouldPresentAiError(error, "running")).toBe(false);
    expect(shouldShowHeaderStop("running")).toBe(true);

    useChatStore.getState().clearProviderRetry(SESSION_ID);

    expect(useChatStore.getState().agentMeta.providerRetry).toBeNull();
    expect(useChatStore.getState().agentMeta.status).toBe("thinking");
    expect(useChatStore.getState().sessions[0].run?.state).toBe("running");
  });

  it.each([429, 503])(
    "terminalizes exhausted HTTP %i failures before presenting the card",
    (statusCode) => {
      useChatStore.setState({
        activeSessionId: SESSION_ID,
        sessions: [sessionMeta()],
      });
      useChatStore.getState().beginRun(SESSION_ID, "builtin:coder");
      useTodosStore
        .getState()
        .setTodos(SESSION_ID, [
          { id: "active", title: "Keep working", status: "in_progress" },
        ]);
      const retrying = normalizeAiError(
        { statusCode, message: "Provider unavailable" },
        { provider: "OpenRouter", disposition: "retrying" },
      );
      useChatStore.getState().setProviderRetry(SESSION_ID, {
        error: retrying,
        retryNumber: 2,
        maxRetries: 2,
      });
      const terminal = normalizeAiError(
        { statusCode, message: "Provider unavailable" },
        { provider: "OpenRouter", disposition: "terminal" },
      );

      useChatStore.getState().finishRun(SESSION_ID, "failed", terminal);

      const state = useChatStore.getState();
      expect(state.sessions[0].run?.state).toBe("failed");
      expect(state.sessions[0].run?.error).toEqual(terminal);
      expect(state.agentMeta.status).toBe("error");
      expect(state.agentMeta.providerRetry).toBeNull();
      expect(shouldPresentAiError(state.agentMeta.error, "failed")).toBe(true);
      expect(shouldShowHeaderStop("failed")).toBe(false);
      expect(shouldShowTodoStrip("failed", 1)).toBe(false);
      expect(useTodosStore.getState().bySession[SESSION_ID]).toEqual([]);
    },
  );

  it("lets Stop cancel a run while a provider retry is pending", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({
      activeSessionId: SESSION_ID,
      sessions: [sessionMeta()],
    });
    useChatStore.getState().beginRun(SESSION_ID, "builtin:coder");
    useChatStore.getState().setProviderRetry(SESSION_ID, {
      error: normalizeAiError(
        { statusCode: 429, message: "Rate limited" },
        { provider: "OpenRouter", disposition: "retrying" },
      ),
      retryNumber: 1,
      maxRetries: 2,
    });
    chats.set(SESSION_ID, { stop, messages: [] } as unknown as Chat<UIMessage>);

    await cancelActiveRun();

    expect(stop).toHaveBeenCalledOnce();
    expect(useChatStore.getState().sessions[0].run?.state).toBe("cancelled");
    expect(useChatStore.getState().agentMeta.providerRetry).toBeNull();
    expect(useChatStore.getState().agentMeta.error).toBeNull();
  });

  it("persists a normalized failure on the session run", () => {
    const normalized = normalizeAiError(
      { statusCode: 503, message: "Service unavailable" },
      { provider: "OpenRouter" },
    );
    useChatStore.setState({
      activeSessionId: SESSION_ID,
      sessions: [
        {
          id: SESSION_ID,
          title: "Failed run",
          createdAt: 1,
          updatedAt: 1,
          run: { state: "running", startedAt: 1 },
        },
      ],
      agentMeta: {
        ...useChatStore.getState().agentMeta,
        status: "error",
        error: normalized,
      },
    });

    useChatStore.getState().finishRun(SESSION_ID, "failed");

    expect(useChatStore.getState().sessions[0].run?.error).toEqual(normalized);
  });

  it("restores a persisted failure when switching sessions", () => {
    const normalized = normalizeAiError(new Error("Connection refused"), {
      provider: "Local endpoint",
      endpoint: "http://localhost:1234/v1",
    });
    chats.set(SESSION_ID, {} as Chat<UIMessage>);
    useChatStore.setState({
      activeSessionId: "other-session",
      sessions: [
        {
          id: SESSION_ID,
          title: "Failed run",
          createdAt: 1,
          updatedAt: 2,
          run: {
            state: "failed",
            startedAt: 1,
            endedAt: 2,
            error: normalized,
          },
        },
      ],
    });

    useChatStore.getState().switchSession(SESSION_ID);

    expect(useChatStore.getState().agentMeta.error).toEqual(normalized);
    expect(useChatStore.getState().agentMeta.status).toBe("error");
  });
});

describe("active todo lifecycle", () => {
  it.each([
    "completed",
    "cancelled",
    "interrupted",
    "failed",
  ] as const)("clears active todos when a run becomes %s", (terminalState) => {
    useChatStore.setState({
      activeSessionId: SESSION_ID,
      sessions: [
        {
          ...sessionMeta(),
          run: {
            state: "running",
            agentId: "builtin:coder",
            startedAt: 1,
          },
        },
      ],
    });
    useTodosStore.getState().setTodos(SESSION_ID, [
      { id: "done", title: "Done", status: "completed" },
      { id: "active", title: "Active", status: "in_progress" },
    ]);

    useChatStore.getState().finishRun(SESSION_ID, terminalState);

    expect(useTodosStore.getState().bySession[SESSION_ID]).toEqual([]);
    expect(useChatStore.getState().sessions[0].run?.state).toBe(terminalState);
  });

  it("starts a fresh todo list instead of resurrecting terminal work", () => {
    useChatStore.setState({
      activeSessionId: SESSION_ID,
      sessions: [
        {
          id: SESSION_ID,
          title: "Run",
          createdAt: 1,
          updatedAt: 1,
          run: {
            state: "completed",
            agentId: "builtin:coder",
            startedAt: 1,
            endedAt: 2,
          },
        },
      ],
    });
    useTodosStore
      .getState()
      .setTodos(SESSION_ID, [{ id: "old", title: "Old", status: "completed" }]);

    useChatStore.getState().beginRun(SESSION_ID, "builtin:coder");

    expect(useTodosStore.getState().bySession[SESSION_ID]).toEqual([]);
    useTodosStore
      .getState()
      .setTodos(SESSION_ID, [
        { id: "new", title: "New", status: "in_progress" },
      ]);
    expect(useTodosStore.getState().bySession[SESSION_ID]).toEqual([
      { id: "new", title: "New", status: "in_progress" },
    ]);
  });
});

describe("sendMessageToSession", () => {
  it("sends to the existing conversation without opening the transcript", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    chats.set(SESSION_ID, { sendMessage } as unknown as Chat<UIMessage>);
    useChatStore.setState({
      activeSessionId: SESSION_ID,
      mini: { open: false, minimized: false },
      panelOpen: true,
      sessions: [sessionMeta()],
      apiKeys: {
        ...useChatStore.getState().apiKeys,
        openai: "test-key",
      },
    });

    const message = {
      role: "user" as const,
      parts: [{ type: "text" as const, text: "quick compact prompt" }],
    };
    await sendMessageToSession(SESSION_ID, message);

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith(message);
    expect(useChatStore.getState().activeSessionId).toBe(SESSION_ID);
    expect(useChatStore.getState().mini.open).toBe(false);
  });

  it("keeps compact submission free of transcript visibility actions", () => {
    const composer = readFileSync(
      join(process.cwd(), "src", "modules", "ai", "lib", "composer.tsx"),
      "utf8",
    );

    expect(composer).toContain("sendMessageToSession(sessionId");
    expect(composer).not.toContain("store.openMini()");
    expect(composer).not.toContain("revealTranscript");
  });
});

function setPermissionMode(mode: "ask" | "trusted-workspace" | "full-access") {
  usePreferencesStore.setState({
    agentPermissionProfiles: {
      "builtin:coder": { mode, categories: {} },
    },
  });
}

function sessionMeta(modelId = "gpt-5.4-mini") {
  return {
    id: SESSION_ID,
    title: "Run",
    createdAt: 1,
    updatedAt: 1,
    profileVersion: 1,
    profile: {
      agentId: "builtin:coder",
      modelId,
      workspaceId: null,
      workspaceRoot: null,
    },
  };
}

function cappedBatch() {
  return {
    steps: AGENT_SOFT_STEP_LIMIT,
    hitSoftLimit: true,
    finishReason: "tool-calls",
  };
}
