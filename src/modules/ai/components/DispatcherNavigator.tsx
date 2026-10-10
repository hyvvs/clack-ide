import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  Message01Icon,
  Add01Icon,
} from "@hugeicons/core-free-icons";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { BUILTIN_AGENTS } from "@/modules/ai/lib/agents";
import {
  availableDispatcherTasks,
  dispatcherTaskConversation,
  dispatcherTaskStatus,
} from "@/modules/ai/lib/dispatcherTasks";
import { isPeerTaskActive } from "@/modules/ai/lib/peerTaskCancellation";
import {
  taskOutcomeLabel,
  taskWorkGroup,
  type WorkGroup,
} from "@/modules/ai/lib/taskPresentation";
import type { useChatStore } from "@/modules/ai/store/chatStore";
import { usePeerTaskStore } from "@/modules/ai/store/peerTaskStore";
import { useAgentsStore } from "@/modules/ai/store/agentsStore";
import {
  focusTaskConversationPane,
  useDispatcherNavigation,
} from "@/modules/ai/store/dispatcherNavigation";

const PeerTaskCard = lazy(() =>
  import("@/modules/ai/components/PeerTaskFeed").then((module) => ({
    default: module.PeerTaskCard,
  })),
);

export type DispatcherProps = {
  sessions: ReturnType<typeof useChatStore.getState>["sessions"];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void | Promise<void>;
  onCreate: () => void;
};
const groups: [WorkGroup, string][] = [
  ["attention", "Needs attention"],
  ["active", "Active"],
  ["completed", "Completed"],
];
const workspaceLabel = (root?: string | null) =>
  root?.split(/[\\/]/).filter(Boolean).pop() ?? "Unbound conversation";

