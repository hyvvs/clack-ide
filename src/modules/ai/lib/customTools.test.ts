import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  captureToolVersions,
  customToolsClient,
  definitionEligibility,
  newToolDefinition,
  type ToolEntry,
  type ToolRegistryView,
} from "@/modules/ai/lib/customTools";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { buildTools } from "@/modules/ai/tools/tools";
import { serializedToolSchemas } from "@/modules/ai/lib/requestPreflight";
import {
  measureRequest,
  resolveContextBudget,
} from "@/modules/ai/lib/contextBudget";
import type { ToolContext } from "@/modules/ai/tools/context";
import { buildCustomToolProposals } from "@/modules/ai/tools/custom";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));
const preferences = usePreferencesStore.getState();
afterEach(() => {
  usePreferencesStore.setState(preferences);
  vi.clearAllMocks();
});
function context(): ToolContext {
  return {
    getCwd: () => "/work/a",
    getWorkspaceRoot: () => "/work/a",
    getWorkspaceId: () => "local:/work/a",
    getSessionId: () => "chat-a",
    getAgentId: () => "builtin:coder",
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
  };
}
function entry(): ToolEntry {
  const definition = newToolDefinition("builtin:coder", "chat-a");
  definition.description = "Read input";
  return {
    id: "tool-a",
    workspaceId: "local:/work/a",
    current: {
      version: 1,
      hash: "a".repeat(64),
      definition,
      status: "authorized",
      enabled: true,
      source: "native-user",
      sessionId: "chat-a",
      agentId: "builtin:coder",
      runId: null,
      createdAt: 1,
    },
    versions: [],
    eligible: true,
    executable: false,
    runtime: "Execution support pending T2/T3",
  };
}
const view = (entries = [entry()]): ToolRegistryView => ({
  schemaVersion: 1,
  revision: 1,
  entries,
});

