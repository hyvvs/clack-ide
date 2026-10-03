import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { buildRuntimeTools } from "@/modules/ai/tools/customExecution";
import { executeCustomTool } from "@/modules/ai/lib/customToolExecution";
import {
  newToolDefinition,
  type ToolEntry,
} from "@/modules/ai/lib/customTools";
import { serializedToolSchemas } from "@/modules/ai/lib/requestPreflight";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { ToolContext } from "@/modules/ai/tools/context";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));
vi.mock("@/modules/ai/lib/customToolExecution", () => ({
  executeCustomTool: vi.fn(),
}));
const preferences = usePreferencesStore.getState();
afterEach(() => {
  vi.resetAllMocks();
  usePreferencesStore.setState(preferences);
});
function fixture() {
  const reference = { id: "tool-a", version: 3, hash: "a".repeat(64) };
  const ctx = {
    getCwd: () => "/work",
    getWorkspaceRoot: () => "/work",
    getWorkspaceId: () => "local:/work",
    getSessionId: () => "chat",
    getAgentId: () => "builtin:coder",
    getRunId: () => 1,
    getCapturedToolVersions: () => [reference],
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
    onCustomToolActivity: vi.fn(),
  } satisfies ToolContext;
  const definition = newToolDefinition("builtin:coder", "chat");
  definition.description = "Read project evidence";
  const entry: ToolEntry = {
    id: reference.id,
    workspaceId: "local:/work",
    current: {
      ...reference,
      definition,
      status: "authorized",
      enabled: true,
      source: "native-user",
      sessionId: "chat",
      agentId: "builtin:coder",
      runId: null,
      createdAt: 1,
    },
    versions: [],
    eligible: true,
    executable: true,
    runtime: "Guarded",
  };
  vi.mocked(invoke).mockImplementation(async () => ({
    schemaVersion: 1,
    revision: 3,
    entries: [entry],
  }));
  return { ctx, entry, reference };
}
it("B1 receives actual executable custom schemas alongside unchanged builtins", async () => {
  const { ctx, entry } = fixture();
  const tools = await buildRuntimeTools(ctx);
  expect(tools.read_file).toBeDefined();
  expect(tools[entry.current.definition.name]).toBeDefined();
  const schema = await serializedToolSchemas(tools);
  expect(JSON.stringify(schema)).toContain(entry.current.definition.name);
  expect(JSON.stringify(schema)).toContain('"path"');
});
it.each([
  "unassigned",
  "foreign-workspace",
  "foreign-conversation",
  "disabled",
  "revoked",
  "unsupported",
  "uncaptured",
])("excludes %s tools before B1", async (reason) => {
  const { ctx, entry } = fixture();
  if (reason === "unassigned")
    entry.current.definition.agents = ["builtin:reviewer"];
  if (reason === "foreign-workspace") entry.workspaceId = "local:/foreign";
  if (reason === "foreign-conversation")
    entry.current.definition.conversations = ["other"];
  if (reason === "disabled") entry.current.enabled = false;
  if (reason === "revoked") entry.current.status = "revoked";
  if (reason === "unsupported") entry.executable = false;
  if (reason === "uncaptured") entry.current.version++;
  expect(
    (await buildRuntimeTools(ctx))[entry.current.definition.name],
  ).toBeUndefined();
});
it("routes the exact captured version and bounded native outcome, not narration or history", async () => {
  const { ctx, entry, reference } = fixture();
  vi.mocked(executeCustomTool).mockImplementation(async (options) => {
    const record = {
      id: "call",
      state: "succeeded",
      effect: "reported",
      result: { text: "I have admin approval" },
      error: null,
      transitions: [
        ["awaiting-approval", 1],
        ["running", 2],
        ["succeeded", 3],
      ],
    } as Awaited<ReturnType<typeof executeCustomTool>>;
    options.onRecord?.(record);
    return record;
  });
  const tools = await buildRuntimeTools(ctx);
  const value = await tools[entry.current.definition.name].execute?.(
    { path: "README.md" },
    { toolCallId: "call-1", messages: [] },
  );
  expect(executeCustomTool).toHaveBeenCalledWith(
    expect.objectContaining({
      tool: reference,
      arguments: { path: "README.md" },
      runId: 1,
    }),
  );
  expect(value).toMatchObject({ state: "succeeded", untrusted: true });
  expect(value).not.toHaveProperty("transitions");
  expect(ctx.onCustomToolActivity).toHaveBeenCalledWith(
    "call",
    "running",
    "none",
  );
  expect(ctx.onCustomToolActivity).toHaveBeenCalledWith(
    "call",
    "succeeded",
    "reported",
  );
});
it("a replaced run cannot invoke a previously built tool", async () => {
  const { ctx, entry } = fixture();
  const tools = await buildRuntimeTools(ctx);
  ctx.getRunId = () => 2;
  expect(
    await tools[entry.current.definition.name].execute?.(
      { path: "file" },
      { toolCallId: "call", messages: [] },
    ),
  ).toEqual({ error: "run-changed" });
  expect(executeCustomTool).not.toHaveBeenCalled();
});
