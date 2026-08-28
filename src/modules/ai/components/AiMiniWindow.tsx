import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextTrigger,
} from "@/components/ai-elements/context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { CLACK_Z_INDEX } from "@/lib/layers";
import { cn } from "@/lib/utils";
import { ConfiguredBackgroundLayer } from "@/modules/theme/ConfiguredBackgroundLayer";
import { workspaceName, workspacePathsEqual } from "@/modules/workspace";
import { useChat, type UIMessage } from "@ai-sdk/react";
import {
  Add01Icon,
  AlertCircleIcon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Delete02Icon,
  FilterIcon,
  Minimize01Icon,
  StopCircleIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { PresenceState } from "@/lib/usePresence";
import { useEffect, useMemo, useState } from "react";
import { estimateCost, getModelContextLimit } from "../config";
import type { ResizeDir } from "../lib/miniWindowGeometry";
import { resolveModelSelectionInfo } from "../lib/savedProviderModels";
import type { SessionMeta, SessionRunState } from "../lib/sessions";
import { useMiniWindowGeometry } from "../lib/useMiniWindowGeometry";
import { useAgentsStore } from "../store/agentsStore";
import {
  cancelActiveRun,
  cancelRun,
  useChatStore,
} from "../store/chatStore";
import { getOrCreateChat } from "../store/chatRuntime";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { usePlanStore } from "../store/planStore";

const EMPTY_TOKEN_USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
};
import { AgentSwitcher } from "./AgentSwitcher";
import { AgentPermissionControl } from "./AgentPermissionControl";
import { AiChatView } from "./AiChat";
import { PlanDiffReview } from "./PlanDiffReview";
import { TodoStrip } from "./TodoStrip";
import { PeerTaskDialog } from "./PeerTaskDialog";

const SUGGESTIONS = [
  {
    label: "Explain the last error",
    hint: "Read the terminal buffer",
    icon: AlertCircleIcon,
    text: "Explain the last error in the terminal.",
  },
  {
    label: "Generate a command",
    hint: "Tell me what you want to do",
    icon: TerminalIcon,
    text: "Give me a command to ",
  },
  {
    label: "Summarize buffer",
    hint: "Recap recent activity",
    icon: FilterIcon,
    text: "Summarize what just happened in the terminal.",
  },
];

export function AiMiniWindow({ state }: { state: PresenceState }) {
  const closeMini = useChatStore((s) => s.closeMini);
  const minimizeMini = useChatStore((s) => s.minimizeMini);
  const sessionId = useChatStore((s) => s.activeSessionId);
  const openPanel = useChatStore((s) => s.openPanel);
  const expandToPanel = () => {
    closeMini();
    openPanel();
  };

  const { ref, onHeaderPointerDown, startResize } = useMiniWindowGeometry();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        closeMini();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeMini]);

  return (
    <div
      ref={ref}
      data-state={state}
      data-ai-mini-window
      aria-hidden={state !== "open"}
      inert={state !== "open"}
      style={{ zIndex: CLACK_Z_INDEX.miniWindow }}
      className={cn(
        "clack-workspace clack-ai-scrollbars fixed isolate flex flex-col overflow-hidden",
        "rounded-[var(--clack-radius-panel)] border border-[color:var(--clack-border-strong)] text-[12px] text-[var(--clack-text-1)] shadow-[var(--clack-shadow-high)]",
        "duration-200 ease-out",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-2",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:slide-out-to-bottom-2",
      )}
    >
      <ConfiguredBackgroundLayer placement="contained" />
      {RESIZE_DIRS.map((dir) => (
        <ResizeHandle key={dir} dir={dir} onPointerDown={startResize(dir)} />
      ))}
      <div className="relative z-[1] flex min-h-0 flex-1 flex-col overflow-hidden">
        {sessionId ? (
          <Body
            sessionId={sessionId}
            onClose={closeMini}
            onMinimize={minimizeMini}
            onExpand={expandToPanel}
            onHeaderPointerDown={onHeaderPointerDown}
          />
        ) : (
          <EmptyShell
            onClose={closeMini}
            onMinimize={minimizeMini}
            onExpand={expandToPanel}
            onHeaderPointerDown={onHeaderPointerDown}
          />
        )}
        <PlanDiffReview />
      </div>
    </div>
  );
}