describe("T1 definitions and permission intersection", () => {
  it("defaults to the current conversation and agent without global grants", () => {
    const d = newToolDefinition("a", "s");
    expect(d.scope).toBe("conversation");
    expect(d.agents).toEqual(["a"]);
    expect(d.conversations).toEqual(["s"]);
    expect(d.credentialRef).toBeNull();
  });
  it.each([
    "draft",
    "proposed",
    "revoked",
    "removed",
  ] as const)("%s is not eligible", (status) => {
    const e = entry();
    e.current.status = status;
    expect(definitionEligibility(e, e.workspaceId, context()).eligible).toBe(
      false,
    );
  });
  it("disabled, unassigned, foreign conversation and foreign workspace are denied", () => {
    const e = entry();
    e.current.enabled = false;
    expect(captureToolVersions(view([e]), e.workspaceId, context())).toEqual(
      [],
    );
    e.current.enabled = true;
    for (const ctx of [
      { ...context(), getAgentId: () => "other" },
      { ...context(), getSessionId: () => "other" },
    ])
      expect(definitionEligibility(e, e.workspaceId, ctx).eligible).toBe(false);
    expect(definitionEligibility(e, "local:/work/b", context()).eligible).toBe(
      false,
    );
  });
  it.each([
    "ask",
    "trusted-workspace",
    "full-access",
    "custom",
  ] as const)("%s preserves existing policy without manufacturing an executable runtime", (mode) => {
    usePreferencesStore.setState({
      agentPermissionProfiles: { "builtin:coder": { mode, categories: {} } },
    });
    const e = entry();
    expect(definitionEligibility(e, e.workspaceId, context()).eligible).toBe(
      true,
    );
    expect(e.executable).toBe(false);
  });
  it("Chat Only denies even user-authorized globally available definitions", () => {
    usePreferencesStore.setState({
      agentPermissionProfiles: {
        "builtin:coder": { mode: "chat-only", categories: {} },
      },
    });
    const e = entry();
    e.current.definition.scope = "global";
    expect(definitionEligibility(e, "local:/work/b", context()).eligible).toBe(
      false,
    );
  });
  it("unknown capabilities and read-only peer lanes never gain write or network authority", () => {
    const e = entry();
    e.current.definition.permissions = ["network"];
    expect(definitionEligibility(e, e.workspaceId, context()).approval).toBe(
      true,
    );
    expect(
      definitionEligibility(e, e.workspaceId, {
        ...context(),
        getMutationMode: () => "read-only",
      }).eligible,
    ).toBe(false);
    e.current.definition.permissions = ["grant-everything"];
    expect(definitionEligibility(e, e.workspaceId, context()).eligible).toBe(
      false,
    );
  });
  it("frozen references survive edits and registration revocation removes future eligibility", () => {
    const e = entry();
    const captured = captureToolVersions(view([e]), e.workspaceId, context());
    e.current.version = 2;
    e.current.hash = "b".repeat(64);
    e.current.definition.agents = ["other"];
    expect(captured).toEqual([
      { id: "tool-a", version: 1, hash: "a".repeat(64) },
    ]);
    expect(captureToolVersions(view([e]), e.workspaceId, context())).toEqual(
      [],
    );
    e.current.status = "revoked";
    expect(captureToolVersions(view([e]), e.workspaceId, context())).toEqual(
      [],
    );
  });
  it("native registration requests have no frontend approval boolean", async () => {
    await customToolsClient("a").change(7, {
      action: "authorize",
      id: "tool-a",
    });
    expect(invoke).toHaveBeenCalledWith("custom_tools_change", {
      sessionId: "a",
      expectedRevision: 7,
      change: { action: "authorize", id: "tool-a" },
    });
  });
  it("WASI import uses the native picker without accepting paths, bytes or approval", async () => {
    const definition = newToolDefinition("builtin:coder", "chat-a");
    await customToolsClient("chat-a").importWasi(4, definition, "tool-a");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("custom_tools_import_wasi", {
      sessionId: "chat-a",
      expectedRevision: 4,
      definition,
      toolId: "tool-a",
    });
  });
  it("agent proposals cannot reach the WASI import or authorization commands", async () => {
    const definition = entry().current.definition;
    definition.binding = {
      kind: "wasi",
      schemaVersion: 1,
      hash: "a".repeat(64),
      abi: "wasi-preview1-json-v1",
      export: "_start",
      runtime: "clack-wasi-1",
    };
    definition.permissions = ["run-commands"];
    vi.mocked(invoke)
      .mockResolvedValueOnce(view())
      .mockResolvedValueOnce({ status: "proposed" });
    const tools = buildCustomToolProposals(context());
    await tools.propose_custom_tool.execute?.(
      { definitionJson: JSON.stringify(definition) },
      { toolCallId: "p", messages: [] },
    );
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      "custom_tools_load",
      "custom_tools_propose",
    ]);
  });
  it("all unavailable custom executable schemas are absent from the real built-in registry", async () => {
    const tools = buildTools(context());
    expect(tools).toHaveProperty("read_file");
    expect(tools).toHaveProperty("propose_custom_tool");
    expect(tools).not.toHaveProperty("custom_tool");
    expect(JSON.stringify(await serializedToolSchemas(tools))).not.toContain(
      '"custom_tool"',
    );
  });
  it("B1 counts the actual proposal schema; a small context can reject its exposure", async () => {
    const tools = buildCustomToolProposals(context());
    const schemas = await serializedToolSchemas(tools);
    const cost = measureRequest({ tools: schemas, system: [], messages: [] });
    expect(cost.tools).toBeGreaterThan(0);
    expect(resolveContextBudget({ reported: 4096 }, cost).working).toBeLessThan(
      resolveContextBudget({ reported: 4096 }).working,
    );
    const limit = resolveContextBudget({ reported: 4096 }, cost);
    expect(
      resolveContextBudget(
        { reported: 4096 },
        { ...cost, conversation: limit.working + 1 },
      ).fits,
    ).toBe(false);
  });
  it("unbound contexts do not expose a proposal tool", () =>
    expect(
      buildCustomToolProposals({ ...context(), getWorkspaceId: () => null }),
    ).toEqual({}));
  it("agent proposal submits only a definition and native revision, never a registration", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(view())
      .mockResolvedValueOnce({ status: "proposed" });
    const tools = buildCustomToolProposals(context());
    await tools.propose_custom_tool.execute?.(
      { definitionJson: JSON.stringify(entry().current.definition) },
      { toolCallId: "p", messages: [] },
    );
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      "custom_tools_load",
      "custom_tools_propose",
    ]);
  });
});