export function DispatcherNavigator({
  sessions,
  activeSessionId,
  onSelect,
  onCreate,
}: DispatcherProps) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const requestedRef = useRef<HTMLButtonElement>(null);
  const navigationRef = useRef<HTMLDivElement>(null);
  const resultNavigation = useRef(false);
  const request = useDispatcherNavigation((s) => s.request);
  const tasks = usePeerTaskStore((s) => s.tasks);
  const customAgents = useAgentsStore((s) => s.customAgents);
  const agents = [...BUILTIN_AGENTS, ...customAgents];
  const work = availableDispatcherTasks(tasks, sessions);
  const activeCount = work.filter(isPeerTaskActive).length;
  const attentionCount = work.filter(
    (task) => taskWorkGroup(task) === "attention",
  ).length;
  const active = sessions.find((s) => s.id === activeSessionId);
  const requestedTask = work.find((task) => task.id === request?.taskId);
  const requestedTaskId = requestedTask?.id;
  const selected = work.find((task) => task.id === selectedId);
  const ownerId = selected && dispatcherTaskConversation(selected, sessions);
  useEffect(() => {
    if (!request || (!requestedTaskId && request.taskId !== null)) return;
    setSelectedId(requestedTaskId ?? null);
    setOpen(true);
  }, [request, requestedTaskId]);
  useEffect(() => {
    if (!open || !requestedTaskId || !request) return;
    const frame = requestAnimationFrame(() => {
      requestedRef.current?.focus();
      requestedRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, requestedTaskId, request]);
  const changeOpen = (value: boolean) => {
    setOpen(value);
    if (!value) useDispatcherNavigation.setState({ request: null });
  };
  const openChat = async (id: string) => {
    await onSelect(id);
    resultNavigation.current = true;
    changeOpen(false);
    focusTaskConversationPane(id);
  };
  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-ai-dispatch-target
          className="inline-flex h-[22px] max-w-[15rem] items-center gap-1.5 rounded-md border border-[color:var(--clack-border-strong)] bg-[var(--clack-accent-soft)] px-2 text-[11px] text-[var(--clack-text-1)] outline-none hover:bg-accent/70 focus-visible:ring-1 focus-visible:ring-[var(--clack-focus)]"
          title={`Dispatcher: ${activeCount} active tasks, ${attentionCount} need attention`}
          aria-label={`Dispatcher. Choose dispatch target. Current target: ${active?.title || "New chat"}. ${activeCount} active tasks. ${attentionCount} need attention`}
        >
          <HugeiconsIcon icon={Message01Icon} size={11} />
          <span className="shrink-0 text-[var(--clack-text-3)]">
            Dispatcher
          </span>
          <span className="min-w-0 truncate font-medium">
            {active?.title || "New chat"}
          </span>
          {activeCount > 0 && (
            <span className="shrink-0 text-[10px] tabular-nums">
              {activeCount} active
            </span>
          )}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={10}
            className="shrink-0"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        aria-label="Dispatcher"
        align="start"
        side="top"
        className="w-[680px] max-w-[calc(100vw-16px)] max-h-[80dvh] gap-2 overflow-auto p-3 text-xs [overflow-wrap:anywhere]"
        onCloseAutoFocus={(event) => {
          if (resultNavigation.current) {
            event.preventDefault();
            resultNavigation.current = false;
          }
        }}
      >
        <h3 className="text-sm font-semibold">Assigned work</h3>
        <div className="grid min-h-0 min-w-0 gap-3 min-[600px]:grid-cols-[220px_minmax(0,1fr)]">
          <div
            ref={navigationRef}
            role="toolbar"
            aria-label="Assigned task navigation"
            className="max-h-[30dvh] min-w-0 space-y-2 overflow-y-auto min-[600px]:max-h-[55dvh]"
            onKeyDown={(event) => {
              if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
                return;
              const rows = [
                ...(navigationRef.current?.querySelectorAll<HTMLButtonElement>(
                  "[data-dispatcher-task-id]",
                ) ?? []),
              ];
              const index =
                event.target instanceof HTMLButtonElement
                  ? rows.indexOf(event.target)
                  : -1;
              if (index < 0) return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? rows.length - 1
                    : (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        rows.length) %
                      rows.length;
              rows[next]?.focus();
            }}
          >
            {groups.map(([group, label]) => {
              const entries = work.filter(
                (task) => taskWorkGroup(task) === group,
              );
              return (
                <section key={group} aria-label={label}>
                  <h4 className="sticky top-0 bg-[var(--clack-surface-raised)] py-1 font-semibold">
                    {label} ({entries.length})
                  </h4>
                  {!entries.length && (
                    <p className="py-1 text-[var(--clack-text-3)]">
                      No {label.toLowerCase()} tasks
                    </p>
                  )}
                  {entries.map((task) => {
                    const parent = sessions.find(
                      (s) =>
                        s.id === task.sourceSessionId &&
                        s.profile?.workspaceId === task.workspaceId,
                    );
                    return (
                      <button
                        key={task.id}
                        type="button"
                        data-dispatcher-task-id={task.id}
                        ref={
                          task.id === request?.taskId ? requestedRef : undefined
                        }
                        aria-pressed={task.id === selectedId}
                        onClick={() => setSelectedId(task.id)}
                        className={cn(
                          "my-1 flex w-full min-w-0 flex-col gap-1 rounded border border-transparent p-2 text-left outline-none hover:bg-[var(--clack-surface-2)] focus-visible:ring-1 focus-visible:ring-[var(--clack-focus)]",
                          task.id === selectedId &&
                            "border-[var(--clack-accent)] bg-[var(--clack-accent-soft)]",
                        )}
                      >
                        <span className="font-semibold">
                          {agents.find(
                            (agent) => agent.id === task.targetAgentId,
                          )?.name ?? task.targetAgentId}
                        </span>
                        <span
                          className="line-clamp-2 break-words"
                          title={task.prompt}
                        >
                          {task.prompt}
                        </span>
                        <span className="text-[var(--clack-text-2)]">
                          {dispatcherTaskStatus(task)}
                        </span>
                        <span className="text-[var(--clack-text-3)]">
                          {parent?.title ?? "Deleted conversation"} |{" "}
                          {workspaceLabel(task.workspaceRoot)}
                        </span>
                        {(task.result || task.changeSet) && (
                          <span className="line-clamp-2 text-[var(--clack-accent)]">
                            {taskOutcomeLabel(task)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </section>
              );
            })}
          </div>
          <section
            className="max-h-[38dvh] min-w-0 overflow-y-auto min-[600px]:max-h-[55dvh]"
            aria-label="Selected task"
          >
            {selected && ownerId ? (
              <Suspense fallback={<p role="status">Loading task details...</p>}>
                <PeerTaskCard
                  key={`${selected.id}:${ownerId}`}
                  task={selected}
                  viewingSessionId={
                    request?.taskId === selected.id && request.sessionId
                      ? request.sessionId
                      : ownerId
                  }
                  allTasks={tasks}
                  onOpenSession={(id) => void openChat(id)}
                  inDispatcher
                  onResultOpened={() => {
                    resultNavigation.current = true;
                    changeOpen(false);
                  }}
                />
              </Suspense>
            ) : (
              <p className="text-[var(--clack-text-3)]">
                Select a task to view its access, result and actions.
              </p>
            )}
          </section>
        </div>
        <details className="border-t border-[var(--clack-border-subtle)] pt-2">
          <summary className="cursor-pointer font-semibold">
            Chats - dispatch destinations ({sessions.length})
          </summary>
          <div className="max-h-40 space-y-1 overflow-auto pt-2">
            {[...sessions]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((session) => (
                <button
                  type="button"
                  key={session.id}
                  aria-pressed={session.id === activeSessionId}
                  onClick={() => void openChat(session.id)}
                  className="flex w-full min-w-0 flex-col rounded p-2 text-left hover:bg-[var(--clack-surface-2)] focus-visible:outline"
                >
                  <span className="font-medium">
                    {session.title || "New chat"}
                    {session.id === activeSessionId ? " - Current target" : ""}
                  </span>
                  <span className="text-[var(--clack-text-3)]">
                    {workspaceLabel(session.profile?.workspaceRoot)}
                    {session.run?.state === "running" ? " - Running" : ""}
                  </span>
                </button>
              ))}
            <button
              type="button"
              className="flex items-center gap-1 p-2 font-medium"
              onClick={() => {
                changeOpen(false);
                onCreate();
              }}
            >
              <HugeiconsIcon icon={Add01Icon} size={12} />
              New chat
            </button>
          </div>
        </details>
      </PopoverContent>
    </Popover>
  );
}
