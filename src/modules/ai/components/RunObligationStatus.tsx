import type { UIMessage } from "ai";
import { useEffect, useMemo } from "react";
import {
  inspectRunObligations,
  type RunObligationReport,
} from "../lib/runObligations";
import type { SessionRun } from "../lib/sessions";
import { usePeerTaskStore } from "../store/peerTaskStore";
import { useTodosStore } from "../store/todoStore";

const EMPTY: never[] = [];

/** Reports evidence; it never marks a Todo complete or triggers inference. */
export function RunObligationStatus({
  sessionId,
  workspaceId,
  run,
  messages,
  continuation,
}: {
  sessionId: string;
  workspaceId: string | null;
  run: SessionRun;
  messages: UIMessage[];
  continuation:
    | "continue"
    | "explicit-limit-extension"
    | "recover"
    | "new-instruction";
}) {
  const hydrate = useTodosStore((s) => s.hydrate);
  const hydrated = useTodosStore((s) => s.hydrated.has(sessionId));
  const todos = useTodosStore((s) => s.bySession[sessionId]) ?? EMPTY;
  const peerTasks = usePeerTaskStore((s) => s.tasks);
  // Ended runs do not mount TodoStrip, and restart recovery only hydrates
  // interrupted chats. Read the accepted persisted plan for every viewed run.
  useEffect(() => {
    void hydrate(sessionId);
  }, [hydrate, sessionId]);
  const report = useMemo(
    () =>
      inspectRunObligations({
        sessionId,
        workspaceId,
        run,
        messages,
        todos,
        peerTasks,
      }),
    [sessionId, workspaceId, run, messages, todos, peerTasks],
  );
  if (!hydrated) {
    return (
      <section
        aria-label="Agent completion evidence"
        className="clack-ai-block px-2.5 py-2 text-[11px] text-[var(--clack-text-2)]"
      >
        Loading persisted Agent obligations; task completion is not yet
        verified.
      </section>
    );
  }
  return <RunObligationEvidence report={report} continuation={continuation} />;
}

export function RunObligationEvidence({
  report,
  continuation,
}: {
  report: RunObligationReport;
  continuation:
    | "continue"
    | "explicit-limit-extension"
    | "recover"
    | "new-instruction";
}) {
  const pending = report.obligations.filter(
    (o) => o.state !== "verified-complete" && o.state !== "superseded",
  );
  const claimed = report.obligations.filter(
    (o) => o.state === "completed-unverified",
  );
  return (
    <section
      aria-label="Agent completion evidence"
      className="clack-ai-block flex flex-col gap-1.5 px-2.5 py-2 text-[11px] text-[var(--clack-text-2)]"
    >
      <div className="font-medium text-[var(--clack-text-1)]">
        Task status:{" "}
        {report.outcome === "verified"
          ? "independently verified"
          : report.outcome}
      </div>
      <div className="break-words">{report.terminalReason}</div>
      <div className="text-[var(--clack-text-3)]">
        Plan: {report.obligations.length} tracked; {claimed.length} marked done
        without current independent proof; {pending.length}{" "}
        outstanding/unverified. Successful workspace-write receipts:{" "}
        {report.writesObserved}.
      </div>
      {pending.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-4">
          {pending.slice(0, 8).map((o) => (
            <li key={o.id} className="break-words">
              {o.title} — {o.state.replace(/-/g, " ")}
            </li>
          ))}
          {pending.length > 8 ? (
            <li>{pending.length - 8} more tracked items</li>
          ) : null}
        </ul>
      ) : null}
      {report.checks.length ? (
        <div>
          {report.checks.map((check) => (
            <div key={check.id} className="break-words">
              {check.kind}: {check.result.replace(/-/g, " ")} —{" "}
              <code>{check.command}</code>
            </div>
          ))}
          <div className="text-[var(--clack-text-3)]">
            Command results are historical observations, not current application
            proof without a revision-scoped verifier.
          </div>
        </div>
      ) : (
        <div className="text-[var(--clack-text-3)]">
          No independently identifiable test or build execution recorded in this
          conversation.
        </div>
      )}
      {report.toolFailures.length ? (
        <div>
          {report.toolFailures.map((failure) => (
            <div key={failure.id} className="break-words">
              Tool failure ({failure.name}): {failure.reason}
            </div>
          ))}
        </div>
      ) : null}
      {report.peerOutstanding || report.peerClaimedComplete ? (
        <div>
          Related PeerTasks: {report.peerOutstanding} unresolved;{" "}
          {report.peerClaimedComplete} reported complete (not independently
          verified).
        </div>
      ) : null}
      {report.unmatchedInstructions ? (
        <div>
          <div>
            Later user instructions after the last accepted Todo plan; earlier
            completion claims need reconciliation:
          </div>
          {report.laterInstructions.map((instruction) => (
            <div key={instruction} className="break-words pl-2">
              {instruction}
            </div>
          ))}
        </div>
      ) : null}
      <div className="text-[var(--clack-text-3)]">
        {continuation === "continue"
          ? "Continue is available under the existing run policy and approval limits."
          : continuation === "explicit-limit-extension"
            ? "Autonomous budget exhausted. Only the existing explicit Continue anyway action can extend it."
            : continuation === "recover"
              ? "The existing guarded Retry/Continue Partial Answer action is available."
              : "No automatic continuation is available. Send a new instruction to request further work."}
      </div>
    </section>
  );
}
