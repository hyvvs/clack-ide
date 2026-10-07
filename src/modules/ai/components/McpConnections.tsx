import { useCallback, useEffect, useId, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Edit02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAgentsStore } from "@/modules/ai/store/agentsStore";
import type { SessionMeta } from "@/modules/ai/lib/sessions";
import {
  mcpClient,
  type McpConfig,
  type McpConnection,
  type McpView,
  type McpChange,
} from "@/modules/ai/lib/mcpConnections";

export function McpConnections({ session }: { session: SessionMeta }) {
  const [view, setView] = useState<McpView>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<{
    config: McpConfig;
    id?: string;
    revision: number;
  }>();
  const generation = useRef(0);
  const refresh = useCallback(() => {
    const requested = ++generation.current;
    void mcpClient(session.id)
      .load()
      .then((value) => {
        if (requested === generation.current) setView(value);
      })
      .catch(() => {
        if (requested === generation.current) {
          setView(undefined);
          setError("MCP connection registry unavailable.");
        }
      });
  }, [session.id]);
  useEffect(() => {
    refresh();
    const pending = listen("clack:custom-tools-changed", refresh);
    return () => {
      generation.current++;
      void pending.then((stop) => stop());
    };
  }, [refresh]);
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
      refresh();
    }
  };
  const change = (change: McpChange) =>
    run(() => mcpClient(session.id).change(view?.revision ?? -1, change));
  return (
    <section
      aria-label="MCP connections"
      className="min-w-0 space-y-3 border-y py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">MCP connections</h3>
        <Button
          size="sm"
          variant="outline"
          disabled={!view || busy}
          onClick={() => {
            if (!view) return;
            setEditor({
              revision: view.revision,
              config: {
                name: "",
                transport: "remote-http",
                endpoint: "",
                scope: "conversation",
                agents: [session.profile?.agentId ?? "builtin:coder"],
                conversations: [session.id],
                useCredential: false,
              },
            });
          }}
        >
          <HugeiconsIcon icon={Add01Icon} size={14} />
          Add connection
        </Button>
      </div>
      {error && (
        <p role="alert" className="break-words text-xs text-destructive">
          {error}
        </p>
      )}
      {view?.connections.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No configured MCP connections
        </p>
      )}
      <ul className="min-w-0 divide-y">
        {view?.connections.map((connection) => (
          <McpConnectionRow
            key={connection.id}
            connection={connection}
            busy={busy}
            onEdit={() =>
              setEditor({
                id: connection.id,
                revision: view.revision,
                config: structuredClone(connection.current.config),
              })
            }
            onChange={(action) => change({ action, id: connection.id })}
            onConnect={() =>
              run(() =>
                mcpClient(session.id).connect(connection.id, view.revision),
              )
            }
            onDisconnect={() =>
              run(() => mcpClient(session.id).disconnect(connection.id))
            }
            onCredential={(password) =>
              run(() =>
                mcpClient(session.id).credential(
                  connection.id,
                  view.revision,
                  password,
                ),
              )
            }
          />
        ))}
      </ul>
      {editor && (
        <McpConnectionEditor
          session={session}
          initial={editor.config}
          busy={busy}
          error={error}
          onClose={() => setEditor(undefined)}
          onSave={(config) =>
            run(async () => {
              await mcpClient(session.id).change(
                editor.revision,
                editor.id
                  ? { action: "edit", id: editor.id, config }
                  : { action: "create", config },
              );
              setEditor(undefined);
            })
          }
        />
      )}
    </section>
  );
}

