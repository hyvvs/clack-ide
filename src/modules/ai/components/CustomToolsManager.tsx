import { useCallback, useEffect, useId, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Edit02Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";
import { loadAll, type SessionMeta } from "@/modules/ai/lib/sessions";
import { useAgentsStore } from "@/modules/ai/store/agentsStore";
import {
  CustomToolHistory,
  CustomToolTest,
} from "@/modules/ai/components/CustomToolExecution";
import {
  customToolsClient,
  newToolDefinition,
  type ToolDefinition,
  type ToolRegistryView,
  type ToolEntry,
  type ToolChange,
  type ToolBinding,
} from "@/modules/ai/lib/customTools";

export function CustomToolsManager() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void loadAll()
      .then((value) => {
        if (live) {
          const bound = value.sessions.filter((s) => s.profile?.workspaceId);
          setSessions(bound);
          setSelected(
            bound.find((s) => s.id === value.activeId)?.id ??
              bound[0]?.id ??
              "",
          );
        }
      })
      .catch(() => {
        if (live) setError("Conversation list unavailable.");
      });
    return () => {
      live = false;
    };
  }, []);
  const session = sessions.find((s) => s.id === selected);
  return (
    <section className="min-w-0 space-y-3" aria-label="Custom tools">
      <h2 className="text-sm font-semibold">Custom tools</h2>
      <label className="flex min-w-0 flex-col gap-1 text-xs">
        Workspace conversation
        <select
          aria-label="Workspace conversation"
          className="h-8 max-w-full min-w-0 rounded border bg-background px-2"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          {!sessions.length && (
            <option value="">No workspace-bound conversations</option>
          )}
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title} ({s.profile?.workspaceRoot})
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {session && <ToolList key={session.id} session={session} />}
    </section>
  );
}