const RESIZE_HANDLE_CLASS: Record<ResizeDir, string> = {
  n: "top-0 left-3 right-3 h-1.5 cursor-ns-resize",
  s: "bottom-0 left-3 right-3 h-1.5 cursor-ns-resize",
  w: "top-3 bottom-3 left-0 w-1.5 cursor-ew-resize",
  e: "top-3 bottom-3 right-0 w-1.5 cursor-ew-resize",
  nw: "top-0 left-0 size-3 cursor-nwse-resize",
  ne: "top-0 right-0 size-3 cursor-nesw-resize",
  sw: "bottom-0 left-0 size-3 cursor-nesw-resize",
  se: "bottom-0 right-0 size-3 cursor-nwse-resize",
};

const RESIZE_DIRS: ResizeDir[] = ["n", "s", "w", "e", "nw", "ne", "sw", "se"];

function ResizeHandle({
  dir,
  onPointerDown,
}: {
  dir: ResizeDir;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      data-no-drag
      onPointerDown={onPointerDown}
      className={cn("absolute z-50 touch-none select-none", RESIZE_HANDLE_CLASS[dir])}
    />
  );
}

function Body({
  sessionId,
  onClose,
  onMinimize,
  onExpand,
  onHeaderPointerDown,
}: {
  sessionId: string;
  onClose: () => void;
  onMinimize: () => void;
  onExpand: () => void;
  onHeaderPointerDown: (e: React.PointerEvent) => void;
}) {
  const focusInput = useChatStore((s) => s.focusInput);
  const step = useChatStore(
    (s) => s.runtimeBySession[sessionId]?.step ?? null,
  );
  const run = useChatStore(
    (s) => s.sessions.find((session) => session.id === sessionId)?.run,
  );
  const runState = run?.state;

  const chat = useMemo(() => getOrCreateChat(sessionId), [sessionId]);
  const helpers = useChat<UIMessage>({ chat });
  const isBusy =
    helpers.status === "submitted" || helpers.status === "streaming";

  return (
    <>
      <Header
        sessionId={sessionId}
        step={step}
        isBusy={
          isBusy ||
          (runState === "running" &&
            (run?.budget?.phase === "running" ||
              run?.budget?.phase === "auto-continue-pending"))
        }
        runState={runState}
        onStop={() => cancelRun(sessionId)}
        onClose={onClose}
        onMinimize={onMinimize}
        onExpand={onExpand}
        messages={helpers.messages}
        onHeaderPointerDown={onHeaderPointerDown}
      />

      <PlanModeStrip />

      <div className="flex min-h-0 flex-1 flex-col">
        {helpers.messages.length === 0 ? (
          <EmptyState onPick={focusInput} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col [&_.text-sm]:text-[12px] [&_p]:leading-relaxed">
            <AiChatView
              messages={helpers.messages}
              status={helpers.status}
              error={helpers.error}
              clearError={helpers.clearError}
              addToolApprovalResponse={helpers.addToolApprovalResponse}
              stop={() => cancelRun(sessionId)}
            />
          </div>
        )}
      </div>

      <TodoStrip sessionId={sessionId} />
    </>
  );
}

function PlanModeStrip() {
  const active = usePlanStore((s) => s.active);
  const queueLen = usePlanStore((s) => s.queue.length);
  const disable = usePlanStore((s) => s.disable);
  if (!active) return null;
  return (
    <div className="clack-panel flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
      <span className="size-1.5 shrink-0 rounded-full bg-[var(--clack-warning)]" />
      <span className="text-[11px] font-medium text-[var(--clack-text-1)]">Plan mode</span>
      <span className="text-[11px] text-[var(--clack-text-3)]">
        {queueLen > 0
          ? `| ${queueLen} queued for review`
          : "| waiting for a prompt"}
      </span>
      <span className="flex-1" />
      <button
        type="button"
        onClick={() => disable()}
        className="rounded-[var(--clack-radius-button)] px-1.5 py-0.5 text-[10.5px] text-[var(--clack-text-3)] transition-colors hover:bg-[var(--clack-accent-soft)] hover:text-[var(--clack-text-1)]"
      >
        Exit
      </button>
    </div>
  );
}

