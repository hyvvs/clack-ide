import { useState } from "react";
import type { UIMessage } from "ai";
import { ContextSources } from "@/modules/ai/components/ContextSources";
import { ProjectMemoryPanel } from "@/modules/ai/components/ProjectMemoryPanel";
import { isAttachmentMessagePart } from "@/modules/ai/lib/attachmentMessages";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePeerTaskStore } from "@/modules/ai/store/peerTaskStore";
import { viewTaskInDispatcher } from "@/modules/ai/store/dispatcherNavigation";

export function ChatContextPanel({
  sessionId,
  messages,
}: {
  sessionId: string;
  messages: UIMessage[];
}) {
  const [open, setOpen] = useState(false);
  const workspaceId = useChatStore(
    (s) =>
      s.sessions.find((item) => item.id === sessionId)?.profile?.workspaceId,
  );
  const tasks = usePeerTaskStore((s) => s.tasks);
  const attachments = messages.flatMap((message) =>
    message.parts
      .filter(isAttachmentMessagePart)
      .map((part) => ({
        ...part.data,
        key: `${message.id}:${part.data.attachmentId}`,
      })),
  );
  const ownedTasks = tasks.filter(
    (task) =>
      task.workspaceId === workspaceId &&
      (task.sourceSessionId === sessionId ||
        task.targetSessionId === sessionId),
  );
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="min-w-0 border-b pb-2 text-xs [overflow-wrap:anywhere]"
      aria-label="Context for this conversation"
    >
      <summary className="cursor-pointer text-[var(--clack-text-2)] focus-visible:outline focus-visible:outline-1">
        Context{" "}
        <span className="text-muted-foreground">
          · Sources, memory, attachments & task artifacts
        </span>
      </summary>
      {open && (
        <div className="mt-2 min-w-0 space-y-2">
          <ContextSources sessionId={sessionId} messages={messages} />
          <ProjectMemoryPanel sessionId={sessionId} messages={messages} />
          <details>
            <summary className="cursor-pointer focus-visible:outline">
              Attachments ({attachments.length})
            </summary>
            <ul>
              {attachments.map((item) => (
                <li key={item.key}>
                  {item.displayName}{" "}
                  <span className="text-muted-foreground">
                    | {item.contentKind}
                  </span>
                  <details>
                    <summary className="cursor-pointer">
                      Content identity
                    </summary>
                    <p>
                      {item.contentId} / {item.contentHash}
                    </p>
                  </details>
                </li>
              ))}
            </ul>
          </details>
          <details>
            <summary className="cursor-pointer focus-visible:outline">
              Task artifacts
            </summary>
            {ownedTasks.map((task) => (
              <div key={task.id} className="py-1">
                <button
                  type="button"
                  className="underline focus-visible:outline"
                  onClick={() => viewTaskInDispatcher(task.id, sessionId)}
                >
                  {task.prompt}
                </button>
                <ul>
                  {Array.from(
                    new Map(
                      [...task.artifactRefs, ...(task.result?.artifacts ?? [])]
                        .filter(
                          (artifact) => artifact.workspaceId === workspaceId,
                        )
                        .map((artifact) => [artifact.id, artifact]),
                    ).values(),
                  ).map((artifact) => (
                    <li key={artifact.id}>
                      {artifact.displayName}{" "}
                      <span className="text-muted-foreground">
                        | {artifact.originType}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </details>
        </div>
      )}
    </details>
  );
}
