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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
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
  LayoutTwoColumnIcon,
  LayoutTwoRowIcon,
  Mic01Icon,
  Minimize01Icon,
  StopCircleIcon,
  TerminalIcon,
  ArrowUpIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { PresenceState } from "@/lib/usePresence";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { estimateCost, getModelContextLimit } from "../config";
import type { ResizeDir } from "../lib/miniWindowGeometry";
import { resolveModelSelectionInfo } from "../lib/savedProviderModels";
import type { SessionMeta, SessionRunState } from "../lib/sessions";
import { useMiniWindowGeometry } from "../lib/useMiniWindowGeometry";
import {
  ACCEPTED_FILES,
  AiComposerProvider,
  useComposer,
} from "../lib/composer";
import { useAgentsStore } from "../store/agentsStore";
import { cancelRun, useChatStore } from "../store/chatStore";
import { getOrCreateChat, prepareSessionChat } from "../store/chatRuntime";
import {
  canAddAiPane,
  focusAiPaneElement,
  useAiPaneStore,
} from "../store/aiPaneStore";
import {
  leafIds,
  type PaneNode,
  type SplitDir,
} from "@/modules/terminal/lib/panes";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { usePlanStore } from "../store/planStore";
import { usePeerTaskStore } from "../store/peerTaskStore";
import { isPeerTaskActive } from "../lib/peerTaskCancellation";
import { activeDelegationAgentCount } from "../lib/delegationUx";
import type { PeerTask } from "../lib/peerTasks";

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
import { AiComposerInput } from "./AiComposerInput";
import { ChipsRow } from "./ChipsRow";
import { ModelDropdown } from "./AiStatusBarControls";
import { BUILTIN_AGENTS } from "../lib/agents";

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
  const tree = useAiPaneStore((s) => s.tree);
  const activePaneId = useAiPaneStore((s) => s.activePaneId);
  const initializePanes = useAiPaneStore((s) => s.initialize);
  const splitPane = useAiPaneStore((s) => s.splitPane);
  const paneCount = leafIds(tree).length;

  const { ref, onHeaderPointerDown, startResize, ensureWidth, ensureHeight } =
    useMiniWindowGeometry();

  useEffect(() => initializePanes(sessionId), [initializePanes, sessionId]);
  useEffect(() => {
    if (paneCount > 1) ensureWidth(paneCount * 360);
  }, [ensureWidth, paneCount]);

  const addPane = (dir: SplitDir = "row") => {
    if (!canAddAiPane(window.innerWidth, paneCount, dir, window.innerHeight))
      return;
    const paneId = splitPane(activePaneId, dir);
    if (paneId === null) return;
    if (dir === "row") ensureWidth(paneCount * 360 + 360);
    else ensureHeight(paneCount * 280 + 280);
    focusAiPaneElement(paneId);
  };

  const canSplitRight = canAddAiPane(
    window.innerWidth,
    paneCount,
    "row",
    window.innerHeight,
  );
  const canSplitDown = canAddAiPane(
    window.innerWidth,
    paneCount,
    "col",
    window.innerHeight,
  );

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
        <WindowHeader
          paneCount={paneCount}
          canSplitRight={canSplitRight}
          canSplitDown={canSplitDown}
          onSplitRight={() => addPane("row")}
          onSplitDown={() => addPane("col")}
          onClose={closeMini}
          onMinimize={minimizeMini}
          onPointerDown={onHeaderPointerDown}
        />
        <AiPaneTree node={tree} activePaneId={activePaneId} />
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
      className={cn(
        "absolute z-50 touch-none select-none",
        RESIZE_HANDLE_CLASS[dir],
      )}
    />
  );
}

