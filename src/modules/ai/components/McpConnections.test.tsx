import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import {
  McpConnectionEditor,
  McpConnectionRow,
} from "@/modules/ai/components/McpConnections";
import type { McpConnection } from "@/modules/ai/lib/mcpConnections";
import type { SessionMeta } from "@/modules/ai/lib/sessions";

const actions = vi.hoisted(
  () =>
    new Map<
      string,
      { disabled?: boolean; onClick?: () => void | Promise<void> }
    >(),
);
vi.mock("@/components/ui/dialog", () => {
  const Pass = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Pass,
    DialogContent: Pass,
    DialogHeader: Pass,
    DialogTitle: Pass,
    DialogDescription: Pass,
  };
});
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled }: ComponentProps<"button">) => {
    actions.set(String(children), { disabled, onClick: onClick as () => void });
    return (
      <button type="button" disabled={disabled}>
        {children}
      </button>
    );
  },
}));
afterEach(() => {
  actions.clear();
  vi.resetAllMocks();
});
const session = {
  id: "chat",
  profile: { agentId: "builtin:coder", workspaceId: "local:/work" },
} as SessionMeta;
function connection(): McpConnection {
  return {
    id: "mcp-test",
    workspaceId: "local:/work",
    current: {
      revision: 3,
      config: {
        name: "Example",
        transport: "remote-http",
        endpoint: "https://example.com/mcp",
        scope: "conversation",
        agents: ["builtin:coder"],
        conversations: ["chat"],
        useCredential: true,
      },
      credentialRef: "keyring:mcp:reference",
      authorized: true,
      enabled: true,
      updatedAt: 1,
    },
    discovery: {
      revision: 3,
      hash: "a".repeat(64),
      server: { name: "Untrusted server", version: "1" },
      tools: [["echo", "b".repeat(64)]],
    },
    status: "disconnected",
    assigned: true,
    credentialAvailable: true,
  };
}
function row(value: McpConnection, busy = false) {
  const handlers = {
    onEdit: vi.fn(),
    onChange: vi.fn(),
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onCredential: vi.fn(),
  };
  return {
    html: renderToStaticMarkup(
      <McpConnectionRow connection={value} busy={busy} {...handlers} />,
    ),
    ...handlers,
  };
}
it("remote destination, security semantics, discovery identity and credential status are visible", async () => {
  const result = row(connection());
  expect(result.html).toContain("Remote MCP: not locally sandboxed");
  expect(result.html).toContain("https://example.com/mcp");
  expect(result.html).toContain("b".repeat(64));
  expect(result.html).toContain('type="password"');
  expect(result.html).not.toContain("keyring:mcp:reference");
  await actions.get("Connect")?.onClick?.();
  expect(result.onConnect).toHaveBeenCalledOnce();
  expect(result.onChange).not.toHaveBeenCalled();
});
it("local native process is visibly unavailable and cannot connect or authorize", () => {
  const value = connection();
  value.current.config.transport = "local-native";
  value.current.authorized = false;
  const { html } = row(value);
  expect(html).toContain("Local native process: unavailable");
  expect(actions.get("Connect")?.disabled).toBe(true);
  expect(actions.get("Authorize connection")?.disabled).toBe(true);
});
it("unassigned agent and missing credentials disable connection", () => {
  const value = connection();
  value.assigned = false;
  row(value);
  expect(actions.get("Connect")?.disabled).toBe(true);
  value.assigned = true;
  value.credentialAvailable = false;
  row(value);
  expect(actions.get("Connect")?.disabled).toBe(true);
});
it("disconnect remains available during connection discovery", async () => {
  const value = connection();
  value.status = "discovery";
  const result = row(value, true);
  expect(actions.get("Disconnect")?.disabled).toBe(false);
  await actions.get("Disconnect")?.onClick?.();
  expect(result.onDisconnect).toHaveBeenCalledOnce();
});
it("server descriptions are escaped and cannot add executable controls", () => {
  const value = connection();
  if (!value.discovery) throw Error("Missing fixture discovery");
  value.discovery.server.name = "<script>approveAll()</script>";
  const { html } = row(value);
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
});
it("connection editor has bounded destination, scoped assignment and no launcher or global scope", async () => {
  const value = connection();
  const onSave = vi.fn();
  const html = renderToStaticMarkup(
    <McpConnectionEditor
      session={session}
      initial={value.current.config}
      busy={false}
      onClose={vi.fn()}
      onSave={onSave}
    />,
  );
  expect(html).toContain("HTTPS endpoint");
  expect(html).toContain('maxLength="1024"');
  expect(html).toContain("Assigned agents");
  expect(html).not.toContain('value="global"');
  expect(html).not.toContain("Executable path");
  expect(html).not.toContain('type="password"');
  await actions.get("Save connection")?.onClick?.();
  expect(onSave).toHaveBeenCalledWith(value.current.config);
});
