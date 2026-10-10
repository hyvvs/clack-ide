import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { loadChatToolSummary } from "@/modules/ai/lib/chatToolSummary";
import {
  newToolDefinition,
  type ToolEntry,
} from "@/modules/ai/lib/customTools";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/modules/ai/tools/tools", () => ({
  buildTools: () => ({ read_file: {}, write_file: {} }),
}));
vi.mock("@/modules/ai/store/chatRuntime", () => ({
  sessionToolContext: () => ({
    toolContext: {
      getAgentId: () => "agent",
      getSessionId: () => "a",
      getWorkspaceId: () => "local:/a",
      getWorkspaceRoot: () => "/a",
      getCwd: () => "/a",
    },
  }),
}));
const chat = useChatStore.getState();
const settings = usePreferencesStore.getState();
let entry: ToolEntry;
beforeEach(() => {
  useChatStore.setState({
    sessions: [
      {
        id: "a",
        title: "Private A",
        createdAt: 1,
        updatedAt: 1,
        profile: {
          agentId: "agent",
          workspaceId: "local:/a",
          workspaceRoot: "/a",
          modelId: "gpt-5.4-mini",
        },
      },
    ],
  });
  usePreferencesStore.setState({
    agentPermissionProfiles: { agent: { mode: "ask", categories: {} } },
    agentWorkspacePermissions: [],
  });
  const definition = {
    ...newToolDefinition("agent", "a"),
    name: "Assigned",
    permissions: ["write-files"],
  };
  entry = {
    id: "tool",
    workspaceId: "local:/a",
    current: {
      definition,
      version: 1,
      hash: "a".repeat(64),
      status: "authorized",
      enabled: true,
      source: "native-user",
      sessionId: "a",
      agentId: "agent",
      runId: null,
      createdAt: 1,
    },
    versions: [],
    eligible: true,
    executable: true,
    runtime: "Native",
  };
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "custom_tools_load"
      ? { schemaVersion: 1, revision: 1, entries: [entry] }
      : { revision: 1, connections: [] },
  );
});
afterEach(() => {
  useChatStore.setState(chat, true);
  usePreferencesStore.setState(settings, true);
  vi.clearAllMocks();
});
it("loads only conversation-scoped native metadata and intersects approval policy without executing", async () => {
  const summary = await loadChatToolSummary("a");
  expect(summary.custom).toMatchObject([
    { name: "Assigned", available: true, approval: true },
  ]);
  expect(summary.builtin).toEqual([
    { name: "read_file", decision: "allow" },
    { name: "write_file", decision: "prompt" },
  ]);
  expect(invoke).toHaveBeenCalledWith("custom_tools_load", {
    sessionId: "a",
    eligibleOnly: true,
  });
  expect(invoke).toHaveBeenCalledWith("mcp_connections_load", {
    sessionId: "a",
  });
  expect(
    vi
      .mocked(invoke)
      .mock.calls.every(([name]) => String(name).endsWith("load")),
  ).toBe(true);
});
it.each([
  "unsupported",
  "other-agent",
  "other-workspace",
  "other-conversation",
  "chat-only",
])("keeps %s tools unavailable", async (reason) => {
  if (reason === "unsupported") {
    entry.executable = false;
    entry.runtime = "Native launcher unsupported";
  }
  if (reason === "other-agent") entry.current.definition.agents = ["other"];
  if (reason === "other-workspace") entry.workspaceId = "local:/b";
  if (reason === "other-conversation")
    entry.current.definition.conversations = ["b"];
  if (reason === "chat-only")
    usePreferencesStore.setState({
      agentPermissionProfiles: { agent: { mode: "chat-only", categories: {} } },
    });
  expect((await loadChatToolSummary("a")).custom?.[0].available).toBe(false);
});
it("keeps unavailable registries explicit and never falls back to another conversation", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("Unavailable"));
  expect(await loadChatToolSummary("a")).toMatchObject({
    custom: null,
    connections: null,
  });
  vi.clearAllMocks();
  await expect(loadChatToolSummary("missing")).rejects.toThrow(
    "owner unavailable",
  );
  expect(invoke).not.toHaveBeenCalled();
});
