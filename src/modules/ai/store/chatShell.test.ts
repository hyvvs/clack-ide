import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/ai/lib/sessions", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/modules/ai/lib/sessions")
  >();
  return {
    ...original,
    saveSessionsList: vi.fn(),
  };
});

vi.mock("@/modules/ai/lib/todos", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/ai/lib/todos")>();
  return {
    ...original,
    loadTodos: vi.fn().mockResolvedValue([]),
    saveTodos: vi.fn().mockResolvedValue(undefined),
    deleteTodos: vi.fn().mockResolvedValue(undefined),
  };
});
import { useChatStore } from "./chatStore";

const original = useChatStore.getState();

beforeEach(() => {
  useChatStore.setState({
    mini: { open: false, minimized: false },
    panelOpen: false,
    focusSignal: 0,
    pendingPrefill: null,
    approvalResponder: null,
    pendingApprovalsBySession: {},
    activeSessionId: "session-a",
    sessions: [
      {
        id: "session-a",
        title: "Existing conversation",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  });
});

afterEach(() => {
  useChatStore.setState({
    mini: original.mini,
    panelOpen: original.panelOpen,
    focusSignal: original.focusSignal,
    pendingPrefill: original.pendingPrefill,
    approvalResponder: original.approvalResponder,
    pendingApprovalsBySession: original.pendingApprovalsBySession,
    agentMeta: original.agentMeta,
    activeSessionId: original.activeSessionId,
    sessions: original.sessions,
  });
});

describe("AI shell visibility", () => {
  it("opens the transcript and compact composer while requesting focus", () => {
    useChatStore.getState().openExperience();

    const state = useChatStore.getState();
    expect(state.mini.open).toBe(true);
    expect(state.panelOpen).toBe(true);
    expect(state.focusSignal).toBe(1);
    expect(state.activeSessionId).toBe("session-a");
    expect(state.sessions).toHaveLength(1);
  });

  it("keeps the existing conversation and pending composer state when reopened", () => {
    const sessions = useChatStore.getState().sessions;
    useChatStore.setState({
      mini: { open: true, minimized: false },
      panelOpen: true,
      focusSignal: 4,
      pendingPrefill: "keep this draft input",
    });

    useChatStore.getState().openExperience();

    const state = useChatStore.getState();
    expect(state.mini).toEqual({ open: true, minimized: false });
    expect(state.panelOpen).toBe(true);
    expect(state.focusSignal).toBe(5);
    expect(state.pendingPrefill).toBe("keep this draft input");
    expect(state.activeSessionId).toBe("session-a");
    expect(state.sessions).toBe(sessions);
  });

  it("keeps transcript opening behind explicit shell actions", () => {
    const state = useChatStore.getState();

    expect(state.mini.open).toBe(false);
    expect(state.panelOpen).toBe(false);
    expect(state.activeSessionId).toBe("session-a");
  });

  it("minimizes and restores without changing the active session", () => {
    const sessions = useChatStore.getState().sessions;
    useChatStore.getState().openMini();
    useChatStore.getState().minimizeMini();

    let state = useChatStore.getState();
    expect(state.mini).toEqual({ open: false, minimized: true });
    expect(state.activeSessionId).toBe("session-a");
    expect(state.sessions).toBe(sessions);

    state.openMini();
    state = useChatStore.getState();
    expect(state.mini).toEqual({ open: true, minimized: false });
    expect(state.activeSessionId).toBe("session-a");
  });

  it("does not cancel or reset an active run when minimized", () => {
    const responder = () => undefined;
    useChatStore.setState({
      approvalResponder: responder,
      sessions: [
        {
          id: "session-a",
          title: "Active run",
          createdAt: 1,
          updatedAt: 2,
          run: {
            state: "running",
            agentId: "builtin:coder",
            startedAt: 2,
          },
        },
      ],
      agentMeta: {
        ...useChatStore.getState().agentMeta,
        status: "streaming",
      },
    });

    useChatStore.getState().minimizeMini();

    const state = useChatStore.getState();
    expect(state.sessions[0].run?.state).toBe("running");
    expect(state.agentMeta.status).toBe("streaming");
    expect(state.approvalResponder).toBe(responder);
  });

  it("preserves a completed run while the transcript is minimized", () => {
    useChatStore.getState().beginRun("session-a", "builtin:coder");
    useChatStore.getState().minimizeMini();
    useChatStore.getState().finishRun("session-a", "completed");

    const state = useChatStore.getState();
    expect(state.mini).toEqual({ open: false, minimized: true });
    expect(state.sessions[0].run?.state).toBe("completed");
    expect(state.sessions[0].run?.agentId).toBe("builtin:coder");
  });

  it("keeps a minimized approval pending until the user restores chat", () => {
    useChatStore.setState({
      mini: { open: false, minimized: true },
      pendingApprovalsBySession: {
        "session-a": [
          {
            id: "approval-a",
            sessionId: "session-a",
            toolName: "write_file",
            input: { path: "README.md" },
          },
        ],
      },
    });

    useChatStore.getState().showApprovalAttention();

    const state = useChatStore.getState();
    expect(state.mini).toEqual({ open: false, minimized: true });
    expect(state.pendingApprovalsBySession["session-a"][0].id).toBe(
      "approval-a",
    );
  });
});
