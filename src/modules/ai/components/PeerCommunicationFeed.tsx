import type { PeerCommunicationEvent } from "@/modules/ai/lib/peerCommunication";

export function PeerCommunicationFeed({
  events,
  agentName = (id: string) => id,
}: {
  events?: readonly PeerCommunicationEvent[];
  agentName?: (id: string) => string;
}) {
  if (!events?.length) return null;
  return (
    <details className="min-w-0 border-b border-[color:var(--clack-border-subtle)] pb-2">
      <summary className="cursor-pointer text-[var(--clack-text-2)]">
        Task communication ({events.length})
      </summary>
      <ol className="max-h-64 space-y-2 overflow-auto pt-2">
        {events.map((event) => (
          <li
            key={event.id}
            className="min-w-0 break-words [overflow-wrap:anywhere]"
          >
            <div className="text-[var(--clack-text-3)]">
              {event.kind.replace(/-/g, " ")} / {communicationStateLabel(event)}
            </div>
            <p className="text-[var(--clack-text-2)]">{agentName(event.sender.agentId)} to {agentName(event.recipient.agentId)}</p>
            <p className="whitespace-pre-wrap">{event.text}</p>
            {event.detail ? <p>{event.detail}</p> : null}
            <details>
              <summary className="cursor-pointer text-[var(--clack-text-3)]">
                Provenance
              </summary>
              <p>
                {event.sender.agentId} to {event.recipient.agentId}
              </p>
              <p>
                {event.sender.sessionId} to {event.recipient.sessionId}
              </p>
              <p>Workspace {event.workspaceId}</p>
              <p>
                Task {event.taskId} · Sequence {event.sequence}
              </p>
              <p>{event.id}</p>
              <p>{event.digest}</p>
              {event.replyTo ? <p>Reply to {event.replyTo}</p> : null}
              {event.sourceMessageId ? (
                <p>Source message {event.sourceMessageId}</p>
              ) : null}
              {event.evidence.map((source) => (
                <p key={`${source.taskId}:${source.artifactId}`}>
                  {source.artifactId} · {source.contentHash}
                </p>
              ))}
            </details>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function communicationStateLabel(event: Pick<PeerCommunicationEvent, "kind" | "state">): string {
  if (event.state === "blocked") return "Blocked";
  if (event.state === "cancelled") return "Cancelled; not replayed";
  if (event.state === "answered") return "Answered";
  if (event.state === "acknowledged") return "Consumed at task boundary";
  const question = event.kind === "clarification-request" || event.kind === "review-request";
  if (event.state === "delivered") return question ? "Waiting for answer" : "Delivered; awaiting task boundary";
  return question ? "Waiting for recipient" : "Queued for recipient";
}
