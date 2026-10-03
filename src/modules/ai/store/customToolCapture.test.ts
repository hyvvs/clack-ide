import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { captureSessionTools } from "@/modules/ai/store/customToolCapture";
import { newToolDefinition } from "@/modules/ai/lib/customTools";
import {
  createConversationProfile,
  saveSessionsList,
} from "@/modules/ai/lib/sessions";
import type { ToolContext } from "@/modules/ai/tools/context";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));
vi.mock("@/modules/ai/lib/sessions", async (original) => ({
  ...(await original<typeof import("@/modules/ai/lib/sessions")>()),
  saveSessionsList: vi.fn().mockResolvedValue(undefined),
  awaitSessionWrites: vi.fn().mockResolvedValue(undefined),
}));
const baseline = useChatStore.getState();
const ctx = {
  getAgentId: () => "builtin:coder",
  getSessionId: () => "a",
  getCwd: () => "/work/a",
  getWorkspaceRoot: () => "/work/a",
} as ToolContext;
beforeEach(() => {
  vi.clearAllMocks();
  useChatStore.setState({
    sessions: [
      {
        id: "a",
        title: "a",
        createdAt: 1,
        updatedAt: 1,
        profile: createConversationProfile({
          agentId: "builtin:coder",
          modelId: "gpt-5.4-mini",
          workspaceRoot: "/work/a",
        }),
        run: { state: "running", startedAt: 1, agentId: "builtin:coder" },
      },
    ],
  });
  vi.mocked(invoke).mockResolvedValue({
    schemaVersion: 1,
    revision: 1,
    entries: [
      {
        id: "tool-a",
        workspaceId: "local:/work/a",
        current: {
          version: 1,
          hash: "a".repeat(64),
          status: "authorized",
          enabled: true,
          definition: newToolDefinition("builtin:coder", "a"),
        },
      },
    ],
  });
});
afterEach(() => useChatStore.setState(baseline));
describe("run-owned custom definition capture", () => {
  it("captures once, persists version references and keeps them through later edits", async () => {
    await captureSessionTools("a", ctx);
    const captured = useChatStore.getState().sessions[0].run?.customTools;
    expect(captured?.versions).toEqual([
      { id: "tool-a", version: 1, hash: "a".repeat(64) },
    ]);
    expect(saveSessionsList).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("custom_tools_load", {
      sessionId: "a",
      eligibleOnly: true,
    });
    expect(
      JSON.parse(JSON.stringify(useChatStore.getState().sessions))[0].run
        .customTools,
    ).toEqual(captured);
    vi.mocked(invoke).mockResolvedValue({
      schemaVersion: 1,
      revision: 2,
      entries: [],
    });
    await captureSessionTools("a", ctx);
    expect(useChatStore.getState().sessions[0].run?.customTools).toBe(captured);
    expect(invoke).toHaveBeenCalledOnce();
  });
  it("corruption blocks custom availability without breaking built-in runs", async () => {
    vi.mocked(invoke).mockRejectedValue(Error("corrupt"));
    await captureSessionTools("a", ctx);
    expect(useChatStore.getState().sessions[0].run?.customTools).toEqual({
      revision: null,
      versions: [],
      unavailable: true,
    });
  });
  it("a stale asynchronous capture cannot attach to a replacement run", async () => {
    let complete: (value: unknown) => void = () => {};
    vi.mocked(invoke).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const pending = captureSessionTools("a", ctx);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    useChatStore.setState({
      sessions: useChatStore.getState().sessions.map((s) => ({
        ...s,
        run: { state: "running", startedAt: 2 },
      })),
    });
    complete({ schemaVersion: 1, revision: 1, entries: [] });
    await pending;
    expect(
      useChatStore.getState().sessions[0].run?.customTools,
    ).toBeUndefined();
  });
});