function EmptyShell({
  onClose,
  onMinimize,
  onExpand,
  onHeaderPointerDown,
}: {
  onClose: () => void;
  onMinimize: () => void;
  onExpand: () => void;
  onHeaderPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <>
      <Header
        step={null}
        isBusy={false}
        runState={undefined}
        onStop={cancelActiveRun}
        onClose={onClose}
        onMinimize={onMinimize}
        onExpand={onExpand}
        onHeaderPointerDown={onHeaderPointerDown}
      />
      <div className="flex flex-1 items-center justify-center text-[11px] text-[var(--clack-text-3)]">
        Loading sessions...
      </div>
    </>
  );
}

function Header({
  sessionId,
  step,
  isBusy,
  runState,
  onStop,
  onClose,
  onMinimize,
  messages,
  onHeaderPointerDown,
}: {
  sessionId?: string;
  step: string | null;
  isBusy: boolean;
  runState: SessionRunState | undefined;
  onStop: () => void | Promise<void>;
  onClose: () => void;
  onMinimize: () => void;
  onExpand: () => void;
  messages?: UIMessage[];
  onHeaderPointerDown: (e: React.PointerEvent) => void;
}) {
  const defaultAgentId = useAgentsStore((state) => state.activeId);
  const conversationAgentId = useChatStore((state) => {
    const session = state.sessions.find((item) => item.id === sessionId);
    if (runState === "running") return session?.run?.agentId;
    return session?.profile?.agentId;
  });
  const displayedAgentId = conversationAgentId ?? defaultAgentId;

  return (
    <div
      onPointerDown={onHeaderPointerDown}
      className="clack-shell relative flex h-11 shrink-0 cursor-grab items-center justify-between gap-2 border-b px-3 active:cursor-grabbing"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <AgentSwitcher
          isMiniWindow
          agentId={displayedAgentId}
          disabled={runState === "running"}
        />
        <AgentPermissionControl agentId={displayedAgentId} compact />
        {messages !== undefined ? (
          <ContextIndicator sessionId={sessionId} messages={messages} />
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {isBusy ? (
          <span className="flex min-w-0 items-center gap-1 text-[10px] text-[var(--clack-text-3)]">
            <Spinner className="size-2.5" />
            <span className="max-w-32 truncate">{step ?? "Thinking..."}</span>
          </span>
        ) : null}
        {shouldShowHeaderStop(runState) ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void invokeHeaderStop(onStop)}
            className="h-6 gap-1 px-2 text-[10.5px]"
            aria-label="Stop active AI run"
            title="Stop active AI run"
          >
            <HugeiconsIcon icon={StopCircleIcon} size={11} strokeWidth={1.9} />
            Stop
          </Button>
        ) : null}
        <SessionPicker />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={onMinimize}
          className="size-5"
          aria-label="Minimize AI chat"
          title="Minimize"
        >
          <HugeiconsIcon icon={Minimize01Icon} size={11} strokeWidth={1.75} />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={onClose}
          className="size-5"
          aria-label="Close AI chat"
          title="Close (Esc)"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={1.75} />
        </Button>
      </div>
    </div>
  );
}

export function shouldShowHeaderStop(
  runState: SessionRunState | undefined,
): boolean {
  return runState === "running";
}

export function invokeHeaderStop(
  onStop: () => void | Promise<void>,
): void | Promise<void> {
  return onStop();
}

