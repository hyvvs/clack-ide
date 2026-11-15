import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { buildRuntimeTools } from "@/modules/ai/tools/customExecution";
import { executeCustomTool } from "@/modules/ai/lib/customToolExecution";
import {
  newToolDefinition,
  type ToolEntry,
} from "@/modules/ai/lib/customTools";
import { serializedToolSchemas } from "@/modules/ai/lib/requestPreflight";
import { prepareToolExposure } from "@/modules/ai/lib/toolExposure";
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

it("catalog discovery sees only current authorized tool identities and cannot execute or reveal schema/credentials", async () => {
  const { ctx, entry } = fixture();
  entry.current.definition.binding = { kind: "mcp", server: "mcp-server-one",
    tool: "find_issue", connectionRevision: 4,
    discovery: "a".repeat(64), toolHash: "b".repeat(64) };
  entry.current.definition.description = "Find issue tracker records";
  entry.current.definition.permissions = ["network"];
  entry.current.definition.credentialRef = "keyring:mcp:never-expose";
  const available = await buildRuntimeTools(ctx);
  expect(available.discover_capabilities).toBeDefined();
  const result = await available.discover_capabilities.execute?.({
    query: "issue tracker", limit: 8,
  }, { toolCallId: "discover", messages: [] });
  expect(result).toMatchObject({ status: "found",
    capabilities: [expect.objectContaining({
      tool: entry.current.definition.name, source: "remote-mcp",
      effectClass: "unknown", permissionClass: "external-effect",
    })],
  });
  expect(JSON.stringify(result)).not.toContain("keyring:");
  expect(JSON.stringify(result)).not.toContain("inputSchema");
  expect(JSON.stringify(result)).not.toContain("endpoint");
  expect(executeCustomTool).not.toHaveBeenCalled();
  entry.current.status = "revoked";
  const revoked = await buildRuntimeTools(ctx);
  const missing = await revoked.discover_capabilities.execute?.({
    query: "issue tracker", limit: 8,
  }, { toolCallId: "discover-revoked", messages: [] });
  expect(missing).toMatchObject({ status: "not-configured", capabilities: [] });
});

