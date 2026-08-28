import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { CheckmarkSquare02Icon, SquareIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect } from "react";
import type { Todo } from "../lib/todos";
import { useChatStore } from "../store/chatStore";
import { useTodosStore } from "../store/todoStore";

type Props = { sessionId: string | null };

const EMPTY_TODOS: Todo[] = [];

export function TodoStrip({ sessionId }: Props) {
  const hydrate = useTodosStore((s) => s.hydrate);
  const todos =
    useTodosStore((s) => (sessionId ? s.bySession[sessionId] : undefined)) ??
    EMPTY_TODOS;
  const runState = useChatStore(
    (state) =>
      state.sessions.find((session) => session.id === sessionId)?.run?.state,
  );

  useEffect(() => {
    if (sessionId) void hydrate(sessionId);
  }, [sessionId, hydrate]);

  if (!sessionId || !shouldShowTodoStrip(runState, todos.length)) return null;

  const completed = todos.filter((t) => t.status === "completed").length;
  const pct = Math.round((completed / todos.length) * 100);

  return (
    <div className="clack-panel flex max-h-[35%] min-h-0 shrink-0 flex-col border-t px-3 py-1.5">
      <div className="my-1.5 flex items-center gap-2 shrink-0">
        <span className="text-[11px] font-medium text-foreground">Todos</span>
        <Progress value={pct} className="h-1 flex-1" />
        <span className="text-[11px] tabular-nums font-mono text-muted-foreground">
          {completed}/{todos.length}
        </span>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <ul className="flex flex-col gap-0.5">
          {todos.map((t) => (
            <TodoRow key={t.id} todo={t} />
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}

export function shouldShowTodoStrip(
  runState: string | undefined,
  todoCount: number,
): boolean {
  return runState === "running" && todoCount > 0;
}

function TodoRow({ todo }: { todo: Todo }) {
  const isInProgress = todo.status === "in_progress";
  const isTerminal =
    todo.status === "cancelled" ||
    todo.status === "interrupted" ||
    todo.status === "failed";
  const row = (
    <li
      className={cn(
        "flex items-start gap-2 rounded px-1.5 py-1 text-[11px] leading-snug",
        isInProgress && "border-l-2 border-foreground/50 bg-muted/40",
      )}
    >
      <span className="mt-[2px] inline-flex size-3.5 shrink-0 items-center justify-center">
        {isInProgress ? (
          <Spinner className="size-3" />
        ) : (
          <HugeiconsIcon
            icon={
              todo.status === "completed" ? CheckmarkSquare02Icon : SquareIcon
            }
            strokeWidth={1.75}
          />
        )}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1",
          todo.status === "completed"
            ? "text-muted-foreground/60 line-through"
            : isTerminal
              ? "text-muted-foreground/60 line-through"
            : isInProgress
              ? "text-foreground"
              : "text-muted-foreground",
        )}
      >
        {todo.title}
        {isTerminal ? (
          <span className="ml-1 text-[9.5px] uppercase">{todo.status}</span>
        ) : null}
      </span>
    </li>
  );

  if (!todo.description) return row;
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{row}</TooltipTrigger>
        <TooltipContent side="left" className="max-w-xs text-[11px]">
          {todo.description}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