function estimateTokens(messages: UIMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type === "text") {
        chars += (p as { text?: string }).text?.length ?? 0;
      } else if (p.type === "reasoning") {
        chars += (p as { text?: string }).text?.length ?? 0;
      } else if (typeof p.type === "string" && p.type.startsWith("tool-")) {
        const tp = p as unknown as { input?: unknown; output?: unknown };
        if (tp.input) chars += JSON.stringify(tp.input).length;
        if (tp.output) chars += JSON.stringify(tp.output).length;
      }
    }
  }
  return Math.ceil(chars / 4);
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function ContextIndicator({
  sessionId,
  messages,
}: {
  sessionId?: string;
  messages: UIMessage[];
}) {
  const modelId = useChatStore((s) => {
    const session = s.sessions.find((item) => item.id === sessionId);
    return session?.run?.modelId ?? session?.profile?.modelId ?? s.selectedModelId;
  });
  const tokens = useChatStore(
    (s) =>
      s.runtimeBySession[sessionId ?? ""]?.tokens ?? EMPTY_TOKEN_USAGE,
  );
  const lastInput = useChatStore(
    (s) => s.runtimeBySession[sessionId ?? ""]?.lastInputTokens ?? 0,
  );
  const lastCached = useChatStore(
    (s) => s.runtimeBySession[sessionId ?? ""]?.lastCachedTokens ?? 0,
  );
  const estimated = useMemo(() => estimateTokens(messages), [messages]);
  const used = lastInput > 0 ? lastInput : estimated;
  const reported = tokens.inputTokens + tokens.outputTokens;
  const openaiCompatibleContextLimit = usePreferencesStore(
    (s) => s.openaiCompatibleContextLimit,
  );
  const customEndpoints = usePreferencesStore((s) => s.customEndpoints);
  const savedProviderModels = usePreferencesStore(
    (s) => s.savedProviderModels,
  );
  const max = getModelContextLimit(modelId, openaiCompatibleContextLimit);
  const modelLabel = useMemo(() => {
    try {
      return resolveModelSelectionInfo(
        modelId,
        customEndpoints,
        savedProviderModels,
      ).label;
    } catch {
      return modelId;
    }
  }, [customEndpoints, modelId, savedProviderModels]);
  const cost = estimateCost(modelId, tokens);
  const cacheRate =
    tokens.inputTokens > 0
      ? Math.round((tokens.cachedInputTokens / tokens.inputTokens) * 100)
      : 0;

  return (
    <Context usedTokens={used} maxTokens={max} modelId={modelId}>
      <ContextTrigger
        className="h-6 min-w-0 gap-1 px-1 text-[10.5px]"
        title={`Model: ${modelLabel}`}
      >
        <span className="max-w-24 truncate text-[var(--clack-text-2)]">
          {modelLabel}
        </span>
        <span className="shrink-0 text-[9.5px] text-[var(--clack-text-3)]">
          {Math.round((used / Math.max(max, 1)) * 100)}%
        </span>
      </ContextTrigger>
      <ContextContent className="w-64 text-[11px]">
        <ContextContentHeader />
        <ContextContentBody>
          <div className="flex items-center justify-between text-[var(--clack-text-3)]">
            <span>Model</span>
            <span className="font-mono text-[var(--clack-text-1)]">{modelLabel}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[var(--clack-text-3)]">
            <span>{lastInput > 0 ? "Last request" : "Estimated context"}</span>
            <span className="font-mono text-[var(--clack-text-1)]">
              {formatTokens(used)}
            </span>
          </div>
          {lastCached > 0 && (
            <div className="flex items-center justify-between text-[var(--clack-text-3)]">
              <span>Of which cached</span>
              <span className="font-mono text-[var(--clack-text-1)]">
                {formatTokens(lastCached)}
              </span>
            </div>
          )}
          {reported > 0 && (
            <>
              <div className="mt-1.5 flex items-center justify-between text-[var(--clack-text-3)]">
                <span>Session input</span>
                <span className="font-mono text-[var(--clack-text-1)]">
                  {formatTokens(tokens.inputTokens)}
                </span>
              </div>
              <div className="flex items-center justify-between text-[var(--clack-text-3)]">
                <span>Session output</span>
                <span className="font-mono text-[var(--clack-text-1)]">
                  {formatTokens(tokens.outputTokens)}
                </span>
              </div>
              {tokens.cachedInputTokens > 0 && (
                <div className="flex items-center justify-between text-[var(--clack-text-3)]">
                  <span>Cache hit</span>
                  <span className="font-mono text-[var(--clack-text-1)]">{cacheRate}%</span>
                </div>
              )}
              {cost != null && (
                <div className="flex items-center justify-between text-[var(--clack-text-3)]">
                  <span>Session cost</span>
                  <span className="font-mono text-[var(--clack-text-1)]">
                    ${cost.toFixed(cost < 0.01 ? 4 : cost < 1 ? 3 : 2)}
                  </span>
                </div>
              )}
            </>
          )}
          <div className="flex items-center justify-between text-[var(--clack-text-3)]">
            <span>Window</span>
            <span className="font-mono text-[var(--clack-text-1)]">
              {formatTokens(max)}
            </span>
          </div>
        </ContextContentBody>
        <ContextContentFooter>
          <span className="text-[10px] italic text-[var(--clack-text-3)]">
            {lastInput > 0
              ? "Last request reflects current context size; session totals are cumulative."
              : "Token count is approximate (chars / 4)."}
          </span>
        </ContextContentFooter>
      </ContextContent>
    </Context>
  );
}

