import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  Message01Icon,
  Add01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Archive02Icon,
} from "@hugeicons/core-free-icons";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { BUILTIN_AGENTS } from "@/modules/ai/lib/agents";
import {
  visibleDispatcherTasks,
  dispatcherTaskGroups,
  dispatcherTaskNeighbors,
  dispatcherTaskConversation,
  dispatcherTaskStatus,
  availableDispatcherTasks,
} from "@/modules/ai/lib/dispatcherTasks";
import { finishedTasksToArchive } from "@/modules/ai/lib/taskArchive";
import { ConfiguredBackgroundLayer } from "@/modules/theme/ConfiguredBackgroundLayer";
import {
  taskOutcomeLabel,
  taskWorkGroup,
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
  const [archived, setArchived] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState("");
  const cancelClearRef = useRef<HTMLButtonElement>(null);
  const navigationRef = useRef<HTMLDivElement>(null);
  const resultNavigation = useRef(false);
  const request = useDispatcherNavigation((s) => s.request);
  const tasks = usePeerTaskStore((s) => s.tasks);
  const managing = usePeerTaskStore(s => s.managingTaskIds);
  const retrying = usePeerTaskStore(s => s.retryingTaskIds);
  const recoveryReady = usePeerTaskStore(s => s.recoveryReady);
  const recoveryError = usePeerTaskStore(s => s.recoveryError);
  const customAgents = useAgentsStore((s) => s.customAgents);
  const agents = [...BUILTIN_AGENTS, ...customAgents];
  const current = visibleDispatcherTasks(tasks, sessions);
  const archivedWork = visibleDispatcherTasks(tasks, sessions, undefined, true);
  const work = archived ? archivedWork : current;
  const neighbors = dispatcherTaskNeighbors(work, selectedId);
  const activeCount = work.filter(t => taskWorkGroup(t) === "active").length;
  const attentionCount = work.filter(
    (task) => taskWorkGroup(task) === "attention",
  ).length;
  const active = sessions.find((s) => s.id === activeSessionId);
  const requestedTask = availableDispatcherTasks(tasks, sessions).find((task) => task.id === request?.taskId);
  const requestedTaskId = requestedTask?.id;
  const selected = work.find((task) => task.id === selectedId);
  const ownerId = selected && dispatcherTaskConversation(selected, sessions);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only a new navigation request changes the visibility filter, not an archive action on its task.
  useEffect(() => {
    if (!request || (!requestedTaskId && request.taskId !== null)) return;
    setSelectedId(requestedTaskId ?? null);
    setArchived(Boolean(requestedTask?.archivedAt));
    setOpen(true);
  }, [request, requestedTaskId]);
  useEffect(() => { if (confirmClear) cancelClearRef.current?.focus(); }, [confirmClear]);
  const finished = finishedTasksToArchive(tasks, [...managing, ...retrying]).filter(t => {
    const owner = dispatcherTaskConversation(t, sessions);
    return owner && t.workspaceId === active?.profile?.workspaceId;
  });
  const advanceSelection = () => setSelectedId(id => id === selectedId ? neighbors.next?.id ?? neighbors.previous?.id ?? null : id);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reopening the same task from chat must refocus its row even when selection is unchanged.
  useEffect(() => {
    if (!open || !selectedId) return;
    const frame = requestAnimationFrame(() => {
      const row = [...(navigationRef.current?.querySelectorAll<HTMLButtonElement>("[data-dispatcher-task-id]") ?? [])].find((button) => button.dataset.dispatcherTaskId === selectedId);
      row?.focus();
      row?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, selectedId, request]);
  const changeOpen = (value: boolean) => {
    setOpen(value);
    if (!value) setConfirmClear(false);
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
          title={`Dispatcher: ${current.filter(t => taskWorkGroup(t) === "active").length} active tasks, ${current.filter(t => taskWorkGroup(t) === "attention").length} need attention`}
          aria-label={`Dispatcher. Choose dispatch target. Current target: ${active?.title || "New chat"}. ${current.filter(t => taskWorkGroup(t) === "active").length} active tasks. ${current.filter(t => taskWorkGroup(t) === "attention").length} need attention`}
        >
          <HugeiconsIcon icon={Message01Icon} size={11} />
          <span className="shrink-0 text-[var(--clack-text-3)]">
            Dispatcher
          </span>
          <span className="min-w-0 truncate font-medium">
            {active?.title || "New chat"}
          </span>
          {current.some(t => taskWorkGroup(t) === "active") && (
            <span className="shrink-0 text-[10px] tabular-nums">
              {current.filter(t => taskWorkGroup(t) === "active").length} active
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
        data-dispatcher-surface
        className="clack-workspace relative isolate w-[720px] max-w-[calc(100vw-16px)] max-h-[80dvh] gap-0 overflow-hidden bg-transparent p-0 text-xs [overflow-wrap:anywhere]"
        style={{ background: "var(--clack-bg-workspace)" }}
        onEscapeKeyDown={event => { if (confirmClear) { event.preventDefault(); setConfirmClear(false); } }}
        onCloseAutoFocus={(event) => {
          if (resultNavigation.current) {
            event.preventDefault();
            resultNavigation.current = false;
          }
        }}
      >
        <ConfiguredBackgroundLayer placement="contained" />
        <div className="relative z-[1] min-h-0 overflow-auto p-3">
        <header className="mb-3 space-y-2 border-b border-[var(--clack-border-subtle)] pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <h3 className="text-sm font-semibold">Dispatcher</h3>
              <p role="status" className="text-[11px] text-[var(--clack-text-3)]">{attentionCount} need attention · {activeCount} active · {work.filter(t => taskWorkGroup(t) === "completed").length} completed</p>
            </div>
            <button type="button" aria-label="Close Dispatcher" title="Close Dispatcher" className="grid size-7 shrink-0 place-items-center rounded hover:bg-accent focus-visible:outline" onClick={() => changeOpen(false)}><HugeiconsIcon icon={Cancel01Icon} size={16} /></button>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <fieldset aria-label="Task visibility" className="inline-flex min-w-0 gap-1 rounded border border-[var(--clack-border-subtle)] p-0.5">
              {[[false, "Current", current.length], [true, "Archived", archivedWork.length]].map(([value, label, count]) => <button key={String(label)} type="button" aria-label={value ? "Show archived" : "Show current"} aria-pressed={archived === value} className={cn("rounded px-2 py-1 focus-visible:outline", archived === value && "bg-[var(--clack-accent-soft)] text-[var(--clack-text-1)]")} onClick={() => { setArchived(Boolean(value)); setSelectedId(null); setConfirmClear(false); }}>{label} ({count})</button>)}
            </fieldset>
            {!archived && <button type="button" aria-label="Clear finished" className="inline-flex items-center gap-1 rounded px-1 py-1 text-[var(--clack-text-2)] hover:bg-accent disabled:opacity-40 focus-visible:outline" disabled={!finished.length || clearing || !recoveryReady} onClick={() => { setClearError(""); setConfirmClear(true); }}><HugeiconsIcon icon={Archive02Icon} size={14} />Clear finished</button>}
          </div>
          {confirmClear && <section aria-label="Confirm clear finished" className="space-y-2 border-t border-[var(--clack-border-subtle)] pt-2">
            <p>Removes finished tasks from the active Dispatcher view. Their history and results are retained in Archived.</p>
            <div className="flex flex-wrap gap-2">
              <button ref={cancelClearRef} type="button" disabled={clearing} className="rounded px-2 py-1 hover:bg-accent focus-visible:outline" onClick={() => setConfirmClear(false)}>Cancel</button>
              <button type="button" disabled={clearing || !finished.length} className="rounded bg-[var(--clack-accent-soft)] px-2 py-1 focus-visible:outline" onClick={() => {
                setClearing(true);
                const remaining = work.filter(t => !finished.some(f => f.id === t.id));
                void import("@/modules/ai/lib/taskResultActions").then(module => module.archiveFinishedTasks(finished.map(t => t.id))).then(() => {
                  setConfirmClear(false);
                  setSelectedId(id => finished.some(t => t.id === id) ? remaining[0]?.id ?? null : id);
                }).catch(e => setClearError(String(e))).finally(() => setClearing(false));
              }}>{clearing ? "Clearing..." : `Archive ${finished.length} completed ${finished.length === 1 ? "task" : "tasks"}`}</button>
            </div>
          </section>}
          {clearError && <p role="alert" className="text-destructive">{clearError}</p>}
          {recoveryError && <p role="alert" className="text-[var(--clack-warning)]">{recoveryError}</p>}
        </header>
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
            {dispatcherTaskGroups.map(([group, label]) => {
              const entries = work.filter(
                (task) => taskWorkGroup(task) === group,
              );
              return (
                <section key={group} aria-label={label}>
                  <h4 className="py-1 font-semibold text-[var(--clack-text-3)]">
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
            <nav aria-label="Previous and next tasks" className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-1 border-b border-[var(--clack-border-subtle)] pb-2">
              <button type="button" aria-label="Previous task" title="Previous task" disabled={!neighbors.previous} onClick={() => setSelectedId(neighbors.previous?.id ?? null)} className="inline-flex h-7 items-center gap-1 rounded px-1.5 outline-none hover:bg-accent disabled:opacity-40 focus-visible:ring-1 focus-visible:ring-[var(--clack-focus)]">
                <HugeiconsIcon icon={ArrowLeft01Icon} size={14} /> Previous
              </button>
              <span role="status" className="text-[10px] tabular-nums text-[var(--clack-text-3)]">{neighbors.index < 0 ? "No task selected" : `Task ${neighbors.index + 1} of ${neighbors.count}`}</span>
              <button type="button" aria-label="Next task" title="Next task" disabled={!neighbors.next} onClick={() => setSelectedId(neighbors.next?.id ?? null)} className="inline-flex h-7 items-center gap-1 rounded px-1.5 outline-none hover:bg-accent disabled:opacity-40 focus-visible:ring-1 focus-visible:ring-[var(--clack-focus)]">
                Next <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
              </button>
            </nav>
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
                  onVisibilityChanged={advanceSelection}
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
            Chats ({sessions.length})
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
        </div>
      </PopoverContent>
    </Popover>
  );
}
