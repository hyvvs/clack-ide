import { invoke } from "@tauri-apps/api/core";

export type McpConfig = {
  name: string;
  transport: "remote-http" | "local-native";
  endpoint: string;
  scope: "conversation" | "agent" | "workspace";
  agents: string[];
  conversations: string[];
  useCredential: boolean;
};
export type McpConnection = {
  id: string;
  workspaceId: string;
  current: {
    revision: number;
    config: McpConfig;
    credentialRef: string | null;
    authorized: boolean;
    enabled: boolean;
    updatedAt: number;
  };
  discovery: null | {
    revision: number;
    hash: string;
    server: { name: string; version: string };
    tools: [string, string][];
  };
  status: string;
  credentialAvailable: boolean;
  assigned: boolean;
};
export type McpView = { revision: number; connections: McpConnection[] };
export type McpChange =
  | { action: "create"; config: McpConfig }
  | { action: "edit"; id: string; config: McpConfig }
  | { action: "authorize" | "enable" | "disable" | "revoke"; id: string };
export type McpProvenance = {
  connectionId: string;
  revision: number;
  discovery: string;
  tool: string;
  toolHash: string;
  endpoint: string;
  credentialRef: string | null;
};

export function mcpClient(sessionId: string) {
  return {
    load: () => invoke<McpView>("mcp_connections_load", { sessionId }),
    change: (expectedRevision: number, change: McpChange) =>
      invoke<McpView>("mcp_connection_change", {
        sessionId,
        expectedRevision,
        change,
      }),
    connect: (id: string, expectedRevision: number) =>
      invoke<McpView>("mcp_connection_connect", {
        sessionId,
        id,
        expectedRevision,
      }),
    disconnect: (id: string) =>
      invoke<void>("mcp_connection_disconnect", { sessionId, id }),
    credential: (
      id: string,
      expectedRevision: number,
      password: string | null,
    ) =>
      invoke<void>("mcp_connection_credential", {
        sessionId,
        id,
        expectedRevision,
        password,
      }),
  };
}