function AiPaneTree({
  node,
  activePaneId,
}: {
  node: PaneNode;
  activePaneId: number;
}) {
  const bindings = useAiPaneStore((s) => s.bindings);
  const focusPane = useAiPaneStore((s) => s.focusPane);
  const bindSession = useAiPaneStore((s) => s.bindSession);
  const splitPane = useAiPaneStore((s) => s.splitPane);
  const closePane = useAiPaneStore((s) => s.closePane);
  const switchSession = useChatStore((s) => s.switchSession);
  const paneCount = leafIds(useAiPaneStore((s) => s.tree)).length;

  if (node.kind === "split") {
    return (
      <ResizablePanelGroup
        orientation={node.dir === "row" ? "horizontal" : "vertical"}
        className="min-h-0 flex-1"
      >
        {node.children.map((child, index) => (
          <Fragment key={leafIds(child)[0]}>
            {index > 0 ? <ResizableHandle /> : null}
            <ResizablePanel id={`ai-pane-${child.id}`} minSize="20%">
              <AiPaneTree node={child} activePaneId={activePaneId} />
            </ResizablePanel>
          </Fragment>
        ))}
      </ResizablePanelGroup>
    );
  }

  const sessionId = bindings[node.id] ?? null;
  const focused = node.id === activePaneId;
  const activate = () => {
    focusPane(node.id);
    if (sessionId) switchSession(sessionId);
  };
  const openSession = async (targetSessionId: string, paneId = node.id) => {
    await prepareSessionChat(targetSessionId);
    if (!bindSession(paneId, targetSessionId)) return;
    switchSession(targetSessionId);
    focusAiPaneElement(paneId);
  };
  const openPeerSession = (targetSessionId: string) => {
    const existing = Object.entries(bindings).find(
      ([, boundSessionId]) => boundSessionId === targetSessionId,
    );
    if (existing) {
      const paneId = Number(existing[0]);
      focusPane(paneId);
      switchSession(targetSessionId);
      focusAiPaneElement(paneId);
      return;
    }
    const currentPaneCount = leafIds(useAiPaneStore.getState().tree).length;
    const targetPaneId = canAddAiPane(
      window.innerWidth,
      currentPaneCount,
      "row",
      window.innerHeight,
    )
      ? (splitPane(node.id, "row") ?? node.id)
      : node.id;
    void openSession(targetSessionId, targetPaneId);
  };
  const close = () => {
    const nextFocus = closePane(node.id);
    if (nextFocus === null) return;
    const nextSession = useAiPaneStore.getState().bindings[nextFocus];
    if (nextSession) switchSession(nextSession);
    focusAiPaneElement(nextFocus);
  };

  return (
    <section
      tabIndex={-1}
      data-ai-pane-id={node.id}
      data-ai-pane-active={focused ? "true" : "false"}
      onMouseDownCapture={activate}
      onFocusCapture={activate}
      className={cn(
        "relative flex h-full min-h-0 w-full flex-col overflow-hidden outline-none",
        focused &&
          paneCount > 1 &&
          "ring-1 ring-inset ring-[var(--clack-focus)]/45",
      )}
    >
      {sessionId ? (
        <Body
          sessionId={sessionId}
          paneCount={paneCount}
          focused={focused}
          onClosePane={close}
          onOpenSession={openPeerSession}
        />
      ) : (
        <SessionChooser paneId={node.id} onOpenSession={openSession} />
      )}
    </section>
  );
}

