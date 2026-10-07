import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { mcpClient, type McpConfig } from "@/modules/ai/lib/mcpConnections";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
const config: McpConfig = {
  name: "Example",
  transport: "remote-http",
  endpoint: "https://example.com/mcp",
  scope: "conversation",
  agents: ["builtin:coder"],
  conversations: ["chat"],
  useCredential: true,
};

it("connection actions always carry the owning conversation and CAS revision to native consent", async () => {
  const client = mcpClient("chat");
  await client.load();
  expect(invoke).toHaveBeenLastCalledWith("mcp_connections_load", {
    sessionId: "chat",
  });
  await client.change(4, { action: "create", config });
  expect(invoke).toHaveBeenLastCalledWith("mcp_connection_change", {
    sessionId: "chat",
    expectedRevision: 4,
    change: { action: "create", config },
  });
  for (const action of ["authorize", "enable", "disable", "revoke"] as const) {
    await client.change(5, { action, id: "mcp-test" });
    expect(invoke).toHaveBeenLastCalledWith("mcp_connection_change", {
      sessionId: "chat",
      expectedRevision: 5,
      change: { action, id: "mcp-test" },
    });
  }
});
it("only explicit connect starts native protocol work and disconnect is scoped", async () => {
  const client = mcpClient("chat");
  expect(invoke).not.toHaveBeenCalled();
  await client.connect("mcp-test", 8);
  expect(invoke).toHaveBeenLastCalledWith("mcp_connection_connect", {
    sessionId: "chat",
    id: "mcp-test",
    expectedRevision: 8,
  });
  await client.disconnect("mcp-test");
  expect(invoke).toHaveBeenLastCalledWith("mcp_connection_disconnect", {
    sessionId: "chat",
    id: "mcp-test",
  });
});
it("credentials use a separate native consent boundary, never ordinary connection configuration", async () => {
  const client = mcpClient("chat");
  await client.credential("mcp-test", 9, "ephemeral-secret");
  expect(invoke).toHaveBeenLastCalledWith("mcp_connection_credential", {
    sessionId: "chat",
    id: "mcp-test",
    expectedRevision: 9,
    password: "ephemeral-secret",
  });
  await client.credential("mcp-test", 9, null);
  expect(invoke).toHaveBeenLastCalledWith("mcp_connection_credential", {
    sessionId: "chat",
    id: "mcp-test",
    expectedRevision: 9,
    password: null,
  });
  expect(JSON.stringify(config)).not.toContain("ephemeral-secret");
});
it("native consent denial and stale configuration errors propagate without retry", async () => {
  vi.mocked(invoke).mockRejectedValueOnce("mcp-native-consent-required");
  await expect(mcpClient("chat").connect("mcp-test", 1)).rejects.toBe(
    "mcp-native-consent-required",
  );
  expect(invoke).toHaveBeenCalledTimes(1);
});
