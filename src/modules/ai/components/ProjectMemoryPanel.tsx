import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { UIMessage } from "ai";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ViewIcon,
  Edit02Icon,
  Cancel01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { useChatStore } from "@/modules/ai/store/chatStore";
import {
  PROJECT_SECTIONS,
  projectMemoryClient,
  projectSources,
  type ProjectMemoryView,
} from "@/modules/ai/lib/projectMemory";

export function ProjectMemoryPanel({
  sessionId,
  messages,
}: {
  sessionId: string;
  messages: UIMessage[];
}) {
  const workspace = useChatStore(
    (s) =>
      s.sessions.find((session) => session.id === sessionId)?.profile
        ?.workspaceId,
  );
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ProjectMemoryView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sourceKey, setSourceKey] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [section, setSection] = useState<string>("requirements");
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null);
  const [inspection, setInspection] = useState<{
    id: string;
    text: string;
    sourceState: string;
  } | null>(null);
  const generation = useRef(0);
  const inspectionSequence = useRef(0);
  const client = useMemo(() => projectMemoryClient(sessionId), [sessionId]);
  const sources = useMemo(
    () => (open ? projectSources(messages) : []),
    [messages, open],
  );
  const source = sources.find((item) => item.key === sourceKey);
  const refresh = useCallback(async () => {
    const ticket = ++generation.current;
    setInspection(null);
    setView(null);
    try {
      const next = await client.load();
      if (ticket === generation.current) {
        setView(next);
        setError("");
      }
    } catch (error) {
      if (ticket === generation.current) setError(String(error));
    }
  }, [client]);
  useEffect(() => {
    setView(null);
    setInspection(null);
    setEdit(null);
    setSourceKey("");
    setExcerpt("");
    if (!open || !workspace) return;
    let alive = true;
    void refresh();
    const listener = listen("clack:project-memory-changed", () => {
      if (alive) void refresh();
    });
    void listener.catch((error) => {
      if (alive) setError(String(error));
    });
    return () => {
      alive = false;
      generation.current++;
      void listener.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [open, workspace, refresh]);
  const act = async (operation: () => Promise<unknown>) => {
    const ticket = generation.current;
    setBusy(true);
    setError("");
    try {
      await operation();
      if (ticket === generation.current) {
        setEdit(null);
        await refresh();
      }
    } catch (error) {
      if (ticket === generation.current) setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  if (!workspace) return null;
  const control =
    "h-7 shrink-0 rounded p-1 hover:bg-[var(--clack-accent-soft)] disabled:opacity-40";
  return (
    <details
      className="min-w-0 border-b border-[var(--clack-border-subtle)] pb-2 text-xs"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-[var(--clack-text-2)]">
        Project memory
      </summary>
      {open && (
        <div className="mt-2 flex min-w-0 flex-col gap-2">
          {error && (
            <p role="alert" className="break-words text-destructive">
              {error}
            </p>
          )}
          {!view && !error && <p role="status">Loading project memory...</p>}
          {view && (
            <>
              <p className="break-all text-[var(--clack-text-3)]">
                {view.checkout} | Revision {view.revision}
              </p>
              <div className="flex min-w-0 flex-col gap-2">
                <select
                  aria-label="Original evidence"
                  className="h-8 w-full min-w-0 rounded border bg-background px-2"
                  value={sourceKey}
                  onChange={(e) => {
                    setSourceKey(e.target.value);
                    const selected = sources.find(
                      (item) => item.key === e.target.value,
                    );
                    setExcerpt(
                      selected &&
                        new TextEncoder().encode(selected.text).byteLength <=
                          4096
                        ? selected.text
                        : "",
                    );
                  }}
                >
                  <option value="">Select original evidence</option>
                  {sources.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
                {source && (
                  <>
                    <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded border p-2 text-[11px]">
                      {source.text.slice(0, 4096)}
                      {source.text.length > 4096 ? "..." : ""}
                    </pre>
                    <textarea
                      aria-label="Selected evidence excerpt"
                      placeholder="Exact evidence excerpt"
                      className="min-h-16 w-full resize-y rounded border bg-background p-2"
                      value={excerpt}
                      onChange={(e) => setExcerpt(e.target.value)}
                      maxLength={4096}
                    />
                    <div className="flex flex-wrap gap-2">
                      <select
                        aria-label="Knowledge category"
                        className="min-w-0 flex-1 rounded border bg-background px-2"
                        value={section}
                        onChange={(e) => setSection(e.target.value)}
                      >
                        {PROJECT_SECTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className={control}
                        disabled={busy || !excerpt.trim()}
                        onClick={() =>
                          void act(() =>
                            client.propose(view, source, excerpt, section),
                          )
                        }
                      >
                        Create proposal
                      </button>
                    </div>
                  </>
                )}
              </div>
              <div className="max-h-[40vh] min-w-0 overflow-y-auto divide-y divide-[var(--clack-border-subtle)]">
                {!view.entries.length && (
                  <p className="py-2 text-[var(--clack-text-3)]">
                    No project records.
                  </p>
                )}
                {view.entries.map((entry) => (
                  <article key={entry.id} className="min-w-0 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="min-w-0 flex-1 break-words">
                        {entry.section} | {entry.status} | {entry.qualification}
                      </span>
                      <button
                        className={control}
                        type="button"
                        title="Inspect selected source"
                        aria-label="Inspect selected source"
                        disabled={busy}
                        onClick={() => {
                          const ticket = generation.current;
                          const inspectionTicket = ++inspectionSequence.current;
                          setError("");
                          void client
                            .inspect(view, entry.id)
                            .then((result) => {
                              if (
                                ticket === generation.current &&
                                inspectionTicket === inspectionSequence.current
                              )
                                setInspection({ ...result, id: entry.id });
                            })
                            .catch((error) => {
                              if (
                                ticket === generation.current &&
                                inspectionTicket === inspectionSequence.current
                              )
                                setError(String(error));
                            });
                        }}
                      >
                        <HugeiconsIcon icon={ViewIcon} size={15} />
                      </button>
                      {entry.status === "pending" && (
                        <button
                          className={control}
                          type="button"
                          title="Approve sharing"
                          aria-label="Approve sharing"
                          disabled={busy}
                          onClick={() =>
                            void act(() =>
                              client.decide(view, entry.id, {
                                kind: "approve",
                              }),
                            )
                          }
                        >
                          <HugeiconsIcon icon={Tick02Icon} size={15} />
                        </button>
                      )}
                      {entry.status === "approved" && (
                        <button
                          className={control}
                          type="button"
                          title="Correct project record"
                          aria-label="Correct project record"
                          disabled={busy}
                          onClick={() =>
                            setEdit({ id: entry.id, text: entry.text })
                          }
                        >
                          <HugeiconsIcon icon={Edit02Icon} size={15} />
                        </button>
                      )}
                      {(entry.status === "approved" ||
                        entry.status === "pending") && (
                        <button
                          className={control}
                          type="button"
                          title="Revoke record"
                          aria-label="Revoke record"
                          disabled={busy}
                          onClick={() =>
                            void act(() =>
                              client.decide(view, entry.id, { kind: "revoke" }),
                            )
                          }
                        >
                          <HugeiconsIcon icon={Cancel01Icon} size={15} />
                        </button>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap break-words">
                      {entry.text}
                    </p>
                    <p className="break-words text-[10px] text-[var(--clack-text-3)]">
                      {entry.sourceState} | {entry.authorAgent} |{" "}
                      {entry.sourceSessionId}
                    </p>
                    {entry.supersedes && (
                      <p className="break-all text-[10px]">
                        Supersedes {entry.supersedes}
                      </p>
                    )}
                    {!!entry.conflicts.length && (
                      <p className="break-all text-[10px]">
                        Conflicts: {entry.conflicts.join(", ")}
                      </p>
                    )}
                    {inspection?.id === entry.id && (
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border p-2">
                        {inspection.sourceState}
                        {"\n"}
                        {inspection.text}
                      </pre>
                    )}
                    {edit?.id === entry.id && (
                      <div className="mt-1 flex flex-col gap-1">
                        <textarea
                          aria-label="User correction"
                          className="min-h-16 w-full resize-y rounded border bg-background p-2"
                          value={edit.text}
                          maxLength={4096}
                          onChange={(e) =>
                            setEdit({ id: entry.id, text: e.target.value })
                          }
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={control}
                            disabled={busy}
                            onClick={() =>
                              void act(() =>
                                client.decide(view, entry.id, {
                                  kind: "correct",
                                  text: edit.text,
                                }),
                              )
                            }
                          >
                            Confirm correction
                          </button>
                          <button
                            type="button"
                            className={control}
                            onClick={() => setEdit(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </details>
  );
}