export function ToolList({ session }: { session: SessionMeta }) {
  const [testEntry, setTestEntry] = useState<ToolEntry>();
  const [view, setView] = useState<ToolRegistryView>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<{
    definition: ToolDefinition;
    entry?: ToolEntry;
    revision: number;
  } | null>(null);
  const generation = useRef(0);
  const agents = useAgentsStore((s) => s.customAgents);
  void agents;
  const refresh = useCallback(() => {
    const requested = ++generation.current;
    void customToolsClient(session.id)
      .load()
      .then((value) => {
        if (requested === generation.current) setView(value);
      })
      .catch(() => {
        if (requested === generation.current) {
          setView(undefined);
          setError("Tool registry unavailable. No custom tools can execute.");
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
  const openEditor = (entry?: ToolEntry) => {
    if (!view) return;
    setError("");
    setEditor({
      revision: view.revision,
      definition: entry
        ? structuredClone(entry.current.definition)
        : newToolDefinition(
            session.profile?.agentId ?? "builtin:coder",
            session.id,
          ),
      entry,
    });
  };
  const change = async (request: ToolChange, revision = view?.revision) => {
    if (revision === undefined) return;
    setBusy(true);
    setError("");
    try {
      setView(await customToolsClient(session.id).change(revision, request));
      setEditor(null);
    } catch (e) {
      setError(String(e));
      refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {view?.entries.length ?? 0} definitions
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={!view || busy}
          onClick={() => openEditor()}
        >
          <HugeiconsIcon icon={Add01Icon} size={14} />
          New tool
        </Button>
      </div>
      {error && (
        <p role="alert" className="break-words text-xs text-destructive">
          {error}
        </p>
      )}
      <ul className="min-w-0 divide-y border-y">
        {view?.entries.map((entry) => (
          <li key={entry.id} className="min-w-0 space-y-2 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="break-all text-sm font-medium">
                  {entry.current.definition.name}{" "}
                  <span className="text-muted-foreground">
                    v{entry.current.version}
                  </span>
                </h3>
                <p className="text-xs">
                  {entry.current.status} ·{" "}
                  {entry.current.enabled
                    ? "Enabled definition"
                    : "Disabled definition"}{" "}
                  · {entry.current.definition.scope}
                </p>
              </div>
              <Button
                size="icon-xs"
                variant="ghost"
                title="Inspect and edit definition"
                aria-label={`Inspect ${entry.current.definition.name}`}
                onClick={() => openEditor(entry)}
              >
                <HugeiconsIcon icon={Edit02Icon} size={14} />
              </Button>
            </div>
            <p className="break-words text-xs text-muted-foreground">
              {entry.current.definition.description}
            </p>
            <p className="text-xs">{entry.runtime}</p>
            <p className="break-words text-xs">
              Agents:{" "}
              {entry.current.definition.agents
                .map(
                  (id) =>
                    useAgentsStore
                      .getState()
                      .all()
                      .find((a) => a.id === id)?.name ?? id,
                )
                .join(", ")}
            </p>
            <div className="flex flex-wrap gap-2">
              {entry.executable && (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Test ${entry.current.definition.name}`}
                  disabled={busy}
                  onClick={() => setTestEntry(entry)}
                >
                  Test
                </Button>
              )}
              {entry.current.status !== "removed" &&
                entry.workspaceId === session.profile?.workspaceId && (
                  <>
                    {entry.current.status !== "authorized" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => openEditor(entry)}
                      >
                        Review registration
                      </Button>
                    )}
                    {entry.current.status === "authorized" && (
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          aria-label={`Enable ${entry.current.definition.name}`}
                          checked={entry.current.enabled}
                          disabled={busy}
                          onChange={(e) =>
                            void change({
                              action: e.target.checked ? "enable" : "disable",
                              id: entry.id,
                            })
                          }
                        />
                        Enabled definition
                      </label>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void change({ action: "revoke", id: entry.id })
                      }
                    >
                      Revoke
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      title="Remove definition"
                      aria-label={`Remove ${entry.current.definition.name}`}
                      disabled={busy}
                      onClick={() =>
                        void change({ action: "remove", id: entry.id })
                      }
                    >
                      <HugeiconsIcon icon={Delete02Icon} size={14} />
                    </Button>
                  </>
                )}
            </div>
          </li>
        ))}
      </ul>
      <CustomToolHistory sessionId={session.id} />
      {testEntry && (
        <CustomToolTest
          sessionId={session.id}
          entry={testEntry}
          onClose={() => setTestEntry(undefined)}
        />
      )}
      {editor && (
        <ToolEditor
          key={`${editor.entry?.id ?? "new"}:${editor.entry?.current.version ?? 0}`}
          session={session}
          initial={editor.definition}
          entry={editor.entry}
          busy={busy}
          error={error}
          onClose={() => setEditor(null)}
          onSave={(definition) =>
            change(
              editor.entry
                ? { action: "edit", id: editor.entry.id, definition }
                : { action: "create", definition },
              editor.revision,
            )
          }
          onAuthorize={() =>
            editor.entry
              ? change(
                  { action: "authorize", id: editor.entry.id },
                  editor.revision,
                )
              : Promise.resolve()
          }
        />
      )}
    </div>
  );
}

function ToolEditor({
  session,
  initial,
  entry,
  busy,
  error,
  onClose,
  onSave,
  onAuthorize,
}: {
  session: SessionMeta;
  initial: ToolDefinition;
  entry?: ToolEntry;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (definition: ToolDefinition) => Promise<void>;
  onAuthorize: () => Promise<void>;
}) {
  const fieldId = useId();
  const [draft, setDraft] = useState(initial);
  const [input, setInput] = useState(
    JSON.stringify(initial.inputSchema, null, 2),
  );
  const [output, setOutput] = useState(
    JSON.stringify(initial.outputSchema, null, 2),
  );
  const [binding, setBinding] = useState(
    JSON.stringify(initial.binding, null, 2),
  );
  const [feedback, setFeedback] = useState("");
  const [validating, setValidating] = useState(false);
  const raw = () =>
    ({
      ...draft,
      inputSchema: JSON.parse(input),
      outputSchema: JSON.parse(output),
      binding: JSON.parse(binding),
    }) as ToolDefinition;
  const validate = async (save = false) => {
    setValidating(true);
    setFeedback("");
    try {
      const definition = raw();
      const hash = await customToolsClient(session.id).validate(definition);
      setFeedback(`Valid definition: ${hash}`);
      if (save) await onSave(definition);
    } catch (error) {
      setFeedback(
        error instanceof SyntaxError
          ? "Invalid JSON in schema or binding."
          : String(error),
      );
    } finally {
      setValidating(false);
    }
  };
  const readOnly =
    entry?.current.status === "removed" ||
    (!!entry && entry.workspaceId !== session.profile?.workspaceId);
  const unchanged =
    JSON.stringify(draft) === JSON.stringify(initial) &&
    input === JSON.stringify(initial.inputSchema, null, 2) &&
    output === JSON.stringify(initial.outputSchema, null, 2) &&
    binding === JSON.stringify(initial.binding, null, 2);
  const update = (patch: Partial<ToolDefinition>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setFeedback("");
  };
  const kinds: ToolBinding["kind"][] = [
    "native",
    "http",
    "script",
    "function",
    "mcp",
  ];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy && !validating) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-24px)] max-w-2xl flex-col overflow-hidden p-4">
        <DialogHeader>
          <DialogTitle>{entry ? "Tool definition" : "New tool"}</DialogTitle>
          <DialogDescription>
            {entry?.runtime ?? "Unregistered definition"}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto pr-1">
          <p className="text-xs">
            {entry
              ? `${entry.current.status} · v${entry.current.version} · ${entry.current.source}`
              : "Unregistered draft"}{" "}
            · {entry?.runtime ?? "Authorization and runtime support required"}
          </p>
          <fieldset
            disabled={busy || validating || readOnly}
            className="min-w-0 space-y-3"
          >
            <label htmlFor={`${fieldId}-name`} className="block text-xs">
              Name
              <Input
                id={`${fieldId}-name`}
                aria-label="Tool name"
                value={draft.name}
                maxLength={64}
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            <label htmlFor={`${fieldId}-description`} className="block text-xs">
              Description
              <Textarea
                id={`${fieldId}-description`}
                aria-label="Tool description"
                className="max-h-32"
                value={draft.description}
                maxLength={2048}
                onChange={(e) => update({ description: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Availability
              <select
                aria-label="Tool scope"
                className="h-8 rounded border bg-background px-2"
                value={draft.scope}
                onChange={(e) =>
                  update({
                    scope: e.target.value as ToolDefinition["scope"],
                    conversations:
                      e.target.value === "conversation" ? [session.id] : [],
                  })
                }
              >
                {["conversation", "agent", "workspace", "global"].map(
                  (scope) => (
                    <option key={scope}>{scope}</option>
                  ),
                )}
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
                      checked={draft.agents.includes(agent.id)}
                      onChange={(e) =>
                        update({
                          agents: e.target.checked
                            ? [...draft.agents, agent.id]
                            : draft.agents.filter((id) => id !== agent.id),
                        })
                      }
                    />
                    {agent.name}
                  </label>
                ))}
            </fieldset>
            <fieldset className="flex flex-wrap gap-3">
              <legend className="mb-1 text-xs">Required permissions</legend>
              {[
                "read-files",
                "write-files",
                "create-files",
                "run-commands",
                "network",
              ].map((permission) => (
                <label
                  className="flex items-center gap-1 text-xs"
                  key={permission}
                >
                  <input
                    type="checkbox"
                    checked={draft.permissions.includes(permission)}
                    onChange={(e) =>
                      update({
                        permissions: e.target.checked
                          ? [...draft.permissions, permission]
                          : draft.permissions.filter((p) => p !== permission),
                      })
                    }
                  />
                  {permission}
                </label>
              ))}
            </fieldset>
            <label className="flex flex-col gap-1 text-xs">
              Execution kind
              <select
                aria-label="Execution kind"
                className="h-8 rounded border bg-background px-2"
                value={draft.binding.kind}
                onChange={(e) => {
                  const kind = e.target.value as ToolBinding["kind"];
                  const next: ToolBinding =
                    kind === "native"
                      ? { kind, operation: "read_file" }
                      : kind === "http"
                        ? {
                            kind,
                            url: "https://example.com/api",
                            method: "GET",
                          }
                        : kind === "script"
                          ? { kind, executable: "", argv: [], hash: "" }
                          : kind === "function"
                            ? { kind, module: "", export: "", hash: "" }
                            : { kind, server: "", tool: "" };
                  update({ binding: next });
                  setBinding(JSON.stringify(next, null, 2));
                }}
              >
                {kinds.map((kind) => (
                  <option key={kind}>{kind}</option>
                ))}
              </select>
            </label>
            <label htmlFor={`${fieldId}-binding`} className="block text-xs">
              Binding JSON (no credentials)
              <Textarea
                id={`${fieldId}-binding`}
                aria-label="Binding JSON"
                className="max-h-44 font-mono text-xs"
                value={binding}
                maxLength={12000}
                onChange={(e) => {
                  setBinding(e.target.value);
                  setFeedback("");
                }}
              />
            </label>
            <label htmlFor={`${fieldId}-input`} className="block text-xs">
              Input schema
              <Textarea
                id={`${fieldId}-input`}
                aria-label="Input schema"
                className="max-h-44 font-mono text-xs"
                value={input}
                maxLength={8192}
                onChange={(e) => {
                  setInput(e.target.value);
                  setFeedback("");
                }}
              />
            </label>
            <label htmlFor={`${fieldId}-output`} className="block text-xs">
              Output schema
              <Textarea
                id={`${fieldId}-output`}
                aria-label="Output schema"
                className="max-h-44 font-mono text-xs"
                value={output}
                maxLength={8192}
                onChange={(e) => {
                  setOutput(e.target.value);
                  setFeedback("");
                }}
              />
            </label>
            <label htmlFor={`${fieldId}-contract`} className="block text-xs">
              Output contract
              <Input
                id={`${fieldId}-contract`}
                aria-label="Output contract"
                value={draft.outputDescription}
                maxLength={1024}
                onChange={(e) => update({ outputDescription: e.target.value })}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label htmlFor={`${fieldId}-timeout`} className="text-xs">
                Timeout (ms)
                <Input
                  id={`${fieldId}-timeout`}
                  type="number"
                  value={draft.timeoutMs}
                  min={100}
                  max={120000}
                  onChange={(e) =>
                    update({ timeoutMs: Number(e.target.value) })
                  }
                />
              </label>
              <label htmlFor={`${fieldId}-bytes`} className="text-xs">
                Output bytes
                <Input
                  id={`${fieldId}-bytes`}
                  type="number"
                  min={1024}
                  max={262144}
                  value={draft.outputBytes}
                  onChange={(e) =>
                    update({ outputBytes: Number(e.target.value) })
                  }
                />
              </label>
            </div>
            <label htmlFor={`${fieldId}-credential`} className="block text-xs">
              Credential reference
              <Input
                id={`${fieldId}-credential`}
                aria-label="Credential reference"
                placeholder="keyring:reference"
                value={draft.credentialRef ?? ""}
                maxLength={128}
                onChange={(e) =>
                  update({ credentialRef: e.target.value || null })
                }
              />
            </label>
          </fieldset>
          {entry && (
            <details className="min-w-0 text-xs">
              <summary>Version history and provenance</summary>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">
                {JSON.stringify(
                  {
                    id: entry.id,
                    workspace: entry.workspaceId,
                    versions: entry.versions,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          )}
          {feedback && (
            <p role="status" className="break-all text-xs">
              {feedback}
            </p>
          )}
          {error && (
            <p role="alert" className="break-all text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t pt-3">
          <Button
            variant="ghost"
            disabled={busy || validating}
            onClick={onClose}
          >
            Close
          </Button>
          {!readOnly && (
            <>
              <Button
                variant="outline"
                disabled={busy || validating}
                onClick={() => void validate()}
              >
                Validate
              </Button>
              <Button
                disabled={busy || validating}
                onClick={() => void validate(true)}
              >
                {entry ? "Save new version" : "Save draft"}
              </Button>
            </>
          )}
          {entry && !readOnly && (
            <Button
              variant="outline"
              disabled={busy || validating || !unchanged}
              onClick={() => void onAuthorize()}
            >
              Authorize registration
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
