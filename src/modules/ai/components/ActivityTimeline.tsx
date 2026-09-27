import { memo, useDeferredValue, useMemo, useState } from "react";
import type { UIMessage } from "ai";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import {
  activityText,
  conversationActivity,
  type ActivityEvent,
} from "@/modules/ai/lib/activity";
import type { SessionRun } from "@/modules/ai/lib/sessions";
import type { PeerTask } from "@/modules/ai/lib/peerTasks";

type Props = {
  sessionId: string;
  workspaceId: string | null;
  messages: UIMessage[];
  tasks: readonly PeerTask[];
  run?: SessionRun;
};
const PAGE_SIZE = 40;

export const ActivityTimeline = memo(function ActivityTimeline(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="min-w-0 max-w-full border-y border-[color:var(--clack-border-subtle)] text-[11px] text-[var(--clack-text-3)]"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer px-1 py-2 focus-visible:outline focus-visible:outline-1">
        Agent activity
      </summary>
      {open ? <ActivityRows {...props} /> : null}
    </details>
  );
});

function ActivityRows(props: Props) {
  const messages = useDeferredValue(props.messages);
  const { tasks, sessionId, workspaceId, run } = props;
  const events = useMemo(
    () => conversationActivity(messages, tasks, sessionId, workspaceId, run),
    [messages, tasks, sessionId, workspaceId, run],
  );
  const [page, setPage] = useState<number | null>(null);
  const lastPage = Math.max(0, Math.ceil(events.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page ?? lastPage, lastPage);
  return (
    <>
      <div className="flex items-center justify-between gap-2 border-t border-[color:var(--clack-border-subtle)] px-1 py-1">
        <span>{events.length} events</span>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            title="Previous activity page"
            aria-label="Previous activity page"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
            className="flex size-7 items-center justify-center disabled:opacity-30"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
          </button>
          <span>
            {currentPage + 1} / {lastPage + 1}
          </span>
          <button
            type="button"
            title="Next activity page"
            aria-label="Next activity page"
            disabled={currentPage === lastPage}
            onClick={() =>
              setPage(currentPage + 1 === lastPage ? null : currentPage + 1)
            }
            className="flex size-7 items-center justify-center disabled:opacity-30"
          >
            <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
          </button>
        </div>
      </div>
      <ol
        aria-label="Chronological agent activity"
        className="max-h-80 min-w-0 overflow-y-auto overscroll-contain px-1 pb-2 [overflow-wrap:anywhere]"
      >
        {events
          .slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
          .map((event) => (
            <ActivityRow key={event.id} event={event} sessionId={sessionId} />
          ))}
      </ol>
    </>
  );
}

const ActivityRow = memo(function ActivityRow({
  event,
  sessionId,
}: {
  event: ActivityEvent;
  sessionId: string;
}) {
  return (
    <li className="min-w-0 border-t border-[color:var(--clack-border-subtle)] py-1.5">
      <details>
        <summary className="cursor-pointer [overflow-wrap:anywhere] focus-visible:outline focus-visible:outline-1">
          <span className="text-[var(--clack-text-2)]">
            {activityText(event.label, 300)}
          </span>
          <span className="ml-2 text-[10px] opacity-70">
            {event.at === undefined
              ? "Time unavailable"
              : new Date(event.at).toLocaleTimeString()}
          </span>
        </summary>
        <div className="min-w-0 space-y-2 py-2 pl-3">
          {event.detail ? (
            <p className="max-h-48 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere]">
              {activityText(event.detail)}
            </p>
          ) : null}
          <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[10px] [overflow-wrap:anywhere]">
            <dt>Category</dt>
            <dd>{event.kind}</dd>
            <dt>Agent</dt>
            <dd>{activityText(event.owner?.agentId) || "Unavailable"}</dd>
            <dt>Model</dt>
            <dd>{activityText(event.owner?.modelId) || "Unavailable"}</dd>
            <dt>Run</dt>
            <dd>{activityText(event.owner?.runId) || "Unavailable"}</dd>
            <dt>Workspace</dt>
            <dd>{activityText(event.owner?.workspaceId) || "Unavailable"}</dd>
            {event.taskId || event.owner?.taskId ? (
              <>
                <dt>Task</dt>
                <dd>{activityText(event.taskId ?? event.owner?.taskId)}</dd>
              </>
            ) : null}
            {event.toolCallId ? (
              <>
                <dt>Tool call</dt>
                <dd>{activityText(event.toolCallId)}</dd>
              </>
            ) : null}
            {event.source ? (
              <>
                <dt>Evidence</dt>
                <dd>{activityText(event.source)}</dd>
              </>
            ) : null}
          </dl>
          {event.messageId &&
          (!event.owner || event.owner.sessionId === sessionId) ? (
            <a
              className="inline-block max-w-full underline [overflow-wrap:anywhere]"
              href={`#evidence-${sessionId}-${event.messageId}`}
            >
              Original message: {activityText(event.messageId)}
            </a>
          ) : null}
        </div>
      </details>
    </li>
  );
});