function SessionPicker() {
  const sessions = useChatStore((s) => s.sessions);
  const activeId = useChatStore((s) => s.activeSessionId);
  const pendingApprovalsBySession = useChatStore(
    (s) => s.pendingApprovalsBySession,
  );
  const switchSession = useChatStore((s) => s.switchSession);
  const newSession = useChatStore((s) => s.newSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const bindSessionToCurrentWorkspace = useChatStore(
    (s) => s.bindSessionToCurrentWorkspace,
  );
  const currentWorkspaceRoot = useChatStore((s) => s.live.getWorkspaceRoot());
  const [peerTarget, setPeerTarget] = useState<SessionMeta | null>(null);

  const active = sessions.find((s) => s.id === activeId) ?? null;
  if (!active) return null;
  const boundWorkspaceRoot = active.profile?.workspaceRoot ?? null;
  const workspaceMatches = workspacePathsEqual(
    boundWorkspaceRoot,
    currentWorkspaceRoot,
  );

  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  const backgroundRunningCount = sessions.filter(
    (session) =>
      session.id !== activeId && session.run?.state === "running",
  ).length;

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex min-w-0 max-w-56 items-center gap-1 rounded-[var(--clack-radius-button)] px-1.5 py-1",
            "text-[11px] text-[var(--clack-text-3)] transition-colors",
            "hover:bg-[var(--clack-accent-soft)] hover:text-[var(--clack-text-1)]",
          )}
          title={
            boundWorkspaceRoot
              ? `Switch session · ${workspaceName(boundWorkspaceRoot)}${
                  backgroundRunningCount > 0
                    ? ` · ${backgroundRunningCount} running in background`
                    : ""
                }`
              : `Switch session · workspace unbound${
                  backgroundRunningCount > 0
                    ? ` · ${backgroundRunningCount} running in background`
                    : ""
                }`
          }
        >
          <span className="truncate">{active.title || "New chat"}</span>
          <span className="shrink-0 text-[var(--clack-text-3)]" aria-hidden>
            /
          </span>
          <span
            className={cn(
              "max-w-20 truncate text-[10px]",
              boundWorkspaceRoot
                ? "text-[var(--clack-text-3)]"
                : "text-[var(--clack-warning)]",
            )}
          >
            {boundWorkspaceRoot
              ? workspaceName(boundWorkspaceRoot)
              : "Unbound"}
          </span>
          {backgroundRunningCount > 0 ? (
            <span
              className="flex shrink-0 items-center gap-1 text-[10px] text-[var(--clack-accent)]"
              title={`${backgroundRunningCount} AI ${
                backgroundRunningCount === 1 ? "run" : "runs"
              } active in background`}
            >
              <Spinner className="size-2.5" />
              {backgroundRunningCount}
            </span>
          ) : null}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={10}
            strokeWidth={2}
            className="opacity-70"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuItem
          onSelect={() => newSession()}
          className="gap-2 text-xs"
        >
          <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={1.75} />
          New session
        </DropdownMenuItem>
        {boundWorkspaceRoot ? (
          <div className="px-2 py-1 text-[10px] text-muted-foreground">
            Workspace: {workspaceName(boundWorkspaceRoot)}
            {!workspaceMatches ? " (not open)" : ""}
          </div>
        ) : currentWorkspaceRoot ? (
          <DropdownMenuItem
            onSelect={() => bindSessionToCurrentWorkspace(active.id)}
            className="text-xs"
          >
            Bind to {workspaceName(currentWorkspaceRoot)}
          </DropdownMenuItem>
        ) : (
          <div className="px-2 py-1 text-[10px] text-muted-foreground">
            No workspace bound
          </div>
        )}
        {sorted.length > 0 ? <DropdownMenuSeparator /> : null}
        {sorted.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            active={s.id === activeId}
            approvalsPending={pendingApprovalsBySession[s.id]?.length ?? 0}
            canPeer={
              s.id !== activeId &&
              !!active.profile?.workspaceId &&
              s.profile?.workspaceId === active.profile.workspaceId
            }
            onSelect={() => switchSession(s.id)}
            onPeer={() => setPeerTarget(s)}
            onDelete={() => deleteSession(s.id)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
    <PeerTaskDialog
      sourceSessionId={active.id}
      target={peerTarget}
      open={peerTarget !== null}
      onOpenChange={(open) => {
        if (!open) setPeerTarget(null);
      }}
    />
    </>
  );
}