it("a stale captured discovery tool cannot reveal capabilities in a new run", async () => {
  const { ctx } = fixture();
  const available = await buildRuntimeTools(ctx);
  ctx.getRunId = () => 2;
  const result = await available.discover_capabilities.execute?.({
    query: "read_file", limit: 3,
  }, { toolCallId: "old-run", messages: [] });
  expect(result).toMatchObject({ status: "unavailable", code: "run-changed" });
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

it.each([
  "disconnected",
  "revoked",
  "unassigned",
  "stale-schema",
])("F1 never selects MCP %s definitions or starts discovery", async (reason) => {
  const { ctx, entry } = fixture();
  entry.current.definition.description = "Weather forecast MCP";
  entry.current.definition.binding = {
    kind: "mcp",
    server: "mcp-test",
    tool: "weather",
    connectionRevision: 3,
    discovery: "b".repeat(64),
    toolHash: "c".repeat(64),
  };
  entry.current.definition.permissions = ["network"];
  if (reason === "disconnected") entry.executable = false;
  if (reason === "revoked") entry.current.status = "revoked";
  if (reason === "unassigned") entry.current.definition.agents = ["other"];
  if (reason === "stale-schema") entry.current.version++;
  const selected = await prepareToolExposure(await buildRuntimeTools(ctx), {
    context: ctx,
    target: "model",
    messages: [{ role: "user", content: "Weather forecast MCP" }],
  });
  expect(selected.names).not.toContain(entry.current.definition.name);
  expect(
    vi
      .mocked(invoke)
      .mock.calls.every(([command]) => command === "custom_tools_load"),
  ).toBe(true);
  expect(executeCustomTool).not.toHaveBeenCalled();
});
it("F1 retains exact guarded WASI/MCP executors and version metadata without authority changes", async () => {
  const { ctx, entry, reference } = fixture();
  const input = { path: "literal data" };
  vi.mocked(executeCustomTool).mockResolvedValue({
    state: "succeeded",
    result: true,
    effect: "reported",
  } as Awaited<ReturnType<typeof executeCustomTool>>);
  for (const binding of [
    {
      kind: "wasi" as const,
      schemaVersion: 1 as const,
      hash: "b".repeat(64),
      abi: "wasi-preview1-json-v1" as const,
      export: "_start" as const,
      runtime: "clack-wasi-1" as const,
    },
    {
      kind: "mcp" as const,
      server: "mcp-test",
      tool: "weather",
      connectionRevision: 3,
      discovery: "b".repeat(64),
      toolHash: "c".repeat(64),
    },
  ]) {
    entry.current.definition.binding = binding;
    entry.current.definition.description = "Weather checksum";
    entry.current.definition.permissions =
      binding.kind === "mcp" ? ["network"] : ["run-commands"];
    const permitted = await buildRuntimeTools(ctx);
    const selected = await prepareToolExposure(permitted, {
      context: ctx,
      target: "model",
      messages: [{ role: "user", content: "Weather checksum" }],
    });
    const executor = selected.tools[entry.current.definition.name];
    expect(executor).toBe(permitted[entry.current.definition.name]);
    await executor.execute?.(input, { toolCallId: "call", messages: [] });
    expect(executeCustomTool).toHaveBeenLastCalledWith(
      expect.objectContaining({ tool: reference, arguments: input, runId: 1 }),
    );
  }
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

it("WASI functions contribute only their captured callable schema to B1", async () => {
  const { ctx, entry, reference } = fixture();
  entry.current.definition.binding = {
    kind: "wasi",
    schemaVersion: 1,
    hash: "b".repeat(64),
    abi: "wasi-preview1-json-v1",
    export: "_start",
    runtime: "clack-wasi-1",
  };
  entry.current.definition.permissions = ["run-commands"];
  vi.mocked(executeCustomTool).mockResolvedValue({
    state: "succeeded",
    result: { answer: 4 },
    effect: "none",
  } as Awaited<ReturnType<typeof executeCustomTool>>);
  const tools = await buildRuntimeTools(ctx);
  const schemas = JSON.stringify(
    await serializedToolSchemas({
      [entry.current.definition.name]: tools[entry.current.definition.name],
    }),
  );
  expect(schemas).toContain(entry.current.definition.name);
  expect(schemas).not.toContain("clack-wasi-1");
  await tools[entry.current.definition.name].execute?.(
    { path: "literal data" },
    { toolCallId: "function-call", messages: [] },
  );
  expect(executeCustomTool).toHaveBeenCalledWith(
    expect.objectContaining({
      tool: reference,
      arguments: { path: "literal data" },
    }),
  );
});

it.each([
  "unverified-runtime",
  "chat-only",
  "read-only-task",
])("WASI %s is not a callable tool even with a valid module", async (reason) => {
  const { ctx, entry } = fixture();
  entry.current.definition.binding = {
    kind: "wasi",
    schemaVersion: 1,
    hash: "b".repeat(64),
    abi: "wasi-preview1-json-v1",
    export: "_start",
    runtime: "clack-wasi-1",
  };
  entry.current.definition.permissions = ["run-commands"];
  if (reason === "unverified-runtime") entry.executable = false;
  if (reason === "chat-only")
    usePreferencesStore.setState({
      agentPermissionProfiles: {
        "builtin:coder": { mode: "chat-only", categories: {} },
      },
    });
  const tools = await buildRuntimeTools(
    reason === "read-only-task"
      ? { ...ctx, getMutationMode: () => "read-only" }
      : ctx,
  );
  expect(tools[entry.current.definition.name]).toBeUndefined();
  expect(executeCustomTool).not.toHaveBeenCalled();
});
