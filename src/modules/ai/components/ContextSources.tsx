import { useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { awaitSessionWrites } from "@/modules/ai/lib/sessions";
import {
  loadConversationMemory,
  onConversationMemoryChanged,
  readMemoryEvidence,
  type MemoryView,
  type MemoryRevision,
} from "@/modules/ai/lib/conversationMemory";
import { loadTargetContext } from "@/modules/ai/lib/targetContext";
import { retrievalSourceMatches } from "@/modules/ai/lib/conversationRetrieval";
import { sanitizeAiErrorText } from "@/modules/ai/lib/errors";

export function ContextSources({
  sessionId,
  messages,
}: {
  sessionId: string;
  messages: UIMessage[];
}) {
  const session = useChatStore((s) =>
    s.sessions.find((item) => item.id === sessionId),
  );
  const retrieval = useChatStore(
    (s) => s.runtimeBySession[sessionId]?.retrievalNotice,
  );
  const root = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<MemoryView | null>(null);
  const [error, setError] = useState("");
  const [prepared, setPrepared] = useState<MemoryRevision | null>(null);
  const [preparedError, setPreparedError] = useState("");
  const [inspection, setInspection] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const generation = useRef(0);
  const sequence = useRef(0);
  const workspaceId = session?.profile?.workspaceId ?? null;
  const target = session?.targetContext;
  const targetKey =
    target &&
    typeof target === "object" &&
    "key" in target &&
    typeof target.key === "string"
      ? target.key
      : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Refresh saved evidence at transcript/run boundaries, not on every streamed token.
  useEffect(() => {
    setView(null);
    setError("");
    setPrepared(null);
    setPreparedError("");
    setInspection("");
    setInspecting(false);
    if (!open) return;
    let live = true;
    const refresh = async () => {
      const ticket = ++generation.current;
      sequence.current++;
      setInspection("");
      setInspecting(false);
      try {
        await awaitSessionWrites(sessionId);
        const next = await loadConversationMemory({ sessionId, workspaceId });
        if (!live || ticket !== generation.current) return;
        setView(next);
        setError("");
        setPrepared(null);
        setPreparedError("");
        if (targetKey) {
          try {
            const targetRevision = await loadTargetContext(
              { sessionId, workspaceId },
              targetKey,
            );
            if (live && ticket === generation.current)
              setPrepared(targetRevision);
          } catch (failure) {
            if (live && ticket === generation.current)
              setPreparedError(sanitizeAiErrorText(String(failure)));
          }
        }
      } catch (failure) {
        if (live && ticket === generation.current) {
          setView(null);
          setError(sanitizeAiErrorText(String(failure)));
        }
      }
    };
    void refresh();
    const pending = onConversationMemoryChanged((id) => {
      if (id === sessionId) void refresh();
    });
    void pending.catch(() => {
      if (live) setError("Context updates unavailable; reopen to refresh.");
    });
    return () => {
      live = false;
      generation.current++;
      sequence.current++;
      void pending.then((stop) => stop()).catch(() => {});
    };
  }, [
    open,
    sessionId,
    workspaceId,
    messages.length,
    session?.run?.state,
    targetKey,
  ]);
  const inspect = async (evidenceId: string) => {
    if (!view?.revisionId) return;
    const ticket = generation.current;
    const request = ++sequence.current;
    setInspecting(true);
    setInspection("");
    try {
      const value = await readMemoryEvidence(
        { sessionId, workspaceId },
        view.revisionId,
        evidenceId,
      );
      if (ticket === generation.current && request === sequence.current) {
        setInspection(JSON.stringify(value, null, 2).slice(0, 8192));
      }
    } catch (failure) {
      if (ticket === generation.current && request === sequence.current) {
        setError(sanitizeAiErrorText(String(failure)));
      }
    } finally {
      if (ticket === generation.current && request === sequence.current)
        setInspecting(false);
    }
  };
  const revision = view?.revision;
  return (
    <details
      ref={root}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="min-w-0 border-b border-[var(--clack-border-subtle)] pb-2 text-xs [overflow-wrap:anywhere]"
    >
      <summary className="cursor-pointer text-[var(--clack-text-2)]">
        Sources & context
      </summary>
      {open && (
        <div className="mt-2 min-w-0 space-y-2">
          <p>
            {messages.length} original messages. Original conversation
            preserved.
          </p>
          <p className="text-[var(--clack-text-3)]">
            Workspace:{" "}
            {session?.run?.state === "running"
              ? (session.run.workspaceRoot ?? "Not bound")
              : (session?.profile?.workspaceRoot ?? "Not bound")}
          </p>
          {error && (
            <p role="alert" className="text-destructive">
              Context unavailable: {error}
            </p>
          )}
          {!view && !error && <p role="status">Loading saved context...</p>}
          {view && !revision && (
            <p>No saved summary yet. Original chat messages remain available.</p>
          )}
          {targetKey && view && (
            <p>
              {prepared
                ? `Prepared model-switch context: ${prepared.coverage.end - prepared.coverage.start} original messages covered, ${prepared.claims.length} source-linked statements.`
                : "Prepared model-switch context needs revalidation."}
            </p>
          )}
          {preparedError && (
            <p role="alert" className="text-destructive">
              Prepared context unavailable: {preparedError}
            </p>
          )}
          {revision && (
            <>
              <p role={view?.sourceChanged ? "status" : undefined} className={view?.sourceChanged ? "font-medium text-[var(--clack-text-1)]" : undefined}>
                {view?.sourceChanged
                  ? "Saved summary sources changed; they need checking before reuse."
                  : `${revision.coverage.end - revision.coverage.start} original messages summarized; ${view?.uncoveredMessages} newer messages are not in this summary.`}
              </p>
              <details>
                <summary className="cursor-pointer">
                  Saved summary ({revision.claims.length})
                </summary>
                <ul className="mt-2 max-h-52 space-y-2 overflow-auto">
                  {revision.claims.map((claim) => (
                    <li key={claim.id}>
                      <p className="text-[var(--clack-text-3)]">
                        {claim.section.replace(/-/g, " ")} /{" "}
                        {claim.status.replace(/-/g, " ")}
                        {claim.contradicts.length > 0
                          ? " / conflicting statements"
                          : ""}
                      </p>
                      <p className="whitespace-pre-wrap">{claim.text}</p>
                      <div className="flex flex-wrap gap-2">
                        {claim.sources.map((id, index) => (
                          <button
                            key={id}
                            type="button"
                            className="text-[var(--clack-accent)] hover:underline disabled:opacity-50"
                            disabled={
                              inspecting ||
                              !revision.evidence.some(
                                (source) => source.id === id,
                              )
                            }
                            onClick={() => void inspect(id)}
                            aria-label={`Inspect source ${index + 1} for ${claim.section}`}
                          >
                            Source {index + 1}
                          </button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
              <details>
                <summary className="cursor-pointer">
                  Advanced provenance
                </summary>
                <p>
                  Revision {revision.revision}: {view?.revisionId}
                </p>
                <p>
                  Latest covered message: {revision.coverage.latestMessageId}
                </p>
                <p>Coverage digest: {revision.coverage.digest}</p>
              </details>
            </>
          )}
          {inspecting && (
            <p role="status">Reading retained original evidence...</p>
          )}
          {inspection && (
            <section aria-label="Retained original evidence">
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all">
                {inspection}
              </pre>
            </section>
          )}
          {retrieval && (
            <details>
              <summary className="cursor-pointer">
                Retrieved original evidence ({retrieval.sources.length})
              </summary>
              <p>
                {retrieval.status}. {retrieval.omitted} groups omitted.
              </p>
              <ul className="mt-1 space-y-1">
                {retrieval.sources.map((source) => {
                  const message = messages.find(
                    (item) => item.id === source.messageId,
                  );
                  const current = retrievalSourceMatches(
                    source.original,
                    message,
                  );
                  return (
                    <li key={`${source.evidenceId}:${source.digest}`}>
                      <button
                        type="button"
                        disabled={!current}
                        className="max-w-full text-left text-[var(--clack-accent)] hover:underline disabled:text-[var(--clack-text-2)]"
                        onClick={() => {
                          // Scope navigation to this transcript, including duplicate chats in split panes.
                          const pane = root.current?.closest(
                            "[data-conversation-pane]",
                          );
                          const target = Array.from(
                            pane?.querySelectorAll<HTMLElement>(
                              "[data-evidence-message]",
                            ) ?? [],
                          ).find(
                            (element) =>
                              element.dataset.evidenceMessage ===
                              source.messageId,
                          );
                          target?.scrollIntoView({ block: "center" });
                          target?.focus({ preventScroll: true });
                        }}
                      >
                        {current
                          ? `View original ${message?.role} message`
                          : "Source changed or unavailable"}
                        : {source.reason}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </div>
      )}
    </details>
  );
}