function SessionRow({
  session,
  active,
  approvalsPending,
  canPeer,
  onSelect,
  onPeer,
  onDelete,
}: {
  session: SessionMeta;
  active: boolean;
  approvalsPending: number;
  canPeer: boolean;
  onSelect: () => void;
  onPeer: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={(e) => {
        // Don't dismiss if user clicked the trash icon.
        const target = e.target as HTMLElement | null;
        if (target?.closest("[data-session-action]")) {
          e.preventDefault();
          return;
        }
        onSelect();
      }}
      className={cn(
        "group flex items-center justify-between gap-2 text-xs",
        active && "bg-[var(--clack-accent-soft)]",
      )}
    >
      <span className="min-w-0 flex-1 truncate">
        {session.title || "New chat"}
      </span>
      {approvalsPending > 0 ? (
        <span className="shrink-0 text-[10px] text-[var(--clack-warning)]">
          Approval required
        </span>
      ) : session.run?.state === "running" ? (
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-[var(--clack-accent)]">
          <Spinner className="size-2.5" />
          Running
        </span>
      ) : null}
      {canPeer ? (
        <button
          type="button"
          data-session-action
          onClick={(event) => {
            event.stopPropagation();
            onPeer();
          }}
          title={`Ask ${session.title || "this chat"}`}
          className="rounded-[var(--clack-radius-button)] p-0.5 text-[var(--clack-text-3)] opacity-0 transition-opacity hover:bg-[var(--clack-accent-soft)] hover:text-[var(--clack-accent)] group-hover:opacity-100"
        >
          <HugeiconsIcon icon={ArrowRight01Icon} size={11} strokeWidth={1.75} />
        </button>
      ) : null}
      <button
        type="button"
        data-session-action
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Delete session"
        className="rounded-[var(--clack-radius-button)] p-0.5 text-[var(--clack-text-3)] opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
      >
        <HugeiconsIcon icon={Delete02Icon} size={11} strokeWidth={1.75} />
      </button>
    </DropdownMenuItem>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 py-10 text-center">
      <img src="/logo.png" alt="Clack" className="size-14 opacity-90" />
      <div className="space-y-1.5">
        <p className="text-[14px] font-semibold tracking-tight">
          Ask Clack anything
        </p>
        <p className="max-w-[18rem] text-[11.5px] leading-relaxed text-[var(--clack-text-3)]">
          Clack sees the active terminal - cwd, recent commands, and output.
        </p>
      </div>
      <div className="flex w-full flex-col gap-2.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => onPick(s.text)}
            className={cn(
              "clack-ai-block group flex items-center gap-2.5 px-2.5 py-2 text-left",
              "transition-colors hover:border-[color:var(--clack-border-accent)] hover:bg-[var(--clack-accent-soft)]",
            )}
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded-[var(--clack-radius-button)] bg-[var(--clack-surface-2)] text-[var(--clack-accent)] transition-colors">
              <HugeiconsIcon icon={s.icon} size={13} strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium text-[var(--clack-text-1)]">
                {s.label}
              </div>
              <div className="text-[10.5px] text-[var(--clack-text-3)]">
                {s.hint}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
