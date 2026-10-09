import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { CLACK_Z_INDEX } from "@/lib/layers";
import { AiInputBarConnect } from "@/modules/ai";
import { Chip } from "@/modules/ai/components/Chip";
import { ChipsRow } from "@/modules/ai/components/ChipsRow";
import { useComposer } from "@/modules/ai/lib/composer";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePeerTaskStore } from "@/modules/ai/store/peerTaskStore";
import { useAgentsStore } from "@/modules/ai/store/agentsStore";
import { BUILTIN_AGENTS } from "@/modules/ai/lib/agents";
import { focusTaskConversationPane, useDispatcherNavigation } from "@/modules/ai/store/dispatcherNavigation";
import { dispatcherTaskConversation, dispatcherTaskStatus, workspaceDispatcherTasks } from "@/modules/ai/lib/dispatcherTasks";
import { isPeerTaskActive } from "@/modules/ai/lib/peerTaskCancellation";
import { useBlockController } from "@/modules/terminal/lib/blockController";
import { focusLeafInput } from "@/modules/terminal/lib/useTerminalSession";
import { useTheme } from "@/modules/theme";
import {
  AiContentGenerator02Icon,
  Add01Icon,
  ArrowDown01Icon,
  CommandLineIcon,
  Folder01Icon,
  GitBranchIcon,
  Message01Icon,
  TerminalIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { OsIcon } from "./OsIcon";
import { useGitBranch } from "./useGitBranch";
import { useSystemInfo } from "./useSystemInfo";
import { resolveWorkspaceInputPresentation } from "./workspaceInputPresentation";

const ShellInput = lazy(() => import("@/modules/terminal/block/ShellInput"));
const AiComposerInput = lazy(() =>
  import("@/modules/ai/components/AiComposerInput").then((m) => ({
    default: m.AiComposerInput,
  })),
);

export const TOGGLE_BLOCK_INPUT_EVENT = "terax:toggle-block-input";

type Props = {
  isBlockTab: boolean;
  isTerminalTab: boolean;
  activeLeafId: number | null;
  cwd: string | null;
  home: string | null;
  hasComposer: boolean;
  panelOpen: boolean;
  keysLoaded: boolean;
  onConnect: () => void;
};

export function WorkspaceInputBar({
  isBlockTab,
  isTerminalTab,
  activeLeafId,
  cwd,
  home,
  hasComposer,
  panelOpen,
  keysLoaded,
  onConnect,
}: Props) {
  const c = useComposer();
  const focusSignal = useChatStore((s) => s.focusSignal);
  const sessions = useChatStore((s) => s.sessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const switchSession = useChatStore((s) => s.switchSession);
  const newSession = useChatStore((s) => s.newSession);
  const { resolvedMode, themeId, customThemes } = useTheme();
  const themeKey = `${resolvedMode}:${themeId}:${customThemes.length}`;
  const { os, shell } = useSystemInfo();

  const controller = useBlockController(isBlockTab ? activeLeafId : null);
  const blockMode = controller?.blockMode ?? "prompt";

  // Re-resolve the branch chip when a command finishes (covers `git checkout`).
  const [promptNonce, setPromptNonce] = useState(0);
  const prevBlockMode = useRef(blockMode);
  useEffect(() => {
    if (prevBlockMode.current !== "prompt" && blockMode === "prompt") {
      setPromptNonce((n) => n + 1);
    }
    prevBlockMode.current = blockMode;
  }, [blockMode]);
  const branch = useGitBranch(isTerminalTab ? cwd : null, promptNonce);

  const [mode, setMode] = useState<"shell" | "ai">("shell");
  const { showToggle, effectiveMode, mounted, open } =
    resolveWorkspaceInputPresentation({
      isBlockTab,
      hasComposer,
      mode,
      keysLoaded,
      panelOpen,
    });

  const [aiLoaded, setAiLoaded] = useState(false);
  useEffect(() => {
    if (open && effectiveMode === "ai") setAiLoaded(true);
  }, [open, effectiveMode]);
  const renderAi = hasComposer && aiLoaded;
  const activeSession = sessions.find(
    (session) => session.id === activeSessionId,
  );
  const dispatcherTitle = activeSession?.title?.trim() || "New chat";

  const selectDispatcherSession = async (sessionId: string) => {
    const { prepareSessionChat } = await import(
      "@/modules/ai/store/chatRuntime"
    );
    await prepareSessionChat(sessionId);
    switchSession(sessionId);
    requestAnimationFrame(() => c.textareaRef.current?.focus());
  };

  const createDispatcherSession = () => {
    newSession();
    requestAnimationFrame(() => c.textareaRef.current?.focus());
  };

  const switchMode = (next: "shell" | "ai") => {
    setMode(next);
    requestAnimationFrame(() => {
      if (next === "ai") c.textareaRef.current?.focus();
      else if (activeLeafId != null) focusLeafInput(activeLeafId);
    });
  };

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const switchModeRef = useRef(switchMode);
  switchModeRef.current = switchMode;
  useEffect(() => {
    if (!showToggle) return;
    const onToggle = () =>
      switchModeRef.current(modeRef.current === "shell" ? "ai" : "shell");
    window.addEventListener(TOGGLE_BLOCK_INPUT_EVENT, onToggle);
    return () => window.removeEventListener(TOGGLE_BLOCK_INPUT_EVENT, onToggle);
  }, [showToggle]);

  const handledFocusSignal = useRef(focusSignal);
  useEffect(() => {
    if (focusSignal === 0 || handledFocusSignal.current === focusSignal) return;
    handledFocusSignal.current = focusSignal;
    if (showToggle && modeRef.current !== "ai") setMode("ai");
  }, [focusSignal, showToggle]);

  useEffect(() => {
    if (!open || effectiveMode !== "ai" || !renderAi) return;
    const frame = requestAnimationFrame(() => c.textareaRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, effectiveMode, renderAi, c.textareaRef]);

  if (!mounted) return null;

  const terminalChips = isTerminalTab ? (
    <>
      {os && <Chip tone="neutral" iconNode={<OsIcon os={os} />} title={os} />}
      {cwd && (
        <Chip tone="blue" icon={Folder01Icon} title={cwd}>
          {relPath(cwd, home)}
        </Chip>
      )}
      {branch && (
        <Chip tone="violet" icon={GitBranchIcon} title={`Branch: ${branch}`}>
          {branch}
        </Chip>
      )}
      {shell && (
        <Chip tone="emerald" icon={CommandLineIcon}>
          {shell}
        </Chip>
      )}
    </>
  ) : null;

  const content =
    !hasComposer && !isBlockTab ? (
      <AiInputBarConnect onAdd={onConnect} />
    ) : (
      <div className="shrink-0 border-t border-border/60 bg-card/40 px-3 py-2">
        <div className="flex flex-col gap-2 rounded-lg px-1 py-1">
          <ChipsRow
            leading={
              <>
                {terminalChips}
                {effectiveMode === "ai" ? (
                  <DispatcherTarget
                    sessions={sessions}
                    activeSessionId={activeSessionId}
                    onSelect={selectDispatcherSession}
                    onCreate={createDispatcherSession}
                  />
                ) : null}
              </>
            }
            files={c.files}
            attachmentCapabilities={c.attachmentCapabilities}
            modelLabel={c.modelLabel}
            onRemoveFile={c.removeFile}
            onMaterializeArchiveEntry={c.materializeArchiveEntry}
            snippets={c.pickedSnippets}
            onRemoveSnippet={(id) => {
              const snip = c.pickedSnippets.find((s) => s.id === id);
              c.removeSnippet(id);
              if (!snip) return;
              const re = new RegExp(`(^|\\s)#${snip.handle}\\b ?`);
              c.setValue((v) => v.replace(re, (_m, lead: string) => lead));
            }}
            commands={c.pickedCommands}
            onRemoveCommand={(name) => c.removeCommand(name)}
          />

          <div className="flex items-end gap-2.5">
            <div className="relative min-w-0 flex-1">
              {isBlockTab && controller && activeLeafId != null && (
                <div className={cn(effectiveMode !== "shell" && "hidden")}>
                  <Suspense fallback={null}>
                    <ShellInput
                      leafId={activeLeafId}
                      mode={blockMode}
                      focused={effectiveMode === "shell"}
                      themeKey={themeKey}
                      onSubmit={controller.submitCommand}
                      onInterrupt={controller.interrupt}
                      getCwd={controller.getCwd}
                    />
                  </Suspense>
                </div>
              )}
              {renderAi && (
                <div className={cn(effectiveMode !== "ai" && "hidden")}>
                  <div data-ai-composer-role="dispatcher">
                    <Suspense fallback={null}>
                      <AiComposerInput
                        placeholder={`Dispatch to ${dispatcherTitle}   -   # commands, @ files`}
                      />
                    </Suspense>
                  </div>
                </div>
              )}
            </div>
            {showToggle && (
              <div className="shrink-0 pb-px">
                <ModeToggle mode={mode} onChange={switchMode} />
              </div>
            )}
          </div>
        </div>
      </div>
    );

  return (
    <div
      data-ai-input-bar
      data-state={open ? "open" : "closed"}
      className="clack-reveal relative"
      style={{ zIndex: CLACK_Z_INDEX.miniWindow + 1 }}
      aria-hidden={!open}
    >
      <div>{content}</div>
    </div>
  );
}

export function DispatcherTarget({
  sessions,
  activeSessionId,
  onSelect,
  onCreate,
}: {
  sessions: ReturnType<typeof useChatStore.getState>["sessions"];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void | Promise<void>;
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const focusRef = useRef<HTMLDivElement>(null);
  const request = useDispatcherNavigation(state => state.request);
  const tasks = usePeerTaskStore(state => state.tasks);
  const customAgents = useAgentsStore(state => state.customAgents);
  const agents = [...BUILTIN_AGENTS, ...customAgents];
  const active = sessions.find((session) => session.id === activeSessionId);
  const requestedSession = sessions.find(session => session.id === request?.sessionId);
  const work = workspaceDispatcherTasks(tasks, (requestedSession ?? active)?.profile?.workspaceId);
  const activeCount = work.filter(isPeerTaskActive).length;
  const requestedTask = work.find(task => task.id === request?.taskId);
  useEffect(() => {
    if (requestedTask && request) setOpen(true);
  }, [requestedTask, request]);
  useEffect(() => {
    if (!open || !request) return;
    const frame = requestAnimationFrame(() => {
      focusRef.current?.focus();
      focusRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, request]);
  const changeOpen = (value: boolean) => {
    setOpen(value);
    if (!value) useDispatcherNavigation.setState({ request: null });
  };
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <DropdownMenu open={open} onOpenChange={changeOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-ai-dispatch-target
          className="inline-flex h-[22px] max-w-[15rem] items-center gap-1.5 rounded-md border border-[color:var(--clack-border-strong)] bg-[var(--clack-accent-soft)] px-2 text-[11px] text-[var(--clack-text-1)] outline-none transition-colors hover:bg-accent/70 focus-visible:ring-1 focus-visible:ring-[var(--clack-focus)]"
          title={`Dispatcher: chats and assigned tasks. ${activeCount} active tasks`}
          aria-label={`Dispatcher. Choose dispatch target. Current target: ${active?.title || "New chat"}. ${activeCount} active tasks`}
        >
          <HugeiconsIcon icon={Message01Icon} size={11} strokeWidth={1.8} />
          <span className="shrink-0 text-[var(--clack-text-3)]">Dispatcher</span>
          <span className="min-w-0 truncate font-medium">
            {active?.title || "New chat"}
          </span>
          {activeCount > 0 && <span className="shrink-0 text-[10px] tabular-nums text-[var(--clack-accent)]">{activeCount} active</span>}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={10}
            strokeWidth={2}
            className="shrink-0 text-[var(--clack-text-3)]"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="max-h-[70dvh] w-80 max-w-[calc(100vw-24px)] overflow-y-auto">
        {work.length > 0 && <>
          <div className="px-2 py-1 text-[10px] font-medium uppercase text-[var(--clack-text-3)]">Assigned tasks</div>
          {work.map(task => {
            const parent = sessions.find(session => session.id === task.sourceSessionId && session.profile?.workspaceId === task.workspaceId);
            const conversationId = dispatcherTaskConversation(task, sessions);
            const agent = agents.find(agent => agent.id === task.targetAgentId)?.name ?? task.targetAgentId;
            return <DropdownMenuItem
              key={task.id}
              ref={task.id === request?.taskId ? focusRef : undefined}
              data-dispatcher-task-id={task.id}
              disabled={!conversationId}
              onSelect={async () => {
                if (!conversationId) return;
                await onSelect(conversationId);
                focusTaskConversationPane(conversationId);
              }}
              className="min-w-0 flex-col items-start gap-1 px-2 py-1.5 text-xs"
            >
              <span className="flex w-full min-w-0 gap-2"><span className="min-w-0 flex-1 truncate font-medium">{agent}</span><span className="shrink-0 text-[10px]">{dispatcherTaskStatus(task)}</span></span>
              <span className="max-w-full truncate text-[10px] text-[var(--clack-text-3)]">{parent?.title ?? "Deleted conversation"}</span>
              <span className="max-w-full truncate" title={task.prompt}>{task.prompt}</span>
            </DropdownMenuItem>;
          })}
          <DropdownMenuSeparator />
        </>}
        <div className="px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase text-[var(--clack-text-3)]">
          Dispatch to chat
        </div>
        {sorted.map((session) => {
          const selected = session.id === activeSessionId;
          return (
            <DropdownMenuItem
              key={session.id}
              onSelect={() => onSelect(session.id)}
              className={cn(
                "min-w-0 gap-2 px-2 py-1.5 text-xs",
                selected && "bg-[var(--clack-accent-soft)]",
              )}
            >
              <HugeiconsIcon
                icon={Message01Icon}
                size={12}
                strokeWidth={1.75}
                className="shrink-0 text-[var(--clack-text-3)]"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">
                  {session.title || "New chat"}
                </span>
                <span className="truncate text-[10px] font-normal text-[var(--clack-text-3)]">
                  {session.run?.state === "running"
                    ? "Running"
                    : workspaceLabel(session.profile?.workspaceRoot)}
                </span>
              </span>
              {selected ? (
                <HugeiconsIcon
                  icon={Tick02Icon}
                  size={12}
                  strokeWidth={2}
                  className="shrink-0"
                />
              ) : null}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={onCreate}
          className="gap-2 px-2 py-1.5 text-xs"
        >
          <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={1.8} />
          New chat
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function workspaceLabel(root: string | null | undefined): string {
  if (!root) return "Unbound conversation";
  const segments = root.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || root;
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: "shell" | "ai";
  onChange: (next: "shell" | "ai") => void;
}) {
  return (
    <div className="relative grid shrink-0 grid-cols-2 rounded-md p-0.5 text-[10.5px] ring-1 ring-inset ring-border/35">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-[4px] bg-accent/60 transition-transform duration-200 ease-out"
        style={{
          transform: mode === "ai" ? "translateX(100%)" : "translateX(0)",
        }}
      />
      <SegButton
        active={mode === "shell"}
        icon={TerminalIcon}
        label="Shell"
        onClick={() => onChange("shell")}
      />
      <SegButton
        active={mode === "ai"}
        icon={AiContentGenerator02Icon}
        label="AI"
        onClick={() => onChange("ai")}
      />
    </div>
  );
}

function SegButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof AiContentGenerator02Icon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative z-10 flex items-center justify-center gap-1 rounded-[4px] px-2 py-[2.5px] font-medium transition-colors",
        active
          ? "text-foreground/90"
          : "text-muted-foreground/70 hover:text-foreground",
      )}
    >
      <HugeiconsIcon icon={icon} size={11} strokeWidth={1.75} />
      {label}
    </button>
  );
}

function relPath(p: string, home: string | null): string {
  if (!home) return p;
  const h = home.replace(/\/+$/, "");
  if (p === h || p.startsWith(`${h}/`)) return `~${p.slice(h.length)}`;
  return p;
}