function Body({
  sessionId,
  paneCount,
  focused,
  onClosePane,
  onOpenSession,
}: {
  sessionId: string;
  paneCount: number;
  focused: boolean;
  onClosePane: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  return (
    <AiComposerProvider sessionId={sessionId} consumeExternalEvents={false}>
      <SessionPane
        sessionId={sessionId}
        paneCount={paneCount}
        focused={focused}
        onClosePane={onClosePane}
        onOpenSession={onOpenSession}
      />
    </AiComposerProvider>
  );
}

function SessionPane({
  sessionId,
  paneCount,
  focused,
  onClosePane,
  onOpenSession,
}: {
  sessionId: string;
  paneCount: number;
  focused: boolean;
  onClosePane: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const composer = useComposer();
  const step = useChatStore((s) => s.runtimeBySession[sessionId]?.step ?? null);
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
        paneCount={paneCount}
        onClosePane={onClosePane}
        messages={helpers.messages}
      />

      {focused ? <PlanModeStrip /> : null}

      <div className="flex min-h-0 flex-1 flex-col">
        {helpers.messages.length === 0 ? (
          <EmptyState
            onPick={(text) => {
              composer.setValue(text);
              requestAnimationFrame(() =>
                composer.textareaRef.current?.focus(),
              );
            }}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col [&_.text-sm]:text-[12px] [&_p]:leading-relaxed">
            <AiChatView
              sessionId={sessionId}
              onOpenSession={onOpenSession}
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
      <PaneComposer sessionId={sessionId} />
    </>
  );
}

function PaneComposer({ sessionId }: { sessionId: string }) {
  const composer = useComposer();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const title = useChatStore(
    (state) =>
      state.sessions.find((session) => session.id === sessionId)?.title ||
      "this chat",
  );
  return (
    <div
      data-ai-composer-role="reply"
      className="shrink-0 border-t border-[color:var(--clack-border-subtle)] bg-[color-mix(in_srgb,var(--clack-surface-1)_82%,transparent)] px-3 py-2"
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_FILES}
          className="hidden"
          onChange={(event) => {
            void composer.addFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <ChipsRow
          files={composer.files}
          attachmentCapabilities={composer.attachmentCapabilities}
          modelLabel={composer.modelLabel}
          onRemoveFile={composer.removeFile}
          onMaterializeArchiveEntry={composer.materializeArchiveEntry}
          snippets={composer.pickedSnippets}
          onRemoveSnippet={composer.removeSnippet}
          commands={composer.pickedCommands}
          onRemoveCommand={composer.removeCommand}
        />
        <div className="flex min-w-0 items-end gap-1.5">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
            disabled={composer.isBusy}
            className="size-7 shrink-0"
            aria-label="Attach file or image"
            title="Attach file or image"
          >
            <HugeiconsIcon icon={Add01Icon} size={13} strokeWidth={1.8} />
          </Button>
          {composer.voice.supported ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() =>
                composer.voice.recording
                  ? composer.voice.stop()
                  : void composer.voice.start()
              }
              disabled={
                composer.isBusy ||
                composer.voice.transcribing ||
                !composer.voice.hasKey
              }
              className="size-7 shrink-0"
              aria-label={
                composer.voice.recording ? "Stop and transcribe" : "Voice input"
              }
              title={
                composer.voice.recording ? "Stop and transcribe" : "Voice input"
              }
            >
              {composer.voice.transcribing ? (
                <Spinner className="size-3" />
              ) : (
                <HugeiconsIcon icon={Mic01Icon} size={13} strokeWidth={1.8} />
              )}
            </Button>
          ) : null}
          <div className="min-w-0 flex-1 py-0.5">
            <AiComposerInput
              showAgentSwitcher={false}
              placeholder={`Reply to ${title}`}
            />
          </div>
          <Button
            type="button"
            size="icon"
            onClick={composer.isBusy ? composer.stop : composer.submit}
            disabled={!composer.isBusy && !composer.canSend}
            className="size-7 shrink-0"
            aria-label={composer.isBusy ? "Stop AI run" : "Send message"}
            title={composer.isBusy ? "Stop" : "Send (Enter)"}
          >
            <HugeiconsIcon
              icon={composer.isBusy ? StopCircleIcon : ArrowUpIcon}
              size={13}
              strokeWidth={1.8}
            />
          </Button>
        </div>
      </div>
    </div>
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
      <span className="text-[11px] font-medium text-[var(--clack-text-1)]">
        Plan mode
      </span>
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

function Header({
  sessionId,
  step,
  isBusy,
  runState,
  onStop,
  paneCount,
  onClosePane,
  messages,
}: {
  sessionId: string;
  step: string | null;
  isBusy: boolean;
  runState: SessionRunState | undefined;
  onStop: () => void | Promise<void>;
  paneCount: number;
  onClosePane: () => void;
  messages?: UIMessage[];
}) {
  const defaultAgentId = useAgentsStore((state) => state.activeId);
  const conversationAgentId = useChatStore((state) => {
    const session = state.sessions.find((item) => item.id === sessionId);
    if (runState === "running") return session?.run?.agentId;
    return session?.profile?.agentId;
  });
  const displayedAgentId = conversationAgentId ?? defaultAgentId;

  return (
    <div className="clack-shell relative flex shrink-0 flex-col gap-0.5 border-b px-2 py-1">
      <div className="flex min-w-0 items-center gap-1">
        <SessionPicker sessionId={sessionId} />
        <span className="flex-1" />
        {isBusy ? (
          <span className="flex min-w-0 items-center gap-1 text-[10px] text-[var(--clack-text-3)]">
            <Spinner className="size-2.5" />
            <span className="max-w-20 truncate">{step ?? "Thinking..."}</span>
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
        <PeerAction sessionId={sessionId} />
        {paneCount > 1 ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onClosePane}
            className="size-5"
            aria-label="Close AI pane"
            title="Close pane"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={1.75} />
          </Button>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        <AgentSwitcher
          isMiniWindow
          agentId={displayedAgentId}
          sessionId={sessionId}
          disabled={runState === "running"}
        />
        <ModelDropdown sessionId={sessionId} compact />
        <AgentPermissionControl agentId={displayedAgentId} compact />
        {messages !== undefined ? (
          <ContextIndicator sessionId={sessionId} messages={messages} compact />
        ) : null}
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
  compact = false,
}: {
  sessionId?: string;
  messages: UIMessage[];
  compact?: boolean;
}) {
  const modelId = useChatStore((s) => {
    const session = s.sessions.find((item) => item.id === sessionId);
    return (
      session?.run?.modelId ?? session?.profile?.modelId ?? s.selectedModelId
    );
  });
  const tokens = useChatStore(
    (s) => s.runtimeBySession[sessionId ?? ""]?.tokens ?? EMPTY_TOKEN_USAGE,
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
  const savedProviderModels = usePreferencesStore((s) => s.savedProviderModels);
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
        {!compact ? (
          <span className="max-w-24 truncate text-[var(--clack-text-2)]">
            {modelLabel}
          </span>
        ) : null}
        <span className="shrink-0 text-[9.5px] text-[var(--clack-text-3)]">
          {Math.round((used / Math.max(max, 1)) * 100)}%
        </span>
      </ContextTrigger>
      <ContextContent className="w-64 text-[11px]">
        <ContextContentHeader />
        <ContextContentBody>
          <div className="flex items-center justify-between text-[var(--clack-text-3)]">
            <span>Model</span>
            <span className="font-mono text-[var(--clack-text-1)]">
              {modelLabel}
            </span>
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
                  <span className="font-mono text-[var(--clack-text-1)]">
                    {cacheRate}%
                  </span>
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

function SessionChooser({
  paneId,
  onOpenSession,
}: {
  paneId: number;
  onOpenSession: (sessionId: string, paneId?: number) => Promise<void>;
}) {
  const sessions = useChatStore((s) => s.sessions);
  const hydrated = useChatStore((s) => s.sessionsHydrated);
  const newSession = useChatStore((s) => s.newSession);
  const pendingApprovals = useChatStore((s) => s.pendingApprovalsBySession);
  const bindings = useAiPaneStore((s) => s.bindings);
  const visibleSessionIds = useMemo(
    () => Object.values(bindings).filter((id): id is string => Boolean(id)),
    [bindings],
  );
  const sorted = useMemo(
    () => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions],
  );
  const create = () => {
    const sessionId = newSession();
    void onOpenSession(sessionId, paneId);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[color-mix(in_srgb,var(--clack-surface-1)_55%,transparent)]">
      <div className="border-b border-[color:var(--clack-border-subtle)] px-3 py-2">
        <div className="text-[11.5px] font-semibold text-[var(--clack-text-1)]">
          Open a chat in this pane
        </div>
        <div className="mt-0.5 text-[10.5px] text-[var(--clack-text-3)]">
          Each pane keeps its own agent, model, approvals, and run controls.
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <Button
          type="button"
          variant="outline"
          onClick={create}
          className="mb-2 h-8 w-full justify-start gap-2 text-[11px]"
        >
          <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={1.8} />
          New chat
        </Button>
        {!hydrated ? (
          <div className="flex items-center gap-2 px-2 py-3 text-[11px] text-[var(--clack-text-3)]">
            <Spinner className="size-3" /> Loading chats...
          </div>
        ) : sorted.length === 0 ? (
          <div className="px-2 py-3 text-[11px] text-[var(--clack-text-3)]">
            No saved chats yet.
          </div>
        ) : (
          <div className="space-y-1">
            {sorted.map((session) => {
              const openElsewhere = visibleSessionIds.includes(session.id);
              const approvals = pendingApprovals[session.id]?.length ?? 0;
              return (
                <button
                  key={session.id}
                  type="button"
                  disabled={openElsewhere}
                  onClick={() => void onOpenSession(session.id, paneId)}
                  className="flex w-full items-center gap-2 rounded-[var(--clack-radius-button)] px-2.5 py-2 text-left transition-colors hover:bg-[var(--clack-accent-soft)] disabled:cursor-default disabled:opacity-55"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-medium text-[var(--clack-text-1)]">
                      {session.title || "New chat"}
                    </span>
                    <span className="block truncate text-[10px] text-[var(--clack-text-3)]">
                      {session.profile?.agentId ?? "Agent"} |{" "}
                      {session.profile?.modelId ?? "No model"}
                    </span>
                  </span>
                  <SessionStatus
                    state={session.run?.state}
                    approvals={approvals}
                    openElsewhere={openElsewhere}
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SessionStatus({
  state,
  approvals,
  openElsewhere,
}: {
  state?: SessionRunState;
  approvals: number;
  openElsewhere?: boolean;
}) {
  if (openElsewhere) {
    return (
      <span className="text-[9.5px] text-[var(--clack-text-3)]">Open</span>
    );
  }
  if (approvals > 0) {
    return (
      <span className="text-[9.5px] text-[var(--clack-warning)]">Approval</span>
    );
  }
  if (state === "running") {
    return (
      <span className="flex items-center gap-1 text-[9.5px] text-[var(--clack-accent)]">
        <Spinner className="size-2.5" /> Running
      </span>
    );
  }
  if (state === "failed") {
    return <span className="text-[9.5px] text-destructive">Failed</span>;
  }
  if (state === "completed") {
    return (
      <span className="text-[9.5px] text-[var(--clack-success)]">Done</span>
    );
  }
  return <span className="text-[9.5px] text-[var(--clack-text-3)]">Idle</span>;
}

export function PeerAction({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 gap-1 px-1.5 text-[10.5px]"
        title="Send a focused task to another agent"
        aria-label="Ask another agent"
        onClick={() => setOpen(true)}
      >
        <HugeiconsIcon icon={ArrowRight01Icon} size={11} strokeWidth={1.8} />
        Ask another agent
      </Button>
      <PeerTaskDialog
        sourceSessionId={sessionId}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

function SessionPicker({ sessionId }: { sessionId: string }) {
  const sessions = useChatStore((s) => s.sessions);
  const pendingApprovalsBySession = useChatStore(
    (s) => s.pendingApprovalsBySession,
  );
  const switchSession = useChatStore((s) => s.switchSession);
  const newSession = useChatStore((s) => s.newSession);
  const paneId = useAiPaneStore((s) => s.activePaneId);
  const bindSession = useAiPaneStore((s) => s.bindSession);
  const bindings = useAiPaneStore((s) => s.bindings);
  const visibleSessionIds = useMemo(
    () => Object.values(bindings).filter((id): id is string => Boolean(id)),
    [bindings],
  );
  const deleteSession = useChatStore((s) => s.deleteSession);
  const bindSessionToCurrentWorkspace = useChatStore(
    (s) => s.bindSessionToCurrentWorkspace,
  );
  const currentWorkspaceRoot = useChatStore((s) => s.live.getWorkspaceRoot());
  const active = sessions.find((s) => s.id === sessionId) ?? null;
  if (!active) return null;
  const boundWorkspaceRoot = active.profile?.workspaceRoot ?? null;
  const workspaceMatches = workspacePathsEqual(
    boundWorkspaceRoot,
    currentWorkspaceRoot,
  );

  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  const backgroundRunningCount = sessions.filter(
    (session) => session.id !== sessionId && session.run?.state === "running",
  ).length;
  const selectSession = async (targetSessionId: string) => {
    if (visibleSessionIds.includes(targetSessionId)) return;
    await prepareSessionChat(targetSessionId);
    if (!bindSession(paneId, targetSessionId)) return;
    switchSession(targetSessionId);
  };
  const createSession = () => {
    const targetSessionId = newSession();
    bindSession(paneId, targetSessionId);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex min-w-0 max-w-36 items-center gap-1 rounded-[var(--clack-radius-button)] px-1.5 py-1",
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
        <DropdownMenuItem onSelect={createSession} className="gap-2 text-xs">
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
            active={s.id === sessionId}
            approvalsPending={pendingApprovalsBySession[s.id]?.length ?? 0}
            openElsewhere={
              s.id !== sessionId && visibleSessionIds.includes(s.id)
            }
            onSelect={() => void selectSession(s.id)}
            onDelete={
              s.id === sessionId || visibleSessionIds.includes(s.id)
                ? undefined
                : () => deleteSession(s.id)
            }
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WindowHeader({
  paneCount,
  canSplitRight,
  canSplitDown,
  onSplitRight,
  onSplitDown,
  onClose,
  onMinimize,
  onPointerDown,
}: {
  paneCount: number;
  canSplitRight: boolean;
  canSplitDown: boolean;
  onSplitRight: () => void;
  onSplitDown: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onPointerDown: (event: React.PointerEvent) => void;
}) {
  return (
    <div
      onPointerDown={onPointerDown}
      className="clack-shell flex h-9 shrink-0 cursor-grab items-center gap-2 border-b px-2.5 active:cursor-grabbing"
    >
      <span className="text-[11px] font-semibold text-[var(--clack-text-1)]">
        AI Chat
      </span>
      <span className="text-[10px] text-[var(--clack-text-3)]">
        {paneCount} pane{paneCount === 1 ? "" : "s"}
      </span>
      <DelegationActivity />
      <span className="flex-1" />
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={!canSplitRight}
        onClick={onSplitRight}
        className="size-6 disabled:opacity-35"
        title={
          canSplitRight
            ? "Split AI chat right (Ctrl+T)"
            : "No room for another AI pane"
        }
        aria-label="Split AI chat right"
      >
        <HugeiconsIcon
          icon={LayoutTwoColumnIcon}
          size={13}
          strokeWidth={1.85}
        />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={!canSplitDown}
        onClick={onSplitDown}
        className="size-6 disabled:opacity-35"
        title={
          canSplitDown ? "Split AI chat down" : "No room for another AI pane"
        }
        aria-label="Split AI chat down"
      >
        <HugeiconsIcon icon={LayoutTwoRowIcon} size={13} strokeWidth={1.85} />
      </Button>
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
  );
}

function DelegationActivity() {
  const tasks = usePeerTaskStore((state) => state.tasks);
  const sessions = useChatStore((state) => state.sessions);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const customAgents = useAgentsStore((state) => state.customAgents);
  const workspaceId = sessions.find((session) => session.id === activeSessionId)
    ?.profile?.workspaceId;
  const activeTasks = useMemo(
    () =>
      tasks.filter(
        (task) => task.workspaceId === workspaceId && isPeerTaskActive(task),
      ),
    [tasks, workspaceId],
  );
  if (activeTasks.length === 0) return null;

  const agentCount = activeDelegationAgentCount(tasks, workspaceId);
  const agents = [...BUILTIN_AGENTS, ...customAgents];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 rounded-[var(--clack-radius-button)] px-1.5 py-0.5 text-[10px] text-[var(--clack-accent)] hover:bg-[var(--clack-accent-soft)]"
          aria-label={`${agentCount} ${agentCount === 1 ? "agent" : "agents"} active`}
        >
          <Spinner className="size-2.5" />
          {agentCount} {agentCount === 1 ? "agent" : "agents"} active
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-2 p-2.5">
        <div className="px-1 text-[10px] font-medium uppercase text-[var(--clack-text-3)]">
          Delegated work
        </div>
        <div className="space-y-1">
          {activeTasks.map((task) => {
            const session = sessions.find(
              (candidate) => candidate.id === task.targetSessionId,
            );
            const agentId = session?.profile?.agentId ?? task.targetAgentId;
            const agentName =
              agents.find((agent) => agent.id === agentId)?.name ?? agentId;
            return (
              <div
                key={task.id}
                className="rounded-[var(--clack-radius-button)] bg-[var(--clack-surface-2)] px-2 py-1.5"
              >
                <div className="flex items-center gap-2 text-[10.5px]">
                  <span className="min-w-0 flex-1 truncate font-medium text-[var(--clack-text-1)]">
                    {agentName}
                  </span>
                  <span className="shrink-0 text-[var(--clack-accent)]">
                    {delegationActivityStatus(task, tasks, sessions, agents)}
                  </span>
                </div>
                <div className="truncate text-[9.5px] text-[var(--clack-text-3)]">
                  {task.prompt}
                </div>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function delegationActivityStatus(
  task: PeerTask,
  tasks: readonly PeerTask[],
  sessions: readonly SessionMeta[],
  agents: readonly { id: string; name: string }[],
): string {
  if (task.status === "running") return "Working";
  if (task.status === "queued") return "Queued";
  const waitingFor = task.dependsOn.flatMap((dependencyId) => {
    const dependency = tasks.find((candidate) => candidate.id === dependencyId);
    if (!dependency) return [];
    const session = sessions.find(
      (candidate) => candidate.id === dependency.targetSessionId,
    );
    const agentId = session?.profile?.agentId ?? dependency.targetAgentId;
    return [agents.find((agent) => agent.id === agentId)?.name ?? agentId];
  });
  if (waitingFor.length === 0) return "Waiting";
  return `Waiting for ${waitingFor.join(", ")}`;
}

function SessionRow({
  session,
  active,
  approvalsPending,
  openElsewhere,
  onSelect,
  onDelete,
}: {
  session: SessionMeta;
  active: boolean;
  approvalsPending: number;
  openElsewhere: boolean;
  onSelect: () => void;
  onDelete?: () => void;
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
        if (openElsewhere) {
          e.preventDefault();
          return;
        }
        onSelect();
      }}
      className={cn(
        "group flex items-center justify-between gap-2 text-xs",
        active && "bg-[var(--clack-accent-soft)]",
        openElsewhere && "opacity-55",
      )}
    >
      <span className="min-w-0 flex-1 truncate">
        {session.title || "New chat"}
      </span>
      {openElsewhere ? (
        <span className="shrink-0 text-[10px] text-[var(--clack-text-3)]">
          Open in another pane
        </span>
      ) : approvalsPending > 0 ? (
        <span className="shrink-0 text-[10px] text-[var(--clack-warning)]">
          Approval required
        </span>
      ) : session.run?.state === "running" ? (
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-[var(--clack-accent)]">
          <Spinner className="size-2.5" />
          Running
        </span>
      ) : null}
      {onDelete ? (
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
      ) : null}
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