export function McpConnectionRow({
  connection,
  busy,
  onEdit,
  onChange,
  onConnect,
  onDisconnect,
  onCredential,
}: {
  connection: McpConnection;
  busy: boolean;
  onEdit: () => void;
  onChange: (
    action: "authorize" | "enable" | "disable" | "revoke",
  ) => Promise<void>;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onCredential: (password: string | null) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const { current, status } = connection;
  const local = current.config.transport === "local-native";
  const connected = ["connecting", "discovery", "ready"].includes(status);
  const credential = (value: string | null) => {
    setPassword("");
    void onCredential(value);
  };
  return (
    <li className="min-w-0 space-y-2 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="break-words text-sm font-medium">
            {current.config.name}{" "}
            <span className="text-muted-foreground">r{current.revision}</span>
          </h4>
          <p className="break-all text-xs">{current.config.endpoint}</p>
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          title="Edit MCP connection"
          aria-label={`Edit ${current.config.name}`}
          disabled={busy}
          onClick={onEdit}
        >
          <HugeiconsIcon icon={Edit02Icon} size={14} />
        </Button>
      </div>
      <p className="text-xs">
        {local
          ? "Local native process: unavailable"
          : "Remote MCP: not locally sandboxed"}
      </p>
      <p className="break-words text-xs">
        {status} / {current.authorized ? "Authorized" : "Not authorized"} /{" "}
        {current.config.scope}
      </p>
      <p className="break-words text-xs">
        Agents: {current.config.agents.join(", ")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {!current.authorized && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || local}
            onClick={() => void onChange("authorize")}
          >
            Authorize connection
          </Button>
        )}
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={current.enabled}
            disabled={busy || local || !current.authorized}
            onChange={(e) =>
              void onChange(e.target.checked ? "enable" : "disable")
            }
          />
          Enabled connection
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={
            busy ||
            local ||
            !connection.assigned ||
            !connection.credentialAvailable ||
            connected
          }
          onClick={() => void onConnect()}
        >
          Connect
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!connected}
          onClick={() => void onDisconnect()}
        >
          Disconnect
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || !current.authorized}
          onClick={() => void onChange("revoke")}
        >
          Revoke
        </Button>
      </div>
      {current.config.useCredential && (
        <div className="min-w-0 space-y-2">
          <p className="text-xs">
            Credential: {connection.credentialAvailable ? "Stored" : "Missing"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label={`Credential for ${current.config.name}`}
              type="password"
              autoComplete="new-password"
              value={password}
              maxLength={4096}
              className="min-w-0 flex-1 basis-40"
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !password}
              onClick={() => credential(password)}
            >
              Store credential
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !connection.credentialAvailable}
              onClick={() => credential(null)}
            >
              Delete credential
            </Button>
          </div>
        </div>
      )}
      {connection.discovery && (
        <details className="min-w-0 text-xs">
          <summary>
            {connection.discovery.tools.length} discovered tools /{" "}
            {connection.discovery.server.name}
          </summary>
          <ul className="min-w-0 space-y-1 py-2">
            {connection.discovery.tools.map(([name, hash]) => (
              <li key={name} className="break-all">
                {name} <span className="text-muted-foreground">{hash}</span>
              </li>
            ))}
          </ul>
          <p className="break-all text-muted-foreground">
            Discovery SHA-256: {connection.discovery.hash}
          </p>
        </details>
      )}
    </li>
  );
}

export function McpConnectionEditor({
  session,
  initial,
  busy,
  error,
  onClose,
  onSave,
}: {
  session: SessionMeta;
  initial: McpConfig;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onSave: (config: McpConfig) => Promise<void>;
}) {
  const [config, setConfig] = useState(initial);
  const field = useId();
  const update = (patch: Partial<McpConfig>) =>
    setConfig((value) => ({ ...value, ...patch }));
  const agents = useAgentsStore((state) => state.customAgents);
  void agents;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-24px)] max-w-xl flex-col overflow-hidden p-4">
        <DialogHeader>
          <DialogTitle>MCP connection</DialogTitle>
          <DialogDescription>
            {config.transport === "remote-http"
              ? "Remote service; external-data approval required"
              : "Native local MCP execution unavailable"}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="break-words text-xs text-destructive">
            {error}
          </p>
        )}
        <fieldset
          disabled={busy}
          className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto pr-1"
        >
          <label htmlFor={`${field}-name`} className="block text-xs">
            Name
            <Input
              id={`${field}-name`}
              value={config.name}
              maxLength={128}
              onChange={(e) => update({ name: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Transport
            <select
              aria-label="MCP transport"
              className="h-8 min-w-0 rounded border bg-background px-2"
              value={config.transport}
              onChange={(e) =>
                update({
                  transport: e.target.value as McpConfig["transport"],
                  useCredential: false,
                })
              }
            >
              <option value="remote-http">Remote MCP / Streamable HTTP</option>
              <option value="local-native">
                Local native process / unavailable
              </option>
            </select>
          </label>
          <label htmlFor={`${field}-endpoint`} className="block text-xs">
            {config.transport === "remote-http"
              ? "HTTPS endpoint"
              : "Unavailable runtime reference"}
            <Input
              id={`${field}-endpoint`}
              type={config.transport === "remote-http" ? "url" : "text"}
              value={config.endpoint}
              maxLength={1024}
              onChange={(e) => update({ endpoint: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Scope
            <select
              aria-label="MCP scope"
              className="h-8 min-w-0 rounded border bg-background px-2"
              value={config.scope}
              onChange={(e) =>
                update({
                  scope: e.target.value as McpConfig["scope"],
                  conversations:
                    e.target.value === "conversation" ? [session.id] : [],
                })
              }
            >
              <option value="conversation">Conversation</option>
              <option value="agent">Agent in this workspace</option>
              <option value="workspace">Workspace</option>
            </select>
          </label>
          <fieldset className="space-y-1">
            <legend className="text-xs">Assigned agents</legend>
            {useAgentsStore
              .getState()
              .all()
              .map((agent) => (
                <label
                  key={agent.id}
                  className="flex items-center gap-2 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={config.agents.includes(agent.id)}
                    onChange={(e) =>
                      update({
                        agents: e.target.checked
                          ? [...config.agents, agent.id]
                          : config.agents.filter((id) => id !== agent.id),
                      })
                    }
                  />
                  {agent.name}
                </label>
              ))}
          </fieldset>
          {config.transport === "remote-http" && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={config.useCredential}
                onChange={(e) => update({ useCredential: e.target.checked })}
              />
              Server-scoped bearer credential
            </label>
          )}
        </fieldset>
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t pt-3">
          <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={
              busy ||
              !config.name.trim() ||
              !config.endpoint.trim() ||
              !config.agents.length
            }
            onClick={() => void onSave(config)}
          >
            Save connection
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
